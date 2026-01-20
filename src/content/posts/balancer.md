---
title: "Breaking the Balancer V2 Invariant"
published: 2026-01-20
description: The math behind the $125M precision loss exploit on Nov 3, 2025.
tags: [DeFi]
category: Post-Mortem
licenseName: "Unlicensed"
author: 0xVrka
sourceLink: "https://github.com/0xvrka/"
draft: false
cover: '../../assets/images/wolf-prey-blood-c.png'
---

## Introduction

Precision attacks are hard to discover but devastating when found. On November 3, 2025, a $125 million exploit hit Balancer V2's Composable Stable Pools. The root cause wasn't a flashy reentrancy or a misconfigured access control. It was a single rounding function, operating exactly as written, that bled the protocol dry one wei at a time.

This post dissects the mathematics of the attack. We'll trace how the attacker used Balancer's internal balance system to drain a pool to near-zero liquidity, then weaponized arithmetic precision loss to collapse the pool's invariant, and finally bought back billions of pool tokens for essentially nothing.

**Important References:**
- [Balancer BPT Valuation](https://github.com/balancer/docs/blob/main/docs/concepts/advanced/valuing-bpt/valuing-bpt.md)
- [Stable Math Derivation](https://github.com/balancer/docs-v3/blob/v3-outline/docs/concepts/explore-available-balancer-pools/stable-pool/stable-math.md)
- [DeFiHackLabs Exploit PoC](https://github.com/SunWeb3Sec/DeFiHackLabs/blob/main/src/test/2025-11/BalancerV2_exp.sol)
- [Phalcon Transaction Trace](https://app.blocksec.com/phalcon/explorer/tx/eth/0x6ed07db1a9fe5c0794d44cd36081d6a6df103fab868cdd75d581e3bd23bc9742)

## Brief overview of Balancer V2
Balancer describes itself as a non-custodial portfolio manager and liquidity provider. While standard AMMs like Uniswap V2 rely on a 50/50 value split, Balancer allows for arbitrary weights (e.g., 80/20 pools) and multi-asset baskets.

The specific victim in this attack was the **Composable Stable Pool**. These pools are designed for assets that trade near parity, such as stablecoins or Liquid Staking Tokens. They use a specific invariant called Stable Math, derived from Curve's logic, to facilitate low-slippage swaps.

Crucially, every pool has a **Balancer Pool Token (BPT)**, representing a user's share of the liquidity. The price of this BPT is derived from the pool's total value, represented mathematically by the invariant $D$.

## Math behind Balancer
To understand the exploit, we have to look at how Balancer handles token amounts mathematically versus how it handles them in Solidity storage.

### The Invariant (D)
For stable pools, Balancer uses an invariant $D$ which represents the total virtual supply of the pool. Determining $D$ is done iteratively using the Stable Math equation:

$$
A \cdot n^n \cdot \sum{x_i} +D = A \cdot D \cdot n^n + { \frac{D^{n+1}}{{n}^{n}\cdot \prod{x_i} } }
$$

Where:
- $n$ is the number of tokens
- $x_i$ is the balance of token $i$
- $A$ is the amplification parameter

### BPT Valuation Models
The valuation of a Balancer Pool Token (BPT) plays a central role in on-chain behavior. For Composable Stable Pools, the on-chain price is typically derived via `pool.getRate()`. This function returns the exchange rate of a BPT to the underlying base asset. It is fundamentally tied to the Invariant $D$.

$$
P_{BPT} \approx \frac{D}{TotalSupply}
$$

This reliance on $D$ for on-chain pricing is exactly why manipulating the invariant causes the BPT price to collapse. Even if the balances (used in the informational formula) technically remain in the pool until the final withdrawal, the protocol *believes* the value is gone because $D$ has collapsed.

### Scaling Factors
Tokens have different decimals (e.g., USDC has 6, WETH has 18). To perform math on them, Balancer normalizes everything to 18 decimals.
* **Upscaling:** Converting native amounts to 18 decimals (Multiplication).
* **Downscaling:** Converting 18 decimals back to native amounts (Division).

This is where the vulnerability lies.

## The Core Vulnerability
The root cause is a violation of the *Error in Favor of the Protocol* principle. In DeFi, whenever there is rounding:
1.  If the user **gives** assets, you round **down** (count less).
2.  If the user **takes** assets, you round **up** (charge more).

This ensures the protocol never bleeds dust.

### The Rounding Mismatch
In Balancer's `upscale` function (used when reading input amounts), the protocol used **unidirectional rounding (rounding down)**.

When a user requests a swap of type `GIVEN_OUT` (I want to buy exactly $X$ tokens), the protocol calculates how many input tokens ($Y$) are required.

$$
\begin{aligned}
Amount_{in} = \text{calcInGivenOut}(Amount_{out})
\end{aligned}
$$

Inside the calculation, $Amount_{out}$ is upscaled. Because `upscale` uses `mulDown` (multiply and round down), the protocol essentially forgets the tiny fractional value at the end of the amount. 

This causes the calculated $Amount_{in}$ to be slightly **underestimated**. The attacker pays less than they mathematically should to extract the desired output.

### Deriving the TrickAmt

The attacker needs to calculate the exact swap amount that maximizes precision loss. Let's derive this from first principles.

The loss from a single upscale operation can be expressed as:

$$
Loss \approx x \cdot sf - y'
$$

Where $x$ is the token amount, $sf$ is the scaling factor, and $y'$ is the integer result after rounding down.

Expanding the true value:

$$
x \cdot sf = x \cdot (1 + Premium) = x + (x \cdot Premium)
$$

The protocol floors this result. To maximize the loss, we want the accumulated premium to be as close to 1 as possible without reaching it (so it gets completely truncated):

$$
(x \cdot Premium) \approx 1
$$

Solving for $x$:

$$
x = \frac{1}{Premium} = \frac{1}{sf - 1}
$$

In Solidity, this becomes:

$$
TrickAmt = \frac{C}{\frac{(sf - 10^{18}) \cdot C}{10^{18}}}
$$

Where $C$ is a scaling constant (e.g., 10,000) used to maintain precision in integer arithmetic. The $10^{18}$ terms normalize the scaling factor back to its decimal form. This simplifies to:

$$
TrickAmt = \frac{10^{18}}{sf - 10^{18}}
$$

This formula gives the precise amount that causes maximum precision loss (approaching 1 wei) per swap. The attacker repeats this across multiple rounds to compound the effect.

## The Attack Phases
The attacker crafted a specific swap path to exploit this precision loss repeatedly.

<svg width="520" height="580" viewBox="0 0 520 580" xmlns="http://www.w3.org/2000/svg" style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; margin: 20px auto; max-width: 520px; display: block;">
  <style>
    .box { fill: #ffffff; stroke: #333; stroke-width: 1.5px; rx: 4; }
    .critical { fill: #fff0f0; stroke: #d32f2f; stroke-width: 1.5px; rx: 4; }
    .title { font-family: sans-serif; font-size: 15px; font-weight: bold; fill: #111; text-anchor: middle; }
    .text { font-family: sans-serif; font-size: 13px; fill: #333; text-anchor: middle; }
    .muted { font-family: sans-serif; font-size: 11px; fill: #666; text-anchor: middle; }
    .arrow { stroke: #333; stroke-width: 1.5px; fill: none; marker-end: url(#arrowhead); }
  </style>
  
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#333" />
    </marker>
  </defs>

  <rect x="110" y="30" width="300" height="75" class="box" />
  <text x="260" y="55" class="title">Off-chain Calculation</text>
  <text x="260" y="75" class="text">Compute initBalance &amp; TrickAmt</text>
  <text x="260" y="92" class="muted">(Maximize rounding impact)</text>

  <path d="M260 105 L260 130" class="arrow" />

  <rect x="110" y="130" width="300" height="75" class="box" />
  <text x="260" y="155" class="title">Phase 1: Pool Setup</text>
  <text x="260" y="175" class="text">Borrow BPT, swap assets</text>
  <text x="260" y="192" class="text">Set pool to computed balances</text>

  <path d="M260 205 L260 230" class="arrow" />

  <rect x="110" y="230" width="300" height="95" class="critical" />
  <text x="260" y="255" class="title" style="fill: #c62828;">Phase 2: Precision Loss</text>
  <text x="260" y="275" class="text">Swap TrickAmt in low liquidity</text>
  <text x="260" y="293" class="text">1 wei rounding &#x21D2; massive impact</text>
  <text x="260" y="310" class="text">Invariant D collapses</text>

  <path d="M260 325 L260 350" class="arrow" />

  <rect x="110" y="350" width="300" height="75" class="box" />
  <text x="260" y="375" class="title">Phase 3: Arbitrage</text>
  <text x="260" y="395" class="text">Buy cheap BPT</text>
  <text x="260" y="412" class="text">Repay borrowed BPT</text>

  <path d="M260 425 L260 450" class="arrow" />

  <rect x="110" y="450" width="300" height="60" class="box" />
  <text x="260" y="475" class="title">Phase 4: Withdraw</text>
  <text x="260" y="495" class="text">Exit pool and extract value</text>
</svg>

### Phase 1: Draining to Setup

The attacker first uses an internal flash mint mechanism within Balancer's batchSwap. By specifying `fromInternalBalance: true` and `toInternalBalance: true`, the attacker can go **negative** on BPT during Phase 1, and only needs to settle at the **end** of the entire transaction.

This allows the attacker to extract almost all tokens from the pool:

```
=== PHASE 1 START ===
Target initBalance: 67000

Initial pool balances:
  osETH:  4,922,356,564,867,078,856,521  (~4,922 ETH)
  wETH:   6,851,581,236,039,298,760,900  (~6,851 ETH)

After 22 swap steps...

=== PHASE 1 COMPLETE ===
Final pool balances:
  osETH:  67,000 wei  (0.000000000000067 ETH)
  wETH:   67,000 wei  (0.000000000000067 ETH)

Total tokens extracted: ~11,773 ETH worth
```

The pool has been drained from ~11,773 ETH to just 134,000 wei total. This creates the **ultra-low liquidity** environment needed for Phase 2.

### Phase 2: The Precision Attack

This is where the real damage happens. With balances at just 67,000 wei, even 1 wei of precision loss becomes significant. The attacker executes 30 rounds of carefully calculated swap pairs.

Each round consists of:
1. **Large swap** (amount - trickAmt - 1): Moves most of the liquidity
2. **Trick swap** (trickAmt): Exploits precision loss to undercharge the attacker
3. **Reverse swap**: Resets the position for the next round

**The core observation:** In each trick swap, the invariant calculation loses precision due to rounding. Over 30 rounds, these losses compound.

```
Phase 2 Initial Invariant: 137,893

Round 0  → Invariant: 113,097 | Drop: 17%
Round 5  → Invariant:  40,892 | Drop: 70%
Round 10 → Invariant:  15,955 | Drop: 88%
Round 15 → Invariant:   7,033 | Drop: 94%
Round 20 → Invariant:   3,807 | Drop: 97%
Round 25 → Invariant:   2,649 | Drop: 98%
Round 29 → Invariant:   2,445 | Drop: 98%

=== PHASE 2 COMPLETE ===
Final simulated balances:
  Token 0: 889 wei
  Token 1: 1,472 wei
```

The invariant collapsed from ~138,000 to ~2,445—**a 98% drop**. This directly causes the BPT price to collapse by the same percentage.

### Phase 3: Buying the Dip

Now the BPT is essentially worthless on-chain. The attacker buys massive amounts of BPT for almost nothing:

```
=== PHASE 3 START ===
Initial State:
  BPT Total Supply: 11,847,097,352,927,601,082,261
  Invariant: 2,445 (collapsed!)
  BPT Price: ~0 (collapsed!)

Step 0: Buy 10,000 BPT         → Cost: 598 wei
Step 1: Buy 10,000,000 BPT     → Cost: 656 wei
Step 2: Buy 10,000,000,000 BPT → Cost: 685 wei
...
Step 6: Buy 10^22 BPT          → Cost: 5,991 wei

=== ATTACK STEPS (FINAL EXTRACTION) ===
Attack Step 0: Buy 941,319,322,493,191,942,754 BPT → Cost: 1,217 wei
Attack Step 1: Buy 941,319,322,493,191,942,754 BPT → Cost: 1,437 wei

Total BPT Acquired: ~11.89 × 10^21 BPT
Total Cost: ~10,345 wei
```

The attacker just bought \~11.89 quintillion BPT for about 10,000 wei (~$0.00003).

### The Net Profit Calculation

The attack uses an internal balance mechanism where:
- **Phase 1**: Attacker goes **negative** ~11.85 × 10²¹ BPT (the flash mint)
- **Phase 3**: Attacker gains **positive** ~11.89 × 10²¹ BPT (buying cheap)
- **Net**: The small difference is pure profit

```
=== PRECISE NET BPT SIMULATION ===
Phase 1 BPT Spent (simulated): 11,847,097,352,927,600,948,040
Phase 3 BPT Received:          11,892,648,654,996,393,895,508
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NET BPT GAIN:                      45,551,302,068,792,947,468

Actual result after execution:     44,154,666,372,672,521,145
```

The simulation is ~97% accurate. The ~44e18 BPT gained represents **~45 ETH of pure profit** at pre-attack prices.

---

## Under the Hood

To verify these claims, I ran a complete simulation of the attack. Here is the cryptographic evidence showing exactly how the invariant collapsed during Phase 2.

### Pool State Before and After

```
=== EXPLOIT EXECUTION START ===
Pool: 0xDACf5Fa19b1f720111609043ac67A9818262850c

BEFORE ATTACK:
  Actual Supply:     11,847,097,352,927,601,082,261
  Invariant D:       12,171,087,849,008,052,087,141
  BPT Price:         1.027347668920808516 ETH
  
AFTER ATTACK:
  Actual Supply:     11,893,097,110,063,641,448,681
  Invariant D:          240,115,638,684,764,457,005
  BPT Price:         0.020189496181073356 ETH
  
DAMAGE:
  Price Collapse:     98%
  Invariant Decrease: 11,930,972,210,323,287,630,136 (98%)
```

### The Precision Loss in Action

During Phase 2, each swap pair demonstrates the rounding error. Here's a single round showing the precision loss:

```
=== SWAP (Round 0, Step 1 - The Trick Swap) ===
Token Index In: 0 (osETH)
Token Index Out: 1 (wETH)

Input balances[0]: 374,353 wei
Input balances[1]: 18 wei

tokenAmountOut: 17 wei
amountOutScaled: 17 (after upscale with mulDown)
Scaling Factor:  1,058,132,398,695,929,516
Precision Loss Ratio: 1,000,000,000,000,000,000

Invariant BEFORE: 138,956
Invariant AFTER:  112,405
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Invariant Delta:   26,551 ← VALUE LEAKED!
```

Notice how the `Precision Loss Ratio` of `1e18` (no scaling compensation) combined with the tiny amounts causes an **Invariant Delta of 26,551**. This is value escaping the pool.

### The Cumulative Invariant Collapse

The following table shows the invariant at the end of each round of Phase 2:

| Round | Invariant | Drop % | Cumulative Loss |
|-------|-----------|--------|-----------------|
| 0     | 113,097   | 17%    | 24,796          |
| 5     | 40,892    | 70%    | 97,001          |
| 10    | 15,955    | 88%    | 121,938         |
| 15    | 7,033     | 94%    | 130,860         |
| 20    | 3,807     | 97%    | 134,086         |
| 25    | 2,649     | 98%    | 135,244         |
| 29    | 2,445     | 98%    | 135,448         |

Each row represents the state after that round's 3 swaps complete. The invariant drops monotonically due to accumulated precision loss.

### Cheap Token Costs

The collapsed invariant means BPT is essentially free:

| Step | BPT Requested | Token Cost | New Supply |
|------|--------------|------------|------------|
| 0    | 10,000       | 598 wei    | 11.847...e21 |
| 1    | 10,000,000   | 656 wei    | 11.847...e21 |
| 2    | 10^10        | 685 wei    | 11.847...e21 |
| 3    | 10^13        | 710 wei    | 11.847...e21 |
| 4    | 10^16        | 745 wei    | 11.847...e21 |
| 5    | 10^19        | 753 wei    | 11.857...e21 |
| 6    | 10^22        | 5,991 wei  | 21.857...e21 |
| Attack 0 | 9.41×10^20 | 1,217 wei | 22.798...e21 |
| Attack 1 | 9.41×10^20 | 1,437 wei | 23.739...e21 |

**Total cost to acquire ~11.89×10²¹ BPT: ~10,345 wei**

## Conclusion
This exploit is a harsh reminder that in Solidity, **order of operations and rounding direction are non-negotiable**. The inconsistency between `mulDown` (upscale) and `divUp` (downscale) created a window for precision loss.

The attack demonstrates several key lessons:
1. **Rounding must always favor the protocol** in AMM calculations
2. **Low liquidity amplifies precision attacks** exponentially
3. **Invariant-based pricing** is vulnerable when the invariant can be manipulated

If there is one takeaway: **Always round against the user.** If they are specifying output, round the required input UP. If they are specifying input, round the resulting output down. Consistency is key.

---
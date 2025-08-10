// src/utils/toc-highlight.ts
let observer: IntersectionObserver | null = null;

export function initTOCHighlight(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  
  const links: HTMLAnchorElement[] = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".toc-list .toc-link")
  );
  if (links.length === 0) return;

  const mapLinkById = new Map<string, HTMLAnchorElement>(
    links.map((a) => {
      const href = a.getAttribute("href") ?? "";
      const slug = href.replace(/^#/, "");
      return [slug, a];
    })
  );

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          links.forEach((a) => a.classList.remove("active"));
          const activeLink = mapLinkById.get(entry.target.id);
          if (activeLink) {
            activeLink.classList.add("active");
            activeLink.scrollIntoView({
              block: "nearest",   
              inline: "start",    
            });
          }
        }
      }
    },
    {
      rootMargin: "0px 0px -50% 0px",
      threshold: 0,
    }
  );

  for (const a of links) {
    const href = a.getAttribute("href") ?? "";
    const slug = href.replace(/^#/, "");
    const target = document.getElementById(slug);
    if (target) observer.observe(target);
  }
}
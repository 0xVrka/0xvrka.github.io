// src/utils/swup-init.ts
import { initTOCHighlight } from "./toc-highlight";
initTOCHighlight();
document.addEventListener("swup:content:replace", initTOCHighlight);
export interface PolicyControl { label: string; path: number[] }
export interface PageSnapshot { html: string; truncated: boolean; controls: PolicyControl[]; url: string }

/** Self-contained: executeScript serialises this function into the clicked tab. */
export function captureRenderedPage(): PageSnapshot {
  const output = document.implementation.createHTMLDocument(document.title);
  output.documentElement.lang = document.documentElement.lang;
  const skipped = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "head", "input", "textarea", "select", "option"]);
  const controls: PolicyControl[] = [];
  const seen = new WeakSet<Node>();
  const stack: { node: Node; parent: Node; path: number[] }[] = [{ node: document.documentElement, parent: output.body, path: [] }];
  let count = 0;
  let chars = 0;
  let truncated = false;
  while (stack.length) {
    const { node, parent, path } = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    if (++count > 30_000) { truncated = true; break; }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      chars += text.length;
      if (chars > 2 * 1024 * 1024) { truncated = true; break; }
      parent.appendChild(output.createTextNode(text));
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.localName;
    if (skipped.has(tag) || node.hasAttribute("hidden") || node.getAttribute("aria-hidden")?.toLowerCase() === "true") continue;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden" || style.opacity === "0") continue;
    // Only a control's own text: reading every ancestor's textContent would cost depth × page text.
    if (controls.length < 20 && (tag === "button" || node.getAttribute("role") === "button" || node.getAttribute("role") === "link" || (tag === "a" && (!node.getAttribute("href") || /^(#|javascript:)/i.test(node.getAttribute("href")!))))) {
      const label = (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 150);
      if (/terms|privacy|agreement|legal|conditions|data protection/i.test(label)) controls.push({ label, path });
    }
    // Keep structural metadata for banner exclusion, never page code or input values.
    const displayBlock = /^(block|flex|grid|list-item|table|flow-root)/.test(style.display);
    const inline = ["span", "em", "strong", "b", "i", "small", "label"].includes(tag);
    const clone = output.createElement(tag === "html" || tag === "body" || tag === "slot" || (displayBlock && inline) ? "div" : tag);
    for (const name of ["id", "class", "role", "aria-label", "aria-modal", "lang"]) {
      const value = node.getAttribute(name);
      if (value) clone.setAttribute(name, value);
    }
    for (const name of ["href", "data-href", "data-url"]) {
      const value = node.getAttribute(name);
      if (!value) continue;
      try {
        const url = new URL(value, document.baseURI);
        if (/^https?:$/.test(url.protocol)) clone.setAttribute(name, url.href);
      } catch { /* A control may have no readable address. */ }
    }
    if (tag === "a" && displayBlock) {
      const wrapper = output.createElement("div");
      wrapper.append(clone);
      parent.appendChild(wrapper);
    } else parent.appendChild(clone);
    const shadow = node.shadowRoot;
    const assigned = tag === "slot" ? (node as HTMLSlotElement).assignedNodes({ flatten: true }) : [];
    const children = shadow ? [...shadow.childNodes] : assigned.length ? assigned : [...node.childNodes];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]!;
      // A closed <details> only displays its summary.
      if (tag === "details" && !node.hasAttribute("open") && (!(child instanceof Element) || child.localName !== "summary")) continue;
      stack.push({ node: child, parent: clone, path: shadow ? [...path, -1, i] : assigned.length ? [] : [...path, i] });
    }
  }
  const html = output.documentElement.outerHTML;
  return { html: html.slice(0, 2 * 1024 * 1024), url: location.href, truncated: truncated || html.length > 2 * 1024 * 1024, controls };
}

/** Focus and reveal a discovered control. The user activates it on the page. */
export function locatePolicyControl(path: number[], expectedLabel: string): boolean {
  let node: Node | null = document.documentElement;
  for (const index of path) node = index === -1 ? (node instanceof Element ? node.shadowRoot : null) : node?.childNodes[index] ?? null;
  if (!(node instanceof HTMLElement)) return false;
  const label = (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 150);
  if (label !== expectedLabel) return false;
  node.scrollIntoView({ block: "center" });
  node.focus();
  return true;
}

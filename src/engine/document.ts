// Turning a page into numbered clauses, as docs/reader.md ("Reading a
// document") describes: skipped and block elements, joining of short blocks,
// offsets. Offsets count Unicode code points, so a quote's position means the
// same in any implementation.

/** Elements whose text is never part of what a reader agrees to. */
const SKIPPED = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "head", "button", "select", "option", "form"]);

/** Elements that end a block of text. */
const BLOCKS = new Set([
  "p", "div", "section", "article", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr", "td", "th",
  "blockquote", "pre", "dd", "dt", "header", "footer", "main", "nav", "aside", "ul", "ol", "table",
  "hr", "summary", "details", "figcaption", "figure", "caption", "address", "dl", "legend", "fieldset", "hgroup",
]);

/** Elements that never hold text: never a dialog or a banner. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** How a cookie or consent banner names itself in its id, a class or its aria-label, matched on the ASCII-lowercased value: structural words only, never a vendor's name. */
const CONSENT_NAME = /(cookie|consent)[-_ ]?(banner|bar|notice|popup|modal|dialog|sdk|manager|preferences|prompt)/;

/** A dialog or banner with more words than this, or a heading, main or article inside, is part of the document, and is read. */
const MAX_BANNER_WORDS = 80;

/** HTML's ASCII whitespace: words are split and attribute values trimmed on it alone, as docs/reader.md says. */
const ASCII_SPACE = "\t\n\f\r ";
const trimAscii = (s: string) => s.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
/** A-Z only, as HTML compares attribute values. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const attrIs = (el: Element, name: string, ...want: string[]) => {
  const v = el.getAttribute(name);
  return v !== null && want.includes(asciiLower(trimAscii(v)));
};

/**
 * Walks a dialog or banner candidate: readable when a heading, main or article
 * is inside or it holds more than MAX_BANNER_WORDS words (as its textContent
 * would split), and whether it holds a control. Stops at the first sign it is
 * readable, so nested banners on a hostile page cost a few words each.
 */
function inspect(el: Element): { readable: boolean; control: boolean } {
  let words = 0;
  let inWord = false;
  let control = false;
  // Template content is not in the tree, as in textContent and querySelector.
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.nodeValue ?? "";
      for (let i = 0; i < t.length; i++) {
        if (ASCII_SPACE.includes(t[i]!)) inWord = false;
        else if (!inWord) {
          inWord = true;
          if (++words > MAX_BANNER_WORDS) return { readable: true, control };
        }
      }
      continue;
    }
    const c = n as Element;
    if (/^(main|article|h[1-6])$/.test(c.localName)) return { readable: true, control };
    if (c.localName === "button" || c.localName === "input" || attrIs(c, "role", "button")) control = true;
  }
  return { readable: false, control };
}

/**
 * A dialog or consent banner, whose text sits over the document and is not
 * part of what a reader agrees to: a <dialog>, role dialog or alertdialog, or
 * aria-modal; or an element named as a cookie or consent banner that sits
 * outside main and article and holds a control. Either is read after all when
 * it holds a heading, main or article, or more than MAX_BANNER_WORDS words,
 * except a dialog that is, or sits in, an element named as consent (a
 * preference centre). html, body, main and void elements never are.
 */
function overlay(el: Element): boolean {
  const tag = el.localName;
  if (VOID.has(tag) || tag === "html" || tag === "body" || tag === "main") return false;
  const dialog = tag === "dialog" || attrIs(el, "role", "dialog", "alertdialog") || attrIs(el, "aria-modal", "true");
  if (!dialog) {
    if (!consentNamed(el)) return false;
    if (el.parentElement?.closest("main, article")) return false;
  }
  const { readable, control } = inspect(el);
  // A consent preference centre is a long dialog with headings: still not the
  // document when it, or what holds it, is named as consent.
  if (dialog && readable) {
    for (let p: Element | null = el; p; p = p.parentElement) if (consentNamed(p)) return true;
  }
  return !readable && (dialog || control);
}

/** Whether an element's id, a class or its aria-label names a cookie or consent banner. */
const consentNamed = (el: Element) => ["id", "class", "aria-label"].some((a) => CONSENT_NAME.test(asciiLower(el.getAttribute(a) ?? "")));

/** A block shorter than this (a heading, "Last updated: …") joins the next. */
export const MIN_CLAUSE_CHARS = 40;

const SPACE_RUN = /[ \t\r\f\v ]+/g;
const collapse = (s: string) => s.replace(SPACE_RUN, " ").trim();
export const length = (s: string) => Array.from(s).length;

export interface Clause {
  index: number;
  text: string;
  /** Code-point offset of `text` in the document body. */
  start: number;
}

export interface Document {
  body: string;
  clauses: Clause[];
}

/** The page's readable text, one block per block element. */
export function htmlToBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: string[] = [];
  let cur = "";
  const flush = () => {
    const t = collapse(cur);
    if (t) blocks.push(t);
    cur = "";
  };
  // An explicit stack, not recursion: a hostile page nesting thousands of
  // elements must not overflow the call stack. A null entry closes a block.
  const stack: (Node | null)[] = [doc.documentElement];
  while (stack.length) {
    const node = stack.pop();
    if (node === null) {
      flush();
      continue;
    }
    if (!node) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      // As written: inline elements add no space, so `collected</a>,` reads "collected,".
      cur += node.nodeValue ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = (node as Element).localName;
    const skipped = SKIPPED.has(tag);
    if (skipped || overlay(node as Element)) {
      // Text on either side of a skipped block, banner or form never runs together.
      if (BLOCKS.has(tag) || tag === "form" || !skipped) flush();
      continue;
    }
    const block = BLOCKS.has(tag);
    if (block) {
      flush();
      stack.push(null);
    }
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  flush();
  return blocks;
}

/** Plain text split on blank lines. */
export function textToBlocks(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => collapse(p.replace(/\n/g, " ")))
    .filter(Boolean);
}

export function buildDocument(blocks: string[]): Document {
  const merged: string[] = [];
  let pending = "";
  for (let b of blocks) {
    if (pending) {
      // A line break, not a space: the heading stays with its clause but is
      // never part of the same sentence.
      b = `${pending}\n${b}`;
      pending = "";
    }
    if (length(b) < MIN_CLAUSE_CHARS) {
      pending = b;
      continue;
    }
    merged.push(b);
  }
  if (pending) merged.push(pending);

  const clauses: Clause[] = [];
  let offset = 0;
  merged.forEach((text, index) => {
    if (index > 0) offset += 2;
    clauses.push({ index, text, start: offset });
    offset += length(text);
  });
  return { body: merged.join("\n\n"), clauses };
}

export const wordCount = (doc: Document) => doc.body.split(/\s+/).filter(Boolean).length;

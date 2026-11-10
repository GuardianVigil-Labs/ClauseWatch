// <cw-report>: what a service's documents say, quoted. A closed Shadow DOM, so
// the same element can later sit on any page without inheriting or leaking
// styles. "Not found" and "could not read" are shown as such; nothing here
// ever says "safe" or gives a score.

import type { Finding } from "../engine/rules";
import type { DocumentResult, Kind } from "../engine/documents";
import { foundCount } from "./scan";

export interface Report {
  site: string;
  documents: DocumentResult[];
  /** Offers "Copy quote & share" on each finding (the popup only; never the page card). */
  onQuote?: (kind: "terms" | "privacy", quote: string) => void;
  /** The site card; the page card leaves it out, its title already names the site. */
  siteCard?: boolean;
}

const CATEGORY: Record<string, { label: string }> = {
  ai_training: { label: "AI training on your content" },
  arbitration: { label: "Arbitration and class-action waiver" },
  ip_assignment: { label: "Rights over your content" },
  data_sale: { label: "Sale or brokering of personal data" },
  unilateral_change: { label: "Changes without notice" },
  data_retention: { label: "Data kept after you leave" },
  ad_sharing: { label: "Data shared for advertising" },
  auto_renewal: { label: "Automatic renewal" },
  liability_limit: { label: "Limits on the company's liability" },
  governing_law: { label: "Governing law and courts" },
  children_data: { label: "Children's data" },
  location_biometric: { label: "Location and biometric data" },
  termination: { label: "Account termination and suspension" },
};
/** A topic's plain name, for banners and cards; an unknown topic shows its key. */
export const topicLabel = (c: string): string => CATEGORY[c]?.label ?? c;

const KIND_LABEL: Record<Kind, string> = { terms: "Terms of service", privacy: "Privacy policy" };

/** A finding's edge and badge colour: red, amber or blue, only on real findings. */
const TONE: Record<string, { tone: "red" | "amber" | "blue"; badge: string }> = {
  ai_training: { tone: "red", badge: "AI training" },
  data_sale: { tone: "red", badge: "Data sale" },
  ip_assignment: { tone: "red", badge: "Your content" },
  location_biometric: { tone: "red", badge: "Location and biometrics" },
  children_data: { tone: "red", badge: "Children" },
  arbitration: { tone: "amber", badge: "Arbitration" },
  ad_sharing: { tone: "amber", badge: "Advertising" },
  data_retention: { tone: "amber", badge: "Retention" },
  auto_renewal: { tone: "amber", badge: "Renewal" },
  liability_limit: { tone: "amber", badge: "Liability" },
  termination: { tone: "amber", badge: "Termination" },
  unilateral_change: { tone: "blue", badge: "Changes" },
  governing_law: { tone: "blue", badge: "Law and courts" },
};

const CUT = `background: linear-gradient(to bottom left, transparent 50%, #1d232d 50%, #1d232d calc(50% + 1px), transparent calc(50% + 1px)) top right / 12px 12px no-repeat border-box, #0c1017; clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);`;

const STYLE = `
:host { all: initial; display: block; font: 13px/1.5 var(--cw-font, ui-sans-serif, system-ui, sans-serif); color: #a3a3a3; }
.card { border: 1px solid #1d232d; padding: 10px 12px; margin: 0 0 10px; ${CUT} }
.site { display: flex; align-items: center; gap: 10px; }
.initial { flex: none; width: 26px; height: 26px; border: 1px solid #323a46; display: grid; place-items: center; color: #fafafa; font-weight: 600; font-size: 12px; }
.site .who { flex: 1; min-width: 0; }
.site p { margin: 0; }
.mono { font-family: var(--cw-mono, ui-monospace, SFMono-Regular, monospace); }
.site .name { color: #fafafa; font-size: 14px; overflow-wrap: anywhere; }
.meta { font-size: 11px; color: #8a8a8a; margin: 0; }
.badge { flex: none; border: 1px solid; padding: 1px 6px; font-size: 11px; white-space: nowrap; }
.badge.red { color: #fca5a5; border-color: #7f1d1d; background: #2a0b0b; }
.badge.amber { color: #fcd34d; border-color: #78350f; background: #2a1d06; }
.badge.blue { color: #93c5fd; border-color: #1e3a8a; background: #0b1730; }
.badge.plain { color: #a3a3a3; border-color: #323a46; }
.finding { border-left-width: 2px; }
.finding.red { border-left-color: #ef4444; }
.finding.amber { border-left-color: #f59e0b; }
.finding.blue { border-left-color: #2f80ff; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
h2 { font-size: 13px; font-weight: 500; margin: 0; color: #fafafa; }
blockquote { margin: 6px 0; padding-left: 8px; border-left: 1px solid #323a46; color: #fafafa; }
.source { font-size: 11px; color: #8a8a8a; margin: 0; }
.source a, button.share { color: #8a8a8a; }
button.share { background: none; border: 0; font: inherit; padding: 0; cursor: pointer; text-decoration: underline; }
.unread { margin: 4px 0 0; }
.allows { margin: 2px 0 0; font-size: 12px; color: #a3a3a3; }
.meta a { color: #8a8a8a; }
.absent { margin: 0 0 4px; color: #a3a3a3; }
button.share:focus-visible, a:focus-visible { outline: 2px solid #2f80ff; outline-offset: 2px; }
`;

export class ReportElement extends HTMLElement {
  #root = this.attachShadow({ mode: "closed" });

  set report(r: Report) {
    fillReport(this.#root, r);
  }
}

/** The report into a shadow root: the custom element's, or the page card's own. */
export function fillReport(root: ShadowRoot, r: Report): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  root.replaceChildren(style, ...reportCards(r));
}

/** The cards, in order: the site, each finding, what was not found, what could not be read. */
export function reportCards(r: Report): HTMLElement[] {
  const read = r.documents.filter((d): d is Extract<DocumentResult, { status: "read" }> => d.status === "read");
  const cards = r.siteCard === false ? [] : [siteCard(r.site, r.documents)];
  for (const d of read) {
    const notes = [...(d.notices ?? [])];
    if (otherLanguage(d)) notes.push(`Language coverage: ${d.coverage!.language}. No built-in rule pack covers this language; only the English rules were applied, so topics written in this language may be missed.`);
    else if (d.coverage?.status === "unsupported") notes.push(`The page is marked as ${d.coverage.language}, but its language could not be identified confidently. The English rules were applied; topics may be missed.`);
    if (d.coverage?.status === "supported") notes.push(d.coverage.confident === false
      ? `Language pack: ${d.coverage.language}, version 1, applied alongside the English rules because the language could not be identified confidently.`
      : `Language pack: ${d.coverage.language}, version 1. Limited coverage: data sale, automatic renewal and arbitration only. English and custom rules are not applied to this document.`);
    if (d.coverage?.status === "unknown") notes.push("Language could not be identified confidently. Default English checks were used; topics may be missed.");
    if (notes.length) {
      const card = el("section", undefined, "card");
      card.setAttribute("aria-label", "Reading coverage");
      for (const note of notes) card.append(el("p", note, "meta"));
      cards.push(card);
    }
  }
  const shown = new Set<string>();
  for (const d of read) for (const c of d.categories) if (c.status === "found") for (const f of c.findings) {
    const key = JSON.stringify([d.kind, d.url, c.category, f.start, f.end]);
    if (shown.has(key)) continue;
    shown.add(key);
    cards.push(findingCard(d, c.category, f, r.onQuote));
  }
  const absent = notFoundCard(read.filter((d) => !otherLanguage(d)));
  if (absent) cards.push(absent);
  for (const d of r.documents) if (d.status === "could_not_read") cards.push(unreadCard(d));
  return cards;
}

/** Text identified as a language without a pack: English rules ran, so a missing topic proves nothing. */
const otherLanguage = (d: DocumentResult) => d.status === "read" && d.coverage?.status === "unsupported" && d.coverage.confident !== false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text; // text only: page-sourced quotes never become markup
  if (cls) e.className = cls;
  return e;
}

/** "just now", "5 min ago", or the date. */
export function readWhen(iso: string, now = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!(min >= 0)) return new Date(iso).toLocaleString();
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return new Date(iso).toLocaleString();
}

function siteCard(site: string, documents: DocumentResult[]): HTMLElement {
  const card = el("div", undefined, "card site");
  const found = foundCount(documents);
  const read = documents.filter((d): d is Extract<DocumentResult, { status: "read" }> => d.status === "read");
  const what = read.length ? `${read.map((d) => KIND_LABEL[d.kind]).join(", ")} · read ${readWhen(read[0]!.readAt)}` : documents.length ? "Nothing could be read" : "No sign-up form or terms on this page";
  const who = el("div", undefined, "who");
  who.append(el("p", site, "name mono"), el("p", what, "meta"));
  card.append(el("span", site.replace(/^[^a-z0-9]+/i, "").slice(0, 1).toUpperCase() || "?", "initial"), who);
  if (found || read.some((d) => !otherLanguage(d))) card.append(el("span", `${found} found`, `badge ${found ? "amber" : "plain"}`));
  return card;
}

function findingCard(d: Extract<DocumentResult, { status: "read" }>, category: string, finding: Finding, onQuote?: Report["onQuote"]): HTMLElement {
  const t = TONE[category] ?? { tone: "blue" as const, badge: topicLabel(category) };
  const card = el("article", undefined, `card finding ${t.tone}`);
  const head = el("div", undefined, "head");
  head.append(el("h2", topicLabel(category)), el("span", t.badge, `badge ${t.tone}`));
  const quote = finding.quote;
  const source = el("p", KIND_LABEL[d.kind], "source mono");
  // Only a web address is a link (pasted text has none).
  if (/^https?:\/\//i.test(d.url)) {
    const a = el("a", "open ↗");
    const destination = new URL(d.url);
    destination.hash = destination.hash.split(":~:")[0]! + ":~:text=" + encodeURIComponent(quote).replace(/-/g, "%2D");
    a.href = destination.href;
    a.textContent = "Highlight quote in policy ↗";
    a.title = "Open the policy with this quote highlighted where supported";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    source.append(" · ", a);
  } else source.append(" · pasted text");
  if (onQuote) {
    const share = el("button", "copy quote & share", "share");
    share.type = "button";
    share.addEventListener("click", () => onQuote(d.kind, quote));
    source.append(" · ", share);
  }
  card.append(head, el("p", "A rule matched this topic. The quoted conditions and exceptions determine what it says.", "allows"), el("blockquote", `“${quote}”`), source);
  if (finding.matchKind === "list") card.append(el("p", "This quote includes a list introduction and its adjacent item.", "meta"));
  const qualified = /\b(unless|except|only\s+(if|with|when)|if\s+you|subject\s+to|provided\s+that|with\s+your\s+(consent|permission))\b/i.exec(quote);
  if (qualified) card.append(el("p", `Wording to review in the quote: “${quote.slice(qualified.index)}”`, "meta"));
  {
    const details = el("details");
    details.append(el("summary", "Show surrounding text"));
    const excerpt = el("blockquote", finding.context?.text ?? quote);
    excerpt.style.whiteSpace = "pre-wrap";
    details.append(el("p", finding.context ? "Source excerpt, including nearby sentences and paragraphs. It may contain qualifications or exceptions; it is not an additional finding." : "Only the quoted text is available for this saved finding.", "meta"), excerpt);
    card.append(details);
  }
  return card;
}

function notFoundCard(read: Extract<DocumentResult, { status: "read" }>[]): HTMLElement | null {
  const found = new Set(read.flatMap((d) => d.categories.filter((c) => c.status === "found").map((c) => c.category)));
  const absent = [...new Set(read.flatMap((d) => d.categories.map((c) => c.category)))].filter((c) => !found.has(c));
  if (!absent.length) return null;
  const card = el("div", undefined, "card");
  card.append(
    el("p", `Not found: ${absent.map(topicLabel).join(", ")}`, "absent"),
    checkedLine(read),
  );
  return card;
}

/** "Checked: Terms of service ↗, …", each a link to the document where it has an address. */
function checkedLine(read: Extract<DocumentResult, { status: "read" }>[]): HTMLElement {
  const p = el("p", "Checked: ", "meta");
  read.forEach((d, i) => {
    if (i) p.append(", ");
    if (/^https?:\/\//i.test(d.url)) {
      const a = el("a", `${KIND_LABEL[d.kind]} ↗`);
      a.href = d.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      p.append(a);
    } else p.append(KIND_LABEL[d.kind]);
  });
  p.append(". “Not found” is not “safe”.");
  return p;
}

function unreadCard(d: Extract<DocumentResult, { status: "could_not_read" }>): HTMLElement {
  const card = el("div", undefined, "card");
  card.append(el("h2", KIND_LABEL[d.kind]), el("p", `Could not read this document. ${d.reason}`, "unread"));
  if (d.url && /^https?:\/\//i.test(d.url)) {
    const open = el("a", "Open policy in a tab");
    open.href = d.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    card.append(open);
  }
  return card;
}

/** A topic's short name, as on the finding badges; the plain name when it has none. */
export const topicShort = (c: string): string => TONE[c]?.badge ?? topicLabel(c);

// Defined by the extension's own pages (the popup), never here: a content script
// has no custom elements in Chromium, and in Firefox would define it on the page.
// The page card uses fillReport on a shadow root of its own.

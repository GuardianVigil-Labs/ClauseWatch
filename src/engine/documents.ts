// Recognising a terms or privacy document, and finding a site's links to them.
// Same words and thresholds as docs/reader.md.

import { getDomain } from "tldts";
import { languageRules } from "./language-packs";
import { languageCoverage, type Coverage } from "./language";
import { buildDocument, htmlToBlocks, textToBlocks, wordCount, hiddenElement, type Document } from "./document";
import { localHost } from "./known-sites";
import { analyse, byCategory, type CategoryResult, type CompiledRules } from "./rules";

export type Kind = "terms" | "privacy";
export const KINDS: Kind[] = ["terms", "privacy"];

/** Minimum readable content; identity is checked separately and may be chosen explicitly. */
export const MIN_DOC_WORDS = 8;

/** What a document calls itself. A page that never says it is not that document. */
export const DOCUMENT_NAMES: Record<Kind, RegExp> = {
  terms: /t[eé]rminos (y condiciones|de (uso|servicio))|condiciones (de uso|generales)|conditions (g[eé]n[eé]rales|d.utilisation)|\bterms\s+(of\s+(service|use|sale|purchase)|and\s+conditions|&\s+conditions)\b|\b(user|customer|subscription|services?|end[- ]user|master\s+services?)\s+(agreement|terms)\b|\b(end[- ]user\s+)?licen[cs]e\s+agreement\b/i,
  privacy: /pol[ií]tica de privacidad|politique de confidentialit[eé]|\b(privacy|data\s+protection)\s+(policy|statement|notice)\b/i,
};

/** Words in a link's label (or path) that suggest it leads to the document. */
const LINK_WORDS: Record<Kind, RegExp> = {
  terms: /\bterms\b|\bterms of (service|use)\b|\btos\b/i,
  privacy: /\bprivacy\b/i,
};

export const COMMON_PATHS: Record<Kind, string[]> = {
  terms: ["/terms", "/terms-of-service", "/tos", "/legal/terms", "/terms-of-use", "/legal/terms-of-service"],
  privacy: ["/privacy", "/privacy-policy", "/legal/privacy", "/legal/privacy-policy"],
};

/** Registrable domain from the bundled Public Suffix List, including private hosts. */
export function registrable(host: string): string | null {
  try {
    if (localHost(host)) return null;
    const canonical = new URL(`https://${host.replace(/\.+$/, "")}`).hostname;
    return getDomain(canonical, { allowPrivateDomains: true });
  } catch { return null; }
}

/** Same site: the same registrable domain (app.service.example, legal.service.example and service.example). */
export function sameSite(host: string, siteHost: string): boolean {
  const a = registrable(host);
  return a !== null && a === registrable(siteHost);
}

/**
 * Links on a page that lead to its terms or privacy documents, on the same
 * site. A link whose label names the document ("Privacy Policy") comes first;
 * a link that only mentions the word comes after.
 */
export function discoverLinks(html: string, pageUrl: string, { external = false } = {}): Record<Kind, string[]> {
  const out: Record<Kind, string[]> = { terms: [], privacy: [] };
  const page = new URL(pageUrl);
  if (localHost(page.hostname)) return out;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of Array.from(doc.querySelectorAll("a[href], [data-href], [data-url]"))) {
    let u: URL;
    try {
      u = new URL(a.getAttribute("href") ?? a.getAttribute("data-href") ?? a.getAttribute("data-url") ?? "", page);
    } catch {
      continue;
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || localHost(u.hostname) || (!external && !sameSite(u.hostname, page.hostname)) || u.username || u.password) continue;
    let hidden = false;
    for (let parent: Element | null = a; parent; parent = parent.parentElement) if (hiddenElement(parent)) { hidden = true; break; }
    if (hidden) continue;
    u.hash = "";
    const label = `${a.textContent ?? ""} ${u.pathname.replace(/[-_/]/g, " ")}`;
    for (const kind of KINDS) {
      const href = u.toString();
      if (out[kind].includes(href)) continue;
      if (DOCUMENT_NAMES[kind].test(label)) out[kind].unshift(href);
      else if (LINK_WORDS[kind].test(label)) out[kind].push(href);
    }
  }
  return out;
}

export type DocumentResult =
  | { kind: Kind; status: "read"; url: string; readAt: string; categories: CategoryResult[]; body: string; coverage?: Coverage; notices?: string[] }
  | { kind: Kind; status: "could_not_read"; url?: string; reason: string };

/** Reads one fetched or current page as a document of `kind`, or says why it cannot. */
export function readDocument(kind: Kind, url: string, content: string, contentType: string, rules: CompiledRules, { explicitKind = false, language = "", rendered = false } = {}): DocumentResult {
  const type = contentType.toLowerCase();
  let doc: Document;
  if (type.includes("text/html") || type === "") doc = buildDocument(htmlToBlocks(content));
  else if (type.includes("text/plain")) doc = buildDocument(textToBlocks(content));
  else return { kind, status: "could_not_read", url, reason: type.includes("pdf") ? "The PDF must be decoded first. Scan its link or paste its extracted text." : "This format is not a supported policy document. Use HTML, plain text or a PDF link." };

  if (wordCount(doc) < rules.minQuoteWords) return { kind, status: "could_not_read", url, reason: `Not enough readable text. At least ${rules.minQuoteWords} words are needed. Open the policy in a tab after its text has loaded.` };
  if (!language && type.includes("html")) language = new DOMParser().parseFromString(content, "text/html").documentElement.lang;
  const coverage = languageCoverage(doc.body, language);
  const activeRules = languageRules(coverage.language, rules);
  if (!explicitKind && (!DOCUMENT_NAMES[kind].test(identityText(content, type, doc.body)) || accessWall(doc))) {
    return { kind, status: "could_not_read", url, reason: coverage.status === "unsupported" ? `Language coverage: ${coverage.language}. No built-in rule pack covers this language. Choose the document type to view its text without topic checks.` : "The document type could not be recognised. Choose Terms or Privacy to read the text, or open the policy in a tab after it has loaded." };
  }
  return { kind, status: "read", url, readAt: new Date().toISOString(), body: doc.body, coverage,
    notices: [...(rules.skipped?.length ? [`${rules.skipped.length} custom rules did not run. Review Settings → Rules for details.`] : []), ...(explicitKind ? ["You chose the document type. ClauseWatch has not verified that this text is the complete policy."] : []), ...(!rendered && (type.includes("html") || !type) ? ["Read from downloaded HTML. Visibility controlled by styles or scripts could not be verified; use the visible-page reader to check what is displayed."] : [])],
    categories: coverage.status === "unsupported" ? [] : byCategory(analyse(doc, activeRules), activeRules) };

}

/**
 * Text the person selected on a page and asked about (the right-click menu):
 * a clause or a few, so neither the document's minimum length nor its name is
 * required. It is reported as terms, quoted from that page.
 */
export function readSelection(text: string, url: string, rules: CompiledRules): DocumentResult {
  const doc = buildDocument(textToBlocks(text));
  if (wordCount(doc) < rules.minQuoteWords) return { kind: "terms", status: "could_not_read", url, reason: `Select at least ${rules.minQuoteWords} words of the terms.` };
  const coverage = languageCoverage(doc.body);
  const activeRules = languageRules(coverage.language, rules);
  return { kind: "terms", status: "read", url, readAt: new Date().toISOString(), body: doc.body, coverage, notices: rules.skipped?.length ? [`${rules.skipped.length} custom rules did not run. Review Settings → Rules for details.`] : [], categories: coverage.status === "unsupported" ? [] : byCategory(analyse(doc, activeRules), activeRules) };
}

/** Which kinds of document a page itself is, if any. */
export function kindsOfPage(html: string): Kind[] {
  const doc = buildDocument(htmlToBlocks(html));
  if (wordCount(doc) < MIN_DOC_WORDS || accessWall(doc)) return [];
  const kinds = KINDS.filter((k) => DOCUMENT_NAMES[k].test(identityText(html, "text/html", doc.body)));
  // A terms page that mentions the privacy policy is not one too: when the
  // page's title or main heading names a kind, it is that kind only.
  // Known limit: parses the page a second time (htmlToBlocks parsed it); pages are capped at 2 MB.
  const heading = htmlHeading(html, "text/html");
  const named = kinds.filter((k) => DOCUMENT_NAMES[k].test(heading));
  return named.length ? named : kinds;
}

const accessWall = (doc: Document) => wordCount(doc) < 120 && /\b(sign in to continue|log in to continue|verify (that )?you are human|checking your browser|access denied|enable javascript|javascript is required)\b/i.test(doc.body);
function htmlHeading(content: string, type: string): string {
  if (type && !type.includes("html")) return "";
  const page = new DOMParser().parseFromString(content, "text/html");
  const heading = [...page.querySelectorAll("h1")].find((el) => {
    for (let p: Element | null = el; p; p = p.parentElement) if (hiddenElement(p)) return false;
    return true;
  });
  return `${page.title} ${heading?.textContent ?? ""}`;
}

function identityText(content: string, type: string, body: string): string {
  if (type && !type.includes("html")) return body;
  const page = new DOMParser().parseFromString(content, "text/html");
  for (const element of page.querySelectorAll("a, nav, footer, [hidden], [aria-hidden=true]")) {
    if (element.localName === "a" && element.closest("h1, h2, h3")) continue;
    element.remove();
  }
  return `${htmlHeading(content, type)} ${buildDocument(htmlToBlocks(page.documentElement.outerHTML)).body}`;
}

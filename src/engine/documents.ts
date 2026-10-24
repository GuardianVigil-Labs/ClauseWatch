// Recognising a terms or privacy document, and finding a site's links to them.
// Same words and thresholds as docs/reader.md.

import { buildDocument, htmlToBlocks, textToBlocks, wordCount, type Document } from "./document";
import { localHost } from "./known-sites";
import { analyse, byCategory, type CategoryResult, type CompiledRules } from "./rules";

export type Kind = "terms" | "privacy";
export const KINDS: Kind[] = ["terms", "privacy"];

/** A document needs this many words: fewer is a sign-in wall or a banner. */
export const MIN_DOC_WORDS = 300;

/** What a document calls itself. A page that never says it is not that document. */
export const DOCUMENT_NAMES: Record<Kind, RegExp> = {
  terms: /\bterms\s+(of\s+(service|use)|and\s+conditions|&\s+conditions)\b|\buser\s+agreement\b|\bterms\s+of\s+service\b/i,
  privacy: /\bprivacy\s+(policy|statement|notice)\b/i,
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

/** Second-level public suffixes under a country code (co.uk, com.au, gov.in...): never a site. */
const SECOND_LEVEL = /^(co|com|net|org|gov|edu|ac|or|ne|go|gob|nic|mil|ltd|plc|sch|nhs|police|me|biz|info|int|lg|ad|ed|gr|nom)\.[a-z]{2}$/;

/**
 * The registrable part of a host: its last two labels, or three under a
 * second-level suffix (shop.co.uk). A bare suffix has none.
 * Known limit: a short list, not the Public Suffix List; add the list if a real case slips through.
 */
export function registrable(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.+$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const two = labels.slice(-2).join(".");
  if (!SECOND_LEVEL.test(two)) return two;
  return labels.length >= 3 ? labels.slice(-3).join(".") : null;
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
export function discoverLinks(html: string, pageUrl: string): Record<Kind, string[]> {
  const out: Record<Kind, string[]> = { terms: [], privacy: [] };
  const page = new URL(pageUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    let u: URL;
    try {
      u = new URL(a.getAttribute("href") ?? "", page);
    } catch {
      continue;
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || localHost(u.hostname) || !sameSite(u.hostname, page.hostname)) continue;
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
  | { kind: Kind; status: "read"; url: string; readAt: string; categories: CategoryResult[]; body: string }
  | { kind: Kind; status: "could_not_read"; url?: string; reason: string };

/** Reads one fetched or current page as a document of `kind`, or says why it cannot. */
export function readDocument(kind: Kind, url: string, content: string, contentType: string, rules: CompiledRules): DocumentResult {
  const type = contentType.toLowerCase();
  let doc: Document;
  if (type.includes("text/html") || type === "") doc = buildDocument(htmlToBlocks(content));
  else if (type.includes("text/plain")) doc = buildDocument(textToBlocks(content));
  else return { kind, status: "could_not_read", url, reason: "The page is not a web page or plain text (for example, a PDF)." };

  if (wordCount(doc) < MIN_DOC_WORDS || !DOCUMENT_NAMES[kind].test(doc.body)) {
    return { kind, status: "could_not_read", url, reason: `This page is not a ${kind === "terms" ? "terms of service" : "privacy policy"} document.` };
  }
  return { kind, status: "read", url, readAt: new Date().toISOString(), body: doc.body, categories: byCategory(analyse(doc, rules), rules) };
}

/**
 * Text the person selected on a page and asked about (the right-click menu):
 * a clause or a few, so neither the document's minimum length nor its name is
 * required. It is reported as terms, quoted from that page.
 */
export function readSelection(text: string, url: string, rules: CompiledRules): DocumentResult {
  const doc = buildDocument(textToBlocks(text));
  if (wordCount(doc) < rules.minQuoteWords) return { kind: "terms", status: "could_not_read", url, reason: `Select at least ${rules.minQuoteWords} words of the terms.` };
  return { kind: "terms", status: "read", url, readAt: new Date().toISOString(), body: doc.body, categories: byCategory(analyse(doc, rules), rules) };
}

/** Which kinds of document a page itself is, if any. */
export function kindsOfPage(html: string): Kind[] {
  const doc = buildDocument(htmlToBlocks(html));
  if (wordCount(doc) < MIN_DOC_WORDS) return [];
  const kinds = KINDS.filter((k) => DOCUMENT_NAMES[k].test(doc.body));
  // A terms page that mentions the privacy policy is not one too: when the
  // page's title or main heading names a kind, it is that kind only.
  // Known limit: parses the page a second time (htmlToBlocks parsed it); pages are capped at 2 MB.
  const page = new DOMParser().parseFromString(html, "text/html");
  const heading = `${page.title} ${page.querySelector("h1")?.textContent ?? ""}`;
  const named = kinds.filter((k) => DOCUMENT_NAMES[k].test(heading));
  return named.length ? named : kinds;
}

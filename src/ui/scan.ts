// "Scan a link" and "This site" support: reading a pasted
// address or pasted text, and the short list of recently checked sites.
// Everything here runs on the device; nothing is sent anywhere.

import { readableFetched } from "../engine/pdf";
import { CHOSEN_TYPE_NOTICE, KINDS, kindsOfPage, readDocument, type DocumentResult, type Kind } from "../engine/documents";
import type { ScanPlan } from "../scan/jobs";
import { isKnownDocument, knownSite, localHost, siteOrigins, type KnownSite } from "../engine/known-sites";
import type { CompiledRules } from "../engine/rules";
import type { Fetched } from "../auto/background";

export interface ScanResult {
  site: string;
  documents: DocumentResult[];
  /**
   * Pages the background fetched for a scan, not yet read: a Chromium service
   * worker cannot parse HTML, so the popup reads them (readFetched).
   */
  fetched?: { url: string; kind: Kind | "auto"; pages: Record<string, Fetched>; targets?: { url: string; kind: Kind | "auto" }[] };
  /** Explicit link candidates saved by a This site scan, in their original order. */
  groups?: { kind: Kind; urls: string[] }[];
  explicitKind?: boolean;
}

export const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** The address to read, or null when the text is not one, or is a local or private address. */
export function asAddress(input: string): URL | null {
  const t = input.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    const u = new URL(t);
    return (u.protocol === "https:" || u.protocol === "http:") && !localHost(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

/** Pasted terms or privacy text, read here. */
export function scanText(text: string, kind: Kind, rules: CompiledRules, explicitKind = false): ScanResult {
  return { site: "Pasted text", documents: [readDocument(kind, "", text, "text/plain", rules, { explicitKind })] };
}

/** The most text read from a paste or a selection, the same everywhere. */
export const MAX_PASTED = 200_000;

/** Whether a report is of text the person pasted or selected, which has no site to remember or write to. */
export const isOwnText = (site: string) => site.startsWith("Pasted text") || site.startsWith("Selected text");

/**
 * Pasted text, as whichever documents it says it is; neither is reported,
 * never guessed. Only its first 200,000 characters are read, and the report says so.
 */
export function scanPasted(text: string, kind: Kind | "auto", rules: CompiledRules): ScanResult {
  const cut = text.length > MAX_PASTED;
  const site = cut ? "Pasted text (its first 200,000 characters)" : "Pasted text";
  if (cut) text = text.slice(0, MAX_PASTED);
  if (kind !== "auto") return { ...scanText(text, kind, rules, true), site };
  const read = KINDS.map((k) => scanText(text, k, rules).documents[0]!).filter((d) => d.status === "read");
  if (read.length) return { site, documents: read };
  return { site, documents: [{ kind: "terms", status: "could_not_read", reason: (() => { const failed = readDocument("terms", "", text, "text/plain", rules); return failed.status === "could_not_read" ? failed.reason : "Choose the document type to read this text."; })() }] };
}

/**
 * What a scan of `url` reads: on a known site, its listed terms and privacy
 * policy (or the one asked for), unless the address is already one of them;
 * anywhere else, the address itself.
 */
export function scanTargets(url: string, kind: Kind | "auto", sites: KnownSite[]): { url: string; kind: Kind | "auto" }[] {
  const known = knownSite(sites, new URL(url).hostname);
  if (!known || /\.pdf$/i.test(new URL(url).pathname) || isKnownDocument(known, url)) return [{ url, kind }];
  return KINDS.filter((k) => kind === "auto" || k === kind).map((k) => ({ url: known[k], kind: k }));
}

/** The sites a scan needs access to, as permission patterns: on a known site, all of its domains, for the redirects between them. */
export function scanOrigins(url: string, kind: Kind | "auto", sites: KnownSite[]): string[] {
  const known = knownSite(sites, new URL(url).hostname);
  return [...new Set([...scanTargets(url, kind, sites).map((t) => `${new URL(t.url).origin}/*`), ...(known ? siteOrigins(known) : [])])];
}

/**
 * Check again on a saved report: its documents read the way the first scan
 * read them (the name and access-wall checks apply unless the person chose the
 * type), with every domain of a known site for the redirects between them.
 */
export function checkAgainPlan(saved: { site: string; documents: DocumentResult[] }, sites: KnownSite[]): { plan: ScanPlan; origins: string[] } | null {
  const targets = saved.documents.filter((d) => d.url && asAddress(d.url)).map((d) => ({ url: d.url!, kind: d.kind }));
  if (!targets.length) return null;
  const hosts = [saved.site, ...targets.map((t) => new URL(t.url).hostname)];
  const known = [...new Set(hosts.map((h) => knownSite(sites, h)).filter((k): k is KnownSite => !!k))];
  const origins = [...new Set([...targets.map((t) => `${new URL(t.url).origin}/*`), ...known.flatMap(siteOrigins)])];
  const explicitKind = saved.documents.some((d) => d.status === "read" && !!d.notices?.includes(CHOSEN_TYPE_NOTICE));
  return { plan: { site: saved.site, url: targets[0]!.url, kind: "auto", targets, documents: [], sites, explicitKind }, origins };
}

/** A scan result with any pages the background fetched read here, with these rules. */
export async function readFetched(r: ScanResult, rules: CompiledRules, sites: KnownSite[]): Promise<ScanResult> {
  if (!r.fetched) return r;
  const { url, kind, pages, targets } = r.fetched;
  const fetcher = async (u: string): Promise<Fetched> => pages[u] ?? { ok: false, reason: "The page could not be reached." };
  const documents = [...r.documents];
  if (r.groups) {
    for (const group of r.groups) documents.push(await readFirst(group.kind, group.urls, group.urls.length, rules, fetcher));
  } else {
    // New results carry their targets. Older session results use their fetched addresses,
    // never a newer known-site list that may point somewhere else.
    for (const target of targets ?? Object.keys(pages).map((u) => ({ url: u, kind }))) {
      documents.push(...(await scanUrl(target.url, target.kind, rules, fetcher, r.explicitKind ?? false)).documents);
    }
  }
  return { site: r.site, documents };
}

/**
 * Reads one address. "auto" reads it as whichever document the page says it
 * is; a page that is neither is not read, and says so.
 */
export async function scanUrl(url: string, kind: Kind | "auto", rules: CompiledRules, fetchText: (u: string) => Promise<Fetched>, explicitKind = kind !== "auto"): Promise<ScanResult> {
  const site = siteOf(url);
  const got = await readableFetched(await fetchText(url));
  if (!got.ok) return { site, documents: [{ kind: kind === "auto" ? "terms" : kind, status: "could_not_read", url, reason: got.reason }] };
  const type = got.contentType.toLowerCase();
  const html = type.includes("text/html") || type === "";
  // Auto on a web page: what it says it is. On plain text (or anything else,
  // which readDocument refuses with its reason): whichever reads.
  const kinds: Kind[] =
    kind !== "auto"
      ? [kind]
      : html
        ? kindsOfPage(got.text)
        : KINDS.filter((k) => readDocument(k, got.url, got.text, got.contentType, rules).status === "read");
  if (kinds.length === 0) {
    return { site, documents: [{ kind: "terms", status: "could_not_read", url: got.url, reason: (() => { const failed = readDocument("terms", got.url, got.text, got.contentType, rules); return failed.status === "could_not_read" ? failed.reason : "Choose the document type, or read the rendered policy in its tab."; })() }] };
  }
  return { site, documents: kinds.map((k) => readDocument(k, got.url, got.text, got.contentType, rules, { explicitKind })) };
}

/** A site checked on this device, newest first, with what its documents said last time. */
export interface RecentSite {
  site: string;
  at: string;
  /** Documents whose text differed from the check before, noted for 30 days. */
  changed: Kind[];
  changedAt?: string;
  documents?: Record<string, { kind: Kind; hash: string; changedAt?: string }>;
  /** Topics found in what was read last time; absent on entries from before. */
  found?: number;
}

/** How many topics the read documents found, each topic once. */
export function foundCount(documents: DocumentResult[]): number {
  return new Set(documents.flatMap((d) => (d.status === "read" ? d.categories.filter((c) => c.status === "found").map((c) => c.category) : []))).size;
}

export const RECENT_KEY = "recentSites";
export const MAX_RECENT = 10;
const CHANGED_FOR_MS = 30 * 24 * 60 * 60 * 1000;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Expire badges at display time, including legacy history entries. */
export function recentHistory(list: RecentSite[], now = Date.now()): RecentSite[] {
  const fresh = (at?: string) => !!at && Date.parse(at) <= now && now - Date.parse(at) < CHANGED_FOR_MS;
  return list.map((entry) => {
    if (!entry.documents) return fresh(entry.changedAt) ? entry : { ...entry, changed: [], changedAt: undefined };
    const documents = Object.fromEntries(Object.entries(entry.documents).map(([id, d]) => [id, { ...d, changedAt: fresh(d.changedAt) ? d.changedAt : undefined }]));
    const active = Object.values(documents).filter((d) => d.changedAt);
    return { ...entry, documents, changed: [...new Set(active.map((d) => d.kind))], changedAt: active.map((d) => d.changedAt!).sort().at(-1) };
  });
}

/** Fingerprints are scoped to kind and full canonical source URL, including
 * query and fragment. A new source establishes a baseline, never a revision. */
export async function recordRecent(list: RecentSite[], site: string, documents: DocumentResult[], now = new Date()): Promise<RecentSite[]> {
  const cleaned = recentHistory(list, now.getTime());
  const before = cleaned.find((r) => r.site === site);
  const sources = { ...(before?.documents ?? {}) };
  for (const d of documents) {
    if (d.status !== "read" || !d.body || !URL.canParse(d.url)) continue;
    const url = new URL(d.url);
    if (!/^https?:$/.test(url.protocol)) continue;
    const identity = await sha256(JSON.stringify([d.kind, url.href]));
    const hash = await sha256(d.body);
    const previous = sources[identity];
    const changedAt = previous && previous.hash !== hash ? now.toISOString() : previous?.changedAt;
    delete sources[identity];
    sources[identity] = { kind: d.kind, hash, ...(changedAt ? { changedAt } : {}) };
  }
  const kept = Object.fromEntries(Object.entries(sources).slice(-20));
  const entry: RecentSite = { site, at: now.toISOString(), documents: kept, changed: [], found: foundCount(documents) };
  return [recentHistory([entry], now.getTime())[0]!, ...cleaned.filter((r) => r.site !== site)].slice(0, MAX_RECENT);
}

/**
 * The first of `urls` (at most `tries` of them) that reads as a `kind`
 * document, or why the last one tried could not be read.
 */
export async function readFirst(kind: Kind, urls: string[], tries: number, rules: CompiledRules, fetchText: (u: string) => Promise<Fetched>): Promise<DocumentResult> {
  let last: DocumentResult = { kind, status: "could_not_read", reason: "No link to this document was found on the page." };
  for (const url of urls.slice(0, tries)) {
    const got = await readableFetched(await fetchText(url));
    last = got.ok ? readDocument(kind, got.url, got.text, got.contentType, rules) : { kind, status: "could_not_read", url, reason: got.reason };
    if (last.status === "read") break;
  }
  return last;
}

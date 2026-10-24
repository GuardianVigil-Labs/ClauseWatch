// "Scan a link" and "This site" support: reading a pasted
// address or pasted text, and the short list of recently checked sites.
// Everything here runs on the device; nothing is sent anywhere.

import { KINDS, kindsOfPage, readDocument, type DocumentResult, type Kind } from "../engine/documents";
import { isKnownDocument, knownSite, localHost, type KnownSite } from "../engine/known-sites";
import type { CompiledRules } from "../engine/rules";
import type { Fetched } from "../auto/background";

/** A scan waiting for the one-site permission the popup asked for. */
export interface PendingScan {
  url: string;
  kind: Kind | "auto";
  at: number;
  /** The sites asked for, as permission patterns: the scan finishes once all are granted. */
  origins?: string[];
}

export interface ScanResult {
  site: string;
  documents: DocumentResult[];
  /**
   * Pages the background fetched for a scan, not yet read: a Chromium service
   * worker cannot parse HTML, so the popup reads them (readFetched).
   */
  fetched?: { url: string; kind: Kind | "auto"; pages: Record<string, Fetched> };
}

/** storage.session keys: saved before the permission prompt, which closes the popup. */
export const PENDING_KEY = "scanPending";
export const RESULT_KEY = "scanResult";
/** A pending scan older than this is dropped rather than resumed. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

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
export function scanText(text: string, kind: Kind, rules: CompiledRules): ScanResult {
  return { site: "Pasted text", documents: [readDocument(kind, "", text, "text/plain", rules)] };
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
  if (kind !== "auto") return { ...scanText(text, kind, rules), site };
  const read = KINDS.map((k) => scanText(text, k, rules).documents[0]!).filter((d) => d.status === "read");
  if (read.length) return { site, documents: read };
  return { site, documents: [{ kind: "terms", status: "could_not_read", reason: "The text does not say it is a terms of service or privacy policy. Choose which it is." }] };
}

/**
 * What a scan of `url` reads: on a known site, its listed terms and privacy
 * policy (or the one asked for), unless the address is already one of them;
 * anywhere else, the address itself.
 */
export function scanTargets(url: string, kind: Kind | "auto", sites: KnownSite[]): { url: string; kind: Kind | "auto" }[] {
  const known = knownSite(sites, new URL(url).hostname);
  if (!known || isKnownDocument(known, url)) return [{ url, kind }];
  return KINDS.filter((k) => kind === "auto" || k === kind).map((k) => ({ url: known[k], kind: k }));
}

/** The sites a scan needs access to, as permission patterns. */
export const scanOrigins = (url: string, kind: Kind | "auto", sites: KnownSite[]) => [...new Set(scanTargets(url, kind, sites).map((t) => `${new URL(t.url).origin}/*`))];

/** Scans an address, reading a known site's own documents (scanTargets). */
export async function scanAddress(url: string, kind: Kind | "auto", rules: CompiledRules, sites: KnownSite[], fetchText: (u: string) => Promise<Fetched>): Promise<ScanResult> {
  const targets = scanTargets(url, kind, sites);
  const documents: DocumentResult[] = [];
  for (const t of targets) documents.push(...(await scanUrl(t.url, t.kind, rules, fetchText)).documents);
  return { site: siteOf(url), documents };
}

/** Fetches what a scan of `url` reads, for the popup to read later (readFetched). */
export async function fetchTargets(url: string, kind: Kind | "auto", sites: KnownSite[], fetchText: (u: string) => Promise<Fetched>): Promise<ScanResult> {
  const pages: Record<string, Fetched> = {};
  for (const t of scanTargets(url, kind, sites)) pages[t.url] = await fetchText(t.url);
  return { site: siteOf(url), documents: [], fetched: { url, kind, pages } };
}

/** A scan result with any pages the background fetched read here, with these rules. */
export async function readFetched(r: ScanResult, rules: CompiledRules, sites: KnownSite[]): Promise<ScanResult> {
  if (!r.fetched) return r;
  const { url, kind, pages } = r.fetched;
  return scanAddress(url, kind, rules, sites, async (u) => pages[u] ?? { ok: false, reason: "The page could not be reached." });
}

/**
 * Reads one address. "auto" reads it as whichever document the page says it
 * is; a page that is neither is not read, and says so.
 */
export async function scanUrl(url: string, kind: Kind | "auto", rules: CompiledRules, fetchText: (u: string) => Promise<Fetched>): Promise<ScanResult> {
  const site = siteOf(url);
  const got = await fetchText(url);
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
    return { site, documents: [{ kind: "terms", status: "could_not_read", url: got.url, reason: "This address is not a terms of service or privacy policy page. Choose which it is, or paste the text." }] };
  }
  return { site, documents: kinds.map((k) => readDocument(k, got.url, got.text, got.contentType, rules)) };
}

/** A site checked on this device, newest first, with what its documents said last time. */
export interface RecentSite {
  site: string;
  at: string;
  /** SHA-256 of each document's text when last read. */
  hashes: Partial<Record<Kind, string>>;
  /** Documents whose text differed from the check before, noted for 30 days. */
  changed: Kind[];
  changedAt?: string;
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

/**
 * Adds a checked site to the list. A document whose text differs from the
 * previous check is marked changed; nothing is said about one not read now.
 */
export async function recordRecent(list: RecentSite[], site: string, documents: DocumentResult[], now = new Date()): Promise<RecentSite[]> {
  const before = list.find((r) => r.site === site);
  const hashes: Partial<Record<Kind, string>> = { ...(before?.hashes ?? {}) };
  // A change stays noted for 30 days, so checking the same site again soon
  // (or the two steps of one check) does not hide it.
  const recent = before?.changedAt && now.getTime() - Date.parse(before.changedAt) < CHANGED_FOR_MS;
  const changed = new Set<Kind>(recent ? before!.changed : []);
  let changedAt = recent ? before!.changedAt : undefined;
  for (const d of documents) {
    if (d.status !== "read" || !d.body) continue;
    const h = await sha256(d.body);
    if (before?.hashes[d.kind] && before.hashes[d.kind] !== h) {
      changed.add(d.kind);
      changedAt = now.toISOString();
    }
    hashes[d.kind] = h;
  }
  const entry: RecentSite = { site, at: now.toISOString(), hashes, changed: [...changed], ...(changedAt ? { changedAt } : {}), found: foundCount(documents) };
  return [entry, ...list.filter((r) => r.site !== site)].slice(0, MAX_RECENT);
}

/** A saved pending scan, if still fresh and well formed. */
export function freshPending(value: unknown, now = Date.now()): PendingScan | null {
  const p = value as PendingScan | undefined;
  if (!p || typeof p.url !== "string" || !asAddress(p.url) || typeof p.at !== "number") return null;
  if (!["terms", "privacy", "auto"].includes(p.kind)) return null;
  if (p.origins !== undefined && !(Array.isArray(p.origins) && p.origins.every((o) => typeof o === "string" && /^https?:\/\/[^/*]+\/\*$/.test(o)))) return null;
  return now - p.at <= PENDING_TTL_MS ? p : null;
}

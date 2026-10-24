// What the background does for automatic mode: fetch a
// site's own documents for the page's script (the page's CORS rules would
// stop it), and remember documents already read per site.

import { sameSite, type DocumentResult } from "../engine/documents";
import { localHost } from "../engine/known-sites";

export { localHost };
import type { KV } from "../storage";

/** Automatic mode's site access, asked for only when the user turns it on. */
export const AUTO_ORIGINS = ["https://*/*", "http://*/*"];

const MAX_BYTES = 2 * 1024 * 1024;
const DOCS_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Whether the page at `tabUrl` may have `url` fetched for it: only a web
 * address on the same site. Anything else would make the extension a proxy
 * for whatever a page asked.
 */
export function mayFetch(url: string, tabUrl: string | undefined): boolean {
  if (!tabUrl || !URL.canParse(url) || !URL.canParse(tabUrl)) return false;
  const u = new URL(url);
  const t = new URL(tabUrl);
  return /^https?:$/.test(u.protocol) && /^https?:$/.test(t.protocol) && !localHost(u.hostname) && sameSite(u.hostname, t.hostname);
}

export type Fetched = { ok: true; url: string; text: string; contentType: string } | { ok: false; reason: string };

export async function fetchText(url: string, staysOn?: (finalUrl: string) => boolean): Promise<Fetched> {
  let res: Response | null = null;
  try {
    res = await fetch(url, { credentials: "omit", redirect: "follow" });
  } catch (err) {
    console.debug("[ClauseWatch] document unreachable", err instanceof Error ? err.name : "");
  }
  if (!res) return { ok: false, reason: "The page could not be reached." };
  if (!res.ok) return { ok: false, reason: `The page answered ${res.status}.` };
  // Redirects are followed, but a read that ended somewhere else is not used.
  if (staysOn && res.url && !staysOn(res.url)) return { ok: false, reason: "The link led to another site." };
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, reason: "The page is too large to read." };
  const text = await res.text();
  if (text.length > MAX_BYTES) return { ok: false, reason: "The page is too large to read." };
  return { ok: true, url: res.url || url, text, contentType: res.headers.get("content-type") ?? "" };
}

export const LOCAL_REASON = "ClauseWatch does not read local or private network addresses.";

/**
 * Fetches an address the person chose (Scan a link, the link menu, a known
 * site's documents): never a local or private address, and a redirect that
 * ends on another site is not used.
 */
export function fetchChosen(url: string): Promise<Fetched> {
  if (!mayFetch(url, url)) return Promise.resolve({ ok: false, reason: LOCAL_REASON });
  return fetchText(url, (end) => mayFetch(end, url));
}

/** What the remembered documents were read with: the extension version, the person's rules and the signed rules release. */
export async function readKey(kv: KV, version = ""): Promise<string> {
  const [disabled, own, update] = await Promise.all(["disabledRuleIds", "ownRules", "rules:update"].map((k) => kv.get(k).catch(() => undefined)));
  return JSON.stringify([version, disabled ?? [], own ?? [], (update as { signature?: unknown } | undefined)?.signature ?? ""]);
}

/**
 * Documents remembered for a site, without their full text, for a week, and
 * only while they were read with the same rules (`key`, readKey).
 */
export async function cachedDocs(kv: KV, site: string, now = Date.now(), key = ""): Promise<DocumentResult[] | null> {
  const entry = (await kv.get(`docs:${site}`)) as { at: number; key?: string; documents: DocumentResult[] } | undefined;
  return entry && now - entry.at < DOCS_TTL_MS && (entry.key ?? "") === key ? entry.documents : null;
}

export async function rememberDocs(kv: KV, site: string, documents: DocumentResult[], now = Date.now(), key = ""): Promise<void> {
  // Only what the card shows: the quotes and where they came from, never the whole text.
  const slim = documents.map((d) => (d.status === "read" ? { ...d, body: "" } : d));
  await kv.set(`docs:${site}`, { at: now, key, documents: slim });
}

/** Whether a storage change makes the remembered documents stale: the person's rules or a new signed rules release. */
export function docsStale(changes: Record<string, unknown>): boolean {
  return "ownRules" in changes || "disabledRuleIds" in changes || "rules:update" in changes;
}

/**
 * Keeps documents read under `asked` only if that is still `current`: rules
 * that changed while the page was reading make the read stale.
 */
export async function rememberIfCurrent(kv: KV, site: string, documents: DocumentResult[], asked: string, current: string, now = Date.now()): Promise<boolean> {
  if (asked !== current) return false;
  await rememberDocs(kv, site, documents, now, current);
  return true;
}

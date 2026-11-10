// What the background does for automatic mode: fetch a
// site's own documents for the page's script (the page's CORS rules would
// stop it), and remember documents already read per site.

import { KINDS, sameSite, type DocumentResult } from "../engine/documents";
import { isKnownDocument, knownSite, localHost, onSiteDomains, type KnownSite } from "../engine/known-sites";

export { localHost };
import type { KV } from "../storage";

/** Automatic mode's site access, asked for only when the user turns it on. */
export const AUTO_ORIGINS = ["https://*/*", "http://*/*"];

export const MAX_BYTES = 2 * 1024 * 1024;
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

/**
 * Whether a redirect from `start` to `end` stays within one known site: both
 * on that site's own domains or legal domains, and `end` a public web address.
 */
export function withinKnownSite(end: string, start: string, sites: KnownSite[]): boolean {
  if (!mayFetch(end, end) || !URL.canParse(start)) return false;
  const from = new URL(start).hostname;
  const to = new URL(end).hostname;
  return sites.some((s) => onSiteDomains(s, from) && onSiteDomains(s, to));
}

export type Fetched = { ok: true; url: string; text: string; contentType: string; pdf?: string } | { ok: false; reason: string };

export const FETCH_TIMEOUT_MS = 20_000;
export const OFF_SITE_REASON = "The page redirected to another site, which ClauseWatch does not read for it.";
export const TIMEOUT_REASON = "The page took too long to respond. Try again.";
export const CANCELLED_REASON = "The scan was cancelled.";
const TOO_LARGE_REASON = "The page is too large to read.";
/**
 * A PDF is kept as base64 (4/3 of its size) in a scan job, whose session
 * storage holds at most 2 MiB of text (MAX_SESSION_CHARS in src/scan/jobs.ts).
 * No PDF is larger than this; each download is also held to the room its scan
 * job has left (`room`), so a document that downloads can always be kept.
 */
export const MAX_PDF_BYTES = 1152 * 1024;
export const PDF_TOO_LARGE_REASON = "The PDF is too large to read here (over 1.1 MB). Open it and paste the policy text.";
export const NO_ROOM_REASON = "This scan has no room left for this document. Scan its address on its own.";

/**
 * A deadline covers headers and the streamed body, including a stalled stream.
 * `room`: how many characters the result may take where it is kept; a larger
 * download is refused as soon as its size is known.
 */
export async function fetchText(url: string, staysOn?: (nextUrl: string) => boolean, signal?: AbortSignal, room = Infinity): Promise<Fetched> {
  // A web page decodes to at most one character per byte; a PDF is kept as base64.
  const pageBytes = Math.min(MAX_BYTES, room);
  const pdfBytes = Math.min(MAX_PDF_BYTES, Math.floor(room / 4) * 3);
  const tooLarge = (pdf: boolean, size: number): Fetched => ({ ok: false, reason: size <= (pdf ? MAX_PDF_BYTES : MAX_BYTES) ? NO_ROOM_REASON : pdf ? PDF_TOO_LARGE_REASON : TOO_LARGE_REASON });
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, FETCH_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(new DOMException("Aborted", "AbortError"));
    if (controller.signal.aborted) fail();
    else controller.signal.addEventListener("abort", fail, { once: true });
  });
  // Attach immediately: cancellation can happen before the first network operation.
  void aborted.catch(() => undefined);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  try {
    if (controller.signal.aborted) await aborted;
    // Browsers hide a manual redirect's destination (an opaque redirect), so
    // the browser follows redirects without cookies and the address the
    // answer finally came from is checked before anything is read from it.
    response = await Promise.race([fetch(url, { credentials: "omit", redirect: "follow", signal: controller.signal }), aborted]);
    const end = response.url || url;
    if (response.redirected && !response.url) return { ok: false, reason: OFF_SITE_REASON };
    if (response.url && (!mayFetch(end, end) || !(staysOn ? staysOn(end) : mayFetch(end, url)))) return { ok: false, reason: OFF_SITE_REASON };
    if (!response.ok) return { ok: false, reason: `The page answered ${response.status}.` };
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, reason: TOO_LARGE_REASON };
    const pdfChunks: Uint8Array[] = [];
    let isPdf = response.headers.get("content-type")?.toLowerCase().includes("application/pdf") ?? false;
    if (Number.isFinite(declared) && declared > (isPdf ? pdfBytes : pageBytes)) return tooLarge(isPdf, declared);
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) return { ok: false, reason: TOO_LARGE_REASON };
        if (bytes === part.value.byteLength && new TextDecoder().decode(part.value.subarray(0, 5)) === "%PDF-") isPdf = true;
        if (bytes > (isPdf ? pdfBytes : pageBytes)) return tooLarge(isPdf, bytes);
        pdfChunks.push(part.value);
        if (!isPdf) chunks.push(decoder.decode(part.value, { stream: true }));
      }
    }
    if (!isPdf) {
      let signature = "";
      for (const chunk of pdfChunks) { signature += String.fromCharCode(...chunk.subarray(0, 5 - signature.length)); if (signature.length === 5) break; }
      isPdf = signature === "%PDF-";
      if (bytes > (isPdf ? pdfBytes : pageBytes)) return tooLarge(isPdf, bytes);
    }
    if (isPdf) {
      const binary: string[] = [];
      for (const chunk of pdfChunks) for (let offset = 0; offset < chunk.length; offset += 8192) binary.push(String.fromCharCode(...chunk.subarray(offset, offset + 8192)));
      return { ok: true, url: end, text: "", contentType: "application/pdf", pdf: btoa(binary.join("")) };
    }
    chunks.push(decoder.decode());
    return { ok: true, url: end, text: chunks.join(""), contentType: response.headers.get("content-type") ?? "" };
  } catch {
    return { ok: false, reason: signal?.aborted ? CANCELLED_REASON : timedOut ? TIMEOUT_REASON : "The page could not be reached." };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    // Do not let a broken stream's cancellation prevent a result from being returned.
    if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    else if (response?.body) void response.body.cancel().catch(() => undefined);
    controller.abort();
  }
}

export const LOCAL_REASON = "ClauseWatch does not read local or private network addresses.";

/**
 * Fetches an address the person chose (Scan a link, the link menu, a known
 * site's documents): never a local or private address, and a redirect that
 * ends on another site is not used. Redirects between a known site's own
 * domains and legal domains are followed.
 */
export function fetchChosen(url: string, sites: KnownSite[] = [], signal?: AbortSignal, room?: number): Promise<Fetched> {
  if (!mayFetch(url, url)) return Promise.resolve({ ok: false, reason: LOCAL_REASON });
  return fetchText(url, (end) => mayFetch(end, url) || withinKnownSite(end, url, sites), signal, room);
}

/**
 * A fetch automatic mode's script asks for, from the page at `tabUrl`: only a
 * document on the page's own site, or its known site's listed documents, and
 * redirects on their site or between that known site's domains. Never
 * wherever a page asks.
 */
export function pageFetch(url: string, tabUrl: string | undefined, sites: KnownSite[], signal?: AbortSignal): Promise<Fetched> {
  const known = tabUrl && URL.canParse(tabUrl) ? knownSite(sites, new URL(tabUrl).hostname) : null;
  const listed = isKnownDocument(known, url);
  // A listed document passes the same refusals as any other: http(s) and no local address.
  if (!(listed ? mayFetch(url, url) : mayFetch(url, tabUrl))) return Promise.resolve({ ok: false, reason: "Not on this site." });
  return fetchText(url, (end) => mayFetch(end, tabUrl) || (listed && mayFetch(end, url)) || (!!known && withinKnownSite(end, url, [known])), signal);
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
  if (!entry) return null;
  if (!freshEntry(entry, now) || (entry.key ?? "") !== key) {
    await kv.remove(`docs:${site}`);
    return null;
  }
  return entry.documents;
}

function freshEntry(value: unknown, now: number): value is { at: number; key?: string; documents: DocumentResult[] } {
  const e = value as { at?: unknown; documents?: unknown } | null;
  return !!e && typeof e.at === "number" && Number.isFinite(e.at) && e.at <= now && now - e.at < DOCS_TTL_MS && Array.isArray(e.documents);
}

/** Only a complete read quiets a site; failures are always eligible for retry. */
export function completeDocs(documents: DocumentResult[] | null | undefined): boolean {
  return !!documents && KINDS.every((kind) => documents.some((d) => d.kind === kind && d.status === "read"));
}

/** Sweep even sites that are never revisited. Called on worker start and each tick. */
export async function pruneDocs(kv: KV, entries: Record<string, unknown>, now = Date.now()): Promise<void> {
  for (const key of Object.keys(entries).filter((k) => k.startsWith("docs:"))) {
    // Re-read rather than deleting a fresh write made after enumeration.
    if (!freshEntry(await kv.get(key), now)) await kv.remove(key);
  }
}

export async function rememberDocs(kv: KV, site: string, documents: DocumentResult[], now = Date.now(), key = ""): Promise<void> {
  // Only the report: quotes, bounded nearby context and sources, without a separate document body.
  const slim = documents.map((d) => (d.status === "read" ? { ...d, body: "" } : d));
  const old = await kv.get(`docs:${site}`);
  // Reusing a successful document must not extend its retention with every failed retry.
  const at = freshEntry(old, now) && old.key === key ? old.at : now;
  await kv.set(`docs:${site}`, { at, key, documents: slim });
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

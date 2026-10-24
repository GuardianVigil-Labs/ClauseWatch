// Known sites (rules/sites.json): popular services mapped to the exact
// addresses of their terms and privacy policy, and optionally their sign-up
// pages. Signed with the rules, so an update carries both. On a known site
// ClauseWatch reads these addresses directly instead of looking for links.
//
// No imports from the browser: scripts/check-sites.mjs runs this file in Node.

export interface KnownSite {
  id: string;
  name: string;
  /** Registrable domains where people use and sign up for the service, without "www.". */
  domains: string[];
  /** Other domains its documents live on (a parent company's legal site), never used to recognise the service. */
  legalDomains?: string[];
  terms: string;
  privacy: string;
  /** Address prefixes of its sign-up pages, on one of its domains. */
  signup?: string[];
}

export const MAX_SITES = 1000;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * An address the extension never fetches for a page: an IP literal (whose
 * "site" would be its last two numbers, so a public address ending in the
 * same two numbers could name a private one), a name with no dot, or a local
 * or internal name. Terms and privacy pages live on public names.
 * Known limit: a public name that resolves to a private address still passes; the
 * browser's own Private Network Access checks are the backstop.
 */
export function localHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return (
    h.startsWith("[") || // IPv6 literal
    /^\d+(\.\d+){3}$/.test(h) || // IPv4 literal
    !h.includes(".") ||
    /\.(local|localhost|internal|lan|home|corp|intranet|home\.arpa)$/.test(h)
  );
}

/**
 * Public suffixes and hosting domains shared by many unrelated sites: never a
 * known site's domain, which would make all of them one site.
 * Known limit: a short list, not the full public suffix list.
 */
export const SHARED_DOMAINS = new Set([
  "co.uk", "org.uk", "com.au", "net.au", "co.jp", "co.nz", "co.in", "com.br", "com.cn", "co.za",
  "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app", "netlify.app", "notion.site", "herokuapp.com",
  "blogspot.com", "appspot.com", "web.app", "firebaseapp.com", "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com",
]);

/** A lower-case public domain without "www.", not one shared by unrelated sites: what "domains" and "legalDomains" list. */
const isDomain = (d: unknown): d is string =>
  typeof d === "string" && d.length <= 253 && DOMAIN.test(d) && !d.startsWith("www.") && !localHost(d) && !/\.\d+$/.test(d) && !SHARED_DOMAINS.has(d);

/** An https address with no credentials, port or fragment, or null. */
function httpsUrl(v: unknown): URL | null {
  if (typeof v !== "string" || v.length > 500 || !URL.canParse(v)) return null;
  const u = new URL(v);
  return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash && u.href === v ? u : null;
}

/** What is wrong with a sites list, or null when every entry is well formed. */
export function sitesProblem(list: unknown): string | null {
  if (!Array.isArray(list)) return '"sites" must be a list.';
  if (list.length > MAX_SITES) return `At most ${MAX_SITES} sites.`;
  const ids = new Set<string>();
  const domains = new Set<string>();
  for (const [i, raw] of list.entries()) {
    const s = raw as Partial<KnownSite> | null;
    const at = `Site ${i + 1}${s && typeof s.id === "string" ? ` ("${s.id}")` : ""}`;
    if (!s || typeof s !== "object") return `${at} is not an object.`;
    const extra = Object.keys(s).filter((k) => !["id", "name", "domains", "legalDomains", "terms", "privacy", "signup"].includes(k));
    if (extra.length) return `${at}: unknown field "${extra[0]}".`;
    if (typeof s.id !== "string" || !ID.test(s.id) || s.id.length > 40) return `${at}: "id" must be lower-case letters, digits and dashes.`;
    if (ids.has(s.id)) return `${at}: the id is used twice.`;
    ids.add(s.id);
    if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 80) return `${at}: "name" must be 1 to 80 characters.`;
    if (!Array.isArray(s.domains) || s.domains.length < 1 || s.domains.length > 10) return `${at}: "domains" must list 1 to 10 domains.`;
    for (const d of s.domains) {
      if (!isDomain(d)) return `${at}: "${String(d)}" is not a lower-case public domain without "www.".`;
      if (domains.has(d)) return `${at}: the domain ${d} is listed twice.`;
      domains.add(d);
    }
    if (s.legalDomains !== undefined) {
      if (!Array.isArray(s.legalDomains) || s.legalDomains.length > 10) return `${at}: "legalDomains" must be a list of at most 10 domains.`;
      for (const d of s.legalDomains) if (!isDomain(d)) return `${at}: "${String(d)}" is not a lower-case public domain without "www.".`;
    }
    const allowed = [...s.domains, ...(s.legalDomains ?? [])];
    for (const k of ["terms", "privacy"] as const) {
      const u = httpsUrl(s[k]);
      if (!u) return `${at}: "${k}" must be a full https address, as the browser writes it, with no fragment.`;
      if (!allowed.some((d) => onDomain(u.hostname, d))) return `${at}: "${k}" is not on one of its domains or legalDomains.`;
    }
    if (s.terms === s.privacy) return `${at}: "terms" and "privacy" are the same address.`;
    if (s.signup !== undefined) {
      if (!Array.isArray(s.signup) || s.signup.length > 10) return `${at}: "signup" must be a list of at most 10 addresses.`;
      for (const p of s.signup) {
        const u = httpsUrl(p);
        if (!u || u.search) return `${at}: the sign-up address "${String(p)}" must be a full https address with no query or fragment.`;
        if (!s.domains.some((d) => onDomain(u.hostname, d))) return `${at}: the sign-up address ${p} is not on one of its domains.`;
      }
    }
  }
  return null;
}

/** The known site a host belongs to, the most specific domain first, or null. */
export function knownSite(sites: KnownSite[], hostname: string): KnownSite | null {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  let best: { site: KnownSite; length: number } | null = null;
  for (const site of sites) {
    for (const d of site.domains) if (onDomain(host, d) && d.length > (best?.length ?? 0)) best = { site, length: d.length };
  }
  return best?.site ?? null;
}

/** Whether an address is one of a known site's sign-up pages. */
export function isSignupPage(site: KnownSite, url: string): boolean {
  if (!URL.canParse(url)) return false;
  // "www." is ignored on both sides; the path keeps its case.
  const bare = (u: URL) => `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname}`;
  const here = bare(new URL(url));
  return (site.signup ?? []).some((raw) => {
    if (!URL.canParse(raw)) return false;
    const p = bare(new URL(raw));
    return here === p || here.startsWith(p.endsWith("/") ? p : `${p}/`);
  });
}

/** The same document address, ignoring the query, the fragment, a trailing slash and "www.". */
export function sameDocument(a: string, b: string): boolean {
  if (!URL.canParse(a) || !URL.canParse(b)) return false;
  const bare = (u: URL) => `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  return bare(new URL(a)) === bare(new URL(b));
}

/** Whether `url` is one of a known site's own document addresses. */
export const isKnownDocument = (site: KnownSite | null, url: string) => !!site && (sameDocument(site.terms, url) || sameDocument(site.privacy, url));

/**
 * The kinds a page at `url` is read as in place. On a known site, a kind
 * only when the page is its listed document; otherwise the listed address is
 * read instead, however much the page mentions it.
 */
export function inPlaceKinds<K extends "terms" | "privacy">(kinds: K[], site: KnownSite | null, url: string): K[] {
  return site ? kinds.filter((k) => sameDocument(site[k], url)) : kinds;
}

/** Every domain a known site uses: its own and its documents'. */
const allDomains = (site: KnownSite) => [...site.domains, ...(site.legalDomains ?? [])];

/** Permission patterns for all of a known site's domains, each with its subdomains: redirects between them are common. */
export const siteOrigins = (site: KnownSite) => allDomains(site).flatMap((d) => [`https://${d}/*`, `https://*.${d}/*`]);

/** Whether a host is on one of a known site's domains or legal domains. */
export const onSiteDomains = (site: KnownSite, hostname: string) => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allDomains(site).some((d) => onDomain(host, d));
};

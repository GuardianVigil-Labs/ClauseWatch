// Sharing: a plain link to the ClauseWatch page, and a
// finding's quote with its source. No tracking code, no referral bonus, and
// nothing about the person: only the link, the site and the quoted words.

export const SHARE_URL = "https://guardianvigil.io/clausewatch";
/** The open-source repository: code, rules and known sites. */
export const REPOSITORY_URL = "https://github.com/GuardianVigil-Labs/ClauseWatch";

const SHARE_TEXT = "ClauseWatch quotes what a service's terms and privacy policy say, before you sign up.";

export interface ShareTarget {
  name: string;
  url: string;
}

/** Where a link can be shared, each a plain web address built with URLSearchParams. */
export function shareTargets(text = SHARE_TEXT, url = SHARE_URL): ShareTarget[] {
  const q = (base: string, params: Record<string, string>) => `${base}?${new URLSearchParams(params).toString()}`;
  return [
    { name: "Email", url: `mailto:?${new URLSearchParams({ subject: "ClauseWatch", body: `${text}\n\n${url}` }).toString().replace(/\+/g, "%20")}` },
    { name: "Reddit", url: q("https://www.reddit.com/submit", { url, title: text }) },
    { name: "X", url: q("https://x.com/intent/post", { text, url }) },
    { name: "LinkedIn", url: q("https://www.linkedin.com/sharing/share-offsite/", { url }) },
    { name: "WhatsApp", url: q("https://wa.me/", { text: `${text} ${url}` }) },
  ];
}

/** A finding, as shared: the site, the exact words, and where it came from. */
export function quoteText(site: string, kind: "terms" | "privacy", quote: string, url = SHARE_URL): string {
  const doc = kind === "terms" ? "terms" : "privacy policy";
  // Page text: no control or invisible (bidi, zero-width) characters, and a bounded length.
  quote = quote.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  if (quote.length > 500) quote = `${quote.slice(0, 500)}…`;
  return `Quoted from ${site}'s ${doc}: “${quote}”, found by ClauseWatch. ${url}`;
}

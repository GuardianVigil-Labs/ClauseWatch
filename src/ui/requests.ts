// Data requests: ask a service to delete, return or close
// your own data. The letter is drafted here, on the device, and the person
// sends it from their own email. ClauseWatch never writes to the service.

export type RequestKind = "erasure" | "access" | "offboarding";
export type Law = "gdpr" | "ccpa";

/** The legal deadline: GDPR one month (Art. 12(3)), CCPA 45 days. */
export const RESPONSE_DEADLINE: Record<Law, string> = {
  gdpr: "Please respond without undue delay and in any event within one calendar month of receiving this request, under Article 12(3) of the GDPR. If a permitted extension is necessary because of the complexity or number of requests, please notify me within that first month and explain the reasons; the response period may be extended by up to two further months.",
  ccpa: "Please respond within 45 days of receiving this request, subject to any extension permitted by the CCPA/CPRA. If you need an extension, please notify me within the initial response period and explain the reasons.",
};

const ARTICLE: Record<Law, Record<RequestKind, string>> = {
  gdpr: { erasure: "Article 17 of the GDPR (right to erasure)", access: "Article 15 of the GDPR (right of access)", offboarding: "Articles 17 and 20 of the GDPR" },
  ccpa: {
    erasure: "the CCPA/CPRA right to delete (Cal. Civ. Code § 1798.105)",
    access: "the CCPA/CPRA right to know (Cal. Civ. Code § 1798.110)",
    offboarding: "the CCPA/CPRA right to delete (Cal. Civ. Code § 1798.105)",
  },
};

const ASK: Record<RequestKind, string> = {
  erasure: "erase all personal data you hold about me and the account below, and confirm in writing when this is done",
  access: "provide a copy of all personal data you hold about me and the account below, with the purposes, recipients and retention period",
  offboarding: "close the account below, erase all personal data you hold about me, return my data in a portable format, and confirm in writing when this is done",
};

const SUBJECT: Record<RequestKind, string> = {
  erasure: "Data erasure request",
  access: "Data access request",
  offboarding: "Account closure and data erasure request",
};

/** The letter, drafted on the device. */
export function draftLetter(kind: RequestKind, law: Law, domain: string, account: string): { subject: string; body: string } {
  return {
    subject: `${SUBJECT[kind]} under ${law.toUpperCase()}`,
    body: `To the privacy team at ${domain},

Under ${ARTICLE[law][kind]}, I ask you to ${ASK[kind]}.

Account: ${account}

${RESPONSE_DEADLINE[law]}

Thank you.`,
  };
}

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g;
const PRIVACY_WORDS = /privacy|dpo|gdpr|data|legal|dsar|rights/i;

/**
 * Addresses a privacy policy names, the likeliest privacy contact first:
 * one at the service's own domain whose name says privacy, then any at its
 * domain, then the rest. A suggestion the person can change, never a guess
 * sent anywhere.
 */
export function privacyAddresses(text: string, site: string): string[] {
  const found = [...new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/[.]+$/, "")))];
  const own = (e: string) => isOwnAddress(e, site);
  const score = (e: string) => (own(e) ? 2 : 0) + (PRIVACY_WORDS.test(e.split("@")[0]!) ? 1 : 0);
  return found.sort((a, b) => score(b) - score(a)).slice(0, 5);
}

/** An address at the service's own domain or one of its subdomains. */
export function isOwnAddress(email: string, site: string): boolean {
  const host = email.split("@")[1] ?? "";
  return host === site || host.endsWith(`.${site}`);
}

/** A mailto: link for the draft. The person's own mail program sends it. */
export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

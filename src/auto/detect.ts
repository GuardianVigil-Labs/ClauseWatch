// Recognising a sign-up or consent form from its structure
// alone: a password field with an email field, or an "I agree" checkbox.
// Nothing here reads what the user typed.

export interface SignupForm {
  /** The form, or the nearest container holding its fields when the page uses no <form>. */
  root: HTMLElement;
  /** The email field: with it, a password field makes a sign-up form. Its value is never read. */
  email: HTMLInputElement | null;
}

const EMAIL_HINT = /e-?mail/i;
const CONSENT_WORDS = /\b(agree|accept|consent)\b|terms|privacy/i;

export function isEmailField(i: HTMLInputElement): boolean {
  if (i.type === "email") return true;
  if (i.type !== "text" && i.type !== "") return false;
  return [i.name, i.id, i.autocomplete, i.placeholder, i.getAttribute("aria-label") ?? ""].some((v) => EMAIL_HINT.test(v ?? ""));
}

function labelText(i: HTMLInputElement): string {
  const own = i.labels ? [...i.labels].map((l) => l.textContent ?? "").join(" ") : "";
  return `${own} ${i.getAttribute("aria-label") ?? ""} ${i.closest("label")?.textContent ?? ""}`;
}

const visible = (el: HTMLElement) => !el.hidden && el.getAttribute("aria-hidden") !== "true" && el.closest("[hidden]") === null;

/** The smallest ancestor holding both elements. */
function commonRoot(a: HTMLElement, b: HTMLElement): HTMLElement {
  let n: HTMLElement | null = a;
  while (n && !n.contains(b)) n = n.parentElement;
  return n ?? a.ownerDocument.body;
}

/**
 * The sign-up or consent forms on a page. A login form (one password, no
 * consent checkbox, no "new-password" hint) is not one: signing in is not
 * agreeing to anything new.
 */
export function findSignupForms(doc: Document): SignupForm[] {
  const out: SignupForm[] = [];
  const seen = new Set<HTMLElement>();
  const inputs = [...doc.querySelectorAll<HTMLInputElement>("input")].filter(visible);
  const passwords = inputs.filter((i) => i.type === "password");
  const consents = inputs.filter((i) => i.type === "checkbox" && CONSENT_WORDS.test(labelText(i)));

  for (const pw of passwords) {
    const root = (pw.form as HTMLElement | null) ?? pw.parentElement?.closest<HTMLElement>("section, div, main, body") ?? doc.body;
    const fields = inputs.filter((i) => root.contains(i));
    const email = fields.find(isEmailField) ?? null;
    const newPassword = fields.some((i) => i.autocomplete === "new-password") || fields.filter((i) => i.type === "password").length > 1;
    const consent = consents.some((c) => root.contains(c));
    if (!email || !(newPassword || consent)) continue;
    if (!seen.has(root)) {
      seen.add(root);
      out.push({ root, email });
    }
  }
  for (const c of consents) {
    if (out.some((f) => f.root.contains(c))) continue;
    const root = (c.form as HTMLElement | null) ?? commonRoot(c, c.closest("section, div, main") ?? c);
    if (seen.has(root)) continue;
    seen.add(root);
    out.push({ root, email: inputs.filter((i) => root.contains(i)).find(isEmailField) ?? null });
  }
  return out;
}

/** The site a page belongs to: its host without "www.". */
export function siteOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

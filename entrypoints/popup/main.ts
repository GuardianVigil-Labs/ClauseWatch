// Click-to-check. Nothing runs until the user clicks the
// toolbar button, and the extension holds no host access by default:
//   1. read the current page (activeTab, granted by the click);
//   2. if it is itself a terms or privacy document, read it in place;
//   3. otherwise find its links to them, and on the user's say-so ask for
//      that one site, fetch them, analyse them here, and give the access back.
// Everything happens on the device. Nothing is sent anywhere.

import { BUNDLED } from "../../src/engine/bundled";
import { compileRules } from "../../src/engine/rules";
import { loadRules } from "../../src/engine/rule-set";
import { currentRulesFile } from "../../src/engine/rules-update";
import { discoverLinks, kindsOfPage, KINDS, readDocument, type DocumentResult, type Kind } from "../../src/engine/documents";
import { ReportElement } from "../../src/ui/report";

if (!customElements.get("cw-report")) customElements.define("cw-report", ReportElement);
import { kv } from "../../src/storage";
import { AUTO_ORIGINS, fetchChosen } from "../../src/auto/background";
import { knownSite } from "../../src/engine/known-sites";
import {
  asAddress, isOwnText, MAX_PASTED, readFetched, recordRecent, scanAddress as readAddress, scanOrigins, scanPasted, siteOf,
  PENDING_KEY, PENDING_TTL_MS, RECENT_KEY, RESULT_KEY, type RecentSite, type ScanResult,
} from "../../src/ui/scan";
import { aiFindings, aiSummary, type AiSettings } from "../../src/ai/assist";
import { quoteText, SHARE_URL, shareTargets } from "../../src/ui/share";
import { mutedSites } from "../../src/ui/sites";
import { draftLetter, isOwnAddress, mailtoLink, privacyAddresses, type Law, type RequestKind } from "../../src/ui/requests";

// A newer signed update when one is stored and still verifies, with its
// known sites, plus the person's rule choices and own rules.
const file = await currentRulesFile(kv, BUNDLED);
const sites = file.sites ?? [];
const rules = await loadRules(kv, compileRules(file));
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TRIES_PER_KIND = 4;
// Each tab has its own panel, so neither can write over the other.
const main = document.getElementById("main")!;
const scanPanel = document.getElementById("scan")!;
const scanOut = document.createElement("div");

function say(text: string, note = false, panel: HTMLElement = main) {
  const p = document.createElement("p");
  p.textContent = text;
  if (note) p.className = "note";
  panel.replaceChildren(p);
}

const CATEGORY_NAMES: Record<string, string> = {
  ai_training: "AI training on your content",
  arbitration: "arbitration",
  ip_assignment: "rights over your content",
  data_sale: "sale of personal data",
  unilateral_change: "changes without notice",
  data_retention: "data kept after you leave",
  ad_sharing: "data shared for advertising",
  auto_renewal: "automatic renewal",
  liability_limit: "limits on liability",
  governing_law: "governing law and courts",
  children_data: "children's data",
  location_biometric: "location and biometric data",
  termination: "account closed at the company's discretion",
};

document.getElementById("settings-button")!.addEventListener("click", () => void browser.runtime.openOptionsPage());

/** Optional AI help: only when the user turned it on, and only when asked. */
async function aiOffer(documents: DocumentResult[], panel: HTMLElement) {
  const settings = ((await kv.get("ai").catch(() => undefined)) as AiSettings | undefined) ?? { mode: "off" };
  if (settings.mode === "off") return;
  // Verified quotes only: the rules' findings, and AI findings once they pass the quote check.
  const quotes = documents.flatMap((d) => (d.status === "read" ? d.categories.flatMap((c) => c.findings.map((f) => f.quote)) : []));
  summaryOffer(settings, quotes, panel);
  // Only documents whose text was read here; a remembered report carries quotes, not the text.
  const read = documents.filter((d): d is DocumentResult & { status: "read" } => d.status === "read" && d.body.length > 0);
  if (read.length === 0) return;
  const box = document.createElement("div");
  const button = document.createElement("button");
  button.textContent = "Look for clauses the rules missed (AI)";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Asking…";
    const list = document.createElement("div");
    for (const doc of read) {
      try {
        const found = await aiFindings(settings, doc, rules.categories, rules.minQuoteWords);
        for (const f of found) {
          quotes.push(f.quote);
          const item = document.createElement("section");
          item.className = "ai";
          const head = document.createElement("p");
          head.className = "ai-label";
          head.textContent = `Found by AI (quoted) · ${CATEGORY_NAMES[f.category] ?? f.category}`;
          const quote = document.createElement("blockquote");
          quote.textContent = `“${f.quote}”`;
          const why = document.createElement("p");
          why.className = "note";
          why.textContent = f.explanation;
          item.append(head, quote, why);
          list.append(item);
        }
      } catch (err) {
        const p = document.createElement("p");
        p.className = "note";
        p.textContent = err instanceof Error ? err.message : "AI help could not answer.";
        list.append(p);
      }
    }
    if (!list.childElementCount) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = "AI found nothing more that it could quote exactly.";
      list.append(p);
    }
    box.replaceChildren(list);
  });
  box.append(button);
  panel.append(box);
}

/**
 * "Summarise the quotes (AI)": three or four sentences above the
 * report, labelled, each citing the quotes it rests on, never in their place.
 */
function summaryOffer(settings: AiSettings, quotes: string[], panel: HTMLElement) {
  const box = document.createElement("section");
  box.className = "ai";
  const button = document.createElement("button");
  button.textContent = "Summarise the quotes (AI)";
  button.addEventListener("click", async () => {
    if (quotes.length === 0) {
      box.replaceChildren(Object.assign(document.createElement("p"), { className: "note", textContent: "There are no quotes to summarise." }));
      return;
    }
    button.disabled = true;
    button.textContent = "Asking…";
    const used = [...quotes];
    try {
      const sentences = await aiSummary(settings, used);
      const head = Object.assign(document.createElement("p"), { className: "ai-label", textContent: "AI summary of the quotes below. Each sentence names its quotes, but AI can be wrong, or misled by the page: read the quotes, they are what the documents say." });
      if (sentences.length === 0) {
        box.replaceChildren(head, Object.assign(document.createElement("p"), { className: "note", textContent: "AI gave no summary that rests on the quotes." }));
        return;
      }
      const list = document.createElement("ul");
      for (const s of sentences) {
        const li = document.createElement("li");
        li.textContent = `${s.text} `;
        const cite = document.createElement("span");
        cite.className = "note";
        cite.textContent = `(${s.quotes.map((n) => `“${used[n - 1]!.slice(0, 60)}${used[n - 1]!.length > 60 ? "…" : ""}”`).join("; ")})`;
        li.append(cite);
        list.append(li);
      }
      if (box.isConnected) box.replaceChildren(head, list);
    } catch (err) {
      box.replaceChildren(Object.assign(document.createElement("p"), { className: "note", textContent: err instanceof Error ? err.message : "AI help could not answer." }));
    }
  });
  box.append(button);
  // A later render may have replaced the panel while the lock was read.
  if (panel.isConnected) panel.prepend(box);
}

async function remember(site: string, documents: DocumentResult[]) {
  const list = ((await kv.get(RECENT_KEY).catch(() => undefined)) as RecentSite[] | undefined) ?? [];
  await kv.set(RECENT_KEY, await recordRecent(list, site, documents)).catch(() => undefined);
}

/** A report into a panel. `final: false` is a first step whose reading continues, not yet remembered. */
function show(site: string, documents: DocumentResult[], extra?: HTMLElement, { panel = main, final = true }: { panel?: HTMLElement; final?: boolean } = {}) {
  const report = document.createElement("cw-report") as ReportElement;
  // Pasted or selected text: no site to remember, quote back or write to.
  const pasted = isOwnText(site);
  report.report = {
    site,
    documents,
    // Copy quote & share: the site, the exact words and the page link.
    onQuote: pasted
      ? undefined
      : (kind, quote) => void navigator.clipboard.writeText(quoteText(site, kind, quote)).then(
              () => say("Quote copied, with its source and a link.", true, flash),
              () => say("Could not copy.", false, flash),
            ),
  };
  const flash = document.createElement("div");
  flash.setAttribute("aria-live", "polite");
  panel.replaceChildren(report, flash, ...(extra ? [extra] : []));
  if (final && !pasted && documents.some((d) => d.status === "read")) void remember(site, documents);
  panel.append(el("p", "Quotes from the documents, not legal advice.", "note"));
  if (!pasted && final) panel.append(requestOffer(site, documents));
  void aiOffer(documents, panel);
}

/** Elsewhere: how ClauseWatch works, and what was checked here recently. */
async function guide(lead: string, site?: string) {
  const parts: HTMLElement[] = [];
  if (site) {
    const card = document.createElement("cw-report") as ReportElement;
    card.report = { site, documents: [] };
    parts.push(card);
  }
  const intro = el("p", lead, "note");
  const automatic = (await kv.get("automatic").catch(() => false)) === true && (await browser.permissions.contains({ origins: AUTO_ORIGINS }).catch(() => false));
  const how = el("div", "", "box");
  const steps = el("ol", "", "guide");
  const step = (n: number, ...content: (string | Node)[]) => {
    const li = el("li");
    const text = el("span");
    text.append(...content);
    li.append(el("span", String(n), "n"), text);
    steps.append(li);
  };
  if (automatic) step(1, "Open any sign-up page. The card appears by itself (you chose ", el("strong", "Show automatically"), ").");
  else step(1, "Open a service's sign-up, terms or privacy page, and click ClauseWatch.");
  step(2, "Read the quotes. Each one links to the document it came from.");
  step(3, "Checking another service? Use ", el("strong", "Scan a link"), ".");
  how.append(el("h2", "How ClauseWatch works"), steps);
  parts.push(intro, how);
  const recent = ((await kv.get(RECENT_KEY).catch(() => undefined)) as RecentSite[] | undefined) ?? [];
  if (recent.length) {
    const box = el("div", "", "box");
    const ul = el("ul", "", "recent");
    for (const r of recent) {
      const li = el("li", r.site);
      const changed = r.changed.length > 0;
      const badge = changed ? el("span", "changed", "badge red") : r.found === undefined ? null : el("span", `${r.found} found`, r.found ? "badge amber" : "badge");
      if (changed) badge!.setAttribute("aria-label", `${r.changed.map((k) => (k === "terms" ? "Terms" : "Privacy policy")).join(" and ")} changed since the check before`);
      if (badge) li.append(badge);
      ul.append(li);
    }
    box.append(el("h2", "Recently checked"), ul);
    parts.push(box);
  }
  const muted = (await mutedSites(kv).catch(() => [])).length;
  parts.push(el("p", `Automatic mode ${automatic ? "on" : "off"}${muted ? ` · muted on ${muted} site${muted === 1 ? "" : "s"}` : ""}`, "note"));
  main.replaceChildren(...parts);
}

async function currentPage(): Promise<{ url: string; html: string } | { error: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) return { error: "ClauseWatch reads web pages. Open a site's sign-up or terms page and click again." };
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.outerHTML });
    const html = typeof res?.result === "string" ? res.result : "";
    if (!html) return { error: "This page could not be read." };
    if (html.length > MAX_PAGE_BYTES) return { error: "This page is too large to read." };
    return { url: tab.url, html };
  } catch {
    return { error: "The browser does not let extensions read this page." };
  }
}

async function fetchDocument(kind: Kind, url: string): Promise<DocumentResult> {
  try {
    const res = await fetch(url, { credentials: "omit", redirect: "follow" });
    if (!res.ok) return { kind, status: "could_not_read", url, reason: `The page answered ${res.status}.` };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) return { kind, status: "could_not_read", url, reason: "The page is too large to read." };
    const text = await res.text();
    if (text.length > MAX_PAGE_BYTES) return { kind, status: "could_not_read", url, reason: "The page is too large to read." };
    return readDocument(kind, res.url || url, text, res.headers.get("content-type") ?? "", rules);
  } catch {
    return { kind, status: "could_not_read", url, reason: "The page could not be reached, or it moved to a site ClauseWatch was not allowed to read." };
  }
}

async function readLinked(site: string, links: Record<Kind, string[]>, kinds: Kind[]): Promise<DocumentResult[]> {
  const origins = [...new Set(kinds.flatMap((k) => links[k].slice(0, MAX_TRIES_PER_KIND)).map((u) => `${new URL(u).origin}/*`))];
  // Asked during the user's click, for exactly these origins. A scan still
  // waiting from Scan a link is abandoned, so this grant is never taken for it.
  void browser.storage.session.remove(PENDING_KEY);
  const granted = await browser.permissions.request({ origins });
  if (!granted) return kinds.map((kind) => ({ kind, status: "could_not_read", reason: `You did not allow ClauseWatch to read ${site}.` }));
  try {
    const out: DocumentResult[] = [];
    for (const kind of kinds) {
      let last: DocumentResult = { kind, status: "could_not_read", reason: "No link to this document was found on the page." };
      for (const url of links[kind].slice(0, MAX_TRIES_PER_KIND)) {
        last = await fetchDocument(kind, url);
        if (last.status === "read") break;
      }
      out.push(last);
    }
    return out;
  } finally {
    // Access was for this click only. Never while automatic mode holds access to
    // every site: that access is not this click's to give back.
    const automatic = await browser.permissions.contains({ origins: AUTO_ORIGINS }).catch(() => false);
    if (!automatic) await browser.permissions.remove({ origins }).catch(() => undefined);
  }
}

async function run() {
  const page = await currentPage();
  if ("error" in page) return guide(page.error);
  const site = new URL(page.url).hostname.replace(/^www\./, "");

  const here = kindsOfPage(page.html);
  const inPlace = here.map((kind) => readDocument(kind, page.url, page.html, "text/html", rules));
  const found = discoverLinks(page.html, page.url);
  // A known site's own documents (rules/sites.json) first, then the links on the page.
  const known = knownSite(sites, new URL(page.url).hostname);
  const links = Object.fromEntries(KINDS.map((k) => [k, [...new Set([...(known ? [known[k]] : []), ...found[k]])]])) as Record<Kind, string[]>;
  const missing = KINDS.filter((k) => !here.includes(k) && links[k].length > 0);
  // A document neither on this page nor linked from it was not read, and the report says so.
  const unread = (kinds: Kind[], reason: string): DocumentResult[] => kinds.map((kind) => ({ kind, status: "could_not_read", reason }));
  const unlinked = unread(KINDS.filter((k) => !here.includes(k) && links[k].length === 0), "No link to it was found on this page.");

  if (inPlace.length === 0 && missing.length === 0) {
    return guide(`No terms or privacy links were found on this page. Try ${site}'s home page or sign-up page.`, site);
  }
  if (missing.length === 0) return show(site, [...inPlace, ...unlinked]);

  const button = document.createElement("button");
  button.textContent = `Read ${site}'s ${missing.map((k) => (k === "terms" ? "terms" : "privacy policy")).join(" and ")}`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Reading…";
    const fetched = await readLinked(site, links, missing);
    show(site, [...inPlace, ...fetched, ...unlinked]);
  });
  if (inPlace.length) show(site, [...inPlace, ...unlinked, ...unread(missing, "Not read yet: use the button below.")], button, { final: false });
  else {
    const docs = missing.map((k) => (k === "terms" ? "terms of service" : "privacy policy")).join(" and ");
    say(known ? `${known.name} is a known service: ClauseWatch knows where its ${docs} are, and will ask to read them once, for this click only.` : `${site} links to its ${docs}. ClauseWatch will ask to read ${site} once, for this click only.`);
    main.append(button);
  }
}

// --- Data requests ------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** "Ask them to delete my data": a letter drafted here, sent by the person. */
function requestOffer(site: string, documents: DocumentResult[]): HTMLElement {
  const box = el("section", "", "request");
  const open = el("button", "Ask them to delete my data");
  open.type = "button";
  box.append(open);
  open.addEventListener(
    "click",
    () => {
      // The button becomes the form's heading.
      // The form also offers a copy of the data, so the heading names the data, not one request.
      const h = el("h2", `Ask ${site} about `);
      h.append(el("strong", "your data"));
      h.tabIndex = -1;
      open.replaceWith(h);
      h.focus();
      void requestForm(site, documents, box);
    },
    { once: true },
  );
  return box;
}

async function requestForm(site: string, documents: DocumentResult[], box: HTMLElement) {
  const body = documents.map((d) => (d.status === "read" ? d.body : "")).join("\n");
  const suggestions = privacyAddresses(body, site);
  const kind = el("select");
  kind.setAttribute("aria-label", "What to ask");
  for (const [v, t] of [["erasure", "Delete my data"], ["access", "Send me a copy of my data"], ["offboarding", "Close my account and delete my data"]] as const) {
    const o = el("option", t);
    o.value = v;
    kind.append(o);
  }
  const law = el("select");
  law.setAttribute("aria-label", "Which law");
  for (const [v, t] of [["gdpr", "GDPR (EU, UK): one month to answer"], ["ccpa", "CCPA (California): 45 days"]] as const) {
    const o = el("option", t);
    o.value = v;
    law.append(o);
  }
  const to = el("input");
  to.type = "email";
  to.setAttribute("aria-label", "The service's privacy address");
  to.placeholder = `privacy@${site}`;
  // Prefilled only with an address at the service's own domain; others are
  // offered in the list, for the person to choose.
  to.value = suggestions.find((a) => isOwnAddress(a, site)) ?? "";
  const list = el("datalist");
  list.id = `cw-privacy-addresses-${crypto.randomUUID()}`;
  for (const a of suggestions) {
    const o = el("option");
    o.value = a;
    list.append(o);
  }
  to.setAttribute("list", list.id);
  const account = el("input");
  account.setAttribute("aria-label", "Your account there (email or username)");
  account.placeholder = "Your account there (email or username)";
  const draft = el("button", "Draft the letter");
  draft.type = "button";
  const out = el("div");
  const note = el("p", suggestions.length ? "The address was found in the privacy policy; check it before sending." : "Find the privacy address in the service's privacy policy.", "note");
  box.replaceChildren(kind, law, to, list, account, draft, note, out);

  draft.addEventListener("click", () => {
    if (!to.value.trim() || !account.value.trim()) return say("Enter the privacy address and your account there.", true, out);
    // Fixed now: what is opened and copied is this letter, as drafted.
    const k = kind.value as RequestKind;
    const l = law.value as Law;
    const recipient = to.value.trim();
    const who = account.value.trim();
    const letter = draftLetter(k, l, site, who);
    const pre = el("pre", `To: ${recipient}\nSubject: ${letter.subject}\n\n${letter.body}`);
    pre.style.whiteSpace = "pre-wrap";
    const mail = el("a", "Open in my email", "button");
    mail.href = mailtoLink(recipient, letter.subject, letter.body);
    const copy = el("button", "Copy text");
    copy.type = "button";
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(`Subject: ${letter.subject}\n\n${letter.body}`).then(() => (copy.textContent = "Copied"));
    });
    const actions = el("p");
    actions.append(mail, " ", copy);
    out.replaceChildren(pre, actions);
  });
}

// --- Scan a link --------------------------------------------------------

function showScan(r: ScanResult) {
  // Pages the background fetched are read here, with this popup's rules.
  void readFetched(r, rules, sites).then(
    (read) => show(read.site, read.documents, undefined, { panel: scanOut }),
    () => say("Something went wrong reading that.", true, scanOut),
  );
}

/** Waits for the background to store the scan it finished, up to a limit. */
function waitForResult(ms: number): Promise<ScanResult | null> {
  return new Promise((resolve) => {
    const done = (r: ScanResult | null) => {
      browser.storage.onChanged.removeListener(listener);
      clearTimeout(timer);
      resolve(r);
    };
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const r = changes[RESULT_KEY]?.newValue as (ScanResult & { running?: boolean }) | undefined;
      if (area === "session" && r?.documents && !r.running) void browser.storage.session.remove(RESULT_KEY).then(() => done(r));
    };
    const timer = setTimeout(() => done(null), ms);
    browser.storage.onChanged.addListener(listener);
  });
}

async function scanAddress(url: URL, kind: Kind | "auto"): Promise<ScanResult | string> {
  // A known site's own documents may be on another of its sites: access to each.
  const origins = scanOrigins(url.href, kind, sites);
  // All three start inside the click: Firefox accepts a permission request
  // only while it handles the user's input, so nothing is awaited before it.
  // The scan is saved first because the prompt may close the popup.
  const had = browser.permissions.contains({ origins });
  const saved = browser.storage.session.set({ [PENDING_KEY]: { url: url.href, kind, at: Date.now(), origins } });
  const asked = browser.permissions.request({ origins });
  const [already, , granted] = await Promise.all([had, saved, asked]);
  if (!granted) {
    await browser.storage.session.remove(PENDING_KEY);
    return `You did not allow ClauseWatch to read ${siteOf(url.href)}.`;
  }
  if (already) {
    // Allowed before (Automatic mode, say): read it here, and leave that access as it was.
    await browser.storage.session.remove(PENDING_KEY);
    return readAddress(url.href, kind, rules, sites, fetchChosen);
  }
  // Newly allowed: the background finishes the scan and gives the access back.
  return (await waitForResult(90_000)) ?? "Still reading. Open ClauseWatch again in a moment to see the result.";
}

let formBuilt = false;

/** Built once: switching tabs keeps what was typed and the last result. */
async function scanForm() {
  if (formBuilt) return;
  formBuilt = true;
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.htmlFor = "scan-address";
  label.textContent = "Terms or privacy page address";
  // An address on one line beside Scan; pasted text in a box of its own, read here.
  const addressField = document.createElement("input");
  addressField.id = "scan-address";
  addressField.className = "address";
  addressField.type = "text";
  addressField.inputMode = "url";
  addressField.placeholder = "https://service.example/terms";
  const input = document.createElement("textarea");
  input.id = "scan-input";
  input.rows = 4;
  input.maxLength = MAX_PASTED;
  input.placeholder = "Paste the terms or privacy policy text";
  input.setAttribute("aria-label", "Terms or privacy policy text");
  const kind = document.createElement("select");
  kind.setAttribute("aria-label", "Which document");
  for (const [value, text] of [["auto", "Detect which document it is"], ["terms", "Terms of service"], ["privacy", "Privacy policy"]]) {
    const o = document.createElement("option");
    o.value = value!;
    o.textContent = text!;
    kind.append(o);
  }
  const go = document.createElement("button");
  go.type = "submit";
  go.textContent = "Scan";
  const top = el("div", "", "row");
  top.append(addressField, go);
  const pasteRow = el("div", "", "row");
  const paste = el("button", "Paste terms text instead", "secondary");
  paste.type = "button";
  pasteRow.append(paste, el("p", "Reads pasted text on this device; no site access needed.", "note"));
  const pasted = el("div");
  pasted.hidden = true;
  pasted.append(input);
  paste.addEventListener("click", () => {
    pasted.hidden = !pasted.hidden;
    // One field at a time: the address is set aside while pasting.
    addressField.disabled = !pasted.hidden;
    paste.textContent = pasted.hidden ? "Paste terms text instead" : "Scan an address instead";
    (pasted.hidden ? addressField : input).focus();
  });
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "For a link, ClauseWatch asks once for permission to read that one site, and finishes the scan even if the permission prompt closes this window. For a known service, it reads that service's own terms and privacy policy.";
  form.append(label, top, pasteRow, pasted, kind, note);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = (pasted.hidden ? addressField.value : input.value).trim();
    if (!value) return;
    go.disabled = true;
    go.textContent = "Reading…";
    const k = kind.value as Kind | "auto";
    const address = asAddress(value);
    try {
      if (!address && pasted.hidden) return say("Enter a web address, or choose Paste terms text instead.", true, scanOut);
      if (!address) return showScan(scanPasted(value, k, rules));
      const r = await scanAddress(address, k);
      return typeof r === "string" ? say(r, true, scanOut) : showScan(r);
    } catch {
      say("Something went wrong reading that.", true, scanOut);
    } finally {
      go.disabled = false;
      go.textContent = "Scan";
    }
  });
  scanPanel.replaceChildren(form, scanOut);
}

/** A scan the background finished, or is still reading, while the popup was closed. */
async function resumeScan(): Promise<boolean> {
  const stored = await browser.storage.session.get(RESULT_KEY);
  const result = stored[RESULT_KEY] as (ScanResult & { at?: number; running?: boolean }) | undefined;
  if (!result?.at || Date.now() - result.at > PENDING_TTL_MS) return false;
  openTab("scan");
  if (result.running) {
    say("Still reading the address you scanned…", true, scanOut);
    const done = await waitForResult(90_000);
    if (done) showScan(done);
    else say("Still reading. Open ClauseWatch again in a moment to see the result.", true, scanOut);
    return true;
  }
  await browser.storage.session.remove(RESULT_KEY);
  showScan(result);
  return true;
}

// --- sharing and the one quiet line ----------------------------------------

/** Share ClauseWatch: the link, a copy button, plain share links, and where it runs. */
function sharePanel(): HTMLElement[] {
  const h = el("h2", "Tell a friend about ");
  h.append(el("strong", "ClauseWatch"));
  const row = el("div", "", "row");
  const link = el("input", "", "link");
  link.value = SHARE_URL;
  link.readOnly = true;
  link.setAttribute("aria-label", "ClauseWatch link");
  const copy = el("button", "Copy");
  copy.type = "button";
  copy.addEventListener("click", () =>
    void navigator.clipboard.writeText(SHARE_URL).then(
      () => (copy.textContent = "Copied"),
      () => (copy.textContent = "Could not copy"),
    ),
  );
  row.append(link, copy);
  const grid = el("div", "", "grid");
  for (const t of shareTargets()) {
    const a = el("a", t.name);
    a.href = t.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    grid.append(a);
  }
  const parts: HTMLElement[] = [h, el("p", "Free, open source, and reads terms on your own device.", "note"), row, grid];
  if (typeof navigator.share === "function") {
    const more = el("button", "More…");
    more.type = "button";
    more.addEventListener("click", () => void navigator.share({ title: "ClauseWatch", url: SHARE_URL }).catch(() => undefined));
    grid.append(more);
    parts.push(el("p", "“More…” opens your device's own share menu.", "note"));
  }
  const get = el("div", "", "box");
  const chips = el("ul", "", "chips");
  for (const b of ["Chrome", "Edge", "Firefox", "Brave", "Opera", "Vivaldi"]) chips.append(el("li", b));
  get.append(el("h2", "Get it for"), chips);
  parts.push(get);
  return parts;
}

// --- tabs ------------------------------------------------------------------------

const tabs = { site: document.getElementById("tab-site")!, scan: document.getElementById("tab-scan")! };
let siteStarted = false;

const sharePane = document.getElementById("share")!;
const shareButton = document.getElementById("share-button")!;
const tablist = document.querySelector('[role="tablist"]') as HTMLElement;
// The share icon swaps the panels for the share sheet; pressing it again goes back.
shareButton.addEventListener("click", () => {
  const open = shareButton.getAttribute("aria-expanded") !== "true";
  shareButton.setAttribute("aria-expanded", String(open));
  if (open && !sharePane.childElementCount) sharePane.append(...sharePanel());
  sharePane.hidden = !open;
  tablist.hidden = open;
  if (open) main.hidden = scanPanel.hidden = true;
  else selectTab(tabs.scan.getAttribute("aria-selected") === "true" ? "scan" : "site");
});

function selectTab(which: "site" | "scan") {
  for (const [name, el] of Object.entries(tabs)) {
    const on = name === which;
    el.setAttribute("aria-selected", String(on));
    el.tabIndex = on ? 0 : -1;
  }
  main.hidden = which !== "site";
  scanPanel.hidden = which !== "scan";
}

function openTab(which: "site" | "scan") {
  selectTab(which);
  if (which === "scan") return void scanForm();
  // The page is read once per opening of the popup.
  if (siteStarted) return;
  siteStarted = true;
  say("Reading this page…", true);
  run().catch(() => say("Something went wrong reading this page.", true));
}

tabs.site.addEventListener("click", () => openTab("site"));
tabs.scan.addEventListener("click", () => openTab("scan"));
for (const el of Object.values(tabs)) {
  el.addEventListener("keydown", (e) => {
    const next = e.key === "Home" ? "site" : e.key === "End" ? "scan" : e.key === "ArrowLeft" || e.key === "ArrowRight" ? (el === tabs.site ? "scan" : "site") : null;
    if (!next) return;
    e.preventDefault();
    openTab(next);
    tabs[next].focus();
  });
}

resumeScan()
  .then((resumed) => {
    if (!resumed) openTab("site");
  })
  .catch(() => openTab("site"));

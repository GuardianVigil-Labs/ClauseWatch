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
import { discoverLinks, sameSite, kindsOfPage, KINDS, readDocument, type DocumentResult, type Kind } from "../../src/engine/documents";
import { captureRenderedPage, locatePolicyControl, type PageSnapshot } from "../../src/engine/rendered";
import { ReportElement } from "../../src/ui/report";

if (!customElements.get("cw-report")) customElements.define("cw-report", ReportElement);
import { kv } from "../../src/storage";
import { AUTO_ORIGINS, cachedDocs, readKey } from "../../src/auto/background";
import { inPlaceKinds, knownSite, siteOrigins, type KnownSite } from "../../src/engine/known-sites";
import {
  asAddress, checkAgainPlan, isOwnText, readFetched, recordRecent, recentHistory, scanOrigins, scanTargets, scanPasted,
  RECENT_KEY, type RecentSite, type ScanResult,
} from "../../src/ui/scan";
import { FOCUS_KEY, JOB_PREFIX, JOB_TTL_MS, jobKey, type ScanJob, type ScanPlan } from "../../src/scan/jobs";
import { jobStore, heldOrigins, requestScan, latestJob, activeJob } from "../../src/scan/client";
import { reportTools } from "../../src/ui/report-tools";
import { aiOffer } from "../../src/ui/ai";
import { quoteText, SHARE_URL, shareTargets } from "../../src/ui/share";
import { mutedSites } from "../../src/ui/sites";
import { draftLetter, isOwnAddress, mailtoLink, privacyAddresses, type Law, type RequestKind } from "../../src/ui/requests";

// A newer signed update when one is stored and still verifies, with its
// known sites, plus the person's rule choices and own rules.
const file = await currentRulesFile(kv, BUNDLED);
const sites = file.sites ?? [];
const rules = await loadRules(kv, compileRules(file));
if (location.search) { document.body.style.width = "min(960px, 100vw)"; document.body.style.maxHeight = "none"; }
const MAX_TRIES_PER_KIND = 4;
// Each tab has its own panel, so neither can write over the other.
const main = document.getElementById("main")!;
const scanPanel = document.getElementById("scan")!;
const scanOut = document.createElement("div");
let pageGeneration = 0;

function say(text: string, note = false, panel: HTMLElement = main) {
  const p = document.createElement("p");
  p.textContent = text;
  if (note) p.className = "note";
  panel.replaceChildren(p);
}

const savedReportButton = document.createElement("button");
savedReportButton.textContent = "Latest report";
savedReportButton.onclick = async () => {
  const generation = ++pageGeneration;
  const saved = await kv.get("latestReport") as { site: string; documents: DocumentResult[]; version: number; at: number } | undefined;
  if (generation !== pageGeneration) return;
  siteStarted = true; selectTab("site");
  if (!saved || Date.now()-saved.at >= 7*864e5) { await kv.remove("latestReport"); say("No saved report is available. Saved quotes expire after seven days.", true); return; }
  show(saved.site, saved.documents, undefined, { final: false, savedVersion: saved.version });
  main.append(el("p", `Saved ${new Date(saved.at).toLocaleString()}; rules version ${saved.version}. Full document bodies are not retained in this report.`, "note"));
  const recheck = checkAgainPlan(saved, sites);
  if (!recheck) return;
  const held = await heldOrigins(recheck.origins);
  if (generation !== pageGeneration) return;
  const again = el("button", "Check again");
  again.onclick = () => { const next = requestScan(recheck.plan, recheck.origins, held, "scan"); void next.saved.then(() => viewJob(next.job.id)); };
  main.append(again);
};
document.querySelector("header")!.append(savedReportButton);

document.getElementById("settings-button")!.addEventListener("click", () => void browser.runtime.openOptionsPage());

async function remember(site: string, documents: DocumentResult[]) {
  const list = ((await kv.get(RECENT_KEY).catch(() => undefined)) as RecentSite[] | undefined) ?? [];
  await kv.set(RECENT_KEY, await recordRecent(list, site, documents)).catch(() => undefined);
}

/** A report into a panel. `final: false` is a first step whose reading continues, not yet remembered. */
function show(site: string, documents: DocumentResult[], extra?: HTMLElement, { panel = main, final = true, savedVersion }: { panel?: HTMLElement; final?: boolean; savedVersion?: number } = {}) {
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
  panel.append(reportTools(site, documents, { ...rules, version: savedVersion ?? rules.version }));
  if (final && !pasted && documents.some((d) => d.status === "read")) {
    const slim = documents.map((d) => d.status === "read" ? { ...d, body: "" } : d);
    const saved = { site, documents: slim, version: rules.version, at: Date.now() };
    if (JSON.stringify(saved).length <= 256000) void kv.set("latestReport", saved);
    else void kv.remove("latestReport");
  }
  for (const d of documents) if (d.status === "could_not_read" && d.url && asAddress(d.url)) {
    const open = el("button", `Open ${d.kind} policy and read this tab`, "secondary");
    open.onclick = () => { void browser.tabs.create({ url: d.url }); flash.textContent = "Wait for the policy to load, sign in if needed, then open ClauseWatch on that tab and choose Read visible policy. This uses the page you can see without sending your cookies to a separate fetch."; };
    panel.append(open);
  }
  if (!pasted && final) panel.append(requestOffer(site, documents));
  void aiOffer(documents, panel, rules);
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
  const recent = recentHistory(((await kv.get(RECENT_KEY).catch(() => undefined)) as RecentSite[] | undefined) ?? []);
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

async function currentPage(): Promise<(PageSnapshot & { tabId: number; pdf?: boolean }) | { error: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) return { error: "ClauseWatch reads web pages. Open a site's sign-up or terms page and click again." };
  if (/\.pdf$/i.test(new URL(tab.url).pathname)) return { url: tab.url, tabId: tab.id, html: "", controls: [], truncated: false, pdf: true };
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: captureRenderedPage });
    const snapshot = res?.result;
    if (!snapshot?.html) return { error: "This page could not be read." };
    if (snapshot.truncated) return { error: "This page is too large to read completely. Open the policy itself or select its text." };
    return { ...snapshot, tabId: tab.id };
  } catch {
    return { error: "The browser does not let extensions read this page. Use Scan a link or paste its policy text." };
  }
}

/** A manual fallback for client-rendered policies and documents with unfamiliar names. */
function renderedOffer(page: PageSnapshot & { tabId: number }): HTMLElement {
  const box = el("section", "", "box");
  box.append(el("h2", "Read the visible page"), el("p", "If the policy is loaded on this page, choose its type. Common hidden elements are excluded; open any policy sections first.", "note"));
  const kind = el("select");
  kind.setAttribute("aria-label", "Visible document type");
  for (const [value, label] of [["terms", "Terms of service"], ["privacy", "Privacy policy"]]) kind.append(Object.assign(el("option", label), { value }));
  const read = el("button", "Read visible policy");
  read.type = "button";
  const status = el("p", "", "note");
  read.addEventListener("click", async () => {
    try {
      const [res] = await browser.scripting.executeScript({ target: { tabId: page.tabId }, func: captureRenderedPage });
      const snapshot = res?.result;
      if (!snapshot || snapshot.truncated) { status.textContent = "The page could not be read completely. Select its policy text instead."; return; }
      const site = new URL(snapshot.url).hostname.replace(/^www\./, "");
      show(site, [readDocument(kind.value as Kind, snapshot.url, snapshot.html, "text/html", rules, { explicitKind: true, rendered: true })]);
    } catch { status.textContent = "The browser could not read this tab. Open the policy and click ClauseWatch again."; }
  });
  box.append(kind, read, status);
  for (const control of page.controls) {
    if (!control.path.length) continue;
    const open = el("button", `Find policy control: ${control.label}`, "secondary");
    open.type = "button";
    open.addEventListener("click", async () => {
      try {
        const [res] = await browser.scripting.executeScript({ target: { tabId: page.tabId }, func: locatePolicyControl, args: [control.path, control.label] });
        status.textContent = res?.result ? "Policy control focused on the page. Open it there, wait for its text, then choose Read visible policy. If it opens another tab, open ClauseWatch there." : "This control changed. Use it on the page, then click ClauseWatch again.";
      } catch { status.textContent = "Use this policy control on the page, then click ClauseWatch again."; }
    });
    box.append(open);
  }
  return box;
}

async function run() {
  const pageToken = ++pageGeneration;
  const page = await currentPage();
  if (pageToken !== pageGeneration) return;
  if ("error" in page) return guide(page.error);
  const site = new URL(page.url).hostname.replace(/^www\./, "");
  if (page.pdf) {
    const origins = [`${new URL(page.url).origin}/*`];
    const held = await heldOrigins(origins);
    say("Read this PDF on your device. Image-only and password-protected files need an accessible text version.");
    const read = el("button", "Read this PDF");
    read.addEventListener("click", () => {
      const pending = requestScan({ site, url: page.url, kind: "auto", targets: [{ url: page.url, kind: "auto" }], sites, documents: [] }, origins, held, "site");
      void pending.saved.then(() => viewJob(pending.job.id));
    });
    main.append(read);
    return;
  }
  const known = knownSite(sites, new URL(page.url).hostname);
  const here = inPlaceKinds(kindsOfPage(page.html), known, page.url);
  const inPlace = here.map((kind) => readDocument(kind, page.url, page.html, "text/html", rules, { rendered: true }));
  const found = discoverLinks(page.html, page.url);
  const all = discoverLinks(page.html, page.url, { external: true });
  const links = Object.fromEntries(KINDS.map((k) => [k, [...new Set([...(known ? [known[k]] : []), ...found[k]])]])) as Record<Kind, string[]>;
  const missing = KINDS.filter((k) => !here.includes(k) && links[k].length > 0);
  const external = KINDS.flatMap((kind) => all[kind].filter((url) => !sameSite(new URL(url).hostname, new URL(page.url).hostname) && !links[kind].includes(url)).slice(0, 10).map((url) => ({ kind, url })));
  const unlinked: DocumentResult[] = KINDS.filter((k) => !here.includes(k) && !links[k].length).map((kind) => ({ kind, status: "could_not_read", reason: "No on-site link was found. Choose an external policy below, scan its address, or read the visible page." }));
  const cached = inPlace.length ? null : await cachedDocs(kv, site, Date.now(), await readKey(kv, `${browser.runtime.getManifest().version}:rules-${BUNDLED.version}:packs-es-fr-1`));
  if (pageToken !== pageGeneration) return;
  if (inPlace.length) show(site, [...inPlace, ...unlinked]);
  else if (cached?.some((d) => d.status === "read")) show(site, cached, undefined, { final: false });
  else say(missing.length ? `${site} links to its policies. Allow access to read them.` : "No readable policy was recognised on this page. Choose a policy link, use its page control, or read the visible page below.");

  const choices = el("fieldset");
  choices.append(el("legend", "Policies on other sites (optional)"), el("p", "Select only the policy hosts you want to read. Your browser will ask for access to them for this scan.", "note"));
  const selected = new Set<string>();
  const read = el("button", missing.length ? `Read ${site}'s ${missing.map((k) => k === "terms" ? "terms" : "privacy policy").join(" and ")}` : "Read selected policies");
  if (cached?.some((d) => d.status === "read") && missing.length) read.textContent = "Check again";
  read.type = "button";
  let prepared: { plan: ScanPlan; origins: string[]; held: string[] } | null = null;
  let generation = 0;
  const prepare = async () => {
    const serial = ++generation;
    prepared = null;
    read.disabled = true;
    const groups = KINDS.map((kind) => ({ kind, urls: [...external.filter((e) => e.kind === kind && selected.has(`${kind}:${e.url}`)).map((e) => e.url), ...(missing.includes(kind) ? links[kind].slice(0, MAX_TRIES_PER_KIND) : [])] })).filter((g) => g.urls.length);
    if (!groups.length) return;
    const targets = groups.flatMap((g) => g.urls.map((url) => ({ url, kind: g.kind })));
    const origins = [...new Set([...targets.map((t) => `${new URL(t.url).origin}/*`), ...(known ? siteOrigins(known) : [])])];
    const held = await heldOrigins(origins);
    if (serial !== generation) return;
    prepared = { plan: { site, url: page.url, kind: "auto", targets, groups, documents: [...inPlace, ...unlinked].filter((d) => !groups.some((g) => g.kind === d.kind)), sites }, origins, held };
    read.disabled = false;
  };
  for (const candidate of external) {
    const label = el("label");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    const key = `${candidate.kind}:${candidate.url}`;
    checkbox.addEventListener("change", () => { if (checkbox.checked) selected.add(key); else selected.delete(key); void prepare(); });
    label.append(checkbox, ` ${candidate.kind === "terms" ? "Terms" : "Privacy"}: ${candidate.url}`);
    choices.append(label);
  }
  read.addEventListener("click", () => {
    if (!prepared) return;
    const pending = requestScan(prepared.plan, prepared.origins, prepared.held, "site");
    void pending.saved.then(() => viewJob(pending.job.id)).catch(() => say("The scan could not be saved. Try again.", true));
  });
  if (external.length) main.append(choices);
  if (missing.length || external.length) main.append(read);
  main.append(renderedOffer(page));
  await prepare();
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
  note.textContent = "Downloads and scan jobs expire after ten minutes; the latest saved quote report lasts seven days. For a link, ClauseWatch asks once for permission to read that one site, and finishes the scan even if the permission prompt closes this window. For a known service, it reads that service's own terms and privacy policy.";
  form.append(label, top, pasteRow, pasted, kind, note);
  let prepared: { value: string; kind: Kind | "auto"; plan: ScanPlan; origins: string[]; held: string[] } | null = null;
  let preparing = 0;
  const prepare = async () => {
    const generation = ++preparing;
    prepared = null;
    const value = addressField.value.trim();
    const address = asAddress(value);
    if (!address || !pasted.hidden) { go.disabled = false; return; }
    go.disabled = true;
    const k = kind.value as Kind | "auto";
    const origins = scanOrigins(address.href, k, sites);
    const held = await heldOrigins(origins);
    if (generation !== preparing) return;
    prepared = { value, kind: k, origins, held, plan: { site: address.hostname.replace(/^www\./, ""), url: address.href, kind: k, targets: scanTargets(address.href, k, sites), documents: [], sites, explicitKind: k !== "auto" } };
    go.disabled = false;
  };
  addressField.addEventListener("input", () => void prepare());
  kind.addEventListener("change", () => void prepare());
  paste.addEventListener("click", () => void prepare());
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
      if (!prepared || prepared.value !== value || prepared.kind !== k) { void prepare(); return say("Preparing access to this address. Press Scan again in a moment.", true, scanOut); }
      // No await before this call: the browser receives the request in the submit gesture.
      const pending = requestScan(prepared.plan, prepared.origins, prepared.held, "scan");
      prepared = null;
      await pending.saved;
      await viewJob(pending.job.id);
    } catch {
      say("Something went wrong reading that.", true, scanOut);
    } finally {
      go.disabled = false;
      go.textContent = "Scan";
    }
  });
  scanPanel.replaceChildren(keepOpen, form, jobList, scanOut);
  void renderJobList();
}

const jobList = document.createElement("section");
jobList.setAttribute("aria-label", "Recent scans");
const keepOpen = el("button", "Open persistent scan screen", "secondary");
keepOpen.onclick = () => void browser.tabs.create({ url: browser.runtime.getURL("/popup.html") + (selectedJob ? `?scan=${encodeURIComponent(selectedJob)}` : "?screen=scan") });
jobList.before(keepOpen);
let selectedJob: string | null = null;
let lastJobView = "";
let viewGeneration = 0;

async function renderJobList() {
  const jobs = (await jobStore.list()).filter((j) => Date.now() - j.at < JOB_TTL_MS).sort((a, b) => b.at - a.at);
  jobList.replaceChildren();
  for (const job of jobs) {
    const status = { waiting: "Waiting for permission", running: "Reading", complete: "Ready", cancelled: "Cancelled", failed: "Could not finish" }[job.state];
    const button = el("button", `${job.plan.site} · ${status}`, "secondary");
    button.type = "button";
    button.setAttribute("aria-label", `Open scan of ${job.plan.site}: ${job.state}`);
    button.addEventListener("click", () => void viewJob(job.id));
    jobList.append(button);
  }
}

async function viewJob(id: string) {
  if (selectedJob !== id) void browser.storage.session.set({ [FOCUS_KEY]: id });
  selectedJob = id;
  openTab("scan");
  const job = await jobStore.get(id);
  if (selectedJob !== id) return;
  if (!job) return say("This scan is no longer available. Scan the address again.", true, scanOut);
  const signature = JSON.stringify([id, job.state, job.updated, job.reason, !!job.result]);
  if (signature === lastJobView) return;
  lastJobView = signature;
  const generation = ++viewGeneration;
  await renderJobList();
  if (generation !== viewGeneration || selectedJob !== id) return;
  if (activeJob(job)) {
    say(job.state === "waiting" ? "Waiting for permission to read this site's documents…" : `Reading ${job.plan.site}'s documents… ${Object.keys(job.pages).length}/${new Set(job.plan.targets.map((t) => t.url)).size} downloads attempted. You can close this window and return to this scan.`, true, scanOut);
    const cancel = el("button", "Cancel scan", "secondary");
    cancel.type = "button";
    cancel.addEventListener("click", () => void browser.runtime.sendMessage({ type: "scan:cancel", id }));
    scanOut.append(cancel);
    return;
  }
  if (job.result) {
    try {
      const read = await readFetched(job.result, rules, sites);
      if (generation !== viewGeneration || selectedJob !== id) return;
      show(read.site, read.documents, undefined, { panel: scanOut });
    } catch { say("Something went wrong reading this scan. Try again.", true, scanOut); }
  } else say(job.reason ?? "This scan could not finish.", true, scanOut);
  if (isOwnText(job.plan.site)) return;
  const retry = el("button", "Scan again", "secondary");
  retry.type = "button";
  retry.disabled = true;
  scanOut.append(retry);
  const held = await heldOrigins(job.origins);
  if (generation !== viewGeneration || selectedJob !== id) return;
  retry.disabled = false;
  retry.addEventListener("click", () => {
    const next = requestScan(job.plan, job.origins, held, job.source === "menu" ? "scan" : job.source);
    void next.saved.then(() => viewJob(next.job.id));
  });
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !Object.keys(changes).some((key) => key.startsWith(JOB_PREFIX))) return;
  void renderJobList();
  if (selectedJob && jobKey(selectedJob) in changes) void viewJob(selectedJob);
});

async function resumeScan(): Promise<boolean> {
  void browser.runtime.sendMessage({ type: "scan:wake" }).catch(() => undefined);
  const focus = (await browser.storage.session.get(FOCUS_KEY))[FOCUS_KEY];
  const id = new URL(location.href).searchParams.get("scan") ?? (typeof focus === "string" ? focus : null);
  const focused = id ? await jobStore.get(id) : undefined;
  const job = focused && Date.now() - focused.at < JOB_TTL_MS ? focused : await latestJob();
  if (!job || Date.now() - job.at >= JOB_TTL_MS) return false;
  await viewJob(job.id);
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
    if (!resumed) openTab(new URL(location.href).searchParams.get("screen") === "scan" ? "scan" : "site");
  })
  .catch(() => openTab("site"));

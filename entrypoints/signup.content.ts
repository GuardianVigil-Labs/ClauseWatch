// Automatic mode: runs only after the user turns it on and
// grants site access, and is unregistered when they turn it off.
//
// It recognises sign-up and consent forms by their fields, and when the user
// starts filling one in, shows what the site's terms and privacy policy say.
// On a known site's sign-up page (rules/sites.json) the card shows when the
// page opens, form or not. It never reads what is typed, and never blocks a page.

import { captureRenderedPage } from "../src/engine/rendered";
import { BUNDLED } from "../src/engine/bundled";
import { compileRules } from "../src/engine/rules";
import { loadRules } from "../src/engine/rule-set";
import { currentRulesFile } from "../src/engine/rules-update";
import { kv } from "../src/storage";
import { discoverLinks, kindsOfPage, KINDS, readDocument, type DocumentResult, type Kind } from "../src/engine/documents";
import { readFirst } from "../src/ui/scan";
import { completeDocs, type Fetched } from "../src/auto/background";
import { inPlaceKinds, isSignupPage, knownSite, type KnownSite } from "../src/engine/known-sites";
import { findSignupForms, signupRoots, siteOf, type SignupForm } from "../src/auto/detect";
import { fillReport } from "../src/ui/report";
import { isMuted, mute, shouldShowCard } from "../src/ui/sites";

const MAX_TRIES_PER_KIND = 3;

export default defineContentScript({
  matches: ["https://*/*", "http://*/*"],
  registration: "runtime",
  runAt: "document_idle",
  allFrames: true,
  async main() {
    // A newer signed update when one is stored and still verifies, with the
    // person's choices and own rules; its known sites too.
    const fileP = currentRulesFile(kv, BUNDLED).catch(() => BUNDLED);
    let rulesP: ReturnType<typeof loadRules> | null = null;
    // Put together only when a page's documents are read, never on pages that read nothing.
    const ruleSet = () => (rulesP ??= fileP.then((f) => loadRules(kv, compileRules(f))));
    const site = siteOf(location.href);
    let handled = new WeakSet<HTMLElement>();
    let card: { host: HTMLElement; body: HTMLElement; dispose: () => void } | null = null;
    let docs: DocumentResult[] = [];
    let started: Promise<void> | null = null;
    let active = false;
    let generation = 0;
    let dismissed = false;
    let completed = false;
    let route = location.href;
    let lifecycle = new AbortController();
    const observers = new Map<Document | ShadowRoot, MutationObserver>();
    let timer: number | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const valid = (epoch: number) => active && epoch === generation;
    function start(): Promise<void> | undefined {
      if (active && location.href !== route) navigate();
      if (!active || dismissed || completed) return;
      if (started) return started;
      const epoch = generation;
      const attempt = onStart(epoch).catch(() => {
        if (!valid(epoch) || dismissed) return;
        rulesP = null;
        docs = KINDS.map((kind) => ({ kind, status: "could_not_read", reason: "Automatic reading could not finish. Try again, or open the policy in a tab and use This site." }));
        render();
      }).finally(() => { if (started === attempt) started = null; });
      started = attempt;
      return attempt;
    }

    const send = <T>(message: unknown) => browser.runtime.sendMessage(message) as Promise<T>;

    /** Remembered documents, and the rules they were read with (or must be put back with). */
    type Remembered = { documents: DocumentResult[] | null; key: string } | null;
    async function readDocuments(remembered: Remembered, known: KnownSite | null, epoch: number): Promise<DocumentResult[]> {
      const rules = await ruleSet();
      if (!valid(epoch)) return [];
      const snapshot = captureRenderedPage();
      if (snapshot.truncated) return [{ kind: "terms", status: "could_not_read", reason: "This page is too large to read completely. Open the policy itself in a tab." }];
      const html = snapshot.html;
      // On a known site, its listed documents are read, unless this page is one.
      const here = inPlaceKinds(kindsOfPage(html), known, location.href);
      const out: DocumentResult[] = (remembered?.documents ?? []).filter((d) => d.status === "read");
      for (const k of here) if (!out.some((d) => d.kind === k)) out.push(readDocument(k, location.href, html, "text/html", rules, { rendered: true }));
      const found = discoverLinks(html, location.href);
      for (const kind of KINDS.filter((k: Kind) => !out.some((d) => d.kind === k))) {
        if (!valid(epoch)) return [];
        // A known site's own documents first, then the links on the page.
        const links = [...new Set([...(known ? [known[kind]] : []), ...found[kind]])];
        try {
          out.push(await readFirst(kind, links, MAX_TRIES_PER_KIND, rules, (url) => valid(epoch) ? send<Fetched>({ type: "fetch-text", url }) : Promise.resolve({ ok: false, reason: "Automatic reading stopped." })));
        } catch {
          out.push({ kind, status: "could_not_read", reason: "Automatic reading could not finish. Try again, or open the policy in a tab and use This site." });
        }
      }
      // A read that found nothing at all is not kept: next time it is tried again,
      // and the site does not go quiet on the strength of it.
      // Put back under the key it was asked with: refused if the rules changed meanwhile.
      if (valid(epoch) && remembered && out.some((d) => d.status === "read")) void send({ type: "docs:put", site, documents: out, key: remembered.key }).catch(() => undefined);
      return out;
    }

    // The card's own placement, set as !important so the page's stylesheets
    // cannot hide or move it. The shadow is on the host: the
    // box's own clip-path would hide it.
    const HOST_STYLE: Record<string, string> = {
      position: "fixed", inset: "auto 16px 16px auto", margin: "0", padding: "0", border: "0", background: "transparent",
      display: "block", visibility: "visible", opacity: "1", transform: "none", "clip-path": "none", "pointer-events": "auto",
      "z-index": "2147483647", width: "360px", "max-height": "70vh", overflow: "visible", filter: "drop-shadow(0 18px 40px rgba(0,0,0,.75))",
    };
    function pin(host: HTMLElement) {
      for (const [k, v] of Object.entries(HOST_STYLE)) host.style.setProperty(k, v, "important");
      // The top layer: above anything the page draws with z-index (a page's own
      // modal dialog or fullscreen element opened later still stacks above it).
      try {
        if (!host.matches(":popover-open")) host.showPopover();
      } catch {
        // No popover support: the !important z-index above still applies.
      }
    }

    function showCard(): NonNullable<typeof card> {
      if (card) return card;
      const host = document.createElement("div");
      host.setAttribute("popover", "manual");
      const root = host.attachShadow({ mode: "closed" });
      // Nothing the page sets is inherited (all:initial; the host's inline style
      // still places it), with focus rings and dark form controls inside the card.
      const style = document.createElement("style");
      // :host rules marked !important inside the shadow outrank any !important
      // rule or inline style the page sets on the host (CSS cascade).
      style.textContent = ":host{all:initial !important;color-scheme:dark;" + Object.entries({ ...HOST_STYLE, "content-visibility": "visible", scale: "none", translate: "none", rotate: "none", height: "auto", "min-height": "0", "max-width": "none", zoom: "1" }).map(([k, v]) => `${k}:${v} !important`).join(";") + "}button:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid #2f80ff;outline-offset:2px}";
      root.append(style);
      const box = document.createElement("div");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "ClauseWatch");
      box.style.cssText = "background:linear-gradient(to bottom left,transparent 50%,#323a46 50%,#323a46 calc(50% + 1px),transparent calc(50% + 1px)) top right / 14px 14px no-repeat border-box,#05070a;color:#a3a3a3;border:1px solid #323a46;padding:12px;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%);";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
      // The mark, drawn here: nothing is loaded from the extension into the page.
      const title = document.createElement("strong");
      title.style.cssText = "display:flex;align-items:center;gap:6px;color:#fafafa;flex:1;";
      // The site, for screen readers.
      const where = document.createElement("span");
      where.textContent = ` · ${site}`;
      where.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
      title.append(markSvg(), "ClauseWatch", where);
      const close = document.createElement("button");
      close.textContent = "×";
      close.setAttribute("aria-label", "Close");
      close.style.cssText = "background:none;border:0;color:#8a8a8a;font-size:18px;cursor:pointer;";
      // Closed means gone: a later card is a fresh one, never a detached one.
      close.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        dismissed = true;
        card?.dispose();
        card = null; // first, so the guard lets it go
        host.remove();
      });
      head.append(title, close);
      const body = document.createElement("div");
      body.textContent = "Reading this site's terms…";
      // Scroll inside the padding, so a scrollbar never covers the cut corner.
      const scroll = document.createElement("div");
      scroll.style.cssText = "overflow:auto;max-height:calc(70vh - 26px);";
      scroll.append(head, body);
      box.append(scroll);
      root.append(box);
      document.documentElement.append(host);
      pin(host);
      // A page that removes the card or rewrites its style gets it back.
      const guard = new MutationObserver(() => {
        if (card?.host !== host) return guard.disconnect();
        if (!host.isConnected) document.documentElement.append(host);
        if (host.getAttribute("popover") !== "manual") host.setAttribute("popover", "manual");
        host.inert = false;
        host.hidden = false;
        pin(host);
        guard.takeRecords(); // our own changes are not news
      });
      // A backstop for what no event reports (a suppressed toggle, a replaced
      // root): every two seconds while the card is up.
      const keep = setInterval(() => {
        if (card?.host !== host) return clearInterval(keep);
        if (!host.isConnected) document.documentElement.append(host);
        host.inert = false;
        pin(host);
      }, 2000);
      // hidePopover() changes no attribute, so it is watched on its own.
      host.addEventListener("toggle", (e) => {
        if ((e as ToggleEvent).newState === "closed" && card?.host === host) pin(host);
      });
      guard.observe(document.documentElement, { childList: true });
      guard.observe(host, { attributes: true, attributeFilter: ["style", "popover", "hidden", "class", "inert"] });
      guard.observe(document, { childList: true }); // the root itself replaced
      card = { host, body, dispose: () => { guard.disconnect(); clearInterval(keep); } };
      return card;
    }

    function markSvg(): SVGSVGElement {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("aria-hidden", "true");
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      for (const [k, v] of Object.entries({ fill: "none", stroke: "#2f80ff", "stroke-width": "8", "stroke-linecap": "round", "stroke-linejoin": "round" })) g.setAttribute(k, v);
      for (const d of ["M 50 15 C 59 20 67 22 76 23 L 76 47 C 76 64 65 76 50 84 C 35 76 24 64 24 47 L 24 23 C 33 22 41 20 50 15 Z", "M 38 58 L 38 51 Q 38 47 42 47 L 43 47", "M 57 58 L 57 51 Q 57 47 61 47 L 62 47"]) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        g.append(path);
      }
      svg.append(g);
      return svg;
    }

    async function onStart(epoch: number) {
      // A site muted, or checked recently, stays quiet.
      const [muted, cached, file] = await Promise.all([
        isMuted(kv, site).catch(() => false),
        send<Remembered>({ type: "docs:get", site }).catch(() => null),
        fileP.catch(() => BUNDLED),
      ]);
      if (!valid(epoch) || dismissed) return;
      if (!shouldShowCard({ muted, checkedRecently: completeDocs(cached?.documents) })) {
        completed = true;
        if (!muted) void send({ type: "badge" });
        return;
      }
      showCard().body.textContent = "Reading this site's terms…";
      let result: DocumentResult[];
      try {
        result = await readDocuments(cached, knownSite(file.sites ?? [], location.hostname), epoch);
      } catch {
        rulesP = null;
        result = KINDS.map((kind) => ({ kind, status: "could_not_read", reason: "Automatic reading could not finish. Try again, or open the policy in a tab and use This site." }));
      }
      if (!valid(epoch) || dismissed) return;
      docs = result;
      completed = completeDocs(docs);
      render();
    }

    /** The card's content: the quotes, and the way to quiet this site. */
    function render() {
      if (!active || dismissed) return;
      const c = showCard();
      // A plain element with a closed shadow root: content scripts have no custom elements.
      const report = document.createElement("div");
      fillReport(report.attachShadow({ mode: "closed" }), { site, documents: docs, siteCard: false });
      // Set here, so a page's own --cw-* variables never restyle the card.
      report.style.setProperty("--cw-font", "ui-sans-serif, system-ui, sans-serif");
      report.style.setProperty("--cw-mono", "ui-monospace, SFMono-Regular, monospace");
      const disclaimer = Object.assign(document.createElement("p"), { textContent: "Quotes from the documents, not legal advice.", style: "margin:6px 0 0;color:#8a8a8a;font-size:11px;" });
      const quiet = button("Don't show on this site");
      quiet.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        void mute(kv, site).then(() => {
          dismissed = true;
          card?.dispose();
          card = null;
          c.host.remove();
        });
      });
      const retry = button("Try again");
      retry.addEventListener("click", (e) => { if (e.isTrusted) void start(); });
      c.body.replaceChildren(...(docs.length ? [report] : []), ...(!completeDocs(docs) ? [retry] : []), disclaimer, quiet);
    }

    function button(text: string, primary = false): HTMLButtonElement {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      // Primary: white with two cut corners; the rest hairline outlines.
      b.style.cssText = primary
        ? "background:#fafafa;border:0;color:#05070a;padding:7px 12px;font:inherit;font-weight:500;cursor:pointer;margin:8px 8px 0 0;clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px));"
        : "background:transparent;border:1px solid #323a46;color:#fafafa;padding:6px 10px;font:inherit;cursor:pointer;margin:8px 8px 0 0;";
      return b;
    }

    function watch(form: SignupForm, scope: Document | ShadowRoot) {
      if (handled.has(form.root)) return;
      handled.add(form.root);
      // When the person starts filling the form in.
      form.root.addEventListener("focusin", () => {
        if (findSignupForms(scope).some((f) => f.root === form.root)) void start();
      }, { signal: lifecycle.signal });
      const root = form.root.getRootNode();
      if (form.root.contains(document.activeElement) || root instanceof ShadowRoot && form.root.contains(root.activeElement)) void start();
    }

    // A known site's sign-up page shows its card when it opens, sign-up form or not:
    // many sign up with a single button, which no form check can see.
    async function checkKnown() {
      const epoch = generation;
      const f = await fileP;
      if (!valid(epoch)) return;
      const known = knownSite(f.sites ?? [], location.hostname);
      if (known && isSignupPage(known, location.href)) void start();
    }
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(scan, 250);
    };
    function scan() {
      if (!active) return;
      const roots = signupRoots(document);
      for (const [root, observer] of observers) if (root instanceof ShadowRoot && !root.host.isConnected) { observer.disconnect(); observers.delete(root); }
      for (const root of roots) {
        if (!observers.has(root)) {
          const observer = new MutationObserver(schedule);
          observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "name", "id", "autocomplete", "placeholder", "aria-label", "aria-labelledby", "form", "hidden", "aria-hidden", "inert", "class", "style"] });
          observers.set(root, observer);
        }
        findSignupForms(root).forEach((form) => watch(form, root));
      }
    }
    function navigate() {
      if (!active || location.href === route) return;
      route = location.href;
      generation++;
      started = null;
      completed = dismissed = false;
      card?.dispose(); card?.host.remove(); card = null;
      docs = [];
      scan();
      for (const root of signupRoots(document)) {
        if (findSignupForms(root).some((f) => f.root.contains(root.activeElement))) void start();
      }
      void checkKnown().catch(() => undefined);
    }
    function stop() {
      active = false;
      generation++;
      lifecycle.abort();
      for (const observer of observers.values()) observer.disconnect();
      observers.clear();
      clearTimeout(timer); clearInterval(poll);
      card?.dispose(); card?.host.remove(); card = null;
      handled = new WeakSet();
      started = null;
      completed = dismissed = false;
      docs = [];
      rulesP = null;
    }
    let syncingState = 0;
    async function sync() {
      const request = ++syncingState;
      const on = await send<boolean>({ type: "auto:state" }).catch(() => false);
      if (request !== syncingState) return;
      if (!on) { stop(); return; }
      if (active) return;
      active = true;
      lifecycle = new AbortController();
      route = location.href;
      window.addEventListener("popstate", navigate, { signal: lifecycle.signal });
      window.addEventListener("hashchange", navigate, { signal: lifecycle.signal });
      scan();
      void checkKnown().catch(() => undefined);
      // pushState/replaceState do not emit DOM events in an isolated script.
      // Also discovers a shadow attached to an already-existing host.
      poll = setInterval(() => { navigate(); scan(); }, 1000);
    }
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && "automatic" in changes) {
        if (changes.automatic.newValue !== true) { syncingState++; stop(); }
        else void sync();
      }
    });
    browser.runtime.onMessage.addListener((message, sender) => {
      if (sender.id === browser.runtime.id && message?.type === "auto:sync") void sync();
    });
    window.addEventListener("pagehide", () => { syncingState++; stop(); });
    window.addEventListener("pageshow", () => void sync());
    await sync();
  },
});

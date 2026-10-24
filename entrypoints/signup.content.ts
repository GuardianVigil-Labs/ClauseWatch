// Automatic mode: runs only after the user turns it on and
// grants site access, and is unregistered when they turn it off.
//
// It recognises sign-up and consent forms by their fields, and when the user
// starts filling one in, shows what the site's terms and privacy policy say.
// On a known site's sign-up page (rules/sites.json) the card shows when the
// page opens, form or not. It never reads what is typed, and never blocks a page.

import { BUNDLED } from "../src/engine/bundled";
import { compileRules } from "../src/engine/rules";
import { loadRules } from "../src/engine/rule-set";
import { currentRulesFile } from "../src/engine/rules-update";
import { kv } from "../src/storage";
import { discoverLinks, kindsOfPage, KINDS, readDocument, type DocumentResult, type Kind } from "../src/engine/documents";
import { readFirst } from "../src/ui/scan";
import type { Fetched } from "../src/auto/background";
import { inPlaceKinds, isSignupPage, knownSite, type KnownSite } from "../src/engine/known-sites";
import { findSignupForms, siteOf, type SignupForm } from "../src/auto/detect";
import { fillReport } from "../src/ui/report";
import { isMuted, mute, shouldShowCard } from "../src/ui/sites";

const MAX_TRIES_PER_KIND = 3;

export default defineContentScript({
  matches: ["https://*/*", "http://*/*"],
  registration: "runtime",
  runAt: "document_idle",
  async main() {
    // A newer signed update when one is stored and still verifies, with the
    // person's choices and own rules; its known sites too.
    const fileP = currentRulesFile(kv, BUNDLED);
    let rulesP: ReturnType<typeof loadRules> | null = null;
    // Put together only when a page's documents are read, never on pages that read nothing.
    const ruleSet = () => (rulesP ??= fileP.then((f) => loadRules(kv, compileRules(f))));
    const site = siteOf(location.href);
    const handled = new WeakSet<HTMLElement>();
    let card: { host: HTMLElement; body: HTMLElement } | null = null;
    let docs: DocumentResult[] = [];
    let started: Promise<void> | null = null;
    const start = () => (started ??= onStart());

    const send = <T>(message: unknown) => browser.runtime.sendMessage(message) as Promise<T>;

    /** Remembered documents, and the rules they were read with (or must be put back with). */
    type Remembered = { documents: DocumentResult[] | null; key: string } | null;
    async function readDocuments(remembered: Remembered, known: KnownSite | null): Promise<DocumentResult[]> {
      if (remembered?.documents) return remembered.documents;
      const rules = await ruleSet();
      const html = document.documentElement.outerHTML;
      // On a known site, its listed documents are read, unless this page is one.
      const here = inPlaceKinds(kindsOfPage(html), known, location.href);
      const out: DocumentResult[] = here.map((k) => readDocument(k, location.href, html, "text/html", rules));
      const found = discoverLinks(html, location.href);
      for (const kind of KINDS.filter((k: Kind) => !here.includes(k))) {
        // A known site's own documents first, then the links on the page.
        const links = [...new Set([...(known ? [known[kind]] : []), ...found[kind]])];
        out.push(await readFirst(kind, links, MAX_TRIES_PER_KIND, rules, (url) => send<Fetched>({ type: "fetch-text", url })));
      }
      // A read that found nothing at all is not kept: next time it is tried again,
      // and the site does not go quiet on the strength of it.
      // Put back under the key it was asked with: refused if the rules changed meanwhile.
      if (remembered && out.some((d) => d.status === "read")) void send({ type: "docs:put", site, documents: out, key: remembered.key });
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

    function showCard(): { host: HTMLElement; body: HTMLElement } {
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
      card = { host, body };
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

    async function onStart() {
      // A site muted, or checked recently, stays quiet.
      const [muted, cached, file] = await Promise.all([
        isMuted(kv, site).catch(() => false),
        send<Remembered>({ type: "docs:get", site }).catch(() => null),
        fileP.catch(() => BUNDLED),
      ]);
      if (!shouldShowCard({ muted, checkedRecently: !!cached?.documents })) {
        if (!muted) void send({ type: "badge" });
        return;
      }
      showCard();
      try {
        docs = await readDocuments(cached, knownSite(file.sites ?? [], location.hostname));
      } catch {
        docs = [];
      }
      render();
    }

    /** The card's content: the quotes, and the way to quiet this site. */
    function render() {
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
          card = null;
          c.host.remove();
        });
      });
      c.body.replaceChildren(...(docs.length ? [report] : []), disclaimer, quiet);
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

    function watch(form: SignupForm) {
      if (handled.has(form.root)) return;
      handled.add(form.root);
      // When the person starts filling the form in.
      form.root.addEventListener("focusin", () => void start(), { once: true });
    }

    // A known site's sign-up page shows its card when it opens, sign-up form or not:
    // many sign up with a single button, which no form check can see.
    void fileP.then((f) => {
      const known = knownSite(f.sites ?? [], location.hostname);
      if (known && isSignupPage(known, location.href)) void start();
    }).catch(() => undefined);

    const scan = () => findSignupForms(document).forEach(watch);
    scan();
    let timer: number | undefined;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(scan, 500);
    }).observe(document.documentElement, { childList: true, subtree: true });
  },
});

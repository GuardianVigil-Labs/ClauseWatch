// Settings: automatic mode, AI help, rules, quiet sites, privacy and about.

import { kv } from "../../src/storage";
import { AUTO_ORIGINS } from "../../src/auto/background";
import { builtInModel, type AiSettings } from "../../src/ai/assist";
import { mutedSites, unmute } from "../../src/ui/sites";
import { redrawRules, renderRules, rulesSaving } from "./rules";
import { REPOSITORY_URL, SHARE_URL } from "../../src/ui/share";

const aiEl = document.getElementById("ai")!;

/**
 * Optional AI help: off by default. The browser's own model
 * runs on the device; an API key stays on this device and goes only to the
 * service the user names. Findings are shown only when they quote the
 * document exactly, labelled as found by AI.
 */
async function renderAi() {
  const current = ((await kv.get("ai")) as AiSettings | undefined) ?? { mode: "off" };
  const s = el("section");
  s.append(el("h2", "AI help (optional)"), el("p", "The rules always run first. AI can look for clauses they missed and explain them in plain words. Every AI finding must quote the document word for word, or it is not shown. AI never rates a service.", "note"));
  const mode = el("select");
  mode.setAttribute("aria-label", "AI help");
  for (const [v, label] of [["off", "Off"], ["builtin", "This browser's built-in model (on this device)"], ["key", "My own API key (OpenAI-compatible)"]] as const) {
    const o = el("option", label);
    o.value = v;
    if (v === "builtin" && !builtInModel()) o.disabled = true;
    mode.append(o);
  }
  mode.value = current.mode;
  const base = el("input");
  base.placeholder = "https://api.example.com/v1";
  base.setAttribute("aria-label", "API address");
  const model = el("input");
  model.placeholder = "model name";
  model.setAttribute("aria-label", "Model");
  const key = el("input");
  key.type = "password";
  key.placeholder = "API key (kept on this device)";
  key.setAttribute("aria-label", "API key");
  if (current.mode === "key") {
    base.value = current.baseUrl;
    model.value = current.model;
  }
  const keyFields = el("div");
  keyFields.append(el("label", "API address"), base, el("label", "Model"), model, el("label", "API key"), key);
  const show = () => (keyFields.hidden = mode.value !== "key");
  show();
  mode.addEventListener("change", show);
  const save = el("button", "Save");
  const msg = el("p", "", "note");
  save.addEventListener("click", async () => {
    if (mode.value === "key") {
      if (!URL.canParse(base.value) || new URL(base.value).protocol !== "https:" || !model.value.trim() || (!key.value && current.mode !== "key")) {
        msg.textContent = "Enter an https address, a model and your key.";
        return;
      }
      const origin = `${new URL(base.value).origin}/*`;
      // One request in the click: the address, and on Firefox the consent to
      // send website content (the text being checked) to it.
      if (!(await requestKeyAccess(origin))) {
        msg.textContent = "ClauseWatch needs your permission to reach that address.";
        return;
      }
      const apiKey = key.value || (current.mode === "key" ? current.apiKey : "");
      await kv.set("ai", { mode: "key", baseUrl: base.value.trim(), model: model.value.trim(), apiKey } satisfies AiSettings);
    } else {
      await kv.set("ai", { mode: mode.value as "off" | "builtin" });
    }
    msg.textContent = "Saved.";
  });
  s.append(mode, keyFields, save, msg);
  aiEl.replaceChildren(s);
}

/**
 * The AI key's address, and on Firefox the declared "website content"
 * consent, in a single request so the click's permission covers both. An
 * older Firefox without data-collection permissions asks for the address alone.
 */
async function requestKeyAccess(origin: string): Promise<boolean> {
  if (!navigator.userAgent.includes("Firefox/")) return browser.permissions.request({ origins: [origin] });
  try {
    return await (browser.permissions.request as (p: unknown) => Promise<boolean>)({ origins: [origin], data_collection: ["websiteContent"] });
  } catch {
    return browser.permissions.request({ origins: [origin] }).catch(() => false);
  }
}

// --- Sites ---------------------------------------------------------------

const sitesEl = document.getElementById("sites")!;

/** Sites where the card stays quiet, and the way back to first-run setup. */
async function renderSites() {
  const s = el("section");
  s.append(el("h2", "Sites"));
  const list = await mutedSites(kv);
  if (!list.length) s.append(el("p", "ClauseWatch shows its card on every site. Choose “Don't show on this site” on a card to quiet one.", "note"));
  for (const site of list) {
    const row = el("p");
    const again = el("button", "Show again");
    again.className = "secondary";
    again.setAttribute("aria-label", `Show the card again on ${site}`);
    again.addEventListener("click", () => void unmute(kv, site).then(renderSites));
    row.append(`${site} `, again);
    s.append(row);
  }
  const setup = el("button", "Run setup again");
  setup.className = "secondary";
  setup.addEventListener("click", () => void browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") }));
  s.append(setup);
  sitesEl.replaceChildren(s);
}

void renderSites();
void renderRules(document.getElementById("rules")!);

/** About: what ClauseWatch is, and where its code and rules live. */
function renderAbout() {
  const s = el("section");
  s.append(el("h2", "About"));
  s.append(el("p", "ClauseWatch quotes what a service's terms and privacy policy say. It never scores a service or calls one safe. Quotes from the documents, not legal advice. It is free and open source, and works without an account."));
  const links = el("p");
  for (const [text, href] of [["ClauseWatch page", SHARE_URL], ["Source code and rules", REPOSITORY_URL]] as const) {
    const a = el("a", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (links.childNodes.length) links.append(" · ");
    links.append(a);
  }
  s.append(links);
  document.getElementById("about-host")!.replaceChildren(s);
}
renderAbout();

const autoEl = document.getElementById("automatic")!;

/**
 * Automatic mode: off until the user turns it on. Turning it
 * on asks for site access at that moment; turning it off gives it back.
 */
async function renderAutomatic() {
  const on = (await kv.get("automatic")) === true && (await browser.permissions.contains({ origins: AUTO_ORIGINS }));
  const s = el("section");
  s.append(el("h2", "General"));
  const label = el("label");
  label.style.display = "flex";
  label.style.gap = "8px";
  const box = el("input");
  box.type = "checkbox";
  box.checked = on;
  box.style.width = "auto";
  label.append(box, el("span", "Automatic mode"));
  box.addEventListener("change", async () => {
    if (box.checked) {
      // Asked now, during the user's click, and only now.
      const granted = await browser.permissions.request({ origins: AUTO_ORIGINS });
      box.checked = granted;
      await kv.set("automatic", granted);
    } else {
      await kv.set("automatic", false);
      await browser.permissions.remove({ origins: AUTO_ORIGINS }).catch(() => undefined);
    }
  });
  s.append(
    label,
    el("p", "When you start filling in a sign-up form, ClauseWatch shows what that site's terms and privacy policy say, without you clicking. On a known service's sign-up page it shows as the page opens. It needs access to the sites you visit, which it asks for only when you turn this on and gives back when you turn it off. It never reads what you type.", "note"),
  );
  autoEl.replaceChildren(s);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

void renderAutomatic();
void renderAi();

// --- the left menu -----------------------------------------------------------

type Pane = "general" | "ai" | "rules" | "sites" | "privacy" | "about";
const PANES: Pane[] = ["general", "ai", "rules", "sites", "privacy", "about"];
/** One section at a time, chosen in the menu; the address keeps it (#rules) across reloads. */
function showPane(name: Pane) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("nav button[data-pane]")) {
    if (b.dataset.pane === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  for (const d of document.querySelectorAll<HTMLElement>("main [data-pane]")) d.hidden = d.dataset.pane !== name;
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
}
for (const b of document.querySelectorAll<HTMLButtonElement>("nav button[data-pane]")) b.addEventListener("click", () => showPane(b.dataset.pane as Pane));
const asked = location.hash.slice(1) as Pane;
showPane(PANES.includes(asked) ? asked : "general");
// A link to a section of an open Settings tab (options.html#ai) opens it.
window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1) as Pane;
  if (PANES.includes(name)) showPane(name);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // A rules release or stored rules changing while Settings is open: the pane is drawn again.
  if (["rules:update", "disabledRuleIds", "ownRules"].some((k) => k in changes) && !rulesSaving()) void redrawRules(document.getElementById("rules")!);
});

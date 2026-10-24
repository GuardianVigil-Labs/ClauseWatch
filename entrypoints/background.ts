// The background worker: the daily rules check, automatic mode's script and
// fetches, "Scan a link" after its permission prompt, and the right-click
// menu. It reads no page and observes no browsing; pages reach it only as
// messages from the extension's own pages and scripts, or a right-click.

import { kv } from "../src/storage";
import { AUTO_ORIGINS, cachedDocs, docsStale, fetchChosen, LOCAL_REASON, pageFetch, readKey, rememberIfCurrent } from "../src/auto/background";
import { readSelection, type DocumentResult } from "../src/engine/documents";
import { BUNDLED } from "../src/engine/bundled";
import { compileRules } from "../src/engine/rules";
import { loadRules } from "../src/engine/rule-set";
import { currentRulesFile, refreshRules } from "../src/engine/rules-update";
import { asAddress, fetchTargets, freshPending, MAX_PASTED, PENDING_KEY, RESULT_KEY, scanOrigins, siteOf, type ScanResult } from "../src/ui/scan";

const AUTO_SCRIPT = "clausewatch-signup";
const MENU_LINK = "clausewatch-link";
const MENU_SELECTION = "clausewatch-selection";

/** What remembered documents are read with, this extension version included: an update reads sites afresh. */
const docsKey = () => readKey(kv, browser.runtime.getManifest().version);

/** The known sites in use, kept at hand: the menu must ask for access without waiting (Firefox). */
let knownSites = BUNDLED.sites ?? [];

/** The rules and known sites in use, with the person's own rules and choices. */
async function current() {
  const file = await currentRulesFile(kv, BUNDLED);
  knownSites = file.sites ?? [];
  return { rules: await loadRules(kv, compileRules(file)), sites: knownSites };
}

/** Registers the sign-up script only while automatic mode is on and its access is granted. */
let syncing: Promise<void> = Promise.resolve();
/** One at a time: two at once could both register the script, and the second would fail. */
function syncAutomatic(): Promise<void> {
  syncing = syncing.then(syncAutomaticNow, syncAutomaticNow);
  return syncing;
}

async function syncAutomaticNow(): Promise<void> {
  const on = (await kv.get("automatic")) === true && (await browser.permissions.contains({ origins: AUTO_ORIGINS }));
  const registered = (await browser.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT] })).length > 0;
  if (on && !registered) {
    await browser.scripting.registerContentScripts([{ id: AUTO_SCRIPT, matches: AUTO_ORIGINS, js: ["content-scripts/signup.js"], runAt: "document_idle" }]).catch(() => undefined);
  } else if (!on && registered) {
    await browser.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT] });
  }
}

async function tick(): Promise<void> {
  await syncAutomatic().catch(() => undefined);
  // Daily at most; refreshRules keeps its own clock.
  await refreshRules(kv, BUNDLED).catch(() => undefined);
}

/** Session storage: the scan result waits there for the popup. */
const showResult = (r: ScanResult & { running?: boolean }) => browser.storage.session.set({ [RESULT_KEY]: { ...r, at: Date.now() } });

/** Opens the popup on the result, or a tab with it where the browser will not open the popup. */
async function openResult(): Promise<void> {
  try {
    await browser.action.openPopup();
  } catch {
    await browser.tabs.create({ url: browser.runtime.getURL("/popup.html") }).catch(() => undefined);
  }
}

/**
 * "Scan a link" and the link menu: the permission prompt closes the
 * popup, so the scan is saved first and, once its sites are allowed, it is
 * finished here. The result waits in session storage for the popup to show,
 * and the access is given back.
 */
let finishing = false;
type Finished = "done" | "busy" | "none" | "not-allowed";
async function finishPendingScan(): Promise<Finished> {
  // One at a time: a grant and the menu's own check can both ask.
  if (finishing) return "busy";
  finishing = true;
  try {
    return await finishPendingScanNow();
  } finally {
    finishing = false;
  }
}

async function finishPendingScanNow(): Promise<Finished> {
  const pending = freshPending((await browser.storage.session.get(PENDING_KEY))[PENDING_KEY]);
  if (!pending) return "none";
  const { sites } = await current();
  // The sites asked for when the scan was saved; a later rules update cannot change what waits for a grant.
  const origins = pending.origins ?? scanOrigins(pending.url, pending.kind, sites);
  // Kept for a grant still to come (another permission may have been added meanwhile).
  if (!(await browser.permissions.contains({ origins }))) return "not-allowed";
  await browser.storage.session.remove(PENDING_KEY);
  // A popup opened while this reads waits for it rather than missing it.
  await showResult({ running: true, site: "", documents: [] });
  try {
    // Fetched here, read by the popup: a service worker cannot parse HTML.
    await showResult(await fetchTargets(pending.url, pending.kind, sites, (u) => fetchChosen(u, sites)));
  } catch {
    await showResult({ site: siteOf(pending.url), documents: [{ kind: "terms", status: "could_not_read", url: pending.url, reason: "The address could not be read." }] });
  } finally {
    // Never while automatic mode holds access to every site: that access is not this scan's to give back.
    if (!(await browser.permissions.contains({ origins: AUTO_ORIGINS }).catch(() => false))) await browser.permissions.remove({ origins }).catch(() => undefined);
  }
  return "done";
}

function createMenus(): void {
  void browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({ id: MENU_LINK, title: "ClauseWatch: check this terms link", contexts: ["link"], targetUrlPatterns: ["https://*/*", "http://*/*"] });
    browser.contextMenus.create({ id: MENU_SELECTION, title: "ClauseWatch: check selected text", contexts: ["selection"] });
  });
}

const MAX_SELECTION = MAX_PASTED;

/** The page's selection, cut in the page to its first 200,000 characters, read with the access the right-click gave (activeTab), or the menu's own copy. */
async function selectedText(tabId: number | undefined, fallback: string): Promise<{ text: string; cut: boolean }> {
  const own = { text: fallback.slice(0, MAX_SELECTION), cut: fallback.length > MAX_SELECTION };
  if (tabId === undefined) return own;
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: (max: number) => {
        const s = getSelection()?.toString() ?? "";
        return { text: s.slice(0, max), cut: s.length > max };
      },
      args: [MAX_SELECTION],
    });
    const got = res?.result as { text?: unknown; cut?: unknown } | undefined;
    return typeof got?.text === "string" && got.text.trim() ? { text: got.text, cut: got.cut === true } : own;
  } catch {
    return own;
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    createMenus();
    void tick();
    // First-run setup: opened once, on install; Settings opens it again.
    if (details.reason === "install") void browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") });
  });
  browser.runtime.onStartup.addListener(() => {
    createMenus();
    void tick();
  });
  void current().catch(() => undefined);
  browser.alarms.create("clausewatch-tick", { periodInMinutes: 15 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === "clausewatch-tick") void tick();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    // Results remembered for quiet sites were read with the old rules: forget them when the rules change.
    if (area === "local" && docsStale(changes)) {
      void browser.storage.local.get(null).then((all) => browser.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("docs:")))).catch(() => undefined);
    }
    if (area === "local" && "automatic" in changes) void syncAutomatic();
    if (area === "local" && "rules:update" in changes) void current().catch(() => undefined);
  });
  browser.permissions.onAdded.addListener(() => {
    void syncAutomatic();
    void finishPendingScan().then((done) => done === "done" && openResultIfMenu());
  });
  browser.permissions.onRemoved.addListener(() => void syncAutomatic());

  // A link scan started from the menu opens its result itself; one from the popup is shown there.
  let fromMenu = false;
  const openResultIfMenu = () => {
    if (!fromMenu) return;
    fromMenu = false;
    void openResult();
  };

  // The right-click menu: the honest fallback where no link or known site is found.
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_LINK && info.linkUrl && /^https?:\/\//.test(info.linkUrl)) {
      const url = info.linkUrl;
      // A local or private address is never read: said in the result, nothing asked for.
      if (!asAddress(url)) {
        void showResult({ site: URL.canParse(url) ? new URL(url).hostname : "Link", documents: [{ kind: "terms", status: "could_not_read", reason: LOCAL_REASON }] });
        void openResult();
        return;
      }
      // Asked inside the click: Firefox grants a request only while it handles the person's input.
      // The scan is saved first: the background finishes it once the sites are allowed.
      const origins = scanOrigins(url, "auto", knownSites);
      const saved = browser.storage.session.set({ [PENDING_KEY]: { url, kind: "auto", at: Date.now(), origins } });
      fromMenu = true;
      // Where the browser refuses to ask (no gesture it accepts), access already held still counts.
      const asked = browser.permissions.request({ origins }).catch(() => browser.permissions.contains({ origins }).catch(() => false));
      void (async () => {
        const granted = await asked;
        await saved;
        if (!granted) {
          fromMenu = false;
          await browser.storage.session.remove(PENDING_KEY);
          return;
        }
        // Already allowed: no permission was added, so it is finished here.
        const done = await finishPendingScan();
        if (done === "done") openResultIfMenu();
        // Allowed, yet the scan cannot go on: say so rather than drop it.
        else if (done === "not-allowed") {
          fromMenu = false;
          await browser.storage.session.remove(PENDING_KEY);
          await showResult({ site: siteOf(url), documents: [{ kind: "terms", status: "could_not_read", url, reason: "ClauseWatch was not allowed to read every site this link needs." }] });
          await openResult();
        }
      })();
      return;
    }
    if (info.menuItemId === MENU_SELECTION) {
      // The popup opens at once and waits for the result.
      void showResult({ running: true, site: "", documents: [] });
      void openResult();
      void (async () => {
        const { text, cut } = await selectedText(tab?.id, info.selectionText ?? "");
        const { rules } = await current();
        const page = info.pageUrl && /^https?:\/\//.test(info.pageUrl) ? info.pageUrl : "";
        const site = `${page ? `Selected text on ${siteOf(page)}` : "Selected text"}${cut ? " (its first 200,000 characters)" : ""}`;
        await showResult({ site, documents: [readSelection(text, page, rules)] });
      })();
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Only the extension's own pages and content scripts.
    if (sender.id !== browser.runtime.id) return;
    const m = message as { type?: string; key?: unknown; url?: unknown; site?: unknown; documents?: unknown };
    if (m?.type === "fetch-text" && typeof m.url === "string") {
      const url = m.url;
      const tabUrl = sender.tab?.url;
      return current().then(({ sites }) => pageFetch(url, tabUrl, sites));
    }
    const tabSite = sender.tab?.url ? new URL(sender.tab.url).hostname.replace(/^www\./, "") : null;
    // The key says what the documents are read with; a put whose key is no longer current is dropped.
    if (m?.type === "docs:get" && tabSite && m.site === tabSite) return docsKey().then(async (key) => ({ key, documents: await cachedDocs(kv, tabSite, Date.now(), key) }));
    if (m?.type === "docs:put" && tabSite && m.site === tabSite && Array.isArray(m.documents) && typeof m.key === "string") {
      const asked = m.key;
      return docsKey().then((key) => rememberIfCurrent(kv, tabSite, m.documents as DocumentResult[], asked, key));
    }
    // A site checked recently stays quiet: a dot on the icon, not the card.
    if (m?.type === "badge" && sender.tab?.id !== undefined) {
      void browser.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#2f80ff" }).catch(() => undefined);
      return browser.action.setBadgeText({ tabId: sender.tab.id, text: "•" }).catch(() => undefined);
    }
  });
});

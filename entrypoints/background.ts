// The background worker: the daily rules check, automatic mode's script and
// fetches, "Scan a link" after its permission prompt, and the right-click
// menu. It reads no page and observes no browsing; pages reach it only as
// messages from the extension's own pages and scripts, or a right-click.

import { applyVersionEdit, cleanSaved, type VersionEdit } from "../src/storage-retention";
import { kv } from "../src/storage";
import { AUTO_ORIGINS, cachedDocs, docsStale, fetchChosen, LOCAL_REASON, pageFetch, pruneDocs, readKey, rememberIfCurrent } from "../src/auto/background";
import { readSelection, type DocumentResult } from "../src/engine/documents";
import { BUNDLED } from "../src/engine/bundled";
import { compileRules } from "../src/engine/rules";
import { applyRuleEdit, type RuleEdit, loadRules } from "../src/engine/rule-set";
import { currentRulesFile, refreshRules } from "../src/engine/rules-update";
import { asAddress, MAX_PASTED, scanOrigins, scanTargets, siteOf } from "../src/ui/scan";

import { ScanJobs, FOCUS_KEY, JOB_PREFIX, newJob, type ScanPlan } from "../src/scan/jobs";
import { jobStore, heldOrigins } from "../src/scan/client";

const AUTO_SCRIPT = "clausewatch-signup";
const AUTO_FRAME_SCRIPT = "clausewatch-signup-frame";
/** The reader runs in top frames; frames get only a small script that asks for it when a sign-up field is focused. */
const AUTO_SCRIPTS = [
  { id: AUTO_SCRIPT, matches: AUTO_ORIGINS, js: ["content-scripts/signup.js"], runAt: "document_idle" as const, allFrames: false },
  { id: AUTO_FRAME_SCRIPT, matches: AUTO_ORIGINS, js: ["content-scripts/signup-frame.js"], runAt: "document_idle" as const, allFrames: true },
];
const automaticReads = new Set<AbortController>();
const stopAutomaticReads = () => { for (const controller of automaticReads) controller.abort(); };
const automaticAllowed = async () => (await kv.get("automatic")) === true && await browser.permissions.contains({ origins: AUTO_ORIGINS });
async function notifyAutomatic(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => tab.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, { type: "auto:sync" }).catch(() => undefined)));
}
const cleanDocs = async () => { await pruneDocs(kv, await browser.storage.local.get(null)); await editVersions(() => cleanSaved(kv)); };
const MENU_LINK = "clausewatch-link";
let editingRules: Promise<unknown> = Promise.resolve();
let editingVersions: Promise<unknown> = Promise.resolve();
/** The one queue for saved policy versions: edits from extension pages and their cleanup. */
function editVersions<T>(apply: () => Promise<T>): Promise<T> {
  const next = editingVersions.then(apply, apply);
  editingVersions = next.catch(() => undefined);
  return next;
}
const MENU_SELECTION = "clausewatch-selection";

/** What remembered documents are read with, this extension version included: an update reads sites afresh. */
const docsKey = () => readKey(kv, `${browser.runtime.getManifest().version}:rules-${BUNDLED.version}:packs-es-fr-1:english-fallback`);

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
  const on = await automaticAllowed();
  const registered = (await browser.scripting.getRegisteredContentScripts({ ids: AUTO_SCRIPTS.map((s) => s.id) })).map((s) => s.id);
  const missing = AUTO_SCRIPTS.filter((s) => !registered.includes(s.id));
  const present = AUTO_SCRIPTS.filter((s) => registered.includes(s.id));
  if (on && missing.length) await browser.scripting.registerContentScripts(missing).catch(() => undefined);
  // Updated in place: an earlier version registered the reader in every frame.
  if (on && present.length) await browser.scripting.updateContentScripts(present);
  if (!on && registered.length) await browser.scripting.unregisterContentScripts({ ids: registered });
  if (!on) stopAutomaticReads();
  await notifyAutomatic();
}

async function tick(): Promise<void> {
  await syncAutomatic().catch(() => undefined);
  await cleanDocs().catch(() => undefined);
  // Daily at most; refreshRules keeps its own clock.
  await refreshRules(kv, BUNDLED).catch(() => undefined);
}

/** Opens results without consuming a shared storage slot. */
async function openResult(id: string): Promise<void> {
  await browser.storage.session.set({ [FOCUS_KEY]: id });
  try { await browser.action.openPopup(); }
  catch { await browser.tabs.create({ url: browser.runtime.getURL(`/popup.html?scan=${encodeURIComponent(id)}`) }).catch(() => undefined); }
}

const scans = new ScanJobs({
  store: jobStore,
  allowed: (origins) => browser.permissions.contains({ origins }).catch(() => false),
  release: async (origins) => {
    if (!(await browser.permissions.contains({ origins: AUTO_ORIGINS }))) await browser.permissions.remove({ origins });
  },
  fetch: (url, sites, signal) => fetchChosen(url, sites, signal),
  completed: (job) => openResult(job.id),
});
let ready: Promise<void> = Promise.resolve();
const wakeScans = (answered?: string) => ready.then(async () => { await scans.expire(); await scans.wake(answered); }).catch(() => undefined);

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
  void cleanDocs().catch(() => undefined);
  // Pre-job versions stored a shared result that could retain downloaded HTML
  // indefinitely. It has no current viewer: remove it from both storage areas.
  ready = Promise.all([browser.storage.local.remove(["scanResult", "scanPending"]), browser.storage.session.remove(["scanResult", "scanPending"])]).then(() => scans.recover());
  void wakeScans();
  browser.alarms.create("clausewatch-tick", { periodInMinutes: 15 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === "clausewatch-tick") void tick();
    if (a.name === "clausewatch-scans") void wakeScans();
  });
  browser.alarms.create("clausewatch-scans", { periodInMinutes: 1 });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && Object.keys(changes).some((key) => key.startsWith(JOB_PREFIX))) void wakeScans();
    // Results remembered for quiet sites were read with the old rules: forget them when the rules change.
    if (area === "local" && docsStale(changes)) {
      void browser.storage.local.get(null).then((all) => browser.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("docs:")))).catch(() => undefined);
    }
    if (area === "local" && "automatic" in changes) {
      if (changes.automatic.newValue !== true) stopAutomaticReads();
      void syncAutomatic();
    }
    if (area === "local" && "rules:update" in changes) void current().catch(() => undefined);
  });
  browser.permissions.onAdded.addListener(() => {
    void syncAutomatic();
    void wakeScans();
  });
  browser.permissions.onRemoved.addListener((removed) => {
    if (removed.origins?.some((origin) => AUTO_ORIGINS.includes(origin) || origin === "<all_urls>")) stopAutomaticReads();
    void syncAutomatic();
  });

  // Permission requests start inside the browser's menu gesture (Firefox).
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_LINK && info.linkUrl && /^https?:\/\//.test(info.linkUrl)) {
      const url = info.linkUrl;
      const plan: ScanPlan = { site: URL.canParse(url) ? siteOf(url) : "Link", url, kind: "auto", targets: [], documents: [], sites: knownSites };
      if (!asAddress(url)) {
        const job = newJob(plan, [], [], "menu");
        job.state = "complete";
        job.result = { site: plan.site, documents: [{ kind: "terms", status: "could_not_read", reason: LOCAL_REASON }] };
        void jobStore.put(job).then(() => openResult(job.id));
        return;
      }
      plan.targets = scanTargets(url, "auto", knownSites);
      const origins = scanOrigins(url, "auto", knownSites);
      const before = heldOrigins(origins);
      const asked = browser.permissions.request({ origins }).catch(() => browser.permissions.contains({ origins }).catch(() => false));
      void (async () => {
        const held = await before;
        const job = newJob(plan, origins, origins.filter((o) => !held.includes(o)), "menu");
        await jobStore.put(job);
        const granted = await asked;
        if (!granted) await scans.cancel(job.id);
        await wakeScans(granted ? job.id : undefined);
        if ((await jobStore.get(job.id))?.state === "cancelled") await openResult(job.id);
      })().catch(() => undefined);
      return;
    }
    if (info.menuItemId === MENU_SELECTION) {
      void (async () => {
        const { text, cut } = await selectedText(tab?.id, info.selectionText ?? "");
        const { rules } = await current();
        const page = info.pageUrl && /^https?:\/\//.test(info.pageUrl) ? info.pageUrl : "";
        const site = `${page ? `Selected text on ${siteOf(page)}` : "Selected text"}${cut ? " (its first 200,000 characters)" : ""}`;
        const job = newJob({ site, url: page, kind: "terms", targets: [], documents: [], sites: [] }, [], [], "menu");
        job.state = "complete";
        job.result = { site, documents: [readSelection(text, page, rules)] };
        await jobStore.put(job);
        await openResult(job.id);
      })().catch(() => undefined);
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Only the extension's own pages and content scripts.
    if (sender.id !== browser.runtime.id) return;
    const m = message as { type?: string; key?: unknown; url?: unknown; site?: unknown; documents?: unknown; id?: unknown; edit?: unknown };
    if (m?.type === "auto:state") return automaticAllowed().catch(() => false);
    // A sign-up field was focused in a frame: add the reader to that frame only.
    const tabId = sender.tab?.id;
    if (m?.type === "auto:frame" && tabId !== undefined && sender.frameId) {
      const frameId = sender.frameId;
      return (async () => {
        if (!(await automaticAllowed())) return false;
        await browser.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["/content-scripts/signup.js"] });
        return true;
      })().catch(() => false);
    }
    // A frame's report, for the top frame's card. Its site is the frame's own address.
    if (m?.type === "auto:card" && tabId !== undefined && sender.frameId && sender.url && URL.canParse(sender.url)) {
      const show = { type: "auto:show", site: siteOf(sender.url), documents: Array.isArray(m.documents) ? m.documents : null };
      return automaticAllowed().then((on) => on && browser.tabs.sendMessage(tabId, show, { frameId: 0 })).then(() => true, () => false);
    }
    if (m?.type === "fetch-text" && typeof m.url === "string") {
      const url = m.url;
      // A frame reads its own site's policies, never its embedding tab's policies.
      const tabUrl = sender.url;
      return (async () => {
        if (!(await automaticAllowed())) return { ok: false, reason: "Automatic mode is off or site access was removed." };
        const controller = new AbortController();
        automaticReads.add(controller);
        try {
          const { sites } = await current();
          if (!(await automaticAllowed())) controller.abort();
          return await pageFetch(url, tabUrl, sites, controller.signal);
        } finally { automaticReads.delete(controller); }
      })();
    }
    // Job control belongs to extension pages, not scripts injected into a website.
    const extensionPage = sender.url?.startsWith(browser.runtime.getURL("/"));
    if (extensionPage && m?.type === "versions:edit") return editVersions(() => applyVersionEdit(kv, m.edit as VersionEdit));
    if (extensionPage && m?.type === "rules:edit") {
      const edit = m.edit as RuleEdit;
      const apply = async () => {
        try {
          const file = await currentRulesFile(kv, BUNDLED);
          await applyRuleEdit(kv, compileRules(file), edit);
          return { ok: true };
        } catch (err) { return { ok: false, reason: err instanceof Error ? err.message : "The rules could not be saved." }; }
      };
      editingRules = editingRules.then(apply, apply);
      return editingRules;
    }
    if (extensionPage && m?.type === "scan:wake") { void wakeScans(typeof m.id === "string" ? m.id : undefined); return Promise.resolve(true); }
    if (extensionPage && m?.type === "scan:cancel" && typeof m.id === "string") return ready.then(() => scans.cancel(m.id as string));
    const tabSite = sender.tab && sender.url && URL.canParse(sender.url) && /^https?:/.test(sender.url) ? new URL(sender.url).hostname.replace(/^www\./, "") : null;
    // The key says what the documents are read with; a put whose key is no longer current is dropped.
    if (m?.type === "docs:get" && tabSite && m.site === tabSite) return docsKey().then(async (key) => ({ key, documents: await automaticAllowed() ? await cachedDocs(kv, tabSite, Date.now(), key) : null }));
    if (m?.type === "docs:put" && tabSite && m.site === tabSite && Array.isArray(m.documents) && typeof m.key === "string") {
      const asked = m.key;
      return docsKey().then(async (key) => await automaticAllowed() && rememberIfCurrent(kv, tabSite, m.documents as DocumentResult[], asked, key));
    }
    // A site checked recently stays quiet: a dot on the icon, not the card.
    if (m?.type === "badge" && sender.tab?.id !== undefined) {
      const tabId = sender.tab.id;
      return automaticAllowed().then(async (on) => {
        if (!on) return;
        await browser.action.setBadgeBackgroundColor({ tabId, color: "#2f80ff" }).catch(() => undefined);
        await browser.action.setBadgeText({ tabId, text: "•" }).catch(() => undefined);
      });
    }
  });
});

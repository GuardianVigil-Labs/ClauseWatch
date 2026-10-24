#!/usr/bin/env node
// Browser smoke test: loads the built Chrome extension in a
// real Chromium and checks that it starts, opens setup on install, renders its
// pages, and that pasted terms are read on the device into exact quotes.
// Run `npm run build` first. Needs Playwright's Chromium (`npx playwright install chromium`).

import { chromium } from "playwright";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// SMOKE_EXT tests another build, such as a release zip unpacked (docs/releasing.md).
const ext = resolve(process.env.SMOKE_EXT ?? ".output/chrome-mv3");
if (!existsSync(join(ext, "manifest.json"))) {
  console.error("No Chrome build found: run `npm run build` first, or point SMOKE_EXT at an unpacked build.");
  process.exit(1);
}
const profile = mkdtempSync(join(tmpdir(), "cw-smoke-"));
// A terms document long enough to be read as one (300 words or more); the two
// clause sentences are what the rules must quote.
const FILLER = Array.from(
  { length: 12 },
  (_, n) => `Section ${n + 1}. You agree to use the service lawfully and to keep the information in your account accurate and up to date.`,
).join(" ");
const TERMS =
  "Terms of Service. These terms govern your use of the service. " +
  FILLER +
  " We may use the content you upload to train our machine learning models and improve them. " +
  "Any dispute arising from these terms will be resolved by binding arbitration rather than in court. " +
  FILLER;

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

let context;
try {
  // The "chromium" channel runs extensions in headless mode. SMOKE_CHANNEL=msedge
  // runs the same checks in an installed Edge (branded Chrome no longer loads
  // an unpacked extension from the command line).
  context = await chromium.launchPersistentContext(profile, {
    channel: process.env.SMOKE_CHANNEL ?? "chromium",
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  // Every request from the start, from the background and every page: noted
  // and stopped, so the test never depends on, or reaches, any server.
  const outside = [];
  // Known limit: a request the background makes in the first instant, before these attach, is not seen.
  const seen = (r) => `${r.method()} ${r.url().split("?")[0]}`;
  await context.route(/^https?:/, (route) => {
    outside.push(seen(route.request()));
    return route.abort();
  });
  // The background's own requests may bypass routing: watched as well.
  context.on("request", (r) => {
    if (/^https?:/.test(r.url())) outside.push(seen(r));
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  check(/^[a-p]{32}$/.test(id), "the background service worker starts");

  // Setup opens by itself on install.
  const deadline = Date.now() + 10000;
  while (!context.pages().some((p) => p.url().endsWith("/welcome.html")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  const welcome = context.pages().find((p) => p.url().endsWith("/welcome.html"));
  check(!!welcome, "setup opens on install");
  if (welcome) {
    await welcome.getByRole("heading", { level: 1 }).waitFor();
    const first = welcome.locator('input[name="ai"]').first();
    await first.waitFor({ timeout: 5000 }).catch(() => undefined);
    check((await first.getAttribute("value").catch(() => null)) === "off" && (await first.isChecked().catch(() => false)), "setup offers no AI first, and chosen");
  }

  // The popup's Scan tab reads pasted terms on the device.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByRole("tab", { name: "Scan a link" }).click();
  check((await popup.locator("#scan").isVisible()) && !(await popup.locator("#main").isVisible()), "the popup's tabs switch to Scan a link");
  await popup.getByRole("tab", { name: "This site" }).click();
  check((await popup.locator("#main").isVisible()) && !(await popup.locator("#scan").isVisible()), "and back to This site");
  await popup.getByRole("tab", { name: "Scan a link" }).click();
  await popup.getByRole("button", { name: "Paste terms text instead" }).click();
  await popup.locator("#scan-input").fill(TERMS);
  await popup.getByRole("combobox", { name: "Which document" }).selectOption("terms");
  await popup.getByRole("button", { name: "Scan", exact: true }).click();
  await popup.locator("#scan cw-report").waitFor({ timeout: 10000 });
  // The pasted text must not be what the checks below find.
  await popup.locator("#scan-input").fill("");
  // The report is a closed shadow root, which page scripts and Playwright's
  // locators cannot see; Chrome's full accessibility tree can.
  const cdp = await context.newCDPSession(popup);
  const quotes = [
    "We may use the content you upload to train our machine learning models and improve them.",
    "Any dispute arising from these terms will be resolved by binding arbitration rather than in court.",
  ];
  // The tree can lag the render a little: asked again for up to five seconds.
  let texts = [];
  for (const until = Date.now() + 5000; Date.now() < until; await popup.waitForTimeout(250)) {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    texts = nodes.filter((n) => n.role?.value === "StaticText").map((n) => String(n.name?.value ?? ""));
    if (quotes.every((q) => texts.some((t) => t.includes(q)))) break;
  }
  check(quotes.every((q) => texts.some((t) => t.includes(q))), "both findings are the document's exact sentences");
  check(texts.some((t) => t === "AI training") && texts.some((t) => t === "Arbitration"), "each finding carries its topic badge");
  check(texts.some((t) => /^2 found$/.test(t)), "the site card counts the topics found");
  // "safe" may appear only where the page says the result is not such a verdict.
  const verdicts = texts.filter((t) => /\b(safe|score|grade)\b/i.test(t) && !/not a verdict|is not “safe”/i.test(t));
  check(verdicts.length === 0, "no verdict, score or grade is shown");
  check(texts.some((t) => t === "Quotes from the documents, not legal advice."), "the report says it is quotes, not legal advice");

  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByRole("button", { name: "About", exact: true }).click();
  check(await options.getByRole("heading", { name: "About" }).waitFor({ timeout: 5000 }).then(() => true, () => false), "Settings renders, and its menu opens a section");
  const menu = await options.locator("nav button").allTextContents();
  check(JSON.stringify(menu) === JSON.stringify(["General", "AI help", "Rules", "Sites", "Privacy", "About"]), `Settings has its six sections (${menu.join(", ")})`);

  // An own rule whose pattern backtracks without end is refused, not saved.
  await options.getByRole("button", { name: "Rules", exact: true }).click();
  check((await options.locator("table.rules tbody tr").count()) > 5, "the rules table lists the ClauseWatch rules");
  const dupes = await options.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map((e) => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); });
  check(dupes.length === 0, `Settings has no duplicate element ids (${dupes.join(", ") || "none"})`);
  await options.getByRole("tab", { name: /^My rules/ }).click();
  await options.locator("#own-name").fill("Smoke test rule");
  await options.locator("#own-patterns-a-sentence-must-match-one-per-line-all-of-them-").fill("(\\w+)+$");
  await options.locator("#own-sentences-it-must-match-one-per-line-").fill("We sell your data to partners.");
  await options.locator("#own-sentences-it-must-not-match-one-per-line-").fill("We never sell your data.");
  await options.locator("#own-save").click();
  const refusal = (await options.locator("#own-save + p").textContent({ timeout: 5000 }).catch(() => "")) ?? "";
  // Refused by the pattern check itself, not for a missing example.
  check(/repeat|backtrack|nested|linear/i.test(refusal) && !(await options.getByText("Smoke test rule", { exact: true }).count()), `a catastrophic own pattern is refused (${refusal.slice(0, 70) || "no message"})`);

  await options.waitForLoadState("networkidle");
  // With AI off, the one request allowed is the daily signed-rules download from GitHub.
  check(outside.includes("GET https://github.com/GuardianVigil-Labs/ClauseWatch/releases/latest/download/rules.signed.json"), "the daily rules check asks GitHub's latest release");
  const others = outside.filter((o) => o !== "GET https://github.com/GuardianVigil-Labs/ClauseWatch/releases/latest/download/rules.signed.json");
  check(others.length === 0, `no other request leaves the extension (${[...new Set(others)].join(", ") || "none"})`);
} finally {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
}

// Automatic mode: the card on a sign-up form, before anything is typed.
// A script cannot click the browser's permission prompt, so a copy of the
// build is given all-sites access up front (this copy only, never shipped).
const autoExt = mkdtempSync(join(tmpdir(), "cw-smoke-ext-"));
const autoProfile = mkdtempSync(join(tmpdir(), "cw-smoke-auto-"));
let auto;
try {
  cpSync(ext, autoExt, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(autoExt, "manifest.json"), "utf8"));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), "<all_urls>"];
  writeFileSync(join(autoExt, "manifest.json"), JSON.stringify(manifest));
  // A script cannot right-click the browser's own menu either: this copy keeps
  // the menu's click handler where the test can call it, as a click would, and
  // shows results in a tab (the fallback where a popup cannot open), which a
  // script can read.
  const bg = join(autoExt, "background.js");
  writeFileSync(bg, `{const e=chrome.contextMenus.onClicked,a=e.addListener.bind(e);e.addListener=(f)=>{globalThis.__cwMenuClick=f;a(f);};chrome.action.openPopup=()=>Promise.reject(new Error("test"));}\n${readFileSync(bg, "utf8")}`);
  auto = await chromium.launchPersistentContext(autoProfile, {
    channel: process.env.SMOKE_CHANNEL ?? "chromium",
    args: [`--disable-extensions-except=${autoExt}`, `--load-extension=${autoExt}`],
  });
  // An invented service: a sign-up page linking to its terms, both served here; nothing else is reached.
  await auto.route(/^https?:/, (route) => {
    const url = route.request().url();
    if (url === "https://signup.example/join") {
      return route.fulfill({ contentType: "text/html", body: '<h1>Create your account</h1><form><input type="email" name="email" autocomplete="email"><input type="password" name="password" autocomplete="new-password"><button type="submit">Create account</button></form><a href="/terms">Terms of Service</a>' });
    }
    if (url === "https://signup.example/terms") return route.fulfill({ contentType: "text/html", body: `<h1>Terms of Service</h1><p>${TERMS}</p>` });
    if (url === "https://signup.example/notes") {
      return route.fulfill({ contentType: "text/html", body: '<p id="clause">Any dispute arising from these terms will be resolved by binding arbitration rather than in court.</p><a href="/terms">our terms</a>' });
    }
    return route.abort();
  });
  let [w] = auto.serviceWorkers();
  w ??= await auto.waitForEvent("serviceworker", { timeout: 15000 });
  await w.evaluate(() => chrome.storage.local.set({ automatic: true }));
  // The background registers the sign-up script once automatic mode is on.
  for (const until = Date.now() + 5000; Date.now() < until; await new Promise((r) => setTimeout(r, 200))) {
    if ((await w.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length) break;
  }
  const page = await auto.newPage();
  await page.goto("https://signup.example/join");
  await page.locator('input[type="email"]').focus();
  const cdp = await auto.newCDPSession(page);
  let texts = [];
  for (const until = Date.now() + 15000; Date.now() < until; await page.waitForTimeout(300)) {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    texts = nodes.map((n) => String(n.name?.value ?? ""));
    if (texts.some((t) => t.includes("binding arbitration"))) break;
  }
  check(texts.some((t) => t.includes("We may use the content you upload to train our machine learning models")), "automatic mode: the card on a sign-up form quotes the linked terms");
  check(texts.some((t) => t === "Don't show on this site"), "automatic mode: the card offers Don't show on this site");
  check(texts.some((t) => t === "Quotes from the documents, not legal advice."), "automatic mode: the card says it is quotes, not legal advice");

  // The right-click menu: both items exist, and each opens its result.
  const menus = await w.evaluate(async () => {
    const exists = (id) => new Promise((ok) => chrome.contextMenus.update(id, {}, () => ok(!chrome.runtime.lastError)));
    return [await exists("clausewatch-link"), await exists("clausewatch-selection"), typeof globalThis.__cwMenuClick];
  });
  check(menus[0] && menus[1] && menus[2] === "function", `the right-click menu has both items (${JSON.stringify(menus)})`);
  const notes = await auto.newPage();
  await notes.goto("https://signup.example/notes");
  const tabId = await w.evaluate(async () => (await chrome.tabs.query({ url: "https://signup.example/notes" }))[0]?.id);
  const resultPage = async (before) => {
    for (const until = Date.now() + 15000; Date.now() < until; await new Promise((r) => setTimeout(r, 200))) {
      const p = auto.pages().find((x) => x.url().endsWith("/popup.html") && !before.includes(x));
      if (p) return p;
    }
    return null;
  };
  const axText = async (p, want) => {
    const c = await auto.newCDPSession(p);
    let names = [];
    for (const until = Date.now() + 15000; Date.now() < until; await p.waitForTimeout(300)) {
      const { nodes } = await c.send("Accessibility.getFullAXTree");
      names = nodes.map((n) => String(n.name?.value ?? ""));
      if (names.some((t) => t.includes(want))) break;
    }
    return names;
  };
  await notes.evaluate(() => getSelection().selectAllChildren(document.getElementById("clause")));
  let before = auto.pages();
  await w.evaluate(({ tabId }) => globalThis.__cwMenuClick({ menuItemId: "clausewatch-selection", selectionText: "", pageUrl: "https://signup.example/notes" }, { id: tabId }), { tabId });
  const sel = await resultPage(before);
  const selText = sel ? await axText(sel, "binding arbitration") : [];
  check(selText.some((t) => t.includes("Any dispute arising from these terms will be resolved by binding arbitration rather than in court.")), "right-click, check selected text: the selected clause is quoted");
  check(!selText.some((t) => t === "Ask them to delete my data"), "right-click, check selected text: no data-request letter for selected text");
  before = auto.pages();
  await w.evaluate(({ tabId }) => globalThis.__cwMenuClick({ menuItemId: "clausewatch-link", linkUrl: "https://signup.example/terms", pageUrl: "https://signup.example/notes" }, { id: tabId }), { tabId });
  const link = await resultPage(before);
  const linkText = link ? await axText(link, "train our machine learning models") : [];
  check(linkText.some((t) => t.includes("We may use the content you upload to train our machine learning models")), "right-click, check this terms link: the linked terms are read and quoted");
  before = auto.pages();
  await w.evaluate(({ tabId }) => globalThis.__cwMenuClick({ menuItemId: "clausewatch-link", linkUrl: "http://198.51.100.10/terms", pageUrl: "https://signup.example/notes" }, { id: tabId }), { tabId });
  const local = await resultPage(before);
  const localText = local ? await axText(local, "local or private network") : [];
  check(localText.some((t) => t.includes("ClauseWatch does not read local or private network addresses.")), "right-click on a private network address: refused, and the result says why");

} finally {
  await auto?.close();
  rmSync(autoExt, { recursive: true, force: true });
  rmSync(autoProfile, { recursive: true, force: true });
}
if (failed) {
  console.error(`${failed} smoke check(s) failed.`);
  process.exit(1);
}
console.log("Smoke test passed.");

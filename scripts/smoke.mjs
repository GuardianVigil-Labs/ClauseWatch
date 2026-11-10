#!/usr/bin/env node
// Browser smoke test: loads the built Chrome extension in a
// real Chromium and checks that it starts, opens setup on install, renders its
// pages, and that pasted terms are read on the device into exact quotes.
// Run `npm run build` first. Needs Playwright's Chromium (`npx playwright install chromium`).

import { makePdf } from "../tests/helpers/pdf.ts";
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
  await popup.getByText("Save or print this report", { exact: true }).click();
  const reportPreview = await popup.getByRole("textbox", { name: "Plain-text report", exact: true }).inputValue();
  check(quotes.every((q) => reportPreview.includes(q)) && reportPreview.includes("Read:") && reportPreview.includes("rules version:"), "plain-text export contains full quotes, scan dates and rule version");
  const downloadReady = popup.waitForEvent("download");
  await popup.getByRole("button", { name: "Download plain-text report", exact: true }).click();
  check((await downloadReady).suggestedFilename() === "clausewatch-report.txt", "a report can be downloaded without extra host access");
  await popup.getByText("Export local diagnostics", { exact: true }).click();
  await popup.getByRole("button", { name: "Prepare diagnostic preview" }).click();
  const diagnosticPreview = await popup.getByRole("textbox", { name: "Diagnostic preview", exact: true }).inputValue();
  check(!quotes.some((q) => diagnosticPreview.includes(q)) && !diagnosticPreview.includes("apiKey") && !diagnosticPreview.includes("https://"), "diagnostic preview excludes policy content, URLs and credentials");

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

  // Example validation uses the same minimum sentence length as real scans.
  await options.locator("#own-name").fill("Local payments");
  await options.locator("#own-patterns-a-sentence-must-match-one-per-line-all-of-them-").fill("payments");
  await options.locator("#own-patterns-it-must-not-match-one-per-line-").fill("not");
  await options.locator("#own-sentences-it-must-match-one-per-line-").fill("All payments are final.");
  await options.locator("#own-sentences-it-must-not-match-one-per-line-").fill("Payments are not final.");
  await options.locator("#own-save").click();
  check(/at least 8 words/.test(await options.locator("#own-save + p").textContent()), "custom-rule examples that cannot match a real scan are rejected");
  await options.locator("#own-sentences-it-must-match-one-per-line-").fill("All payments for this subscription are final after purchase.");
  await options.locator("#own-sentences-it-must-not-match-one-per-line-").fill("All payments for this subscription are not final after purchase.");
  await options.locator("#own-save").click();
  await options.getByText("Local payments", { exact: true }).waitFor();
  check(true, "a valid custom rule is saved through the background edit queue");

  const settingsWorker = context.serviceWorkers()[0];
  const secondSettings = await context.newPage();
  await secondSettings.goto(`chrome-extension://${id}/options.html#rules`);
  const concurrentRule = (id) => ({ id, title: id, category: "auto_renewal", all: ["payments"], none: ["not"], examples: { match: ["All payments for this subscription are final after purchase."], noMatch: ["All payments for this subscription are not final after purchase."] } });
  const concurrent = await Promise.all([options, secondSettings].map((page, i) => page.evaluate((rule) => chrome.runtime.sendMessage({ type: "rules:edit", edit: { type: "add", rules: [rule] } }), concurrentRule(`own-concurrent-${i}`))));
  check(concurrent.every((r) => r.ok) && await settingsWorker.evaluate(async () => (await chrome.storage.local.get("ownRules")).ownRules.filter((r) => r.id.startsWith("own-concurrent-")).length === 2), "concurrent Settings pages preserve both custom-rule additions");
  await Promise.all([options.evaluate(() => chrome.runtime.sendMessage({ type: "rules:edit", edit: { type: "delete", id: "own-concurrent-0" } })), secondSettings.evaluate(() => chrome.runtime.sendMessage({ type: "rules:edit", edit: { type: "toggle", id: "own-concurrent-1", on: false } }))]);
  check(await settingsWorker.evaluate(async () => { const s = await chrome.storage.local.get(["ownRules", "disabledRuleIds"]); return !s.ownRules.some((r) => r.id === "own-concurrent-0") && s.ownRules.some((r) => r.id === "own-concurrent-1") && s.disabledRuleIds.includes("own-concurrent-1"); }), "concurrent deletion and toggle preserve each other's rule edits");
  await secondSettings.close();
  const budgetRules = Array.from({ length: 150 }, (_, n) => ({ id: `own-budget-${n}`, title: `Budget ${n}`, category: "auto_renewal", all: ["payments", "subscription", "final"], none: ["not"], examples: { match: ["All payments for this subscription are final after purchase."], noMatch: ["All payments for this subscription are not final after purchase."] } }));
  await settingsWorker.evaluate((ownRules) => chrome.storage.local.set({ ownRules }), budgetRules);
  await options.getByRole("tab", { name: "My rules · 150", exact: true }).click();
  await options.locator("#own-name").fill("Over budget");
  await options.locator("#own-patterns-it-must-not-match-one-per-line-").fill("not");
  await options.locator("#own-patterns-a-sentence-must-match-one-per-line-all-of-them-").fill("payments");
  await options.locator("#own-sentences-it-must-match-one-per-line-").fill("All payments for this subscription are final after purchase.");
  await options.locator("#own-sentences-it-must-not-match-one-per-line-").fill("All payments for this subscription are not final after purchase.");
  await options.locator("#own-save").click();
  await options.getByText(/At most 600 patterns across/).waitFor();
  check((await settingsWorker.evaluate(async () => (await chrome.storage.local.get("ownRules")).ownRules.length)) === 150, "the combined pattern budget is enforced before storing another rule");
  await settingsWorker.evaluate(() => chrome.storage.local.set({ ownRules: [{ id: "own-invalid", title: "Invalid saved rule", category: "auto_renewal", all: ["["], none: [], examples: { match: ["All payments for this subscription are final after purchase."], noMatch: ["No charges."] } }] }));
  await options.getByText(/custom rules are not running: Invalid saved rule/).waitFor();
  check(true, "settings identifies saved rules that cannot run");
  await settingsWorker.evaluate(() => chrome.storage.local.set({ ownRules: [] }));

  await popup.reload();
  await popup.getByRole("tab", { name: "Scan a link" }).click();
  await popup.getByRole("button", { name: "Paste terms text instead" }).click();
  const sale = "We may sell personal data to advertisers unless you opt out.";
  const denial = "We will not change these terms without notice to you.";
  const later = "Your second subscription automatically renews each month at its current price.";
  await popup.locator("#scan-input").fill(`Terms of Service\n\n${sale} ${denial} Your subscription automatically renews at the current price until you cancel. ${later}\n\nThis applies only in regions where you have consented to these offers.`);
  await popup.getByRole("button", { name: "Scan", exact: true }).click();
  await popup.locator("#scan-input").fill("");
  let accuracyText = [];
  for (const until = Date.now() + 5000; Date.now() < until; await popup.waitForTimeout(100)) {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    accuracyText = nodes.map((node) => String(node.name?.value ?? ""));
    if (accuracyText.some((text) => text === `“${later}”`)) break;
  }
  check(accuracyText.some((text) => text === `“${sale}”`) && accuracyText.some((text) => text === `“${later}”`), "qualified data sales and later renewal sentences are both retained");
  check(!accuracyText.some((text) => text === `“${denial}”`), "a denial of changes without notice is not a finding");
  check(accuracyText.some((text) => text === "Show surrounding text"), "findings offer their surrounding source text");

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

  // AI tests use invented credentials and routed model answers; no AI server
  // is contacted. This test-only build already holds the host permission.
  await w.evaluate(() => chrome.storage.local.set({ ai: { mode: "key", baseUrl: "https://old-model.example/v1", model: "fixture", apiKey: "fixture-old-credential" } }));
  const aiSettings = await auto.newPage();
  await aiSettings.goto(`chrome-extension://${new URL(w.url()).host}/options.html#ai`);
  await aiSettings.getByRole("textbox", { name: "API address" }).fill("https://model.example/v1");
  check(await aiSettings.getByRole("combobox", { name: "Credential", exact: true }).inputValue() === "", "changing an AI endpoint clears the implicit saved-key selection");
  await aiSettings.getByRole("button", { name: "Save", exact: true }).click();
  await aiSettings.getByText("Choose a credential for this endpoint.", { exact: false }).waitFor();
  check(await w.evaluate(async () => (await chrome.storage.local.get("ai")).ai.baseUrl === "https://old-model.example/v1"), "saving a changed AI endpoint without a credential choice is refused");
  await aiSettings.getByLabel("API key", { exact: true }).fill("fixture-new-credential");
  await aiSettings.getByRole("button", { name: "Save", exact: true }).click();
  await aiSettings.getByText("Saved.", { exact: true }).waitFor();
  check(await w.evaluate(async () => { const ai = (await chrome.storage.local.get("ai")).ai; return ai.apiKey === "fixture-new-credential" && ai.credentialEndpoint === "https://model.example/v1/chat/completions"; }), "a new credential is bound to the full selected endpoint");
  await aiSettings.getByRole("textbox", { name: "API address" }).fill("https://model.example/v2");
  check(await aiSettings.getByRole("combobox", { name: "Credential", exact: true }).inputValue() === "", "changing an AI endpoint path also requires a credential choice");
  await aiSettings.getByRole("combobox", { name: "Credential", exact: true }).selectOption("saved");
  await aiSettings.getByRole("button", { name: "Save", exact: true }).click();
  for (const until = Date.now() + 5000; Date.now() < until; await aiSettings.waitForTimeout(100)) {
    if (await w.evaluate(async () => (await chrome.storage.local.get("ai")).ai.credentialEndpoint === "https://model.example/v2/chat/completions")) break;
  }
  check(await w.evaluate(async () => { const ai = (await chrome.storage.local.get("ai")).ai; return ai.apiKey === "fixture-new-credential" && ai.credentialEndpoint === "https://model.example/v2/chat/completions"; }), "explicitly choosing the saved credential permits its use at a new endpoint");
  await aiSettings.getByRole("textbox", { name: "API address" }).evaluate((input) => { input.value = "https://model.example/unselected-path"; });
  await aiSettings.getByRole("button", { name: "Save", exact: true }).click();
  await aiSettings.getByText("Choose a credential for this endpoint.", { exact: false }).waitFor();
  check(await w.evaluate(async () => (await chrome.storage.local.get("ai")).ai.credentialEndpoint === "https://model.example/v2/chat/completions"), "saving also enforces the endpoint-specific credential choice when no input event fired");

  const aiQuote = "You authorize compensated transfers of personal profiles to independent recipients only after giving express permission.";
  const unsupported = "The service sells all personal data without permission.";
  let aiRequests = 0;
  let holdAi = false;
  let releaseAi;
  let aiGate = Promise.resolve();
  let reachedTail = false;
  let allBatchesBounded = true;
  let correctCredential = true;
  await auto.route("https://model.example/v2/chat/completions", async (route) => {
    aiRequests++;
    const prompt = route.request().postDataJSON().messages[0].content;
    correctCredential &&= route.request().headers().authorization === "Bearer fixture-new-credential";
    if (holdAi) await aiGate;
    if (aiRequests === 1) return route.fulfill({ status: 503, body: "Temporary model failure" });
    let answer;
    if (prompt.includes("extractive summary")) answer = [{ text: unsupported, quotes: [1] }, { text: aiQuote, quotes: [1] }];
    else {
      const source = prompt.split("<<<DOCUMENT\n")[1].split("\nDOCUMENT>>>")[0];
      allBatchesBounded &&= source.length <= 24000;
      reachedTail ||= source.includes(aiQuote);
      answer = [
        { category: "data_sale", quote: aiQuote.split(" only after")[0], explanation: unsupported },
        { category: "data_sale", quote: aiQuote, explanation: unsupported },
      ];
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }).catch(() => undefined);
  });
  const aiPopup = await auto.newPage();
  await aiPopup.goto(`chrome-extension://${new URL(w.url()).host}/popup.html`);
  await aiPopup.getByRole("tab", { name: "Scan a link" }).click();
  await aiPopup.getByRole("button", { name: "Paste terms text instead" }).click();
  const aiFiller = "These terms explain membership records and service access for registered account holders. ";
  await aiPopup.locator("#scan-input").fill(`Terms of Service\n\n${aiFiller.repeat(450)}\n\n${aiQuote}`);
  await aiPopup.getByRole("combobox", { name: "Which document" }).selectOption("terms");
  await aiPopup.getByRole("button", { name: "Scan", exact: true }).click();
  await aiPopup.getByText("AI coverage: at most 24,000", { exact: false }).waitFor();
  check(aiRequests === 0, "the AI batch limit and document coverage are shown before any model request");
  await aiPopup.getByRole("button", { name: "Look for clauses the rules missed (AI)" }).click();
  await aiPopup.getByRole("button", { name: "Retry AI request" }).waitFor();
  await aiPopup.getByRole("button", { name: "Retry AI request" }).click();
  await aiPopup.getByRole("button", { name: "AI analysis complete" }).waitFor();
  check(reachedTail && allBatchesBounded && correctCredential, "AI analysis reaches the end of a long document in bounded batches using only the selected credential");
  check(await aiPopup.locator("blockquote").filter({ hasText: aiQuote, visible: true }).count() === 1 && !(await aiPopup.locator("body").innerText()).includes(unsupported), "AI displays a complete conditional quote and drops fragment quotes and generated explanations");
  await aiPopup.getByRole("button", { name: "Summarise the quotes (AI)" }).click();
  await aiPopup.getByText("AI-selected quote summary.", { exact: false }).waitFor();
  check(!(await aiPopup.locator("body").innerText()).includes(unsupported) && (await aiPopup.locator("li").filter({ hasText: aiQuote }).count()) > 0, "a genuine citation cannot admit an unsupported summary claim");
  holdAi = true; aiGate = new Promise((resolve) => { releaseAi = resolve; });
  await aiPopup.getByRole("button", { name: "Summarise the quotes (AI)" }).click();
  await aiPopup.getByRole("button", { name: "Cancel AI request" }).filter({ visible: true }).click();
  await aiPopup.getByText("The AI request was cancelled.", { exact: false }).waitFor();
  check(await aiPopup.getByRole("button", { name: "Retry AI request" }).isEnabled(), "a cancelled AI request leaves an explicit retry control available");
  holdAi = false; releaseAi();
  await aiPopup.getByRole("button", { name: "Retry AI request" }).click();
  await aiPopup.getByRole("button", { name: "Summarise the quotes (AI)" }).waitFor();
  await w.evaluate(() => chrome.storage.local.set({ ai: { mode: "off" } }));
  await aiPopup.close(); await aiSettings.close();

  // Lifecycle regressions use separate invented hosts so their caches cannot
  // quiet one another. CDP can click the card's closed shadow via its AX node.
  const names = async (session) => (await session.send("Accessibility.getFullAXTree")).nodes.map((n) => String(n.name?.value ?? ""));
  const waitNames = async (session, predicate) => {
    let found = [];
    for (const until = Date.now() + 10000; Date.now() < until;) {
      found = await names(session);
      if (predicate(found)) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Automatic card did not reach its expected state: ${found.join(" | ")}`);
  };
  const clickCard = async (session, name) => {
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const node = nodes.find((n) => n.role?.value === "button" && n.name?.value === name);
    if (!node?.backendDOMNodeId) throw new Error(`Missing card button: ${name}`);
    await session.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: node.backendDOMNodeId });
    const { model } = await session.send("DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId });
    const q = model.content;
    const x = (q[0] + q[2] + q[4] + q[6]) / 4;
    const y = (q[1] + q[3] + q[5] + q[7]) / 4;
    await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  let releaseDismiss;
  const pendingDismiss = new Promise((resolve) => { releaseDismiss = resolve; });
  let privacyAvailable = false;
  const calls = new Map();
  const fields = '<div id="fields"><div><input type="email"></div><div><input type="password" autocomplete="new-password"></div></div>';
  const links = '<a href="/terms">Terms of Service</a><a href="/privacy">Privacy policy</a>';
  await auto.route(/^https:\/\/(dismiss|disable|retry|shadow|attributes|iframe|embedded)\.example\//, async (route) => {
    const u = new URL(route.request().url());
    calls.set(u.host + u.pathname, (calls.get(u.host + u.pathname) ?? 0) + 1);
    if (u.pathname === "/join") {
      let body = fields + links;
      if (u.host === "shadow.example") body = `<div id="shadow"></div>${links}<script>setTimeout(()=>document.getElementById('shadow').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(fields)},300)</script>`;
      if (u.host === "attributes.example") body = `<div id="hidden" style="display:none">${fields.replace("new-password", "current-password")}</div>${links}`;
      if (u.host === "iframe.example") body = '<iframe src="https://embedded.example/join" title="Create account"></iframe>';
      return route.fulfill({ contentType: "text/html", body });
    }
    if (u.pathname === "/terms") {
      if (u.host === "dismiss.example") await pendingDismiss;
      return route.fulfill({ contentType: "text/html", body: `<h1>Terms of Service</h1><p>${TERMS}</p>` });
    }
    if (u.pathname.startsWith("/privacy") || u.pathname.startsWith("/legal/privacy")) {
      if (u.host === "retry.example" && !privacyAvailable) return route.fulfill({ status: 503, body: "Temporarily unavailable" });
      return route.fulfill({ contentType: "text/html", body: '<h1>Privacy Policy</h1><p>We collect your email address and delete it when you close your account.</p>' });
    }
    return route.fulfill({ status: 404, body: "Not found" });
  });
  const dismissPage = await auto.newPage();
  await dismissPage.goto("https://dismiss.example/join");
  await dismissPage.locator('input[type="email"]').focus();
  const dismissAX = await auto.newCDPSession(dismissPage);
  await waitNames(dismissAX, (n) => n.includes("Reading this site's terms…"));
  check(true, "sibling field containers without a form trigger automatic reading");
  await clickCard(dismissAX, "Close");
  releaseDismiss();
  for (const until = Date.now() + 5000; Date.now() < until; await dismissPage.waitForTimeout(100)) {
    if (await w.evaluate(async () => !!(await chrome.storage.local.get("docs:dismiss.example"))["docs:dismiss.example"])) break;
  }
  await dismissPage.waitForTimeout(500);
  check(!(await names(dismissAX)).includes("ClauseWatch"), "a dismissed loading card stays closed after reading finishes");

  const retryPage = await auto.newPage();
  await retryPage.goto("https://retry.example/join");
  await retryPage.locator('input[type="email"]').focus();
  const retryAX = await auto.newCDPSession(retryPage);
  await waitNames(retryAX, (n) => n.includes("Try again"));
  privacyAvailable = true;
  await clickCard(retryAX, "Try again");
  await waitNames(retryAX, (n) => n.some((t) => t.includes("binding arbitration")) && !n.includes("Try again"));
  check(calls.get("retry.example/terms") === 1 && calls.get("retry.example/privacy") === 2, "retrying a partial result reuses its terms and retries its failed privacy policy");

  const disablePage = await auto.newPage();
  await disablePage.goto("https://disable.example/join");
  await disablePage.locator('input[type="email"]').focus();
  const disableAX = await auto.newCDPSession(disablePage);
  await waitNames(disableAX, (n) => n.some((t) => t.includes("binding arbitration")));
  await w.evaluate(() => chrome.storage.local.set({ automatic: false }));
  await waitNames(disableAX, (n) => !n.includes("ClauseWatch"));
  await disablePage.locator('input[type="password"]').focus();
  await disablePage.waitForTimeout(1200);
  check(!(await names(disableAX)).includes("ClauseWatch"), "disabling automatic mode stops the already-injected card and focus handlers");
  const disabledId = await w.evaluate(async () => (await chrome.tabs.query({ url: "https://disable.example/join" }))[0].id);
  const refusal = await w.evaluate(async (tabId) => (await chrome.scripting.executeScript({ target: { tabId }, func: () => chrome.runtime.sendMessage({ type: "fetch-text", url: "https://disable.example/terms" }) }))[0].result, disabledId);
  check(refusal?.ok === false && refusal.reason.includes("off"), "the background refuses automatic fetch messages while mode is disabled");
  await w.evaluate(() => chrome.storage.local.set({ automatic: true }));
  for (const until = Date.now() + 5000; Date.now() < until; await disablePage.waitForTimeout(100)) {
    if ((await w.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length) break;
  }

  const attrPage = await auto.newPage();
  await attrPage.goto("https://attributes.example/join");
  await attrPage.evaluate(() => {
    document.querySelector("#hidden").style.display = "block";
    document.querySelector('input[type="password"]').autocomplete = "new-password";
  });
  await attrPage.locator('input[type="email"]').focus();
  const attrAX = await auto.newCDPSession(attrPage);
  await waitNames(attrAX, (n) => n.some((t) => t.includes("binding arbitration")));
  check(true, "autocomplete and form-visibility changes are detected without adding fields");
  const shadowPage = await auto.newPage();
  await shadowPage.goto("https://shadow.example/join");
  await shadowPage.locator('#shadow input[type="email"]').focus();
  const shadowAX = await auto.newCDPSession(shadowPage);
  await waitNames(shadowAX, (n) => n.some((t) => t.includes("binding arbitration")));
  check(true, "a sign-up form in a dynamically attached open shadow root is detected");
  const iframePage = await auto.newPage();
  await iframePage.goto("https://iframe.example/join");
  await iframePage.frameLocator("iframe").locator('input[type="email"]').focus();
  const embedded = iframePage.frames().find((frame) => frame.url() === "https://embedded.example/join");
  const frameAX = await auto.newCDPSession(embedded);
  await waitNames(frameAX, (n) => n.some((t) => t.includes("binding arbitration")));
  const frameCache = await w.evaluate(async () => (await chrome.storage.local.get("docs:embedded.example"))["docs:embedded.example"]);
  check(frameCache?.documents?.every((d) => d.url.startsWith("https://embedded.example/")) && !calls.has("iframe.example/terms"), "a permitted cross-origin iframe reads and caches only its own site's policies");

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
      const p = auto.pages().find((x) => new URL(x.url()).pathname.endsWith("/popup.html") && !before.includes(x));
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

  // This site uses the same persistent queue as link scans. Delayed responses
  // make closing the viewer, cancellation and overlapping scans deterministic.
  let releaseSlow;
  let slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const requested = [];
  await auto.route("https://jobs.example/**", async (route) => {
    const url = route.request().url();
    requested.push(url);
    if (url.endsWith("/join")) return route.fulfill({ contentType: "text/html", body: '<h1>Join</h1><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a>' });
    if (!url.endsWith("/privacy")) await slowGate;
    return route.fulfill({ contentType: "text/html", body: `<h1>${url.endsWith("/privacy") ? "Privacy Policy" : "Terms of Service"}</h1><p>${TERMS}</p>` }).catch(() => undefined);
  });
  const jobsPage = await auto.newPage();
  await jobsPage.goto("https://jobs.example/join");
  const viewer = await auto.newPage();
  await jobsPage.bringToFront();
  await viewer.goto(`chrome-extension://${new URL(w.url()).host}/popup.html`);
  await viewer.getByRole("tab", { name: "This site" }).click();
  await viewer.getByRole("button", { name: /^Read jobs.example/ }).click();
  const scanJobs = () => w.evaluate(async () => Object.entries(await chrome.storage.session.get(null)).filter(([key]) => key.startsWith("scan:job:")).map(([, job]) => job));
  let firstJob;
  for (const until = Date.now() + 5000; Date.now() < until; await viewer.waitForTimeout(100)) {
    firstJob = (await scanJobs()).find((job) => job.plan.site === "jobs.example");
    if (firstJob?.state === "running") break;
  }
  check(firstJob?.state === "running", "This site starts a background scan");
  await viewer.close();
  releaseSlow();
  for (const until = Date.now() + 5000; Date.now() < until; await new Promise((resolve) => setTimeout(resolve, 100))) {
    if ((await scanJobs()).find((job) => job.id === firstJob.id)?.state === "complete") break;
  }
  const reopened = await auto.newPage();
  await reopened.goto(`chrome-extension://${new URL(w.url()).host}/popup.html?scan=${firstJob.id}`);
  const persistentText = await axText(reopened, "binding arbitration");
  check(persistentText.some((text) => text.includes("binding arbitration")), "This site finishes after its popup closes, and its report reopens");

  slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  await reopened.getByRole("button", { name: "Scan again", exact: true }).click();
  await reopened.getByRole("button", { name: "Cancel scan", exact: true }).click();
  await reopened.getByText("The scan was cancelled.", { exact: true }).waitFor();
  check(true, "a running scan can be cancelled from its viewer");
  releaseSlow();

  slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  await reopened.locator("#scan-address").fill("https://jobs.example/first-terms");
  await reopened.getByRole("button", { name: "Scan", exact: true }).click();
  await reopened.locator("#scan-address").fill("https://jobs.example/second-terms");
  await reopened.getByRole("button", { name: "Scan", exact: true }).click();
  const overlapping = (await scanJobs()).filter((job) => /first-terms|second-terms/.test(job.plan.url));
  check(overlapping.length === 2 && overlapping[0].id !== overlapping[1].id, "overlapping scans have separate saved requests");
  await reopened.close();
  releaseSlow();
  let completedJobs = [];
  for (const until = Date.now() + 5000; Date.now() < until; await new Promise((resolve) => setTimeout(resolve, 100))) {
    completedJobs = (await scanJobs()).filter((job) => overlapping.some((old) => old.id === job.id));
    if (completedJobs.every((job) => job.state === "complete")) break;
  }
  check(completedJobs.length === 2 && completedJobs.every((job) => job.state === "complete" && job.result?.fetched?.pages[job.plan.url]?.ok), "both overlapping scans finish after their viewer closes");
  check(await w.evaluate(() => chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] })), "scans preserve the site access held before they started");

  // Reader coverage: CSS visibility, client-rendered shadow roots, external
  // host opt-in, JavaScript controls and real local PDF parsing.
  const readerRequests = [];
  const arbitration = "Any dispute arising from these terms will be resolved by binding arbitration rather than in court.";
  await auto.route("https://reader.example/**", (route) => {
    const url = route.request().url();
    readerRequests.push(url);
    if (url.endsWith(".pdf")) return route.fulfill({ contentType: "application/pdf", body: Buffer.from(makePdf(`Terms of Service\n${arbitration}`)) });
    return route.fulfill({ contentType: "text/html", body: `<html lang="en"><head><style>.ghost { display:none }</style></head><body><h1>Membership information</h1><p class="ghost">We may use the content you upload to train our machine learning models and improve them.</p><div id="shadow"></div><button id="policy" type="button">Read privacy policy</button><script>
      const root = document.getElementById('shadow').attachShadow({mode:'open'});
      setTimeout(() => { root.innerHTML = '<p>${arbitration}</p><a href="https://legal.provider.example/privacy">Privacy Policy</a>'; }, 30);
      document.getElementById('policy').addEventListener('click', () => { document.querySelector('h1').textContent='Privacy Policy'; root.innerHTML='<p>We collect your email address and delete it when you close your account.</p>'; });
    </script></body></html>` });
  });
  await auto.route("https://legal.provider.example/**", (route) => {
    readerRequests.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: '<html lang="en"><h1>Privacy Policy</h1><p>We collect your email address and delete it when you close your account.</p></html>' });
  });
  const dynamic = await auto.newPage();
  await dynamic.goto("https://reader.example/dynamic");
  await dynamic.locator("#shadow a").waitFor();
  const visibleViewer = await auto.newPage();
  await dynamic.bringToFront();
  await visibleViewer.goto(`chrome-extension://${new URL(w.url()).host}/popup.html`);
  await visibleViewer.getByRole("tab", { name: "This site" }).click();
  check(await visibleViewer.getByRole("button", { name: "Find policy control: Read privacy policy", exact: true }).waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false), "discovers a JavaScript policy control without executing it");
  check(!readerRequests.some((url) => url.startsWith("https://legal.provider.example/")), "external policy hosts are not contacted before selection");
  await visibleViewer.getByRole("combobox", { name: "Visible document type" }).selectOption("terms");
  await visibleViewer.getByRole("button", { name: "Read visible policy", exact: true }).click();
  const renderedText = await axText(visibleViewer, "binding arbitration");
  check(renderedText.some((text) => text.includes(arbitration)), "manual visible-page reading finds client-rendered text in an open shadow root");
  check(!renderedText.some((text) => text.includes("We may use the content you upload to train")), "CSS-hidden text is excluded from the visible-page report");
  await visibleViewer.close();
  const externalViewer = await auto.newPage();
  await dynamic.bringToFront();
  await externalViewer.goto(`chrome-extension://${new URL(w.url()).host}/popup.html`);
  await externalViewer.getByRole("tab", { name: "This site" }).click();
  await externalViewer.getByRole("checkbox", { name: /Privacy: https:\/\/legal.provider.example\/privacy/ }).check();
  await externalViewer.getByRole("button", { name: "Read selected policies", exact: true }).click();
  await externalViewer.getByRole("button", { name: "Scan again", exact: true }).waitFor();
  check(readerRequests.includes("https://legal.provider.example/privacy"), "explicitly selected external policy hosts can be read");
  await externalViewer.close();
  await dynamic.locator("#policy").click();
  const controlViewer = await auto.newPage();
  await dynamic.bringToFront();
  await controlViewer.goto(`chrome-extension://${new URL(w.url()).host}/popup.html`);
  await controlViewer.getByRole("tab", { name: "This site" }).click();
  const controlText = await axText(controlViewer, "Privacy policy");
  check(controlText.some((text) => text.includes("Privacy policy") || text.includes("Privacy Policy")), "a policy opened by a JavaScript control can be read from its rendered tab");
  await controlViewer.locator("#main").getByText("Policy changes (local, optional)", { exact: true }).click();
  await controlViewer.getByRole("button", { name: "Keep policy versions on this device", exact: true }).click();
  await controlViewer.getByRole("button", { name: "Compare and remember this version", exact: true }).click();
  await controlViewer.getByText("First version at this URL; no earlier text to compare.", { exact: true }).waitFor();
  await dynamic.evaluate(() => { document.querySelector("#shadow").shadowRoot.querySelector("p").textContent = "We collect your email address and retain audit records for two years after closure."; });
  const comparisonViewer = await auto.newPage();
  await dynamic.bringToFront();
  await comparisonViewer.goto(`chrome-extension://${new URL(w.url()).host}/popup.html`);
  await comparisonViewer.getByRole("tab", { name: "This site" }).click();
  await comparisonViewer.getByRole("combobox", { name: "Visible document type" }).selectOption("privacy");
  await comparisonViewer.getByRole("button", { name: "Read visible policy", exact: true }).click();
  await comparisonViewer.locator("#main").getByText("Policy changes (local, optional)", { exact: true }).click();
  await comparisonViewer.getByRole("button", { name: "Compare and remember this version", exact: true }).click();
  await comparisonViewer.getByText("Removed:", { exact: true }).waitFor();
  check((await comparisonViewer.locator("body").innerText()).includes("Added:") && (await comparisonViewer.locator("body").innerText()).includes("Previous:"), "opt-in comparison displays exact removed and added policy paragraphs with dates and URL");
  await comparisonViewer.getByRole("button", { name: "Delete saved policy versions", exact: true }).click();
  await comparisonViewer.getByText("Saved policy text deleted; comparisons disabled.", { exact: true }).waitFor();
  check(await w.evaluate(async () => !(await chrome.storage.local.get("policyVersions")).policyVersions), "deleting saved policy versions removes retained policy text");
  await comparisonViewer.getByRole("button", { name: "Latest report", exact: true }).click();
  await comparisonViewer.getByRole("button", { name: "Check again", exact: true }).waitFor();
  check(await comparisonViewer.getByText(/Full document bodies are not retained/).isVisible(), "the latest saved quote report can be reopened and checked again");
  await comparisonViewer.close();
  await controlViewer.getByRole("tab", { name: "Scan a link" }).click();
  await controlViewer.locator("#scan-address").fill("https://reader.example/policy.pdf");
  await controlViewer.getByRole("button", { name: "Scan", exact: true }).click();
  const pdfText = await axText(controlViewer, arbitration);
  check(pdfText.some((text) => text === `“${arbitration}”`), `a real PDF is parsed locally into an exact sentence without its heading (${pdfText.some((text) => text === `“${arbitration}”`) ? "quoted" : pdfText.filter((text) => /PDF|Could not|arbitration/.test(text)).join(" | ")})`);

  // Stop the actual MV3 worker mid-download, then reopen its saved job.
  const recoveryViewer = await auto.newPage();
  await recoveryViewer.goto(`chrome-extension://${new URL(w.url()).host}/popup.html`);
  slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const workerControl = await auto.newCDPSession(jobsPage);
  const versions = new Map();
  workerControl.on("ServiceWorker.workerVersionUpdated", ({ versions: updates }) => { for (const version of updates) versions.set(version.versionId, version); });
  await workerControl.send("ServiceWorker.enable");
  await recoveryViewer.getByRole("tab", { name: "Scan a link" }).click();
  await recoveryViewer.locator("#scan-address").fill("https://jobs.example/recovery-terms");
  await recoveryViewer.getByRole("button", { name: "Scan", exact: true }).click();
  let recoveryJob;
  for (const until = Date.now() + 5000; Date.now() < until; await recoveryViewer.waitForTimeout(100)) {
    recoveryJob = (await scanJobs()).find((job) => job.plan.url === "https://jobs.example/recovery-terms");
    if (recoveryJob?.state === "running") break;
  }
  const version = [...versions.values()].find((v) => v.scriptURL === w.url() && v.runningStatus === "running");
  check(!!version && recoveryJob?.state === "running", "an unfinished scan is saved before worker termination");
  if (version && recoveryJob) {
    await recoveryViewer.evaluate(async () => {
      const cached = (await chrome.storage.local.get("docs:dismiss.example"))["docs:dismiss.example"];
      await chrome.storage.local.set({ "docs:expired.example": { ...cached, at: Date.now() - 8 * 864e5 }, "docs:fresh.example": { ...cached, at: Date.now() } });
      await chrome.storage.local.set({ scanResult: { fetched: { text: "legacy downloaded HTML" } }, scanPending: { url: "https://service.example/terms" } });
      await chrome.storage.session.set({ scanResult: { fetched: { text: "legacy session HTML" } }, scanPending: { url: "https://service.example/privacy" } });
    });
    await workerControl.send("ServiceWorker.stopWorker", { versionId: version.versionId });
    releaseSlow();
    await recoveryViewer.evaluate(() => chrome.runtime.sendMessage({ type: "scan:wake" }));
    let recovered;
    for (const until = Date.now() + 10000; Date.now() < until; await recoveryViewer.waitForTimeout(100)) {
      recovered = await recoveryViewer.evaluate(async (id) => (await chrome.storage.session.get(`scan:job:${id}`))[`scan:job:${id}`], recoveryJob.id);
      if (recovered?.state === "complete") break;
    }
    check(recovered?.state === "complete" && recovered.recoveries === 1, "a restarted service worker resumes its unfinished scan");
    const cacheAfterRestart = await recoveryViewer.evaluate(() => chrome.storage.local.get(["docs:expired.example", "docs:fresh.example", "automatic"]));
    check(!cacheAfterRestart["docs:expired.example"] && cacheAfterRestart["docs:fresh.example"]?.documents?.length && cacheAfterRestart.automatic === true, "worker startup deletes expired cached quotes while preserving fresh reports and settings");
    const legacyGone = await recoveryViewer.evaluate(async () => {
      const [local, session] = await Promise.all([chrome.storage.local.get(["scanResult", "scanPending"]), chrome.storage.session.get(["scanResult", "scanPending"])]);
      return !Object.keys(local).length && !Object.keys(session).length;
    });
    check(legacyGone, "worker startup deletes legacy shared scan payloads from local and session storage");
  }
  releaseSlow();


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

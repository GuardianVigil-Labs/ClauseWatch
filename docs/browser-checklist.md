# Real-browser checklist

Use this checklist on the packaged release candidate in Chrome and Firefox. Mark only checks actually performed. Public evidence must use invented examples and omit account details, private policy text, environment paths, addresses and machine identifiers.

`npm run smoke` uses Chromium, invented sites and routed responses. It covers setup, navigation, exact quotes, independent/recovered jobs, cancellation, shared permissions, automatic forms/frames/shadow roots, concurrent settings edits, simulated AI, PDF extraction, report downloads, diagnostic previews, saved reports, comparisons and storage cleanup. Its rule-download request is observed and routed; it is not a live-network or Firefox permission-prompt test. Menu handlers are exercised programmatically, not through a physical browser-menu click.

Native browser prompts, real menu gestures, built-in model availability, live-provider behaviour, text highlighting and printing still need manual validation. Edge smoke testing uses `SMOKE_CHANNEL=msedge` where available. Record a failure privately if it contains sensitive material; otherwise use an invented public reproduction.

## Load the build

1. In the repository, run `npm run build && npm run build:firefox`.
2. **Chrome:** open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, then pick the `.output/chrome-mv3` folder.
3. **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, then pick `.output/firefox-mv3/manifest.json`.
4. Pin ClauseWatch: click the puzzle-piece icon in the toolbar, then the pin next to ClauseWatch.

## 1. Reading a page

- [ ] Open five real sign-up or terms pages. On each, click the ClauseWatch button; on a sign-up page, click **Read <site>'s terms** (or privacy policy) and allow access to that site. The report lists findings, and every quote appears word for word in the document it names (open it and search with Ctrl+F).
- [ ] On a page with no terms link, the report says what it could not find, not that the site is fine.
- [ ] A link that cannot be read, such as a page that needs sign-in, shows that it could not be read, and why.
- [ ] The report never assigns a safety verdict, score or grade. A source quote or the notice “not found is not safe” is not a generated verdict.

- [ ] On a known service (any site in `rules/sites.json`), click the ClauseWatch button on its home page: it offers to read that service's terms and privacy policy, even where the page has no link to them.

## 2. Scan a link

- [ ] In the popup, open **Scan a link**, paste a terms address and click **Scan**. The browser asks for access to that one site, which closes the popup; allow it. Open ClauseWatch again: the result is waiting.
- [ ] Paste terms text instead of an address. It is read with no prompt.
- [ ] Paste a known service's home address. Both its documents are read.

- [ ] Start a linked-document scan from **This site**, close the popup while it reads, and reopen it: the report is available under recent scans.
- [ ] Start two scans before the first finishes: each keeps its own request and result.
- [ ] Cancel a slow scan: it stops, shows cancelled, and can be retried.
- [ ] Read with an individually granted site permission already held: it is still held after the scan.
- [ ] A redirect whose destination is hidden stops with an explanation; opening the final policy in a tab and choosing **This site** still works.

- [ ] Read a short policy, then manually read text whose heading is not recognised; the manual choice is labelled.
- [ ] Read a policy loaded by JavaScript inside an open shadow root. Hidden text must not appear as a quote.
- [ ] Discover a page policy control; focusing it must not click, submit or accept anything.
- [ ] Select an external policy host and grant access; it is read only after selection. Automatic mode must not fetch it.
- [ ] Scan a text-based PDF and verify its quoted sentences. Image-only or password-protected files show an explanation.
- [ ] Read Spanish and French policies: only the three declared pack topics are checked. Read an unsupported language: no topic results appear. Uncertain-language fallback is clearly labelled.

- [ ] Check a sale permission with an opt-out, renewal with a reminder, and an explicit exception after a denial. The full qualified sentence is quoted.
- [ ] “We will not change these terms without notice” is not shown as a changes-without-notice finding.
- [ ] Later matching sentences remain visible; **Show surrounding text** includes nearby qualifications without presenting them as new findings.
- [ ] A custom rule with a positive example shorter than eight words is rejected; a valid example saves and runs.
- [ ] Two settings pages add/import rules near the shared limit: the combined stored collection never exceeds 600 patterns. Invalid legacy rules are identified as not running.

## 2b. The right-click menu

- [ ] Right-click a link to a terms page and choose **ClauseWatch: check this terms link**. The browser asks for access to that site; allow it. The result opens.
- [ ] Select a clause of at least eight words, right-click and choose **ClauseWatch: check selected text**. The result opens with the clause quoted, if a rule matches it.

## 3. Automatic mode

- [ ] In Settings → **General**, turn **Automatic mode** on. The browser asks for access to all sites; allow it.
- [ ] Open a sign-up form and click into it. The card appears before you type anything.
- [ ] Repeat with email/password fields in sibling containers without a form, a dynamically attached open shadow root, and a permitted cross-origin iframe. The iframe's card and policy sources belong to its own site.
- [ ] Change a login password field's `autocomplete` to `new-password`, or make a CSS-hidden sign-up form visible, without adding fields. Focusing it shows the card.
- [ ] Navigate to a known sign-up route using `pushState`, `replaceState`, and back/forward without reloading. The card appears once for the route; login-only routes do not trigger it.
- [ ] Close a loading card before its download finishes. It stays closed after completion.
- [ ] Fail one policy download while the other succeeds. The failure shows a reason and **Try again**. Retrying or revisiting retries the failed document and reuses the successful document; a partial result must not quiet the site for a week.
- [ ] Open a known service's sign-up page (a `signup` address in `rules/sites.json`). The card appears when the page opens, and quotes no cookie-banner text.
- [ ] On the card, click **Don't show on this site**. Reopening the site does not show the card.
- [ ] Turn automatic mode off. Check that access to all sites is gone:
  - Chrome: `chrome://extensions` → ClauseWatch → **Details** → **Site access**.
  - Firefox: `about:addons` → ClauseWatch → **Permissions** (or **Permissions and data**).
- [ ] Keep an existing sign-up tab open while disabling mode or revoking access. Its card disappears and focusing its fields makes no automatic requests. An unfinished automatic read must not recreate its card. Enable mode again with access and verify detection resumes in the existing tab.
- [ ] Seed an expired `docs:` entry for a site that is never opened. Restart the worker or wait for its cleanup alarm; the stored quotes are deleted and fresh entries/settings remain.

## 4. AI help with your own key

- [ ] In Settings → **AI help**, choose **My own API key (OpenAI-compatible)**, fill in **API address**, **Model** and **API key**, then click **Save**. The browser asks for access to that address (Firefox also asks to send website content); allow it.
- [ ] Read a page, then click **Summarise the quotes (AI)**. Every selection is a complete sentence in its actual cited sources; **Show cited quotes** reveals the full evidence.
- [ ] Set AI help to **Off** and click **Save**. AI help is off again.
- [ ] Change the configured AI host, then its path, without entering a key. Each change clears the credential choice and refuses saving until a new key is entered or the saved key is explicitly selected. Check that only the selected credential reaches the selected endpoint; redirects must not forward it.
- [ ] Return an AI quote that drops an initial denial, a trailing condition, or a semicolon exception. It is rejected; the full source sentence preserves its exact original text. Generated explanations are omitted.
- [ ] Return a fabricated summary claim with a genuine citation number. It must not appear. Only complete sentences copied from the actual cited sources are shown, with full source quotes available.
- [ ] Read a document longer than 24,000 characters. Coverage and batch count appear before asking AI; a clause near the end can be found. No batch cuts a sentence; oversized sentences and unterminated fragments are visibly uncovered.
- [ ] Stall a model request (including its response body or built-in model creation). It times out after 90 seconds and offers **Retry AI request**. Cancel a request, then explicitly retry; completed analysis batches are reused within the open report.
- [ ] Close or replace the report, or change AI settings during a request. The request stops and late results do not modify the new report. AI remains off until explicitly enabled.

## 5. Your own rules

- [ ] In Settings → **Rules**, switch a rule off, then read a page where it matched before. That finding is gone.
- [ ] On the **My rules** tab, under **Add my rule**, enter a working pattern and one example of each kind, then click **Test and save**. It saves, and finds its sentence on a page.
- [ ] On the **Import** tab, click **Export my rules**, then **Reset rules to defaults** (it asks first, and removes your own rules), then **Import a rules file** with the exported file. Your rule is back.

## 6. Other browsers

Load the Chrome build the same way in each browser below, then repeat sections 1, 2b and 3:

- [ ] Edge (`edge://extensions`)
- [ ] Brave (`brave://extensions`)
- [ ] Opera (`opera://extensions`)
- [ ] Vivaldi (`vivaldi://extensions`)

## History, concurrent edits and retention

- [ ] Open two Settings pages. Add different custom rules together, then delete one while switching the other off. Both additions survive and the later actions preserve each other. Unsaved form drafts in the other tab remain intact.
- [ ] Display history containing a change older than thirty days, without scanning. No expired change badge appears. Changes to another document must not renew that badge.
- [ ] Read two different terms URLs under the same site. They establish separate baselines; changing the text at one URL marks only that document as changed. Repeat with different query/fragment identifiers.
- [ ] Expire a scan containing fetched HTML and in-place policy text while another job is waiting for permission. Its payload disappears even if origin bookkeeping must remain. A download finishing after expiry must not restore it.
- [ ] Restart the worker with obsolete local/session shared scan-result slots. They are deleted, while fresh independent jobs remain recoverable.
- [ ] Draft all three GDPR requests: each says one calendar month, with applicable extension/notification wording, rather than 30 days. CCPA drafts retain the separate 45-day period.

## Saved reports, exports and optional versions

- [ ] Open **Open persistent scan screen** and finish/cancel/retry a link scan there. Closing a view does not cancel its background job; the ten-minute job lifetime is visible.
- [ ] Reopen **Latest report**, confirm its original rules version/date and no separate body, then **Check again**. Reopening must not extend its seven-day lifetime. Pasted/selected text must not become the saved web report.
- [ ] Follow **Highlight quote in policy**. If unsupported or the source changed, copy and search the quote. Verify no guarantee of universal highlighting is made.
- [ ] Open **Save or print this report**. Check complete rule quotes, context, URLs, dates, rule version and coverage. Download the text and use the native print dialog. AI suggestions must not be silently included.
- [ ] Prepare diagnostics. Verify no policy text, quote, HTML, URL, account detail, setting or credential appears. No file is sent automatically; downloading requires an explicit action.
- [ ] With comparisons disabled, no full policy version is retained. Enable, explicitly remember a version, then compare a later scan of the same source. Verify exact added/removed paragraphs, URL and dates, including a no-change case and a different-source baseline.
- [ ] **Delete saved policy versions** removes text and disables comparisons. A stale comparison save from another open report must be rejected after deletion. Check the version/source/size limits and expiry of each retained version independently.

# ClauseWatch user guide

ClauseWatch shows what a policy says using exact quotes. It does not score a service or replace legal advice. These instructions describe the current source checkout; published builds may differ. See [the changelog](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/CHANGELOG.md).

## Install and set up

For source builds, follow [the README](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/README.md#build-and-load). Setup opens when the extension is installed. Settings can reopen it through **Sites → Run setup again**.

Choose whether to use AI help and when the extension should appear. AI is off by default. Automatic mode is preselected in setup but starts only after you choose **Done** and grant the browser's site-access request. Choosing click-only mode or denying that request leaves automatic mode inactive.

| AI choice | Policy text sent to an AI service |
|---|---|
| **No AI, rules only** | None. Rules run on the device. |
| **The browser's built-in AI** | None from ClauseWatch. The browser may need to download its model first. |
| **My own AI key** | Only what you explicitly ask to analyse or summarise, sent to the endpoint configured in Settings. |

Policy retrieval from the document host and signed-rules downloads are separate network requests regardless of the AI choice. See [privacy](PRIVACY.md).

## Reading and recovery

### Read this site

Open a service's page and click the toolbar icon. **This site** reads the visible page or offers its policy links. On known services, ClauseWatch uses the configured policy addresses. Grant site access when you choose to fetch them. Temporary scan access is released when scans no longer need it; access held before the scan is preserved.

A report shows exact findings, topics not found in the text checked, and any documents that could not be read. Review the source and coverage notices: an unrecognised clause, omitted topic or unread document is not evidence that a service is safe.

### Scan a link or paste text

Open **Scan a link**, enter the policy address, choose a document type if needed, and press **Scan**. **Paste terms text instead** reads pasted text locally without site permission. Paste and selection reads use at most the first 200,000 characters, with a truncation notice. Readable documents and quotes need at least eight words in the current rules configuration.

Link scans continue after the popup closes. Reopen a recent scan to see its progress, **Cancel scan**, or **Scan again**. **Open persistent scan screen** opens the same controls in a browser tab. Downloads and full scan results expire ten minutes after job creation and may be cleared earlier to make room; keeping the screen open does not extend that period.

### Recover a dynamic or protected policy

When a failed policy offers **Open terms policy and read this tab** or **Open privacy policy and read this tab**:

1. Open it in the browser, wait for its content and sign in yourself if required.
2. Open ClauseWatch on that policy tab.
3. In **This site**, choose **Visible document type**, then **Read visible policy**.

This reads the loaded page rather than making a separate cookie-free document request. Manual type selection bypasses document-name recognition, with a notice; it does not prove that the policy is complete. Open collapsed sections first. Common computed-hidden elements are excluded. Open shadow roots and slots are included; closed roots and iframe contents are outside this manual snapshot.

A **Find policy control** button focuses a discovered terms/privacy control. Activate it yourself, wait for the text or new tab, then read the visible policy. ClauseWatch does not sign in or click site controls for you.

### External policy hosts

Under **Policies on other sites (optional)**, select the policies you want to read, then grant access to the displayed hosts. Discovery alone does not fetch them. Automatic mode does not use this manual selection list; it reads only its page's own site or the known service's configured legal documents.

### PDFs

Scan the PDF address, or use **Read this PDF** when the extension recognises the address as a PDF. Extraction runs locally, with a 100-page limit, 200,000 extracted-character limit and 15-second deadline. Downloads still have the 2 MiB and 20-second limits. Image-only PDFs need a text version; password-protected PDFs must be opened by you and their text pasted or selected. Automatic cards direct PDF reading to the popup. No OCR or remote conversion service is used.

### Right-click menu

- **ClauseWatch: check this terms link** asks for access and reads the linked policy.
- **ClauseWatch: check selected text** checks the selection locally. Select at least eight words. The report labels selected text separately from a complete document.

## Verify findings and coverage

**Show surrounding text** is available for rule and AI findings. It shows bounded nearby source text; an older saved finding may have only its quote. Context is not an additional finding, and a topic label does not replace qualifications in the source.

**Highlight quote in policy** opens the source with a text-fragment hint. Support depends on the browser, page and the text still being present. Protected pages, dynamic content and PDF viewers may not highlight it. Copy the quote and search the source when needed.

| Language | Topic checks |
|---|---|
| English | The current English rule set: 19 bundled rules under 13 topics, plus applicable user rules and choices. |
| Spanish | Pack version 1: data sale, automatic renewal and arbitration only. |
| French | Pack version 1: data sale, automatic renewal and arbitration only. |
| Other detected languages | Coverage notice; English rules only, and topics are not listed as not found. |
| Uncertain language | A notice and default English checks; topics may be missed. |

Detection is an estimate, not translation. Manual document selection does not add language coverage. Spanish/French reads use their bundled pack instead of English or custom rules. See [rules](rules.md) for scope and limits.

## Automatic mode

Enable it in **Settings → General** and grant site access. It recognises email/new-password fields or consent checkboxes without reading field values. It also supports sibling field containers, open shadow roots and permitted web iframes. Each iframe reads its own site's policies once a sign-up field in it is focused; its report appears in the page's one card, not inside the frame. Closed roots and restricted or opaque-origin frames are unsupported.

On known sign-up URLs the card can appear without a form. Single-page-app navigation and relevant field/visibility changes are observed. A login-only form is not meant to trigger a sign-up card.

- **Try again** retries failed reads while reusing successful cached documents. Failures do not quiet a site for a week.
- A complete terms-and-privacy read quiets the site for a week and shows a dot on the toolbar icon. The toolbar can reopen the site's cached report and offer a fresh check.
- Closing a loading card keeps it closed for that route after reading finishes.
- **Don't show on this site** mutes the site. Use **Settings → Sites → Show again** to undo that choice.
- Turning automatic mode off, or removing its broad site access, stops already-injected scripts and pending automatic reads.

## Saved reports and policy changes

### Reopen a report

**Latest report** retains the most recently displayed web-policy report's quotes, context, sources, coverage and original rules version for seven days. It does not keep a separate full-document body. Reopening does not extend retention. **Check again** asks for permission for a fresh scan. Pasted and selected text are not archived as this saved web report; an oversized report may be omitted.

### Change badges

**Recently checked** keeps up to ten sites and fingerprints for up to twenty source documents per site. It compares the same document type and canonical URL, including query and fragment. A different address starts a separate baseline. A changed badge expires after thirty days from that document's change, including when history is displayed without another scan. The recent-site entry itself can remain until displaced by another site.

### Compare policy text

**Policy changes (local, optional)** is off by default. Enable **Keep policy versions on this device**, then use **Compare and remember this version** after a scan with full policy text available.

It keeps up to two versions per source, three sources total, with at most 100,000 characters per version and thirty-day retention per saved version. Pasted text, empty-body saved reports and oversized versions are not saved. The comparison shows exact added/removed paragraphs, source URL and read dates. It does not classify reordered or repeated paragraphs as edits, or interpret their legal significance. Different URLs retain separate baselines.

**Delete saved policy versions** removes the text and disables comparisons. Expired versions are cleaned when the worker starts and on its fifteen-minute tick, when the browser is running.

## Save, print and diagnose

**Save or print this report** previews a plain-text report with source URLs, read dates, rule version, coverage, rule findings and their context. Use **Download plain-text report** or **Print report**. AI suggestions are not included. Review quotes and full URLs before sharing; a source URL may contain private parameters.

**Export local diagnostics → Prepare diagnostic preview** shows result states, broad failure categories, coverage, counts and scan timing. It excludes policy text, quotes, HTML, URLs, settings and API credentials. Choose **Download diagnostics** only if you want a local file. ClauseWatch does not upload it or contact support automatically.

## AI help

The rules always run first. AI controls appear only after AI help is enabled in Settings.

- **Look for clauses the rules missed (AI)** checks documents whose full text is available in the open report. Accepted findings are complete source units, preserving source wording, conditions and negation. Generated explanations are omitted. The topic remains an AI suggestion that can be wrong.
- **Summarise the quotes (AI)** selects up to four complete source sentences from the actual cited quotes. It rejects paraphrases and unsupported claims, even with valid citation numbers. **Show cited quotes** displays their full supporting text. It is a selection, not full document coverage.

Coverage and batch count appear before analysis. Long documents use sequential batches of at most 24,000 source characters, with sentence overlap where it fits. Oversized sentences and unterminated fragments are omitted and coverage is shown. A batch being submitted does not guarantee the model finds every relevant clause.

Each request has a 90-second deadline. **Cancel AI request** stops the request and later batches. **Retry AI request** resumes unfinished analysis batches within the open report; summary retries can resend their inputs. Closing or replacing the report cancels requests and discards temporary analysis checkpoints. Built-in model sessions are destroyed on completion or cancellation.

In **Settings → AI help**, choose a model and endpoint for your own key. Changing the API address or path clears its credential selection. Enter a new key or explicitly choose the saved key for the new destination before saving. Requests refuse binding mismatches and do not follow redirects. Changing AI settings cancels requests in open reports; reopen the report to use the new settings. Endpoint query strings, fragments and embedded credentials are not accepted.

## Rules, sharing and data requests

**Settings → Rules** offers **ClauseWatch rules**, **My rules** and **Import**. Test and save uses the real scanner and minimum quote length. All saved custom rules, including disabled ones, share the 200-rule and 600-pattern limits. Skipped rules are identified. Concurrent Settings pages submit individual edits through the background queue. See [rules](rules.md).

**Copy quote & share** copies the quote, source and project link. The popup's **Share** menu shares the ClauseWatch project link. You choose where to send either; the extension does not send messages for you.

**Ask them to delete my data** drafts an erasure, access or account-closure request. Review its recipient and account details, then send it through your own email program. GDPR drafts use “without undue delay” and one calendar month, with permitted-extension and notification wording. CCPA drafts use a separate 45-day period. A template does not determine which law applies to a particular request.

## Limits and troubleshooting

| Problem | What to try |
|---|---|
| Document name not recognised | Choose Terms or Privacy manually, then read it; confirm that it is the actual policy. |
| Scripts, a bot check or sign-in hide the policy | Open it yourself, complete the site's steps, then use **Read visible policy**. |
| An external host or a redirect to another site is refused | Open the final policy URL yourself and scan that address or its visible tab. |
| Image-only or password-protected PDF | Obtain an accessible text version or paste/select text after opening it yourself. |
| Request timeout or excessive size | Open the policy directly, or read/select the relevant visible text. Partial downloads are not reported as complete policies. |
| No highlight | Copy the quote and search the source. |
| AI request fails | Check Settings and the selected credential, then use explicit retry. Saved quote reports have no full body for new-document AI analysis. |
| Expired scan or missing saved report | Run a fresh scan; retaining a screen does not extend its data lifetime. |

Address checks reject IP literals and recognised local/private hostnames; they do not perform DNS-level private-network validation. Browser network protections still apply. Downloaded HTML cannot verify visibility that depends on external styles or scripts; those reports are labelled. Banner filtering uses structural heuristics and is not a guarantee that every banner is excluded. Manual tab snapshots do not traverse iframes, even though automatic form detection can run inside permitted frames.

Firefox permission prompts, plain-HTTP addresses, custom ports, model availability and browser text highlighting need testing in the target browser. Do not assume Chromium test results cover every Firefox or mobile behaviour. Full data handling is described in [privacy](PRIVACY.md).

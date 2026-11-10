# Changelog

All notable changes to ClauseWatch. Versions follow [semantic versioning](https://semver.org/).

## [Unreleased]

These changes describe the source checkout and are not a published release.

### Reading and scan reliability

- Run link, This site and menu scans as independent recoverable jobs with immutable targets, progress, cancellation, retry and a persistent-tab launcher.
- Finish downloads after the popup closes, recover worker interruptions, preserve prior/shared permissions and expire full scan payloads after ten minutes. Scrub expired content independently of permission release and remove obsolete shared scan-storage slots.
- Bound downloads to 20 seconds and 2 MiB, validate visible redirects before following them, and explain hidden redirects and other failures with recovery paths.
- Read short policies and more agreement names; allow explicit type choice and rendered-tab reading with visibility notices, open shadow roots and user-operated policy controls.
- Extract text-based PDFs locally in a bounded worker, explaining password-protected, image-only and oversized documents. Ship dependency licences.
- Offer selected external policy hosts with permission, and use the bundled Public Suffix List for site boundaries.
- Add limited Spanish and French recognition and version-1 packs for data sale, automatic renewal and arbitration; label unsupported and uncertain coverage.

### Findings and automatic mode

- Prepare bundled English rules version 4, narrowing negations and preserving sale exceptions, opt-outs and renewal disclosures with reminders.
- Retain later matches, supported list statements, exact source context and qualifications. Add browser-supported quote highlighting and surrounding-text controls for rule and AI findings.
- Stop already-injected automatic scripts, cards and downloads when mode/access is disabled. Keep dismissed loading cards closed after completion.
- Detect sibling signup fields, relevant attribute changes, SPA routes, open roots and permitted web frames, with frame-specific policy access. Show failures and retry only unfinished policy reads; complete terms-and-privacy reads alone quiet a site for a week.

### Settings, history and report tools

- Validate custom rules through the actual scanner, preserve scope on copy/import, enforce combined saved-rule budgets and show skipped rules. Serialize fresh-storage edits from concurrent Settings pages.
- Compare history fingerprints only for the same document kind and source URL, and expire individual change badges on display. Legacy kind-only fingerprints establish new baselines.
- Retain a bounded latest web-policy quote report for seven days with its original rule version and Check again.
- Add opt-in, bounded local policy versions and exact paragraph comparisons with URLs/dates, deletion controls and thirty-day cleanup.
- Add previewed plain-text/print report exports and local diagnostics excluding policy text, URLs, settings and credentials.
- Use calendar-month GDPR response wording with permitted-extension notification, keeping CCPA's separate period.

### Optional AI

- Require complete source units, restore original spacing and omit ungrounded generated explanations.
- Make summaries extractive: every selected sentence must occur in every actual cited source. Valid citation numbers alone do not admit generated claims.
- Require endpoint-specific credential selection, bind saved credentials to their destination and refuse redirects.
- Add request deadlines, cancellation, explicit retry and cleanup on report/settings changes.
- Replace silent truncation with visible coverage and sequential 24,000-source-character batches, retaining completed analysis batches only within the open report.

### Documentation

- Reconcile user, developer, reader, privacy and release guidance with current workflows, language coverage, storage limits and public contribution requirements.

## [1.0.0] — 2026-10-23

First public release: a free, open-source extension with no account and no server of its own.

- Reads a service's terms of service and privacy policy on the device and quotes the sentences that matter, under 13 topics, with 18 open, signed detection rules. Quotes from the documents, not legal advice.
- Known sites: about 45 popular AI and software services with the exact addresses of their terms and privacy policy (`rules/sites.json`), used by the popup, Scan a link and automatic mode, which shows its card when a known sign-up page opens.
- The right-click menu: **ClauseWatch: check this terms link** and **ClauseWatch: check selected text**.
- Click mode and an optional automatic mode for sign-up pages, chosen in first-run setup; per-site quiet.
- Scan a link: a terms address, any address on a known service, or pasted text.
- Rules and known sites update once a day from this repository's signed GitHub releases; a release is used only if it verifies against a pinned key and is newer.
- Optional AI help (the browser's built-in model or your own key): findings must quote the document exactly; a summary written only from verified quotes.
- Data requests (GDPR, CCPA) drafted on the device and sent from your own email.
- Sharing a plain link or a quote, with no tracking.
- Chrome, Edge, Firefox and Opera; Brave and Vivaldi from the Chrome Web Store.

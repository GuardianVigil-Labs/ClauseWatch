# Store listing and disclosures

Draft text for the current source checkout. Before submitting a release, verify it against the packaged version, the [privacy policy](PRIVACY.md) and [browser checklist](browser-checklist.md). Updating this file does not publish a store listing or privacy website.

## Single purpose

Show what a service's terms and privacy policy say, quoted, at sign-up.

## Short description

See what a site's terms and privacy policy say before you sign up: AI training, arbitration, data sale. Quoted, never scored.

## Long description

ClauseWatch reads terms and privacy policies on your device and shows exact source quotes. The English pack contains 19 rules under 13 topics, including data sale, automatic renewal, AI training on uploaded content, arbitration, content licences and changes without notice. Initial Spanish and French packs cover three topics each: data sale, automatic renewal and arbitration. Unsupported or uncertain language coverage is labelled.

Click the toolbar icon to read a policy or its links, scan an address, paste/select text, or enable automatic sign-up detection with site access. Known services have configured terms and privacy addresses. A rendered-tab fallback helps with pages loaded by JavaScript or after sign-in; text-based PDFs are extracted locally.

Background scans have progress, cancellation and retry, with a persistent scan tab. Findings offer nearby context and browser-supported source highlighting. The latest web-policy quote report can be reopened. Optional full-text policy comparisons are off by default and stored only on the device. Plain-text/print reports and diagnostic previews can be exported by the user; nothing is sent to support automatically.

“Not found” is not “safe”. A topic label is not a legal interpretation, and wording outside a pack's coverage can be missed. Documents that cannot be read show a reason and recovery path. ClauseWatch never gives a service score. Quotes from the documents, not legal advice.

AI help is optional and off by default. A built-in model works on the device; using your own key sends the requested text to the service you select. AI findings must preserve complete source units, and summaries select sentences from actual cited quotes. Cancellation, request deadlines and explicit retries are available.

Free and open source, with no account, advertising or telemetry service. Downloaded English rule/known-site updates are signature-verified; bundled language packs ship with the extension.

## Permission justifications

| Permission | Purpose |
|---|---|
| `activeTab` | Read the clicked page or selected text after a toolbar/menu action. |
| `scripting` | Capture page/selection text and run automatic detection on permitted sites. |
| `contextMenus` | Link and selected-text commands. |
| `storage` | Settings, own rules, accepted signed updates, quote reports/history, optional full-text comparison versions and temporary scan jobs. |
| `alarms` | Fifteen-minute rule-refresh/retention tick and a one-minute scan wake/expiry alarm. Rules download at most daily. |
| Required access to `github.com` and `release-assets.githubusercontent.com` | Download the public signed English rule/known-site release. GitHub can redirect to release-asset storage; no visited-site list, application account identifier or cookies are added. |
| Optional HTTP(S) host access | Requested for chosen policy hosts (including approved external legal hosts), broad automatic-mode operation, or the user's configured AI service. Scan-added access is released when no longer needed; prior access is preserved. Automatic access is requested only when enabled. |

The manifest requires Chrome 137 or later, Firefox 140 or later and Firefox Android 142 or later. Minimums reflect signature-verification and Firefox disclosure requirements, not a claim that every optional browser feature is available on each device.

## Data use and retention

Policy downloads omit cookies and are processed locally. Reading a loaded policy tab uses the browser's existing page; the site may already have its own sign-in session. ClauseWatch has no telemetry service and does not maintain a general browsing history. Document hosts, GitHub and any chosen AI service can observe ordinary requests to them.

Automatic quote caches and the latest slim web report have seven-day validity. Temporary session scan payloads can contain HTML/text/PDF data and expire ten minutes after creation, with cleanup on worker wake/alarm and at session end. Recent-site fingerprints retain up to ten sites and twenty source identities per site; change badges expire after thirty days. Opt-in policy versions retain up to two full texts per source, three sources, at most 100,000 characters each, for thirty days. Cleanup resumes when the browser runs. Full details: [PRIVACY.md](PRIVACY.md).

With an external AI key, summary inputs contain verified quotes; document analysis can send the full eligible text across multiple batches of at most 24,000 source characters each. Coverage appears before sending. The key is tied to the selected endpoint, and endpoint/path changes require credential selection. Requests refuse redirects and have a 90-second deadline. Provider data use is governed by that provider's terms; ClauseWatch does not claim the provider never stores or trains on requests.

Report exports include quoted text and full source URLs, dates, rule version and coverage; users review and share them themselves. Diagnostic exports exclude policy text, quotes, HTML, URLs, settings and credentials. Optional comparison text and exports are not uploaded by ClauseWatch.

**Chrome disclosure:** website content is processed for the feature requested by the user and sent externally only when that user chooses an external AI service or shares an export. ClauseWatch uses no Google APIs. Its own handling is not for advertising, lending or model training; provider terms remain separate. Reconcile all store disclosure fields with the submitted package.

**Firefox disclosure:** the manifest declares required `none` and optional `websiteContent` for external AI help. The extension requests website-content consent with the configured service's host access on supported Firefox versions. Test the prompt and declaration in the release build before submission.

## Listing assets and public links

`docs/store/` contains screenshots, a promotional tile and an Edge logo. The screenshots use invented example pages and illustrate the earlier interface; they do not establish that every current control or browser flow was validated. Review or replace them against the packaged release before submission. Do not use account pages, internal hostnames, private documents or machine metadata in new captures.

- Support: clausewatch@guardianvigil.io
- Public privacy page: https://guardianvigil.io/clausewatch/privacy/
- Source: https://github.com/GuardianVigil-Labs/ClauseWatch

Apache-2.0 covers the code. Project names and the shield mark have separate [trademark terms](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/TRADEMARKS.md).

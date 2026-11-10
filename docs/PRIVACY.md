# ClauseWatch privacy policy

Last updated 9 November 2026.

This document describes data handling in the current source checkout. Consult the release notes for the version you use. The public project privacy page is https://guardianvigil.io/clausewatch/privacy/; editing this repository does not update that website or a store listing by itself.

## Network activity

ClauseWatch has no account system, advertising or telemetry service. It does not upload diagnostic reports automatically. Its network activity consists of:

| Activity | Destination and data |
|---|---|
| Reading a policy | The document host receives a request for the selected URL. Extension downloads omit cookies. Reading a policy already open in a tab uses the page's loaded text; the site's ordinary browser session is separate. |
| Updating rules | GitHub receives a request for the public signed-rules release, at most daily. The extension adds no account, identifier or visited-site list, and omits cookies. |
| Optional AI with your key | The configured AI endpoint receives the text you explicitly ask it to analyse or summarise, using the credential selected for that endpoint. |

Hosts can observe ordinary network-request information. With the browser's built-in model, policy processing stays on the device; the browser may first download model files. ClauseWatch does not send form-field values, passwords, cookies or a general browsing history to an AI service.

## Reading pages

Policy reading is initiated through the toolbar, a selected policy link, pasted or selected text, or automatic mode after you enable it and grant site access. Automatic mode recognises form structure, including permitted web frames and open shadow roots, without reading field values. Each frame reads policies for its own site. Turning the mode off or removing broad access stops already-injected automatic scripts and pending automatic reads.

Downloaded HTML is processed locally. Rendered-tab reading uses content already loaded by the browser; sign-in and page controls remain the user's responsibility. PDF text extraction runs locally without a conversion service or OCR upload.

## Local storage and retention

Data is kept in browser extension storage, not browser sync storage. Removing the extension removes its extension storage. The following limits describe normal retention; data can be removed earlier to make room or when settings change.

| Data | Contents and retention |
|---|---|
| Settings and own rules | Preferences, disabled rule IDs, custom rules/examples, muted sites, optional AI configuration and any user-entered API key. Kept until changed, reset where supported, or the extension is removed. |
| Signed rule update | The downloaded signed file and update-check metadata. The signature is checked before use; a newer accepted update replaces it. |
| Automatic policy cache | Source URLs, quotes, bounded nearby context and report metadata, without a separate full-document body. Valid for seven days and only with the rules configuration used to read it. Retrying partial reads does not extend the cached timestamp. |
| Latest web-policy report | The most recently displayed report's quotes, nearby context, URLs, coverage, original rules version and save time. Limited to 256,000 characters and seven days. Reopening does not renew it. Pasted and selected text are excluded. |
| Recently checked sites | Up to ten sites, with text fingerprints and hashed identities for up to twenty source documents per site. A source identity includes document type and canonical URL. These entries remain until displaced; their change badges expire after thirty days. The history does not retain full policy text. |
| Manual scan jobs | Requested URLs, permission bookkeeping, any in-place document text, downloaded HTML/text/PDF checkpoints and results in `storage.session`. Payloads expire ten minutes after creation and also disappear at the end of the browser session. Cleanup prunes finished, released jobs to eight; shared payload-budget checks can remove older content early. Active jobs and unreleased permission bookkeeping are handled separately. |
| Optional policy versions | Only after enabling comparisons and explicitly remembering a version: full policy text, source URL, type and date. At most 100,000 characters per version, two versions per source and three sources, for thirty days per version. Pasted text and oversized versions are excluded. |
| AI analysis checkpoints | Completed batch markers and verified findings in the open report's memory, for explicit retry. They are not persisted and are discarded when the report closes or is replaced. |

Bounded excerpts and quotes may cover all of a very short policy. “No separate full-document body” does not mean a report contains no policy text.

Expired automatic caches and saved reports/versions are removed on access where supported, at worker startup and on its fifteen-minute cleanup tick. Expired scan payloads are scrubbed on worker wake and the one-minute scan alarm, independently of permission release. A running scan has an expiry deadline and cannot checkpoint a late download. Minimal origin bookkeeping can remain until shared temporary access can be released. Cleanup resumes when the browser next runs. Obsolete shared scan-result and pending-scan slots from earlier versions are removed during worker startup.

Only a successful read of both terms and privacy quiets a site for a week. Incomplete reads remain retryable. **Delete saved policy versions** removes comparison text and disables comparisons; an earlier in-flight save cannot bypass the comparison-generation check after that change.

## Optional AI help

AI is off by default. If you choose your own key, the configured provider processes requests under its own terms, including retention and training practices:

- **Summarise the quotes** sends the verified quotes used as input to the summary, in bounded batches. Quotes exceeding the per-batch limit are omitted.
- **Look for clauses the rules missed** sends eligible document, pasted or selected text in sequential batches of at most 24,000 source characters. For a long document, multiple requests can send the full eligible text, not just its beginning. Coverage and omissions appear before analysis.

No account identifier or browsing-history field is added to these prompts. The text you choose to analyse may itself contain personal information; review it and the provider before sending it.

The API key is stored on your device and sent in authorization to the selected endpoint. Changing the API address or path requires an explicit credential choice. Requests refuse binding mismatches and redirects, have a 90-second deadline, and can be cancelled. Retry is an explicit action. This does not promise that a provider erases a request it already received. Changing AI settings cancels requests in open reports.

## Exports and messages

**Export local diagnostics** creates a preview containing result states, broad failure categories, language/coverage, aggregate counts and scan timing. It excludes policy text, quotes, HTML, URLs, settings, account details and API credentials. A local download happens only when requested; ClauseWatch does not send it to support.

Plain-text and printable report exports deliberately include rule quotes, context, full source URLs, dates, rules version and coverage. AI suggestions are not included in that export. A source URL may contain private parameters. Review exported text before sharing it. Exported files, printed copies, clipboard contents and files you share are outside the extension's cleanup controls.

Data-request letters are drafted locally. Review the recipient and account details, then send through your own email program. ClauseWatch does not send the letter. Sharing controls copy text or open the destination you choose; they do not add tracking identifiers.

## No telemetry or general browsing tracking

ClauseWatch does not collect user accounts, send analytics or crash reports, sell personal data, or use it for advertising. It keeps the limited checked-site history described above on the device; it does not use that history to track browsing across services. Optional AI providers and destinations you choose to share with have their own policies.

## Changes and contact

The repository history records changes to this policy. Release maintainers must reconcile the policy supplied with a build, the public website and store disclosures before publishing.

Privacy and security contact: clausewatch@guardianvigil.io. Security-reporting instructions: [SECURITY.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/SECURITY.md).

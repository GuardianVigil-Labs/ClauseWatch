# Architecture

ClauseWatch is a Manifest V3 extension written in TypeScript and built with WXT. It has no application server. This document describes the current source checkout; see [development](development.md) for setup and checks, and [the reader contract](reader.md) for extraction and matching details.

## Entry points and ownership

| Entry point | Responsibility |
|---|---|
| `entrypoints/background.ts` | Signed-rule refresh, runtime content-script registration, permission-scoped downloads, scan recovery/expiry, menus and serialized settings/version edits. |
| `entrypoints/popup/` | Toolbar and persistent-tab views; policy discovery, rendered snapshots, HTML/PDF interpretation, report tools, saved reports and recovery controls. |
| `entrypoints/options/` | General, AI, Rules, Sites, Privacy and About settings. Rule changes are operations sent to the background rather than writes of stale UI snapshots. |
| `entrypoints/welcome/` | Setup choices; automatic mode starts only after its permission grant. |
| `entrypoints/signup.content.ts` | Automatic form recognition and a protected page card. It reads structure, never field values. |
| `entrypoints/signup-frame.content.ts` | In frames: asks for the reader once a sign-up field is focused. |

The worker cannot parse HTML with a page DOM. It downloads and checkpoints bytes/text; the report view parses completed results. A job marked complete therefore means downloads finished, not that every document was successfully recognised. Per-document results distinguish these cases.

## Reading pipeline

1. `documents.ts` and `known-sites.ts` identify policies from configured known sites or discovered page links. Same-site checks use `tldts` with the Public Suffix List, including private hosting domains. Manual external candidates require selection and host permission; discovery does not fetch them.
2. `src/auto/background.ts` bounds downloads to 2 MiB and a 20-second deadline covering headers and body. It omits cookies and lets the browser follow redirects (browsers hide a redirect's destination from extension code until it has been followed), then checks the final address before reading the answer. Same-site or explicitly configured known-service legal domains are allowed; any other final address, or a redirected answer without a visible address, is refused unread. Intermediate redirect hops are requested by the browser without cookies and are not inspected. Address checks reject IP literals and recognised local names, not arbitrary public names resolving to private addresses.
3. `document.ts` parses downloaded HTML with scripting off, applies structural visibility/banner filters, builds text blocks and records code-point offsets. Downloaded HTML has no computed external stylesheet or JavaScript state; its report carries a visibility notice.
4. `rendered.ts` captures loaded tab text, computed visibility, open shadow roots and assigned slots without input values or page code. It bounds traversal and output, reports truncation, and does not traverse iframe contents or closed roots. Policy-control discovery offers focus for user activation, not automatic clicks.
5. `pdf.ts`, `pdf-text.ts` and `pdf.worker.ts` decode bounded PDF bytes with bundled PDF.js. A disposable worker has no remote document URL, a 15-second limit, a 100-page limit and a 200,000-character output cap. Image-only, password-protected and malformed PDFs return errors. Automatic cards direct PDF reading to the report view.
6. Identity checks require enough readable words and a recognised policy name, unless the user explicitly chooses the type. A manual type notice does not certify completeness. `language.ts` estimates language; `language-packs.ts` selects the applicable rule set.
7. `rules.ts` finds every matching eligible sentence, plus supported bounded list-introduction/item matches, with exact quotes and nearby context. Reports deduplicate identical same-category spans without removing later distinct matches. A label is not a legal paraphrase.

## Rules and language packs

English rules and known sites are bundled from `rules/rules.json` and `rules/sites.json`. English updates are accepted only after Ed25519 signature verification, version checks, pattern compilation and known-site validation. `rules-update.ts` stores the signed envelope and verifies it again before use. A failed download or invalid update keeps the usable rules already available.

Spanish and French packs are bundled separately from `rules/es/` and `rules/fr/`. Each is version 1 with three categories: data sale, automatic renewal and arbitration. When the text itself is confidently identified as Spanish or French, the pack replaces the English/custom matching set. When the language rests only on the page's `lang` attribute or a wording guess, the English rules run alongside the matching pack. They are not independently downloaded signed packs. Text confidently identified as another language is checked with the English rules, and its report does not list topics as not found; uncertain language uses the English rules with a notice. Pack version and reader-profile changes must invalidate automatic cached reads.

All patterns pass `pattern-check.ts`; official patterns also have hostile-input timing checks and JavaScript/Go fixtures. Custom patterns are compiled with RE2JS before they are considered runnable. `rule-set.ts` combines English rules with disabled IDs and validated custom rules, surfacing malformed, duplicate and over-budget entries as skipped.

`rules:edit` messages from extension pages enter one background promise queue. Each operation reads fresh storage, validates examples with the real scanner and enforces the combined 200-rule/600-pattern budget, including disabled rules. Add/import is validated before writing; delete and toggle use IDs. The queue avoids one Settings page replacing another's whole collection.

## Scan jobs and permissions

`src/scan/jobs.ts` owns independent job records in `storage.session`. `client.ts` saves a plan and permission snapshot before starting the browser's permission prompt. Each plan retains the original targets, candidate groups, explicit document choice and known-site data; a later rules update cannot silently move an unfinished request to different URLs.

The worker wakes on job/permission changes, startup and a one-minute alarm. It attempts permitted jobs, checkpoints completed downloads, and can recover a running job up to three times after worker interruption. Fetch cancellation propagates through `AbortSignal`. Closing the popup does not cancel the job; it removes only the view. A persistent tab uses the same viewer and job store.

Jobs expire ten minutes after creation. A running job has a deadline; expired results, downloaded checkpoints and in-place bodies are scrubbed even when permission release is blocked by another job. Permission bookkeeping can remain until access is no longer borrowed. Completed, released expired jobs are removed. Cleanup prunes finished, released jobs to eight records. Shared serialized-character budget checks can reject oversized scans or clear older finished payloads early; active jobs and unreleased permission bookkeeping are handled separately.

Origins held before a scan are preserved. Access another unreleased scan added counts as temporary, not held, in the permission snapshot. Newly requested origins are removed only inside the job queue, once no active job uses them; a job is marked released after its access is removed, and a failed removal is retried. Broad automatic-mode permission is handled separately. Obsolete `scanResult`/`scanPending` slots from pre-job versions are removed from local and session storage during worker initialization.

## Automatic mode

The runtime scripts are registered only while the automatic preference and broad access are present. The reader runs in top frames. Frames get a small script that, when a sign-up field is focused there, asks the background to add the reader to that frame only. A frame shows no card itself: its report is sent to the top frame, which shows one card per tab and keeps its own page's card over a frame's. Each frame is scoped by `sender.url`, not the embedding tab's URL. Fetch and cache messages are checked again in the background.

The content script checks a form when a field is focused, including inside open shadow roots attached at any time; it does not watch or walk the page. In the top frame, a one-second address comparison detects History API navigation. It handles sibling field wrappers, consent controls, and known sign-up routes, while excluding ordinary login-only forms and hidden fields.

Disabling mode or removing access aborts automatic downloads and tells injected scripts to remove cards, observers, focus handlers and timers. Generation checks reject stopped-session or previous-route completions. Closing a loading card dismisses it for the current route, so a late result cannot recreate it.

Only successfully read terms and privacy documents quiet a site for a week. Partial reports reuse successes and retry failures. Reuse preserves the original cache timestamp. Rule/configuration changes invalidate automatic caches. Muted sites remain quiet until unmuted.

## Reports, history and comparisons

`report.ts` renders source quotes, qualification text, coverage and surrounding excerpts. Source highlighting uses browser text-fragment navigation and is best effort. `report-tools.ts` creates plain-text/print previews and diagnostics. Report exports include source URLs and quotes; diagnostic exports use only result states, broad error categories, counts, coverage and timing, excluding text, URLs and settings. Neither is uploaded automatically.

`Latest report` saves the last displayed web-policy report as quotes/context with its original rules version, not a separate body. It is bounded to 256,000 characters and seven days, excludes pasted/selected text, and does not renew when reopened. Automatic cached reports can also be reopened for their site. Fresh checks ask for access again as needed.

History uses SHA-256 text fingerprints keyed by a hash of document kind and full canonical URL, including query and fragment. It keeps ten sites and twenty document identities per site. Different source URLs establish separate baselines. Legacy kind-only hashes do not establish revisions. Per-document change timestamps are filtered on display, so badges expire after thirty days without another scan; the recent-site record itself has no age-based expiry.

Full-text comparisons require opt-in and an explicit remember action. Up to two versions per source and three sources are stored, capped at 100,000 characters per version and thirty days per version. Comparison reports exact added/removed paragraphs; reordering and duplicates are not treated as edits. Only the text of a policy document read from a web address is kept; pasted and right-clicked selected text never is. Every write to saved versions, their expiry cleanup included, runs in one background queue (`versions:edit` and the cleanup tick), and a generation check makes disabling/deleting versions reject stale saves.

## AI help

`src/ai/assist.ts` uses either a browser-native model or an OpenAI-compatible endpoint after opt-in. `settings.ts` validates the full endpoint, including path. New saved key settings carry an endpoint binding; changing the destination requires credential selection. Legacy valid settings can use their existing configured destination until edited. Requests refuse redirects and binding mismatches.

`source.ts` forms conservative complete source units, retaining semicolons, wrapped lines, abbreviations and immediate qualifications. `validate.ts` restores exact source spacing and accepts only complete eligible units, dropping generated explanations. Topic suggestions remain fallible. `summary.ts` checks every selected sentence against every actual cited source; a real citation number alone is insufficient. Verdict filtering remains an additional check. These are extractive grounding constraints, not general semantic entailment or legal interpretation.

Document and summary inputs are batched, without cutting source sentences/quotes, at a 24,000-source-character limit. Coverage and omissions are shown before analysis. Requests have a 90-second deadline and bounded responses. Cancellation covers creation, headers and body; built-in sessions are destroyed, including late creation after cancellation. `src/ui/ai.ts` keeps completed analysis batches in open-report memory for explicit retry and aborts requests when reports close, are replaced, or AI settings change. Summary retries can resend inputs. No AI checkpoint is persisted.

## Storage and cleanup

| Area | Main keys and owner |
|---|---|
| Local settings | `automatic`, `ai`, `ownRules`, `disabledRuleIds`, `mutedSites`; settings UI with background ownership for rule edits. |
| Rule updates | `rules:update`, `rules:checkedAt`; rule-update module. |
| Automatic reports | `docs:<site>`; background validates the current read key and trims separate body text. |
| Latest report | `latestReport`; report view writes a bounded slim report. |
| Recent-site fingerprints | `recentSites`; report/history helpers. |
| Opt-in full-text versions | `policyVersions`, `policyVersionsEnabled`, `policyVersionsGeneration`; serialized background edits. |
| Session jobs | `scan:job:<id>`, `scan:focus`; job worker and viewer. |

`src/storage-retention.ts` cleans saved reports and each saved version; automatic cache cleanup lives in `src/auto/background.ts`. They run at startup and the fifteen-minute tick, with access-time cleanup where implemented. Scan payload cleanup runs independently on wake and a one-minute alarm. Cleanup resumes when the browser runs again. No data uses browser sync storage. See [privacy](PRIVACY.md) for retention and export details.

## Permissions and checks

| Permission | Purpose |
|---|---|
| `activeTab`, `scripting` | Read the clicked tab/selection and run permitted automatic scripts. |
| `contextMenus` | Link and selection commands. |
| `storage` | Local settings/reports and temporary session jobs. |
| `alarms` | Rule-refresh scheduling and retention/job cleanup. |
| Required GitHub hosts | Signed-rule download only. |
| Optional HTTP(S) hosts | User-chosen scan hosts, broad access for automatic mode, or the configured AI service. |

`wxt.config.ts` removes runtime-script host matches from required install-time access. `npm run check:manifest` pins the expected permissions and shipped licences. Public store explanations are in [STORE_LISTING.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/docs/STORE_LISTING.md). Automated smoke checks use invented sites and simulated provider answers; native browser features and real permission prompts need [manual validation](browser-checklist.md).

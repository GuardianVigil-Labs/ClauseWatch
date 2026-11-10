# Development

This guide covers building, testing and reviewing ClauseWatch from source. It contains project instructions only. Keep organization-private information, machine identifiers, credentials and unrelated projects out of repository files, logs, screenshots and review text.

## Prerequisites

- Node.js 24 and npm, using the committed lockfile.
- Go for `npm run check:rules`. The toolchain is declared in `tools/rulecheck/go.mod`; use that declaration rather than copying a machine-specific installation path.
- Playwright's Chromium for browser checks.

Run commands from the repository root. Never copy account credentials, local installation paths or environment output into a public issue or commit.

## Build and load

```sh
npm ci
npm run typecheck
npm run build
npm run build:firefox
```

`npm ci` runs WXT's prepare step. Chromium output is `.output/chrome-mv3`; Firefox output is `.output/firefox-mv3`. Load the unpacked Chromium build through the browser's extension manager. Load Firefox's `manifest.json` through `about:debugging#/runtime/this-firefox` as a temporary add-on.

`npm run dev` starts the WXT development workflow. Generated output, dependencies, environment files and mutation backups are ignored by Git. Do not force-add them.

## Checks

| Command | What it checks |
|---|---|
| `npm run leak-guard` | Guard self-test, then tracked-file checks for local paths, personal addresses, network addresses and credential patterns. It does not replace a manual disclosure review. |
| `npm run typecheck` | WXT-generated types and TypeScript. |
| `npm test` | Reader parity, rules, permissions, scan jobs, settings, AI validation and UI behaviour. |
| `npm run build` / `npm run build:firefox` | Both browser targets. |
| `npm run check:manifest` | Permission and packaged-licence checks for built manifests. |
| `npm run size` | Reports built extension sizes. |
| `npm run check:rules` | Known-site schema, Go vet/tests, and English/Spanish/French fixture parity. |
| `npm run smoke` | The built Chromium extension with invented sites and routed responses, including simulated AI answers. |
| `npm run mutation -- src/<changed-file>.ts` | Mutation checks for a changed module; investigate surviving behaviour changes and add meaningful tests. |

Run the full maintainer checks in [AGENTS.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/AGENTS.md#local-checks) before opening a pull request. Mutation runs apply to code changes, not prose-only documentation edits. Build first, then install the browser if necessary:

```sh
npx playwright install chromium
npm run smoke
```

CI installs Chromium's system dependencies too. On a supported Linux environment that needs them, use `npx playwright install --with-deps chromium`. Use the browser installation appropriate for your own environment; do not publish its local path.

Timing-sensitive regex tests should run without competing builds or browser tests. If diagnosing resource contention, `npm test -- --maxWorkers=1` runs the same tests and assertions serially. Do not loosen a timing limit or pattern guard to make a failure disappear. CI continues to use the project's normal test command.

Chromium smoke checks do not establish live-provider compatibility, built-in model availability, browser-native highlighting, printer behaviour, or Firefox permission-prompt behaviour. Use [the browser checklist](browser-checklist.md) for manual release validation.

## Code map

| Area | Modules |
|---|---|
| Entry points | `entrypoints/background.ts`, `popup/`, `options/`, `welcome/`, `signup.content.ts`, `signup-frame.content.ts` |
| Download, identity and extraction | `src/auto/background.ts`, `src/engine/document.ts`, `documents.ts`, `rendered.ts`, `pdf*.ts` |
| Rule matching and user rules | `src/engine/rules.ts`, `rule-set.ts`, `pattern-check.ts`, `rules-update.ts`, `verify.ts` |
| Language selection | `src/engine/language.ts`, `language-packs.ts`, `rules/es/`, `rules/fr/` |
| Recoverable jobs | `src/scan/jobs.ts`, `client.ts` |
| Reports, exports and comparisons | `src/ui/report.ts`, `report-tools.ts`, `scan.ts`, `src/storage-retention.ts` |
| Optional AI | `src/ai/` and `src/ui/ai.ts` |

[Architecture](architecture.md) describes ownership and storage. [The reader contract](reader.md) documents extraction and matching. Changes to either need corresponding fixtures and documentation.

## Fixtures and regression checks

Use invented policy text and `.example` or `example.com` addresses. Documentation IP ranges are suitable for address-validation fixtures; real infrastructure identifiers are not. A rule needs both a positive example and a close negative example, checked in JavaScript and Go. Language packs use the same fixture shape in their own directory.

Useful regression scenarios include cancellation during a body read, restarting the service worker mid-download, overlapping scans that share permissions, two Settings pages editing different rules, and cancellation after a report or AI setting changes. Do not capture real account pages or policy text received privately in test fixtures.

## Public change review

Before proposing a change:

1. Review the complete diff and the file list. Include only ClauseWatch source, invented fixtures and public project documentation.
2. Check newly added files as well as tracked files. The leak guard scans tracked paths; register only intended new project files before running it. Do not add scratch notes, exports, logs, browser profiles, environment files or build artifacts.
3. Check for machine paths, hostnames, addresses, credentials, internal plans, private links, unrelated projects and author-attribution boilerplate. Do not weaken a guard or add an exception to conceal a finding.
4. Keep changelog and documentation claims tied to current code. Distinguish source changes under **Unreleased** from published versions. Do not claim a release, signing step or manual check that has not happened.
5. Use the contributor identity and GitHub account you are authorized to use. Do not change authorship to impersonate someone. Commits, pull requests, tags and publishing are separate actions governed by repository review and release permissions.

Security findings belong in the private channel described by [SECURITY.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/SECURITY.md), not in a public issue containing the sensitive material. No external message is sent by any local check.

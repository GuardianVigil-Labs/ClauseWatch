# Maintaining ClauseWatch

A guide for anyone, human or AI, who works on this repository. `CLAUDE.md` points here; this file is the only copy.

This repository is public. Every file, commit message, branch name, issue, pull request, review comment and release note can be read by anyone, forever. Deleting it later does not unpublish it.

## Project layout

| Path | What it holds |
|---|---|
| `entrypoints/` | The extension's entry points (WXT): `background.ts` (service worker), `popup/`, `options/` (Settings), `welcome/` (first-run setup), `signup.content.ts` (automatic mode's card). |
| `src/engine/` | Reading documents and matching rules: `document.ts` (HTML to text blocks), `documents.ts` (finding and recognising terms and privacy pages), `rules.ts`, `rule-set.ts`, `pattern-check.ts`, `known-sites.ts`, `verify.ts`, `rules-update.ts`, `trusted-keys.ts`, `bundled.ts`. |
| `src/auto/` | Automatic mode: sign-up form detection and remembered documents. |
| `src/ai/` | Optional AI help: prompts, quote validation, the summary, the verdict filter. |
| `src/ui/` | Shared UI: the report, Scan a link, sharing, data requests, quiet sites, the theme. |
| `rules/` | `rules.json`, `rules_fixtures.json`, `sites.json`: the source of truth for detection rules and known sites. |
| `tests/` | Vitest suites; `tests/fixtures/reader-parity.json` for the reader contract. |
| `tools/rulecheck/` | Runs every rule fixture through Go's RE2 engine. |
| `scripts/` | Checks and tooling: leak guard, manifest check, known-sites check, bundle size, smoke test, mutation testing, packaging. |
| `docs/` | User and developer documentation, published with GitHub Pages. |

How it fits together: [docs/architecture.md](docs/architecture.md).

## Local checks

Run all of these before opening a pull request. Every one must pass.

```sh
npm ci
npm run leak-guard
npm run typecheck
npm test
npm run build
npm run build:firefox
npm run check:manifest
npm run size
npm run check:rules   # needs Go installed
npm run smoke         # the built extension in a real Chromium; run `npx playwright install chromium` once
npm run mutation -- src/<changed file>.ts   # add a test for every surviving mutant that changes behaviour
```

The leak guard scans tracked files only, so stage new files with `git add` before running it.

## Rules and known sites

- A rule change edits `rules/rules.json` and adds fixtures to `rules/rules_fixtures.json`: at least one invented sentence the rule must match and one near miss it must not. Both `npm test` and `npm run check:rules` must pass. See [rules/README.md](rules/README.md).
- A known-site change edits `rules/sites.json`, sorted by `id`. Open every address in a private window first, and say in the pull request what you checked. See [docs/rules.md](docs/rules.md#known-sites).
- Never use a real company's text in a test or fixture. Real public service addresses belong only in `sites.json`.
- Rule and known-site changes are merged by pull request. The GuardianVigil team does a final review, signs and releases each rules version; the extension accepts only releases signed with the key built into it.

## What the product must keep

- Every finding is an exact quote from the document. Never a verdict, a score or "safe".
- Nothing leaves the device except the daily signed-rules download from GitHub and, when the user turns it on, AI help with their own key.
- No secret may depend on the extension's code staying hidden.
- No account, no telemetry, no tracking.

## Privacy and leaks

Never commit personal data, local paths, credentials or non-public information. That covers files, commit messages, branch names, issues, pull requests, test fixtures, logs and screenshots.

- Use invented examples: `example.com` and `.example` domains, and the documentation addresses 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24.
- A leak-guard finding is fixed by removing the content. Never weaken the guard or add an exception without a code owner's approval (see [POLICY.md](POLICY.md)).
- If you find something like this already in the repository or its history, do not repeat it in public. Tell the maintainers privately: clausewatch@guardianvigil.io.

## Pull requests, commits and workflows

- Changes reach `main` only through a pull request approved by a code owner.
- Describe problems generically, with invented fixtures.
- No AI attribution: no co-author trailers naming a model, no "generated with" lines, no bot signatures.
- Workflows run for pull requests and release tags.

## Releases

Only battle-tested versions are released: every check plus a real-browser run ([docs/browser-checklist.md](docs/browser-checklist.md)), then a maintainer test, then a tag. The steps are in [docs/releasing.md](docs/releasing.md).

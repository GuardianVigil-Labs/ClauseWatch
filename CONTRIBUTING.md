# Contributing

ClauseWatch is improved most by its detection rules and its list of known sites. Both are plain JSON files in `rules/`, checked by the tests, and anyone can propose a change.

1. Read [POLICY.md](POLICY.md) and the maintainer guide, [AGENTS.md](AGENTS.md) (for people and AI tools alike).
2. Branch from `main` and open a pull request. Direct pushes to `main` are not accepted; every change needs a code owner's review.
3. Before pushing, run:
   ```sh
   npm ci
   npm run leak-guard
   npm run typecheck
   npm test
   npm run check:rules   # the known-sites schema, then every rule fixture in Go's engine (needs Go)
   ```
   Changing the extension itself? Also `npm run build && npm run build:firefox && npm run check:manifest && npm run smoke`.
4. Every finding the extension shows must be an exact quote from the document. A change that shows a verdict, score or "safe" will not be merged.
5. Test fixtures use invented text, `.example` domains and documentation addresses (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24). Never a real company's name or text in a test.

## Proposing a rule

Follow [rules/README.md](rules/README.md): the rule in `rules/rules.json`, at least one sentence it must match and one near miss it must not in `rules/rules_fixtures.json`, and both checks green.

## Adding a known site

Follow [docs/rules.md](docs/rules.md#known-sites): one entry in `rules/sites.json` with the service's domains and the exact addresses of its terms and privacy policy (and, optionally, its sign-up pages). Open each address in a private window first, and say in the pull request what you checked. Real public service addresses belong in `sites.json` only, never in tests.

Rule and known-site changes are merged by pull request. The GuardianVigil team then does a final review, signs and releases each rules version, and installed extensions pick it up within a day. The extension accepts only releases signed with the key built into it.

## Reporting a problem

- A bug: open a **Bug report** issue.
- A missed clause or a wrong finding: open a **Missed clause or false positive** issue with the address of the document and the sentence. Never paste text you received privately.
- A service missing from the known sites: open an **Add a known site** issue, or better, a pull request.
- Anything else: clausewatch@guardianvigil.io.
- A security issue: report it privately, see [SECURITY.md](SECURITY.md).

## Licence of contributions

By opening a pull request you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), like the rest of the project (section 5 of the licence).

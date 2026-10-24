## What and why

## Type of change
- [ ] Rule (`rules/rules.json` with fixtures in `rules/rules_fixtures.json`)
- [ ] Known site (`rules/sites.json`): for each address, what I checked and when:
- [ ] Extension code
- [ ] Documentation

## Checks
- [ ] `npm run leak-guard`, `typecheck`, `test`, `build`, `build:firefox`, `check:manifest`, `size` pass.
- [ ] `npm run check:rules` passes (rule or known-site changes).
- [ ] `npm run smoke` passes (extension changes).
- [ ] Docs updated where behaviour changed.

## Before you open this (the repository is public)
- [ ] No personal data, local paths, credentials or non-public information, in the diff, the commit messages or this description.
- [ ] Tests and docs use invented examples (`example.com`, documentation IP ranges); no real company's text in a test.
- [ ] Findings stay exact quotes: nothing scores a service or calls it safe.

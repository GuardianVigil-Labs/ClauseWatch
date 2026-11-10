## What and why

## Type of change
- [ ] Rule or language pack (rule file with corresponding positive/negative fixtures)
- [ ] Known site (`rules/sites.json`): for each address, what I checked and when:
- [ ] Extension code
- [ ] Documentation

## Checks
- [ ] `npm run leak-guard`, `typecheck`, `test`, `build`, `build:firefox`, `check:manifest`, `size` pass.
- [ ] `npm run check:rules` passes (rule or known-site changes).
- [ ] `npm run smoke` passes (extension changes).
- [ ] User, developer and privacy docs match behaviour, limits and retention; unreleased changes are not described as published.
- [ ] Targeted mutation checks and manual browser checks completed where required.

## Before you open this (the repository is public)
- [ ] No personal data, machine identifiers, local paths, credentials, internal plans or unrelated-project information, in the diff, the commit messages or this description.
- [ ] Tests and docs use invented examples (`example.com`, documentation IP ranges); no real company's text in a test.
- [ ] Findings stay exact quotes: nothing scores a service or calls it safe.

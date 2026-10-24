---
name: add-known-site-or-rule
description: Add or fix a ClauseWatch known site (rules/sites.json) or detection rule (rules/rules.json with fixtures). Use when asked to add a service, update a terms or privacy address, propose a rule, or fix a missed clause or false positive.
---

# Add a known site or a rule

Read `AGENTS.md` first. Never put real company text in tests, and never commit personal data, local paths, credentials or non-public information.

## A known site

1. Open `rules/sites.json`. The list is sorted by `id`; insert the entry in place.
2. Fill in, following `docs/rules.md#known-sites` and the schema in `docs/reader.md#known-sites`:
   - `id`: lower-case letters, digits and dashes, at most 40 characters, unique;
   - `name`: what people call the service;
   - `domains`: where people use and sign up for it, without `www.`; a domain belongs to one site only;
   - `legalDomains` (optional): other domains its documents live on;
   - `terms`, `privacy`: full `https` addresses after any redirect, with no tracking query or fragment, on one of `domains` or `legalDomains`; the consumer terms accepted at sign-up;
   - `signup` (optional): address prefixes of sign-up pages, with no query.
3. Each address must open without signing in and show its text in the server's HTML (no JavaScript-only page, no bot check, under 2 MB). If it cannot be checked, say so instead of guessing an address.
4. Run `npm run check:rules` and `npm test`.
5. In the pull request, list each address and what was checked.

## A rule

1. Edit `rules/rules.json`: an `id`, a `category` (one of `categories`), `all` patterns that must all match a sentence, and `none` patterns that must not.
2. Keep to the pattern limits in `rules/README.md`: no lookaround, backreferences or inline flags; `.` and negated classes only with a bounded repeat up to `{0,200}`; no repeated group holding a quantifier or `|`; at most 400 characters.
3. Add fixtures to `rules/rules_fixtures.json`: at least one invented sentence the rule must match, and one near miss it must not (for example a denial: "we do not sell your data").
4. If the rule is new, add it to the table in `rules/README.md`.
5. Run `npm test` (JavaScript engine, pattern safety, timing on hostile text) and `npm run check:rules` (Go's RE2 engine).

Do not change `version` in `rules/rules.json` in the same pull request: the GuardianVigil team does a final review, signs and releases each rules version.

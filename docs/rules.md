# Detection rules

This page describes the current source checkout, including unreleased rule changes. ClauseWatch's English rules are open: `rules/rules.json` holds them (the current bundled version has 19 rules under 13 topics), and [rules/README.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/rules/README.md) lists every rule and what it looks for.

## How a rule works

A rule normally matches **sentences**. Every pattern in its `all` list must match the sentence, and none in its `none` list may (that is how "we do not sell your data" stays out). A match is shown as the sentence itself, quoted, under the rule's topic. Assertion-scoped rules can recover an explicit permission after a denial and contrast, while quoting the full original sentence. A list introduction and its adjacent item may be quoted together; arbitrary nearby paragraphs are not treated as one permission. A rule never scores or judges a service.

## Proposing a rule

1. Open a pull request that changes `rules/rules.json` and adds fixtures to `rules/rules_fixtures.json`: at least one invented sentence the rule must match and one near miss it must not. Never use a real company's text.
2. The checks run every fixture in both the browser's JavaScript engine (`npm test`) and Go's (`npm run check:rules`), refuse pattern shapes that can freeze a page, and time each rule against hostile text.
3. One code owner reviews it.

Details and the pattern limits are in [rules/README.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/rules/README.md).

## Releases

Rule and known-site changes are merged by pull request. The GuardianVigil team then does a final review, signs and releases each rules version, with the rules and the known sites in one signed file (`rules.signed.json`). The extension accepts only releases signed with the key built into it, and only a version newer than the one it has. Once a day it downloads the latest release from this repository's GitHub releases; the copy bundled with the extension keeps working offline. How a release is checked: [reader.md](reader.md#the-signed-release).

## Known sites

`rules/sites.json` lists popular services with the exact addresses of their terms and privacy policy, and optionally their sign-up pages. On a known site, ClauseWatch reads those addresses directly instead of looking for links on the page, and in automatic mode its card shows as soon as a sign-up page opens.

```json
{
  "id": "service",
  "name": "Service",
  "domains": ["service.example"],
  "terms": "https://service.example/legal/terms",
  "privacy": "https://service.example/legal/privacy",
  "signup": ["https://service.example/signup"]
}
```

To add or fix a site:

1. Edit `rules/sites.json` in a pull request. Keep the list sorted by `id`.
   - `id`: lower-case letters, digits and dashes.
   - `name`: what people call the service.
   - `domains`: where people use and sign up for it, without `www.`; a domain covers its subdomains, and belongs to one site only.
   - `legalDomains` (optional): other domains its documents live on, such as a parent company's legal site. They do not make the service known there. A scan of the service asks for access to all of its `domains` and `legalDomains`, and follows redirects between them.
   - `terms`, `privacy`: the full `https` address of each document, after any redirect, with no tracking query or `#fragment`, on one of `domains` or `legalDomains`. Use the consumer terms people agree to at sign-up, not a business agreement or a data processing addendum, unless that is what sign-up accepts.
   - `signup` (optional): address prefixes of the sign-up pages, on one of its domains, with no query.
2. Check each address in a private window: it opens without signing in, is the right document, and provides downloadable readable text or a supported text-based PDF within the extraction limits. A rendered-tab fallback does not make a JavaScript-only or protected address suitable for unattended known-site fetching.
3. Run `npm run check:rules` (the schema check, `scripts/check-sites.mjs`, runs first) and `npm test`.
4. In the pull request, say for each address what you checked and when. Public service addresses are the list's data; never put a real service in a test fixture.

The format is described in [reader.md](reader.md#known-sites).

## Your own rules

In **Settings → Rules** you can:

- switch any ClauseWatch rule off;
- **copy** a ClauseWatch rule and edit it;
- **add your own rule**: a name, a topic, the patterns a sentence must and must not match, and at least one example sentence of each kind. It is tested against its examples before it is saved;
- **import** a rules file (a community pack, at most 512 KB and 200 rules) and **export** your own rules;
- **reset** everything to the defaults.

Your own rules stay on your device unless you export them.

Rules you write or import run on [re2js](https://github.com/le0pard/re2js), a JavaScript port of RE2, to avoid backtracking behaviour. Pattern, collection and input limits still apply; this is not a guarantee that arbitrary input or runtime conditions can never cause delays. The fixture checks compare matching with Go's engine. Before that, they pass the same pattern check as the official rules. The signed rules run on the browser's own engine.

## Example checks and limits

“Test and save” and imports use the same document builder and matching engine as scanning. Each positive must contain an eligible match of at least the current minimum quote length (eight words in this version); a negative fails if any eligible sentence or list statement matches. Patterns satisfied only across unrelated sentences do not pass. Copies preserve their match scope, selectable as **Whole sentence** or **Separate assertions**.

The background validates changes against the latest stored collection. All saved rules, including disabled ones, count toward the limits of 200 rules and 600 patterns. Adding several valid packs cannot bypass the combined limit. Settings names rules that did not run; their topics are not treated as checked solely because those rules were stored.

The report retains later matching sentences and offers **Show surrounding text**. Direct conditions such as “unless you opt out” are quoted as wording to review, rather than being replaced with a categorical explanation. This is bounded pattern matching, not a complete interpretation of legal meaning.

## Language packs

| Pack | Source | Current topic coverage |
|---|---|---|
| English | `rules/rules.json`, bundled version 4 | 19 rules, 13 topics |
| Spanish | `rules/es/rules.json`, version 1 | Data sale, automatic renewal, arbitration |
| French | `rules/fr/rules.json`, version 1 | Data sale, automatic renewal, arbitration |

The language selector uses the applicable bundled pack for Spanish/French reads. When the text itself is confidently identified, English rule switches and user rules are not applied to those reads; when the language is only a guess, the English rules run alongside the pack. An imported custom rule is not a way to enable checks for an otherwise unsupported language. Coverage notices must not imply that all English topics were checked. These packs detect selected formulations, not every possible sentence or legal dependency.

To change a pack, edit its own rule and fixture files, add invented positive and near-negative sentences, and run `npm test` and `npm run check:rules`. Every pack is checked by JavaScript and Go. Spanish/French pack changes ship with the extension; they are not independent downloaded signed releases. Review and release requirements are in [releasing](releasing.md).

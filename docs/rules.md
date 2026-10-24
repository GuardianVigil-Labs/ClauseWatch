# Detection rules

ClauseWatch's rules are open: `rules/rules.json` holds them (at 1.0.0, 18 rules under 13 topics), and [rules/README.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/rules/README.md) lists every rule and what it looks for.

## How a rule works

A rule matches **sentences**. Every pattern in its `all` list must match the sentence, and none in its `none` list may (that is how "we do not sell your data" stays out). A match is shown as the sentence itself, quoted, under the rule's topic. A rule never scores or judges a service.

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
2. Check each address in a private window: it opens without signing in, is the right document, and shows its text without a click (ClauseWatch reads the page as the server sends it, so a page that draws its text only with JavaScript, needs a bot check, or is larger than 2 MB cannot be read; such a site does not belong on the list).
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

Rules you write or import run on [re2js](https://github.com/le0pard/re2js), a JavaScript port of RE2. It works in linear time, so no pattern can freeze a page, and it matches as Go's engine in the rule checks does. Before that, they pass the same pattern check as the official rules. The signed rules run on the browser's own engine.

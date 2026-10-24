# ClauseWatch reader contract

How ClauseWatch turns a page into quotes, and the formats of the files it reads. There is no server API: the extension talks to no service of its own. It downloads one public file, the latest signed rules release, and reads terms and privacy pages from the services themselves.

Anyone may implement the same reading (a command-line tool, another browser, a server). Following this contract, with the same rules file, gives the same quotes at the same positions.

## The rules file

```json
{
  "version": 1,
  "flags": "i",
  "minQuoteWords": 8,
  "categories": ["ai_training", "arbitration", "ip_assignment", "data_sale", "unilateral_change"],
  "rules": [{ "id": "binding-arbitration", "category": "arbitration", "all": ["…"], "none": ["…"] }]
}
```

- Compile each pattern with `new RegExp(pattern, flags)`. Patterns avoid lookaround, backreferences, inline flags, classes starting with `]` and escapes other than `\s \S \w \W \d \D \b \B \n \t \r \f \v` and escaped symbols, class ranges outside printable ASCII, so every engine reads them the same way, and keep to shapes known not to backtrack badly (a filter, not a proof; official rules are also timed against hostile text): no repeated group that holds a quantifier or alternation, `.` and negated classes only with a bounded repeat (at most `{0,200}`), no two open-ended repeats that can match the same characters without something between them that neither can match, bounded repeats in a row only while their choices multiply to at most 1,000 (3,000 when a group of alternatives ends the chain), at most 400 characters (`src/engine/pattern-check.ts`). The fixtures must pass in both JavaScript and Go (RE2).
- **A rule matches a sentence** when every `all` pattern matches it and no `none` pattern does.
- **A finding is a sentence** of at least `minQuoteWords` words. The first matching sentence per rule per clause is the finding; its text is quoted exactly, with its position in the document.
- **Each category is `found`,** with every finding, **or `not_found`.** A document that could not be read is reported as such, with the reason. Never "safe", never a score.
- `rules_fixtures.json` comes with each version: sentences each rule must and must not match. An implementation must agree with every fixture.

## Known sites

`rules/sites.json` maps popular services to the exact addresses of their documents:

```json
{
  "sites": [
    {
      "id": "service",
      "name": "Service",
      "domains": ["service.example", "service-app.example"],
      "legalDomains": ["parent.example"],
      "terms": "https://legal.parent.example/terms",
      "privacy": "https://legal.service.example/privacy",
      "signup": ["https://service.example/signup"]
    }
  ]
}
```

- `id`: lower-case letters, digits and dashes, at most 40 characters, unique.
- `name`: what people call the service, 1 to 80 characters.
- `domains`: 1 to 10 lower-case public domains where people use and sign up for the service, without `www.`. A domain covers its subdomains, and is listed by one site only. A host belongs to the site with the most specific matching domain. IP addresses, local or internal names, and public suffixes or hosting domains shared by unrelated sites (`co.uk`, `github.io`, `vercel.app` and the like, `SHARED_DOMAINS` in `src/engine/known-sites.ts`) are refused.
- `legalDomains` (optional): up to 10 more domains, checked the same way, where the service's documents live (a parent company's legal site). They never make the service known on those domains.
- `terms`, `privacy`: the full `https` address of each document, as a browser writes it (`new URL(address).href` gives it back unchanged), with no fragment, port or credentials, on one of `domains` or `legalDomains`.
- `signup` (optional): up to 10 address prefixes of the service's sign-up pages, `https`, on one of its domains, with no query. A page is a sign-up page when its address without the query, ignoring `www.` on either side, is a prefix, or continues it after a `/`. The path is compared as written, case included.
- `scripts/check-sites.mjs` (part of `npm run check:rules`) and the extension apply the same check (`src/engine/known-sites.ts`).

On a known site, the extension reads these addresses directly, in the toolbar popup, in automatic mode and in "Scan a link", before any link found on the page. Automatic mode shows its card when a sign-up page opens.

## The signed release

Each rules release carries `rules.signed.json`, signed by the GuardianVigil team. It holds the rules and the known sites together:

```json
{ "version": 4, "rules": "<text of rules.json with \"sites\" from sites.json added>", "signature": "<base64>", "algorithm": "Ed25519", "keyId": "<id>" }
```

- Verify `signature` over the **exact bytes** of `rules` with a public key built into the extension (`keyId` says which one, `src/engine/trusted-keys.ts`). Use the file only if it verifies, its outer `version` equals the one inside the signed text, its patterns compile, any `sites` it carries pass the known-sites check, and its `version` is newer than **both** the bundled copy and any stored update, so an old signed file cannot roll the rules back.
- A release without `sites` keeps the bundled list.
- The extension downloads `https://github.com/GuardianVigil-Labs/ClauseWatch/releases/latest/download/rules.signed.json` on install and then at most daily, without cookies (`src/engine/rules-update.ts`). GitHub redirects that address to the release's own and then to its file storage; neither sends CORS headers, so the extension holds host access to `github.com` and `release-assets.githubusercontent.com` for this download alone. It keeps the signed file in local storage and verifies it again each time it is used; any failure keeps what is there.
- Whoever serves the file, only the pinned keys are trusted: a mirror, a proxy or GitHub itself cannot change the rules.

## Reading a document
- Skip the text inside `script`, `style`, `noscript`, `template`, `svg`, `canvas`, `iframe`, `head`, `button`, `select`, `option` and `form`. Navigation and footer text is kept. Block elements (`p`, `div`, `li`, headings, table cells, `nav`, `header`, `footer` and similar) end a block.
- Read the page as the browser's own parser builds it (scripting off), not as a stream of tags, so a self-closing `<div/>` or an unclosed element nests as it does in a browser. A page nested more than 512 elements deep is still read, as browsers show it.
- Skip dialogs and consent banners as well: a `dialog` element, `role="dialog"` or `role="alertdialog"`, or `aria-modal="true"`; and an element whose `id`, a `class` or `aria-label` names a cookie or consent banner (`cookie` or `consent`, then `banner`, `bar`, `notice`, `popup`, `modal`, `dialog`, `sdk`, `manager`, `preferences` or `prompt`) when it sits outside `main` and `article` and holds a control (`button`, `input` or `role="button"`). Either is read after all when it holds a heading, `main` or `article`, or more than 80 words (counted on ASCII whitespace, as its text content would split, template content excluded): then it is part of the document, such as a "Cookie notice" or an app wrapped in a dialog. The exception is a dialog that is, or sits inside, an element named as a cookie or consent banner: a consent preference centre is long and has headings, and is still skipped. `html`, `body`, `main` and elements that cannot hold text (`link`, `img`, `input` and the other void elements) are never skipped this way. Attribute values are compared after trimming ASCII whitespace and lowercasing A to Z only.
- Text is joined as written: an inline element adds no space, so `collected</a>,` reads "collected," and a word split by an inline tag stays whole. Block elements (also `hr`, `summary`, `details`, `figure`, `figcaption`, `caption`, `address`, `dl`, `legend`, `fieldset` and `hgroup`) separate text, and so does a skipped block, form, dialog or banner.
- Known limit: an inline element a stylesheet shows as a block (a `span` with `display: block`) is read as inline, because reading uses no layout.
- A block under 40 characters joins the next one, on its own line, so a heading stays with its clause without becoming part of its first sentence.
- Sentences end at `.`, `!`, `?` or `;` followed by a space, and at a line break.
- A document needs at least 300 words and must name itself ("Terms of Service", "Terms of Use", "Terms and Conditions", "User Agreement", or "Privacy Policy/Statement/Notice"). Otherwise it is not that document.
- `tests/fixtures/reader-parity.json` holds pages with the text and clause positions any implementation must read from them.

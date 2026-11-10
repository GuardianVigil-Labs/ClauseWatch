# ClauseWatch reader contract

How ClauseWatch turns a page into quotes, and the formats of the files it reads. There is no server API: the extension talks to no service of its own. It downloads one public file, the latest signed rules release, and reads terms and privacy pages from the services themselves.

Anyone may implement the same reading (a command-line tool, another browser, a server). Following the extraction and matching contract with the same rule set gives comparable quote positions. Language selection, rendered-tab capture and PDF extraction are separate inputs; implementations must match those stages as well to reproduce a complete report.

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
- **A rule matches a sentence** when every `all` pattern matches it and no `none` pattern does. Optional `scope: "assertion"` also checks explicit contrasts after a denial (but/however/yet/except, or “and we/our company”); this can recover a separately stated permission. The full sentence, including its conditions, remains the quote. Missing or unknown scope values must not be interpreted as an arbitrary matching mode; unknown scopes are refused.
- **A finding** is every matching sentence of at least `minQuoteWords` words, quoted exactly with code-point positions. There is no first-match-per-clause restriction. A bounded list introduction ending in a colon and its adjacent item may also match as one exact contiguous source quote; arbitrary neighbouring paragraphs are not joined into new matches.
- Findings retain an exact nearby source excerpt, capped to 700 code points on either side of the quote and at most one adjacent block in each direction. The report offers it under “Show surrounding text”, explicitly as context rather than another finding. A topic label is not a legal paraphrase; direct conditions/exceptions are shown in the document's own words.
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
- `domains`: 1 to 10 lower-case public domains where people use and sign up for the service, without `www.`. A domain covers its subdomains, and is listed by one site only. A host belongs to the site with the most specific matching domain. IP addresses, local or internal names, and public suffixes or hosting domains shared by unrelated sites (`co.uk`, `github.io`, `vercel.app` and the like, the bundled Public Suffix List plus `SHARED_DOMAINS` in `src/engine/known-sites.ts`) are refused.
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
- Skip explicit `hidden`, `aria-hidden="true"`, inline `display:none`, `visibility:hidden/collapse` and `content-visibility:hidden` content. Skip the text inside `script`, `style`, `noscript`, `template`, `svg`, `canvas`, `iframe`, `head`, `button`, `select`, `option` and `form`. Navigation and footer text is kept. Block elements (`p`, `div`, `li`, headings, table cells, `nav`, `header`, `footer` and similar) end a block.
- Read the page as the browser's own parser builds it (scripting off), not as a stream of tags, so a self-closing `<div/>` or an unclosed element nests as it does in a browser. A page nested more than 512 elements deep is still read, as browsers show it.
- Skip dialogs and consent banners as well: a `dialog` element, `role="dialog"` or `role="alertdialog"`, or `aria-modal="true"`; and an element whose `id`, a `class` or `aria-label` names a cookie or consent banner (`cookie` or `consent`, then `banner`, `bar`, `notice`, `popup`, `modal`, `dialog`, `sdk`, `manager`, `preferences` or `prompt`) when it sits outside `main` and `article` and holds a control (`button`, `input` or `role="button"`). Either is read after all when it holds a heading, `main` or `article`, or more than 80 words (counted on ASCII whitespace, as its text content would split, template content excluded): then it is part of the document, such as a "Cookie notice" or an app wrapped in a dialog. The exception is a dialog that is, or sits inside, an element named as a cookie or consent banner: a consent preference centre is long and has headings, and is still skipped. `html`, `body`, `main` and elements that cannot hold text (`link`, `img`, `input` and the other void elements) are never skipped this way. Attribute values are compared after trimming ASCII whitespace and lowercasing A to Z only.
- Text is joined as written: an inline element adds no space, so `collected</a>,` reads "collected," and a word split by an inline tag stays whole. Block elements (also `hr`, `summary`, `details`, `figure`, `figcaption`, `caption`, `address`, `dl`, `legend`, `fieldset` and `hgroup`) separate text, and so does a skipped block, form, dialog or banner.
- Known limit: an inline element a stylesheet shows as a block (a `span` with `display: block`) is read as inline, for downloaded HTML, because it uses no layout. Those reports carry a visibility notice; the rendered-tab snapshot also respects computed block layout.
- A block under 40 characters joins the next one, on its own line, so a heading stays with its clause without becoming part of its first sentence.
- Rule-matching sentences end at `.`, `!`, `?` or `;` followed by whitespace or the end of the text, and at a line break. Offsets are Unicode code points; list matching remains an additional bounded path.
- A document needs at least the configured minimum quote length (currently eight words) and a recognised name. Names include Terms of Service/Use/Sale, Terms and Conditions, user/customer/subscription/master services/licence agreements, and Privacy or Data Protection Policy/Statement/Notice. Policy links in navigation or a footer alone do not establish identity. A short access-wall message is refused. Explicit manual type selection bypasses the name check and labels the choice; it does not bypass the minimum readable length.
- Language coverage is estimated locally. English uses the configured English/custom rule set. Spanish and French select their bundled version-1 packs, each declaring only data sale, automatic renewal and arbitration. When the text is confidently identified as Spanish or French, these reads do not run English/custom rules or report other categories as checked. When the language comes only from the page's `lang` attribute or a wording guess, the English rules run alongside the pack. Other languages are checked with the English rules, without listing topics as not found; uncertain language uses the English rules with a notice. Detection is an estimate, not a translation. Native policy names include Spanish terms/privacy titles and French conditions/confidentiality titles.
- Manual tab reading captures loaded DOM text, traversing open shadow roots and slots and omitting common computed hidden elements. Closed roots, frames and unread sections remain outside that snapshot. Policy controls can be focused for the user to activate on the page; no page control is clicked automatically.
- PDF links are downloaded within the same byte/deadline limits, then decoded on the device in a dedicated worker. Extraction is capped at 100 pages, 200,000 output characters and 15 seconds. Password-protected, image-only and malformed PDFs return an error; no OCR or remote conversion is used.
- `tests/fixtures/reader-parity.json` holds pages with the text and clause positions any implementation must read from them.

## Language-pack distribution

`rules/es/` and `rules/fr/` contain separate `rules.json` and `rules_fixtures.json` files using the same shapes. They are compiled and bundled with the extension; the signed English update envelope does not independently replace them. Their versions and declared categories must be visible in coverage descriptions. JavaScript and Go fixture checks apply to every pack. A build with changed reader/language behaviour must invalidate incompatible automatic cached reads.

## AI source units and report context

AI quote validation does not use the rule engine's semicolon/newline sentence boundaries. `src/ai/source.ts` conservatively retains semicolons, wrapped lines, abbreviations and immediate qualifications in complete source units. Unterminated units and units longer than the 24,000-source-character batch limit are omitted. Returned whitespace-equivalent text is mapped back to the original source string; a substring match is insufficient. Generated explanations are not shown.

Summary selections must match complete source sentences in every cited quote. Unknown, mismatched or invented citations and generated paraphrases are rejected. This is an extractive source check, not proof of legal interpretation or completeness. Surrounding report text remains evidence, not a synthesized quote or an additional finding.

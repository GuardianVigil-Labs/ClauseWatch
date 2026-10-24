# Architecture

How the extension is built. ClauseWatch is a Manifest V3 extension written in TypeScript and built with [WXT](https://wxt.dev). It has no server: everything below runs in the browser.

## Entry points (`entrypoints/`)

| Entry point | Role |
|---|---|
| `background.ts` | The service worker. Runs the daily rules check (an alarm every 15 minutes, a download at most once a day), registers automatic mode's content script only while automatic mode is on and its site access is granted, finishes **Scan a link** after the permission prompt closes the popup, and handles the two right-click items. It reads no page and observes no browsing: pages reach it only as messages from the extension's own pages and scripts, or a right-click. |
| `popup/` | The toolbar popup: **This site** (reads the current tab after a click, through `activeTab`) and **Scan a link** (an address or pasted text). Shows the report, sharing, data requests and the recently checked list. |
| `options/` | Settings: General, AI help, Rules, Sites, Privacy, About. `rules.ts` is the Rules pane (switching signed rules off, writing, importing and exporting own rules). |
| `welcome/` | First-run setup: AI help and when ClauseWatch appears. Opened once on install, and again from Settings. |
| `signup.content.ts` | Automatic mode's content script. Recognises sign-up and consent forms by their fields (never what is typed), and shows the card in a closed shadow root when the user starts filling one in, or as soon as a known site's sign-up page opens. |

## Reading a document (`src/engine/`)

1. **Finding documents** (`documents.ts`): on a known site, the addresses from `rules/sites.json` (`known-sites.ts`), and a page is read in place only when it is one of them; otherwise the page's links whose labels or addresses name terms or a privacy policy, on the page's own site.
2. **Fetching**: with the site access the user just granted, without cookies, at most 2 MB, never from a local or private network address, and never following a redirect to another site, except between a known site's own domains and legal domains (`src/auto/background.ts`).
3. **Text** (`document.ts`): the HTML is parsed as the browser parses it (scripting off), skipping scripts, forms, dialogs and cookie or consent banners, and split into blocks and sentences.
4. **Recognising the document**: at least 300 words and a title such as "Terms of Service" or "Privacy Policy". Anything else is reported as not that document.
5. **Matching** (`rules.ts`): a rule matches a sentence when all of its `all` patterns match and none of its `none` patterns do. The first match per rule per clause becomes a finding, quoted exactly with its position. Each topic is then `found` or `not_found`, and a document that could not be read says why.

The exact behaviour is specified in [reader.md](reader.md), with parity fixtures in `tests/fixtures/reader-parity.json`.

## Rules

- `rules/rules.json` and `rules/sites.json` are bundled into the build (`bundled.ts`), so the extension works offline from the first run.
- Signed rules run on the browser's own `RegExp`. Rules a person writes or imports run on [re2js](https://github.com/le0pard/re2js), a linear-time engine (`rule-set.ts`).
- Every pattern, signed or not, passes `pattern-check.ts` first: a filter that refuses the regular-expression shapes known to backtrack badly. Official rules are also timed against hostile text in the tests, and checked in Go's RE2 engine by `tools/rulecheck`.
- `rule-set.ts` combines the signed rules with the person's choices: rules switched off, copies they edited, and their own rules.

## Rules updates

- `rules-update.ts` downloads `https://github.com/GuardianVigil-Labs/ClauseWatch/releases/latest/download/rules.signed.json` on install and then at most once a day, without cookies.
- `verify.ts` checks the Ed25519 signature over the exact bytes of the signed text, against a public key in `trusted-keys.ts`, using WebCrypto. The file is used only if it verifies, its outer and inner versions agree, its patterns compile, its known sites pass the same check as `scripts/check-sites.mjs`, and its version is newer than both the bundled copy and any stored update.
- The signed response is stored as it came and verified again every time it is used. Any failure keeps the rules already in hand.

## AI help (`src/ai/`)

Off by default. `assist.ts` talks to the browser's built-in model or to an OpenAI-compatible service with the user's own key. `validate.ts` keeps an AI finding only when its quote appears word for word in the document. `summary.ts` sends only the verified quotes, keeps only sentences that cite a quote by number, and `verdict.ts` refuses any sentence that judges the service.

## Storage

Everything is kept in the browser's extension storage on the device (`src/storage.ts`): settings, own rules, the signed rules update, quiet sites, and recently read documents' quotes (for a week, without the full text). `storage.session` holds a pending scan while the permission prompt is open. Nothing is synced or sent.

## Permissions

| Permission | Used for |
|---|---|
| `activeTab`, `scripting` | Reading the current page after the user clicks the button or a right-click item; running automatic mode's script on sites the user allowed. |
| `contextMenus` | **Check this terms link** and **check selected text**. |
| `storage` | Settings, own rules, the rules update and remembered quotes, on the device. |
| `alarms` | The periodic check for the daily rules download. |
| `github.com`, `release-assets.githubusercontent.com` | The daily rules download only: GitHub redirects from the first host to the second, and neither sends CORS headers. |
| Optional `https://*/*`, `http://*/*` | Asked for at the moment it is needed: one site to read its documents (given back afterwards), all sites for automatic mode (given back when it is turned off), or the address of the user's own AI service. Never at install. |

`npm run check:manifest` (`scripts/check-manifest.mjs`) fails the build if the manifest asks for more. Each permission is also justified for the stores in [STORE_LISTING.md](STORE_LISTING.md).

## Checks

Unit tests use Vitest with happy-dom. `npm run smoke` loads the built extension in a real Chromium with Playwright and blocks every outside request, checking that the only one made is the rules download. `npm run mutation` flips operators in changed files to find untested behaviour. The full list is in [AGENTS.md](../AGENTS.md#local-checks).

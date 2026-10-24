# Store listing (Chrome Web Store, Firefox Add-ons, Edge Add-ons, Opera add-ons)

## Single purpose

Shows what a service's terms and privacy policy say, quoted, at sign-up.

## Short description (132 characters or fewer)

See what a site's terms and privacy policy say before you sign up: AI training, arbitration, data sale. Quoted, never scored.

## Long description

ClauseWatch reads a service's terms of service and privacy policy and shows you, in exact quotes, what they say about 13 topics (18 open detection rules), including whether they let the service:

- train AI on what you upload or type;
- send disputes to private arbitration or waive class actions;
- take ownership of, or a perpetual licence to, your content;
- sell or broker your personal data;
- change the terms without notice.

Every finding is a sentence from the document, with a link to where it came from. If a clause is not there, ClauseWatch lists it under "Not found", and says that "not found" is not "safe". If a document cannot be read, it says so and why. It never gives a score or calls a service safe. Quotes from the documents, not legal advice.

It works on your device, with no account. Click the toolbar button on a sign-up page to read that site, or turn on Automatic mode to see the card as soon as you start filling in a sign-up form. For about 45 popular AI and software services, ClauseWatch knows exactly where their terms and privacy policy are. Anywhere else, right-click a terms link or selected text and choose ClauseWatch.

Free and open source. The detection rules and the known-sites list are public, improved by pull request, and every update is signed.

## Permission justifications

| Permission | Why |
|---|---|
| `activeTab` | Read the page you are on, only after you click the toolbar button or choose ClauseWatch in the right-click menu. |
| `scripting` | Read that page's text (or your selected text) after your click, and run Automatic mode's form detection on the sites you allowed, when you turn it on. |
| `contextMenus` | The two right-click items: **ClauseWatch: check this terms link** on links, and **ClauseWatch: check selected text** on selections. |
| `storage` | Keep your settings, your own rules, the signed rules update and the quotes from documents already read, on your device. |
| `alarms` | Every 15 minutes, check whether the daily download of signed rules is due (at most once a day). |
| Host access to `github.com` and `release-assets.githubusercontent.com` | Once a day, download the latest signed rules release (`https://github.com/GuardianVigil-Labs/ClauseWatch/releases/latest/download/rules.signed.json`). GitHub answers with a redirect to the release, then to its file storage on the second host; neither sends CORS headers, so the extension needs access to both for this one download. That is all they are used for: the extension reads no GitHub page and runs nothing on either host. The request carries no account, identifier or cookie. |
| Optional host access (`https://*/*`, `http://*/*`) | Requested only when you choose to: the sites of a service's terms and privacy policy when you read them, an address you scan, or a link you right-click (one site at a time, given back afterwards); all sites when you turn on Automatic mode (given back when you turn it off); the address of your own AI service when you save your own API key. Never requested at install: setup starts with Automatic mode chosen, and asks only when you click **Done**. |

`minimum_chrome_version` 137 and Firefox `strict_min_version` 140 (142 on Android): rule signatures are checked with WebCrypto Ed25519, and Firefox's data collection declaration needs 140.

## Data use

- Nothing about the user leaves the device. The daily rules download carries no account, identifier or cookie. Documents are fetched from the service, without cookies, analysed on the device, and their quotes remembered on the device for a week without the full text.
- **AI help (off by default):** the built-in model runs on the device; with the user's own key, a summary sends only the quotes found, and "Look for clauses the rules missed" sends the text being checked (the document, or the text the user pasted or selected, up to 24,000 characters), only to the AI service they named. Every AI finding is shown only if it quotes the document exactly, labelled "Found by AI (quoted)".
- No data is sold, used for advertising, used to train models, or used for creditworthiness or lending. (Limited Use: the use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. ClauseWatch uses no Google APIs.)

Data categories (Chrome): "Website content" only (the text being checked, sent to the user's own AI service, only when they choose their own key), to provide the feature the user chose.

Data collection (Firefox, `data_collection_permissions`): required `none`; optional `websiteContent`, used only when the user turns on AI help with their own key. The extension requests it together with the key's address, when the key is saved (Firefox 140+), before anything is sent.

## Listing assets

In `docs/store/`, made from the built extension on invented `.example` pages:

- Screenshots (1280×800): `screenshot-1-popup-quotes.png` (the popup on a sign-up page with its quotes), `screenshot-2-scan-a-link.png`, `screenshot-3-automatic-card.png` (Automatic mode's card beside a sign-up form), `screenshot-4-right-click.png` (the result of "check selected text"), `screenshot-5-settings.png` (Settings → Rules).
- Promo tile (440×280): `promo-tile-440x280.png`, "Know what you agree to."
- Edge logo (300×300): `edge-logo-300.png`.
- Support: clausewatch@guardianvigil.io. Privacy policy: https://guardianvigil.io/clausewatch/privacy/. Source: https://github.com/GuardianVigil-Labs/ClauseWatch

Licence: open source under Apache-2.0; the source is public on GitHub. The names and the shield mark are not licensed (TRADEMARKS.md).

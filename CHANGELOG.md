# Changelog

All notable changes to ClauseWatch. Versions follow [semantic versioning](https://semver.org/).

## [1.0.0] — 2026-10-23

First public release: a free, open-source extension with no account and no server of its own.

- Reads a service's terms of service and privacy policy on the device and quotes the sentences that matter, under 13 topics, with 18 open, signed detection rules. Quotes from the documents, not legal advice.
- Known sites: about 45 popular AI and software services with the exact addresses of their terms and privacy policy (`rules/sites.json`), used by the popup, Scan a link and automatic mode, which shows its card when a known sign-up page opens.
- The right-click menu: **ClauseWatch: check this terms link** and **ClauseWatch: check selected text**.
- Click mode and an optional automatic mode for sign-up pages, chosen in first-run setup; per-site quiet.
- Scan a link: a terms address, any address on a known service, or pasted text.
- Rules and known sites update once a day from this repository's signed GitHub releases; a release is used only if it verifies against a pinned key and is newer.
- Optional AI help (the browser's built-in model or your own key): findings must quote the document exactly; a summary written only from verified quotes.
- Data requests (GDPR, CCPA) drafted on the device and sent from your own email.
- Sharing a plain link or a quote, with no tracking.
- Chrome, Edge, Firefox and Opera; Brave and Vivaldi from the Chrome Web Store.

# ClauseWatch user guide

ClauseWatch reads a service's terms of service and privacy policy, on your device, and quotes the sentences that matter before you sign up. It never scores a service, grades it or calls it safe: it shows you the words, and you decide. Quotes from the documents, not legal advice.

## Setting up

When you install ClauseWatch, a setup page opens: a short introduction, then two choices. You can change both later in **Settings**, or open setup again from **Settings → Sites → Run setup again**.

**AI help.** Rules always run first. AI can look for clauses the rules missed and summarise what the quotes say.

| Choice | What leaves your device |
|---|---|
| **No AI, rules only** (the default) | Nothing. |
| **The browser's built-in AI** (only shown where the browser has one) | Nothing: the model runs on your device. If the browser first has to download its model, setup says so; it can be several gigabytes. |
| **My own AI key** | What you ask about, sent to the AI service whose address you enter in Settings, under your account there: the quotes found for a summary, or the text being checked (the document, or the text you pasted or selected, up to 24,000 characters) when you ask it to look for clauses the rules missed. Never what you type into forms, passwords, cookies or history. Your key stays on your device. |

**When ClauseWatch appears.**

- **Show automatically on sign-up pages** (recommended, and chosen to start with): when you click **Done**, ClauseWatch asks your browser for access to all sites. Say no, or pick the other choice, and it appears only when you click it. It uses that access only to recognise sign-up forms and to read that site's terms on your device. Turning it off gives the access back.
- **Only when I click the icon**: ClauseWatch reads a site only when you click it, one site at a time.

## Reading a site

Click the ClauseWatch icon. The popup has two tabs.

**This site** reads the current site's terms and privacy policy and shows, for each topic, either:

- the topic's name, what such a clause allows, and the exact sentence quoted, with a link to the document. The quote is the document's own words, never a paraphrase.
- **Not found:** the topics nothing in what was read matched, with the documents checked. This is not a verdict that the service is safe ("“Not found” is not “safe”"); wording the rules do not know is not caught.
- **Could not read this document**, and why: for example, no link to it was found, the page is a PDF, or the site did not answer.

**Scan a link** reads a terms or privacy address you paste, or the text itself. Pasted text is read on your device; an address is read once, with your permission for that one site. If you choose an address, ClauseWatch asks for access to that site, and the scan finishes even if the popup closes while you answer.

## Known sites

For about 45 popular AI and software services, ClauseWatch knows exactly where the terms and privacy policy are (the [known-sites list](../rules/sites.json), signed with the rules). On one of their sites, **This site**, the card and **Scan a link** (with any address on the service, such as its home page) read those documents directly, even where the page itself has no link to them. On a known service's sign-up page, the card in automatic mode shows when the page opens, before you start filling anything in, because many services sign you up with a single button. The terms may be on another of the company's sites; ClauseWatch asks for access to the sites it reads, and gives it back afterwards.

A service missing, or a link out of date? Add it by pull request: see [rules.md](rules.md#known-sites).

## The right-click menu

Anywhere ClauseWatch does not find the documents itself:

- **ClauseWatch: check this terms link**: right-click a link to a terms or privacy page. ClauseWatch asks for access to that site once, reads it, and opens the result.
- **ClauseWatch: check selected text**: select a clause or a few, right-click, and ClauseWatch quotes what the rules find in it, read on your device. A selection needs at least eight words; at most its first 200,000 characters are read (the same for pasted text), and the result says when it was cut.

With AI help on, two more buttons appear:

- **Look for clauses the rules missed (AI)**, for documents read on this device. Every AI finding must quote the document word for word, or it is not shown. It is labelled **Found by AI (quoted)**.
- **Summarise the quotes (AI)**: up to four sentences above the report, labelled as AI. Every sentence names the quotes it rests on, and a sentence that judges the service ("safe", "standard", "nothing to worry about", a score) is removed. AI can still be wrong or misled by the page: the quotes are what the documents say.

## The card on sign-up pages

In automatic mode, a small card appears when you start filling in a sign-up form, with the same quotes.

- **Don't show on this site** stops the card on that site. Settings → Sites lists those sites, with **Show again**.
- A site ClauseWatch read in the last week stays quiet; the icon shows a dot instead.

## Rules

**Settings → Rules** has tabs. **ClauseWatch rules** lists every rule with a switch and a **Copy** button to edit it as your own. **My rules** holds your own rules and **Add my rule** (each tested against your example sentences before it is saved). **Import** imports or exports a rules file, and resets to the defaults. Settings has a menu on the left: General, AI help, Rules, Sites, Privacy and About. See [rules.md](rules.md).

## Sharing

The popup's **Share** menu shares a plain link to the ClauseWatch page: copy it, or send it by email, Reddit, X, LinkedIn or WhatsApp. **Copy quote & share** on a finding copies the site, the exact sentence and the link. Nothing about you is added, and there is no tracking code.

## Data requests

On a site's report, ClauseWatch can draft a request to the service to erase your data, give you a copy, or close your account, under the GDPR or the CCPA. It suggests the service's privacy address from its privacy policy, and you send the letter from your own email program. Nothing is sent by ClauseWatch.

## Known limits

- ClauseWatch reads what the page and its linked documents say in text. A PDF, an image of the terms, or a page that shows its text only after you sign in cannot be read; the report says so.
- ClauseWatch never reads a local or private network address (`localhost`, IP addresses, `.local`, `.internal` and the like), and a link that redirects to another site is not used.
- Text in a cookie or consent banner, or in a dialog over the page, is not part of the document and is never quoted.
- Some services block any request that does not come from a full browser visit (a bot check), or are too large to read (more than 2 MB). Those documents show **Could not read**, with the reason; open them in a tab and use **check selected text** instead.
- **Firefox:** Firefox loads every address an extension asks for over https, so a terms page available only over plain http cannot be read there. Firefox also cannot give an extension access to an address with a port number (`https://service.example:8443/terms`), so Scan a link cannot read one. Both work in Chrome, Edge and Opera.

## What ClauseWatch never does

No account, no telemetry, no browsing history, no reading what you type. See [PRIVACY.md](PRIVACY.md).

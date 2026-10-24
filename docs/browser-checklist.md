# Real-browser checklist

Run before each release, in Chrome and in Firefox. `npm run smoke` already covers:
- start-up and setup;
- the popup's tabs;
- a pasted scan that returns exact quotes;
- refusal of an unsafe own-rule pattern;
- Settings and its six sections;
- that the only request is the daily signed-rules download from GitHub;
- automatic mode's card on a sign-up form, quoting the linked terms;
- the right-click menu's two items and their results (the handler called as a click would call it).

It runs in Chromium, and in Edge with `SMOKE_CHANNEL=msedge`. This list covers what a script cannot do: permission prompts, the browser's own right-click menu and real pages.

Tick each box. If anything fails, note the browser, the page and what you saw, and open an issue.

## Load the build

1. In the repository, run `npm run build && npm run build:firefox`.
2. **Chrome:** open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, then pick the `.output/chrome-mv3` folder.
3. **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, then pick `.output/firefox-mv3/manifest.json`.
4. Pin ClauseWatch: click the puzzle-piece icon in the toolbar, then the pin next to ClauseWatch.

## 1. Reading a page

- [ ] Open five real sign-up or terms pages. On each, click the ClauseWatch button; on a sign-up page, click **Read <site>'s terms** (or privacy policy) and allow access to that site. The report lists findings, and every quote appears word for word in the document it names (open it and search with Ctrl+F).
- [ ] On a page with no terms link, the report says what it could not find, not that the site is fine.
- [ ] A link that cannot be read, such as a page that needs sign-in, shows that it could not be read, and why.
- [ ] The report never says "safe", and never gives a score or grade.

- [ ] On a known service (any site in `rules/sites.json`), click the ClauseWatch button on its home page: it offers to read that service's terms and privacy policy, even where the page has no link to them.

## 2. Scan a link

- [ ] In the popup, open **Scan a link**, paste a terms address and click **Scan**. The browser asks for access to that one site, which closes the popup; allow it. Open ClauseWatch again: the result is waiting.
- [ ] Paste terms text instead of an address. It is read with no prompt.
- [ ] Paste a known service's home address. Both its documents are read.

## 2b. The right-click menu

- [ ] Right-click a link to a terms page and choose **ClauseWatch: check this terms link**. The browser asks for access to that site; allow it. The result opens.
- [ ] Select a clause of at least eight words, right-click and choose **ClauseWatch: check selected text**. The result opens with the clause quoted, if a rule matches it.

## 3. Automatic mode

- [ ] In Settings → **General**, turn **Automatic mode** on. The browser asks for access to all sites; allow it.
- [ ] Open a sign-up form and click into it. The card appears before you type anything.
- [ ] Open a known service's sign-up page (a `signup` address in `rules/sites.json`). The card appears when the page opens, and quotes no cookie-banner text.
- [ ] On the card, click **Don't show on this site**. Reopening the site does not show the card.
- [ ] Turn automatic mode off. Check that access to all sites is gone:
  - Chrome: `chrome://extensions` → ClauseWatch → **Details** → **Site access**.
  - Firefox: `about:addons` → ClauseWatch → **Permissions** (or **Permissions and data**).

## 4. AI help with your own key

- [ ] In Settings → **AI help**, choose **My own API key (OpenAI-compatible)**, fill in **API address**, **Model** and **API key**, then click **Save**. The browser asks for access to that address (Firefox also asks to send website content); allow it.
- [ ] Read a page, then click **Summarise the quotes (AI)**. The summary cites a quote for every sentence and never says "safe".
- [ ] Set AI help to **Off** and click **Save**. AI help is off again.

## 5. Your own rules

- [ ] In Settings → **Rules**, switch a rule off, then read a page where it matched before. That finding is gone.
- [ ] On the **My rules** tab, under **Add my rule**, enter a working pattern and one example of each kind, then click **Test and save**. It saves, and finds its sentence on a page.
- [ ] On the **Import** tab, click **Export my rules**, then **Reset rules to defaults** (it asks first, and removes your own rules), then **Import a rules file** with the exported file. Your rule is back.

## 6. Other browsers

Load the Chrome build the same way in each browser below, then repeat sections 1, 2b and 3:

- [ ] Edge (`edge://extensions`)
- [ ] Brave (`brave://extensions`)
- [ ] Opera (`opera://extensions`)
- [ ] Vivaldi (`vivaldi://extensions`)

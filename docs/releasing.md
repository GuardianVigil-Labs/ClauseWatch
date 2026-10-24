# Releasing

A maintainer checklist. Only battle-tested versions are released: every check plus a real-browser run, then a maintainer test, then a tag. Tags can be created by admins only. Workflows run for pull requests and release tags (`.github/workflows/release.yml`).

## The extension

1. **Version and changelog.** In a pull request, set `version` in `package.json` (for example `1.0.1`) and add a `## [1.0.1] — <date>` entry at the top of `CHANGELOG.md`. Merge it after review.
2. **Every check, on the merged `main`:**
   ```sh
   git checkout main && git pull && npm ci
   npm run leak-guard && npm run typecheck && npm test
   npm run build && npm run build:firefox && npm run check:manifest && npm run size
   npm run check:rules
   npm run smoke
   ```
3. **Build the packages locally**, the same way the workflow does:
   ```sh
   node scripts/package-release.mjs v1.0.1
   ```
   This builds, in `.output/`:
   - `clausewatch-1.0.1-chrome.zip` (Chrome, Edge, Opera, Brave, Vivaldi);
   - `clausewatch-1.0.1-firefox.zip`;
   - `clausewatch-1.0.1-sources.zip` (Firefox's reviewers rebuild from it with `npm ci && npm run build:firefox`);
   - `SHA256SUMS`, and `RELEASE_NOTES.md` from the changelog entry.

   It refuses a tag that does not match `package.json`, or a version with no changelog entry.
4. **Smoke-test the package itself:** unzip the Chrome zip and run `SMOKE_EXT=<unzipped folder> npm run smoke` (add `SMOKE_CHANNEL=msedge` for Edge).
5. **Real-browser run.** Load each build (in Chrome, `chrome://extensions` → **Developer mode** → **Load unpacked** → `.output/chrome-mv3`; in Firefox, `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → the Firefox zip) and work through [the real-browser checklist](browser-checklist.md) in Chrome and Firefox.
6. **Maintainer test.** A maintainer installs the packaged build and uses it on real sites before the tag.
7. **Tag it:**
   ```sh
   git tag v1.0.1 && git push origin v1.0.1
   ```
   The workflow runs every check again, builds the zips and checksums, and creates the GitHub release. Only the step that publishes the release can write to the repository.
8. **Never mark an extension release Latest.** Installed extensions download `releases/latest/download/rules.signed.json`, so the latest release must always be a rules release. If one is marked by mistake, mark the newest rules release **Latest** again (Releases → the rules release → Edit → **Set as the latest release**).
9. **Upload to each store:** Chrome Web Store, Microsoft Edge Add-ons, Firefox Add-ons (with the source zip) and Opera add-ons. Listing text and permission justifications are in [STORE_LISTING.md](STORE_LISTING.md).

## Detection rules and known sites

Rule and known-site changes are merged by pull request. The GuardianVigil team does a final review, signs and releases each rules version. The extension accepts only releases signed with the key built into it, and only a version newer than the one it has.

1. Merge the rule and known-site changes to `main` (checks green, one code-owner review). A known-sites change needs a rules release too.
2. In a pull request, raise `version` in `rules/rules.json` by one, and merge it.
3. Tag `rules-v<version>`. The workflow runs the rule checks, confirms the tag matches `rules.json`'s version, and creates a draft release with `rules.json` and `sites.json`. A draft is never "latest", so installs never look for a file that is not there yet.
4. The release is published with its signed file and marked **Latest**. Installs pick it up within a day.

How installs check a release: [reader.md](reader.md#the-signed-release).

## Rolling back

Extensions refuse any rules version that is not newer than the one they have. To undo a rules release, put the previous rules back in `rules.json`, raise `version` again, and release it as above. To undo an extension release, release a new patch version.

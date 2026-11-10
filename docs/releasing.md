# Releasing ClauseWatch

Public maintainer procedure for reviewed project releases. This document does not authorize a commit, push, signing operation, tag or publication. Use only accounts and release permissions you are authorized to use. Never put signing material, credentials, machine details or private review records in the repository or release notes.

## Before a pull request

1. Review the complete source and documentation diff against [POLICY.md](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/POLICY.md), including new files, assets and proposed review text. Run the disclosure guard; do not force-add ignored outputs, exports or local notes.
2. Run the applicable [development checks](development.md#checks), including targeted mutation checks for code changes. Use [the browser checklist](browser-checklist.md) for Chrome and Firefox.
3. Reconcile README, user guide, reader contract, architecture, privacy and store descriptions with the actual code. Verify every coverage and retention claim. Keep unshipped changes under **Unreleased**.
4. Open a pull request for code-owner review. Direct pushes to `main` are not the release path.

Passing automated checks does not mean native permission prompts, a real AI provider, model availability, source highlighting, printing or every browser has been tested. Record the checks actually completed, with invented examples in any public evidence.

## Extension release

1. In a reviewed version-change pull request, update `package.json` and any affected lockfile metadata, then move the applicable **Unreleased** notes into a dated version entry. Do not package new code with an existing release's version and historical notes.
2. From the exact reviewed release commit, install from the lockfile and run:

   ```sh
   npm ci
   npm run leak-guard
   npm run typecheck
   npm test
   npm run build
   npm run build:firefox
   npm run check:manifest
   npm run size
   npm run check:rules
   npm run smoke
   ```

3. Build the packages using the matching version tag argument. For example, **only if the package version is `1.0.1`**:

   ```sh
   node scripts/package-release.mjs v1.0.1
   ```

   The script checks the tag/version and changelog entry, replaces generated `.output/`, builds browser ZIPs and the Firefox source ZIP, and writes `SHA256SUMS` and `RELEASE_NOTES.md`. The source ZIP contains build inputs selected by WXT, not a complete repository checkout; the public repository remains the reference for developer documentation and tests.
4. Inspect artifact contents. Required licences and notices must ship; logs, private files, internal links and environment metadata must not. Confirm the build has the expected optional/required permissions and the intended English and bundled language-pack versions.
5. Unpack the Chromium package and run `SMOKE_EXT=<unpacked-directory> npm run smoke`. Use a directory appropriate to your own environment; do not copy its local path into public evidence. Edge can use `SMOKE_CHANNEL=msedge` where installed.
6. Load both packaged targets, work through [the browser checklist](browser-checklist.md), and have a maintainer use the packaged build. Validate manual permission grants/revocation, PDF/visible-page fallbacks, optional storage/deletion, exports, printing, highlighting and AI settings. Simulated-provider smoke tests are not live-provider validation.
7. After approval, an authorized maintainer creates and pushes the matching extension version tag. The release workflow validates it, packages the extension, attests the store ZIPs and publishes the GitHub release. The publishing job has write permission; check/build jobs do not.
8. **Do not mark an extension release Latest.** Installed extensions request `releases/latest/download/rules.signed.json`; Latest must remain a published signed English-rule/known-site release.
9. Approve the workflow's `stores` job when GitHub asks (see [Store submission](#store-submission)). It submits the exact packages from the release to the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons. Upload the Chromium ZIP to Opera Add-ons by hand from the GitHub release: Opera has no public upload API.
10. Reconcile disclosure fields, [listing text](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/docs/STORE_LISTING.md), screenshots and the public privacy website with the submitted version in each store's dashboard. The workflow uploads packages only; repository edits do not update those external surfaces.

## Provenance

Each extension release carries `attestation.sigstore.json`, a signed [SLSA build provenance](https://slsa.dev/spec/v1.0/provenance) attestation for its ZIPs, also recorded in the repository's attestations. To check a downloaded package:

```sh
gh attestation verify clausewatch-1.0.1-chrome.zip --repo GuardianVigil-Labs/ClauseWatch
# offline, with the release's bundle:
gh attestation verify clausewatch-1.0.1-chrome.zip --repo GuardianVigil-Labs/ClauseWatch --bundle attestation.sigstore.json
```

`SHA256SUMS` lists the same files' checksums.

## Store submission

After the GitHub release is created, the `stores` job of the release workflow runs in the `browser-stores` environment. It never rebuilds: it downloads the packages built earlier in the same run, checks them against `SHA256SUMS`, and submits them. Each store is a separate matrix entry, so the run shows which store failed and a failed store can be re-run on its own with **Re-run failed jobs**. A store whose secrets are missing fails with the names of the missing secrets; tokens are masked and never printed.

| Store | Package | How |
|---|---|---|
| Chrome Web Store | `clausewatch-<version>-chrome.zip` | Chrome Web Store API v2: upload to the existing item, then publish (submits for review; publishes on approval). |
| Microsoft Edge Add-ons | `clausewatch-<version>-chrome.zip` | Edge Add-ons API v1.1 (API key): upload to the draft, then publish, polling each operation for up to 20 minutes. |
| Firefox Add-ons | `clausewatch-<version>-firefox.zip` and `-sources.zip` | `web-ext sign --channel listed` (an exact pinned version): a new listed version with the source code Mozilla's reviewers rebuild from. It does not wait for review. |
| Opera Add-ons | `clausewatch-<version>-chrome.zip` | By hand in the Opera developer dashboard. |

Pre-release tags (containing `-`, such as `v1.1.0-rc.1`) skip store submission. Each store reviews submissions on its own schedule; follow the review in its dashboard.

### One-time setup

Create a GitHub environment named `browser-stores` (**Settings → Environments**), add required reviewers, and limit its deployments to `v*` tags. Store the credentials below only as secrets of that environment, never as repository or organisation secrets. The first version of each listing is created by hand in the store's dashboard; the workflow only updates existing listings.

**Chrome Web Store**

1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Configure the OAuth consent screen, then create an OAuth client ID of type **Web application** with `https://developers.google.com/oauthplayground` as an authorised redirect URI.
3. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), choose **Use your own OAuth credentials**, authorise the scope `https://www.googleapis.com/auth/chromewebstore` with the account that publishes the item, and exchange the code for a refresh token. Publish the consent screen to production so the refresh token does not expire after seven days.
4. Secrets: `CHROME_PUBLISHER_ID` (Developer Dashboard → **Publisher → Settings**), `CHROME_EXTENSION_ID` (the item's ID), `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` and `CHROME_REFRESH_TOKEN`.

**Microsoft Edge Add-ons**

1. In Partner Center, open **Microsoft Edge → Publish API**, enable the new experience (API keys), and select **Create API credentials**.
2. Secrets: `EDGE_PRODUCT_ID` (the extension's **Product ID**, under **Extension identity** on its overview page), `EDGE_CLIENT_ID` and `EDGE_API_KEY`. API keys expire: renew the key on the same page before its expiry date and replace the secret.

**Firefox Add-ons**

1. Sign in to addons.mozilla.org with an account that is a developer of the add-on, and open **Developer Hub → Manage API Keys** to generate credentials.
2. Secrets: `AMO_JWT_ISSUER` (the JWT issuer) and `AMO_JWT_SECRET` (the JWT secret).

## English rules and known sites

English rules and `rules/sites.json` are distributed together through the signed update format in [the reader contract](reader.md#the-signed-release).

1. Submit rule/site changes by pull request with invented positive/negative fixtures and the required checks. For known-site URLs, record public document checks without account data or private policy text.
2. Raise the English rules version through review. A known-site change also needs a new English rules version.
3. An authorized maintainer creates the matching `rules-v<version>` tag. Its workflow checks the version and creates a draft release containing `rules.json` and `sites.json`.
4. The signing maintainer prepares the Ed25519 envelope outside the public repository. Only public rules, known-site data, public verification metadata and the resulting signature belong in release assets. Never commit the signing key or operational details.
5. Attach the validated `rules.signed.json` before publishing and marking the rules release Latest. Installations check at most daily and accept only a newer valid signed version. A release without a usable signature does not replace their usable rules.

## Bundled Spanish and French packs

`rules/es/` and `rules/fr/` each include a rules file and positive/negative fixtures. Their current packs cover three topics only. They are bundled with an extension release, not independently replaced by the English signed-update endpoint.

For a pack change, review the language, bump the affected pack version when appropriate, run JavaScript/Go fixture checks, and reconcile coverage messages, export metadata and the reader/cache profile. Confirm that other English topics and custom rules are not presented as checked for that language. Publish only through the extension release procedure above.

## Rollback

The verifier refuses English rule versions that are not newer than the accepted version. To restore earlier rule behaviour, review a new higher version containing the desired rules and release it normally. Extension fixes require a new extension version; do not replace an existing version's assets without a reviewed release process.

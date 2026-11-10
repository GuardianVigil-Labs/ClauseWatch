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
7. After approval, an authorized maintainer creates and pushes the matching extension version tag. The release workflow validates it, packages the extension and publishes the GitHub release. The publishing job has write permission; check/build jobs do not.
8. **Do not mark an extension release Latest.** Installed extensions request `releases/latest/download/rules.signed.json`; Latest must remain a published signed English-rule/known-site release.
9. Submit the reviewed packages to the relevant stores. Reconcile disclosure fields, [listing text](https://github.com/GuardianVigil-Labs/ClauseWatch/blob/main/docs/STORE_LISTING.md), screenshots and the public privacy website with the submitted version. Repository edits do not update those external surfaces automatically.

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

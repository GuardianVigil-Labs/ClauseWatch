#!/usr/bin/env node
// Store packages for a release: the Chromium zip (Chrome,
// Edge, Opera, Brave, Vivaldi), the Firefox zip, the source zip Firefox's
// reviewers rebuild from, SHA-256 checksums, and the changelog entry as the
// release notes. Run locally the same way the release workflow does:
//
//   node scripts/package-release.mjs v1.0.0
//
// With a tag, it refuses one that does not match package.json's version.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = process.argv[2];
// An empty argument is a tag too, and a wrong one: only no argument means a dry run.
if (tag !== undefined && tag !== `v${version}`) {
  console.error(`The tag ${tag} does not match package.json's version ${version}.`);
  process.exit(1);
}

// The changelog entry for this version is the release's notes; a release without one is refused.
const changelog = readFileSync("CHANGELOG.md", "utf8");
const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][^\\n]*\\n`, "m");
const start = changelog.search(heading);
const rest = start < 0 ? "" : changelog.slice(start).replace(heading, "");
const notes = rest.split(/^## /m)[0].trim();
if (!notes && tag !== undefined) {
  console.error(`CHANGELOG.md has no "## [${version}]" entry, or it is empty.`);
  process.exit(1);
}

const out = ".output";
rmSync(out, { recursive: true, force: true });
const run = (args) => execFileSync("npx", ["wxt", ...args], { stdio: "inherit" });
run(["zip"]);
run(["zip", "-b", "firefox", "--mv3"]);

const zips = readdirSync(out).filter((f) => f.endsWith(".zip")).sort();
const sums = zips.map((f) => `${createHash("sha256").update(readFileSync(join(out, f))).digest("hex")}  ${f}`).join("\n") + "\n";
writeFileSync(join(out, "SHA256SUMS"), sums);
writeFileSync(join(out, "RELEASE_NOTES.md"), (notes || `ClauseWatch ${version}`) + "\n");
console.log(`\n${sums}`);

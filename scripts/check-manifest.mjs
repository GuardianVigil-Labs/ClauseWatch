#!/usr/bin/env node
// The built manifests ask for no site access at install beyond the two GitHub
// hosts the daily rules download needs. Access to the sites a user visits is
// optional, requested when they turn on Automatic mode or click the button, as
// the store listing says. WXT adds a runtime content script's matches to
// host_permissions; wxt.config.ts removes them, and this fails the build if
// that ever stops happening. The permission list is pinned too: a new one
// needs a justification in docs/STORE_LISTING.md first.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const out = ".output";
const allowed = new Set(["https://github.com/*", "https://release-assets.githubusercontent.com/*"]);
const permissions = ["activeTab", "alarms", "contextMenus", "scripting", "storage"];
const builds = existsSync(out) ? readdirSync(out).filter((d) => existsSync(join(out, d, "manifest.json"))) : [];
if (builds.length === 0) {
  console.error("No build found: run `npm run build` first.");
  process.exit(1);
}
let failed = false;
for (const b of builds) {
  const m = JSON.parse(readFileSync(join(out, b, "manifest.json"), "utf8"));
  const extra = (m.host_permissions ?? []).filter((p) => !allowed.has(p));
  if (extra.length) {
    console.error(`${b}: host access asked for at install: ${extra.join(", ")}`);
    failed = true;
  } else console.log(`${b}: no site access at install beyond the rules download.`);
  const asked = [...(m.permissions ?? [])].sort();
  if (JSON.stringify(asked) !== JSON.stringify(permissions)) {
    console.error(`${b}: permissions ${asked.join(", ")}; expected ${permissions.join(", ")}`);
    failed = true;
  }
  if (m.web_accessible_resources) {
    console.error(`${b}: no web-accessible resources`);
    failed = true;
  }
  // Rule signatures need WebCrypto Ed25519.
  const min = b.startsWith("firefox") ? m.browser_specific_settings?.gecko?.strict_min_version : m.minimum_chrome_version;
  const need = b.startsWith("firefox") ? 140 : 137;
  if (!(parseInt(min, 10) >= need)) {
    console.error(`${b}: minimum browser version must be at least ${need} (found ${min ?? "none"})`);
    failed = true;
  }
  // The licence ships with every build (Apache-2.0 §4).
  for (const f of ["LICENSE", "NOTICE"]) {
    if (!existsSync(join(out, b, f))) {
      console.error(`${b}: ${f} is missing from the build`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);

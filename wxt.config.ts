import { resolve } from "node:path";
import { defineConfig } from "wxt";

// Permissions, each justified in docs/STORE_LISTING.md:
// - activeTab + scripting: read the current page, only after the user clicks
//   the button or the right-click menu.
// - contextMenus: "check this terms link" and "check selected text".
// - optional host access: asked for one site at a time, at the moment the user
//   chooses to read that site's terms, or for all sites when they turn on
//   automatic mode; never granted at install.
// - storage: settings, own rules and the signed rules update, on the device.
// - alarms: the daily rules check (and automatic mode's script kept in step).
// - the two GitHub hosts: the daily download of the latest signed rules
//   release, which redirects from github.com to GitHub's file storage. These
//   hosts send no CORS headers, so the extension needs access to both.
const RULES_HOSTS = ["https://github.com/*", "https://release-assets.githubusercontent.com/*"];

const pdfjsGlobalThis = () => ({
  name: "pdfjs-global-this",
  transform(code: string, id: string) {
    if (!id.includes("pdfjs-dist/legacy/build/")) return null;
    const out = code.replaceAll("Function('return this')()", "globalThis");
    return out === code ? null : { code: out, map: null };
  },
});

export default defineConfig({
  srcDir: ".",
  // Store packages. The source zip lets Firefox's reviewers rebuild the
  // exact build: only what the build needs, nothing private or generated.
  zip: {
    includeSources: ["entrypoints", "src", "public", "rules", "package.json", "package-lock.json", "tsconfig.json", "wxt.config.ts", "README.md", "LICENSE", "NOTICE"],
    excludeSources: ["**/*.test.ts"],
  },
  entrypointsDir: "entrypoints",
  // PDF.js's legacy build bundles core-js, whose last-resort global lookup is
  // Function("return this")(). Every supported browser has globalThis, so the
  // fallback is replaced and no string-to-code call ships (check-manifest.mjs).
  vite: () => ({ plugins: [pdfjsGlobalThis()], worker: { plugins: () => [pdfjsGlobalThis()] } }),
  manifest: ({ browser }) => ({
    name: "ClauseWatch",
    description: "Shows what a service's terms and privacy policy say, quoted, at sign-up.",
    permissions: ["activeTab", "scripting", "storage", "alarms", "contextMenus"],
    // A copy: WXT adds to this list, and the hook below filters by the original.
    host_permissions: [...RULES_HOSTS],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    // Firefox keeps the add-on's id fixed across updates. Data collection is
    // declared for Firefox: none required; AI help with the person's own key
    // is optional (docs/STORE_LISTING.md).
    // Minimum versions: rule signatures are checked with WebCrypto
    // Ed25519, on by default from Chrome 137 and Firefox 129; Firefox's data
    // collection declaration needs 140 (142 on Android). An older browser cannot
    // verify rules.
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "clausewatch@guardianvigil.io",
              strict_min_version: "140.0",
              // websiteContent: AI help with the person's own key sends their chosen
              // AI service the text being checked (the document, or text they pasted
              // or selected, up to 24,000 characters), or only the quotes for a summary.
              data_collection_permissions: { required: ["none"], optional: ["websiteContent"] },
            },
            // Firefox for Android declares data collection from 142.
            gecko_android: { strict_min_version: "142.0" },
          },
        }
      : { minimum_chrome_version: "137" }),
    action: { default_title: "ClauseWatch: read this site's terms" },
  }),
  hooks: {
    // WXT copies a runtime-registered content script's matches into the
    // required host_permissions, which would ask for every site at install.
    // Site access is optional and asked for when the user turns it on.
    "build:manifestGenerated": (_wxt, manifest) => {
      manifest.host_permissions = (manifest.host_permissions ?? []).filter((p: string) => RULES_HOSTS.includes(p));
    },
    // The licence travels with the installed extension, not only the source zip.
    "build:publicAssets": (wxt, assets) => {
      for (const f of ["LICENSE", "NOTICE"]) assets.push({ absoluteSrc: resolve(wxt.config.root, f), relativeDest: f });
      for (const [pkg, file] of [["tldts", "LICENSE"], ["tldts-core", "LICENSE"], ["tinyld", "license"], ["pdfjs-dist", "LICENSE"]]) {
        assets.push({ absoluteSrc: resolve(wxt.config.root, "node_modules", pkg!, file!), relativeDest: `licenses/${pkg}.txt` });
      }
    },
  },
});

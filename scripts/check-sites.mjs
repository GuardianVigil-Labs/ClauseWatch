#!/usr/bin/env node
// Schema check for rules/sites.json, run by `npm run check:rules` and by
// the tests. The same check the extension applies to a signed update
// (src/engine/known-sites.ts), so a list that passes here is one it accepts.

import { readFileSync } from "node:fs";
import { sitesProblem } from "../src/engine/known-sites.ts";

const path = process.argv[2] ?? "rules/sites.json";
let data;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`${path}: not valid JSON (${e instanceof Error ? e.message : e})`);
  process.exit(1);
}
const extra = Object.keys(data ?? {}).filter((k) => k !== "sites");
const problem = extra.length ? `unknown field "${extra[0]}"` : sitesProblem(data?.sites);
if (problem) {
  console.error(`${path}: ${problem}`);
  process.exit(1);
}
console.log(`${path}: ${data.sites.length} known sites, all well formed.`);

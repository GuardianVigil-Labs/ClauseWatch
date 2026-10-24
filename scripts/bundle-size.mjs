#!/usr/bin/env node
// Records the built extension's size per browser. In CI the
// table also goes to the job summary, so growth is visible on every PR.

import { appendFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const out = ".output";
if (!existsSync(out)) {
  console.error("No build found: run `npm run build` first.");
  process.exit(1);
}
const size = (dir) => readdirSync(dir).reduce((n, f) => {
  const p = join(dir, f);
  return n + (statSync(p).isDirectory() ? size(p) : statSync(p).size);
}, 0);
const rows = readdirSync(out)
  .filter((d) => statSync(join(out, d)).isDirectory())
  .map((d) => [d, size(join(out, d))]);
const table = ["| Build | Size |", "|---|---|", ...rows.map(([d, n]) => `| ${d} | ${(n / 1024).toFixed(1)} KiB |`)].join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle size\n\n${table}\n`);

#!/usr/bin/env node
// Mutation testing: plants one small bug at a time in the code
// the tests should guard (a flipped comparison, condition or boolean) and runs
// the tests. A bug the tests do not notice "survives": a gap to close with a
// test, or a change that does not matter (say why in the pull request).
//
//   npm run mutation                     # the security-relevant files below
//   npm run mutation -- src/ui/sites.ts  # just these files (e.g. a PR's changes)
//
// The file under test is copied to .mutation-backup/ before it is changed and
// restored after every mutant. The folder is also the lock: a second run, or a
// run after one was killed, refuses to start until `npm run mutation --
// --restore` puts the backed-up files back. Dependency-free: tools that mutate
// through the test runner do not work with this Vitest version.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const DEFAULT_FILES = [
  "src/engine/rules.ts",
  "src/engine/rule-set.ts",
  "src/engine/verify.ts",
  "src/engine/rules-update.ts",
  "src/engine/pattern-check.ts",
  "src/engine/documents.ts",
  "src/engine/known-sites.ts",
  "src/ui/scan.ts",
  "src/ai/validate.ts",
  "src/ai/summary.ts",
  "src/ai/verdict.ts",
  "src/auto/background.ts",
  "src/ui/share.ts",
  "src/ui/sites.ts",
];

// Each operator flip, tried at every place it occurs on a line, one at a time.
// Lookarounds keep `=>`, `<=`, `>=`, `!==` and the like from being cut in half.
const FLIPS = [
  [/===/g, "!=="],
  [/!==/g, "==="],
  [/(?<![=!<>])==(?!=)/g, "!="],
  [/!=(?!=)/g, "=="],
  [/<=/g, "<"],
  [/>=/g, ">"],
  [/(?<![<=>-])<(?![=<])/g, "<="],
  [/(?<![=>-])>(?![=>])/g, ">="],
  [/&&/g, "||"],
  [/\|\|/g, "&&"],
  [/\btrue\b/g, "false"],
  [/\bfalse\b/g, "true"],
  [/!(?=[\w(.])/g, ""],
];

const BACKUP = ".mutation-backup";
const backupOf = (f) => join(BACKUP, f.replaceAll("/", "__"));
const restoreBackups = () => {
  for (const name of readdirSync(BACKUP)) copyFileSync(join(BACKUP, name), name.replaceAll("__", "/"));
  rmSync(BACKUP, { recursive: true });
};

if (process.argv.includes("--restore")) {
  if (existsSync(BACKUP)) restoreBackups();
  console.log("Restored.");
  process.exit(0);
}
try {
  mkdirSync(BACKUP);
} catch {
  console.error(`${BACKUP}/ exists: another run is going, or one was stopped. If none is running, run \`npm run mutation -- --restore\`.`);
  process.exit(1);
}
const files = process.argv.slice(2).filter((f) => f.endsWith(".ts"));
const targets = [...new Set(files.length ? files : DEFAULT_FILES)];
let stopped = false;
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => (stopped = true));

// A line worth mutating: code, not a comment, an import or a type-only line.
const skip = (line) => /^\s*(\/\/|\*|\/\*|import |export type |type |interface )/.test(line) || /^\s*$/.test(line);

// Positions on a line that are code: not inside a string, a template, a
// trailing comment or a block comment (whose state carries across lines).
let inBlock = false;
function codeMask(line) {
  const code = new Array(line.length).fill(false);
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inBlock) {
      if (c === "*" && line[i + 1] === "/") (inBlock = false), i++;
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && line[i + 1] === "/") break;
    if (c === "/" && line[i + 1] === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    code[i] = true;
  }
  return code;
}

/** Runs the unit tests: "fail", "pass", or "stopped" when a signal ended them. */
function runTests() {
  const r = spawnSync("npx", ["vitest", "run", "--reporter=dot", "--bail=1"], { stdio: "ignore", timeout: 120000 });
  const timedOut = r.error?.code === "ETIMEDOUT"; // a mutant that hangs the tests is caught
  if (stopped || (!timedOut && (r.signal || r.error))) return "stopped";
  if (timedOut) return "fail";
  return r.status === 0 ? "pass" : "fail";
}

let killed = 0;
const survived = [];
let aborted = "";
try {
  // Without a passing suite every mutant would look caught.
  const base = runTests();
  if (base !== "pass") aborted = base === "stopped" ? "stopped" : "the tests fail without any mutant; fix them first";
  for (const file of targets) {
    if (aborted) break;
    const text = readFileSync(file, "utf8");
    copyFileSync(file, backupOf(file));
    const lines = text.split("\n");
    inBlock = false;
    for (let i = 0; i < lines.length && !aborted; i++) {
      const code = codeMask(lines[i]);
      if (skip(lines[i])) continue;
      for (const [re, to] of FLIPS) {
        for (const m of lines[i].matchAll(re)) {
          if (aborted || !code[m.index]) continue;
          const mutated = lines[i].slice(0, m.index) + to + lines[i].slice(m.index + m[0].length);
          if (mutated === lines[i]) continue;
          writeFileSync(file, [...lines.slice(0, i), mutated, ...lines.slice(i + 1)].join("\n"));
          const result = runTests();
          writeFileSync(file, text);
          if (result === "stopped") aborted = "stopped";
          else if (result === "fail") killed++;
          else survived.push({ file, line: i + 1, from: lines[i].trim(), to: mutated.trim() });
        }
      }
    }
  }
} finally {
  restoreBackups();
}
if (aborted) {
  console.error(`Mutation run ${aborted === "stopped" ? "stopped; every file is restored" : "not started: " + aborted}.`);
  process.exit(1);
}

const total = killed + survived.length;
console.log(`\nMutants: ${total}, killed: ${killed}, survived: ${survived.length} (score ${total ? Math.round((killed / total) * 100) : 100}%)\n`);
for (const s of survived) console.log(`${s.file}:${s.line}\n  - ${s.from}\n  + ${s.to}`);

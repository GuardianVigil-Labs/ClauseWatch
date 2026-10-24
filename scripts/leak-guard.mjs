#!/usr/bin/env node
// Leak guard: fails when a tracked file contains something POLICY.md forbids:
// personal data, local paths, credentials or non-public information.
//
//   node scripts/leak-guard.mjs              scan every tracked file
//   node scripts/leak-guard.mjs --self-test  prove each check still catches
//
// Structural checks only: local paths, email addresses outside the allowed
// domains, private network addresses, private keys and credential-shaped
// tokens.
//
// A self-test runs first in CI. A guard that matches nothing reports success,
// which is why the self-test must prove every check still fires.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Files that may contain example patterns on purpose.
const SKIP = new Set(["package-lock.json"]);

// Documentation ranges (RFC 5737) and loopback are fine in examples.
const ALLOWED_IPS = [/^127\./, /^0\.0\.0\.0$/, /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
// Invented example domains and the project's public contact address.
const ALLOWED_EMAIL = (m) => /@([a-z0-9-]+\.)*(example|example\.(com|org|net)|test|invalid|localhost)$/i.test(m) || m.toLowerCase() === "clausewatch@guardianvigil.io";

const PATTERNS = [
  { name: "local path", re: /(?:\/home\/[a-z_][\w.-]*|\/Users\/[A-Za-z][\w.-]*|[A-Za-z]:\\Users\\[\w.-]+)/g },
  { name: "email address", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, allow: ALLOWED_EMAIL },
  { name: "IPv4 address", re: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, allow: (m) => ALLOWED_IPS.some((r) => r.test(m)) },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "cloud access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { name: "API secret key", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

export function findings(text) {
  const out = [];
  for (const { name, re, allow } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (allow && allow(m[0])) continue;
      out.push({ check: name, match: m[0].slice(0, 12) + "…" });
    }
  }
  return out;
}

function scan() {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  let bad = 0;
  for (const f of files) {
    if (SKIP.has(f)) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const x of findings(text)) {
      bad++;
      console.error(`${f}: ${x.check} ${x.match}`);
    }
  }
  if (bad) {
    console.error(`\n${bad} finding(s). POLICY.md: never commit personal data, local paths, credentials or non-public information.`);
    process.exit(1);
  }
  console.log(`Leak guard: ${files.length} tracked file(s) clean.`);
}

function selfTest() {
  // Each sample is assembled at run time so this file is not itself a finding.
  const j = (...parts) => parts.join("");
  const cases = [
    ["local path", j("/ho", "me/someone/project")],
    ["local path, Windows", j("C:", "\\Users\\someone")],
    ["email address", j("someone", "@", "mail.invalid-provider.org")],
    ["IPv4 address", j("connect to 10", ".20.30", ".40")],
    ["private network address", j("192", ".168", ".1.20")],
    ["private key", j("-----BEGIN ", "RSA PRIVATE", " KEY-----")],
    ["cloud access key", j("AKIA", "ABCDEFGHIJKLMNOP")],
    ["GitHub token", j("ghp", "_", "a".repeat(36))],
    ["API secret key", j("sk-", "ant-", "b".repeat(24))],
    ["JSON web token", j("eyJ", "e".repeat(12), ".", "f".repeat(12), ".", "g".repeat(12))],
  ];
  const clean = ["a documentation address 192.0.2.10 and 127.0.0.1", "ClauseWatch shows quotes from terms of service", "write to alice@corp.example or clausewatch@guardianvigil.io"];
  let failed = 0;
  for (const [label, text] of cases) {
    if (findings(text).length === 0) {
      failed++;
      console.error(`self-test: missed ${label}`);
    }
  }
  for (const text of clean) {
    if (findings(text).length !== 0) {
      failed++;
      console.error(`self-test: false positive on ${JSON.stringify(text)}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`Self-test passed: ${cases.length} catches, ${clean.length} clean samples.`);
}

// Run only when executed, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else scan();
}

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Policy for the workflows, read as text: the release workflow submits to the
// browser stores, so its guard rails are checked on every pull request.
const dir = ".github/workflows";
const release = readFileSync(`${dir}/release.yml`, "utf8");

// Top-level jobs: two-space-indented keys under `jobs:`.
const jobs: Record<string, string> = Object.fromEntries(
  release
    .slice(release.indexOf("\njobs:\n"))
    .split(/\n(?=  [a-z-]+:\n)/)
    .slice(1)
    .map((block) => [block.match(/^ {2}([a-z-]+):/)![1], block]),
);

describe("release workflow", () => {
  it("pins every action to a full commit SHA with a version comment", () => {
    for (const file of readdirSync(dir)) {
      for (const line of readFileSync(`${dir}/${file}`, "utf8").split("\n").filter((l) => /^\s*(- )?uses:/.test(l))) {
        expect(line, `${file}: ${line.trim()}`).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/);
      }
    }
  });

  it("runs only for tags", () => {
    expect(release).toMatch(/^on:\n {2}push:\n {4}tags: \["v\*", "rules-v\*"\]\n\n/m);
  });

  it("never marks a release Latest", () => {
    const creates = release.split("gh release create").slice(1).map((rest) => rest.split("\n\n")[0]!);
    expect(creates).toHaveLength(2);
    for (const command of creates) expect(command).toMatch(/--latest=false(\s|$)/);
    expect(release).not.toMatch(/--latest(?!=false)/);
  });

  it("submits to the stores only from the browser-stores environment, after the release, for final version tags", () => {
    const stores = jobs.stores!;
    expect(stores).toMatch(/\n {4}needs: \[package, publish\]\n/);
    expect(stores).toMatch(/\n {4}if: startsWith\(github\.ref, 'refs\/tags\/v'\) && !contains\(github\.ref_name, '-'\)\n/);
    expect(stores).toMatch(/\n {4}environment: browser-stores\n/);
    expect(stores).toMatch(/\n {4}permissions: \{\}\n/);
    expect(stores).toMatch(/\n {6}fail-fast: false\n/);
    expect(stores).not.toMatch(/actions\/checkout|npm ci|npm run/);
  });

  it("uses store secrets nowhere outside the stores job", () => {
    const names = /secrets\.(CHROME|EDGE|AMO)_/;
    expect(jobs.stores).toMatch(names);
    for (const [name, block] of Object.entries(jobs)) {
      if (name !== "stores") expect(block, name).not.toMatch(/secrets\./);
    }
    for (const file of readdirSync(dir).filter((f) => f !== "release.yml")) {
      expect(readFileSync(`${dir}/${file}`, "utf8"), file).not.toMatch(/secrets\./);
    }
  });

  it("attests the store packages and attaches the bundle to the release", () => {
    expect(jobs.publish).toMatch(/uses: actions\/attest@[0-9a-f]{40} # v\d/);
    expect(jobs.publish).toMatch(/subject-path: packages\/\*\.zip/);
    expect(jobs.publish).toMatch(/gh release create[^\n]*packages\/attestation\.sigstore\.json/);
  });

  it("keeps write permissions out of the jobs that run repository code", () => {
    expect(release).toMatch(/^permissions:\n {2}contents: read\n/m);
    for (const name of ["package", "rules-check"]) expect(jobs[name], name).not.toMatch(/permissions:/);
    for (const block of Object.values(jobs)) {
      if (block.includes("actions/checkout")) expect(block).toMatch(/persist-credentials: false/);
    }
  });
});

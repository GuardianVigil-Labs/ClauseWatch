import { describe, it, expect } from "vitest";
import { patternProblem, smallestPeriod } from "../src/engine/pattern-check";
import { compileRules, type RulesFile } from "../src/engine/rules";
import bundled from "../rules/rules.json";

// Patterns that can freeze a browser are refused before they compile.

describe("patternProblem", () => {
  it.each([
    ["(a+)+", "repeated group"],
    ["(a|aa)*", "repeated group"],
    ["(\\w+\\s?)*$", "repeated group"],
    ["(x*){2,9}", "repeated group"],
    ["(.*a){20}", "bounded"],
    ["(\\w+a){20}", "repeated group"],
    [".*secret", "bounded"],
    ["[^.]+ waive", "bounded"],
    ["x{0,500}", "at most {0,200}"],
    ["(?=a)a", "lookaround"],
    ["(?i)a", "does not compile"],
    ["(?i:a)b", "lookaround"],
    ["(a)\\1", "backreferences"],
    ["a**", "does not compile"],
    ["(ab", "does not compile"],
    ["ab)", "does not compile"],
    ["[ab", "does not compile"],
    ["a{3,1}", "does not compile"],
    ["", "non-empty"],
    ["a".repeat(401), "at most 400"],
    ["\\w*\\w*\\w*x", "open-ended repeats"],
    ["\\w+\\s*\\w+\\s*\\w+x", "open-ended repeats"],
    ["a*a*a*a*b", "open-ended repeats"],
    ["[a-z]+[a-z]+[a-z]+!", "open-ended repeats"],
    ["\\s+\\s+\\s+x", "open-ended repeats"],
    ["(\\w+|x)\\w+y", "open-ended repeats"],
    ["\\w+(a)?\\w+y", "open-ended repeats"],
    ["[^.]{0,200}[^.]{0,200}[^.]{0,200}x", "multiply"],
    ["\\w{0,20}\\w{0,20}\\w{0,20}\\w{0,20}x", "multiply"],
    // Classes starting with "]", repeated groups, and escapes the engines read differently.
    ["[^](a+)+]", "\\]"],
    ["[]|(a+)+b[)]", "\\]"],
    ["((a|aa))+b", "repeated group"],
    ["\u2014+\u2014+\u2014+\u2014+b", "open-ended repeats"],
    [".{0,200}\u2014.{0,200}\u2014.{0,200}b", "multiply"],
    ["[\\w ]+[\\w ]+\\b", "open-ended repeats"],
    ["(.)*secret", "bounded repeat"],
    ["([^.])+ waive", "bounded repeat"],
    ["\\s+\\s+\\s+$", "open-ended repeats"],
    ["\\s*\\s*\\s*\\s*!x", "open-ended repeats"],
    ["[\\s\\S]+[\\s\\S]+[\\s\\S]+x", "open-ended repeats"],
    ["\\w+\\d*\\w*\\w+x", "open-ended repeats"],
    ["\\w*?\\w*?\\w*?x", "open-ended repeats"],
    ["(\\w+)?(\\w+)?(\\w+)?x", "open-ended repeats"],
    ["(a|a)?".repeat(25) + "a".repeat(25) + "b", "multiply"],
    ["(a|aa)?".repeat(30) + "b", "multiply"],
    ["(a){0,200}(a){0,200}x", "multiply"],
    ["\\pL+", "escape"],
    ["\\Abinding", "escape"],
    ["caf\\u00e9", "escape"],
    // Repeated alternatives, and bounded repeats around a long literal.
    ["(a|a)".repeat(22) + "b", "multiply"],
    ["(\\w|\\d)".repeat(20) + "!", "multiply"],
    ["\\w*[a-z]+\\b", "open-ended repeats"],
    ["\\w*(ab)+\\b", "open-ended repeats"],
    ["[\\xe1!]+[\\xe1?]+x", "escape"],
    ["[\u00e1-\u00ff]+x", "printable ASCII"],
    [".{1,100}(ab){0,5}[\\s-][\\s-]*(a?b)\\.", "open-ended repeats"],
    // Bounded repeats side by side, fast enough per character only under the lower limit.
    ["a{0,50}\\w{0,50}!", "at or under 1,000"],["a{0,19}\\w{0,50}!", "at or under 1,000"],
    ["[\\s-]{0,50}.{0,50}\\d!", "at or under 1,000"],["\\w{0,200}(" + Array.from({ length: 15 }, (_, i) => "a".repeat(i + 1)).join("|") + ")!", "at or under 3,000"],
    // A literal run repeated between open repeats lines up almost everywhere.
    ["\\w{0,200}" + "a".repeat(70) + "\\w{0,200}" + "a".repeat(70) + "\\w{0,200}!", "multiply"],
    ["(a?|b)aa".repeat(20) + "c", "multiply"],
    ["(a?)aa".repeat(20) + "c", "multiply"],
    ["\\w{0,200}" + "ab".repeat(30) + "\\w{0,200}" + "ab".repeat(30) + "\\w{0,200}!", "multiply"],
    ["\\w{0,200}" + "a".repeat(40) + "\\w{0,200}!", "multiply"],
    // Many optional groups of alternatives in a row.
    ["((b|aa))?((c|aa))?((d|aa))?((e|aa))?((f|aa))?((g|aa))?((h|aa))?((i|aa))?((j|aa))?((k|aa))?((l|aa))?((m|aa))?((n|aa))?((o|aa))?((p|aa))?b", "multiply"],
    ["\\w{0,80}(ab)(ab)(ab)(ab)(ab)(ab)\\w{0,80}(ab)(ab)(ab)(ab)(ab)(ab)\\w{0,80}c", "multiply"],
    ["[a9]{0,40}(9|9|\\B)[a8]{0,40}(8|8|\\B)a+b", "multiply"],
    ["[a\\r]{0,80}[b\\r]{0,80}[c\\r]{0,80}!", "multiply"],
    ["[!-\\xe1]+", "plain printable"],
    ["[!-\\u00ff]+", "plain printable"],
    ["[\\n-z]", "plain printable"],
  ])("refuses %s", (p, why) => {
    expect(patternProblem(p)).toContain(why);
  });

  it.each([
    "\\bbinding\\s+(individual\\s+)?arbitration\\b",
    "\\barbitration\\b[^.]{0,120}\\b(final and binding|is binding)\\b",
    "\\b(train|fine-tun\\w*)\\b",
    "(ab)+c",
    "[\\s-]*sell",
    "a{2}b{1,3}",
    "price \\{ list",
    "\\w*\\s+\\w*x",
    "[^.]{0,50}\\bupon\\b[^.]{0,50}\\b(post|publish\\w*)\\b",
    "\\(?s\\) apply",
    "[(?] mark",
    "a\\.b\\-c\\]",
    "\\b(sell|share|rent)s?\\b",
    "\\bauto(matic(ally)?)?[- ]?renew",
    "\\bwe\\s+(do\\s+not|don['\u2019]t)\\s+sell\\b",
    "x\\w*\\b",
    "\\b(we|us)\\b[^.]{0,50}\\b(sell|rent)\\b",
    "\\b(share[sd]?|sharing)\\b[^.]{0,80}\\bthird[- ]part(y|ies)\\b",
    // The limits themselves: 20 x 50 repeats is 1,000; 200 x 15 alternatives is 3,000.
    "a{0,19}\\w{0,49}!",
    "\\w{0,200}(" + Array.from({ length: 14 }, (_, i) => "a".repeat(i + 1)).join("|") + ")!",
    "\\w{0,199}(" + Array.from({ length: 15 }, (_, i) => "a".repeat(i + 1)).join("|") + ")!", // exactly 3,000
  ])("accepts %s", (p) => {
    expect(patternProblem(p)).toBeNull();
  });

  it("accepts every bundled rule", () => {
    const file = bundled as unknown as RulesFile;
    for (const r of file.rules) for (const p of [...r.all, ...r.none]) expect(patternProblem(p), `${r.id}: ${p}`).toBeNull();
  });

  it("is enforced by compileRules", () => {
    const file: RulesFile = { version: 1, flags: "i", minQuoteWords: 1, categories: ["a"], rules: [{ id: "bad", category: "a", all: ["(a+)+b"], none: [] }] };
    expect(() => compileRules(file)).toThrow(/bad: a repeated group/);
  });

  it("bundled patterns stay fast on hostile text", () => {
    const file = compileRules(bundled as unknown as RulesFile);
    const hostile = ["a".repeat(5000), " ".repeat(5000), "a ".repeat(2500), "binding ".repeat(600) + "!", "-".repeat(5000)];
    for (const r of file.rules) {
      for (const re of [...r.all, ...r.none]) {
        for (const s of hostile) {
          const t = performance.now();
          re.test(s);
          expect(performance.now() - t, `${r.id} ${re}`).toBeLessThan(50);
        }
      }
    }
  });

  // Random patterns from a small grammar: whatever the check accepts must
  // stay fast on hostile text. A fixed seed keeps the run repeatable.
  it("accepted random patterns are fast on hostile text", () => {
    let seed = 0x5eed;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const atoms = ["a", "b", "x", " ", "\\w", "\\s", "\\d", ".", "[a-z]", "[^.]", "[\\s-]", "(ab)", "(a|b)", "(a|a)", "(\\w|\\d)", "(a\\s)", "\\b"];
    const quants = ["", "", "?", "*", "+", "{0,5}", "{0,50}", "{1,200}", "{2,}"];
    const hostile = ["a".repeat(3000) + "!", " ".repeat(3000) + "!", "ab ".repeat(1000) + "!", "a1 ".repeat(1000) + "."];
    let accepted = 0;
    for (let n = 0; n < 4000; n++) {
      let p = "";
      for (let k = 2 + rnd(5); k > 0; k--) p += atoms[rnd(atoms.length)]! + quants[rnd(quants.length)]!;
      p += ["!", "x", "\\.", ""][rnd(4)];
      if (patternProblem(p) !== null) continue;
      accepted++;
      const re = new RegExp(p, "i");
      for (const s of hostile) {
        // The best of three, so a busy machine does not fail a fast pattern;
        // a blow-up is slow every time.
        let best = Infinity;
        for (let r = 0; r < 3 && best >= 100; r++) {
          const t = performance.now();
          re.test(s);
          best = Math.min(best, performance.now() - t);
        }
        expect(best, p).toBeLessThan(100);
      }
    }
    expect(accepted).toBeGreaterThan(300); // the grammar still exercises accepted shapes
  });

  it("smallestPeriod", () => {
    expect([smallestPeriod("aaaa"), smallestPeriod("abab"), smallestPeriod("sell"), smallestPeriod("third"), smallestPeriod("abcab")]).toEqual([1, 2, 4, 5, 3]);
  });
});

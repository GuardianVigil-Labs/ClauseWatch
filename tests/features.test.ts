import { describe, it, expect } from "vitest";
import es from "../rules/es/rules.json";
import fr from "../rules/fr/rules.json";
import esFixtures from "../rules/es/rules_fixtures.json";
import frFixtures from "../rules/fr/rules_fixtures.json";
import { compileRules, ruleMatches, type RulesFile } from "../src/engine/rules";
import { BUNDLED } from "../src/engine/bundled";
import { readDocument } from "../src/engine/documents";
import { diagnostics, reportText, compareClauses, reportTools } from "../src/ui/report-tools";
import { reportCards } from "../src/ui/report";
import { cleanSaved } from "../src/storage-retention";

const base=compileRules(BUNDLED);
const text="We may sell your personal information to partners only when you explicitly consent.";
const doc=readDocument("privacy","https://policy.example/privacy",`Privacy Policy\n\n${text}`,"text/plain",base);

describe("localized rule packs",()=>{
  for(const [lang,file,fixtures] of [["es",es,esFixtures],["fr",fr,frFixtures]] as const){
    it(`${lang} agrees on every positive and negative fixture`,()=>{
      const compiled=compileRules(file as RulesFile);
      for(const rule of compiled.rules){const examples=(fixtures.fixtures as Record<string,{match:string[];noMatch:string[]}>)[rule.id]!;expect(examples).toBeDefined();for(const s of examples.match)expect(ruleMatches(rule,s)).toBe(true);for(const s of examples.noMatch)expect(ruleMatches(rule,s)).toBe(false);}
    });
  }
  it("recognizes Spanish policies and checks only the pack's declared categories",()=>{
    const result=readDocument("privacy","https://policy.example/es",'<html lang="es"><h1>Política de privacidad</h1><p>Podemos vender sus datos personales a nuestros socios comerciales con su consentimiento.</p></html>',"text/html",base);
    expect(result.status).toBe("read");if(result.status!=="read")return;
    expect(result.coverage?.status).toBe("supported");expect(result.categories.map((c)=>c.category).sort()).toEqual(["arbitration","auto_renewal","data_sale"]);
    expect(result.categories.find((c)=>c.category==="data_sale")?.status).toBe("found");
  });
  it("recognizes French terms",()=>expect(readDocument("terms","",'<html lang="fr"><h1>Conditions générales</h1><p>Votre abonnement sera renouvelé automatiquement chaque mois jusqu’à votre demande de résiliation.</p></html>',"text/html",base).status).toBe("read"));
});

describe("report verification and exports",()=>{
  it("offers source highlighting and surrounding text for every rule finding",()=>{
    const cards=reportCards({site:"policy.example",documents:[doc]});
    const finding=cards.find((c)=>c.tagName==="ARTICLE")!;
    expect(finding.textContent).toContain("Show surrounding text");
    expect(finding.querySelector("a")?.href).toContain(":~:text=");
  });
  it("exports sources, dates, version, coverage, full quotations and their qualifications",()=>{
    const report=reportText("policy.example",[doc],4);
    expect(report).toContain(text);expect(report).toContain("https://policy.example/privacy");expect(report).toContain("version: 4");expect(report).toContain("Language/coverage");expect(report).toContain("Read:");
  });
  it("diagnostics exclude raw quotes, URLs, HTML, settings and credentials",()=>{
    const output=JSON.stringify(diagnostics([doc], [{state:"complete",at:0,updated:1}],4));
    expect(output).not.toContain("policy.example");expect(output).not.toContain(text);expect(output).not.toContain("body");expect(output).not.toContain("apiKey");expect(output).toContain("findings");
  });
  it("shows exact added/removed paragraphs without claiming reordered text is rewritten",()=>{
    expect(compareClauses("Old clause.\n\nSame clause.","Same clause.\n\nNew clause.")).toEqual({removed:["Old clause."],added:["New clause."]});
    expect(compareClauses("A.\n\nB.","B.\n\nA.")).toEqual({removed:[],added:[]});
  });
  it("does not store policy text before explicit opt-in",()=>{
    const tools=reportTools("policy.example",[doc],base);expect(tools.textContent).toContain("Off by default");expect(tools.textContent).toContain("Delete saved policy versions");
  });
  it("expires each saved version independently, and deletes versions when disabled",async()=>{
    const now=40*864e5;const mem=new Map<string,unknown>([["latestReport",{at:0}], ["policyVersionsEnabled",true],["policyVersions",[[{at:new Date(0).toISOString(),body:"expired"},{at:new Date(now).toISOString(),body:"fresh"}]]]]);
    const kv={get:async(k:string)=>mem.get(k),set:async(k:string,v:unknown)=>{mem.set(k,v);},remove:async(k:string)=>{mem.delete(k);}};
    await cleanSaved(kv,now);expect(mem.has("latestReport")).toBe(false);expect(mem.get("policyVersions")).toEqual([[{at:new Date(now).toISOString(),body:"fresh"}]]);
    mem.set("policyVersionsEnabled",false);await cleanSaved(kv,now);expect(mem.has("policyVersions")).toBe(false);
  });
});

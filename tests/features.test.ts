import { describe, it, expect, vi } from "vitest";
import es from "../rules/es/rules.json";
import fr from "../rules/fr/rules.json";
import esFixtures from "../rules/es/rules_fixtures.json";
import frFixtures from "../rules/fr/rules_fixtures.json";
import { compileRules, ruleMatches, type RulesFile } from "../src/engine/rules";
import { BUNDLED } from "../src/engine/bundled";
import { readDocument } from "../src/engine/documents";
import { diagnostics, reportText, compareClauses, reportTools, versionDocuments } from "../src/ui/report-tools";
import { readSelection } from "../src/engine/documents";
import { mergeRules, type OwnRule } from "../src/engine/rule-set";
import { languageRules, TRANSLATES } from "../src/engine/language-packs";
import { reportCards } from "../src/ui/report";
import { applyVersionEdit, cleanSaved } from "../src/storage-retention";

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
    const result=readDocument("privacy","https://policy.example/es",'<html lang="es"><h1>Política de privacidad</h1><p>Esta política explica cómo recopilamos, usamos y compartimos sus datos personales cuando utiliza nuestro servicio. Recopilamos la información que nos proporciona al crear una cuenta, como su nombre y dirección de correo electrónico.</p><p>Podemos vender sus datos personales a nuestros socios comerciales con su consentimiento.</p></html>',"text/html",base);
    expect(result.status).toBe("read");if(result.status!=="read")return;
    expect(result.coverage?.status).toBe("supported");expect(result.categories.map((c)=>c.category).sort()).toEqual(["arbitration","auto_renewal","data_sale"]);
    expect(result.categories.find((c)=>c.category==="data_sale")?.status).toBe("found");
  });
  it("applies the person's switched-off rules and own rules to language packs",()=>{
    const esPage=(p:string)=>`<html lang="es"><h1>Política de privacidad</h1><p>Esta política explica cómo recopilamos, usamos y compartimos sus datos personales cuando utiliza nuestro servicio y sus funciones.</p><p>${p}</p></html>`;
    const sale="Podemos vender sus datos personales a nuestros socios comerciales con su consentimiento.";
    const off=mergeRules(base,{disabled:["sells-personal-data"],own:[]});
    const read=(rules:typeof base,html:string,lang="es")=>{const r=readDocument("privacy","https://policy.example/es",html,"text/html",rules,{language:lang});if(r.status!=="read")throw new Error(r.status);return r;};
    const offResult=read(off,esPage(sale));
    expect(offResult.coverage?.confident).toBe(true);
    expect(offResult.categories.map((c)=>c.category)).not.toContain("data_sale");
    expect(read(base,esPage(sale)).categories.find((c)=>c.category==="data_sale")?.status).toBe("found");
    const own:OwnRule={id:"own-cookies-x",title:"Cookies",category:"ad_sharing",all:["galletas de terceros"],none:[],examples:{match:[],noMatch:[]}};
    const withOwn=read(mergeRules(base,{disabled:[],own:[own]}),esPage("Utilizamos galletas de terceros para mostrarle anuncios personalizados en otros sitios."));
    expect(withOwn.categories.find((c)=>c.category==="ad_sharing")?.status).toBe("found");
    const ownOff=read(mergeRules(base,{disabled:["own-cookies-x"],own:[own]}),esPage("Utilizamos galletas de terceros para mostrarle anuncios personalizados en otros sitios."));
    expect(ownOff.categories.map((c)=>c.category)).not.toContain("ad_sharing");
    // A guessed language runs English plus the pack: the switch still holds for both.
    const guess=languageRules({language:"fr",confident:false},mergeRules(base,{disabled:["binding-arbitration"],own:[]}));
    expect(guess.rules.map((r)=>r.id)).not.toContain("fr-arbitration");
    expect(guess.rules.map((r)=>r.id)).not.toContain("binding-arbitration");
  });
  it("maps every pack rule to an English rule of the same topic",()=>{
    for(const file of [es,fr])for(const r of file.rules)expect(base.rules.find((x)=>x.id===TRANSLATES[r.id])?.category,r.id).toBe(r.category);
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

describe("opt-in policy versions",()=>{
  const memory=(entries:[string,unknown][]=[])=>{const mem=new Map<string,unknown>(entries);return {mem,kv:{get:async(k:string)=>mem.get(k),set:async(k:string,v:unknown)=>{mem.set(k,v);},remove:async(k:string)=>{mem.delete(k);}}};};
  const v=(body:string,at:string,url="https://policy.example/privacy")=>({url,kind:"privacy",at,body});

  it("keeps only documents read from a web address, never pasted or right-clicked selected text",()=>{
    const selected=readSelection(text,"https://page.example/article",base);
    expect(selected.status).toBe("read");
    expect(versionDocuments("Selected text on page.example",[selected])).toEqual([]);
    expect(versionDocuments("Pasted text",[{...doc,url:""}])).toEqual([]);
    expect(versionDocuments("policy.example",[doc])).toEqual([doc]);
    expect(versionDocuments("policy.example",[{...doc,body:""} as typeof doc])).toEqual([]);
  });

  it("never sends selected text to be stored, and writes nothing from the report view",async()=>{
    const sendMessage=vi.fn(async()=>({previous:[]}));const set=vi.fn();
    const local:Record<string,unknown>={policyVersionsEnabled:true,policyVersionsGeneration:0};
    vi.stubGlobal("browser",{runtime:{sendMessage},storage:{local:{get:async(k:string)=>({[k]:local[k]}),set,remove:set}}});
    try{
      const selected=readSelection(text,"https://page.example/article",base);
      const tools=reportTools("Selected text on page.example",[selected],base);
      [...tools.querySelectorAll("button")].find((b)=>b.textContent==="Compare and remember this version")!.click();
      await vi.waitFor(()=>expect(tools.textContent).toContain("never stored"));
      expect(sendMessage).not.toHaveBeenCalled();
      const own=reportTools("policy.example",[doc],base);
      [...own.querySelectorAll("button")].find((b)=>b.textContent==="Compare and remember this version")!.click();
      await vi.waitFor(()=>expect(own.textContent).toContain("First version at this URL"));
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith({type:"versions:edit",edit:{type:"remember",generation:0,documents:[{url:doc.url,kind:"privacy",at:(doc as {readAt:string}).readAt,body:(doc as {body:string}).body}]}});
      expect(set).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });

  it("merges, cleans and writes in one edit, returning the previous version",async()=>{
    const now=Date.parse("2026-02-01T00:00:00Z");
    const {mem,kv}=memory([["policyVersionsEnabled",true],["policyVersions",[[v("expired",new Date(now-31*864e5).toISOString(),"https://old.example/privacy")],[v("A.\n\nB.","2026-01-20T00:00:00Z")]]]]);
    const got=await applyVersionEdit(kv,{type:"remember",generation:0,documents:[v("A.\n\nC.","2026-02-01T00:00:00Z")]},now);
    expect(got).toEqual({previous:[v("A.\n\nB.","2026-01-20T00:00:00Z")]});
    expect(mem.get("policyVersions")).toEqual([[v("A.\n\nB.","2026-01-20T00:00:00Z"),v("A.\n\nC.","2026-02-01T00:00:00Z")]]);
  });

  it("refuses a stale, disabled or invalid edit without writing",async()=>{
    const {mem,kv}=memory([["policyVersionsEnabled",true],["policyVersionsGeneration",2]]);
    const ok=v("body","2026-02-01T00:00:00Z");
    expect(await applyVersionEdit(kv,{type:"remember",generation:1,documents:[ok]})).toBe(false);
    expect(await applyVersionEdit(kv,{type:"remember",generation:2,documents:[{...ok,url:""}]})).toBe(false);
    expect(await applyVersionEdit(kv,{type:"remember",generation:2,documents:[]})).toBe(false);
    expect(mem.has("policyVersions")).toBe(false);
    expect(await applyVersionEdit(kv,{type:"clear"})).toBe(true);
    expect(await applyVersionEdit(kv,{type:"remember",generation:3,documents:[ok]})).toBe(false);
    expect(mem.has("policyVersions")).toBe(false);
  });
});

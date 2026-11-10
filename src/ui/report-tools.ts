import type { DocumentResult } from "../engine/documents";
import type { CompiledRules } from "../engine/rules";
import { cleanSaved } from "../storage-retention";
import { kv } from "../storage";
import { jobStore } from "../scan/client";

const KEEP_MS = 30 * 864e5;
const MAX_BODY = 100_000;
interface Version { url: string; kind: string; at: string; body: string }
export function compareClauses(before: string, after: string) {
  const clauses = (s: string) => s.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const a = clauses(before), b = clauses(after), old = new Set(a), next = new Set(b);
  return { removed: [...new Set(a.filter((s) => !next.has(s)))], added: [...new Set(b.filter((s) => !old.has(s)))] };
}
export function reportText(site: string, docs: DocumentResult[], version: number): string {
  const lines = [`ClauseWatch report: ${site}`, `Exported: ${new Date().toISOString()}`, `English rules version: ${version}; Spanish/French packs: 1 (three topics each)`, "Rule findings only; AI selections are not included. Quotes are not legal advice."];
  for (const d of docs) {
    lines.push(`\n${d.kind.toUpperCase()} · ${d.url || "Pasted/selected text"}`);
    if (d.status !== "read") { lines.push(`Could not read: ${d.reason}`); continue; }
    lines.push(`Read: ${d.readAt}`, `Language/coverage: ${d.coverage?.language ?? "unknown"} / ${d.coverage?.status ?? "unknown"}`, ...(d.notices ?? []));
    for (const c of d.categories) {
      lines.push(`${c.category}: ${c.status}`);
      for (const f of c.findings) lines.push(`“${f.quote}”`, `Surrounding text: ${f.context?.text ?? f.quote}`);
    }
  }
  return lines.join("\n");
}
export function diagnostics(docs: DocumentResult[], jobs: { state: string; at: number; updated: number }[], version: number) {
  return { format: "clausewatch-diagnostics", version: 1, exportedAt: new Date().toISOString(), rulesVersion: version,
    documents: docs.map((d) => ({ kind: d.kind, status: d.status, ...(d.status === "read" ? { language: /^[a-z]{2,3}$/i.test(d.coverage?.language ?? "") ? d.coverage?.language : "und", coverage: d.coverage?.status, categories: d.categories.length, findings: d.categories.reduce((n,c) => n+c.findings.length,0) } : { failure: /\b(\d{3})\b/.exec(d.reason)?.[1] ?? (/time|long/i.test(d.reason) ? "timeout-or-size" : "unreadable") }) })),
    scans: jobs.map((j) => ({ state: j.state, ageMs: Math.max(0,Date.now()-j.at), durationMs: Math.max(0,j.updated-j.at) })) };
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text="") => { const n=document.createElement(tag);n.textContent=text;return n; };

export function reportTools(site: string, docs: DocumentResult[], rules: CompiledRules): HTMLElement {
  const box=node("section");
  const details=node("details"); details.append(node("summary","Save or print this report"));
  const preview=node("textarea");preview.readOnly=true;preview.rows=12;preview.setAttribute("aria-label","Plain-text report");preview.value=reportText(site,docs,rules.version);
  const save=node("button","Download plain-text report");save.onclick=()=>download("clausewatch-report.txt",preview.value,"text/plain");
  const print=node("button","Print report");print.onclick=()=>{
    const frame=node("iframe"); frame.style.cssText="position:fixed;width:1px;height:1px;left:-10000px"; document.body.append(frame);
    const target=frame.contentDocument!; const pre=target.createElement("pre");pre.style.whiteSpace="pre-wrap";pre.textContent=preview.value;target.body.append(pre);
    frame.contentWindow?.print();setTimeout(()=>frame.remove(),1000);
  };
  details.append(node("p","This export includes policy quotes and full source URLs. Review it before sharing."),preview,save,print); box.append(details);
  const diag=node("details");diag.append(node("summary","Export local diagnostics"),node("p","No telemetry. The preview excludes policy text, quotes, URLs, account details, settings and API credentials. Download only if you choose to share it yourself."));
  const prepare=node("button","Prepare diagnostic preview");prepare.onclick=async()=>{
    const text=JSON.stringify(diagnostics(docs,await jobStore.list(),rules.version),null,2);
    const area=node("textarea");area.readOnly=true;area.rows=10;area.value=text;area.setAttribute("aria-label","Diagnostic preview");
    const exportButton=node("button","Download diagnostics");exportButton.onclick=()=>download("clausewatch-diagnostics.json",text,"application/json");
    diag.replaceChildren(node("summary","Export local diagnostics"),area,exportButton);
  };diag.append(prepare);box.append(diag);
  const versions=node("details");versions.append(node("summary","Policy changes (local, optional)"));
  const enable=node("button","Keep policy versions on this device");
  const status=node("p","Off by default. Enabling stores complete policy text locally for comparisons: up to 100,000 characters per document, two versions per source, three sources, thirty days. Pasted text is excluded. Same text at a different URL starts a new baseline. No upload.");
  const compare=node("button","Compare and remember this version");const clear=node("button","Delete saved policy versions");
  enable.onclick=async()=>{await browser.runtime.sendMessage({type:"versions:edit",edit:{type:"enable"}});status.textContent="Local comparisons enabled. Use Compare and remember after each scan.";};
  clear.onclick=async()=>{await browser.runtime.sendMessage({type:"versions:edit",edit:{type:"clear"}});status.textContent="Saved policy text deleted; comparisons disabled.";};
  compare.onclick=async()=>{
    if(await kv.get("policyVersionsEnabled")!==true){status.textContent="Enable local comparisons first.";return;}
    const generation = Number(await kv.get("policyVersionsGeneration")) || 0;
    await cleanSaved(kv);
    const old=await kv.get("policyVersions") as Version[][]|undefined;
    const stored=(Array.isArray(old)?old:[]).filter((g)=>g.length && Date.now()-Date.parse(g.at(-1)!.at)<KEEP_MS);
    const output=node("div");
    for(const d of docs){
      if(d.status!=="read"||!d.body||!/^https?:/.test(d.url))continue;
      if(d.body.length>MAX_BODY){output.append(node("p",`${d.kind}: too large to retain; no partial comparison saved.`));continue;}
      const index=stored.findIndex((g)=>g[0]?.url===d.url&&g[0]?.kind===d.kind);
      const group=index<0?[]:stored.splice(index,1)[0]!;
      const previous=group.at(-1);
      output.append(node("h3",`${d.kind} · ${d.url}`));
      if(previous){const diff=compareClauses(previous.body,d.body);output.append(node("p",`Previous: ${previous.at}; current: ${d.readAt}. Exact paragraph comparison; reordered/duplicate paragraphs are not classified as edits.`));for(const s of diff.removed)output.append(node("p","Removed:"),node("blockquote",s));for(const s of diff.added)output.append(node("p","Added:"),node("blockquote",s));if(!diff.added.length&&!diff.removed.length)output.append(node("p","No paragraph text changes."));}
      else output.append(node("p","First version at this URL; no earlier text to compare."));
      if(!previous||previous.body!==d.body)group.push({url:d.url,kind:d.kind,at:d.readAt,body:d.body});
      stored.push(group.slice(-2));
    }
    const saved = await browser.runtime.sendMessage({type:"versions:edit",edit:{type:"write",generation,versions:stored.slice(-3)}});
    if (!saved) { status.textContent="Comparison settings changed; no policy text was saved. Try again if comparisons are enabled."; return; }
    status.replaceChildren(output);
  };
  versions.append(status,enable,compare,clear);box.append(versions);return box;
}

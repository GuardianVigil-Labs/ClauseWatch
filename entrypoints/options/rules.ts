// Settings → Rules: switch the signed rules off, write or
// import your own. Own rules never leave this device unless you export them.

import { BUNDLED as bundled } from "../../src/engine/bundled";
import { compileRules, matchingSentences } from "../../src/engine/rules";
import fixtures from "../../rules/rules_fixtures.json";
import { kv } from "../../src/storage";
import { currentRulesFile } from "../../src/engine/rules-update";
import { DISABLED_KEY, exportOwn, mergeRules, MAX_OWN_RULES, OWN_KEY, ownRuleId, ownRuleProblem, parseImport, type RuleEdit, type OwnRule } from "../../src/engine/rule-set";
import { topicLabel, topicShort } from "../../src/ui/report";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const titleOf = (id: string) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()).replace(/\bAi\b/, "AI");

async function stored() {
  const [disabled, own] = await Promise.all([kv.get(DISABLED_KEY).catch(() => undefined), kv.get(OWN_KEY).catch(() => undefined)]);
  return {
    disabled: Array.isArray(disabled) ? (disabled as string[]) : [],
    own: Array.isArray(own) ? (own as OwnRule[]) : [],
  };
}

type Tab = "signed" | "mine" | "import";
// The open tab, kept when the section is drawn again after a change.
let openTab: Tab = "signed";

/** A rule's on/off switch. */
function ruleSwitch(id: string, label: string, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const cell = el("td", undefined, "on");
  const box = el("input", undefined, "toggle");
  box.id = `switch-${id}`;
  box.type = "checkbox";
  box.setAttribute("role", "switch");
  box.setAttribute("aria-label", label);
  box.checked = on;
  box.addEventListener("change", () => onChange(box.checked));
  cell.append(box);
  const why = !on ? el("span", "you turned off", "note") : null;
  if (why) {
    why.id = `why-${id}`;
    box.setAttribute("aria-describedby", why.id);
    cell.append(why);
  }
  return cell;
}

function table(head: string[]): { table: HTMLTableElement; body: HTMLTableSectionElement } {
  const t = el("table", undefined, "rules");
  const tr = el("tr");
  for (const h of head) tr.append(Object.assign(el("th", h), { scope: "col" }));
  t.createTHead().append(tr);
  return { table: t, body: t.createTBody() };
}

/** A save in progress: it draws the pane itself when done. */
let saving = 0;
export const rulesSaving = () => saving > 0;

/**
 * Draws the pane again, keeping keyboard focus and, unless told otherwise, an
 * unsaved draft in "Add my rule": after a save here, or when the rules
 * release or stored rules change elsewhere.
 */
export async function redrawRules(host: HTMLElement, note?: string, keepDraft = true): Promise<void> {
  const focused = document.activeElement?.id;
  const draft = keepDraft ? [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("form [id^=own-]")].map((f) => [f.id, f.value] as const) : [];
  await renderRules(host, note);
  for (const [id, value] of draft) {
    const f = document.getElementById(id) as HTMLInputElement | null;
    if (f) f.value = value;
  }
  // A deleted rule's button is gone: focus goes to the open tab instead.
  if (focused) (document.getElementById(focused) ?? document.getElementById(`rules-tab-${openTab}`))?.focus();
}

export async function renderRules(host: HTMLElement, note?: string): Promise<void> {
  const file = await currentRulesFile(kv, bundled);
  const known = file.categories;
  const { disabled, own } = await stored();
  const save = async (edit: RuleEdit, note?: string) => {
    saving++;
    try {
      const result = await browser.runtime.sendMessage({ type: "rules:edit", edit }) as { ok: boolean; reason?: string };
      if (!result?.ok) throw new Error(result?.reason ?? "The rules could not be saved.");
      await redrawRules(host, note, edit.type !== "add");
    } finally { saving--; }
  };
  const toggle = (id: string, on: boolean) => save({ type: "toggle", id, on }).catch((err) => redrawRules(host, err instanceof Error ? err.message : "The rule could not be switched."));

  const s = el("section");
  const heading = el("h2", "Detection ");
  heading.append(el("strong", "rules"));
  s.append(heading, el("p", "Every finding quotes the matched source text, including an adjacent list introduction where needed. Rules you switch off or write yourself stay on this device. Changes apply the next time a page is read.", "note"));
  const signedBase = compileRules(file);
  const merged = mergeRules(signedBase, { disabled, own });
  if (merged.skipped.length) s.append(el("p", `${merged.skipped.length} custom rules are not running: ${merged.skipped.slice(0, 20).map((id) => own.find((r) => r?.id === id)?.title ?? id).join(", ")}${merged.skipped.length > 20 ? "…" : ""}. Delete or correct these rules, or reset the defaults.`, "note"));

  // Tabs: the signed rules, mine, import.
  const tablist = el("div", undefined, "tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Rules");
  const panes: { id: Tab; tab: HTMLButtonElement; pane: HTMLElement }[] = [];
  const show = (id: Tab) => {
    openTab = id;
    for (const x of panes) {
      x.tab.setAttribute("aria-selected", String(x.id === id));
      x.tab.tabIndex = x.id === id ? 0 : -1;
      x.pane.hidden = x.id !== id;
    }
  };
  const addPane = (id: Tab, label: string) => {
    const tab = el("button", label);
    tab.type = "button";
    tab.id = `rules-tab-${id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `rules-${id}`);
    tab.addEventListener("click", () => show(id));
    const pane = el("div");
    pane.id = `rules-${id}`;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", tab.id);
    tablist.append(tab);
    panes.push({ id, tab, pane });
    return pane;
  };
  const signedPane = addPane("signed", `ClauseWatch rules · ${file.rules.length}`);
  const minePane = addPane("mine", `My rules · ${own.length}`);
  const importPane = addPane("import", "Import");
  tablist.addEventListener("keydown", (e) => {
    const i = panes.findIndex((x) => x.id === openTab);
    const next = e.key === "ArrowRight" ? (i + 1) % panes.length : e.key === "ArrowLeft" ? (i - 1 + panes.length) % panes.length : -1;
    if (next < 0) return;
    e.preventDefault();
    show(panes[next]!.id);
    panes[next]!.tab.focus();
  });

  // The signed rules: each with a switch, and a copy to edit as my own.
  const source = `v${file.version} · ${file.version > bundled.version ? "signed update" : "built in"}`;
  const signed = table(["Rule", "Category", "Source", "On", ""]);
  for (const r of file.rules) {
    const tr = el("tr");
    const copy = el("button", "Copy", "secondary small");
    copy.id = `copy-${r.id}`;
    copy.type = "button";
    copy.setAttribute("aria-label", `Copy ${titleOf(r.id)} as my own rule`);
    copy.addEventListener("click", () => {
      const ex = (fixtures as { fixtures: Record<string, { match: string[]; noMatch: string[] }> }).fixtures[r.id];
      show("mine");
      fill({ title: `${titleOf(r.id)} (my copy)`, category: r.category, all: r.all, none: r.none ?? [], scope: r.scope, examples: { match: ex?.match.filter((s) => matchingSentences(s, signedBase.rules.find((x) => x.id === r.id)!, file.minQuoteWords).length > 0).slice(0, 3) ?? [], noMatch: ex?.noMatch.slice(0, 3) ?? [] } });
    });
    const copyCell = el("td");
    copyCell.append(copy);
    tr.append(el("td", r.id, "mono"), el("td", topicShort(r.category)), el("td", source, "nowrap"), ruleSwitch(r.id, titleOf(r.id), !disabled.includes(r.id), (on) => void toggle(r.id, on)), copyCell);
    signed.body.append(tr);
  }
  const addMine = el("button", "Add my rule");
  addMine.type = "button";
  addMine.addEventListener("click", () => {
    show("mine");
    document.getElementById("own-name")?.focus();
  });
  const signedFoot = el("div", undefined, "foot");
  signedFoot.append(addMine, el("p", "Rules update from the open-source repository's releases, signed by the GuardianVigil team.", "note"));
  signedPane.append(signed.table, signedFoot);

  // My rules.
  if (!own.length) minePane.append(el("p", "None yet. Write one below, copy a ClauseWatch rule, or import a file.", "note"));
  else {
    const t = table(["Rule", "Category", "Source", "On", ""]);
    for (const r of own.filter((r) => r && typeof r.id === "string")) {
      const tr = el("tr");
      const del = el("button", "Delete", "secondary small");
      del.id = `delete-${r.id}`;
      del.type = "button";
      del.setAttribute("aria-label", `Delete ${r.title}`);
      del.addEventListener("click", () => void save({ type: "delete", id: r.id }).catch((err) => redrawRules(host, err instanceof Error ? err.message : "The rule could not be deleted.")));
      const delCell = el("td");
      delCell.append(del);
      tr.append(el("td", r.title, "mono"), el("td", topicShort(r.category)), el("td", merged.skipped.includes(r.id) ? "not running" : "my rule", "nowrap"), ruleSwitch(r.id, r.title, !disabled.includes(r.id), (on) => void toggle(r.id, on)), delCell);
      t.body.append(tr);
    }
    minePane.append(t.table);
  }

  // Add my rule: tested against its own examples before it is saved.
  const form = el("form");
  form.append(el("h3", "Add my rule"));
  const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(label: string, input: T, hint?: string) => {
    const id = `own-${label.toLowerCase().replace(/\W+/g, "-")}`;
    input.id = id;
    const l = el("label", label);
    l.htmlFor = id;
    form.append(l, input);
    if (hint) form.append(el("p", hint, "note"));
    return input;
  };
  const title = field("Name", el("input"));
  const topic = field("Topic", el("select"));
  for (const c of known) topic.append(Object.assign(el("option", topicLabel(c)), { value: c }));
  const scope = field("Match scope", el("select"), "Sentence checks the whole sentence. Separate assertions can recover an explicit permission after a denial; the full sentence is still quoted.");
  scope.append(Object.assign(el("option", "Whole sentence"), { value: "sentence" }), Object.assign(el("option", "Separate assertions"), { value: "assertion" }));
  const area = (rows: number) => Object.assign(el("textarea"), { rows });
  const all = field("Patterns a sentence must match (one per line, all of them)", area(3), "Regular expressions, case-insensitive. Lookarounds and back-references are not allowed.");
  const none = field("Patterns it must not match (one per line)", area(2), "For example \\bnot\\b, so \"we do not…\" is left out.");
  const yes = field("Sentences it must match (one per line)", area(2));
  const no = field("Sentences it must not match (one per line)", area(2));
  const msg = el("p", undefined, "note");
  msg.setAttribute("aria-live", "polite");
  const add = el("button", "Test and save");
  add.id = "own-save";
  add.type = "submit";
  form.append(add, msg);
  function fill(r: Omit<OwnRule, "id">) {
    title.value = r.title;
    topic.value = r.category;
    scope.value = r.scope ?? "sentence";
    all.value = r.all.join("\n");
    none.value = r.none.join("\n");
    yes.value = r.examples.match.join("\n");
    no.value = r.examples.noMatch.join("\n");
    title.focus();
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (own.length >= MAX_OWN_RULES) {
      msg.textContent = `You can keep at most ${MAX_OWN_RULES} rules.`;
      return;
    }
    const rule: OwnRule = {
      id: ownRuleId(title.value),
      title: title.value.trim(),
      category: topic.value,
      ...(scope.value === "assertion" ? { scope: "assertion" as const } : {}),
      all: lines(all.value),
      none: lines(none.value),
      examples: { match: lines(yes.value), noMatch: lines(no.value) },
    };
    const problem = ownRuleProblem(rule, known, file.minQuoteWords);
    if (problem) {
      msg.textContent = problem;
      return;
    }
    void save({ type: "add", rules: [rule] }).catch((err) => { msg.textContent = err instanceof Error ? err.message : "The rule could not be saved."; });
  });
  minePane.append(form);

  // Import, export, reset.
  const tools = el("p");
  const pick = el("input");
  pick.type = "file";
  pick.accept = "application/json,.json";
  pick.id = "rules-import-file"; // not "rules-import": that is the Import tab's panel
  pick.hidden = true;
  const importBtn = el("button", "Import a rules file");
  importBtn.id = "rules-import-button";
  importBtn.className = "secondary";
  importBtn.addEventListener("click", () => pick.click());
  const status = el("p", note, "note");
  status.setAttribute("aria-live", "polite");
  pick.addEventListener("change", async () => {
    const f = pick.files?.[0];
    if (!f) return;
    try {
      if (f.size > 512 * 1024) throw new Error("The file is too large (at most 512 KB).");
      const rules = parseImport(await f.text(), known, file.minQuoteWords);
      if (own.length + rules.length > MAX_OWN_RULES) throw new Error(`That would make more than ${MAX_OWN_RULES} rules.`);
      await save({ type: "add", rules }, `Imported ${rules.length} rule${rules.length === 1 ? "" : "s"}.`);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "The file could not be imported.";
    } finally {
      // The same file can be picked again after fixing it.
      pick.value = "";
    }
  });
  const exportBtn = el("button", "Export my rules");
  exportBtn.className = "secondary";
  exportBtn.disabled = own.length === 0;
  exportBtn.addEventListener("click", () => {
    const a = el("a");
    a.href = URL.createObjectURL(new Blob([exportOwn(own)], { type: "application/json" }));
    a.download = "clausewatch-rules.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const reset = el("button", "Reset rules to defaults");
  reset.className = "secondary";
  reset.addEventListener("click", () => {
    if (!confirm("Switch every ClauseWatch rule back on and delete your own rules?")) return;
    void save({ type: "reset" }).catch((err) => { status.textContent = String(err); });
  });
  tools.append(importBtn, " ", exportBtn, " ", reset, pick);
  importPane.append(el("p", "Import a rules file someone shared, or export your own. Imported rules pass the same checks as rules you write.", "note"), tools);
  // Above the tabs, so a switch, delete or import message shows whichever tab is open.
  s.append(status, tablist, ...panes.map((x) => x.pane));
  show(panes.some((x) => x.id === openTab) ? openTab : "signed");
  host.replaceChildren(s);
}

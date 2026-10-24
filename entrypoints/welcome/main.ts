// First-run setup: the two choices that decide what leaves
// the device and when ClauseWatch appears. Opened once, on install, and from
// Settings. Every choice says plainly what leaves the device.

import { kv } from "../../src/storage";
import { builtInModel, type AiSettings } from "../../src/ai/assist";
import { AUTO_ORIGINS } from "../../src/auto/background";

const aiBox = document.getElementById("ai")!;
const displayBox = document.getElementById("display")!;
const status = document.getElementById("status")!;

/** A choice card: its title (with "Default" on the default one), what it does, and what leaves the device. */
function choice(
  group: string,
  value: string,
  title: string,
  desc: string,
  checked: boolean,
  { leaves, isDefault = false }: { leaves?: { what: "nothing" | "some"; text: string }; isDefault?: boolean } = {},
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.className = "choice";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = group;
  input.value = value;
  input.checked = checked;
  const t = document.createElement("strong");
  t.textContent = title;
  if (isDefault) t.append(Object.assign(document.createElement("span"), { className: "default", textContent: "Default" }));
  label.append(input, t, Object.assign(document.createElement("span"), { className: "desc", textContent: desc }));
  if (leaves) {
    const l = document.createElement("span");
    l.className = `leaves ${leaves.what}`;
    l.append(Object.assign(document.createElement("b"), { textContent: leaves.what === "nothing" ? "Leaves your device: nothing." : "Leaves your device:" }), leaves.text ? ` ${leaves.text}` : "");
    label.append(l);
  }
  return { label, input };
}

async function aiChoices() {
  const current = ((await kv.get("ai").catch(() => undefined)) as AiSettings | undefined) ?? { mode: "off" };
  const off = choice("ai", "off", "No AI, rules only", "Quotes found by open-source rules.", current.mode === "off", { isDefault: true, leaves: { what: "nothing", text: "" } });
  aiBox.append(off.label);
  // Offered only where the browser has a built-in model.
  const lm = builtInModel();
  if (lm) {
    const builtin = choice("ai", "builtin", "The browser's built-in AI", "The model runs on this computer.", current.mode === "builtin", { leaves: { what: "nothing", text: "" } });
    const availability = lm.availability ? await lm.availability().catch(() => "unavailable") : "available";
    if (availability === "unavailable") {
      builtin.input.disabled = true;
      builtin.label.append(Object.assign(document.createElement("span"), { className: "warn", textContent: " Not available on this device." }));
    } else if (availability !== "available") {
      builtin.label.append(
        Object.assign(document.createElement("span"), { className: "warn", textContent: " The browser would first download its model, which can be several gigabytes." }),
      );
    }
    aiBox.append(builtin.label);
  }
  const key = choice(
    "ai",
    "key",
    "My own AI key",
    "An OpenAI-compatible service you choose. You enter the key in Settings.",
    current.mode === "key",
    { leaves: { what: "some", text: "what you ask about, sent to that service under your account: the text being checked (the document, or the text you pasted or selected, up to 24,000 characters) when you ask AI to look for missed clauses, or only the quotes found for a summary. Never your form entries, passwords, cookies or browsing history." } },
  );
  aiBox.append(key.label);
}

async function displayChoices() {
  // On only while the access it needs is still granted.
  const stored = await kv.get("automatic").catch(() => undefined);
  // Automatic is the default on first run; access is asked on Done.
  const on = stored === undefined || (stored === true && (await browser.permissions.contains({ origins: AUTO_ORIGINS }).catch(() => false)));
  const auto = choice(
    "display",
    "automatic",
    "Show automatically on sign-up pages",
    "Recommended. You will not need to remember the extension is there. Your browser asks for access to all sites when you click Done; it is used only to recognise sign-up forms and read that site's terms on this device.",
    on,
    { isDefault: true },
  );
  const click = choice("display", "click", "Only when I click the icon", "Nothing appears unless you ask.", !on);
  displayBox.append(auto.label, click.label);
}

document.getElementById("done")!.addEventListener("click", async () => {
  // Asked first, before any await: Firefox grants a request only inside the click itself.
  const wantsAuto = (document.querySelector('input[name="display"][value="automatic"]') as HTMLInputElement | null)?.checked === true;
  const access = wantsAuto ? browser.permissions.request({ origins: AUTO_ORIGINS }).catch(() => false) : browser.permissions.remove({ origins: AUTO_ORIGINS }).then(() => false, () => false);
  const granted = await access;
  await kv.set("automatic", granted);
  const declined = wantsAuto && !granted;
  const clickNote = "Without access to sites, ClauseWatch appears only when you click it. You can turn automatic mode on in Settings.";
  if (declined) (document.querySelector('input[name="display"][value="click"]') as HTMLInputElement).checked = true;
  const picked = (document.querySelector('input[name="ai"]:checked') as HTMLInputElement | null)?.value ?? "off";
  const current = ((await kv.get("ai").catch(() => undefined)) as AiSettings | undefined) ?? { mode: "off" };
  if (picked === "key") {
    // The key itself is entered in Settings, where it can be checked.
    // Until the key is saved there, AI stays off.
    if (current.mode !== "key") await kv.set("ai", { mode: "off" } satisfies AiSettings);
    status.textContent = `${declined ? `${clickNote} ` : ""}Enter your key in Settings, which opens now. AI help stays off until it is saved.`;
    return void browser.tabs.create({ url: browser.runtime.getURL("/options.html#ai") });
  }
  await kv.set("ai", { mode: picked as "off" | "builtin" } satisfies AiSettings);
  // Someone who said no to site access reads why before the page closes.
  if (declined) return void (status.textContent = `Done. ${clickNote}`);
  status.textContent = "Done. ClauseWatch is ready.";
  window.setTimeout(() => window.close(), 800);
});

// Three steps on one page; every choice stays in the page, so Done reads them all.
const steps = [1, 2, 3].map((n) => document.getElementById(`step-${n}`)!);
const title = document.getElementById("step-title")!;
let at = 0;
function go(n: number) {
  at = n;
  steps.forEach((s, i) => (s.hidden = i !== n));
  title.textContent = `Setup · ${n + 1} of 3`;
  (steps[n]!.querySelector("h1") as HTMLElement).focus?.();
}
for (const b of document.querySelectorAll("button.next")) b.addEventListener("click", () => go(at + 1));
for (const b of document.querySelectorAll("button.back")) b.addEventListener("click", () => go(at - 1));
// Skip keeps everything as it is: no AI, and ClauseWatch only when clicked.
document.getElementById("skip")!.addEventListener("click", () => window.close());
for (const h of document.querySelectorAll("section.step h1")) h.setAttribute("tabindex", "-1");

void aiChoices();
void displayChoices();

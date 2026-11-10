import type { AiSettings } from "./assist";

/** The full destination, including path, is the credential boundary. */
export function aiEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Use an https API address without credentials, query parameters or a fragment.");
  return new URL("chat/completions", url.href.endsWith("/") ? url.href : `${url.href}/`).href;
}

export function keySettings(current: AiSettings, base: string, model: string, entered: string, choice: string): AiSettings & { mode: "key" } {
  const credentialEndpoint = aiEndpoint(base);
  if (!model.trim()) throw new Error("Enter a model name.");
  if (choice !== "saved" && choice !== "entered") throw new Error("Choose a credential for this endpoint. The previous key will not be reused automatically.");
  const apiKey = choice === "saved" && current.mode === "key" ? current.apiKey : choice === "entered" ? entered.trim() : "";
  if (!apiKey) throw new Error("Enter a key or explicitly select an available saved key.");
  return { mode: "key", baseUrl: base.trim(), model: model.trim(), apiKey, credentialEndpoint };
}

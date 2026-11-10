// Automatic mode in frames: a few lines, not the reader. When a sign-up field
// in a frame is focused, the background is asked once to add automatic mode's
// script (signup.content.ts) to that frame. Field values are never read.

export default defineContentScript({
  matches: ["https://*/*", "http://*/*"],
  registration: "runtime",
  runAt: "document_idle",
  allFrames: true,
  main() {
    if (window === window.top) return;
    const controller = new AbortController();
    document.addEventListener("focusin", (e) => {
      const field = e.composedPath()[0];
      if (!(field instanceof HTMLInputElement)) return;
      const signup = ["email", "password", "checkbox"].includes(field.type) || /e-?mail/i.test(`${field.name} ${field.id} ${field.autocomplete}`) || !!field.form?.querySelector("input[type=password]");
      if (!signup) return;
      controller.abort();
      void browser.runtime.sendMessage({ type: "auto:frame" }).catch(() => undefined);
    }, { capture: true, signal: controller.signal });
  },
});

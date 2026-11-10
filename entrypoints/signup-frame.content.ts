// Automatic mode in frames: a few lines, not the reader. When a sign-up field
// in a frame is focused, the background is asked to add automatic mode's
// script (signup.content.ts) to that frame. Field values are never read.
// It stops listening only once the script was added; a refused or failed
// request is asked again on a later focus, a few times at most.

const MAX_TRIES = 5;

export default defineContentScript({
  matches: ["https://*/*", "http://*/*"],
  registration: "runtime",
  runAt: "document_idle",
  allFrames: true,
  main() {
    if (window === window.top) return;
    const controller = new AbortController();
    let tries = 0;
    let asking = false;
    document.addEventListener("focusin", (e) => {
      const field = e.composedPath()[0];
      if (asking || !(field instanceof HTMLInputElement)) return;
      const signup = ["email", "password", "checkbox"].includes(field.type) || /e-?mail/i.test(`${field.name} ${field.id} ${field.autocomplete}`) || !!field.form?.querySelector("input[type=password]");
      if (!signup) return;
      asking = true;
      if (++tries >= MAX_TRIES) controller.abort();
      void (browser.runtime.sendMessage({ type: "auto:frame" }) as Promise<unknown>).catch(() => false).then((added) => {
        asking = false;
        if (added === true) controller.abort();
      });
    }, { capture: true, signal: controller.signal });
  },
});

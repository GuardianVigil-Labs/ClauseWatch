import { afterEach, describe, expect, it, vi } from "vitest";
import { captureRenderedPage } from "../src/engine/rendered";

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

describe("visible-page capture", () => {
  it("reads only a control's own text, never every ancestor's (cost would grow with depth × page text)", () => {
    const depth = 40;
    document.body.innerHTML = `${"<div>".repeat(depth)}<p>Invented membership text for registered users.</p><button type="button">Read privacy policy</button><a href="#">Contact</a>${"</div>".repeat(depth)}`;
    const reads = vi.spyOn(Element.prototype, "textContent", "get");
    const snapshot = captureRenderedPage();
    expect(snapshot.controls.map((c) => c.label)).toEqual(["Read privacy policy"]);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

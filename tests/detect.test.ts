import { describe, it, expect, beforeEach } from "vitest";
import { findSignupForms, signupRoots, siteOf } from "../src/auto/detect";

const page = (html: string) => {
  document.body.innerHTML = html;
  return findSignupForms(document);
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findSignupForms", () => {
  it("finds a sign-up form: email plus a new password", () => {
    const [f] = page(`<form id="f"><input type="email" name="email"><input type="password" autocomplete="new-password"></form>`);
    expect(f!.root.id).toBe("f");
    expect(f!.email!.name).toBe("email");
  });
  it("finds one with a confirm-password field and a text field named email", () => {
    expect(page(`<form><input name="user_email"><input type="password"><input type="password"></form>`)).toHaveLength(1);
  });
  it("supports autocomplete sections and accessible consent labels", () => {
    expect(page('<div><input type="email"><input type="password" autocomplete="section-join new-password"></div>')).toHaveLength(1);
    expect(page('<div><span id="agreement">I accept the privacy policy</span><input type="checkbox" aria-labelledby="agreement"></div>')).toHaveLength(1);
  });
  it("finds a sign-up with an agree checkbox, and a consent form with no password", () => {
    expect(page(`<form><input type="email"><input type="password"><label><input type="checkbox"> I agree to the Terms</label></form>`)).toHaveLength(1);
    const [c] = page(`<div id="c"><label><input type="checkbox"> I accept the privacy policy</label><button>Continue</button></div>`);
    expect(c).toBeDefined();
    expect(c!.email).toBeNull();
  });
  it("ignores a login form, a newsletter box, a hidden form and an unrelated checkbox", () => {
    expect(page(`<form><input type="email"><input type="password" autocomplete="current-password"></form>`)).toHaveLength(0);
    expect(page(`<form><input type="email"><button>Subscribe</button></form>`)).toHaveLength(0);
    expect(page(`<form hidden><input type="email"><input type="password" autocomplete="new-password"></form>`)).toHaveLength(0);
    expect(page(`<form><label><input type="checkbox"> Remember me</label></form>`)).toHaveLength(0);
  });
  it("works without a <form> element", () => {
    expect(page(`<div><input type="email"><input type="password" autocomplete="new-password"></div>`)).toHaveLength(1);
  });
  it("groups sibling field wrappers at their smallest shared container", () => {
    const [f] = page(`<main><section id="join"><div><input type="email"></div><div><input type="password" autocomplete="new-password"></div></section></main>`);
    expect(f!.root.id).toBe("join");
    expect(page(`<section><input type="email"></section><section><input type="password" autocomplete="new-password"></section>`)).toHaveLength(0);
    expect(page(`<form><input type="email"></form><div><input type="password" autocomplete="new-password"></div>`)).toHaveLength(0);
  });
  it("checks visibility through ancestors and shadow hosts", () => {
    for (const attrs of ['style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"', 'aria-hidden="true"', 'inert']) {
      expect(page(`<div ${attrs}><input type="email"><input type="password" autocomplete="new-password"></div>`)).toHaveLength(0);
    }
    document.body.innerHTML = '<div id="host" hidden></div>';
    const host = document.querySelector<HTMLElement>("#host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<input type="email"><input type="password" autocomplete="new-password"><label><input type="checkbox">I accept the terms</label>';
    expect(findSignupForms(root)).toHaveLength(0);
    host.hidden = false;
    expect(findSignupForms(root)).toHaveLength(1);
    expect(findSignupForms(root)[0]!.root).toBe(host);
    expect(signupRoots(document)).toEqual([document, root]);
  });
  it("discovers nested open roots and leaves closed roots alone", () => {
    document.body.innerHTML = '<div id="open"></div><div id="closed"></div>';
    const root = document.querySelector("#open")!.attachShadow({ mode: "open" });
    root.innerHTML = '<div id="nested"></div>';
    const nested = root.querySelector("#nested")!.attachShadow({ mode: "open" });
    nested.innerHTML = '<form><input type="email"><input type="password" autocomplete="new-password"></form>';
    document.querySelector("#closed")!.attachShadow({ mode: "closed" });
    expect(signupRoots(document)).toEqual([document, root, nested]);
    expect(findSignupForms(nested)).toHaveLength(1);
  });
  it("never reads a field's value", () => {
    const [f] = page(`<form><input type="email" value="alice@corp.example"><input type="password" autocomplete="new-password" value="hunter2"></form>`);
    expect(JSON.stringify({ root: f!.root.tagName, email: f!.email?.name })).not.toContain("alice");
  });
});

describe("siteOf", () => {
  it("is the host without www", () => {
    expect(siteOf("https://www.Service.example/signup?x=1")).toBe("service.example");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { findSignupForms, siteOf } from "../src/auto/detect";

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

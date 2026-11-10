import { describe, it, expect } from "vitest";
import { draftLetter, type RequestKind } from "../src/ui/requests";

describe("data request deadlines", () => {
  it.each<RequestKind>(["erasure", "access", "offboarding"])("uses calendar months and extension wording for GDPR %s", (kind) => {
    const letter = draftLetter(kind, "gdpr", "service.example", "example-account");
    expect(letter.body).toContain("without undue delay");
    expect(letter.body).toContain("within one calendar month");
    expect(letter.body).toContain("Article 12(3)");
    expect(letter.body).toContain("two further months");
    expect(letter.body).not.toContain("30 days");
    expect(letter.body).not.toContain("within 45 days");
  });
  it("keeps the CCPA period separate", () => {
    expect(draftLetter("access", "ccpa", "service.example", "account").body).toContain("within 45 days");
    expect(draftLetter("access", "ccpa", "service.example", "account").body).not.toContain("calendar month");
  });
});

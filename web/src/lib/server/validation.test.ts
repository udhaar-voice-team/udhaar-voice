import { describe, expect, it } from "vitest";
import { parseIdentifier, parseProfile, parseSignUp } from "./validation";

describe("sign-in", () => {
  it("accepts a 10-digit mobile in any common form, or an email", () => {
    expect(parseIdentifier("98300 12345")).toEqual({ phone: "+919830012345" });
    expect(parseIdentifier("+91 98300-12345")).toEqual({ phone: "+919830012345" });
    expect(parseIdentifier(" Gopal@Example.com ")).toEqual({ email: "gopal@example.com" });
  });

  it("rejects a phone number that is not 10 digits and an invalid email", () => {
    expect(() => parseIdentifier("12345")).toThrow(/10-digit/);
    expect(() => parseIdentifier("gopal@")).toThrow(/valid email/);
  });
});

describe("sign-up", () => {
  const form = { phone: "9830012345", email: "Gopal@Example.com", password: "secret1", ownerName: " Gopal Saha ", shopName: "Maa Tara", language: "bn" as const };

  it("normalises what was typed", () => {
    expect(parseSignUp(form)).toEqual({ ...form, phone: "+919830012345", email: "gopal@example.com", ownerName: "Gopal Saha" });
  });

  it("needs an email, a 6-character password and both names", () => {
    expect(() => parseSignUp({ ...form, email: "" })).toThrow(/valid email/);
    expect(() => parseSignUp({ ...form, password: "12345" })).toThrow(/6 characters/);
    expect(() => parseSignUp({ ...form, shopName: " " })).toThrow(/shop name/);
  });
});

describe("profile", () => {
  const profile = { name: "Gopal Saha", phone: "98300 12345", email: "gopal@example.com", shopName: "Maa Tara Stores", upiId: "gopal@okaxis" };

  it("normalises the phone and keeps a valid UPI ID", () => {
    expect(parseProfile(profile)).toMatchObject({ phone: "+919830012345", upiId: "gopal@okaxis" });
  });

  it("allows no UPI ID yet, but refuses a malformed one", () => {
    expect(parseProfile({ ...profile, upiId: "" }).upiId).toBe("");
    expect(() => parseProfile({ ...profile, upiId: "gopal" })).toThrow(/UPI/);
    expect(() => parseProfile({ ...profile, phone: "12" })).toThrow(/10-digit/);
  });
});

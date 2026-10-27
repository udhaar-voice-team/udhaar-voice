import { normalizeIndianMobile } from "@/lib/domain/rules";
import type { ProfileInput, SignInInput, SignUpInput } from "@/lib/api/contract";

/** Checks what people type into the account forms. Throws a message the shopkeeper can act on. */

/** Loose email check, good enough to catch typos; Supabase Auth has the final say. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPI = /^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/;

export type SignInTarget = { email: string } | { phone: string };

export function parseIdentifier(input: SignInInput["identifier"]): SignInTarget {
  const id = input.trim();
  if (id.includes("@")) {
    if (!EMAIL.test(id)) throw new Error("Enter a valid email address.");
    return { email: id.toLowerCase() };
  }
  const phone = normalizeIndianMobile(id);
  if (!phone) throw new Error("Enter a 10-digit Indian mobile number or an email address.");
  return { phone };
}

export function parseSignUp(input: SignUpInput): SignUpInput {
  const phone = normalizeIndianMobile(input.phone);
  if (!phone) throw new Error("Enter a 10-digit Indian mobile number.");
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("Enter a valid email address.");
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters.");
  const ownerName = input.ownerName.trim();
  const shopName = input.shopName.trim();
  if (!ownerName || !shopName) throw new Error("Fill in your name and shop name.");
  return { phone, email, password: input.password, ownerName, shopName, language: input.language };
}

export function parseProfile(input: ProfileInput): ProfileInput {
  const phone = normalizeIndianMobile(input.phone);
  if (!phone) throw new Error("Enter a 10-digit Indian mobile number.");
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("Enter a valid email address.");
  const name = input.name.trim();
  const shopName = input.shopName.trim();
  if (!name || !shopName) throw new Error("Fill in your name and shop name.");
  const upiId = input.upiId.trim();
  if (upiId && !UPI.test(upiId)) throw new Error("Enter a UPI ID like name@bank.");
  return { name, phone, email, shopName, upiId };
}

/** The same message for every failed sign-in, so it doesn't reveal which numbers have accounts. */
export const WRONG_DETAILS = "Wrong details. Check your phone/email and password.";

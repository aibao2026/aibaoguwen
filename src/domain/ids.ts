import { createHash } from "node:crypto";

function normalizePart(value: string | undefined, fallback = "unknown"): string {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : fallback;
}

function hashParts(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export function makeCustomerBusinessKey(input: {
  name: string;
  idNumber?: string;
}): string {
  return `customer:${hashParts([
    "customer",
    normalizePart(input.name),
    normalizePart(input.idNumber),
  ])}`;
}

export function makePolicyBusinessKey(input: {
  policyNumber?: string;
  applicantName: string;
  insuredName: string;
  productName: string;
  effectiveDate?: string;
}): string {
  const policyNumber = normalizePart(input.policyNumber, "");
  if (policyNumber) {
    return [
      "policy",
      policyNumber,
      normalizePart(input.insuredName),
      normalizePart(input.productName),
    ].join(":");
  }

  return [
    "policy-fallback",
    normalizePart(input.applicantName),
    normalizePart(input.insuredName),
    normalizePart(input.productName),
    normalizePart(input.effectiveDate),
  ].join(":");
}

export function makeReminderBusinessKey(input: {
  group: string;
  reminderDate: string;
  customerId?: string;
  policyId?: string;
  title: string;
}): string {
  return [
    "reminder",
    normalizePart(input.group),
    normalizePart(input.reminderDate),
    normalizePart(input.customerId),
    normalizePart(input.policyId),
    normalizePart(input.title),
  ].join(":");
}

export type MatchResult =
  | { matched: true; confidence: "strict" }
  | { matched: false; reason: string };

interface IdentityInput {
  name: string;
  idNumber?: string;
}

function normalize(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, "") ?? "";
}

function isMaskedId(idNumber: string): boolean {
  return idNumber.includes("*");
}

function visibleParts(maskedId: string): { prefix: string; suffix: string } {
  const firstMask = maskedId.indexOf("*");
  const lastMask = maskedId.lastIndexOf("*");
  return {
    prefix: maskedId.slice(0, firstMask),
    suffix: maskedId.slice(lastMask + 1),
  };
}

function fullMatchesMasked(fullId: string, maskedId: string): boolean {
  const { prefix, suffix } = visibleParts(maskedId);
  if (!prefix || !suffix) {
    return false;
  }

  return fullId.startsWith(prefix) && fullId.endsWith(suffix);
}

function maskedMatchesMasked(left: string, right: string): boolean {
  const leftParts = visibleParts(left);
  const rightParts = visibleParts(right);
  return (
    Boolean(leftParts.prefix) &&
    Boolean(leftParts.suffix) &&
    leftParts.prefix === rightParts.prefix &&
    leftParts.suffix === rightParts.suffix
  );
}

export function matchCustomerIdentity(
  a: IdentityInput,
  b: IdentityInput,
): MatchResult {
  const nameA = normalize(a.name);
  const nameB = normalize(b.name);
  if (!nameA || nameA !== nameB) {
    return { matched: false, reason: "name_mismatch" };
  }

  const idA = normalize(a.idNumber);
  const idB = normalize(b.idNumber);
  if (!idA || !idB) {
    return { matched: false, reason: "missing_id" };
  }

  if (idA === idB) {
    return { matched: true, confidence: "strict" };
  }

  const aMasked = isMaskedId(idA);
  const bMasked = isMaskedId(idB);
  const matched =
    aMasked && bMasked
      ? maskedMatchesMasked(idA, idB)
      : aMasked
        ? fullMatchesMasked(idB, idA)
        : fullMatchesMasked(idA, idB);

  return matched
    ? { matched: true, confidence: "strict" }
    : { matched: false, reason: "id_mismatch" };
}

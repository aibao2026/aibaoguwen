import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FieldMappingSuggestion, ImportTableKind } from "./fieldTaxonomy";

export interface StoredImportFieldProfile {
  fileName: string;
  sheetName: string;
  tableKind: ImportTableKind;
  rowCount: number;
  headerCount: number;
  mappings: FieldMappingSuggestion[];
  analyzedAt: string;
}

function profilePath(dataRoot: string): string {
  return join(dataRoot, "import-field-profiles.json");
}

export function readImportFieldProfiles(dataRoot: string): StoredImportFieldProfile[] {
  const filePath = profilePath(dataRoot);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as StoredImportFieldProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveImportFieldProfiles(
  dataRoot: string,
  profiles: StoredImportFieldProfile[],
): StoredImportFieldProfile[] {
  const existing = readImportFieldProfiles(dataRoot);
  const analyzedAt = new Date().toISOString();
  const nextProfiles = profiles.map((profile) => ({ ...profile, analyzedAt }));
  const byKey = new Map<string, StoredImportFieldProfile>();
  for (const profile of [...existing, ...nextProfiles]) {
    byKey.set(`${profile.fileName}\u0000${profile.sheetName}`, profile);
  }
  const next = Array.from(byKey.values()).slice(-200);
  const filePath = profilePath(dataRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

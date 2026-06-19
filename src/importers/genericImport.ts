import { createRequire } from "node:module";
import { join } from "node:path";
import type * as Xlsx from "xlsx";
import { requestAiFieldMappings } from "../ai/fieldMappingAi";
import type { AiProviderId } from "../ai/modelProviders";
import {
  canonicalFieldLabel,
  classifyFieldMappingsWithContext,
  importableMappingsForKind,
  type CanonicalFieldKey,
  type FieldMappingSuggestion,
} from "./fieldTaxonomy";
import { saveImportFieldProfiles, type StoredImportFieldProfile } from "./importAnalysisStore";
import { readImportFileTables, type ImportFileTables, type ImportTableRows } from "./tableReader";

const require = createRequire(import.meta.url);
const xlsx = require("xlsx") as typeof Xlsx;

export interface ImportFieldMappingInput {
  fileName: string;
  sheetName: string;
  sourceField: string;
  canonicalField: CanonicalFieldKey;
}

export interface ImportAnalysisRequest {
  files: Array<{ fileName: string; filePath: string }>;
  dataRoot: string;
  ai?: {
    enabled?: boolean;
    providerId?: AiProviderId;
    apiKey?: string;
  };
}

export interface ImportAnalysisTable {
  fileName: string;
  sheetName: string;
  tableKind: "customer" | "policy" | "family" | "unknown";
  confidence: number;
  rowCount: number;
  headers: string[];
  mappings: FieldMappingSuggestion[];
  missingImportFields: string[];
}

export interface ImportAnalysisResult {
  files: Array<{
    fileName: string;
    tables: ImportAnalysisTable[];
  }>;
  summary: {
    customerTables: number;
    policyTables: number;
    familyTables: number;
    unknownTables: number;
    mappedFields: number;
    aiUsed: boolean;
  };
}

export interface PreparedGenericImport {
  customerWorkbookPath?: string;
  policyWorkbookPath?: string;
  analysis: ImportAnalysisResult;
}

const customerStandardFields: Array<{ key: CanonicalFieldKey; target: string }> = [
  { key: "customer.name", target: "客户姓名" },
  { key: "customer.idNumber", target: "证件号" },
  { key: "customer.birthDate", target: "出生日期" },
  { key: "customer.phone", target: "手机号" },
];

const policyStandardFields: Array<{ key: CanonicalFieldKey; target: string }> = [
  { key: "policy.applicantName", target: "投保人" },
  { key: "policy.applicantIdNumber", target: "投保人证件号" },
  { key: "policy.insuredName", target: "被保人" },
  { key: "policy.insuredIdNumber", target: "被保人证件号" },
  { key: "policy.policyNumber", target: "保单号码" },
  { key: "policy.insurerName", target: "保险公司" },
  { key: "policy.productName", target: "保险产品" },
  { key: "policy.scalePremium", target: "规模保费" },
  { key: "policy.standardPremium", target: "标准保费" },
  { key: "policy.paymentMethod", target: "缴费方式" },
  { key: "policy.paymentPeriodRaw", target: "缴费期间" },
  { key: "policy.effectiveDate", target: "生效时间" },
];

function mappingKey(fileName: string, sheetName: string, sourceField: string): string {
  return `${fileName}\u0000${sheetName}\u0000${sourceField}`;
}

function mergeMappings(
  table: ImportTableRows,
  overrides?: ImportFieldMappingInput[],
  aiMappings?: FieldMappingSuggestion[],
): FieldMappingSuggestion[] {
  const bySource = new Map<string, FieldMappingSuggestion>();
  table.mappings.forEach((mapping) => bySource.set(mapping.sourceField, mapping));
  aiMappings?.forEach((mapping) => bySource.set(mapping.sourceField, mapping));
  overrides
    ?.filter((mapping) => mapping.fileName === table.fileName && mapping.sheetName === table.sheetName)
    .forEach((mapping) => {
      bySource.set(mapping.sourceField, {
        sourceField: mapping.sourceField,
        canonicalField: mapping.canonicalField,
        canonicalLabel: canonicalFieldLabel(mapping.canonicalField),
        confidence: 1,
        source: "ai",
      });
    });
  return Array.from(bySource.values());
}

function missingImportFields(kind: ImportAnalysisTable["tableKind"], mappings: FieldMappingSuggestion[]): string[] {
  const fields = new Set(mappings.map((mapping) => mapping.canonicalField));
  if (kind === "customer") {
    return customerStandardFields
      .filter((field) => field.key === "customer.name" && !fields.has(field.key))
      .map((field) => field.target);
  }
  if (kind === "policy") {
    return policyStandardFields
      .filter((field) => ["policy.applicantName", "policy.insuredName", "policy.productName"].includes(field.key))
      .filter((field) => !fields.has(field.key))
      .map((field) => field.target);
  }
  return [];
}

function toProfiles(result: ImportAnalysisResult): StoredImportFieldProfile[] {
  return result.files.flatMap((file) =>
    file.tables.map((table) => ({
      fileName: table.fileName,
      sheetName: table.sheetName,
      tableKind: table.tableKind,
      rowCount: table.rowCount,
      headerCount: table.headers.length,
      mappings: table.mappings,
      analyzedAt: new Date().toISOString(),
    })),
  );
}

async function analyzeTable(
  table: ImportTableRows,
  request: ImportAnalysisRequest,
): Promise<ImportAnalysisTable> {
  let aiMappings: FieldMappingSuggestion[] | undefined;
  const shouldUseAi =
    request.ai?.enabled &&
    request.ai.providerId &&
    request.ai.apiKey &&
    (table.classification.kind === "unknown" || table.classification.confidence < 0.75);
  if (shouldUseAi && request.ai?.providerId && request.ai.apiKey) {
    aiMappings = await requestAiFieldMappings({
      providerId: request.ai.providerId,
      apiKey: request.ai.apiKey,
      fileName: table.fileName,
      sheetName: table.sheetName,
      headers: table.headers,
      sampleRows: table.sampleRows,
    });
  }

  const mappings = mergeMappings(table, undefined, aiMappings);
  const classification = classifyFieldMappingsWithContext(mappings, {
    fileName: table.fileName,
    sheetName: table.sheetName,
  });
  return {
    fileName: table.fileName,
    sheetName: table.sheetName,
    tableKind: classification.kind,
    confidence: classification.confidence,
    rowCount: table.rows.length,
    headers: table.headers,
    mappings,
    missingImportFields: missingImportFields(classification.kind, mappings),
  };
}

export async function analyzeImportFiles(request: ImportAnalysisRequest): Promise<ImportAnalysisResult> {
  const files = request.files.map((file) => readImportFileTables(file.filePath, file.fileName));
  const analyzedFiles = [];
  let aiUsed = false;

  for (const file of files) {
    const tables = [];
    for (const table of file.tables) {
      const analyzed = await analyzeTable(table, request);
      aiUsed ||= analyzed.mappings.some((mapping) => mapping.source === "ai");
      tables.push(analyzed);
    }
    analyzedFiles.push({ fileName: file.fileName, tables });
  }

  const result: ImportAnalysisResult = {
    files: analyzedFiles,
    summary: {
      customerTables: analyzedFiles.flatMap((file) => file.tables).filter((table) => table.tableKind === "customer").length,
      policyTables: analyzedFiles.flatMap((file) => file.tables).filter((table) => table.tableKind === "policy").length,
      familyTables: analyzedFiles.flatMap((file) => file.tables).filter((table) => table.tableKind === "family").length,
      unknownTables: analyzedFiles.flatMap((file) => file.tables).filter((table) => table.tableKind === "unknown").length,
      mappedFields: analyzedFiles.flatMap((file) => file.tables).reduce((sum, table) => sum + table.mappings.length, 0),
      aiUsed,
    },
  };
  saveImportFieldProfiles(request.dataRoot, toProfiles(result));
  return result;
}

function mappingByCanonical(
  table: ImportAnalysisTable,
): Map<CanonicalFieldKey, string> {
  return new Map(table.mappings.map((mapping) => [mapping.canonicalField, mapping.sourceField]));
}

function normalizedRows(
  table: ImportTableRows,
  analysisTable: ImportAnalysisTable,
  fields: Array<{ key: CanonicalFieldKey; target: string }>,
): Array<Record<string, string>> {
  const byCanonical = mappingByCanonical(analysisTable);
  return table.rows.map((row) => {
    const output: Record<string, string> = {};
    fields.forEach((field) => {
      const source = byCanonical.get(field.key);
      output[field.target] = source ? row[source] ?? "" : "";
    });
    return output;
  });
}

function writeWorkbook(filePath: string, sheetName: string, rows: Array<Record<string, string>>) {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  xlsx.writeFile(workbook, filePath);
}

export async function prepareGenericImportWorkbooks(input: {
  files: Array<{ fileName: string; filePath: string }>;
  uploadDir: string;
  dataRoot: string;
  mappings?: ImportFieldMappingInput[];
  ai?: ImportAnalysisRequest["ai"];
}): Promise<PreparedGenericImport> {
  const readFiles: ImportFileTables[] = input.files.map((file) => readImportFileTables(file.filePath, file.fileName));
  const analysis = await analyzeImportFiles({
    files: input.files,
    dataRoot: input.dataRoot,
    ai: input.ai,
  });
  const analysisTables = new Map<string, ImportAnalysisTable>(
    analysis.files.flatMap((file) =>
      file.tables.map((table) => [`${table.fileName}\u0000${table.sheetName}`, table] as const),
    ),
  );

  const customerRows: Array<Record<string, string>> = [];
  const policyRows: Array<Record<string, string>> = [];

  for (const file of readFiles) {
    for (const table of file.tables) {
      const key = `${file.fileName}\u0000${table.sheetName}`;
      const analyzed = analysisTables.get(key);
      if (!analyzed) {
        continue;
      }
      const overrides = input.mappings?.filter((mapping) => mapping.fileName === table.fileName && mapping.sheetName === table.sheetName);
      if (overrides?.length) {
        const merged = mergeMappings(table, overrides);
        const classification = classifyFieldMappingsWithContext(merged, {
          fileName: table.fileName,
          sheetName: table.sheetName,
        });
        analyzed.mappings = merged;
        analyzed.tableKind = classification.kind;
        analyzed.confidence = classification.confidence;
      }
      if (analyzed.tableKind === "customer") {
        analyzed.mappings = importableMappingsForKind("customer", analyzed.mappings);
        customerRows.push(...normalizedRows(table, analyzed, customerStandardFields));
      } else if (analyzed.tableKind === "policy") {
        analyzed.mappings = importableMappingsForKind("policy", analyzed.mappings);
        policyRows.push(...normalizedRows(table, analyzed, policyStandardFields));
      }
    }
  }

  const customerWorkbookPath = customerRows.length ? join(input.uploadDir, "generic-customers.xlsx") : undefined;
  const policyWorkbookPath = policyRows.length ? join(input.uploadDir, "generic-policies.xlsx") : undefined;
  if (customerWorkbookPath) {
    writeWorkbook(customerWorkbookPath, "客户信息", customerRows);
  }
  if (policyWorkbookPath) {
    writeWorkbook(policyWorkbookPath, "结果", policyRows);
  }

  saveImportFieldProfiles(input.dataRoot, toProfiles(analysis));
  return { customerWorkbookPath, policyWorkbookPath, analysis };
}

export function mappingInputKey(mapping: ImportFieldMappingInput): string {
  return mappingKey(mapping.fileName, mapping.sheetName, mapping.sourceField);
}

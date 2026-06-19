import { createRequire } from "node:module";
import { extname } from "node:path";
import type * as Xlsx from "xlsx";
import {
  classifyFieldMappings,
  classifyFieldMappingsWithContext,
  matchCanonicalField,
  type FieldMappingSuggestion,
  type ImportTableKind,
  type TableClassification,
} from "./fieldTaxonomy";

const require = createRequire(import.meta.url);
const xlsx = require("xlsx") as typeof Xlsx;

export interface UploadedImportFile {
  fileName: string;
  base64: string;
}

export interface ImportTableRows {
  fileName: string;
  filePath: string;
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  rows: Array<Record<string, string>>;
  sampleRows: Array<Record<string, string>>;
  mappings: FieldMappingSuggestion[];
  classification: TableClassification;
}

export interface ImportFileTables {
  fileName: string;
  filePath: string;
  tables: ImportTableRows[];
}

export function supportedImportFileExtension(fileName: string): boolean {
  return [".xlsx", ".xls", ".csv"].includes(extname(fileName).toLowerCase());
}

function trimCell(value: unknown): string {
  return String(value ?? "").trim();
}

function rowHasValue(row: string[]): boolean {
  return row.some((cell) => cell.trim());
}

function uniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const clean = header.trim() || `未命名列${index + 1}`;
    const nextCount = (counts.get(clean) ?? 0) + 1;
    counts.set(clean, nextCount);
    return nextCount === 1 ? clean : `${clean}_${nextCount}`;
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.map((item) => item.map(trimCell)).filter(rowHasValue);
}

function bestHeaderRow(rows: string[][]): number {
  let best = { index: 0, score: -1 };
  rows.slice(0, 10).forEach((row, index) => {
    const mappings = row.flatMap((header) => {
      const mapping = matchCanonicalField(header);
      return mapping ? [mapping] : [];
    });
    const classification = classifyFieldMappings(mappings);
    const score =
      mappings.length +
      classification.scores.customer +
      classification.scores.policy +
      classification.scores.family;
    if (score > best.score) {
      best = { index, score };
    }
  });
  return best.index;
}

function rowsToTable(input: {
  fileName: string;
  filePath: string;
  sheetName: string;
  rawRows: string[][];
}): ImportTableRows {
  const nonEmptyRows = input.rawRows.filter(rowHasValue);
  const headerRowIndex = bestHeaderRow(nonEmptyRows);
  const headers = uniqueHeaders(nonEmptyRows[headerRowIndex] ?? []);
  const rows = nonEmptyRows.slice(headerRowIndex + 1).map((row) => {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => {
      item[header] = trimCell(row[index]);
    });
    return item;
  });
  const mappings = headers.flatMap((header) => {
    const mapping = matchCanonicalField(header);
    return mapping ? [mapping] : [];
  });

  return {
    fileName: input.fileName,
    filePath: input.filePath,
    sheetName: input.sheetName,
    headerRowIndex,
    headers,
    rows,
    sampleRows: rows.slice(0, 3),
    mappings,
    classification: classifyFieldMappingsWithContext(mappings, {
      fileName: input.fileName,
      sheetName: input.sheetName,
    }),
  };
}

export function readImportFileTables(filePath: string, fileName: string): ImportFileTables {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".csv") {
    const workbook = xlsx.readFile(filePath, { type: "file", raw: false, codepage: 65001 });
    const sheetName = workbook.SheetNames[0] ?? "CSV";
    const sheet = workbook.Sheets[sheetName];
    const csv = xlsx.utils.sheet_to_csv(sheet);
    return {
      fileName,
      filePath,
      tables: [
        rowsToTable({
          fileName,
          filePath,
          sheetName,
          rawRows: parseCsv(csv),
        }),
      ],
    };
  }

  const workbook = xlsx.readFile(filePath, {
    cellDates: false,
    raw: false,
    dateNF: "yyyy-mm-dd",
  });

  return {
    fileName,
    filePath,
    tables: workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rawRows = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
        dateNF: "yyyy-mm-dd",
      }) as unknown[][];
      return rowsToTable({
        fileName,
        filePath,
        sheetName,
        rawRows: rawRows.map((row) => row.map(trimCell)),
      });
    }),
  };
}

export function tableKindLabel(kind: ImportTableKind): string {
  if (kind === "customer") return "客户表";
  if (kind === "policy") return "保单表";
  if (kind === "family") return "家庭保障表";
  return "未识别";
}

import { createRequire } from "node:module";
import type * as Xlsx from "xlsx";

const require = createRequire(import.meta.url);
const xlsx = require("xlsx") as typeof Xlsx;

export interface ExcelSheetRows {
  sheetName: string;
  rows: Array<Record<string, unknown>>;
}

function trimRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    trimmed[key.trim()] = value;
  }
  return trimmed;
}

export async function readWorkbookRows(filePath: string): Promise<ExcelSheetRows[]> {
  const workbook = xlsx.readFile(filePath, {
    cellDates: false,
    raw: false,
    dateNF: "yyyy-mm-dd",
  });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils
      .sheet_to_json<Record<string, unknown>>(sheet, {
        defval: undefined,
        raw: false,
        dateNF: "yyyy-mm-dd",
      })
      .map(trimRowKeys);

    return { sheetName, rows };
  });
}

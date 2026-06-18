import { describe, expect, it } from "vitest";
import { readWorkbookRows } from "../../src/importers/excelReader";

describe("excel reader", () => {
  it("lists workbook sheets", async () => {
    const sheets = await readWorkbookRows("tests/fixtures/customer-info.xlsx");

    expect(sheets.map((sheet) => sheet.sheetName)).toContain("客户信息");
  });

  it("returns rows with trimmed column names", async () => {
    const sheets = await readWorkbookRows("tests/fixtures/customer-info.xlsx");
    const customerSheet = sheets.find((sheet) => sheet.sheetName === "客户信息");

    expect(customerSheet?.rows[0]).toHaveProperty("客户姓名");
    expect(customerSheet?.rows[0]).toHaveProperty("证件号");
    expect(customerSheet?.rows[0]).not.toHaveProperty(" 客户姓名");
  });

  it("keeps date cells as yyyy-mm-dd strings", async () => {
    const sheets = await readWorkbookRows("tests/fixtures/customer-info.xlsx");
    const customerSheet = sheets.find((sheet) => sheet.sheetName === "客户信息");

    expect(customerSheet?.rows[0]["出生日期"]).toBe("1980-01-01");
  });
});

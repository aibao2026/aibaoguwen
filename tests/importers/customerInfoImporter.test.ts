import { describe, expect, it } from "vitest";
import { makeCustomerBusinessKey } from "../../src/domain/ids";
import { importCustomerInfoWorkbook } from "../../src/importers/customerInfoImporter";

describe("customer info importer", () => {
  it("imports customers from 客户信息 sheet", async () => {
    const result = await importCustomerInfoWorkbook("tests/fixtures/customer-info.xlsx");

    expect(result.customers.length).toBeGreaterThan(600);
    expect(result.customers[0]).toMatchObject({
      name: "测试客户0001",
      fullIdNumber: "110101198001010001",
      birthDate: "1980-01-01",
    });
  });

  it("maps phone and keeps full ID locally", async () => {
    const result = await importCustomerInfoWorkbook("tests/fixtures/customer-info.xlsx");
    const customer = result.customers.find((item) => item.name === "测试客户0002");

    expect(customer).toMatchObject({
      fullIdNumber: "110101198001020002",
      phone: "13900000002",
    });
  });

  it("skips blank rows and returns no empty-name customers", async () => {
    const result = await importCustomerInfoWorkbook("tests/fixtures/customer-info.xlsx");

    expect(result.customers.every((customer) => customer.name.trim().length > 0)).toBe(
      true,
    );
  });

  it("creates stable customer IDs from name and ID number", async () => {
    const result = await importCustomerInfoWorkbook("tests/fixtures/customer-info.xlsx");

    expect(result.customers[0].id).toBe(
      makeCustomerBusinessKey({
        name: "测试客户0001",
        idNumber: "110101198001010001",
      }),
    );
    expect(result.customers[0].id).toMatch(/^customer:[a-f0-9]{16}$/);
    expect(result.customers[0].id).not.toContain("测试客户0001");
    expect(result.customers[0].id).not.toContain("110101198001010001");
  });
});

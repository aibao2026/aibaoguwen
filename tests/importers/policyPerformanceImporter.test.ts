import { describe, expect, it } from "vitest";
import { importPolicyPerformanceWorkbook } from "../../src/importers/policyPerformanceImporter";

describe("policy performance importer", () => {
  it("imports policies from 结果 sheet", async () => {
    const result = await importPolicyPerformanceWorkbook(
      "tests/fixtures/policy-performance.xlsx",
    );

    expect(result.policies.length).toBeGreaterThan(700);
    expect(result.policies[0]).toMatchObject({
      applicantName: "测试客户0001",
      applicantMaskedIdNumber: "11*************001",
      insuredName: "测试客户0001",
      insuredMaskedIdNumber: "11*************001",
      policyNumber: "TEST-POLICY-0001",
      insurerName: "示例保险公司",
      productName: "示例保障计划A",
      paymentMethod: "年交",
      paymentPeriodRaw: "5年",
      effectiveDate: "2026-06-23",
    });
  });

  it("maps premium as number when present", async () => {
    const result = await importPolicyPerformanceWorkbook(
      "tests/fixtures/policy-performance.xlsx",
    );

    expect(result.policies[0].premium).toBe(1001);
  });

  it("creates stable policy IDs from policy number", async () => {
    const result = await importPolicyPerformanceWorkbook(
      "tests/fixtures/policy-performance.xlsx",
    );

    expect(result.policies[0].id).toBe(
      "policy:TEST-POLICY-0001:测试客户0001:示例保障计划A",
    );
  });

  it("does not calculate reminders during import", async () => {
    const result = await importPolicyPerformanceWorkbook(
      "tests/fixtures/policy-performance.xlsx",
    );

    expect(result.policies[0]).not.toHaveProperty("reminderDate");
  });
});

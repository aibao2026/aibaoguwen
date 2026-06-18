import { describe, expect, it } from "vitest";
import {
  makeCustomerBusinessKey,
  makePolicyBusinessKey,
  makeReminderBusinessKey,
} from "../../src/domain/ids";

describe("business key generation", () => {
  it("uses normalized customer name and full ID number to create an opaque customer key", () => {
    const key = makeCustomerBusinessKey({
      name: " 测试客户0001 ",
      idNumber: " 110101198001010001 ",
    });
    const repeatedKey = makeCustomerBusinessKey({
      name: "测试客户0001",
      idNumber: "110101198001010001",
    });

    expect(key).toMatch(/^customer:[a-f0-9]{16}$/);
    expect(key).toBe(repeatedKey);
    expect(key).not.toContain("测试客户0001");
    expect(key).not.toContain("110101198001010001");
  });

  it("uses normalized customer name and masked ID without exposing the masked ID", () => {
    const key = makeCustomerBusinessKey({
      name: "测试客户0002",
      idNumber: "11*************002",
    });

    expect(key).toMatch(/^customer:[a-f0-9]{16}$/);
    expect(key).not.toContain("测试客户0002");
    expect(key).not.toContain("11*************002");
    expect(key).not.toContain("*");
  });

  it("uses policy number and product name when present", () => {
    const key = makePolicyBusinessKey({
      policyNumber: " TEST-POLICY-0001 ",
      applicantName: "测试客户0001",
      insuredName: "测试客户0001",
      productName: "示例保障计划A",
      effectiveDate: "2026-06-23",
    });

    expect(key).toBe("policy:TEST-POLICY-0001:测试客户0001:示例保障计划A");
  });

  it("separates main and rider products that share a policy number", () => {
    const main = makePolicyBusinessKey({
      policyNumber: "TEST-POLICY-0100",
      applicantName: "测试客户0100",
      insuredName: "测试客户0100",
      productName: "示例少儿重疾主险",
      effectiveDate: "2021-01-01",
    });
    const rider = makePolicyBusinessKey({
      policyNumber: "TEST-POLICY-0100",
      applicantName: "测试客户0100",
      insuredName: "测试客户0100",
      productName: "示例附加投保人豁免险",
      effectiveDate: "2021-01-01",
    });

    expect(main).not.toBe(rider);
  });

  it("separates multiple insured people that share a policy number and product", () => {
    const first = makePolicyBusinessKey({
      policyNumber: "TEST-POLICY-0200",
      applicantName: "测试客户0200",
      insuredName: "测试家属0200",
      productName: "示例长期医疗计划",
      effectiveDate: "2025-09-15",
    });
    const second = makePolicyBusinessKey({
      policyNumber: "TEST-POLICY-0200",
      applicantName: "测试客户0200",
      insuredName: "测试客户0200",
      productName: "示例长期医疗计划",
      effectiveDate: "2025-09-15",
    });

    expect(first).not.toBe(second);
  });

  it("falls back to applicant, insured, product, and effective date without policy number", () => {
    const key = makePolicyBusinessKey({
      applicantName: " 张三 ",
      insuredName: " 李四 ",
      productName: " 保障计划 A ",
      effectiveDate: "2023-08-01",
    });

    expect(key).toBe("policy-fallback:张三:李四:保障计划 A:2023-08-01");
  });

  it("uses group, date, relation, and title for reminder keys", () => {
    const customerId = makeCustomerBusinessKey({
      name: "张三",
      idNumber: "110101199001010010",
    });
    const key = makeReminderBusinessKey({
      group: "policy_renewal",
      reminderDate: "2026-08-01",
      customerId,
      policyId: "policy:abc",
      title: " 续期提醒：张三 ",
    });

    expect(key).toBe(
      `reminder:policy_renewal:2026-08-01:${customerId}:policy:abc:续期提醒：张三`,
    );
    expect(key).not.toContain("110101199001010010");
  });
});

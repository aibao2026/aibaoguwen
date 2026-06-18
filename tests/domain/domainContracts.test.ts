import { describe, expect, it } from "vitest";
import type {
  Customer,
  PendingConfirmation,
  Policy,
  Reminder,
} from "../../src/domain/types";

describe("domain contracts", () => {
  it("represents a birthday customer without importing infrastructure code", () => {
    const customer: Customer = {
      id: "customer:97782d8024193a86",
      name: "测试客户0001",
      fullIdNumber: "110101198001010001",
      phone: "13800000000",
      birthDate: "1980-01-01",
    };

    expect(customer.birthDate).toBe("1980-01-01");
  });

  it("represents a policy candidate with explicit renewal fields", () => {
    const policy: Policy = {
      id: "policy:TEST-POLICY-0001",
      policyNumber: "TEST-POLICY-0001",
      applicantName: "测试客户0001",
      insuredName: "测试客户0001",
      productName: "示例保障计划A",
      insurerName: "示例保险公司",
      premium: 1001,
      paymentPeriodRaw: "1年",
      effectiveDate: "2026-06-23",
    };

    expect(policy.paymentPeriodRaw).toBe("1年");
  });

  it("represents a renewal reminder linked to a policy", () => {
    const reminder: Reminder = {
      id: "reminder:policy_renewal:2026-08-01:policy:abc",
      group: "policy_renewal",
      title: "续期提醒：张三",
      reminderDate: "2026-08-01",
      status: "pending",
      isKey: false,
      policyId: "policy:abc",
      source: "policy_import",
    };

    expect(reminder.status).toBe("pending");
  });

  it("represents a pending confirmation with auditable payload", () => {
    const pending: PendingConfirmation = {
      id: "pending:unsupported_payment_period:policy:abc",
      reason: "unsupported_payment_period",
      title: "缴费期间需确认",
      detail: "60周岁暂不自动计算",
      payload: { paymentPeriodRaw: "60周岁" },
    };

    expect(pending.payload).toEqual({ paymentPeriodRaw: "60周岁" });
  });
});

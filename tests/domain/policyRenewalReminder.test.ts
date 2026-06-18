import { describe, expect, it } from "vitest";
import {
  generatePolicyRenewalReminders,
  getPolicyRenewalSchedule,
  parsePaymentYears,
} from "../../src/domain/reminders/policyRenewalReminder";
import type { Policy } from "../../src/domain/types";

const today = "2026-06-17";

function policy(overrides: Partial<Policy>): Policy {
  return {
    id: "policy:default",
    applicantName: "张三",
    insuredName: "张三",
    productName: "测试产品",
    ...overrides,
  };
}

describe("payment period parser", () => {
  it("parses explicit year periods", () => {
    expect(parsePaymentYears("10年")).toEqual({ ok: true, years: 10 });
    expect(parsePaymentYears(" 30年 ")).toEqual({ ok: true, years: 30 });
  });

  it("keeps age-based periods out of explicit year parsing", () => {
    expect(parsePaymentYears("60周岁")).toEqual({
      ok: false,
      reason: "unsupported_payment_period",
    });
  });

  it("rejects missing periods", () => {
    expect(parsePaymentYears()).toEqual({
      ok: false,
      reason: "missing_required_field",
    });
  });
});

describe("policy renewal reminder generation", () => {
  it("generates only the next renewal reminder when it is within 60 days", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:abc",
        insuredName: "张三",
        paymentPeriodRaw: "10年",
        effectiveDate: "2023-08-01",
      }),
      today,
    );

    expect(result).toMatchObject({
      ended: false,
      confirmations: [],
    });
    expect(result.schedule).toMatchObject({
      nextRenewalDate: "2026-08-01",
      finalPaymentYear: 2032,
      ended: false,
    });
    expect(result.reminders.map((reminder) => reminder.reminderDate)).toEqual(["2026-08-01"]);
    expect(result.reminders[0]).toMatchObject({
      group: "policy_renewal",
      title: "续期提醒：张三",
      policyId: "policy:abc",
      source: "policy_import",
    });
  });

  it("keeps the next renewal in schedule but does not generate a reminder outside 60 days", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:abc",
        insuredName: "张三",
        paymentPeriodRaw: "10年",
        effectiveDate: "2023-05-01",
      }),
      today,
    );

    expect(result).toMatchObject({
      ended: false,
      confirmations: [],
      schedule: {
        nextRenewalDate: "2027-05-01",
        finalPaymentYear: 2032,
        ended: false,
      },
    });
    expect(result.reminders).toEqual([]);
  });

  it("marks policy ended when payment period is already complete", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:ended",
        paymentPeriodRaw: "1年",
        effectiveDate: "2025-05-01",
      }),
      today,
    );

    expect(result).toMatchObject({
      reminders: [],
      confirmations: [],
      ended: true,
      schedule: {
        finalPaymentYear: 2025,
        ended: true,
      },
    });
  });

  it("uses the 59th birthday year when birthday comes before the policy date", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:age",
        insuredName: "李四",
        paymentPeriodRaw: "60周岁",
        effectiveDate: "2023-05-01",
      }),
      "2029-04-01",
      { insuredBirthDate: "1970-03-01" },
    );

    expect(result).toMatchObject({
      ended: false,
      confirmations: [],
    });
    expect(result.schedule).toMatchObject({
      nextRenewalDate: "2029-05-01",
      finalPaymentYear: 2029,
    });
    expect(result.reminders.map((reminder) => reminder.reminderDate)).toEqual(["2029-05-01"]);
  });

  it("uses the 60th birthday year when policy date comes before birthday", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:age",
        insuredName: "李四",
        paymentPeriodRaw: "60周岁",
        effectiveDate: "2023-05-01",
      }),
      "2030-04-01",
      { insuredBirthDate: "1970-08-01" },
    );

    expect(result).toMatchObject({
      ended: false,
      confirmations: [],
    });
    expect(result.schedule).toMatchObject({
      nextRenewalDate: "2030-05-01",
      finalPaymentYear: 2030,
    });
    expect(result.reminders.map((reminder) => reminder.reminderDate)).toEqual(["2030-05-01"]);
  });

  it("treats same-day birthday and policy date as birthday already reached", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:age",
        insuredName: "李四",
        paymentPeriodRaw: "60周岁",
        effectiveDate: "2023-05-01",
      }),
      "2029-04-01",
      { insuredBirthDate: "1970-05-01" },
    );

    expect(result.schedule).toMatchObject({
      nextRenewalDate: "2029-05-01",
      finalPaymentYear: 2029,
    });
    expect(result.reminders.map((reminder) => reminder.reminderDate)).toEqual(["2029-05-01"]);
  });

  it("exposes the next renewal date and payment final year without creating a reminder", () => {
    const schedule = getPolicyRenewalSchedule(
      policy({
        id: "policy:future",
        insuredName: "王五",
        paymentPeriodRaw: "20年",
        effectiveDate: "2023-12-01",
      }),
      today,
    );

    expect(schedule).toEqual({
      nextRenewalDate: "2026-12-01",
      finalPaymentYear: 2042,
      ended: false,
    });
  });

  it("returns pending confirmation for age-based periods without customer birthday", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:age",
        insuredName: "李四",
        insuredCustomerId: "customer:li-si",
        paymentPeriodRaw: "60周岁",
        effectiveDate: "2023-05-01",
      }),
      today,
    );

    expect(result.reminders).toEqual([]);
    expect(result.ended).toBe(false);
    expect(result.confirmations[0]).toMatchObject({
      reason: "missing_required_field",
      title: "客户生日需确认",
      payload: {
        customerId: "customer:li-si",
      },
    });
  });

  it("returns pending confirmation when effective date is missing", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:missing-date",
        paymentPeriodRaw: "10年",
      }),
      today,
    );

    expect(result.confirmations[0]).toMatchObject({
      reason: "missing_required_field",
      title: "生效时间需确认",
    });
  });

  it("returns pending confirmation when payment period is missing", () => {
    const result = generatePolicyRenewalReminders(
      policy({
        id: "policy:missing-period",
        effectiveDate: "2023-05-01",
      }),
      today,
    );

    expect(result.confirmations[0]).toMatchObject({
      reason: "missing_required_field",
      title: "缴费期间需确认",
    });
  });
});

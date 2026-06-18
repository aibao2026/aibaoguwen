import { describe, expect, it } from "vitest";
import { generateBirthdayReminder } from "../../src/domain/reminders/birthdayReminder";
import type { Customer } from "../../src/domain/types";

const today = "2026-06-17";

function customer(overrides: Partial<Customer>): Customer {
  return {
    id: "customer:default",
    name: "默认客户",
    ...overrides,
  };
}

describe("birthday reminder generation", () => {
  it("generates next year's birthday when this year's birthday has passed", () => {
    const result = generateBirthdayReminder(
      customer({
        id: "customer:test-0001",
        name: "测试客户0001",
        birthDate: "1980-01-01",
      }),
      today,
    );

    expect(result).toMatchObject({
      group: "birthday",
      title: "生日提醒：测试客户0001",
      reminderDate: "2027-01-01",
      status: "pending",
      customerId: "customer:test-0001",
      source: "birthday_import",
    });
  });

  it("generates this year's birthday when it has not passed", () => {
    const result = generateBirthdayReminder(
      customer({
        id: "customer:test-0002",
        name: "测试客户0002",
        birthDate: "1973-10-24",
      }),
      today,
    );

    expect(result).toMatchObject({
      reminderDate: "2026-10-24",
      title: "生日提醒：测试客户0002",
    });
  });

  it("uses February 28 for leap day birthdays in a non-leap reminder year", () => {
    const result = generateBirthdayReminder(
      customer({
        id: "customer:闰年客户",
        name: "闰年客户",
        birthDate: "2000-02-29",
      }),
      today,
    );

    expect(result).toMatchObject({
      reminderDate: "2027-02-28",
      title: "生日提醒：闰年客户",
    });
  });

  it("returns pending confirmation when birth date is missing", () => {
    const result = generateBirthdayReminder(
      customer({
        id: "customer:缺日期客户",
        name: "缺日期客户",
      }),
      today,
    );

    expect(result).toMatchObject({
      reason: "missing_required_field",
      title: "生日日期需确认",
    });
  });
});

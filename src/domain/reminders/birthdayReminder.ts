import { makeReminderBusinessKey } from "../ids";
import type { Customer, PendingConfirmation, Reminder } from "../types";

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function formatDate(year: number, month: number, day: number): string {
  const resolvedDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return `${year}-${String(month).padStart(2, "0")}-${String(resolvedDay).padStart(2, "0")}`;
}

function pending(customer: Customer, birthDate?: string): PendingConfirmation {
  return {
    id: `pending:birthday:${customer.id}`,
    reason: "missing_required_field",
    title: "生日日期需确认",
    detail: `${customer.name} 缺少可识别的出生日期`,
    payload: {
      customerId: customer.id,
      customerName: customer.name,
      birthDate,
    },
  };
}

export function generateBirthdayReminder(
  customer: Customer,
  today: string,
): Reminder | PendingConfirmation {
  if (!customer.birthDate) {
    return pending(customer);
  }

  const birthDate = parseDateOnly(customer.birthDate);
  const todayDate = parseDateOnly(today);
  if (!birthDate || !todayDate) {
    return pending(customer, customer.birthDate);
  }

  const todayYear = todayDate.getUTCFullYear();
  const birthMonth = birthDate.getUTCMonth() + 1;
  const birthDay = birthDate.getUTCDate();
  const thisYearBirthday = formatDate(todayYear, birthMonth, birthDay);
  const reminderDate =
    thisYearBirthday >= today
      ? thisYearBirthday
      : formatDate(todayYear + 1, birthMonth, birthDay);
  const title = `生日提醒：${customer.name}`;

  return {
    id: makeReminderBusinessKey({
      group: "birthday",
      reminderDate,
      customerId: customer.id,
      title,
    }),
    group: "birthday",
    title,
    reminderDate,
    status: "pending",
    isKey: false,
    customerId: customer.id,
    source: "birthday_import",
  };
}

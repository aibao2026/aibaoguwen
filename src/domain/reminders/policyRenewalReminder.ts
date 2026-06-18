import { makeReminderBusinessKey } from "../ids";
import type {
  ConfirmationReason,
  PendingConfirmation,
  Policy,
  Reminder,
} from "../types";

type PaymentYearsResult =
  | { ok: true; years: number }
  | { ok: false; reason: ConfirmationReason };

type PaymentEndYearResult =
  | { ok: true; finalPaymentYear: number }
  | { ok: false; reason: ConfirmationReason; title: string; detail: string };

interface RenewalContext {
  insuredBirthDate?: string;
}

export interface PolicyRenewalSchedule {
  nextRenewalDate?: string;
  finalPaymentYear?: number;
  ended: boolean;
}

function parseDateOnly(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

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

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysUntil(left: Date, right: Date): number {
  return Math.floor((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

function pending(
  policy: Policy,
  reason: ConfirmationReason,
  title: string,
  detail: string,
): PendingConfirmation {
  return {
    id: `pending:policy_renewal:${reason}:${policy.id}`,
    reason,
    title,
    detail,
    payload: {
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      productName: policy.productName,
      paymentPeriodRaw: policy.paymentPeriodRaw,
      effectiveDate: policy.effectiveDate,
      customerId: policy.insuredCustomerId,
    },
  };
}

function compareMonthDay(
  left: { month: number; day: number },
  right: { month: number; day: number },
): number {
  if (left.month !== right.month) {
    return left.month - right.month;
  }
  return left.day - right.day;
}

export function parsePaymentYears(raw?: string): PaymentYearsResult {
  const value = raw?.trim();
  if (!value) {
    return { ok: false, reason: "missing_required_field" };
  }

  const explicitYears = /^(\d+)年$/.exec(value);
  if (!explicitYears) {
    return { ok: false, reason: "unsupported_payment_period" };
  }

  const years = Number(explicitYears[1]);
  if (!Number.isInteger(years) || years <= 0) {
    return { ok: false, reason: "unsupported_payment_period" };
  }

  return { ok: true, years };
}

function finalPaymentYearForAgeLimit(
  birthDate: Date,
  effectiveDate: Date,
  ageLimit: number,
): number {
  const birthday = {
    month: birthDate.getUTCMonth() + 1,
    day: birthDate.getUTCDate(),
  };
  const effectiveDay = {
    month: effectiveDate.getUTCMonth() + 1,
    day: effectiveDate.getUTCDate(),
  };
  const birthdayIsBeforeOrOnEffectiveDay = compareMonthDay(birthday, effectiveDay) <= 0;

  return birthDate.getUTCFullYear() + ageLimit - (birthdayIsBeforeOrOnEffectiveDay ? 1 : 0);
}

function paymentFinalYear(
  policy: Policy,
  effectiveDate: Date,
  context: RenewalContext,
): PaymentEndYearResult {
  const explicitYears = parsePaymentYears(policy.paymentPeriodRaw);
  if (explicitYears.ok) {
    return {
      ok: true,
      finalPaymentYear: effectiveDate.getUTCFullYear() + explicitYears.years - 1,
    };
  }

  const value = policy.paymentPeriodRaw?.trim();
  const ageLimitMatch = /^(\d+)周岁$/.exec(value ?? "");
  if (!ageLimitMatch) {
    return {
      ok: false,
      reason: explicitYears.reason,
      title: "缴费期间需确认",
      detail: `${policy.insuredName} 的 ${policy.productName} 缴费期间无法自动计算`,
    };
  }

  const ageLimit = Number(ageLimitMatch[1]);
  if (!Number.isInteger(ageLimit) || ageLimit <= 0) {
    return {
      ok: false,
      reason: "unsupported_payment_period",
      title: "缴费期间需确认",
      detail: `${policy.insuredName} 的 ${policy.productName} 缴费期间无法自动计算`,
    };
  }

  const birthDate = parseDateOnly(context.insuredBirthDate);
  if (!birthDate) {
    return {
      ok: false,
      reason: "missing_required_field",
      title: "客户生日需确认",
      detail: `${policy.insuredName} 的 ${policy.productName} 使用 ${value} 缴费期间，需要先确认客户生日`,
    };
  }

  return {
    ok: true,
    finalPaymentYear: finalPaymentYearForAgeLimit(birthDate, effectiveDate, ageLimit),
  };
}

export function getPolicyRenewalSchedule(
  policy: Policy,
  today: string,
  context: RenewalContext = {},
): PolicyRenewalSchedule | PendingConfirmation {
  const effectiveDate = parseDateOnly(policy.effectiveDate);
  if (!effectiveDate) {
    return pending(
      policy,
      "missing_required_field",
      "生效时间需确认",
      `${policy.insuredName} 的 ${policy.productName} 缺少可识别的生效时间`,
    );
  }

  const todayDate = parseDateOnly(today);
  if (!todayDate) {
    throw new Error(`Invalid today value: ${today}`);
  }

  const paymentEndYear = paymentFinalYear(policy, effectiveDate, context);
  if (!paymentEndYear.ok) {
    return pending(policy, paymentEndYear.reason, paymentEndYear.title, paymentEndYear.detail);
  }

  const renewalDay = {
    month: effectiveDate.getUTCMonth() + 1,
    day: effectiveDate.getUTCDate(),
  };
  const todayDay = {
    month: todayDate.getUTCMonth() + 1,
    day: todayDate.getUTCDate(),
  };
  const nextRenewalYear =
    compareMonthDay(todayDay, renewalDay) <= 0
      ? todayDate.getUTCFullYear()
      : todayDate.getUTCFullYear() + 1;

  if (nextRenewalYear > paymentEndYear.finalPaymentYear) {
    return {
      finalPaymentYear: paymentEndYear.finalPaymentYear,
      ended: true,
    };
  }

  return {
    nextRenewalDate: formatDate(nextRenewalYear, renewalDay.month, renewalDay.day),
    finalPaymentYear: paymentEndYear.finalPaymentYear,
    ended: false,
  };
}

export function generatePolicyRenewalReminders(
  policy: Policy,
  today: string,
  context: RenewalContext = {},
): {
  reminders: Reminder[];
  confirmations: PendingConfirmation[];
  ended: boolean;
  schedule?: PolicyRenewalSchedule;
} {
  const schedule = getPolicyRenewalSchedule(policy, today, context);
  if ("reason" in schedule) {
    return {
      reminders: [],
      confirmations: [schedule],
      ended: false,
    };
  }

  const todayDate = parseDateOnly(today);
  if (!todayDate) {
    throw new Error(`Invalid today value: ${today}`);
  }

  if (schedule.ended || !schedule.nextRenewalDate) {
    return {
      reminders: [],
      confirmations: [],
      ended: schedule.ended,
      schedule,
    };
  }

  const nextRenewalDate = parseDateOnly(schedule.nextRenewalDate);
  if (!nextRenewalDate) {
    throw new Error(`Invalid next renewal date: ${schedule.nextRenewalDate}`);
  }

  const renewalWindowEnd = addDays(todayDate, 60);
  const reminders: Reminder[] = [];

  if (daysUntil(todayDate, nextRenewalDate) >= 0 && nextRenewalDate <= renewalWindowEnd) {
    const title = `续期提醒：${policy.insuredName}`;
    reminders.push({
      id: makeReminderBusinessKey({
        group: "policy_renewal",
        reminderDate: schedule.nextRenewalDate,
        policyId: policy.id,
        title,
      }),
      group: "policy_renewal",
      title,
      reminderDate: schedule.nextRenewalDate,
      status: "pending",
      isKey: false,
      policyId: policy.id,
      customerId: policy.insuredCustomerId,
      source: "policy_import",
    });
  }

  return {
    reminders,
    confirmations: [],
    ended: schedule.ended,
    schedule,
  };
}

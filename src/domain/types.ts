export type ReminderGroup = "birthday" | "policy_renewal" | "manual_todo";

export type ReminderStatus = "pending" | "completed";

export type ConfirmationReason =
  | "unsupported_payment_period"
  | "missing_required_field"
  | "identity_incomplete"
  | "strict_match_failed"
  | "key_field_changed";

export interface Customer {
  id: string;
  name: string;
  fullIdNumber?: string;
  maskedIdNumber?: string;
  phone?: string;
  birthDate?: string;
}

export interface Policy {
  id: string;
  policyNumber?: string;
  applicantCustomerId?: string;
  insuredCustomerId?: string;
  applicantName: string;
  applicantMaskedIdNumber?: string;
  insuredName: string;
  insuredMaskedIdNumber?: string;
  productName: string;
  insurerName?: string;
  premium?: number;
  paymentMethod?: string;
  paymentPeriodRaw?: string;
  effectiveDate?: string;
}

export interface KeyFieldChange {
  field: string;
  label: string;
  current?: string | number;
  incoming: string | number;
}

export type ReminderSource = "birthday_import" | "policy_import" | "manual";

export interface Reminder {
  id: string;
  group: ReminderGroup;
  title: string;
  reminderDate: string;
  status: ReminderStatus;
  isKey: boolean;
  customerId?: string;
  policyId?: string;
  source: ReminderSource;
}

export interface PendingConfirmation {
  id: string;
  reason: ConfirmationReason;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  status?: "open" | "resolved";
  resolutionNote?: string;
  resolvedAt?: string;
}

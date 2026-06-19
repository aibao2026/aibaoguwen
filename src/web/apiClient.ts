export interface ReminderItem {
  id: string;
  group: "birthday" | "policy_renewal" | "manual_todo";
  title: string;
  reminderDate: string;
  status: "pending" | "completed";
  isKey: boolean;
  customerId?: string;
  policyId?: string;
  source?: "birthday_import" | "policy_import" | "manual";
  policySummary?: {
    policyNumber?: string;
    productName: string;
    insurerName?: string;
    premium?: number;
    paymentMethod?: string;
    paymentPeriodRaw?: string;
    effectiveDate?: string;
    nextRenewalDate?: string;
    finalPaymentYear?: number;
  };
}

export interface CustomerItem {
  id: string;
  name: string;
  fullIdNumber?: string;
  maskedIdNumber?: string;
  phone?: string;
  birthDate?: string;
}

export interface PolicyItem {
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
  nextRenewalDate?: string;
  finalPaymentYear?: number;
}

export interface ReminderDetail {
  reminder: ReminderItem;
  customer?: CustomerItem;
  policy?: PolicyItem;
  applicantCustomer?: CustomerItem;
  insuredCustomer?: CustomerItem;
}

export interface PendingItem {
  id: string;
  reason: string;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  status?: "open" | "resolved";
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface KeyFieldChangeItem {
  field: string;
  label: string;
  current?: string | number;
  incoming: string | number;
}

export interface PendingCorrectionInput {
  birthDate?: string;
  effectiveDate?: string;
  paymentPeriodRaw?: string;
}

export interface FeishuDryRunSummary {
  customers: number;
  policies: number;
  reminders: number;
  keyCalendarReminders: number;
}

export interface LocalDataStats {
  customers: number;
  policies: number;
  reminders: {
    total: number;
    pending: number;
    completed: number;
    birthday: number;
    policyRenewal: number;
    manualTodo: number;
    keyPending: number;
  };
  pendingConfirmations: {
    open: number;
    resolved: number;
  };
  health: {
    legacyPolicyKeys: number;
  };
}

export interface DataBackupItem {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
}

export interface ImportPreviewResult {
  mode: "preview";
  summary: {
    importedCustomers: number;
    importedPolicies: number;
    persistedCustomers: number;
    persistedPolicies: number;
    generatedReminders: number;
    pendingConfirmations: number;
  };
  before: LocalDataStats;
  after: LocalDataStats;
  delta: {
    customers: number;
    policies: number;
    reminders: number;
    openPendingConfirmations: number;
  };
}

export interface FeishuBaseSyncResult {
  mode: "plan" | "execute";
  summary: {
    planned: number;
    created: number;
    updated?: number;
    failed: number;
    skippedByLimit?: number;
    skippedExisting?: number;
    batches?: number;
  };
  commands?: Array<{
    table: "customers" | "policies" | "reminders";
    tableRef: string;
    externalId: string;
    operation: "create" | "update";
    fields: Record<string, string | number | boolean | null>;
    argv: string[];
  }>;
  batches?: Array<{
    table: "customers" | "policies" | "reminders";
    tableRef: string;
    planned: number;
    operation: "batch_create" | "skip_existing";
    argv: string[];
  }>;
  errors: Array<{ externalId: string; table: string; message: string }>;
  previewCount: number;
  totalCommands: number;
}

export interface FeishuBaseSchemaResult {
  mode: "plan" | "execute";
  summary: {
    planned: number;
    executed: number;
    skippedExisting: number;
    failed: number;
  };
  commands: Array<{
    action: "list_tables" | "create_table" | "list_fields" | "create_field";
    table: "customers" | "policies" | "reminders";
    tableName: string;
    fieldName?: string;
    argv: string[];
  }>;
  tables: Record<"customers" | "policies" | "reminders", { name: string; tableId?: string }>;
  errors: Array<{ action: string; table: string; fieldName?: string; message: string }>;
  previewCount: number;
  totalCommands: number;
}

export interface FeishuBaseCalendarViewResult {
  mode: "plan" | "execute";
  summary: {
    planned: number;
    executed: number;
    skippedExisting: number;
    failed: number;
  };
  tableName: string;
  viewName: string;
  viewId?: string;
  commands: Array<{
    action: "list_views" | "create_view" | "set_timebar" | "set_visible_fields";
    tableName: string;
    viewName: string;
    argv: string[];
  }>;
  errors: Array<{ action: string; message: string }>;
}

export interface FeishuCalendarSyncResult {
  mode: "plan" | "execute";
  calendarId: string;
  summary: {
    planned: number;
    created: number;
    skippedExisting: number;
    failed: number;
    skippedByLimit: number;
  };
  commands: Array<{
    externalId: string;
    title: string;
    reminderDate: string;
    operation: "create" | "skip_existing";
    calendarId: string;
    eventId?: string;
    argv: string[];
  }>;
  errors: Array<{ externalId: string; message: string }>;
}

export interface WorkbookUpload {
  fileName: string;
  base64: string;
}

export type AiProviderId = "deepseek" | "qwen" | "glm" | "moonshot" | "openai";

export interface AiSettings {
  providerId: AiProviderId;
  apiKeyConfigured: boolean;
  providers: Array<{ id: AiProviderId; name: string; model: string }>;
}

export type ImportTableKind = "customer" | "policy" | "family" | "unknown";

export interface ImportFieldMapping {
  sourceField: string;
  canonicalField: string;
  canonicalLabel: string;
  confidence: number;
  source: "rule" | "ai";
}

export interface ImportAnalysisResult {
  files: Array<{
    fileName: string;
    tables: Array<{
      fileName: string;
      sheetName: string;
      tableKind: ImportTableKind;
      confidence: number;
      rowCount: number;
      headers: string[];
      mappings: ImportFieldMapping[];
      missingImportFields: string[];
    }>;
  }>;
  summary: {
    customerTables: number;
    policyTables: number;
    familyTables: number;
    unknownTables: number;
    mappedFields: number;
    aiUsed: boolean;
  };
}

export interface ImportFieldMappingInput {
  fileName: string;
  sheetName: string;
  sourceField: string;
  canonicalField: string;
}

export interface AiImportOptions {
  enabled?: boolean;
  providerId?: AiProviderId;
  apiKey?: string;
  useSavedKey?: boolean;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export function getAuthStatus() {
  return request<{ enabled: boolean; authenticated: boolean }>("/api/auth/status");
}

export function loginWithPassword(password: string) {
  return request<{ ok: true }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function logout() {
  return request<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getAiSettings() {
  return request<AiSettings>("/api/ai/settings");
}

export function saveAiSettings(input: { providerId: AiProviderId; apiKey?: string }) {
  return request<AiSettings>("/api/ai/settings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function importWorkbooks(input: {
  customerWorkbookPath?: string;
  policyWorkbookPath?: string;
  customerWorkbookFile?: WorkbookUpload;
  policyWorkbookFile?: WorkbookUpload;
  files?: WorkbookUpload[];
  mappings?: ImportFieldMappingInput[];
  ai?: AiImportOptions;
}) {
  return request<{
    importedCustomers: number;
    importedPolicies: number;
    persistedCustomers: number;
    persistedPolicies: number;
    generatedReminders: number;
    pendingConfirmations: number;
  }>("/api/imports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function previewImport(input: {
  customerWorkbookPath?: string;
  policyWorkbookPath?: string;
  customerWorkbookFile?: WorkbookUpload;
  policyWorkbookFile?: WorkbookUpload;
  files?: WorkbookUpload[];
  mappings?: ImportFieldMappingInput[];
  ai?: AiImportOptions;
}) {
  return request<ImportPreviewResult>("/api/imports/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function analyzeImport(input: {
  files: WorkbookUpload[];
  ai?: AiImportOptions;
}) {
  return request<ImportAnalysisResult>("/api/imports/analyze", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listReminders() {
  return request<{ items: ReminderItem[] }>("/api/reminders");
}

export function getLocalDataStats() {
  return request<LocalDataStats>("/api/stats");
}

export function listBackups() {
  return request<{ items: DataBackupItem[] }>("/api/backups");
}

export function createBackup(label?: string) {
  return request<{ ok: true; backup: DataBackupItem }>("/api/backups", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function restoreBackup(fileName: string) {
  return request<{ ok: true; restored: string; stats: LocalDataStats }>("/api/backups/restore", {
    method: "POST",
    body: JSON.stringify({ fileName }),
  });
}

export function getReminderDetail(id: string) {
  return request<ReminderDetail>(`/api/reminders/${encodeURIComponent(id)}/detail`);
}

export function completeReminder(id: string) {
  return request<{ ok: true; updated: boolean }>(`/api/reminders/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function completeRemindersByDate(reminderDate: string) {
  return request<{ ok: true; completed: number }>("/api/reminders/complete-date", {
    method: "POST",
    body: JSON.stringify({ reminderDate }),
  });
}

export function reopenReminder(id: string) {
  return request<{ ok: true }>(`/api/reminders/${encodeURIComponent(id)}/reopen`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function deleteReminder(id: string) {
  return request<{ ok: true }>(`/api/reminders/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function createTodo(input: {
  title: string;
  reminderDate: string;
  isKey: boolean;
}) {
  return request<ReminderItem>("/api/todos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTodo(
  id: string,
  input: {
    title: string;
    reminderDate: string;
    isKey: boolean;
  },
) {
  return request<ReminderItem>(`/api/todos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listPendingConfirmations() {
  return request<{ items: PendingItem[] }>("/api/pending-confirmations");
}

export function resolvePendingConfirmation(
  id: string,
  input: { note?: string; correction?: PendingCorrectionInput },
) {
  return request<{ ok: true; appliedCorrection: boolean; remindersGenerated: number }>(
    `/api/pending-confirmations/${encodeURIComponent(id)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function previewFeishuSync() {
  return request<{
    mode: "dry-run";
    summary: FeishuDryRunSummary;
  }>("/api/sync/feishu/dry-run", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function syncFeishuBase(input: {
  baseToken: string;
  mode: "plan" | "execute";
  strategy?: "incremental" | "batch-create";
  limit?: number;
  confirmFullSync?: boolean;
  tables?: {
    customers?: string;
    policies?: string;
    reminders?: string;
  };
}) {
  return request<FeishuBaseSyncResult>("/api/sync/feishu/base", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function prepareFeishuBaseSchema(input: {
  baseToken: string;
  mode: "plan" | "execute";
  tableNames?: {
    customers?: string;
    policies?: string;
    reminders?: string;
  };
}) {
  return request<FeishuBaseSchemaResult>("/api/sync/feishu/base/schema", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function prepareFeishuCalendarView(input: {
  baseToken: string;
  mode: "plan" | "execute";
  remindersTable?: string;
  viewName?: string;
}) {
  return request<FeishuBaseCalendarViewResult>("/api/sync/feishu/base/calendar-view", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function syncFeishuCalendar(input: {
  mode: "plan" | "execute";
  calendarId?: string;
  startTime?: string;
  durationMinutes?: number;
  limit?: number;
  confirmFullSync?: boolean;
}) {
  return request<FeishuCalendarSyncResult>("/api/sync/feishu/calendar", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

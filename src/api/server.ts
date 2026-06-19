import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import Fastify from "fastify";
import { publicAiSettings, resolveSavedApiKey, writeLocalAiSettings } from "../ai/localAiSettings";
import type { AiProviderId } from "../ai/modelProviders";
import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrations";
import { CustomerRepository } from "../db/repositories/customerRepository";
import { PendingChangeRepository } from "../db/repositories/pendingChangeRepository";
import { PolicyRepository } from "../db/repositories/policyRepository";
import { ReminderRepository } from "../db/repositories/reminderRepository";
import { makeReminderBusinessKey } from "../domain/ids";
import { generateBirthdayReminder } from "../domain/reminders/birthdayReminder";
import {
  generatePolicyRenewalReminders,
  getPolicyRenewalSchedule,
} from "../domain/reminders/policyRenewalReminder";
import type { KeyFieldChange, PendingConfirmation, Reminder } from "../domain/types";
import {
  analyzeImportFiles,
  prepareGenericImportWorkbooks,
  type ImportFieldMappingInput,
} from "../importers/genericImport";
import { importWorkbooks } from "../importers/importService";
import { supportedImportFileExtension } from "../importers/tableReader";
import { prepareFeishuBaseSchema } from "../sync/feishuBaseSchema";
import { syncFeishuBaseBatch } from "../sync/feishuBaseBatchSync";
import { syncFeishuBase } from "../sync/feishuBaseSync";
import { prepareFeishuReminderCalendarView } from "../sync/feishuBaseViews";
import { syncFeishuCalendar } from "../sync/feishuCalendarSync";
import { buildFeishuSyncSnapshot } from "../sync/feishuSnapshot";

interface ServerOptions {
  dbPath?: string;
  today?: string;
  accessPassword?: string;
}

interface UploadedWorkbook {
  fileName: string;
  base64: string;
}

interface ImportRequestBody {
  customerWorkbookPath?: string;
  policyWorkbookPath?: string;
  customerWorkbookFile?: UploadedWorkbook;
  policyWorkbookFile?: UploadedWorkbook;
  files?: UploadedWorkbook[];
  mappings?: ImportFieldMappingInput[];
  ai?: AiImportRequestBody;
}

interface AiImportRequestBody {
  enabled?: boolean;
  providerId?: AiProviderId;
  apiKey?: string;
  useSavedKey?: boolean;
}

interface AiSettingsRequestBody {
  providerId?: AiProviderId;
  apiKey?: string;
}

interface DataBackupRequestBody {
  label?: string;
}

interface DataRestoreRequestBody {
  fileName?: string;
}

interface ClearLocalDataRequestBody {
  confirm?: string;
}

interface FeishuBaseSyncRequestBody {
  baseToken?: string;
  mode?: "plan" | "execute";
  strategy?: "incremental" | "batch-create";
  limit?: number;
  confirmFullSync?: boolean;
  tables?: {
    customers?: string;
    policies?: string;
    reminders?: string;
  };
}

interface FeishuBaseSchemaRequestBody {
  baseToken?: string;
  mode?: "plan" | "execute";
  tableNames?: {
    customers?: string;
    policies?: string;
    reminders?: string;
  };
}

interface FeishuBaseCalendarViewRequestBody {
  baseToken?: string;
  mode?: "plan" | "execute";
  remindersTable?: string;
  viewName?: string;
}

interface FeishuCalendarSyncRequestBody {
  mode?: "plan" | "execute";
  calendarId?: string;
  startTime?: string;
  durationMinutes?: number;
  limit?: number;
  confirmFullSync?: boolean;
}

interface CompleteRemindersByDateRequestBody {
  reminderDate?: string;
}

interface LocalDataStats {
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

function reminderListItem(
  reminder: Reminder,
  customers: CustomerRepository,
  policies: PolicyRepository,
  today: string,
): Reminder & {
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
} {
  const policy = reminder.policyId ? policies.findByBusinessKey(reminder.policyId) : undefined;
  if (!policy) {
    return reminder;
  }
  return {
    ...reminder,
    policySummary: {
      policyNumber: policy.policyNumber,
      productName: policy.productName,
      insurerName: policy.insurerName,
      premium: policy.premium,
      paymentMethod: policy.paymentMethod,
      paymentPeriodRaw: policy.paymentPeriodRaw,
      effectiveDate: policy.effectiveDate,
      ...policyRenewalSummary(policy, customers, today),
    },
  };
}

interface PendingCorrectionInput {
  birthDate?: string;
  effectiveDate?: string;
  paymentPeriodRaw?: string;
}

interface AuthLoginRequestBody {
  password?: string;
}

interface AuthConfig {
  enabled: boolean;
  passwordHash?: Buffer;
  sessions: Set<string>;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function constantTimeMatchesHash(value: string, expectedHash: Buffer): boolean {
  const actualHash = hashSecret(value);
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""];
        }
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function sessionCookie(token: string, maxAgeSeconds: number) {
  return [
    `customer_reminders_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function clearSessionCookie() {
  return [
    "customer_reminders_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

function createAuthConfig(accessPassword?: string): AuthConfig {
  const password = accessPassword?.trim();
  return {
    enabled: Boolean(password),
    passwordHash: password ? hashSecret(password) : undefined,
    sessions: new Set<string>(),
  };
}

function persistUploadedWorkbook(upload: UploadedWorkbook, dir: string): string {
  const extension = extname(upload.fileName).toLowerCase();
  if (![".xlsx", ".xls"].includes(extension)) {
    throw new Error("unsupported_workbook_file_type");
  }
  const filePath = join(dir, `${Date.now()}-${basename(upload.fileName)}`);
  writeFileSync(filePath, Buffer.from(upload.base64, "base64"));
  return filePath;
}

function persistUploadedImportFile(upload: UploadedWorkbook, dir: string): string {
  if (!supportedImportFileExtension(upload.fileName)) {
    throw new Error("unsupported_import_file_type");
  }
  const filePath = join(dir, `${Date.now()}-${basename(upload.fileName)}`);
  writeFileSync(filePath, Buffer.from(upload.base64, "base64"));
  return filePath;
}

function safeBackupLabel(label?: string): string {
  return (label?.trim() || "manual")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .slice(0, 40);
}

function backupDir(dbPath: string): string {
  return join(dirname(dbPath), "backups");
}

function timestampLabel(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function backupFilePath(dbPath: string, label?: string): string {
  return join(backupDir(dbPath), `customer-reminders-${timestampLabel()}-${safeBackupLabel(label)}.sqlite`);
}

function createDatabaseBackup(dbPath: string, label?: string) {
  const targetDir = backupDir(dbPath);
  mkdirSync(targetDir, { recursive: true });
  const filePath = backupFilePath(dbPath, label);
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, filePath);
  } else {
    const db = openDatabase(dbPath);
    runMigrations(db);
    db.close();
    copyFileSync(dbPath, filePath);
  }
  const stats = statSync(filePath);
  return {
    fileName: basename(filePath),
    filePath,
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString(),
  };
}

function listBackupFiles(dbPath: string) {
  const dir = backupDir(dbPath);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".sqlite"))
    .map((fileName) => {
      const filePath = join(dir, fileName);
      const stats = statSync(filePath);
      return {
        fileName,
        filePath,
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
      };
    })
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

function resolveBackupPath(dbPath: string, fileName: string): string | undefined {
  const backupsRoot = resolve(backupDir(dbPath));
  const candidate = resolve(backupsRoot, fileName);
  if (!candidate.startsWith(`${backupsRoot}/`) || !candidate.endsWith(".sqlite")) {
    return undefined;
  }
  return existsSync(candidate) ? candidate : undefined;
}

function cleanOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && ["deepseek", "qwen", "glm", "moonshot", "openai"].includes(value);
}

function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function hasCorrection(input?: PendingCorrectionInput): boolean {
  return Boolean(
    cleanOptional(input?.birthDate) ||
      cleanOptional(input?.effectiveDate) ||
      cleanOptional(input?.paymentPeriodRaw),
  );
}

function keyFieldChanges(item: PendingConfirmation): KeyFieldChange[] {
  if (!Array.isArray(item.payload.changes)) {
    return [];
  }
  return item.payload.changes.filter((change): change is KeyFieldChange => {
    if (!change || typeof change !== "object") {
      return false;
    }
    const candidate = change as Partial<KeyFieldChange>;
    return (
      typeof candidate.field === "string" &&
      typeof candidate.label === "string" &&
      (typeof candidate.incoming === "string" || typeof candidate.incoming === "number")
    );
  });
}

function validateCorrection(input: PendingCorrectionInput): string | undefined {
  const birthDate = cleanOptional(input.birthDate);
  const effectiveDate = cleanOptional(input.effectiveDate);
  const paymentPeriodRaw = cleanOptional(input.paymentPeriodRaw);

  if (birthDate && !isDateOnly(birthDate)) {
    return "invalid_birth_date";
  }
  if (effectiveDate && !isDateOnly(effectiveDate)) {
    return "invalid_effective_date";
  }
  if (paymentPeriodRaw && !/^(\d+年|\d+周岁)$/.test(paymentPeriodRaw)) {
    return "invalid_payment_period";
  }
  return undefined;
}

function upsertGeneratedResult(
  result: Reminder | PendingConfirmation,
  reminders: ReminderRepository,
  pending: PendingChangeRepository,
): { reminderGenerated: number; confirmation?: PendingConfirmation } {
  if ("reminderDate" in result) {
    reminders.upsertGenerated(result);
    return { reminderGenerated: 1 };
  }
  pending.create(result);
  return { reminderGenerated: 0, confirmation: result };
}

function buildLocalDataStats(repos: {
  customers: CustomerRepository;
  policies: PolicyRepository;
  reminders: ReminderRepository;
  pending: PendingChangeRepository;
}): LocalDataStats {
  const customers = repos.customers.list();
  const policies = repos.policies.list();
  const reminders = repos.reminders.list();
  const openPending = repos.pending.list();
  const resolvedPending = repos.pending.list({ status: "resolved" });
  const legacyPolicyKeys = policies.filter(
    (policy) => policy.id === `policy:${policy.policyNumber?.trim()}`,
  ).length;

  return {
    customers: customers.length,
    policies: policies.length,
    reminders: {
      total: reminders.length,
      pending: reminders.filter((item) => item.status === "pending").length,
      completed: reminders.filter((item) => item.status === "completed").length,
      birthday: reminders.filter((item) => item.group === "birthday").length,
      policyRenewal: reminders.filter((item) => item.group === "policy_renewal").length,
      manualTodo: reminders.filter((item) => item.group === "manual_todo").length,
      keyPending: reminders.filter((item) => item.isKey && item.status === "pending").length,
    },
    pendingConfirmations: {
      open: openPending.length,
      resolved: resolvedPending.length,
    },
    health: {
      legacyPolicyKeys,
    },
  };
}

function policyRenewalSummary(
  policy: NonNullable<ReturnType<PolicyRepository["findByBusinessKey"]>>,
  customers: CustomerRepository,
  today: string,
) {
  const insuredCustomer = policy.insuredCustomerId
    ? customers.findByBusinessKey(policy.insuredCustomerId)
    : undefined;
  const schedule = getPolicyRenewalSchedule(policy, today, {
    insuredBirthDate: insuredCustomer?.birthDate,
  });
  if ("reason" in schedule) {
    return {};
  }
  return {
    nextRenewalDate: schedule.nextRenewalDate,
    finalPaymentYear: schedule.finalPaymentYear,
  };
}

function applyPendingCorrection(
  item: PendingConfirmation,
  correction: PendingCorrectionInput,
  today: string,
  repos: {
    customers: CustomerRepository;
    policies: PolicyRepository;
    reminders: ReminderRepository;
    pending: PendingChangeRepository;
  },
): { applied: boolean; remindersGenerated: number; error?: string } {
  const birthDate = cleanOptional(correction.birthDate);
  const effectiveDate = cleanOptional(correction.effectiveDate);
  const paymentPeriodRaw = cleanOptional(correction.paymentPeriodRaw);
  let remindersGenerated = 0;

  if (birthDate) {
    const customerId = typeof item.payload.customerId === "string" ? item.payload.customerId : undefined;
    if (!customerId) {
      return { applied: false, remindersGenerated, error: "customer_id_missing" };
    }
    const customer = repos.customers.updateCorrection(customerId, { birthDate });
    if (!customer) {
      return { applied: false, remindersGenerated, error: "customer_not_found" };
    }
    const result = upsertGeneratedResult(generateBirthdayReminder(customer, today), repos.reminders, repos.pending);
    if (result.confirmation) {
      return { applied: false, remindersGenerated, error: "correction_still_pending" };
    }
    remindersGenerated += result.reminderGenerated;
  }

  if (effectiveDate || paymentPeriodRaw) {
    const policyId = typeof item.payload.policyId === "string" ? item.payload.policyId : undefined;
    if (!policyId) {
      return { applied: false, remindersGenerated, error: "policy_id_missing" };
    }
    const policy = repos.policies.updateCorrection(policyId, { effectiveDate, paymentPeriodRaw });
    if (!policy) {
      return { applied: false, remindersGenerated, error: "policy_not_found" };
    }
    const insuredCustomer = policy.insuredCustomerId
      ? repos.customers.findByBusinessKey(policy.insuredCustomerId)
      : undefined;
    const result = generatePolicyRenewalReminders(policy, today, {
      insuredBirthDate: insuredCustomer?.birthDate,
    });
    if (result.confirmations.length > 0) {
      result.confirmations.forEach((nextItem) => repos.pending.create(nextItem));
      return { applied: false, remindersGenerated, error: "correction_still_pending" };
    }
    for (const reminder of result.reminders) {
      repos.reminders.upsertGenerated(reminder);
      remindersGenerated += 1;
    }
  }

  return { applied: true, remindersGenerated };
}

function applyAcceptedKeyFieldChanges(
  item: PendingConfirmation,
  today: string,
  repos: {
    customers: CustomerRepository;
    policies: PolicyRepository;
    reminders: ReminderRepository;
    pending: PendingChangeRepository;
  },
): { applied: boolean; remindersGenerated: number; error?: string } {
  if (item.reason !== "key_field_changed") {
    return { applied: false, remindersGenerated: 0 };
  }

  const changes = keyFieldChanges(item);
  let remindersGenerated = 0;
  const byField = new Map(changes.map((change) => [change.field, change.incoming]));
  const entityType = item.payload.entityType;

  if (entityType === "customer") {
    const customerId = typeof item.payload.customerId === "string" ? item.payload.customerId : undefined;
    if (!customerId) {
      return { applied: false, remindersGenerated, error: "customer_id_missing" };
    }
    const birthDate =
      typeof byField.get("birthDate") === "string" ? String(byField.get("birthDate")) : undefined;
    const phone = typeof byField.get("phone") === "string" ? String(byField.get("phone")) : undefined;
    if (birthDate && !isDateOnly(birthDate)) {
      return { applied: false, remindersGenerated, error: "invalid_birth_date" };
    }
    const customer = repos.customers.updateCorrection(customerId, { birthDate, phone });
    if (!customer) {
      return { applied: false, remindersGenerated, error: "customer_not_found" };
    }
    if (birthDate) {
      const result = upsertGeneratedResult(generateBirthdayReminder(customer, today), repos.reminders, repos.pending);
      if (result.confirmation) {
        return { applied: false, remindersGenerated, error: "correction_still_pending" };
      }
      remindersGenerated += result.reminderGenerated;
    }
    return { applied: true, remindersGenerated };
  }

  if (entityType === "policy") {
    const policyId = typeof item.payload.policyId === "string" ? item.payload.policyId : undefined;
    if (!policyId) {
      return { applied: false, remindersGenerated, error: "policy_id_missing" };
    }
    const productName =
      typeof byField.get("productName") === "string" ? String(byField.get("productName")) : undefined;
    const insurerName =
      typeof byField.get("insurerName") === "string" ? String(byField.get("insurerName")) : undefined;
    const premiumValue = byField.get("premium");
    const premium = typeof premiumValue === "number" ? premiumValue : undefined;
    const paymentMethod =
      typeof byField.get("paymentMethod") === "string" ? String(byField.get("paymentMethod")) : undefined;
    const paymentPeriodRaw =
      typeof byField.get("paymentPeriodRaw") === "string" ? String(byField.get("paymentPeriodRaw")) : undefined;
    const effectiveDate =
      typeof byField.get("effectiveDate") === "string" ? String(byField.get("effectiveDate")) : undefined;
    if (effectiveDate && !isDateOnly(effectiveDate)) {
      return { applied: false, remindersGenerated, error: "invalid_effective_date" };
    }

    const policy = repos.policies.updateCorrection(policyId, {
      productName,
      insurerName,
      premium,
      paymentMethod,
      paymentPeriodRaw,
      effectiveDate,
    });
    if (!policy) {
      return { applied: false, remindersGenerated, error: "policy_not_found" };
    }

    const insuredCustomer = policy.insuredCustomerId
      ? repos.customers.findByBusinessKey(policy.insuredCustomerId)
      : undefined;
    const result = generatePolicyRenewalReminders(policy, today, {
      insuredBirthDate: insuredCustomer?.birthDate,
    });
    if (result.confirmations.length > 0) {
      result.confirmations.forEach((nextItem) => repos.pending.create(nextItem));
      return { applied: false, remindersGenerated, error: "correction_still_pending" };
    }
    for (const reminder of result.reminders) {
      repos.reminders.upsertGenerated(reminder);
      remindersGenerated += 1;
    }
    return { applied: true, remindersGenerated };
  }

  return { applied: false, remindersGenerated, error: "unsupported_key_field_entity" };
}

function withRepositories<T>(
  dbPath: string,
  fn: (repos: {
    customers: CustomerRepository;
    policies: PolicyRepository;
    reminders: ReminderRepository;
    pending: PendingChangeRepository;
  }) => T,
): T {
  const db = openDatabase(dbPath);
  runMigrations(db);
  try {
    return fn({
      customers: new CustomerRepository(db),
      policies: new PolicyRepository(db),
      reminders: new ReminderRepository(db),
      pending: new PendingChangeRepository(db),
    });
  } finally {
    db.close();
  }
}

function clearLocalData(dbPath: string) {
  const db = openDatabase(dbPath);
  runMigrations(db);
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM sync_state").run();
      db.prepare("DELETE FROM pending_confirmations").run();
      db.prepare("DELETE FROM reminders").run();
      db.prepare("DELETE FROM policies").run();
      db.prepare("DELETE FROM customers").run();
    })();
  } finally {
    db.close();
  }
}

export function buildServer(options: ServerOptions = {}) {
  const dbPath = options.dbPath ?? "data/customer-reminders.sqlite";
  const dataRoot = dirname(dbPath);
  const today = options.today ?? todayIso();
  const auth = createAuthConfig(options.accessPassword ?? process.env.CUSTOMER_REMINDERS_PASSWORD);
  const app = Fastify({
    logger: false,
    routerOptions: {
      maxParamLength: 4096,
    },
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!auth.enabled || !request.url.startsWith("/api/")) {
      return;
    }
    if (request.url === "/api/auth/status" || request.url === "/api/auth/login") {
      return;
    }

    const token = parseCookieHeader(request.headers.cookie).customer_reminders_session;
    if (!token || !auth.sessions.has(token)) {
      reply.code(401);
      return reply.send({ error: "authentication_required" });
    }
  });

  app.get("/api/auth/status", async (request) => {
    const token = parseCookieHeader(request.headers.cookie).customer_reminders_session;
    return {
      enabled: auth.enabled,
      authenticated: !auth.enabled || Boolean(token && auth.sessions.has(token)),
    };
  });

  app.post<{ Body: AuthLoginRequestBody }>("/api/auth/login", async (request, reply) => {
    if (!auth.enabled) {
      return { ok: true };
    }
    const password = request.body.password ?? "";
    if (!auth.passwordHash || !constantTimeMatchesHash(password, auth.passwordHash)) {
      reply.code(401);
      return { error: "invalid_password" };
    }
    const token = randomBytes(32).toString("hex");
    auth.sessions.add(token);
    reply.header("Set-Cookie", sessionCookie(token, 60 * 60 * 12));
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = parseCookieHeader(request.headers.cookie).customer_reminders_session;
    if (token) {
      auth.sessions.delete(token);
    }
    reply.header("Set-Cookie", clearSessionCookie());
    return { ok: true };
  });

  app.get("/api/ai/settings", async () => publicAiSettings(dataRoot));

  app.post<{ Body: AiSettingsRequestBody }>("/api/ai/settings", async (request, reply) => {
    if (!isAiProviderId(request.body.providerId)) {
      reply.code(400);
      return { error: "unsupported_ai_provider" };
    }
    writeLocalAiSettings(dataRoot, {
      providerId: request.body.providerId,
      apiKey: request.body.apiKey,
    });
    return publicAiSettings(dataRoot);
  });

  app.post<{ Body: ImportRequestBody }>("/api/imports/analyze", async (request, reply) => {
    const uploadDir = mkdtempSync(join(tmpdir(), "customer-reminders-upload-"));
    try {
      const uploads = request.body.files ?? [];
      const files = uploads.map((upload) => ({
        fileName: upload.fileName,
        filePath: persistUploadedImportFile(upload, uploadDir),
      }));
      const providerId = request.body.ai?.providerId;
      const apiKey =
        request.body.ai?.apiKey?.trim() ||
        (providerId && request.body.ai?.useSavedKey ? resolveSavedApiKey(dataRoot, providerId) : undefined);
      return await analyzeImportFiles({
        files,
        dataRoot,
        ai:
          request.body.ai?.enabled && providerId && apiKey
            ? { enabled: true, providerId, apiKey }
            : { enabled: false },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "unsupported_import_file_type") {
        reply.code(400);
        return { error: error.message };
      }
      throw error;
    } finally {
      rmSync(uploadDir, { recursive: true, force: true });
    }
  });

  app.post<{ Body: ImportRequestBody }>("/api/imports", async (request, reply) => {
    const uploadDir = mkdtempSync(join(tmpdir(), "customer-reminders-upload-"));
    try {
      let customerWorkbookPath = request.body.customerWorkbookFile
        ? persistUploadedWorkbook(request.body.customerWorkbookFile, uploadDir)
        : request.body.customerWorkbookPath;
      let policyWorkbookPath = request.body.policyWorkbookFile
        ? persistUploadedWorkbook(request.body.policyWorkbookFile, uploadDir)
        : request.body.policyWorkbookPath;

      if (request.body.files?.length) {
        const providerId = request.body.ai?.providerId;
        const apiKey =
          request.body.ai?.apiKey?.trim() ||
          (providerId && request.body.ai?.useSavedKey ? resolveSavedApiKey(dataRoot, providerId) : undefined);
        const prepared = await prepareGenericImportWorkbooks({
          files: request.body.files.map((upload) => ({
            fileName: upload.fileName,
            filePath: persistUploadedImportFile(upload, uploadDir),
          })),
          uploadDir,
          dataRoot,
          mappings: request.body.mappings,
          ai:
            request.body.ai?.enabled && providerId && apiKey
              ? { enabled: true, providerId, apiKey }
              : { enabled: false },
        });
        customerWorkbookPath = prepared.customerWorkbookPath;
        policyWorkbookPath = prepared.policyWorkbookPath;
      }

      return await importWorkbooks({
        customerWorkbookPath,
        policyWorkbookPath,
        today,
        dbPath,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "unsupported_workbook_file_type") {
        reply.code(400);
        return { error: error.message };
      }
      if (error instanceof Error && error.message === "unsupported_import_file_type") {
        reply.code(400);
        return { error: error.message };
      }
      throw error;
    } finally {
      rmSync(uploadDir, { recursive: true, force: true });
    }
  });

  app.post<{ Body: ImportRequestBody }>("/api/imports/preview", async (request, reply) => {
    const uploadDir = mkdtempSync(join(tmpdir(), "customer-reminders-upload-"));
    const previewDir = mkdtempSync(join(tmpdir(), "customer-reminders-preview-"));
    const previewDbPath = join(previewDir, "preview.sqlite");
    try {
      let customerWorkbookPath = request.body.customerWorkbookFile
        ? persistUploadedWorkbook(request.body.customerWorkbookFile, uploadDir)
        : request.body.customerWorkbookPath;
      let policyWorkbookPath = request.body.policyWorkbookFile
        ? persistUploadedWorkbook(request.body.policyWorkbookFile, uploadDir)
        : request.body.policyWorkbookPath;
      if (request.body.files?.length) {
        const providerId = request.body.ai?.providerId;
        const apiKey =
          request.body.ai?.apiKey?.trim() ||
          (providerId && request.body.ai?.useSavedKey ? resolveSavedApiKey(dataRoot, providerId) : undefined);
        const prepared = await prepareGenericImportWorkbooks({
          files: request.body.files.map((upload) => ({
            fileName: upload.fileName,
            filePath: persistUploadedImportFile(upload, uploadDir),
          })),
          uploadDir,
          dataRoot,
          mappings: request.body.mappings,
          ai:
            request.body.ai?.enabled && providerId && apiKey
              ? { enabled: true, providerId, apiKey }
              : { enabled: false },
        });
        customerWorkbookPath = prepared.customerWorkbookPath;
        policyWorkbookPath = prepared.policyWorkbookPath;
      }
      if (existsSync(dbPath)) {
        copyFileSync(dbPath, previewDbPath);
      }

      const before = withRepositories(previewDbPath, (repos) => buildLocalDataStats(repos));
      const summary = await importWorkbooks({
        customerWorkbookPath,
        policyWorkbookPath,
        today,
        dbPath: previewDbPath,
      });
      const after = withRepositories(previewDbPath, (repos) => buildLocalDataStats(repos));
      return {
        mode: "preview",
        summary,
        before,
        after,
        delta: {
          customers: after.customers - before.customers,
          policies: after.policies - before.policies,
          reminders: after.reminders.total - before.reminders.total,
          openPendingConfirmations: after.pendingConfirmations.open - before.pendingConfirmations.open,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message === "unsupported_workbook_file_type") {
        reply.code(400);
        return { error: error.message };
      }
      if (error instanceof Error && error.message === "unsupported_import_file_type") {
        reply.code(400);
        return { error: error.message };
      }
      throw error;
    } finally {
      rmSync(uploadDir, { recursive: true, force: true });
      rmSync(previewDir, { recursive: true, force: true });
    }
  });

  app.get<{
    Querystring: { status?: Reminder["status"]; group?: Reminder["group"] };
  }>("/api/reminders", async (request) => {
    return withRepositories(dbPath, ({ customers, reminders, policies }) => ({
      items: reminders
        .list({
          status: request.query.status,
          group: request.query.group,
        })
        .map((reminder) => reminderListItem(reminder, customers, policies, today)),
    }));
  });

  app.get("/api/stats", async () => {
    return withRepositories(dbPath, (repos) => buildLocalDataStats(repos));
  });

  app.get("/api/backups", async () => ({
    items: listBackupFiles(dbPath),
  }));

  app.post<{ Body: DataBackupRequestBody }>("/api/backups", async (request) => {
    return {
      ok: true,
      backup: createDatabaseBackup(dbPath, request.body?.label),
    };
  });

  app.post<{ Body: DataRestoreRequestBody }>("/api/backups/restore", async (request, reply) => {
    const fileName = request.body?.fileName?.trim();
    if (!fileName) {
      reply.code(400);
      return { error: "backup_file_required" };
    }
    const sourcePath = resolveBackupPath(dbPath, fileName);
    if (!sourcePath) {
      reply.code(404);
      return { error: "backup_not_found" };
    }
    mkdirSync(dirname(dbPath), { recursive: true });
    copyFileSync(sourcePath, dbPath);
    return {
      ok: true,
      restored: basename(sourcePath),
      stats: withRepositories(dbPath, (repos) => buildLocalDataStats(repos)),
    };
  });

  app.post<{ Body: ClearLocalDataRequestBody }>("/api/local-data/clear", async (request, reply) => {
    if (request.body?.confirm !== "清空数据") {
      reply.code(400);
      return { error: "clear_confirmation_required" };
    }
    const backup = createDatabaseBackup(dbPath, "before-clear");
    clearLocalData(dbPath);
    return {
      ok: true,
      backup,
      stats: withRepositories(dbPath, (repos) => buildLocalDataStats(repos)),
    };
  });

  app.post<{ Body: CompleteRemindersByDateRequestBody }>("/api/reminders/complete-date", async (request, reply) => {
    const reminderDate = request.body?.reminderDate?.trim();
    if (!reminderDate || !/^\d{4}-\d{2}-\d{2}$/.test(reminderDate)) {
      reply.code(400);
      return { error: "reminder_date_required" };
    }
    return withRepositories(dbPath, ({ reminders }) => ({
      ok: true,
      completed: reminders.markCompletedByDate(reminderDate),
    }));
  });

  app.get<{ Params: { id: string } }>("/api/reminders/:id/detail", async (request, reply) => {
    return withRepositories(dbPath, ({ customers, policies, reminders }) => {
      const reminder = reminders.findByBusinessKey(request.params.id);
      if (!reminder) {
        reply.code(404);
        return { error: "reminder_not_found" };
      }

      const customer = reminder.customerId
        ? customers.findByBusinessKey(reminder.customerId)
        : undefined;
      const policy = reminder.policyId ? policies.findByBusinessKey(reminder.policyId) : undefined;
      const applicantCustomer = policy?.applicantCustomerId
        ? customers.findByBusinessKey(policy.applicantCustomerId)
        : undefined;
      const insuredCustomer = policy?.insuredCustomerId
        ? customers.findByBusinessKey(policy.insuredCustomerId)
        : undefined;

      return {
        reminder: reminderListItem(reminder, customers, policies, today),
        customer,
        policy: policy
          ? {
              ...policy,
              ...policyRenewalSummary(policy, customers, today),
            }
          : undefined,
        applicantCustomer,
        insuredCustomer,
      };
    });
  });

  app.post<{ Params: { id: string } }>("/api/reminders/:id/complete", async (request) => {
    return withRepositories(dbPath, ({ reminders }) => {
      const updated = reminders.markCompleted(request.params.id);
      return { ok: true, updated };
    });
  });

  app.post<{ Params: { id: string } }>("/api/reminders/:id/reopen", async (request) => {
    return withRepositories(dbPath, ({ reminders }) => {
      reminders.markPending(request.params.id);
      return { ok: true };
    });
  });

  app.delete<{ Params: { id: string } }>("/api/reminders/:id", async (request, reply) => {
    return withRepositories(dbPath, ({ reminders }) => {
      const deleted = reminders.deleteManual(request.params.id);
      if (!deleted) {
        reply.code(404);
        return { error: "manual_todo_not_found" };
      }
      return { ok: true };
    });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title: string;
      reminderDate: string;
      isKey?: boolean;
    };
  }>("/api/todos/:id", async (request, reply) => {
    const title = request.body.title?.trim();
    const reminderDate = request.body.reminderDate?.trim();
    if (!title || !reminderDate) {
      reply.code(400);
      return { error: "title_and_reminder_date_required" };
    }

    return withRepositories(dbPath, ({ reminders }) => {
      const updated = reminders.updateManual(request.params.id, {
        title,
        reminderDate,
        isKey: Boolean(request.body.isKey),
      });
      if (!updated) {
        reply.code(404);
        return { error: "manual_todo_not_found" };
      }
      return updated;
    });
  });

  app.post<{
    Body: {
      title: string;
      reminderDate: string;
      customerId?: string;
      isKey?: boolean;
    };
  }>("/api/todos", async (request, reply) => {
    const title = request.body.title?.trim();
    const reminderDate = request.body.reminderDate?.trim();
    if (!title || !reminderDate) {
      reply.code(400);
      return { error: "title_and_reminder_date_required" };
    }

    const reminder: Reminder = {
      id: makeReminderBusinessKey({
        group: "manual_todo",
        reminderDate,
        customerId: request.body.customerId,
        title,
      }),
      group: "manual_todo",
      title,
      reminderDate,
      status: "pending",
      isKey: Boolean(request.body.isKey),
      customerId: request.body.customerId,
      source: "manual",
    };

    return withRepositories(dbPath, ({ reminders }) => {
      reminders.createManual(reminder);
      return reminder;
    });
  });

  app.get<{
    Querystring: { status?: "open" | "resolved" | "all" };
  }>("/api/pending-confirmations", async (request) => {
    return withRepositories(dbPath, ({ pending }) => ({
      items: pending.list({ status: request.query.status }),
    }));
  });

  app.post<{
    Params: { id: string };
    Body: { note?: string; correction?: PendingCorrectionInput };
  }>("/api/pending-confirmations/:id/resolve", async (request, reply) => {
    return withRepositories(dbPath, (repos) => {
      const { pending } = repos;
      const item = pending.findById(request.params.id);
      if (!item || item.status === "resolved") {
        reply.code(404);
        return { error: "pending_confirmation_not_found" };
      }

      const correction = request.body?.correction;
      let appliedCorrection = false;
      let remindersGenerated = 0;
      if (hasCorrection(correction)) {
        const validationError = validateCorrection(correction ?? {});
        if (validationError) {
          reply.code(400);
          return { error: validationError };
        }
        const result = applyPendingCorrection(item, correction ?? {}, today, repos);
        if (!result.applied) {
          reply.code(422);
          return { error: result.error ?? "correction_failed" };
        }
        appliedCorrection = true;
        remindersGenerated = result.remindersGenerated;
      } else if (item.reason === "key_field_changed") {
        const result = applyAcceptedKeyFieldChanges(item, today, repos);
        if (!result.applied) {
          reply.code(422);
          return { error: result.error ?? "key_field_change_failed" };
        }
        appliedCorrection = true;
        remindersGenerated = result.remindersGenerated;
      }

      const resolved = pending.resolve(request.params.id, request.body?.note);
      if (!resolved) {
        reply.code(404);
        return { error: "pending_confirmation_not_found" };
      }
      return { ok: true, appliedCorrection, remindersGenerated };
    });
  });

  app.post("/api/sync/feishu/dry-run", async () => {
    const snapshot = buildFeishuSyncSnapshot(dbPath, { today });
    return {
      mode: "dry-run",
      summary: snapshot.summary,
      preview: {
        customers: snapshot.customers.slice(0, 3),
        policies: snapshot.policies.slice(0, 3),
        reminders: snapshot.reminders.slice(0, 5),
      },
    };
  });

  app.post<{ Body: FeishuBaseSyncRequestBody }>("/api/sync/feishu/base", async (request, reply) => {
    const baseToken = request.body.baseToken?.trim();
    const mode = request.body.mode ?? "plan";
    const limit = request.body.limit;
    if (!baseToken) {
      reply.code(400);
      return { error: "base_token_required" };
    }
    if (mode === "execute" && (!limit || limit <= 0) && !request.body.confirmFullSync) {
      reply.code(400);
      return { error: "full_sync_confirmation_required" };
    }

    const result =
      request.body.strategy === "batch-create"
        ? await syncFeishuBaseBatch({
            dbPath,
            baseToken,
            mode,
            confirmFullSync: request.body.confirmFullSync,
            tables: request.body.tables,
            today,
          })
        : await syncFeishuBase({
            dbPath,
            baseToken,
            mode,
            limit,
            tables: request.body.tables,
            today,
          });

    return {
      ...result,
      commands: "commands" in result ? result.commands.slice(0, 5) : undefined,
      batches: "batches" in result ? result.batches.slice(0, 5) : undefined,
      previewCount: Math.min(("commands" in result ? result.commands.length : result.batches.length), 5),
      totalCommands: "commands" in result ? result.commands.length : result.batches.length,
    };
  });

  app.post<{ Body: FeishuBaseSchemaRequestBody }>(
    "/api/sync/feishu/base/schema",
    async (request, reply) => {
      const baseToken = request.body.baseToken?.trim();
      const mode = request.body.mode ?? "plan";
      if (!baseToken) {
        reply.code(400);
        return { error: "base_token_required" };
      }

      const result = await prepareFeishuBaseSchema({
        baseToken,
        mode,
        tableNames: request.body.tableNames,
      });

      return {
        ...result,
        commands: result.commands.slice(0, 12),
        previewCount: Math.min(result.commands.length, 12),
        totalCommands: result.commands.length,
      };
    },
  );

  app.post<{ Body: FeishuBaseCalendarViewRequestBody }>(
    "/api/sync/feishu/base/calendar-view",
    async (request, reply) => {
      const baseToken = request.body.baseToken?.trim();
      const mode = request.body.mode ?? "plan";
      if (!baseToken) {
        reply.code(400);
        return { error: "base_token_required" };
      }

      const result = await prepareFeishuReminderCalendarView({
        baseToken,
        mode,
        remindersTable: request.body.remindersTable,
        viewName: request.body.viewName,
      });

      return result;
    },
  );

  app.post<{ Body: FeishuCalendarSyncRequestBody }>(
    "/api/sync/feishu/calendar",
    async (request, reply) => {
      const mode = request.body.mode ?? "plan";
      if (mode === "execute" && !request.body.limit && !request.body.confirmFullSync) {
        reply.code(400);
        return { error: "full_sync_confirmation_required" };
      }

      const result = await syncFeishuCalendar({
        dbPath,
        mode,
        calendarId: request.body.calendarId,
        startTime: request.body.startTime,
        durationMinutes: request.body.durationMinutes,
        limit: request.body.limit,
        today,
      });

      return result;
    },
  );

  return app;
}

if (process.env.RUN_API_SERVER === "1") {
  const app = buildServer();
  app.listen({ host: "127.0.0.1", port: 3001 }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}

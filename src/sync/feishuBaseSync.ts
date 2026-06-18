import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrations";
import {
  feishuRecordStateKey,
  SyncStateRepository,
} from "../db/repositories/syncStateRepository";
import type { FeishuCustomerRow, FeishuPolicyRow, FeishuReminderRow } from "./feishuSnapshot";
import { buildFeishuSyncSnapshot } from "./feishuSnapshot";
import { defaultLarkCliRunner, maskTokenInMessage, type LarkCliRunner } from "./larkCli";

type TableKind = "customers" | "policies" | "reminders";
type SyncMode = "plan" | "execute";
type FeishuCellValue =
  | string
  | number
  | boolean
  | null
  | Array<{ id: string }>;

export interface FeishuBaseSyncInput {
  dbPath: string;
  baseToken: string;
  tables?: Partial<Record<TableKind, string>>;
  mode: SyncMode;
  limit?: number;
  today?: string;
  runner?: LarkCliRunner;
}

export interface FeishuBaseSyncCommand {
  table: TableKind;
  tableRef: string;
  externalId: string;
  operation: "create" | "update";
  fields: Record<string, FeishuCellValue>;
  argv: string[];
}

export interface FeishuBaseSyncResult {
  mode: SyncMode;
  summary: {
    planned: number;
    created: number;
    updated: number;
    failed: number;
    skippedByLimit: number;
  };
  commands: FeishuBaseSyncCommand[];
  errors: Array<{ externalId: string; table: TableKind; message: string }>;
}

interface SyncTargetRow {
  table: TableKind;
  tableRef: string;
  externalId: string;
  fields: Record<string, FeishuCellValue>;
  links?: Array<{
    fieldName: string;
    targetTableRef: string;
    targetExternalId?: string;
  }>;
}

const defaultTables: Record<TableKind, string> = {
  customers: "客户",
  policies: "保单",
  reminders: "提醒",
};

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim() ? value : null;
}

function customerFields(row: FeishuCustomerRow) {
  return {
    外部ID: row.externalId,
    姓名: row.name,
    证件号: nonEmpty(row.maskedIdNumber),
    手机号: nonEmpty(row.maskedPhone),
    生日: nonEmpty(row.birthDate),
  };
}

function policyFields(row: FeishuPolicyRow) {
  return {
    外部ID: row.externalId,
    保单号: nonEmpty(row.policyNumber),
    投保人: row.applicantName,
    被保人: row.insuredName,
    产品名称: row.productName,
    保险公司: nonEmpty(row.insurerName),
    保费: row.premium ?? null,
    缴费方式: nonEmpty(row.paymentMethod),
    缴费期间: nonEmpty(row.paymentPeriodRaw),
    生效日: nonEmpty(row.effectiveDate),
    下次续期: nonEmpty(row.nextRenewalDate),
    缴费结束年: row.finalPaymentYear ?? null,
    投保人客户ID: nonEmpty(row.applicantCustomerExternalId),
    被保人客户ID: nonEmpty(row.insuredCustomerExternalId),
  };
}

function reminderFields(row: FeishuReminderRow) {
  return {
    外部ID: row.externalId,
    分组: row.group,
    标题: row.title,
    提醒日期: row.reminderDate,
    结束日期: row.reminderDate,
    状态: row.status,
    关键提醒: row.isKey,
    客户ID: nonEmpty(row.customerExternalId),
    保单ID: nonEmpty(row.policyExternalId),
    来源: row.source,
  };
}

function parseRecordId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      record?: { record_id?: string; id?: string };
      data?: { record?: { record_id?: string; id?: string } };
    };
    return (
      parsed.record?.record_id ??
      parsed.record?.id ??
      parsed.data?.record?.record_id ??
      parsed.data?.record?.id
    );
  } catch {
    return undefined;
  }
}

function buildRows(input: FeishuBaseSyncInput): SyncTargetRow[] {
  const snapshot = buildFeishuSyncSnapshot(input.dbPath, { today: input.today });
  const tables = { ...defaultTables, ...input.tables };
  return [
    ...snapshot.customers.map((row) => ({
      table: "customers" as const,
      tableRef: tables.customers,
      externalId: row.externalId,
      fields: customerFields(row),
    })),
    ...snapshot.policies.map((row) => ({
      table: "policies" as const,
      tableRef: tables.policies,
      externalId: row.externalId,
      fields: policyFields(row),
      links: [
        {
          fieldName: "投保人客户",
          targetTableRef: tables.customers,
          targetExternalId: row.applicantCustomerExternalId,
        },
        {
          fieldName: "被保人客户",
          targetTableRef: tables.customers,
          targetExternalId: row.insuredCustomerExternalId,
        },
      ],
    })),
    ...snapshot.reminders.map((row) => ({
      table: "reminders" as const,
      tableRef: tables.reminders,
      externalId: row.externalId,
      fields: reminderFields(row),
      links: [
        {
          fieldName: "关联客户",
          targetTableRef: tables.customers,
          targetExternalId: row.customerExternalId,
        },
        {
          fieldName: "关联保单",
          targetTableRef: tables.policies,
          targetExternalId: row.policyExternalId,
        },
      ],
    })),
  ];
}

function resolveLinkFields(input: {
  baseToken: string;
  row: SyncTargetRow;
  syncState: SyncStateRepository;
}): Record<string, Array<{ id: string }>> {
  return Object.fromEntries(
    (input.row.links ?? []).flatMap((link) => {
      if (!link.targetExternalId) {
        return [];
      }
      const recordId = input.syncState.get(
        feishuRecordStateKey({
          baseToken: input.baseToken,
          tableRef: link.targetTableRef,
          externalId: link.targetExternalId,
        }),
      );
      return recordId ? [[link.fieldName, [{ id: recordId }]]] : [];
    }),
  );
}

function argvForRow(input: {
  baseToken: string;
  row: SyncTargetRow;
  recordId?: string;
  linkFields?: Record<string, Array<{ id: string }>>;
}) {
  const fields = { ...input.row.fields, ...(input.linkFields ?? {}) };
  const argv = [
    "base",
    "+record-upsert",
    "--as",
    "user",
    "--base-token",
    input.baseToken,
    "--table-id",
    input.row.tableRef,
    "--json",
    JSON.stringify(fields),
  ];
  if (input.recordId) {
    argv.push("--record-id", input.recordId);
  }
  return argv;
}

function commandForRow(input: {
  row: SyncTargetRow;
  recordId?: string;
  linkFields?: Record<string, Array<{ id: string }>>;
}): FeishuBaseSyncCommand {
  const fields = { ...input.row.fields, ...(input.linkFields ?? {}) };
  return {
    table: input.row.table,
    tableRef: input.row.tableRef,
    externalId: input.row.externalId,
    operation: input.recordId ? "update" : "create",
    fields,
    argv: argvForRow({
      baseToken: "<base-token>",
      row: input.row,
      recordId: input.recordId,
      linkFields: input.linkFields,
    }),
  };
}

export async function syncFeishuBase(input: FeishuBaseSyncInput): Promise<FeishuBaseSyncResult> {
  if (!input.baseToken.trim()) {
    throw new Error("base_token_required");
  }

  const db = openDatabase(input.dbPath);
  runMigrations(db);
  const syncState = new SyncStateRepository(db);
  const errors: FeishuBaseSyncResult["errors"] = [];
  const commands: FeishuBaseSyncCommand[] = [];
  const runner = input.runner ?? defaultLarkCliRunner;
  let created = 0;
  let updated = 0;
  let failed = 0;

  try {
    const allRows = buildRows(input);
    const limitedRows = input.limit && input.limit > 0 ? allRows.slice(0, input.limit) : allRows;

    for (const row of limitedRows) {
      const stateKey = feishuRecordStateKey({
        baseToken: input.baseToken,
        tableRef: row.tableRef,
        externalId: row.externalId,
      });
      const existingRecordId = syncState.get(stateKey);
      const linkFields = resolveLinkFields({
        baseToken: input.baseToken,
        row,
        syncState,
      });
      const command = commandForRow({ row, recordId: existingRecordId, linkFields });
      commands.push(command);

      if (input.mode === "plan") {
        continue;
      }

      try {
        const { stdout } = await runner(
          argvForRow({ baseToken: input.baseToken, row, recordId: existingRecordId, linkFields }),
        );
        const recordId = parseRecordId(stdout);
        if (recordId) {
          syncState.set(stateKey, recordId);
        }
        if (existingRecordId) {
          updated += 1;
        } else {
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          externalId: row.externalId,
          table: row.table,
          message: maskTokenInMessage(
            error instanceof Error ? error.message : String(error),
            input.baseToken,
          ),
        });
      }
    }

    return {
      mode: input.mode,
      summary: {
        planned: limitedRows.length,
        created,
        updated,
        failed,
        skippedByLimit: allRows.length - limitedRows.length,
      },
      commands,
      errors,
    };
  } finally {
    db.close();
  }
}

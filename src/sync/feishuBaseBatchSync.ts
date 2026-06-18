import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

interface BatchTargetRow {
  table: TableKind;
  tableRef: string;
  externalId: string;
  fields: string[];
  cells: FeishuCellValue[];
}

export interface FeishuBaseBatchSyncInput {
  dbPath: string;
  baseToken: string;
  mode: SyncMode;
  batchSize?: number;
  confirmFullSync?: boolean;
  today?: string;
  tables?: Partial<Record<TableKind, string>>;
  runner?: LarkCliRunner;
}

export interface FeishuBaseBatchSyncResult {
  mode: SyncMode;
  summary: {
    planned: number;
    created: number;
    skippedExisting: number;
    failed: number;
    batches: number;
  };
  batches: Array<{
    table: TableKind;
    tableRef: string;
    planned: number;
    operation: "batch_create" | "skip_existing";
    argv: string[];
  }>;
  errors: Array<{ table: TableKind; message: string }>;
}

const defaultTables: Record<TableKind, string> = {
  customers: "客户",
  policies: "保单",
  reminders: "提醒",
};

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim() ? value : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function customerRow(row: FeishuCustomerRow, tableRef: string): BatchTargetRow {
  return {
    table: "customers",
    tableRef,
    externalId: row.externalId,
    fields: ["外部ID", "姓名", "证件号", "手机号", "生日"],
    cells: [
      row.externalId,
      row.name,
      nonEmpty(row.maskedIdNumber),
      nonEmpty(row.maskedPhone),
      nonEmpty(row.birthDate),
    ],
  };
}

function policyRow(input: {
  row: FeishuPolicyRow;
  tableRef: string;
  customerTableRef: string;
  baseToken: string;
  syncState: SyncStateRepository;
}): BatchTargetRow {
  const applicantRecordId = input.row.applicantCustomerExternalId
    ? input.syncState.get(
        feishuRecordStateKey({
          baseToken: input.baseToken,
          tableRef: input.customerTableRef,
          externalId: input.row.applicantCustomerExternalId,
        }),
      )
    : undefined;
  const insuredRecordId = input.row.insuredCustomerExternalId
    ? input.syncState.get(
        feishuRecordStateKey({
          baseToken: input.baseToken,
          tableRef: input.customerTableRef,
          externalId: input.row.insuredCustomerExternalId,
        }),
      )
    : undefined;

  return {
    table: "policies",
    tableRef: input.tableRef,
    externalId: input.row.externalId,
    fields: [
      "外部ID",
      "保单号",
      "投保人",
      "被保人",
      "产品名称",
      "保险公司",
      "保费",
      "缴费方式",
      "缴费期间",
      "生效日",
      "下次续期",
      "缴费结束年",
      "投保人客户ID",
      "被保人客户ID",
      "投保人客户",
      "被保人客户",
    ],
    cells: [
      input.row.externalId,
      nonEmpty(input.row.policyNumber),
      input.row.applicantName,
      input.row.insuredName,
      input.row.productName,
      nonEmpty(input.row.insurerName),
      input.row.premium ?? null,
      nonEmpty(input.row.paymentMethod),
      nonEmpty(input.row.paymentPeriodRaw),
      nonEmpty(input.row.effectiveDate),
      nonEmpty(input.row.nextRenewalDate),
      input.row.finalPaymentYear ?? null,
      nonEmpty(input.row.applicantCustomerExternalId),
      nonEmpty(input.row.insuredCustomerExternalId),
      applicantRecordId ? [{ id: applicantRecordId }] : null,
      insuredRecordId ? [{ id: insuredRecordId }] : null,
    ],
  };
}

function reminderRow(input: {
  row: FeishuReminderRow;
  tableRef: string;
  customerTableRef: string;
  policyTableRef: string;
  baseToken: string;
  syncState: SyncStateRepository;
}): BatchTargetRow {
  const customerRecordId = input.row.customerExternalId
    ? input.syncState.get(
        feishuRecordStateKey({
          baseToken: input.baseToken,
          tableRef: input.customerTableRef,
          externalId: input.row.customerExternalId,
        }),
      )
    : undefined;
  const policyRecordId = input.row.policyExternalId
    ? input.syncState.get(
        feishuRecordStateKey({
          baseToken: input.baseToken,
          tableRef: input.policyTableRef,
          externalId: input.row.policyExternalId,
        }),
      )
    : undefined;

  return {
    table: "reminders",
    tableRef: input.tableRef,
    externalId: input.row.externalId,
    fields: [
      "外部ID",
      "分组",
      "标题",
      "提醒日期",
      "结束日期",
      "状态",
      "关键提醒",
      "客户ID",
      "保单ID",
      "关联客户",
      "关联保单",
      "来源",
    ],
    cells: [
      input.row.externalId,
      input.row.group,
      input.row.title,
      input.row.reminderDate,
      input.row.reminderDate,
      input.row.status,
      input.row.isKey,
      nonEmpty(input.row.customerExternalId),
      nonEmpty(input.row.policyExternalId),
      customerRecordId ? [{ id: customerRecordId }] : null,
      policyRecordId ? [{ id: policyRecordId }] : null,
      input.row.source,
    ],
  };
}

function parseJsonOutput(stdout: string, stderr: string): unknown {
  const text = stdout.trim() || stderr.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error(`lark_cli_json_missing:${text.slice(0, 300)}`);
  }
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

function parseRecordIds(output: unknown): string[] {
  const value = output as {
    record_id_list?: string[];
    data?: {
      record_id_list?: string[];
      record_ids?: string[];
      records?: Array<{ record_id?: string; id?: string }>;
    };
    records?: Array<{ record_id?: string; id?: string }>;
  };
  const candidates = [
    value.record_id_list,
    value.data?.record_id_list,
    value.data?.record_ids,
    value.data?.records?.map((record) => record.record_id ?? record.id),
    value.records?.map((record) => record.record_id ?? record.id),
  ];
  return candidates.find((item): item is string[] => Array.isArray(item))?.filter(Boolean) ?? [];
}

function batchArgv(input: { baseToken: string; tableRef: string; payloadPath: string }) {
  return [
    "base",
    "+record-batch-create",
    "--as",
    "user",
    "--base-token",
    input.baseToken,
    "--table-id",
    input.tableRef,
    "--json",
    `@${input.payloadPath}`,
  ];
}

function masked(argv: string[]) {
  return argv.map((item, index) => (argv[index - 1] === "--base-token" ? "<base-token>" : item));
}

export async function syncFeishuBaseBatch(
  input: FeishuBaseBatchSyncInput,
): Promise<FeishuBaseBatchSyncResult> {
  const baseToken = input.baseToken.trim();
  if (!baseToken) {
    throw new Error("base_token_required");
  }

  const batchSize = input.batchSize && input.batchSize > 0 ? Math.min(input.batchSize, 200) : 200;
  const tables = { ...defaultTables, ...input.tables };
  const db = openDatabase(input.dbPath);
  runMigrations(db);
  const syncState = new SyncStateRepository(db);
  const runner = input.runner ?? defaultLarkCliRunner;
  const batchDir = join(".omx", "feishu-batch");
  const result: FeishuBaseBatchSyncResult = {
    mode: input.mode,
    summary: {
      planned: 0,
      created: 0,
      skippedExisting: 0,
      failed: 0,
      batches: 0,
    },
    batches: [],
    errors: [],
  };

  try {
    mkdirSync(batchDir, { recursive: true });
    const snapshot = buildFeishuSyncSnapshot(input.dbPath, { today: input.today });
    const stages: Array<() => BatchTargetRow[]> = [
      () => snapshot.customers.map((row) => customerRow(row, tables.customers)),
      () =>
        snapshot.policies.map((row) =>
          policyRow({
            row,
            tableRef: tables.policies,
            customerTableRef: tables.customers,
            baseToken,
            syncState,
          }),
        ),
      () =>
        snapshot.reminders.map((row) =>
          reminderRow({
            row,
            tableRef: tables.reminders,
            customerTableRef: tables.customers,
            policyTableRef: tables.policies,
            baseToken,
            syncState,
          }),
        ),
    ];

    for (const stage of stages) {
      const rows = stage();
      const missingRows = rows.filter((row) => {
        const existing = syncState.get(
          feishuRecordStateKey({ baseToken, tableRef: row.tableRef, externalId: row.externalId }),
        );
        if (existing) {
          result.summary.skippedExisting += 1;
          return false;
        }
        return true;
      });

      for (const [batchIndex, rowsChunk] of chunks(missingRows, batchSize).entries()) {
        const firstRow = rowsChunk[0];
        if (!firstRow) {
          continue;
        }
        const payloadPath = join(batchDir, `${firstRow.table}-${Date.now()}-${batchIndex}.json`);
        writeFileSync(
          payloadPath,
          JSON.stringify({
            fields: firstRow.fields,
            rows: rowsChunk.map((row) => row.cells),
          }),
        );
        const argv = batchArgv({ baseToken, tableRef: firstRow.tableRef, payloadPath });
        result.batches.push({
          table: firstRow.table,
          tableRef: firstRow.tableRef,
          planned: rowsChunk.length,
          operation: input.mode === "plan" ? "batch_create" : "batch_create",
          argv: masked(batchArgv({ baseToken: "<base-token>", tableRef: firstRow.tableRef, payloadPath })),
        });
        result.summary.planned += rowsChunk.length;
        result.summary.batches += 1;

        if (input.mode === "plan") {
          continue;
        }

        try {
          const output = await runner(argv);
          const recordIds = parseRecordIds(parseJsonOutput(output.stdout, output.stderr));
          if (recordIds.length !== rowsChunk.length) {
            throw new Error(`record_id_count_mismatch:${recordIds.length}/${rowsChunk.length}`);
          }
          recordIds.forEach((recordId, rowIndex) => {
            const row = rowsChunk[rowIndex];
            syncState.set(
              feishuRecordStateKey({ baseToken, tableRef: row.tableRef, externalId: row.externalId }),
              recordId,
            );
          });
          result.summary.created += recordIds.length;
        } catch (error) {
          result.summary.failed += rowsChunk.length;
          result.errors.push({
            table: firstRow.table,
            message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
          });
        }
      }
    }

    return result;
  } finally {
    db.close();
    rmSync(batchDir, { recursive: true, force: true });
  }
}

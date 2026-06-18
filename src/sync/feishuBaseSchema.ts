import { defaultLarkCliRunner, maskTokenInMessage, type LarkCliRunner } from "./larkCli";

type SchemaMode = "plan" | "execute";
type TableKind = "customers" | "policies" | "reminders";

type FieldType = "text" | "number" | "datetime" | "select" | "checkbox" | "link";

export interface FeishuBaseSchemaInput {
  baseToken: string;
  mode: SchemaMode;
  tableNames?: Partial<Record<TableKind, string>>;
  runner?: LarkCliRunner;
}

export interface FeishuBaseSchemaCommand {
  action: "list_tables" | "create_table" | "list_fields" | "create_field";
  table: TableKind;
  tableName: string;
  fieldName?: string;
  argv: string[];
}

export interface FeishuBaseSchemaResult {
  mode: SchemaMode;
  summary: {
    planned: number;
    executed: number;
    skippedExisting: number;
    failed: number;
  };
  commands: FeishuBaseSchemaCommand[];
  tables: Record<TableKind, { name: string; tableId?: string }>;
  errors: Array<{ action: string; table: TableKind; fieldName?: string; message: string }>;
}

interface FieldSpec {
  name: string;
  type: FieldType;
  style?: Record<string, string | number | boolean>;
  multiple?: boolean;
  options?: Array<{ name: string; hue?: string; lightness?: string }>;
  linkTable?: TableKind;
  bidirectional?: boolean;
  bidirectionalLinkFieldName?: string;
}

interface TableSpec {
  kind: TableKind;
  name: string;
  fields: FieldSpec[];
}

const tableLabels: Record<TableKind, string> = {
  customers: "客户",
  policies: "保单",
  reminders: "提醒",
};

const schemaSpecs: Record<TableKind, Omit<TableSpec, "name">> = {
  customers: {
    kind: "customers",
    fields: [
      { name: "外部ID", type: "text" },
      { name: "姓名", type: "text" },
      { name: "证件号", type: "text" },
      { name: "手机号", type: "text", style: { type: "phone" } },
      { name: "生日", type: "datetime", style: { format: "yyyy-MM-dd" } },
    ],
  },
  policies: {
    kind: "policies",
    fields: [
      { name: "外部ID", type: "text" },
      { name: "保单号", type: "text" },
      { name: "投保人", type: "text" },
      { name: "被保人", type: "text" },
      { name: "产品名称", type: "text" },
      { name: "保险公司", type: "text" },
      { name: "保费", type: "number", style: { type: "plain", precision: 2 } },
      { name: "缴费方式", type: "text" },
      { name: "缴费期间", type: "text" },
      { name: "生效日", type: "datetime", style: { format: "yyyy-MM-dd" } },
      { name: "下次续期", type: "datetime", style: { format: "yyyy-MM-dd" } },
      { name: "缴费结束年", type: "number", style: { type: "plain", precision: 0 } },
      { name: "投保人客户ID", type: "text" },
      { name: "被保人客户ID", type: "text" },
      {
        name: "投保人客户",
        type: "link",
        linkTable: "customers",
        bidirectional: true,
        bidirectionalLinkFieldName: "投保保单",
      },
      {
        name: "被保人客户",
        type: "link",
        linkTable: "customers",
        bidirectional: true,
        bidirectionalLinkFieldName: "被保保单",
      },
    ],
  },
  reminders: {
    kind: "reminders",
    fields: [
      { name: "外部ID", type: "text" },
      {
        name: "分组",
        type: "select",
        options: [
          { name: "birthday", hue: "Carmine", lightness: "Light" },
          { name: "policy_renewal", hue: "Blue", lightness: "Light" },
          { name: "manual_todo", hue: "Green", lightness: "Light" },
        ],
      },
      { name: "标题", type: "text" },
      { name: "提醒日期", type: "datetime", style: { format: "yyyy-MM-dd" } },
      { name: "结束日期", type: "datetime", style: { format: "yyyy-MM-dd" } },
      {
        name: "状态",
        type: "select",
        options: [
          { name: "pending", hue: "Orange", lightness: "Light" },
          { name: "completed", hue: "Green", lightness: "Light" },
        ],
      },
      { name: "关键提醒", type: "checkbox" },
      { name: "客户ID", type: "text" },
      { name: "保单ID", type: "text" },
      { name: "关联客户", type: "link", linkTable: "customers" },
      { name: "关联保单", type: "link", linkTable: "policies" },
      {
        name: "来源",
        type: "select",
        options: [
          { name: "birthday_import", hue: "Carmine", lightness: "Lighter" },
          { name: "policy_import", hue: "Blue", lightness: "Lighter" },
          { name: "manual", hue: "Green", lightness: "Lighter" },
        ],
      },
    ],
  },
};

function tableSpecs(tableNames?: Partial<Record<TableKind, string>>): TableSpec[] {
  return (["customers", "policies", "reminders"] as const).map((kind) => ({
    ...schemaSpecs[kind],
    name: tableNames?.[kind]?.trim() || tableLabels[kind],
  }));
}

function tableNameMap(specs: TableSpec[]): Record<TableKind, string> {
  return Object.fromEntries(specs.map((spec) => [spec.kind, spec.name])) as Record<TableKind, string>;
}

function fieldConfig(field: FieldSpec, linkedTableNames: Record<TableKind, string>) {
  const linkTable = field.linkTable ? linkedTableNames[field.linkTable] : undefined;
  return {
    name: field.name,
    type: field.type,
    ...(field.style ? { style: field.style } : {}),
    ...(field.multiple !== undefined ? { multiple: field.multiple } : {}),
    ...(field.options ? { multiple: false, options: field.options } : {}),
    ...(linkTable ? { link_table: linkTable } : {}),
    ...(field.bidirectional !== undefined ? { bidirectional: field.bidirectional } : {}),
    ...(field.bidirectionalLinkFieldName
      ? { bidirectional_link_field_name: field.bidirectionalLinkFieldName }
      : {}),
  };
}

function fieldJson(field: FieldSpec, linkedTableNames: Record<TableKind, string>) {
  return JSON.stringify(fieldConfig(field, linkedTableNames));
}

function tableFieldsJson(table: TableSpec, linkedTableNames: Record<TableKind, string>) {
  return JSON.stringify(table.fields.map((field) => fieldConfig(field, linkedTableNames)));
}

function tableCreateArgv(
  baseToken: string,
  table: TableSpec,
  linkedTableNames: Record<TableKind, string>,
) {
  return [
    "base",
    "+table-create",
    "--as",
    "user",
    "--base-token",
    baseToken,
    "--name",
    table.name,
    "--fields",
    tableFieldsJson(table, linkedTableNames),
  ];
}

function tableListArgv(baseToken: string) {
  return ["base", "+table-list", "--as", "user", "--base-token", baseToken, "--limit", "100"];
}

function fieldListArgv(baseToken: string, tableId: string) {
  return [
    "base",
    "+field-list",
    "--as",
    "user",
    "--base-token",
    baseToken,
    "--table-id",
    tableId,
    "--limit",
    "200",
  ];
}

function fieldCreateArgv(
  baseToken: string,
  tableId: string,
  field: FieldSpec,
  linkedTableNames: Record<TableKind, string>,
) {
  return [
    "base",
    "+field-create",
    "--as",
    "user",
    "--base-token",
    baseToken,
    "--table-id",
    tableId,
    "--json",
    fieldJson(field, linkedTableNames),
  ];
}

function masked(argv: string[]) {
  return argv.map((item, index) => (argv[index - 1] === "--base-token" ? "<base-token>" : item));
}

function parseTableItems(stdout: string): Array<{ table_id?: string; table_name?: string; name?: string }> {
  const parsed = JSON.parse(stdout) as {
    items?: Array<{ table_id?: string; table_name?: string; name?: string }>;
    data?: { items?: Array<{ table_id?: string; table_name?: string; name?: string }> };
  };
  return parsed.items ?? parsed.data?.items ?? [];
}

function parseFieldItems(stdout: string): Array<{ field_name?: string; name?: string }> {
  const parsed = JSON.parse(stdout) as {
    items?: Array<{ field_name?: string; name?: string }>;
    data?: { items?: Array<{ field_name?: string; name?: string }> };
  };
  return parsed.items ?? parsed.data?.items ?? [];
}

function parseCreatedTableId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      table?: { table_id?: string };
      data?: { table?: { table_id?: string } };
    };
    return parsed.table?.table_id ?? parsed.data?.table?.table_id;
  } catch {
    return undefined;
  }
}

export async function prepareFeishuBaseSchema(
  input: FeishuBaseSchemaInput,
): Promise<FeishuBaseSchemaResult> {
  const baseToken = input.baseToken.trim();
  if (!baseToken) {
    throw new Error("base_token_required");
  }

  const specs = tableSpecs(input.tableNames);
  const linkedTableNames = tableNameMap(specs);
  const runner = input.runner ?? defaultLarkCliRunner;
  const commands: FeishuBaseSchemaCommand[] = [];
  const errors: FeishuBaseSchemaResult["errors"] = [];
  const tables = Object.fromEntries(
    specs.map((spec) => [spec.kind, { name: spec.name }]),
  ) as FeishuBaseSchemaResult["tables"];
  let executed = 0;
  let skippedExisting = 0;
  let failed = 0;

  if (input.mode === "plan") {
    for (const spec of specs) {
      commands.push({
        action: "create_table",
        table: spec.kind,
        tableName: spec.name,
        argv: masked(tableCreateArgv(baseToken, spec, linkedTableNames)),
      });
    }
    return {
      mode: input.mode,
      summary: { planned: commands.length, executed, skippedExisting, failed },
      commands,
      tables,
      errors,
    };
  }

  let remoteTables: Array<{ table_id?: string; table_name?: string; name?: string }> = [];
  try {
    commands.push({
      action: "list_tables",
      table: "customers",
      tableName: "Base",
      argv: masked(tableListArgv(baseToken)),
    });
    remoteTables = parseTableItems((await runner(tableListArgv(baseToken))).stdout);
  } catch (error) {
    failed += 1;
    errors.push({
      action: "list_tables",
      table: "customers",
      message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
    });
    return {
      mode: input.mode,
      summary: { planned: commands.length, executed, skippedExisting, failed },
      commands,
      tables,
      errors,
    };
  }

  for (const spec of specs) {
    const existing = remoteTables.find((item) => (item.table_name ?? item.name) === spec.name);
    let tableId = existing?.table_id;
    if (!tableId) {
      const argv = tableCreateArgv(baseToken, spec, linkedTableNames);
      commands.push({
        action: "create_table",
        table: spec.kind,
        tableName: spec.name,
        argv: masked(argv),
      });
      try {
        tableId = parseCreatedTableId((await runner(argv)).stdout);
        executed += 1;
      } catch (error) {
        failed += 1;
        errors.push({
          action: "create_table",
          table: spec.kind,
          message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
        });
        continue;
      }
    } else {
      skippedExisting += 1;
    }

    tables[spec.kind] = { name: spec.name, tableId };
    if (!tableId) continue;

    let existingFieldNames = new Set<string>();
    try {
      commands.push({
        action: "list_fields",
        table: spec.kind,
        tableName: spec.name,
        argv: masked(fieldListArgv(baseToken, tableId)),
      });
      existingFieldNames = new Set(
        parseFieldItems((await runner(fieldListArgv(baseToken, tableId))).stdout).map(
          (field) => field.field_name ?? field.name ?? "",
        ),
      );
    } catch (error) {
      failed += 1;
      errors.push({
        action: "list_fields",
        table: spec.kind,
        message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
      });
      continue;
    }

    for (const field of spec.fields) {
      if (existingFieldNames.has(field.name)) {
        skippedExisting += 1;
        continue;
      }
      const argv = fieldCreateArgv(baseToken, tableId, field, linkedTableNames);
      commands.push({
        action: "create_field",
        table: spec.kind,
        tableName: spec.name,
        fieldName: field.name,
        argv: masked(argv),
      });
      try {
        await runner(argv);
        executed += 1;
      } catch (error) {
        failed += 1;
        errors.push({
          action: "create_field",
          table: spec.kind,
          fieldName: field.name,
          message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
        });
      }
    }
  }

  return {
    mode: input.mode,
    summary: { planned: commands.length, executed, skippedExisting, failed },
    commands,
    tables,
    errors,
  };
}

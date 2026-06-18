import { describe, expect, it } from "vitest";
import { prepareFeishuBaseSchema } from "../../src/sync/feishuBaseSchema";
import type { LarkCliRunner } from "../../src/sync/larkCli";

describe("feishu base schema", () => {
  it("builds a masked table creation plan without external writes", async () => {
    const modernBaseToken = "FNrnbZJt8atlBRsuaVgcOKdSnXf";
    const result = await prepareFeishuBaseSchema({
      baseToken: modernBaseToken,
      mode: "plan",
    });

    expect(result.summary).toEqual({
      planned: 3,
      executed: 0,
      skippedExisting: 0,
      failed: 0,
    });
    expect(result.commands.map((command) => command.tableName)).toEqual(["客户", "保单", "提醒"]);
    expect(JSON.stringify(result.commands)).toContain("<base-token>");
    expect(JSON.stringify(result.commands)).not.toContain(modernBaseToken);

    const policyCreate = result.commands.find((command) => command.table === "policies");
    const fields = JSON.parse(policyCreate?.argv[policyCreate.argv.indexOf("--fields") + 1] ?? "[]");
    expect(fields).toContainEqual(
      expect.objectContaining({
        name: "投保人客户",
        type: "link",
        link_table: "客户",
        bidirectional: true,
      }),
    );
    expect(fields).toContainEqual(
      expect.objectContaining({
        name: "下次续期",
        type: "datetime",
      }),
    );
    expect(fields).toContainEqual(
      expect.objectContaining({
        name: "缴费结束年",
        type: "number",
      }),
    );
  });

  it("creates only missing tables and fields when executing", async () => {
    const calls: string[][] = [];
    const runner: LarkCliRunner = async (argv) => {
      calls.push(argv);
      const command = argv[1];
      if (command === "+table-list") {
        return {
          stdout: JSON.stringify({
            items: [{ table_id: "tbl_customer", table_name: "客户" }],
          }),
          stderr: "",
        };
      }
      if (command === "+field-list") {
        const tableId = argv[argv.indexOf("--table-id") + 1];
        if (tableId === "tbl_customer") {
          return {
            stdout: JSON.stringify({
              items: [{ field_name: "外部ID" }, { field_name: "姓名" }],
            }),
            stderr: "",
          };
        }
        return { stdout: JSON.stringify({ items: [] }), stderr: "" };
      }
      if (command === "+table-create") {
        const tableName = argv[argv.indexOf("--name") + 1];
        return {
          stdout: JSON.stringify({ table: { table_id: `tbl_${tableName}` } }),
          stderr: "",
        };
      }
      if (command === "+field-create") {
        return { stdout: JSON.stringify({ field: { field_id: "fld" } }), stderr: "" };
      }
      throw new Error(`unexpected command ${command}`);
    };

    const result = await prepareFeishuBaseSchema({
      baseToken: "app_schema_token",
      mode: "execute",
      runner,
    });

    expect(result.summary.failed).toBe(0);
    expect(result.summary.skippedExisting).toBeGreaterThanOrEqual(3);
    expect(result.tables.customers.tableId).toBe("tbl_customer");
    expect(result.tables.policies.tableId).toBe("tbl_保单");
    expect(result.tables.reminders.tableId).toBe("tbl_提醒");
    expect(calls.some((argv) => argv[1] === "+table-create")).toBe(true);
    expect(calls.some((argv) => argv[1] === "+field-create")).toBe(true);
    expect(JSON.stringify(result.commands)).not.toContain("app_schema_token");
  });
});

import { describe, expect, it } from "vitest";
import { prepareFeishuReminderCalendarView } from "../../src/sync/feishuBaseViews";
import type { LarkCliRunner } from "../../src/sync/larkCli";

describe("feishu base views", () => {
  it("builds a masked calendar view plan", async () => {
    const result = await prepareFeishuReminderCalendarView({
      baseToken: "app_view_token",
      mode: "plan",
    });

    expect(result.summary).toEqual({
      planned: 3,
      executed: 0,
      skippedExisting: 0,
      failed: 0,
    });
    expect(result.commands.map((command) => command.action)).toEqual([
      "create_view",
      "set_timebar",
      "set_visible_fields",
    ]);
    expect(JSON.stringify(result.commands)).toContain("<base-token>");
    expect(JSON.stringify(result.commands)).not.toContain("app_view_token");
  });

  it("reuses an existing calendar view and configures it", async () => {
    const calls: string[][] = [];
    const runner: LarkCliRunner = async (argv) => {
      calls.push(argv);
      if (argv[1] === "+view-list") {
        return {
          stdout: JSON.stringify({
            views: [{ view_id: "viw_existing", view_name: "提醒日历" }],
          }),
          stderr: "",
        };
      }
      if (argv[1] === "+view-set-timebar" || argv[1] === "+view-set-visible-fields") {
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      throw new Error(`unexpected command ${argv[1]}`);
    };

    const result = await prepareFeishuReminderCalendarView({
      baseToken: "app_view_token",
      mode: "execute",
      runner,
    });

    expect(result.summary).toEqual({
      planned: 3,
      executed: 2,
      skippedExisting: 1,
      failed: 0,
    });
    expect(result.viewId).toBe("viw_existing");
    expect(calls.some((argv) => argv[1] === "+view-create")).toBe(false);
    expect(calls.some((argv) => argv[1] === "+view-set-timebar")).toBe(true);
    expect(JSON.stringify(result.commands)).not.toContain("app_view_token");
  });
});

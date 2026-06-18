import { defaultLarkCliRunner, maskTokenInMessage, type LarkCliRunner } from "./larkCli";

type ViewMode = "plan" | "execute";

export interface FeishuBaseCalendarViewInput {
  baseToken: string;
  mode: ViewMode;
  remindersTable?: string;
  viewName?: string;
  runner?: LarkCliRunner;
}

export interface FeishuBaseCalendarViewCommand {
  action: "list_views" | "create_view" | "set_timebar" | "set_visible_fields";
  tableName: string;
  viewName: string;
  argv: string[];
}

export interface FeishuBaseCalendarViewResult {
  mode: ViewMode;
  summary: {
    planned: number;
    executed: number;
    skippedExisting: number;
    failed: number;
  };
  tableName: string;
  viewName: string;
  viewId?: string;
  commands: FeishuBaseCalendarViewCommand[];
  errors: Array<{ action: string; message: string }>;
}

function masked(argv: string[]) {
  return argv.map((item, index) => (argv[index - 1] === "--base-token" ? "<base-token>" : item));
}

function viewListArgv(baseToken: string, tableName: string) {
  return [
    "base",
    "+view-list",
    "--as",
    "user",
    "--base-token",
    baseToken,
    "--table-id",
    tableName,
    "--limit",
    "100",
  ];
}

function viewCreateArgv(baseToken: string, tableName: string, viewName: string) {
  return [
    "base",
    "+view-create",
    "--as",
    "user",
    "--base-token",
    baseToken,
    "--table-id",
    tableName,
    "--json",
    JSON.stringify({ name: viewName, type: "calendar" }),
  ];
}

function setTimebarArgv(baseToken: string, tableName: string, viewId: string) {
  return [
    "base",
    "+view-set-timebar",
    "--as",
    "user",
    "--base-token",
    baseToken,
    "--table-id",
    tableName,
    "--view-id",
    viewId,
    "--json",
    JSON.stringify({
      start_time: "提醒日期",
      end_time: "结束日期",
      title: "标题",
    }),
  ];
}

function setVisibleFieldsArgv(baseToken: string, tableName: string, viewId: string) {
  return [
    "base",
    "+view-set-visible-fields",
    "--as",
    "user",
    "--base-token",
    baseToken,
    "--table-id",
    tableName,
    "--view-id",
    viewId,
    "--json",
    JSON.stringify({
      visible_fields: ["标题", "分组", "提醒日期", "状态", "关键提醒", "客户ID", "保单ID"],
    }),
  ];
}

function parseViewItems(stdout: string): Array<{ view_id?: string; view_name?: string; name?: string }> {
  const parsed = JSON.parse(stdout) as {
    views?: Array<{ view_id?: string; view_name?: string; name?: string }>;
    items?: Array<{ view_id?: string; view_name?: string; name?: string }>;
    data?: {
      views?: Array<{ view_id?: string; view_name?: string; name?: string }>;
      items?: Array<{ view_id?: string; view_name?: string; name?: string }>;
    };
  };
  return parsed.views ?? parsed.items ?? parsed.data?.views ?? parsed.data?.items ?? [];
}

function parseCreatedViewId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      view?: { view_id?: string };
      data?: { view?: { view_id?: string } };
    };
    return parsed.view?.view_id ?? parsed.data?.view?.view_id;
  } catch {
    return undefined;
  }
}

export async function prepareFeishuReminderCalendarView(
  input: FeishuBaseCalendarViewInput,
): Promise<FeishuBaseCalendarViewResult> {
  const baseToken = input.baseToken.trim();
  if (!baseToken) {
    throw new Error("base_token_required");
  }
  const tableName = input.remindersTable?.trim() || "提醒";
  const viewName = input.viewName?.trim() || "提醒日历";
  const runner = input.runner ?? defaultLarkCliRunner;
  const commands: FeishuBaseCalendarViewCommand[] = [];
  const errors: FeishuBaseCalendarViewResult["errors"] = [];
  let executed = 0;
  let skippedExisting = 0;
  let failed = 0;
  let viewId: string | undefined;

  const plannedViewId = "<view-id>";
  const plannedCommands: FeishuBaseCalendarViewCommand[] = [
    {
      action: "create_view",
      tableName,
      viewName,
      argv: masked(viewCreateArgv(baseToken, tableName, viewName)),
    },
    {
      action: "set_timebar",
      tableName,
      viewName,
      argv: masked(setTimebarArgv(baseToken, tableName, plannedViewId)),
    },
    {
      action: "set_visible_fields",
      tableName,
      viewName,
      argv: masked(setVisibleFieldsArgv(baseToken, tableName, plannedViewId)),
    },
  ];

  if (input.mode === "plan") {
    return {
      mode: input.mode,
      summary: {
        planned: plannedCommands.length,
        executed,
        skippedExisting,
        failed,
      },
      tableName,
      viewName,
      commands: plannedCommands,
      errors,
    };
  }

  try {
    const argv = viewListArgv(baseToken, tableName);
    commands.push({ action: "list_views", tableName, viewName, argv: masked(argv) });
    const views = parseViewItems((await runner(argv)).stdout);
    const existing = views.find((item) => (item.view_name ?? item.name) === viewName);
    viewId = existing?.view_id;
    if (viewId) {
      skippedExisting += 1;
    }
  } catch (error) {
    failed += 1;
    errors.push({
      action: "list_views",
      message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
    });
    return {
      mode: input.mode,
      summary: { planned: commands.length, executed, skippedExisting, failed },
      tableName,
      viewName,
      viewId,
      commands,
      errors,
    };
  }

  if (!viewId) {
    const argv = viewCreateArgv(baseToken, tableName, viewName);
    commands.push({ action: "create_view", tableName, viewName, argv: masked(argv) });
    try {
      viewId = parseCreatedViewId((await runner(argv)).stdout);
      executed += 1;
    } catch (error) {
      failed += 1;
      errors.push({
        action: "create_view",
        message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
      });
      return {
        mode: input.mode,
        summary: { planned: commands.length, executed, skippedExisting, failed },
        tableName,
        viewName,
        viewId,
        commands,
        errors,
      };
    }
  }

  if (!viewId) {
    failed += 1;
    errors.push({ action: "create_view", message: "view_id_missing" });
    return {
      mode: input.mode,
      summary: { planned: commands.length, executed, skippedExisting, failed },
      tableName,
      viewName,
      viewId,
      commands,
      errors,
    };
  }

  for (const command of [
    { action: "set_timebar" as const, argv: setTimebarArgv(baseToken, tableName, viewId) },
    {
      action: "set_visible_fields" as const,
      argv: setVisibleFieldsArgv(baseToken, tableName, viewId),
    },
  ]) {
    commands.push({ action: command.action, tableName, viewName, argv: masked(command.argv) });
    try {
      await runner(command.argv);
      executed += 1;
    } catch (error) {
      failed += 1;
      errors.push({
        action: command.action,
        message: maskTokenInMessage(error instanceof Error ? error.message : String(error), baseToken),
      });
    }
  }

  return {
    mode: input.mode,
    summary: { planned: commands.length, executed, skippedExisting, failed },
    tableName,
    viewName,
    viewId,
    commands,
    errors,
  };
}

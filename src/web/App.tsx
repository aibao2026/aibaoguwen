import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { DatesSetArg, EventClickArg, EventContentArg, EventInput } from "@fullcalendar/core";
import {
  analyzeImport,
  completeReminder,
  completeRemindersByDate,
  createBackup,
  createTodo,
  deleteReminder,
  getAiSettings,
  getReminderDetail,
  getAuthStatus,
  getLocalDataStats,
  importWorkbooks,
  listBackups,
  listPendingConfirmations,
  listReminders,
  loginWithPassword,
  logout,
  prepareFeishuBaseSchema,
  prepareFeishuCalendarView,
  reopenReminder,
  restoreBackup,
  resolvePendingConfirmation,
  saveAiSettings,
  syncFeishuBase,
  syncFeishuCalendar,
  type AiProviderId,
  type AiSettings,
  type DataBackupItem,
  type FeishuBaseCalendarViewResult,
  type FeishuBaseSchemaResult,
  type FeishuCalendarSyncResult,
  updateTodo,
  type FeishuBaseSyncResult,
  type KeyFieldChangeItem,
  type LocalDataStats,
  type PendingCorrectionInput,
  type ImportAnalysisResult,
  type ReminderDetail,
  type PendingItem,
  type ReminderItem,
} from "./apiClient";

type Tab = "dashboard" | "maintenance" | "reminders" | "support";
type NavIconName = "calendar" | "maintenance" | "support";

const groupLabels: Record<ReminderItem["group"], string> = {
  birthday: "生日",
  policy_renewal: "续期",
  manual_todo: "待办",
};

const WORK_NOTICE_STORAGE_KEY = "ai-baoguwen:work-notice";

const panelEyebrows: Record<Exclude<Tab, "dashboard">, string> = {
  maintenance: "数据维护",
  reminders: "低频查看",
  support: "社群交流",
};

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <path d="M8 16a8 8 0 0 1 13.7-5.7" />
        <path d="M24 16a8 8 0 0 1-13.7 5.7" />
        <path d="M22 7v5h-5" />
        <path d="M10 25v-5h5" />
        <path d="M13 14h6" />
        <path d="M13 18h6" />
      </svg>
    </span>
  );
}

function NavIcon({ name }: { name: NavIconName }) {
  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" />
        <path d="M8 14h2M13 14h3M8 17h2M13 17h3" />
      </svg>
    );
  }

  if (name === "maintenance") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h10" />
        <path d="M18 7h2" />
        <circle cx="16" cy="7" r="2.5" />
        <path d="M4 17h2" />
        <path d="M10 17h10" />
        <circle cx="8" cy="17" r="2.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9a6 6 0 0 1 12 0v1" />
      <path d="M4 10h4v6H4z" />
      <path d="M16 10h4v6h-4z" />
      <path d="M12 19h2a4 4 0 0 0 4-4" />
      <path d="M9 19h3" />
    </svg>
  );
}

function localDateIso(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function todayIso() {
  return localDateIso(new Date());
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateIso(date);
}

function monthLabel(month: Date) {
  return `${month.getFullYear()}年${month.getMonth() + 1}月`;
}

function shortMonthLabel(month: Date) {
  return `${month.getMonth() + 1}月`;
}

function dateLabel(dateIso: string) {
  const date = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
}

function addMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth() + amount, 1));
}

function groupCount(reminders: ReminderItem[], group: ReminderItem["group"]) {
  return reminders.filter((item) => item.group === group).length;
}

function reminderPreviewText(item: ReminderItem) {
  return item.title.replace(/^.*?：/, "");
}

function reminderCardTitle(item: ReminderItem) {
  const baseTitle = reminderPreviewText(item);
  if (item.group !== "policy_renewal") {
    return baseTitle;
  }
  const premium = formatMoney(item.policySummary?.premium);
  return premium ? `${baseTitle} · ${premium}` : baseTitle;
}

function formatMoney(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function backupOptionLabel(item: DataBackupItem) {
  const date = new Date(item.modifiedAt);
  if (Number.isNaN(date.getTime())) {
    return "一个备份";
  }
  return `${date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  })} ${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })} 的备份`;
}

function groupColor(group: ReminderItem["group"]) {
  if (group === "birthday") return "#db2777";
  if (group === "policy_renewal") return "#2563eb";
  return "#0f766e";
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function AuthGate({
  message,
  onUnlock,
}: {
  message: string;
  onUnlock: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onUnlock(password);
      setPassword("");
    } catch {
      setError("密码不正确");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-lock">
      <form className="lock-panel" onSubmit={submit}>
        <BrandMark />
        <h1>AI保顾问</h1>
        <label>
          访问密码
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {(error || message) && <p className="lock-error">{error || message}</p>}
        <button className="primary" disabled={isSubmitting || !password.trim()}>
          {isSubmitting ? "解锁中" : "解锁"}
        </button>
      </form>
    </main>
  );
}

export function App() {
  const [authStatus, setAuthStatus] = useState<{ enabled: boolean; authenticated: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [stats, setStats] = useState<LocalDataStats | null>(null);
  const [message, setMessage] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [activeGroups, setActiveGroups] = useState<Record<ReminderItem["group"], boolean>>({
    birthday: true,
    policy_renewal: true,
    manual_todo: true,
  });

  async function refresh() {
    const [reminderResult, pendingResult, statsResult] = await Promise.all([
      listReminders(),
      listPendingConfirmations(),
      getLocalDataStats(),
    ]);
    setReminders(reminderResult.items);
    setPending(pendingResult.items);
    setStats(statsResult);
  }

  async function refreshAuthStatus() {
    const status = await getAuthStatus();
    setAuthStatus(status);
    return status;
  }

  useEffect(() => {
    refreshAuthStatus()
      .then((status) => {
        if (status.authenticated) {
          return refresh();
        }
        return undefined;
      })
      .catch((error: unknown) => setMessage(String(error)));
  }, []);

  if (!authStatus) {
    return (
      <main className="app-lock">
        <section className="lock-panel">
          <BrandMark />
          <h1>AI保顾问</h1>
          <p>正在检查本地访问状态</p>
        </section>
      </main>
    );
  }

  if (authStatus.enabled && !authStatus.authenticated) {
    return (
      <AuthGate
        message={message}
        onUnlock={async (password) => {
          await loginWithPassword(password);
          setMessage("已解锁");
          await refreshAuthStatus();
          await refresh();
        }}
      />
    );
  }

  const pendingReminders = reminders.filter(
    (item) => item.status === "pending" && activeGroups[item.group],
  );
  const visibleReminders = reminders.filter((item) => activeGroups[item.group]);
  const allPendingReminders = reminders.filter((item) => item.status === "pending");
  const todayReminders = pendingReminders.filter((item) => item.reminderDate === todayIso());
  const selectedReminders = visibleReminders.filter(
    (item) => item.reminderDate === selectedDate,
  );
  const visibleMonthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
  const monthReminders = pendingReminders.filter((item) =>
    item.reminderDate.startsWith(visibleMonthKey),
  );
  const allMonthReminders = allPendingReminders.filter((item) =>
    item.reminderDate.startsWith(visibleMonthKey),
  );
  const overdueCount = pendingReminders.filter((item) => item.reminderDate < todayIso()).length;
  const navItems: Array<{ key: Tab; label: string; icon: NavIconName }> = [
    { key: "dashboard", label: "工作日历", icon: "calendar" },
    { key: "maintenance", label: "维护", icon: "maintenance" },
    { key: "support", label: "支持", icon: "support" },
  ];

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>AI保顾问</h1>
          </div>
        </div>
        {authStatus.enabled && (
          <button
            className="ghost"
            onClick={async () => {
              await logout();
              setAuthStatus({ enabled: true, authenticated: false });
              setReminders([]);
              setPending([]);
              setStats(null);
              setMessage("已锁定");
            }}
          >
            锁定
          </button>
        )}
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? "active" : ""}
              onClick={() => setTab(item.key)}
              title={item.label}
              aria-label={item.label}
            >
              <span className="nav-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="content">
        {message && <div className="message">{message}</div>}
        {tab === "dashboard" && (
          <Dashboard
            month={visibleMonth}
            reminders={monthReminders}
            monthReminders={monthReminders}
            overdueCount={overdueCount}
            pendingCount={pending.length}
            selectedDate={selectedDate}
            selectedReminders={selectedReminders}
            todayCount={todayReminders.length}
            stats={stats}
            onMonthChange={(amount) => setVisibleMonth((current) => addMonths(current, amount))}
            onSelectDate={setSelectedDate}
            onToday={() => {
              const now = startOfMonth(new Date());
              setVisibleMonth(now);
              setSelectedDate(todayIso());
            }}
            activeGroups={activeGroups}
            rawGroupCounts={{
              birthday: groupCount(allMonthReminders, "birthday"),
              policy_renewal: groupCount(allMonthReminders, "policy_renewal"),
              manual_todo: groupCount(allMonthReminders, "manual_todo"),
            }}
            onToggleGroup={(group) =>
              setActiveGroups((current) => ({ ...current, [group]: !current[group] }))
            }
            onOpenMaintenance={() => setTab("maintenance")}
            onGoReminders={() => setTab("reminders")}
            onCreateTodo={async (input) => {
              await createTodo(input);
              setMessage("手动待办已创建");
              setSelectedDate(input.reminderDate);
              await refresh();
            }}
            onCompleteReminder={async (id) => {
              setReminders((current) =>
                current.map((item) => (item.id === id ? { ...item, status: "completed" } : item)),
              );
              try {
                await completeReminder(id);
                setMessage("提醒已完成");
                await refresh();
              } catch (error) {
                setMessage(String(error));
                await refresh();
                throw error;
              }
            }}
            onCompleteDate={async (date) => {
              setReminders((current) =>
                current.map((item) =>
                  item.reminderDate === date && item.status === "pending"
                    ? { ...item, status: "completed" }
                    : item,
                ),
              );
              try {
                const result = await completeRemindersByDate(date);
                setMessage(result.completed > 0 ? `当天 ${result.completed} 条提醒已完成` : "当天没有未完成提醒");
                await refresh();
              } catch (error) {
                setMessage(String(error));
                await refresh();
                throw error;
              }
            }}
          />
        )}
        {tab === "maintenance" && (
          <Panel title="维护" eyebrow={panelEyebrows.maintenance}>
            <MaintenanceView
              pending={pending}
              onOpenDashboard={() => setTab("dashboard")}
              onRestored={async () => {
                await refresh();
                setTab("dashboard");
              }}
              onImported={async (summary) => {
                setMessage(
                  `导入完成：客户 ${summary.persistedCustomers}，保单 ${summary.persistedPolicies}，提醒 ${summary.generatedReminders}，待确认 ${summary.pendingConfirmations}`,
                );
                await refresh();
              }}
              onResolve={async (id, input) => {
                const result = await resolvePendingConfirmation(id, input);
                setMessage(
                  result.appliedCorrection
                    ? `待确认已修正，生成 ${result.remindersGenerated} 条提醒`
                    : "待确认事项已处理",
                );
                await refresh();
              }}
            />
          </Panel>
        )}
        {tab === "reminders" && (
          <Panel title="提醒" eyebrow={panelEyebrows.reminders}>
            <ReminderList
              reminders={reminders}
              onComplete={async (id) => {
                await completeReminder(id);
                await refresh();
              }}
              onReopen={async (id) => {
                await reopenReminder(id);
                setMessage("提醒已恢复为未完成");
                await refresh();
              }}
              onUpdateManual={async (id, input) => {
                await updateTodo(id, input);
                setMessage("手动待办已更新");
                await refresh();
              }}
              onDelete={async (id) => {
                await deleteReminder(id);
                setMessage("手动待办已删除");
                await refresh();
              }}
            />
          </Panel>
        )}
        {tab === "support" && (
          <Panel title="支持" eyebrow={panelEyebrows.support}>
            <SupportView />
          </Panel>
        )}
      </section>
      <nav className="mobile-nav" aria-label="主要导航">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={tab === item.key ? "active" : ""}
            onClick={() => setTab(item.key)}
            aria-label={item.label}
          >
            <span aria-hidden="true"><NavIcon name={item.icon} /></span>
            <b>{item.label}</b>
          </button>
        ))}
      </nav>
    </main>
  );
}

function Panel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-page">
      <div className="page-heading">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function MaintenanceView({
  pending,
  onImported,
  onOpenDashboard,
  onRestored,
  onResolve,
}: {
  pending: PendingItem[];
  onImported: (summary: Awaited<ReturnType<typeof importWorkbooks>>) => Promise<void>;
  onOpenDashboard: () => void;
  onRestored: () => Promise<void>;
  onResolve: (
    id: string,
    input: { note?: string; correction?: PendingCorrectionInput },
  ) => Promise<void>;
}) {
  return (
    <div className="maintenance-page">
      <section className="maintenance-section">
        <div className="maintenance-head">
          <div>
            <span>1</span>
            <h3>导入数据</h3>
          </div>
        </div>
        <ImportView
          onOpenDashboard={onOpenDashboard}
          onOpenPending={() => {
            const section = document.getElementById("pending-maintenance");
            section?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onRestored={onRestored}
          onImported={onImported}
        />
      </section>

      <section className="maintenance-section" id="pending-maintenance">
        <div className="maintenance-head">
          <div>
            <span>2</span>
            <h3>需要确认</h3>
          </div>
          <strong>{pending.length} 条</strong>
        </div>
        <PendingList items={pending} onResolve={onResolve} />
      </section>

      <section className="maintenance-section">
        <div className="maintenance-head">
          <div>
            <span>3</span>
            <h3>飞书同步</h3>
          </div>
        </div>
        <FeishuAgentGuide />
      </section>
    </div>
  );
}

function SupportView() {
  return (
    <div className="support-page">
      <section className="support-panel">
        <div className="support-copy">
          <span>微信群</span>
          <h3>扫码进群交流</h3>
          <p>导入、提醒、飞书同步和使用建议，都可以在群里反馈。</p>
        </div>
        <div className="support-qr">
          <img src="/support/community-qr.png" alt="微信群二维码" />
        </div>
      </section>
    </div>
  );
}

function Dashboard({
  month,
  reminders,
  monthReminders,
  overdueCount,
  pendingCount,
  selectedDate,
  selectedReminders,
  todayCount,
  stats,
  activeGroups,
  rawGroupCounts,
  onMonthChange,
  onSelectDate,
  onToday,
  onToggleGroup,
  onOpenMaintenance,
  onGoReminders,
  onCreateTodo,
  onCompleteReminder,
  onCompleteDate,
}: {
  month: Date;
  reminders: ReminderItem[];
  monthReminders: ReminderItem[];
  overdueCount: number;
  pendingCount: number;
  selectedDate: string;
  selectedReminders: ReminderItem[];
  todayCount: number;
  stats: LocalDataStats | null;
  activeGroups: Record<ReminderItem["group"], boolean>;
  rawGroupCounts: Record<ReminderItem["group"], number>;
  onMonthChange: (amount: number) => void;
  onSelectDate: (date: string) => void;
  onToday: () => void;
  onToggleGroup: (group: ReminderItem["group"]) => void;
  onOpenMaintenance: () => void;
  onGoReminders: () => void;
  onCreateTodo: (input: { title: string; reminderDate: string; isKey: boolean }) => Promise<void>;
  onCompleteReminder: (id: string) => Promise<void>;
  onCompleteDate: (date: string) => Promise<void>;
}) {
  const [todoDate, setTodoDate] = useState(selectedDate);
  const [isTodoModalOpen, setTodoModalOpen] = useState(false);
  const [isCompletingDate, setCompletingDate] = useState(false);
  const [detail, setDetail] = useState<ReminderDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [hiddenNoticeId, setHiddenNoticeId] = useState("");
  const isMobileCalendar = useMediaQuery("(max-width: 760px)");
  const [mobileCalendarRange, setMobileCalendarRange] = useState<"week" | "month">("week");

  function openTodoModal(date: string) {
    onSelectDate(date);
    setTodoDate(date);
    setTodoModalOpen(true);
  }

  async function openReminderDetail(item: ReminderItem) {
    onSelectDate(item.reminderDate);
    setDetailError("");
    setLoadingDetailId(item.id);
    try {
      setDetail(await getReminderDetail(item.id));
    } catch (error) {
      setDetailError(String(error));
    } finally {
      setLoadingDetailId(null);
    }
  }

  const hasImportedData = Boolean(
    stats && (stats.customers > 0 || stats.policies > 0 || stats.reminders.total > 0),
  );
  const selectedPendingCount = selectedReminders.filter((item) => item.status === "pending").length;
  const selectedCompletedCount = selectedReminders.filter((item) => item.status === "completed").length;
  const selectedPendingReminders = selectedReminders.filter((item) => item.status === "pending");
  const selectedCompletedReminders = selectedReminders.filter((item) => item.status === "completed");
  const nextStep = (() => {
    if (!hasImportedData) {
      return {
        noticeId: "import-data",
        tone: "blue",
        title: "先导入客户和保单表",
        action: "去维护",
        onClick: onOpenMaintenance,
      };
    }
    if (pendingCount > 0) {
      return {
        noticeId: "pending-confirmations",
        tone: "amber",
        title: `先处理 ${pendingCount} 条待确认`,
        action: "处理待确认",
        onClick: onOpenMaintenance,
      };
    }
    if (overdueCount > 0) {
      return {
        noticeId: "overdue-reminders",
        tone: "rose",
        title: `有 ${overdueCount} 条提醒已逾期`,
        action: "查看提醒",
        onClick: onGoReminders,
      };
    }
    if (todayCount > 0) {
      return {
        noticeId: "today-reminders",
        tone: "teal",
        title: `今天有 ${todayCount} 条提醒`,
        action: "回到今天",
        onClick: onToday,
      };
    }
    return {
      noticeId: "idle",
      tone: "teal",
      title: "今天没有未完成提醒",
      action: "新增待办",
      onClick: () => openTodoModal(selectedDate),
    };
  })();
  const shouldShowWorkNotice = nextStep.noticeId !== "idle" && hiddenNoticeId !== nextStep.noticeId;

  useEffect(() => {
    if (nextStep.noticeId === "idle") {
      setHiddenNoticeId("");
      return;
    }
    try {
      const raw = window.localStorage.getItem(WORK_NOTICE_STORAGE_KEY);
      const record = raw ? JSON.parse(raw) as { noticeId?: string; snoozeUntil?: string } : null;
      setHiddenNoticeId(
        record?.noticeId === nextStep.noticeId && record.snoozeUntil && record.snoozeUntil > todayIso()
          ? nextStep.noticeId
          : "",
      );
    } catch {
      setHiddenNoticeId("");
    }
  }, [nextStep.noticeId]);

  function closeWorkNotice() {
    const today = todayIso();
    let closeCount = 0;
    try {
      const raw = window.localStorage.getItem(WORK_NOTICE_STORAGE_KEY);
      const record = raw ? JSON.parse(raw) as { noticeId?: string; closeCount?: number } : null;
      closeCount = record?.noticeId === nextStep.noticeId ? record.closeCount ?? 0 : 0;
    } catch {
      closeCount = 0;
    }
    const nextCloseCount = closeCount + 1;
    const snoozeDays = nextCloseCount >= 2 ? 7 : 1;
    window.localStorage.setItem(
      WORK_NOTICE_STORAGE_KEY,
      JSON.stringify({
        noticeId: nextStep.noticeId,
        closeCount: nextCloseCount,
        snoozeUntil: addDaysIso(today, snoozeDays),
      }),
    );
    setHiddenNoticeId(nextStep.noticeId);
  }

  return (
    <div className="calendar-workbench">
      {shouldShowWorkNotice && (
        <div className={`work-notice ${nextStep.tone}`} role="status">
          <button className="work-notice-main" onClick={nextStep.onClick} title={nextStep.title}>
            <span>{nextStep.action}</span>
            <b>{nextStep.title}</b>
          </button>
          <button className="work-notice-close" onClick={closeWorkNotice} aria-label="关闭提醒" type="button">
            ×
          </button>
        </div>
      )}

      <section className="workbench-grid">
        <div className="calendar-panel">
          <FullCalendarSurface
            month={month}
            mobileRange={mobileCalendarRange}
            onMobileRangeChange={setMobileCalendarRange}
            activeGroups={activeGroups}
            rawGroupCounts={rawGroupCounts}
            onToggleGroup={onToggleGroup}
            reminders={reminders}
            selectedDate={selectedDate}
            onMonthVisible={(date) => onMonthChange(date.getMonth() - month.getMonth() + (date.getFullYear() - month.getFullYear()) * 12)}
            onDateClick={onSelectDate}
            onEventClick={openReminderDetail}
          />
        </div>

        <aside className="selected-panel">
          <div className="selected-head">
            <div>
              <span className="eyebrow">当前日期</span>
              <h3>{dateLabel(selectedDate)}</h3>
            </div>
            <span className="mobile-selected-count">未完成 {selectedPendingCount}</span>
            <div className="selected-actions">
              <button className="primary selected-add-todo" onClick={() => openTodoModal(selectedDate)}>
                +待办
              </button>
              <button
                className="ghost"
                onClick={async () => {
                  setCompletingDate(true);
                  try {
                    await onCompleteDate(selectedDate);
                  } finally {
                    setCompletingDate(false);
                  }
                }}
                disabled={selectedPendingCount === 0 || isCompletingDate}
              >
                {isCompletingDate ? "处理中" : "搞定今日"}
              </button>
            </div>
          </div>
          <ReminderCards
            reminders={selectedPendingReminders}
            emptyText="这一天没有未完成提醒"
            onComplete={onCompleteReminder}
          />
          {selectedCompletedCount > 0 && (
            <details className="completed-reminders">
              <summary>已完成 {selectedCompletedCount}</summary>
              <ReminderCards
                reminders={selectedCompletedReminders}
                emptyText="这一天没有已完成提醒"
                onComplete={onCompleteReminder}
              />
            </details>
          )}
          <button className="ghost selected-all-reminders" onClick={onGoReminders}>
            筛选提醒
          </button>
        </aside>
      </section>
      <div className="mobile-action-bar">
        <button className="primary" onClick={() => openTodoModal(selectedDate)}>新增待办</button>
        <button
          className="ghost"
          onClick={async () => {
            setCompletingDate(true);
            try {
              await onCompleteDate(selectedDate);
            } finally {
              setCompletingDate(false);
            }
          }}
          disabled={selectedPendingCount === 0 || isCompletingDate}
        >
          {isCompletingDate ? "处理中" : "搞定今日"}
        </button>
      </div>
      {isTodoModalOpen && (
        <TodoDialog
          initialDate={todoDate}
          onClose={() => setTodoModalOpen(false)}
          onSubmit={async (input) => {
            await onCreateTodo(input);
            setTodoModalOpen(false);
          }}
        />
      )}
      {detailError && <p className="inline-error">{detailError}</p>}
      {detail && <ReminderDetailDialog detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function FullCalendarSurface({
  month,
  mobileRange,
  onMobileRangeChange,
  activeGroups,
  rawGroupCounts,
  onToggleGroup,
  reminders,
  selectedDate,
  onMonthVisible,
  onDateClick,
  onEventClick,
}: {
  month: Date;
  mobileRange: "week" | "month";
  onMobileRangeChange: (range: "week" | "month") => void;
  activeGroups: Record<ReminderItem["group"], boolean>;
  rawGroupCounts: Record<ReminderItem["group"], number>;
  onToggleGroup: (group: ReminderItem["group"]) => void;
  reminders: ReminderItem[];
  selectedDate: string;
  onMonthVisible: (date: Date) => void;
  onDateClick: (date: string) => void;
  onEventClick: (item: ReminderItem) => void;
}) {
  const isMobile = useMediaQuery("(max-width: 760px)");
  const calendarRef = useRef<FullCalendar | null>(null);
  const [calendarTitle, setCalendarTitle] = useState(monthLabel(month));
  const calendarEvents = useMemo<EventInput[]>(
    () =>
      reminders.map((item) => ({
        id: item.id,
        title: reminderCardTitle(item),
        start: item.reminderDate,
        allDay: true,
        backgroundColor: groupColor(item.group),
        borderColor: groupColor(item.group),
        classNames: [`event-${item.group}`, item.reminderDate === selectedDate ? "event-selected" : ""],
        extendedProps: { group: item.group, fullTitle: item.title, reminder: item },
      })),
    [reminders, selectedDate],
  );

  return (
    <div className="full-calendar-shell">
      {!isMobile && (
        <div className="calendar-toolbar">
          <div className="calendar-toolbar-main">
            <strong>{calendarTitle}</strong>
            <div className="filter-pills calendar-filter-pills" aria-label="提醒分组筛选">
              {(["birthday", "policy_renewal", "manual_todo"] as const).map((group) => (
                <button
                  key={group}
                  className={`filter-pill ${group} ${activeGroups[group] ? "active" : ""}`}
                  onClick={() => onToggleGroup(group)}
                  aria-pressed={activeGroups[group]}
                  type="button"
                >
                  <span>{groupLabels[group]}</span>
                  <b>{rawGroupCounts[group]}</b>
                </button>
              ))}
            </div>
          </div>
          <div className="calendar-nav-controls">
            <button className="calendar-nav-button" onClick={() => calendarRef.current?.getApi().prev()} aria-label="上月" type="button">‹</button>
            <button className="calendar-today-button" onClick={() => calendarRef.current?.getApi().today()} type="button">今天</button>
            <button className="calendar-nav-button" onClick={() => calendarRef.current?.getApi().next()} aria-label="下月" type="button">›</button>
          </div>
        </div>
      )}
      {isMobile && (
        <div className="mobile-calendar-toolbar">
          <div className="mobile-calendar-controls">
            <div className="mobile-calendar-range" aria-label="日历范围">
              <button
                className={mobileRange === "week" ? "active" : ""}
                onClick={() => onMobileRangeChange("week")}
                type="button"
              >
                本周
              </button>
              <button
                className={mobileRange === "month" ? "active" : ""}
                onClick={() => onMobileRangeChange("month")}
                type="button"
              >
                本月
              </button>
            </div>
            <button
              className="mobile-calendar-nav"
              onClick={() => calendarRef.current?.getApi().prev()}
              aria-label="上一段"
              type="button"
            >
              ‹
            </button>
            <button
              className="mobile-calendar-today"
              onClick={() => calendarRef.current?.getApi().today()}
              type="button"
            >
              今天
            </button>
            <button
              className="mobile-calendar-nav"
              onClick={() => calendarRef.current?.getApi().next()}
              aria-label="下一段"
              type="button"
            >
              ›
            </button>
          </div>
        </div>
      )}
      <FullCalendar
        ref={calendarRef}
        key={isMobile ? `mobile-${mobileRange}` : "desktop-month"}
        plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
        initialDate={isMobile ? selectedDate : month}
        initialView={isMobile && mobileRange === "week" ? "dayGridWeek" : "dayGridMonth"}
        locale="zh-cn"
        firstDay={0}
        height="auto"
        fixedWeekCount={false}
        dayMaxEvents={isMobile ? (mobileRange === "week" ? 2 : 1) : 3}
        events={calendarEvents}
        headerToolbar={false}
        dayHeaderContent={(info) => {
          if (!isMobile) return undefined;
          const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
          return (
            <span className="mobile-day-head">
              <b>{info.date.getDate()}</b>
              <small>{weekdays[info.date.getDay()]}</small>
            </span>
          );
        }}
        buttonText={{ today: "今天", month: "月", list: "列表" }}
        noEventsContent="暂无提醒"
        dateClick={(info) => onDateClick(info.dateStr)}
        eventClick={(info: EventClickArg) => {
          const item = info.event.extendedProps.reminder as ReminderItem | undefined;
          if (item) onEventClick(item);
        }}
        datesSet={(info: DatesSetArg) => {
          setCalendarTitle(isMobile ? shortMonthLabel(info.view.currentStart) : monthLabel(info.view.currentStart));
          if (!isMobile) onMonthVisible(startOfMonth(info.view.currentStart));
        }}
        eventContent={(info: EventContentArg) => (
          <span className="fc-reminder-event" aria-label={info.event.title}>
            <i aria-hidden="true" />
            <b>{info.event.title}</b>
          </span>
        )}
      />
    </div>
  );
}

function TodoDialog({
  initialDate,
  initialTitle = "",
  initialIsKey = false,
  title: dialogTitle = "新增待办",
  onClose,
  onSubmit,
}: {
  initialDate: string;
  initialTitle?: string;
  initialIsKey?: boolean;
  title?: string;
  onClose: () => void;
  onSubmit: (input: { title: string; reminderDate: string; isKey: boolean }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [reminderDate, setReminderDate] = useState(initialDate);
  const [isKey, setIsKey] = useState(initialIsKey);
  const [isSaving, setSaving] = useState(false);

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isSaving) return;
    setSaving(true);
    try {
      await onSubmit({ title: trimmedTitle, reminderDate, isKey });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="todo-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="todo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="todo-dialog-head">
          <div>
            <span className="eyebrow">待办</span>
            <h3 id="todo-dialog-title">{dialogTitle}</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <label>
          标题
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="输入待办内容"
            autoFocus
          />
        </label>
        <label>
          日期
          <input
            type="date"
            value={reminderDate}
            onChange={(event) => setReminderDate(event.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={isKey}
            onChange={(event) => setIsKey(event.target.checked)}
          />
          标记关键
        </label>
        <div className="todo-dialog-actions">
          <button className="ghost" onClick={onClose}>取消</button>
          <button className="primary" onClick={submit} disabled={!title.trim() || isSaving}>
            {isSaving ? "保存中" : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ReminderCards({
  reminders,
  emptyText,
  onComplete,
}: {
  reminders: ReminderItem[];
  emptyText: string;
  onComplete?: (id: string) => Promise<void>;
}) {
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, ReminderDetail>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  async function toggleRenewalDetail(item: ReminderItem) {
    if (item.group !== "policy_renewal") {
      return;
    }
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (detailsById[item.id]) {
      return;
    }
    setLoadingDetailId(item.id);
    try {
      const detail = await getReminderDetail(item.id);
      setDetailsById((current) => ({ ...current, [item.id]: detail }));
    } finally {
      setLoadingDetailId(null);
    }
  }

  if (reminders.length === 0) {
    return <p className="empty-state">{emptyText}</p>;
  }

  return (
    <div className="reminder-cards">
      {reminders.map((item) => (
        <article key={item.id} className={`reminder-card ${item.group} ${item.status === "completed" ? "completed" : ""}`}>
          <div
            className={item.group === "policy_renewal" ? "reminder-card-main can-expand" : "reminder-card-main"}
            role={item.group === "policy_renewal" ? "button" : undefined}
            tabIndex={item.group === "policy_renewal" ? 0 : undefined}
            aria-expanded={item.group === "policy_renewal" ? expandedId === item.id : undefined}
            onClick={() => toggleRenewalDetail(item)}
            onKeyDown={(event) => {
              if (item.group !== "policy_renewal") return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleRenewalDetail(item);
              }
            }}
          >
            <h4>{reminderCardTitle(item)}</h4>
            {item.group === "policy_renewal" && (
              <small>{expandedId === item.id ? "收起续期详情" : "查看续期详情"}</small>
            )}
            {expandedId === item.id && item.group === "policy_renewal" && (
              <PolicyRenewalDetail
                detail={detailsById[item.id]}
                fallback={item.policySummary}
                isLoading={loadingDetailId === item.id}
              />
            )}
          </div>
          <div className="reminder-card-actions">
            {item.isKey && <b>关键</b>}
            {onComplete && (
              <button
                onClick={async (event) => {
                  event.stopPropagation();
                  if (item.status === "completed") {
                    return;
                  }
                  setCompletingId(item.id);
                  try {
                    await onComplete(item.id);
                  } finally {
                    setCompletingId(null);
                  }
                }}
                disabled={completingId === item.id || item.status === "completed"}
              >
                {completingId === item.id ? "处理中" : item.status === "completed" ? "已完成" : "完成"}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function PolicyRenewalDetail({
  detail,
  fallback,
  isLoading,
}: {
  detail?: ReminderDetail;
  fallback?: ReminderItem["policySummary"];
  isLoading: boolean;
}) {
  const policy = detail?.policy ?? fallback;
  if (isLoading && !policy) {
    return <p className="renewal-detail-loading">正在读取保单详情</p>;
  }
  if (!policy) {
    return <p className="renewal-detail-loading">暂无可展示的保单详情</p>;
  }

  const rows = [
    ["产品", policy.productName],
    ["保单号", policy.policyNumber],
    ["保费", formatMoney(policy.premium)],
    ["保险公司", policy.insurerName],
    ["缴费方式", policy.paymentMethod],
    ["缴费期间", policy.paymentPeriodRaw],
    ["生效日", policy.effectiveDate],
    ["下次续期", policy.nextRenewalDate],
    ["缴费结束", policy.finalPaymentYear ? `${policy.finalPaymentYear}年` : undefined],
  ].filter(([, value]) => value);

  return (
    <dl className="renewal-detail">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ImportView({
  onImported,
  onOpenDashboard,
  onOpenPending,
  onRestored,
}: {
  onImported: (summary: Awaited<ReturnType<typeof importWorkbooks>>) => Promise<void>;
  onOpenDashboard: () => void;
  onOpenPending: () => void;
  onRestored: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysisResult | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProviderId>("deepseek");
  const [aiKey, setAiKey] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [lastSummary, setLastSummary] = useState<Awaited<ReturnType<typeof importWorkbooks>> | null>(null);
  const [backups, setBackups] = useState<DataBackupItem[]>([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const hasImportSource = files.length > 0;
  const hasImportableTables = Boolean(
    analysis && analysis.summary.customerTables + analysis.summary.policyTables > 0,
  );

  async function buildImportInput() {
    const providerId = aiProvider;
    return {
      files: await Promise.all(files.map(fileToUpload)),
      ai: useAi
        ? {
            enabled: true,
            providerId,
            apiKey: aiKey.trim() || undefined,
            useSavedKey: true,
          }
        : { enabled: false },
    };
  }

  async function refreshBackups() {
    const result = await listBackups();
    setBackups(result.items);
    setSelectedBackup((current) =>
      result.items.some((item) => item.fileName === current)
        ? current
        : result.items[0]?.fileName || "",
    );
  }

  async function fileToUpload(file: File) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    const chunks: string[] = [];
    for (let index = 0; index < bytes.length; index += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.slice(index, index + chunkSize)));
    }
    return {
      fileName: file.name,
      base64: window.btoa(chunks.join("")),
    };
  }

  useEffect(() => {
    refreshBackups().catch((error: unknown) => setBackupMessage(String(error)));
    getAiSettings()
      .then((settings) => {
        setAiSettings(settings);
        setAiProvider(settings.providerId);
      })
      .catch((error: unknown) => setBackupMessage(String(error)));
  }, []);

  async function analyzeSelectedFiles() {
    setAnalyzing(true);
    setAnalysis(null);
    setLastSummary(null);
    try {
      if (useAi && aiKey.trim()) {
        const settings = await saveAiSettings({ providerId: aiProvider, apiKey: aiKey.trim() });
        setAiSettings(settings);
        setAiKey("");
      }
      const result = await analyzeImport(await buildImportInput());
      setAnalysis(result);
      if (result.summary.unknownTables > 0) {
        setBackupMessage("有表格暂未识别，可以填写 API Key 后再分析一次。");
      } else if (result.summary.familyTables > 0) {
        setBackupMessage("家庭保障字段已记录，本次只导入客户和保单提醒。");
      } else {
        setBackupMessage("字段已识别，可以确认导入。");
      }
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <h2>导入</h2>
      <p className="section-note">上传客户、保单或家庭保障表，先识别字段，再确认导入。</p>
      <div className="import-grid import-grid-single">
        <label className="file-picker">
          上传文件
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
              setAnalysis(null);
              setLastSummary(null);
            }}
          />
          <span>{files.length > 0 ? files.map((file) => file.name).join("、") : "选择 Excel 或 CSV"}</span>
        </label>
      </div>
      <section className="ai-import-options" aria-label="大模型字段识别">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={useAi}
            onChange={(event) => setUseAi(event.target.checked)}
          />
          <span>表头不标准时，用大模型识别字段</span>
        </label>
        {useAi && (
          <div className="ai-import-grid">
            <label>
              模型
              <select
                value={aiProvider}
                onChange={(event) => setAiProvider(event.target.value as AiProviderId)}
              >
                {(aiSettings?.providers ?? []).map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API Key
              <input
                type="password"
                value={aiKey}
                placeholder={aiSettings?.apiKeyConfigured ? "已保存，可留空" : "粘贴后会保存在本机"}
                onChange={(event) => setAiKey(event.target.value)}
              />
            </label>
          </div>
        )}
      </section>
      <div className="import-actions">
        <button
          className="primary"
          disabled={analyzing || !hasImportSource}
          onClick={analyzeSelectedFiles}
        >
          {analyzing ? "分析中" : "分析文件"}
        </button>
        <button
          className="ghost"
          disabled={loading || !hasImportSource || !hasImportableTables}
          onClick={async () => {
            setLoading(true);
            setLastSummary(null);
            try {
              const backup = await createBackup("auto-before-import");
              setBackupMessage(`已自动备份：${backup.backup.fileName}`);
              const summary = await importWorkbooks(await buildImportInput());
              setLastSummary(summary);
              await refreshBackups();
              await onImported(summary);
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? "导入中" : "确认导入"}
        </button>
      </div>
      {analysis && <ImportAnalysisSummary analysis={analysis} />}
      {lastSummary && (
        <section className="import-result">
          <div>
            <span>导入客户</span>
            <strong>{lastSummary.persistedCustomers}</strong>
          </div>
          <div>
            <span>导入保单</span>
            <strong>{lastSummary.persistedPolicies}</strong>
          </div>
          <div>
            <span>生成提醒</span>
            <strong>{lastSummary.generatedReminders}</strong>
          </div>
          <div className={lastSummary.pendingConfirmations > 0 ? "needs-review" : ""}>
            <span>待确认</span>
            <strong>{lastSummary.pendingConfirmations}</strong>
          </div>
          <p>
            {lastSummary.pendingConfirmations > 0
              ? "建议先处理待确认事项，确认缺失生日、生效日或字段变化后，提醒会更准确。"
              : "导入完成，可以回到工作台查看今天和本月的提醒。"}
          </p>
          <div className="import-result-actions">
            {lastSummary.pendingConfirmations > 0 && (
              <button className="primary" onClick={onOpenPending}>
                处理待确认
              </button>
            )}
            <button className="ghost" onClick={onOpenDashboard}>
              回工作台
            </button>
          </div>
        </section>
      )}
      <section className="backup-panel">
        <div className="backup-head">
          <h3>备份 / 恢复</h3>
        </div>
        <div className="backup-actions">
          <button
            className="primary"
            disabled={backupLoading}
            onClick={async () => {
              setBackupLoading(true);
              try {
                await createBackup("manual");
                setBackupMessage("已备份");
                await refreshBackups();
              } finally {
                setBackupLoading(false);
              }
            }}
          >
            {backupLoading ? "处理中" : "备份"}
          </button>
          <div className="restore-action">
            <select
              aria-label="选择备份"
              value={selectedBackup}
              onChange={(event) => setSelectedBackup(event.target.value)}
              disabled={backupLoading || backups.length === 0}
            >
              <option value="">选择备份</option>
              {backups.map((item) => (
                <option key={item.fileName} value={item.fileName}>
                  {backupOptionLabel(item)}
                </option>
              ))}
            </select>
            <button
              className="ghost"
              disabled={backupLoading || !selectedBackup}
              onClick={async () => {
                if (!selectedBackup || !window.confirm("恢复后会覆盖当前数据，继续？")) return;
                setBackupLoading(true);
                try {
                  await restoreBackup(selectedBackup);
                  setBackupMessage("已恢复");
                  await onRestored();
                } finally {
                  setBackupLoading(false);
                }
              }}
            >
              恢复
            </button>
          </div>
        </div>
        {backupMessage && <p className="backup-message">{backupMessage}</p>}
      </section>
    </>
  );
}

function importKindLabel(kind: ImportAnalysisResult["files"][number]["tables"][number]["tableKind"]) {
  if (kind === "customer") return "客户";
  if (kind === "policy") return "保单";
  if (kind === "family") return "家庭保障";
  return "待确认";
}

function ImportAnalysisSummary({ analysis }: { analysis: ImportAnalysisResult }) {
  const tables = analysis.files.flatMap((file) => file.tables);
  return (
    <section className="analysis-panel">
      <div className="analysis-head">
        <strong>
          识别到客户 {analysis.summary.customerTables} 张，保单 {analysis.summary.policyTables} 张，家庭保障 {analysis.summary.familyTables} 张
        </strong>
        <span>{analysis.summary.aiUsed ? "已用大模型辅助" : "本地规则识别"}</span>
      </div>
      <div className="analysis-list">
        {tables.slice(0, 8).map((table) => (
          <div key={`${table.fileName}-${table.sheetName}`} className={table.tableKind === "unknown" ? "needs-review" : ""}>
            <span>{importKindLabel(table.tableKind)}</span>
            <strong>{table.sheetName}</strong>
            <p>
              {table.rowCount} 行，匹配 {table.mappings.length} 个字段
              {table.missingImportFields.length > 0
                ? `，缺 ${table.missingImportFields.join("、")}`
                : ""}
            </p>
          </div>
        ))}
      </div>
      {tables.length > 8 && <p className="analysis-note">其余 {tables.length - 8} 张表已记录。</p>}
      {analysis.summary.familyTables > 0 && (
        <p className="analysis-note">家庭保障字段会先记录下来，后续用于客户等级和家庭保障视图。</p>
      )}
    </section>
  );
}

function ReminderList({
  reminders,
  onComplete,
  onReopen,
  onUpdateManual,
  onDelete,
}: {
  reminders: ReminderItem[];
  onComplete: (id: string) => Promise<void>;
  onReopen: (id: string) => Promise<void>;
  onUpdateManual: (
    id: string,
    input: { title: string; reminderDate: string; isKey: boolean },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  type ReminderFilter = "pending" | "completed";
  const [filter, setFilter] = useState<ReminderFilter>("pending");
  const [query, setQuery] = useState("");
  const filterItems: Array<{ key: ReminderFilter; label: string }> = [
    { key: "pending", label: "未完成" },
    { key: "completed", label: "已完成" },
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredReminders = reminders.filter((item) => {
    if (filter === "pending") return item.status === "pending";
    return item.status === "completed";
  }).filter((item) => {
    if (!normalizedQuery) return true;
    return [
      item.title,
      groupLabels[item.group],
      item.status === "completed" ? "已完成" : "未完成",
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  return (
    <>
      <h2>提醒</h2>
      <div className="list-toolbar">
        <div className="segmented-filter" aria-label="提醒筛选">
          {filterItems.map((item) => (
            <button
              key={item.key}
              className={filter === item.key ? "active" : ""}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span>{filteredReminders.length} / {reminders.length} 条</span>
      </div>
      <label className="list-search">
        搜索提醒
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入客户名、生日、续期或待办"
        />
      </label>
      <ReminderTable
        reminders={filteredReminders}
        onComplete={onComplete}
        onReopen={onReopen}
        onUpdateManual={onUpdateManual}
        onDelete={onDelete}
      />
    </>
  );
}

function ReminderTable({
  reminders,
  compact = false,
  onComplete,
  onReopen,
  onUpdateManual,
  onDelete,
}: {
  reminders: ReminderItem[];
  compact?: boolean;
  onComplete?: (id: string) => Promise<void>;
  onReopen?: (id: string) => Promise<void>;
  onUpdateManual?: (
    id: string,
    input: { title: string; reminderDate: string; isKey: boolean },
  ) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [pendingDelete, setPendingDelete] = useState<ReminderItem | null>(null);
  const [editingManual, setEditingManual] = useState<ReminderItem | null>(null);
  const [detail, setDetail] = useState<ReminderDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [isDeleting, setDeleting] = useState(false);

  function requestDelete(item: ReminderItem) {
    setPendingDelete(item);
  }

  async function openDetail(item: ReminderItem) {
    setDetailError("");
    setLoadingDetailId(item.id);
    try {
      setDetail(await getReminderDetail(item.id));
    } catch (error) {
      setDetailError(String(error));
    } finally {
      setLoadingDetailId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !onDelete) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {reminders.length === 0 ? (
        <p className="empty-state">当前筛选下没有提醒</p>
      ) : (
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>分组</th>
            <th>标题</th>
            {!compact && <th>状态</th>}
            {!compact && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {reminders.map((item) => (
            <tr key={item.id}>
              <td>{item.reminderDate}</td>
              <td>{groupLabels[item.group]}</td>
              <td>{item.title}</td>
              {!compact && <td>{item.status === "completed" ? "已完成" : "未完成"}</td>}
              {!compact && (
                <td>
                  {(item.customerId || item.policyId) && (
                    <button onClick={() => openDetail(item)} disabled={loadingDetailId === item.id}>
                      {loadingDetailId === item.id ? "加载中" : "详情"}
                    </button>
                  )}
                  {item.status === "pending" && (
                    <button onClick={() => onComplete?.(item.id)}>完成</button>
                  )}
                  {item.status === "completed" && (
                    <button onClick={() => onReopen?.(item.id)}>恢复</button>
                  )}
                  {item.group === "manual_todo" && (
                    <>
                      <button onClick={() => setEditingManual(item)}>编辑</button>
                      <button className="danger-action" onClick={() => requestDelete(item)}>
                        删除
                      </button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {detailError && <p className="inline-error">{detailError}</p>}
      {detail && <ReminderDetailDialog detail={detail} onClose={() => setDetail(null)} />}
      {pendingDelete && (
        <div className="todo-dialog-backdrop" role="presentation" onClick={() => setPendingDelete(null)}>
          <section
            className="todo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="todo-dialog-head">
              <div>
                <span className="eyebrow">删除确认</span>
                <h3 id="delete-dialog-title">删除手动待办</h3>
              </div>
              <button className="icon-button" onClick={() => setPendingDelete(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <p className="delete-dialog-title">{pendingDelete.title}</p>
            <div className="todo-dialog-actions">
              <button className="ghost" onClick={() => setPendingDelete(null)} disabled={isDeleting}>
                取消
              </button>
              <button className="primary danger-primary" onClick={confirmDelete} disabled={isDeleting}>
                {isDeleting ? "删除中" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      )}
      {editingManual && (
        <TodoDialog
          initialDate={editingManual.reminderDate}
          initialTitle={editingManual.title}
          initialIsKey={editingManual.isKey}
          title="编辑待办"
          onClose={() => setEditingManual(null)}
          onSubmit={async (input) => {
            await onUpdateManual?.(editingManual.id, input);
            setEditingManual(null);
          }}
        />
      )}
    </>
  );
}

function valueOrDash(value: string | number | undefined) {
  if (value === undefined || value === "") return "-";
  return String(value);
}

function maskPhone(value: string | undefined) {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return value;
  return `${digits.slice(0, 3)}****${digits.slice(7)}`;
}

function maskIdNumber(value: string | undefined) {
  if (!value) return undefined;
  if (value.includes("*")) return value;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function DetailRow({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{valueOrDash(value)}</dd>
    </>
  );
}

function ReminderDetailDialog({
  detail,
  onClose,
}: {
  detail: ReminderDetail;
  onClose: () => void;
}) {
  const { reminder, customer, policy, applicantCustomer, insuredCustomer } = detail;

  return (
    <div className="todo-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="todo-dialog detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="todo-dialog-head">
          <div>
            <span className="eyebrow">详情</span>
            <h3 id="reminder-detail-title">提醒详情</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <section className="detail-section">
          <h4>提醒</h4>
          <dl>
            <DetailRow label="标题" value={reminder.title} />
            <DetailRow label="日期" value={reminder.reminderDate} />
            <DetailRow label="分组" value={groupLabels[reminder.group]} />
            <DetailRow label="状态" value={reminder.status === "completed" ? "已完成" : "未完成"} />
          </dl>
        </section>

        <section className="detail-section">
          <h4>客户</h4>
          {customer ? (
            <dl>
              <DetailRow label="姓名" value={customer.name} />
              <DetailRow label="生日" value={customer.birthDate} />
              <DetailRow label="电话" value={maskPhone(customer.phone)} />
              <DetailRow
                label="证件号"
                value={customer.maskedIdNumber ?? maskIdNumber(customer.fullIdNumber)}
              />
            </dl>
          ) : (
            <p className="empty-detail">暂无关联客户</p>
          )}
        </section>

        <section className="detail-section">
          <h4>保单</h4>
          {policy ? (
            <dl>
              <DetailRow label="保单号" value={policy.policyNumber} />
              <DetailRow label="产品" value={policy.productName} />
              <DetailRow label="保险公司" value={policy.insurerName} />
              <DetailRow label="保费" value={formatMoney(policy.premium)} />
              <DetailRow label="缴费期间" value={policy.paymentPeriodRaw} />
              <DetailRow label="缴费方式" value={policy.paymentMethod} />
              <DetailRow label="生效日" value={policy.effectiveDate} />
              <DetailRow label="下次续期" value={policy.nextRenewalDate} />
              <DetailRow
                label="缴费结束"
                value={policy.finalPaymentYear ? `${policy.finalPaymentYear}年` : undefined}
              />
              <DetailRow label="投保人" value={applicantCustomer?.name ?? policy.applicantName} />
              <DetailRow label="被保人" value={insuredCustomer?.name ?? policy.insuredName} />
            </dl>
          ) : (
            <p className="empty-detail">暂无关联保单</p>
          )}
        </section>
      </section>
    </div>
  );
}

const reasonLabels: Record<string, string> = {
  unsupported_payment_period: "缴费期间需确认",
  missing_required_field: "缺少关键字段",
  identity_incomplete: "身份信息不完整",
  strict_match_failed: "身份匹配失败",
  key_field_changed: "关键字段变化",
};

function PendingList({
  items,
  onResolve,
}: {
  items: PendingItem[];
  onResolve: (
    id: string,
    input: { note?: string; correction?: PendingCorrectionInput },
  ) => Promise<void>;
}) {
  const [pendingResolve, setPendingResolve] = useState<PendingItem | null>(null);
  const [note, setNote] = useState("");
  const [correction, setCorrection] = useState<PendingCorrectionInput>({});
  const [isResolving, setResolving] = useState(false);
  const [query, setQuery] = useState("");

  function stringPayload(item: PendingItem, key: string): string {
    const value = item.payload[key];
    return typeof value === "string" ? value : "";
  }

  function keyChanges(item: PendingItem): KeyFieldChangeItem[] {
    const changes = item.payload.changes;
    if (!Array.isArray(changes)) {
      return [];
    }
    return changes.filter((change): change is KeyFieldChangeItem => {
      if (!change || typeof change !== "object") {
        return false;
      }
      const candidate = change as Partial<KeyFieldChangeItem>;
      return (
        typeof candidate.field === "string" &&
        typeof candidate.label === "string" &&
        (typeof candidate.incoming === "string" || typeof candidate.incoming === "number")
      );
    });
  }

  function pendingGuidance(item: PendingItem): string {
    if (item.reason === "key_field_changed") {
      return "导入文件里的关键字段和本地记录不同，确认后会采用这次导入的新值并重新生成相关提醒。";
    }
    if (item.reason === "missing_required_field") {
      if (typeof item.payload.customerId === "string") {
        return "这通常是客户生日缺失。补上生日后，生日提醒和按周岁缴费的续期提醒才能准确计算。";
      }
      if (typeof item.payload.policyId === "string") {
        return "这通常是保单生效日或缴费期间缺失。补齐后，系统会重新计算续期提醒。";
      }
      return "这条记录缺少必要信息，补齐后系统才能稳定生成提醒。";
    }
    if (item.reason === "unsupported_payment_period") {
      return "请把缴费期间改成明确格式，例如 10年、20年、60周岁。系统不会从产品名里猜。";
    }
    if (item.reason === "strict_match_failed") {
      return "客户姓名或证件号不能严格匹配，系统先不自动合并，避免把不同客户混在一起。";
    }
    if (item.reason === "identity_incomplete") {
      return "客户身份信息不完整，建议补齐姓名、证件号或生日后再继续。";
    }
    return "请人工确认这条数据是否可用，再决定修正或标记已处理。";
  }

  function beginResolve(item: PendingItem) {
    setPendingResolve(item);
    setNote("");
    setCorrection(
      item.reason === "key_field_changed"
        ? {}
        : {
            birthDate: stringPayload(item, "birthDate"),
            effectiveDate: stringPayload(item, "effectiveDate"),
            paymentPeriodRaw: stringPayload(item, "paymentPeriodRaw"),
          },
    );
  }

  function cleanCorrection(input: PendingCorrectionInput): PendingCorrectionInput | undefined {
    const next = {
      birthDate: input.birthDate?.trim(),
      effectiveDate: input.effectiveDate?.trim(),
      paymentPeriodRaw: input.paymentPeriodRaw?.trim(),
    };
    const compact = Object.fromEntries(
      Object.entries(next).filter(([, value]) => value),
    ) as PendingCorrectionInput;
    return Object.keys(compact).length > 0 ? compact : undefined;
  }

  function closeDialog() {
    setPendingResolve(null);
    setNote("");
    setCorrection({});
  }

  async function confirmResolve() {
    if (!pendingResolve) {
      return;
    }
    setResolving(true);
    try {
      await onResolve(pendingResolve.id, {
        note: note.trim() || undefined,
        correction: cleanCorrection(correction),
      });
      closeDialog();
    } finally {
      setResolving(false);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (!normalizedQuery) return true;
    return [
      reasonLabels[item.reason] ?? item.reason,
      item.title,
      item.detail,
      pendingGuidance(item),
      JSON.stringify(item.payload),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  return (
    <>
      <h2>待确认</h2>
      {items.length > 0 && (
        <div className="list-toolbar">
          <label className="list-search">
            搜索待确认
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入客户名、产品名、原因或字段"
            />
          </label>
          <span>{visibleItems.length} / {items.length} 条</span>
        </div>
      )}
      {items.length === 0 ? (
        <p className="empty-state">没有待确认事项</p>
      ) : visibleItems.length === 0 ? (
        <p className="empty-state">当前搜索下没有待确认事项</p>
      ) : (
        <div className="pending-list">
          {visibleItems.map((item) => {
            const changes = keyChanges(item);
            return (
              <article className="pending-card" key={item.id}>
                <div>
                  <span>{reasonLabels[item.reason] ?? item.reason}</span>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                  <p className="pending-guidance">{pendingGuidance(item)}</p>
                </div>
                <button className="ghost" onClick={() => beginResolve(item)}>
                  {item.reason === "key_field_changed" ? "确认采用导入值" : "标记已处理"}
                </button>
                {changes.length > 0 && (
                  <div className="change-list">
                    {changes.map((change) => (
                      <div className="change-row" key={change.field}>
                        <strong>{change.label}</strong>
                        <span>{change.current ?? "空"}</span>
                        <span>{change.incoming}</span>
                      </div>
                    ))}
                  </div>
                )}
                <details>
                  <summary>查看原始信息</summary>
                  <pre>{JSON.stringify(item, null, 2)}</pre>
                </details>
              </article>
            );
          })}
        </div>
      )}
      {pendingResolve && (
        <div className="todo-dialog-backdrop" role="presentation" onClick={closeDialog}>
          <section
            className="todo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="todo-dialog-head">
              <div>
                <span className="eyebrow">确认事项</span>
                <h3 id="resolve-dialog-title">处理待确认</h3>
              </div>
              <button className="icon-button" onClick={closeDialog} aria-label="关闭">
                ×
              </button>
            </div>
            <p className="delete-dialog-title">{pendingResolve.title}</p>
            {pendingResolve.reason === "key_field_changed" && (
              <div className="change-list dialog-change-list">
                {keyChanges(pendingResolve).map((change) => (
                  <div className="change-row" key={change.field}>
                    <strong>{change.label}</strong>
                    <span>{change.current ?? "空"}</span>
                    <span>{change.incoming}</span>
                  </div>
                ))}
              </div>
            )}
            {pendingResolve.reason !== "key_field_changed" &&
              typeof pendingResolve.payload.customerId === "string" && (
              <label>
                出生日期
                <input
                  type="date"
                  value={correction.birthDate ?? ""}
                  onChange={(event) =>
                    setCorrection((current) => ({ ...current, birthDate: event.target.value }))
                  }
                />
              </label>
            )}
            {pendingResolve.reason !== "key_field_changed" &&
              typeof pendingResolve.payload.policyId === "string" && (
              <>
                <label>
                  缴费期间
                  <input
                    value={correction.paymentPeriodRaw ?? ""}
                    onChange={(event) =>
                      setCorrection((current) => ({
                        ...current,
                        paymentPeriodRaw: event.target.value,
                      }))
                    }
                    placeholder="例如：10年 或 60周岁"
                  />
                </label>
                <label>
                  生效日期
                  <input
                    type="date"
                    value={correction.effectiveDate ?? ""}
                    onChange={(event) =>
                      setCorrection((current) => ({
                        ...current,
                        effectiveDate: event.target.value,
                      }))
                    }
                  />
                </label>
              </>
            )}
            <label>
              处理备注
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：已人工确认，暂不需要提醒"
              />
            </label>
            <div className="todo-dialog-actions">
              <button className="ghost" onClick={closeDialog} disabled={isResolving}>
                取消
              </button>
              <button className="primary" onClick={confirmResolve} disabled={isResolving}>
                {isResolving
                  ? "处理中"
                  : pendingResolve.reason === "key_field_changed"
                    ? "确认采用导入值"
                    : "确认处理"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ManualTodo({ onCreated }: { onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [reminderDate, setReminderDate] = useState(todayIso());
  const [isKey, setIsKey] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const canSubmit = Boolean(title.trim() && reminderDate && !isSaving);

  return (
    <>
      <h2>手动待办</h2>
      <label>
        标题
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：联系王姐确认续期"
        />
      </label>
      <label>
        日期
        <input
          type="date"
          value={reminderDate}
          onChange={(e) => setReminderDate(e.target.value)}
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={isKey} onChange={(e) => setIsKey(e.target.checked)} />
        标记关键
      </label>
      <button
        className="primary"
        disabled={!canSubmit}
        onClick={async () => {
          if (!canSubmit) return;
          setSaving(true);
          try {
            await createTodo({ title: title.trim(), reminderDate, isKey });
            setTitle("");
            setIsKey(false);
            await onCreated();
          } finally {
            setSaving(false);
          }
        }}
      >
        {isSaving ? "保存中" : "新增待办"}
      </button>
    </>
  );
}

function FeishuAgentGuide() {
  return (
    <div className="agent-sync-guide">
      <section className="agent-sync-brief">
        <h4>交给 AI 助手同步</h4>
        <p>
          这里不让用户手动填 token 或配置表结构。请让 WorkBuddy、Codex 这类 AI 助手在本机通过
          lark-cli 操作飞书。
        </p>
      </section>

      <section className="agent-sync-command" aria-label="给 AI 助手的指令">
        <span>复制给 AI 助手</span>
        <p>
          请检查本机 lark-cli 授权，用我提供的飞书多维表格链接同步 AI保顾问的客户、保单和提醒；
          先给我同步计划，我确认后再执行。
        </p>
      </section>

      <div className="agent-sync-flow">
        <article>
          <b>1</b>
          <div>
            <h4>先确认权限</h4>
            <p>检查本机 lark-cli 是否已登录；飞书多维表格必须可编辑。</p>
          </div>
        </article>
        <article>
          <b>2</b>
          <div>
            <h4>先出同步计划</h4>
            <p>列出会写入哪些表、多少条客户、保单、提醒；不要直接执行。</p>
          </div>
        </article>
        <article>
          <b>3</b>
          <div>
            <h4>确认后再写入</h4>
            <p>用户确认后，通过 lark-cli 写入飞书；完成后报告新增、更新、跳过和失败。</p>
          </div>
        </article>
      </div>

      <section className="agent-sync-rules">
        <h4>边界</h4>
        <ul>
          <li>不要展示完整证件号、手机号或飞书授权信息。</li>
          <li>不要把待确认数据当成已确认客户直接同步。</li>
          <li>失败时说人话：缺授权、没编辑权限、链接不对，或网络失败。</li>
        </ul>
      </section>
    </div>
  );
}

function parseFeishuBaseToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const tokenFromLink = trimmed.match(/\bapp[A-Za-z0-9_]+\b/);
  if (tokenFromLink) {
    return tokenFromLink[0];
  }
  try {
    const url = new URL(trimmed);
    const tokenFromBasePath = url.pathname.match(/\/base\/([A-Za-z0-9_-]+)/);
    if (tokenFromBasePath?.[1]) {
      return tokenFromBasePath[1];
    }
  } catch {
    const tokenFromLooseBasePath = trimmed.match(/\/base\/([A-Za-z0-9_-]+)/);
    if (tokenFromLooseBasePath?.[1]) {
      return tokenFromLooseBasePath[1];
    }
  }
  return /^https?:\/\//.test(trimmed) ? "" : trimmed;
}

function FeishuSyncView({ onMessage }: { onMessage: (message: string) => void }) {
  const [baseInput, setBaseInput] = useState("");
  const [customersTable, setCustomersTable] = useState("客户");
  const [policiesTable, setPoliciesTable] = useState("保单");
  const [remindersTable, setRemindersTable] = useState("提醒");
  const [calendarId, setCalendarId] = useState("primary");
  const [calendarStartTime, setCalendarStartTime] = useState("09:00");
  const [limit, setLimit] = useState("20");
  const [baseSyncStrategy, setBaseSyncStrategy] = useState<"incremental" | "batch-create">("batch-create");
  const [confirmFullSync, setConfirmFullSync] = useState(false);
  const [loadingMode, setLoadingMode] = useState<
    | "setup-all"
    | "sync-all"
    | "schema-plan"
    | "schema-execute"
    | "calendar-plan"
    | "calendar-execute"
    | "sync-plan"
    | "sync-execute"
    | "event-plan"
    | "event-execute"
    | null
  >(null);
  const [calendarViewName, setCalendarViewName] = useState("提醒日历");
  const [schemaResult, setSchemaResult] = useState<FeishuBaseSchemaResult | null>(null);
  const [calendarResult, setCalendarResult] = useState<FeishuBaseCalendarViewResult | null>(null);
  const [eventResult, setEventResult] = useState<FeishuCalendarSyncResult | null>(null);
  const [result, setResult] = useState<FeishuBaseSyncResult | null>(null);
  const baseToken = parseFeishuBaseToken(baseInput);
  const canReadBaseInput = Boolean(baseToken);

  function tableNames() {
    return {
      customers: customersTable.trim() || "客户",
      policies: policiesTable.trim() || "保单",
      reminders: remindersTable.trim() || "提醒",
    };
  }

  function syncLimit() {
    const parsedLimit = Number(limit);
    return Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
  }

  function requireBaseToken() {
    const trimmedToken = baseToken.trim();
    if (!trimmedToken) {
      onMessage(baseInput.trim() ? "这条链接里没有找到飞书多维表格标识" : "请先粘贴飞书多维表格链接");
      return "";
    }
    return trimmedToken;
  }

  async function prepareSchema(mode: "plan" | "execute") {
    const trimmedToken = requireBaseToken();
    if (!trimmedToken) {
      return;
    }
    setLoadingMode(mode === "plan" ? "schema-plan" : "schema-execute");
    try {
      const nextResult = await prepareFeishuBaseSchema({
        baseToken: trimmedToken,
        mode,
        tableNames: tableNames(),
      });
      setSchemaResult(nextResult);
      onMessage(
        mode === "plan"
          ? `表结构计划：${nextResult.summary.planned} 条命令`
          : `表结构准备：执行 ${nextResult.summary.executed}，跳过已有 ${nextResult.summary.skippedExisting}，失败 ${nextResult.summary.failed}`,
      );
    } finally {
      setLoadingMode(null);
    }
  }

  async function prepareCalendarView(mode: "plan" | "execute") {
    const trimmedToken = requireBaseToken();
    if (!trimmedToken) {
      return;
    }
    setLoadingMode(mode === "plan" ? "calendar-plan" : "calendar-execute");
    try {
      const nextResult = await prepareFeishuCalendarView({
        baseToken: trimmedToken,
        mode,
        remindersTable: tableNames().reminders,
        viewName: calendarViewName.trim() || "提醒日历",
      });
      setCalendarResult(nextResult);
      onMessage(
        mode === "plan"
          ? `日历视图计划：${nextResult.summary.planned} 条命令`
          : `日历视图准备：执行 ${nextResult.summary.executed}，跳过已有 ${nextResult.summary.skippedExisting}，失败 ${nextResult.summary.failed}`,
      );
    } finally {
      setLoadingMode(null);
    }
  }

  async function run(mode: "plan" | "execute") {
    const trimmedToken = requireBaseToken();
    if (!trimmedToken) {
      return;
    }
    setLoadingMode(mode === "plan" ? "sync-plan" : "sync-execute");
    try {
      const nextResult = await syncFeishuBase({
        baseToken: trimmedToken,
        mode,
        strategy: baseSyncStrategy,
        limit: syncLimit(),
        confirmFullSync,
        tables: tableNames(),
      });
      setResult(nextResult);
      onMessage(
        mode === "plan"
          ? `同步计划：${nextResult.summary.planned} 条，批次 ${nextResult.summary.batches ?? 0}，跳过已有 ${nextResult.summary.skippedExisting ?? 0}`
          : `同步执行：新建 ${nextResult.summary.created}，更新 ${nextResult.summary.updated ?? 0}，跳过已有 ${nextResult.summary.skippedExisting ?? 0}，失败 ${nextResult.summary.failed}`,
      );
    } finally {
      setLoadingMode(null);
    }
  }

  async function syncCalendarEvents(mode: "plan" | "execute") {
    setLoadingMode(mode === "plan" ? "event-plan" : "event-execute");
    try {
      const nextResult = await syncFeishuCalendar({
        mode,
        calendarId: calendarId.trim() || "primary",
        startTime: calendarStartTime.trim() || "09:00",
        durationMinutes: 30,
        limit: syncLimit(),
        confirmFullSync,
      });
      setEventResult(nextResult);
      onMessage(
        mode === "plan"
          ? `飞书日历计划：${nextResult.summary.planned} 条关键提醒，另有 ${nextResult.summary.skippedByLimit} 条未纳入本次计划`
          : `飞书日历同步：新建 ${nextResult.summary.created}，跳过已有 ${nextResult.summary.skippedExisting}，失败 ${nextResult.summary.failed}`,
      );
    } finally {
      setLoadingMode(null);
    }
  }

  async function prepareEverything() {
    const trimmedToken = requireBaseToken();
    if (!trimmedToken) {
      return;
    }
    setLoadingMode("setup-all");
    try {
      const nextSchemaResult = await prepareFeishuBaseSchema({
        baseToken: trimmedToken,
        mode: "execute",
        tableNames: tableNames(),
      });
      setSchemaResult(nextSchemaResult);

      const nextCalendarResult = await prepareFeishuCalendarView({
        baseToken: trimmedToken,
        mode: "execute",
        remindersTable: tableNames().reminders,
        viewName: calendarViewName.trim() || "提醒日历",
      });
      setCalendarResult(nextCalendarResult);

      onMessage(
        `飞书表格已准备：表字段执行 ${nextSchemaResult.summary.executed}，日历视图执行 ${nextCalendarResult.summary.executed}，失败 ${nextSchemaResult.summary.failed + nextCalendarResult.summary.failed}`,
      );
    } finally {
      setLoadingMode(null);
    }
  }

  async function syncEverything() {
    const trimmedToken = requireBaseToken();
    if (!trimmedToken) {
      return;
    }
    setLoadingMode("sync-all");
    try {
      const nextResult = await syncFeishuBase({
        baseToken: trimmedToken,
        mode: "execute",
        strategy: baseSyncStrategy,
        limit: syncLimit(),
        confirmFullSync,
        tables: tableNames(),
      });
      setResult(nextResult);

      const nextEventResult = await syncFeishuCalendar({
        mode: "execute",
        calendarId: calendarId.trim() || "primary",
        startTime: calendarStartTime.trim() || "09:00",
        durationMinutes: 30,
        limit: syncLimit(),
        confirmFullSync,
      });
      setEventResult(nextEventResult);

      onMessage(
        `同步完成：多维表格新建 ${nextResult.summary.created}，更新 ${nextResult.summary.updated ?? 0}，关键日历新建 ${nextEventResult.summary.created}，失败 ${nextResult.summary.failed + nextEventResult.summary.failed}`,
      );
    } finally {
      setLoadingMode(null);
    }
  }

  return (
    <div className="sync-layout">
      <section className="sync-form sync-simple">
        <div className="sync-simple-header">
          <h3>飞书链接粘这里</h3>
          <p>用一个你能编辑的飞书多维表格。新建空表也可以，复制浏览器地址栏的链接，粘到下面。</p>
        </div>

        <label className="sync-link-field">
          飞书多维表格链接
          <input
            value={baseInput}
            onChange={(event) => setBaseInput(event.target.value)}
            placeholder="https://xxx.feishu.cn/base/..."
          />
        </label>
        {baseInput.trim() && !canReadBaseInput && (
          <p className="inline-error">这条链接里没有找到飞书多维表格标识，请确认复制的是飞书多维表格链接。</p>
        )}

        <div className="sync-requirements">
          <strong>这里需要什么</strong>
          <span>可以用你新建的空多维表格，也可以用已有表格；但你必须有编辑权限。</span>
          <span>普通飞书文档、表格、只读链接不能用。</span>
          <span>第一次同步前，本机需要先完成飞书授权，否则按钮会报未授权。</span>
        </div>

        <div className="sync-primary-steps">
          <button className="primary" onClick={prepareEverything} disabled={loadingMode !== null}>
            {loadingMode === "setup-all" ? "准备中" : "1. 准备飞书表格"}
          </button>
          <button className="primary" onClick={syncEverything} disabled={loadingMode !== null}>
            {loadingMode === "sync-all" ? "同步中" : "2. 同步提醒数据"}
          </button>
        </div>

        <div className="sync-note">
          <strong>默认会同步什么</strong>
          <span>客户、保单、提醒会进多维表格；标为关键的未完成提醒会进飞书日历。</span>
        </div>

        <details className="sync-advanced">
          <summary>高级设置</summary>
          <div className="sync-grid">
            <label>
              客户表
              <input value={customersTable} onChange={(event) => setCustomersTable(event.target.value)} />
            </label>
            <label>
              保单表
              <input value={policiesTable} onChange={(event) => setPoliciesTable(event.target.value)} />
            </label>
            <label>
              提醒表
              <input value={remindersTable} onChange={(event) => setRemindersTable(event.target.value)} />
            </label>
          </div>
          <label>
            本次条数上限
            <input
              type="number"
              min="1"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="留空表示全量"
            />
          </label>
          <div className="segmented-filter sync-strategy" aria-label="Base 同步方式">
            <button
              className={baseSyncStrategy === "incremental" ? "active" : ""}
              onClick={() => setBaseSyncStrategy("incremental")}
              type="button"
            >
              增量更新
            </button>
            <button
              className={baseSyncStrategy === "batch-create" ? "active" : ""}
              onClick={() => setBaseSyncStrategy("batch-create")}
              type="button"
            >
              批量创建
            </button>
          </div>
          <label>
            日历视图名称
            <input
              value={calendarViewName}
              onChange={(event) => setCalendarViewName(event.target.value)}
            />
          </label>
          <div className="sync-grid sync-grid-compact">
            <label>
              飞书日历 ID
              <input
                value={calendarId}
                onChange={(event) => setCalendarId(event.target.value)}
                placeholder="primary 或 cal_xxx"
              />
            </label>
            <label>
              关键提醒时间
              <input
                type="time"
                value={calendarStartTime}
                onChange={(event) => setCalendarStartTime(event.target.value)}
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmFullSync}
              onChange={(event) => setConfirmFullSync(event.target.checked)}
            />
            允许全量执行
          </label>
          <div className="sync-actions sync-plan-actions">
            <button className="ghost" onClick={() => prepareSchema("plan")} disabled={loadingMode !== null}>
              {loadingMode === "schema-plan" ? "生成中" : "表结构计划"}
            </button>
            <button className="ghost" onClick={() => prepareCalendarView("plan")} disabled={loadingMode !== null}>
              {loadingMode === "calendar-plan" ? "生成中" : "日历视图计划"}
            </button>
            <button className="ghost" onClick={() => run("plan")} disabled={loadingMode !== null}>
              {loadingMode === "sync-plan" ? "生成中" : "数据计划"}
            </button>
            <button className="ghost" onClick={() => syncCalendarEvents("plan")} disabled={loadingMode !== null}>
              {loadingMode === "event-plan" ? "生成中" : "飞书日历计划"}
            </button>
          </div>
        </details>
      </section>

      <section className="sync-result sync-status">
        <h3>同步结果</h3>
        {schemaResult ? (
          <>
            <h4>飞书表格</h4>
            <div className="sync-summary">
              <span>计划 {schemaResult.summary.planned}</span>
              <span>执行 {schemaResult.summary.executed}</span>
              <span>跳过 {schemaResult.summary.skippedExisting}</span>
              <span>失败 {schemaResult.summary.failed}</span>
            </div>
            <details className="sync-result-details">
              <summary>查看表结构明细</summary>
              <div className="sync-preview">
                {schemaResult.commands.map((command, index) => (
                  <article key={`schema:${command.table}:${command.fieldName ?? command.action}:${index}`}>
                    <span>{command.action} · {command.tableName}</span>
                    <strong>{command.fieldName ?? command.tableName}</strong>
                    <code>{command.argv.join(" ")}</code>
                  </article>
                ))}
              </div>
            </details>
            {schemaResult.errors.length > 0 && (
              <div className="sync-errors">
                {schemaResult.errors.slice(0, 5).map((error) => (
                  <p key={`schema-error:${error.table}:${error.fieldName ?? error.action}`}>
                    {error.table} · {error.fieldName ?? error.action} · {error.message}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="empty-state">还没有同步结果。先粘贴飞书链接，再按左侧按钮操作。</p>
        )}
        {calendarResult && (
          <div className="calendar-view-result">
            <h4>日历视图</h4>
            <div className="sync-summary">
              <span>计划 {calendarResult.summary.planned}</span>
              <span>执行 {calendarResult.summary.executed}</span>
              <span>跳过 {calendarResult.summary.skippedExisting}</span>
              <span>失败 {calendarResult.summary.failed}</span>
            </div>
            <details className="sync-result-details">
              <summary>查看日历视图明细</summary>
              <div className="sync-preview">
                {calendarResult.commands.map((command, index) => (
                  <article key={`calendar:${command.action}:${index}`}>
                    <span>{command.action} · {command.tableName}</span>
                    <strong>{command.viewName}</strong>
                    <code>{command.argv.join(" ")}</code>
                  </article>
                ))}
              </div>
            </details>
            {calendarResult.errors.length > 0 && (
              <div className="sync-errors">
                {calendarResult.errors.slice(0, 5).map((error) => (
                  <p key={`calendar-error:${error.action}`}>{error.action} · {error.message}</p>
                ))}
              </div>
            )}
          </div>
        )}
        {result ? (
          <>
            <h4>客户、保单、提醒</h4>
            <div className="sync-summary">
              <span>计划 {result.summary.planned}</span>
              <span>新建 {result.summary.created}</span>
              <span>更新 {result.summary.updated ?? 0}</span>
              <span>失败 {result.summary.failed}</span>
              <span>跳过 {result.summary.skippedByLimit ?? result.summary.skippedExisting ?? 0}</span>
              {result.summary.batches !== undefined && <span>批次 {result.summary.batches}</span>}
            </div>
            <details className="sync-result-details">
              <summary>查看数据同步明细</summary>
              <div className="sync-preview">
                {result.commands?.map((command) => (
                  <article key={`${command.table}:${command.externalId}`}>
                    <span>{command.operation === "create" ? "新建" : "更新"} · {command.tableRef}</span>
                    <strong>{String(command.fields["外部ID"])}</strong>
                    <code>{command.argv.join(" ")}</code>
                  </article>
                ))}
                {result.batches?.map((batch, index) => (
                  <article key={`${batch.table}:${batch.tableRef}:${index}`}>
                    <span>{batch.operation === "batch_create" ? "批量创建" : "跳过已有"} · {batch.tableRef}</span>
                    <strong>{batch.planned} 条</strong>
                    <code>{batch.argv.join(" ")}</code>
                  </article>
                ))}
              </div>
            </details>
            {result.errors.length > 0 && (
              <div className="sync-errors">
                {result.errors.slice(0, 5).map((error) => (
                  <p key={`${error.table}:${error.externalId}`}>
                    {error.table} · {error.externalId} · {error.message}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : null}
        {eventResult && (
          <div className="calendar-view-result">
            <h4>飞书日历</h4>
            <div className="sync-summary">
              <span>计划 {eventResult.summary.planned}</span>
              <span>新建 {eventResult.summary.created}</span>
              <span>跳过已有 {eventResult.summary.skippedExisting}</span>
              <span>失败 {eventResult.summary.failed}</span>
              <span>跳过 {eventResult.summary.skippedByLimit}</span>
            </div>
            <details className="sync-result-details">
              <summary>查看飞书日历明细</summary>
              <div className="sync-preview">
                {eventResult.commands.map((command) => (
                  <article key={`event:${command.externalId}`}>
                    <span>{command.operation === "create" ? "创建日程" : "已存在"} · {command.calendarId}</span>
                    <strong>{command.title}</strong>
                    <code>{command.argv.length > 0 ? command.argv.join(" ") : command.eventId ?? ""}</code>
                  </article>
                ))}
              </div>
            </details>
            {eventResult.errors.length > 0 && (
              <div className="sync-errors">
                {eventResult.errors.slice(0, 5).map((error) => (
                  <p key={`event-error:${error.externalId}`}>{error.externalId} · {error.message}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

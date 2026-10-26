import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BellRing,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  FolderOpen,
  Hash,
  Inbox,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import { Feed } from "@/components/Feed";
import { RemindersWidget } from "@/components/RemindersWidget";
import { ReplyQueue } from "@/components/ReplyQueue";
import { Widget } from "@/components/ui";
import { BriefBody, DeadlinesBody, DriveBody, TodayBody, WeekBody } from "@/components/widgets";
import { requireSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/queries";
import { getKV, getSettings, WIDGETS, type WidgetId } from "@/lib/settings";
import { addDays, greeting, localDate, zonedToUtc } from "@/lib/time";
import { toItemView, toTaskView } from "@/lib/views";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
// Server actions on this page (sync now, connect account, run agent) can take up to a minute.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Dashboard" };

const SPAN: Partial<Record<WidgetId, string>> = {
  brief: "md:col-span-2 xl:col-span-3",
  classUpdates: "md:col-span-2",
  inbox: "md:col-span-2",
  week: "md:col-span-2",
};

export default async function DashboardPage() {
  await requireSession();
  const settings = await getSettings();
  const d = await getDashboardData(settings);
  const agentSeen = await getKV<{ at: string }>("agent_last_seen");
  const { now, tz } = d;
  const aliases = settings.courseAliases;
  const today = d.today;
  const tomorrow = addDays(today, 1);
  const weekEnd = zonedToUtc(addDays(today, 7), "00:00", tz);
  const horizon = zonedToUtc(addDays(today, settings.deadlines.lookaheadDays), "00:00", tz);
  const weekAgo = now.getTime() - 7 * 86_400_000;

  const view = (t: (typeof d.tasks)[number]) => toTaskView(t, tz, now, aliases);
  const assignments = d.tasks.filter((t) => t.kind === "assignment" && t.due_at);
  const overdueAssignments = assignments.filter((t) => new Date(t.due_at!) < d.dayStart && t.carry_over && new Date(t.due_at!).getTime() > weekAgo);
  const dueLaterToday = assignments.filter((t) => new Date(t.due_at!) >= d.dayStart && new Date(t.due_at!) < d.tomorrowStart);
  const byDay = (date: string) => assignments.filter((t) => localDate(new Date(t.due_at!), tz) === date);
  const thisWeek = assignments.filter((t) => {
    const due = new Date(t.due_at!);
    const ld = localDate(due, tz);
    return ld > tomorrow && due < weekEnd;
  });
  const later = assignments.filter((t) => new Date(t.due_at!) >= weekEnd && new Date(t.due_at!) < horizon);

  const reminders = d.tasks.filter((t) => t.kind !== "assignment");
  const isVisibleReminder = (t: (typeof reminders)[number]) =>
    !t.due_at || new Date(t.due_at) >= d.dayStart || t.carry_over; // past-due ones stay only while carrying over
  const autoReminders = reminders.filter((t) => t.source === "agent" && isVisibleReminder(t)).map(view);
  const myReminders = reminders.filter((t) => t.source === "manual" && isVisibleReminder(t)).map(view);

  const carriedOver = d.tasks.filter((t) => t.due_at && new Date(t.due_at) < d.dayStart && t.carry_over && (t.kind !== "assignment" || new Date(t.due_at).getTime() > weekAgo));
  const dueTodayAll = d.tasks.filter((t) => t.due_at && new Date(t.due_at) >= d.dayStart && new Date(t.due_at) < d.tomorrowStart);
  const replyCounts = {
    imessage: d.replyMeta.find((r) => r.platform === "imessage")?.waiting_count ?? 0,
    instagram: d.replyMeta.find((r) => r.platform === "instagram")?.waiting_count ?? 0,
    slack: d.slackWaiting.length,
  };
  const importantUnread = d.emails.filter((e) => e.is_unread && (e.importance ?? 1) >= 2).length;

  const widgets: Record<WidgetId, ReactNode> = {
    brief: (
      <Widget
        title="Daily brief"
        icon={<Sparkles />}
        action={
          <Link href="/digest" className="rounded-md px-2 py-1 text-xs font-semibold text-link hover:bg-surface-2">
            Full digest
          </Link>
        }
      >
        <BriefBody
          narrative={d.digest?.narrative ?? null}
          hasDigest={!!d.digest}
          digestTime={new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`1970-01-01T${settings.digest.time}:00Z`))}
          stats={[
            { label: "Due today", value: dueTodayAll.length, tone: "gold", href: "#deadlines" },
            { label: "Carried over", value: carriedOver.length, tone: "red", href: "#reminders" },
            { label: "Waiting on you", value: replyCounts.imessage + replyCounts.instagram + replyCounts.slack, tone: "gold", href: "#replies" },
            { label: "Important unread", value: importantUnread, tone: "navy", href: "#inbox" },
          ]}
        />
      </Widget>
    ),
    today: (
      <Widget title="Today" icon={<CalendarClock />} count={d.events.length || null}>
        <TodayBody events={d.events} dueToday={dueTodayAll.map((t) => ({ ...view(t), at: new Date(t.due_at!) }))} now={now} tz={tz} />
      </Widget>
    ),
    deadlines: (
      <Widget id="deadlines" title="Deadlines" icon={<CalendarDays />} count={overdueAssignments.length + dueLaterToday.length + byDay(tomorrow).length + thisWeek.length + later.length}>
        <DeadlinesBody
          groups={[
            { label: "Overdue", tasks: overdueAssignments.map(view), tone: "red" },
            { label: "Today", tasks: dueLaterToday.map(view) },
            { label: "Tomorrow", tasks: byDay(tomorrow).map(view) },
            { label: "This week", tasks: thisWeek.map(view) },
            { label: "Later", tasks: later.map(view) },
          ]}
        />
      </Widget>
    ),
    reminders: (
      <Widget id="reminders" title="Reminders" icon={<BellRing />}>
        <RemindersWidget auto={autoReminders} mine={myReminders} defaultTab={autoReminders.length ? "auto" : "mine"} />
      </Widget>
    ),
    replies: (
      <Widget id="replies" title="Reply queue" icon={<MessagesSquare />}>
        <ReplyQueue counts={replyCounts} agentSeen={agentSeen?.at ?? null} serverNow={now.toISOString()} />
      </Widget>
    ),
    classUpdates: (
      <Widget title="Class updates" icon={<BookOpen />} count={d.classItems.filter((i) => i.is_unread).length || null}>
        <Feed
          items={d.classItems.map((i) => toItemView(i, now, aliases))}
          filterByCourse
          empty="No class updates in the last two weeks. Connect bCourses, Ed, Gradescope or a course website in Settings."
        />
      </Widget>
    ),
    inbox: (
      <Widget id="inbox" title="Inbox" icon={<Inbox />}>
        <Feed
          items={d.emails.map((i) => toItemView(i, now, aliases))}
          tabs={[
            { id: "important", label: "Important", filter: "important" },
            { id: "unread", label: "Unread", filter: "unread" },
            { id: "all", label: "All", filter: "all" },
          ]}
          empty="Nothing here. Connect a Google account in Settings to see your email."
        />
      </Widget>
    ),
    slack: (
      <Widget title="Slack" icon={<Hash />}>
        <Feed
          items={d.slackItems.map((i) => toItemView(i, now, aliases))}
          tabs={[
            { id: "mentions", label: "Mentions", filter: "kind:Mention" },
            { id: "announcements", label: "Announcements", filter: "kind:Announcement" },
          ]}
          empty="No Slack activity. Connect a workspace and pick announcement channels in Settings."
        />
      </Widget>
    ),
    week: (
      <Widget title="Week ahead" icon={<CalendarRange />}>
        <WeekBody
          events={d.weekEvents}
          tasks={assignments.filter((t) => new Date(t.due_at!) >= d.dayStart && new Date(t.due_at!) < weekEnd).map((t) => ({ ...view(t), at: new Date(t.due_at!) }))}
          now={now}
          tz={tz}
        />
      </Widget>
    ),
    drive: (
      <Widget title="Drive" icon={<FolderOpen />}>
        <DriveBody files={d.files} now={now} />
      </Widget>
    ),
  };

  const known = new Set<string>(WIDGETS.map((w) => w.id));
  const order = [...settings.widgets.order.filter((id) => known.has(id)), ...WIDGETS.map((w) => w.id).filter((id) => !settings.widgets.order.includes(id))] as WidgetId[];
  const shown = order.filter((id) => !settings.widgets.hidden.includes(id));
  const dateLine = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(now);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
            {greeting(now, tz)}, {env.ownerName()}
          </h1>
          <p className="mt-0.5 text-sm text-muted">{dateLine}</p>
        </div>
        {d.connections.some((c) => c.status !== "ok") && (
          <Link href="/settings#connections" className="rounded-lg bg-amber-soft px-3 py-1.5 text-xs font-semibold text-amber ring-1 ring-amber/20 hover:underline">
            {d.connections.filter((c) => c.status !== "ok").length} connection(s) need attention
          </Link>
        )}
        {d.connections.length === 0 && (
          <Link href="/settings#connections" className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-on-navy hover:bg-navy-hover">
            Connect your accounts to get started
          </Link>
        )}
      </div>
      <div className="grid grid-flow-row-dense grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((id) => (
          <div key={id} className={`min-w-0 ${SPAN[id] ?? ""}`}>
            {widgets[id]}
          </div>
        ))}
      </div>
    </>
  );
}

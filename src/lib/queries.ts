import "server-only";
import type { CalendarOption } from "@/components/CalendarPicker";
import { sql } from "./db";
import { courseKey } from "./courses";
import { withoutSyllabusDuplicates } from "./dedupe";
import type { Settings } from "./settings";
import type { Item, Task } from "./store";
import { addDays, localDate, zonedToUtc } from "./time";

export type EventRow = {
  id: string;
  title: string;
  starts_at: Date;
  ends_at: Date | null;
  all_day: boolean;
  location: string | null;
  calendar: string | null;
  color: string | null;
  url: string | null;
  source: string;
};

export type ReplyMeta = { platform: string; waiting_count: number; oldest_wait_at: Date | null; generated_at: Date | null; updated_at: Date };

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData(settings: Settings, now = new Date()) {
  const tz = settings.timezone;
  const today = localDate(now, tz);
  const dayStart = zonedToUtc(today, "00:00", tz);
  const tomorrowStart = zonedToUtc(addDays(today, 1), "00:00", tz);
  const weekEnd = zonedToUtc(addDays(today, 7), "00:00", tz);
  const hidden = settings.hiddenCourses;

  const [events, weekEvents, tasks, recentDone, classItems, emails, slackItems, files, slackWaiting, replyMeta, digest, conns, lastTick] =
    await Promise.all([
      sql<EventRow[]>`
        select id, title, starts_at, ends_at, all_day, location, calendar, color, url, source from events
        where starts_at < ${tomorrowStart} and coalesce(ends_at, starts_at) > ${dayStart}
          and (calendar_id is null or calendar_id <> all(${settings.hiddenCalendars}::text[]))
        order by all_day desc, starts_at`,
      sql<EventRow[]>`
        select id, title, starts_at, ends_at, all_day, location, calendar, color, url, source from events
        where starts_at >= ${dayStart} and starts_at < ${weekEnd}
          and (calendar_id is null or calendar_id <> all(${settings.hiddenCalendars}::text[]))
        order by starts_at`,
      sql<Task[]>`
        select * from tasks where status = 'open'
          and (due_at is null or due_at > now() - interval '60 days')
        order by due_at nulls last, priority desc, created_at desc`,
      sql<Task[]>`
        select * from tasks where status = 'done' and completed_at > ${dayStart}
        order by completed_at desc limit 20`,
      sql<Item[]>`
        select * from items where is_class and not dismissed
          and kind in ('announcement', 'update', 'post', 'grade', 'message', 'email')
          and occurred_at > now() - interval '14 days'
        order by occurred_at desc limit 60`,
      sql<Item[]>`
        select * from items where source = 'gmail' and not dismissed and occurred_at > now() - interval '7 days'
        order by occurred_at desc limit 60`,
      sql<Item[]>`
        select * from items where source = 'slack' and not dismissed and occurred_at > now() - interval '7 days'
        order by occurred_at desc limit 40`,
      sql<Item[]>`select * from items where kind = 'file' order by occurred_at desc limit 12`,
      sql<{ id: string; name: string; waiting_since: Date; unanswered: number; url: string | null; state_hash: string }[]>`
        select id, name, waiting_since, unanswered, url, state_hash from reply_waiting order by waiting_since`,
      sql<ReplyMeta[]>`select platform, waiting_count, oldest_wait_at, generated_at, updated_at from reply_queue`,
      sql<{ date: string; narrative: string | null; sent_at: Date | null; created_at: Date }[]>`
        select to_char(date, 'YYYY-MM-DD') as date, narrative, sent_at, created_at from digests where date = ${today}`,
      sql<{ type: string; status: string; label: string }[]>`select type, status, label from connections where enabled`,
      sql<{ started_at: Date; ok: boolean | null }[]>`select started_at, ok from run_log where kind = 'tick' order by started_at desc limit 1`,
    ]);

  const visibleTask = (t: Task) => !t.course || !hidden.includes(courseKey(t.course) ?? t.course);
  const visibleItem = (i: Item) => !i.course || !hidden.includes(courseKey(i.course) ?? i.course);

  return {
    now,
    tz,
    today,
    dayStart,
    tomorrowStart,
    events,
    weekEvents,
    tasks: withoutSyllabusDuplicates(tasks.filter(visibleTask)),
    recentDone: recentDone.filter(visibleTask),
    classItems: classItems.filter(visibleItem),
    emails,
    slackItems,
    files,
    slackWaiting,
    replyMeta,
    digest: digest[0] ?? null,
    connections: conns,
    lastTick: lastTick[0] ?? null,
  };
}

/** All synced calendars with their visibility, for the calendar toggles. */
export async function getCalendars(hidden: string[]): Promise<CalendarOption[]> {
  const rows = await sql<{ id: string; name: string; color: string | null; account: string | null }[]>`
    select c.id, c.name, c.color, c.account from calendars c
    join connections k on k.id = c.connection_id
    where k.enabled
    order by c.account nulls last, c.name`;
  return rows.map((r) => ({ ...r, hidden: hidden.includes(r.id) }));
}

/** Every course seen anywhere, for the Classes page and settings. */
export async function getCourses(): Promise<string[]> {
  const rows = await sql<{ course: string }[]>`
    select distinct course from (
      select course from tasks where course is not null and created_at > now() - interval '150 days'
      union select course from items where course is not null and occurred_at > now() - interval '150 days'
    ) c`;
  const keys = new Set<string>();
  for (const r of rows) keys.add(courseKey(r.course) ?? r.course);
  return [...keys].sort();
}

export async function getCourseData(course: string | null) {
  const match = (c: string | null) => !course || (c != null && (courseKey(c) ?? c) === course);
  const [tasks, items] = await Promise.all([
    sql<Task[]>`
      select * from tasks where kind = 'assignment' and course is not null
        and (due_at is null or due_at > now() - interval '30 days')
      order by due_at nulls last`,
    sql<Item[]>`
      select * from items where is_class and not dismissed and occurred_at > now() - interval '45 days'
      order by occurred_at desc limit 300`,
  ]);
  return { tasks: withoutSyllabusDuplicates(tasks).filter((t) => match(t.course)), items: items.filter((i) => match(i.course)) };
}

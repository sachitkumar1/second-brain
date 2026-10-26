import "server-only";
import { sql } from "../db";
import { appUrl, env } from "../env";
import { courseColor } from "../courses";
import { truncate } from "../http";
import { sendEmail } from "../notify/email";
import { sendPush } from "../notify/push";
import { taskLinks } from "../notify/scheduler";
import { buildEmail, type EmailRow } from "../notify/templates";
import { getSettings, type Settings } from "../settings";
import type { Item, Task } from "../store";
import { addDays, daysBetween, fmtDay, fmtDue, fmtTime, hhmmToMinutes, localDate, zonedParts, zonedToUtc } from "../time";
import { aiAvailable, textCall } from "./ai";
import { withoutSyllabusDuplicates } from "../dedupe";

export type DigestTask = {
  id: string;
  title: string;
  course: string | null;
  dueAt: string | null;
  allDay: boolean;
  url: string | null;
  source: string;
  kind: string;
  notes: string | null;
  daysOverdue: number;
};
export type DigestEvent = { title: string; startsAt: string; endsAt: string | null; allDay: boolean; location: string | null; calendar: string | null };
export type DigestItem = { title: string; summary: string | null; source: string; kind: string; course: string | null; author: string | null; url: string | null; importance: number | null };

export type DigestData = {
  date: string;
  timezone: string;
  generatedAt: string;
  events: DigestEvent[];
  overdue: DigestTask[];
  dueToday: DigestTask[];
  upcoming: DigestTask[];
  reminders: DigestTask[];
  classUpdates: DigestItem[];
  emails: DigestItem[];
  replies: { imessage: number | null; instagram: number | null; slack: { name: string; since: string }[] };
};

function liteTask(t: Task, today: string, tz: string): DigestTask {
  return {
    id: t.id,
    title: t.title,
    course: t.course,
    dueAt: t.due_at ? new Date(t.due_at).toISOString() : null,
    allDay: t.all_day,
    url: t.url,
    source: t.source,
    kind: t.kind,
    notes: t.notes,
    daysOverdue: t.due_at ? Math.max(0, daysBetween(localDate(new Date(t.due_at), tz), today)) : 0,
  };
}

function liteItem(i: Item): DigestItem {
  return { title: i.title, summary: i.summary, source: i.source, kind: i.kind, course: i.course, author: i.author, url: i.url, importance: i.importance };
}

/**
 * Collects everything for a day's brief. Carry-over rule: any open task whose due date has passed
 * stays in "Carried over" every morning until you finish it, dismiss it, or turn off carry-over.
 * Assignments stop carrying over a week after their deadline (they can't usually be submitted by then).
 */
export async function buildDigestData(settings: Settings, now = new Date()): Promise<DigestData> {
  const tz = settings.timezone;
  const today = localDate(now, tz);
  const dayStart = zonedToUtc(today, "00:00", tz);
  const dayEnd = zonedToUtc(addDays(today, 1), "00:00", tz);
  const weekEnd = zonedToUtc(addDays(today, 8), "00:00", tz);

  const [events, open, classItems, emails, slackWaiting, rq] = await Promise.all([
    sql<{ title: string; starts_at: Date; ends_at: Date | null; all_day: boolean; location: string | null; calendar: string | null }[]>`
      select title, starts_at, ends_at, all_day, location, calendar from events
      where starts_at < ${dayEnd} and coalesce(ends_at, starts_at) > ${dayStart}
        and (calendar_id is null or calendar_id <> all(${settings.hiddenCalendars}::text[]))
      order by all_day desc, starts_at`,
    sql<Task[]>`select * from tasks where status = 'open' order by due_at nulls last, priority desc`,
    sql<Item[]>`
      select * from items where is_class and not dismissed and kind in ('announcement','update','post','grade','message')
        and occurred_at > ${new Date(now.getTime() - 26 * 3_600_000)}
      order by importance desc nulls last, occurred_at desc limit 12`,
    sql<Item[]>`
      select * from items where source = 'gmail' and not dismissed and coalesce(importance, 1) >= 2
        and occurred_at > ${new Date(now.getTime() - 26 * 3_600_000)}
      order by importance desc nulls last, occurred_at desc limit 10`,
    sql<{ name: string; waiting_since: Date }[]>`select name, waiting_since from reply_waiting order by waiting_since limit 15`,
    sql<{ platform: string; waiting_count: number }[]>`select platform, waiting_count from reply_queue`,
  ]);

  const hidden = new Set(settings.hiddenCourses);
  const visible = withoutSyllabusDuplicates(open.filter((t) => !t.course || !hidden.has(t.course)));
  const overdue = visible.filter(
    (t) =>
      t.due_at &&
      new Date(t.due_at) < dayStart &&
      t.carry_over &&
      (t.kind !== "assignment" || new Date(t.due_at).getTime() > now.getTime() - 7 * 86_400_000),
  );
  const dueToday = visible.filter((t) => t.due_at && new Date(t.due_at) >= dayStart && new Date(t.due_at) < dayEnd);
  const upcoming = visible.filter((t) => t.due_at && new Date(t.due_at) >= dayEnd && new Date(t.due_at) < weekEnd && t.kind === "assignment");
  const reminders = visible.filter(
    (t) => t.kind !== "assignment" && (!t.due_at ? true : new Date(t.due_at) >= dayEnd && new Date(t.due_at) < weekEnd && t.priority >= 2),
  );

  const counts = Object.fromEntries(rq.map((r) => [r.platform, r.waiting_count]));
  return {
    date: today,
    timezone: tz,
    generatedAt: now.toISOString(),
    events: events.map((e) => ({
      title: e.title,
      startsAt: new Date(e.starts_at).toISOString(),
      endsAt: e.ends_at ? new Date(e.ends_at).toISOString() : null,
      allDay: e.all_day,
      location: e.location,
      calendar: e.calendar,
    })),
    overdue: overdue.map((t) => liteTask(t, today, tz)),
    dueToday: dueToday.map((t) => liteTask(t, today, tz)),
    upcoming: upcoming.map((t) => liteTask(t, today, tz)),
    reminders: reminders.slice(0, 15).map((t) => liteTask(t, today, tz)),
    classUpdates: classItems.map(liteItem),
    emails: emails.map(liteItem),
    replies: {
      imessage: counts.imessage ?? null,
      instagram: counts.instagram ?? null,
      slack: slackWaiting.map((w) => ({ name: w.name, since: new Date(w.waiting_since).toISOString() })),
    },
  };
}

const BRIEF_SYSTEM = (name: string) => `You write ${name}'s morning brief: a UC Berkeley Data Science + Applied Math student's plan for the day. You'll get today's schedule and to-dos as JSON.

Write plain text (no markdown headings, no bold), in this shape:
1. One or two sentences on the shape of the day (how busy, the main fixed commitments).
2. "Top priorities:" followed by 3-5 lines starting with "- ", most urgent first. Name specific assignments, courses and times. Mention items carried over from previous days explicitly ("still open from Tuesday").
3. Optionally one short line on anything else worth knowing (a notable class announcement, people waiting on replies).

Be concrete and brief, like a sharp assistant. Use 12-hour times. Don't invent anything that isn't in the data.`;

async function narrative(data: DigestData, tz: string): Promise<string | null> {
  if (!aiAvailable()) return null;
  const compact = {
    today: `${fmtDay(new Date(data.generatedAt), tz, { year: "numeric" })}`,
    schedule: data.events.map((e) => `${e.allDay ? "all day" : `${fmtTime(e.startsAt, tz)}${e.endsAt ? "–" + fmtTime(e.endsAt, tz) : ""}`} ${e.title}${e.location ? " @ " + e.location : ""}`),
    carriedOver: data.overdue.map((t) => `${t.course ? t.course + " " : ""}${t.title} (was due ${fmtDue(t.dueAt!, tz, new Date(data.generatedAt), t.allDay)}, ${t.daysOverdue}d ago)`),
    dueToday: data.dueToday.map((t) => `${t.course ? t.course + " " : ""}${t.title} — ${fmtDue(t.dueAt!, tz, new Date(data.generatedAt), t.allDay)}`),
    dueThisWeek: data.upcoming.map((t) => `${t.course ? t.course + " " : ""}${t.title} — ${fmtDue(t.dueAt!, tz, new Date(data.generatedAt), t.allDay)}`),
    openReminders: data.reminders.map((t) => t.title),
    classUpdates: data.classUpdates.map((i) => `${i.course ?? ""} ${i.summary ?? i.title}`.trim()),
    importantEmail: data.emails.map((i) => `${i.author ?? ""}: ${i.summary ?? i.title}`),
    peopleWaitingOnReply: {
      imessage: data.replies.imessage,
      instagram: data.replies.instagram,
      slack: data.replies.slack.map((s) => s.name),
    },
  };
  try {
    // Bounded so a slow response can't push the scheduler past its time limit; the digest goes out without it.
    return await textCall({ system: BRIEF_SYSTEM(env.ownerName()), user: JSON.stringify(compact, null, 1), effort: "medium", timeoutMs: 22_000 });
  } catch (err) {
    console.error("[digest] narrative failed", err);
    return null;
  }
}

export async function generateDigest(now = new Date()): Promise<{ data: DigestData; narrative: string | null }> {
  const settings = await getSettings();
  const data = await buildDigestData(settings, now);
  const text = settings.digest.aiSummary ? await narrative(data, settings.timezone) : null;
  await sql`
    insert into digests (date, data, narrative) values (${data.date}, ${sql.json(data as never)}, ${text})
    on conflict (date) do update set data = excluded.data, narrative = coalesce(excluded.narrative, digests.narrative), created_at = now()`;
  return { data, narrative: text };
}

async function emailDigest(data: DigestData, narrativeText: string | null, settings: Settings): Promise<void> {
  const tz = settings.timezone;
  const now = new Date(data.generatedAt);
  const taskRow = async (t: DigestTask, badge?: EmailRow["badge"]): Promise<EmailRow> => ({
    title: t.title,
    meta: [t.course, t.dueAt ? `due ${fmtDue(t.dueAt, tz, now, t.allDay)}` : null].filter(Boolean).join(" · ") || undefined,
    url: t.url,
    color: courseColor(t.course),
    badge,
    links: await taskLinks({ id: t.id }, { carried: t.daysOverdue > 0 }),
  });
  const replyBits = [
    data.replies.imessage ? `${data.replies.imessage} on iMessage` : null,
    data.replies.instagram ? `${data.replies.instagram} on Instagram` : null,
    data.replies.slack.length ? `${data.replies.slack.length} on Slack` : null,
  ].filter(Boolean);

  const sections = [
    {
      title: "Today's schedule",
      rows: data.events.map((e) => ({
        title: e.title,
        meta: [e.allDay ? "All day" : `${fmtTime(e.startsAt, tz)}${e.endsAt ? " – " + fmtTime(e.endsAt, tz) : ""}`, e.location].filter(Boolean).join(" · "),
        color: "#003262",
      })),
      empty: "Nothing on the calendar.",
    },
    { title: "Carried over", rows: await Promise.all(data.overdue.map((t) => taskRow(t, { text: t.daysOverdue <= 1 ? "from yesterday" : `${t.daysOverdue} days`, tone: "red" }))) },
    { title: "Due today", rows: await Promise.all(data.dueToday.map((t) => taskRow(t))), empty: "Nothing due today." },
    { title: "Due this week", rows: await Promise.all(data.upcoming.map((t) => taskRow(t))) },
    { title: "Reminders", rows: await Promise.all(data.reminders.map((t) => taskRow(t))) },
    {
      title: "Class updates (last 24h)",
      rows: data.classUpdates.map((i) => ({ title: i.title, meta: [i.course, i.author].filter(Boolean).join(" · "), note: truncate(i.summary, 220), url: i.url, color: courseColor(i.course) })),
    },
    {
      title: "Important email",
      rows: data.emails.map((i) => ({ title: i.title, meta: i.author ?? undefined, note: truncate(i.summary, 220), url: i.url, color: "#5b6576" })),
    },
    {
      title: "Waiting on your reply",
      rows: replyBits.length
        ? [{ title: replyBits.join(" · "), meta: data.replies.slack.length ? `Slack: ${data.replies.slack.map((s) => s.name).join(", ")}` : "Names are end-to-end encrypted — open the Reply Queue to see who.", url: appUrl(), color: "#fdb515" }]
        : [],
    },
  ];

  const total = data.dueToday.length + data.overdue.length;
  const built = buildEmail({
    preheader: `${data.events.length} events · ${data.dueToday.length} due today${data.overdue.length ? ` · ${data.overdue.length} carried over` : ""}`,
    heading: `Your ${fmtDay(now, tz, { weekday: "long", month: "long" })}`,
    subheading: `${data.events.length} event${data.events.length === 1 ? "" : "s"} · ${total} thing${total === 1 ? "" : "s"} to finish today`,
    intro: narrativeText,
    sections,
    footer: [
      { label: "Open dashboard", href: appUrl() },
      { label: "Full digest", href: `${appUrl()}/digest/${data.date}` },
      { label: "Settings", href: `${appUrl()}/settings` },
    ],
  });
  if (settings.notifications.email) await sendEmail({ subject: `☀️ Daily brief — ${fmtDay(now, tz, { weekday: "long" })}`, ...built });
  if (settings.notifications.push) await sendPush({ title: "Your daily brief is ready", body: `${data.dueToday.length} due today · ${data.events.length} events`, url: `${appUrl()}/digest/${data.date}` });
}

/** Whether today's digest should go out now (enabled, past the configured time, not yet sent). */
export async function digestDue(now = new Date()): Promise<{ due: boolean; reason?: string }> {
  const settings = await getSettings();
  if (!settings.digest.enabled) return { due: false, reason: "disabled" };
  const tz = settings.timezone;
  const p = zonedParts(now, tz);
  if (p.hour * 60 + p.minute < hhmmToMinutes(settings.digest.time)) return { due: false, reason: "not yet" };
  const existing = await sql<{ sent_at: Date | null }[]>`select sent_at from digests where date = ${localDate(now, tz)}`;
  if (existing[0]?.sent_at) return { due: false, reason: "already sent" };
  return { due: true };
}

/** Sends today's digest once, at or after the configured local time (or immediately with force). */
export async function maybeSendDigest(now = new Date(), force = false): Promise<{ sent: boolean; reason?: string }> {
  if (!force) {
    const check = await digestDue(now);
    if (!check.due) return { sent: false, reason: check.reason };
  }
  const settings = await getSettings();
  const today = localDate(now, settings.timezone);
  const { data, narrative: text } = await generateDigest(now);
  await emailDigest(data, text, settings);
  await sql`update digests set sent_at = now() where date = ${today}`;
  return { sent: true };
}

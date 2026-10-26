import "server-only";
import { sql } from "../db";
import { appUrl } from "../env";
import { courseColor } from "../courses";
import { truncate } from "../http";
import { signAction } from "../session";
import { getSettings, type Settings } from "../settings";
import type { Task } from "../store";
import { fmtDue, fmtUntil, inWindow, zonedParts } from "../time";
import { sendEmail } from "./email";
import { sendPush } from "./push";
import { buildEmail, type EmailRow } from "./templates";

/** One-click links for emails. "Don't carry over" only makes sense once something is overdue. */
export async function taskLinks(t: Pick<Task, "id">, opts: { carried?: boolean } = {}): Promise<{ label: string; href: string }[]> {
  const base = `${appUrl()}/api/act`;
  const links = [
    { label: "✓ Mark done", href: `${base}?t=${await signAction({ a: "done", id: t.id })}` },
    { label: "Snooze a day", href: `${base}?t=${await signAction({ a: "snooze", id: t.id })}` },
  ];
  if (opts.carried) links.push({ label: "Don't carry over", href: `${base}?t=${await signAction({ a: "nocarry", id: t.id })}` });
  return links;
}

function inQuietHours(settings: Settings, now: Date): boolean {
  const q = settings.notifications.quietHours;
  if (!q.enabled) return false;
  const p = zonedParts(now, settings.timezone);
  return inWindow(p.hour * 60 + p.minute, q.start, q.end);
}

async function alreadySent(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await sql<{ key: string }[]>`select key from notification_log where key in ${sql(keys)}`;
  return new Set(rows.map((r) => r.key));
}

/** Logged only after a successful send, so a failed email is retried on the next tick. */
async function markSent(keys: string[]): Promise<void> {
  for (const key of keys) await sql`insert into notification_log (key) values (${key}) on conflict do nothing`;
}

async function deliver(settings: Settings, subject: string, built: { html: string; text: string }, push: { title: string; body: string; url?: string }) {
  if (settings.notifications.email) await sendEmail({ subject, ...built });
  if (settings.notifications.push) await sendPush(push);
}

const footer = () => [
  { label: "Open dashboard", href: appUrl() },
  { label: "Notification settings", href: `${appUrl()}/settings#notifications` },
];

/** Your own reminders whose time has come. Always delivered, even in quiet hours (you set the time). */
async function dueReminders(settings: Settings, now: Date): Promise<number> {
  const due = await sql<Task[]>`
    select * from tasks where status = 'open' and remind_at is not null and remind_at <= ${now}
      and remind_at > ${new Date(now.getTime() - 36 * 3_600_000)}
    order by remind_at`;
  const keyOf = (t: Task) => `remind:${t.id}:${new Date(t.remind_at!).toISOString()}`;
  const sent = await alreadySent(due.map(keyOf));
  const fresh = due.filter((t) => !sent.has(keyOf(t)));
  if (!fresh.length) return 0;
  const tz = settings.timezone;
  const rows: EmailRow[] = await Promise.all(
    fresh.map(async (t) => ({
      title: t.title,
      meta: [t.course, t.due_at ? `due ${fmtDue(t.due_at, tz, now, t.all_day)}` : null].filter(Boolean).join(" · ") || undefined,
      note: t.notes,
      url: t.url,
      color: courseColor(t.course),
      links: await taskLinks(t),
    })),
  );
  const subject = fresh.length === 1 ? `⏰ Reminder: ${fresh[0].title}` : `⏰ ${fresh.length} reminders`;
  await deliver(
    settings,
    subject,
    buildEmail({ preheader: fresh.map((t) => t.title).join(" · "), heading: fresh.length === 1 ? "Reminder" : `${fresh.length} reminders`, sections: [{ title: "Now", rows }], footer: footer() }),
    { title: subject.replace("⏰ ", ""), body: fresh.map((t) => t.title).join("\n"), url: appUrl() },
  );
  await markSent(fresh.map(keyOf));
  return fresh.length;
}

/** Heads-up emails N hours before assignment and agent deadlines. */
async function deadlineHeadsUps(settings: Settings, now: Date, quiet: boolean): Promise<number> {
  const leads = [...settings.deadlines.leadHours].sort((a, b) => b - a); // e.g. [24, 3]
  if (!leads.length) return 0;
  const horizon = new Date(now.getTime() + leads[0] * 3_600_000);
  const upcoming = await sql<Task[]>`
    select * from tasks where status = 'open' and due_at > ${now} and due_at <= ${horizon}
      and (kind = 'assignment' or source = 'agent')
    order by due_at`;
  const tz = settings.timezone;
  const picked: { t: Task; lead: number }[] = [];
  const keys: string[] = [];
  const keyOf = (t: Task, l: number) => `deadline:${t.id}:${l}:${new Date(t.due_at!).toISOString()}`;
  const sent = await alreadySent(upcoming.flatMap((t) => leads.map((l) => keyOf(t, l))));
  for (const t of upcoming) {
    const hoursLeft = (new Date(t.due_at!).getTime() - now.getTime()) / 3_600_000;
    const active = leads.filter((l) => hoursLeft <= l); // leads whose window has opened
    if (!active.length) continue;
    const smallest = Math.min(...active);
    // During quiet hours, only deadlines that would pass before quiet hours end get through.
    if (quiet && hoursLeft > 9) continue;
    const unsent = active.map((l) => keyOf(t, l)).filter((k) => !sent.has(k));
    if (unsent.length) {
      keys.push(...unsent);
      picked.push({ t, lead: smallest });
    }
  }
  if (!picked.length) return 0;
  const rows: EmailRow[] = await Promise.all(
    picked.map(async ({ t }) => ({
      title: t.title,
      meta: [t.course, `due ${fmtDue(t.due_at!, tz, now, t.all_day)}`].filter(Boolean).join(" · "),
      badge: { text: fmtUntil(t.due_at!, now), tone: (new Date(t.due_at!).getTime() - now.getTime() < 6 * 3_600_000 ? "red" : "navy") as "red" | "navy" },
      url: t.url,
      color: courseColor(t.course),
      links: await taskLinks(t),
    })),
  );
  const first = picked[0].t;
  const subject =
    picked.length === 1 ? `Due ${fmtDue(first.due_at!, tz, now, first.all_day)}: ${first.title}` : `${picked.length} deadlines coming up`;
  await deliver(
    settings,
    subject,
    buildEmail({ preheader: picked.map((p) => p.t.title).join(" · "), heading: "Deadlines coming up", sections: [{ title: "Due soon", rows }], footer: footer() }),
    { title: subject, body: picked.map((p) => `${p.t.title} — ${fmtUntil(p.t.due_at!, now)}`).join("\n"), url: appUrl() },
  );
  await markSent(keys);
  return picked.length;
}

type AlertRow = { id: string; kind: string; title: string; body: string | null; url: string | null; urgent: boolean; summary: string | null; course: string | null };

/** New announcements, grades, assignments, urgent emails — batched into one email per tick. */
async function pendingAlerts(settings: Settings, now: Date, quiet: boolean): Promise<number> {
  const rows = await sql<AlertRow[]>`
    select a.id, a.kind, a.title, a.body, a.url, a.urgent, i.summary, i.course
    from alerts a left join items i on i.id = a.item_id
    where a.sent_at is null and a.created_at > now() - interval '3 days'
      and (${!quiet} or a.urgent)
    order by a.urgent desc, a.created_at`;
  if (!rows.length) return 0;
  const label: Record<string, string> = {
    urgent: "Needs attention",
    assignment: "New assignment",
    announcement: "Announcement",
    grade: "Grade posted",
    update: "Course site changed",
    mention: "Slack mention",
    email: "Email",
    post: "Ed post",
  };
  const emailRows: EmailRow[] = rows.map((r) => ({
    title: r.title,
    badge: { text: label[r.kind] ?? r.kind, tone: r.urgent ? "red" : "navy" },
    note: truncate(r.summary ?? r.body, 300),
    url: r.url,
    color: r.urgent ? "#b42318" : courseColor(r.course),
  }));
  const urgent = rows.filter((r) => r.urgent).length;
  const subject =
    rows.length === 1 ? `${rows[0].urgent ? "‼️ " : ""}${rows[0].title}` : `${urgent ? "‼️ " : ""}${rows.length} new updates${urgent ? ` (${urgent} urgent)` : ""}`;
  await deliver(
    settings,
    subject,
    buildEmail({ preheader: rows.map((r) => r.title).join(" · "), heading: rows.length === 1 ? label[rows[0].kind] ?? "Update" : `${rows.length} new updates`, sections: [{ title: "New", rows: emailRows }], footer: footer() }),
    { title: subject, body: rows.slice(0, 4).map((r) => r.title).join("\n"), url: rows.length === 1 && rows[0].url ? rows[0].url : appUrl() },
  );
  await sql`update alerts set sent_at = ${now} where id in ${sql(rows.map((r) => r.id))}`;
  return rows.length;
}

export async function runNotifications(now = new Date()): Promise<{ reminders: number; deadlines: number; alerts: number; quiet: boolean }> {
  const settings = await getSettings();
  const quiet = inQuietHours(settings, now);
  const reminders = await dueReminders(settings, now);
  const deadlines = await deadlineHeadsUps(settings, now, quiet);
  const alerts = await pendingAlerts(settings, now, quiet);
  return { reminders, deadlines, alerts, quiet };
}

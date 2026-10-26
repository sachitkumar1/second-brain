import "server-only";
import { z } from "zod";
import { sql } from "./db";
import { env } from "./env";

export const WIDGETS = [
  { id: "brief", name: "Daily brief" },
  { id: "today", name: "Today" },
  { id: "deadlines", name: "Deadlines" },
  { id: "reminders", name: "Reminders" },
  { id: "replies", name: "Reply queue" },
  { id: "classUpdates", name: "Class updates" },
  { id: "inbox", name: "Inbox" },
  { id: "week", name: "Week ahead" },
  { id: "slack", name: "Slack" },
  { id: "drive", name: "Drive" },
] as const;
export type WidgetId = (typeof WIDGETS)[number]["id"];

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const SettingsSchema = z.object({
  notifyEmail: z.string().email().default(env.defaultNotifyEmail()),
  timezone: z.string().default("America/Los_Angeles"),
  digest: z
    .object({
      enabled: z.boolean().default(true),
      time: hhmm.default("07:00"),
      aiSummary: z.boolean().default(true),
    })
    .prefault({}),
  deadlines: z
    .object({
      // Hours before a deadline to send a heads-up email.
      leadHours: z.array(z.number().positive()).default([24, 3]),
      lookaheadDays: z.number().int().min(1).max(60).default(14),
    })
    .prefault({}),
  notifications: z
    .object({
      email: z.boolean().default(true),
      push: z.boolean().default(false),
      quietHours: z
        .object({ enabled: z.boolean().default(true), start: hhmm.default("23:00"), end: hhmm.default("07:30") })
        .prefault({}),
      rules: z
        .object({
          newAssignment: z.boolean().default(true),
          canvasAnnouncement: z.boolean().default(true),
          edAnnouncement: z.boolean().default(true),
          gradePosted: z.boolean().default(true),
          courseSiteChange: z.boolean().default(true),
          aiUrgent: z.boolean().default(true),
          slackMention: z.boolean().default(false),
          slackAnnouncement: z.boolean().default(false),
          // Always alert on emails from these senders/domains, or containing these keywords.
          emailFrom: z.array(z.string()).default([]),
          keywords: z.array(z.string()).default([]),
        })
        .prefault({}),
    })
    .prefault({}),
  ai: z
    .object({
      enabled: z.boolean().default(true),
      processEmail: z.boolean().default(true),
      processSlack: z.boolean().default(true),
    })
    .prefault({}),
  replyQueue: z
    .object({
      lookbackDays: z.number().int().min(1).max(90).default(14),
      includeGroups: z.boolean().default(false),
      contactsOnly: z.boolean().default(true),
      tapbackCountsAsReply: z.boolean().default(true),
    })
    .prefault({}),
  widgets: z
    .object({
      order: z.array(z.string()).default(WIDGETS.map((w) => w.id)),
      hidden: z.array(z.string()).default([]),
    })
    .prefault({}),
  // Map raw course names to your preferred label, e.g. {"DATA C100": "Data 100"}.
  courseAliases: z.record(z.string(), z.string()).default({}),
  hiddenCourses: z.array(z.string()).default([]),
  // Calendar IDs (see the calendars table) whose events are hidden from the dashboard and digest.
  hiddenCalendars: z.array(z.string()).default([]),
});

export type Settings = z.infer<typeof SettingsSchema>;

export async function getSettings(): Promise<Settings> {
  const rows = await sql<{ value: unknown }[]>`select value from settings where key = 'app'`;
  const parsed = SettingsSchema.safeParse(rows[0]?.value ?? {});
  if (parsed.success) return parsed.data;
  // Fall back to defaults merged with whatever parsed, rather than breaking the dashboard.
  return SettingsSchema.parse({});
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  await sql`
    insert into settings (key, value, updated_at) values ('app', ${sql.json(next as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  return next;
}

export async function hideCalendars(ids: string[]): Promise<void> {
  const s = await getSettings();
  await saveSettings({ hiddenCalendars: [...new Set([...s.hiddenCalendars, ...ids])] });
}

/** Small helper for other single-purpose keys (agent token hash, etc.). */
export async function getKV<T>(key: string): Promise<T | null> {
  const rows = await sql<{ value: T }[]>`select value from settings where key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await sql`
    insert into settings (key, value, updated_at) values (${key}, ${sql.json(value as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { maybeSendDigest, generateDigest } from "@/lib/agent/digest";
import { runTriage } from "@/lib/agent/triage";
import { requireSession } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { tick } from "@/lib/jobs/tick";
import { sendEmail } from "@/lib/notify/email";
import { runNotifications } from "@/lib/notify/scheduler";
import { buildEmail } from "@/lib/notify/templates";
import { appUrl } from "@/lib/env";
import { getSettings, saveSettings, setKV, SettingsSchema, WIDGETS } from "@/lib/settings";
import { syncDue } from "@/lib/sources";
import { listSlackChannels } from "@/lib/sources/slack";
import { createConnection, deleteConnection, getConnection, readSecret, updateConnection, type ConnectionType } from "@/lib/store";
import { applyTaskAction, type TaskAction } from "@/lib/tasks";
import { localDate, zonedToUtc } from "@/lib/time";
import { SESSION_COOKIE } from "@/lib/session";

export type ActionResult = { ok: boolean; message?: string; data?: unknown };

const refresh = () => revalidatePath("/", "layout");
const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

// ---------------------------------------------------------------- session

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------------------------------------------------------------- tasks & reminders

export async function taskAction(id: string, action: TaskAction): Promise<ActionResult> {
  await requireSession();
  await applyTaskAction(id, action);
  refresh();
  return { ok: true };
}

const ReminderInput = z.object({
  title: z.string().trim().min(1, "Give the reminder a title").max(300),
  notes: z.string().trim().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  notify: z.enum(["at", "15m", "1h", "1d", "none"]).default("at"),
  priority: z.coerce.number().int().min(0).max(3).default(1),
  carry: z.string().optional(),
});

export async function createReminder(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = ReminderInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid reminder" };
  const r = parsed.data;
  const { timezone: tz } = await getSettings();
  let due: Date | null = null;
  let allDay = false;
  if (r.date) {
    allDay = !r.time;
    due = zonedToUtc(r.date, r.time || "23:59", tz);
  } else if (r.time) {
    due = zonedToUtc(localDate(new Date(), tz), r.time, tz);
  }
  const offsets: Record<string, number> = { at: 0, "15m": 15, "1h": 60, "1d": 1440 };
  let remind: Date | null = null;
  if (due && r.notify !== "none") {
    // All-day reminders notify at 9am that day.
    remind = allDay && r.notify === "at" ? zonedToUtc(r.date!, "09:00", tz) : new Date(due.getTime() - offsets[r.notify] * 60_000);
  }
  await sql`
    insert into tasks (source, kind, title, notes, due_at, remind_at, all_day, priority, carry_over)
    values ('manual', 'reminder', ${r.title}, ${r.notes || null}, ${due}, ${remind}, ${allDay}, ${r.priority}, ${r.carry !== "off"})`;
  refresh();
  return { ok: true, message: "Reminder added" };
}

export async function updateReminder(id: string, patch: { title?: string; notes?: string | null }): Promise<ActionResult> {
  await requireSession();
  if (patch.title !== undefined) await sql`update tasks set title = ${patch.title.slice(0, 300)}, updated_at = now() where id = ${id}`;
  if (patch.notes !== undefined) await sql`update tasks set notes = ${patch.notes}, updated_at = now() where id = ${id}`;
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------- feed items

export async function dismissItem(id: string, dismissed = true): Promise<ActionResult> {
  await requireSession();
  await sql`update items set dismissed = ${dismissed} where id = ${id}`;
  refresh();
  return { ok: true };
}

export async function markItemRead(id: string): Promise<ActionResult> {
  await requireSession();
  await sql`update items set is_unread = false where id = ${id}`;
  return { ok: true };
}

// ---------------------------------------------------------------- sync & jobs

export async function syncNow(): Promise<ActionResult> {
  await requireSession();
  try {
    const outcomes = await syncDue({ budgetMs: 25_000, force: true });
    const triage = await runTriage(30_000).catch((e) => ({ error: String(e) }));
    await runNotifications().catch(() => null);
    refresh();
    const failed = outcomes.filter((o) => !o.ok);
    return {
      ok: failed.length === 0,
      message: failed.length ? `Synced with ${failed.length} error(s): ${failed.map((f) => `${f.label}: ${f.error}`).join("; ")}` : `Synced ${outcomes.length} source(s)`,
      data: { outcomes, triage },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function runTickNow(): Promise<ActionResult> {
  await requireSession();
  try {
    const result = await tick({ totalMs: 50_000 });
    refresh();
    return { ok: true, message: "Ran the agent", data: result };
  } catch (e) {
    return fail(e);
  }
}

export async function digestNow(send: boolean): Promise<ActionResult> {
  await requireSession();
  try {
    if (send) await maybeSendDigest(new Date(), true);
    else await generateDigest();
    refresh();
    return { ok: true, message: send ? "Digest generated and emailed" : "Digest regenerated" };
  } catch (e) {
    return fail(e);
  }
}

export async function sendTestEmail(): Promise<ActionResult> {
  await requireSession();
  try {
    const s = await getSettings();
    const built = buildEmail({
      preheader: "Your dashboard can email you.",
      heading: "Test email",
      subheading: `Notifications will arrive at ${s.notifyEmail}.`,
      intro: "If you can read this, email delivery from the agent mailbox works.",
      sections: [],
      footer: [{ label: "Open dashboard", href: appUrl() }],
    });
    const sent = await sendEmail({ subject: "Apollo test email", ...built });
    return sent ? { ok: true, message: `Sent to ${s.notifyEmail}` } : { ok: false, message: "GMAIL_APP_PASSWORD isn't set on the server." };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- settings

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

export async function saveGeneral(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSession();
  const email = String(form.get("notifyEmail") ?? "").trim();
  const timezone = String(form.get("timezone") ?? "").trim();
  if (!z.string().email().safeParse(email).success) return { ok: false, message: "That email address doesn't look right." };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { ok: false, message: "Unknown timezone." };
  }
  const s = await getSettings();
  await saveSettings({
    notifyEmail: email,
    timezone,
    digest: {
      enabled: form.get("digestEnabled") === "on",
      time: String(form.get("digestTime") ?? s.digest.time),
      aiSummary: form.get("aiSummary") === "on",
    },
    ai: {
      enabled: form.get("aiEnabled") === "on",
      processEmail: form.get("aiEmail") === "on",
      processSlack: form.get("aiSlack") === "on",
    },
  });
  refresh();
  return { ok: true, message: "Saved" };
}

export async function saveNotifications(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSession();
  const on = (k: string) => form.get(k) === "on";
  const leads = list(form.get("leadHours"))
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 24 * 14);
  try {
    await saveSettings({
      notifications: SettingsSchema.shape.notifications.parse({
        email: on("email"),
        push: on("push"),
        quietHours: { enabled: on("quietEnabled"), start: String(form.get("quietStart")), end: String(form.get("quietEnd")) },
        rules: {
          newAssignment: on("newAssignment"),
          canvasAnnouncement: on("canvasAnnouncement"),
          edAnnouncement: on("edAnnouncement"),
          gradePosted: on("gradePosted"),
          courseSiteChange: on("courseSiteChange"),
          aiUrgent: on("aiUrgent"),
          slackMention: on("slackMention"),
          slackAnnouncement: on("slackAnnouncement"),
          emailFrom: list(form.get("emailFrom")),
          keywords: list(form.get("keywords")),
        },
      }),
      deadlines: { leadHours: leads.length ? leads : [24, 3], lookaheadDays: 14 },
    });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "Saved" };
}

export async function saveReplySettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSession();
  const days = Number(form.get("lookbackDays"));
  await saveSettings({
    replyQueue: {
      lookbackDays: Number.isFinite(days) ? Math.min(90, Math.max(1, Math.round(days))) : 14,
      includeGroups: form.get("includeGroups") === "on",
      contactsOnly: form.get("contactsOnly") === "on",
      tapbackCountsAsReply: form.get("tapback") === "on",
    },
  });
  refresh();
  return { ok: true, message: "Saved — the Mac agent picks this up on its next run." };
}

export async function saveWidgets(order: string[], hidden: string[]): Promise<ActionResult> {
  await requireSession();
  const valid = new Set<string>(WIDGETS.map((w) => w.id));
  await saveSettings({ widgets: { order: order.filter((id) => valid.has(id)), hidden: hidden.filter((id) => valid.has(id)) } });
  refresh();
  return { ok: true };
}

export async function saveCourses(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSession();
  const aliases: Record<string, string> = {};
  for (const line of String(form.get("aliases") ?? "").split("\n")) {
    const [k, v] = line.split("=").map((s) => s?.trim());
    if (k && v) aliases[k.toUpperCase()] = v;
  }
  await saveSettings({ courseAliases: aliases, hiddenCourses: form.getAll("hidden").map(String) });
  refresh();
  return { ok: true, message: "Saved" };
}

// ---------------------------------------------------------------- connections

export async function addConnection(type: ConnectionType, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSession();
  const v = (k: string) => String(form.get(k) ?? "").trim();
  let conn;
  try {
    switch (type) {
      case "canvas":
        if (!v("token")) return { ok: false, message: "Paste your bCourses access token." };
        conn = await createConnection({ type, label: "bCourses", config: { baseUrl: v("baseUrl") || "https://bcourses.berkeley.edu" }, secret: { token: v("token") } });
        break;
      case "ed":
        if (!v("token")) return { ok: false, message: "Paste your Ed API token." };
        conn = await createConnection({ type, label: "Ed Discussion", config: { region: v("region") || "us" }, secret: { token: v("token") } });
        break;
      case "gradescope":
        if (!v("email") || !v("password")) return { ok: false, message: "Enter your Gradescope email and password." };
        conn = await createConnection({ type, label: "Gradescope", account: v("email"), secret: { email: v("email"), password: v("password") } });
        break;
      case "slack":
        if (!/^xox[pe]-/.test(v("token"))) return { ok: false, message: "That doesn't look like a Slack user token (xoxp-…)." };
        conn = await createConnection({ type, label: v("label") || "Slack", config: { channels: [] }, secret: { token: v("token") } });
        break;
      case "ics":
        if (!/^(https|webcal):\/\//i.test(v("url"))) return { ok: false, message: "Feed URL should start with https:// or webcal://" };
        conn = await createConnection({ type, label: v("label") || "Calendar feed", config: { url: v("url"), kind: v("kind") || "auto", course: v("course") || undefined } });
        break;
      case "webpage":
        if (!/^https?:\/\//i.test(v("url"))) return { ok: false, message: "Page URL should start with https://" };
        conn = await createConnection({ type, label: v("label") || new URL(v("url")).host, config: { url: v("url"), course: v("course") || undefined, selector: v("selector") || undefined } });
        break;
      default:
        return { ok: false, message: "Use the Connect Google button for Google accounts." };
    }
  } catch (e) {
    return fail(e);
  }
  const [outcome] = await syncDue({ budgetMs: 45_000, onlyId: conn.id });
  if (outcome && !outcome.ok) {
    await deleteConnection(conn.id);
    return { ok: false, message: `Couldn't connect: ${outcome.error}` };
  }
  refresh();
  return { ok: true, message: `Connected ${conn.label}` };
}

export async function setConnectionEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  await requireSession();
  await updateConnection(id, { enabled, status: "ok", last_error: null });
  refresh();
  return { ok: true };
}

export async function removeConnection(id: string): Promise<ActionResult> {
  await requireSession();
  await deleteConnection(id);
  refresh();
  return { ok: true };
}

export async function syncConnectionNow(id: string): Promise<ActionResult> {
  await requireSession();
  await updateConnection(id, { status: "ok" });
  const [o] = await syncDue({ budgetMs: 45_000, onlyId: id });
  refresh();
  return o?.ok ? { ok: true, message: "Synced" } : { ok: false, message: o?.error ?? "Sync failed" };
}

export async function updateGoogleConfig(id: string, cfg: { gmail: boolean; calendar: boolean; drive: boolean }): Promise<ActionResult> {
  await requireSession();
  const conn = await getConnection(id);
  if (!conn || conn.type !== "google") return { ok: false, message: "Not found" };
  await updateConnection(id, { config: { ...conn.config, ...cfg } });
  refresh();
  return { ok: true };
}

export async function getSlackChannels(id: string): Promise<ActionResult> {
  await requireSession();
  const conn = await getConnection(id);
  const secret = conn ? readSecret<{ token: string }>(conn) : null;
  if (!conn || !secret) return { ok: false, message: "Not found" };
  try {
    return { ok: true, data: await listSlackChannels(secret.token) };
  } catch (e) {
    return fail(e);
  }
}

export async function setSlackChannels(id: string, channels: { id: string; name: string }[]): Promise<ActionResult> {
  await requireSession();
  const conn = await getConnection(id);
  if (!conn) return { ok: false, message: "Not found" };
  await updateConnection(id, { config: { ...conn.config, channels: channels.slice(0, 40) } });
  refresh();
  return { ok: true, message: `Watching ${channels.length} channel(s)` };
}

// ---------------------------------------------------------------- Mac agent

/** Creates a new agent token (shown once). Only its hash is stored; the old token stops working. */
export async function createAgentToken(): Promise<ActionResult> {
  await requireSession();
  const token = `sb_${randomToken(32)}`;
  await setKV("agent_token_hash", sha256(token));
  return { ok: true, data: token };
}

export async function forgetReplyQueue(): Promise<ActionResult> {
  await requireSession();
  await sql`delete from reply_queue`;
  await sql`delete from reply_dismissals`;
  refresh();
  return { ok: true, message: "Cleared encrypted reply data from the server" };
}

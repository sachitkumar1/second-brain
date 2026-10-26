import "server-only";
import { sql } from "../db";
import { getSettings, type Settings } from "../settings";
import { addAlert, listConnections, updateConnection, type Connection, type ConnectionType, type Item, type Task } from "../store";
import { truncate } from "../http";
import { fmtDue } from "../time";
import { canvas } from "./canvas";
import { ed } from "./ed";
import { google, NeedsReauth } from "./google";
import { gradescope } from "./gradescope";
import { ics } from "./ics";
import { slack } from "./slack";
import type { SourceAdapter, SyncResult } from "./types";
import { webpage } from "./webpage";

export const ADAPTERS: Record<ConnectionType, SourceAdapter> = { google, slack, canvas, ed, gradescope, ics, webpage };

export type SyncOutcome = { id: string; label: string; type: string; ok: boolean; error?: string; counts?: Record<string, number>; ms: number };

/** Turns freshly-synced items/assignments into alerts according to your notification rules. */
export async function alertsForNew(newItems: Item[], newAssignments: Task[], settings: Settings, now: Date): Promise<number> {
  const rules = settings.notifications.rules;
  const tz = settings.timezone;
  const recent = (d: Date) => now.getTime() - new Date(d).getTime() < 3 * 86_400_000;
  let n = 0;

  for (const t of newAssignments) {
    if (!rules.newAssignment || !t.due_at || new Date(t.due_at) < now || t.status !== "open") continue;
    await addAlert({
      dedupeKey: `assignment:${t.id}`,
      kind: "assignment",
      title: `New assignment: ${t.title}`,
      body: `${t.course ? t.course + " · " : ""}due ${fmtDue(t.due_at, tz, now)}`,
      url: t.url,
    });
    n++;
  }

  for (const it of newItems) {
    if (!recent(it.occurred_at)) continue;
    let rule = false;
    let kind = it.kind;
    if (it.kind === "announcement" && it.source === "canvas") rule = rules.canvasAnnouncement;
    else if (it.kind === "announcement" && it.source === "ed") rule = rules.edAnnouncement;
    else if (it.kind === "announcement" && it.source === "slack") rule = rules.slackAnnouncement;
    else if (it.kind === "mention") rule = rules.slackMention;
    else if (it.kind === "grade") rule = rules.gradePosted;
    else if (it.kind === "update" && it.source === "webpage") rule = rules.courseSiteChange;
    else if (it.kind === "email" && it.ai_meta?.ruleMatch) {
      rule = true;
      kind = "email";
    }
    if (!rule) continue;
    const prefix = it.course ? `${it.course}: ` : it.channel ? `${it.channel}: ` : "";
    await addAlert({
      dedupeKey: `item:${it.id}`,
      kind,
      title: `${prefix}${it.title}`,
      body: truncate(it.body, 280),
      url: it.url,
      itemId: it.id,
    });
    n++;
  }
  return n;
}

export async function syncConnection(conn: Connection, settings: Settings, now = new Date()): Promise<SyncOutcome> {
  const started = Date.now();
  const adapter = ADAPTERS[conn.type];
  if (!adapter) return { id: conn.id, label: conn.label, type: conn.type, ok: false, error: "Unknown connection type", ms: 0 };
  const backfill = !conn.last_sync_at;
  try {
    const result: SyncResult = await adapter.sync({ conn, settings, now, backfill });
    await updateConnection(conn.id, {
      status: result.warning ? "partial" : "ok",
      last_error: result.warning ?? null,
      ...(result.cursor ? { cursor: result.cursor } : {}),
      ...(result.secret !== undefined ? { secret: result.secret } : {}),
      ...(result.account ? { account: result.account } : {}),
    });
    await sql`update connections set last_sync_at = ${now} where id = ${conn.id}`;
    if (!backfill) await alertsForNew(result.newItems ?? [], result.newAssignments ?? [], settings, now);
    return { id: conn.id, label: conn.label, type: conn.type, ok: true, counts: result.counts, ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateConnection(conn.id, { status: err instanceof NeedsReauth ? "needs_auth" : "error", last_error: message.slice(0, 500) });
    // Count failed attempts as a sync so a broken source backs off instead of retrying every tick.
    await sql`update connections set last_sync_at = ${now} where id = ${conn.id}`;
    return { id: conn.id, label: conn.label, type: conn.type, ok: false, error: message, ms: Date.now() - started };
  }
}

function isDue(conn: Connection, now: Date): boolean {
  if (!conn.enabled || conn.status === "needs_auth") return false;
  if (!conn.last_sync_at) return true;
  const base = ADAPTERS[conn.type]?.intervalMinutes ?? 30;
  const interval = conn.status === "error" ? Math.max(base, 30) : base;
  // Small slack so a 10-minute cron doesn't skip a 10-minute source because of jitter.
  return now.getTime() - new Date(conn.last_sync_at).getTime() >= (interval - 1) * 60_000;
}

/** Syncs every connection that's due, in parallel, within a time budget. */
export async function syncDue(opts: { budgetMs: number; force?: boolean; onlyId?: string } = { budgetMs: 40_000 }): Promise<SyncOutcome[]> {
  const settings = await getSettings();
  const now = new Date();
  const all = await listConnections();
  const due = all.filter((c) => (opts.onlyId ? c.id === opts.onlyId : opts.force ? c.enabled : isDue(c, now)));
  const deadline = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), opts.budgetMs));
  const outcomes = await Promise.all(
    due.map(async (c) => {
      const res = await Promise.race([syncConnection(c, settings, now), deadline]);
      return res === "timeout"
        ? ({ id: c.id, label: c.label, type: c.type, ok: false, error: "still running at time budget", ms: opts.budgetMs } as SyncOutcome)
        : res;
    }),
  );
  return outcomes;
}

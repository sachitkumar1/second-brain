import "server-only";
import { digestDue, maybeSendDigest } from "../agent/digest";
import { runTriage } from "../agent/triage";
import { runNotifications } from "../notify/scheduler";
import { syncDue } from "../sources";
import { logRun } from "../store";

const errMsg = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });

/**
 * One scheduler heartbeat (call every 10–15 minutes):
 * sync due sources → AI triage → morning digest (once a day) → reminders/alerts.
 */
export async function tick(opts: { totalMs?: number; force?: boolean } = {}) {
  const total = opts.totalMs ?? 55_000;
  const started = Date.now();
  const left = () => total - (Date.now() - started);
  return logRun("tick", async () => {
    const sync = await syncDue({ budgetMs: Math.min(20_000, left() - 25_000), force: opts.force }).catch(errMsg);
    const digestPending = (await digestDue().catch(() => ({ due: false }))).due;
    const triage = await runTriage(Math.max(0, left() - (digestPending ? 28_000 : 6_000))).catch(errMsg);
    const digest = digestPending ? await maybeSendDigest().catch(errMsg) : { sent: false };
    const notify = await runNotifications().catch(errMsg);
    return { sync, triage, digest, notify, ms: Date.now() - started };
  });
}

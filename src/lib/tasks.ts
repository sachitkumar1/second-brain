import "server-only";
import { sql } from "./db";
import { getSettings } from "./settings";
import type { Task } from "./store";
import { addDays, localDate, zonedToUtc } from "./time";

export type TaskAction = "done" | "reopen" | "dismiss" | "nocarry" | "carry" | "snooze" | "delete";

/** Applies a quick action to a task. Marks synced tasks as user-touched so syncs don't undo your choice. */
export async function applyTaskAction(id: string, action: TaskAction): Promise<Task | null> {
  const rows = await sql<Task[]>`select * from tasks where id = ${id}`;
  const t = rows[0];
  if (!t) return null;
  switch (action) {
    case "done":
      await sql`update tasks set status = 'done', completed_at = now(), user_touched = true, updated_at = now() where id = ${id}`;
      break;
    case "reopen":
      await sql`update tasks set status = 'open', completed_at = null, user_touched = true, updated_at = now() where id = ${id}`;
      break;
    case "dismiss":
      await sql`update tasks set status = 'dismissed', user_touched = true, updated_at = now() where id = ${id}`;
      break;
    case "nocarry":
      await sql`update tasks set carry_over = false, user_touched = true, updated_at = now() where id = ${id}`;
      break;
    case "carry":
      await sql`update tasks set carry_over = true, updated_at = now() where id = ${id}`;
      break;
    case "snooze": {
      // Your own reminders move to tomorrow (same time, or 9am); synced deadlines can't move, so they just stay quiet for a day.
      const { timezone: tz } = await getSettings();
      const tomorrow = addDays(localDate(new Date(), tz), 1);
      if (t.source === "manual" || t.source === "agent") {
        const due = t.due_at ? new Date(new Date(t.due_at).getTime() + 86_400_000) : null;
        const remind = zonedToUtc(tomorrow, "09:00", tz);
        await sql`update tasks set due_at = coalesce(${due}, due_at), remind_at = ${remind}, user_touched = true, updated_at = now() where id = ${id}`;
      } else {
        await sql`update tasks set remind_at = ${zonedToUtc(tomorrow, "09:00", tz)}, user_touched = true, updated_at = now() where id = ${id}`;
      }
      break;
    }
    case "delete":
      if (t.source === "manual" || t.source === "agent") await sql`delete from tasks where id = ${id}`;
      else await sql`update tasks set status = 'dismissed', user_touched = true where id = ${id}`;
      break;
  }
  return t;
}

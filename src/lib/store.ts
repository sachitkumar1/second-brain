import "server-only";
import { sql } from "./db";
import { decryptJson, encryptJson } from "./crypto";

/** Only allow web/mail/sms links; drops javascript: and other schemes from untrusted sources. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ["http:", "https:", "mailto:", "sms:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---------- Connections ----------

export type ConnectionType = "google" | "slack" | "canvas" | "ed" | "gradescope" | "ics" | "webpage";

export type Connection = {
  id: string;
  type: ConnectionType;
  label: string;
  account: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
  secret: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursor: Record<string, any>;
  enabled: boolean;
  status: string;
  last_sync_at: Date | null;
  last_error: string | null;
  created_at: Date;
};

export async function listConnections(): Promise<Connection[]> {
  return sql<Connection[]>`select * from connections order by type, created_at`;
}

export async function getConnection(id: string): Promise<Connection | null> {
  const rows = await sql<Connection[]>`select * from connections where id = ${id}`;
  return rows[0] ?? null;
}

export function readSecret<T>(conn: Connection): T | null {
  return decryptJson<T>(conn.secret);
}

export async function createConnection(input: {
  type: ConnectionType;
  label: string;
  account?: string | null;
  config?: Record<string, unknown>;
  secret?: unknown;
}): Promise<Connection> {
  const rows = await sql<Connection[]>`
    insert into connections (type, label, account, config, secret)
    values (${input.type}, ${input.label}, ${input.account ?? null}, ${sql.json((input.config ?? {}) as never)},
            ${input.secret === undefined ? null : encryptJson(input.secret)})
    returning *`;
  return rows[0];
}

export async function updateConnection(
  id: string,
  patch: Partial<{ label: string; account: string | null; config: Record<string, unknown>; secret: unknown; enabled: boolean; status: string; last_error: string | null; cursor: Record<string, unknown> }>,
): Promise<void> {
  const current = await getConnection(id);
  if (!current) return;
  await sql`
    update connections set
      label      = ${patch.label ?? current.label},
      account    = ${patch.account !== undefined ? patch.account : current.account},
      config     = ${sql.json((patch.config ?? current.config) as never)},
      secret     = ${patch.secret !== undefined ? encryptJson(patch.secret) : current.secret},
      enabled    = ${patch.enabled ?? current.enabled},
      status     = ${patch.status ?? current.status},
      last_error = ${patch.last_error !== undefined ? patch.last_error : current.last_error},
      cursor     = ${sql.json((patch.cursor ?? current.cursor) as never)}
    where id = ${id}`;
}

export async function deleteConnection(id: string): Promise<void> {
  // Synced assignments survive with connection_id = null; drop open ones from this source.
  await sql`delete from tasks where connection_id = ${id} and status = 'open' and source <> 'manual'`;
  await sql`delete from connections where id = ${id}`;
}

// ---------- Feed items ----------

export type ItemInput = {
  source: string;
  kind: string;
  externalId: string;
  title: string;
  body?: string | null;
  author?: string | null;
  url?: string | null;
  course?: string | null;
  channel?: string | null;
  account?: string | null;
  occurredAt: Date;
  isUnread?: boolean;
  isClass?: boolean;
  importance?: number | null;
  /** 'pending' queues the item for AI triage; 'skipped' means no AI needed. */
  aiStatus?: "pending" | "skipped";
  aiMeta?: Record<string, unknown> | null;
};

export type Item = {
  id: string;
  connection_id: string | null;
  source: string;
  kind: string;
  external_id: string;
  title: string;
  body: string | null;
  author: string | null;
  url: string | null;
  course: string | null;
  channel: string | null;
  account: string | null;
  occurred_at: Date;
  is_unread: boolean;
  is_class: boolean;
  importance: number | null;
  summary: string | null;
  ai_status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai_meta: Record<string, any> | null;
  dismissed: boolean;
  created_at: Date;
};

/** Inserts or refreshes feed items. Returns only the rows that were newly inserted. */
export async function upsertItems(connectionId: string | null, items: ItemInput[]): Promise<Item[]> {
  const inserted: Item[] = [];
  for (const it of items) {
    const rows = await sql<(Item & { inserted: boolean })[]>`
      insert into items (connection_id, source, kind, external_id, title, body, author, url, course, channel, account,
                         occurred_at, is_unread, is_class, importance, ai_status, ai_meta)
      values (${connectionId}, ${it.source}, ${it.kind}, ${it.externalId}, ${it.title.slice(0, 500)},
              ${it.body ? it.body.slice(0, 20000) : null}, ${it.author ?? null}, ${safeUrl(it.url)}, ${it.course ?? null},
              ${it.channel ?? null}, ${it.account ?? null}, ${it.occurredAt}, ${it.isUnread ?? false},
              ${it.isClass ?? false}, ${it.importance ?? null}, ${it.aiStatus ?? "pending"},
              ${it.aiMeta ? sql.json(it.aiMeta as never) : null})
      on conflict (source, connection_id, external_id) do update set
        title     = excluded.title,
        body      = coalesce(excluded.body, items.body),
        url       = coalesce(excluded.url, items.url),
        course    = coalesce(items.course, excluded.course),
        is_unread = excluded.is_unread,
        occurred_at = case when items.kind = 'file' then excluded.occurred_at else items.occurred_at end
      returning *, (xmax = 0) as inserted`;
    if (rows[0]?.inserted) inserted.push(rows[0]);
  }
  return inserted;
}

// ---------- Calendar events ----------

export type EventInput = {
  externalId: string;
  calendarId?: string | null;
  calendar?: string | null;
  title: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  color?: string | null;
};

/** Replaces all events of one connection inside [from, to) with the given set (handles deletions). */
export async function replaceEvents(connectionId: string, source: string, from: Date, to: Date, events: EventInput[]) {
  await sql.begin(async (tx) => {
    await tx`delete from events where connection_id = ${connectionId} and starts_at >= ${from} and starts_at < ${to}`;
    for (const e of events) {
      await tx`
        insert into events (connection_id, source, external_id, calendar_id, calendar, title, location, description, url,
                            starts_at, ends_at, all_day, color)
        values (${connectionId}, ${source}, ${e.externalId}, ${e.calendarId ?? null}, ${e.calendar ?? null}, ${e.title.slice(0, 300)},
                ${e.location ?? null}, ${e.description ? e.description.slice(0, 2000) : null}, ${safeUrl(e.url)},
                ${e.startsAt}, ${e.endsAt ?? null}, ${e.allDay ?? false}, ${e.color ?? null})
        on conflict (source, connection_id, external_id) do update set
          title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at, calendar_id = excluded.calendar_id,
          location = excluded.location, all_day = excluded.all_day, updated_at = now()`;
    }
  });
}

export type CalendarInput = { id: string; name: string; color?: string | null; account?: string | null; hiddenByDefault?: boolean };

/**
 * Records the calendars a connection currently has (dropping ones that disappeared) and returns the
 * IDs of newly seen calendars that should start hidden (e.g. unchecked in Google Calendar).
 */
export async function syncCalendarList(connectionId: string, list: CalendarInput[]): Promise<string[]> {
  const startHidden: string[] = [];
  for (const c of list) {
    const rows = await sql<{ inserted: boolean }[]>`
      insert into calendars (id, connection_id, name, color, account)
      values (${c.id}, ${connectionId}, ${c.name.slice(0, 200)}, ${c.color ?? null}, ${c.account ?? null})
      on conflict (id) do update set name = excluded.name, color = excluded.color, account = excluded.account
      returning (xmax = 0) as inserted`;
    if (rows[0]?.inserted && c.hiddenByDefault) startHidden.push(c.id);
  }
  const keep = list.map((c) => c.id);
  await sql`delete from calendars where connection_id = ${connectionId} and not (id = any(${keep}::text[]))`;
  return startHidden;
}

// ---------- Tasks (assignments + reminders) ----------

export type Task = {
  id: string;
  source: string;
  kind: string;
  connection_id: string | null;
  external_id: string | null;
  item_id: string | null;
  title: string;
  notes: string | null;
  course: string | null;
  url: string | null;
  due_at: Date | null;
  remind_at: Date | null;
  all_day: boolean;
  priority: number;
  status: "open" | "done" | "dismissed";
  carry_over: boolean;
  submitted: boolean;
  score: string | null;
  user_touched: boolean;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type AssignmentInput = {
  source: string;
  externalId: string;
  title: string;
  course?: string | null;
  url?: string | null;
  dueAt: Date | null;
  submitted?: boolean;
  score?: string | null;
  notes?: string | null;
  allDay?: boolean;
  priority?: number;
};

/**
 * Upserts synced assignments. A submitted assignment is closed automatically unless you've
 * touched it by hand. Returns newly created ones (for "new assignment posted" alerts).
 */
export async function upsertAssignments(connectionId: string | null, list: AssignmentInput[]): Promise<Task[]> {
  const created: Task[] = [];
  for (const a of list) {
    const submitted = a.submitted ?? false;
    const rows = await sql<(Task & { inserted: boolean })[]>`
      insert into tasks (source, kind, connection_id, external_id, title, course, url, due_at, submitted, score, notes,
                         status, completed_at, priority, all_day)
      values (${a.source}, 'assignment', ${connectionId}, ${a.externalId}, ${a.title.slice(0, 300)}, ${a.course ?? null},
              ${safeUrl(a.url)}, ${a.dueAt}, ${submitted}, ${a.score ?? null}, ${a.notes ?? null},
              ${submitted ? "done" : "open"}, ${submitted ? new Date() : null}, ${a.priority ?? 2}, ${a.allDay ?? false})
      on conflict (source, external_id) do update set
        title     = excluded.title,
        course    = coalesce(excluded.course, tasks.course),
        url       = coalesce(excluded.url, tasks.url),
        due_at    = excluded.due_at,
        all_day   = excluded.all_day,
        notes     = coalesce(excluded.notes, tasks.notes),
        submitted = excluded.submitted,
        score     = coalesce(excluded.score, tasks.score),
        status    = case
                      when tasks.user_touched then tasks.status
                      when excluded.submitted and tasks.status = 'open' then 'done'
                      when not excluded.submitted and tasks.status = 'done' and tasks.completed_at is not null
                           and tasks.submitted then 'open'
                      else tasks.status end,
        completed_at = case when excluded.submitted and tasks.completed_at is null then now() else tasks.completed_at end,
        updated_at = now()
      returning *, (xmax = 0) as inserted`;
    if (rows[0]?.inserted) created.push(rows[0]);
  }
  return created;
}

// ---------- Alerts ----------

export async function addAlert(a: {
  dedupeKey: string;
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  itemId?: string | null;
  urgent?: boolean;
}): Promise<void> {
  await sql`
    insert into alerts (dedupe_key, kind, title, body, url, item_id, urgent)
    values (${a.dedupeKey}, ${a.kind}, ${a.title.slice(0, 300)}, ${a.body ?? null}, ${safeUrl(a.url)}, ${a.itemId ?? null},
            ${a.urgent ?? false})
    on conflict (dedupe_key) do nothing`;
}

// ---------- Run log ----------

export async function logRun<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  const [{ id }] = await sql<{ id: number }[]>`insert into run_log (kind) values (${kind}) returning id`;
  try {
    const result = await fn();
    await sql`update run_log set finished_at = now(), ok = true, detail = ${sql.json((result ?? null) as never)} where id = ${id}`;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`update run_log set finished_at = now(), ok = false, detail = ${sql.json({ error: message })} where id = ${id}`;
    throw err;
  }
}

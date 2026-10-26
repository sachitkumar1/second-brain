import "server-only";
import { sql } from "../db";
import { appUrl, env } from "../env";
import { courseKey, isClassSender } from "../courses";
import { fetchJson, HttpError, htmlToText, mapLimit } from "../http";
import { hideCalendars } from "../settings";
import { readSecret, replaceEvents, syncCalendarList, upsertItems, type Connection, type EventInput, type ItemInput } from "../store";
import { zonedToUtc } from "../time";
import type { SourceAdapter, SyncContext, SyncResult } from "./types";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

export type GoogleSecret = {
  refresh_token: string;
  access_token?: string;
  expires_at?: number; // epoch ms
};

export function googleRedirectUri(): string {
  return `${appUrl()}/api/oauth/google/callback`;
}

export function googleAuthUrl(state: string, loginHint?: string): string {
  const clientId = env.googleClientId();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

export async function exchangeGoogleCode(code: string): Promise<{ secret: GoogleSecret; email: string; name?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: env.googleClientId() ?? "",
    client_secret: env.googleClientSecret() ?? "",
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const tok = await fetchJson<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!tok.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.");
  const info = await fetchJson<{ email: string; name?: string }>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  return {
    email: info.email,
    name: info.name,
    secret: { refresh_token: tok.refresh_token, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000 },
  };
}

class NeedsReauth extends Error {}

async function accessToken(secret: GoogleSecret): Promise<GoogleSecret> {
  if (secret.access_token && secret.expires_at && secret.expires_at - Date.now() > 120_000) return secret;
  const body = new URLSearchParams({
    client_id: env.googleClientId() ?? "",
    client_secret: env.googleClientSecret() ?? "",
    refresh_token: secret.refresh_token,
    grant_type: "refresh_token",
  });
  try {
    const tok = await fetchJson<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", body });
    return { ...secret, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000 };
  } catch (err) {
    if (err instanceof HttpError && err.status === 400 && err.body?.includes("invalid_grant")) {
      throw new NeedsReauth("Google access was revoked or expired. Reconnect this account in Settings → Connections.");
    }
    throw err;
  }
}

function api<T>(token: string, url: string): Promise<T> {
  return fetchJson<T>(url, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 });
}

// ---------- Gmail ----------

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

function decodeB64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export function extractBody(part: GmailPart | undefined): string {
  if (!part) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename) return; // attachment
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decodeB64Url(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(decodeB64Url(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(part);
  if (plain.length) return plain.join("\n").trim();
  return htmlToText(html.join("\n"));
}

function header(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** "Jane Doe <jane@x.com>" → "Jane Doe" */
function displayName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(from);
  if (m) return m[1].trim() || m[2];
  return from.trim();
}

function matchesRules(from: string, subject: string, body: string, rules: { emailFrom: string[]; keywords: string[] }) {
  const f = from.toLowerCase();
  const text = `${subject}\n${body}`.toLowerCase();
  return (
    rules.emailFrom.some((s) => s.trim() && f.includes(s.trim().toLowerCase())) ||
    rules.keywords.some((k) => k.trim() && text.includes(k.trim().toLowerCase()))
  );
}

async function syncGmail(ctx: SyncContext, token: string): Promise<{ newCount: number; newItems: Awaited<ReturnType<typeof upsertItems>> }> {
  const email = ctx.conn.account ?? "";
  const window = ctx.backfill ? "newer_than:5d" : "newer_than:2d";
  const q = encodeURIComponent(`${window} -in:chats -in:sent -category:promotions -category:social`);
  const list = await api<{ messages?: { id: string }[] }>(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=40`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const known = ids.length
    ? new Set(
        (
          await sql<{ external_id: string }[]>`
            select external_id from items where connection_id = ${ctx.conn.id} and source = 'gmail' and external_id in ${sql(ids)}`
        ).map((r) => r.external_id),
      )
    : new Set<string>();
  const fresh = ids.filter((id) => !known.has(id));

  const messages = await mapLimit(fresh, 5, (id) =>
    api<GmailMessage>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`).catch(() => null),
  );

  const rules = ctx.settings.notifications.rules;
  const inputs: ItemInput[] = [];
  const ruleHits = new Set<string>();
  for (const msg of messages) {
    if (!msg) continue;
    const from = header(msg, "From") ?? "";
    const subject = header(msg, "Subject") ?? "(no subject)";
    const body = extractBody(msg.payload) || msg.snippet || "";
    const labels = msg.labelIds ?? [];
    const course = courseKey(subject);
    const isClass = isClassSender(from) || course !== null;
    if (matchesRules(from, subject, body, rules)) ruleHits.add(msg.id);
    inputs.push({
      source: "gmail",
      kind: "email",
      externalId: msg.id,
      title: subject,
      body: body.slice(0, 12000),
      author: displayName(from),
      url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#all/${msg.id}`,
      course,
      account: email,
      occurredAt: new Date(Number(msg.internalDate ?? Date.now())),
      isUnread: labels.includes("UNREAD"),
      isClass,
      importance: labels.includes("IMPORTANT") ? 2 : 1,
      aiStatus: ctx.settings.ai.enabled && ctx.settings.ai.processEmail ? "pending" : "skipped",
      aiMeta: { from, labels, threadId: msg.threadId, ruleMatch: ruleHits.has(msg.id) },
    });
  }
  const newItems = await upsertItems(ctx.conn.id, inputs);

  // Keep unread state fresh for the last week of mail.
  const unread = await api<{ messages?: { id: string }[] }>(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent("is:unread newer_than:7d")}&maxResults=200`,
  );
  const unreadIds = (unread.messages ?? []).map((m) => m.id);
  await sql`
    update items set is_unread = (external_id = any(${unreadIds}::text[]))
    where connection_id = ${ctx.conn.id} and source = 'gmail' and occurred_at > now() - interval '8 days'`;

  return { newCount: newItems.length, newItems };
}

// ---------- Calendar ----------

type CalListEntry = { id: string; summary: string; backgroundColor?: string; selected?: boolean; hidden?: boolean; primary?: boolean };
type CalEvent = {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

async function syncCalendar(ctx: SyncContext, token: string): Promise<number> {
  const tz = ctx.settings.timezone;
  const from = new Date(ctx.now.getTime() - 2 * 86_400_000);
  const to = new Date(ctx.now.getTime() + 35 * 86_400_000);
  const cals = await api<{ items: CalListEntry[] }>(token, "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader");
  // Every calendar is synced; which ones show on the dashboard is a per-calendar toggle (Settings → Calendars).
  // Calendars you'd unchecked in Google Calendar start out hidden.
  const chosen = cals.items;
  const calId = (c: CalListEntry) => `${ctx.conn.id}:${c.id}`;
  const calName = (c: CalListEntry) => (c.primary ? `${ctx.conn.account ?? "Calendar"}` : c.summary);
  const startHidden = await syncCalendarList(
    ctx.conn.id,
    chosen.map((c) => ({ id: calId(c), name: calName(c), color: c.backgroundColor ?? null, account: ctx.conn.account, hiddenByDefault: c.selected === false || !!c.hidden })),
  );
  if (startHidden.length) await hideCalendars(startHidden);

  const events: EventInput[] = [];
  await mapLimit(chosen, 4, async (cal) => {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    const res = await api<{ items: CalEvent[] }>(
      token,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
    ).catch(() => ({ items: [] as CalEvent[] }));
    for (const e of res.items) {
      if (e.status === "cancelled" || e.eventType === "workingLocation" || !e.start) continue;
      const allDay = !!e.start.date;
      const startsAt = allDay ? zonedToUtc(e.start.date!, "00:00", tz) : new Date(e.start.dateTime!);
      const endsAt = e.end ? (e.end.date ? zonedToUtc(e.end.date, "00:00", tz) : new Date(e.end.dateTime!)) : null;
      events.push({
        externalId: `${cal.id}:${e.id}`,
        calendarId: calId(cal),
        calendar: cal.primary ? "Calendar" : cal.summary,
        title: e.summary ?? "(busy)",
        location: e.location ?? null,
        description: e.description ? htmlToText(e.description) : null,
        url: e.htmlLink ?? null,
        startsAt,
        endsAt,
        allDay,
        color: cal.backgroundColor ?? null,
      });
    }
  });
  await replaceEvents(ctx.conn.id, "gcal", from, to, events);
  return events.length;
}

// ---------- Drive ----------

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  iconLink?: string;
  lastModifyingUser?: { displayName?: string; me?: boolean };
  sharingUser?: { displayName?: string };
  sharedWithMeTime?: string;
};

async function syncDrive(ctx: SyncContext, token: string): Promise<number> {
  const fields = "files(id,name,mimeType,modifiedTime,webViewLink,iconLink,lastModifyingUser(displayName,me),sharingUser(displayName),sharedWithMeTime)";
  const base = "https://www.googleapis.com/drive/v3/files";
  const recent = await api<{ files: DriveFile[] }>(
    token,
    `${base}?pageSize=20&orderBy=modifiedTime desc&q=${encodeURIComponent("trashed = false and mimeType != 'application/vnd.google-apps.folder'")}&fields=${fields}`,
  );
  const shared = await api<{ files: DriveFile[] }>(
    token,
    `${base}?pageSize=10&orderBy=sharedWithMeTime desc&q=${encodeURIComponent("sharedWithMe = true and trashed = false")}&fields=${fields}`,
  ).catch(() => ({ files: [] as DriveFile[] }));

  const seen = new Set<string>();
  const inputs: ItemInput[] = [];
  for (const [f, isShared] of [...recent.files.map((f) => [f, false] as const), ...shared.files.map((f) => [f, true] as const)]) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    inputs.push({
      source: "drive",
      kind: "file",
      externalId: f.id,
      title: f.name,
      author: isShared ? f.sharingUser?.displayName ?? null : f.lastModifyingUser?.me ? "You" : f.lastModifyingUser?.displayName ?? null,
      url: f.webViewLink ?? null,
      account: ctx.conn.account,
      occurredAt: new Date(isShared && f.sharedWithMeTime ? f.sharedWithMeTime : f.modifiedTime),
      aiStatus: "skipped",
      aiMeta: { mimeType: f.mimeType, shared: isShared, iconLink: f.iconLink },
    });
  }
  await upsertItems(ctx.conn.id, inputs);
  return inputs.length;
}

/** Turns Google API errors into a next step you can act on. */
export function explainGoogleError(part: string, err: unknown): string {
  const body = err instanceof HttpError ? err.body ?? "" : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (/accessNotConfigured|has not been used in project|SERVICE_DISABLED/i.test(body + msg)) {
    const api = part === "Gmail" ? "Gmail API" : part === "Calendar" ? "Google Calendar API" : "Google Drive API";
    return `the ${api} isn't enabled in your Google Cloud project. Enable it under APIs & Services → Library, wait a minute, then press Sync.`;
  }
  if (err instanceof HttpError && err.status === 403 && /insufficient|scope/i.test(body)) {
    return "this account didn't grant access. Reconnect it and tick every permission on Google's consent screen.";
  }
  return msg.slice(0, 200);
}

// ---------- Adapter ----------

export const google: SourceAdapter = {
  intervalMinutes: 10,
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const conn: Connection = ctx.conn;
    const stored = readSecret<GoogleSecret>(conn);
    if (!stored) throw new NeedsReauth("Missing Google credentials; reconnect this account.");
    const secret = await accessToken(stored);
    const token = secret.access_token!;
    const cfg = { gmail: true, calendar: true, drive: true, ...conn.config };
    const counts: Record<string, number> = {};
    const result: SyncResult = { secret, counts, newItems: [] };

    const parts: [string, Promise<void>][] = [];
    if (cfg.gmail)
      parts.push([
        "Gmail",
        syncGmail(ctx, token).then((r) => {
          counts.newEmails = r.newCount;
          result.newItems!.push(...r.newItems);
        }),
      ]);
    if (cfg.calendar) parts.push(["Calendar", syncCalendar(ctx, token).then((n) => void (counts.events = n))]);
    // Drive changes slowly; refresh it at most every 30 minutes.
    const lastDrive = Number(conn.cursor.lastDriveSync ?? 0);
    if (cfg.drive && Date.now() - lastDrive > 30 * 60_000) {
      parts.push(["Drive", syncDrive(ctx, token).then((n) => void (counts.files = n))]);
      result.cursor = { ...conn.cursor, lastDriveSync: Date.now() };
    }
    const settled = await Promise.allSettled(parts.map(([, p]) => p));
    const failed = settled
      .map((s, i) => (s.status === "rejected" ? `${parts[i][0]}: ${explainGoogleError(parts[i][0], s.reason)}` : null))
      .filter((x): x is string => !!x);
    if (failed.length && failed.length === parts.length) throw new Error(failed.join(" · "));
    if (failed.length) result.warning = failed.join(" · ");
    return result;
  },
};

export { NeedsReauth };

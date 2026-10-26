import "server-only";
import { sql } from "../db";
import { sha256 } from "../crypto";
import { mapLimit } from "../http";
import { readSecret, upsertItems, type ItemInput } from "../store";
import type { SourceAdapter, SyncContext, SyncResult } from "./types";

// Slack, one connection per workspace, using a user token (xoxp-...) from a Slack app you
// create inside that workspace (manifest in SETUP.md). Reads: chosen announcement channels,
// @-mentions, and which DMs are waiting on your reply.

type SlackSecret = { token: string };
type SlackMsg = { ts: string; user?: string; bot_id?: string; username?: string; text?: string; subtype?: string; thread_ts?: string };

export async function slackApi<T>(token: string, method: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.status === 429) {
      const wait = Math.min(10, Number(res.headers.get("retry-after") ?? 2));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const data = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
    return data;
  }
  throw new Error(`Slack ${method}: rate limited`);
}

export async function listSlackChannels(token: string): Promise<{ id: string; name: string; is_private: boolean }[]> {
  const out: { id: string; name: string; is_private: boolean }[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const res = await slackApi<{ channels: { id: string; name: string; is_private: boolean; is_member?: boolean }[]; response_metadata?: { next_cursor?: string } }>(
      token,
      "users.conversations",
      { types: "public_channel,private_channel", exclude_archived: "true", limit: 500, ...(cursor ? { cursor } : {}) },
    );
    out.push(...res.channels.map((c) => ({ id: c.id, name: c.name, is_private: c.is_private })));
    cursor = res.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Turns Slack mrkdwn into plain text: <@U1> → @Name, <#C1|general> → #general, <url|label> → label. */
export function cleanSlackText(text: string, names: Record<string, string>): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => `@${names[id] ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, "$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export const slack: SourceAdapter = {
  intervalMinutes: 10,
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const secret = readSecret<SlackSecret>(ctx.conn);
    if (!secret?.token) throw new Error("Missing Slack token.");
    const token = secret.token;
    const cursor = { ...ctx.conn.cursor } as {
      names?: Record<string, string>;
      lastTs?: Record<string, string>;
      imState?: Record<string, { ts: string; fromMe: boolean; unanswered: number; firstTs: string }>;
      imOffset?: number;
    };
    const names: Record<string, string> = { ...(cursor.names ?? {}) };

    const auth = await slackApi<{ user_id: string; team: string; url: string }>(token, "auth.test");
    const me = auth.user_id;
    const teamUrl = auth.url.replace(/\/$/, "");
    const permalink = (channel: string, ts: string) => `${teamUrl}/archives/${channel}/p${ts.replace(".", "")}`;

    const resolveName = async (id?: string): Promise<string> => {
      if (!id) return "Unknown";
      if (names[id]) return names[id];
      try {
        const res = await slackApi<{ user: { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } } }>(token, "users.info", { user: id });
        names[id] = res.user.profile?.display_name || res.user.real_name || res.user.profile?.real_name || res.user.name || id;
      } catch {
        names[id] = id;
      }
      return names[id];
    };

    const items: ItemInput[] = [];
    const lookbackSec = Math.floor(ctx.now.getTime() / 1000) - 7 * 86_400;

    // 1. Announcement channels you picked in Settings.
    const channels: { id: string; name: string }[] = ctx.conn.config.channels ?? [];
    const lastTs = { ...(cursor.lastTs ?? {}) };
    await mapLimit(channels, 3, async (ch) => {
      const oldest = lastTs[ch.id] ?? String(lookbackSec);
      const res = await slackApi<{ messages: SlackMsg[] }>(token, "conversations.history", { channel: ch.id, oldest, limit: 30 }).catch(
        () => ({ messages: [] as SlackMsg[] }),
      );
      for (const m of res.messages) {
        if (m.subtype && !["bot_message", "thread_broadcast"].includes(m.subtype)) continue;
        if (!m.text?.trim()) continue;
        const author = m.user ? await resolveName(m.user) : m.username ?? "bot";
        items.push({
          source: "slack",
          kind: "announcement",
          externalId: `${ch.id}:${m.ts}`,
          title: cleanSlackText(m.text, names).split("\n")[0].slice(0, 160),
          body: cleanSlackText(m.text, names).slice(0, 6000),
          author,
          url: permalink(ch.id, m.ts),
          channel: `#${ch.name}`,
          account: auth.team,
          occurredAt: new Date(Number(m.ts) * 1000),
          importance: 1,
          aiStatus: ctx.settings.ai.enabled && ctx.settings.ai.processSlack ? "pending" : "skipped",
        });
        if (!lastTs[ch.id] || Number(m.ts) > Number(lastTs[ch.id])) lastTs[ch.id] = m.ts;
      }
    });

    // 2. Messages that @-mention you anywhere in the workspace.
    try {
      const res = await slackApi<{ messages: { matches: (SlackMsg & { channel: { id: string; name?: string; is_im?: boolean }; permalink?: string })[] } }>(
        token,
        "search.messages",
        { query: `<@${me}>`, sort: "timestamp", sort_dir: "desc", count: 20 },
      );
      for (const m of res.messages.matches) {
        if (Number(m.ts) < lookbackSec || m.user === me) continue;
        items.push({
          source: "slack",
          kind: "mention",
          externalId: `${m.channel.id}:${m.ts}`,
          title: cleanSlackText(m.text ?? "", names).split("\n")[0].slice(0, 160),
          body: cleanSlackText(m.text ?? "", names).slice(0, 4000),
          author: m.user ? await resolveName(m.user) : m.username ?? null,
          url: m.permalink ?? permalink(m.channel.id, m.ts),
          channel: m.channel.is_im ? "DM" : m.channel.name ? `#${m.channel.name}` : null,
          account: auth.team,
          occurredAt: new Date(Number(m.ts) * 1000),
          importance: 2,
          aiStatus: ctx.settings.ai.enabled && ctx.settings.ai.processSlack ? "pending" : "skipped",
        });
      }
    } catch {
      // search:read missing or search unavailable on this workspace — skip mentions.
    }

    // 3. DMs where the other person spoke last (who you owe a reply).
    const imState = { ...(cursor.imState ?? {}) };
    const ims = await slackApi<{ channels: { id: string; user: string; is_user_deleted?: boolean; updated?: number }[] }>(token, "conversations.list", {
      types: "im",
      exclude_archived: "true",
      limit: 300,
    }).catch(() => ({ channels: [] }));
    const live = ims.channels.filter((c) => !c.is_user_deleted && c.user !== "USLACKBOT" && c.user !== me);
    const byRecent = [...live].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    const offset = cursor.imOffset ?? 0;
    const rotating = live.slice(offset, offset + 10);
    const toScan = [...new Map([...byRecent.slice(0, 15), ...rotating].map((c) => [c.id, c])).values()];
    cursor.imOffset = live.length ? (offset + 10) % live.length : 0;

    await mapLimit(toScan, 3, async (im) => {
      const res = await slackApi<{ messages: SlackMsg[] }>(token, "conversations.history", { channel: im.id, limit: 10 }).catch(() => null);
      if (!res) return;
      const msgs = res.messages.filter((m) => !m.subtype || m.subtype === "file_share");
      if (!msgs.length) return;
      const latest = msgs[0];
      let unanswered = 0;
      let firstTs = latest.ts;
      for (const m of msgs) {
        if (m.user === me) break;
        unanswered++;
        firstTs = m.ts;
      }
      imState[im.id] = { ts: latest.ts, fromMe: latest.user === me, unanswered, firstTs };
    });

    const replyLookback = ctx.now.getTime() / 1000 - ctx.settings.replyQueue.lookbackDays * 86_400;
    const waiting = live.filter((c) => {
      const s = imState[c.id];
      return s && !s.fromMe && Number(s.ts) > replyLookback;
    });
    await sql.begin(async (tx) => {
      await tx`delete from reply_waiting where connection_id = ${ctx.conn.id}`;
      for (const c of waiting) {
        const s = imState[c.id];
        const name = await resolveName(c.user);
        await tx`
          insert into reply_waiting (id, connection_id, source, name, waiting_since, unanswered, url, state_hash)
          values (${`slack:${c.id}`}, ${ctx.conn.id}, 'slack', ${name}, ${new Date(Number(s.firstTs) * 1000)}, ${s.unanswered},
                  ${permalink(c.id, s.ts)}, ${sha256(`slack:${c.id}:${s.ts}`)})`;
      }
    });

    const newItems = await upsertItems(ctx.conn.id, items);
    // Cap the name cache so the cursor stays small.
    const trimmedNames = Object.fromEntries(Object.entries(names).slice(-800));
    return {
      newItems,
      account: auth.team,
      counts: { announcements: items.filter((i) => i.kind === "announcement").length, mentions: items.filter((i) => i.kind === "mention").length, waiting: waiting.length },
      cursor: { ...cursor, names: trimmedNames, lastTs, imState },
    };
  },
};

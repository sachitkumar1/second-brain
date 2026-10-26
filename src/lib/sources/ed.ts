import "server-only";
import { courseKey } from "../courses";
import { fetchJson, mapLimit } from "../http";
import { readSecret, upsertItems, type ItemInput } from "../store";
import type { SourceAdapter, SyncContext, SyncResult } from "./types";

// Ed Discussion. Auth: an API token from edstem.org → Settings → API Tokens.

type EdSecret = { token: string };
type EdCourse = { id: number; code: string; name: string; status: string; year?: string; session?: string };
type EdUser = { id: number; name: string; course_role?: string };
type EdThread = {
  id: number;
  number?: number;
  user_id: number;
  course_id: number;
  type: "post" | "question" | "announcement";
  title: string;
  document?: string;
  category?: string;
  is_pinned?: boolean;
  is_private?: boolean;
  is_seen?: boolean;
  created_at: string;
};

const STAFF_ROLES = new Set(["staff", "admin", "tutor", "instructor"]);

export const ed: SourceAdapter = {
  intervalMinutes: 15,
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const secret = readSecret<EdSecret>(ctx.conn);
    if (!secret?.token) throw new Error("Missing Ed API token.");
    const region = String(ctx.conn.config.region ?? "us");
    const api = `https://${region}.edstem.org/api`;
    const headers = { Authorization: `Bearer ${secret.token}` };

    const me = await fetchJson<{ user: { id: number; name: string }; courses: { course: EdCourse }[] }>(`${api}/user`, { headers });
    const hidden = new Set(ctx.settings.hiddenCourses);
    const courses = me.courses
      .map((c) => c.course)
      .filter((c) => c.status === "active")
      .map((c) => ({ ...c, label: courseKey(c.code) ?? courseKey(c.name) ?? c.code }))
      .filter((c) => !hidden.has(c.label));

    const items: ItemInput[] = [];
    await mapLimit(courses, 3, async (c) => {
      const res = await fetchJson<{ threads: EdThread[]; users: EdUser[] }>(
        `${api}/courses/${c.id}/threads?limit=40&sort=new`,
        { headers },
      ).catch(() => ({ threads: [] as EdThread[], users: [] as EdUser[] }));
      const users = new Map(res.users.map((u) => [u.id, u]));
      for (const t of res.threads) {
        const author = users.get(t.user_id);
        const byStaff = STAFF_ROLES.has(author?.course_role ?? "");
        const isAnnouncement = t.type === "announcement";
        if (!isAnnouncement && !byStaff && !t.is_pinned) continue;
        items.push({
          source: "ed",
          kind: isAnnouncement ? "announcement" : "post",
          externalId: String(t.id),
          title: t.title,
          body: (t.document ?? "").slice(0, 8000),
          author: author?.name ?? null,
          url: `https://edstem.org/${region}/courses/${c.id}/discussion/${t.id}`,
          course: c.label,
          channel: t.category ?? null,
          occurredAt: new Date(t.created_at),
          isUnread: t.is_seen === false,
          isClass: true,
          importance: isAnnouncement ? 2 : 1,
          aiStatus: ctx.settings.ai.enabled ? "pending" : "skipped",
        });
      }
    });

    const newItems = await upsertItems(ctx.conn.id, items);
    return {
      newItems,
      account: me.user.name,
      counts: { courses: courses.length, threads: items.length },
      cursor: { ...ctx.conn.cursor, courses: courses.map((c) => ({ id: c.id, name: c.label })) },
    };
  },
};

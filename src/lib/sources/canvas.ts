import "server-only";
import { courseKey } from "../courses";
import { fetchOk, htmlToText } from "../http";
import { readSecret, upsertAssignments, upsertItems, type AssignmentInput, type ItemInput } from "../store";
import { upsertSyllabusSource } from "../syllabus";
import type { SourceAdapter, SyncContext, SyncResult } from "./types";

// Canvas LMS (bCourses at Berkeley). Auth: a personal access token from
// bCourses → Account → Settings → "+ New Access Token".

type CanvasSecret = { token: string };

type Course = {
  id: number;
  name: string;
  course_code?: string;
  syllabus_body?: string | null;
  access_restricted_by_date?: boolean;
  term?: { name?: string; end_at?: string | null };
};

type PlannerItem = {
  course_id?: number;
  plannable_id: number;
  plannable_type: string;
  plannable_date?: string;
  plannable: { title?: string; due_at?: string | null; todo_date?: string | null; points_possible?: number | null };
  submissions?: false | { submitted?: boolean; excused?: boolean; graded?: boolean; missing?: boolean; late?: boolean };
  planner_override?: { marked_complete?: boolean; dismissed?: boolean } | null;
  html_url?: string;
  context_name?: string;
};

type Announcement = {
  id: number;
  title: string;
  message?: string;
  posted_at?: string;
  html_url?: string;
  context_code?: string;
  author?: { display_name?: string };
};

type StreamEntry = {
  id: number;
  type: string;
  title?: string;
  message?: string;
  html_url?: string;
  course_id?: number;
  updated_at?: string;
  created_at?: string;
  score?: number | null;
  grade?: string | null;
  graded_at?: string | null;
  assignment?: { name?: string; points_possible?: number | null };
};

function baseUrl(ctx: SyncContext): string {
  return String(ctx.conn.config.baseUrl ?? "https://bcourses.berkeley.edu").replace(/\/$/, "");
}

async function getAll<T>(url: string, token: string, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < maxPages; page++) {
    const res: Response = await fetchOk(next, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 20_000 });
    out.push(...((await res.json()) as T[]));
    const link = res.headers.get("link") ?? "";
    next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
  }
  return out;
}

const abs = (base: string, path?: string) => (path ? (path.startsWith("http") ? path : `${base}${path}`) : null);

export const canvas: SourceAdapter = {
  intervalMinutes: 20,
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const secret = readSecret<CanvasSecret>(ctx.conn);
    if (!secret?.token) throw new Error("Missing Canvas access token.");
    const base = baseUrl(ctx);
    const token = secret.token;
    const now = ctx.now;

    const courses = (await getAll<Course>(`${base}/api/v1/courses?enrollment_state=active&per_page=100&include[]=term&include[]=syllabus_body`, token)).filter(
      (c) => !c.access_restricted_by_date && c.name && (!c.term?.end_at || new Date(c.term.end_at).getTime() > now.getTime() - 14 * 86_400_000),
    );
    const courseName = new Map<number, string>();
    for (const c of courses) {
      courseName.set(c.id, courseKey(c.course_code) ?? courseKey(c.name) ?? c.course_code ?? c.name);
    }
    const hidden = new Set(ctx.settings.hiddenCourses);

    // Each course's bCourses syllabus page is read by the agent for deadlines and exams (only when it changes).
    for (const c of courses) {
      const label = courseName.get(c.id) ?? null;
      if (!c.syllabus_body || (label && hidden.has(label))) continue;
      await upsertSyllabusSource({
        source: "canvas",
        ref: `${ctx.conn.id}:${c.id}`,
        connectionId: ctx.conn.id,
        course: label,
        title: `${label ?? c.name} syllabus (bCourses)`,
        url: `${base}/courses/${c.id}/assignments/syllabus`,
        text: htmlToText(c.syllabus_body),
      });
    }

    // Assignments, quizzes, discussions with due dates — the planner API returns them with submission state.
    const start = new Date(now.getTime() - 21 * 86_400_000).toISOString();
    const end = new Date(now.getTime() + 90 * 86_400_000).toISOString();
    const planner = await getAll<PlannerItem>(
      `${base}/api/v1/planner/items?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100`,
      token,
      8,
    );
    const assignments: AssignmentInput[] = [];
    for (const p of planner) {
      if (!["assignment", "quiz", "discussion_topic", "sub_assignment", "wiki_page"].includes(p.plannable_type)) continue;
      const due = p.plannable.due_at ?? p.plannable.todo_date ?? p.plannable_date ?? null;
      if (!due) continue;
      const course = (p.course_id && courseName.get(p.course_id)) || courseKey(p.context_name) || p.context_name || null;
      if (course && hidden.has(course)) continue;
      const subs = p.submissions || undefined;
      const done = !!(subs?.submitted || subs?.excused || p.planner_override?.marked_complete);
      assignments.push({
        source: "canvas",
        externalId: `${p.plannable_type}:${p.plannable_id}`,
        title: p.plannable.title ?? "Untitled",
        course,
        url: abs(base, p.html_url),
        dueAt: new Date(due),
        submitted: done,
        notes: p.plannable.points_possible ? `${p.plannable.points_possible} pts` : null,
      });
    }
    const newAssignments = await upsertAssignments(ctx.conn.id, assignments);

    // Announcements from the last 3 weeks.
    const items: ItemInput[] = [];
    if (courses.length) {
      const codes = courses.map((c) => `context_codes[]=course_${c.id}`).join("&");
      const since = new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10);
      const anns = await getAll<Announcement>(`${base}/api/v1/announcements?${codes}&start_date=${since}&per_page=50`, token, 3);
      for (const a of anns) {
        const cid = Number(a.context_code?.replace("course_", ""));
        const course = courseName.get(cid) ?? null;
        if (course && hidden.has(course)) continue;
        items.push({
          source: "canvas",
          kind: "announcement",
          externalId: `ann:${a.id}`,
          title: a.title,
          body: htmlToText(a.message).slice(0, 8000),
          author: a.author?.display_name ?? null,
          url: a.html_url ?? null,
          course,
          occurredAt: new Date(a.posted_at ?? now),
          isClass: true,
          importance: 2,
          aiStatus: ctx.settings.ai.enabled ? "pending" : "skipped",
        });
      }
    }

    // Grades and Canvas inbox messages from the activity stream.
    const stream = await getAll<StreamEntry>(`${base}/api/v1/users/self/activity_stream?per_page=50`, token, 1).catch(() => []);
    for (const e of stream) {
      const course = (e.course_id && courseName.get(e.course_id)) || null;
      if (course && hidden.has(course)) continue;
      if (e.type === "Submission" && (e.score != null || e.grade)) {
        const name = e.assignment?.name ?? e.title ?? "Assignment";
        const pts = e.assignment?.points_possible;
        const scoreText = e.score != null ? `${e.score}${pts ? ` / ${pts}` : ""}` : String(e.grade);
        items.push({
          source: "canvas",
          kind: "grade",
          externalId: `grade:${e.id}:${e.graded_at ?? e.updated_at ?? ""}`,
          title: `Graded: ${name}`,
          body: `Score: ${scoreText}`,
          url: abs(base, e.html_url),
          course,
          occurredAt: new Date(e.graded_at ?? e.updated_at ?? now),
          isClass: true,
          importance: 1,
          aiStatus: "skipped",
          aiMeta: { score: scoreText },
        });
      } else if (e.type === "Conversation") {
        items.push({
          source: "canvas",
          kind: "message",
          externalId: `conv:${e.id}:${e.updated_at ?? ""}`,
          title: e.title || "bCourses message",
          body: htmlToText(e.message).slice(0, 6000),
          url: abs(base, e.html_url),
          course,
          occurredAt: new Date(e.updated_at ?? e.created_at ?? now),
          isClass: true,
          isUnread: true,
          importance: 2,
          aiStatus: ctx.settings.ai.enabled ? "pending" : "skipped",
        });
      }
    }
    const newItems = await upsertItems(ctx.conn.id, items);

    return {
      newItems,
      newAssignments,
      counts: { courses: courses.length, assignments: assignments.length, items: items.length },
      cursor: { ...ctx.conn.cursor, courses: courses.map((c) => ({ id: c.id, name: courseName.get(c.id) })) },
    };
  },
};

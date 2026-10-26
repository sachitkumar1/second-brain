import "server-only";
import * as cheerio from "cheerio";
import { courseKey } from "../courses";
import { mapLimit } from "../http";
import { readSecret, upsertAssignments, upsertItems, type AssignmentInput, type ItemInput } from "../store";
import type { SourceAdapter, SyncContext, SyncResult } from "./types";

// Gradescope has no public API, so this signs in like a browser and reads your course pages.
// Berkeley accounts use CalNet SSO; set a Gradescope password once via "Forgot password"
// on gradescope.com (same email) so this connector can sign in.

const BASE = "https://www.gradescope.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

type GsSecret = { email: string; password: string };

class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function get(jar: CookieJar, path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: jar.header(), "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  jar.absorb(res);
  if (!res.ok) throw new Error(`Gradescope ${path} responded ${res.status}`);
  return res.text();
}

async function login(secret: GsSecret): Promise<CookieJar> {
  const jar = new CookieJar();
  const page = await get(jar, "/login");
  const $ = cheerio.load(page);
  const token = $('form input[name="authenticity_token"]').attr("value") ?? $('meta[name="csrf-token"]').attr("content");
  if (!token) throw new Error("Could not find Gradescope's login form (the page layout may have changed).");
  const body = new URLSearchParams({
    utf8: "✓",
    authenticity_token: token,
    "session[email]": secret.email,
    "session[password]": secret.password,
    "session[remember_me]": "0",
    commit: "Log In",
    "session[remember_me_sso]": "0",
  });
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    body,
    headers: {
      Cookie: jar.header(),
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
      Referer: `${BASE}/login`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  jar.absorb(res);
  const location = res.headers.get("location") ?? "";
  if (res.status >= 300 && res.status < 400 && !location.includes("/login")) return jar;
  throw new Error("Gradescope sign-in failed. Check the email/password (set a Gradescope password via 'Forgot password' if you normally use CalNet).");
}

export type GsCourse = { id: string; shortName: string; name: string; term: string };

export function parseCourses(html: string): GsCourse[] {
  const $ = cheerio.load(html);
  const courses: GsCourse[] = [];
  const seen = new Set<string>();
  $(".courseList").each((_, list) => {
    // Terms are listed newest first; only the most recent term is "current".
    const firstTerm = $(list).find(".courseList--term").first();
    const term = firstTerm.text().trim();
    const container = firstTerm.nextAll(".courseList--coursesForTerm").first();
    container.find("a.courseBox").each((__, a) => {
      const href = $(a).attr("href") ?? "";
      const id = /\/courses\/(\d+)/.exec(href)?.[1];
      if (!id || seen.has(id)) return;
      seen.add(id);
      courses.push({
        id,
        shortName: $(a).find(".courseBox--shortname").text().trim(),
        name: $(a).find(".courseBox--name").text().trim(),
        term,
      });
    });
  });
  return courses;
}

/** "2026-10-28 23:59:00 -0700" → Date */
export function parseGsDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})$/.exec(s.trim());
  const d = m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type GsAssignment = { id: string; title: string; url: string | null; due: Date | null; submitted: boolean; score: string | null };

export function parseAssignments(html: string, courseId: string): GsAssignment[] {
  const $ = cheerio.load(html);
  const out: GsAssignment[] = [];
  $("#assignments-student-table tbody tr").each((_, tr) => {
    const row = $(tr);
    const head = row.find("th").first();
    const link = head.find("a").first();
    const button = head.find("button[data-assignment-id]").first();
    const title = (link.text() || button.attr("data-assignment-title") || button.text() || head.text()).trim();
    if (!title) return;
    const href = link.attr("href");
    const id = /assignments\/(\d+)/.exec(href ?? "")?.[1] ?? button.attr("data-assignment-id") ?? `${courseId}:${title}`;
    const status = row.find(".submissionStatus").text().replace(/\s+/g, " ").trim();
    const score = row.find(".submissionStatus--score").text().replace(/\s+/g, " ").trim() || null;
    const dueEl = row.find("time.submissionTimeChart--dueDate, [class*='dueDate'][datetime]").first();
    out.push({
      id,
      title,
      url: href ? `${BASE}${href}` : `${BASE}/courses/${courseId}`,
      due: parseGsDate(dueEl.attr("datetime")),
      submitted: !!score || /submitted|graded/i.test(status),
      score,
    });
  });
  return out;
}

export const gradescope: SourceAdapter = {
  intervalMinutes: 60,
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const secret = readSecret<GsSecret>(ctx.conn);
    if (!secret?.email || !secret.password) throw new Error("Missing Gradescope email/password.");
    const jar = await login(secret);
    const courses = parseCourses(await get(jar, "/account"));
    const hidden = new Set(ctx.settings.hiddenCourses);

    const assignments: AssignmentInput[] = [];
    const grades: ItemInput[] = [];
    await mapLimit(courses, 3, async (c) => {
      const label = courseKey(c.shortName) ?? courseKey(c.name) ?? c.shortName;
      if (hidden.has(label)) return;
      const list = parseAssignments(await get(jar, `/courses/${c.id}`), c.id);
      for (const a of list) {
        if (a.due) {
          assignments.push({
            source: "gradescope",
            externalId: a.id,
            title: a.title,
            course: label,
            url: a.url,
            dueAt: a.due,
            submitted: a.submitted,
            score: a.score,
          });
        }
        if (a.score) {
          grades.push({
            source: "gradescope",
            kind: "grade",
            externalId: `grade:${a.id}:${a.score}`,
            title: `Graded: ${a.title}`,
            body: `Score: ${a.score}`,
            url: a.url,
            course: label,
            occurredAt: ctx.now,
            isClass: true,
            importance: 1,
            aiStatus: "skipped",
            aiMeta: { score: a.score },
          });
        }
      }
    });

    const newAssignments = await upsertAssignments(ctx.conn.id, assignments);
    const newItems = await upsertItems(ctx.conn.id, grades);
    return {
      newAssignments,
      newItems,
      counts: { courses: courses.length, assignments: assignments.length },
      cursor: { ...ctx.conn.cursor, courses: courses.map((c) => ({ id: c.id, name: c.shortName, term: c.term })) },
    };
  },
};

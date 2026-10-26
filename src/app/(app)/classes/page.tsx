import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CalendarDays, GraduationCap, ScrollText } from "lucide-react";
import { Feed } from "@/components/Feed";
import { SyllabusPanel } from "@/components/SyllabusPanel";
import { TaskRow } from "@/components/TaskRow";
import { cx, Empty, Widget } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { courseColor, courseKey, courseLabel } from "@/lib/courses";
import { getCourseData, getCourses } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { datesBySyllabus, listSyllabi, unreadWebsites } from "@/lib/syllabus";
import { aiAvailable } from "@/lib/agent/ai";
import { fmtAgo, fmtDue } from "@/lib/time";
import { toItemView, toTaskView } from "@/lib/views";

export const dynamic = "force-dynamic";
// Server actions on this page (sync now, connect account, run agent) can take up to a minute.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Classes" };

const scoreOf = (g: { ai_meta: Record<string, unknown> | null; body: string | null }) =>
  String(g.ai_meta?.score ?? g.body?.replace(/^Score:\s*/, "") ?? "");

export default async function ClassesPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  await requireSession();
  const { course: selected = null } = await searchParams;
  const settings = await getSettings();
  const tz = settings.timezone;
  const aliases = settings.courseAliases;
  const now = new Date();
  const courses = (await getCourses()).filter((c) => !settings.hiddenCourses.includes(c));
  const { tasks, items } = await getCourseData(selected);
  const [syllabi, dates, unread] = await Promise.all([listSyllabi(), datesBySyllabus(), unreadWebsites()]);
  const highlights = selected
    ? syllabi.filter((s) => s.status === "done" && (courseKey(s.course) ?? s.course) === selected).flatMap((s) => s.highlights.map((h) => ({ h, from: s.title })))
    : [];
  const keyOf = (c: string | null) => (c ? courseKey(c) ?? c : null);

  const open = tasks.filter((t) => t.status === "open" && t.due_at && new Date(t.due_at).getTime() > now.getTime() - 7 * 86_400_000);
  const finished = tasks.filter((t) => t.status !== "open" || t.submitted).slice(-15).reverse();
  const grades = items.filter((i) => i.kind === "grade");
  const updates = items.filter((i) => i.kind !== "grade");

  const chip = (label: string, href: string, active: boolean, color?: string) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink",
      )}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />}
      {label}
    </Link>
  );

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Classes</h1>
        <p className="mt-0.5 text-sm text-muted">Assignments, announcements and grades from bCourses, Gradescope, Ed and your course websites.</p>
      </div>
      <nav aria-label="Courses" className="scroll-quiet mb-5 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 ring-1 ring-line-2">
        {chip("All classes", "/classes", !selected)}
        {courses.map((c) => chip(courseLabel(c, aliases) ?? c, `/classes?course=${encodeURIComponent(c)}`, selected === c, courseColor(c)))}
      </nav>

      {!selected && courses.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {courses.map((c) => {
            const mine = tasks.filter((t) => keyOf(t.course) === c);
            const next = mine.filter((t) => t.status === "open" && t.due_at && new Date(t.due_at) > now).sort((a, b) => +new Date(a.due_at!) - +new Date(b.due_at!))[0];
            const unread = items.filter((i) => keyOf(i.course) === c && i.is_unread).length;
            const lastGrade = items.find((i) => keyOf(i.course) === c && i.kind === "grade");
            return (
              <Link key={c} href={`/classes?course=${encodeURIComponent(c)}`} className="group min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-ink/20">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: courseColor(c) }} aria-hidden />
                  <span className="font-semibold tracking-tight">{courseLabel(c, aliases)}</span>
                  {unread > 0 && <span className="ml-auto rounded-full bg-gold-soft px-2 py-px text-[11px] font-semibold text-ink ring-1 ring-gold/40">{unread} new</span>}
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted">Next due</dt>
                    <dd className="min-w-0 truncate text-ink">{next ? `${next.title} · ${fmtDue(next.due_at!, tz, now, next.all_day)}` : "Nothing upcoming"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted">Open</dt>
                    <dd className="tabular text-ink">
                      {(() => {
                        const n = mine.filter((t) => t.status === "open" && t.due_at && new Date(t.due_at) > now).length;
                        return `${n} assignment${n === 1 ? "" : "s"}`;
                      })()}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted">Latest</dt>
                    <dd className="min-w-0 truncate text-ink">{lastGrade ? `${lastGrade.title.replace(/^Graded: /, "")} — ${scoreOf(lastGrade)}` : "No grades yet"}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}

      {highlights.length > 0 && (
        <Widget title="From the syllabus" icon={<ScrollText />} className="mb-4">
          <ul className="grid gap-x-8 gap-y-1.5 px-4 py-3 text-sm text-ink-2 md:grid-cols-2">
            {highlights.map(({ h, from }, i) => (
              <li key={i} className="flex gap-2" title={from}>
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
        </Widget>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Widget title={selected ? "Assignments" : "Upcoming assignments"} icon={<CalendarDays />} count={open.length}>
          {open.length ? (
            <ul className="scroll-quiet max-h-[640px] divide-y divide-line-2 overflow-y-auto">
              {open.map((t) => (
                <TaskRow key={t.id} task={toTaskView(t, tz, now, aliases)} />
              ))}
            </ul>
          ) : (
            <Empty>No open assignments.</Empty>
          )}
          {finished.length > 0 && (
            <details className="border-t border-line-2">
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-muted hover:text-ink">Submitted & done ({finished.length})</summary>
              <ul className="divide-y divide-line-2">
                {finished.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-muted line-through">{t.title}</span>
                    {t.score && <span className="tabular text-xs font-semibold text-green">{t.score}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Widget>
        <Widget title="Announcements & updates" icon={<BookOpen />} className="lg:col-span-1" count={updates.filter((u) => u.is_unread).length || null}>
          <Feed items={updates.map((i) => toItemView(i, now, aliases))} empty="No announcements yet." maxHeight={680} />
        </Widget>
        <Widget title="Grades" icon={<GraduationCap />} count={grades.length || null}>
          {grades.length ? (
            <ul className="scroll-quiet max-h-[680px] divide-y divide-line-2 overflow-y-auto">
              {grades.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: courseColor(keyOf(g.course)) }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {g.url ? (
                        <a href={g.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {g.title.replace(/^Graded: /, "")}
                        </a>
                      ) : (
                        g.title.replace(/^Graded: /, "")
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {courseLabel(g.course, aliases)} · {g.source === "gradescope" ? "Gradescope" : "bCourses"} · {fmtAgo(g.occurred_at, now)} ago
                    </p>
                  </div>
                  <span className="tabular text-sm font-semibold text-ink">{scoreOf(g)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Grades from Gradescope and bCourses show up here.</Empty>
          )}
        </Widget>
      </div>
      <Widget title="Syllabi & schedules" icon={<ScrollText />} count={syllabi.filter((s) => s.status !== "ignored").length || null} className="mt-4">
        <SyllabusPanel
          aiReady={aiAvailable()}
          unread={unread.map((u) => ({ id: u.id, label: u.label, url: u.url, course: u.course, error: u.status !== "ok" ? u.last_error : null }))}
          courses={courses}
          syllabi={syllabi.map((s) => ({
            id: s.id,
            source: s.source,
            course: courseLabel(s.course, aliases),
            title: s.title,
            url: s.url,
            status: s.status,
            error: s.error,
            itemCount: s.item_count,
            readAgo: s.extracted_at ? `${fmtAgo(s.extracted_at, now)} ago` : null,
            dates: (dates.get(s.id) ?? []).map((d) => `${d.title} — ${fmtDue(d.due_at, tz, now, d.all_day)}`),
          }))}
        />
      </Widget>
      <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted">
        Pensieve and CalCentral don&apos;t offer a way for outside apps to read your data (CalNet sign-in requires Duo), so their notification emails are picked up from Gmail
        and shown here instead. Add any course website under Settings → Connections to get alerted when it changes.
      </p>
    </>
  );
}

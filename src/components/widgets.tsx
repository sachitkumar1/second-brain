import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Presentation,
} from "lucide-react";
import type { EventRow } from "@/lib/queries";
import type { Item } from "@/lib/store";
import { addDays, fmtAgo, fmtTime, localDate, zonedParts, zonedToUtc } from "@/lib/time";
import { TaskRow, type TaskView } from "./TaskRow";
import { Badge, cx, Empty } from "./ui";

// ---------------------------------------------------------------- Daily brief

export function BriefBody({
  narrative,
  stats,
  digestTime,
  hasDigest,
}: {
  narrative: string | null;
  stats: { label: string; value: number; tone?: "red" | "gold" | "navy"; href?: string }[];
  digestTime: string;
  hasDigest: boolean;
}) {
  const lines = (narrative ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0 border-l-[3px] border-gold pl-4">
        {lines.length ? (
          <div className="space-y-1.5 text-[14px] leading-relaxed text-ink-2">
            {lines.map((l, i) =>
              /^[-•]\s/.test(l) ? (
                <p key={i} className="flex gap-2 pl-1">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-2" aria-hidden />
                  <span>{l.replace(/^[-•]\s/, "")}</span>
                </p>
              ) : /:$/.test(l) ? (
                <p key={i} className="pt-1 text-[13px] font-semibold text-ink">
                  {l}
                </p>
              ) : (
                <p key={i}>{l}</p>
              ),
            )}
          </div>
        ) : (
          <div className="text-sm text-muted">
            <p className="text-ink-2">
              {hasDigest ? "Today's digest is ready." : `Your morning brief arrives at ${digestTime}.`} It lists today&apos;s schedule, what&apos;s due, and anything
              carried over from previous days.
            </p>
            <Link href="/digest" className="mt-2 inline-flex items-center gap-1 font-semibold text-link hover:underline">
              {hasDigest ? "Open digest" : "Generate it now"} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
      <dl className="grid h-fit grid-cols-2 gap-2 self-start sm:grid-cols-4 lg:w-[440px]">
        {stats.map((s) => {
          const body = (
            <>
              <dt className="text-[11px] font-medium text-muted">{s.label}</dt>
              <dd
                className={cx(
                  "tabular mt-0.5 text-2xl font-semibold tracking-tight",
                  s.value > 0 && s.tone === "red" ? "text-red" : s.value > 0 && s.tone === "gold" ? "text-ink" : "text-ink",
                )}
              >
                {s.value}
              </dd>
            </>
          );
          const cls = cx(
            "rounded-xl border border-line-2 bg-surface-2 px-3 py-2.5",
            s.value > 0 && s.tone === "gold" && "border-gold/50 bg-gold-soft",
            s.value > 0 && s.tone === "red" && "border-red/20 bg-red-soft",
          );
          return s.href ? (
            <a key={s.label} href={s.href} className={cx(cls, "transition hover:border-line")}>
              {body}
            </a>
          ) : (
            <div key={s.label} className={cls}>
              {body}
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- Today

type AgendaEntry =
  | { type: "event"; at: Date; end: Date | null; e: EventRow }
  | { type: "task"; at: Date; t: TaskView };

export function TodayBody({ events, dueToday, now, tz }: { events: EventRow[]; dueToday: (TaskView & { at: Date })[]; now: Date; tz: string }) {
  const allDay = events.filter((e) => e.all_day);
  const entries: AgendaEntry[] = [
    ...events.filter((e) => !e.all_day).map((e) => ({ type: "event" as const, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null, e })),
    ...dueToday.map((t) => ({ type: "task" as const, at: t.at, t })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const nowIdx = entries.findIndex((x) => x.at > now);
  const markerAt = nowIdx === -1 ? entries.length : nowIdx;

  if (!entries.length && !allDay.length) return <Empty icon={<CalendarDays />}>Nothing scheduled today.</Empty>;

  return (
    <div className="scroll-quiet max-h-[420px] overflow-y-auto py-2">
      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {allDay.map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-ink-2 ring-1 ring-line">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color ?? "var(--navy)" }} aria-hidden />
              {e.title}
            </span>
          ))}
        </div>
      )}
      <ol>
        {entries.map((x, i) => {
          const past = x.type === "event" ? (x.end ?? x.at) < now : x.at < now;
          return (
            <FragmentWithMarker key={i} showMarker={i === markerAt} marker={<NowMarker now={now} tz={tz} />}>
              <li className={cx("flex items-start gap-2 px-4 py-1.5", past && "opacity-55")}>
                <span className="tabular w-[62px] shrink-0 pt-px text-right text-xs text-muted">{fmtTime(x.at, tz)}</span>
                {x.type === "event" ? (
                  <>
                    <span className="mt-0.5 h-8 w-[3px] shrink-0 rounded-full" style={{ background: x.e.color ?? "var(--navy)" }} aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {x.e.url ? (
                          <a href={x.e.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {x.e.title}
                          </a>
                        ) : (
                          x.e.title
                        )}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {x.end ? `until ${fmtTime(x.end, tz)}` : ""}
                        {x.e.location ? ` · ${x.e.location}` : ""}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="mt-0.5 h-8 w-[3px] shrink-0 rounded-full" style={{ background: x.t.courseColor }} aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        <Badge tone={x.t.kind === "assignment" ? "red" : "gold"} className="mr-1.5 align-[1px]">
                          {x.t.kind === "assignment" ? "Due" : "Reminder"}
                        </Badge>
                        {x.t.url ? (
                          <a href={x.t.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {x.t.title}
                          </a>
                        ) : (
                          x.t.title
                        )}
                      </p>
                      {x.t.course && <p className="text-xs text-muted">{x.t.course}</p>}
                    </div>
                  </>
                )}
              </li>
            </FragmentWithMarker>
          );
        })}
        {markerAt === entries.length && entries.length > 0 && <NowMarker now={now} tz={tz} />}
      </ol>
    </div>
  );
}

function NowMarker({ now, tz }: { now: Date; tz: string }) {
  return (
    <li className="flex items-center gap-2 px-4 py-1" aria-label={`Now, ${fmtTime(now, tz)}`}>
      <span className="tabular w-[62px] shrink-0 text-right text-[11px] font-semibold text-ink">{fmtTime(now, tz)}</span>
      <span className="h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
      <span className="h-px flex-1 bg-gold" aria-hidden />
    </li>
  );
}

function FragmentWithMarker({ showMarker, marker, children }: { showMarker: boolean; marker: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {showMarker && marker}
      {children}
    </>
  );
}

// ---------------------------------------------------------------- Deadlines

export function DeadlinesBody({ groups }: { groups: { label: string; tasks: TaskView[]; tone?: "red" }[] }) {
  const nonEmpty = groups.filter((g) => g.tasks.length);
  if (!nonEmpty.length) return <Empty>No upcoming deadlines. Connect bCourses or Gradescope in Settings to track assignments.</Empty>;
  return (
    <div className="scroll-quiet max-h-[420px] overflow-y-auto pb-2">
      {nonEmpty.map((g) => (
        <div key={g.label}>
          <h3 className={cx("px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide", g.tone === "red" ? "text-red" : "text-muted")}>
            {g.label} <span className="tabular font-medium">· {g.tasks.length}</span>
          </h3>
          <ul className="divide-y divide-line-2">
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Week ahead

export function WeekBody({ events, tasks, now, tz }: { events: EventRow[]; tasks: (TaskView & { at: Date })[]; now: Date; tz: string }) {
  const today = localDate(now, tz);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return (
    <div className="scroll-quiet overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-7 divide-x divide-line-2">
        {days.map((d, i) => {
          const start = zonedToUtc(d, "00:00", tz);
          const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(start);
          const dayNum = zonedParts(start, tz).day;
          const dayEvents = events.filter((e) => localDate(new Date(e.starts_at), tz) === d);
          const dayTasks = tasks.filter((t) => localDate(t.at, tz) === d);
          return (
            <div key={d} className={cx("min-h-[180px] px-2.5 pb-3 pt-2.5", i === 0 && "bg-gold-soft/40")}>
              <div className={cx("mb-2 flex items-baseline gap-1.5 border-t-2 pt-1.5", i === 0 ? "border-gold" : "border-transparent")}>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
                <span className="tabular text-sm font-semibold text-ink">{dayNum}</span>
              </div>
              <ul className="space-y-1.5">
                {dayTasks.map((t) => (
                  <li key={t.id} className="rounded-md bg-red-soft px-1.5 py-1 text-[11px] leading-tight text-ink ring-1 ring-inset ring-red/15">
                    <span className="block truncate font-semibold">{t.title}</span>
                    <span className="block truncate text-muted">
                      {t.course ? `${t.course} · ` : ""}
                      {fmtTime(t.at, tz)}
                    </span>
                  </li>
                ))}
                {dayEvents.map((e) => (
                  <li key={e.id} className="flex gap-1.5 text-[11px] leading-tight">
                    <span className="mt-0.5 h-full w-[2px] shrink-0 self-stretch rounded-full" style={{ background: e.color ?? "var(--navy)" }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{e.title}</span>
                      <span className="tabular block text-muted">{e.all_day ? "All day" : fmtTime(e.starts_at, tz)}</span>
                    </span>
                  </li>
                ))}
                {!dayTasks.length && !dayEvents.length && <li className="text-[11px] text-muted/70">—</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Drive

function FileIcon({ mime }: { mime?: string }) {
  const cls = "h-4 w-4 shrink-0";
  if (!mime) return <File className={cls} />;
  if (mime.includes("spreadsheet") || mime.includes("csv") || mime.includes("excel")) return <FileSpreadsheet className={cx(cls, "text-green")} />;
  if (mime.includes("presentation") || mime.includes("powerpoint")) return <Presentation className={cx(cls, "text-amber")} />;
  if (mime.startsWith("image/")) return <FileImage className={cls} />;
  if (mime.includes("document") || mime.includes("pdf") || mime.startsWith("text/")) return <FileText className={cx(cls, "text-link")} />;
  return <File className={cls} />;
}

export function DriveBody({ files, now }: { files: Item[]; now: Date }) {
  if (!files.length) return <Empty>Connect a Google account to see recent Drive files.</Empty>;
  return (
    <ul className="scroll-quiet max-h-[420px] divide-y divide-line-2 overflow-y-auto">
      {files.map((f) => (
        <li key={f.id}>
          <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2">
            <span className="text-muted">
              <FileIcon mime={f.ai_meta?.mimeType} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{f.title}</span>
              <span className="block truncate text-xs text-muted">
                {f.ai_meta?.shared ? "Shared with you" : "Edited"}
                {f.author ? ` by ${f.author}` : ""} · {fmtAgo(f.occurred_at, now)}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

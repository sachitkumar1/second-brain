import "server-only";
import ical, { type VEvent } from "node-ical";
import { courseKey } from "../courses";
import { fetchOk } from "../http";
import { replaceEvents, syncCalendarList, upsertAssignments, type AssignmentInput, type EventInput } from "../store";
import { zonedToUtc } from "../time";
import type { SourceAdapter, SyncContext, SyncResult } from "./types";

// Any iCalendar feed: bCourses calendar feed, course-website calendars, club calendars,
// UC Berkeley academic calendar. Assignment-like entries (Canvas "event-assignment-*") become tasks.

type Param = string | { val: string };
const text = (v: Param | undefined): string => (v == null ? "" : typeof v === "string" ? v : v.val);

/** Date-only ICS values are wall dates; anchor them to local midnight in your timezone. */
function dateOnlyToUtc(d: Date, tz: string): Date {
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return zonedToUtc(ymd, "00:00", tz);
}

export const ics: SourceAdapter = {
  intervalMinutes: 60,
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const url = String(ctx.conn.config.url ?? "").replace(/^webcal:\/\//i, "https://");
    if (!/^https:\/\//i.test(url)) throw new Error("ICS feed URL must start with https:// or webcal://");
    const kind: "auto" | "events" | "assignments" = ctx.conn.config.kind ?? "auto";
    const tz = ctx.settings.timezone;
    const body = await (await fetchOk(url, { timeoutMs: 20_000 })).text();
    const data = ical.sync.parseICS(body);

    const from = new Date(ctx.now.getTime() - 2 * 86_400_000);
    const to = new Date(ctx.now.getTime() + 60 * 86_400_000);
    const events: EventInput[] = [];
    const assignments: AssignmentInput[] = [];

    for (const comp of Object.values(data)) {
      if (!comp || comp.type !== "VEVENT") continue;
      const ev = comp as VEvent;
      if (!ev.start) continue;
      const summary = text(ev.summary as Param) || "(untitled)";
      const isAssignment = kind === "assignments" || (kind === "auto" && /assignment|quiz|discussion_topic/i.test(ev.uid ?? ""));
      const bracket = /\[([^\]]+)\]\s*$/.exec(summary)?.[1];
      const course = courseKey(bracket) ?? courseKey(summary) ?? (ctx.conn.config.course as string | undefined) ?? null;
      const cleanTitle = bracket ? summary.replace(/\s*\[[^\]]+\]\s*$/, "") : summary;
      const allDay = ev.datetype === "date" || (ev.start as { dateOnly?: boolean }).dateOnly === true;

      const instances = ev.rrule
        ? ical.expandRecurringEvent(ev, { from, to }).map((i) => ({ start: i.start as Date, end: i.end as Date | undefined, full: i.isFullDay }))
        : [{ start: ev.start as Date, end: ev.end as Date | undefined, full: allDay }];

      for (const inst of instances) {
        const startsAt = inst.full ? dateOnlyToUtc(inst.start, tz) : inst.start;
        if (startsAt < from || startsAt >= to) continue;
        if (isAssignment) {
          // Canvas marks all-day due dates on the day; treat them as due end-of-day.
          const due = inst.full ? new Date(startsAt.getTime() + (24 * 60 - 1) * 60_000) : startsAt;
          assignments.push({
            source: "ics",
            externalId: `${ctx.conn.id}:${ev.uid}`,
            title: cleanTitle,
            course,
            url: typeof ev.url === "string" ? ev.url : null,
            dueAt: due,
          });
        } else {
          events.push({
            externalId: `${ev.uid}:${startsAt.toISOString()}`,
            calendarId: ctx.conn.id,
            calendar: ctx.conn.label,
            title: summary,
            location: text(ev.location as Param) || null,
            description: text(ev.description as Param).slice(0, 2000) || null,
            url: typeof ev.url === "string" ? ev.url : null,
            startsAt,
            endsAt: inst.end ? (inst.full ? dateOnlyToUtc(inst.end, tz) : inst.end) : null,
            allDay: inst.full,
            color: (ctx.conn.config.color as string | undefined) ?? null,
          });
        }
      }
    }

    await syncCalendarList(ctx.conn.id, [{ id: ctx.conn.id, name: ctx.conn.label, color: (ctx.conn.config.color as string | undefined) ?? null }]);
    await replaceEvents(ctx.conn.id, "ics", from, to, events);
    const newAssignments = await upsertAssignments(ctx.conn.id, assignments);
    return { newAssignments, counts: { events: events.length, assignments: assignments.length } };
  },
};

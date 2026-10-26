import "server-only";
import type { ItemView } from "@/components/Feed";
import type { TaskView } from "@/components/TaskRow";
import { courseColor, courseKey, courseLabel } from "./courses";
import type { Item, Task } from "./store";
import { daysBetween, fmtAgo, fmtDue, fmtUntil, localDate } from "./time";

/** Shapes a task row for the client: labels computed server-side in your timezone. */
export function toTaskView(t: Task, tz: string, now: Date, aliases: Record<string, string> = {}): TaskView {
  const due = t.due_at ? new Date(t.due_at) : null;
  const hoursLeft = due ? (due.getTime() - now.getTime()) / 3_600_000 : null;
  const today = localDate(now, tz);
  const carriedDays = due && due < now ? Math.max(0, daysBetween(localDate(due, tz), today)) : 0;
  let urgency: TaskView["urgency"] = "none";
  if (hoursLeft != null) {
    if (hoursLeft < 0) urgency = "overdue";
    else if (hoursLeft < 12) urgency = "soon";
    else if (localDate(due!, tz) === today) urgency = "today";
    else urgency = "later";
  }
  const key = courseKey(t.course) ?? t.course;
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    course: courseLabel(t.course, aliases),
    courseColor: courseColor(key),
    url: t.url,
    source: t.source,
    kind: t.kind,
    status: t.status,
    dueLabel: due ? fmtDue(due, tz, now, t.all_day) : null,
    untilLabel: due && hoursLeft != null && hoursLeft < 72 && !t.all_day ? fmtUntil(due, now) : due && hoursLeft != null && hoursLeft < 0 ? "overdue" : null,
    urgency,
    carriedDays,
    carryOver: t.carry_over,
    priority: t.priority,
    remindLabel: t.remind_at && new Date(t.remind_at) > now ? fmtDue(t.remind_at, tz, now) : null,
  };
}


const KIND: Record<string, { label: string; tone: ItemView["kindTone"] }> = {
  email: { label: "Email", tone: "neutral" },
  announcement: { label: "Announcement", tone: "navy" },
  update: { label: "Site update", tone: "amber" },
  post: { label: "Ed post", tone: "neutral" },
  grade: { label: "Grade", tone: "green" },
  message: { label: "Message", tone: "neutral" },
  mention: { label: "Mention", tone: "gold" },
  file: { label: "File", tone: "neutral" },
};

const SOURCE: Record<string, string> = {
  gmail: "Gmail",
  canvas: "bCourses",
  ed: "Ed Discussion",
  gradescope: "Gradescope",
  webpage: "Course website",
  slack: "Slack",
  drive: "Google Drive",
};

export function toItemView(i: Item, now: Date, aliases: Record<string, string> = {}): ItemView {
  const kind = KIND[i.kind] ?? { label: i.kind, tone: "neutral" as const };
  const urgent = (i.importance ?? 0) >= 3;
  const key = courseKey(i.course) ?? i.course;
  const flat = i.body ? i.body.replace(/\s+/g, " ").trim() : "";
  // Slack posts use their first line as the title; don't repeat it as the snippet.
  const snippet = flat && !flat.startsWith(i.title.slice(0, 60)) ? flat.slice(0, 220) : null;
  return {
    id: i.id,
    title: i.title,
    summary: i.summary,
    snippet,
    author: i.author,
    url: i.url,
    course: courseLabel(i.course, aliases),
    courseColor: courseColor(key),
    kindLabel: urgent ? "Urgent" : kind.label,
    kindTone: urgent ? "red" : kind.tone,
    sourceLabel: SOURCE[i.source] ?? i.source,
    account: i.account?.includes("@") ? i.account.split("@")[1] : i.account,
    ago: fmtAgo(i.occurred_at, now),
    unread: i.is_unread,
    importance: i.importance,
    channel: i.channel,
  };
}

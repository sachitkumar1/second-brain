import { courseKey } from "./courses";

// Decides when two to-dos are the same thing seen from different places
// ("HW 5" in a syllabus vs "Homework 5: Gradient Descent" on Gradescope).

const STOP = new Set(["the", "and", "for", "submit", "complete", "due", "on", "to", "a", "your", "of", "in", "by"]);

export function titleTokens(s: string): Set<string> {
  const norm = s
    .toLowerCase()
    .replace(/\bhw\b/g, "homework")
    .replace(/\b(pset|ps)\b/g, "problem set")
    .replace(/\bproj\b/g, "project")
    .replace(/\bmt\b/g, "midterm")
    .replace(/\bdisc\b/g, "discussion")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b0+(\d)/g, "$1");
  return new Set(norm.split(/\s+/).filter((w) => w.length > 0 && !STOP.has(w) && (w.length > 1 || /\d/.test(w))));
}

type Comparable = { title: string; course: string | null; due_at: Date | string | null };

export function isSameTask(title: string, course: string | null, due: Date | null, other: Comparable): boolean {
  if (course && other.course && (courseKey(course) ?? course) !== (courseKey(other.course) ?? other.course)) return false;
  if (due && other.due_at && Math.abs(new Date(other.due_at).getTime() - due.getTime()) > 36 * 3_600_000) return false;
  const a = titleTokens(title);
  const b = titleTokens(other.title);
  // Different numbers ("Homework 5" vs "Homework 6") are never the same thing.
  const numsA = [...a].filter((w) => /^\d+$/.test(w));
  const numsB = [...b].filter((w) => /^\d+$/.test(w));
  if (numsA.length && numsB.length && !numsA.some((n) => numsB.includes(n))) return false;
  const inter = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size || 1;
  return inter / union >= 0.5 || (inter >= 2 && (a.size <= 3 || b.size <= 3));
}

export function isDuplicateAction(title: string, course: string | null, due: Date | null, existing: Comparable[]): boolean {
  return existing.some((t) => isSameTask(title, course, due, t));
}

/**
 * Hides syllabus-derived deadlines once bCourses/Gradescope track the same assignment,
 * so each assignment shows up once (the synced copy knows submission status).
 */
export function withoutSyllabusDuplicates<T extends Comparable & { source: string }>(tasks: T[]): T[] {
  const synced = tasks.filter((t) => t.source !== "syllabus" && t.source !== "agent");
  return tasks.filter((t) => t.source !== "syllabus" || !synced.some((o) => isSameTask(t.title, t.course, t.due_at ? new Date(t.due_at) : null, o)));
}

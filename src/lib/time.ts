// Timezone helpers built on Intl, so "today" always means today in your timezone,
// not the server's (Vercel runs in UTC).

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of the given instant in the given timezone. */
export function localDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** HH:mm of the given instant in the given timezone. */
export function localTime(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset (ms) of `tz` from UTC at the given instant. Positive east of UTC. */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC instant. Handles DST transitions. */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm, ss] = (timeStr || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  // Two passes converge across DST boundaries.
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

export function startOfLocalDay(date: Date, tz: string): Date {
  return zonedToUtc(localDate(date, tz), "00:00", tz);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from local date a to local date b (b - a). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Minutes since local midnight for an HH:mm string. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** True if local time-of-day `now` falls in [start, end), where the window may wrap midnight. */
export function inWindow(nowMinutes: number, start: string, end: string): boolean {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s === e) return false;
  return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e;
}

// ---------- Display formatting ----------

export function fmtTime(date: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(
    new Date(date),
  );
}

export function fmtDay(date: Date | string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...opts,
  }).format(new Date(date));
}

/** "Today 11:59 PM", "Tomorrow 9:00 AM", "Thu 5:00 PM", "Nov 12, 11:59 PM", "2 days ago". */
export function fmtDue(date: Date | string, tz: string, now = new Date(), allDay = false): string {
  const d = new Date(date);
  const diffDays = daysBetween(localDate(now, tz), localDate(d, tz));
  const time = allDay ? "" : ` ${fmtTime(d, tz)}`;
  if (diffDays === 0) return `Today${time}`;
  if (diffDays === 1) return `Tomorrow${time}`;
  if (diffDays === -1) return `Yesterday${time}`;
  if (diffDays > 1 && diffDays < 7) return `${fmtDay(d, tz, { month: undefined, day: undefined })}${time}`;
  return `${fmtDay(d, tz, { weekday: undefined })}${time ? "," + time : ""}`;
}

/** Compact relative time: "now", "5m", "3h", "2d", "3w". */
export function fmtAgo(date: Date | string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(date).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 7))}w`;
}

/** "in 3h", "in 2d", "3h overdue" */
export function fmtUntil(date: Date | string, now = new Date()): string {
  const s = (new Date(date).getTime() - now.getTime()) / 1000;
  const a = Math.abs(s);
  const v = a < 3600 ? `${Math.max(1, Math.round(a / 60))}m` : a < 86400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86400)}d`;
  return s >= 0 ? `in ${v}` : `${v} overdue`;
}

export function greeting(now: Date, tz: string): string {
  const h = zonedParts(now, tz).hour;
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

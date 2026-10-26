"use client";

import { Layers } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { setCalendarHidden } from "@/app/actions";
import { cx } from "./ui";

export type CalendarOption = { id: string; name: string; color: string | null; account: string | null; hidden: boolean };

function CalendarList({ calendars, onToggle }: { calendars: CalendarOption[]; onToggle: (id: string, hidden: boolean) => void }) {
  if (!calendars.length)
    return (
      <p className="px-3 py-2 text-xs leading-relaxed text-muted">
        No calendars yet. They appear after a Google account syncs: press <strong>Sync</strong> at the top. If an account shows a warning under Settings →
        Connections, fix that first. For an account that can&apos;t connect (like berkeley.edu), add its calendar as a Calendar feed.
      </p>
    );
  const groups = [...new Set(calendars.map((c) => c.account ?? "Calendar feeds"))];
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g}>
          <p className="truncate px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g}</p>
          <ul>
            {calendars
              .filter((c) => (c.account ?? "Calendar feeds") === g)
              .map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={!c.hidden}
                      onChange={(e) => onToggle(c.id, !e.target.checked)}
                      className="h-4 w-4 shrink-0"
                      style={{ accentColor: c.color ?? "var(--navy)" }}
                    />
                    <span className={cx("min-w-0 flex-1 truncate", c.hidden ? "text-muted" : "text-ink")}>{c.name}</span>
                  </label>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function useCalendarToggles(initial: CalendarOption[]) {
  const [calendars, setCalendars] = useState(initial);
  const [, start] = useTransition();
  const toggle = (id: string, hidden: boolean) => {
    setCalendars((cs) => cs.map((c) => (c.id === id ? { ...c, hidden } : c)));
    start(async () => {
      await setCalendarHidden(id, hidden);
    });
  };
  return { calendars, toggle };
}

/** "Calendars" menu for the Today and Week widgets. */
export function CalendarPicker({ calendars: initial }: { calendars: CalendarOption[] }) {
  const { calendars, toggle } = useCalendarToggles(initial);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const hiddenCount = calendars.filter((c) => c.hidden).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink"
        title="Choose which calendars to show"
      >
        <Layers className="h-3.5 w-3.5" />
        Calendars{hiddenCount > 0 && <span className="tabular text-muted">· {hiddenCount} hidden</span>}
      </button>
      {open && (
        <div className="scroll-quiet absolute right-0 top-8 z-30 max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-surface py-2 shadow-lg">
          <CalendarList calendars={calendars} onToggle={toggle} />
        </div>
      )}
    </div>
  );
}

/** Same toggles, laid out inline for the Settings page. */
export function CalendarSettings({ calendars: initial }: { calendars: CalendarOption[] }) {
  const { calendars, toggle } = useCalendarToggles(initial);
  return (
    <div className="-mx-3">
      <CalendarList calendars={calendars} onToggle={toggle} />
    </div>
  );
}

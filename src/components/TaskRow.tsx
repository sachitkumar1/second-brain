"use client";

import { Bell, Check, CornerDownRight, ExternalLink, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { taskAction } from "@/app/actions";
import { Badge, cx } from "./ui";

export type TaskView = {
  id: string;
  title: string;
  notes: string | null;
  course: string | null;
  courseColor: string;
  url: string | null;
  source: string;
  kind: string;
  status: string;
  dueLabel: string | null;
  untilLabel: string | null;
  urgency: "overdue" | "soon" | "today" | "later" | "none";
  carriedDays: number;
  carryOver: boolean;
  priority: number;
  remindLabel: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  canvas: "bCourses",
  gradescope: "Gradescope",
  ics: "Calendar",
  agent: "Agent",
  manual: "You",
  ed: "Ed",
  syllabus: "Syllabus",
};

export function TaskRow({ task, showNotes = false }: { task: TaskView; showNotes?: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(task.status === "done");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const run = (action: Parameters<typeof taskAction>[1]) => {
    setMenu(false);
    if (action === "done") setDone(true);
    if (action === "reopen") setDone(false);
    start(async () => {
      await taskAction(task.id, action);
    });
  };

  const tone = task.urgency === "overdue" ? "red" : task.urgency === "soon" ? "amber" : task.urgency === "today" ? "gold" : "neutral";

  return (
    <li className={cx("group relative flex items-start gap-3 px-4 py-2.5 transition", pending && "opacity-60", done && "opacity-55")}>
      <button
        type="button"
        onClick={() => run(done ? "reopen" : "done")}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className={cx(
          "mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition",
          done ? "border-navy bg-navy text-on-navy" : "border-line bg-surface hover:border-navy",
        )}
      >
        {done && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={cx("min-w-0 flex-1 text-sm leading-snug text-ink", done && "line-through")}>
            {task.url ? (
              <a href={task.url} target="_blank" rel="noreferrer" className="hover:text-link hover:underline">
                {task.title}
              </a>
            ) : (
              task.title
            )}
          </p>
          {task.untilLabel && !done && <Badge tone={tone}>{task.untilLabel}</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
          {task.course && (
            <span className="inline-flex items-center gap-1.5 font-medium text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: task.courseColor }} aria-hidden />
              {task.course}
            </span>
          )}
          {task.dueLabel && <span className="tabular">{task.dueLabel}</span>}
          {task.remindLabel && (
            <span className="tabular inline-flex items-center gap-1">
              <Bell className="h-3 w-3" aria-label="Reminder" />
              {task.remindLabel}
            </span>
          )}
          {task.carriedDays > 0 && task.carryOver && (
            <span className="font-medium text-red">Carried over · {task.carriedDays === 1 ? "since yesterday" : `${task.carriedDays} days`}</span>
          )}
          {!task.carryOver && task.carriedDays > 0 && <span>Not carrying over</span>}
          {SOURCE_LABEL[task.source] && task.source !== "manual" && <span>{SOURCE_LABEL[task.source]}</span>}
        </div>
        {showNotes && task.notes && (
          <p className="mt-1 flex gap-1 text-xs leading-relaxed text-muted">
            <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{task.notes}</span>
          </p>
        )}
      </div>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          aria-label="More actions"
          aria-expanded={menu}
          className="rounded-md p-1 text-muted opacity-100 transition hover:bg-surface-2 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menu && (
          <div role="menu" className="absolute right-0 top-7 z-20 w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-lg">
            {task.url && (
              <a role="menuitem" href={task.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2">
                <ExternalLink className="h-3.5 w-3.5" /> Open
              </a>
            )}
            <button role="menuitem" onClick={() => run("snooze")} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
              Snooze until tomorrow
            </button>
            {task.carryOver ? (
              <button role="menuitem" onClick={() => run("nocarry")} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                Don&apos;t carry over
              </button>
            ) : (
              <button role="menuitem" onClick={() => run("carry")} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                Carry over again
              </button>
            )}
            <button role="menuitem" onClick={() => run(task.source === "manual" || task.source === "agent" ? "delete" : "dismiss")} className="block w-full px-3 py-1.5 text-left text-red hover:bg-red-soft">
              {task.source === "manual" || task.source === "agent" ? "Delete" : "Hide"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

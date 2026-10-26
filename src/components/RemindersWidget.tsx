"use client";

import { Plus, Sparkles, User } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { createReminder } from "@/app/actions";
import { TaskRow, type TaskView } from "./TaskRow";
import { cx, Empty, inputClass } from "./ui";

export function RemindersWidget({ auto, mine, defaultTab = "auto" }: { auto: TaskView[]; mine: TaskView[]; defaultTab?: "auto" | "mine" }) {
  const [tab, setTab] = useState<"auto" | "mine">(defaultTab);
  const [composing, setComposing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof createReminder>> | null, form: FormData) => {
    const result = await createReminder(prev, form);
    if (result.ok) {
      formRef.current?.reset();
      setComposing(false);
      setTab("mine");
    }
    return result;
  }, null);

  const list = tab === "auto" ? auto : mine;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 pt-2.5" role="tablist" aria-label="Reminder lists">
        {(
          [
            ["auto", "From your agent", auto.length, Sparkles],
            ["mine", "Yours", mine.length, User],
          ] as const
        ).map(([id, label, n, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
              tab === id ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className="tabular text-muted">{n}</span>
          </button>
        ))}
        <button
          onClick={() => {
            setComposing((c) => !c);
            setTab("mine");
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-link hover:bg-surface-2"
          aria-expanded={composing}
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      {composing && (
        <form ref={formRef} action={action} className="mx-3 mt-2.5 space-y-2 rounded-xl border border-line bg-surface-2 p-3">
          <input name="title" required placeholder="Remind me to…" className={inputClass} autoFocus aria-label="Reminder" />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" name="date" className={inputClass} aria-label="Date" />
            <input type="time" name="time" className={inputClass} aria-label="Time" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select name="notify" className={inputClass} defaultValue="at" aria-label="Notify">
              <option value="at">Email me at that time</option>
              <option value="15m">15 min before</option>
              <option value="1h">1 hour before</option>
              <option value="1d">1 day before</option>
              <option value="none">Don&apos;t notify</option>
            </select>
            <select name="priority" className={inputClass} defaultValue="1" aria-label="Priority">
              <option value="0">Low priority</option>
              <option value="1">Normal</option>
              <option value="2">High</option>
              <option value="3">Urgent</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="carry" value="off" className="accent-[var(--navy)]" />
            Don&apos;t carry over if I miss it
          </label>
          {state && !state.ok && <p className="text-xs text-red">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setComposing(false)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-on-navy hover:bg-navy-hover disabled:opacity-60">
              {pending ? "Adding…" : "Add reminder"}
            </button>
          </div>
        </form>
      )}

      <div className="scroll-quiet mt-1 max-h-[380px] flex-1 overflow-y-auto pb-2">
        {list.length ? (
          <ul className="divide-y divide-line-2">
            {list.map((t) => (
              <TaskRow key={t.id} task={t} showNotes={tab === "auto"} />
            ))}
          </ul>
        ) : (
          <Empty>
            {tab === "auto"
              ? "Nothing from your agent right now. It adds reminders when an email, announcement or Slack post asks something of you."
              : "No reminders. Add one with New."}
          </Empty>
        )}
      </div>
    </div>
  );
}

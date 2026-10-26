"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import { useState, useTransition } from "react";
import { saveWidgets } from "@/app/actions";
import { buttonClass, cx } from "../ui";

export function WidgetEditor({ widgets, order, hidden }: { widgets: { id: string; name: string }[]; order: string[]; hidden: string[] }) {
  const names = Object.fromEntries(widgets.map((w) => [w.id, w.name]));
  const [list, setList] = useState(() => [...order.filter((id) => names[id]), ...widgets.map((w) => w.id).filter((id) => !order.includes(id))]);
  const [off, setOff] = useState(new Set(hidden));
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    setSaved(false);
  };

  return (
    <div>
      <ol className="divide-y divide-line-2 rounded-xl border border-line">
        {list.map((id, i) => (
          <li key={id} className={cx("flex items-center gap-2 px-3 py-2", off.has(id) && "opacity-50")}>
            <span className="tabular w-5 text-xs text-muted">{i + 1}</span>
            <span className="flex-1 text-sm font-medium text-ink">{names[id]}</span>
            <button className={buttonClass.ghost} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${names[id]} up`}>
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button className={buttonClass.ghost} onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${names[id]} down`}>
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              className={buttonClass.ghost}
              onClick={() => {
                const next = new Set(off);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setOff(next);
                setSaved(false);
              }}
              aria-label={off.has(id) ? `Show ${names[id]}` : `Hide ${names[id]}`}
            >
              {off.has(id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-3">
        <button
          className={buttonClass.primary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await saveWidgets(list, [...off]);
              setSaved(true);
            })
          }
        >
          {pending ? "Saving…" : "Save layout"}
        </button>
        {saved && <span className="text-sm text-green">Saved</span>}
      </div>
    </div>
  );
}

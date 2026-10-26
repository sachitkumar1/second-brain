"use client";

import { ExternalLink, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { dismissItem } from "@/app/actions";
import { Badge, cx, Empty } from "./ui";

export type ItemView = {
  id: string;
  title: string;
  summary: string | null;
  snippet: string | null;
  author: string | null;
  url: string | null;
  course: string | null;
  courseColor: string;
  kindLabel: string;
  kindTone: "neutral" | "navy" | "red" | "amber" | "green" | "gold";
  sourceLabel: string;
  account: string | null;
  ago: string;
  unread: boolean;
  importance: number | null;
  channel: string | null;
};

function ItemRow({ item, showCourse }: { item: ItemView; showCourse: boolean }) {
  const [gone, setGone] = useState(false);
  const [, start] = useTransition();
  if (gone) return null;
  const text = item.summary ?? item.snippet;
  return (
    <li className="group flex gap-3 px-4 py-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: item.unread ? "var(--gold)" : item.courseColor }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {showCourse && item.course && <span className="font-semibold text-ink-2">{item.course}</span>}
          <Badge tone={item.kindTone}>{item.kindLabel}</Badge>
          {item.author && <span className="truncate">{item.author}</span>}
          {item.channel && <span>{item.channel}</span>}
          <span className="ml-auto tabular">{item.ago}</span>
        </div>
        <p className={cx("mt-1 text-sm leading-snug text-ink", item.unread && "font-semibold")}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-link hover:underline">
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </p>
        {text && <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{text}</p>}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
          <span>{item.sourceLabel}</span>
          {item.account && <span>· {item.account}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Open">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          onClick={() => {
            setGone(true);
            start(() => dismissItem(item.id).then(() => undefined));
          }}
          className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

/** Declarative tab filters (functions can't cross the server→client boundary). */
export type FeedFilter = "all" | "important" | "unread" | `kind:${string}`;

function matches(i: ItemView, f: FeedFilter): boolean {
  if (f === "all") return true;
  if (f === "important") return (i.importance ?? 1) >= 2;
  if (f === "unread") return i.unread;
  return i.kindLabel === f.slice(5);
}

export function Feed({
  items,
  tabs,
  filterByCourse = false,
  empty,
  maxHeight = 420,
}: {
  items: ItemView[];
  tabs?: { id: string; label: string; filter: FeedFilter }[];
  filterByCourse?: boolean;
  empty: string;
  maxHeight?: number;
}) {
  const [tab, setTab] = useState(tabs?.[0]?.id ?? "all");
  const [course, setCourse] = useState<string | null>(null);
  const courses = useMemo(
    () => (filterByCourse ? [...new Map(items.filter((i) => i.course).map((i) => [i.course!, i.courseColor])).entries()] : []),
    [items, filterByCourse],
  );
  const active = tabs?.find((t) => t.id === tab);
  const shown = items.filter((i) => (!active || matches(i, active.filter)) && (!course || i.course === course));

  return (
    <div className="flex h-full flex-col">
      {(tabs || courses.length > 1) && (
        <div className="scroll-quiet flex items-center gap-1 overflow-x-auto px-3 pt-2.5">
          {tabs?.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cx(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                tab === t.id ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
              <span className="tabular text-muted">{items.filter((i) => matches(i, t.filter)).length}</span>
            </button>
          ))}
          {courses.length > 1 && (
            <>
              {tabs && <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />}
              <button
                onClick={() => setCourse(null)}
                aria-pressed={!course}
                className={cx("shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold", !course ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink")}
              >
                All
              </button>
              {courses.map(([c, color]) => (
                <button
                  key={c}
                  onClick={() => setCourse(c === course ? null : c)}
                  aria-pressed={course === c}
                  className={cx(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                    course === c ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink",
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
                  {c}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      <div className="scroll-quiet mt-1 flex-1 overflow-y-auto" style={{ maxHeight }}>
        {shown.length ? (
          <ul className="divide-y divide-line-2">
            {shown.map((i) => (
              <ItemRow key={i.id} item={i} showCourse={!course} />
            ))}
          </ul>
        ) : (
          <Empty>{empty}</Empty>
        )}
      </div>
    </div>
  );
}

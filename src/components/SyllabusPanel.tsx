"use client";

import { AlertTriangle, CheckCircle2, FileText, Globe, GraduationCap, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";
import { removeSyllabus, rescanSyllabusNow, uploadSyllabus, type ActionResult } from "@/app/actions";
import { buttonClass, cx, Empty, inputClass } from "./ui";

export type SyllabusView = {
  id: string;
  source: "upload" | "canvas" | "webpage";
  course: string | null;
  title: string;
  url: string | null;
  status: "pending" | "done" | "error" | "ignored";
  error: string | null;
  itemCount: number;
  readAgo: string | null;
};

const SOURCE = {
  upload: { label: "Uploaded", Icon: FileText },
  canvas: { label: "bCourses", Icon: GraduationCap },
  webpage: { label: "Course website", Icon: Globe },
} as const;

function Row({ s }: { s: SyllabusView }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const { label, Icon } = SOURCE[s.source];
  const run = (fn: () => Promise<ActionResult>) => start(async () => setMsg(await fn()));
  const status =
    s.status === "done" ? (
      <span className="inline-flex items-center gap-1 text-green">
        <CheckCircle2 className="h-3.5 w-3.5" /> {s.itemCount} date{s.itemCount === 1 ? "" : "s"} · read {s.readAgo}
      </span>
    ) : s.status === "pending" ? (
      <span className="inline-flex items-center gap-1 text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Queued; read within ~10 minutes
      </span>
    ) : s.status === "error" ? (
      <span className="inline-flex items-center gap-1 text-amber" title={s.error ?? ""}>
        <AlertTriangle className="h-3.5 w-3.5" /> Couldn&apos;t read it{s.error ? `: ${s.error.slice(0, 80)}` : ""}
      </span>
    ) : (
      <span className="text-muted">Turned off</span>
    );

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
              {s.title}
            </a>
          ) : (
            s.title
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
          <span>{label}</span>
          {s.course && <span>· {s.course}</span>}
          <span>· {status}</span>
        </p>
        {msg?.message && <p className={cx("mt-1 text-xs", msg.ok ? "text-green" : "text-red")}>{msg.message}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button className={buttonClass.ghost} disabled={pending} onClick={() => run(() => rescanSyllabusNow(s.id))} title="Read it again now">
          <RefreshCw className={cx("h-3.5 w-3.5", pending && "animate-spin")} /> {s.status === "ignored" ? "Turn on" : "Read again"}
        </button>
        {s.status !== "ignored" && (
          <button
            className={cx(buttonClass.ghost, "hover:text-red")}
            disabled={pending}
            onClick={() => window.confirm(`Remove "${s.title}" and the open deadlines it added?`) && run(() => removeSyllabus(s.id))}
            aria-label={`Remove ${s.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

export function SyllabusPanel({ syllabi, courses }: { syllabi: SyllabusView[]; courses: string[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"file" | "text" | "url">("file");
  const [state, action, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = await uploadSyllabus(prev, form);
    if (r.ok) formRef.current?.reset();
    return r;
  }, null);

  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 border-line-2 lg:border-r">
        {syllabi.length ? (
          <ul className="scroll-quiet max-h-[440px] divide-y divide-line-2 overflow-y-auto">
            {syllabi.map((s) => (
              <Row key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <Empty>
            No syllabi yet. bCourses syllabus pages and the course websites you&apos;ve added are read automatically; upload anything else here.
          </Empty>
        )}
      </div>
      <form ref={formRef} action={action} className="space-y-3 border-t border-line-2 p-4 lg:border-t-0">
        <p className="text-sm font-semibold text-ink">Add a syllabus or schedule</p>
        <input name="course" list="syllabus-courses" placeholder="Course, e.g. DATA 100" className={inputClass} aria-label="Course" />
        <datalist id="syllabus-courses">
          {courses.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="flex gap-1" role="tablist" aria-label="How to add it">
          {(
            [
              ["file", "File"],
              ["text", "Paste text"],
              ["url", "Link"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => setMode(id)}
              className={cx("rounded-lg px-2.5 py-1 text-xs font-semibold", mode === id ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "file" && (
          <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-5 text-center text-xs text-muted hover:border-ink/30">
            <Upload className="h-5 w-5" />
            <span>PDF or text file, up to 4 MB</span>
            <input type="file" name="file" accept=".pdf,.txt,.md,.html,.htm,.csv,application/pdf,text/*" className="max-w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink" />
          </label>
        )}
        {mode === "text" && <textarea name="text" rows={6} placeholder="Paste the schedule or syllabus text" className={inputClass} />}
        {mode === "url" && <input name="url" type="url" placeholder="https://… (a page or PDF link)" className={inputClass} />}
        <button type="submit" disabled={pending} className={cx(buttonClass.primary, "w-full")}>
          {pending ? "Reading… (up to a minute)" : "Read it and add deadlines"}
        </button>
        {state?.message && <p className={cx("text-xs", state.ok ? "text-green" : "text-red")}>{state.message}</p>}
        <p className="text-[11px] leading-relaxed text-muted">
          Exams, homework, projects and other dated deadlines become tasks with reminders. Anything already tracked from bCourses or Gradescope isn&apos;t
          duplicated.
        </p>
      </form>
    </div>
  );
}

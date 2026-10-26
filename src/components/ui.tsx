import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Widget({
  title,
  icon,
  count,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: string;
  icon?: ReactNode;
  count?: number | string | null;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("flex h-full min-w-0 scroll-mt-20 flex-col rounded-2xl border border-line bg-surface shadow-card", className)}>
      <header className="flex items-center gap-2 border-b border-line-2 px-4 py-3">
        {icon && <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
        {count != null && count !== 0 && (
          <span className="tabular rounded-full bg-surface-2 px-1.5 py-px text-[11px] font-semibold text-muted ring-1 ring-line">{count}</span>
        )}
        <div className="ml-auto flex items-center gap-1">{action}</div>
      </header>
      <div className={cx("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted">
      {icon && <span className="text-line [&>svg]:h-6 [&>svg]:w-6">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

const TONES = {
  neutral: "bg-surface-2 text-ink-2 ring-line",
  navy: "bg-surface-2 text-navy ring-line",
  red: "bg-red-soft text-red ring-red/20",
  amber: "bg-amber-soft text-amber ring-amber/20",
  green: "bg-green-soft text-green ring-green/20",
  gold: "bg-gold-soft text-ink ring-gold/40",
} as const;

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: keyof typeof TONES; className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function CourseTag({ course, color }: { course: string; color: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-ink-2">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {course}
    </span>
  );
}

export function SourceLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{children}</span>;
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-sm font-semibold text-on-navy transition hover:bg-navy-hover disabled:opacity-60",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-2 disabled:opacity-60",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-red transition hover:bg-red-soft disabled:opacity-60",
};

export const inputClass =
  "block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line transition peer-checked:bg-navy peer-focus-visible:ring-2 peer-focus-visible:ring-ring after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:shadow after:transition peer-checked:after:translate-x-4"
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

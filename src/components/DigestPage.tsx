import Link from "next/link";
import { digestNow } from "@/app/actions";
import { ActionButton } from "@/components/ActionButton";
import { DigestView } from "@/components/DigestView";
import { requireSession } from "@/lib/auth";
import { buildDigestData, type DigestData } from "@/lib/agent/digest";
import { sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtDay, localDate } from "@/lib/time";


/** Shared by /digest (today) and /digest/[date]. */
export async function DigestPage({ date }: { date?: string }) {
  await requireSession();
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = localDate(new Date(), tz);
  const target = date ?? today;
  const [row] = await sql<{ data: DigestData; narrative: string | null; sent_at: Date | null }[]>`select data, narrative, sent_at from digests where date = ${target}`;
  const history = await sql<{ date: string; sent_at: Date | null }[]>`select to_char(date, 'YYYY-MM-DD') as date, sent_at from digests order by date desc limit 30`;
  // Without a stored digest for today, show a live preview so the page is never empty.
  const live = !row?.data?.date && target === today ? await buildDigestData(settings) : null;
  const data = row?.data?.date ? row.data : live;
  const title = fmtDay(new Date(`${target}T12:00:00Z`), "UTC", { weekday: "long", month: "long", year: "numeric" });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
      <article className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{target === today ? "Today's digest" : "Digest"}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted">
              {row?.sent_at
                ? `Emailed to ${settings.notifyEmail} at ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(row.sent_at)}`
                : live
                  ? `Live preview — the email goes out at ${settings.digest.time} to ${settings.notifyEmail}`
                  : "Not emailed"}
            </p>
          </div>
          {target === today && (
            <div className="flex flex-wrap gap-2">
              <ActionButton action={digestNow.bind(null, false)}>Regenerate</ActionButton>
              <ActionButton action={digestNow.bind(null, true)} variant="primary">
                Email it now
              </ActionButton>
            </div>
          )}
        </div>
        {data ? <DigestView data={data} narrative={row?.narrative ?? null} /> : <p className="text-sm text-muted">No digest for this day.</p>}
      </article>
      <aside>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Past digests</h2>
        <ul className="space-y-0.5">
          {history.map((h) => (
            <li key={h.date}>
              <Link
                href={h.date === today ? "/digest" : `/digest/${h.date}`}
                className={`block rounded-lg px-3 py-1.5 text-sm ${h.date === target ? "bg-surface font-semibold text-ink ring-1 ring-line" : "text-muted hover:text-ink"}`}
              >
                {fmtDay(new Date(`${h.date}T12:00:00Z`), "UTC")}
              </Link>
            </li>
          ))}
          {!history.length && <li className="px-3 text-sm text-muted">None yet.</li>}
        </ul>
      </aside>
    </div>
  );
}

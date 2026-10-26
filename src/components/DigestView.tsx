import type { DigestData, DigestTask } from "@/lib/agent/digest";
import { courseColor, courseKey } from "@/lib/courses";
import { fmtDue, fmtTime } from "@/lib/time";
import { Badge, Empty } from "./ui";

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-t border-line-2 pt-4">
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-navy">
        {title} {count ? <span className="tabular text-muted">· {count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function TaskLine({ t, tz, now, badge }: { t: DigestTask; tz: string; now: Date; badge?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: courseColor(courseKey(t.course) ?? t.course) }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          {t.url ? (
            <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">
              {t.title}
            </a>
          ) : (
            t.title
          )}{" "}
          {badge}
        </p>
        <p className="text-xs text-muted">{[t.course, t.dueAt ? `due ${fmtDue(t.dueAt, tz, now, t.allDay)}` : null].filter(Boolean).join(" · ")}</p>
      </div>
    </li>
  );
}

export function DigestView({ data, narrative }: { data: DigestData; narrative: string | null }) {
  const tz = data.timezone;
  const now = new Date(data.generatedAt);
  const lines = (narrative ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const replies = [data.replies.imessage ? `${data.replies.imessage} on iMessage` : null, data.replies.instagram ? `${data.replies.instagram} on Instagram` : null, data.replies.slack.length ? `${data.replies.slack.length} on Slack (${data.replies.slack.map((s) => s.name).join(", ")})` : null].filter(Boolean);

  return (
    <div className="space-y-5">
      {lines.length > 0 && (
        <div className="space-y-1.5 border-l-[3px] border-gold pl-4 text-[15px] leading-relaxed text-ink-2">
          {lines.map((l, i) =>
            /^[-•]\s/.test(l) ? (
              <p key={i} className="flex gap-2">
                <span className="mt-[10px] h-1 w-1 shrink-0 rounded-full bg-ink-2" aria-hidden />
                {l.replace(/^[-•]\s/, "")}
              </p>
            ) : (
              <p key={i} className={/:$/.test(l) ? "pt-1 font-semibold text-ink" : ""}>
                {l}
              </p>
            ),
          )}
        </div>
      )}
      <Section title="Schedule" count={data.events.length}>
        {data.events.length ? (
          <ul>
            {data.events.map((e, i) => (
              <li key={i} className="flex gap-3 py-1.5 text-sm">
                <span className="tabular w-36 shrink-0 text-muted">{e.allDay ? "All day" : `${fmtTime(e.startsAt, tz)}${e.endsAt ? ` – ${fmtTime(e.endsAt, tz)}` : ""}`}</span>
                <span className="text-ink">
                  {e.title}
                  {e.location && <span className="text-muted"> · {e.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing on the calendar.</p>
        )}
      </Section>
      {data.overdue.length > 0 && (
        <Section title="Carried over" count={data.overdue.length}>
          <ul>
            {data.overdue.map((t) => (
              <TaskLine key={t.id} t={t} tz={tz} now={now} badge={<Badge tone="red">{t.daysOverdue <= 1 ? "from yesterday" : `${t.daysOverdue} days`}</Badge>} />
            ))}
          </ul>
        </Section>
      )}
      <Section title="Due today" count={data.dueToday.length}>
        {data.dueToday.length ? (
          <ul>
            {data.dueToday.map((t) => (
              <TaskLine key={t.id} t={t} tz={tz} now={now} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing due today.</p>
        )}
      </Section>
      {data.upcoming.length > 0 && (
        <Section title="Due this week" count={data.upcoming.length}>
          <ul>
            {data.upcoming.map((t) => (
              <TaskLine key={t.id} t={t} tz={tz} now={now} />
            ))}
          </ul>
        </Section>
      )}
      {data.reminders.length > 0 && (
        <Section title="Reminders" count={data.reminders.length}>
          <ul>
            {data.reminders.map((t) => (
              <TaskLine key={t.id} t={t} tz={tz} now={now} />
            ))}
          </ul>
        </Section>
      )}
      {data.classUpdates.length > 0 && (
        <Section title="Class updates" count={data.classUpdates.length}>
          <ul className="space-y-2">
            {data.classUpdates.map((i, n) => (
              <li key={n} className="text-sm">
                <a href={i.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                  {i.course ? `${i.course}: ` : ""}
                  {i.title}
                </a>
                {i.summary && <p className="text-[13px] text-muted">{i.summary}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {data.emails.length > 0 && (
        <Section title="Important email" count={data.emails.length}>
          <ul className="space-y-2">
            {data.emails.map((i, n) => (
              <li key={n} className="text-sm">
                <a href={i.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                  {i.author ? `${i.author}: ` : ""}
                  {i.title}
                </a>
                {i.summary && <p className="text-[13px] text-muted">{i.summary}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {replies.length > 0 && (
        <Section title="Waiting on your reply">
          <p className="text-sm text-ink-2">{replies.join(" · ")}</p>
        </Section>
      )}
      {!data.events.length && !data.dueToday.length && !data.overdue.length && !lines.length && <Empty>A quiet day.</Empty>}
    </div>
  );
}

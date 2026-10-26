import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  addConnection,
  forgetReplyQueue,
  runTickNow,
  saveCourses,
  saveGeneral,
  saveNotifications,
  saveReplySettings,
  sendTestEmail,
} from "@/app/actions";
import { ActionButton } from "@/components/ActionButton";
import { ActionForm } from "@/components/settings/ActionForm";
import { AgentPairing } from "@/components/settings/AgentPairing";
import { ConnectionCard, type ConnectionView } from "@/components/settings/ConnectionCard";
import { PushSetup } from "@/components/settings/PushSetup";
import { WidgetEditor } from "@/components/settings/WidgetEditor";
import { buttonClass, Field, inputClass, Toggle } from "@/components/ui";
import { aiAvailable } from "@/lib/agent/claude";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { appUrl, env } from "@/lib/env";
import { emailConfigured } from "@/lib/notify/email";
import { pushConfigured } from "@/lib/notify/push";
import { getCourses } from "@/lib/queries";
import { getKV, getSettings, WIDGETS } from "@/lib/settings";
import { listConnections } from "@/lib/store";
import { fmtAgo } from "@/lib/time";

export const dynamic = "force-dynamic";
// Server actions on this page (sync now, connect account, run agent) can take up to a minute.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  ["general", "General"],
  ["notifications", "Notifications"],
  ["connections", "Connections"],
  ["agent", "Mac agent"],
  ["layout", "Dashboard layout"],
  ["courses", "Courses"],
  ["system", "System"],
] as const;

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function AddCard({ title, how, children }: { title: string; how: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-surface-2 open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink">
        {title}
        <span className="text-xs font-medium text-link group-open:hidden">Connect</span>
      </summary>
      <div className="border-t border-line-2 px-4 pb-4 pt-3">
        <div className="mb-3 text-xs leading-relaxed text-muted">{how}</div>
        {children}
      </div>
    </details>
  );
}

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-sm">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-green" : "bg-amber"}`} aria-hidden />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {!ok && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </li>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  await requireSession();
  const { error, connected } = await searchParams;
  const s = await getSettings();
  const conns = await listConnections();
  const courses = await getCourses();
  const agentSeen = await getKV<{ at: string }>("agent_last_seen");
  const agentPaired = !!(await getKV<string>("agent_token_hash"));
  const runs = await sql<{ id: number; kind: string; started_at: Date; ok: boolean | null; detail: Record<string, unknown> | null }[]>`
    select id, kind, started_at, ok, detail from run_log order by started_at desc limit 8`;
  const now = new Date();
  const timezones = Intl.supportedValuesOf("timeZone");
  const r = s.notifications.rules;

  const views: ConnectionView[] = conns.map((c) => ({
    id: c.id,
    type: c.type,
    label: c.label,
    account: c.account,
    enabled: c.enabled,
    status: c.status,
    lastError: c.last_error,
    lastSync: c.last_sync_at ? `${fmtAgo(c.last_sync_at, now)} ago`.replace("now ago", "just now") : null,
    detail:
      c.type === "ics" || c.type === "webpage"
        ? String(c.config.url ?? "")
        : Array.isArray(c.cursor.courses)
          ? `${c.cursor.courses.length} course${c.cursor.courses.length === 1 ? "" : "s"}`
          : null,
    google: c.type === "google" ? { gmail: c.config.gmail !== false, calendar: c.config.calendar !== false, drive: c.config.drive !== false } : undefined,
    slackChannels: c.type === "slack" ? (c.config.channels ?? []) : undefined,
  }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">Settings</h1>
        <ul className="scroll-quiet flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block shrink-0 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-6">
        {(error || connected) && (
          <div role="status" className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-red-soft text-red" : "bg-green-soft text-green"}`}>
            {error ?? `Connected ${connected}. The first sync is done; email and calendar will keep updating every 10 minutes.`}
          </div>
        )}

        <Section id="general" title="General" description="Where notifications go, your timezone, and the morning digest.">
          <ActionForm action={saveGeneral}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Send reminders and notifications to" hint={`Emails come from ${env.gmailSender()}.`}>
                <input name="notifyEmail" type="email" required defaultValue={s.notifyEmail} className={inputClass} />
              </Field>
              <Field label="Timezone">
                <select name="timezone" defaultValue={s.timezone} className={inputClass}>
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Daily digest time" hint="The digest lists today's schedule, what's due, and everything carried over.">
                <input name="digestTime" type="time" defaultValue={s.digest.time} className={inputClass} />
              </Field>
            </div>
            <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
              <Toggle name="digestEnabled" label="Email me a daily digest" defaultChecked={s.digest.enabled} />
              <Toggle name="aiSummary" label="Write a 'top priorities' summary with AI" defaultChecked={s.digest.aiSummary} />
              <Toggle name="aiEnabled" label="Let the agent triage incoming items" hint="Summaries, importance, and auto-reminders" defaultChecked={s.ai.enabled} />
              <Toggle name="aiEmail" label="Include email in AI triage" defaultChecked={s.ai.processEmail} />
              <Toggle name="aiSlack" label="Include Slack in AI triage" defaultChecked={s.ai.processSlack} />
            </div>
          </ActionForm>
          <div className="mt-4 border-t border-line-2 pt-4">
            <ActionButton action={sendTestEmail}>Send a test email</ActionButton>
          </div>
        </Section>

        <Section id="notifications" title="Notifications" description="What's important enough to email you right away. Everything else waits for the digest.">
          <ActionForm action={saveNotifications}>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Toggle name="email" label="Email notifications" defaultChecked={s.notifications.email} />
              <Toggle name="push" label="Push notifications" hint="Enable on each device below" defaultChecked={s.notifications.push} />
            </div>
            <h3 className="mt-4 text-[13px] font-semibold text-ink">Alert me when…</h3>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Toggle name="newAssignment" label="A new assignment is posted" defaultChecked={r.newAssignment} />
              <Toggle name="canvasAnnouncement" label="bCourses posts an announcement" defaultChecked={r.canvasAnnouncement} />
              <Toggle name="edAnnouncement" label="Ed posts an announcement" defaultChecked={r.edAnnouncement} />
              <Toggle name="gradePosted" label="A grade is posted" defaultChecked={r.gradePosted} />
              <Toggle name="courseSiteChange" label="A course website changes" defaultChecked={r.courseSiteChange} />
              <Toggle name="aiUrgent" label="The agent flags something urgent" hint="e.g. a professor emailing you directly" defaultChecked={r.aiUrgent} />
              <Toggle name="slackMention" label="Someone @-mentions me on Slack" defaultChecked={r.slackMention} />
              <Toggle name="slackAnnouncement" label="A watched Slack channel posts" defaultChecked={r.slackAnnouncement} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Always alert for email from" hint="One per line or comma-separated: addresses, names or domains.">
                <textarea name="emailFrom" rows={3} defaultValue={r.emailFrom.join("\n")} placeholder={"recruiting@janestreet.com\nberkeley.edu"} className={inputClass} />
              </Field>
              <Field label="…or containing keywords" hint="Matched against subject and body.">
                <textarea name="keywords" rows={3} defaultValue={r.keywords.join("\n")} placeholder={"midterm\ninterview\nextension"} className={inputClass} />
              </Field>
              <Field label="Deadline heads-ups (hours before)" hint="Comma-separated, e.g. 24, 3">
                <input name="leadHours" defaultValue={s.deadlines.leadHours.join(", ")} className={inputClass} />
              </Field>
              <div>
                <Toggle name="quietEnabled" label="Quiet hours" hint="Hold non-urgent alerts overnight. Your own reminders still arrive on time." defaultChecked={s.notifications.quietHours.enabled} />
                <div className="mt-1 grid grid-cols-2 gap-2 pl-12">
                  <input type="time" name="quietStart" defaultValue={s.notifications.quietHours.start} className={inputClass} aria-label="Quiet hours start" />
                  <input type="time" name="quietEnd" defaultValue={s.notifications.quietHours.end} className={inputClass} aria-label="Quiet hours end" />
                </div>
              </div>
            </div>
          </ActionForm>
          <div className="mt-5 border-t border-line-2 pt-4">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Push on this device</h3>
            <PushSetup publicKey={env.vapidPublicKey() ?? null} />
          </div>
        </Section>

        <Section id="connections" title="Connections" description="Credentials are encrypted at rest (AES-256-GCM) and never sent to your browser.">
          {views.length > 0 && (
            <ul className="mb-5 divide-y divide-line-2 rounded-xl border border-line">
              {views.map((c) => (
                <ConnectionCard key={c.id} c={c} />
              ))}
            </ul>
          )}
          <div className="grid gap-2.5">
            <AddCard
              title="Google — Gmail, Calendar, Drive"
              how={
                <>
                  Connect each account separately (personal Gmail, berkeley.edu…). Access is read-only. If Berkeley blocks the sign-in, forward your bMail to a connected Gmail
                  account instead.
                </>
              }
            >
              {env.googleClientId() ? (
                <a href="/api/oauth/google/start" className={buttonClass.primary}>
                  Connect a Google account
                </a>
              ) : (
                <p className="text-sm text-amber">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first (SETUP.md, step 3).</p>
              )}
            </AddCard>
            <AddCard title="bCourses (Canvas)" how={<>bCourses → Account → Settings → Approved Integrations → “+ New Access Token”. Copy the token here.</>}>
              <ActionForm action={addConnection.bind(null, "canvas")} submitLabel="Connect bCourses">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Access token">
                    <input name="token" type="password" required className={inputClass} autoComplete="off" />
                  </Field>
                  <Field label="Canvas URL">
                    <input name="baseUrl" defaultValue="https://bcourses.berkeley.edu" className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </AddCard>
            <AddCard
              title="Gradescope"
              how={<>Gradescope has no API, so this signs in as you. If you use “School Credentials”, set a Gradescope password once via “Forgot your password?” on gradescope.com.</>}
            >
              <ActionForm action={addConnection.bind(null, "gradescope")} submitLabel="Connect Gradescope">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Email">
                    <input name="email" type="email" required className={inputClass} autoComplete="off" />
                  </Field>
                  <Field label="Password">
                    <input name="password" type="password" required className={inputClass} autoComplete="off" />
                  </Field>
                </div>
              </ActionForm>
            </AddCard>
            <AddCard title="Ed Discussion" how={<>edstem.org → your avatar → Settings → API Tokens → Create token.</>}>
              <ActionForm action={addConnection.bind(null, "ed")} submitLabel="Connect Ed">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="API token">
                    <input name="token" type="password" required className={inputClass} autoComplete="off" />
                  </Field>
                  <Field label="Region">
                    <select name="region" defaultValue="us" className={inputClass}>
                      <option value="us">US (edstem.org/us)</option>
                      <option value="au">Australia</option>
                    </select>
                  </Field>
                </div>
              </ActionForm>
            </AddCard>
            <AddCard title="Slack workspace" how={<>Create a Slack app in the workspace from the manifest in SETUP.md, install it, and paste the “User OAuth Token” (xoxp-…). Add one per workspace.</>}>
              <ActionForm action={addConnection.bind(null, "slack")} submitLabel="Connect Slack">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="User OAuth token">
                    <input name="token" type="password" required placeholder="xoxp-…" className={inputClass} autoComplete="off" />
                  </Field>
                  <Field label="Name">
                    <input name="label" placeholder="e.g. Data Science Society" className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </AddCard>
            <AddCard
              title="Course website"
              how={<>Paste a class site (e.g. ds100.org/fa26). It&apos;s checked hourly; when new text appears you get an update, summarized by the agent, with any deadlines pulled out.</>}
            >
              <ActionForm action={addConnection.bind(null, "webpage")} submitLabel="Watch this page">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Page URL">
                    <input name="url" type="url" required placeholder="https://…" className={inputClass} />
                  </Field>
                  <Field label="Name">
                    <input name="label" placeholder="DATA 100 site" className={inputClass} />
                  </Field>
                  <Field label="Course (optional)">
                    <input name="course" placeholder="DATA 100" className={inputClass} />
                  </Field>
                  <Field label="CSS selector (optional)" hint="Only watch part of the page, e.g. #announcements">
                    <input name="selector" className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </AddCard>
            <AddCard
              title="Calendar feed (ICS)"
              how={
                <>
                  Any iCal link: course calendars, club calendars, or the bCourses calendar feed (bCourses → Calendar → Calendar Feed) if you don&apos;t use a bCourses token.
                </>
              }
            >
              <ActionForm action={addConnection.bind(null, "ics")} submitLabel="Add feed">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Feed URL">
                    <input name="url" required placeholder="https://… or webcal://…" className={inputClass} />
                  </Field>
                  <Field label="Name">
                    <input name="label" placeholder="MATH 110 calendar" className={inputClass} />
                  </Field>
                  <Field label="Treat entries as">
                    <select name="kind" defaultValue="auto" className={inputClass}>
                      <option value="auto">Detect automatically</option>
                      <option value="events">Events</option>
                      <option value="assignments">Assignments (deadlines)</option>
                    </select>
                  </Field>
                  <Field label="Course (optional)">
                    <input name="course" className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </AddCard>
            <p className="px-1 pt-1 text-xs leading-relaxed text-muted">
              Pensieve and CalCentral can&apos;t be connected directly (no API; CalNet requires Duo). Their notification emails are recognized in Gmail and shown under Classes.
              Instagram and iMessage are handled privately by the Mac agent.
            </p>
          </div>
        </Section>

        <Section
          id="agent"
          title="Mac agent — iMessage & Instagram"
          description={
            <>
              A small script on your Mac finds conversations where the other person spoke last. Message text never leaves your Mac; only an end-to-end encrypted list of{" "}
              <em>who</em> and <em>since when</em> is uploaded, and only your browser can decrypt it.
            </>
          }
        >
          <p className="mb-4 text-sm text-ink-2">
            Status:{" "}
            {agentSeen ? (
              <span className="font-medium text-green">last checked in {fmtAgo(agentSeen.at, now)} ago</span>
            ) : agentPaired ? (
              <span className="font-medium text-amber">paired, waiting for first upload</span>
            ) : (
              <span className="font-medium text-muted">not set up</span>
            )}
          </p>
          <AgentPairing appUrl={appUrl()} paired={agentPaired} />
          <div className="mt-6 border-t border-line-2 pt-5">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">What counts as “waiting on you”</h3>
            <ActionForm action={saveReplySettings}>
              <div className="grid gap-x-6 sm:grid-cols-2">
                <Field label="Look back (days)">
                  <input name="lookbackDays" type="number" min={1} max={90} defaultValue={s.replyQueue.lookbackDays} className={inputClass} />
                </Field>
                <div />
                <Toggle name="contactsOnly" label="Only people in my contacts" hint="Skips unknown numbers and spam" defaultChecked={s.replyQueue.contactsOnly} />
                <Toggle name="includeGroups" label="Include group chats" defaultChecked={s.replyQueue.includeGroups} />
                <Toggle name="tapback" label="A reaction (❤️, 👍) counts as a reply" defaultChecked={s.replyQueue.tapbackCountsAsReply} />
              </div>
            </ActionForm>
          </div>
          <div className="mt-5 border-t border-line-2 pt-4">
            <ActionButton action={forgetReplyQueue} variant="danger" confirm="Delete the encrypted reply-queue data stored on the server?">
              Delete encrypted reply data from server
            </ActionButton>
          </div>
        </Section>

        <Section id="layout" title="Dashboard layout" description="Reorder or hide widgets.">
          <WidgetEditor widgets={WIDGETS.map((w) => ({ id: w.id, name: w.name }))} order={s.widgets.order} hidden={s.widgets.hidden} />
        </Section>

        <Section id="courses" title="Courses" description="Rename courses and hide ones you've dropped.">
          <ActionForm action={saveCourses}>
            <Field label="Display names" hint="One per line: COURSE = Name, e.g. DATA 100 = Data 100">
              <textarea
                name="aliases"
                rows={4}
                defaultValue={Object.entries(s.courseAliases)
                  .map(([k, v]) => `${k} = ${v}`)
                  .join("\n")}
                className={inputClass}
              />
            </Field>
            {courses.length > 0 && (
              <fieldset className="mt-4">
                <legend className="text-[13px] font-medium text-ink-2">Hide these courses everywhere</legend>
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
                  {[...new Set([...courses, ...s.hiddenCourses])].map((c) => (
                    <label key={c} className="flex items-center gap-1.5 text-sm text-ink-2">
                      <input type="checkbox" name="hidden" value={c} defaultChecked={s.hiddenCourses.includes(c)} className="accent-[var(--navy)]" />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </ActionForm>
        </Section>

        <Section id="system" title="System" description="Health of the deployment and what the agent did recently.">
          <ul>
            <Check ok={emailConfigured()} label={`Email sending (${env.gmailSender()})`} hint="Set GMAIL_APP_PASSWORD (a Google app password for the agent mailbox)." />
            <Check ok={aiAvailable()} label={`AI agent (${env.aiModel()})`} hint="Set ANTHROPIC_API_KEY to enable triage, auto-reminders and the digest summary." />
            <Check ok={!!env.googleClientId() && !!env.googleClientSecret()} label="Google sign-in" hint="Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." />
            <Check ok={!!env.cronSecret()} label="Scheduler secret" hint="Set CRON_SECRET and point a scheduler at /api/cron/tick every 10 minutes." />
            <Check ok={pushConfigured()} label="Push notifications" hint="Optional: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY." />
            <Check
              ok={!!runs.find((x) => x.kind === "tick" && now.getTime() - new Date(x.started_at).getTime() < 45 * 60_000)}
              label="Scheduler running"
              hint="No agent run in the last 45 minutes. Check your cron job (SETUP.md, step 8)."
            />
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton action={runTickNow}>Run the agent now</ActionButton>
          </div>
          <h3 className="mb-2 mt-6 text-[13px] font-semibold text-ink">Recent runs</h3>
          <ul className="divide-y divide-line-2 rounded-xl border border-line text-xs">
            {runs.map((x) => (
              <li key={x.id} className="flex items-start gap-3 px-3 py-2">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${x.ok === false ? "bg-red" : x.ok ? "bg-green" : "bg-amber"}`} aria-hidden />
                <span className="w-24 shrink-0 text-muted">{fmtAgo(x.started_at, now)} ago</span>
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2" title={JSON.stringify(x.detail)}>
                  {JSON.stringify(x.detail)?.slice(0, 220)}
                </code>
              </li>
            ))}
            {!runs.length && <li className="px-3 py-2 text-muted">No runs yet.</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}

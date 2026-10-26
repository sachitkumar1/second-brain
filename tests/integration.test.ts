// Runs the scheduler, digest and triage against a real Postgres (TEST_DATABASE_URL), with email,
// push and Claude mocked. Skipped when no test database is configured.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DB = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = DB ?? "postgres://unused";
process.env.SESSION_SECRET = "test-session-secret-0123456789";
process.env.ENCRYPTION_KEY = "test-key";
process.env.APP_URL = "https://brain.example.com";
process.env.ANTHROPIC_API_KEY = "test";
process.env.GMAIL_APP_PASSWORD = "test";

const sent: { subject: string; html: string; text: string }[] = [];
vi.mock("@/lib/notify/email", () => ({
  emailConfigured: () => true,
  sendEmail: vi.fn(async (m: { subject: string; html: string; text: string }) => {
    sent.push(m);
    return true;
  }),
}));
vi.mock("@/lib/notify/push", () => ({ pushConfigured: () => false, sendPush: vi.fn(async () => 0) }));
const structuredCall = vi.fn();
vi.mock("@/lib/agent/claude", () => ({
  aiAvailable: () => true,
  structuredCall: (...a: unknown[]) => structuredCall(...a),
  textCall: vi.fn(async () => "A calm Monday.\nTop priorities:\n- Finish HW 6"),
}));

const NOON = new Date("2026-10-26T19:00:00Z"); // Monday 12:00 PT

describe.skipIf(!DB)("scheduler, digest and triage", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any, notify: any, digest: any, triage: any, settings: any, sources: any;

  beforeAll(async () => {
    execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: DB } });
    ({ sql } = await import("@/lib/db"));
    notify = await import("@/lib/notify/scheduler");
    digest = await import("@/lib/agent/digest");
    triage = await import("@/lib/agent/triage");
    settings = await import("@/lib/settings");
    sources = await import("@/lib/sources");
  });
  afterAll(async () => sql?.end());
  beforeEach(async () => {
    sent.length = 0;
    structuredCall.mockReset();
    await sql`truncate tasks, items, events, alerts, notification_log, digests, connections cascade`;
    await sql`delete from settings`;
    await settings.saveSettings({ notifications: { email: true, push: false, quietHours: { enabled: true, start: "23:00", end: "07:30" }, rules: {} } });
  });

  it("sends a deadline heads-up once per lead time", async () => {
    await sql`insert into tasks (source, kind, external_id, title, course, due_at) values ('canvas','assignment','a1','HW 6','DATA 100', ${new Date(NOON.getTime() + 2 * 3_600_000)})`;
    const r1 = await notify.runNotifications(NOON);
    expect(r1.deadlines).toBe(1);
    expect(sent[0].subject).toContain("HW 6");
    expect(sent[0].html).toContain("/api/act?t="); // one-click links
    const r2 = await notify.runNotifications(new Date(NOON.getTime() + 10 * 60_000));
    expect(r2.deadlines).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("emails your own reminders at their time, even in quiet hours", async () => {
    const lateNight = new Date("2026-10-27T07:00:00Z"); // 00:00 PT
    await sql`insert into tasks (source, kind, title, remind_at, due_at) values ('manual','reminder','Take out trash', ${new Date(lateNight.getTime() - 60_000)}, ${lateNight})`;
    const r = await notify.runNotifications(lateNight);
    expect(r.quiet).toBe(true);
    expect(r.reminders).toBe(1);
    expect(sent[0].subject).toBe("⏰ Reminder: Take out trash");
  });

  it("holds non-urgent alerts during quiet hours and batches them later", async () => {
    await sql`insert into alerts (dedupe_key, kind, title) values ('a','announcement','Midterm logistics'), ('b','grade','Graded: PS 5')`;
    await sql`insert into alerts (dedupe_key, kind, title, urgent) values ('c','urgent','Prof emailed you', true)`;
    const night = new Date("2026-10-27T08:00:00Z"); // 1am PT
    expect((await notify.runNotifications(night)).alerts).toBe(1);
    expect(sent[0].subject).toContain("Prof emailed you");
    expect((await notify.runNotifications(NOON)).alerts).toBe(2);
    expect(sent[1].subject).toBe("2 new updates");
  });

  it("carries unfinished work into the next digest unless told not to", async () => {
    const yesterday = new Date(NOON.getTime() - 26 * 3_600_000);
    await sql`insert into tasks (source, kind, title, due_at) values ('manual','reminder','Pay rent', ${yesterday})`;
    await sql`insert into tasks (source, kind, title, due_at, carry_over) values ('manual','reminder','Old thing', ${yesterday}, false)`;
    await sql`insert into tasks (source, kind, external_id, title, due_at) values ('canvas','assignment','old','Lab 2', ${new Date(NOON.getTime() - 10 * 86_400_000)})`;
    await sql`insert into tasks (source, kind, external_id, title, due_at) values ('canvas','assignment','today','HW 6', ${new Date(NOON.getTime() + 6 * 3_600_000)})`;
    await sql`insert into tasks (source, kind, title, due_at, status) values ('manual','reminder','Done already', ${yesterday}, 'done')`;
    const s = await settings.getSettings();
    const d = await digest.buildDigestData(s, NOON);
    expect(d.overdue.map((t: { title: string }) => t.title)).toEqual(["Pay rent"]);
    expect(d.overdue[0].daysOverdue).toBe(1);
    expect(d.dueToday.map((t: { title: string }) => t.title)).toEqual(["HW 6"]);
  });

  it("sends the digest once after the configured time", async () => {
    await settings.saveSettings({ digest: { enabled: true, time: "07:00", aiSummary: true } });
    const early = new Date("2026-10-26T13:00:00Z"); // 6am PT
    expect((await digest.maybeSendDigest(early)).sent).toBe(false);
    const r = await digest.maybeSendDigest(new Date("2026-10-26T14:05:00Z")); // 7:05 PT
    expect(r.sent).toBe(true);
    expect(sent[0].subject).toMatch(/^☀️ Daily brief/);
    expect(sent[0].text).toContain("Finish HW 6");
    expect((await digest.maybeSendDigest(new Date("2026-10-26T15:00:00Z"))).sent).toBe(false);
  });

  it("turns triaged items into reminders, skips duplicates of tracked assignments, and flags urgent ones", async () => {
    await settings.saveSettings({ notifications: { rules: { aiUrgent: true } } });
    await sql`insert into tasks (source, kind, external_id, title, course, due_at) values ('gradescope','assignment','6','Problem Set 6','MATH 110', ${new Date("2026-10-29T06:59:00Z")})`;
    const [item] = await sql`insert into items (source, kind, external_id, title, body, author, occurred_at) values ('gmail','email','m1','Extension','You have until Wed noon. Please reply to confirm.','Prof. Ruiz', ${NOON}) returning *`;
    structuredCall.mockResolvedValue({
      results: [
        {
          ref: "1",
          summary: "Extension granted until Wednesday noon; reply to confirm.",
          importance: 3,
          category: "class",
          course: "MATH 110",
          notify_now: true,
          actions: [
            { title: "Reply to Prof. Ruiz to confirm", due: null, kind: "reply", priority: 3 },
            { title: "Submit Problem Set 6", due: "2026-10-28T23:59", kind: "deadline", priority: 2 },
          ],
        },
      ],
    });
    const r = await triage.triageBatch([item], await settings.getSettings(), NOON);
    expect(r).toMatchObject({ processed: 1, tasks: 1, alerts: 1 });
    const agentTasks = await sql`select title from tasks where source = 'agent'`;
    expect(agentTasks.map((t: { title: string }) => t.title)).toEqual(["Reply to Prof. Ruiz to confirm"]);
    const [updated] = await sql`select summary, importance, ai_status, course from items where id = ${item.id}`;
    expect(updated).toMatchObject({ importance: 3, ai_status: "done", course: "MATH 110" });
    const prompt = structuredCall.mock.calls[0][0].user as string;
    expect(prompt).toContain("Problem Set 6"); // tracked assignments are given to the model
  });

  it("raises alerts for new class items per your rules", async () => {
    const s = await settings.getSettings();
    const [ann] = await sql`insert into items (source, kind, external_id, title, occurred_at, course) values ('canvas','announcement','x','Midterm moved', ${NOON}, 'DATA 100') returning *`;
    const [slackPost] = await sql`insert into items (source, kind, external_id, title, occurred_at) values ('slack','announcement','y','Pizza tonight', ${NOON}) returning *`;
    const [task] = await sql`insert into tasks (source, kind, external_id, title, due_at) values ('canvas','assignment','z','Lab 9', ${new Date(NOON.getTime() + 86_400_000)}) returning *`;
    const n = await sources.alertsForNew([ann, slackPost], [task], s, NOON);
    expect(n).toBe(2); // Slack announcements are off by default
    const titles = (await sql`select title from alerts order by title`).map((a: { title: string }) => a.title);
    expect(titles).toEqual(["DATA 100: Midterm moved", "New assignment: Lab 9"]);
  });
});

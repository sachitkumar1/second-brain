// Local preview only: fills the database with realistic sample data so you can see the dashboard
// without connecting accounts. Never run this against your real database.
//   DATABASE_URL=postgres://... npx tsx scripts/seed-demo.ts
import postgres from "postgres";
import { deriveKey, encryptPayload, makeIdKey } from "../agent/apollo-agent.mjs";
import { createHash } from "node:crypto";

const url = process.env.DATABASE_URL!;
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("Refusing to seed a non-local database.");
const sql = postgres(url, { onnotice: () => {} });
const TZ = "America/Los_Angeles";

function localToUtc(dayOffset: number, hhmm: string): Date {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  const base = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + dayOffset);
  const d = new Date(base);
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  return new Date(guess - (asUtc - guess));
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function main() {
  await sql`truncate items, events, tasks, alerts, digests, reply_queue, reply_dismissals, reply_waiting, connections, run_log, notification_log cascade`;
  await sql`delete from settings`;

  const [google] = await sql`insert into connections (type, label, account, status, last_sync_at) values ('google', 'sachitkumar2025@gmail.com', 'sachitkumar2025@gmail.com', 'ok', now()) returning id`;
  const [berkeley] = await sql`insert into connections (type, label, account, status, last_sync_at) values ('google', 'sachit@berkeley.edu', 'sachit@berkeley.edu', 'ok', now()) returning id`;
  const [canvas] = await sql`insert into connections (type, label, status, last_sync_at) values ('canvas', 'bCourses', 'ok', now()) returning id`;
  const [gs] = await sql`insert into connections (type, label, status, last_sync_at) values ('gradescope', 'Gradescope', 'ok', now()) returning id`;
  const [ed] = await sql`insert into connections (type, label, status, last_sync_at) values ('ed', 'Ed Discussion', 'ok', now()) returning id`;
  const [slack] = await sql`insert into connections (type, label, account, status, last_sync_at) values ('slack', 'Data Science Society', 'Data Science Society', 'ok', now()) returning id`;
  await sql`insert into connections (type, label, config, status, last_sync_at) values ('webpage', 'DATA 100 site', ${sql.json({ url: "https://ds100.org/fa26/", course: "DATA 100" })}, 'ok', now())`;

  // Calendar
  const ev = (d: number, s: string, e: string, title: string, loc: string | null, color: string, cal = "Classes") =>
    sql`insert into events (connection_id, source, external_id, calendar, title, location, starts_at, ends_at, color)
        values (${google.id}, 'gcal', ${`${title}-${d}-${s}`}, ${cal}, ${title}, ${loc}, ${localToUtc(d, s)}, ${localToUtc(d, e)}, ${color})`;
  for (const d of [0, 2, 4]) await ev(d, "09:30", "11:00", "DATA C100 Lecture", "Wheeler 150", "#2563eb");
  for (const d of [0, 2]) await ev(d, "14:00", "15:00", "MATH 110 Lecture", "Evans 10", "#7c3aed");
  await ev(1, "11:00", "12:30", "STAT 134 Lecture", "Li Ka Shing 245", "#0d9488");
  await ev(3, "11:00", "12:30", "STAT 134 Lecture", "Li Ka Shing 245", "#0d9488");
  await ev(0, "16:00", "17:00", "DATA 100 Office Hours", "Warren 101B", "#2563eb");
  await ev(0, "18:30", "19:30", "DSS General Meeting", "Soda 306", "#c2410c", "Clubs");
  await ev(1, "15:00", "16:00", "Coffee chat — Jane Street recruiter", "Zoom", "#be123c", "Personal");
  await ev(3, "17:00", "18:00", "MATH 110 Discussion", "Evans 75", "#7c3aed");
  await ev(5, "10:00", "12:00", "Study group: STAT 134 midterm", "Moffitt 4th floor", "#0d9488", "Personal");
  await sql`insert into events (connection_id, source, external_id, calendar, title, starts_at, ends_at, all_day, color) values (${google.id}, 'gcal', 'allday', 'Academic', 'Last day to drop with W', ${localToUtc(2, "00:00")}, ${localToUtc(3, "00:00")}, true, '#a16207')`;

  // Assignments
  const asg = (src: string, conn: string, id: string, title: string, course: string, due: Date, submitted = false, url = "https://bcourses.berkeley.edu") =>
    sql`insert into tasks (source, kind, connection_id, external_id, title, course, url, due_at, submitted, status, priority)
        values (${src}, 'assignment', ${conn}, ${id}, ${title}, ${course}, ${url}, ${due}, ${submitted}, ${submitted ? "done" : "open"}, 2)`;
  await asg("gradescope", gs.id, "1", "Homework 6: Gradient Descent", "DATA 100", localToUtc(0, "23:59"), false, "https://www.gradescope.com");
  await asg("canvas", canvas.id, "2", "Lab 8: Modeling and Feature Engineering", "DATA 100", localToUtc(1, "17:00"));
  await asg("gradescope", gs.id, "3", "Problem Set 7", "MATH 110", localToUtc(2, "23:59"), false, "https://www.gradescope.com");
  await asg("canvas", canvas.id, "4", "Reading Quiz: Chapter 9", "STAT 134", localToUtc(3, "09:00"));
  await asg("gradescope", gs.id, "5", "Homework 8", "STAT 134", localToUtc(5, "23:59"), false, "https://www.gradescope.com");
  await asg("canvas", canvas.id, "6", "Project 2 Checkpoint", "DATA 100", localToUtc(9, "23:59"));
  await asg("gradescope", gs.id, "7", "Problem Set 6", "MATH 110", localToUtc(-1, "23:59"), false, "https://www.gradescope.com");
  await asg("canvas", canvas.id, "8", "Lab 7", "DATA 100", localToUtc(-3, "17:00"), true);

  // Agent reminders (extracted from email/announcements) and manual ones
  const [i1] = await sql`insert into items (connection_id, source, kind, external_id, title, body, author, url, course, account, occurred_at, is_unread, is_class, importance, summary, ai_status)
    values (${berkeley.id}, 'gmail', 'email', 'e1', 'Re: Extension request for PS 6', 'Hi Sachit, I can give you until Wednesday at noon. Please submit via Gradescope and reply to confirm.', 'Prof. Elena Ruiz', 'https://mail.google.com', 'MATH 110', 'sachit@berkeley.edu', ${hoursAgo(3)}, true, true, 3,
    'Prof. Ruiz extended Problem Set 6 to Wednesday noon; reply to confirm and submit on Gradescope.', 'done') returning id`;
  await sql`insert into tasks (source, kind, external_id, item_id, title, notes, course, due_at, priority) values
    ('agent', 'reminder', ${i1.id + ":0"}, ${i1.id}, 'Reply to Prof. Ruiz to confirm the extension', 'Prof. Ruiz extended Problem Set 6 to Wednesday noon; reply to confirm and submit on Gradescope.', 'MATH 110', null, 3),
    ('agent', 'reminder', ${i1.id + ":1"}, ${i1.id}, 'Submit Problem Set 6 (extended)', 'Extension granted until Wednesday noon.', 'MATH 110', ${localToUtc(2, "12:00")}, 2)`;
  await sql`insert into tasks (source, kind, external_id, title, notes, due_at, priority) values
    ('agent', 'reminder', 'x2', 'Fill out DSS project team preferences', 'Form closes Friday per #announcements.', ${localToUtc(4, "23:59")}, 1)`;
  await sql`insert into tasks (source, kind, title, due_at, remind_at, priority) values
    ('manual', 'reminder', 'Call mom', ${localToUtc(0, "20:00")}, ${localToUtc(0, "20:00")}, 1),
    ('manual', 'reminder', 'Pay rent', ${localToUtc(-2, "12:00")}, ${localToUtc(-2, "09:00")}, 2),
    ('manual', 'reminder', 'Book flight home for Thanksgiving', null, null, 1)`;

  // Class updates
  const item = (conn: string, src: string, kind: string, id: string, title: string, body: string, author: string | null, course: string, h: number, unread: boolean, importance: number, summary: string | null) =>
    sql`insert into items (connection_id, source, kind, external_id, title, body, author, url, course, occurred_at, is_unread, is_class, importance, summary, ai_status)
        values (${conn}, ${src}, ${kind}, ${id}, ${title}, ${body}, ${author}, 'https://bcourses.berkeley.edu', ${course}, ${hoursAgo(h)}, ${unread}, true, ${importance}, ${summary}, 'done')`;
  await item(canvas.id, "canvas", "announcement", "a1", "Midterm 2 logistics", "Midterm 2 is next Thursday 7–9pm in Pimentel. One double-sided cheat sheet allowed...", "Prof. Narges Norouzi", "DATA 100", 5, true, 3, "Midterm 2 is next Thursday 7–9pm in Pimentel; one double-sided cheat sheet allowed.");
  await item(ed.id, "ed", "announcement", "a2", "HW 6 Q4 clarification", "For Q4b you may assume the learning rate is constant...", "Course staff", "DATA 100", 9, true, 2, "HW 6 Q4b: assume a constant learning rate; no need to tune it.");
  await item(gs.id, "gradescope", "grade", "g1", "Graded: Problem Set 5", "Score: 46.0 / 50.0", null, "MATH 110", 20, false, 1, null);
  await item(canvas.id, "webpage", "update", "w1", "DATA 100 site updated", "Lecture 18 slides posted\nDiscussion 9 worksheet and solutions", null, "DATA 100", 26, false, 1, "Lecture 18 slides and Discussion 9 worksheet were posted on the course site.");
  await item(ed.id, "ed", "post", "p1", "Office hours moved to Soda 283 this week", "Due to a room conflict...", "Ani Adhikari (TA)", "STAT 134", 30, false, 1, "STAT 134 office hours are in Soda 283 this week only.");

  // Inbox
  const mail = (conn: string, acct: string, id: string, subject: string, from: string, h: number, unread: boolean, importance: number, summary: string) =>
    sql`insert into items (connection_id, source, kind, external_id, title, body, author, url, account, occurred_at, is_unread, importance, summary, ai_status)
        values (${conn}, 'gmail', 'email', ${id}, ${subject}, ${summary}, ${from}, 'https://mail.google.com', ${acct}, ${hoursAgo(h)}, ${unread}, ${importance}, ${summary}, 'done')`;
  await mail(google.id, "sachitkumar2025@gmail.com", "m1", "Your Jane Street interview: next steps", "Jane Street Recruiting", 2, true, 3, "Jane Street invited you to pick a second-round interview slot by Thursday.");
  await mail(berkeley.id, "sachit@berkeley.edu", "m2", "Spring 2027 enrollment appointments", "Office of the Registrar", 7, true, 2, "Your Phase 1 enrollment appointment for Spring 2027 is Nov 12 at 10am.");
  await mail(google.id, "sachitkumar2025@gmail.com", "m3", "Statement available", "Chase", 15, false, 1, "Your October credit card statement is ready.");
  await mail(berkeley.id, "sachit@berkeley.edu", "m4", "DSS consulting project kickoff", "Maya Patel", 22, false, 2, "Maya shared the kickoff agenda for the consulting project and asked for availability.");
  await mail(google.id, "sachitkumar2025@gmail.com", "m5", "Weekly newsletter", "Morning Brew", 30, false, 0, "Newsletter.");

  // Slack
  await sql`insert into items (connection_id, source, kind, external_id, title, body, author, url, channel, account, occurred_at, importance, ai_status) values
    (${slack.id}, 'slack', 'mention', 's1', '@Sachit can you review the slides before Thursday?', '@Sachit can you review the slides before Thursday?', 'Maya Patel', 'https://slack.com', '#consulting', 'Data Science Society', ${hoursAgo(4)}, 2, 'done'),
    (${slack.id}, 'slack', 'announcement', 's2', 'General meeting tonight at 6:30 in Soda 306 — pizza provided', 'General meeting tonight at 6:30 in Soda 306 — pizza provided', 'DSS Board', 'https://slack.com', '#announcements', 'Data Science Society', ${hoursAgo(6)}, 1, 'done'),
    (${slack.id}, 'slack', 'announcement', 's3', 'Project team preference form closes Friday', 'Project team preference form closes Friday', 'DSS Board', 'https://slack.com', '#announcements', 'Data Science Society', ${hoursAgo(28)}, 2, 'done')`;
  await sql`insert into reply_waiting (id, connection_id, source, name, waiting_since, unanswered, url, state_hash) values
    ('slack:D1', ${slack.id}, 'slack', 'Maya Patel', ${hoursAgo(4)}, 2, 'https://slack.com', 'h1')`;

  // Drive
  const file = (id: string, name: string, mime: string, h: number, author: string, shared = false) =>
    sql`insert into items (connection_id, source, kind, external_id, title, author, url, occurred_at, ai_status, ai_meta)
        values (${google.id}, 'drive', 'file', ${id}, ${name}, ${author}, 'https://drive.google.com', ${hoursAgo(h)}, 'skipped', ${sql.json({ mimeType: mime, shared })})`;
  await file("f1", "STAT 134 midterm notes", "application/vnd.google-apps.document", 1, "You");
  await file("f2", "DSS consulting — client deck", "application/vnd.google-apps.presentation", 5, "Maya Patel", true);
  await file("f3", "Budget Fall 2026", "application/vnd.google-apps.spreadsheet", 26, "You");
  await file("f4", "Resume — Sachit Kumar.pdf", "application/pdf", 72, "You");

  // Encrypted reply queue exactly as the Mac agent would upload it (passphrase: "demo passphrase")
  const salt = Buffer.from("demo-salt-123456").toString("base64");
  const key = await deriveKey("demo passphrase", salt, 600_000);
  const idKey = makeIdKey("demo passphrase", salt);
  const h = (s: string) => createHash("sha256").update(idKey.toString("hex") + s).digest("hex");
  const mk = (name: string, handle: string | null, hrs: number, n: number, q: boolean, unread: boolean, group = false) => ({
    id: h(name), state: h(name + hrs), name, handle, isGroup: group, unanswered: n,
    waitingSince: hoursAgo(hrs).toISOString(), lastIncomingAt: hoursAgo(hrs - 0.5).toISOString(), question: q, unread,
  });
  const im = { v: 1, platform: "imessage", asOf: new Date().toISOString(), source: "chat.db", threads: [
    mk("Arjun Mehta", "+15105550101", 52, 3, true, false),
    mk("Priya Shah", "+15105550102", 20, 1, true, true),
    mk("Dad", "+14085550103", 8, 2, false, true),
    mk("Leo Kim", "+15105550104", 3, 1, false, true),
  ] };
  const ig = { v: 1, platform: "instagram", asOf: hoursAgo(30).toISOString(), source: "export", threads: [
    mk("Zoë Alvarez", null, 70, 2, true, false),
    mk("Ethan Wu", null, 26, 1, false, false),
  ] };
  for (const [platform, data] of [["imessage", im], ["instagram", ig]] as const) {
    const { ciphertext, iv } = await encryptPayload(key, data);
    await sql`insert into reply_queue (platform, ciphertext, iv, salt, kdf, waiting_count, oldest_wait_at, generated_at)
              values (${platform}, ${ciphertext}, ${iv}, ${salt}, ${sql.json({ name: "PBKDF2", hash: "SHA-256", iterations: 600000 })}, ${data.threads.length}, ${data.threads[0].waitingSince}, now())`;
  }
  await sql`insert into settings (key, value) values ('agent_last_seen', ${sql.json({ at: hoursAgo(0.15).toISOString(), platform: "imessage" })})`;

  // Today's digest narrative
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  await sql`insert into digests (date, data, narrative, sent_at) values (${today}, ${sql.json({})}, ${
    "A full Monday: DATA 100 lecture at 9:30, MATH 110 at 2, office hours at 4 and the DSS meeting at 6:30.\nTop priorities:\n- Finish DATA 100 Homework 6 (due 11:59 PM tonight) — note the Q4b clarification on Ed.\n- Reply to Prof. Ruiz to confirm your Problem Set 6 extension (still open from yesterday).\n- Pick a Jane Street second-round slot before Thursday.\nArjun and Priya are waiting on texts, and Maya asked you to review the consulting slides."
  }, now())`;
  await sql`insert into run_log (kind, finished_at, ok, detail) values ('tick', now(), true, ${sql.json({ demo: true })})`;
  console.log("Seeded demo data. Reply-queue passphrase: demo passphrase");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

-- Apollo schema. Every statement is idempotent so migrations can re-run safely.

create extension if not exists pgcrypto;

-- Key/value app settings (notification email, digest time, rules, widget layout...).
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per connected account/feed (a Google account, a Slack workspace, Canvas, Ed, ...).
-- `secret` holds AES-256-GCM encrypted credentials; it is never sent to the browser.
create table if not exists connections (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,
  label        text not null,
  account      text,
  config       jsonb not null default '{}'::jsonb,
  secret       text,
  cursor       jsonb not null default '{}'::jsonb,
  enabled      boolean not null default true,
  status       text not null default 'ok',
  last_sync_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now()
);

-- Unified feed: emails, announcements, Slack messages, Ed posts, course-site changes, Drive files.
create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid references connections(id) on delete cascade,
  source        text not null,
  kind          text not null,
  external_id   text not null,
  title         text not null,
  body          text,
  author        text,
  url           text,
  course        text,
  channel       text,
  account       text,
  occurred_at   timestamptz not null,
  is_unread     boolean not null default false,
  is_class      boolean not null default false,
  importance    smallint,
  summary       text,
  ai_status     text not null default 'pending',
  ai_meta       jsonb,
  dismissed     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (source, connection_id, external_id)
);
create index if not exists items_occurred_idx on items (occurred_at desc);
create index if not exists items_pending_idx on items (created_at) where ai_status = 'pending';
create index if not exists items_kind_idx on items (kind, occurred_at desc);

-- Calendar events from Google Calendar and ICS feeds.
create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid references connections(id) on delete cascade,
  source        text not null,
  external_id   text not null,
  calendar      text,
  title         text not null,
  location      text,
  description   text,
  url           text,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  all_day       boolean not null default false,
  color         text,
  updated_at    timestamptz not null default now(),
  unique (source, connection_id, external_id)
);
create index if not exists events_starts_idx on events (starts_at);

-- Everything you need to do: synced assignments, agent-created reminders, and your own reminders.
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                 -- manual | agent | canvas | gradescope | ics
  kind          text not null default 'reminder', -- reminder | assignment
  connection_id uuid references connections(id) on delete set null,
  external_id   text,
  item_id       uuid references items(id) on delete set null,
  title         text not null,
  notes         text,
  course        text,
  url           text,
  due_at        timestamptz,
  remind_at     timestamptz,
  all_day       boolean not null default false,
  priority      smallint not null default 1,   -- 0 low, 1 normal, 2 high, 3 urgent
  status        text not null default 'open',  -- open | done | dismissed
  carry_over    boolean not null default true,
  submitted     boolean not null default false,
  score         text,
  user_touched  boolean not null default false, -- set when you change a synced task by hand
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists tasks_open_due_idx on tasks (due_at) where status = 'open';

-- Alerts waiting to be emailed/pushed (new announcement, grade posted, urgent email...).
create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  kind        text not null,
  title       text not null,
  body        text,
  url         text,
  item_id     uuid references items(id) on delete cascade,
  urgent      boolean not null default false,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists alerts_unsent_idx on alerts (created_at) where sent_at is null;

-- Idempotency log so a reminder/deadline notice is never sent twice.
create table if not exists notification_log (
  key     text primary key,
  sent_at timestamptz not null default now()
);

create table if not exists digests (
  date       date primary key,
  data       jsonb not null,
  narrative  text,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);

-- End-to-end encrypted reply queue uploaded by the Mac agent. The server only ever
-- sees ciphertext plus a count; names are decrypted in your browser.
create table if not exists reply_queue (
  platform       text primary key,
  ciphertext     text not null,
  iv             text not null,
  salt           text not null,
  kdf            jsonb not null,
  waiting_count  integer not null default 0,
  oldest_wait_at timestamptz,
  generated_at   timestamptz,
  updated_at     timestamptz not null default now()
);

-- Dismiss/snooze markers keyed by opaque state hashes (the server cannot tell who they refer to).
create table if not exists reply_dismissals (
  state_hash text primary key,
  until      timestamptz,
  created_at timestamptz not null default now()
);

-- Cloud-visible "waiting on you" threads (Slack DMs).
create table if not exists reply_waiting (
  id            text primary key,
  connection_id uuid references connections(id) on delete cascade,
  source        text not null,
  name          text not null,
  waiting_since timestamptz not null,
  unanswered    integer not null default 1,
  url           text,
  state_hash    text not null,
  updated_at    timestamptz not null default now()
);

create table if not exists push_subscriptions (
  endpoint   text primary key,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists login_attempts (
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_idx on login_attempts (ip, at);

-- Run log shown under Settings → System so you can see what the agent did and any errors.
create table if not exists run_log (
  id          bigserial primary key,
  kind        text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  detail      jsonb
);
create index if not exists run_log_started_idx on run_log (started_at desc);

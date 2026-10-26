-- Per-calendar visibility: every synced calendar is listed here, and events remember which one they came from.
create table if not exists calendars (
  id            text primary key,           -- "<connection id>:<google calendar id>", or the connection id for ICS feeds
  connection_id uuid not null references connections(id) on delete cascade,
  name          text not null,
  color         text,
  account       text,
  created_at    timestamptz not null default now()
);

alter table events add column if not exists calendar_id text;
create index if not exists events_calendar_idx on events (calendar_id);

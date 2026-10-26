-- Syllabi and course schedules (uploaded files, bCourses syllabus pages, course websites) that the
-- agent reads to add deadlines and exams.
create table if not exists syllabi (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                  -- upload | canvas | webpage
  ref           text,                           -- stable key for synced sources (one row per course/page)
  connection_id uuid references connections(id) on delete cascade,
  course        text,
  title         text not null,
  url           text,
  content_text  text,
  content_pdf   bytea,
  content_hash  text not null,
  status        text not null default 'pending', -- pending | done | error
  error         text,
  attempts      integer not null default 0,
  item_count    integer not null default 0,
  highlights    jsonb not null default '[]'::jsonb,
  extracted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source, ref)
);
create index if not exists syllabi_pending_idx on syllabi (updated_at) where status = 'pending';

-- Lesson tutor: a cartoon character per lesson and the live voice tutor.
--
-- * lesson_characters: one character per topic (two poses), generated after
--   the lesson publishes and stored in the private `lesson-art` bucket. The
--   row is its own work queue, so it never touches generation_jobs or the
--   credit ledger: art is included in the lesson credit.
-- * tutor_sessions: usage metadata for live voice sessions. No audio and no
--   transcripts are stored.
-- * parents.live_tutor_allowed: a grown-up switch for the voice tutor.
--   Entitlement itself stays on parents.tutor_enabled (Max).

-- ---------------------------------------------------------------------------
-- lesson_characters
-- ---------------------------------------------------------------------------
create table public.lesson_characters (
  topic_id uuid primary key references public.topics (id) on delete cascade,
  parent_id uuid references public.parents (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed')),
  concept text,
  seed integer,
  model text,
  talk_path text,
  teach_path text,
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'ready' or (talk_path is not null and teach_path is not null))
);
create index lesson_characters_queue_idx on public.lesson_characters (status, run_after)
  where status in ('queued', 'running');
create index lesson_characters_parent_day_idx on public.lesson_characters (parent_id, created_at);

create trigger lesson_characters_touch before update on public.lesson_characters
  for each row execute function public.touch_updated_at();

alter table public.lesson_characters enable row level security;
revoke insert, update, delete on public.lesson_characters from anon, authenticated;

create policy "lesson characters select by learner" on public.lesson_characters for select
  using (public.can_learn_topic(topic_id));

-- ---------------------------------------------------------------------------
-- tutor_sessions
-- ---------------------------------------------------------------------------
create table public.tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  parent_id uuid not null references public.parents (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  artifact_session_id uuid references public.artifact_sessions (id) on delete set null,
  model text not null,
  status text not null default 'issued' check (status in ('issued', 'ended')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  seconds_used integer check (seconds_used is null or seconds_used >= 0),
  check (expires_at > started_at)
);
create index tutor_sessions_child_day_idx on public.tutor_sessions (child_id, started_at desc);
create index tutor_sessions_open_idx on public.tutor_sessions (child_id) where status = 'issued';

alter table public.tutor_sessions enable row level security;
revoke insert, update, delete on public.tutor_sessions from anon, authenticated;

create policy "tutor sessions select by owner" on public.tutor_sessions for select
  using (public.owns_child(child_id));

-- ---------------------------------------------------------------------------
-- parents.live_tutor_allowed (readable; written by a server action)
-- ---------------------------------------------------------------------------
alter table public.parents
  add column live_tutor_allowed boolean not null default true;

grant select (id, email, tier, timezone, kind, created_at, credit_balance, tutor_enabled, live_tutor_allowed)
  on public.parents to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, service role only (no storage.objects policies)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-art', 'lesson-art', false, 4194304, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

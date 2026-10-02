-- Durable learner memory.
--
-- learner_memories holds short cards. Parents may read and deactivate them.
-- Child logins cannot. Compaction (service role) writes inferred cards.
-- personalization_context stays the parent-typed interest, preference, and note store.
--
-- children.age is a cache. When birth_year and birth_month are set, a trigger
-- fills age and the model is not allowed to write it.
-- Memory jobs do not reserve credits and do not count toward the two-job cap.

-- ---------------------------------------------------------------------------
-- Birth month and year. Age is computed; both columns are set or both are null.
-- ---------------------------------------------------------------------------
alter table public.children
  add column birth_year smallint,
  add column birth_month smallint,
  add constraint children_birth_month_check check (birth_month is null or birth_month between 1 and 12),
  add constraint children_birth_year_check check (birth_year is null or birth_year between 1900 and 2100),
  add constraint children_birth_pair_check check (
    (birth_year is null and birth_month is null)
    or (birth_year is not null and birth_month is not null)
  );

-- Completed years as of p_on. The birthday is the first of the birth month.
create or replace function public.age_from_birth(p_year integer, p_month integer, p_on date)
returns smallint
language sql
immutable
as $$
  select (
    (extract(year from p_on)::integer - p_year)
    - case when extract(month from p_on)::integer < p_month then 1 else 0 end
  )::smallint;
$$;

create or replace function public.set_child_age_from_birth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.birth_year is not null and new.birth_month is not null then
    new.age := public.age_from_birth(new.birth_year::integer, new.birth_month::integer, (timezone('utc', now()))::date);
  end if;
  return new;
end;
$$;

create trigger children_set_age_from_birth
  before insert or update of birth_year, birth_month, age
  on public.children
  for each row execute function public.set_child_age_from_birth();

grant update (birth_year, birth_month) on public.children to authenticated;
grant execute on function public.age_from_birth(integer, integer, date) to authenticated;
grant execute on function public.set_child_age_from_birth() to authenticated;

-- Rewrite the cached age when a birthday month has passed. Skip a value that
-- would violate the kind's age check so one row cannot fail the daily sweep.
create or replace function public.refresh_learner_ages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.children c
  set age = public.age_from_birth(c.birth_year::integer, c.birth_month::integer, (timezone('utc', now()))::date)
  where c.birth_year is not null
    and c.birth_month is not null
    and public.age_from_birth(c.birth_year::integer, c.birth_month::integer, (timezone('utc', now()))::date) is distinct from c.age
    and (
      (c.kind = 'child' and public.age_from_birth(c.birth_year::integer, c.birth_month::integer, (timezone('utc', now()))::date) between 3 and 18)
      or (c.kind = 'self' and public.age_from_birth(c.birth_year::integer, c.birth_month::integer, (timezone('utc', now()))::date) between 13 and 120)
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cards
-- ---------------------------------------------------------------------------
create table public.learner_memories (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  kind text not null check (kind in ('interest', 'preference', 'strength', 'misconception', 'analogy_that_worked')),
  value text not null check (char_length(btrim(value)) between 1 and 200),
  source text not null check (source in ('parent', 'inferred')),
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index learner_memories_identity_idx
  on public.learner_memories (child_id, kind, lower(btrim(value)));

create index learner_memories_active_idx
  on public.learner_memories (child_id, confidence, last_seen_at)
  where active;

alter table public.learner_memories enable row level security;
revoke all on table public.learner_memories from anon, authenticated;
grant select on table public.learner_memories to authenticated;
grant update (active) on table public.learner_memories to authenticated;

-- Parents only. No insert, no delete, and no policy for child logins.
create policy "memories select by owner" on public.learner_memories for select
  using (public.owns_child(child_id));

create policy "memories deactivate by owner" on public.learner_memories for update
  using (public.owns_child(child_id))
  with check (public.owns_child(child_id) and active = false);

-- Drop the lowest-confidence inferred cards until the active inferred count
-- is within p_cap. Ties break toward the oldest last_seen_at. Parent cards stay.
create or replace function public.enforce_memory_cap(p_child_id uuid, p_cap integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  n integer := 0;
  v_count integer;
begin
  if p_cap < 0 then
    raise exception 'memory cap must be non-negative';
  end if;

  loop
    select count(*) into v_count
    from public.learner_memories
    where child_id = p_child_id and active and source = 'inferred';

    exit when v_count <= p_cap;

    select id into v_id
    from public.learner_memories
    where child_id = p_child_id and active and source = 'inferred'
    order by confidence asc, last_seen_at asc, id asc
    limit 1;

    exit when v_id is null;

    update public.learner_memories
    set active = false
    where id = v_id and source = 'inferred';

    n := n + 1;
    exit when n > 1000;
  end loop;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Raw traces older than 90 days, only after mastery or progress exists.
-- ---------------------------------------------------------------------------
create or replace function public.purge_learning_traces()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  d integer;
begin
  delete from public.learning_events e
  where e.occurred_at < now() - interval '90 days'
    and (
      exists (
        select 1 from public.topic_progress tp
        where tp.child_id = e.child_id and tp.topic_id = e.topic_id
      )
      or exists (
        select 1
        from public.objective_mastery om
        join public.learning_objectives lo on lo.id = om.objective_id
        where om.child_id = e.child_id and lo.topic_id = e.topic_id
      )
    );
  get diagnostics d = row_count;
  n := n + d;

  delete from public.responses r
  where r.occurred_at < now() - interval '90 days'
    and (
      exists (
        select 1 from public.topic_progress tp
        where tp.child_id = r.child_id and tp.topic_id = r.topic_id
      )
      or exists (
        select 1
        from public.objective_mastery om
        join public.learning_objectives lo on lo.id = om.objective_id
        where om.child_id = r.child_id and lo.topic_id = r.topic_id
      )
    );
  get diagnostics d = row_count;
  n := n + d;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- generation_jobs: memory kind, excluded from the billable concurrency cap
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'generation_jobs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.generation_jobs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.generation_jobs
  add constraint generation_jobs_kind_check
  check (kind in ('curriculum', 'artifact', 'daily_report', 'memory'));

-- One queued compaction per learner. A running job may have a single follow-up.
create unique index generation_jobs_one_queued_memory_idx
  on public.generation_jobs ((payload->>'childId'))
  where kind = 'memory' and status = 'queued';

create index generation_jobs_memory_open_idx
  on public.generation_jobs ((payload->>'childId'))
  where kind = 'memory' and status in ('queued', 'running');

-- Insert the curriculum and its job only after the credit and the caps pass.
-- On ok: { ok, job_id, curriculum_id }. Otherwise { ok: false, error }.
-- Memory jobs are not billable and do not consume the two-job slot.
create or replace function public.start_curriculum_job(p_child_id uuid, p_goal text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_balance integer;
  v_recent integer;
  v_running integer;
  v_curriculum_id uuid;
  v_job_id uuid;
  v_goal text := trim(p_goal);
begin
  if v_goal is null or char_length(v_goal) < 5 or char_length(p_goal) > 600 then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select parent_id into v_parent from public.children where id = p_child_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select credit_balance into v_balance
  from public.parents
  where id = v_parent
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select count(*) into v_recent
  from public.curricula cu
  join public.children c on c.id = cu.child_id
  where c.parent_id = v_parent
    and cu.created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limit');
  end if;

  select count(*) into v_running
  from public.generation_jobs
  where parent_id = v_parent and status in ('queued', 'running') and kind <> 'memory';

  if v_running >= 2 then
    return jsonb_build_object('ok', false, 'error', 'concurrency');
  end if;

  if v_balance < 1 then
    return jsonb_build_object('ok', false, 'error', 'credits');
  end if;

  insert into public.curricula (child_id, goal_text, title, status)
  values (p_child_id, v_goal, 'Preparing your curriculum…', 'generating')
  returning id into v_curriculum_id;

  insert into public.generation_jobs (kind, payload, parent_id)
  values ('curriculum', jsonb_build_object('curriculumId', v_curriculum_id), v_parent)
  returning id into v_job_id;

  if not public.reserve_credit(v_parent, v_job_id, 'outline') then
    raise exception 'credit reserve failed after balance check';
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'curriculum_id', v_curriculum_id);
end;
$$;

create or replace function public.retry_curriculum_job(p_curriculum_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_balance integer;
  v_running integer;
  v_existing uuid;
  v_job_id uuid;
begin
  perform 1 from public.curricula where id = p_curriculum_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select c.parent_id into v_parent
  from public.curricula cu
  join public.children c on c.id = cu.child_id
  where cu.id = p_curriculum_id;

  if v_parent is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select credit_balance into v_balance
  from public.parents
  where id = v_parent
  for update;

  select id into v_existing
  from public.generation_jobs
  where parent_id = v_parent
    and kind = 'curriculum'
    and status in ('queued', 'running')
    and payload->>'curriculumId' = p_curriculum_id::text
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'skipped', true, 'job_id', v_existing, 'curriculum_id', p_curriculum_id);
  end if;

  select count(*) into v_running
  from public.generation_jobs
  where parent_id = v_parent and status in ('queued', 'running') and kind <> 'memory';

  if v_running >= 2 then
    return jsonb_build_object('ok', false, 'error', 'concurrency');
  end if;

  if v_balance < 1 then
    return jsonb_build_object('ok', false, 'error', 'credits');
  end if;

  update public.curricula
  set status = 'generating', error = null
  where id = p_curriculum_id;

  insert into public.generation_jobs (kind, payload, parent_id)
  values ('curriculum', jsonb_build_object('curriculumId', p_curriculum_id), v_parent)
  returning id into v_job_id;

  if not public.reserve_credit(v_parent, v_job_id, 'outline') then
    raise exception 'credit reserve failed after balance check';
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'curriculum_id', p_curriculum_id);
end;
$$;

create or replace function public.start_artifact_job(p_topic_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_tier text;
  v_balance integer;
  v_running integer;
  v_art_id uuid;
  v_art_status text;
  v_art_version integer;
  v_artifact_id uuid;
  v_job_id uuid;
  v_required boolean;
begin
  if p_reason not in ('initial', 'prewarm', 'regenerate') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select c.parent_id into v_parent
  from public.topics t
  join public.curricula cu on cu.id = t.curriculum_id
  join public.children c on c.id = cu.child_id
  where t.id = p_topic_id;

  if v_parent is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select tier, credit_balance into v_tier, v_balance
  from public.parents
  where id = v_parent
  for update;

  perform 1 from public.topics where id = p_topic_id for update;

  select id, status, version into v_art_id, v_art_status, v_art_version
  from public.artifacts
  where topic_id = p_topic_id
  order by version desc
  limit 1;

  v_required := p_reason <> 'prewarm';

  if p_reason = 'regenerate' then
    if v_art_id is not null and v_art_status = 'generating' then
      return jsonb_build_object('ok', true, 'skipped', true, 'artifact_id', v_art_id);
    end if;
    if v_tier = 'free' and v_art_id is not null and v_art_status = 'published' then
      return jsonb_build_object('ok', false, 'error', 'plan');
    end if;
  elsif v_art_id is not null and v_art_status <> 'failed' then
    return jsonb_build_object('ok', true, 'skipped', true, 'artifact_id', v_art_id);
  end if;

  select count(*) into v_running
  from public.generation_jobs
  where parent_id = v_parent and status in ('queued', 'running') and kind <> 'memory';

  if v_running >= 2 then
    if v_required then
      return jsonb_build_object('ok', false, 'error', 'concurrency');
    end if;
    return jsonb_build_object('ok', false, 'error', 'skipped');
  end if;

  if v_balance < 1 then
    if v_required then
      return jsonb_build_object('ok', false, 'error', 'credits');
    end if;
    return jsonb_build_object('ok', false, 'error', 'skipped');
  end if;

  insert into public.artifacts (topic_id, version, status)
  values (p_topic_id, coalesce(v_art_version, 0) + 1, 'generating')
  returning id into v_artifact_id;

  insert into public.generation_jobs (kind, payload, parent_id)
  values (
    'artifact',
    jsonb_build_object('topicId', p_topic_id, 'reason', p_reason, 'artifactId', v_artifact_id),
    v_parent
  )
  returning id into v_job_id;

  if not public.reserve_credit(v_parent, v_job_id, p_reason) then
    raise exception 'credit reserve failed after balance check';
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'artifact_id', v_artifact_id);
end;
$$;

-- Signup may pass birth_year and birth_month. Age alone still works so existing
-- accounts and tests keep a cached age until a birthday is saved.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_kind text;
  self_name text;
  birth_year smallint;
  birth_month smallint;
  given_age smallint;
  month_start date := (date_trunc('month', timezone('utc', now())))::date;
begin
  if coalesce(new.raw_app_meta_data ->> 'account', '') = 'child' then
    return new;
  end if;

  account_kind := case when new.raw_user_meta_data ->> 'account_kind' = 'individual' then 'individual' else 'parent' end;

  insert into public.parents (id, email, kind)
  values (new.id, new.email, account_kind)
  on conflict (id) do nothing;

  if found then
    perform public.grant_period(new.id, public.plan_credits('free'), month_start);
  end if;

  if account_kind = 'individual' then
    self_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Me'), 40);
    birth_year := nullif(new.raw_user_meta_data ->> 'birth_year', '')::smallint;
    birth_month := nullif(new.raw_user_meta_data ->> 'birth_month', '')::smallint;
    given_age := nullif(new.raw_user_meta_data ->> 'age', '')::smallint;
    insert into public.children (parent_id, display_name, age, birth_year, birth_month, kind)
    values (new.id, self_name, given_age, birth_year, birth_month, 'self');
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

do $grant$
declare
  fn text;
begin
  foreach fn in array array[
    'public.refresh_learner_ages()',
    'public.enforce_memory_cap(uuid, integer)',
    'public.purge_learning_traces()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$grant$;

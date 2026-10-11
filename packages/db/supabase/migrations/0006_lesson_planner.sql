-- Planner-driven lessons.
--
-- curricula carry the goal's scope and the interest to frame it with.
-- A topic too big for one lesson becomes a unit: its child topics are
-- inserted right after it, and the planning attempt is refunded, so no
-- lesson is generated (or charged) until a child topic is opened.
-- artifacts keep the LessonPlan they implement. Generated images live in
-- artifact_assets and are inlined into the published HTML as data: URIs.
-- topic_progress.feedback is the end-of-lesson summary for kid and parent.

-- ---------------------------------------------------------------------------
-- Scope and interest per goal. Existing goals read as hobby, the closest
-- match to how they were generated.
-- ---------------------------------------------------------------------------
alter table public.curricula
  add column scope text not null default 'hobby',
  add column scope_note text,
  add column interest text,
  add constraint curricula_scope_check check (scope in ('overview', 'hobby', 'exam', 'mastery')),
  add constraint curricula_scope_note_check check (scope_note is null or char_length(scope_note) <= 300),
  add constraint curricula_interest_check check (interest is null or char_length(interest) <= 120);

-- ---------------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------------
alter table public.topics
  add column kind text not null default 'lesson',
  add column parent_topic_id uuid references public.topics (id) on delete cascade,
  add constraint topics_kind_check check (kind in ('lesson', 'unit')),
  add constraint topics_parent_not_self check (parent_topic_id is null or parent_topic_id <> id);
create index topics_parent_idx on public.topics (parent_topic_id) where parent_topic_id is not null;

-- ---------------------------------------------------------------------------
-- Lesson plans and the split status
-- ---------------------------------------------------------------------------
alter table public.artifacts add column lesson_plan jsonb;
alter table public.artifacts drop constraint if exists artifacts_status_check;
alter table public.artifacts
  add constraint artifacts_status_check check (status in ('generating', 'published', 'failed', 'split'));

-- ---------------------------------------------------------------------------
-- Generated images. Service role writes; learners and owners read.
-- ---------------------------------------------------------------------------
create table public.artifact_assets (
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  key text not null,
  mime text not null,
  data_base64 text not null,
  created_at timestamptz not null default now(),
  primary key (artifact_id, key),
  constraint artifact_assets_key_check check (key ~ '^[a-z0-9_-]{1,60}$'),
  constraint artifact_assets_mime_check check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  constraint artifact_assets_size_check check (char_length(data_base64) <= 3000000)
);

alter table public.artifact_assets enable row level security;

create policy "assets select by learner" on public.artifact_assets for select
  using (exists (
    select 1 from public.artifacts a
    where a.id = artifact_id and public.can_learn_topic(a.topic_id)
  ));

revoke insert, update, delete on public.artifact_assets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- End-of-lesson feedback
-- ---------------------------------------------------------------------------
alter table public.topic_progress add column feedback jsonb;

-- ---------------------------------------------------------------------------
-- Turn a topic into a unit. Shifts later topics down, inserts the child
-- topics and their objectives, and marks the planning artifact as split.
-- Idempotent: a topic that is already a unit is left alone.
--
-- p_children: [{ "slug", "title", "description", "objectives": [text, ...] }, ...]
-- ---------------------------------------------------------------------------
create or replace function public.split_topic_into_unit(
  p_topic_id uuid,
  p_artifact_id uuid,
  p_plan jsonb,
  p_children jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic public.topics%rowtype;
  v_count integer;
  v_child jsonb;
  v_child_id uuid;
  v_i integer := 0;
  v_j integer;
  v_text text;
  v_prev_slug text;
begin
  select * into v_topic from public.topics where id = p_topic_id for update;
  if not found then
    raise exception 'topic % not found', p_topic_id;
  end if;

  if v_topic.kind = 'unit' then
    update public.artifacts
    set status = 'split', lesson_plan = coalesce(lesson_plan, p_plan), error = null
    where id = p_artifact_id and topic_id = p_topic_id and status = 'generating';
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if v_topic.parent_topic_id is not null then
    raise exception 'a child topic cannot become a unit';
  end if;

  v_count := coalesce(jsonb_array_length(p_children), 0);
  if v_count < 2 then
    raise exception 'a unit needs at least two child topics';
  end if;

  perform 1 from public.topics where curriculum_id = v_topic.curriculum_id for update;

  update public.topics
  set position = position + v_count
  where curriculum_id = v_topic.curriculum_id and position > v_topic.position;

  for v_child in select value from jsonb_array_elements(p_children)
  loop
    v_i := v_i + 1;
    insert into public.topics (curriculum_id, slug, title, description, position, difficulty, prerequisites, kind, parent_topic_id)
    values (
      v_topic.curriculum_id,
      v_child ->> 'slug',
      left(v_child ->> 'title', 80),
      left(coalesce(v_child ->> 'description', ''), 400),
      v_topic.position + v_i,
      v_topic.difficulty,
      case when v_prev_slug is null then v_topic.prerequisites else array[v_prev_slug] end,
      'lesson',
      v_topic.id
    )
    returning id into v_child_id;

    v_j := 0;
    for v_text in select value from jsonb_array_elements_text(v_child -> 'objectives')
    loop
      v_j := v_j + 1;
      exit when v_j > 6;
      insert into public.learning_objectives (topic_id, code, text, position)
      values (v_child_id, 'lo' || v_j, left(v_text, 200), v_j);
    end loop;

    v_prev_slug := v_child ->> 'slug';
  end loop;

  update public.topics set kind = 'unit' where id = v_topic.id;
  update public.artifacts
  set status = 'split', lesson_plan = p_plan, error = null
  where id = p_artifact_id and topic_id = p_topic_id;

  return jsonb_build_object('ok', true, 'children', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Units have no lesson of their own, so starting one is always skipped.
-- Otherwise identical to 0005.
-- ---------------------------------------------------------------------------
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
  v_kind text;
begin
  if p_reason not in ('initial', 'prewarm', 'regenerate') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select c.parent_id, t.kind into v_parent, v_kind
  from public.topics t
  join public.curricula cu on cu.id = t.curriculum_id
  join public.children c on c.id = cu.child_id
  where t.id = p_topic_id;

  if v_parent is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_kind = 'unit' then
    return jsonb_build_object('ok', true, 'skipped', true);
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

do $grant$
begin
  execute 'revoke all on function public.split_topic_into_unit(uuid, uuid, jsonb, jsonb) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.split_topic_into_unit(uuid, uuid, jsonb, jsonb) to service_role';
  end if;
end
$grant$;

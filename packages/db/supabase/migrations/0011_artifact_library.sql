-- Artifact library: reusable interactive artifacts that lessons can embed.
--
-- * library_artifacts: one row per artifact. The id is the manifest id
--   (kebab-case), the same string a lesson stores in LibraryRef.artifactId.
-- * library_artifact_versions: immutable once published. A trigger enforces
--   the status lifecycle for every role, the service role included.
-- * library_search_log / library_usage: matching decisions and which lesson
--   pinned which artifact@version.
-- * staff_users: who may use the Studio. Staff read drafts; every write still
--   goes through the service role.
-- * Storage: private `library` bucket, service role only.

-- ---------------------------------------------------------------------------
-- staff_users
-- ---------------------------------------------------------------------------
create table public.staff_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.staff_users enable row level security;
revoke insert, update, delete on public.staff_users from anon, authenticated;

create policy "staff users read self" on public.staff_users for select to authenticated
  using (user_id = auth.uid());

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_users s where s.user_id = auth.uid());
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- library_artifacts
-- ---------------------------------------------------------------------------
create table public.library_artifacts (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) between 3 and 64),
  title text not null check (char_length(title) between 3 and 80),
  owner uuid references auth.users (id) on delete set null,
  current_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger library_artifacts_touch before update on public.library_artifacts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- library_artifact_versions
-- ---------------------------------------------------------------------------
create table public.library_artifact_versions (
  artifact_id text not null references public.library_artifacts (id) on delete cascade,
  version integer not null check (version >= 1),
  manifest jsonb not null,
  entry_file text not null,
  files jsonb not null,
  bundle_sha256 text not null check (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'testing', 'published', 'retired')),
  validation_report jsonb,
  compliance_level smallint not null check (compliance_level between 0 and 3),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  retired_at timestamptz,
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(manifest ->> 'title', '')), 'A')
    || setweight(to_tsvector('english'::regconfig, coalesce(manifest ->> 'description', '')), 'B')
    || setweight(jsonb_to_tsvector('english'::regconfig, coalesce(manifest -> 'subjects', '[]'::jsonb) || coalesce(manifest -> 'topics', '[]'::jsonb), '["string"]'), 'B')
    || setweight(jsonb_to_tsvector('english'::regconfig, coalesce(manifest -> 'concepts', '[]'::jsonb) || coalesce(manifest -> 'learningObjectives', '[]'::jsonb), '["string"]'), 'C')
  ) stored,
  primary key (artifact_id, version),
  check (manifest ->> 'id' = artifact_id),
  check (manifest -> 'version' = to_jsonb(version)),
  check (manifest ->> 'entry' = entry_file),
  check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) between 1 and 2000),
  check (files @> jsonb_build_array(jsonb_build_object('path', entry_file))),
  check ((status in ('published', 'retired')) = (published_at is not null)),
  check ((status = 'retired') = (retired_at is not null))
);
create index library_versions_status_idx on public.library_artifact_versions (status, artifact_id);
create index library_versions_search_idx on public.library_artifact_versions using gin (search_tsv);
create index library_versions_manifest_idx on public.library_artifact_versions using gin (manifest jsonb_path_ops);

alter table public.library_artifacts
  add constraint library_artifacts_current_version_fkey
  foreign key (id, current_version) references public.library_artifact_versions (artifact_id, version);

-- Lifecycle: draft <-> testing -> published -> retired. Published rows only
-- ever change status (to retired); retired rows never change; neither can be
-- deleted. Applies to every role.
create or replace function public.guard_library_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception 'library version %@% is % and cannot be deleted', old.artifact_id, old.version, old.status;
    end if;
    return old;
  end if;

  if new.artifact_id <> old.artifact_id or new.version <> old.version then
    raise exception 'library version %@% cannot be renumbered', old.artifact_id, old.version;
  end if;

  if old.status = 'retired' then
    raise exception 'library version %@% is retired and cannot change', old.artifact_id, old.version;
  end if;

  if new.status <> old.status and (old.status, new.status) not in (
    ('draft', 'testing'), ('testing', 'draft'), ('testing', 'published'), ('published', 'retired')
  ) then
    raise exception 'library version %@% cannot move from % to %', old.artifact_id, old.version, old.status, new.status;
  end if;

  if old.status = 'published' and (
    new.manifest is distinct from old.manifest
    or new.entry_file is distinct from old.entry_file
    or new.files is distinct from old.files
    or new.bundle_sha256 is distinct from old.bundle_sha256
    or new.validation_report is distinct from old.validation_report
    or new.compliance_level is distinct from old.compliance_level
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.published_at is distinct from old.published_at
    or new.published_by is distinct from old.published_by
  ) then
    raise exception 'library version %@% is published and cannot be modified', old.artifact_id, old.version;
  end if;

  if new.status = 'published' and old.status <> 'published' then
    new.published_at := now();
  elsif new.status = 'retired' then
    new.retired_at := now();
  end if;
  return new;
end;
$$;

create trigger library_versions_guard before update or delete on public.library_artifact_versions
  for each row execute function public.guard_library_version();

-- ---------------------------------------------------------------------------
-- library_search_log
-- ---------------------------------------------------------------------------
create table public.library_search_log (
  id bigint generated always as identity primary key,
  topic_id uuid references public.topics (id) on delete set null,
  artifact_id uuid references public.artifacts (id) on delete set null,
  bite_id text,
  request jsonb not null,
  candidates jsonb not null default '[]'::jsonb,
  decision text not null check (decision in ('accepted', 'rejected_all', 'no_candidates')),
  chosen_artifact_id text,
  chosen_version integer,
  created_at timestamptz not null default now(),
  check ((decision = 'accepted') = (chosen_artifact_id is not null and chosen_version is not null)),
  foreign key (chosen_artifact_id, chosen_version) references public.library_artifact_versions (artifact_id, version)
);
create index library_search_log_created_idx on public.library_search_log (created_at desc);
create index library_search_log_decision_idx on public.library_search_log (decision, created_at desc);

-- ---------------------------------------------------------------------------
-- library_usage
-- ---------------------------------------------------------------------------
create table public.library_usage (
  id bigint generated always as identity primary key,
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  bite_id text not null,
  library_artifact_id text not null,
  library_version integer not null,
  plays integer not null default 0 check (plays >= 0),
  created_at timestamptz not null default now(),
  unique (artifact_id, bite_id),
  foreign key (library_artifact_id, library_version) references public.library_artifact_versions (artifact_id, version)
);
create index library_usage_version_idx on public.library_usage (library_artifact_id, library_version);

-- ---------------------------------------------------------------------------
-- RLS: signed-in users read what lessons can play; staff also read drafts and
-- analytics. No client writes anywhere.
-- ---------------------------------------------------------------------------
alter table public.library_artifacts enable row level security;
alter table public.library_artifact_versions enable row level security;
alter table public.library_search_log enable row level security;
alter table public.library_usage enable row level security;

revoke insert, update, delete on public.library_artifacts from anon, authenticated;
revoke insert, update, delete on public.library_artifact_versions from anon, authenticated;
revoke insert, update, delete on public.library_search_log from anon, authenticated;
revoke insert, update, delete on public.library_usage from anon, authenticated;

create policy "library artifacts read" on public.library_artifacts for select to authenticated
  using (current_version is not null or public.is_staff());

-- Retired versions stay readable so lessons already pinned to them keep playing.
create policy "library versions read" on public.library_artifact_versions for select to authenticated
  using (status in ('published', 'retired') or public.is_staff());

create policy "library search log read by staff" on public.library_search_log for select to authenticated
  using (public.is_staff());

create policy "library usage read by staff" on public.library_usage for select to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Catalog functions (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.library_add_version(
  p_artifact_id text,
  p_manifest jsonb,
  p_files jsonb,
  p_bundle_sha256 text,
  p_compliance integer,
  p_actor uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  perform 1 from public.library_artifacts where id = p_artifact_id for update;
  if not found then
    raise exception 'library artifact % not found', p_artifact_id;
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from public.library_artifact_versions where artifact_id = p_artifact_id;

  insert into public.library_artifact_versions
    (artifact_id, version, manifest, entry_file, files, bundle_sha256, compliance_level, created_by)
  values (
    p_artifact_id,
    v_next,
    jsonb_set(p_manifest, '{version}', to_jsonb(v_next)),
    p_manifest ->> 'entry',
    p_files,
    p_bundle_sha256,
    p_compliance,
    p_actor
  );
  return v_next;
end;
$$;

create or replace function public.library_register_draft(
  p_artifact_id text,
  p_manifest jsonb,
  p_files jsonb,
  p_bundle_sha256 text,
  p_compliance integer,
  p_actor uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.library_artifacts (id, title, owner)
  values (p_artifact_id, p_manifest ->> 'title', p_actor);
  return public.library_add_version(p_artifact_id, p_manifest, p_files, p_bundle_sha256, p_compliance, p_actor);
end;
$$;

-- Moves one version along the lifecycle (the trigger rejects illegal moves)
-- and keeps library_artifacts.current_version on the newest published version.
create or replace function public.library_set_status(
  p_artifact_id text,
  p_version integer,
  p_status text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_current integer;
begin
  select current_version into v_current from public.library_artifacts where id = p_artifact_id for update;
  if not found then
    raise exception 'library artifact % not found', p_artifact_id;
  end if;

  select status into v_old from public.library_artifact_versions
  where artifact_id = p_artifact_id and version = p_version;
  if not found then
    raise exception 'library version %@% not found', p_artifact_id, p_version;
  end if;
  if v_old = p_status then
    raise exception 'library version %@% is already %', p_artifact_id, p_version, p_status;
  end if;

  update public.library_artifact_versions
  set status = p_status,
      published_by = case when p_status = 'published' then p_actor else published_by end
  where artifact_id = p_artifact_id and version = p_version;

  if p_status = 'published' and p_version > coalesce(v_current, 0) then
    update public.library_artifacts a
    set current_version = p_version, title = v.manifest ->> 'title'
    from public.library_artifact_versions v
    where a.id = p_artifact_id and v.artifact_id = p_artifact_id and v.version = p_version;
    v_current := p_version;
  elsif p_status = 'retired' and p_version = v_current then
    select max(version) into v_current from public.library_artifact_versions
    where artifact_id = p_artifact_id and status = 'published';
    update public.library_artifacts set current_version = v_current where id = p_artifact_id;
  end if;

  return jsonb_build_object('status', p_status, 'current_version', v_current);
end;
$$;

do $grant$
declare
  fn text;
begin
  foreach fn in array array[
    'public.library_add_version(text, jsonb, jsonb, text, integer, uuid)',
    'public.library_register_draft(text, jsonb, jsonb, text, integer, uuid)',
    'public.library_set_status(text, integer, text, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$grant$;

-- The trigger must stay executable by whoever can write the table (service
-- role today; postgres in tests). Callers still cannot UPDATE through RLS.

-- ---------------------------------------------------------------------------
-- Storage: private bucket, service role only (no storage.objects policies).
-- Paths: bundles/{artifactId}/{version}/{file}, previews/{artifactId}/{version}/thumb.webp
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 15728640, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

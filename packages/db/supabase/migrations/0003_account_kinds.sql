-- Account kinds on top of the parent -> children model.
--
-- * parents gains `kind` (individual | parent). Every adult auth user still
--   gets exactly one parents row; existing rows default to 'parent'.
-- * children gains `kind` (child | self) and `shared_device`. An individual
--   learns through a single 'self' profile; a parent may also have one.
-- * child_logins maps a child auth user (username + PIN) to one child
--   profile. Child auth users never get a parents row, so nothing is billed
--   to them and owns_child() is always false for them.
-- * Additive RLS lets a child auth user read that child's learn rows and
--   open sessions for that child only.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- parents: kind + grown-up PIN
-- ---------------------------------------------------------------------------
alter table public.parents
  add column kind text not null default 'parent' check (kind in ('individual', 'parent')),
  add column grownup_pin_hash text,
  add column pin_failed smallint not null default 0,
  add column pin_locked_until timestamptz;

-- tier, kind and the PIN columns are service-role only. The PIN hash is also
-- unreadable: on a shared device the child holds the parent's session.
revoke insert, update, delete, select on public.parents from anon, authenticated;
grant select (id, email, tier, timezone, kind, created_at) on public.parents to authenticated;
grant update (timezone) on public.parents to authenticated;

-- ---------------------------------------------------------------------------
-- children: kind, shared_device, age rules, one self profile per account
-- ---------------------------------------------------------------------------
alter table public.children
  add column kind text not null default 'child' check (kind in ('child', 'self')),
  add column shared_device boolean not null default true;

alter table public.children drop constraint children_age_check;
alter table public.children add constraint children_age_check check (
  (kind = 'child' and (age is null or age between 3 and 18))
  or (kind = 'self' and age is not null and age between 13 and 120)
);

create unique index children_one_self_idx on public.children (parent_id) where kind = 'self';

revoke update on public.children from anon, authenticated;
grant update (display_name, age, reading_level, avatar, shared_device) on public.children to authenticated;

drop policy if exists "children by owner" on public.children;

create policy "children select by owner" on public.children for select
  using (parent_id = (select auth.uid()));

create policy "children insert by owner" on public.children for insert
  with check (
    parent_id = (select auth.uid())
    and (
      kind = 'self'
      or exists (select 1 from public.parents p where p.id = (select auth.uid()) and p.kind = 'parent')
    )
  );

create policy "children update by owner" on public.children for update
  using (parent_id = (select auth.uid())) with check (parent_id = (select auth.uid()));

create policy "children delete by owner" on public.children for delete
  using (parent_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- child_logins: username + PIN logins created by a parent
-- ---------------------------------------------------------------------------
create table public.child_logins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  child_id uuid not null unique references public.children (id) on delete cascade,
  parent_id uuid not null references public.parents (id) on delete cascade,
  username citext not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  auth_email text not null unique,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create index child_logins_parent_idx on public.child_logins (parent_id);

alter table public.child_logins enable row level security;
revoke insert, update, delete on public.child_logins from anon, authenticated;

create policy "child logins by parent" on public.child_logins for select
  using (parent_id = (select auth.uid()));

create or replace function public.check_child_login()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.children c
    where c.id = new.child_id and c.parent_id = new.parent_id and c.kind = 'child'
  ) then
    raise exception 'child login must belong to a child profile of the same parent';
  end if;
  return new;
end;
$$;

create trigger child_logins_check before insert or update on public.child_logins
  for each row execute function public.check_child_login();

-- A child profile must stay reachable: shared device, a login, or both.
create or replace function public.check_child_access()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'child' and not new.shared_device
     and not exists (select 1 from public.child_logins l where l.child_id = new.id) then
    raise exception 'a child profile needs shared-device access or a child login';
  end if;
  return new;
end;
$$;

create trigger children_access_check before insert or update of shared_device on public.children
  for each row execute function public.check_child_access();

-- ---------------------------------------------------------------------------
-- Signup trigger: adults only; child auth users are created by the service
-- role with app_metadata.account = 'child' and get no parents row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_kind text;
  self_name text;
begin
  if coalesce(new.raw_app_meta_data ->> 'account', '') = 'child' then
    return new;
  end if;

  account_kind := case when new.raw_user_meta_data ->> 'account_kind' = 'individual' then 'individual' else 'parent' end;

  insert into public.parents (id, email, kind) values (new.id, new.email, account_kind)
  on conflict (id) do nothing;

  if account_kind = 'individual' then
    self_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Me'), 40);
    -- children_age_check rejects a missing age or one under 13, failing the signup.
    insert into public.children (parent_id, display_name, age, kind)
    values (new.id, self_name, (nullif(new.raw_user_meta_data ->> 'age', ''))::smallint, 'self');
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Learner helpers
-- ---------------------------------------------------------------------------
create or replace function public.learner_child_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.child_id from public.child_logins l where l.user_id = auth.uid();
$$;

create or replace function public.can_learn(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.owns_child(cid) or cid = public.learner_child_id();
$$;

create or replace function public.can_learn_topic(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.owns_topic(tid) or exists (
    select 1 from public.topics t
    join public.curricula cu on cu.id = t.curriculum_id
    where t.id = tid and cu.child_id = public.learner_child_id()
  );
$$;

-- The topic must be on that child's curriculum and the artifact must be for that topic.
create or replace function public.session_matches(cid uuid, tid uuid, aid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.topics t
    join public.curricula cu on cu.id = t.curriculum_id
    join public.artifacts a on a.topic_id = t.id
    where t.id = tid and a.id = aid and cu.child_id = cid
  );
$$;

revoke all on function public.learner_child_id() from public, anon;
revoke all on function public.can_learn(uuid) from public, anon;
revoke all on function public.can_learn_topic(uuid) from public, anon;
revoke all on function public.session_matches(uuid, uuid, uuid) from public, anon;
revoke all on function public.check_child_login() from public, anon;
revoke all on function public.check_child_access() from public, anon;
grant execute on function public.check_child_login() to authenticated;
grant execute on function public.check_child_access() to authenticated;
grant execute on function public.learner_child_id() to authenticated;
grant execute on function public.can_learn(uuid) to authenticated;
grant execute on function public.can_learn_topic(uuid) to authenticated;
grant execute on function public.session_matches(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sessions: parents and child logins; inserts must match topic and artifact
-- ---------------------------------------------------------------------------
drop policy if exists "sessions by owner" on public.artifact_sessions;

create policy "sessions select by learner" on public.artifact_sessions for select
  using (public.can_learn(child_id));

create policy "sessions insert by learner" on public.artifact_sessions for insert
  with check (public.can_learn(child_id) and public.session_matches(child_id, topic_id, artifact_id));

revoke update, delete on public.artifact_sessions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Additive read policies for child logins (no personalization, reports,
-- parents, or curriculum writes)
-- ---------------------------------------------------------------------------
create policy "children select by learner" on public.children for select
  using (id = (select public.learner_child_id()));

create policy "curricula select by learner" on public.curricula for select
  using (child_id = (select public.learner_child_id()));

create policy "topics select by learner" on public.topics for select
  using (public.can_learn_topic(id));

create policy "objectives select by learner" on public.learning_objectives for select
  using (public.can_learn_topic(topic_id));

create policy "artifacts select by learner" on public.artifacts for select
  using (public.can_learn_topic(topic_id));

create policy "events select by learner" on public.learning_events for select
  using (child_id = (select public.learner_child_id()));

create policy "responses select by learner" on public.responses for select
  using (child_id = (select public.learner_child_id()));

create policy "mastery select by learner" on public.objective_mastery for select
  using (child_id = (select public.learner_child_id()));

create policy "progress select by learner" on public.topic_progress for select
  using (child_id = (select public.learner_child_id()));

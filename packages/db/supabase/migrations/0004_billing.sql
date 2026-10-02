-- Lesson credits and Stripe billing on parents.
--
-- A credit is one published lesson. The outline job costs one credit too.
-- reserve_credit decrements the balance when a job is enqueued, spend_credit
-- settles it on publish, and refund_credit returns it after a hard failure.
-- The same job can only reserve once, so retries do not double-charge.
--
-- Amounts, the free child cap, and the paid child cap are enforced here.
-- Keep them in sync with apps/web/src/lib/plans.ts:
--   free 10 credits, 1 child; plus (tier paid) 50 credits; max 150 credits; paid/max 8 children.
--   at most 2 queued or running jobs; at most 5 curricula per hour.

-- ---------------------------------------------------------------------------
-- parents: tier, credits, Stripe
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
      and rel.relname = 'parents'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%tier%'
  loop
    execute format('alter table public.parents drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.parents
  add constraint parents_tier_check check (tier in ('free', 'paid', 'max'));

alter table public.parents
  add column tutor_enabled boolean not null default false,
  add column credit_balance integer not null default 0,
  add column credits_period_start date,
  add column stripe_customer_id text,
  add column stripe_subscription_id text,
  add column stripe_period_end timestamptz,
  add column subscription_status text,
  add column cancel_at_period_end boolean not null default false;

alter table public.parents
  add constraint parents_credit_balance_check check (credit_balance >= 0);

create unique index parents_stripe_customer_idx on public.parents (stripe_customer_id) where stripe_customer_id is not null;
create unique index parents_stripe_subscription_idx on public.parents (stripe_subscription_id) where stripe_subscription_id is not null;
create index parents_free_period_idx on public.parents (credits_period_start) where tier = 'free';

-- Stripe ids stay service-role only. Balance and the tutor flag are readable.
revoke insert, update, delete, select on public.parents from anon, authenticated;
grant select (id, email, tier, timezone, kind, created_at, credit_balance, tutor_enabled)
  on public.parents to authenticated;
grant update (timezone) on public.parents to authenticated;

alter table public.generation_jobs
  add column parent_id uuid references public.parents (id) on delete cascade;

create index jobs_parent_active_idx on public.generation_jobs (parent_id)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- Ledger and webhook idempotency. No client policies: service role only.
-- ---------------------------------------------------------------------------
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  amount integer not null,
  kind text not null check (kind in ('grant', 'reserve', 'spend', 'refund', 'expire')),
  job_id uuid references public.generation_jobs (id) on delete cascade,
  reason text,
  period_start date,
  created_at timestamptz not null default now(),
  constraint credit_ledger_shape_check check (
    (kind = 'grant' and amount > 0 and period_start is not null and job_id is null)
    or (kind = 'expire' and amount < 0 and job_id is null)
    or (kind = 'reserve' and amount = -1 and job_id is not null)
    or (kind = 'spend' and amount = 0 and job_id is not null)
    or (kind = 'refund' and amount = 1 and job_id is not null)
  )
);

create index credit_ledger_parent_idx on public.credit_ledger (parent_id, created_at desc);
create unique index credit_ledger_one_reserve_idx on public.credit_ledger (job_id) where kind = 'reserve';
create unique index credit_ledger_one_spend_idx on public.credit_ledger (job_id) where kind = 'spend';
create unique index credit_ledger_one_refund_idx on public.credit_ledger (job_id) where kind = 'refund';
create unique index credit_ledger_one_grant_idx on public.credit_ledger (parent_id, period_start) where kind = 'grant';

alter table public.credit_ledger enable row level security;
revoke all on table public.credit_ledger from anon, authenticated;

create table public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Credit amounts
-- ---------------------------------------------------------------------------
create or replace function public.plan_credits(p_tier text)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'paid' then 50
    when 'max' then 150
    else 10
  end;
$$;

-- Expire leftover available credits (open reserves are already off the
-- balance and are left alone), then grant. A second call for the same period
-- is a no-op, unless the new amount is higher (plan upgrade): then only the
-- difference is added.
create or replace function public.grant_period(p_parent_id uuid, p_amount integer, p_period date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_existing integer;
begin
  if p_amount < 1 then
    raise exception 'grant amount must be positive';
  end if;

  select credit_balance into v_balance
  from public.parents
  where id = p_parent_id
  for update;

  if not found then
    raise exception 'parent % not found', p_parent_id;
  end if;

  select amount into v_existing
  from public.credit_ledger
  where parent_id = p_parent_id and kind = 'grant' and period_start = p_period;

  if found then
    if v_existing >= p_amount then
      return;
    end if;
    update public.credit_ledger
    set amount = p_amount
    where parent_id = p_parent_id and kind = 'grant' and period_start = p_period;
    update public.parents
    set credit_balance = credit_balance + (p_amount - v_existing),
        credits_period_start = p_period
    where id = p_parent_id;
    return;
  end if;

  if v_balance > 0 then
    insert into public.credit_ledger (parent_id, amount, kind, reason)
    values (p_parent_id, -v_balance, 'expire', 'period_end');
    update public.parents set credit_balance = 0 where id = p_parent_id;
  end if;

  insert into public.credit_ledger (parent_id, amount, kind, reason, period_start)
  values (p_parent_id, p_amount, 'grant', 'period_grant', p_period);

  update public.parents
  set credit_balance = p_amount, credits_period_start = p_period
  where id = p_parent_id;
end;
$$;

create or replace function public.grant_tier_period(p_parent_id uuid, p_tier text, p_period date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.grant_period(p_parent_id, public.plan_credits(p_tier), p_period);
end;
$$;

-- True when this job holds a reserve, including when it already did.
-- False when the balance is empty. Never decrements twice for one job.
create or replace function public.reserve_credit(p_parent_id uuid, p_job_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.parents where id = p_parent_id for update;

  if exists (select 1 from public.credit_ledger where job_id = p_job_id and kind = 'reserve') then
    return true;
  end if;

  update public.parents
  set credit_balance = credit_balance - 1
  where id = p_parent_id and credit_balance >= 1;

  if not found then
    return false;
  end if;

  insert into public.credit_ledger (parent_id, amount, kind, job_id, reason)
  values (p_parent_id, -1, 'reserve', p_job_id, p_reason);

  return true;
end;
$$;

-- Settle an open reserve. No second balance change. No-op after spend or refund.
create or replace function public.spend_credit(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
begin
  select parent_id into v_parent
  from public.credit_ledger
  where job_id = p_job_id and kind = 'reserve';

  if not found then
    return false;
  end if;

  perform 1 from public.parents where id = v_parent for update;

  if exists (
    select 1 from public.credit_ledger
    where job_id = p_job_id and kind in ('spend', 'refund')
  ) then
    return false;
  end if;

  insert into public.credit_ledger (parent_id, amount, kind, job_id, reason)
  values (v_parent, 0, 'spend', p_job_id, 'publish');

  return true;
end;
$$;

-- Return a credit only while the reserve is still open.
create or replace function public.refund_credit(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
begin
  select parent_id into v_parent
  from public.credit_ledger
  where job_id = p_job_id and kind = 'reserve';

  if not found then
    return false;
  end if;

  perform 1 from public.parents where id = v_parent for update;

  if exists (
    select 1 from public.credit_ledger
    where job_id = p_job_id and kind in ('spend', 'refund')
  ) then
    return false;
  end if;

  insert into public.credit_ledger (parent_id, amount, kind, job_id, reason)
  values (v_parent, 1, 'refund', p_job_id, 'failed');

  update public.parents
  set credit_balance = credit_balance + 1
  where id = v_parent;

  return true;
end;
$$;

-- Insert the curriculum and its job only after the credit and the caps pass.
-- On ok: { ok, job_id, curriculum_id }. Otherwise { ok: false, error }.
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
  where parent_id = v_parent and status in ('queued', 'running');

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

-- A new job for a failed outline. Does not flip the row to generating when
-- the reserve fails, and does not reserve again while one is already in flight.
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
  where parent_id = v_parent and status in ('queued', 'running');

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

-- p_reason: initial | prewarm | regenerate.
-- prewarm returns error=skipped instead of charging or blocking the caller.
-- A published lesson is returned with skipped=true and no new reserve.
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
  where parent_id = v_parent and status in ('queued', 'running');

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

create or replace function public.refresh_free_grants()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
  month_start date := (date_trunc('month', timezone('utc', now())))::date;
begin
  for r in
    select id
    from public.parents
    where tier = 'free'
      and (credits_period_start is null or credits_period_start < month_start)
    for update skip locked
  loop
    perform public.grant_period(r.id, public.plan_credits('free'), month_start);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Safety net for missed webhooks. Active renewing subscriptions are left alone
-- even if stripe_period_end has passed by a few minutes.
create or replace function public.downgrade_lapsed_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
  month_start date := (date_trunc('month', timezone('utc', now())))::date;
begin
  for r in
    select id
    from public.parents
    where tier in ('paid', 'max')
      and stripe_period_end is not null
      and stripe_period_end <= now()
      and (
        subscription_status in ('past_due', 'canceled', 'unpaid', 'incomplete_expired')
        or cancel_at_period_end
      )
    for update skip locked
  loop
    update public.parents
    set tier = 'free',
        tutor_enabled = false,
        subscription_status = 'canceled',
        stripe_subscription_id = null,
        cancel_at_period_end = false
    where id = r.id;
    perform public.grant_period(r.id, public.plan_credits('free'), month_start);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Child cap. Existing profiles over the cap stay; new ones are refused.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_child_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_cap integer;
  v_count integer;
begin
  if tg_op = 'UPDATE' and old.kind = 'child' then
    return new;
  end if;
  if new.kind <> 'child' then
    return new;
  end if;

  perform 1 from public.parents where id = new.parent_id for update;

  select tier into v_tier from public.parents where id = new.parent_id;
  v_cap := case when v_tier = 'free' then 1 else 8 end;

  select count(*) into v_count
  from public.children
  where parent_id = new.parent_id and kind = 'child';

  if v_count >= v_cap then
    raise exception 'child profile limit reached for this plan' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger children_plan_cap
  before insert or update of kind on public.children
  for each row execute function public.enforce_child_cap();

-- ---------------------------------------------------------------------------
-- Signup grant. Adults only; the row insert must succeed before we grant,
-- so a conflict does not expire an existing paid balance.
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
    insert into public.children (parent_id, display_name, age, kind)
    values (new.id, self_name, (nullif(new.raw_user_meta_data ->> 'age', ''))::smallint, 'self');
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
    'public.plan_credits(text)',
    'public.grant_period(uuid, integer, date)',
    'public.grant_tier_period(uuid, text, date)',
    'public.reserve_credit(uuid, uuid, text)',
    'public.spend_credit(uuid)',
    'public.refund_credit(uuid)',
    'public.start_curriculum_job(uuid, text)',
    'public.retry_curriculum_job(uuid)',
    'public.start_artifact_job(uuid, text)',
    'public.refresh_free_grants()',
    'public.downgrade_lapsed_subscriptions()',
    'public.enforce_child_cap()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$grant$;

-- Trigger execution needs the invoker to be allowed to call the function.
grant execute on function public.enforce_child_cap() to authenticated;

-- Existing accounts receive the same signup grant for their current tier.
do $$
declare
  r record;
  month_start date := (date_trunc('month', timezone('utc', now())))::date;
begin
  for r in select id, tier from public.parents
  loop
    perform public.grant_period(r.id, public.plan_credits(r.tier), month_start);
  end loop;
  update public.parents set tutor_enabled = (tier = 'max');
end $$;

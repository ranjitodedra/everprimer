-- Metered credits: one balance for lessons, pictures and the live tutor.
--
-- A credit is now a fixed slice of real API spend (see packages/ai/src/pricing.ts)
-- instead of one lesson. A typical lesson costs about 100 credits, so plans move
-- from 10/50/150 to 1000/5000/15000 and existing amounts are scaled by 100.
--
-- * Generation jobs reserve an estimate when enqueued (reserve_credit), then
--   settle_credit charges the measured cost: a `spend` row for any extra (never
--   below a zero balance) or a `refund` row for the unused part.
-- * Work outside the job queue (character art, live tutor) is charged with
--   charge_usage, which writes a `charge` row.
-- * Every row that moves credits for usage carries a category, `lesson` or
--   `live`, so Settings can split what was used.

-- ---------------------------------------------------------------------------
-- credit_ledger
-- ---------------------------------------------------------------------------
alter table public.credit_ledger drop constraint credit_ledger_shape_check;
alter table public.credit_ledger drop constraint credit_ledger_kind_check;

alter table public.credit_ledger
  add column category text check (category in ('lesson', 'live')),
  add column tutor_session_id uuid references public.tutor_sessions (id) on delete set null,
  add column topic_id uuid references public.topics (id) on delete set null;

update public.credit_ledger set amount = amount * 100;
update public.credit_ledger set category = 'lesson' where job_id is not null;
update public.parents set credit_balance = credit_balance * 100;

alter table public.credit_ledger
  add constraint credit_ledger_kind_check check (kind in ('grant', 'reserve', 'spend', 'refund', 'expire', 'charge')),
  add constraint credit_ledger_shape_check check (
    (kind = 'grant' and amount > 0 and period_start is not null and job_id is null and category is null)
    or (kind = 'expire' and amount < 0 and job_id is null and category is null)
    or (kind = 'reserve' and amount < 0 and job_id is not null and category is not null)
    or (kind = 'spend' and amount <= 0 and job_id is not null and category is not null)
    or (kind = 'refund' and amount >= 0 and job_id is not null and category is not null)
    or (kind = 'charge' and amount < 0 and job_id is null and category is not null)
  );

create index credit_ledger_usage_idx on public.credit_ledger (parent_id, category, created_at desc)
  where category is not null;
create index credit_ledger_tutor_session_idx on public.credit_ledger (tutor_session_id)
  where tutor_session_id is not null;

-- ---------------------------------------------------------------------------
-- Amounts
-- ---------------------------------------------------------------------------
create or replace function public.plan_credits(p_tier text)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'paid' then 5000
    when 'max' then 15000
    else 1000
  end;
$$;

-- What a job holds while it runs. Settled to the measured cost afterwards.
create or replace function public.credit_estimate(p_reason text)
returns integer
language sql
immutable
as $$
  select case p_reason
    when 'outline' then 5
    else 80
  end;
$$;

-- ---------------------------------------------------------------------------
-- Reserve, settle, refund
-- ---------------------------------------------------------------------------
-- True when this job holds a reserve, including when it already did. False
-- when the balance is empty. Holds the estimate, or what is left if less.
create or replace function public.reserve_credit(p_parent_id uuid, p_job_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_hold integer;
begin
  select credit_balance into v_balance from public.parents where id = p_parent_id for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from public.credit_ledger where job_id = p_job_id and kind = 'reserve') then
    return true;
  end if;

  if v_balance < 1 then
    return false;
  end if;

  v_hold := least(public.credit_estimate(p_reason), v_balance);
  update public.parents set credit_balance = credit_balance - v_hold where id = p_parent_id;

  insert into public.credit_ledger (parent_id, amount, kind, job_id, reason, category)
  values (p_parent_id, -v_hold, 'reserve', p_job_id, p_reason, 'lesson');

  return true;
end;
$$;

-- Charge an open reserve its measured cost. Extra cost is taken only down to a
-- zero balance; unused credits go back. No-op after a settle or a refund.
create or replace function public.settle_credit(p_job_id uuid, p_actual integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_held integer;
  v_balance integer;
  v_delta integer;
  v_take integer;
begin
  select parent_id, -amount into v_parent, v_held
  from public.credit_ledger
  where job_id = p_job_id and kind = 'reserve';

  if not found then
    return false;
  end if;

  select credit_balance into v_balance from public.parents where id = v_parent for update;

  if exists (
    select 1 from public.credit_ledger
    where job_id = p_job_id and kind in ('spend', 'refund')
  ) then
    return false;
  end if;

  v_delta := greatest(coalesce(p_actual, 0), 0) - v_held;

  if v_delta >= 0 then
    v_take := least(v_delta, v_balance);
    insert into public.credit_ledger (parent_id, amount, kind, job_id, reason, category)
    values (v_parent, -v_take, 'spend', p_job_id, 'publish', 'lesson');
    update public.parents set credit_balance = credit_balance - v_take where id = v_parent;
  else
    insert into public.credit_ledger (parent_id, amount, kind, job_id, reason, category)
    values (v_parent, -v_delta, 'refund', p_job_id, 'unused', 'lesson');
    update public.parents set credit_balance = credit_balance - v_delta where id = v_parent;
  end if;

  return true;
end;
$$;

-- Return the whole hold, only while the reserve is still open.
create or replace function public.refund_credit(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_held integer;
begin
  select parent_id, -amount into v_parent, v_held
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

  insert into public.credit_ledger (parent_id, amount, kind, job_id, reason, category)
  values (v_parent, v_held, 'refund', p_job_id, 'failed', 'lesson');

  update public.parents set credit_balance = credit_balance + v_held where id = v_parent;

  return true;
end;
$$;

drop function public.spend_credit(uuid);

-- Charge usage outside the job queue. Takes at most what is left and returns
-- the balance afterwards; a zero result tells the caller to stop.
create or replace function public.charge_usage(
  p_parent_id uuid,
  p_category text,
  p_amount integer,
  p_reason text,
  p_tutor_session_id uuid default null,
  p_topic_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_take integer;
begin
  if p_category not in ('lesson', 'live') then
    raise exception 'unknown usage category %', p_category;
  end if;

  select credit_balance into v_balance from public.parents where id = p_parent_id for update;
  if not found then
    raise exception 'parent % not found', p_parent_id;
  end if;

  v_take := least(greatest(coalesce(p_amount, 0), 0), v_balance);
  if v_take = 0 then
    return v_balance;
  end if;

  insert into public.credit_ledger (parent_id, amount, kind, reason, category, tutor_session_id, topic_id)
  values (p_parent_id, -v_take, 'charge', p_reason, p_category, p_tutor_session_id, p_topic_id);

  update public.parents set credit_balance = credit_balance - v_take where id = p_parent_id;

  return v_balance - v_take;
end;
$$;

-- ---------------------------------------------------------------------------
-- tutor_sessions: metering. expires_at is the current token's expiry and moves
-- forward when the browser renews; last_seen_at is the latest tick.
-- ---------------------------------------------------------------------------
alter table public.tutor_sessions
  add column last_seen_at timestamptz,
  add column credits_used integer not null default 0 check (credits_used >= 0),
  add column input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column output_tokens bigint not null default 0 check (output_tokens >= 0);

update public.tutor_sessions set last_seen_at = coalesce(ended_at, started_at);

create index tutor_sessions_parent_idx on public.tutor_sessions (parent_id, started_at desc);

-- ---------------------------------------------------------------------------
-- lesson_characters: poses cut out of their background
-- ---------------------------------------------------------------------------
alter table public.lesson_characters
  add column cutout boolean not null default false;

-- ---------------------------------------------------------------------------
-- Grants: service role only
-- ---------------------------------------------------------------------------
do $grant$
declare
  fn text;
begin
  foreach fn in array array[
    'public.plan_credits(text)',
    'public.credit_estimate(text)',
    'public.reserve_credit(uuid, uuid, text)',
    'public.settle_credit(uuid, integer)',
    'public.refund_credit(uuid)',
    'public.charge_usage(uuid, text, integer, text, uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$grant$;

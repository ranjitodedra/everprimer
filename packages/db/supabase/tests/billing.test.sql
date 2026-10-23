-- Credit ledger, column grants, and the child cap. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('f1000000-0000-4000-8000-000000000001', 'billing-parent@test.invalid', '{"account_kind":"parent"}', '{}');

-- ---------------------------------------------------------------------------
-- Signup grant
-- ---------------------------------------------------------------------------
select is(
  (select credit_balance from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  1000,
  'signup grants 1000 credits'
);
select is(
  (select credits_period_start from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  (date_trunc('month', timezone('utc', now())))::date,
  'signup stamps the current UTC month'
);
select is(
  (select tutor_enabled from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  false,
  'free signup does not enable the tutor'
);

-- ---------------------------------------------------------------------------
-- Authenticated column and function grants
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$ select credit_balance from public.parents $$, 'parent can read the credit balance');
select throws_ok($$ update public.parents set tier = 'max' $$, '42501', null, 'parent cannot change tier');
select throws_ok($$ update public.parents set credit_balance = 1000 $$, '42501', null, 'parent cannot change the credit balance');
select throws_ok($$ update public.parents set tutor_enabled = true $$, '42501', null, 'parent cannot enable the tutor');
select throws_ok($$ select stripe_customer_id from public.parents $$, '42501', null, 'parent cannot read the Stripe customer id');
select throws_ok(
  $$ select public.reserve_credit('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'test') $$,
  '42501', null, 'parent cannot reserve credits directly'
);

select lives_ok(
  $$ insert into public.children (id, parent_id, display_name, age, kind) values ('f1100000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'First', 7, 'child') $$,
  'free plan can add one child'
);
select throws_ok(
  $$ insert into public.children (parent_id, display_name, age, kind) values ('f1000000-0000-4000-8000-000000000001', 'Second', 7, 'child') $$,
  'P0001', null, 'free plan cannot add a second child'
);

reset role;

-- ---------------------------------------------------------------------------
-- Reserve, spend, refund, grant
-- ---------------------------------------------------------------------------
insert into public.generation_jobs (id, kind, payload, parent_id) values
  ('f1300000-0000-4000-8000-000000000001', 'artifact', '{"topicId":"x"}', 'f1000000-0000-4000-8000-000000000001');

update public.parents set credit_balance = 0 where id = 'f1000000-0000-4000-8000-000000000001';
select is(
  public.reserve_credit('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'test'),
  false,
  'reserve fails when the balance is empty'
);
select is(
  (select count(*) from public.credit_ledger where job_id = 'f1300000-0000-4000-8000-000000000001' and kind = 'reserve'),
  0::bigint,
  'a failed reserve writes no ledger row'
);

update public.parents set credit_balance = 500 where id = 'f1000000-0000-4000-8000-000000000001';
select is(
  public.reserve_credit('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'test'),
  true,
  'reserve succeeds when the balance is positive'
);
select is(
  public.reserve_credit('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'retry'),
  true,
  'reserving the same job again is a no-op success'
);
select is(
  (select credit_balance from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  420,
  'one job holds its estimate once'
);

select is(
  public.settle_credit('f1300000-0000-4000-8000-000000000001', 80),
  true,
  'settle charges the open reserve its measured cost'
);
select is(
  public.refund_credit('f1300000-0000-4000-8000-000000000001'),
  false,
  'refund after settle is a no-op'
);
select is(
  (select credit_balance from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  420,
  'a settle that matches the hold and a later refund leave the balance unchanged'
);

-- Open reserve must survive a new period grant. Leftover available credits expire.
insert into public.generation_jobs (id, kind, payload, parent_id) values
  ('f1300000-0000-4000-8000-000000000002', 'artifact', '{"topicId":"y"}', 'f1000000-0000-4000-8000-000000000001');
select public.reserve_credit('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000002', 'open');
-- balance is 340; the open reserve is not part of it.
select public.grant_period('f1000000-0000-4000-8000-000000000001', 1000, '2099-01-01');
select is(
  (select credit_balance from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  1000,
  'a new period expires leftover credits and grants the new amount'
);
select is(
  (select count(*) from public.credit_ledger where job_id = 'f1300000-0000-4000-8000-000000000002' and kind = 'reserve'),
  1::bigint,
  'a period grant does not touch an open reserve'
);
select public.grant_period('f1000000-0000-4000-8000-000000000001', 1000, '2099-01-01');
select is(
  (select credit_balance from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  1000,
  'granting the same period again does not add credits'
);
select public.grant_period('f1000000-0000-4000-8000-000000000001', 5000, '2099-01-01');
select is(
  (select credit_balance from public.parents where id = 'f1000000-0000-4000-8000-000000000001'),
  5000,
  'a higher grant for the same period tops up the difference'
);

-- ---------------------------------------------------------------------------
-- Curriculum enqueue refuses without writing a row
-- ---------------------------------------------------------------------------
update public.generation_jobs
set status = 'done'
where parent_id = 'f1000000-0000-4000-8000-000000000001';
update public.parents set credit_balance = 0 where id = 'f1000000-0000-4000-8000-000000000001';
select is(
  (public.start_curriculum_job('f1100000-0000-4000-8000-000000000001', 'learn how tides work'))->>'error',
  'credits',
  'curriculum enqueue reports an empty balance'
);
select is(
  (select count(*) from public.curricula where child_id = 'f1100000-0000-4000-8000-000000000001'),
  0::bigint,
  'a refused curriculum leaves no generating row'
);

-- ---------------------------------------------------------------------------
-- Paid child cap, then downgrade keeps existing profiles
-- ---------------------------------------------------------------------------
update public.parents set tier = 'paid' where id = 'f1000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $q$
    insert into public.children (parent_id, display_name, age, kind)
    select 'f1000000-0000-4000-8000-000000000001', 'K' || g, 8, 'child'
    from generate_series(2, 8) g
  $q$,
  'plus can hold 8 children'
);
select throws_ok(
  $$ insert into public.children (parent_id, display_name, age, kind) values ('f1000000-0000-4000-8000-000000000001', 'Ninth', 8, 'child') $$,
  'P0001', null, 'plus cannot add a ninth child'
);

reset role;
update public.parents set tier = 'free' where id = 'f1000000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.children where parent_id = 'f1000000-0000-4000-8000-000000000001' and kind = 'child'),
  8::bigint,
  'downgrade keeps child profiles that already exist'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.children (parent_id, display_name, age, kind) values ('f1000000-0000-4000-8000-000000000001', 'After', 8, 'child') $$,
  'P0001', null, 'free again cannot add another child'
);

select * from finish();
rollback;

-- Metered credits: estimates, settling to measured cost, usage charges. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('f2000000-0000-4000-8000-000000000001', 'metered-parent@test.invalid', '{"account_kind":"parent"}', '{}');

insert into public.generation_jobs (id, kind, payload, parent_id) values
  ('f2300000-0000-4000-8000-000000000001', 'artifact', '{"topicId":"a"}', 'f2000000-0000-4000-8000-000000000001'),
  ('f2300000-0000-4000-8000-000000000002', 'artifact', '{"topicId":"b"}', 'f2000000-0000-4000-8000-000000000001'),
  ('f2300000-0000-4000-8000-000000000003', 'curriculum', '{"curriculumId":"c"}', 'f2000000-0000-4000-8000-000000000001'),
  ('f2300000-0000-4000-8000-000000000004', 'artifact', '{"topicId":"d"}', 'f2000000-0000-4000-8000-000000000001');

select is(public.plan_credits('free'), 1000, 'free plan is 1000 credits');
select is(public.plan_credits('paid'), 5000, 'plus plan is 5000 credits');
select is(public.plan_credits('max'), 15000, 'max plan is 15000 credits');

-- A lesson holds its estimate, then pays more when it cost more.
update public.parents set credit_balance = 1000 where id = 'f2000000-0000-4000-8000-000000000001';
select public.reserve_credit('f2000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'initial');
select is(
  (select credit_balance from public.parents where id = 'f2000000-0000-4000-8000-000000000001'),
  920,
  'a lesson holds its 80-credit estimate'
);
select is(
  (select category from public.credit_ledger where job_id = 'f2300000-0000-4000-8000-000000000001' and kind = 'reserve'),
  'lesson',
  'job reserves are lesson usage'
);
select is(public.settle_credit('f2300000-0000-4000-8000-000000000001', 110), true, 'settle charges a costlier lesson');
select is(
  (select credit_balance from public.parents where id = 'f2000000-0000-4000-8000-000000000001'),
  890,
  'the extra cost comes off the balance'
);
select is(public.settle_credit('f2300000-0000-4000-8000-000000000001', 500), false, 'a second settle is a no-op');

-- A cheaper lesson gets the unused part back.
select public.reserve_credit('f2000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000002', 'prewarm');
select public.settle_credit('f2300000-0000-4000-8000-000000000002', 30);
select is(
  (select credit_balance from public.parents where id = 'f2000000-0000-4000-8000-000000000001'),
  860,
  'a cheaper lesson only costs what it used'
);
select is(
  (select amount from public.credit_ledger where job_id = 'f2300000-0000-4000-8000-000000000002' and kind = 'refund'),
  50,
  'the unused hold is refunded'
);

-- An outline holds less, and a failed job gets its whole hold back.
select public.reserve_credit('f2000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000003', 'outline');
select is(
  (select -amount from public.credit_ledger where job_id = 'f2300000-0000-4000-8000-000000000003' and kind = 'reserve'),
  5,
  'an outline holds 5 credits'
);
select is(public.refund_credit('f2300000-0000-4000-8000-000000000003'), true, 'a failed job is refunded');
select is(
  (select credit_balance from public.parents where id = 'f2000000-0000-4000-8000-000000000001'),
  860,
  'the refund returns the whole hold'
);

-- Extra cost never takes the balance below zero; a low balance holds what is left.
update public.parents set credit_balance = 20 where id = 'f2000000-0000-4000-8000-000000000001';
select public.reserve_credit('f2000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000004', 'initial');
select is(
  (select -amount from public.credit_ledger where job_id = 'f2300000-0000-4000-8000-000000000004' and kind = 'reserve'),
  20,
  'a low balance holds only what is left'
);
select public.settle_credit('f2300000-0000-4000-8000-000000000004', 120);
select is(
  (select credit_balance from public.parents where id = 'f2000000-0000-4000-8000-000000000001'),
  0,
  'settling never goes below zero'
);

-- Usage outside the queue.
update public.parents set credit_balance = 100 where id = 'f2000000-0000-4000-8000-000000000001';
select is(
  public.charge_usage('f2000000-0000-4000-8000-000000000001', 'live', 30, 'live_tutor'),
  70,
  'a live charge returns the balance left'
);
select is(
  public.charge_usage('f2000000-0000-4000-8000-000000000001', 'lesson', 500, 'art'),
  0,
  'a charge takes at most what is left'
);
select is(
  (select sum(-amount)::integer from public.credit_ledger where parent_id = 'f2000000-0000-4000-8000-000000000001' and kind = 'charge' and category = 'live'),
  30,
  'charges are recorded by category'
);
select throws_ok(
  $$ select public.charge_usage('f2000000-0000-4000-8000-000000000001', 'other', 1, 'x') $$,
  'P0001', null, 'unknown categories are refused'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.charge_usage('f2000000-0000-4000-8000-000000000001', 'live', 1, 'x') $$,
  '42501', null, 'a parent cannot charge or refund usage directly'
);
reset role;

select * from finish();
rollback;

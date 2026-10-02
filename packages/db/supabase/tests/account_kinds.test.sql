-- RLS and constraint checks for account kinds. Run with `supabase test db`.
-- Everything happens inside one transaction and is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, RLS bypassed)
--   Family A: parent A, children a1 (has child login C) and a2
--   Family B: parent B, child b1
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'parent-a@test.invalid', '{}', '{}'),
  ('b0000000-0000-4000-8000-000000000001', 'parent-b@test.invalid', '{"account_kind":"parent"}', '{}'),
  ('c0000000-0000-4000-8000-000000000001', 'kid-c@test.invalid', '{"account_kind":"individual","age":"30"}', '{"account":"child"}');

-- Family A has two children. Free accounts can only add one, so this fixture
-- is a paid plan. Credit limits are asserted in billing.test.sql.
update public.parents set tier = 'paid' where id = 'a0000000-0000-4000-8000-000000000001';

insert into public.children (id, parent_id, display_name, age, kind) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A1', 8, 'child'),
  ('a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A2', 10, 'child'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'B1', 9, 'child');

insert into public.child_logins (user_id, child_id, parent_id, username, auth_email) values
  ('c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'kid_c', 'kid-c@test.invalid');

insert into public.curricula (id, child_id, goal_text, status) values
  ('a1c00000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'fractions', 'ready'),
  ('a2c00000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'planets', 'ready'),
  ('b1c00000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'dinosaurs', 'ready');

insert into public.topics (id, curriculum_id, slug, title, position) values
  ('a1f00000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001', 't', 'T', 1),
  ('a2f00000-0000-4000-8000-000000000001', 'a2c00000-0000-4000-8000-000000000001', 't', 'T', 1),
  ('b1f00000-0000-4000-8000-000000000001', 'b1c00000-0000-4000-8000-000000000001', 't', 'T', 1);

insert into public.artifacts (id, topic_id, version, status) values
  ('a1a00000-0000-4000-8000-000000000001', 'a1f00000-0000-4000-8000-000000000001', 1, 'published'),
  ('a2a00000-0000-4000-8000-000000000001', 'a2f00000-0000-4000-8000-000000000001', 1, 'published'),
  ('b1a00000-0000-4000-8000-000000000001', 'b1f00000-0000-4000-8000-000000000001', 1, 'published');

insert into public.topic_progress (child_id, topic_id, status) values
  ('a1000000-0000-4000-8000-000000000001', 'a1f00000-0000-4000-8000-000000000001', 'in_progress'),
  ('a2000000-0000-4000-8000-000000000001', 'a2f00000-0000-4000-8000-000000000001', 'in_progress'),
  ('b1000000-0000-4000-8000-000000000001', 'b1f00000-0000-4000-8000-000000000001', 'in_progress');

insert into public.personalization_context (child_id, kind, value) values
  ('a1000000-0000-4000-8000-000000000001', 'interest', 'space');

insert into public.daily_reports (child_id, report_date, stats, summary) values
  ('a1000000-0000-4000-8000-000000000001', '2026-01-01', '{}', 'ok');

-- ---------------------------------------------------------------------------
-- Signup trigger and constraints
-- ---------------------------------------------------------------------------
select is((select kind from public.parents where id = 'a0000000-0000-4000-8000-000000000001'), 'parent', 'signup without a kind is a parent');
select is((select count(*) from public.parents where id = 'c0000000-0000-4000-8000-000000000001'), 0::bigint, 'child auth users get no parents row, even with individual metadata');

select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data) values ('d0000000-0000-4000-8000-000000000001', 'young@test.invalid', '{"account_kind":"individual","display_name":"Kid","age":"12"}') $$,
  '23514', null, 'individual signup under 13 fails'
);
select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data) values ('d0000000-0000-4000-8000-000000000002', 'noage@test.invalid', '{"account_kind":"individual"}') $$,
  '23514', null, 'individual signup without an age fails'
);
select lives_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data) values ('e0000000-0000-4000-8000-000000000001', 'adult@test.invalid', '{"account_kind":"individual","display_name":"Sam","age":"30"}') $$,
  'individual signup at 30 succeeds'
);
select is((select kind from public.parents where id = 'e0000000-0000-4000-8000-000000000001'), 'individual', 'individual signup sets parents.kind');
select is(
  (select count(*) from public.children where parent_id = 'e0000000-0000-4000-8000-000000000001' and kind = 'self' and display_name = 'Sam' and age = 30),
  1::bigint, 'individual signup creates one self profile'
);
select throws_ok(
  $$ insert into public.children (parent_id, display_name, age, kind) values ('e0000000-0000-4000-8000-000000000001', 'Again', 30, 'self') $$,
  '23505', null, 'a second self profile fails'
);
select throws_ok(
  $$ insert into public.child_logins (user_id, child_id, parent_id, username, auth_email) values ('e0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'bad_one', 'bad@test.invalid') $$,
  'P0001', null, 'a child login cannot point at another family''s child'
);

-- ---------------------------------------------------------------------------
-- Parent A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.children), 2::bigint, 'parent sees only their own children');
select is((select count(*) from public.curricula where child_id = 'b1000000-0000-4000-8000-000000000001'), 0::bigint, 'parent cannot see another family''s curricula');
select is((select count(*) from public.topics), 2::bigint, 'parent sees only their own topics');
select is((select count(*) from public.topic_progress where child_id = 'b1000000-0000-4000-8000-000000000001'), 0::bigint, 'parent cannot see another family''s progress');
select is((select count(*) from public.parents), 1::bigint, 'parent sees only their own parents row');
select is((select count(*) from public.child_logins), 1::bigint, 'parent sees their child logins');

select throws_ok(
  $$ insert into public.artifact_sessions (child_id, topic_id, artifact_id, nonce) values ('a1000000-0000-4000-8000-000000000001', 'b1f00000-0000-4000-8000-000000000001', 'b1a00000-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'session pairing an owned child with a foreign topic fails'
);
select throws_ok(
  $$ insert into public.artifact_sessions (child_id, topic_id, artifact_id, nonce) values ('a1000000-0000-4000-8000-000000000001', 'a1f00000-0000-4000-8000-000000000001', 'a2a00000-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'session with an artifact from another topic fails'
);
select lives_ok(
  $$ insert into public.artifact_sessions (child_id, topic_id, artifact_id, nonce) values ('a2000000-0000-4000-8000-000000000001', 'a2f00000-0000-4000-8000-000000000001', 'a2a00000-0000-4000-8000-000000000001', 'x') $$,
  'parent can open a session for their own child'
);

select throws_ok($$ update public.parents set tier = 'paid' $$, '42501', null, 'parent cannot change tier');
select throws_ok($$ update public.parents set kind = 'individual' $$, '42501', null, 'parent cannot change account kind');
select throws_ok($$ select grownup_pin_hash from public.parents $$, '42501', null, 'parent cannot read the PIN hash');
select throws_ok($$ update public.children set kind = 'self' $$, '42501', null, 'parent cannot change a profile kind');
select throws_ok(
  $$ update public.children set shared_device = false where id = 'a2000000-0000-4000-8000-000000000001' $$,
  'P0001', null, 'a child without a login must stay on the shared device'
);

-- ---------------------------------------------------------------------------
-- Individual E cannot add children
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.children (parent_id, display_name, age, kind) values ('e0000000-0000-4000-8000-000000000001', 'Kid', 8, 'child') $$,
  '42501', null, 'individual cannot add a child profile'
);

-- ---------------------------------------------------------------------------
-- Child login C (child a1)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq($$ select id from public.children $$, $$ values ('a1000000-0000-4000-8000-000000000001'::uuid) $$, 'child login sees only its own profile');
select results_eq($$ select id from public.curricula $$, $$ values ('a1c00000-0000-4000-8000-000000000001'::uuid) $$, 'child login sees only its own curricula');
select results_eq($$ select id from public.artifacts $$, $$ values ('a1a00000-0000-4000-8000-000000000001'::uuid) $$, 'child login sees only its own artifacts');
select results_eq($$ select child_id from public.topic_progress $$, $$ values ('a1000000-0000-4000-8000-000000000001'::uuid) $$, 'child login sees only its own progress');

select lives_ok(
  $$ insert into public.artifact_sessions (child_id, topic_id, artifact_id, nonce) values ('a1000000-0000-4000-8000-000000000001', 'a1f00000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000001', 'x') $$,
  'child login can open a session for itself'
);
select throws_ok(
  $$ insert into public.artifact_sessions (child_id, topic_id, artifact_id, nonce) values ('a2000000-0000-4000-8000-000000000001', 'a2f00000-0000-4000-8000-000000000001', 'a2a00000-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'child login cannot open a session for a sibling'
);
select throws_ok(
  $$ insert into public.curricula (child_id, goal_text) values ('a1000000-0000-4000-8000-000000000001', 'new goal') $$,
  '42501', null, 'child login cannot create curricula'
);
select is(
  (select count(*) from public.personalization_context) + (select count(*) from public.daily_reports)
    + (select count(*) from public.parents) + (select count(*) from public.child_logins),
  0::bigint, 'child login sees no personalization, reports, parents, or logins'
);
select is((select count(*) from public.artifact_sessions), 1::bigint, 'child login sees only its own sessions');

update public.children set display_name = 'Hacked' where id = 'a1000000-0000-4000-8000-000000000001';
reset role;
select is((select display_name from public.children where id = 'a1000000-0000-4000-8000-000000000001'), 'A1', 'child login cannot edit its profile');

select * from finish();
rollback;

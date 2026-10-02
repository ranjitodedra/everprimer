-- Learner memory: birth age, caps, retention, and who can see cards.
-- Run with `supabase test db`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-0000000000b1', 'mem-parent@test.invalid', '{}', '{}'),
  ('b0000000-0000-4000-8000-0000000000b1', 'mem-other@test.invalid', '{}', '{}'),
  ('c0000000-0000-4000-8000-0000000000b1', 'mem-kid@test.invalid', '{}', '{"account":"child"}');

update public.parents set tier = 'paid' where id = 'a0000000-0000-4000-8000-0000000000b1';

-- Month 1 has always arrived, so age is the year difference.
insert into public.children (id, parent_id, display_name, age, birth_year, birth_month, kind) values
  (
    'a1000000-0000-4000-8000-0000000000b1',
    'a0000000-0000-4000-8000-0000000000b1',
    'Ava',
    4,
    extract(year from (timezone('utc', now()))::date)::integer - 8,
    1,
    'child'
  );

select is(
  (select age::integer from public.children where id = 'a1000000-0000-4000-8000-0000000000b1'),
  8,
  'a birthday overwrites the stored age'
);

select throws_ok(
  $$ insert into public.children (parent_id, display_name, birth_year, kind)
     values ('a0000000-0000-4000-8000-0000000000b1', 'Half', 2016, 'child') $$,
  '23514', null, 'birth year without a month fails'
);

alter table public.children disable trigger children_set_age_from_birth;
update public.children set age = 4 where id = 'a1000000-0000-4000-8000-0000000000b1';
insert into public.children (id, parent_id, display_name, age, birth_year, birth_month, kind) values
  (
    'a2000000-0000-4000-8000-0000000000b1',
    'a0000000-0000-4000-8000-0000000000b1',
    'Older',
    8,
    extract(year from (timezone('utc', now()))::date)::integer - 40,
    1,
    'child'
  );
alter table public.children enable trigger children_set_age_from_birth;

select is(public.refresh_learner_ages() > 0, true, 'refresh rewrites a stale in-range age');
select is(
  (select age::integer from public.children where id = 'a1000000-0000-4000-8000-0000000000b1'),
  8,
  'refresh restores the age computed from the birthday'
);
select is(
  (select age::integer from public.children where id = 'a2000000-0000-4000-8000-0000000000b1'),
  8,
  'refresh leaves a cached age when the birthday is outside the child range'
);

select lives_ok(
  format(
    'insert into auth.users (id, email, raw_user_meta_data) values (%L, %L, %L::jsonb)',
    'e1000000-0000-4000-8000-0000000000b1',
    'born@test.invalid',
    jsonb_build_object(
      'account_kind', 'individual',
      'display_name', 'Sam',
      'birth_year', (extract(year from (timezone('utc', now()))::date)::integer - 30)::text,
      'birth_month', '1'
    )::text
  ),
  'individual signup with a birthday succeeds'
);
select is(
  (select age::integer from public.children where parent_id = 'e1000000-0000-4000-8000-0000000000b1' and kind = 'self'),
  30,
  'signup caches age from the birthday'
);
select is(
  (select birth_month from public.children where parent_id = 'e1000000-0000-4000-8000-0000000000b1'),
  1::smallint,
  'signup stores the birth month'
);

insert into public.learner_memories (id, child_id, kind, value, source, confidence, last_seen_at) values
  ('m1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000b1', 'interest', 'drawing', 'parent', 0.10, '2020-01-01'),
  ('m1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-0000000000b1', 'interest', 'old guess', 'inferred', 0.20, '2020-06-01'),
  ('m1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-0000000000b1', 'strength', 'can order the planets', 'inferred', 0.90, '2024-01-01');

insert into public.children (id, parent_id, display_name, age, kind) values
  ('b1000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000b1', 'Bea', 9, 'child');
insert into public.learner_memories (id, child_id, kind, value, source, confidence) values
  ('m2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1', 'interest', 'secret', 'inferred', 0.50);

select is(public.enforce_memory_cap('a1000000-0000-4000-8000-0000000000b1', 1), 1, 'the cap deactivates one inferred card');
select is(
  (select active from public.learner_memories where id = 'm1000000-0000-4000-8000-000000000001'),
  true,
  'the cap never deactivates a parent card'
);
select is(
  (select active from public.learner_memories where id = 'm1000000-0000-4000-8000-000000000002'),
  false,
  'the cap deactivates the oldest low-confidence inferred card'
);
select is(
  (select active from public.learner_memories where id = 'm1000000-0000-4000-8000-000000000003'),
  true,
  'a higher-confidence inferred card stays active'
);

-- Retention. Topic 1 has mastery and progress. Topic 2 does not.
insert into public.curricula (id, child_id, goal_text, status) values
  ('a1c00000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-0000000000b1', 'planets', 'ready');
insert into public.topics (id, curriculum_id, slug, title, position) values
  ('a1f00000-0000-4000-8000-0000000000b1', 'a1c00000-0000-4000-8000-0000000000b1', 'mastered', 'Mastered', 1),
  ('a1f00000-0000-4000-8000-0000000000b2', 'a1c00000-0000-4000-8000-0000000000b1', 'fresh', 'Fresh', 2);
insert into public.artifacts (id, topic_id, version, status) values
  ('a1a00000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b1', 1, 'published'),
  ('a1a00000-0000-4000-8000-0000000000b2', 'a1f00000-0000-4000-8000-0000000000b2', 1, 'published');
insert into public.learning_objectives (id, topic_id, code, text, position) values
  ('a1o00000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b1', 'lo1', 'Name the planets', 1);
insert into public.objective_mastery (child_id, objective_id, score, status) values
  ('a1000000-0000-4000-8000-0000000000b1', 'a1o00000-0000-4000-8000-0000000000b1', 0.800, 'proficient');
insert into public.topic_progress (child_id, topic_id, status, mastery) values
  ('a1000000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b1', 'completed', 0.800);
insert into public.artifact_sessions (id, child_id, topic_id, artifact_id, nonce) values
  ('a1s00000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b1', 'a1a00000-0000-4000-8000-0000000000b1', 'n1'),
  ('a1s00000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b2', 'a1a00000-0000-4000-8000-0000000000b2', 'n2');
insert into public.learning_events (session_id, child_id, topic_id, artifact_id, client_event_id, type, payload, occurred_at) values
  ('a1s00000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b1', 'a1a00000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'question_answered', '{}', now() - interval '100 days'),
  ('a1s00000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b1', 'a1a00000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'question_answered', '{}', now() - interval '10 days'),
  ('a1s00000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b2', 'a1a00000-0000-4000-8000-0000000000b2', '33333333-3333-4333-8333-333333333333', 'question_answered', '{}', now() - interval '100 days');
insert into public.responses (
  session_id, child_id, topic_id, artifact_id, activity_id, activity_type, question_id, question_kind,
  difficulty, objective_codes, answer, correct, attempt, occurred_at
) values (
  'a1s00000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-0000000000b1', 'a1f00000-0000-4000-8000-0000000000b1', 'a1a00000-0000-4000-8000-0000000000b1',
  'quiz', 'quiz', 'q1', 'short_answer', 1, '{lo1}', '"jupiter"'::jsonb, true, 1, now() - interval '100 days'
);

select is(public.purge_learning_traces(), 2, 'purge removes the old event and the old graded answer');
select is(
  (select count(*) from public.learning_events where client_event_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'an old event is removed once mastery is written'
);
select is(
  (select count(*) from public.learning_events where client_event_id = '22222222-2222-4222-8222-222222222222'),
  1::bigint,
  'a recent event stays'
);
select is(
  (select count(*) from public.learning_events where client_event_id = '33333333-3333-4333-8333-333333333333'),
  1::bigint,
  'an old event without mastery stays'
);
select is((select count(*) from public.responses), 0::bigint, 'the graded answer text is removed');
select is(
  (select count(*) from public.objective_mastery where child_id = 'a1000000-0000-4000-8000-0000000000b1'),
  1::bigint,
  'mastery stays'
);
select is(
  (select count(*) from public.topic_progress where child_id = 'a1000000-0000-4000-8000-0000000000b1'),
  1::bigint,
  'topic progress stays'
);

insert into public.child_logins (user_id, child_id, parent_id, username, auth_email) values
  ('c0000000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b1', 'ava_b', 'mem-kid@test.invalid');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

select is((select count(*) from public.learner_memories), 3::bigint, 'a parent sees only their own cards');
select throws_ok(
  $$ insert into public.learner_memories (child_id, kind, value, source, confidence)
     values ('a1000000-0000-4000-8000-0000000000b1', 'interest', 'sneaky', 'parent', 1) $$,
  '42501', null, 'a parent cannot insert a card'
);
select throws_ok(
  $$ update public.learner_memories set value = 'rewritten' where id = 'm1000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'a parent cannot rewrite a card'
);
select lives_ok(
  $$ update public.learner_memories set active = false where id = 'm1000000-0000-4000-8000-000000000003' $$,
  'a parent can deactivate a card'
);

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*) from public.learner_memories), 0::bigint, 'a child login cannot see cards');
update public.learner_memories set active = false where id = 'm1000000-0000-4000-8000-000000000001';

reset role;
select is(
  (select active from public.learner_memories where id = 'm1000000-0000-4000-8000-000000000001'),
  true,
  'a child login cannot deactivate a card'
);

select * from finish();
rollback;

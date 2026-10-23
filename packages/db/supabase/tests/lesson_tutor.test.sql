-- Lesson characters, tutor sessions and the lesson-art bucket.
-- Run with `supabase test db`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

-- Family A: parent A, child a1 (child login C). Family B: parent B, child b1.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-0000000000f1', 'tutor-parent-a@test.invalid', '{}', '{}'),
  ('b0000000-0000-4000-8000-0000000000f1', 'tutor-parent-b@test.invalid', '{}', '{}'),
  ('c0000000-0000-4000-8000-0000000000f1', 'tutor-kid-c@test.invalid', '{}', '{"account":"child"}');

insert into public.children (id, parent_id, display_name, age, kind) values
  ('a1000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'A1', 8, 'child'),
  ('b1000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1', 'B1', 9, 'child');

insert into public.child_logins (user_id, child_id, parent_id, username, auth_email) values
  ('c0000000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'tutor_kid_c', 'tutor-kid-c@test.invalid');

insert into public.curricula (id, child_id, goal_text, status) values
  ('a1c00000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-0000000000f1', 'orbits', 'ready'),
  ('b1c00000-0000-4000-8000-0000000000f1', 'b1000000-0000-4000-8000-0000000000f1', 'volcanoes', 'ready');

insert into public.topics (id, curriculum_id, slug, title, position) values
  ('a1f00000-0000-4000-8000-0000000000f1', 'a1c00000-0000-4000-8000-0000000000f1', 'intro', 'Intro', 1),
  ('b1f00000-0000-4000-8000-0000000000f1', 'b1c00000-0000-4000-8000-0000000000f1', 'intro', 'Intro', 1);

insert into public.lesson_characters (topic_id, parent_id, status, talk_path, teach_path) values
  ('a1f00000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'ready', 'a/talk.webp', 'a/teach.webp'),
  ('b1f00000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1', 'queued', null, null);

insert into public.tutor_sessions (id, child_id, parent_id, topic_id, model, expires_at) values
  ('a1e00000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1',
   'a1f00000-0000-4000-8000-0000000000f1', 'gemini-3.8-live', now() + interval '6 minutes');

-- ---------------------------------------------------------------------------
-- Schema rules (as postgres)
-- ---------------------------------------------------------------------------
select is(
  (select public from storage.buckets where id = 'lesson-art'),
  false,
  'the lesson-art bucket is private'
);

select throws_ok(
  $$ update public.lesson_characters set talk_path = null where topic_id = 'a1f00000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'a ready character needs both poses'
);

select is(
  (select live_tutor_allowed from public.parents where id = 'a0000000-0000-4000-8000-0000000000f1'),
  true,
  'the live tutor switch defaults on'
);

-- ---------------------------------------------------------------------------
-- Parent A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);

select is((select count(*) from public.lesson_characters), 1::bigint, 'a parent sees only their own lesson characters');
select is((select count(*) from public.tutor_sessions), 1::bigint, 'a parent sees their child''s tutor sessions');
select is(
  (select live_tutor_allowed from public.parents where id = 'a0000000-0000-4000-8000-0000000000f1'),
  true,
  'a parent can read the live tutor switch'
);

select throws_ok(
  $$ insert into public.lesson_characters (topic_id) values ('a1f00000-0000-4000-8000-0000000000f1') $$,
  '42501', null, 'a parent cannot queue a character'
);
select throws_ok(
  $$ update public.tutor_sessions set seconds_used = 0 $$,
  '42501', null, 'a parent cannot rewrite tutor usage'
);
select throws_ok(
  $$ insert into public.tutor_sessions (child_id, parent_id, topic_id, model, expires_at)
     values ('a1000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1',
             'a1f00000-0000-4000-8000-0000000000f1', 'x', now() + interval '1 minute') $$,
  '42501', null, 'a parent cannot mint a tutor session'
);
select throws_ok(
  $$ update public.parents set live_tutor_allowed = false where id = 'a0000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'the live tutor switch is written by the server only'
);
select throws_ok(
  $$ update public.parents set tutor_enabled = true where id = 'a0000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'a parent cannot enable the tutor'
);

-- ---------------------------------------------------------------------------
-- Child login C (learns as a1)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);

select is(
  (select count(*) from public.lesson_characters where topic_id = 'a1f00000-0000-4000-8000-0000000000f1'),
  1::bigint,
  'a child login sees the character for their own lesson'
);
select is(
  (select count(*) from public.lesson_characters where topic_id = 'b1f00000-0000-4000-8000-0000000000f1'),
  0::bigint,
  'a child login cannot see another family''s character'
);
select is((select count(*) from public.tutor_sessions), 0::bigint, 'a child login cannot read tutor usage');

reset role;

select * from finish();
rollback;

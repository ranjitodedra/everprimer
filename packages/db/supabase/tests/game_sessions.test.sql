-- Game session resume columns on topic_progress.
-- Run with `supabase test db`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-0000000000e1', 'game-parent@test.invalid', '{}', '{}');

insert into public.children (id, parent_id, display_name, age, kind) values
  ('a1000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-0000000000e1', 'Ava', 8, 'child');

insert into public.curricula (id, child_id, goal_text, status) values
  ('a1c00000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000e1', 'orbits', 'ready');

insert into public.topics (id, curriculum_id, slug, title, position) values
  ('a1f00000-0000-4000-8000-0000000000e1', 'a1c00000-0000-4000-8000-0000000000e1', 'intro', 'Intro', 1);

insert into public.topic_progress (child_id, topic_id, status) values
  ('a1000000-0000-4000-8000-0000000000e1', 'a1f00000-0000-4000-8000-0000000000e1', 'in_progress');

select is(
  (select sessions_completed from public.topic_progress
    where child_id = 'a1000000-0000-4000-8000-0000000000e1'
      and topic_id = 'a1f00000-0000-4000-8000-0000000000e1'),
  0,
  'a new progress row starts at session 0'
);

select is(
  (select final_score from public.topic_progress
    where child_id = 'a1000000-0000-4000-8000-0000000000e1'
      and topic_id = 'a1f00000-0000-4000-8000-0000000000e1'),
  null,
  'a new progress row has no final score'
);

select throws_ok(
  $$ update public.topic_progress set sessions_completed = -1
     where child_id = 'a1000000-0000-4000-8000-0000000000e1'
       and topic_id = 'a1f00000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'sessions_completed cannot be negative'
);

select throws_ok(
  $$ update public.topic_progress set final_score = 1.5
     where child_id = 'a1000000-0000-4000-8000-0000000000e1'
       and topic_id = 'a1f00000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'final_score stays between 0 and 1'
);

update public.topic_progress
  set sessions_completed = 2, final_score = 0.75
  where child_id = 'a1000000-0000-4000-8000-0000000000e1'
    and topic_id = 'a1f00000-0000-4000-8000-0000000000e1';

select ok(
  (select sessions_completed = 2 and final_score = 0.75 from public.topic_progress
    where child_id = 'a1000000-0000-4000-8000-0000000000e1'
      and topic_id = 'a1f00000-0000-4000-8000-0000000000e1'),
  'session count and final score can be stored'
);

select * from finish();
rollback;

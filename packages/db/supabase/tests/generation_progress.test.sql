-- Generation progress: allowed stages and the reset on retry.
-- Run with `supabase test db`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-0000000000d1', 'progress-parent@test.invalid', '{}', '{}');

insert into public.children (id, parent_id, display_name, age, kind) values
  ('a1000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-0000000000d1', 'Ava', 8, 'child');

insert into public.curricula (id, child_id, goal_text, status) values
  ('a1c00000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'volcanoes', 'generating');

insert into public.topics (id, curriculum_id, slug, title, position) values
  ('a1f00000-0000-4000-8000-0000000000d1', 'a1c00000-0000-4000-8000-0000000000d1', 'intro', 'Intro', 1);

insert into public.artifacts (id, topic_id, version, status) values
  ('a1a00000-0000-4000-8000-0000000000d1', 'a1f00000-0000-4000-8000-0000000000d1', 1, 'generating');

select is(
  (select stage from public.artifacts where id = 'a1a00000-0000-4000-8000-0000000000d1'),
  null,
  'a new lesson starts without a stage'
);

select throws_ok(
  $$ update public.artifacts set stage = 'dreaming' where id = 'a1a00000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'lesson stages are constrained'
);

select throws_ok(
  $$ update public.curricula set stage = 'pictures' where id = 'a1c00000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'curriculum stages are constrained'
);

update public.artifacts set stage = 'building', stage_at = now() - interval '1 hour' where id = 'a1a00000-0000-4000-8000-0000000000d1';
update public.artifacts set status = 'failed' where id = 'a1a00000-0000-4000-8000-0000000000d1';
select is(
  (select stage from public.artifacts where id = 'a1a00000-0000-4000-8000-0000000000d1'),
  'building',
  'a failed lesson keeps the step it reached'
);

update public.artifacts set status = 'generating' where id = 'a1a00000-0000-4000-8000-0000000000d1';
select ok(
  (select stage is null and stage_at > now() - interval '1 minute' from public.artifacts where id = 'a1a00000-0000-4000-8000-0000000000d1'),
  'retrying a lesson clears its stage'
);

update public.curricula set stage = 'saving', status = 'failed' where id = 'a1c00000-0000-4000-8000-0000000000d1';
update public.curricula set status = 'generating' where id = 'a1c00000-0000-4000-8000-0000000000d1';
select is(
  (select stage from public.curricula where id = 'a1c00000-0000-4000-8000-0000000000d1'),
  null,
  'retrying a curriculum clears its stage'
);

select * from finish();
rollback;

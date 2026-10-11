-- Lesson planner: units, the split status, image asset visibility, and scope.
-- Run with `supabase test db`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-0000000000c1', 'plan-parent@test.invalid', '{}', '{}'),
  ('b0000000-0000-4000-8000-0000000000c1', 'plan-other@test.invalid', '{}', '{}');

insert into public.children (id, parent_id, display_name, age, kind) values
  ('a1000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000c1', 'Ava', 8, 'child');

insert into public.curricula (id, child_id, goal_text, status, scope, interest) values
  ('a1c00000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-0000000000c1', 'electricity', 'ready', 'mastery', 'robots');

select throws_ok(
  $$ update public.curricula set scope = 'everything' where id = 'a1c00000-0000-4000-8000-0000000000c1' $$,
  '23514', null, 'scope is constrained to the four values'
);

insert into public.topics (id, curriculum_id, slug, title, position) values
  ('a1f00000-0000-4000-8000-0000000000c1', 'a1c00000-0000-4000-8000-0000000000c1', 'intro', 'Intro', 1),
  ('a1f00000-0000-4000-8000-0000000000c2', 'a1c00000-0000-4000-8000-0000000000c1', 'electricity', 'Electricity', 2),
  ('a1f00000-0000-4000-8000-0000000000c3', 'a1c00000-0000-4000-8000-0000000000c1', 'review', 'Review', 3);
insert into public.artifacts (id, topic_id, version, status) values
  ('a1a00000-0000-4000-8000-0000000000c1', 'a1f00000-0000-4000-8000-0000000000c1', 1, 'published'),
  ('a1a00000-0000-4000-8000-0000000000c2', 'a1f00000-0000-4000-8000-0000000000c2', 1, 'generating');

select is(
  (public.split_topic_into_unit(
    'a1f00000-0000-4000-8000-0000000000c2',
    'a1a00000-0000-4000-8000-0000000000c2',
    '{"mode":"sub_index"}'::jsonb,
    '[{"slug":"electricity-circuits","title":"What is a circuit?","description":"Loops that let current flow.","objectives":["Identify a closed circuit","Explain why a gap stops the bulb"]},
      {"slug":"electricity-current","title":"How current moves","description":"What flows and why.","objectives":["Describe current as moving charge","Compare a dim and a bright bulb"]}]'::jsonb
  ) ->> 'children')::integer,
  2,
  'the split inserts two child topics'
);
select is(
  (select kind from public.topics where id = 'a1f00000-0000-4000-8000-0000000000c2'),
  'unit',
  'the split topic becomes a unit'
);
select is(
  (select status from public.artifacts where id = 'a1a00000-0000-4000-8000-0000000000c2'),
  'split',
  'the planning artifact is marked split'
);
select is(
  (select array_agg(slug order by position) from public.topics where curriculum_id = 'a1c00000-0000-4000-8000-0000000000c1'),
  array['intro', 'electricity', 'electricity-circuits', 'electricity-current', 'review'],
  'children sit right after the unit and later topics shift down'
);
select is(
  (select prerequisites from public.topics where slug = 'electricity-current'),
  array['electricity-circuits'],
  'each child topic builds on the one before it'
);
select is(
  (select count(*)::integer from public.learning_objectives lo join public.topics t on t.id = lo.topic_id where t.parent_topic_id = 'a1f00000-0000-4000-8000-0000000000c2'),
  4,
  'child topics get their objectives'
);
select is(
  (public.split_topic_into_unit('a1f00000-0000-4000-8000-0000000000c2', 'a1a00000-0000-4000-8000-0000000000c2', '{}'::jsonb, '[]'::jsonb) ->> 'already')::boolean,
  true,
  'splitting a unit again is a no-op'
);
select is(
  (public.start_artifact_job('a1f00000-0000-4000-8000-0000000000c2', 'regenerate') ->> 'skipped')::boolean,
  true,
  'a unit never starts a lesson job'
);
select is(
  (select count(*)::integer from public.artifacts where topic_id = 'a1f00000-0000-4000-8000-0000000000c2'),
  1,
  'no artifact is created for a unit'
);

insert into public.artifact_assets (artifact_id, key, mime, data_base64) values
  ('a1a00000-0000-4000-8000-0000000000c1', 'img_s_heart', 'image/png', 'iVBORw0KGgo=');

select throws_ok(
  $$ insert into public.artifact_assets (artifact_id, key, mime, data_base64)
     values ('a1a00000-0000-4000-8000-0000000000c1', 'bad', 'image/svg+xml', 'x') $$,
  '23514', null, 'only raster image types are stored'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::integer from public.artifact_assets), 1, 'the owner can read lesson images');
select throws_ok(
  $$ insert into public.artifact_assets (artifact_id, key, mime, data_base64)
     values ('a1a00000-0000-4000-8000-0000000000c1', 'mine', 'image/png', 'x') $$,
  '42501', null, 'owners cannot write lesson images'
);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::integer from public.artifact_assets), 0, 'another account cannot read lesson images');
reset role;

select * from finish();
rollback;

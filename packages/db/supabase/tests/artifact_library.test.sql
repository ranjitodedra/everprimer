-- Artifact library: catalog tables, version lifecycle, RLS and the library bucket.
-- Run with `supabase test db`. The transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(42);

-- Staff S. Family A: parent A, child a1 (child login C).
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('5a000000-0000-4000-8000-0000000000a1', 'library-staff@test.invalid', '{}', '{}'),
  ('a0000000-0000-4000-8000-0000000000a1', 'library-parent-a@test.invalid', '{}', '{}'),
  ('c0000000-0000-4000-8000-0000000000a1', 'library-kid-c@test.invalid', '{}', '{"account":"child"}');

insert into public.staff_users (user_id) values ('5a000000-0000-4000-8000-0000000000a1');

insert into public.children (id, parent_id, display_name, age, kind) values
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'A1', 8, 'child');

insert into public.child_logins (user_id, child_id, parent_id, username, auth_email) values
  ('c0000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'library_kid_c', 'library-kid-c@test.invalid');

insert into public.curricula (id, child_id, goal_text, status) values
  ('a1c00000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', 'orbits', 'ready');

insert into public.topics (id, curriculum_id, slug, title, position) values
  ('a1f00000-0000-4000-8000-0000000000a1', 'a1c00000-0000-4000-8000-0000000000a1', 'orbits', 'Orbits', 1);

insert into public.artifacts (id, topic_id, version, status) values
  ('a1a00000-0000-4000-8000-0000000000a1', 'a1f00000-0000-4000-8000-0000000000a1', 1, 'published');

create temporary table fx (manifest jsonb, files jsonb, sha text) on commit drop;
insert into fx values (
  '{"id": "orbit-lab", "version": 1, "title": "Orbit Lab", "entry": "index.html",
    "description": "Planets travel around the sun at different speeds.",
    "subjects": ["science"], "topics": ["solar system"], "concepts": ["planetary orbit"],
    "learningObjectives": ["Compare how long planets take to go around the sun"]}',
  '[{"path": "index.html", "size": 1200, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "mime": "text/html"}]',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
grant select on fx to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schema rules and lifecycle (as postgres)
-- ---------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'library'), false, 'the library bucket is private');

select is(
  (select public.library_register_draft('orbit-lab', manifest, files, sha, 3, '5a000000-0000-4000-8000-0000000000a1') from fx),
  1, 'registering an artifact creates version 1'
);
select is(
  (select public.library_add_version('orbit-lab', manifest, files, sha, 3, '5a000000-0000-4000-8000-0000000000a1') from fx),
  2, 'the next version is numbered by the database'
);
select is(
  (select manifest ->> 'version' from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 2),
  '2', 'the assigned number is written into the manifest'
);
select is(
  (select status from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 1),
  'draft', 'new versions start as drafts'
);
select is(
  (select current_version from public.library_artifacts where id = 'orbit-lab'),
  null, 'nothing is current until a version is published'
);

select throws_ok(
  $$ insert into public.library_artifact_versions (artifact_id, version, manifest, entry_file, files, bundle_sha256, compliance_level)
     select 'orbit-lab', 9, manifest || '{"id": "other-lab", "version": 9}', 'index.html', files, sha, 0 from fx $$,
  '23514', null, 'the manifest id must match the artifact'
);
select throws_ok(
  $$ insert into public.library_artifact_versions (artifact_id, version, manifest, entry_file, files, bundle_sha256, compliance_level)
     select 'orbit-lab', 9, manifest || '{"version": 9, "entry": "main.html"}', 'main.html', files, sha, 0 from fx $$,
  '23514', null, 'the entry file must be one of the files'
);
select throws_ok(
  $$ select public.library_add_version('missing-lab', manifest, files, sha, 0, null) from fx $$,
  'P0001', 'library artifact missing-lab not found', 'adding a version needs an existing artifact'
);

select throws_ok(
  $$ update public.library_artifact_versions set status = 'published' where artifact_id = 'orbit-lab' and version = 1 $$,
  'P0001', 'library version orbit-lab@1 cannot move from draft to published', 'a draft cannot skip testing'
);
select lives_ok(
  $$ select public.library_set_status('orbit-lab', 1, 'testing', null) $$,
  'a draft moves into testing'
);
select throws_ok(
  $$ select public.library_set_status('orbit-lab', 1, 'testing', null) $$,
  'P0001', 'library version orbit-lab@1 is already testing', 'repeating a status change is refused'
);
select is(
  public.library_set_status('orbit-lab', 1, 'published', '5a000000-0000-4000-8000-0000000000a1') ->> 'current_version',
  '1', 'publishing makes the version current'
);
select ok(
  (select published_at is not null and published_by = '5a000000-0000-4000-8000-0000000000a1'
   from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 1),
  'publishing records when and by whom'
);

select throws_ok(
  $$ update public.library_artifact_versions set manifest = manifest || '{"title": "Changed"}' where artifact_id = 'orbit-lab' and version = 1 $$,
  'P0001', 'library version orbit-lab@1 is published and cannot be modified', 'a published manifest cannot change'
);
select throws_ok(
  $$ update public.library_artifact_versions set validation_report = '{"ok": true}' where artifact_id = 'orbit-lab' and version = 1 $$,
  'P0001', 'library version orbit-lab@1 is published and cannot be modified', 'a published validation report cannot change'
);
select throws_ok(
  $$ update public.library_artifact_versions set status = 'draft' where artifact_id = 'orbit-lab' and version = 1 $$,
  'P0001', 'library version orbit-lab@1 cannot move from published to draft', 'a published version cannot go back to draft'
);
select throws_ok(
  $$ delete from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 1 $$,
  'P0001', 'library version orbit-lab@1 is published and cannot be deleted', 'a published version cannot be deleted'
);
select throws_ok(
  $$ delete from public.library_artifacts where id = 'orbit-lab' $$,
  'P0001', null, 'an artifact with published versions cannot be deleted'
);

select ok(
  (select search_tsv @@ websearch_to_tsquery('english', 'orbits') from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 1),
  'search_tsv matches a stemmed concept'
);
select ok(
  (select search_tsv @@ websearch_to_tsquery('english', 'solar system') from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 1),
  'search_tsv matches topics'
);

select lives_ok($$ select public.library_set_status('orbit-lab', 2, 'testing', null) $$, 'version 2 moves into testing');
select is(
  public.library_set_status('orbit-lab', 2, 'published', null) ->> 'current_version',
  '2', 'a newer published version becomes current'
);
select is(
  public.library_set_status('orbit-lab', 2, 'retired', null) ->> 'current_version',
  '1', 'retiring the current version falls back to the newest published one'
);
select ok(
  (select retired_at is not null from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 2),
  'retiring records when'
);
select throws_ok(
  $$ update public.library_artifact_versions set status = 'published' where artifact_id = 'orbit-lab' and version = 2 $$,
  'P0001', 'library version orbit-lab@2 is retired and cannot change', 'a retired version never changes'
);

select is(
  (select public.library_add_version('orbit-lab', manifest, files, sha, 3, null) from fx),
  3, 'numbering continues after a retirement'
);
select lives_ok(
  $$ delete from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 3 $$,
  'a draft can be deleted'
);

select is(
  (select public.library_register_draft('draft-lab', manifest || '{"id": "draft-lab"}', files, sha, 0, null) from fx),
  1, 'a second artifact starts at version 1'
);

insert into public.library_search_log (topic_id, artifact_id, bite_id, request, decision, chosen_artifact_id, chosen_version)
values ('a1f00000-0000-4000-8000-0000000000a1', 'a1a00000-0000-4000-8000-0000000000a1', 'explore-1', '{}', 'accepted', 'orbit-lab', 1);
insert into public.library_usage (artifact_id, bite_id, library_artifact_id, library_version)
values ('a1a00000-0000-4000-8000-0000000000a1', 'explore-1', 'orbit-lab', 1);

-- ---------------------------------------------------------------------------
-- Service role: the trigger still applies
-- ---------------------------------------------------------------------------
set local role service_role;
select throws_ok(
  $$ update public.library_artifact_versions set files = '[]' where artifact_id = 'orbit-lab' and version = 1 $$,
  'P0001', 'library version orbit-lab@1 is published and cannot be modified', 'the service role cannot modify a published version'
);
select throws_ok(
  $$ delete from public.library_artifact_versions where artifact_id = 'orbit-lab' and version = 2 $$,
  'P0001', 'library version orbit-lab@2 is retired and cannot be deleted', 'the service role cannot delete a retired version'
);
reset role;

-- ---------------------------------------------------------------------------
-- Staff S
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5a000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

select is((select count(*) from public.library_artifact_versions), 3::bigint, 'staff see drafts, published and retired versions');
select is((select count(*) from public.library_search_log), 1::bigint, 'staff read the search log');
select throws_ok(
  $$ update public.library_artifact_versions set validation_report = '{}' where artifact_id = 'draft-lab' $$,
  '42501', null, 'staff cannot write versions directly'
);
select throws_ok(
  $$ select public.library_set_status('draft-lab', 1, 'testing', null) $$,
  '42501', null, 'staff cannot call the catalog functions directly'
);

-- ---------------------------------------------------------------------------
-- Parent A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

select is(
  (select array_agg(status order by version) from public.library_artifact_versions),
  array['published', 'retired'], 'a parent sees published and retired versions only'
);
select is((select array_agg(id) from public.library_artifacts), array['orbit-lab'], 'a parent cannot see an artifact with nothing published');
select is(
  (select count(*) from public.library_search_log) + (select count(*) from public.library_usage) + (select count(*) from public.staff_users),
  0::bigint, 'a parent cannot read the search log, usage or staff list'
);
select throws_ok(
  $$ select public.library_register_draft('sneaky-lab', manifest || '{"id": "sneaky-lab"}', files, sha, 0, null) from fx $$,
  '42501', null, 'a parent cannot register artifacts'
);
select throws_ok(
  $$ insert into public.library_artifacts (id, title) values ('sneaky-lab', 'Sneaky') $$,
  '42501', null, 'a parent cannot insert artifacts'
);

-- ---------------------------------------------------------------------------
-- Child login C and anon
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is(
  (select array_agg(artifact_id || '@' || version order by version) from public.library_artifact_versions),
  array['orbit-lab@1', 'orbit-lab@2'], 'a child login sees the same published and retired versions'
);

reset role;
set local role anon;
select is((select count(*) from public.library_artifact_versions), 0::bigint, 'anonymous visitors see nothing');
reset role;

select * from finish();
rollback;

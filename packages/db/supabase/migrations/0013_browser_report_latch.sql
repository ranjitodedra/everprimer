-- Publishing requires a passing browser report for this bundle.
-- The application still compares the WebGL flag and parameter defaults.
-- Replacing the function keeps the service-role grant from 0011.

create or replace function public.library_set_status(
  p_artifact_id text,
  p_version integer,
  p_status text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_current integer;
  v_report jsonb;
  v_bundle text;
begin
  select current_version into v_current from public.library_artifacts where id = p_artifact_id for update;
  if not found then
    raise exception 'library artifact % not found', p_artifact_id;
  end if;

  select status, validation_report, bundle_sha256
  into v_old, v_report, v_bundle
  from public.library_artifact_versions
  where artifact_id = p_artifact_id and version = p_version;
  if not found then
    raise exception 'library version %@% not found', p_artifact_id, p_version;
  end if;
  if v_old = p_status then
    raise exception 'library version %@% is already %', p_artifact_id, p_version, p_status;
  end if;

  if p_status = 'published' then
    if v_report is null then
      raise exception 'library version %@% has no browser report', p_artifact_id, p_version;
    elsif jsonb_typeof(v_report -> 'ok') is distinct from 'boolean'
      or (v_report ->> 'ok') is distinct from 'true' then
      raise exception 'library version %@% browser report did not pass', p_artifact_id, p_version;
    elsif (v_report ->> 'bundleSha256') is distinct from v_bundle then
      raise exception 'library version %@% browser report does not match the bundle', p_artifact_id, p_version;
    end if;
  end if;

  update public.library_artifact_versions
  set status = p_status,
      published_by = case when p_status = 'published' then p_actor else published_by end
  where artifact_id = p_artifact_id and version = p_version;

  if p_status = 'published' and p_version > coalesce(v_current, 0) then
    update public.library_artifacts a
    set current_version = p_version, title = v.manifest ->> 'title'
    from public.library_artifact_versions v
    where a.id = p_artifact_id and v.artifact_id = p_artifact_id and v.version = p_version;
    v_current := p_version;
  elsif p_status = 'retired' and p_version = v_current then
    select max(version) into v_current from public.library_artifact_versions
    where artifact_id = p_artifact_id and status = 'published';
    update public.library_artifacts set current_version = v_current where id = p_artifact_id;
  end if;

  return jsonb_build_object('status', p_status, 'current_version', v_current);
end;
$$;

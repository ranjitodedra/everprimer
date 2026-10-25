-- Removes one staff row unless it would leave none. The lock makes two
-- overlapping removals leave the last staff member in place.

create or replace function public.remove_staff_member(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  lock table public.staff_users in exclusive mode;
  if (select count(*) from public.staff_users) <= 1 then
    return false;
  end if;
  delete from public.staff_users where user_id = p_user_id;
  return found;
end;
$$;

revoke all on function public.remove_staff_member(uuid) from public, anon, authenticated;

do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.remove_staff_member(uuid) to service_role;
  end if;
end
$grant$;

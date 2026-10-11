-- Generation progress.
--
-- The job runner records which step a curriculum or lesson is on, so the
-- waiting screens can show a progress bar driven by real steps. A null stage
-- means the job has not been picked up yet. stage_at is when the current
-- step began; the UI eases the bar forward within a step from that time.

alter table public.curricula
  add column stage text,
  add column stage_at timestamptz not null default now(),
  add constraint curricula_stage_check check (stage is null or stage in ('outlining', 'saving'));

alter table public.artifacts
  add column stage text,
  add column stage_at timestamptz not null default now(),
  add constraint artifacts_stage_check check (stage is null or stage in ('planning', 'writing', 'checking', 'pictures', 'building'));

-- A retry starts from the beginning: a row going back to generating drops
-- the step it reached last time.
create or replace function public.reset_generation_stage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'generating' and old.status is distinct from 'generating' then
    new.stage = null;
    new.stage_at = now();
  end if;
  return new;
end;
$$;

create trigger curricula_reset_stage before update of status on public.curricula
  for each row execute function public.reset_generation_stage();

create trigger artifacts_reset_stage before update of status on public.artifacts
  for each row execute function public.reset_generation_stage();

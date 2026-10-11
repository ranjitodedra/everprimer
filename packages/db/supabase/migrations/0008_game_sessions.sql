-- Game lessons: resume by session and a server-computed final score.
--
-- sessions_completed is how many rounds the learner has finished. It only
-- ever goes up. final_score is the first-attempt mark on the final test
-- (0..1), written by the server, never taken from the client.

alter table public.topic_progress
  add column sessions_completed integer not null default 0,
  add column final_score numeric,
  add constraint topic_progress_sessions_completed_check check (sessions_completed >= 0),
  add constraint topic_progress_final_score_check check (final_score is null or (final_score >= 0 and final_score <= 1));

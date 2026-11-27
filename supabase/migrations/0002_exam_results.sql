-- Real exam results reported by learners: the ground truth for the pass chance.
-- Append-only like the answer log: a correction is a new row, the latest per exam day wins.
create table public.exam_results (
  user_id     uuid    not null references auth.users (id) on delete cascade,
  id          uuid    not null,                      -- made on the device, so retries never double-count
  taken_at    bigint  not null check (taken_at > 0), -- epoch ms
  passed      boolean not null,
  score       smallint check (score between 0 and 100),
  reported_at bigint  not null check (reported_at > 0),
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.exam_results enable row level security;

create policy "read own results" on public.exam_results
  for select to authenticated using (user_id = (select auth.uid()));

create policy "report own results" on public.exam_results
  for insert to authenticated with check (user_id = (select auth.uid()));

-- "Ask me later" bookkeeping for the result prompt.
alter table public.study_settings
  add column result_prompt_skips smallint not null default 0 check (result_prompt_skips >= 0),
  add column result_prompt_skipped_at bigint check (result_prompt_skipped_at > 0);

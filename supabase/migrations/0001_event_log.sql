-- Readyline: the answer log is the only stored truth. Learner state is rebuilt from it.
-- Rows are append-only: users can insert and read their own rows, never update or delete them.

create table public.answer_events (
  user_id    uuid    not null references auth.users (id) on delete cascade,
  id         integer not null check (id > 0),
  item_key   text    not null,
  correct    boolean not null,
  at         bigint  not null check (at > 0),          -- epoch ms, set by the client when answered
  confidence text    check (confidence in ('sure', 'guess')),
  context    text    check (context in ('baseline', 'session')),
  created_at timestamptz not null default now(),        -- set by the server
  primary key (user_id, id)
);

alter table public.answer_events enable row level security;

create policy "read own answers" on public.answer_events
  for select to authenticated using (user_id = (select auth.uid()));

create policy "append own answers" on public.answer_events
  for insert to authenticated with check (user_id = (select auth.uid()));

-- No update or delete policy: with RLS on, both are denied.

-- Settings are the only mutable per-user data.
create table public.study_settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  exam_at          bigint check (exam_at > 0),             -- epoch ms
  baseline_skipped boolean not null default false,
  updated_at       timestamptz not null default now()
);

alter table public.study_settings enable row level security;

create policy "read own settings" on public.study_settings
  for select to authenticated using (user_id = (select auth.uid()));

create policy "create own settings" on public.study_settings
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "change own settings" on public.study_settings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

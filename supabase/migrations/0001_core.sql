-- Readyline core schema
-- Rule: content tables are the single source of question truth,
-- `events` is the single source of learner truth. Everything else is derived.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ============================================================
-- Exams and blueprint
-- ============================================================

create table exams (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                -- 'NJ-LIFE'
  name text not null,
  scored_items int not null,
  pass_percent int not null,
  time_minutes int not null,
  options_per_item int not null default 4,
  blueprint_verified boolean not null default false,
  blueprint_provenance jsonb not null default '{}'
);

create table blueprint_sections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  code text not null,                       -- 'II'
  name text not null,
  item_count int not null check (item_count >= 0),
  unique (exam_id, code)
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references blueprint_sections(id) on delete cascade,
  code text not null,                       -- 'II.2'
  name text not null,
  unique (section_id, code)
);

-- ============================================================
-- Content provenance
-- ============================================================

create type source_kind as enum ('blueprint', 'statute', 'regulation', 'model_law', 'manual', 'other');

create table sources (
  id uuid primary key default gen_random_uuid(),
  kind source_kind not null,
  citation text not null,                   -- 'N.J.S.A. 17B:25-18'
  title text,
  url text,
  retrieved_at timestamptz not null,
  content_hash text not null,               -- detects silent source changes
  superseded_by uuid references sources(id)
);

create table source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  locator text not null,                    -- section / paragraph / page
  text text not null,
  embedding vector(1024)
);

create type content_status as enum ('draft', 'in_review', 'verified', 'live', 'quarantined', 'retired');

-- A fact is one testable statement. Memory (FSRS) is scheduled per fact.
create table facts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id),
  statement text not null,
  source_chunk_id uuid not null references source_chunks(id),
  status content_status not null default 'draft',
  created_at timestamptz not null default now()
);

-- Items are versioned. (id, version) is what an answer refers to.
create table items (
  id uuid not null default gen_random_uuid(),
  version int not null default 1,
  fact_id uuid not null references facts(id),
  topic_id uuid not null references topics(id),
  stem text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  answer_index int not null check (answer_index >= 0),
  explanation text not null,
  source_chunk_id uuid not null references source_chunks(id),
  difficulty_prior real not null default 0, -- IRT b estimate before data
  status content_status not null default 'draft',
  generator jsonb not null default '{}',    -- model, prompt hash, run id
  embedding vector(1024),
  created_at timestamptz not null default now(),
  primary key (id, version),
  check (answer_index < jsonb_array_length(options))
);

create index items_live_topic on items (topic_id) where status = 'live';

create type review_check as enum ('blind_solve', 'distractor', 'ambiguity', 'citation', 'dedupe', 'human');

create table item_reviews (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  item_version int not null,
  check_kind review_check not null,
  passed boolean not null,
  detail jsonb not null default '{}',
  reviewer text not null,                   -- model id or user id
  created_at timestamptz not null default now(),
  foreign key (item_id, item_version) references items(id, version)
);

-- An item can only go live once every automated check has a passing record.
create or replace function enforce_item_promotion() returns trigger language plpgsql as $$
declare missing int;
begin
  if new.status = 'live' and (old.status is distinct from 'live') then
    select count(*) into missing
    from unnest(array['blind_solve','distractor','ambiguity','citation','dedupe']::review_check[]) as req(k)
    where not exists (
      select 1 from item_reviews r
      where r.item_id = new.id and r.item_version = new.version
        and r.check_kind = req.k and r.passed
    );
    if missing > 0 then
      raise exception 'item %/% cannot go live: % required checks missing', new.id, new.version, missing;
    end if;
  end if;
  return new;
end $$;

create trigger items_promotion before update of status on items
  for each row execute function enforce_item_promotion();

-- Calibrated statistics, written by the calibration job (derived, rebuildable).
create table item_stats (
  item_id uuid not null,
  item_version int not null,
  n int not null default 0,
  p_correct real,
  difficulty_b real,
  point_biserial real,
  reports int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (item_id, item_version),
  foreign key (item_id, item_version) references items(id, version)
);

-- ============================================================
-- Organizations and people
-- ============================================================

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  seats int not null default 0,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create type org_role as enum ('owner', 'manager', 'learner');

create table memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null,
  primary key (org_id, user_id)
);

create table enrollments (
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid not null references exams(id),
  org_id uuid references orgs(id),
  exam_date date,
  created_at timestamptz not null default now(),
  primary key (user_id, exam_id)
);

-- ============================================================
-- The event log: the only learner truth. Append only.
-- ============================================================

create type event_kind as enum ('answer', 'report', 'session_start', 'session_end');
create type study_mode as enum ('diagnostic', 'practice', 'review', 'mock');

create table events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  exam_id uuid not null references exams(id),
  kind event_kind not null,
  mode study_mode,
  session_id uuid,
  item_id uuid,
  item_version int,
  chosen_index int,
  correct boolean,
  response_ms int,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null,          -- client time, for spacing math
  received_at timestamptz not null default now(),
  foreign key (item_id, item_version) references items(id, version),
  check (kind <> 'answer' or (item_id is not null and correct is not null and chosen_index is not null))
);

create index events_user_exam on events (user_id, exam_id, id);
create index events_item on events (item_id, item_version) where kind = 'answer';

create or replace function forbid_event_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'events are append only';
end $$;

create trigger events_no_update before update or delete on events
  for each row execute function forbid_event_mutation();

-- Derived cache of engine state. Safe to truncate at any time.
create table learner_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid not null references exams(id),
  last_event_id bigint not null,
  engine_version text not null,
  state jsonb not null,
  readiness jsonb,
  computed_at timestamptz not null default now(),
  primary key (user_id, exam_id)
);

-- ============================================================
-- Row level security
-- ============================================================

alter table events enable row level security;
alter table learner_snapshots enable row level security;
alter table enrollments enable row level security;
alter table memberships enable row level security;

create or replace function is_manager_of(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships me
    join memberships them on them.org_id = me.org_id
    where me.user_id = auth.uid() and me.role in ('owner','manager')
      and them.user_id = target
  );
$$;

create policy events_insert_own on events for insert with check (user_id = auth.uid());
create policy events_read on events for select using (user_id = auth.uid() or is_manager_of(user_id));
create policy snapshots_read on learner_snapshots for select using (user_id = auth.uid() or is_manager_of(user_id));
create policy enrollments_read on enrollments for select using (user_id = auth.uid() or is_manager_of(user_id));
create policy memberships_read on memberships for select using (user_id = auth.uid() or is_manager_of(user_id));

-- Content is readable by any signed-in user, but only live items.
alter table items enable row level security;
create policy items_live_read on items for select using (status = 'live' and auth.role() = 'authenticated');

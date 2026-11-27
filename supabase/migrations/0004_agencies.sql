-- Agencies: seats, a join code, members. Managers see summaries of their learners through
-- the agency-dashboard edge function (service role); raw answers stay readable only by
-- their owner. Nothing here widens access to answer_events, study_settings or exam_results.

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  seats      integer not null default 0 check (seats >= 0),
  join_code  text not null unique,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id    uuid not null references public.organizations (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null check (role in ('manager', 'learner')),
  email     text,                          -- shown to the agency; copied from the sign-in at join
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- a learner belongs to at most one agency at a time
create unique index one_agency_per_learner on public.memberships (user_id) where role = 'learner';

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

-- helper: orgs the caller manages (security definer so policies don't recurse)
create function public.managed_orgs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select org_id from public.memberships where user_id = (select auth.uid()) and role = 'manager'
$$;
revoke all on function public.managed_orgs() from public, anon;
grant execute on function public.managed_orgs() to authenticated;

create policy "see own agencies" on public.organizations for select to authenticated
  using (id in (select org_id from public.memberships where user_id = (select auth.uid())));

create policy "see own membership" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or org_id in (select public.managed_orgs()));

-- learners may leave; managers may remove learners from their agency
create policy "leave agency" on public.memberships for delete to authenticated
  using (role = 'learner' and (user_id = (select auth.uid()) or org_id in (select public.managed_orgs())));

-- No insert/update policies: joining and code changes go through the functions below.

create function public.make_join_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- no 0/O/1/I/L: easy to read aloud
  c text := 'RDY-';
begin
  for i in 1..8 loop
    if i = 5 then c := c || '-'; end if;
    c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return c;
end $$;

create function public.redeem_join_code(code text) returns table (org_name text)
language plpgsql security definer set search_path = '' as $$
declare
  o public.organizations;
  used int;
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into o from public.organizations where join_code = upper(trim(code)) for update;
  if not found then raise exception 'That code is not valid.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.memberships where user_id = uid and org_id = o.id) then
    return query select o.name; return;
  end if;
  if exists (select 1 from public.memberships where user_id = uid and role = 'learner') then
    raise exception 'You are already linked to an agency. Leave it first.' using errcode = 'P0001';
  end if;
  select count(*) into used from public.memberships where org_id = o.id and role = 'learner';
  if used >= o.seats then raise exception 'This agency has no seats left. Ask your manager.' using errcode = 'P0001'; end if;
  insert into public.memberships (org_id, user_id, role, email)
    values (o.id, uid, 'learner', (select auth.jwt() ->> 'email'));
  return query select o.name;
end $$;
revoke all on function public.redeem_join_code(text) from public, anon;
grant execute on function public.redeem_join_code(text) to authenticated;

create function public.rotate_join_code(org uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if org not in (select public.managed_orgs()) then raise exception 'not a manager of this agency' using errcode = '42501'; end if;
  loop
    c := public.make_join_code();
    begin
      update public.organizations set join_code = c where id = org;
      return c;
    exception when unique_violation then -- try another
    end;
  end loop;
end $$;
revoke all on function public.rotate_join_code(uuid) from public, anon;
grant execute on function public.rotate_join_code(uuid) to authenticated;

revoke all on function public.make_join_code() from public, anon, authenticated;

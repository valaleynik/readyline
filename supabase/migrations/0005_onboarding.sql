-- When the learner finished onboarding (epoch ms). Null for accounts from before onboarding;
-- the app treats anyone with answers as onboarded.
alter table public.study_settings add column onboarded_at bigint check (onboarded_at > 0);

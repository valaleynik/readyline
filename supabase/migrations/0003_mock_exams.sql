-- Mock exams: answers tagged "mock", and the mock records (start time, seed, draft answers).
alter table public.answer_events drop constraint answer_events_context_check;
alter table public.answer_events add constraint answer_events_context_check
  check (context in ('baseline', 'session', 'mock'));

alter table public.study_settings
  add column mocks jsonb not null default '[]'::jsonb check (jsonb_typeof(mocks) = 'array');

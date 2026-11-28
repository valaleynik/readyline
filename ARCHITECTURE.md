# Readyline Architecture

Readyline prepares insurance producer candidates for state licensing exams and gives agencies a live view of recruit readiness. Version 1 covers one exam: the New Jersey Life Producer exam (83 scored items, 70% to pass, 210 minutes).

## The rule

**One source of content truth. One learner model. Every feature reads from both.**

No feature keeps its own private idea of what a question is or what a learner knows. Quizzes, review scheduling, readiness, the agency dashboard and the AI tutor all call the same engine, which computes everything from the same event log and the same verified item bank. UI comes last.

## Success metrics (measured, not claimed)

| Metric | Target | How it is measured |
|---|---|---|
| Item key accuracy | > 99% | Audit sample of live items, every item traceable to a cited source |
| Pass prediction calibration | ECE < 0.05 | Simulated cohorts now, reported real outcomes later |
| Ability recovery | r > 0.85 after 100 answers | Simulated learners with known true ability |
| Bad item detection | Flagged before 50 responses | Seeded bad items in simulation |

## Layer 1: Content (the item bank)

Questions are built from sources, never from a bare prompt.

```
sources -> source_chunks -> facts -> items -> item_reviews -> live
```

- **sources**: the exam blueprint, N.J.S.A. Title 17 / 17B, N.J.A.C. 11:17, NAIC model text. Each has a URL, retrieval date and content hash.
- **facts**: small, single testable statements ("A free look period for individual life policies in NJ is 10 days"), each tied to a source chunk and a blueprint topic. Facts are the unit of memory scheduling.
- **items**: multiple choice questions generated from exactly one fact. Versioned. Editing an item creates a new version, so old answers stay interpretable.
- **item_reviews**: every automated and human check, stored with its result:
  1. `blind_solve`: a separate model answers without the key and must match it.
  2. `distractor`: each wrong option must be shown wrong by the cited source.
  3. `ambiguity`: no option can be defended as also correct.
  4. `citation`: the explanation must quote or point to the source chunk.
  5. `dedupe`: embedding similarity against existing items.
  6. `human`: spot check sample before promotion to `live`.
- **Live item statistics**: difficulty (IRT b, calibrated from responses), point biserial discrimination, user reports. Automatic quarantine when an item looks miskeyed (very low p-correct among strong learners) or discriminates negatively.

### Content as code

The bank lives in the repo as reviewable files, so every change to a question is a diff:

- `content/sources/`: verbatim statute text plus `manifest.json` with URL, retrieval date and SHA-256. The hash is computed in the retrieving browser and checked again after saving. `npm run content` fails if any source text changes.
- `content/exams/nj-life/topics/*.json`: facts, each with an exact quote that must be a substring of its source, and the items built from them.
- `content/reviews/*.json`: every review record, both automated and from independent agents. Reviewers get only the questions and the statute text, never the keys.

`npm run content` enforces: exact quotes, cited explanations, 4 unique options with no catch-all answers, no near-duplicate stems, balanced key positions, and test-wiseness checks (a key much longer than the distractors, absolute words in distractors, a key that is the only option echoing the statute wording). An item counts as verified only when every required review has passed and it has no open warning.

Item status lifecycle: `draft -> in_review -> verified -> live -> retired` (or `quarantined`). Only `live` items are served.

## Layer 2: The learner model

**The event log is the only truth.** Every answer is an append-only row in `events`. Nothing is updated in place. All learner state is derived by replaying events through the engine, so any number on any screen can be recomputed and explained.

The engine (`src/engine`) is pure TypeScript with no database or network access. Same events in, same state out.

### Ability (what the learner knows)

- Item response model with a guessing floor for 4-option items: `P(correct) = 0.25 + 0.75 * sigmoid(theta - b)`.
- Ability is hierarchical: `theta_topic = g + delta_topic`. `g` is general ability, `delta` is a topic offset. Topics with little data borrow strength from `g`.
- Each parameter keeps a Gaussian posterior (mean and variance), updated after every answer with an online Laplace step. Uncertainty is a first-class output, not an afterthought.

### Memory (what the learner will still know on exam day)

- FSRS 4.5 per fact: stability, difficulty, last review. Retrievability `R(t) = (1 + 19/81 * t / S)^-0.5`.
- Wrong answer = Again, correct answer = Good. Same day repeats do not change stability.

### Readiness (will they pass)

Monte Carlo simulation of the real exam, using the official blueprint item counts:

1. Draw abilities from the posteriors.
2. For each blueprint section, compute the probability of answering a typical live item correctly, discounted by projected memory decay on exam day for facts already studied.
3. Draw a full 83-item score. Repeat 4,000 times with a seeded RNG.
4. `P(pass) = share of simulated scores >= 59` (70% of 83, rounded up).

Outputs: P(pass), expected score with an interval, and per section expected accuracy.

## Layer 3: The decision engine

One scheduler picks the next item for every mode.

- **Diagnostic**: asks where ability is most uncertain, weighted by exam share, choosing items near current ability for maximum information.
- **Practice**: ranks every fact by its expected value for the exam. Base value = the fact's share of the exam (topic weight / facts in topic).
  - New fact: base x (1 - expected topic accuracy + uncertainty bonus).
  - Relearn (a missed fact): base x 1.5 / lapses, eligible after 8 x lapses answers. Repeated misses widen the gap so a struggling learner is never stuck looping.
  - Due review: base x (1 - R) / (1 - 0.9), capped at 1.5, once FSRS retrievability drops below 0.9.
  - Studied facts leave the new pool, so no single topic can absorb a session.
- **Exposure control**: ties break randomly per learner and items are drawn from the top 5 by information, so the whole bank gets used and calibrated. Unseen wordings of a fact are served before repeats. Nothing in the last 25 answers is served again.
- **Review**: due and relearn facts only.
- **Mock exam**: exactly the blueprint's 83 items, one item per fact where the bank allows. Refuses to build a short form.

Flagged items (suspect key or negative discrimination) are quarantined and sent to human review, never silently deleted. Suspect keys are detected with a likelihood-ratio test: the responses are compared under "item is hard" versus "stored key is wrong".

## Layer 4: Consumers

- **Learner app**: calls the engine for the next item and the readiness card.
- **AI tutor**: explains a missed item using only the item's cited source chunk. It cannot invent facts outside the chunk.
- **Agency dashboard**: aggregates engine output per recruit and per topic. It never computes its own scores.

## Data flow

```
answer -> INSERT events -> replay(events, items) -> LearnerState (cached snapshot, rebuildable)
                                                  -> scheduler.next()
                                                  -> readiness()
                                                  -> dashboard aggregates
```

`learner_snapshots` is a cache keyed by the last event id and the engine version. It can always be dropped and rebuilt.

## Verification

`npm run sim` builds synthetic learners with known true abilities, runs them through the diagnostic and practice flow, predicts their pass probability, then simulates their real exam from the true parameters. It reports ability recovery, Brier score and calibration error. The engine does not ship if these miss target.

## Concepts reference

Every concept below exists to fix a specific failure. Before adding a new one, check whether an existing concept already covers it.

| Concept | Where | What it does | Why it exists |
|---|---|---|---|
| Source hash | `content/sources/manifest.json` | SHA-256 of each verbatim source text | Detects any silent change to the law text a question depends on |
| Fact | topic files | One testable statement with an exact quote from its source | Unit of truth for content and unit of memory for the scheduler |
| Item version | topic files | Any change to stem or options bumps the version | Old answers and reviews stay attached to what was actually shown |
| Review record | `content/reviews/` | One record per check per item version | Audit trail; an item is verified only when all required checks pass for its current version |
| Pending snapshot | `content/reviews/pending/` | Exact layout sent to a blind reviewer | Scoring by option text, never by letter; frozen items cannot be reordered mid-review |
| Retired | `item.retired` | Withdraws an item and records the reason | Keeps history instead of deleting; retired items never reach the engine |
| optionStyle | `item.optionStyle` | `ordered` keeps natural order; `category` exempts name-style options from the echo check | Prevents false warnings and wrong shuffles |
| Group | `item.group` | Items that all cue each other; at most one per form | Symmetric cueing, such as two items with the same option set |
| Enemies | `item.enemies` | Specific items that must not share a form | Asymmetric cueing: one item's stem reveals another's answer |
| Contrasts | `fact.contrasts` | Facts students commonly confuse | Data only for now; used by confusing-pairs drills in the UI phase |
| Live bank | `src/content/bank.ts` | Feeds the engine verified, non-retired items only | A draft can never reach a learner |

## Sourcing policy

Every item traces to a source stored verbatim with a hash. Sources come in three tiers, used in this order:

1. **Law.** New Jersey statutes for state law and policy provisions, the Internal Revenue Code for taxation, the Social Security Act, the Fair Credit Reporting Act for underwriting reports, and the FCC's TCPA rules for telemarketing.
2. **Regulator text.** Material written or adopted by insurance regulators: NJ DOBI pages, the NAIC Life Insurance Buyer's Guide (adopted into N.J.A.C. 11:4-11), NAIC consumer guides, and SEC investor education. Used for product concepts (term, whole life, universal life, riders) that the statutes do not define.
3. **Not allowed.** Prep-course text, insurer marketing, blogs, and anything an AI wrote. These can point to where a rule lives but never stand as the source.

When tiers disagree, law wins. Adding a new source within tiers 1 or 2 needs no sign-off; anything else does.

The FTC Telemarketing Sales Rule was dropped for insurance items, because the FTC's authority largely does not reach the state-regulated business of insurance.

Rules that changed recently (for example the 2024 FCC change from 30 days to 10 business days for honoring do-not-call requests) are withheld when prep materials, and possibly the exam itself, may still teach the old rule. Retired items stay in the files with their reason.

## Known limits (v1)

- Blueprint item counts come from a prelicensing provider's published breakdown of the PSI outline. They must be checked against the current PSI content outline before launch (`blueprint.json` marks this).
- Item difficulty starts from a generator estimate and is calibrated as real responses arrive.
- Ability does not decay with time; memory decay is handled by FSRS at the fact level.

## Study loop (UI phase, step 1)

- `src/session/daily.ts` is the daily session: pure functions over the event log. It adds one session rule on top of the engine: at most 12 new facts a day, then review only, with a hard cap of 60 questions. A missed fact that is stuck behind the relearn gap is served before the day counts as cleared.
- `src/content/export.ts` writes `web/data/bank.json` (engine metadata plus display text from the same files in one pass). A test fails if the bundled file is stale.
- `web/components/StudyApp.tsx` is the only UI component. The Next.js app (`web/app`) and the single-file preview (`scripts/build-preview.mjs`) both render it.
- Stored state is the event log only. Learner state is always `replay(events)`. Confidence ("sure" / "guess") is recorded on each event for the calibration grid; the engine ignores it.
- Engine fix found while building: the no-repeat window now covers only the last 6 hours, so a learner returning after a break sees their due reviews.

### Exam date and study plan

- `src/session/plan.ts` turns one setting (the exam date) into today's new-fact quota and an on-track / behind signal. It stores nothing.
- Pace: remaining facts spread over the days before a 2-day review-only buffer, between 5 and 40 new facts a day. Above 25 a day counts as behind, with the number of extra days needed shown.
- Readiness is measured on exam day (with forgetting) when a future date is set.
- The session fixes its quota when it starts, so the target cannot shift mid-session.
- The date field on the home screen is temporary. Onboarding will write the same setting.

### Feature rule

Every feature reads the event log, the bank and the settings, and may only add events or change a setting. No feature keeps its own copy of what the learner knows.

## Baseline test

A 20-question placement round offered once, at signup, before any studying.

- Offered only to a learner with no events and an exam more than 5 days out (or no date). Skippable.
- Questions are split across sections by exam share (at least one each), one per fact, picked where ability is least certain.
- No feedback per question. Answers are ordinary events tagged `context: "baseline"`, so they feed the model like any other answer.
- Result: section-by-section estimate, likely score range, weakest section first.

## Pass chance gate

The pass chance is hidden until the model has earned it for this learner (`src/session/passchance.ts`). All four checks must pass:

- Coverage: 5+ answers in every section, and topics with 2+ answers cover 60% of exam weight.
- Certainty: the model-uncertainty band on expected score (ability draws only, no exam-day luck) is 10 points wide or less.
- Self-check: before each answer the engine's prediction (ability vs. difficulty, times memory) is replayed from the log. Over the last 100 answers, actual correct must be within 2 standard errors of predicted (60+ answers needed).
- Recency: an answer in the last 7 days.

Once unlocked before today, looser keep rules apply (50%, 13 points, 2.5 SE, 10 days) so the number does not flicker. Shown as "about N%", rounded to 5s, held between 5% and 95%, with the likely score range. While locked, the learner sees the checks and a rough count of answers left, with the section to work on.

Simulation (learners who behave as the model assumes): unlocks at roughly 180 to 390 answers, and hides again on about 3% of later days. The real test is reported exam results.

## Storage and sync (Supabase)

The server stores the answer log and settings, nothing else (`supabase/migrations/0001_event_log.sql`). The bank stays in code.

- `answer_events`: one row per answer, keyed by (user, id). Row level security: users can read and insert their own rows only. No update or delete, ever.
- `study_settings`: exam date and baseline skip, the only mutable per-user data.
- Answers are saved locally first, then uploaded (`src/sync/store.ts`). Losing the connection never loses an answer.
- Two devices can both write id N. The server's rows are final: local answers it lacks are renumbered after its last id and retried (`src/sync/merge.ts`). Answer times are never rewritten. Replay treats a late upload with an earlier time as happening at the previous answer's time, so memory never runs backward.
- The app is told about changes only when the log or settings actually changed, so saving back cannot loop.
- Project: `readyline` (ref `tszpanlxwshwvxemtrvc`, us-east-1). Migration `0001_event_log` applied 2026-11-27.
- Verified on the live database (as two test users and as anon, then rolled back): duplicate ids rejected with 23505, inserting as another user rejected, updates and deletes of answers affect 0 rows, other users' answers and settings invisible, anon sees nothing. Security and performance advisors: no issues.
- Live: https://readyline-orpin.vercel.app (Vercel project `readyline`, root directory `web`). Verified 2026-11-27 on an iPhone: email-link sign-in, then a 20-question baseline synced as ids 1 to 20 with confidence and context, plus settings (exam date).
- Auth: email link via Supabase's built-in sender (low hourly limit). Site URL and redirect set to the Vercel address. Use a real email provider before real users.
- Without `NEXT_PUBLIC_SUPABASE_URL` and the publishable key, the app runs local-only (the preview build does).

## Exam results

Learners report their real result (`src/session/results.ts`); it is the only ground truth for the pass chance.

- Asked on home from 5pm on exam day until answered. "Ask me later" hides it for the day; after 3 it stops asking. An "I took the exam" link is always there (early exams, no date set).
- Pass or fail required, score (0 to 100) optional. A pass keeps the date and shows a banner. A fail clears the date so the learner sets a retake; the log carries on.
- `exam_results` is append-only with a device-made id, so a retried upload never double-counts. Latest report for an exam day wins.
- The prediction is not stored: `predictionBefore` rebuilds what the app showed from answers before exam day. Comparing those against results across users is the calibration check.
- Migration `0002_exam_results` applied before the app deploy (the new app writes the new settings columns). Verified on the live database: retry inserts 0 rows, score 101 rejected, other users and anon see nothing, no updates or deletes.

## Mock exam

A full rehearsal (`src/session/mock.ts`): 83 questions in the blueprint's section mix, 210 minutes, no feedback until submit.

- Stored as `{ id, startedAt, seed, answers, flagged, submittedAt }` in `study_settings.mocks`. The form itself is never stored: it is rebuilt from answers logged before `startedAt` plus the seed, so every device sees the same 83 questions.
- Form assembly prefers never-seen questions, then questions on facts not yet met, then those seen longest ago (`mockForm` cost option; without it the engine's forms are unchanged).
- Answers are drafts (changeable, flaggable) until submit. On submit, answered questions become events tagged `mock` and feed the model. Blanks are not logged but count as wrong. The clock runs while the app is closed; an expired mock is submitted on sight, stamped at the deadline. A guard makes submit fire once.
- Result: score with a rough 80% range (one form has luck in it), section scores, minutes used, what the model expected before, a warning when over 15% of questions were repeats, and a review of every miss with explanation and citation.
- Suggested (always available): once 40% of facts are studied, and again 2 to 5 days before the exam; never within 3 days of the last one.
- Migration `0003_mock_exams` applied before deploy; verified "mock" accepted, other contexts and a non-array `mocks` rejected.

## Agencies

Same app, same sign-in. Individuals study on their own; agencies buy seats and hand out a join code (`supabase/migrations/0004_agencies.sql`).

- `organizations` (name, seats, join code) and `memberships` (manager or learner, email copied at join). A learner belongs to at most one agency.
- Joining goes through `redeem_join_code`: valid code, a free seat, not already in another agency. `rotate_join_code` (managers only) replaces the code; the old one stops working. Learners can leave; managers can remove learners. No insert or update policies: nobody can self-promote.
- Managers never get raw answers. The `agency-dashboard` edge function (service role) checks the caller manages the agency, reads each learner's log, runs the same engine (`src/agency/summary.ts`) and returns summaries only: exam date, plan status, share of material seen, activity, pass chance (only when the learner's own app shows it), mock scores, reported result. RLS on answers, settings and results is unchanged.
- The function is bundled from `supabase/functions/agency-dashboard/handler.ts` by `scripts/build-functions.mjs` and reads the bank from the app's `/bank.json`, so server and app use the same questions.
- Verified on the live database: code format, seat limit, invalid and replaced codes rejected, no self-promotion, learners see only themselves, managers see members but zero raw answers, outsiders and anon see nothing.
- Agencies are created by hand for now (sales-led); Stripe will create them on purchase.

## Roadmap (agreed 2026-11-27)

1. Done 2026-11-27: domain readylineprep.com (bought on Vercel, Vercel DNS; apex redirects to www). Resend added its DKIM and sending records via auto-configure; Supabase sends auth email through Resend SMTP as Readyline <noreply@readylineprep.com>. Site URL is https://www.readylineprep.com (vercel.app kept as a redirect URL). Verified end to end on a phone. Not set up yet: inbound mail (free forwarding, e.g. ImprovMX, for support@). The deployed agency-dashboard function still reads the bank from the vercel.app address (works); the source now points at www and ships on the next function deploy.
2. Design pass and onboarding: real visual design, signup with exam date, baseline screens, plus a Learn tab:
   - lessons per topic built only from verified facts (statement, quote, contrasts), no AI-written text
   - each lesson ends with 2 to 3 check questions logged as context "learn"
   - no points or streaks; keep pointing back to the daily session
   - pull sample lessons first to judge whether fact statements read well as teaching text
3. Cleanups: V4-64a "whom" to "who" (version bump and re-review), check the primary PSI outline by hand, delete the demo learner (d300d300-0000-4000-8000-000000000001) when no longer needed.
4. Stripe last, test mode first: one `hasAccess` check gates the app (always true until then); individual purchase and agency seats (creates the organization). Webhook signature checks and idempotency tested before going live.

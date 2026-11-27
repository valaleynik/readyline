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

## Sourcing policy

Every item traces to a government primary source, stored verbatim with a hash: New Jersey statutes for state law and policy provisions, the Internal Revenue Code for taxation, the Fair Credit Reporting Act for underwriting reports, and the FCC's TCPA rules for telemarketing. The FTC Telemarketing Sales Rule was dropped for insurance items, because the FTC's authority largely does not reach the state-regulated business of insurance.

Rules that changed recently (for example the 2024 FCC change from 30 days to 10 business days for honoring do-not-call requests) are withheld when prep materials, and possibly the exam itself, may still teach the old rule. Retired items stay in the files with their reason.

## Known limits (v1)

- Blueprint item counts come from a prelicensing provider's published breakdown of the PSI outline. They must be checked against the current PSI content outline before launch (`blueprint.json` marks this).
- Item difficulty starts from a generator estimate and is calibrated as real responses arrive.
- Group life (IV.2, VI.2) has no items yet: FindLaw's copy of N.J.S.A. 17B:27 omits the group life sections, and the official NJ Legislature site needs a different retrieval path.
- Ability does not decay with time; memory decay is handled by FSRS at the fact level.

"use client";
/**
 * The study session: progress bar, question, feedback, end of session.
 * Display only. Picking questions, logging answers and scheduling stay in StudyApp and the engine.
 */
import type React from "react";
import type { DisplayItem, DisplayFact } from "../../src/content/export";

export const REASON_LABEL: Record<string, string> = {
  new_material: "New",
  relearn: "Missed earlier",
  due_review: "Review",
  diagnostic: "Placement",
  extra_practice: "Extra practice",
  baseline: "Baseline test",
};

/**
 * One bar for the whole session. `fraction` never moves backward (StudyApp keeps the highest value),
 * and each answer, right or wrong, floats a +1 off the end of the fill.
 */
export function SessionBar({ fraction, label, bump }: { fraction: number; label: string; bump: number }) {
  const pctW = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  return (
    <div className="ss-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label={label}>
      <div className="ss-bar__track">
        <div className="ss-bar__fill" style={{ width: pctW }} />
        {bump > 0 && (
          <span key={bump} className="ss-bar__plus" style={{ left: pctW }} aria-hidden="true">
            +1
          </span>
        )}
      </div>
      <span className="ss-bar__label">{label}</span>
    </div>
  );
}

export function QuestionCard({
  item,
  label,
  topic,
  choice,
  onChoose,
  onSubmit,
}: {
  item: DisplayItem;
  label: string;
  topic: string;
  choice: number | null;
  onChoose: (c: number) => void;
  onSubmit: (c: "sure" | "guess") => void;
}) {
  return (
    <section className="ss" aria-labelledby="ss-stem">
      <div className="ss__meta">
        <span className="rl-badge rl-badge--neutral">{label}</span>
        <span className="ss__topic">{topic}</span>
      </div>
      <h2 id="ss-stem" className="t-question ss__stem">
        {item.stem}
      </h2>
      <ol className="ss__options">
        {item.options.map((o, i) => (
          <li key={i}>
            <button className={`rl-option ${choice === i ? "rl-option--selected" : ""}`} onClick={() => onChoose(i)} aria-pressed={choice === i}>
              <span className="rl-option__key">{"ABCD"[i]}</span>
              <span>{o}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="ss__actions">
        <p className="ss__ask">{choice === null ? "Pick an answer, then say how sure you are." : "How sure are you?"}</p>
        <div className="ss__buttons">
          <button className="rl-btn rl-btn--primary" disabled={choice === null} onClick={() => onSubmit("sure")}>
            I'm sure
          </button>
          <button className="rl-btn rl-btn--secondary" disabled={choice === null} onClick={() => onSubmit("guess")}>
            I'm guessing
          </button>
        </div>
        <p className="ss__keys" aria-hidden="true">
          <kbd>1</kbd>–<kbd>4</kbd> choose · <kbd>S</kbd> sure · <kbd>G</kbd> guessing
        </p>
      </div>
    </section>
  );
}

/** One quiet line under the answer. The screen is about the rule, not the score. */
export function verdictFor(correct: boolean, confidence: "sure" | "guess", picked?: string): { title: string; note: string } {
  if (correct)
    return confidence === "guess"
      ? { title: "Correct", note: "You were guessing, so it comes back soon to make it stick." }
      : { title: "Correct", note: "It comes back right before you'd forget." }
  const yours = picked ? `You picked ${picked}. ` : "";
  return confidence === "sure"
    ? { title: "Not quite", note: `${yours}You were sure, so this one is worth a careful read.` }
    : { title: "Not quite", note: `${yours}Good call marking it as a guess.` };
}

export function FeedbackCard({
  item,
  fact,
  contrasts,
  choice,
  correct,
  confidence,
  nextRef,
  onNext,
}: {
  item: DisplayItem;
  fact?: DisplayFact;
  contrasts: DisplayFact[];
  choice: number;
  correct: boolean;
  confidence: "sure" | "guess";
  nextRef: React.RefObject<HTMLButtonElement>;
  onNext: () => void;
}) {
  const v = verdictFor(correct, confidence, correct ? undefined : item.options[choice]);
  return (
    <section className="ss" aria-labelledby="ss-answer">
      <p className="ss__stemSmall">{item.stem}</p>
      <div className={`ss-verdict ${correct ? "ss-verdict--right" : "ss-verdict--wrong"}`}>
        <p className="rl-overline">The answer</p>
        <h2 id="ss-answer" className="ss-verdict__answer">
          {item.options[item.answer]}
        </h2>
        <p className="ss-verdict__note">
          <span className="ss-verdict__dot" aria-hidden="true">
            {correct ? "✓" : "✕"}
          </span>
          <span>
            <strong>{v.title}.</strong> {v.note}
          </span>
        </p>
      </div>

      <div className="ss__section">
        <p className="rl-overline">Why</p>
        <p className="ss__why">{item.explanation}</p>
      </div>

      {fact && (
        <div className="ss__section">
          <p className="rl-overline">The law</p>
          <figure className="ss-law">
            <blockquote className="ss-law__quote">“{fact.quote}”</blockquote>
            <figcaption className="ss-law__cite">{fact.citation}</figcaption>
          </figure>
        </div>
      )}

      {contrasts.length > 0 && fact && (
        <div className="ss__section">
          <p className="rl-overline">Don't confuse</p>
          <div className="ss-pair">
            <div className="ss-pair__card ss-pair__card--this">
              <p className="ss-pair__label">This rule</p>
              <p>{fact.statement}</p>
            </div>
            {contrasts.map((c, i) => (
              <div key={i} className="ss-pair__card">
                <p className="ss-pair__label">Easy to mix up with</p>
                <p>{c.statement}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ss__actions">
        <div className="ss__buttons">
          <button ref={nextRef} className="rl-btn rl-btn--primary" onClick={onNext}>
            Next question
          </button>
        </div>
        <p className="ss__keys" aria-hidden="true">
          <kbd>Enter</kbd> next
        </p>
      </div>
    </section>
  );
}

/** "tomorrow around 3 PM", "in 4 days", "later today" */
export function whenLabel(at: number, now: number): string {
  if (at <= now + 15 * 60_000) return "now";
  const d0 = new Date(now);
  d0.setHours(0, 0, 0, 0);
  const days = Math.floor((at - d0.getTime()) / 86_400_000);
  const hour = new Date(at).toLocaleTimeString(undefined, { hour: "numeric" });
  if (days <= 0) return `later today, around ${hour}`;
  if (days === 1) return `tomorrow, around ${hour}`;
  if (days < 7) return `in ${days} days`;
  return `on ${new Date(at).toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
}

export function SessionDone({
  capped,
  answered,
  correct,
  newFacts,
  factsSeen,
  factsTotal,
  nextDue,
  missed = 0,
  children,
  onHome,
}: {
  capped: boolean;
  answered: number;
  correct: number;
  newFacts: number;
  factsSeen: number;
  factsTotal: number;
  nextDue: number | null;
  /** facts missed and not yet relearned: they open the next session */
  missed?: number;
  children?: React.ReactNode;
  onHome: () => void;
}) {
  const before = factsSeen - newFacts;
  const now = Date.now();
  return (
    <section className="ss sd" aria-labelledby="sd-title">
      <p className="rl-overline">Session complete</p>
      <h1 id="sd-title" className="t-h3 sd__title">
        {capped ? "That's enough for one sitting" : "Today's list is clear"}
      </h1>
      <p className="sd__lede">
        {capped
          ? "You hit the session limit. Anything left over comes first next time."
          : "Everything due today is done. Stopping here is the plan, not a shortcut: spacing is what makes it stick."}
      </p>

      <div className="sd__stats">
        <div className="sd__stat">
          <span className="sd__num">{answered}</span>
          <span className="sd__lab">answered</span>
        </div>
        <div className="sd__stat">
          <span className="sd__num">{answered ? Math.round((correct / answered) * 100) : 0}%</span>
          <span className="sd__lab">correct</span>
        </div>
        <div className="sd__stat">
          <span className="sd__num">{newFacts}</span>
          <span className="sd__lab">new facts</span>
        </div>
      </div>

      <div className="rl-card sd__card">
        <p className="rl-overline">What changed</p>
        <p className="sd__big">
          {factsSeen} of {factsTotal} facts studied
        </p>
        <div className="sd__material" aria-hidden="true">
          <span className="sd__material--before" style={{ width: `${(before / factsTotal) * 100}%` }} />
          <span className="sd__material--today" style={{ width: `${(newFacts / factsTotal) * 100}%` }} />
        </div>
        <p className="rl-muted">
          {newFacts > 0 ? `+${newFacts} today, shown in blue.` : "Today was all review, which locks in what you've learned."}
        </p>
      </div>

      <div className="rl-card sd__card">
        <p className="rl-overline">Come back</p>
        {missed > 0 ? (
          <>
            <p className="sd__big">Later today</p>
            <p className="rl-muted">
              {missed === 1 ? "The question you missed comes" : `The ${missed} questions you missed come`} back first. A short break before
              retrying helps it stick.
            </p>
          </>
        ) : (
          <>
            <p className="sd__big">{nextDue === null ? "Tomorrow" : `Next reviews: ${whenLabel(nextDue, now)}`}</p>
            <p className="rl-muted">Reviews are timed to just before you'd forget. Showing up then is worth more than a long session now.</p>
          </>
        )}
      </div>

      {children}

      <div className="ss__actions">
        <div className="ss__buttons">
          <button className="rl-btn rl-btn--primary" onClick={onHome} autoFocus>
            Back to home
          </button>
        </div>
      </div>
    </section>
  );
}

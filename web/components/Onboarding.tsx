"use client";
import type React from "react";
/**
 * First-run setup: how you study, when your exam is, where you start. Writes settings only;
 * the agency join goes through the account layer's join (the database checks the code and seats).
 */
import { useState } from "react";
import type { Bank } from "../../src/engine/bank";
import type { LearnerState } from "../../src/engine/types";
import type { MockSettings as Settings } from "../../src/session/mock";
import { studyPlan } from "../../src/session/plan";
import { examDateFromInput, onboardingSteps, startChoice, type OnboardingStep } from "../../src/session/onboarding";
import { BASELINE_LENGTH } from "../../src/session/baseline";
import type { Account } from "../lib/agency";
import { planLine, toInput } from "../lib/words";

export default function Onboarding({
  state,
  bank,
  settings,
  account,
  onFinish,
}: {
  state: LearnerState;
  bank: Bank;
  settings: Settings;
  account?: Account;
  /** saves the settings, then either starts the baseline or goes straight to studying */
  onFinish: (settings: Settings, next: "baseline" | "study") => void;
}) {
  const steps = onboardingSteps(!!account);
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState<Settings>(settings);
  // kept here, not in the step, so Back returns to the same answer
  const [noDate, setNoDate] = useState(false);
  const [how, setHow] = useState<"own" | "agency" | null>(null);
  const step = steps[i]!;
  const back = i > 0 ? () => setI(i - 1) : undefined;
  const next = () => setI(i + 1);

  return (
    <section className="ob" aria-labelledby="ob-title">
      <div className="ob__progress" aria-label={`Step ${i + 1} of ${steps.length}`}>
        <span className="ob__count">
          Step {i + 1} of {steps.length}
        </span>
        <div className="ob__bars">
          {steps.map((s, k) => (
            <span key={s} className={`ob__bar ${k <= i ? "on" : ""}`} />
          ))}
        </div>
      </div>
      {step === "how" && account && <HowStep account={account} choice={how} setChoice={setHow} onNext={next} />}
      {step === "date" && <DateStep state={state} bank={bank} draft={draft} setDraft={setDraft} noDate={noDate} setNoDate={setNoDate} onNext={next} onBack={back} />}
      {step === "start" && (
        <StartStep
          offer={startChoice(state, bank, draft, Date.now())}
          onBack={back}
          onChoose={(c) =>
            onFinish({ ...draft, onboardedAt: Date.now(), ...(c === "skip" ? { baselineSkipped: true } : {}) }, c === "baseline" ? "baseline" : "study")
          }
        />
      )}
    </section>
  );
}

function Nav({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="ob__nav">
      {children}
      {onBack && (
        <button className="rl-btn rl-btn--ghost" onClick={onBack}>
          Back
        </button>
      )}
    </div>
  );
}

function HowStep({
  account,
  choice: picked,
  setChoice,
  onNext,
}: {
  account: Account;
  choice: "own" | "agency" | null;
  setChoice: (c: "own" | "agency") => void;
  onNext: () => void;
}) {
  const linked = account.memberships.find((m) => m.role === "learner");
  const choice = picked ?? (linked ? "agency" : null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = choice === "own" || !!linked;
  return (
    <>
      <h1 id="ob-title" className="t-h3 ob__title">
        How are you studying?
      </h1>
      <p className="ob__lede">Agencies can see a summary of your progress. Studying on your own, nobody sees anything.</p>
      <div className="ob__choices" role="radiogroup">
        <button role="radio" aria-checked={choice === "own"} className={`ob__choice ${choice === "own" ? "on" : ""}`} onClick={() => setChoice("own")}>
          <span className="ob__choiceTitle">On my own</span>
          <span className="ob__choiceSub">You can link to an agency later.</span>
        </button>
        <button
          role="radio"
          aria-checked={choice === "agency"}
          className={`ob__choice ${choice === "agency" ? "on" : ""}`}
          onClick={() => setChoice("agency")}
        >
          <span className="ob__choiceTitle">With an agency</span>
          <span className="ob__choiceSub">Your agency gave you a code.</span>
        </button>
      </div>
      {choice === "agency" &&
        (linked ? (
          <p className="ob__note ok">
            ✓ Linked to {linked.orgName}. They'll see your progress summary, never your individual answers.
          </p>
        ) : (
          <form
            className="ob__code"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(await account.join(code));
              setBusy(false);
            }}
          >
            <label className="rl-field">
              Agency code
              <input
                className="rl-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="RDY-XXXX-XXXX"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              {error && <span className="rl-field__error">▲ {error}</span>}
            </label>
            <button className="rl-btn rl-btn--secondary" type="submit" disabled={busy || code.trim().length < 8}>
              {busy ? "Checking..." : "Join"}
            </button>
          </form>
        ))}
      <Nav>
        <button className="rl-btn rl-btn--primary" disabled={!ready} onClick={onNext}>
          Continue
        </button>
      </Nav>
    </>
  );
}

function DateStep({
  state,
  bank,
  draft,
  setDraft,
  noDate,
  setNoDate,
  onNext,
  onBack,
}: {
  state: LearnerState;
  bank: Bank;
  draft: Settings;
  setDraft: (s: Settings) => void;
  noDate: boolean;
  setNoDate: (v: boolean) => void;
  onNext: () => void;
  onBack?: () => void;
}) {
  const [raw, setRaw] = useState(toInput(draft.examAt));
  const now = Date.now();
  const at = examDateFromInput(raw, now);
  const plan = studyPlan(state, bank, noDate ? {} : { examAt: at ?? undefined }, now);
  const ready = noDate || at !== null;
  return (
    <>
      <h1 id="ob-title" className="t-h3 ob__title">
        When is your exam?
      </h1>
      <p className="ob__lede">Your daily plan is built backward from this date. You can change it anytime.</p>
      <label className="rl-field">
        Exam date
        <input
          className="rl-input ob__date"
          type="date"
          min={toInput(now)}
          value={raw}
          disabled={noDate}
          onChange={(e) => setRaw(e.target.value)}
        />
        {raw && at === null && <span className="rl-field__error">▲ Pick today or a later date.</span>}
      </label>
      <label className="ob__check">
        <input type="checkbox" checked={noDate} onChange={(e) => setNoDate(e.target.checked)} /> I haven't scheduled it yet
      </label>
      {ready && (
        <div className="rl-card ob__plan">
          <p className="rl-overline">Your plan</p>
          <p className="ob__planLine">{planLine(plan)}</p>
          {!noDate && plan.status === "behind" && (
            <p className="rl-muted">That's a heavy pace. A later date, if you can move it, makes each day lighter.</p>
          )}
        </div>
      )}
      <Nav onBack={onBack}>
        <button
          className="rl-btn rl-btn--primary"
          disabled={!ready}
          onClick={() => {
            setDraft(noDate ? { ...draft, examAt: undefined } : { ...draft, examAt: at! });
            onNext();
          }}
        >
          Continue
        </button>
      </Nav>
    </>
  );
}

function StartStep({
  offer,
  onBack,
  onChoose,
}: {
  offer: "baseline" | "too_close";
  onBack?: () => void;
  onChoose: (c: "baseline" | "skip" | "study") => void;
}) {
  if (offer === "too_close")
    return (
      <>
        <h1 id="ob-title" className="t-h3 ob__title">
          Your exam is close
        </h1>
        <p className="ob__lede">We'll skip the placement test and put every minute into learning what's most likely on the exam.</p>
        <Nav onBack={onBack}>
          <button className="rl-btn rl-btn--primary" onClick={() => onChoose("study")}>
            Start studying
          </button>
        </Nav>
      </>
    );
  return (
    <>
      <h1 id="ob-title" className="t-h3 ob__title">
        Find your starting point
      </h1>
      <p className="ob__lede">
        {BASELINE_LENGTH} questions across every section of the exam, about 10 minutes. No answers are shown until the end. Then you'll
        see where you stand, and your sessions start with your weakest section.
      </p>
      <ul className="ob__points">
        <li>Guessing is fine. "I'm guessing" is a real answer here.</li>
        <li>It counts toward your progress, so nothing is wasted.</li>
      </ul>
      <Nav onBack={onBack}>
        <button className="rl-btn rl-btn--primary" onClick={() => onChoose("baseline")}>
          Take the baseline test
        </button>
        <button className="rl-btn rl-btn--secondary" onClick={() => onChoose("skip")}>
          Skip and start studying
        </button>
      </Nav>
    </>
  );
}

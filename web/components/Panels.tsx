"use client";
/** Cards shared by home and the end of a session: pass chance, confidence grid, exam result, agency. */
import { useMemo, useState } from "react";
import type { Bank } from "../../src/engine/bank";
import type { AnswerEvent } from "../../src/engine/types";
import { passChance, type CheckName } from "../../src/session/passchance";
import { calibration } from "../../src/session/daily";
import { newResult, type ExamResult } from "../../src/session/results";
import type { Account } from "../lib/agency";
import { toInput } from "../lib/words";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const CHECK_LABELS: Record<CheckName, string> = {
  coverage: "Every section practiced",
  certainty: "Enough answers to be sure about you",
  selfCheck: "Predictions match your results",
  recency: "Studied in the last week",
};

/** The pass chance, shown only once the model has earned it for this learner. */
export function PassChanceCard({ bank, events, examAt }: { bank: Bank; events: AnswerEvent[]; examAt?: number }) {
  const pc = useMemo(() => passChance(events, bank, Date.now(), examAt), [events, bank, examAt]);
  const onDay = examAt && examAt > Date.now();
  const title = onDay ? "Chance of passing on exam day" : "Chance of passing today";
  if (pc.show) {
    return (
      <div className="chance">
        <div className="chanceTitle">{title}</div>
        <div className="chanceValue">about {pct(pc.chance!)}</div>
        <p className="chanceNote">
          Likely score {pc.scoreRange![0]} to {pc.scoreRange![1]} of {pc.scoredItems}. Passing is {pc.passScore}.
        </p>
        <p className="chanceNote">
          How we know: on your last {pc.check.checked} answers the model expected {pct(pc.check.predicted)} correct and you
          got {pct(pc.check.actual)}.
        </p>
      </div>
    );
  }
  const focus = pc.focus ? bank.blueprint.sections.find((s) => s.code === pc.focus) : null;
  return (
    <div className="chance locked">
      <div className="chanceTitle">{title}</div>
      <div className="chanceValue">Not yet</div>
      <p className="chanceNote">
        {pc.needMore === null
          ? "Your recent results don't match what the model predicted, so it won't guess yet. It adjusts as you keep studying."
          : `About ${pc.needMore} more answers${focus ? `, mostly in ${focus.code}. ${focus.name}` : ""}, and we can give you a number you can trust.`}
      </p>
      <ul className="checks">
        {pc.checks.map((c) => (
          <li key={c.name} className={c.ok ? "ok" : ""}>
            {c.ok ? "✓" : "○"} {CHECK_LABELS[c.name]}
          </li>
        ))}
      </ul>
    </div>
  );
}
export function CalibrationGrid({ events, title }: { events: AnswerEvent[]; title: string }) {
  const c = calibration(events);
  const cells = [
    { k: "Sure and right", v: c.sureRight, note: "Solid", cls: "solid" },
    { k: "Sure and wrong", v: c.sureWrong, note: "Danger zone: you think you know it", cls: "danger" },
    { k: "Guessing and right", v: c.guessRight, note: "Lucky: needs review", cls: "lucky" },
    { k: "Guessing and wrong", v: c.guessWrong, note: "Still learning", cls: "learning" },
  ];
  if (c.sureRight + c.sureWrong + c.guessRight + c.guessWrong === 0) return null;
  return (
    <div className="calib">
      <div className="calibTitle">{title}</div>
      <div className="grid">
        {cells.map((x) => (
          <div key={x.k} className={`cell ${x.cls}`}>
            <div className="cellValue">{x.v}</div>
            <div className="cellLabel">{x.k}</div>
            <div className="cellNote">{x.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
export function ResultBanner({ r, hasDate }: { r: ExamResult; hasDate: boolean }) {
  const day = new Date(r.takenAt).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return (
    <div className={`resultBanner ${r.passed ? "passed" : "failed"}`}>
      {r.passed
        ? `You passed the NJ Life exam on ${day}${r.score !== undefined ? ` with ${r.score}` : ""}. Congratulations.`
        : `Not this time (${day}${r.score !== undefined ? `, ${r.score}` : ""}). Your progress carries over.${hasDate ? "" : " Set your retake date below to get a new plan."}`}
    </div>
  );
}

/** Pass or fail, optional score; the date only when reporting by hand. */
export function ResultForm({
  title,
  takenAt,
  onSave,
  onLater,
}: {
  title: string;
  takenAt?: number;
  onSave: (r: ExamResult) => void;
  onLater: () => void;
}) {
  const [passed, setPassed] = useState<boolean | null>(null);
  const [score, setScore] = useState("");
  const [date, setDate] = useState(toInput(takenAt ?? Date.now()));
  const n = score.trim() === "" ? undefined : Number(score);
  const scoreOk = n === undefined || (Number.isInteger(n) && n >= 0 && n <= 100);
  const when = () => {
    if (takenAt) return takenAt;
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y!, m! - 1, d!, 9).getTime();
  };
  return (
    <div className="resultForm">
      <div className="chanceTitle">{title}</div>
      <div className="row">
        <button className={passed === true ? "primary" : "secondary"} aria-pressed={passed === true} onClick={() => setPassed(true)}>
          Passed
        </button>
        <button className={passed === false ? "primary" : "secondary"} aria-pressed={passed === false} onClick={() => setPassed(false)}>
          Didn't pass
        </button>
      </div>
      {passed !== null && (
        <>
          {!takenAt && (
            <label className="dateField">
              <span>Exam date</span>
              <input type="date" value={date} max={toInput(Date.now())} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          <label className="dateField">
            <span>Score on your report (optional)</span>
            <input inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value)} placeholder="e.g. 78" />
          </label>
          {!scoreOk && <p className="error">Enter a whole number from 0 to 100, or leave it blank.</p>}
        </>
      )}
      <div className="row">
        {passed !== null && (
          <button className="primary" disabled={!scoreOk || (!takenAt && !date)} onClick={() => onSave(newResult(when(), passed, n, Date.now()))}>
            Save result
          </button>
        )}
        <button className="link" onClick={onLater}>
          {takenAt ? "Ask me later" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
export function AgencyBox({ account }: { account: Account }) {
  const linked = account.memberships.find((m) => m.role === "learner");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (linked) {
    return (
      <div className="mockBox">
        <div className="chanceTitle">Agency</div>
        <p className="chanceNote">
          Linked to {linked.orgName}. They can see your progress summary (exam date, pace, pass chance, mock scores), not your
          individual answers.
        </p>
        {error && <p className="error">{error}</p>}
        <button
          className="link"
          onClick={async () => {
            if (!confirm(`Leave ${linked.orgName}? Your progress stays with you.`)) return;
            setError(await account.leave(linked.orgId));
          }}
        >
          Leave agency
        </button>
      </div>
    );
  }
  return (
    <form
      className="mockBox"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(await account.join(code));
        setBusy(false);
      }}
    >
      <div className="chanceTitle">Studying with an agency?</div>
      <label className="dateField">
        <span>Agency code</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="RDY-XXXX-XXXX" autoCapitalize="characters" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="secondary" type="submit" disabled={busy || code.trim().length < 8}>
        {busy ? "Joining..." : "Join"}
      </button>
    </form>
  );
}

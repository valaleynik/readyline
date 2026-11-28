"use client";
/**
 * Home: a briefing, not a dashboard. One dominant action (today), then calm context:
 * the study grid, the exam, readiness, the mock exam. Detail stays folded until asked for.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bank } from "../../src/engine/bank";
import type { AnswerEvent, LearnerState } from "../../src/engine/types";
import type { ExportedBank } from "../../src/content/export";
import { activity, today as todayOf, type DayCell } from "../../src/session/today";
import { nextDueAt } from "../../src/session/daily";
import { studyPlan } from "../../src/session/plan";
import { baselineStatus, BASELINE_LENGTH } from "../../src/session/baseline";
import { activeMock, mockAdvice, mockDeadline, mockResult, type MockSettings as Settings } from "../../src/session/mock";
import { latestResult, shouldAskResult, skipResultPrompt, type ExamResult } from "../../src/session/results";
import { examDateFromInput } from "../../src/session/onboarding";
import type { Account } from "../lib/agency";
import { paceLine, planLine, toInput } from "../lib/words";
import { whenLabel } from "./Session";
import { AgencyBox, CalibrationGrid, PassChanceCard, ResultBanner, ResultForm } from "./Panels";

const fmtDay = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t).toLocaleDateString(undefined, o);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function Home({
  data,
  state,
  bank,
  events,
  settings,
  results,
  account,
  onSettings,
  onStart,
  onBaseline,
  onReport,
  onMock,
  onOpenMock,
}: {
  data: ExportedBank;
  state: LearnerState;
  bank: Bank;
  events: AnswerEvent[];
  settings: Settings;
  results: ExamResult[];
  account?: Account;
  onSettings: (s: Settings) => void;
  onStart: () => void;
  onBaseline: () => void;
  onReport: (r: ExamResult) => void;
  onMock: () => void;
  onOpenMock: (id: string) => void;
}) {
  const now = Date.now();
  const t = useMemo(() => todayOf(state, bank, events, settings, now, "local-learner"), [state, bank, events, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const ask = shouldAskResult(settings, results, now);
  const last = latestResult(results);
  const bStatus = baselineStatus(state, bank, events, settings, now);
  const hour = new Date(now).getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const [manual, setManual] = useState(false);

  return (
    <div className="hm">
      {ask && (
        <ResultForm title="How did the exam go?" takenAt={settings.examAt!} onSave={onReport} onLater={() => onSettings(skipResultPrompt(settings, now))} />
      )}
      {!ask && last && <ResultBanner r={last} hasDate={!!settings.examAt} />}

      <p className="rl-overline">{fmtDay(now, { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1 className="t-h3 hm__hello">{greet}</h1>

      <TodayCard
        t={t}
        baseline={bStatus}
        nextDue={nextDueAt(state, bank)}
        onStart={onStart}
        onBaseline={onBaseline}
        onSkipBaseline={() => onSettings({ ...settings, baselineSkipped: true })}
      />

      <StudyGrid events={events} examAt={settings.examAt} />

      <div className="hm__row">
        <ExamCard state={state} bank={bank} settings={settings} onSettings={onSettings} />
        <ReadinessCard data={data} state={state} bank={bank} events={events} examAt={settings.examAt} />
        <MockCard state={state} bank={bank} data={data} events={events} settings={settings} onMock={onMock} onOpenMock={onOpenMock} />
      </div>

      {state.answers > 0 && (
        <details className="hm__more">
          <summary>How well your confidence matches your answers</summary>
          <CalibrationGrid events={events} title="All sessions" />
        </details>
      )}
      {account && <AgencyBox account={account} />}
      {!ask &&
        (manual ? (
          <ResultForm title="Report your exam result" onSave={(r) => (onReport(r), setManual(false))} onLater={() => setManual(false)} />
        ) : (
          <button className="link hm__took" onClick={() => setManual(true)}>
            I took the exam
          </button>
        ))}
    </div>
  );
}

function TodayCard({
  t,
  baseline,
  nextDue,
  onStart,
  onBaseline,
  onSkipBaseline,
}: {
  t: ReturnType<typeof todayOf>;
  baseline: ReturnType<typeof baselineStatus>;
  nextDue: number | null;
  onStart: () => void;
  onBaseline: () => void;
  onSkipBaseline: () => void;
}) {
  if (baseline === "needed")
    return (
      <section className="hm-today" aria-labelledby="hm-today">
        <p className="rl-overline">Today</p>
        <h2 id="hm-today" className="hm-today__title">
          Find your starting point
        </h2>
        <p className="hm-today__sub">{BASELINE_LENGTH} questions, about 10 minutes. Your sessions then start with your weakest section.</p>
        <div className="hm-today__btns">
          <button className="rl-btn rl-btn--primary hm-today__go" onClick={onBaseline} autoFocus>
            Take the baseline test
          </button>
          <button className="rl-btn rl-btn--secondary" onClick={onSkipBaseline}>
            Skip it
          </button>
        </div>
      </section>
    );
  if (baseline === "in_progress")
    return (
      <section className="hm-today" aria-labelledby="hm-today">
        <p className="rl-overline">Today</p>
        <h2 id="hm-today" className="hm-today__title">
          Finish your baseline test
        </h2>
        <p className="hm-today__sub">A few questions left of {BASELINE_LENGTH}. Then your sessions start with your weakest section.</p>
        <button className="rl-btn rl-btn--primary hm-today__go" onClick={onBaseline} autoFocus>
          Finish the baseline test
        </button>
      </section>
    );
  if (t.done)
    return (
      <section className="hm-today hm-today--done" aria-labelledby="hm-today">
        <p className="rl-overline">Today ✓</p>
        <h2 id="hm-today" className="hm-today__title">
          Done for today
        </h2>
        <p className="hm-today__sub">
          {t.answeredToday > 0 ? `${plural(t.answeredToday, "question")} answered. ` : ""}
          {nextDue && nextDue > Date.now() ? `Your next reviews are due ${whenLabel(nextDue, Date.now())}.` : "Come back tomorrow for new material."}
        </p>
      </section>
    );
  const parts = [t.newLeft > 0 ? plural(t.newLeft, "new fact") : null, t.due > 0 ? plural(t.due, "review") : null].filter(Boolean);
  const resuming = t.answeredToday > 0;
  return (
    <section className="hm-today" aria-labelledby="hm-today">
      <p className="rl-overline">{resuming ? "Today · keep going" : "Today"}</p>
      <h2 id="hm-today" className="hm-today__title">
        {parts.length ? parts.join(" and ") : "A few questions to finish"}
      </h2>
      <p className="hm-today__sub">
        About {plural(t.minutes, "minute")}. {resuming ? `${plural(t.answeredToday, "question")} done already today.` : "Reviews are timed to just before you'd forget."}
      </p>
      <button className="rl-btn rl-btn--primary hm-today__go" onClick={onStart} autoFocus>
        {resuming ? "Continue today's session" : "Start today's session"}
      </button>
    </section>
  );
}

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

export function StudyGrid({ events, examAt }: { events: AnswerEvent[]; examAt?: number }) {
  const a = useMemo(() => activity(events, Date.now(), examAt), [events, examAt]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // phones: show today and what's ahead, not the oldest weeks
    const el = scroller.current;
    const today = el?.querySelector(".sg__cell--today") as HTMLElement | null;
    if (el && today) el.scrollLeft = Math.max(0, today.offsetLeft - el.clientWidth / 2);
  }, [a]);
  const months = a.weeks.map((w, i) => {
    const first = w.find((d) => new Date(d.day).getDate() === 1);
    if (first) return fmtDay(first.day, { month: "short" });
    // label the opening month too, unless the next month starts right after (labels would collide)
    const soon = a.weeks.slice(1, 3).some((x) => x.some((d) => new Date(d.day).getDate() === 1));
    return i === 0 && !soon ? fmtDay(w[0]!.day, { month: "short" }) : "";
  });
  const label = (d: DayCell) =>
    `${fmtDay(d.day, { weekday: "short", month: "short", day: "numeric" })}: ${
      d.isExam ? "exam day" : d.future ? "ahead" : d.count ? plural(d.count, "answer") : "no study"
    }`;
  return (
    <section className="rl-card sg" aria-labelledby="sg-title">
      <div className="sg__head">
        <div>
          <p className="rl-overline" id="sg-title">
            Your study
          </p>
          <p className="sg__stats">
            {a.daysStudied === 0 ? (
              "Each day you study fills in a square."
            ) : (
              <>
                <strong>{plural(a.daysStudied, "day")}</strong> studied
              </>
            )}
            {a.currentRun > 1 && (
              <>
                {" "}
                · <strong>{a.currentRun} days</strong> in a row
              </>
            )}
          </p>
        </div>
        {a.longestRun > 1 && <p className="sg__best">Best run: {plural(a.longestRun, "day")}</p>}
      </div>
      <div className="sg__scroll" ref={scroller}>
        <div className="sg__grid" style={{ gridTemplateColumns: `32px repeat(${a.weeks.length}, var(--sg-col))` }}>
          <span />
          {months.map((m, i) => (
            <span key={`m${i}`} className="sg__month">
              {m}
            </span>
          ))}
          {DAY_LABELS.map((dl, row) => (
            <Row key={row} dl={dl} cells={a.weeks.map((w) => w[row]!)} label={label} />
          ))}
        </div>
      </div>
      <div className="sg__legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`sg__cell sg__l${l}`} />
        ))}
        <span>More</span>
        {examAt && (
          <span className="sg__examKey">
            <span className="sg__cell sg__cell--exam" /> Exam day
          </span>
        )}
      </div>
    </section>
  );
}

function Row({ dl, cells, label }: { dl: string; cells: DayCell[]; label: (d: DayCell) => string }) {
  return (
    <>
      <span className="sg__day">{dl}</span>
      {cells.map((d) => (
        <span
          key={d.day}
          title={label(d)}
          aria-label={label(d)}
          className={`sg__cell ${d.isExam ? "sg__cell--exam" : d.future ? "sg__cell--future" : `sg__l${d.level}`} ${d.isToday ? "sg__cell--today" : ""}`}
        />
      ))}
    </>
  );
}

function ExamCard({ state, bank, settings, onSettings }: { state: LearnerState; bank: Bank; settings: Settings; onSettings: (s: Settings) => void }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(toInput(settings.examAt));
  const now = Date.now();
  const plan = studyPlan(state, bank, settings, now);
  const at = examDateFromInput(raw, now);
  return (
    <section className="rl-card hm-card" aria-labelledby="hm-exam">
      <p className="rl-overline" id="hm-exam">
        Your exam
      </p>
      {settings.examAt && plan.status !== "past" ? (
        <>
          <p className="hm-card__big">{fmtDay(settings.examAt, { month: "long", day: "numeric" })}</p>
          <p className="hm-card__sub">
            {plan.daysLeft === 0 ? "Today" : plan.daysLeft === 1 ? "Tomorrow" : `${plan.daysLeft} days away`}
          </p>
          <span className={`rl-badge ${plan.status === "behind" ? "rl-badge--behind" : "rl-badge--ontrack"}`}>
            <span className="rl-badge__icon">{plan.status === "behind" ? "▲" : "●"}</span>
            {plan.status === "behind" ? "Behind" : plan.status === "review_only" || plan.factsRemaining === 0 ? "Review days" : "On track"}
          </span>
          <p className="rl-muted hm-card__note">
            {paceLine(plan)}
          </p>
        </>
      ) : (
        <>
          <p className="hm-card__big">{plan.status === "past" ? "Date passed" : "No date yet"}</p>
          <p className="rl-muted hm-card__note">{planLine(plan)}</p>
        </>
      )}
      {editing ? (
        <div className="hm-card__edit">
          <input className="rl-input" type="date" min={toInput(now)} value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="Exam date" />
          <div className="hm-card__editBtns">
            <button
              className="rl-btn rl-btn--secondary rl-btn--sm"
              disabled={at === null}
              onClick={() => {
                onSettings({ ...settings, examAt: at! });
                setEditing(false);
              }}
            >
              Save
            </button>
            {settings.examAt && (
              <button
                className="rl-btn rl-btn--ghost rl-btn--sm"
                onClick={() => {
                  onSettings({ ...settings, examAt: undefined });
                  setEditing(false);
                }}
              >
                Remove date
              </button>
            )}
            <button className="rl-btn rl-btn--ghost rl-btn--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="link hm-card__link" onClick={() => setEditing(true)}>
          {settings.examAt ? "Change date" : "Set your exam date"}
        </button>
      )}
    </section>
  );
}

function ReadinessCard({
  data,
  state,
  bank,
  events,
  examAt,
}: {
  data: ExportedBank;
  state: LearnerState;
  bank: Bank;
  events: AnswerEvent[];
  examAt?: number;
}) {
  const sections = bank.blueprint.sections.map((sec) => {
    const facts = sec.topics.flatMap((tp) => bank.factsByTopic.get(tp.code) ?? []);
    return { code: sec.code, name: sec.name, total: facts.length, seen: facts.filter((f) => state.facts[f]).length };
  });
  const seen = sections.reduce((x, s) => x + s.seen, 0);
  const total = bank.factTopic.size;
  void data;
  return (
    <section className="rl-card hm-card" aria-labelledby="hm-ready">
      <p className="rl-overline" id="hm-ready">
        Readiness
      </p>
      <PassChanceCard bank={bank} events={events} examAt={examAt} />
      <p className="hm-card__sub hm-card__material">
        {seen} of {total} facts studied
      </p>
      <div className="hm-bar" aria-hidden="true">
        <span style={{ width: `${(seen / total) * 100}%` }} />
      </div>
      <details className="hm-sections">
        <summary>By section</summary>
        <ul>
          {sections.map((s) => (
            <li key={s.code}>
              <span className="hm-sections__name">
                {s.code}. {s.name}
              </span>
              <span className="hm-sections__num">
                {s.seen}/{s.total}
              </span>
              <span className="hm-bar hm-bar--sm" aria-hidden="true">
                <span style={{ width: `${(s.seen / s.total) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function MockCard({
  state,
  bank,
  data,
  events,
  settings,
  onMock,
  onOpenMock,
}: {
  state: LearnerState;
  bank: Bank;
  data: ExportedBank;
  events: AnswerEvent[];
  settings: Settings;
  onMock: () => void;
  onOpenMock: (id: string) => void;
}) {
  const active = activeMock(settings);
  const advice = mockAdvice(state, bank, settings, Date.now());
  const key = useMemo(() => new Map(data.items.map((i) => [i.key, i.answer])), [data]);
  const past = useMemo(
    () =>
      (settings.mocks ?? [])
        .filter((m) => m.submittedAt)
        .slice(-3)
        .map((m) => ({ m, r: mockResult(bank, events, m, (k) => key.get(k)!) })),
    [settings.mocks, bank, events, key],
  );
  return (
    <section className="rl-card hm-card" aria-labelledby="hm-mock">
      <p className="rl-overline" id="hm-mock">
        Mock exam
      </p>
      {active ? (
        <>
          <p className="hm-card__big">In progress</p>
          <p className="rl-muted hm-card__note">
            {Object.keys(active.answers).length} of {bank.blueprint.scoredItems} answered,{" "}
            {Math.max(0, Math.ceil((mockDeadline(bank, active) - Date.now()) / 60_000))} minutes left. The clock keeps running.
          </p>
          <button className="rl-btn rl-btn--primary rl-btn--sm" onClick={onMock}>
            Resume mock exam
          </button>
        </>
      ) : (
        <>
          <p className="hm-card__big">{advice ? "Recommended now" : `${bank.blueprint.scoredItems} questions`}</p>
          <p className="rl-muted hm-card__note">
            {advice === "final"
              ? "A full rehearsal a few days before the real thing."
              : advice === "first"
                ? "You've studied enough for a full practice exam to mean something."
                : `${bank.blueprint.timeMinutes / 60} hours, no feedback until you submit. Same mix as the real exam.`}
          </p>
          <button className={`rl-btn ${advice ? "rl-btn--primary" : "rl-btn--secondary"} rl-btn--sm`} onClick={onMock}>
            Take a mock exam
          </button>
        </>
      )}
      {past.length > 0 && (
        <ul className="hm-mocks">
          {past.map(({ m, r }) => (
            <li key={m.id}>
              <button className="link" onClick={() => onOpenMock(m.id)}>
                {fmtDay(m.startedAt, { month: "short", day: "numeric" })}
              </button>
              <span className="hm-mocks__score">
                {r.correct}/{r.total}
              </span>
              <span className={`rl-badge ${r.passed ? "rl-badge--ontrack" : "rl-badge--behind"}`}>{r.passed ? "Pass" : "Below pass"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

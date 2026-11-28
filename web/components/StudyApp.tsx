"use client";
/**
 * The study loop. One component, no framework-specific APIs, so the same code runs
 * in the Next.js app and in the single-file preview build.
 *
 * Data flow: the event log is the only state that is stored. Learner state is
 * always rebuilt from it with the engine's replay(), so every view reads the
 * same truth.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bank, replay, type AnswerEvent, type LearnerState } from "../../src/engine";
import { calibration, dueFacts, progress, sessionPick, type SessionStart, remainingEstimate, nextDueAt, startOfDay } from "../../src/session/daily";
import { studyPlan, type StudyPlan } from "../../src/session/plan";
import { passChance, type CheckName } from "../../src/session/passchance";
import { BASELINE_LENGTH, baselinePick, baselineResult, baselineStatus } from "../../src/session/baseline";
import {
  latestResult,
  newResult,
  settingsAfterResult,
  shouldAskResult,
  skipResultPrompt,
  type ExamResult,
} from "../../src/session/results";
import {
  activeMock,
  mockAdvice,
  mockDeadline,
  mockItems,
  mockResult,
  startMock,
  submitMock,
  updateMock,
  type MockRecord,
  type MockSettings as StudySettings,
} from "../../src/session/mock";
import type { ExportedBank, DisplayItem } from "../../src/content/export";
import type { Account } from "../lib/agency";
import { SiteHeader } from "./brand";
import { planLine, toInput } from "../lib/words";
import Onboarding from "./Onboarding";
import Home from "./Home";
import { AgencyBox, CalibrationGrid, PassChanceCard, ResultBanner, ResultForm } from "./Panels";
import { FeedbackCard, QuestionCard, REASON_LABEL as REASONS, SessionBar, SessionDone } from "./Session";
import { needsOnboarding } from "../../src/session/onboarding";
import type { ReactNode } from "react";

export interface EventStore {
  load(): AnswerEvent[];
  save(events: AnswerEvent[]): void;
  loadSettings?(): StudySettings;
  saveSettings?(s: StudySettings): void;
  /** for stores that sync: refresh from the server and report changes */
  subscribe?(onChange: (events: AnswerEvent[], settings: StudySettings, results: ExamResult[]) => void): () => void;
  loadResults?(): ExamResult[];
  /** for stores that sync: resolves once the first pull from the server is done (or gave up) */
  whenReady?(): Promise<void>;
  addResult?(r: ExamResult): void;
}

const KEY = "readyline.events.v1";
export const localStore: EventStore = {
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      return raw ? (JSON.parse(raw) as AnswerEvent[]) : [];
    } catch {
      return [];
    }
  },
  save(events) {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(events));
    } catch {
      /* storage unavailable: the session still works in memory */
    }
  },
  loadSettings() {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      return raw ? (JSON.parse(raw) as StudySettings) : {};
    } catch {
      return {};
    }
  },
  saveSettings(st) {
    try {
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(st));
    } catch {
      /* in memory only */
    }
  },
};
const SETTINGS_KEY = "readyline.settings.v1";
const RESULTS_KEY = "readyline.results.v1";
localStore.loadResults = () => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(RESULTS_KEY) ?? "[]") as ExamResult[];
  } catch {
    return [];
  }
};
localStore.addResult = (r) => {
  try {
    globalThis.localStorage?.setItem(RESULTS_KEY, JSON.stringify([...localStore.loadResults!(), r]));
  } catch {
    /* in memory only */
  }
};

const SEED = "local-learner";
const pct = (x: number) => `${Math.round(x * 100)}%`;

type View =
  | { kind: "home" }
  | { kind: "question"; item: DisplayItem; reason: string; choice: number | null }
  | { kind: "feedback"; item: DisplayItem; choice: number; correct: boolean; confidence: "sure" | "guess" }
  | { kind: "done" }
  | { kind: "baseline"; item: DisplayItem; choice: number | null; n: number }
  | { kind: "baselineDone" }
  | { kind: "mock"; id: string; index: number; review: boolean }
  | { kind: "mockDone"; id: string };


export default function StudyApp({
  data,
  store = localStore,
  account,
  headerExtra,
}: {
  data: ExportedBank;
  store?: EventStore;
  account?: Account;
  /** account links from the sign-in layer, shown in the shared header */
  headerExtra?: ReactNode;
}) {
  const bank = useMemo(() => new Bank(data.blueprint, data.items), [data]);
  const display = useMemo(() => new Map(data.items.map((i) => [i.key, i])), [data]);
  // Load after mount so server-rendered and first client render match.
  const [events, setEvents] = useState<AnswerEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const state: LearnerState = useMemo(() => replay(events, bank), [events, bank]);
  const [settings, setSettings] = useState<StudySettings>({});
  const [results, setResults] = useState<ExamResult[]>([]);
  /** false until a synced store has finished its first pull, so onboarding never flashes for returning learners */
  const [ready, setReady] = useState(!store.whenReady);
  const [session, setSession] = useState<SessionStart | null>(null);
  /** today's quota is fixed when the session starts, so it cannot shift mid-session */
  const [quota, setQuota] = useState(0);
  const [view, setView] = useState<View>({ kind: "home" });
  const nextBtn = useRef<HTMLButtonElement>(null);
  /** the session bar never moves backward, even when a miss adds a relearn */
  const barMax = useRef(0);

  useEffect(() => {
    setEvents(store.load());
    setSettings(store.loadSettings?.() ?? {});
    setResults(store.loadResults?.() ?? []);
    setLoaded(true);
    void store.whenReady?.().then(() => setReady(true));
    return store.subscribe?.((evs, st, rs) => {
      setEvents(evs);
      setSettings(st);
      setResults(rs);
    });
  }, [store]);
  useEffect(() => {
    if (loaded) store.save(events);
  }, [events, loaded, store]);
  useEffect(() => {
    if (loaded) store.saveSettings?.(settings);
  }, [settings, loaded, store]);

  const answerKey = (k: string) => display.get(k)!.answer;
  const viewMock = view.kind === "mock" || view.kind === "mockDone" ? (settings.mocks ?? []).find((m) => m.id === view.id) : undefined;
  const mockForm_ = useMemo(
    () => (viewMock ? mockItems(bank, events, viewMock) : []),
    // the form depends only on the start time, the seed and answers before the start
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bank, viewMock?.startedAt, viewMock?.seed, events.length],
  );

  function beginMock() {
    const active = activeMock(settings);
    const id = active?.id ?? globalThis.crypto.randomUUID();
    if (!active) setSettings((st) => startMock(st, Date.now(), id));
    setView({ kind: "mock", id, index: 0, review: false });
  }

  // Submitting is one-way; the clock and the button can both fire, so only the first counts.
  const submitted = useRef(new Set<string>());
  function finishMock(id: string) {
    if (submitted.current.has(id)) return;
    submitted.current.add(id);
    const { settings: st, newEvents } = submitMock(bank, events, settings, id, Date.now(), answerKey);
    if (newEvents.length) setEvents([...events, ...newEvents]);
    setSettings(st);
    setView({ kind: "mockDone", id });
  }

  // The clock keeps running when the app is closed: an expired mock is submitted on sight.
  useEffect(() => {
    if (!loaded) return;
    const m = activeMock(settings);
    if (m && Date.now() >= mockDeadline(bank, m)) finishMock(m.id);
  });

  function report(r: ExamResult) {
    store.addResult?.(r);
    setResults((rs) => [...rs, r]);
    setSettings((st) => settingsAfterResult(st, r));
  }

  function nextQuestion(evs: AnswerEvent[], st: LearnerState, s: SessionStart, q: number) {
    const pick = sessionPick(st, bank, evs, s, Date.now(), SEED, q);
    if (!pick) return setView({ kind: "done" });
    setView({ kind: "question", item: display.get(pick.item.key)!, reason: pick.reason, choice: null });
  }

  function start(st: StudySettings = settings) {
    const t = Date.now();
    // the new-fact quota counts from the start of the day, so a second sitting doesn't reset it
    const s = { startAnswers: state.answers, startedAt: t, dayStartedAt: startOfDay(t) };
    const q = studyPlan(state, bank, st, t).newPerDay;
    setSession(s);
    setQuota(q);
    barMax.current = 0;
    nextQuestion(events, state, s, q);
  }

  function nextBaseline(evs: AnswerEvent[], st: LearnerState) {
    const pick = baselinePick(st, bank, evs, Date.now(), SEED);
    const n = evs.filter((e) => e.context === "baseline").length;
    if (!pick) return setView({ kind: "baselineDone" });
    setView({ kind: "baseline", item: display.get(pick.item.key)!, choice: null, n: n + 1 });
  }

  function submitBaseline(confidence: "sure" | "guess") {
    if (view.kind !== "baseline" || view.choice === null) return;
    const ev: AnswerEvent = {
      id: (events.at(-1)?.id ?? 0) + 1,
      itemKey: view.item.key,
      correct: view.choice === view.item.answer,
      at: Math.max(Date.now(), (events.at(-1)?.at ?? 0) + 1),
      confidence,
      context: "baseline",
    };
    const evs = [...events, ev];
    setEvents(evs);
    nextBaseline(evs, replay(evs, bank));
  }

  function submit(confidence: "sure" | "guess") {
    if (view.kind !== "question" || view.choice === null) return;
    const correct = view.choice === view.item.answer;
    const ev: AnswerEvent = {
      id: (events.at(-1)?.id ?? 0) + 1,
      itemKey: view.item.key,
      correct,
      at: Math.max(Date.now(), (events.at(-1)?.at ?? 0) + 1),
      confidence,
      context: "session",
    };
    setEvents([...events, ev]);
    setView({ kind: "feedback", item: view.item, choice: view.choice, correct, confidence });
  }

  function next() {
    if (!session) return;
    nextQuestion(events, state, session, quota);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (view.kind === "mock" && !view.review) {
        const m = (settings.mocks ?? []).find((x) => x.id === view.id);
        if (!m) return;
        const form = mockItems(bank, events, m);
        const it = form[view.index]!;
        const n = Number(e.key);
        if (n >= 1 && n <= 4) setSettings((st) => updateMock(st, m.id, (x) => ({ ...x, answers: { ...x.answers, [it.key]: n - 1 } })));
        if ((e.key === "ArrowRight" || e.key === "n") && view.index < form.length - 1) setView({ ...view, index: view.index + 1 });
        if ((e.key === "ArrowLeft" || e.key === "p") && view.index > 0) setView({ ...view, index: view.index - 1 });
      } else if (view.kind === "baseline") {
        const n = Number(e.key);
        if (n >= 1 && n <= 4) setView({ ...view, choice: n - 1 });
        if (view.choice !== null && (e.key === "s" || e.key === "Enter")) submitBaseline("sure");
        if (view.choice !== null && e.key === "g") submitBaseline("guess");
      } else if (view.kind === "question") {
        const n = Number(e.key);
        if (n >= 1 && n <= 4) setView({ ...view, choice: n - 1 });
        if (view.choice !== null && (e.key === "s" || e.key === "Enter")) submit("sure");
        if (view.choice !== null && e.key === "g") submit("guess");
      } else if (view.kind === "feedback" && (e.key === "Enter" || e.key === "n")) next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (view.kind === "feedback") nextBtn.current?.focus();
  }, [view.kind]);

  const now = Date.now();
  const prog = session ? progress(state, bank, events, session, now, SEED, quota) : null;
  const left = prog ? remainingEstimate(prog, quota) : 0;
  if (prog && (view.kind === "question" || view.kind === "feedback")) {
    const f = prog.done ? 1 : prog.answered / (prog.answered + left);
    if (f > barMax.current) barMax.current = f;
  }

  return (
    <div className="app">
      <SiteHeader>{headerExtra}</SiteHeader>
      <main className="main">
        {view.kind === "home" && loaded && !ready && <p className="rl-muted ob">Loading your progress...</p>}
        {view.kind === "home" && loaded && ready && needsOnboarding(settings, events) && (
          <Onboarding
            state={state}
            bank={bank}
            settings={settings}
            account={account}
            onFinish={(st, next) => {
              setSettings(st);
              if (next === "baseline") nextBaseline(events, state);
              else start(st);
            }}
          />
        )}
        {view.kind === "home" && loaded && ready && !needsOnboarding(settings, events) && (
          <Home
            data={data}
            state={state}
            bank={bank}
            events={events}
            settings={settings}
            results={results}
            account={account}
            onSettings={setSettings}
            onStart={() => start()}
            onBaseline={() => nextBaseline(events, state)}
            onReport={report}
            onMock={beginMock}
            onOpenMock={(id) => setView({ kind: "mockDone", id })}
          />
        )}
        {(view.kind === "question" || view.kind === "feedback") && prog && (
          <SessionBar
            fraction={barMax.current}
            label={prog.done || left === 0 ? "Last one" : `About ${left} left`}
            bump={prog.answered}
          />
        )}
        {view.kind === "question" && (
          <QuestionCard
            item={view.item}
            label={REASONS[view.reason] ?? view.reason}
            topic={data.topicNames[view.item.topic] ?? view.item.topic}
            choice={view.choice}
            onChoose={(c) => setView({ ...view, choice: c })}
            onSubmit={submit}
          />
        )}
        {view.kind === "baseline" && (
          <>
            <SessionBar fraction={(view.n - 1) / BASELINE_LENGTH} label={`${view.n} of ${BASELINE_LENGTH}`} bump={view.n - 1} />
            <QuestionCard
              item={view.item}
              label={`Baseline · Question ${view.n} of ${BASELINE_LENGTH}`}
              topic={data.topicNames[view.item.topic] ?? view.item.topic}
              choice={view.choice}
              onChoose={(c) => setView({ ...view, choice: c })}
              onSubmit={submitBaseline}
            />
          </>
        )}
        {view.kind === "mock" && (settings.mocks ?? []).some((m) => m.id === view.id && !m.submittedAt) && (
          <MockView
            bank={bank}
            display={display}
            mock={(settings.mocks ?? []).find((m) => m.id === view.id)!}
            form={mockForm_}
            index={view.index}
            review={view.review}
            onGo={(index, review) => setView({ ...view, index, review })}
            onChange={(f) => setSettings((st) => updateMock(st, view.id, f))}
            onSubmit={() => finishMock(view.id)}
            onLeave={() => setView({ kind: "home" })}
          />
        )}
        {view.kind === "mockDone" && (settings.mocks ?? []).some((m) => m.id === view.id && m.submittedAt) && (
          <MockDone
            bank={bank}
            data={data}
            result={mockResult(bank, events, (settings.mocks ?? []).find((m) => m.id === view.id)!, answerKey)}
            mock={(settings.mocks ?? []).find((m) => m.id === view.id)!}
            onHome={() => setView({ kind: "home" })}
          />
        )}
        {view.kind === "baselineDone" && (
          <BaselineDone state={state} bank={bank} events={events} onStart={() => start()} />
        )}
        {view.kind === "feedback" && (
          <FeedbackCard
            item={view.item}
            fact={data.facts[view.item.factId]}
            contrasts={view.correct ? [] : (data.facts[view.item.factId]?.contrasts ?? []).map((c) => data.facts[c]!).filter(Boolean)}
            choice={view.choice}
            correct={view.correct}
            confidence={view.confidence}
            nextRef={nextBtn}
            onNext={next}
          />
        )}
        {view.kind === "done" && session && (
          <SessionDone
            capped={!!prog && prog.doneReason === "cap"}
            answered={prog?.answered ?? 0}
            correct={prog?.correct ?? 0}
            newFacts={prog?.newIntroduced ?? 0}
            factsSeen={Object.keys(state.facts).filter((f) => bank.factTopic.has(f)).length}
            factsTotal={bank.factTopic.size}
            nextDue={nextDueAt(state, bank)}
            missed={Object.entries(state.facts).filter(([f, m]) => bank.factTopic.has(f) && m.lastCorrect === false).length}
            onHome={() => setView({ kind: "home" })}
          >
            <PassChanceCard bank={bank} events={events} examAt={settings.examAt} />
            <CalibrationGrid events={events.filter((e) => e.at >= session.startedAt)} title="This session: confidence vs. results" />
          </SessionDone>
        )}
      </main>
    </div>
  );
}

function BaselineDone({ state, bank, events, onStart }: { state: LearnerState; bank: Bank; events: AnswerEvent[]; onStart: () => void }) {
  const r = useMemo(() => baselineResult(state, bank, events), [state, bank, events]);
  return (
    <section className="home">
      <h1>Your starting point</h1>
      <p className="lede">
        You got {r.correct} of {r.answered} right. Right now you'd likely score between {pct(r.range[0])} and {pct(r.range[1])} on the
        real exam. Passing takes {pct(bank.passScore / bank.blueprint.scoredItems)}. Your sessions will start with your weakest
        sections.
      </p>
      <table className="sections">
        <thead>
          <tr>
            <th>Section</th>
            <th>Asked</th>
            <th>Estimate</th>
          </tr>
        </thead>
        <tbody>
          {r.sections.map((s) => (
            <tr key={s.code} className={s.code === r.weakest[0] ? "weak" : ""}>
              <td>
                {s.code}. {s.name}
              </td>
              <td className="num">
                {s.correct}/{s.asked}
              </td>
              <td className="num">{pct(s.estimate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="primary" onClick={onStart} autoFocus>
        Start your first session
      </button>
    </section>
  );
}

const clock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

function MockView({
  bank,
  display,
  mock,
  form,
  index,
  review,
  onGo,
  onChange,
  onSubmit,
  onLeave,
}: {
  bank: Bank;
  display: Map<string, DisplayItem>;
  mock: MockRecord;
  form: { key: string }[];
  index: number;
  review: boolean;
  onGo: (index: number, review: boolean) => void;
  onChange: (f: (m: MockRecord) => MockRecord) => void;
  onSubmit: () => void;
  onLeave: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = mockDeadline(bank, mock) - now;
  useEffect(() => {
    if (left <= 0) onSubmit();
  }, [left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const flagged = new Set(mock.flagged ?? []);
  const answered = form.filter((f) => mock.answers[f.key] !== undefined).length;
  const header = (
    <div className="mockBar">
      <span>
        Mock exam · {answered} of {form.length} answered
      </span>
      <span className={`timer ${left < 10 * 60_000 ? "low" : ""}`} aria-label="time left">
        {clock(left)}
      </span>
    </div>
  );
  if (review) {
    const blank = form.length - answered;
    return (
      <section className="card">
        {header}
        <h2 className="stem">Review your answers</h2>
        <div className="mockGrid">
          {form.map((f, i) => (
            <button
              key={f.key}
              className={`cell ${mock.answers[f.key] !== undefined ? "done" : ""} ${flagged.has(f.key) ? "flag" : ""}`}
              onClick={() => onGo(i, false)}
              aria-label={`Question ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <p className="chanceNote">
          {blank ? `${blank} unanswered: they count as wrong, like on the real exam. ` : "Every question answered. "}
          {flagged.size ? `${flagged.size} flagged.` : ""}
        </p>
        <div className="row">
          <button className="primary" onClick={onSubmit}>
            Submit mock exam
          </button>
          <button className="secondary" onClick={() => onGo(index, false)}>
            Back to questions
          </button>
        </div>
      </section>
    );
  }
  const item = display.get(form[index]!.key)!;
  const choice = mock.answers[item.key];
  return (
    <section className="card">
      {header}
      <div className="meta">
        <span className="tag">Question {index + 1}</span>
        <label className="flagToggle">
          <input
            type="checkbox"
            checked={flagged.has(item.key)}
            onChange={(e) =>
              onChange((m) => ({
                ...m,
                flagged: e.target.checked ? [...(m.flagged ?? []), item.key] : (m.flagged ?? []).filter((k) => k !== item.key),
              }))
            }
          />{" "}
          Flag for review
        </label>
      </div>
      <h2 className="stem">{item.stem}</h2>
      <ol className="options">
        {item.options.map((o, i) => (
          <li key={i}>
            <button
              className={`option ${choice === i ? "selected" : ""}`}
              aria-pressed={choice === i}
              onClick={() => onChange((m) => ({ ...m, answers: { ...m.answers, [item.key]: i } }))}
            >
              <span className="letter">{"ABCD"[i]}</span>
              <span>{o}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="submit">
        <button className="secondary" disabled={index === 0} onClick={() => onGo(index - 1, false)}>
          Previous
        </button>
        {index < form.length - 1 ? (
          <button className="primary" onClick={() => onGo(index + 1, false)}>
            Next
          </button>
        ) : (
          <button className="primary" onClick={() => onGo(index, true)}>
            Review and submit
          </button>
        )}
        <button className="link" onClick={() => onGo(index, true)}>
          All questions
        </button>
        <button className="link" onClick={onLeave}>
          Pause (clock keeps running)
        </button>
      </div>
    </section>
  );
}

function MockDone({
  bank,
  data,
  result: r,
  mock,
  onHome,
}: {
  bank: Bank;
  data: ExportedBank;
  result: ReturnType<typeof mockResult>;
  mock: MockRecord;
  onHome: () => void;
}) {
  const byKey = new Map(data.items.map((i) => [i.key, i]));
  const n = bank.blueprint.scoredItems;
  return (
    <section className="home">
      <h1>
        Mock exam: {r.correct} of {r.total}
      </h1>
      <p className="lede">
        {r.passed ? "That's a passing score" : "Below the passing line"} (passing is {r.passScore}). Your true level is likely
        somewhere from {r.range[0]} to {r.range[1]}: one exam's worth of questions has luck in it.
        {Number.isFinite(r.expectedBefore) ? ` Before this mock, the model expected about ${Math.round(r.expectedBefore)}.` : ""}
      </p>
      {r.repeats / r.total > 0.15 && (
        <p className="resultBanner failed">
          {r.repeats} of these questions were ones you had answered before, so this score may run high.
        </p>
      )}
      <p className="chanceNote">
        {r.answered} answered, {r.unanswered.length} left blank, {r.minutes} of {bank.blueprint.timeMinutes} minutes used.
      </p>
      <table className="sections">
        <thead>
          <tr>
            <th>Section</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {r.sections.map((s) => (
            <tr key={s.code} className={s.correct / s.asked < bank.passScore / n ? "weak" : ""}>
              <td>
                {s.code}. {s.name}
              </td>
              <td className="num">
                {s.correct}/{s.asked}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.missed.length + r.unanswered.length > 0 && (
        <>
          <h2 className="reviewTitle">Review: {r.missed.length + r.unanswered.length} to go over</h2>
          <p className="chanceNote">These go into your sessions to relearn.</p>
          <ol className="missed">
            {[...r.missed, ...r.unanswered].map((k) => {
              const it = byKey.get(k)!;
              const fact = data.facts[it.factId];
              const mine = mock.answers[k];
              return (
                <li key={k}>
                  <p className="stem small">{it.stem}</p>
                  <p>
                    {mine === undefined ? "Left blank. " : <>Your answer: {"ABCD"[mine]}. {it.options[mine]}. </>}
                    <strong>
                      Correct: {"ABCD"[it.answer]}. {it.options[it.answer]}
                    </strong>
                  </p>
                  <p className="explain">{it.explanation}</p>
                  {fact && <p className="cite">{fact.citation}</p>}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <button className="primary" onClick={onHome}>
        Back to home
      </button>
    </section>
  );
}

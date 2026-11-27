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
import { Bank, readiness, replay, type AnswerEvent, type LearnerState } from "../../src/engine";
import { calibration, dueFacts, progress, sessionPick, NEW_PER_DAY, type SessionStart } from "../../src/session/daily";
import type { ExportedBank, DisplayItem } from "../../src/content/export";

export interface EventStore {
  load(): AnswerEvent[];
  save(events: AnswerEvent[]): void;
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
};

const SEED = "local-learner";
const pct = (x: number) => `${Math.round(x * 100)}%`;

type View =
  | { kind: "home" }
  | { kind: "question"; item: DisplayItem; reason: string; choice: number | null }
  | { kind: "feedback"; item: DisplayItem; choice: number; correct: boolean; confidence: "sure" | "guess" }
  | { kind: "done" };

const REASON_LABEL: Record<string, string> = {
  new_material: "New",
  relearn: "Missed earlier",
  due_review: "Review",
  diagnostic: "Placement",
  extra_practice: "Extra practice",
};

export default function StudyApp({ data, store = localStore }: { data: ExportedBank; store?: EventStore }) {
  const bank = useMemo(() => new Bank(data.blueprint, data.items), [data]);
  const display = useMemo(() => new Map(data.items.map((i) => [i.key, i])), [data]);
  // Load after mount so server-rendered and first client render match.
  const [events, setEvents] = useState<AnswerEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const state: LearnerState = useMemo(() => replay(events, bank), [events, bank]);
  const [session, setSession] = useState<SessionStart | null>(null);
  const [view, setView] = useState<View>({ kind: "home" });
  const nextBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setEvents(store.load());
    setLoaded(true);
  }, [store]);
  useEffect(() => {
    if (loaded) store.save(events);
  }, [events, loaded, store]);

  function nextQuestion(evs: AnswerEvent[], st: LearnerState, s: SessionStart) {
    const pick = sessionPick(st, bank, evs, s, Date.now(), SEED);
    if (!pick) return setView({ kind: "done" });
    setView({ kind: "question", item: display.get(pick.item.key)!, reason: pick.reason, choice: null });
  }

  function start() {
    const s = { startAnswers: state.answers, startedAt: Date.now() };
    setSession(s);
    nextQuestion(events, state, s);
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
    };
    setEvents([...events, ev]);
    setView({ kind: "feedback", item: view.item, choice: view.choice, correct, confidence });
  }

  function next() {
    if (!session) return;
    nextQuestion(events, state, session);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (view.kind === "question") {
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
  const prog = session ? progress(state, bank, events, session, now, SEED) : null;

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">Readyline</span>
        <span className="exam">NJ Life Producer</span>
        {prog && view.kind !== "home" && (
          <span className="count">
            {prog.answered} answered · {Math.min(prog.newIntroduced, NEW_PER_DAY)}/{NEW_PER_DAY} new · {prog.dueRemaining} due
          </span>
        )}
      </header>
      <main className="main">
        {view.kind === "home" && loaded && <Home state={state} bank={bank} events={events} onStart={start} />}
        {view.kind === "question" && (
          <Question
            item={view.item}
            reason={view.reason}
            topicName={data.topicNames[view.item.topic] ?? view.item.topic}
            choice={view.choice}
            onChoose={(c) => setView({ ...view, choice: c })}
            onSubmit={submit}
          />
        )}
        {view.kind === "feedback" && (
          <Feedback data={data} view={view} nextRef={nextBtn} onNext={next} />
        )}
        {view.kind === "done" && session && (
          <Done state={state} bank={bank} events={events} session={session} onHome={() => setView({ kind: "home" })} />
        )}
      </main>
    </div>
  );
}

function Home({ state, bank, events, onStart }: { state: LearnerState; bank: Bank; events: AnswerEvent[]; onStart: () => void }) {
  const due = dueFacts(state, bank, Date.now()).length;
  const studied = Object.keys(state.facts).filter((f) => bank.factTopic.has(f)).length;
  const totalFacts = bank.factTopic.size;
  const r = useMemo(() => (state.answers ? readiness(state, bank, { draws: 2000 }) : null), [state, bank]);
  return (
    <section className="home">
      <h1>{state.answers ? "Ready for today's session" : "Start studying for the NJ Life exam"}</h1>
      <p className="lede">
        {state.answers
          ? `${due} facts due for review, plus up to ${NEW_PER_DAY} new ones. The session ends when today's list is clear.`
          : `Each session mixes new material with reviews timed to just before you'd forget. About 15 minutes a day.`}
      </p>
      <button className="primary" onClick={onStart} autoFocus>
        {state.answers ? "Start today's session" : "Start first session"}
      </button>
      {state.answers > 0 && (
        <div className="stats">
          <Stat label="Facts studied" value={`${studied} of ${totalFacts}`} />
          {r && <Stat label="Chance of passing today" value={pct(r.pPass)} note={`based on ${state.answers} answers`} />}
          {r && <Stat label="Expected score" value={`${Math.round(r.expectedScore)} / ${r.scoredItems}`} note={`pass is ${r.passScore}`} />}
        </div>
      )}
      {state.answers > 0 && <CalibrationGrid events={events} title="How well your confidence matches your answers" />}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="statValue">{value}</div>
      <div className="statLabel">{label}</div>
      {note && <div className="statNote">{note}</div>}
    </div>
  );
}

function Question({
  item,
  reason,
  topicName,
  choice,
  onChoose,
  onSubmit,
}: {
  item: DisplayItem;
  reason: string;
  topicName: string;
  choice: number | null;
  onChoose: (c: number) => void;
  onSubmit: (c: "sure" | "guess") => void;
}) {
  return (
    <section className="card">
      <div className="meta">
        <span className="tag">{REASON_LABEL[reason] ?? reason}</span>
        <span>{topicName}</span>
      </div>
      <h2 className="stem">{item.stem}</h2>
      <ol className="options">
        {item.options.map((o, i) => (
          <li key={i}>
            <button className={`option ${choice === i ? "selected" : ""}`} onClick={() => onChoose(i)} aria-pressed={choice === i}>
              <span className="letter">{"ABCD"[i]}</span>
              <span>{o}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="submit">
        <span className="hint">How sure are you?</span>
        <button className="primary" disabled={choice === null} onClick={() => onSubmit("sure")}>
          I'm sure
        </button>
        <button className="secondary" disabled={choice === null} onClick={() => onSubmit("guess")}>
          I'm guessing
        </button>
      </div>
    </section>
  );
}

function Feedback({
  data,
  view,
  nextRef,
  onNext,
}: {
  data: ExportedBank;
  view: Extract<View, { kind: "feedback" }>;
  nextRef: React.RefObject<HTMLButtonElement>;
  onNext: () => void;
}) {
  const { item, choice, correct, confidence } = view;
  const fact = data.facts[item.factId];
  const contrasts = !correct ? (fact?.contrasts ?? []).map((c) => data.facts[c]).filter(Boolean) : [];
  const verdict = correct
    ? confidence === "guess"
      ? "Right, but you were guessing. This one will come back soon."
      : "Correct."
    : confidence === "sure"
      ? "Not quite, and you were sure. Worth a careful read."
      : "Not quite.";
  return (
    <section className="card">
      <p className={`verdict ${correct ? "good" : "bad"}`}>{verdict}</p>
      <h2 className="stem small">{item.stem}</h2>
      <ol className="options">
        {item.options.map((o, i) => (
          <li key={i}>
            <div className={`option static ${i === item.answer ? "right" : i === choice ? "wrong" : ""}`}>
              <span className="letter">{"ABCD"[i]}</span>
              <span>{o}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="explain">{item.explanation}</p>
      {fact && (
        <blockquote className="source">
          <span className="cite">{fact.citation}</span>
          <span>“{fact.quote}”</span>
        </blockquote>
      )}
      {contrasts.length > 0 && (
        <div className="contrast">
          <div className="contrastTitle">Easy to confuse with</div>
          <div className="pair">
            <div>
              <div className="pairLabel">This question</div>
              <p>{fact!.statement}</p>
            </div>
            {contrasts.map((c, i) => (
              <div key={i}>
                <div className="pairLabel">The other rule</div>
                <p>{c!.statement}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      <button ref={nextRef} className="primary" onClick={onNext}>
        Next question
      </button>
    </section>
  );
}

function Done({
  state,
  bank,
  events,
  session,
  onHome,
}: {
  state: LearnerState;
  bank: Bank;
  events: AnswerEvent[];
  session: SessionStart;
  onHome: () => void;
}) {
  const p = progress(state, bank, events, session, Date.now(), SEED);
  const mine = events.filter((e) => e.at >= session.startedAt);
  const r = useMemo(() => readiness(state, bank, { draws: 2000 }), [state, bank]);
  return (
    <section className="home">
      <h1>{p.doneReason === "cap" ? "That's enough for one sitting" : "Today's list is clear"}</h1>
      <p className="lede">
        {p.doneReason === "cap"
          ? "You hit the session limit. Anything left over comes back first next time."
          : "Come back tomorrow: the reviews will be timed to just before you'd forget."}
      </p>
      <div className="stats">
        <Stat label="Answered" value={String(p.answered)} />
        <Stat label="Correct" value={p.answered ? pct(p.correct / p.answered) : "0%"} />
        <Stat label="New facts" value={String(p.newIntroduced)} />
        <Stat label="Chance of passing today" value={pct(r.pPass)} />
      </div>
      <CalibrationGrid events={mine} title="This session: confidence vs. results" />
      <button className="primary" onClick={onHome}>
        Back to home
      </button>
    </section>
  );
}

function CalibrationGrid({ events, title }: { events: AnswerEvent[]; title: string }) {
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

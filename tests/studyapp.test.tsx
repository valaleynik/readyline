// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);
import StudyApp, { type EventStore } from "../web/components/StudyApp";
import bankJson from "../web/data/bank.json";
import type { ExportedBank } from "../src/content/export";
import type { AnswerEvent } from "../src/engine";

const data = bankJson as unknown as ExportedBank;

function memStore(): EventStore & { events: AnswerEvent[] } {
  // an existing learner who already finished onboarding (onboarding has its own tests)
  const s = { events: [] as AnswerEvent[], load: () => s.events, save: (e: AnswerEvent[]) => { s.events = e; }, loadSettings: () => ({ onboardedAt: 1 }), saveSettings: () => {} };
  return s;
}

describe("study loop UI", () => {
  it("runs a full first session: answer, feedback, next, until the day is cleared", async () => {
    const store = memStore();
    render(<StudyApp data={data} store={store} />);
    fireEvent.click(await screen.findByText("Skip it"));
    fireEvent.click(await screen.findByText("Start today's session"));
    let answered = 0;
    for (let i = 0; i < 80; i++) {
      if (screen.queryByText("Today's list is clear") || screen.queryByText("That's enough for one sitting")) break;
      const opts = screen.getAllByRole("button", { pressed: false }).filter((b) => b.classList.contains("rl-option"));
      fireEvent.click(opts[i % 4]!);
      fireEvent.click(screen.getByText(i % 3 ? "I'm sure" : "I'm guessing"));
      expect(document.querySelector(".ss-verdict")).not.toBeNull();
      expect(document.querySelector(".ss-law")).not.toBeNull();
      answered++;
      await act(async () => { fireEvent.click(screen.getByText("Next question")); });
    }
    expect(screen.queryByText("Today's list is clear") ?? screen.queryByText("That's enough for one sitting")).not.toBeNull();
    expect(answered).toBeGreaterThanOrEqual(12);
    expect(store.events.length).toBe(answered);
    expect(store.events.every((e: AnswerEvent) => e.confidence === "sure" || e.confidence === "guess")).toBe(true);
    expect(store.events.every((e: AnswerEvent) => e.context === "session")).toBe(true);
    expect(screen.getByText("This session: confidence vs. results")).not.toBeNull();
    // one session is not enough evidence: the pass chance stays locked
    expect(screen.getByText("Not yet")).not.toBeNull();
    expect(screen.queryByText(/^about \d+%$/)).toBeNull();
  });

  it("setting an exam date on home changes the plan", async () => {
    render(<StudyApp data={data} store={memStore()} />);
    expect(await screen.findByText(/No exam date set/)).not.toBeNull();
    fireEvent.click(screen.getByText("Set your exam date"));
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    const d = new Date(Date.now() + 30 * 86_400_000);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    fireEvent.change(input, { target: { value: v } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText(/Your pace: \d+ new facts a day\./)).not.toBeNull();
    expect(screen.getByText("30 days away")).not.toBeNull();
  });

  it("submit stays disabled until an option is chosen", async () => {
    render(<StudyApp data={data} store={memStore()} />);
    fireEvent.click(await screen.findByText("Skip it"));
    fireEvent.click(await screen.findByText("Start today's session"));
    expect((screen.getByText("I'm sure") as HTMLButtonElement).disabled).toBe(true);
  });

  it("baseline: 20 questions with no feedback, then a section breakdown, then studying", async () => {
    const store = memStore();
    render(<StudyApp data={data} store={store} />);
    fireEvent.click(await screen.findByText(/Take the baseline test/));
    for (let i = 0; i < 20; i++) {
      expect(screen.getByText(new RegExp(`Question ${i + 1} of 20`))).not.toBeNull();
      const opts = screen.getAllByRole("button").filter((b) => b.classList.contains("rl-option"));
      fireEvent.click(opts[i % 4]!);
      await act(async () => { fireEvent.click(screen.getByText("I'm sure")); });
      expect(document.querySelector(".ss-verdict")).toBeNull();
    }
    expect(screen.getByText("Your starting point")).not.toBeNull();
    expect(document.querySelectorAll(".sections tbody tr").length).toBe(data.blueprint.sections.length);
    expect(store.events.length).toBe(20);
    expect(store.events.every((e: AnswerEvent) => e.context === "baseline")).toBe(true);
    fireEvent.click(screen.getByText("Start your first session"));
    expect(document.querySelector(".rl-option")).not.toBeNull();
  });
});

describe("study loop UI with a synced store", () => {
  it("uploads answers and settles without a save loop", async () => {
    const { memoryRemote } = await import("../src/sync/remote");
    const { SyncedStore } = await import("../src/sync/store");
    const remote = memoryRemote();
    const m = new Map<string, string>();
    const s = new SyncedStore(remote, { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }, "u");
    s.saveSettings({ onboardedAt: 1 });
    let calls = 0;
    const origFetch = remote.fetchEvents;
    remote.fetchEvents = async () => (calls++, origFetch());
    const store: EventStore = {
      load: () => s.load(),
      save: (e) => s.save(e),
      loadSettings: () => s.loadSettings(),
      saveSettings: (st) => s.saveSettings(st),
      subscribe(fn) {
        s.onChange = fn;
        void s.sync();
        return () => (s.onChange = undefined);
      },
    };
    render(<StudyApp data={data} store={store} />);
    fireEvent.click(await screen.findByText("Skip it"));
    fireEvent.click(await screen.findByText("Start today's session"));
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.classList.contains("rl-option"))[0]!);
    await act(async () => { fireEvent.click(screen.getByText("I'm sure")); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(remote.rows.length).toBe(1);
    expect(remote.settings?.baselineSkipped).toBe(true);
    expect(calls).toBeLessThanOrEqual(2);
  });
});

describe("exam result UI", () => {
  const withSettings = (st: object) => {
    const s = memoryStore();
    return Object.assign(s, { loadSettings: () => ({ onboardedAt: 1, ...st }), saveSettings: () => {} });
  };
  function memoryStore() {
    const results: import("../src/session/results").ExamResult[] = [];
    return {
      events: [] as AnswerEvent[],
      results,
      load() { return this.events; },
      save(e: AnswerEvent[]) { this.events = e; },
      loadResults: () => results,
      addResult: (r: import("../src/session/results").ExamResult) => void results.push(r),
    };
  }

  it("asks after exam day and records a pass with a score", async () => {
    const store = withSettings({ examAt: Date.now() - 2 * 86_400_000, baselineSkipped: true });
    render(<StudyApp data={data} store={store as unknown as EventStore} />);
    fireEvent.click(await screen.findByText("Passed"));
    fireEvent.change(screen.getByPlaceholderText("e.g. 78"), { target: { value: "81" } });
    fireEvent.click(screen.getByText("Save result"));
    expect(await screen.findByText(/You passed the NJ Life exam/)).not.toBeNull();
    expect(store.results.map((r) => [r.passed, r.score])).toEqual([[true, 81]]);
    expect(screen.queryByText("How did the exam go?")).toBeNull();
  });

  it("'I took the exam' works without a date, and rejects a bad score", async () => {
    const store = withSettings({ baselineSkipped: true });
    render(<StudyApp data={data} store={store as unknown as EventStore} />);
    expect(screen.queryByText("How did the exam go?")).toBeNull();
    fireEvent.click(await screen.findByText("I took the exam"));
    fireEvent.click(screen.getByText("Didn't pass"));
    fireEvent.change(screen.getByPlaceholderText("e.g. 78"), { target: { value: "140" } });
    expect((screen.getByText("Save result") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("e.g. 78"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save result"));
    expect(await screen.findByText(/Not this time/)).not.toBeNull();
    expect(store.results[0]!.passed).toBe(false);
  });
});

describe("mock exam UI", () => {
  it("start, answer, pause and resume, review, submit, see the breakdown", async () => {
    const store = memStore();
    let saved: object = { baselineSkipped: true, onboardedAt: 1 };
    const s = Object.assign(store, { loadSettings: () => saved, saveSettings: (x: object) => void (saved = x) });
    render(<StudyApp data={data} store={s as unknown as EventStore} />);
    fireEvent.click(await screen.findByText("Take a mock exam"));
    expect(screen.getByText(/0 of 83 answered/)).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getAllByRole("button").filter((b) => b.classList.contains("option"))[0]!);
      fireEvent.click(screen.getByText("Next"));
    }
    expect(screen.getByText(/5 of 83 answered/)).not.toBeNull();
    expect(document.querySelector(".verdict")).toBeNull();
    fireEvent.click(screen.getByText("Pause (clock keeps running)"));
    expect(screen.getByText("In progress")).not.toBeNull();
    expect(screen.getByText(/5 of 83 answered/)).not.toBeNull();
    fireEvent.click(screen.getByText("Resume mock exam"));
    fireEvent.click(screen.getByText("All questions"));
    expect(screen.getByText(/78 unanswered/)).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByText("Submit mock exam")); });
    expect(screen.getByText(/Mock exam: \d+ of 83/)).not.toBeNull();
    expect(document.querySelectorAll(".sections tbody tr").length).toBe(data.blueprint.sections.length);
    expect(store.events.length).toBe(5);
    expect(store.events.every((e: AnswerEvent) => e.context === "mock")).toBe(true);
    fireEvent.click(screen.getByText("Back to home"));
    expect(document.querySelector(".hm-mocks li")?.textContent).toMatch(/\d+\/83/);
  });
});

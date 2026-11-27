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
  const s = { events: [] as AnswerEvent[], load: () => s.events, save: (e: AnswerEvent[]) => { s.events = e; } };
  return s;
}

describe("study loop UI", () => {
  it("runs a full first session: answer, feedback, next, until the day is cleared", async () => {
    const store = memStore();
    render(<StudyApp data={data} store={store} />);
    fireEvent.click(await screen.findByText("Skip it"));
    fireEvent.click(await screen.findByText("Start first session"));
    let answered = 0;
    for (let i = 0; i < 80; i++) {
      if (screen.queryByText("Today's list is clear") || screen.queryByText("That's enough for one sitting")) break;
      const opts = screen.getAllByRole("button", { pressed: false }).filter((b) => b.classList.contains("option"));
      fireEvent.click(opts[i % 4]!);
      fireEvent.click(screen.getByText(i % 3 ? "I'm sure" : "I'm guessing"));
      expect(document.querySelector(".verdict")).not.toBeNull();
      expect(document.querySelector(".source")).not.toBeNull();
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

  it("setting an exam date changes the plan shown on home", async () => {
    render(<StudyApp data={data} store={memStore()} />);
    expect(await screen.findByText(/No exam date set/)).not.toBeNull();
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    const d = new Date(Date.now() + 30 * 86_400_000);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    fireEvent.change(input, { target: { value: v } });
    expect(await screen.findByText(/Exam in 30 days\. On track at \d+ new facts a day\./)).not.toBeNull();
  });

  it("submit stays disabled until an option is chosen", async () => {
    render(<StudyApp data={data} store={memStore()} />);
    fireEvent.click(await screen.findByText("Skip it"));
    fireEvent.click(await screen.findByText("Start first session"));
    expect((screen.getByText("I'm sure") as HTMLButtonElement).disabled).toBe(true);
  });

  it("baseline: 20 questions with no feedback, then a section breakdown, then studying", async () => {
    const store = memStore();
    render(<StudyApp data={data} store={store} />);
    fireEvent.click(await screen.findByText(/Take the baseline test/));
    for (let i = 0; i < 20; i++) {
      expect(screen.getByText(new RegExp(`Question ${i + 1} of 20`))).not.toBeNull();
      const opts = screen.getAllByRole("button").filter((b) => b.classList.contains("option"));
      fireEvent.click(opts[i % 4]!);
      await act(async () => { fireEvent.click(screen.getByText("I'm sure")); });
      expect(document.querySelector(".verdict")).toBeNull();
    }
    expect(screen.getByText("Your starting point")).not.toBeNull();
    expect(document.querySelectorAll(".sections tbody tr").length).toBe(data.blueprint.sections.length);
    expect(store.events.length).toBe(20);
    expect(store.events.every((e: AnswerEvent) => e.context === "baseline")).toBe(true);
    fireEvent.click(screen.getByText("Start your first session"));
    expect(document.querySelector(".option")).not.toBeNull();
  });
});

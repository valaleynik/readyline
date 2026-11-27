// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText("This session: confidence vs. results")).not.toBeNull();
  });

  it("submit stays disabled until an option is chosen", async () => {
    render(<StudyApp data={data} store={memStore()} />);
    fireEvent.click(await screen.findByText("Start first session"));
    expect((screen.getByText("I'm sure") as HTMLButtonElement).disabled).toBe(true);
  });
});

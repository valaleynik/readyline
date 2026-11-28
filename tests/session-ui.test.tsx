// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import StudyApp, { type EventStore } from "../web/components/StudyApp";
import { verdictFor, whenLabel } from "../web/components/Session";
import bankJson from "../web/data/bank.json";
import type { ExportedBank } from "../src/content/export";
import type { AnswerEvent } from "../src/engine";

afterEach(cleanup);
const data = bankJson as unknown as ExportedBank;
const store = () => {
  const s = { events: [] as AnswerEvent[], load: () => s.events, save: (e: AnswerEvent[]) => void (s.events = e), loadSettings: () => ({ onboardedAt: 1, baselineSkipped: true }), saveSettings: () => {} };
  return s;
};
const options = () => [...document.querySelectorAll<HTMLButtonElement>("button.rl-option")];
const bar = () => screen.getByRole("progressbar");

describe("study session screens", () => {
  it("bar: starts empty, fills forward, floats a +1 per answer; feedback reads top to bottom", async () => {
    render(<StudyApp data={data} store={store() as unknown as EventStore} />);
    await act(async () => { fireEvent.click(await screen.findByText("Start today's session")); });
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText(/About \d+ left/)).not.toBeNull();
    expect(document.querySelector(".ss-bar__plus")).toBeNull();
    let last = 0;
    for (let i = 0; i < 6; i++) {
      // pick a wrong answer on purpose half the time
      const item = data.items.find((it) => it.stem === screen.getByRole("heading", { level: 2 }).textContent)!;
      const pick = i % 2 ? item.answer : (item.answer + 1) % 4;
      fireEvent.click(options()[pick]!);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: i % 3 ? "I'm sure" : "I'm guessing" })); });
      expect(document.querySelector(".ss-bar__plus")?.textContent).toBe("+1");
      const now = Number(bar().getAttribute("aria-valuenow"));
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
      const text = document.querySelector(".ss")!.textContent!;
      const order = ["The answer", "Why", "The law"].map((t) => text.indexOf(t));
      expect(order.every((x) => x >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      if (pick !== item.answer) expect(screen.getByText(/Your answer:/)).not.toBeNull();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next question" })); });
    }
    expect(last).toBeGreaterThan(0);
  });

  it("end of session: stats, what changed, when to come back", async () => {
    render(<StudyApp data={data} store={store() as unknown as EventStore} />);
    await act(async () => { fireEvent.click(await screen.findByText("Start today's session")); });
    for (let i = 0; i < 80 && !screen.queryByText(/Today's list is clear|enough for one sitting/); i++) {
      fireEvent.click(options()[0]!);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "I'm sure" })); });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next question" })); });
    }
    expect(screen.getByText("Session complete")).not.toBeNull();
    expect(screen.getByText(/of 325 facts studied|facts studied/)).not.toBeNull();
    expect(screen.queryByText(/Next reviews:/) ?? screen.queryByText("Later today")).not.toBeNull();
    expect(screen.queryByText("Next reviews: now")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to home" })).not.toBeNull();
  });

  it("words: verdicts never shame, and times read naturally", () => {
    expect(verdictFor(true, "guess").note).toMatch(/comes back soon/);
    expect(verdictFor(false, "guess").note).toMatch(/Good call/);
    expect(verdictFor(false, "sure").title).toBe("Not quite");
    const now = new Date(2026, 10, 27, 10).getTime();
    expect(whenLabel(now + 60_000, now)).toBe("now");
    expect(whenLabel(new Date(2026, 10, 28, 15).getTime(), now)).toMatch(/^tomorrow, around/);
    expect(whenLabel(new Date(2026, 10, 30, 9).getTime(), now)).toBe("in 3 days");
    expect(whenLabel(new Date(2026, 11, 20, 9).getTime(), now)).toMatch(/^on /);
  });
});

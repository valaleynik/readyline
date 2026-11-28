// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import StudyApp, { type EventStore } from "../web/components/StudyApp";
import bankJson from "../web/data/bank.json";
import type { ExportedBank } from "../src/content/export";
import type { AnswerEvent } from "../src/engine";
import { memoryRemote } from "../src/sync/remote";
import { SyncedStore } from "../src/sync/store";
import { toInput } from "../web/lib/words";

afterEach(cleanup);
const data = bankJson as unknown as ExportedBank;
const D = 86_400_000;

function newLearner() {
  const s = {
    events: [] as AnswerEvent[],
    settings: {} as Record<string, unknown>,
    load: () => s.events,
    save: (e: AnswerEvent[]) => void (s.events = e),
    loadSettings: () => s.settings,
    saveSettings: (x: Record<string, unknown>) => void (s.settings = x),
  };
  return s;
}
const setDate = (v: string) => fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: v } });
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("onboarding", () => {
  it("local learner: no date yet, then the baseline", async () => {
    const store = newLearner();
    render(<StudyApp data={data} store={store as unknown as EventStore} />);
    expect(await screen.findByText("When is your exam?")).not.toBeNull();
    expect(screen.getByText("Step 1 of 2")).not.toBeNull();
    expect(btn("Continue").disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I haven't scheduled it yet/));
    expect(screen.getByText(/steady 12 new facts a day/)).not.toBeNull();
    fireEvent.click(btn("Continue"));
    expect(screen.getByText("Find your starting point")).not.toBeNull();
    fireEvent.click(btn("Back"));
    expect(screen.getByText("When is your exam?")).not.toBeNull();
    fireEvent.click(btn("Continue"));
    await act(async () => { fireEvent.click(btn("Take the baseline test")); });
    expect(screen.getByText(/Question 1 of 20/)).not.toBeNull();
    expect(store.settings.onboardedAt).toBeGreaterThan(0);
    expect(store.settings.examAt).toBeUndefined();
  });

  it("a date picks the plan; an exam days away skips the baseline and starts studying", async () => {
    const store = newLearner();
    render(<StudyApp data={data} store={store as unknown as EventStore} />);
    await screen.findByText("When is your exam?");
    setDate(toInput(Date.now() - 3 * D));
    expect(screen.getByText(/Pick today or a later date/)).not.toBeNull();
    setDate(toInput(Date.now() + 3 * D));
    expect(screen.getByText(/Exam in 3 days/)).not.toBeNull();
    fireEvent.click(btn("Continue"));
    expect(screen.getByText("Your exam is close")).not.toBeNull();
    await act(async () => { fireEvent.click(btn("Start studying")); });
    expect(document.querySelector(".option")).not.toBeNull();
    expect(store.settings.examAt).toBeGreaterThan(Date.now());
    expect(store.settings.onboardedAt).toBeGreaterThan(0);
  });

  it("with an account: choose agency, a bad code is refused, a good one links", async () => {
    const memberships: { orgId: string; orgName: string; role: "learner" | "manager" }[] = [];
    const account = {
      memberships,
      join: async (code: string) => {
        if (code !== "RDY-AAAA-BBBB") return "That code is not valid.";
        memberships.push({ orgId: "o", orgName: "Acme Insurance", role: "learner" });
        return null;
      },
      leave: async () => null,
    };
    const store = newLearner();
    const r = render(<StudyApp data={data} store={store as unknown as EventStore} account={account} />);
    expect(await screen.findByText("How are you studying?")).not.toBeNull();
    expect(screen.getByText("Step 1 of 3")).not.toBeNull();
    expect(btn("Continue").disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /With an agency/ }));
    const input = screen.getByPlaceholderText("RDY-XXXX-XXXX");
    fireEvent.change(input, { target: { value: "rdy-zzzz-zzzz" } });
    expect((input as HTMLInputElement).value).toBe("RDY-ZZZZ-ZZZZ");
    await act(async () => { fireEvent.click(btn("Join")); });
    expect(screen.getByText(/That code is not valid/)).not.toBeNull();
    fireEvent.change(input, { target: { value: "RDY-AAAA-BBBB" } });
    await act(async () => { fireEvent.click(btn("Join")); });
    r.rerender(<StudyApp data={data} store={store as unknown as EventStore} account={{ ...account, memberships: [...memberships] }} />);
    expect(screen.getByText(/Linked to Acme Insurance/)).not.toBeNull();
    expect(btn("Continue").disabled).toBe(false);
    fireEvent.click(btn("Continue"));
    expect(screen.getByText("When is your exam?")).not.toBeNull();
  });

  it("a returning learner on a new device never sees onboarding", async () => {
    const remote = memoryRemote();
    remote.rows.push({ id: 1, itemKey: data.items[0]!.key, correct: true, at: Date.now() - D, context: "session" });
    const m = new Map<string, string>();
    const s = new SyncedStore(remote, { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }, "u");
    const first = s.sync();
    const store: EventStore = {
      load: () => s.load(),
      save: (e) => s.save(e),
      loadSettings: () => s.loadSettings(),
      saveSettings: (x) => s.saveSettings(x),
      whenReady: () => first,
      subscribe(fn) {
        s.onChange = fn;
        void first.then(() => fn(s.load(), s.loadSettings(), s.loadResults()));
        return () => (s.onChange = undefined);
      },
    };
    const seen: string[] = [];
    const r = render(<StudyApp data={data} store={store} />);
    seen.push(r.container.textContent ?? "");
    await act(async () => { await first; await new Promise((x) => setTimeout(x, 20)); });
    seen.push(r.container.textContent ?? "");
    expect(seen.join(" ")).not.toContain("When is your exam?");
    expect(screen.getByText(/Ready for today's session/)).not.toBeNull();
  });
});

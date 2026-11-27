import { describe, expect, it } from "vitest";
import { loadLiveBank } from "../src/content/bank";
import {
  MAX_PROMPT_SKIPS,
  latestResult,
  newResult,
  predictionBefore,
  resultFor,
  settingsAfterResult,
  shouldAskResult,
  skipResultPrompt,
} from "../src/session/results";
import { memoryRemote } from "../src/sync/remote";
import { SyncedStore } from "../src/sync/store";

const H = 3_600_000;
const D = 24 * H;
const exam = new Date(2026, 11, 10, 9).getTime();

describe("exam results", () => {
  it("asks from the evening of exam day, not before", () => {
    const s = { examAt: exam };
    expect(shouldAskResult(s, [], exam - D)).toBe(false);
    expect(shouldAskResult(s, [], exam + 3 * H)).toBe(false); // noon on exam day
    expect(shouldAskResult(s, [], exam + 8 * H)).toBe(true); // 5pm
    expect(shouldAskResult(s, [], exam + 5 * D)).toBe(true);
    expect(shouldAskResult({}, [], exam + D)).toBe(false);
  });

  it("'ask me later' hides it for the day and stops after the limit", () => {
    let s = skipResultPrompt({ examAt: exam }, exam + D);
    expect(shouldAskResult(s, [], exam + D + H)).toBe(false);
    expect(shouldAskResult(s, [], exam + 2 * D)).toBe(true);
    for (let i = 1; i < MAX_PROMPT_SKIPS; i++) s = skipResultPrompt(s, exam + (2 + i) * D);
    expect(shouldAskResult(s, [], exam + 10 * D)).toBe(false);
  });

  it("stops asking once reported; a fail clears the date, a pass keeps it", () => {
    const pass = newResult(exam, true, 81, exam + D, "a");
    expect(shouldAskResult({ examAt: exam }, [pass], exam + 2 * D)).toBe(false);
    expect(settingsAfterResult({ examAt: exam, resultPromptSkips: 2 }, pass)).toEqual({ examAt: exam });
    const fail = newResult(exam, false, undefined, exam + D, "b");
    expect(settingsAfterResult({ examAt: exam, baselineSkipped: true }, fail)).toEqual({ examAt: undefined, baselineSkipped: true });
  });

  it("latest report wins, and scores must be 0 to 100", () => {
    const a = newResult(exam, false, 60, exam + D, "a");
    const b = newResult(exam, true, 72, exam + 2 * D, "b");
    expect(resultFor([a, b], exam)!.id).toBe("b");
    expect(latestResult([b, newResult(exam - 30 * D, false, undefined, exam, "c")])!.id).toBe("b");
    expect(() => newResult(exam, true, 101, exam)).toThrow();
    expect(() => newResult(exam, true, 7.5, exam)).toThrow();
  });

  it("rebuilds the prediction from answers given before the exam only", () => {
    const { bank } = loadLiveBank();
    const key = [...bank.items.keys()][0]!;
    const before = { id: 1, itemKey: key, correct: true, at: exam - D };
    const after = { id: 2, itemKey: key, correct: true, at: exam + D };
    const r = newResult(exam, true, undefined, exam + D, "x");
    const p = predictionBefore([before, after], bank, r);
    expect(p.check.checked).toBe(1);
    expect(p.show).toBe(false);
  });

  it("syncs reports to the server once, across retries and devices", async () => {
    const remote = memoryRemote();
    const mk = () => {
      const m = new Map<string, string>();
      return new SyncedStore(remote, { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }, "u");
    };
    const phone = mk();
    remote.down = true;
    phone.addResult(newResult(exam, true, 80, exam + D, "r1"));
    await phone.sync();
    expect(remote.results.length).toBe(0);
    remote.down = false;
    await phone.sync();
    await phone.sync();
    expect(remote.results.map((r) => r.id)).toEqual(["r1"]);
    const laptop = mk();
    await laptop.sync();
    expect(laptop.loadResults().map((r) => r.score)).toEqual([80]);
  });
});

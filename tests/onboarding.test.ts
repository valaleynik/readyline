import { describe, expect, it } from "vitest";
import { loadLiveBank } from "../src/content/bank";
import { initState } from "../src/engine";
import { examDateFromInput, needsOnboarding, onboardingSteps, startChoice } from "../src/session/onboarding";

const { bank } = loadLiveBank();
const now = new Date(2026, 10, 27, 20).getTime();
const D = 86_400_000;

describe("onboarding", () => {
  it("is for brand-new learners only", () => {
    expect(needsOnboarding({}, [])).toBe(true);
    expect(needsOnboarding({ onboardedAt: now }, [])).toBe(false);
    // someone who already studied (old account, or a new device once the log loaded) never sees it
    expect(needsOnboarding({}, [{ id: 1, itemKey: "x", correct: true, at: now }])).toBe(false);
  });

  it("asks about agencies only when there is an account", () => {
    expect(onboardingSteps(true)).toEqual(["how", "date", "start"]);
    expect(onboardingSteps(false)).toEqual(["date", "start"]);
  });

  it("offers the baseline unless the exam is 5 days away or less", () => {
    const s0 = initState(bank);
    expect(startChoice(s0, bank, {}, now)).toBe("baseline");
    expect(startChoice(s0, bank, { examAt: now + 30 * D }, now)).toBe("baseline");
    expect(startChoice(s0, bank, { examAt: now + 3 * D }, now)).toBe("too_close");
  });

  it("reads the date input as 9am local and refuses past dates", () => {
    const t = examDateFromInput("2026-12-10", now)!;
    expect(new Date(t).getHours()).toBe(9);
    expect(new Date(t).getDate()).toBe(10);
    expect(examDateFromInput("2026-11-27", now)).not.toBeNull(); // today is allowed
    expect(examDateFromInput("2026-11-01", now)).toBeNull();
    expect(examDateFromInput("", now)).toBeNull();
  });
});

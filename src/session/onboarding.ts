/**
 * Onboarding for a brand-new learner: how they study, when the exam is, where they start.
 * Settings only (plus the agency join, which the account layer does). It never writes answers.
 */
import type { Bank } from "../engine/bank";
import type { AnswerEvent, LearnerState } from "../engine/types";
import { baselineStatus, type BaselineSettings } from "./baseline";

export type OnboardingStep = "how" | "date" | "start";

/**
 * Show onboarding only to someone who has never studied and never finished it. Anyone with
 * answers already counts as onboarded (accounts from before onboarding existed, or a returning
 * learner on a new device once their log has loaded).
 */
export function needsOnboarding(settings: BaselineSettings & { onboardedAt?: number }, events: AnswerEvent[]): boolean {
  return !settings.onboardedAt && events.length === 0;
}

/** The steps this learner sees. The agency step needs an account; local-only mode skips it. */
export function onboardingSteps(hasAccount: boolean): OnboardingStep[] {
  return hasAccount ? ["how", "date", "start"] : ["date", "start"];
}

/** What the last step offers, given the date just chosen. */
export function startChoice(
  state: LearnerState,
  bank: Bank,
  settings: BaselineSettings,
  now: number,
): "baseline" | "too_close" {
  return baselineStatus(state, bank, [], settings, now) === "needed" ? "baseline" : "too_close";
}

/** Parse a yyyy-mm-dd from a date input as 9:00 local on that day; null if empty or not in the future. */
export function examDateFromInput(v: string, now: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9).getTime();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return t >= today.getTime() ? t : null;
}

/** Shared wording and small formatters used across screens. */
import type { StudyPlan } from "../../src/session/plan";

export function planLine(p: StudyPlan): string {
  if (!p.hasDate) return "No exam date set, so you get a steady 12 new facts a day.";
  if (p.status === "past") return "Your exam date has passed. Set a new date to plan again.";
  const when = p.daysLeft === 0 ? "today" : p.daysLeft === 1 ? "tomorrow" : `in ${p.daysLeft} days`;
  if (p.factsRemaining === 0) return `Exam ${when}. You've seen every fact, so it's reviews from here.`;
  if (p.status === "review_only") return `Exam ${when}. These last days are for review only, with no new material.`;
  if (p.status === "behind")
    return `Exam ${when}. You're behind by about ${p.daysBehind} day${p.daysBehind === 1 ? "" : "s"}: ${p.newPerDay} new facts a day to catch up.`;
  return `Exam ${when}. On track at ${p.newPerDay} new facts a day.`;
}

/** the exam card's one line under the date and badge (the card already says how many days) */
export function paceLine(p: StudyPlan): string {
  if (p.factsRemaining === 0) return "You've seen every fact. Reviews from here.";
  if (p.status === "review_only") return "The last days are for review, with no new material.";
  if (p.status === "behind") return `About ${p.daysBehind} day${p.daysBehind === 1 ? "" : "s"} behind. ${p.newPerDay} new facts a day catches you up.`;
  return `Your pace: ${p.newPerDay} new facts a day.`;
}

/** epoch ms to the yyyy-mm-dd a date input wants */
export const toInput = (t?: number) => {
  if (!t) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

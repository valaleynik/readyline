"use client";
/** The manager's view: one row per learner, summaries only. Bare until the design pass. */
import { useCallback, useEffect, useState } from "react";
import type { AgencyView } from "../lib/agency";
import type { LearnerSummary } from "../../src/agency/summary";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const ago = (t: number | null, now: number) => {
  if (t === null) return "never";
  const d = Math.floor((now - t) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

export function status(l: LearnerSummary, now: number): { label: string; tone: "good" | "warn" | "bad" | "muted" } {
  if (l.result) return l.result.passed ? { label: "Passed", tone: "good" } : { label: "Didn't pass", tone: "bad" };
  if (l.answers === 0) return { label: "Not started", tone: "muted" };
  if (l.lastActive !== null && now - l.lastActive > 7 * 86_400_000) return { label: "Inactive", tone: "bad" };
  if (l.planStatus === "behind") return { label: "Behind", tone: "warn" };
  if (l.planStatus === "no_date") return { label: "No exam date", tone: "muted" };
  return { label: "On track", tone: "good" };
}

export default function AgencyDashboard({
  load,
  onRotate,
  onRemove,
}: {
  load: () => Promise<{ agencies: AgencyView[] } | { error: string }>;
  onRotate: (orgId: string) => Promise<string | null>;
  onRemove: (orgId: string, userId: string) => Promise<string | null>;
}) {
  const [data, setData] = useState<AgencyView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const r = await load();
    if ("error" in r) setError(r.error);
    else {
      setError(null);
      setData(r.agencies);
    }
  }, [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const now = Date.now();

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="chanceNote">Loading your team...</p>;
  return (
    <>
      {data.map((a) => (
        <section key={a.id} className="home agency">
          <h1>{a.name}</h1>
          <div className="row agencyMeta">
            <div className="chance">
              <div className="chanceTitle">Join code</div>
              <div className="chanceValue code">{a.joinCode}</div>
              <p className="chanceNote">Workers enter this after signing up. Replacing it stops the old one from working.</p>
              <button
                className="link"
                onClick={async () => {
                  if (!confirm("Replace the code? The current one stops working right away.")) return;
                  const e = await onRotate(a.id);
                  if (e) setError(e);
                  else void refresh();
                }}
              >
                Replace code
              </button>
            </div>
            <div className="chance">
              <div className="chanceTitle">Seats</div>
              <div className="chanceValue">
                {a.learners.length} of {a.seats}
              </div>
              <p className="chanceNote">{a.seats - a.learners.length > 0 ? `${a.seats - a.learners.length} open` : "Full: the code won't accept anyone new"}</p>
            </div>
          </div>
          {a.learners.length === 0 ? (
            <p className="lede">No one has joined yet. Share the code above.</p>
          ) : (
            <div className="tableWrap">
              <table className="sections team">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Status</th>
                    <th>Exam</th>
                    <th>Material</th>
                    <th>Pass chance</th>
                    <th>Last mock</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {a.learners.map((l) => {
                    const s = status(l, now);
                    const mock = l.mocks.at(-1);
                    return (
                      <tr key={l.userId}>
                        <td>{l.email ?? "Unknown"}</td>
                        <td>
                          <span className={`pill ${s.tone}`}>{s.label}</span>
                        </td>
                        <td className="num">{l.result ? day(l.result.takenAt) : l.examAt ? `${day(l.examAt)}${l.daysLeft !== null && l.daysLeft >= 0 ? ` (${l.daysLeft}d)` : ""}` : "-"}</td>
                        <td className="num">{pct(l.factsSeen / l.factsTotal)}</td>
                        <td className="num">{l.passChance !== null ? `about ${pct(l.passChance)}` : "not yet"}</td>
                        <td className="num">{mock ? `${mock.score}/${mock.total}` : "-"}</td>
                        <td className="num">
                          {ago(l.lastActive, now)}
                          <br />
                          <span className="chanceNote">{l.answersThisWeek} this week</span>
                        </td>
                        <td>
                          <button
                            className="link"
                            onClick={async () => {
                              if (!confirm(`Remove ${l.email ?? "this learner"}? They keep their progress; you lose access to it and the seat opens.`)) return;
                              const e = await onRemove(a.id, l.userId);
                              if (e) setError(e);
                              else void refresh();
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="chanceNote">
            You see progress summaries, not individual answers. Pass chance appears only when the learner's own app shows it.
          </p>
        </section>
      ))}
    </>
  );
}

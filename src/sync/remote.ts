/** The server side of the log, behind an interface so tests and the offline preview need no network. */
import type { AnswerEvent } from "../engine/types";
import type { ExamResult } from "../session/results";
import type { MockSettings as BaselineSettings } from "../session/mock";

export type InsertResult = "ok" | "conflict" | "offline";

export interface Remote {
  fetchEvents(): Promise<AnswerEvent[]>;
  /** insert in one batch; "conflict" if any id already exists */
  insertEvents(events: AnswerEvent[]): Promise<InsertResult>;
  fetchSettings(): Promise<BaselineSettings | null>;
  saveSettings(s: BaselineSettings): Promise<InsertResult>;
  fetchResults(): Promise<ExamResult[]>;
  /** insert; a result whose id already exists is ignored, so retries are safe */
  insertResults(results: ExamResult[]): Promise<InsertResult>;
}

/** In-memory server with the same rules as the database: append-only, unique ids. */
export function memoryRemote(): Remote & { rows: AnswerEvent[]; settings: BaselineSettings | null; results: ExamResult[]; down: boolean } {
  const r = {
    results: [] as ExamResult[],
    async fetchResults() {
      if (r.down) throw new Error("offline");
      return r.results.map((x) => ({ ...x }));
    },
    async insertResults(xs: ExamResult[]): Promise<InsertResult> {
      if (r.down) return "offline";
      for (const x of xs) if (!r.results.some((y) => y.id === x.id)) r.results.push({ ...x });
      return "ok";
    },
    rows: [] as AnswerEvent[],
    settings: null as BaselineSettings | null,
    down: false,
    async fetchEvents() {
      if (r.down) throw new Error("offline");
      return r.rows.map((e) => ({ ...e }));
    },
    async insertEvents(evs: AnswerEvent[]): Promise<InsertResult> {
      if (r.down) return "offline";
      if (evs.some((e) => r.rows.some((x) => x.id === e.id))) return "conflict";
      r.rows.push(...evs.map((e) => ({ ...e })));
      return "ok";
    },
    async fetchSettings() {
      if (r.down) throw new Error("offline");
      return r.settings ? { ...r.settings } : null;
    },
    async saveSettings(s: BaselineSettings): Promise<InsertResult> {
      if (r.down) return "offline";
      r.settings = { ...s };
      return "ok";
    },
  };
  return r;
}

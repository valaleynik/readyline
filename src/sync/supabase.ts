/** Supabase implementation of Remote. Row level security limits every query to the signed-in user. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswerEvent } from "../engine/types";
import type { ExamResult } from "../session/results";
import type { MockSettings as BaselineSettings } from "../session/mock";
import type { InsertResult, Remote } from "./remote";

interface Row {
  user_id: string;
  id: number;
  item_key: string;
  correct: boolean;
  at: number;
  confidence: "sure" | "guess" | null;
  context: "baseline" | "session" | "mock" | null;
}

const toEvent = (r: Row): AnswerEvent => ({
  id: r.id,
  itemKey: r.item_key,
  correct: r.correct,
  at: Number(r.at),
  ...(r.confidence ? { confidence: r.confidence } : {}),
  ...(r.context ? { context: r.context } : {}),
});

const PAGE = 1000;

export function supabaseRemote(db: SupabaseClient, userId: string): Remote {
  return {
    async fetchEvents() {
      const out: AnswerEvent[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
          .from("answer_events")
          .select("user_id,id,item_key,correct,at,confidence,context")
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...(data as Row[]).map(toEvent));
        if (data.length < PAGE) return out;
      }
    },
    async insertEvents(evs): Promise<InsertResult> {
      const rows: Row[] = evs.map((e) => ({
        user_id: userId,
        id: e.id,
        item_key: e.itemKey,
        correct: e.correct,
        at: e.at,
        confidence: e.confidence ?? null,
        context: e.context ?? null,
      }));
      const { error } = await db.from("answer_events").insert(rows);
      if (!error) return "ok";
      if (error.code === "23505") return "conflict"; // unique violation on (user_id, id)
      return "offline";
    },
    async fetchSettings() {
      const { data, error } = await db.from("study_settings").select("exam_at,baseline_skipped,result_prompt_skips,result_prompt_skipped_at,mocks").maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...(data.exam_at ? { examAt: Number(data.exam_at) } : {}),
        ...(data.baseline_skipped ? { baselineSkipped: true } : {}),
        ...(data.result_prompt_skips ? { resultPromptSkips: data.result_prompt_skips } : {}),
        ...(data.result_prompt_skipped_at ? { resultPromptSkippedAt: Number(data.result_prompt_skipped_at) } : {}),
        ...(Array.isArray(data.mocks) && data.mocks.length ? { mocks: data.mocks } : {}),
      };
    },
    async saveSettings(s): Promise<InsertResult> {
      const { error } = await db.from("study_settings").upsert({
        user_id: userId,
        exam_at: s.examAt ?? null,
        baseline_skipped: !!s.baselineSkipped,
        result_prompt_skips: s.resultPromptSkips ?? 0,
        result_prompt_skipped_at: s.resultPromptSkippedAt ?? null,
        mocks: s.mocks ?? [],
        updated_at: new Date().toISOString(),
      });
      return error ? "offline" : "ok";
    },
    async fetchResults() {
      const { data, error } = await db.from("exam_results").select("id,taken_at,passed,score,reported_at").order("reported_at");
      if (error) throw error;
      return (data as { id: string; taken_at: number; passed: boolean; score: number | null; reported_at: number }[]).map((r) => ({
        id: r.id,
        takenAt: Number(r.taken_at),
        passed: r.passed,
        ...(r.score !== null ? { score: r.score } : {}),
        reportedAt: Number(r.reported_at),
      }));
    },
    async insertResults(xs): Promise<InsertResult> {
      const { error } = await db.from("exam_results").upsert(
        xs.map((r) => ({ user_id: userId, id: r.id, taken_at: r.takenAt, passed: r.passed, score: r.score ?? null, reported_at: r.reportedAt })),
        { onConflict: "user_id,id", ignoreDuplicates: true },
      );
      return error ? "offline" : "ok";
    },
  };
}

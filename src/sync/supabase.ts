/** Supabase implementation of Remote. Row level security limits every query to the signed-in user. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswerEvent } from "../engine/types";
import type { BaselineSettings } from "../session/baseline";
import type { InsertResult, Remote } from "./remote";

interface Row {
  user_id: string;
  id: number;
  item_key: string;
  correct: boolean;
  at: number;
  confidence: "sure" | "guess" | null;
  context: "baseline" | "session" | null;
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
      const { data, error } = await db.from("study_settings").select("exam_at,baseline_skipped").maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...(data.exam_at ? { examAt: Number(data.exam_at) } : {}),
        ...(data.baseline_skipped ? { baselineSkipped: true } : {}),
      };
    },
    async saveSettings(s): Promise<InsertResult> {
      const { error } = await db.from("study_settings").upsert({
        user_id: userId,
        exam_at: s.examAt ?? null,
        baseline_skipped: !!s.baselineSkipped,
        updated_at: new Date().toISOString(),
      });
      return error ? "offline" : "ok";
    },
  };
}

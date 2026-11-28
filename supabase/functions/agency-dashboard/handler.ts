/**
 * agency-dashboard: returns summaries of an agency's learners to that agency's managers.
 * Runs with the service role so managers never receive raw answers; the caller's identity
 * is checked first. Built into one file by scripts/build-functions.mjs.
 */
import { bankFrom, learnerSummary } from "../../../src/agency/summary";
import type { ExportedBank } from "../../../src/content/export";
import type { AnswerEvent } from "../../../src/engine/types";
import type { MockSettings } from "../../../src/session/mock";
import type { ExamResult } from "../../../src/session/results";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BANK_URL = Deno.env.get("READYLINE_BANK_URL") ?? "https://www.readylineprep.com/bank.json";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function rest<T>(path: string): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** The API returns at most 1000 rows per request; read everything in pages. */
async function restAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest<T[]>(`${path}&limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

let bankCache: { data: ExportedBank; at: number } | null = null;
async function loadBank(): Promise<ExportedBank> {
  if (bankCache && Date.now() - bankCache.at < 10 * 60_000) return bankCache.data;
  const r = await fetch(BANK_URL);
  if (!r.ok) throw new Error(`bank: ${r.status}`);
  bankCache = { data: (await r.json()) as ExportedBank, at: Date.now() };
  return bankCache.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // who is asking
    const auth = req.headers.get("Authorization") ?? "";
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: auth } });
    if (!who.ok) return json({ error: "Sign in first." }, 401);
    const me = (await who.json()) as { id: string };

    // which agencies they manage
    const managed = await rest<{ org_id: string }[]>(`memberships?select=org_id&role=eq.manager&user_id=eq.${me.id}`);
    if (!managed.length) return json({ error: "You don't manage an agency." }, 403);
    const orgIds = managed.map((m) => m.org_id);
    const ids = `(${orgIds.join(",")})`;

    const [orgs, members, data] = await Promise.all([
      rest<{ id: string; name: string; seats: number; join_code: string }[]>(`organizations?select=id,name,seats,join_code&id=in.${ids}`),
      rest<{ org_id: string; user_id: string; email: string | null; joined_at: string }[]>(
        `memberships?select=org_id,user_id,email,joined_at&role=eq.learner&org_id=in.${ids}&order=joined_at`,
      ),
      loadBank(),
    ]);
    const bank = bankFrom(data);
    const now = Date.now();

    const learners = await Promise.all(
      members.map(async (m) => {
        const [events, settings, results] = await Promise.all([
          restAll<{ id: number; item_key: string; correct: boolean; at: number; confidence: string | null; context: string | null }>(
            `answer_events?select=id,item_key,correct,at,confidence,context&user_id=eq.${m.user_id}&order=id`,
          ),
          rest<{ exam_at: number | null; mocks: MockSettings["mocks"] }[]>(`study_settings?select=exam_at,mocks&user_id=eq.${m.user_id}`),
          rest<{ id: string; taken_at: number; passed: boolean; score: number | null; reported_at: number }[]>(
            `exam_results?select=id,taken_at,passed,score,reported_at&user_id=eq.${m.user_id}`,
          ),
        ]);
        const evs: AnswerEvent[] = events.map((e) => ({
          id: e.id,
          itemKey: e.item_key,
          correct: e.correct,
          at: Number(e.at),
          ...(e.confidence ? { confidence: e.confidence as "sure" | "guess" } : {}),
          ...(e.context ? { context: e.context as AnswerEvent["context"] } : {}),
        }));
        const st: MockSettings = {
          ...(settings[0]?.exam_at ? { examAt: Number(settings[0].exam_at) } : {}),
          mocks: settings[0]?.mocks ?? [],
        };
        const rs: ExamResult[] = results.map((r) => ({
          id: r.id,
          takenAt: Number(r.taken_at),
          passed: r.passed,
          ...(r.score !== null ? { score: r.score } : {}),
          reportedAt: Number(r.reported_at),
        }));
        return {
          orgId: m.org_id,
          ...learnerSummary(data, bank, { userId: m.user_id, email: m.email, joinedAt: m.joined_at }, evs, st, rs, now),
        };
      }),
    );

    return json({
      agencies: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        seats: o.seats,
        joinCode: o.join_code,
        learners: learners.filter((l) => l.orgId === o.id),
      })),
      computedAt: now,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

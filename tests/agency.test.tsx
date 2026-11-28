// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bankJson from "../web/data/bank.json";
import type { ExportedBank } from "../src/content/export";
import { bankFrom, learnerSummary } from "../src/agency/summary";

const data = bankJson as unknown as ExportedBank;
const bank = bankFrom(data);
const D = 86_400_000;
const now = new Date(2026, 10, 27, 12).getTime();

describe("agency learner summary", () => {
  it("summarizes without question detail and hides a pass chance the learner can't see yet", () => {
    const k = data.items[0]!.key;
    const s = learnerSummary(
      data,
      bank,
      { userId: "u", email: "a@x.com", joinedAt: "2026-11-01" },
      [{ id: 1, itemKey: k, correct: true, at: now - D }],
      { examAt: now + 10 * D },
      [],
      now,
    );
    expect(s.answers).toBe(1);
    expect(s.answersThisWeek).toBe(1);
    expect(s.passChance).toBeNull();
    expect(s.passChanceNeed).toBeGreaterThan(0);
    expect(s.daysLeft).toBe(10);
    expect(JSON.stringify(s)).not.toContain(k);
  });
});

describe("agency-dashboard function", () => {
  let handler: (r: Request) => Promise<Response>;
  const calls: string[] = [];
  const db = {
    memberships: [
      { org_id: "o1", user_id: "mgr", role: "manager" },
      { org_id: "o1", user_id: "L1", role: "learner", email: "l1@x.com", joined_at: "2026-11-01" },
    ],
  };
  beforeAll(async () => {
    (globalThis as any).Deno = {
      env: { get: (k: string) => ({ SUPABASE_URL: "https://db", SUPABASE_SERVICE_ROLE_KEY: "svc" })[k] },
      serve: (h: typeof handler) => void (handler = h),
    };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(url);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith("/bank.json")) return ok(data);
      if (url.includes("/auth/v1/user")) return auth === "Bearer mgr-token" ? ok({ id: "mgr" }) : auth === "Bearer l1-token" ? ok({ id: "L1" }) : new Response("no", { status: 401 });
      if (url.includes("memberships?select=org_id&role=eq.manager")) return ok(db.memberships.filter((m) => m.role === "manager" && url.includes(`user_id=eq.${m.user_id}`)));
      if (url.includes("organizations?")) return ok([{ id: "o1", name: "Acme", seats: 5, join_code: "RDY-AAAA-BBBB" }]);
      if (url.includes("memberships?select=org_id,user_id")) return ok(db.memberships.filter((m) => m.role === "learner"));
      if (url.includes("answer_events?")) {
        const offset = Number(/offset=(\d+)/.exec(url)![1]);
        // 1500 answers: forces a second page
        const all = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, item_key: data.items[i % 300]!.key, correct: i % 4 !== 0, at: now - 5 * D + i * 60_000, confidence: "sure", context: "session" }));
        return ok(all.slice(offset, offset + 1000));
      }
      if (url.includes("study_settings?")) return ok([{ exam_at: now + 20 * D, mocks: [] }]);
      if (url.includes("exam_results?")) return ok([]);
      return new Response("unexpected " + url, { status: 500 });
    });
    await import("../supabase/functions/agency-dashboard/handler");
  });
  afterAll(() => vi.unstubAllGlobals());

  it("rejects people who are not signed in or not managers", async () => {
    expect((await handler(new Request("https://f", { method: "POST" }))).status).toBe(401);
    expect((await handler(new Request("https://f", { method: "POST", headers: { Authorization: "Bearer l1-token" } }))).status).toBe(403);
  });

  it("returns summaries for the manager's agency, reading every page of answers", async () => {
    const r = await handler(new Request("https://f", { method: "POST", headers: { Authorization: "Bearer mgr-token" } }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.agencies[0].name).toBe("Acme");
    expect(body.agencies[0].joinCode).toBe("RDY-AAAA-BBBB");
    const l = body.agencies[0].learners[0];
    expect(l.email).toBe("l1@x.com");
    expect(l.answers).toBe(1500);
    expect(calls.filter((c) => c.includes("answer_events?")).length).toBe(2);
    expect(JSON.stringify(body)).not.toContain("item_key");
    expect(JSON.stringify(body)).not.toContain(data.items[0]!.key);
  });
});

describe("agency screens", () => {
  it("learner: join with a code, see the privacy note, leave", async () => {
    const { render, screen, fireEvent, act, cleanup } = await import("@testing-library/react");
    const StudyApp = (await import("../web/components/StudyApp")).default;
    const memberships: { orgId: string; orgName: string; role: "learner" | "manager" }[] = [];
    let rerender: () => void = () => {};
    const account = {
      memberships,
      join: async (code: string) => {
        if (code.trim() !== "RDY-AAAA-BBBB") return "That code is not valid.";
        memberships.push({ orgId: "o1", orgName: "Acme Insurance", role: "learner" });
        rerender();
        return null;
      },
      leave: async () => {
        memberships.length = 0;
        rerender();
        return null;
      },
    };
    const store = { load: () => [], save: () => {}, loadSettings: () => ({ baselineSkipped: true, onboardedAt: 1 }), saveSettings: () => {} };
    const r = render(<StudyApp data={data} store={store} account={{ ...account }} />);
    rerender = () => r.rerender(<StudyApp data={data} store={store} account={{ ...account, memberships: [...memberships] }} />);
    const input = await screen.findByPlaceholderText("RDY-XXXX-XXXX");
    fireEvent.change(input, { target: { value: "RDY-ZZZZ-ZZZZ" } });
    await act(async () => { fireEvent.click(screen.getByText("Join")); });
    expect(screen.getByText("That code is not valid.")).not.toBeNull();
    fireEvent.change(input, { target: { value: "RDY-AAAA-BBBB" } });
    await act(async () => { fireEvent.click(screen.getByText("Join")); });
    expect(screen.getByText(/Linked to Acme Insurance/)).not.toBeNull();
    expect(screen.getByText(/not your\s+individual answers/)).not.toBeNull();
    const confirm = globalThis.confirm;
    globalThis.confirm = () => true;
    await act(async () => { fireEvent.click(screen.getByText("Leave agency")); });
    globalThis.confirm = confirm;
    expect(screen.getByText("Studying with an agency?")).not.toBeNull();
    cleanup();
  });

  it("manager: code, seats, one row per learner with status", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const AgencyDashboard = (await import("../web/components/AgencyDashboard")).default;
    const base = { email: null, joinedAt: "", examAt: null, daysLeft: null, factsSeen: 0, factsTotal: 325, answers: 0, answersThisWeek: 0, lastActive: null, passChance: null, passChanceNeed: 100, mocks: [], result: null };
    const t = Date.now();
    const learners = [
      { ...base, userId: "1", email: "new@x.com", planStatus: "no_date" as const },
      { ...base, userId: "2", email: "ok@x.com", planStatus: "on_track" as const, answers: 400, lastActive: t, factsSeen: 200, passChance: 0.75, mocks: [{ at: t, score: 64, total: 83 }] },
      { ...base, userId: "3", email: "gone@x.com", planStatus: "on_track" as const, answers: 50, lastActive: t - 10 * 86_400_000 },
      { ...base, userId: "4", email: "done@x.com", planStatus: "past" as const, answers: 900, lastActive: t, result: { takenAt: t, passed: true, score: 80 } },
    ];
    render(
      <AgencyDashboard
        load={async () => ({ agencies: [{ id: "o1", name: "Acme", seats: 4, joinCode: "RDY-AAAA-BBBB", learners }] })}
        onRotate={async () => null}
        onRemove={async () => null}
      />,
    );
    expect(await screen.findByText("RDY-AAAA-BBBB")).not.toBeNull();
    expect(screen.getByText("4 of 4")).not.toBeNull();
    expect(screen.getByText(/Full/)).not.toBeNull();
    for (const s of ["Not started", "On track", "Inactive", "Passed"]) expect(screen.getByText(s)).not.toBeNull();
    expect(screen.getByText("about 75%")).not.toBeNull();
    expect(screen.getByText("64/83")).not.toBeNull();
    cleanup();
  });

  it("shows the server's refusal instead of a blank page", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const AgencyDashboard = (await import("../web/components/AgencyDashboard")).default;
    render(<AgencyDashboard load={async () => ({ error: "You don't manage an agency." })} onRotate={async () => null} onRemove={async () => null} />);
    expect(await screen.findByText("You don't manage an agency.")).not.toBeNull();
    cleanup();
  });
});

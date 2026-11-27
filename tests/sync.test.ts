import { describe, expect, it } from "vitest";
import type { AnswerEvent } from "../src/engine";
import { mergeEvents } from "../src/sync/merge";
import { memoryRemote } from "../src/sync/remote";
import { SyncedStore, type LocalCache } from "../src/sync/store";

const cache = (): LocalCache & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};
const ev = (id: number, at: number, itemKey = `k${at}`): AnswerEvent => ({ id, itemKey, correct: at % 2 === 0, at, context: "session" });
/** The app appends to whatever log the store last gave it. */
const answer = (s: SyncedStore, at: number) => {
  const cur = s.load();
  s.save([...cur, ev((cur.at(-1)?.id ?? 0) + 1, at)]);
};

describe("sync", () => {
  it("merge: server rows are final, pending answers follow in answer order", () => {
    const m = mergeEvents([ev(1, 10), ev(2, 20)], [ev(2, 25), ev(3, 30), ev(2, 20)]);
    expect(m.events.map((e) => [e.id, e.at])).toEqual([[1, 10], [2, 20], [3, 25], [4, 30]]);
    expect(m.pending.map((e) => e.id)).toEqual([3, 4]);
  });

  it("keeps answers made offline and uploads them when the connection is back", async () => {
    const remote = memoryRemote();
    remote.down = true;
    const s = new SyncedStore(remote, cache(), "u");
    answer(s, 100);
    answer(s, 200);
    await s.sync();
    expect(s.status).toBe("offline");
    expect(s.load().length).toBe(2);
    remote.down = false;
    await s.sync();
    expect(s.status).toBe("synced");
    expect(remote.rows.map((e) => e.at)).toEqual([100, 200]);
  });

  it("two devices answering at once end with one clean log on the server", async () => {
    const remote = memoryRemote();
    const a = new SyncedStore(remote, cache(), "u");
    const b = new SyncedStore(remote, cache(), "u");
    answer(a, 100);
    answer(b, 150);
    answer(a, 200);
    answer(b, 250);
    await a.sync();
    await b.sync();
    await a.sync();
    const ids = remote.rows.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(new Set(ids).size).toBe(4);
    expect(remote.rows.map((e) => e.at).sort()).toEqual([100, 150, 200, 250]);
    expect(a.load()).toEqual(b.load());
    expect(a.load().map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });

  it("a late upload with earlier answer times replays without memory running backward", async () => {
    const { loadLiveBank } = await import("../src/content/bank");
    const { replay } = await import("../src/engine");
    const { bank } = loadLiveBank();
    const key = [...bank.items.keys()][0]!;
    const log: AnswerEvent[] = [
      { id: 1, itemKey: key, correct: true, at: 5 * 86_400_000 },
      { id: 2, itemKey: key, correct: true, at: 1 * 86_400_000 },
    ];
    const st = replay(log, bank);
    expect(st.lastAt).toBe(5 * 86_400_000);
    expect(st.facts[bank.items.get(key)!.factId]!.lastReview).toBe(5 * 86_400_000);
  });

  it("survives a reload from the local cache and syncs settings both ways", async () => {
    const remote = memoryRemote();
    const c = cache();
    const s = new SyncedStore(remote, c, "u");
    answer(s, 100);
    s.saveSettings({ examAt: 5_000, baselineSkipped: true });
    await s.sync();
    const again = new SyncedStore(remote, c, "u");
    expect(again.load().length).toBe(1);
    expect(again.loadSettings().examAt).toBe(5_000);
    const other = new SyncedStore(remote, cache(), "u");
    await other.sync();
    expect(other.load().length).toBe(1);
    expect(other.loadSettings()).toEqual({ examAt: 5_000, baselineSkipped: true });
  });

  it("never sends the same answer twice", async () => {
    const remote = memoryRemote();
    const s = new SyncedStore(remote, cache(), "u");
    answer(s, 100);
    await s.sync();
    s.save(s.load());
    await s.sync();
    answer(s, 200);
    await s.sync();
    expect(remote.rows.map((e) => e.at)).toEqual([100, 200]);
  });
});

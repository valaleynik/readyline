/** Wires the synced store to Supabase for a signed-in user. The preview build stays local-only. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SyncedStore } from "../../src/sync/store";
import { supabaseRemote } from "../../src/sync/supabase";
import type { EventStore } from "../components/StudyApp";

let client: SupabaseClient | null = null;

/** Null when the app is built without Supabase settings (local-only mode). */
export function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return (client ??= createClient(url, key));
}

const browserCache = {
  get: (k: string) => {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {
      /* blocked storage: server copy still works */
    }
  },
};

export function syncedStore(db: SupabaseClient, userId: string): EventStore {
  const s = new SyncedStore(supabaseRemote(db, userId), browserCache, `readyline.sync.v1.${userId}`);
  return {
    load: () => s.load(),
    save: (e) => s.save(e),
    loadSettings: () => s.loadSettings(),
    saveSettings: (st) => s.saveSettings(st),
    loadResults: () => s.loadResults(),
    addResult: (r) => s.addResult(r),
    subscribe(fn) {
      s.onChange = fn;
      void s.sync();
      const again = () => void s.sync();
      globalThis.addEventListener?.("online", again);
      globalThis.addEventListener?.("focus", again);
      return () => {
        s.onChange = undefined;
        globalThis.removeEventListener?.("online", again);
        globalThis.removeEventListener?.("focus", again);
      };
    },
  };
}

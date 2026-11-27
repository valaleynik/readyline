/**
 * Synced event store: answers are kept locally first (so a lost connection never loses one)
 * and uploaded in the background. The server copy is the truth once it has it.
 */
import type { AnswerEvent } from "../engine/types";
import type { ExamResult, ResultSettings as BaselineSettings } from "../session/results";
import { mergeEvents } from "./merge";
import type { Remote } from "./remote";

export interface LocalCache {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export type SyncStatus = "synced" | "pending" | "offline";

export class SyncedStore {
  private events: AnswerEvent[] = [];
  private settings: BaselineSettings = {};
  /** ids the server is known to have */
  private confirmed = 0;
  private settingsDirty = false;
  private results: ExamResult[] = [];
  /** result ids not yet confirmed by the server */
  private pendingResults: string[] = [];
  private flushing: Promise<void> | null = null;
  status: SyncStatus = "pending";
  /** called when a sync changed the log or settings (another device, renumbering) */
  onChange?: (events: AnswerEvent[], settings: BaselineSettings, results: ExamResult[]) => void;

  constructor(
    private remote: Remote,
    private cache: LocalCache,
    private key: string,
  ) {
    try {
      const c = JSON.parse(cache.get(key) ?? "null");
      if (c) {
        this.events = c.events ?? [];
        this.settings = c.settings ?? {};
        this.confirmed = c.confirmed ?? 0;
        this.settingsDirty = !!c.settingsDirty;
        this.results = c.results ?? [];
        this.pendingResults = c.pendingResults ?? [];
      }
    } catch {
      /* bad cache: start empty, the server fills it in */
    }
  }

  load(): AnswerEvent[] {
    return this.events;
  }
  loadSettings(): BaselineSettings {
    return this.settings;
  }
  loadResults(): ExamResult[] {
    return this.results;
  }
  addResult(r: ExamResult): void {
    if (this.results.some((x) => x.id === r.id)) return;
    this.results = [...this.results, r];
    this.pendingResults.push(r.id);
    this.persist();
    void this.flush();
  }

  /** The app hands over its full log; anything past what we had is new. */
  save(events: AnswerEvent[]): void {
    // Keep what the server confirmed; the app's newer answers follow it, renumbered if needed.
    const confirmed = this.events.filter((e) => e.id <= this.confirmed);
    const next = mergeEvents(confirmed, events).events;
    if (JSON.stringify(next) === JSON.stringify(this.events)) return;
    this.events = next;
    this.persist();
    void this.flush();
  }
  saveSettings(s: BaselineSettings): void {
    if (JSON.stringify(s) === JSON.stringify(this.settings)) return;
    this.settings = s;
    this.settingsDirty = true;
    this.persist();
    void this.flush();
  }

  /** Pull from the server, merge, push what's pending. Safe to call any time. */
  sync(): Promise<void> {
    return this.flush(true);
  }

  private persist() {
    try {
      this.cache.set(
        this.key,
        JSON.stringify({
          events: this.events,
          settings: this.settings,
          confirmed: this.confirmed,
          settingsDirty: this.settingsDirty,
          results: this.results,
          pendingResults: this.pendingResults,
        }),
      );
    } catch {
      /* storage full or blocked: the server copy still gets it */
    }
  }

  private flush(pull = false): Promise<void> {
    if (this.flushing) return this.flushing.then(() => this.flush(pull));
    this.flushing = this.run(pull).finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async run(pull: boolean) {
    const before = JSON.stringify([this.events, this.settings, this.results]);
    try {
      if (this.settingsDirty) {
        if ((await this.remote.saveSettings(this.settings)) === "ok") this.settingsDirty = false;
      } else if (pull) {
        const s = await this.remote.fetchSettings();
        if (s) this.settings = s;
      }
      if (this.pendingResults.length) {
        const ids = [...this.pendingResults];
        const send = this.results.filter((r) => ids.includes(r.id));
        if ((await this.remote.insertResults(send)) === "ok") this.pendingResults = this.pendingResults.filter((id) => !ids.includes(id));
      }
      if (pull) {
        const server = await this.remote.fetchResults();
        const mine = this.results.filter((r) => this.pendingResults.includes(r.id));
        this.results = [...server, ...mine.filter((m) => !server.some((x) => x.id === m.id))];
      }
      // Always work from the current log: the app may add answers while a request is in flight.
      const unconfirmed = () => this.events.filter((e) => e.id > this.confirmed);
      let server: AnswerEvent[] | null = pull ? await this.remote.fetchEvents() : null;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (server) {
          this.events = mergeEvents(server, unconfirmed()).events;
          this.confirmed = server.at(-1)?.id ?? 0;
          server = null;
        }
        const batch = unconfirmed();
        if (batch.length === 0) break;
        const res = await this.remote.insertEvents(batch);
        if (res === "ok") {
          this.confirmed = Math.max(this.confirmed, batch.at(-1)!.id);
          break;
        }
        if (res === "offline") break;
        server = await this.remote.fetchEvents(); // conflict: another device wrote first
      }
      const local = unconfirmed();
      this.status = local.length || this.settingsDirty || this.pendingResults.length ? "pending" : "synced";
    } catch {
      this.status = "offline";
    }
    this.persist();
    // Only tell the app when something it shows changed, so saving back is never a loop.
    if (JSON.stringify([this.events, this.settings, this.results]) !== before) this.onChange?.(this.events, this.settings, this.results);
  }
}

/**
 * Merging the server log with answers not yet saved there.
 *
 * Event ids must increase in answer order, and two devices can both try to write id N.
 * The rule: the server's rows are final. Local answers the server doesn't have yet are
 * renumbered to follow the server's last id, in the order they were answered. Answer times
 * are never changed; a late upload from an offline device can carry earlier times than rows
 * before it, and the engine handles that when replaying (see applyAnswer). An insert
 * that collides is not an error: pull, merge, retry.
 */
import type { AnswerEvent } from "../engine/types";

/** Same answer, regardless of id: same item at the same moment. */
const sameAnswer = (a: AnswerEvent, b: AnswerEvent) => a.itemKey === b.itemKey && a.at === b.at;

export interface Merged {
  /** the full log to replay: server rows, then pending answers */
  events: AnswerEvent[];
  /** answers still to upload, already renumbered */
  pending: AnswerEvent[];
}

export function mergeEvents(server: AnswerEvent[], local: AnswerEvent[]): Merged {
  const remote = [...server].sort((a, b) => a.id - b.id);
  const maxId = remote.at(-1)?.id ?? 0;
  const pending = local
    .filter((l) => !remote.some((r) => sameAnswer(r, l)))
    .sort((a, b) => a.at - b.at || a.id - b.id)
    .map((e, i) => ({ ...e, id: maxId + i + 1 }));
  return { events: [...remote, ...pending], pending };
}

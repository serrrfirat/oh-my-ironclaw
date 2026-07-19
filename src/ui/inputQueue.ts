import type { StagedAttachment } from "./attachments"

// A single message the user typed while a run was in flight. It carries the
// composer text plus any staged attachments so the auto-flush can replay the
// send exactly as it would have gone out, without re-staging.
export type QueuedMessage = {
  text: string
  attachments: StagedAttachment[]
}

// Per-thread FIFO of queued messages. Immutable: every mutator returns a NEW
// map (and new inner array) so React state updates stay referentially honest.
// Keyed by thread id (the caller supplies a "local" fallback for the no-thread
// case, mirroring runLocalCliCommand).
export type QueuedMessageMap = Record<string, QueuedMessage[]>

// Append a message to the END of a thread's queue (newest last).
export function enqueue(map: QueuedMessageMap, threadId: string, msg: QueuedMessage): QueuedMessageMap {
  const existing = map[threadId] ?? []
  return { ...map, [threadId]: [...existing, msg] }
}

// Prepend a message to the FRONT of a thread's queue (becomes the new oldest).
// Used when an auto-flushed message's send comes back rejected_busy (the run was
// still settling): re-queueing it to the front preserves FIFO order so a queue of
// [M, N] that flushed M and bounced stays [M, N] rather than becoming [N, M].
export function enqueueFront(map: QueuedMessageMap, threadId: string, msg: QueuedMessage): QueuedMessageMap {
  const existing = map[threadId] ?? []
  return { ...map, [threadId]: [msg, ...existing] }
}

// Move a thread's whole queue from one key to another (used to reconcile messages
// queued under the "local" fallback key onto the real thread id once it's known).
// The moved messages are older, so they land in FRONT of any entries already on the
// destination. A no-op (same map reference) when there is nothing to move.
export function migrateThreadQueue(map: QueuedMessageMap, fromKey: string, toKey: string): QueuedMessageMap {
  if (fromKey === toKey) return map
  const from = map[fromKey]
  if (!from || from.length === 0) return map
  const next = { ...map }
  delete next[fromKey]
  next[toKey] = [...from, ...(map[toKey] ?? [])]
  return next
}

// Remove and return the OLDEST message (front of the FIFO) — the one auto-sent
// on a clean completion edge. Returns the message (or null when empty) and the
// map with that entry removed. An emptied thread key is dropped from the map so
// queueCount stays honest and the map doesn't accumulate empty arrays.
export function dequeueOldest(map: QueuedMessageMap, threadId: string): { msg: QueuedMessage | null; map: QueuedMessageMap } {
  const existing = map[threadId] ?? []
  if (existing.length === 0) return { msg: null, map }
  const [oldest, ...rest] = existing
  return { msg: oldest ?? null, map: withThreadQueue(map, threadId, rest) }
}

// Remove and return the NEWEST message (back of the FIFO) — used by Alt+Up to
// pull the last-typed queued message back into the composer for editing.
export function popNewest(map: QueuedMessageMap, threadId: string): { msg: QueuedMessage | null; map: QueuedMessageMap } {
  const existing = map[threadId] ?? []
  if (existing.length === 0) return { msg: null, map }
  const newest = existing[existing.length - 1] ?? null
  const rest = existing.slice(0, -1)
  return { msg: newest, map: withThreadQueue(map, threadId, rest) }
}

// How many messages are queued for a thread.
export function queueCount(map: QueuedMessageMap, threadId: string): number {
  return map[threadId]?.length ?? 0
}

// Pure predicate for the condition-based auto-flush: the active thread's oldest
// queued message may auto-send only when the thread is fully idle, its last run
// settled cleanly (completed), and its queue is non-empty. A failed/cancelled
// outcome is deliberately NOT eligible — that queue is held for the user.
export function isFlushEligible(args: {
  idle: boolean
  outcome: "completed" | "failed" | "cancelled" | null | undefined
  queued: number
}): boolean {
  return args.idle && args.outcome === "completed" && args.queued > 0
}

// Peek the oldest queued message (front of the FIFO) without removing it —
// drives the queued-indicator preview.
export function peekOldest(map: QueuedMessageMap, threadId: string): QueuedMessage | null {
  return map[threadId]?.[0] ?? null
}

// Drop a thread's queue entirely (used when a thread is deleted).
export function clearThreadQueue(map: QueuedMessageMap, threadId: string): QueuedMessageMap {
  if (!(threadId in map)) return map
  const next = { ...map }
  delete next[threadId]
  return next
}

// Replace a thread's queue array, dropping the key when the array is empty.
function withThreadQueue(map: QueuedMessageMap, threadId: string, queue: QueuedMessage[]): QueuedMessageMap {
  const next = { ...map }
  if (queue.length === 0) delete next[threadId]
  else next[threadId] = queue
  return next
}

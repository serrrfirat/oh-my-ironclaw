import type { LogLevel, LogQuery } from "../gateway/types"

export const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error"]

// UI filter state for the remote logs surface.
export type LogFilterState = {
  level?: LogLevel
  target?: string
  threadId?: string
  tail: boolean
  follow: boolean
  cursor?: string
  limit: number
}

export const DEFAULT_LOG_FILTER: LogFilterState = {
  level: undefined,
  target: "",
  threadId: "",
  tail: true,
  follow: false,
  cursor: undefined,
  limit: 100,
}

// Cycle the level filter forward/backward. `undefined` means "all levels" and
// sits before "trace" in the cycle.
export function cycleLogLevel(current: LogLevel | undefined, direction: 1 | -1): LogLevel | undefined {
  const order: Array<LogLevel | undefined> = [undefined, ...LOG_LEVELS]
  const index = order.indexOf(current)
  const next = order[(index + direction + order.length) % order.length]
  return next
}

// Build the wire query from the UI filter state, dropping empty fields.
export function buildLogQuery(state: LogFilterState): LogQuery {
  const query: LogQuery = { limit: state.limit }
  if (state.level) query.level = state.level
  const target = state.target?.trim()
  if (target) query.target = target
  const threadId = state.threadId?.trim()
  if (threadId) query.thread_id = threadId
  if (state.tail) query.tail = true
  if (state.follow) query.follow = true
  if (state.cursor) query.cursor = state.cursor
  return query
}

export function logLevelLabel(level: LogLevel | undefined): string {
  return level ?? "all"
}

import type { LogEntry } from "../gateway/types"
import type { LogFilterState } from "./logFilters"
import { logLevelLabel } from "./logFilters"
import { theme, statusColor } from "./theme"
import { Hint, Surface, truncate } from "./pixel"

export const LOG_VISIBLE_LIMIT = 16

export function LogsSurface({
  entries,
  filter,
  editingTarget,
  targetInput,
  source,
  tailSupported,
  followSupported,
  hasOlder,
  offset,
  loading,
  error,
  width,
  height,
}: {
  entries: LogEntry[]
  filter: LogFilterState
  editingTarget: boolean
  targetInput: string
  source: string
  tailSupported: boolean
  followSupported: boolean
  hasOlder: boolean
  offset: number
  loading: boolean
  error: string | null
  width: number
  height: number
}) {
  const contentWidth = Math.max(1, width - 4)
  // `offset` is how many entries the window is scrolled up from the newest. It
  // is clamped here so fetched older entries stay reachable without the caller
  // needing to know the entry count.
  const maxOffset = Math.max(0, entries.length - LOG_VISIBLE_LIMIT)
  const clampedOffset = Math.min(Math.max(0, offset), maxOffset)
  const end = entries.length - clampedOffset
  const start = Math.max(0, end - LOG_VISIBLE_LIMIT)
  const visible = entries.slice(start, end)
  return (
    <Surface title="logs" meta={loading ? "loading" : `${entries.length} · ${source || "server"}`} width={width} height={height}>
      <FilterStrip filter={filter} editingTarget={editingTarget} targetInput={targetInput} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        {visible.length ? (
          visible.map((entry) => <LogRow key={entry.id} entry={entry} width={contentWidth} />)
        ) : (
          <text fg={theme.textMuted}>{loading ? "loading logs…" : "no log entries"}</text>
        )}
      </box>
      <Hint
        text={`l level (${logLevelLabel(filter.level)}) · t target · f follow ${filter.follow ? "on" : "off"}${tailSupported ? " · tail" + (filter.tail ? " on" : " off") : ""}${maxOffset > 0 ? " · ↑/↓ scroll" : ""}${clampedOffset > 0 ? ` (+${clampedOffset} newer below)` : ""}${hasOlder ? " · o older" : ""} · r refresh · esc back${followSupported ? "" : ""}`}
        width={contentWidth}
      />
    </Surface>
  )
}

function FilterStrip({
  filter,
  editingTarget,
  targetInput,
  width,
}: {
  filter: LogFilterState
  editingTarget: boolean
  targetInput: string
  width: number
}) {
  const targetValue = editingTarget ? `${targetInput}▏` : filter.target || "all"
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg={theme.textMuted}>level </text>
      <text fg={statusColor(filter.level ?? "info")}>{logLevelLabel(filter.level)}</text>
      <text fg={theme.textFaint}> · target </text>
      <text fg={editingTarget ? theme.accentText : theme.text}>{truncate(targetValue, 24)}</text>
      {filter.threadId ? <text fg={theme.textFaint}> · thread {truncate(filter.threadId, 12)}</text> : null}
      <text fg={theme.textFaint}> · </text>
      <text fg={filter.follow ? theme.info : theme.textFaint}>{filter.follow ? "following" : "paused"}</text>
    </box>
  )
}

function LogRow({ entry, width }: { entry: LogEntry; width: number }) {
  const time = formatLogTime(entry.timestamp)
  const level = entry.level.toUpperCase()
  const meta = `${time} ${level.padEnd(5)} ${entry.target}`
  const messageWidth = Math.max(8, width - meta.length - 2)
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg={theme.textFaint}>{time} </text>
      <text fg={statusColor(entry.level)}>{level.padEnd(5)} </text>
      <text fg={theme.textMuted}>{truncate(entry.target, 20)} </text>
      <text fg={theme.text}>{truncate(entry.message, messageWidth)}</text>
    </box>
  )
}

function formatLogTime(value: string): string {
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return "--:--:--"
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

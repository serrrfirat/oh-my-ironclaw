import type { AutomationInfo } from "../gateway/types"
import { theme, statusColor, statusTone } from "./theme"
import { Field, Hairline, Hint, Tag, truncate, wrapIndex } from "./pixel"

const AUTOMATION_VISIBLE_LIMIT = 14

export function AutomationsSurface({
  automations,
  error,
  height,
  loading,
  selectedIndex,
  schedulerEnabled,
  renaming,
  renameInput,
  confirmingDelete,
  message,
  width,
}: {
  automations: AutomationInfo[]
  error?: string | null
  height: number
  loading: boolean
  selectedIndex: number
  schedulerEnabled?: boolean | null
  renaming?: boolean
  renameInput?: string
  confirmingDelete?: boolean
  message?: string | null
  width: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const selected = automations[wrapIndex(selectedIndex, automations.length)] ?? null
  const summary = automationSummary(automations)
  const narrow = width < 90
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: theme.bg, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="automations" meta={loading ? "loading" : `${automations.length} schedules`} width={contentWidth} />
      <box style={{ height: 1 }} />
      {typeof schedulerEnabled === "boolean" ? (
        <box style={{ height: 1, flexDirection: "row" }}>
          <text fg={theme.textMuted}>scheduler </text>
          <Tag label={schedulerEnabled ? "enabled" : "paused"} tone={schedulerEnabled ? "ok" : "warn"} />
        </box>
      ) : null}
      <SummaryStrip summary={summary} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      {message ? <text fg={theme.accentText}>{truncate(message, contentWidth)}</text> : null}
      {renaming ? (
        <box style={{ width: contentWidth, height: 1, flexDirection: "row", backgroundColor: theme.bgCode, paddingLeft: 1 }}>
          <text fg={theme.accent}>rename › </text>
          <text fg={theme.textStrong}>{`${renameInput ?? ""}▏`}</text>
        </box>
      ) : null}
      {narrow ? (
        <box style={{ flexDirection: "column" }}>
          <AutomationList automations={automations} selectedIndex={selectedIndex} width={contentWidth} />
          <box style={{ height: 1 }} />
          <AutomationDetail automation={selected} confirmingDelete={confirmingDelete} width={contentWidth} />
        </box>
      ) : (
        <box style={{ flexDirection: "row", width: contentWidth }}>
          <AutomationList automations={automations} selectedIndex={selectedIndex} width={Math.min(56, Math.max(34, Math.floor(contentWidth * 0.46)))} />
          <box style={{ width: 2 }} />
          <AutomationDetail automation={selected} confirmingDelete={confirmingDelete} width={Math.max(1, contentWidth - Math.min(56, Math.max(34, Math.floor(contentWidth * 0.46))) - 2)} />
        </box>
      )}
      <box style={{ flexGrow: 1 }} />
      <Hint text={confirmingDelete ? "delete automation? y confirm · n cancel" : "up/down select · p pause · r resume · n rename · d delete · g refresh · esc back"} width={contentWidth} />
    </box>
  )
}

function SurfaceHeader({ title, meta, width }: { title: string; meta: string; width: number }) {
  const spacer = Math.max(1, width - 10 - title.length - meta.length - 4)
  return (
    <box style={{ width, height: 2, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={theme.accent}>◆ </text>
        <text fg={theme.textStrong}>ironclaw</text>
        <text fg={theme.textFaint}>{" ".repeat(spacer)}</text>
        <text fg={theme.text}>{title}</text>
        <text fg={theme.textFaint}> · {meta}</text>
      </box>
      <Hairline width={width} />
    </box>
  )
}

function SummaryStrip({ summary, width }: { summary: { scheduled: number; active: number; paused: number; nextRun: string | null }; width: number }) {
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg={theme.ok}>active {summary.active}</text>
      <text fg={theme.textFaint}> · </text>
      <text fg={theme.text}>scheduled {summary.scheduled}</text>
      <text fg={theme.textFaint}> · </text>
      <text fg={theme.warn}>paused {summary.paused}</text>
      <text fg={theme.textFaint}> · next {truncate(summary.nextRun || "none", Math.max(1, width - 42))}</text>
    </box>
  )
}

function AutomationList({ automations, selectedIndex, width }: { automations: AutomationInfo[]; selectedIndex: number; width: number }) {
  const selected = wrapIndex(selectedIndex, automations.length)
  const start = Math.min(Math.max(0, selected - AUTOMATION_VISIBLE_LIMIT + 1), Math.max(0, automations.length - AUTOMATION_VISIBLE_LIMIT))
  const visible = automations.slice(start, start + AUTOMATION_VISIBLE_LIMIT)
  return (
    <box style={{ width, flexDirection: "column" }}>
      {visible.length ? (
        visible.map((automation, index) => (
          <AutomationRow key={automation.automation_id} automation={automation} selected={start + index === selected} width={width} />
        ))
      ) : (
        <box style={{ height: 1, paddingLeft: 2 }}>
          <text fg={theme.textMuted}>No automations</text>
        </box>
      )}
    </box>
  )
}

function AutomationRow({ automation, selected, width }: { automation: AutomationInfo; selected: boolean; width: number }) {
  const state = stateLabel(automation.state)
  return (
    <box style={{ width, height: 1, flexDirection: "row", backgroundColor: selected ? theme.accentSoftBg : theme.bg }}>
      <box style={{ width: 1, backgroundColor: selected ? theme.accent : theme.border }} />
      <text fg={selected ? theme.accent : theme.textMuted}> {selected ? "›" : " "} </text>
      <text fg={selected ? theme.accentText : theme.text}>{truncate(automation.name || "Untitled automation", Math.max(8, width - 18))}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={statusColor(automation.state)}>{truncate(state, 10)}</text>
    </box>
  )
}

function AutomationDetail({ automation, confirmingDelete, width }: { automation: AutomationInfo | null; confirmingDelete?: boolean; width: number }) {
  if (!automation) {
    return (
      <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
        <text fg={theme.textMuted}>Select an automation</text>
      </box>
    )
  }
  const fields: Array<[string, string]> = [
    ["id", automation.automation_id],
    ["state", stateLabel(automation.state)],
    ["schedule", scheduleLabel(automation.source?.cron)],
    ["next run", formatDate(automation.next_run_at, "Not scheduled")],
    ["last run", formatDate(automation.last_run_at, "No runs yet")],
    ["last status", automation.last_status ? automation.last_status : "No result"],
    ["created", formatDate(automation.created_at, "Unknown")],
  ]
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={theme.textStrong}>{truncate(automation.name || "Untitled automation", Math.max(1, width - 14))} </text>
        <Tag label={stateLabel(automation.state)} tone={statusTone(automation.state)} />
      </box>
      <box style={{ height: 1 }} />
      {fields.map(([label, value]) => <Field key={label} label={label} value={value} width={width - 4} labelWidth={14} />)}
      {confirmingDelete ? <text fg={theme.danger}>Delete this automation? y / n</text> : null}
    </box>
  )
}

function automationSummary(automations: AutomationInfo[]) {
  const active = automations.filter((automation) => automation.state === "active" || automation.state === "scheduled" || automation.is_active).length
  const paused = automations.filter((automation) => ["paused", "disabled", "inactive"].includes(automation.state)).length
  const next = automations
    .filter((automation) => parseDate(automation.next_run_at) !== null)
    .sort((a, b) => (parseDate(a.next_run_at) ?? Number.MAX_SAFE_INTEGER) - (parseDate(b.next_run_at) ?? Number.MAX_SAFE_INTEGER))[0]
  return {
    scheduled: automations.length,
    active,
    paused,
    nextRun: next ? formatDate(next.next_run_at, "none") : null,
  }
}

function scheduleLabel(cron?: string | null): string {
  if (!cron) return "Custom schedule"
  const parts = cron.trim().split(/\s+/)
  const fields = parts.length === 5 ? parts : parts.length >= 6 && /^0+$/.test(parts[0] ?? "") ? parts.slice(1) : null
  if (!fields || fields.length < 5) return "Custom schedule"
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (!singleNumber(hour, 0, 23) || !singleNumber(minute, 0, 59)) return "Custom schedule"
  const time = formatCronTime(Number(hour), Number(minute))
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return `Every day at ${time}`
  if (dayOfMonth === "*" && month === "*" && (dayOfWeek === "1-5" || dayOfWeek.toUpperCase() === "MON-FRI")) return `Weekdays at ${time}`
  return cron
}

function formatCronTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM"
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${period}`
}

function singleNumber(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false
  const parsed = Number(value)
  return parsed >= min && parsed <= max
}

function stateLabel(state: string): string {
  return state ? state.replaceAll("_", " ") : "unknown"
}

function formatDate(value?: string | null, fallback = "Unknown"): string {
  const timestamp = parseDate(value)
  if (timestamp === null) return fallback
  return new Date(timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function parseDate(value?: string | null): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

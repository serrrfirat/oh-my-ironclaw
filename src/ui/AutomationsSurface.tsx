import type { AutomationInfo } from "../gateway/types"

const AUTOMATION_VISIBLE_LIMIT = 14

export function AutomationsSurface({
  automations,
  error,
  height,
  loading,
  selectedIndex,
  width,
}: {
  automations: AutomationInfo[]
  error?: string | null
  height: number
  loading: boolean
  selectedIndex: number
  width: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const selected = automations[wrapIndex(selectedIndex, automations.length)] ?? null
  const summary = automationSummary(automations)
  const narrow = width < 90
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="automations" meta={loading ? "loading" : `${automations.length} schedules`} width={contentWidth} />
      <box style={{ height: 1 }} />
      <SummaryStrip summary={summary} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg="#f08a8a">{truncate(error, contentWidth)}</text> : null}
      {narrow ? (
        <box style={{ flexDirection: "column" }}>
          <AutomationList automations={automations} selectedIndex={selectedIndex} width={contentWidth} />
          <box style={{ height: 1 }} />
          <AutomationDetail automation={selected} width={contentWidth} />
        </box>
      ) : (
        <box style={{ flexDirection: "row", width: contentWidth }}>
          <AutomationList automations={automations} selectedIndex={selectedIndex} width={Math.min(56, Math.max(34, Math.floor(contentWidth * 0.46)))} />
          <box style={{ width: 2 }} />
          <AutomationDetail automation={selected} width={Math.max(1, contentWidth - Math.min(56, Math.max(34, Math.floor(contentWidth * 0.46))) - 2)} />
        </box>
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg="#777777">{truncate("up/down select · r refresh · esc back", contentWidth)}</text>
    </box>
  )
}

function SummaryStrip({
  summary,
  width,
}: {
  summary: { scheduled: number; active: number; paused: number; nextRun: string | null }
  width: number
}) {
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg="#8cffb0">active {summary.active}</text>
      <text fg="#777777"> · </text>
      <text fg="#d0d0d0">scheduled {summary.scheduled}</text>
      <text fg="#777777"> · </text>
      <text fg="#ffb887">paused {summary.paused}</text>
      <text fg="#777777"> · next {truncate(summary.nextRun || "none", Math.max(1, width - 42))}</text>
    </box>
  )
}

function AutomationList({
  automations,
  selectedIndex,
  width,
}: {
  automations: AutomationInfo[]
  selectedIndex: number
  width: number
}) {
  const selected = wrapIndex(selectedIndex, automations.length)
  const start = clamp(selected - AUTOMATION_VISIBLE_LIMIT + 1, 0, Math.max(0, automations.length - AUTOMATION_VISIBLE_LIMIT))
  const visible = automations.slice(start, start + AUTOMATION_VISIBLE_LIMIT)
  return (
    <box style={{ width, flexDirection: "column" }}>
      {visible.length ? visible.map((automation, index) => (
        <AutomationRow
          key={automation.automation_id}
          automation={automation}
          selected={start + index === selected}
          width={width}
        />
      )) : (
        <box style={{ height: 3, backgroundColor: "#101010", paddingLeft: 2, paddingTop: 1 }}>
          <text fg="#777777">No automations</text>
        </box>
      )}
    </box>
  )
}

function AutomationRow({
  automation,
  selected,
  width,
}: {
  automation: AutomationInfo
  selected: boolean
  width: number
}) {
  const marker = selected ? ">" : " "
  const state = stateLabel(automation.state)
  return (
    <box style={{ height: 1, flexDirection: "row", backgroundColor: selected ? "#1b1b1b" : "#101010", paddingLeft: 2, paddingRight: 2 }}>
      <text fg={selected ? "#2ee66b" : "#707070"}>{marker} </text>
      <text fg={selected ? "#f2f2f2" : "#d0d0d0"}>{truncate(automation.name || "Untitled automation", Math.max(8, width - 18))}</text>
      <text fg={stateColor(automation.state)}> {truncate(state, 10)}</text>
    </box>
  )
}

function AutomationDetail({ automation, width }: { automation: AutomationInfo | null; width: number }) {
  if (!automation) {
    return (
      <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
        <text fg="#777777">Select an automation</text>
      </box>
    )
  }
  const fields = [
    ["id", automation.automation_id],
    ["state", stateLabel(automation.state)],
    ["schedule", scheduleLabel(automation.source?.cron)],
    ["next run", formatDate(automation.next_run_at, "Not scheduled")],
    ["last run", formatDate(automation.last_run_at, "No runs yet")],
    ["last status", automation.last_status ? automation.last_status : "No result"],
    ["created", formatDate(automation.created_at, "Unknown")],
  ]
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <text fg="#f2f2f2">{truncate(automation.name || "Untitled automation", Math.max(1, width - 4))}</text>
      <box style={{ height: 1 }} />
      {fields.map(([label, value]) => <Field key={label} label={label} value={value} width={width - 4} />)}
    </box>
  )
}

function Field({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = 14
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg="#8a8a8a">{padEnd(label, labelWidth)}</text>
      <text fg="#d0d0d0">{truncate(value, Math.max(1, width - labelWidth))}</text>
    </box>
  )
}

function SurfaceHeader({ title, meta, width }: { title: string; meta: string; width: number }) {
  return (
    <box style={{ width, height: 2, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#8cffb0">ironclaw</text>
        <text fg="#777777">{padEnd("", Math.max(1, width - title.length - meta.length - 12))}</text>
        <text fg="#d0d0d0">{title}</text>
        <text fg="#777777"> · {meta}</text>
      </box>
      <text fg="#1f1f1f">{padEnd("", width).replaceAll(" ", "-")}</text>
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
    nextRun: next ? formatDate(next.next_run_at, null) : null,
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

function stateColor(state: string): string {
  if (state === "active" || state === "scheduled" || state === "completed") return "#8cffb0"
  if (state === "paused" || state === "disabled" || state === "inactive") return "#ffb887"
  return "#777777"
}

function formatDate(value?: string | null, fallback: string | null = "Unknown"): string {
  const timestamp = parseDate(value)
  if (timestamp === null) return fallback ?? ""
  return new Date(timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function parseDate(value?: string | null): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function padEnd(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length)
}

function truncate(value: string, width: number) {
  if (width <= 0) return ""
  if (value.length <= width) return value
  if (width <= 3) return ".".repeat(width)
  return `${value.slice(0, width - 3)}...`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

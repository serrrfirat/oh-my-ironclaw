import type { AutomationInfo } from "../gateway/types"

// Pure selectors that turn existing app state + fetched lists into the homepage
// (control-room) view-model. No React, no fetch, no Date.now() — callers pass
// `nowMs` in so ages are deterministic and testable, matching the codebase's
// pattern. Every selector is total: empty/missing inputs yield empty rows.

// ---- View-model row types (rendered by HomeSurface) ----

export interface NeedsYouRow {
  threadId: string
  threadTitle: string
  kind: "approval" | "auth" | "failed"
  detail: string
  ageLabel: string
}

export interface ActiveRow {
  threadId: string
  threadTitle: string
  phase: string
  elapsedLabel: string
}

export interface HomeVitals {
  connected: boolean
  model: string
  credits?: string | null
  todayCost?: string | null
  pendingApprovals: number
}

export interface AutomationsSummary {
  schedulerEnabled: boolean
  pausedCount: number
  heldCount: number
  nextLabel?: string | null
}

// ---- Input shapes (wave 2 populates these from UiState + client results) ----

// A pending gate blocking a thread on the user. `challengeKind` distinguishes an
// authentication challenge (oauth / manual token) from a plain tool approval —
// it maps 1:1 from PendingGateInfo.challenge_kind. `sinceMs` is when the gate was
// raised (epoch ms); absent when unknown.
export interface HomeGateInput {
  threadId: string
  threadTitle: string
  challengeKind?: string | null
  detail?: string | null
  sinceMs?: number | null
}

// A run that reached a terminal failure state and still needs the user (retry /
// recover). Mirrors the failed run_status / run_cancelled path in state.ts.
export interface HomeFailedRunInput {
  threadId: string
  threadTitle: string
  detail?: string | null
  sinceMs?: number | null
}

// An automation that needs attention. The gateway's AutomationInfo has no "held"
// state, so wave 2 derives this from a failed last run (last_status === "error")
// or an equivalent hold signal. Automations have no thread association, so the
// automation id is surfaced as the row's threadId (wave 2 routes it to
// /automations rather than a conversation).
export interface HomeHeldAutomationInput {
  automationId: string
  name: string
  detail?: string | null
  sinceMs?: number | null
}

// A thread with a run in flight. `status` is the raw run-status projection
// (running / thinking / reflecting / typing / tool_running / …); `capabilityId`
// enriches a tool phase into "tool:<cap>". `startedAtMs` drives the elapsed
// label.
export interface HomeActiveRunInput {
  threadId: string
  threadTitle: string
  status: string
  capabilityId?: string | null
  startedAtMs?: number | null
}

export interface HomeInputs {
  connected: boolean
  model: string
  credits?: string | null
  todayCost?: string | null
  pendingApprovals: number
  gates: HomeGateInput[]
  failedRuns: HomeFailedRunInput[]
  activeRuns: HomeActiveRunInput[]
  heldAutomations: HomeHeldAutomationInput[]
}

// ---- Selectors ----

// NEEDS YOU: pending gates/auth + failed runs + held automations, oldest-first.
// Rows without a known timestamp sort after dated rows and render an em-dash age.
export function buildNeedsYou(input: HomeInputs, nowMs: number): NeedsYouRow[] {
  const gates: RankedRow[] = (input.gates ?? []).map((gate) => ({
    sinceMs: gate.sinceMs ?? null,
    row: {
      threadId: gate.threadId,
      threadTitle: displayTitle(gate.threadTitle),
      kind: gate.challengeKind ? "auth" : "approval",
      detail: (gate.detail ?? "").trim() || (gate.challengeKind ? "authentication required" : "approval required"),
      ageLabel: ageLabelFor(gate.sinceMs, nowMs),
    },
  }))
  const failed: RankedRow[] = (input.failedRuns ?? []).map((run) => ({
    sinceMs: run.sinceMs ?? null,
    row: {
      threadId: run.threadId,
      threadTitle: displayTitle(run.threadTitle),
      kind: "failed",
      detail: (run.detail ?? "").trim() || "run failed",
      ageLabel: ageLabelFor(run.sinceMs, nowMs),
    },
  }))
  const held: RankedRow[] = (input.heldAutomations ?? []).map((automation) => ({
    sinceMs: automation.sinceMs ?? null,
    row: {
      threadId: automation.automationId,
      threadTitle: displayTitle(automation.name),
      kind: "failed",
      detail: (automation.detail ?? "").trim() || "automation needs attention",
      ageLabel: ageLabelFor(automation.sinceMs, nowMs),
    },
  }))
  return [...gates, ...failed, ...held].sort(byOldestFirst).map((ranked) => ranked.row)
}

// ACTIVE: threads with a run in flight, phase projected from the run status.
export function buildActiveRows(input: HomeInputs, nowMs: number): ActiveRow[] {
  return (input.activeRuns ?? [])
    .filter((run) => !isTerminalStatus(run.status))
    .map((run) => ({
      threadId: run.threadId,
      threadTitle: displayTitle(run.threadTitle),
      phase: projectPhase(run.status, run.capabilityId),
      elapsedLabel: ageLabelFor(run.startedAtMs, nowMs),
    }))
}

export function buildVitals(input: HomeInputs): HomeVitals {
  return {
    connected: input.connected,
    model: input.model || "—",
    credits: input.credits ?? null,
    todayCost: input.todayCost ?? null,
    pendingApprovals: Math.max(0, input.pendingApprovals ?? 0),
  }
}

// AUTOMATIONS summary. pausedCount = paused/disabled/inactive; heldCount =
// automations whose last run errored (last_status === "error"); nextLabel = the
// soonest upcoming next_run_at as an ISO string (HomeSurface formats it).
export function buildAutomationsSummary(
  automations: AutomationInfo[],
  schedulerEnabled: boolean,
): AutomationsSummary {
  const list = automations ?? []
  const pausedCount = list.filter((automation) =>
    ["paused", "disabled", "inactive"].includes(automation.state),
  ).length
  const heldCount = list.filter((automation) => automation.last_status === "error").length
  const next = list
    .map((automation) => parseMs(automation.next_run_at))
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b)[0]
  return {
    schedulerEnabled,
    pausedCount,
    heldCount,
    nextLabel: next !== undefined ? new Date(next).toISOString() : null,
  }
}

// Where an Enter on the flat home selection routes. A held-automation NEEDS YOU
// row (its threadId is an automation id, not a thread) routes to /automations;
// every other row opens its thread.
export type HomeTarget = { kind: "thread"; threadId: string } | { kind: "automations" }

// Total number of selectable rows in the flat home list (NEEDS YOU + ACTIVE +
// RECENT). Section headers and the automations summary line are not selectable.
export function homeSelectableCount(input: HomeInputs, recentCount: number, nowMs: number): number {
  return buildNeedsYou(input, nowMs).length + buildActiveRows(input, nowMs).length + Math.max(0, recentCount)
}

// Resolve the Enter target for a flat selection index over [needsYou…, active…,
// recent…]. Rebuilds the same ordering HomeSurface renders so the parent can
// route without duplicating the layout. Held-automation rows (threadId matches a
// held automation id) route to /automations; all others open their thread.
// Returns null when the index is out of range.
export function resolveHomeTarget(
  input: HomeInputs,
  recentThreadIds: string[],
  nowMs: number,
  selectedIndex: number,
): HomeTarget | null {
  const needsYou = buildNeedsYou(input, nowMs)
  const active = buildActiveRows(input, nowMs)
  const heldIds = new Set((input.heldAutomations ?? []).map((automation) => automation.automationId))
  const flat: HomeTarget[] = [
    ...needsYou.map((row): HomeTarget =>
      heldIds.has(row.threadId) ? { kind: "automations" } : { kind: "thread", threadId: row.threadId },
    ),
    ...active.map((row): HomeTarget => ({ kind: "thread", threadId: row.threadId })),
    ...recentThreadIds.map((threadId): HomeTarget => ({ kind: "thread", threadId })),
  ]
  if (selectedIndex < 0 || selectedIndex >= flat.length) return null
  return flat[selectedIndex] ?? null
}

// Format a USD amount as "$X.XX" (four decimals under a cent). Used for the home
// vitals credits + today's spend. Non-finite input yields null (render nothing).
export function formatUsd(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null
  const value = Number(amount)
  return `$${value.toFixed(Math.abs(value) < 0.01 && value !== 0 ? 4 : 2)}`
}

// "2m", "1h 04m", "3d". Sub-minute → "Ns"; negative clamps to "0s".
export function formatAge(deltaMs: number): string {
  const clamped = Math.max(0, Math.floor(deltaMs))
  const seconds = Math.floor(clamped / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

// ---- internals ----

type RankedRow = { sinceMs: number | null; row: NeedsYouRow }

function byOldestFirst(a: RankedRow, b: RankedRow): number {
  const left = a.sinceMs ?? Number.POSITIVE_INFINITY
  const right = b.sinceMs ?? Number.POSITIVE_INFINITY
  return left - right
}

function ageLabelFor(sinceMs: number | null | undefined, nowMs: number): string {
  if (sinceMs === null || sinceMs === undefined) return "—"
  return formatAge(nowMs - sinceMs)
}

function displayTitle(title: string | null | undefined): string {
  const trimmed = (title ?? "").trim()
  return trimmed || "New session"
}

function parseMs(value?: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// Normalize an arbitrary status string to a canon key (matches state.ts/theme.ts).
function statusKey(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

function isTerminalStatus(status: string): boolean {
  return [
    "completed",
    "done",
    "succeeded",
    "idle",
    "failed",
    "cancelled",
    "canceled",
    "killed",
    "recovery_required",
  ].includes(statusKey(status))
}

function projectPhase(status: string, capabilityId?: string | null): string {
  const key = statusKey(status)
  switch (key) {
    case "tool_running":
    case "tool":
      return capabilityId ? `tool:${capabilityId}` : "using tools"
    case "thinking":
      return "thinking"
    case "reflecting":
      return "reflecting"
    case "reasoning":
      return "reasoning"
    case "typing":
    case "streaming":
      return "writing"
    case "waiting":
      return "waiting"
    case "accepted":
    case "queued":
    case "running":
      return "running"
    default:
      return status.replaceAll("_", " ")
  }
}

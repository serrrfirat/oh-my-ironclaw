import type {
  AppEvent,
  ApprovalContext,
  HistoryResponse,
  PendingGateInfo,
  RebornRunCost,
  RebornRunUsage,
  SessionResponse,
  ThreadInfo,
} from "./gateway/types"
import {
  capabilityDisplayPreviewDetail,
  capabilityEventActivity,
  capabilityPreviewTranscriptId,
  capabilityPreviewEventActivity,
  hasAssistantAfterLatestUser,
  mergeHistoryTranscript,
  mergeTranscript,
  transcriptFromHistory,
  upsertCapabilityTranscriptItem,
  upsertTranscriptItem,
  type TranscriptItem,
} from "./transcript"

export { transcriptActivityLines, toolSummary } from "./transcript"
export type { TranscriptActivity, TranscriptItem } from "./transcript"

export type ActivityItem = {
  id: string
  label: string
  detail?: string
  status: "running" | "ok" | "error" | "info"
  kind?: string
}

// Per-run token usage + USD cost for the status bar, captured from the failed
// run_state SSE event (and any future run-state read). Tagged with the run and
// thread it belongs to so a stale value from a previous run/thread is never
// rendered against the current context.
export type RunUsageCost = {
  runId?: string | null
  threadId?: string | null
  usage?: RebornRunUsage | null
  cost?: RebornRunCost | null
}

export type UiState = {
  connected: boolean
  status: string
  isThinking: boolean
  activeThreadId?: string | null
  activeRunId?: string | null
  threads: ThreadInfo[]
  transcript: TranscriptItem[]
  historyCursor?: string | null
  hasOlderHistory: boolean
  activity: ActivityItem[]
  pendingGate?: PendingGateInfo | null
  lastError?: string | null
  streamingAssistantId?: string | null
  // GET /session snapshot, drives UI capability/feature gating. Null until fetched.
  session?: SessionResponse | null
  // Non-error notice (e.g. rejected_busy). Cleared when a new run starts.
  notice?: string | null
  // Latest per-run usage/cost for the status bar.
  runUsageCost?: RunUsageCost | null
  // Run id of the most recent run that reached a terminal state
  // (failed/cancelled/killed/recovery_required). Cleared on run_started.
  // Used by /retry to target the last terminal run.
  lastTerminalRunId?: string | null
  // Count of threads waiting on approval (approval-inbox badge).
  approvalCount: number
}

export const initialUiState: UiState = {
  connected: false,
  status: "starting",
  isThinking: false,
  activeRunId: null,
  threads: [],
  transcript: [],
  historyCursor: null,
  hasOlderHistory: false,
  activity: [],
  pendingGate: null,
  session: null,
  notice: null,
  runUsageCost: null,
  lastTerminalRunId: null,
  approvalCount: 0,
}

export type UiAction =
  | { type: "connected"; connected: boolean; status?: string }
  | { type: "error"; message: string }
  | { type: "threads"; threads: ThreadInfo[]; activeThreadId?: string | null }
  | { type: "history"; history: HistoryResponse }
  | { type: "older_history"; history: HistoryResponse }
  | { type: "run_started"; threadId?: string | null; runId?: string | null; status?: string | null }
  | { type: "user_sent"; content: string; threadId?: string | null }
  | { type: "event"; event: AppEvent }
  | { type: "gate_cleared" }
  | { type: "session"; session: SessionResponse }
  | { type: "notice"; message: string | null }
  | { type: "approval_count"; count: number }

export function reduceUiState(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: action.connected, status: action.status ?? state.status }
    case "error":
      return {
        ...state,
        isThinking: false,
        lastError: action.message,
        status: "error",
        activity: pushActivity(state.activity, {
          id: `error-${Date.now()}`,
          label: "error",
          detail: action.message,
          status: "error",
        }),
      }
    case "threads":
      return { ...state, threads: action.threads, activeThreadId: action.activeThreadId ?? state.activeThreadId }
    case "history": {
      const pendingGate = pendingGateFromHistory(state, action.history)
      const threadSwitched = Boolean(state.activeThreadId) && action.history.thread_id !== state.activeThreadId
      return {
        ...state,
        activeThreadId: action.history.thread_id,
        transcript: mergeHistoryTranscript(state.transcript, action.history),
        historyCursor: action.history.next_cursor ?? null,
        hasOlderHistory: Boolean(action.history.next_cursor),
        runUsageCost: threadSwitched ? null : state.runUsageCost,
        pendingGate,
        activeRunId: pendingGate?.run_id ?? (action.history.in_progress ? state.activeRunId : null),
        status: action.history.in_progress ? action.history.in_progress.state : "idle",
        isThinking: pendingGate
          ? false
          : Boolean(action.history.in_progress) || (state.isThinking && !hasAssistantAfterLatestUser(action.history)),
      }
    }
    case "older_history":
      return {
        ...state,
        transcript: mergeTranscript(transcriptFromHistory(action.history), state.transcript),
        historyCursor: action.history.next_cursor ?? null,
        hasOlderHistory: Boolean(action.history.next_cursor),
      }
    case "session":
      return { ...state, session: action.session }
    case "notice":
      return { ...state, notice: action.message }
    case "approval_count":
      return { ...state, approvalCount: action.count }
    case "run_started":
      return {
        ...state,
        activeThreadId: action.threadId ?? state.activeThreadId,
        activeRunId: action.runId ?? state.activeRunId,
        status: action.status ?? "running",
        isThinking: true,
        notice: null,
        runUsageCost: null,
        lastTerminalRunId: null,
      }
    case "user_sent":
      return {
        ...state,
        status: "sent",
        isThinking: true,
        notice: null,
        runUsageCost: null,
        activity: clearRunningActivity(state.activity),
        transcript: [
          ...state.transcript,
          {
            id: `user-${Date.now()}`,
            role: "user",
            text: action.content,
            threadId: action.threadId,
            meta: { sentAtMs: Date.now() },
          },
        ],
      }
    case "gate_cleared":
      return { ...state, pendingGate: null }
    case "event":
      return applyEvent(state, action.event)
  }
}

function applyEvent(state: UiState, event: AppEvent): UiState {
  switch (event.type) {
    case "heartbeat":
      return { ...state, connected: true }
    case "thinking":
      return {
        ...state,
        status: event.message,
        isThinking: true,
        activity: upsertActivity(state.activity, {
          id: progressActivityId(event.thread_id ?? state.activeThreadId, event.message),
          label: progressLabel(event.message),
          detail: progressDetail(event.message),
          status: "running",
          kind: event.message,
        }),
      }
    case "thinking_update":
      return applyThinkingUpdate(state, event)
    case "work_summary_update":
      return applyWorkSummaryUpdate(state, event)
    case "skill_activated":
      return applySkillActivated(state, event)
    case "status":
      return { ...state, status: event.message }
    case "run_status":
      if (isFailedRunStatus(event.status)) {
        return applyTerminalRun(
          state,
          event.run_id,
          event.status,
          event.thread_id,
          runFailureMessage(statusKey(event.status), event.failure_category),
        )
      }
      return {
        ...state,
        status: event.status,
        activeRunId: isTrackedRunStatus(event.status) ? event.run_id ?? state.activeRunId : null,
        isThinking: isThinkingRunStatus(event.status),
      }
    case "run_cancelled": {
      const cancelledStatus = event.status ?? "cancelled"
      return applyTerminalRun(
        state,
        event.run_id,
        cancelledStatus,
        event.thread_id,
        runFailureMessage(statusKey(cancelledStatus)),
      )
    }
    case "run_usage":
      return {
        ...state,
        runUsageCost: { runId: event.run_id, threadId: event.thread_id, usage: event.usage, cost: event.cost },
      }
    case "notice":
      return { ...state, notice: event.message }
    case "stream_chunk":
      return appendAssistantChunk(state, event.content, event.thread_id)
    case "response":
      return finalizeAssistant(state, event.content, event.thread_id)
    case "tool_started":
      return {
        ...state,
        isThinking: true,
        status: `running ${event.name}`,
        activity: upsertActivity(state.activity, {
          id: event.call_id ?? progressActivityId(event.thread_id ?? state.activeThreadId, event.name),
          label: progressLabel(event.name),
          detail: event.detail ?? progressDetail(event.name),
          status: "running",
          kind: event.name,
        }),
      }
    case "tool_completed":
      return {
        ...state,
        isThinking: true,
        status: event.success ? `${event.name} completed` : `${event.name} failed`,
        activity: upsertActivity(state.activity, {
          id: event.call_id ?? `${event.name}-${Date.now()}`,
          label: event.name,
          detail: event.error ?? event.parameters ?? undefined,
          status: event.success ? "ok" : "error",
        }),
      }
    case "tool_result":
      return {
        ...state,
        activity: pushActivity(state.activity, {
          id: event.call_id ?? `result-${Date.now()}`,
          label: `${event.name} result`,
          detail: event.preview,
          status: "info",
        }),
      }
    case "capability_activity":
      return applyCapabilityActivity(state, event)
    case "capability_display_preview":
      return applyCapabilityDisplayPreview(state, event)
    case "reasoning_update":
      return {
        ...state,
        isThinking: true,
        status: "reasoning",
        activity: pushActivity(state.activity, {
          id: `reasoning-${Date.now()}`,
          label: "reasoning",
          detail: event.narrative,
          status: "info",
        }),
      }
    case "gate_required":
    case "approval_needed": {
      const pendingGate = toPendingGate(event, state)
      return {
        ...state,
        isThinking: false,
        status: "waiting for approval",
        activeRunId: pendingGate.run_id ?? state.activeRunId,
        pendingGate,
      }
    }
    case "gate_resolved":
      return { ...state, pendingGate: null, status: event.message, isThinking: true }
    case "onboarding_state":
      return {
        ...state,
        status: `${event.extension_name}: ${event.state}`,
        activity: pushActivity(state.activity, {
          id: `onboarding-${Date.now()}`,
          label: `${event.extension_name} ${event.state}`,
          detail: event.message ?? event.instructions ?? event.auth_url ?? event.setup_url ?? undefined,
          status: event.state === "failed" ? "error" : "info",
        }),
      }
    case "warning":
      return {
        ...state,
        activity: pushActivity(state.activity, {
          id: `warning-${Date.now()}`,
          label: event.source ? `${event.source} warning` : "warning",
          detail: event.message,
          status: "info",
        }),
      }
    case "error":
      return reduceUiState(state, { type: "error", message: event.message })
    default:
      return state
  }
}

// Build a PendingGateInfo from either gate_required or approval_needed. Both
// reducer cases share this so the field mapping can never drift. Optional wire
// fields are read defensively — approval_needed's AppEvent type omits several of
// them, but the runtime frame may still carry them (e.g. approval_context).
function toPendingGate(
  event: Extract<AppEvent, { type: "gate_required" }> | Extract<AppEvent, { type: "approval_needed" }>,
  state: UiState,
): PendingGateInfo {
  const loose = event as {
    run_id?: string | null
    gate_ref?: string | null
    gate_name?: string
    extension_name?: string | null
    provider?: string | null
    account_label?: string | null
    challenge_kind?: string | null
    authorization_url?: string | null
    expires_at?: string | null
    allow_always?: boolean
    approval_context?: ApprovalContext | null
    resume_kind?: unknown
  }
  const runId = loose.run_id ?? state.activeRunId ?? null
  const allowAlways = loose.allow_always ?? false
  return {
    request_id: event.request_id,
    thread_id: event.thread_id ?? state.activeThreadId ?? "",
    run_id: runId,
    gate_ref: loose.gate_ref ?? null,
    gate_name: loose.gate_name ?? "approval",
    tool_name: event.tool_name,
    description: event.description,
    parameters: event.parameters,
    extension_name: loose.extension_name,
    provider: loose.provider,
    account_label: loose.account_label,
    challenge_kind: loose.challenge_kind,
    authorization_url: loose.authorization_url,
    expires_at: loose.expires_at,
    allow_always: allowAlways,
    approval_context: loose.approval_context ?? null,
    resume_kind: loose.resume_kind ?? { kind: "approval", allow_always: allowAlways },
  }
}

// Single terminal-run path shared by run_status (failed/killed/recovery_required/
// cancelled) and the run_cancelled event so the two frames can never produce
// diverging state. Semantics:
//   cancelled → info tone, "run cancelled", clears the gate, leaves lastError
//   failed/killed/recovery_required → error tone, sets lastError, clears the gate
// A terminal run can never have a live gate, so pendingGate is always cleared.
// Dedupe id prefers the frame's run_id, then the tracked activeRunId, then a
// synthetic timestamp id so a null run_id never collapses distinct runs.
function applyTerminalRun(
  state: UiState,
  runId: string | null | undefined,
  status: string,
  threadId: string | null | undefined,
  detail: string,
): UiState {
  const key = statusKey(status)
  const cancelled = key === "cancelled"
  const resolvedRunId = runId ?? state.activeRunId ?? null
  const id = resolvedRunId ? `run-${resolvedRunId}-${key}` : `run-${key}-${Date.now()}`
  const transcript = state.transcript.some((item) => item.id === id)
    ? state.transcript
    : [
        ...state.transcript,
        {
          id,
          role: "system" as const,
          text: detail,
          threadId,
          state: status,
        },
      ]

  return {
    ...state,
    status,
    isThinking: false,
    activeRunId: null,
    pendingGate: null,
    lastError: cancelled ? state.lastError : detail,
    lastTerminalRunId: resolvedRunId,
    transcript,
    activity: upsertActivity(state.activity, {
      id,
      label: cancelled ? "run cancelled" : "run failed",
      detail,
      status: cancelled ? "info" : "error",
    }),
  }
}

function assistantTimingMeta(
  state: UiState,
  item?: TranscriptItem,
  completedAtMs?: number,
): TranscriptItem["meta"] {
  const sentAtMs = item?.meta?.sentAtMs ?? latestUserSentAtMs(state.transcript)
  const meta: TranscriptItem["meta"] = { ...item?.meta }
  if (sentAtMs) meta.sentAtMs = sentAtMs
  if (completedAtMs) {
    meta.completedAtMs = completedAtMs
    if (sentAtMs) meta.durationMs = Math.max(0, completedAtMs - sentAtMs)
  }
  return meta
}

function pendingGateFromHistory(state: UiState, history: HistoryResponse): PendingGateInfo | null {
  if (history.pending_gate) return history.pending_gate
  const existingGate = state.pendingGate
  if (!existingGate || !history.in_progress) return null
  if (existingGate.thread_id !== history.thread_id) return null
  return existingGate
}

function latestUserSentAtMs(transcript: TranscriptItem[]): number | undefined {
  return [...transcript].reverse().find((item) => item.role === "user" && item.meta?.sentAtMs)?.meta?.sentAtMs
}

function appendAssistantChunk(state: UiState, content: string, threadId?: string | null): UiState {
  const existingId = state.streamingAssistantId
  if (existingId) {
    return {
      ...state,
      status: "streaming",
      isThinking: true,
      transcript: state.transcript.map((item) =>
        item.id === existingId && item.role === "assistant"
          ? { ...item, text: item.text + content, meta: assistantTimingMeta(state, item) }
          : item,
      ),
    }
  }

  const id = `assistant-${Date.now()}`
  return {
    ...state,
    status: "streaming",
    isThinking: true,
    streamingAssistantId: id,
    transcript: [...state.transcript, { id, role: "assistant", text: content, threadId, meta: assistantTimingMeta(state) }],
  }
}

function finalizeAssistant(state: UiState, content: string, threadId: string): UiState {
  const existingId = state.streamingAssistantId
  if (existingId) {
    return {
      ...state,
      status: "idle",
      isThinking: false,
      activeThreadId: threadId,
      activeRunId: null,
      streamingAssistantId: null,
      transcript: state.transcript.map((item) =>
        item.id === existingId && item.role === "assistant"
          ? { ...item, text: content, threadId, meta: assistantTimingMeta(state, item, Date.now()) }
          : item,
      ),
    }
  }

  const completedAtMs = Date.now()
  return {
    ...state,
    status: "idle",
    isThinking: false,
    activeThreadId: threadId,
    activeRunId: null,
    transcript: [
      ...state.transcript,
      {
        id: `assistant-${completedAtMs}`,
        role: "assistant",
        text: content,
        threadId,
        meta: assistantTimingMeta(state, undefined, completedAtMs),
      },
    ],
  }
}

function pushActivity(items: ActivityItem[], item: ActivityItem): ActivityItem[] {
  return [...items, item].slice(-80)
}

function upsertActivity(items: ActivityItem[], item: ActivityItem): ActivityItem[] {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index < 0) return pushActivity(items, item)
  return items.map((existing, current) => (current === index ? item : existing))
}

function clearRunningActivity(items: ActivityItem[]): ActivityItem[] {
  return items.map((item) => (item.status === "running" ? { ...item, status: "info" } : item))
}

function applyCapabilityActivity(
  state: UiState,
  event: Extract<AppEvent, { type: "capability_activity" }>,
): UiState {
  const status = statusKey(event.status)
  const effectiveStatus = event.error_kind ? "failed" : status
  const active = status === "started" || status === "running"
  const failed = effectiveStatus === "failed" || effectiveStatus === "killed"
  const id = `capability-${event.invocation_id}`
  const transcriptActivity = capabilityEventActivity(event)
  const activityItem: ActivityItem = {
    id,
    label: transcriptActivity.title,
    detail: transcriptActivity.detail ?? undefined,
    status: active ? "running" : failed ? "error" : "ok",
    kind: active ? "tool_running" : `tool_${effectiveStatus}`,
  }

  return {
    ...state,
    isThinking: active ? true : state.isThinking,
    status: active ? `running ${event.capability_id}` : state.status,
    activity: upsertActivity(state.activity, activityItem),
    transcript: upsertCapabilityTranscriptItem(state.transcript, {
      id,
      role: "activity",
      threadId: event.thread_id,
      state: event.status,
      activity: transcriptActivity,
      meta: {
        capabilityId: event.capability_id,
        invocationId: event.invocation_id,
      },
    }),
  }
}

function applyCapabilityDisplayPreview(
  state: UiState,
  event: Extract<AppEvent, { type: "capability_display_preview" }>,
): UiState {
  const status = statusKey(event.status)
  const active = status === "started" || status === "running"
  const failed = status === "failed" || status === "killed"
  const id = event.timeline_message_id
    ? capabilityPreviewTranscriptId(event.timeline_message_id)
    : `capability-${event.invocation_id}`
  const transcriptActivity = capabilityPreviewEventActivity(event)

  return {
    ...state,
    isThinking: active ? true : state.isThinking,
    status: active ? `running ${event.capability_id}` : state.status,
    activity: upsertActivity(state.activity, {
      id,
      label: transcriptActivity.title,
      detail: capabilityDisplayPreviewDetail(transcriptActivity),
      status: active ? "running" : failed ? "error" : "ok",
      kind: active ? "tool_running" : `tool_${status}`,
    }),
    transcript: upsertCapabilityTranscriptItem(state.transcript, {
      id,
      role: "activity",
      threadId: event.thread_id,
      state: event.status,
      activity: transcriptActivity,
      meta: {
        capabilityId: event.capability_id,
        invocationId: event.invocation_id,
        timelineMessageId: event.timeline_message_id ?? null,
        resultRef: event.result_ref ?? null,
      },
    }),
  }
}

function applyThinkingUpdate(
  state: UiState,
  event: Extract<AppEvent, { type: "thinking_update" }>,
): UiState {
  const id = `thinking-${event.id}`
  const completedAssistantAfterLatestUser = transcriptHasCompletedAssistantAfterLatestUser(state)
  const thinkingState = completedAssistantAfterLatestUser ? "completed" : "running"
  return {
    ...state,
    isThinking: completedAssistantAfterLatestUser ? state.isThinking : true,
    status: completedAssistantAfterLatestUser ? state.status : "thinking",
    activity: upsertActivity(state.activity, {
      id,
      label: "Thinking",
      detail: event.content,
      status: completedAssistantAfterLatestUser ? "info" : "running",
      kind: "thinking",
    }),
    transcript: upsertThinkingTranscriptItem(state.transcript, {
      id,
      role: "thinking",
      text: event.content,
      threadId: event.thread_id,
      state: thinkingState,
      meta: { projectionId: event.id },
    }),
  }
}

function upsertThinkingTranscriptItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  if (items.some((existing) => existing.id === item.id)) return upsertTranscriptItem(items, item)
  const assistantIndex = firstAssistantAfterLatestUserIndex(items)
  if (assistantIndex < 0) return [...items, item]
  return [...items.slice(0, assistantIndex), item, ...items.slice(assistantIndex)]
}

function transcriptHasCompletedAssistantAfterLatestUser(state: UiState): boolean {
  return firstCompletedAssistantAfterLatestUserIndex(state) >= 0
}

function firstCompletedAssistantAfterLatestUserIndex(state: UiState): number {
  const latestUserIndex = findLastTranscriptIndex(state.transcript, (item) => item.role === "user")
  return state.transcript.findIndex(
    (item, index) =>
      index > latestUserIndex &&
      item.role === "assistant" &&
      (typeof item.meta?.completedAtMs === "number" || (!state.streamingAssistantId && state.status === "idle")),
  )
}

function firstAssistantAfterLatestUserIndex(items: TranscriptItem[]): number {
  const latestUserIndex = findLastTranscriptIndex(items, (item) => item.role === "user")
  return items.findIndex((item, index) => index > latestUserIndex && item.role === "assistant")
}

function findLastTranscriptIndex(items: TranscriptItem[], predicate: (item: TranscriptItem) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as TranscriptItem)) return index
  }
  return -1
}

function applyWorkSummaryUpdate(
  state: UiState,
  event: Extract<AppEvent, { type: "work_summary_update" }>,
): UiState {
  const phase = statusKey(event.phase)
  return {
    ...state,
    isThinking: true,
    status: workSummaryLabel(phase).toLowerCase(),
    activeRunId: event.run_id ?? state.activeRunId,
    activity: upsertActivity(state.activity, {
      id: event.id,
      label: workSummaryLabel(phase),
      detail: event.content,
      status: "running",
      kind: `work_summary_${phase}`,
    }),
  }
}

function workSummaryLabel(phase: string): string {
  switch (phase) {
    case "planning":
      return "Planning"
    case "working":
      return "Working"
    case "waiting":
      return "Waiting"
    case "retrying":
      return "Retrying"
    case "context":
      return "Gathering context"
    default:
      return statusLabel(phase)
  }
}

function applySkillActivated(
  state: UiState,
  event: Extract<AppEvent, { type: "skill_activated" }>,
): UiState {
  const content = skillActivationText(event.skill_names, event.feedback ?? [])
  if (!content) return state
  const id = skillActivationId(event)
  const title = event.skill_names.length === 1
    ? `skill activated ${event.skill_names[0]}`
    : `skill activated ${event.skill_names.join(", ")}`
  const detail = (event.feedback ?? []).join("\n")
  return {
    ...state,
    isThinking: state.isThinking,
    status: "skills activated",
    activeRunId: event.run_id ?? state.activeRunId,
    activity: upsertActivity(state.activity, {
      id,
      label: title,
      detail: detail || undefined,
      status: "info",
      kind: "skill_activation",
    }),
    transcript: upsertCapabilityTranscriptItem(state.transcript, {
      id,
      role: "activity",
      threadId: event.thread_id,
      state: "completed",
      activity: {
        kind: "skill_activation",
        title,
        status: "completed",
        detail,
      },
      meta: { projectionId: event.id ?? id },
    }),
  }
}

function skillActivationText(skillNames: string[], feedback: string[]): string {
  return [
    skillNames.length ? `Skill activated: ${skillNames.join(", ")}` : "",
    ...feedback,
  ]
    .filter(Boolean)
    .join("\n")
}

function skillActivationId(event: Extract<AppEvent, { type: "skill_activated" }>): string {
  return `skill-${event.id ?? (event.skill_names.join("-") || "activation")}`
}

function progressActivityId(threadId: string | null | undefined, kind: string): string {
  return `progress-${threadId ?? "thread"}-${kind}`
}

function progressLabel(kind: string): string {
  switch (statusKey(kind)) {
    case "typing":
      return "Writing response"
    case "reflecting":
      return "Thinking through the next step"
    case "tool_running":
      return "Using tools"
    default:
      return kind.replaceAll("_", " ")
  }
}

function progressDetail(kind: string): string {
  switch (statusKey(kind)) {
    case "typing":
      return "SSE progress: typing"
    case "reflecting":
      return "SSE progress: reflecting"
    case "tool_running":
      return "SSE progress: tool_running"
    default:
      return `SSE progress: ${kind}`
  }
}

function isFailedRunStatus(status: string): boolean {
  return ["failed", "recovery_required", "cancelled", "killed"].includes(statusKey(status))
}

function isTrackedRunStatus(status: string): boolean {
  return ["accepted", "queued", "running", "waiting_for_approval", "waiting_for_auth"].includes(statusKey(status))
}

function isThinkingRunStatus(status: string): boolean {
  return ["accepted", "queued", "running"].includes(statusKey(status))
}

function runFailureMessage(status: string, category?: string | null): string {
  if (category) return `Run ${statusLabel(status)}: ${category}`
  if (status === "recovery_required") return "Run needs recovery before a reply can be produced."
  if (status === "cancelled") return "Run was cancelled before a reply was produced."
  if (status === "killed") return "Run was killed before a reply was produced."
  return "Run failed before a reply was produced."
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ")
}

function statusKey(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

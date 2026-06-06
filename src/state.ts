import type { AppEvent, HistoryResponse, PendingGateInfo, ThreadInfo } from "./gateway/types"
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
      return {
        ...state,
        activeThreadId: action.history.thread_id,
        transcript: mergeHistoryTranscript(state.transcript, action.history),
        historyCursor: action.history.next_cursor ?? null,
        hasOlderHistory: Boolean(action.history.next_cursor),
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
    case "run_started":
      return {
        ...state,
        activeThreadId: action.threadId ?? state.activeThreadId,
        activeRunId: action.runId ?? state.activeRunId,
        status: action.status ?? "running",
        isThinking: true,
      }
    case "user_sent":
      return {
        ...state,
        status: "sent",
        isThinking: true,
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
        return appendRunFailure(state, event)
      }
      return {
        ...state,
        status: event.status,
        activeRunId: isTrackedRunStatus(event.status) ? event.run_id ?? state.activeRunId : null,
        isThinking: isThinkingRunStatus(event.status),
      }
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
      const gateRunId = "run_id" in event ? event.run_id ?? state.activeRunId : state.activeRunId
      return {
        ...state,
        isThinking: false,
        status: "waiting for approval",
        activeRunId: gateRunId,
        pendingGate: {
          request_id: event.request_id,
          thread_id: event.thread_id ?? state.activeThreadId ?? "",
          run_id: gateRunId,
          gate_ref: "gate_ref" in event ? event.gate_ref : null,
          gate_name: event.gate_name,
          tool_name: event.tool_name,
          description: event.description,
          parameters: event.parameters,
          extension_name: event.extension_name,
          provider: event.provider,
          account_label: event.account_label,
          challenge_kind: event.challenge_kind,
          authorization_url: event.authorization_url,
          expires_at: event.expires_at,
          resume_kind: event.resume_kind,
        },
      }
    case "approval_needed":
      return {
        ...state,
        isThinking: false,
        status: "waiting for approval",
        pendingGate: {
          request_id: event.request_id,
          thread_id: event.thread_id ?? state.activeThreadId ?? "",
          gate_name: "approval",
          tool_name: event.tool_name,
          description: event.description,
          parameters: event.parameters,
          resume_kind: { kind: "approval", allow_always: event.allow_always },
        },
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
    case "error":
      return reduceUiState(state, { type: "error", message: event.message })
    default:
      return state
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

function appendRunFailure(
  state: UiState,
  event: Extract<AppEvent, { type: "run_status" }>,
): UiState {
  const status = statusKey(event.status)
  const id = event.run_id ? `run-${event.run_id}-${status}` : `run-${status}-${Date.now()}`
  const detail = runFailureMessage(status, event.failure_category)
  const transcript = state.transcript.some((item) => item.id === id)
    ? state.transcript
    : [
        ...state.transcript,
        {
          id,
          role: "system" as const,
          text: detail,
          threadId: event.thread_id,
          state: event.status,
        },
      ]

  return {
    ...state,
    status: event.status,
    isThinking: false,
    activeRunId: null,
    lastError: detail,
    transcript,
    activity: upsertActivity(state.activity, {
      id,
      label: "run failed",
      detail,
      status: "error",
    }),
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

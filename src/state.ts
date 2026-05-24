import type { AppEvent, HistoryResponse, PendingGateInfo, ThreadInfo, ToolCallInfo } from "./gateway/types"

export type TranscriptItem = {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  threadId?: string | null
  state?: string
}

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
    case "history":
      return {
        ...state,
        activeThreadId: action.history.thread_id,
        transcript: transcriptFromHistory(action.history),
        historyCursor: action.history.next_cursor ?? null,
        hasOlderHistory: Boolean(action.history.next_cursor),
        pendingGate: action.history.pending_gate ?? null,
        activeRunId: action.history.pending_gate?.run_id ?? (action.history.in_progress ? state.activeRunId : null),
        status: action.history.in_progress ? action.history.in_progress.state : "idle",
        isThinking: action.history.pending_gate
          ? false
          : Boolean(action.history.in_progress) || (state.isThinking && !hasAssistantAfterLatestUser(action.history)),
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
        transcript: [
          ...state.transcript,
          { id: `user-${Date.now()}`, role: "user", text: action.content, threadId: action.threadId },
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
    case "status":
      return { ...state, status: event.message }
    case "run_status":
      if (isFailedRunStatus(event.status)) {
        return appendRunFailure(state, event)
      }
      return {
        ...state,
        status: event.status,
        activeRunId: isActiveRunStatus(event.status) ? event.run_id ?? state.activeRunId : null,
        isThinking: isActiveRunStatus(event.status),
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
      return {
        ...state,
        isThinking: false,
        status: "waiting for approval",
        activeRunId: "run_id" in event ? event.run_id : state.activeRunId,
        pendingGate: {
          request_id: event.request_id,
          thread_id: event.thread_id ?? state.activeThreadId ?? "",
          run_id: "run_id" in event ? event.run_id : null,
          gate_ref: "gate_ref" in event ? event.gate_ref : null,
          gate_name: event.gate_name,
          tool_name: event.tool_name,
          description: event.description,
          parameters: event.parameters,
          extension_name: event.extension_name,
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

function transcriptFromHistory(history: HistoryResponse): TranscriptItem[] {
  return history.turns.flatMap((turn) => {
    const items: TranscriptItem[] = []
    if (turn.user_input) {
      items.push({
        id: turn.user_message_id ?? `turn-${turn.turn_number}-user`,
        role: "user",
        text: turn.user_input,
        threadId: history.thread_id,
        state: turn.state,
      })
    }
    if (turn.response) {
      items.push({
        id: `turn-${turn.turn_number}-assistant`,
        role: "assistant",
        text: turn.response,
        threadId: history.thread_id,
        state: turn.state,
      })
    }
    if (turn.narrative) {
      items.push({
        id: `turn-${turn.turn_number}-narrative`,
        role: "system",
        text: turn.narrative,
        threadId: history.thread_id,
        state: turn.state,
      })
    }
    return items
  })
}

function mergeTranscript(prefix: TranscriptItem[], suffix: TranscriptItem[]): TranscriptItem[] {
  const seen = new Set<string>()
  const merged: TranscriptItem[] = []
  for (const item of [...prefix, ...suffix]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

function hasAssistantAfterLatestUser(history: HistoryResponse): boolean {
  let hasUser = false
  let assistantAfterUser = false
  for (const turn of history.turns) {
    if (turn.user_input) {
      hasUser = true
      assistantAfterUser = false
    }
    if (hasUser && turn.response) {
      assistantAfterUser = true
    }
  }
  return assistantAfterUser
}

function appendAssistantChunk(state: UiState, content: string, threadId?: string | null): UiState {
  const existingId = state.streamingAssistantId
  if (existingId) {
    return {
      ...state,
      status: "streaming",
      isThinking: true,
      transcript: state.transcript.map((item) =>
        item.id === existingId ? { ...item, text: item.text + content } : item,
      ),
    }
  }

  const id = `assistant-${Date.now()}`
  return {
    ...state,
    status: "streaming",
    isThinking: true,
    streamingAssistantId: id,
    transcript: [...state.transcript, { id, role: "assistant", text: content, threadId }],
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
        item.id === existingId ? { ...item, text: content, threadId } : item,
      ),
    }
  }

  return {
    ...state,
    status: "idle",
    isThinking: false,
    activeThreadId: threadId,
    activeRunId: null,
    transcript: [
      ...state.transcript,
      { id: `assistant-${Date.now()}`, role: "assistant", text: content, threadId },
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

function isActiveRunStatus(status: string): boolean {
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

export function toolSummary(tool: ToolCallInfo): string {
  if (tool.error) return `${tool.name}: ${tool.error}`
  if (tool.result_preview) return `${tool.name}: ${tool.result_preview}`
  return tool.name
}

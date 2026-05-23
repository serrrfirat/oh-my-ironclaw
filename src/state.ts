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
}

export type UiState = {
  connected: boolean
  status: string
  activeThreadId?: string | null
  threads: ThreadInfo[]
  transcript: TranscriptItem[]
  activity: ActivityItem[]
  pendingGate?: PendingGateInfo | null
  lastError?: string | null
  streamingAssistantId?: string | null
}

export const initialUiState: UiState = {
  connected: false,
  status: "starting",
  threads: [],
  transcript: [],
  activity: [],
  pendingGate: null,
}

export type UiAction =
  | { type: "connected"; connected: boolean; status?: string }
  | { type: "error"; message: string }
  | { type: "threads"; threads: ThreadInfo[]; activeThreadId?: string | null }
  | { type: "history"; history: HistoryResponse }
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
        pendingGate: action.history.pending_gate ?? null,
        status: action.history.in_progress ? action.history.in_progress.state : "idle",
      }
    case "user_sent":
      return {
        ...state,
        status: "sent",
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
      return { ...state, status: event.message }
    case "status":
      return { ...state, status: event.message }
    case "stream_chunk":
      return appendAssistantChunk(state, event.content, event.thread_id)
    case "response":
      return finalizeAssistant(state, event.content, event.thread_id)
    case "tool_started":
      return {
        ...state,
        status: `running ${event.name}`,
        activity: pushActivity(state.activity, {
          id: event.call_id ?? `${event.name}-${Date.now()}`,
          label: event.name,
          detail: event.detail ?? undefined,
          status: "running",
        }),
      }
    case "tool_completed":
      return {
        ...state,
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
        status: "waiting for approval",
        pendingGate: {
          request_id: event.request_id,
          thread_id: event.thread_id ?? state.activeThreadId ?? "",
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
      return { ...state, pendingGate: null, status: event.message }
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
    const items: TranscriptItem[] = [
      {
        id: turn.user_message_id ?? `turn-${turn.turn_number}-user`,
        role: "user",
        text: turn.user_input,
        threadId: history.thread_id,
        state: turn.state,
      },
    ]
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

function appendAssistantChunk(state: UiState, content: string, threadId?: string | null): UiState {
  const existingId = state.streamingAssistantId
  if (existingId) {
    return {
      ...state,
      status: "streaming",
      transcript: state.transcript.map((item) =>
        item.id === existingId ? { ...item, text: item.text + content } : item,
      ),
    }
  }

  const id = `assistant-${Date.now()}`
  return {
    ...state,
    status: "streaming",
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
      activeThreadId: threadId,
      streamingAssistantId: null,
      transcript: state.transcript.map((item) =>
        item.id === existingId ? { ...item, text: content, threadId } : item,
      ),
    }
  }

  return {
    ...state,
    status: "idle",
    activeThreadId: threadId,
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

export function toolSummary(tool: ToolCallInfo): string {
  if (tool.error) return `${tool.name}: ${tool.error}`
  if (tool.result_preview) return `${tool.name}: ${tool.result_preview}`
  return tool.name
}


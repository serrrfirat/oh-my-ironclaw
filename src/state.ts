import type { AppEvent, HistoryResponse, PendingGateInfo, ThreadInfo, ToolCallInfo } from "./gateway/types"

export type TranscriptActivity = {
  kind: "capability_activity" | "capability_display_preview" | "tool_result_reference"
  title: string
  status: string
  detail?: string | null
  inputSummary?: string | null
  outputSummary?: string | null
  outputPreview?: string | null
  outputKind?: string | null
  outputBytes?: number | null
  truncated?: boolean | null
}

type TranscriptMeta = {
  resultRef?: string | null
  capabilityId?: string | null
  invocationId?: string | null
  timelineMessageId?: string | null
  sentAtMs?: number
  completedAtMs?: number
  durationMs?: number
  projectionId?: string | null
}

export type TranscriptItem = {
  id: string
  role: "user" | "assistant" | "system" | "activity" | "thinking"
  text: string
  threadId?: string | null
  state?: string
  meta?: TranscriptMeta
  activity?: TranscriptActivity
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
        transcript: mergeHistoryTranscript(state.transcript, action.history),
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

function transcriptFromHistory(history: HistoryResponse, includeToolPlaceholders = false): TranscriptItem[] {
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
    if (turn.narrative) {
      items.push({
        id: `turn-${turn.turn_number}-narrative`,
        role: "system",
        text: turn.narrative,
        threadId: history.thread_id,
        state: turn.state,
      })
    }
    for (const [index, tool] of turn.tool_calls.entries()) {
      const activity = toolTranscriptActivity(tool)
      const text = activity ? transcriptActivityText(activity) : null
      if (!activity && !includeToolPlaceholders) continue
      const timelineMessageId = tool.kind === "capability_display_preview" ? tool.message_id ?? null : null
      const resultRef = tool.kind === "capability_display_preview" ? tool.result_ref ?? tool.result ?? null : tool.call_id ?? tool.result ?? null
      items.push({
        id: timelineMessageId ? capabilityPreviewTranscriptId(timelineMessageId) : `turn-${turn.turn_number}-tool-${tool.call_id ?? index}`,
        role: "activity",
        text: text ?? "",
        threadId: history.thread_id,
        state: tool.kind === "capability_display_preview" ? tool.status ?? (tool.has_error ? "failed" : turn.state) : tool.has_error ? "failed" : turn.state,
        activity: activity ?? undefined,
        meta: {
          resultRef,
          capabilityId: tool.kind === "capability_display_preview" ? tool.capability_id ?? null : null,
          invocationId: tool.kind === "capability_display_preview" ? tool.call_id ?? null : null,
          timelineMessageId,
        },
      })
    }
    if (turn.response) {
      items.push({
        id: `turn-${turn.turn_number}-assistant`,
        role: "assistant",
        text: turn.response,
        threadId: history.thread_id,
        state: turn.state,
        meta: { durationMs: turnDurationMs(turn.started_at, turn.completed_at) },
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

function mergeHistoryTranscript(current: TranscriptItem[], history: HistoryResponse): TranscriptItem[] {
  const liveCapabilityItems = current.filter(
    (item) => item.role === "activity" && item.id.startsWith("capability-") && item.threadId === history.thread_id,
  )
  const liveThinkingItems = current.filter(
    (item) => item.role === "thinking" && item.threadId === history.thread_id,
  )
  const preservedThinkingItems = hasAssistantAfterLatestUser(history) ? [] : liveThinkingItems
  if (liveCapabilityItems.length === 0) return mergeTranscript(transcriptFromHistory(history), preservedThinkingItems)

  const liveByResultRef = new Map<string, TranscriptItem>()
  const liveByInvocationId = new Map<string, TranscriptItem>()
  const liveByTimelineMessageId = new Map<string, TranscriptItem>()
  for (const item of liveCapabilityItems) {
    const resultRef = item.meta?.resultRef
    if (resultRef) liveByResultRef.set(resultRef, item)
    if (item.meta?.invocationId) liveByInvocationId.set(item.meta.invocationId, item)
    if (item.meta?.timelineMessageId) liveByTimelineMessageId.set(item.meta.timelineMessageId, item)
  }

  const usedLiveItems = new Set<string>()
  const merged = transcriptFromHistory(history, true).flatMap((item) => {
    if (item.role !== "activity") return [item]
    const liveItem = matchingLiveCapabilityItem(item, liveByTimelineMessageId, liveByInvocationId, liveByResultRef)
    if (!liveItem) return item.text ? [item] : []
    usedLiveItems.add(liveItem.id)
    if (item.meta?.timelineMessageId) {
      return [
        {
          ...item,
          text: item.text || liveItem.text,
          meta: { ...liveItem.meta, ...item.meta },
        },
      ]
    }
    return [liveItem]
  })

  return mergeTranscript(
    merged,
    [...liveCapabilityItems.filter((item) => !usedLiveItems.has(item.id)), ...preservedThinkingItems],
  )
}

function matchingLiveCapabilityItem(
  item: TranscriptItem,
  liveByTimelineMessageId: Map<string, TranscriptItem>,
  liveByInvocationId: Map<string, TranscriptItem>,
  liveByResultRef: Map<string, TranscriptItem>,
): TranscriptItem | null {
  const timelineMessageId = item.meta?.timelineMessageId
  if (timelineMessageId && liveByTimelineMessageId.has(timelineMessageId)) {
    return liveByTimelineMessageId.get(timelineMessageId) ?? null
  }
  const invocationId = item.meta?.invocationId
  if (invocationId && liveByInvocationId.has(invocationId)) return liveByInvocationId.get(invocationId) ?? null
  const resultRef = item.meta?.resultRef
  if (resultRef && liveByResultRef.has(resultRef)) return liveByResultRef.get(resultRef) ?? null
  return null
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

function latestUserSentAtMs(transcript: TranscriptItem[]): number | undefined {
  return [...transcript].reverse().find((item) => item.role === "user" && item.meta?.sentAtMs)?.meta?.sentAtMs
}

function turnDurationMs(startedAt?: string | null, completedAt?: string | null): number | undefined {
  if (!startedAt || !completedAt) return undefined
  const started = Date.parse(startedAt)
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return undefined
  return completed - started
}

function appendAssistantChunk(state: UiState, content: string, threadId?: string | null): UiState {
  const existingId = state.streamingAssistantId
  if (existingId) {
    return {
      ...state,
      status: "streaming",
      isThinking: true,
      transcript: state.transcript.map((item) =>
        item.id === existingId ? { ...item, text: item.text + content, meta: assistantTimingMeta(state, item) } : item,
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
        item.id === existingId
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
  const active = status === "started" || status === "running"
  const failed = status === "failed" || status === "killed"
  const id = `capability-${event.invocation_id}`
  const transcriptActivity = capabilityEventActivity(event)
  const activityItem: ActivityItem = {
    id,
    label: transcriptActivity.title,
    detail: transcriptActivity.detail ?? undefined,
    status: active ? "running" : failed ? "error" : "ok",
    kind: active ? "tool_running" : `tool_${status}`,
  }

  return {
    ...state,
    isThinking: active ? true : state.isThinking,
    status: active ? `running ${event.capability_id}` : state.status,
    activity: upsertActivity(state.activity, activityItem),
    transcript: upsertCapabilityTranscriptItem(state.transcript, {
      id,
      role: "activity",
      text: transcriptActivityText(transcriptActivity),
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
      text: transcriptActivityText(transcriptActivity),
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
  return {
    ...state,
    isThinking: true,
    status: "thinking",
    activity: upsertActivity(state.activity, {
      id,
      label: "Thinking",
      detail: event.content,
      status: "running",
      kind: "thinking",
    }),
    transcript: upsertTranscriptItem(state.transcript, {
      id,
      role: "thinking",
      text: event.content,
      threadId: event.thread_id,
      state: "running",
      meta: { projectionId: event.id },
    }),
  }
}

function upsertTranscriptItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index < 0) return [...items, item]
  return items.map((existing, current) => (current === index ? item : existing))
}

function upsertCapabilityTranscriptItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const index = items.findIndex(
    (existing) =>
      existing.id === item.id ||
      (existing.role === "activity" &&
        item.meta?.invocationId &&
        existing.meta?.invocationId === item.meta.invocationId),
  )
  if (index < 0) return [...items, item]

  return items.map((existing, current) => {
    if (current !== index) return existing
    if (existing.meta?.timelineMessageId && !item.meta?.timelineMessageId) {
      return {
        ...existing,
        threadId: item.threadId ?? existing.threadId,
        state: item.state,
        meta: {
          ...item.meta,
          ...existing.meta,
          resultRef: existing.meta.resultRef ?? item.meta?.resultRef ?? null,
        },
      }
    }
    return item
  })
}

function capabilityPreviewTranscriptId(timelineMessageId: string): string {
  return `capability-preview-${timelineMessageId}`
}

function capabilityEventActivity(event: Extract<AppEvent, { type: "capability_activity" }>): TranscriptActivity {
  const status = statusKey(event.status)
  return {
    kind: "capability_activity",
    title: activityTitleForStatus(event.capability_id, status),
    status,
    detail: [
      event.runtime ? `runtime ${event.runtime}` : null,
      event.provider ? `provider ${event.provider}` : null,
      typeof event.output_bytes === "number" ? `${formatBytes(event.output_bytes)} output` : null,
      event.error_kind ? `error ${event.error_kind}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }
}

function capabilityPreviewEventActivity(
  event: Extract<AppEvent, { type: "capability_display_preview" }>,
): TranscriptActivity {
  const status = statusKey(event.status)
  return {
    kind: "capability_display_preview",
    title: activityTitleForStatus(event.title || event.capability_id, status),
    status,
    detail: event.subtitle,
    inputSummary: event.input_summary,
    outputSummary: event.output_summary,
    outputPreview: event.output_preview,
    outputKind: event.output_kind,
    outputBytes: event.output_bytes,
    truncated: event.truncated,
  }
}

function toolTranscriptActivity(tool: ToolCallInfo): TranscriptActivity | null {
  if (tool.kind === "capability_display_preview") return capabilityToolActivity(tool)

  const status = tool.has_error ? "failed" : "completed"
  const label = tool.name === "Capability" ? "tool call" : tool.name
  if (!tool.error && (!tool.result_preview || isGenericCapabilitySummary(tool.result_preview)) && label === "tool call") {
    return null
  }

  return {
    kind: "tool_result_reference",
    title: label,
    status,
    detail: [tool.error, tool.result_preview && !isGenericCapabilitySummary(tool.result_preview) ? tool.result_preview : null]
      .filter(Boolean)
      .join(" · "),
  }
}

function capabilityToolActivity(tool: Extract<ToolCallInfo, { kind: "capability_display_preview" }>): TranscriptActivity {
  const status = statusKey(tool.status ?? (tool.has_error ? "failed" : "completed"))
  const title = tool.name || tool.capability_id || "tool"
  return {
    kind: "capability_display_preview",
    title: activityTitleForStatus(title, status),
    status,
    detail: tool.subtitle,
    inputSummary: tool.input_summary,
    outputSummary: tool.output_summary,
    outputPreview: tool.output_preview,
    outputKind: tool.output_kind,
    outputBytes: tool.output_bytes,
    truncated: tool.truncated,
  }
}

function isGenericCapabilitySummary(summary: string): boolean {
  return statusKey(summary) === "capability_completed"
}

function activityGlyph(status: string): string {
  if (status === "failed" || status === "killed") return "!"
  if (status === "started" || status === "running") return "·"
  return "✓"
}

function activityTitleForStatus(title: string, status: string): string {
  switch (status) {
    case "started":
    case "running":
      return `Using ${title}`
    case "completed":
      return title
    case "failed":
      return `Failed ${title}`
    case "killed":
      return `Killed ${title}`
    default:
      return `${statusLabel(status)} ${title}`
  }
}

export function transcriptActivityLines(activity: TranscriptActivity): string[] {
  const lines = [`${activityGlyph(activity.status)} ${activity.title}`]
  if (activity.detail) lines.push(activity.detail)
  if (activity.inputSummary) lines.push(`input: ${activity.inputSummary}`)
  const output = transcriptActivityOutputLine(activity)
  if (output) lines.push(output)
  if (activity.outputPreview) lines.push(activity.outputPreview)
  if (activity.truncated) lines.push("truncated")
  return lines
}

function transcriptActivityText(activity: TranscriptActivity): string {
  return transcriptActivityLines(activity).join("\n")
}

function transcriptActivityOutputLine(activity: TranscriptActivity): string | null {
  const parts = [
    activity.outputSummary,
    activity.outputKind,
    typeof activity.outputBytes === "number" ? formatBytes(activity.outputBytes) : null,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return `output: ${parts.join(" · ")}`
}

function capabilityDisplayPreviewDetail(activity: TranscriptActivity): string {
  return [
    activity.detail,
    activity.outputSummary,
    activity.outputPreview ? firstLine(activity.outputPreview) : null,
    activity.truncated ? "truncated" : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? ""
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

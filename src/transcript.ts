import type { AppEvent, HistoryResponse, TimelineMessageInfo, ToolCallInfo } from "./gateway/types"

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

export type TranscriptMeta = {
  resultRef?: string | null
  capabilityId?: string | null
  invocationId?: string | null
  timelineMessageId?: string | null
  sentAtMs?: number
  completedAtMs?: number
  durationMs?: number
  projectionId?: string | null
}

type TranscriptBase = {
  id: string
  threadId?: string | null
  state?: string
  meta?: TranscriptMeta
}

export type TranscriptItem =
  | (TranscriptBase & { role: "user" | "assistant" | "system" | "thinking"; text: string })
  | (TranscriptBase & { role: "activity"; activity: TranscriptActivity })

export function transcriptFromHistory(history: HistoryResponse): TranscriptItem[] {
  if (history.messages) return transcriptFromTimelineMessages(history.messages)
  return transcriptFromLegacyTurns(history)
}

function transcriptFromTimelineMessages(messages: TimelineMessageInfo[]): TranscriptItem[] {
  return messages.flatMap((message) => {
    switch (message.kind) {
      case "user":
        return [transcriptTextItem(message, "user")]
      case "assistant":
      case "summary":
        return [transcriptTextItem(message, "assistant")]
      case "system":
        return [transcriptTextItem(message, "system")]
      case "tool_result_reference":
      case "capability_display_preview": {
        const activity = toolTranscriptActivity(message.activity)
        if (!activity) return []
        return [{
          id: message.id,
          role: "activity" as const,
          threadId: message.thread_id,
          state: message.status,
          activity,
          meta: activityMetaForTool(message.activity, message.id),
        }]
      }
    }
  })
}

function transcriptTextItem(
  message: Extract<TimelineMessageInfo, { kind: "user" | "assistant" | "system" | "summary" }>,
  role: "user" | "assistant" | "system",
): TranscriptItem {
  return {
    id: message.id,
    role,
    text: message.content,
    threadId: message.thread_id,
    state: message.status,
  }
}

function transcriptFromLegacyTurns(history: HistoryResponse): TranscriptItem[] {
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
      if (!activity) continue
      const timelineMessageId = toolTimelineMessageId(tool)
      items.push({
        id: timelineMessageId ?? `turn-${turn.turn_number}-tool-${tool.call_id ?? index}`,
        role: "activity",
        threadId: history.thread_id,
        state: tool.kind === "capability_display_preview" ? tool.status ?? (tool.has_error ? "failed" : turn.state) : tool.has_error ? "failed" : turn.state,
        activity,
        meta: {
          resultRef: toolResultRef(tool),
          capabilityId: toolCapabilityId(tool),
          invocationId: toolInvocationId(tool),
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

export function mergeTranscript(prefix: TranscriptItem[], suffix: TranscriptItem[]): TranscriptItem[] {
  const seen = new Set<string>()
  const merged: TranscriptItem[] = []
  for (const item of [...prefix, ...suffix]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

export function mergeHistoryTranscript(current: TranscriptItem[], history: HistoryResponse): TranscriptItem[] {
  const liveCapabilityItems = current.filter(
    (item) => item.role === "activity" && item.threadId === history.thread_id,
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
  const merged = transcriptFromHistory(history).flatMap((item) => {
    if (item.role !== "activity") return [item]
    const liveItem = matchingLiveCapabilityItem(item, liveByTimelineMessageId, liveByInvocationId, liveByResultRef)
    if (!liveItem) return [item]
    usedLiveItems.add(liveItem.id)
    if (item.meta?.timelineMessageId) {
      return [
        {
          ...item,
          meta: { ...liveItem.meta, ...item.meta },
        },
      ]
    }
    return [liveItem]
  })

  const positionedLiveItems = placeUnmatchedLiveCapabilityItems(
    merged,
    liveCapabilityItems.filter((item) => !usedLiveItems.has(item.id)),
    history,
  )
  return mergeTranscript(positionedLiveItems, preservedThinkingItems)
}

export function capabilityPreviewTranscriptId(timelineMessageId: string): string {
  return timelineMessageId
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

function activityMetaForTool(tool: ToolCallInfo, messageId: string): TranscriptMeta {
  if (tool.kind === "capability_display_preview") {
    return {
      resultRef: toolResultRef(tool),
      capabilityId: toolCapabilityId(tool),
      invocationId: toolInvocationId(tool),
      timelineMessageId: messageId,
    }
  }
  return {
    resultRef: toolResultRef(tool),
  }
}

function placeUnmatchedLiveCapabilityItems(
  transcript: TranscriptItem[],
  liveItems: TranscriptItem[],
  history: HistoryResponse,
): TranscriptItem[] {
  let positioned = transcript
  for (const liveItem of liveItems) {
    if (positioned.some((item) => item.id === liveItem.id)) continue
    const anchorId = historyAnchorAfterLiveCapability(history, liveItem)
    const anchorIndex = anchorId ? positioned.findIndex((item) => item.id === anchorId) : -1
    if (anchorIndex < 0) {
      positioned = [...positioned, liveItem]
      continue
    }
    positioned = [...positioned.slice(0, anchorIndex), liveItem, ...positioned.slice(anchorIndex)]
  }
  return positioned
}

function historyAnchorAfterLiveCapability(history: HistoryResponse, liveItem: TranscriptItem): string | null {
  if (history.messages) return timelineAnchorAfterLiveCapability(history.messages, liveItem)
  return legacyAnchorAfterLiveCapability(history, liveItem)
}

function timelineAnchorAfterLiveCapability(messages: TimelineMessageInfo[], liveItem: TranscriptItem): string | null {
  const matchedMessage = messages.find((message) => {
    if (message.kind !== "tool_result_reference" && message.kind !== "capability_display_preview") return false
    return toolMatchesLiveItem(message.activity, liveItem)
  })
  if (!matchedMessage) return null
  const anchor = messages.find((message) => message.sequence > matchedMessage.sequence && transcriptMessageIsVisible(message))
  return anchor?.id ?? null
}

function transcriptMessageIsVisible(message: TimelineMessageInfo): boolean {
  return message.kind === "user" || message.kind === "assistant" || message.kind === "system" || message.kind === "summary"
}

function legacyAnchorAfterLiveCapability(history: HistoryResponse, liveItem: TranscriptItem): string | null {
  for (let turnIndex = 0; turnIndex < history.turns.length; turnIndex += 1) {
    const turn = history.turns[turnIndex]
    if (!turn.tool_calls.some((tool) => toolMatchesLiveItem(tool, liveItem))) continue
    if (turn.response) return `turn-${turn.turn_number}-assistant`
    for (const laterTurn of history.turns.slice(turnIndex + 1)) {
      if (laterTurn.user_input) return laterTurn.user_message_id ?? `turn-${laterTurn.turn_number}-user`
      if (laterTurn.narrative) return `turn-${laterTurn.turn_number}-narrative`
      if (laterTurn.response) return `turn-${laterTurn.turn_number}-assistant`
    }
  }
  return null
}

function toolMatchesLiveItem(tool: ToolCallInfo, liveItem: TranscriptItem): boolean {
  if (liveItem.role !== "activity") return false
  const resultRef = liveItem.meta?.resultRef
  const invocationId = liveItem.meta?.invocationId
  if (resultRef && toolResultRef(tool) === resultRef) return true
  if (invocationId && tool.call_id === invocationId) return true
  return false
}

function toolResultRef(tool: ToolCallInfo): string | null {
  if (tool.kind === "capability_display_preview") return tool.result_ref ?? tool.result ?? null
  return tool.call_id ?? tool.result ?? null
}

function toolTimelineMessageId(tool: ToolCallInfo): string | null {
  return tool.kind === "capability_display_preview" ? tool.message_id ?? null : null
}

function toolCapabilityId(tool: ToolCallInfo): string | null {
  return tool.kind === "capability_display_preview" ? tool.capability_id ?? null : null
}

function toolInvocationId(tool: ToolCallInfo): string | null {
  return tool.kind === "capability_display_preview" ? tool.call_id ?? null : null
}

export function hasAssistantAfterLatestUser(history: HistoryResponse): boolean {
  if (history.messages) return hasAssistantMessageAfterLatestUser(history.messages)
  let hasUser = false
  let assistantAfterUser = false
  for (const turn of history.turns) {
    if (turn.user_input) {
      hasUser = true
      assistantAfterUser = false
    }
    if (hasUser && turn.response) assistantAfterUser = true
  }
  return assistantAfterUser
}

function hasAssistantMessageAfterLatestUser(messages: TimelineMessageInfo[]): boolean {
  let hasUser = false
  let assistantAfterUser = false
  for (const message of messages) {
    if (message.kind === "user") {
      hasUser = true
      assistantAfterUser = false
    }
    if (hasUser && (message.kind === "assistant" || message.kind === "summary")) assistantAfterUser = true
  }
  return assistantAfterUser
}

export function upsertTranscriptItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index < 0) return [...items, item]
  return items.map((existing, current) => (current === index ? item : existing))
}

export function transcriptItemContentLength(item: TranscriptItem): number {
  if (item.role === "activity") return transcriptActivityText(item.activity).length
  return item.text.length
}

export function upsertCapabilityTranscriptItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
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

export function capabilityEventActivity(event: Extract<AppEvent, { type: "capability_activity" }>): TranscriptActivity {
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

export function capabilityPreviewEventActivity(
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

export function transcriptActivityText(activity: TranscriptActivity): string {
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

export function capabilityDisplayPreviewDetail(activity: TranscriptActivity): string {
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

function turnDurationMs(startedAt?: string | null, completedAt?: string | null): number | undefined {
  if (!startedAt || !completedAt) return undefined
  const started = Date.parse(startedAt)
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return undefined
  return Math.max(0, completed - started)
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

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

  const historyTranscript = transcriptFromHistory(history)
  const usedLiveItems = new Set<string>()
  const transcriptIdByLiveId = new Map<string, string>()
  const transcriptIdByCurrentId = currentTranscriptIdMap(current, historyTranscript)
  const merged = historyTranscript.flatMap((item) => {
    if (item.role !== "activity") return [item]
    const liveItem = matchingLiveCapabilityItem(item, liveByTimelineMessageId, liveByInvocationId, liveByResultRef)
    if (!liveItem) return [item]
    usedLiveItems.add(liveItem.id)
    if (item.meta?.timelineMessageId) {
      const mergedItem = {
        ...item,
        meta: { ...liveItem.meta, ...item.meta },
      }
      transcriptIdByLiveId.set(liveItem.id, mergedItem.id)
      transcriptIdByCurrentId.set(liveItem.id, mergedItem.id)
      return [mergedItem]
    }
    transcriptIdByLiveId.set(liveItem.id, liveItem.id)
    transcriptIdByCurrentId.set(liveItem.id, liveItem.id)
    return [liveItem]
  })

  const positionedLiveItems = placeUnmatchedLiveCapabilityItems(
    merged,
    current,
    liveCapabilityItems,
    usedLiveItems,
    transcriptIdByLiveId,
    transcriptIdByCurrentId,
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
  current: TranscriptItem[],
  liveItems: TranscriptItem[],
  usedLiveItems: Set<string>,
  transcriptIdByLiveId: Map<string, string>,
  transcriptIdByCurrentId: Map<string, string>,
  history: HistoryResponse,
): TranscriptItem[] {
  let positioned = transcript
  for (const liveItem of liveItems) {
    if (usedLiveItems.has(liveItem.id)) continue
    if (positioned.some((item) => item.id === liveItem.id)) continue
    const anchorId =
      followingCurrentTranscriptAnchor(current, liveItem, transcriptIdByCurrentId, positioned) ??
      followingLiveCapabilityAnchor(liveItems, liveItem, transcriptIdByLiveId, positioned)
    const anchorIndex = anchorId ? positioned.findIndex((item) => item.id === anchorId) : -1
    if (anchorIndex >= 0) {
      positioned = [...positioned.slice(0, anchorIndex), liveItem, ...positioned.slice(anchorIndex)]
      continue
    }
    const previousId = previousCurrentTranscriptAnchor(current, liveItem, transcriptIdByCurrentId, positioned)
    const previousIndex = previousId ? positioned.findIndex((item) => item.id === previousId) : -1
    if (previousIndex < 0) {
      const historyAnchorId = historyAnchorAfterLiveCapability(history, liveItem)
      const historyAnchorIndex = historyAnchorId ? positioned.findIndex((item) => item.id === historyAnchorId) : -1
      positioned = historyAnchorIndex >= 0
        ? [...positioned.slice(0, historyAnchorIndex), liveItem, ...positioned.slice(historyAnchorIndex)]
        : [...positioned, liveItem]
      continue
    }
    positioned = [...positioned.slice(0, previousIndex + 1), liveItem, ...positioned.slice(previousIndex + 1)]
  }
  return positioned
}

function currentTranscriptIdMap(current: TranscriptItem[], historyTranscript: TranscriptItem[]): Map<string, string> {
  const map = new Map<string, string>()
  const usedHistoryIds = new Set<string>()
  for (const item of current) {
    const matched = historyTranscript.find((candidate) => !usedHistoryIds.has(candidate.id) && transcriptItemsMatch(item, candidate))
    if (!matched) continue
    map.set(item.id, matched.id)
    usedHistoryIds.add(matched.id)
  }
  return map
}

function transcriptItemsMatch(current: TranscriptItem, history: TranscriptItem): boolean {
  if (current.threadId !== history.threadId || current.role !== history.role) return false
  if (current.role === "activity" || history.role === "activity") return current.id === history.id
  return current.text === history.text
}

function followingCurrentTranscriptAnchor(
  current: TranscriptItem[],
  liveItem: TranscriptItem,
  transcriptIdByCurrentId: Map<string, string>,
  transcript: TranscriptItem[],
): string | null {
  const liveIndex = current.findIndex((item) => item.id === liveItem.id)
  for (const laterItem of current.slice(liveIndex + 1)) {
    const transcriptId = transcriptIdByCurrentId.get(laterItem.id) ?? laterItem.id
    if (transcript.some((item) => item.id === transcriptId)) return transcriptId
  }
  return null
}

function previousCurrentTranscriptAnchor(
  current: TranscriptItem[],
  liveItem: TranscriptItem,
  transcriptIdByCurrentId: Map<string, string>,
  transcript: TranscriptItem[],
): string | null {
  const liveIndex = current.findIndex((item) => item.id === liveItem.id)
  for (let index = liveIndex - 1; index >= 0; index -= 1) {
    const previousItem = current[index]
    if (!previousItem) continue
    const transcriptId = transcriptIdByCurrentId.get(previousItem.id) ?? previousItem.id
    if (transcript.some((item) => item.id === transcriptId)) return transcriptId
  }
  return null
}

function followingLiveCapabilityAnchor(
  liveItems: TranscriptItem[],
  liveItem: TranscriptItem,
  transcriptIdByLiveId: Map<string, string>,
  transcript: TranscriptItem[],
): string | null {
  const liveIndex = liveItems.findIndex((item) => item.id === liveItem.id)
  for (const laterLiveItem of liveItems.slice(liveIndex + 1)) {
    const transcriptId = transcriptIdByLiveId.get(laterLiveItem.id) ?? laterLiveItem.id
    if (transcript.some((item) => item.id === transcriptId)) return transcriptId
  }
  return null
}

function historyAnchorAfterLiveCapability(history: HistoryResponse, liveItem: TranscriptItem): string | null {
  const matchedAnchor = history.messages
    ? timelineAnchorAfterLiveCapability(history.messages, liveItem)
    : legacyAnchorAfterLiveCapability(history, liveItem)
  return matchedAnchor ?? assistantAnchorAfterLatestUser(history)
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

function assistantAnchorAfterLatestUser(history: HistoryResponse): string | null {
  if (history.messages) return assistantMessageAnchorAfterLatestUser(history.messages)
  return legacyAssistantAnchorAfterLatestUser(history)
}

function assistantMessageAnchorAfterLatestUser(messages: TimelineMessageInfo[]): string | null {
  const latestUserIndex = findLastIndex(messages, (message) => message.kind === "user")
  const anchor = messages
    .slice(latestUserIndex + 1)
    .find((message) => message.kind === "assistant" || message.kind === "summary")
  return anchor?.id ?? null
}

function legacyAssistantAnchorAfterLatestUser(history: HistoryResponse): string | null {
  const latestUserIndex = findLastIndex(history.turns, (turn) => Boolean(turn.user_input))
  const turn = history.turns.slice(latestUserIndex + 1).find((candidate) => Boolean(candidate.response))
  return turn ? `turn-${turn.turn_number}-assistant` : null
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

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index
  }
  return -1
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
  const status = event.error_kind ? "failed" : statusKey(event.status)
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
  const httpBodyText = httpBodyTextPreview(event.capability_id, event.title, event.output_preview)
  if (httpBodyText) {
    return {
      kind: "capability_display_preview",
      title: activityTitleForStatus(event.title || event.capability_id, status),
      status,
      outputPreview: httpBodyText,
      truncated: event.truncated,
    }
  }

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

  const detail = [tool.error, tool.result_preview && !isGenericCapabilitySummary(tool.result_preview) ? tool.result_preview : null]
    .filter(Boolean)
    .join(" · ")
  const status = tool.has_error || toolTextLooksFailed(detail) ? "failed" : "completed"
  const label = tool.name === "Capability" ? "tool call" : tool.name
  if (!tool.error && (!tool.result_preview || isGenericCapabilitySummary(tool.result_preview)) && label === "tool call") {
    return null
  }

  return {
    kind: "tool_result_reference",
    title: label,
    status,
    detail,
  }
}

function capabilityToolActivity(tool: Extract<ToolCallInfo, { kind: "capability_display_preview" }>): TranscriptActivity {
  const statusText = [
    tool.status,
    tool.subtitle,
    tool.output_summary,
  ]
    .filter(Boolean)
    .join(" · ")
  const status = tool.has_error || toolTextLooksFailed(statusText)
    ? "failed"
    : statusKey(tool.status ?? "completed")
  const title = tool.name || tool.capability_id || "tool"
  const httpBodyText = httpBodyTextPreview(tool.capability_id, tool.name, tool.output_preview)
  if (httpBodyText) {
    return {
      kind: "capability_display_preview",
      title: activityTitleForStatus(title, status),
      status,
      outputPreview: httpBodyText,
      truncated: tool.truncated,
    }
  }

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

function toolTextLooksFailed(value: string): boolean {
  return /\b(error|failed|failure|killed|cancelled|backend)\b/i.test(value)
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
  const toolLines = toolSpecificActivityLines(activity)
  if (toolLines) return toolLines

  const lines = [`${activityGlyph(activity.status)} ${activity.title}`]
  if (activity.detail) lines.push(activity.detail)
  if (activity.inputSummary) lines.push(`input: ${activity.inputSummary}`)
  const output = transcriptActivityOutputLine(activity)
  if (output) lines.push(output)
  if (activity.outputPreview) lines.push(...activity.outputPreview.split(/\r?\n/))
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

function toolSpecificActivityLines(activity: TranscriptActivity): string[] | null {
  if (activity.kind === "capability_activity") return null

  const tool = toolKey(activity.title)
  const failed = activity.status === "failed" || activity.status === "killed"
  const glyph = activityGlyph(activity.status)
  const preview = outputPreviewLines(activity)
  const path = pathFromActivity(activity)
  const target = path ?? cleanSummary(activity.detail) ?? cleanSummary(activity.inputSummary)

  if (isHttpTool(tool, activity.title)) {
    return [`${glyph} ${activity.title}`, ...preview, ...truncatedLine(activity)]
  }

  if (isReadTool(tool)) {
    return [
      `${glyph} ${failed ? "failed " : ""}read${target ? ` ${target}` : ""}`,
      ...preview,
      ...outputMetaLines(activity),
      ...truncatedLine(activity),
    ]
  }

  if (isListTool(tool)) {
    return [
      `${glyph} ${failed ? "failed " : ""}list${target ? ` ${target}` : tool ? ` ${tool}` : ""}`,
      ...preview,
      ...outputMetaLines(activity),
      ...truncatedLine(activity),
    ]
  }

  if (isSearchTool(tool)) {
    return [
      `${glyph} ${failed ? "failed " : ""}${searchLabel(tool)}${searchQuery(activity)}`,
      ...preview,
      ...outputMetaLines(activity),
      ...truncatedLine(activity),
    ]
  }

  if (isShellTool(tool)) {
    return [
      `${glyph} ${failed ? "failed command" : "command"}`,
      ...commandLines(activity),
      ...preview,
      ...outputMetaLines(activity),
      ...truncatedLine(activity),
    ]
  }

  if (isEditTool(tool)) {
    return [
      `${glyph} edit${target ? ` ${target}` : ""}`,
      ...diffSummaryLines(activity),
      ...preview,
      ...outputMetaLines(activity),
      ...truncatedLine(activity),
    ]
  }

  if (isWriteTool(tool)) {
    return [
      `${glyph} write${target ? ` ${target}` : ""}`,
      ...diffSummaryLines(activity),
      ...preview,
      ...outputMetaLines(activity),
      ...truncatedLine(activity),
    ]
  }

  return null
}

function outputPreviewLines(activity: TranscriptActivity): string[] {
  return activity.outputPreview?.split(/\r?\n/) ?? []
}

function outputMetaLines(activity: TranscriptActivity): string[] {
  const output = transcriptActivityOutputLine(activity)
  return output ? [output] : []
}

function truncatedLine(activity: TranscriptActivity): string[] {
  return activity.truncated ? ["truncated"] : []
}

function toolKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(using|failed|killed|completed|running)\s+/, "")
    .replace(/^builtin[._-]/, "")
    .trim()
}

function isReadTool(tool: string): boolean {
  return /\b(read|read_file|cat)\b/.test(tool)
}

function isListTool(tool: string): boolean {
  return /\b(list|list_dir|ls)\b/.test(tool)
}

function isSearchTool(tool: string): boolean {
  return /\b(grep|glob|search|find|rg)\b/.test(tool)
}

function isShellTool(tool: string): boolean {
  return /\b(shell|exec|execute|command|bash|zsh|ctx_execute|ctx_batch_execute)\b/.test(tool)
}

function isEditTool(tool: string): boolean {
  return /\b(edit|apply_patch|patch)\b/.test(tool)
}

function isWriteTool(tool: string): boolean {
  return /\b(write|write_file|create_file)\b/.test(tool)
}

function isHttpTool(tool: string, title: string): boolean {
  return /\bhttps?\b|\bhttp\b/i.test(`${tool} ${title}`)
}

function searchLabel(tool: string): string {
  if (tool.includes("glob")) return "glob"
  if (tool.includes("grep") || tool.includes("rg")) return "grep"
  return "search"
}

function searchQuery(activity: TranscriptActivity): string {
  const pattern = fieldValue(activity.inputSummary, ["pattern", "query", "regex"])
  const path = fieldValue(activity.inputSummary, ["path", "cwd", "directory", "root"]) ?? pathFromActivity(activity)
  const parts = [
    pattern ? ` /${pattern}/` : cleanSummary(activity.inputSummary) ? ` ${cleanSummary(activity.inputSummary)}` : "",
    path ? ` in ${path}` : "",
  ]
  return parts.join("")
}

function commandLines(activity: TranscriptActivity): string[] {
  const command = fieldValue(activity.inputSummary, ["command", "cmd", "shell", "args"]) ?? cleanSummary(activity.inputSummary)
  return command ? [`$ ${command}`] : []
}

function diffSummaryLines(activity: TranscriptActivity): string[] {
  return [activity.outputSummary, activity.detail]
    .map(cleanSummary)
    .filter((line): line is string => Boolean(line))
}

function pathFromActivity(activity: TranscriptActivity): string | null {
  return (
    cleanPath(activity.detail) ??
    fieldValue(activity.inputSummary, ["path", "file", "filename", "target", "cwd", "directory"]) ??
    cleanPath(activity.inputSummary)
  )
}

function fieldValue(summary: string | null | undefined, keys: string[]): string | null {
  if (!summary) return null
  for (const key of keys) {
    const match = summary.match(new RegExp(`(?:^|[,;\\s])${key}\\s*[:=]\\s*([^,;\\n]+)`, "i"))
    const value = match?.[1]?.trim()
    if (value) return stripQuotes(value)
  }
  return null
}

function cleanPath(value: string | null | undefined): string | null {
  const cleaned = cleanSummary(value)
  if (!cleaned) return null
  if (/^[\w.-]+:\s/.test(cleaned)) return null
  if (cleaned.includes(" · ")) return cleaned.split(" · ")[0]?.trim() || null
  return cleaned
}

function cleanSummary(value: string | null | undefined): string | null {
  const cleaned = value?.trim()
  return cleaned || null
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "")
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

function httpBodyTextPreview(capabilityId?: string | null, title?: string | null, outputPreview?: string | null): string | null {
  if (!outputPreview || !isHttpCapability(capabilityId, title)) return null
  return findBodyText(parseJsonValue(outputPreview))
}

function isHttpCapability(capabilityId?: string | null, title?: string | null): boolean {
  return [capabilityId, title].filter(Boolean).some((value) => /\bhttps?\b|\bhttp\b/i.test(String(value)))
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function findBodyText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  if ("body_text" in value && typeof value.body_text === "string") return value.body_text

  for (const nested of Object.values(value)) {
    const bodyText = findBodyText(nested)
    if (bodyText) return bodyText
  }

  return null
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

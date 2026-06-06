import type { ClientConfig } from "../config"
import { parseSse } from "./sse"
import type {
  AppEvent,
  AutomationListResponse,
  ExtensionActionResponse,
  ExtensionListResponse,
  ExtensionRegistryResponse,
  ExtensionSetupResponse,
  GateResolveRequest,
  HistoryResponse,
  LifecyclePackageRef,
  LlmConfigSnapshot,
  ManualTokenSecretSubmitRequest,
  ManualTokenSetupResponse,
  ManualTokenSubmitRequest,
  ManualTokenSubmitResponse,
  RebornCancelRunResponse,
  RebornCreateThreadResponse,
  RebornListThreadsResponse,
  RebornMessageRecord,
  RebornSubmitTurnResponse,
  RebornThreadRecord,
  RebornTimelineResponse,
  RebornWebChatEventFrame,
  SendMessageResponse,
  TimelineMessageInfo,
  ThreadInfo,
  ThreadListResponse,
  TurnInfo,
} from "./types"

const THREAD_LIST_PAGE_LIMIT = 100

export class GatewayClient {
  constructor(private readonly config: ClientConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl
  }

  async health(): Promise<void> {
    await this.threadPage(1).catch((error: unknown) => {
      if (isUnavailableThreadList(error)) return
      throw error
    })
  }

  async status(): Promise<unknown> {
    return { status: "ok", surface: "webchat_v2" }
  }

  async threads(): Promise<ThreadListResponse> {
    const records = await this.threadRecords()
    const threads = records.map(mapThread)
    return {
      threads,
      active_thread: threads[0]?.id ?? null,
      assistant_thread: null,
    }
  }

  async newThread(): Promise<ThreadInfo> {
    const response = await this.createThread()
    return mapThread(response.thread)
  }

  async history(threadId?: string | null, limit = 80, cursor?: string | null): Promise<HistoryResponse> {
    if (!threadId) {
      return { thread_id: "", turns: [], has_more: false }
    }
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set("cursor", cursor)
    const response = await this.requestJson<RebornTimelineResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/timeline?${params}`,
      { method: "GET" },
    )
    return {
      thread_id: response.thread.thread_id,
      messages: response.messages.flatMap(mapMessageToTimelineMessage),
      turns: response.messages.flatMap(mapMessageToTurn),
      has_more: Boolean(response.next_cursor),
      next_cursor: response.next_cursor ?? null,
    }
  }

  async send(content: string, threadId?: string | null): Promise<SendMessageResponse> {
    const targetThreadId = threadId ?? (await this.createThread()).thread.thread_id
    const response = await this.requestJson<RebornSubmitTurnResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(targetThreadId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          client_action_id: actionId("message"),
        }),
      },
    )
    return {
      message_id: response.accepted_message_ref,
      status: response.status,
      thread_id: response.thread_id,
      run_id: response.outcome === "deferred_busy" ? response.active_run_id : response.run_id,
    }
  }

  async resolveGate(payload: GateResolveRequest): Promise<SendMessageResponse> {
    const threadId = payload.thread_id
    const { runId, gateRef } = resolveGatePathParts(payload)
    if (!threadId || !runId || !gateRef) {
      throw new Error("Missing thread/run/gate information for WebChat v2 gate resolution")
    }
    const response = await this.requestJson<unknown>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(gateRef)}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({
          client_action_id: actionId("gate"),
          resolution: payload.resolution,
          always: "always" in payload ? payload.always : undefined,
          credential_ref: "credential_ref" in payload ? payload.credential_ref : undefined,
        }),
      },
    )
    return { message_id: gateRef, status: "resolved", thread_id: threadId, response }
  }

  async submitManualToken(payload: ManualTokenSubmitRequest): Promise<ManualTokenSubmitResponse> {
    const setup = await this.requestJson<ManualTokenSetupResponse>("/api/reborn/product-auth/manual-token/setup", {
      method: "POST",
      body: JSON.stringify({
        provider: payload.provider,
        account_label: payload.account_label,
        thread_id: payload.thread_id,
        run_id: payload.run_id,
        gate_ref: payload.gate_ref,
      }),
    })
    const secretSubmit: ManualTokenSecretSubmitRequest = {
      interaction_id: setup.interaction_id,
      token: payload.token,
      thread_id: payload.thread_id,
      invocation_id: setup.invocation_id,
    }
    return this.requestJson<ManualTokenSubmitResponse>("/api/reborn/product-auth/manual-token/secret-submit", {
      method: "POST",
      body: JSON.stringify(secretSubmit),
    })
  }

  async cancelRun(threadId: string, runId: string): Promise<RebornCancelRunResponse> {
    return this.requestJson<RebornCancelRunResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ client_action_id: actionId("cancel") }),
      },
    )
  }

  async automations(limit = 50): Promise<AutomationListResponse> {
    const params = new URLSearchParams({ limit: String(limit) })
    return this.requestJson<AutomationListResponse>(`/api/webchat/v2/automations?${params}`, { method: "GET" })
  }

  async extensions(): Promise<ExtensionListResponse> {
    return this.requestJson<ExtensionListResponse>("/api/webchat/v2/extensions", { method: "GET" })
  }

  async extensionRegistry(): Promise<ExtensionRegistryResponse> {
    return this.requestJson<ExtensionRegistryResponse>("/api/webchat/v2/extensions/registry", { method: "GET" })
  }

  async installExtension(packageRef: LifecyclePackageRef): Promise<ExtensionActionResponse> {
    return this.requestJson<ExtensionActionResponse>("/api/webchat/v2/extensions/install", {
      method: "POST",
      body: JSON.stringify({ package_ref: packageRef }),
    })
  }

  async activateExtension(packageId: string): Promise<ExtensionActionResponse> {
    return this.requestJson<ExtensionActionResponse>(
      `/api/webchat/v2/extensions/${encodeURIComponent(packageId)}/activate`,
      { method: "POST" },
    )
  }

  async removeExtension(packageId: string): Promise<ExtensionActionResponse> {
    return this.requestJson<ExtensionActionResponse>(
      `/api/webchat/v2/extensions/${encodeURIComponent(packageId)}/remove`,
      { method: "POST" },
    )
  }

  async extensionSetup(packageId: string): Promise<ExtensionSetupResponse> {
    return this.requestJson<ExtensionSetupResponse>(
      `/api/webchat/v2/extensions/${encodeURIComponent(packageId)}/setup`,
      { method: "GET" },
    )
  }

  async submitExtensionSetup(
    packageId: string,
    payload: { secrets?: Record<string, string>; fields?: Record<string, string> },
  ): Promise<ExtensionSetupResponse> {
    return this.requestJson<ExtensionSetupResponse>(
      `/api/webchat/v2/extensions/${encodeURIComponent(packageId)}/setup`,
      {
        method: "POST",
        body: JSON.stringify({ action: "submit", payload }),
      },
    )
  }

  async llmConfig(): Promise<LlmConfigSnapshot> {
    return this.requestJson<LlmConfigSnapshot>("/api/webchat/v2/llm/providers", { method: "GET" })
  }

  async setActiveLlm(providerId: string, model?: string | null): Promise<LlmConfigSnapshot> {
    return this.requestJson<LlmConfigSnapshot>("/api/webchat/v2/llm/active", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId, model }),
    })
  }

  async *events(threadId?: string | null, lastEventId?: string): AsyncGenerator<AppEvent> {
    if (!threadId) return
    const params = new URLSearchParams({ token: this.config.token })
    if (lastEventId) params.set("after_cursor", lastEventId)

    const response = await fetch(
      `${this.config.baseUrl}/api/webchat/v2/threads/${encodeURIComponent(threadId)}/events?${params}`,
    )
    if (!response.ok) {
      throw new Error(`SSE failed: HTTP ${response.status} ${await response.text()}`)
    }

    for await (const frame of parseSse(response)) {
      for (const event of mapWebChatEvents(parseWebChatEvent(frame.data), threadId)) {
        yield event
      }
    }
  }

  private async createThread(): Promise<RebornCreateThreadResponse> {
    return this.requestJson<RebornCreateThreadResponse>("/api/webchat/v2/threads", {
      method: "POST",
      body: JSON.stringify({ client_action_id: actionId("thread") }),
    })
  }

  private async threadRecords(): Promise<RebornThreadRecord[]> {
    const records: RebornThreadRecord[] = []
    let cursor: string | null | undefined
    do {
      const page = await this.threadPage(THREAD_LIST_PAGE_LIMIT, cursor).catch((error: unknown) => {
        if (isUnavailableThreadList(error)) return { threads: [], next_cursor: null }
        throw error
      })
      records.push(...page.threads)
      cursor = page.next_cursor
    } while (cursor)
    return records
  }

  private async threadPage(limit: number, cursor?: string | null): Promise<RebornListThreadsResponse> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set("cursor", cursor)
    return this.requestJson<RebornListThreadsResponse>(`/api/webchat/v2/threads?${params}`, { method: "GET" })
  }

  private async requestJson<T>(path: string, init: RequestInit & { auth?: boolean }): Promise<T> {
    const response = await this.request(path, init)
    return response.json() as Promise<T>
  }

  private async request(path: string, init: RequestInit & { auth?: boolean }): Promise<Response> {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    if (init.auth !== false) {
      if (!this.config.token) throw new Error("Missing OPEN_IRONCLAW_TOKEN, IRONCLAW_REBORN_WEBUI_TOKEN, or --token")
      headers.set("Authorization", `Bearer ${this.config.token}`)
    }

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new GatewayHttpError(response.status, text || response.statusText)
    }

    return response
  }
}

class GatewayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body}`)
  }
}

function isUnavailableThreadList(error: unknown): boolean {
  if (!(error instanceof GatewayHttpError) || error.status !== 503) return false
  try {
    const body = JSON.parse(error.body) as { error?: string; kind?: string; retryable?: boolean }
    return body.error === "unavailable" && body.kind === "service_unavailable" && body.retryable === true
  } catch {
    return false
  }
}

function mapThread(thread: RebornThreadRecord): ThreadInfo {
  return {
    id: thread.thread_id,
    state: "active",
    turn_count: 0,
    created_at: thread.created_at ?? "",
    updated_at: thread.updated_at ?? "",
    title: thread.title ?? null,
    thread_type: "webchat_v2",
    channel: "webchat_v2",
  }
}

function mapMessageToTurn(message: RebornMessageRecord, index: number): TurnInfo[] {
  if (message.kind === "checkpoint_reference" || message.kind === "tool_result_reference" || message.kind === "capability_display_preview") return []

  const content = message.content ?? ""
  const isAssistant = message.kind === "assistant" || message.kind === "system" || message.kind === "summary"
  return [
    {
      turn_number: message.sequence ?? index,
      user_message_id: message.message_id,
      user_input: isAssistant ? "" : content,
      response: isAssistant ? content : null,
      state: message.status,
      started_at: "",
      completed_at: null,
      tool_calls: [],
    },
  ]
}

function mapMessageToTimelineMessage(message: RebornMessageRecord): TimelineMessageInfo[] {
  if (message.kind === "checkpoint_reference") return []
  if (message.kind === "tool_result_reference") {
    const activity = toolResultReference(message)
    if (!activity) return []
    return [{
      kind: message.kind,
      id: message.message_id,
      thread_id: message.thread_id,
      sequence: message.sequence,
      status: message.status,
      activity,
    }]
  }
  if (message.kind === "capability_display_preview") {
    const activity = capabilityDisplayPreviewReference(message)
    if (!activity) return []
    return [{
      kind: message.kind,
      id: message.message_id,
      thread_id: message.thread_id,
      sequence: message.sequence,
      status: message.status,
      activity,
    }]
  }

  return [{
    kind: message.kind,
    id: message.message_id,
    thread_id: message.thread_id,
    sequence: message.sequence,
    status: message.status,
    content: message.content ?? "",
  }]
}

function toolResultReference(message: RebornMessageRecord): TurnInfo["tool_calls"][number] | null {
  const envelope = parseToolResultEnvelope(message.content)
  const resultRef = message.tool_result_ref ?? envelope?.result_ref ?? null
  const safeSummary = envelope?.safe_summary ?? message.content ?? null
  if (!safeSummary && !resultRef) return null

  return {
    kind: "tool_result_reference",
    name: "Capability",
    has_result: true,
    has_error: false,
    call_id: resultRef,
    result_preview: safeSummary,
    result: resultRef,
  }
}

type CapabilityDisplayPreviewEnvelope = {
  invocation_id?: string
  capability_id?: string
  status?: string
  title?: string
  subtitle?: string | null
  input_summary?: string | null
  output_summary?: string | null
  output_preview?: string | null
  output_kind?: string | null
  output_bytes?: number | null
  result_ref?: string | null
  truncated?: boolean
}

function capabilityDisplayPreviewReference(message: RebornMessageRecord): TurnInfo["tool_calls"][number] | null {
  const envelope = parseCapabilityDisplayPreviewEnvelope(message.content)
  const resultRef = message.tool_result_ref ?? stringOrNull(envelope?.result_ref)
  const title = stringOrNull(envelope?.title) ?? stringOrNull(envelope?.capability_id) ?? "Capability"
  const status = stringOrNull(envelope?.status) ?? message.status
  const hasError = ["failed", "killed"].includes(statusKey(status))
  if (!envelope && !resultRef) return null

  return {
    kind: "capability_display_preview",
    message_id: message.message_id,
    name: title,
    has_result: !hasError,
    has_error: hasError,
    call_id: stringOrNull(envelope?.invocation_id) ?? message.message_id,
    capability_id: stringOrNull(envelope?.capability_id),
    status,
    subtitle: stringOrNull(envelope?.subtitle),
    input_summary: stringOrNull(envelope?.input_summary),
    output_summary: stringOrNull(envelope?.output_summary),
    output_preview: stringOrNull(envelope?.output_preview),
    output_kind: stringOrNull(envelope?.output_kind),
    output_bytes: typeof envelope?.output_bytes === "number" ? envelope.output_bytes : null,
    result_ref: resultRef,
    truncated: envelope?.truncated === true,
    result_preview: stringOrNull(envelope?.output_summary) ?? stringOrNull(envelope?.output_preview),
    result: resultRef,
    error: hasError ? stringOrNull(envelope?.output_summary) ?? status : null,
  }
}

function parseToolResultEnvelope(content?: string | null): { result_ref?: string; safe_summary?: string } | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as { result_ref?: unknown; safe_summary?: unknown }
    return {
      result_ref: typeof parsed.result_ref === "string" ? parsed.result_ref : undefined,
      safe_summary: typeof parsed.safe_summary === "string" ? parsed.safe_summary : undefined,
    }
  } catch {
    return null
  }
}

function parseCapabilityDisplayPreviewEnvelope(content?: string | null): CapabilityDisplayPreviewEnvelope | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as CapabilityDisplayPreviewEnvelope
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch {
    return null
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function statusKey(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

function parseWebChatEvent(data: string): RebornWebChatEventFrame | null {
  if (!data.trim()) return null
  return JSON.parse(data) as RebornWebChatEventFrame
}

export function mapWebChatEvent(frame: RebornWebChatEventFrame | null, threadId: string): AppEvent | null {
  return prioritizedEvent(mapWebChatEvents(frame, threadId)) ?? null
}

export function mapWebChatEvents(frame: RebornWebChatEventFrame | null, threadId: string): AppEvent[] {
  if (!frame) return []
  switch (frame.type) {
    case "keep_alive":
      return [{ type: "heartbeat" }]
    case "accepted":
      return [{ type: "status", message: "accepted", thread_id: threadId }]
    case "running":
      return [{ type: "thinking", message: frame.progress?.kind ?? "running", thread_id: threadId }]
    case "capability_progress":
      return [{
        type: "tool_started",
        name: frame.progress?.kind ?? "capability",
        thread_id: threadId,
      }]
    case "capability_activity":
      return compactEvents(capabilityActivityEvent(frame, threadId))
    case "capability_display_preview":
      return compactEvents(capabilityDisplayPreviewEvent(frame, threadId))
    case "gate":
      return compactEvents(gateRequiredEvent(frame, threadId, "approval", frame.prompt?.gate_ref))
    case "auth_required":
      return compactEvents(gateRequiredEvent(frame, threadId, "auth", frame.prompt?.auth_request_ref))
    case "final_reply":
      return [{
        type: "response",
        content: frame.reply?.text ?? "",
        thread_id: threadId,
      }]
    case "failed":
      return [{
        type: "run_status",
        status: frame.run_state?.status ?? "failed",
        run_id: frame.run_state?.run_id,
        failure_category: frame.run_state?.failure?.category,
        thread_id: threadId,
      }]
    case "projection_snapshot":
    case "projection_update":
      return projectionEvents(frame, threadId)
    default:
      return [{ type: "status", message: frame.type, thread_id: threadId }]
  }
}

function compactEvents(...events: Array<AppEvent | null>): AppEvent[] {
  return events.filter((event): event is AppEvent => Boolean(event))
}

function gateRequiredEvent(
  frame: RebornWebChatEventFrame,
  threadId: string,
  gateName: string,
  gateRef?: string,
): AppEvent | null {
  const runId = frame.prompt?.turn_run_id ?? ""
  const ref = gateRef ?? ""
  if (!runId || !ref) return { type: "status", message: frame.type, thread_id: threadId }
  const headline = frame.prompt?.headline ?? (gateName === "auth" ? "Authentication required" : "Approval required")
  return {
    type: "gate_required",
    request_id: `${runId}:${ref}`,
    gate_name: gateName,
    tool_name: headline,
    description: frame.prompt?.body ?? headline,
    parameters: "",
    extension_name: null,
    run_id: runId,
    gate_ref: ref,
    provider: gateName === "auth" ? frame.prompt?.provider ?? null : null,
    account_label: gateName === "auth" ? frame.prompt?.account_label ?? null : null,
    challenge_kind: gateName === "auth" ? frame.prompt?.challenge_kind ?? "manual_token" : null,
    authorization_url: gateName === "auth" ? frame.prompt?.authorization_url ?? null : null,
    expires_at: gateName === "auth" ? frame.prompt?.expires_at ?? null : null,
    resume_kind: { run_id: runId, gate_ref: ref },
    thread_id: threadId,
  }
}

function prioritizedEvent(events: AppEvent[]): AppEvent | null {
  return (
    events.find((event) => event.type === "run_status") ??
    events.find((event) => event.type === "response") ??
    events.find((event) => event.type === "thinking_update") ??
    events[0] ??
    null
  )
}

function capabilityActivityEvent(frame: RebornWebChatEventFrame, threadId: string): AppEvent | null {
  const activity = frame.activity
  if (!activity || typeof activity.invocation_id !== "string" || typeof activity.capability_id !== "string") {
    return { type: "status", message: "capability_activity", thread_id: threadId }
  }

  return {
    type: "capability_activity",
    invocation_id: activity.invocation_id,
    capability_id: activity.capability_id,
    status: typeof activity.status === "string" ? activity.status : "running",
    provider: typeof activity.provider === "string" ? activity.provider : null,
    runtime: typeof activity.runtime === "string" ? activity.runtime : null,
    process_id: typeof activity.process_id === "string" ? activity.process_id : null,
    output_bytes: typeof activity.output_bytes === "number" ? activity.output_bytes : null,
    error_kind: typeof activity.error_kind === "string" ? activity.error_kind : null,
    thread_id: typeof activity.thread_id === "string" ? activity.thread_id : threadId,
  }
}

function capabilityDisplayPreviewEvent(frame: RebornWebChatEventFrame, threadId: string): AppEvent | null {
  const preview = frame.preview
  if (
    !preview ||
    typeof preview.invocation_id !== "string" ||
    typeof preview.capability_id !== "string" ||
    typeof preview.title !== "string"
  ) {
    return { type: "status", message: "capability_display_preview", thread_id: threadId }
  }

  return {
    type: "capability_display_preview",
    timeline_message_id: typeof preview.timeline_message_id === "string" ? preview.timeline_message_id : null,
    invocation_id: preview.invocation_id,
    capability_id: preview.capability_id,
    status: typeof preview.status === "string" ? preview.status : "completed",
    title: preview.title,
    subtitle: typeof preview.subtitle === "string" ? preview.subtitle : null,
    input_summary: typeof preview.input_summary === "string" ? preview.input_summary : null,
    output_summary: typeof preview.output_summary === "string" ? preview.output_summary : null,
    output_preview: typeof preview.output_preview === "string" ? preview.output_preview : null,
    output_kind: typeof preview.output_kind === "string" ? preview.output_kind : null,
    output_bytes: typeof preview.output_bytes === "number" ? preview.output_bytes : null,
    result_ref: typeof preview.result_ref === "string" ? preview.result_ref : null,
    truncated: preview.truncated === true,
    thread_id: typeof preview.thread_id === "string" ? preview.thread_id : threadId,
  }
}

function projectionEvents(frame: RebornWebChatEventFrame, threadId: string): AppEvent[] {
  const items = frame.state?.items ?? []
  const runStatusEvents: AppEvent[] = []
  const gateEvents: AppEvent[] = []
  const thinkingEvents: AppEvent[] = []
  const workSummaryEvents: AppEvent[] = []
  const skillActivationEvents: AppEvent[] = []
  const textEvents: AppEvent[] = []

  for (const item of items) {
    runStatusEvents.push(...runStatusFromProjectionItem(item).map((runStatus): AppEvent => ({
        type: "run_status",
        status: runStatus.status,
        run_id: runStatus.run_id,
        failure_category: runStatus.failure_category,
        thread_id: threadId,
    })))
    gateEvents.push(...gateFromProjectionItem(item).map((gate): AppEvent => ({
      type: "gate_required",
      request_id: gate.gate_ref,
      gate_name: "approval",
      tool_name: "approval",
      description: gate.headline,
      parameters: "",
      resume_kind: { gate_ref: gate.gate_ref },
      thread_id: threadId,
      run_id: null,
      gate_ref: gate.gate_ref,
    })))
    thinkingEvents.push(...thinkingFromProjectionItem(item).map((thinking): AppEvent => ({
      type: "thinking_update",
      id: thinking.id,
      content: thinking.body,
      thread_id: threadId,
    })))
    workSummaryEvents.push(...workSummaryFromProjectionItem(item).map((summary): AppEvent => ({
      type: "work_summary_update",
      id: summary.id,
      run_id: summary.run_id,
      phase: summary.phase,
      content: summary.body,
      thread_id: threadId,
    })))
    skillActivationEvents.push(...skillActivationFromProjectionItem(item).map((activation): AppEvent => ({
      type: "skill_activated",
      id: activation.id,
      run_id: activation.run_id,
      skill_names: activation.skill_names,
      feedback: activation.feedback,
      thread_id: threadId,
    })))
    textEvents.push(...textBodyFromProjectionItem(item).map((content): AppEvent => ({ type: "response", content, thread_id: threadId })))
  }

  const events = [...runStatusEvents, ...gateEvents, ...thinkingEvents, ...workSummaryEvents, ...skillActivationEvents, ...textEvents]
  return events.length > 0 ? events : [{ type: "status", message: frame.type, thread_id: threadId }]
}

function textBodyFromProjectionItem(item: Record<string, unknown>): string[] {
  const directBody = item.type === "text" && typeof item.body === "string" ? item.body : null
  if (directBody) return [directBody]

  const text = item.text
  if (text && typeof text === "object" && "body" in text && typeof text.body === "string") {
    return [text.body]
  }

  return []
}

function thinkingFromProjectionItem(item: Record<string, unknown>): Array<{ id: string; body: string }> {
  if (item.type === "thinking" && typeof item.id === "string" && typeof item.body === "string") {
    return [{ id: item.id, body: item.body }]
  }

  const thinking = item.thinking
  if (
    thinking &&
    typeof thinking === "object" &&
    "id" in thinking &&
    typeof thinking.id === "string" &&
    "body" in thinking &&
    typeof thinking.body === "string"
  ) {
    return [{ id: thinking.id, body: thinking.body }]
  }

  return []
}

function workSummaryFromProjectionItem(
  item: Record<string, unknown>,
): Array<{ id: string; run_id?: string | null; phase: string; body: string }> {
  if (
    item.type === "work_summary" &&
    typeof item.id === "string" &&
    typeof item.phase === "string" &&
    typeof item.body === "string"
  ) {
    return [{
      id: item.id,
      run_id: typeof item.run_id === "string" ? item.run_id : null,
      phase: item.phase,
      body: item.body,
    }]
  }

  const workSummary = item.work_summary
  if (workSummary && typeof workSummary === "object") {
    return workSummaryFromRecord(workSummary as Record<string, unknown>)
  }

  return []
}

function workSummaryFromRecord(
  record: Record<string, unknown>,
): Array<{ id: string; run_id?: string | null; phase: string; body: string }> {
  if (typeof record.id !== "string" || typeof record.phase !== "string" || typeof record.body !== "string") {
    return []
  }
  return [{
    id: record.id,
    run_id: typeof record.run_id === "string" ? record.run_id : null,
    phase: record.phase,
    body: record.body,
  }]
}

function skillActivationFromProjectionItem(
  item: Record<string, unknown>,
): Array<{ id: string; run_id?: string | null; skill_names: string[]; feedback: string[] }> {
  if (item.type === "skill_activation") return skillActivationFromRecord(item)

  const skillActivation = item.skill_activation
  if (skillActivation && typeof skillActivation === "object") {
    return skillActivationFromRecord(skillActivation as Record<string, unknown>)
  }

  return []
}

function skillActivationFromRecord(
  record: Record<string, unknown>,
): Array<{ id: string; run_id?: string | null; skill_names: string[]; feedback: string[] }> {
  if (typeof record.id !== "string") return []
  const skillNames = stringArray(record.skill_names)
  const feedback = stringArray(record.feedback)
  if (skillNames.length === 0 && feedback.length === 0) return []
  return [{
    id: record.id,
    run_id: typeof record.run_id === "string" ? record.run_id : null,
    skill_names: skillNames,
    feedback,
  }]
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function runStatusFromProjectionItem(
  item: Record<string, unknown>,
): Array<{ run_id?: string | null; status: string; failure_category?: string | null }> {
  const runStatus = item.run_status
  if (runStatus && typeof runStatus === "object") {
    return runStatusFromRecord(runStatus as Record<string, unknown>)
  }

  if (item.type === "run_status") return runStatusFromRecord(item)

  return []
}

function runStatusFromRecord(
  record: Record<string, unknown>,
): Array<{ run_id?: string | null; status: string; failure_category?: string | null }> {
  if (typeof record.status !== "string") return []
  const failure = record.failure
  return [
    {
      run_id: typeof record.run_id === "string" ? record.run_id : null,
      status: record.status,
      failure_category:
        failure && typeof failure === "object" && "category" in failure && typeof failure.category === "string"
          ? failure.category
          : null,
    },
  ]
}

function gateFromProjectionItem(item: Record<string, unknown>): Array<{ gate_ref: string; headline: string }> {
  if (item.type === "gate") return gateFromProjectionRecord(item)
  const gate = item.gate
  if (gate && typeof gate === "object") return gateFromProjectionRecord(gate as Record<string, unknown>)
  return []
}

function gateFromProjectionRecord(record: Record<string, unknown>): Array<{ gate_ref: string; headline: string }> {
  if (typeof record.gate_ref !== "string") return []
  return [{
    gate_ref: record.gate_ref,
    headline: typeof record.headline === "string" ? record.headline : "Approval required",
  }]
}

function actionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function resolveGatePathParts(payload: GateResolveRequest): { runId?: string | null; gateRef?: string | null } {
  if ("run_id" in payload || "gate_ref" in payload) {
    return {
      runId: payload.run_id,
      gateRef: payload.gate_ref,
    }
  }
  const [runId, ...gateRefParts] = payload.request_id.split(":")
  return { runId, gateRef: gateRefParts.join(":") }
}

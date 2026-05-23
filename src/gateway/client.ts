import type { ClientConfig } from "../config"
import { parseSse } from "./sse"
import type {
  AppEvent,
  GateResolveRequest,
  HistoryResponse,
  RebornCreateThreadResponse,
  RebornListThreadsResponse,
  RebornMessageRecord,
  RebornSubmitTurnResponse,
  RebornThreadRecord,
  RebornTimelineResponse,
  RebornWebChatEventFrame,
  SendMessageResponse,
  ThreadInfo,
  ThreadListResponse,
  TurnInfo,
} from "./types"

export class GatewayClient {
  constructor(private readonly config: ClientConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl
  }

  async health(): Promise<void> {
    await this.threads()
  }

  async status(): Promise<unknown> {
    return { status: "ok", surface: "webchat_v2" }
  }

  async threads(): Promise<ThreadListResponse> {
    const response = await this.requestJson<RebornListThreadsResponse>("/api/webchat/v2/threads", { method: "GET" })
    const threads = response.threads.map(mapThread)
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

  async history(threadId?: string | null, limit = 80): Promise<HistoryResponse> {
    if (!threadId) {
      return { thread_id: "", turns: [], has_more: false }
    }
    const params = new URLSearchParams({ limit: String(limit) })
    const response = await this.requestJson<RebornTimelineResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/timeline?${params}`,
      { method: "GET" },
    )
    return {
      thread_id: response.thread.thread_id,
      turns: response.messages.map(mapMessageToTurn),
      has_more: Boolean(response.next_cursor),
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
        }),
      },
    )
    return { message_id: gateRef, status: "resolved", thread_id: threadId, response }
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
      const event = mapWebChatEvent(parseWebChatEvent(frame.data), threadId)
      if (event) yield event
    }
  }

  private async createThread(): Promise<RebornCreateThreadResponse> {
    return this.requestJson<RebornCreateThreadResponse>("/api/webchat/v2/threads", {
      method: "POST",
      body: JSON.stringify({ client_action_id: actionId("thread") }),
    })
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
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`)
    }

    return response
  }
}

function mapThread(thread: RebornThreadRecord): ThreadInfo {
  return {
    id: thread.thread_id,
    state: "active",
    turn_count: 0,
    created_at: "",
    updated_at: "",
    title: thread.title ?? thread.thread_id,
    thread_type: "webchat_v2",
    channel: "webchat_v2",
  }
}

function mapMessageToTurn(message: RebornMessageRecord, index: number): TurnInfo {
  const content = message.content ?? ""
  const isAssistant = message.kind === "assistant" || message.kind === "system" || message.kind === "summary"
  return {
    turn_number: message.sequence ?? index,
    user_message_id: message.message_id,
    user_input: isAssistant ? "" : content,
    response: isAssistant ? content : null,
    state: message.status,
    started_at: "",
    completed_at: null,
    tool_calls: [],
  }
}

function parseWebChatEvent(data: string): RebornWebChatEventFrame | null {
  if (!data.trim()) return null
  return JSON.parse(data) as RebornWebChatEventFrame
}

function mapWebChatEvent(frame: RebornWebChatEventFrame | null, threadId: string): AppEvent | null {
  if (!frame) return null
  switch (frame.type) {
    case "keep_alive":
      return { type: "heartbeat" }
    case "accepted":
      return { type: "status", message: "accepted", thread_id: threadId }
    case "running":
      return { type: "thinking", message: frame.progress?.kind ?? "running", thread_id: threadId }
    case "capability_progress":
      return {
        type: "tool_started",
        name: frame.progress?.kind ?? "capability",
        thread_id: threadId,
      }
    case "gate": {
      const runId = frame.prompt?.turn_run_id ?? ""
      const gateRef = frame.prompt?.gate_ref ?? ""
      return {
        type: "gate_required",
        request_id: `${runId}:${gateRef}`,
        gate_name: "approval",
        tool_name: frame.prompt?.headline ?? "approval",
        description: frame.prompt?.body ?? frame.prompt?.headline ?? "Approval required",
        parameters: "",
        extension_name: null,
        run_id: runId,
        gate_ref: gateRef,
        resume_kind: { run_id: runId, gate_ref: gateRef },
        thread_id: threadId,
      }
    }
    case "final_reply":
      return {
        type: "response",
        content: frame.reply?.text ?? "",
        thread_id: threadId,
      }
    case "failed":
      return { type: "error", message: "run failed", thread_id: threadId }
    case "projection_snapshot":
    case "projection_update":
      return projectionEvent(frame, threadId)
    default:
      return { type: "status", message: frame.type, thread_id: threadId }
  }
}

function projectionEvent(frame: RebornWebChatEventFrame, threadId: string): AppEvent | null {
  const bodies = frame.state?.items?.flatMap(textBodyFromProjectionItem) ?? []
  const body = bodies.at(-1) ?? null
  if (!body) return { type: "status", message: frame.type, thread_id: threadId }
  return { type: "response", content: body, thread_id: threadId }
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

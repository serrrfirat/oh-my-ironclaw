import type { ClientConfig } from "../config"
import { parseAppEvent, parseSse } from "./sse"
import type {
  AppEvent,
  GateResolveRequest,
  HistoryResponse,
  SendMessageRequest,
  SendMessageResponse,
  ThreadInfo,
  ThreadListResponse,
} from "./types"

export class GatewayClient {
  constructor(private readonly config: ClientConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl
  }

  async health(): Promise<void> {
    await this.request("/api/health", { method: "GET", auth: false })
  }

  async status(): Promise<unknown> {
    return this.requestJson("/api/gateway/status", { method: "GET" })
  }

  async threads(): Promise<ThreadListResponse> {
    return this.requestJson<ThreadListResponse>("/api/chat/threads", { method: "GET" })
  }

  async newThread(): Promise<ThreadInfo> {
    return this.requestJson<ThreadInfo>("/api/chat/thread/new", { method: "POST" })
  }

  async history(threadId?: string | null, limit = 80): Promise<HistoryResponse> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (threadId) params.set("thread_id", threadId)
    return this.requestJson<HistoryResponse>(`/api/chat/history?${params}`, { method: "GET" })
  }

  async send(content: string, threadId?: string | null): Promise<SendMessageResponse> {
    const body: SendMessageRequest = {
      content,
      thread_id: threadId ?? null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
    return this.requestJson<SendMessageResponse>("/api/chat/send", {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  async resolveGate(payload: GateResolveRequest): Promise<SendMessageResponse> {
    return this.requestJson<SendMessageResponse>("/api/chat/gate/resolve", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async *events(lastEventId?: string): AsyncGenerator<AppEvent> {
    const params = new URLSearchParams({ token: this.config.token })
    if (this.config.debugEvents) params.set("debug", "true")
    if (lastEventId) params.set("last_event_id", lastEventId)

    const response = await fetch(`${this.config.baseUrl}/api/chat/events?${params}`)
    if (!response.ok) {
      throw new Error(`SSE failed: HTTP ${response.status} ${await response.text()}`)
    }

    for await (const frame of parseSse(response)) {
      const event = parseAppEvent(frame)
      if (event) yield event
    }
  }

  private async requestJson<T>(path: string, init: RequestInit & { auth?: boolean }): Promise<T> {
    const response = await this.request(path, init)
    return response.json() as Promise<T>
  }

  private async request(path: string, init: RequestInit & { auth?: boolean }): Promise<Response> {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    if (init.auth !== false) {
      if (!this.config.token) throw new Error("Missing OPEN_IRONCLAW_TOKEN or --token")
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


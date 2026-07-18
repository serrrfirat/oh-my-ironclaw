import type { ClientConfig } from "../config"
import { parseSse } from "./sse"
import type {
  AccountLoginLinkResponse,
  AccountTracesResponse,
  AppEvent,
  AttachmentBytes,
  AutomationListResponse,
  AutomationMutationResponse,
  CodexLoginStart,
  ConnectableChannelListResponse,
  CreateProjectRequest,
  ExtensionActionResponse,
  ExtensionListResponse,
  ExtensionRegistryResponse,
  ExtensionSetupResponse,
  FsListResponse,
  FsMountsResponse,
  GatewayErrorBody,
  GateResolveRequest,
  HistoryResponse,
  LifecyclePackageRef,
  LlmConfigSnapshot,
  LlmProviderActionPayload,
  LlmProviderModelsResult,
  LlmProviderTestResult,
  LlmProviderUpsertPayload,
  LlmProviderView,
  LogQuery,
  LogQueryResponse,
  ManualTokenSecretSubmitRequest,
  ManualTokenSetupResponse,
  ManualTokenSubmitRequest,
  ManualTokenSubmitResponse,
  NearAiAuthProvider,
  NearAiLoginStart,
  NearAiWalletLoginRequest,
  NearAiWalletLoginResult,
  OutboundDeliveryTargetListResponse,
  OutboundPreferencesResponse,
  OutgoingAttachment,
  ProjectFsListResponse,
  ProjectFsStatResponse,
  ProjectListResponse,
  ProjectMemberListResponse,
  ProjectResponse,
  ProjectRole,
  RebornCancelRunResponse,
  RebornCreateThreadResponse,
  RebornDeleteThreadResponse,
  RebornListThreadsResponse,
  RebornMessageRecord,
  RebornRetryRunResponse,
  RebornSubmitTurnResponse,
  RebornThreadRecord,
  RebornTimelineResponse,
  RebornWebChatEventFrame,
  SendMessageResponse,
  SessionResponse,
  SettingsToolEntryResponse,
  SettingsToolPermissionState,
  SettingsToolsResponse,
  SkillActionResponse,
  SkillContentResponse,
  SkillListResponse,
  SkillSearchResponse,
  TimelineMessageInfo,
  ThreadInfo,
  ThreadListResponse,
  TraceCreditsResponse,
  TraceHoldAuthorizeResponse,
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

  async send(
    content: string,
    threadId?: string | null,
    options?: { attachments?: OutgoingAttachment[]; model?: string | null },
  ): Promise<SendMessageResponse> {
    const targetThreadId = threadId ?? (await this.createThread()).thread.thread_id
    const attachments = options?.attachments ?? []
    const response = await this.requestJson<RebornSubmitTurnResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(targetThreadId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          client_action_id: actionId("message"),
          content,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(options?.model ? { model: options.model } : {}),
        }),
      },
    )
    return submitTurnToSendResponse(response)
  }

  async deleteThread(threadId: string): Promise<RebornDeleteThreadResponse> {
    return this.requestJson<RebornDeleteThreadResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}`,
      { method: "DELETE" },
    )
  }

  async session(): Promise<SessionResponse> {
    return this.requestJson<SessionResponse>("/api/webchat/v2/session", { method: "GET" })
  }

  // Count threads waiting on approval, for the approval-inbox badge.
  async approvalInbox(limit = 100): Promise<{ threads: RebornThreadRecord[]; count: number }> {
    const params = new URLSearchParams({ limit: String(limit), needs_approval: "true" })
    const page = await this.requestJson<RebornListThreadsResponse>(
      `/api/webchat/v2/threads?${params}`,
      { method: "GET" },
    ).catch((error: unknown) => {
      if (isUnavailableThreadList(error)) return { threads: [], next_cursor: null }
      throw error
    })
    return { threads: page.threads, count: page.threads.length }
  }

  // Raw bytes of one landed attachment (image/pdf/etc.), for save-to-file.
  async attachment(threadId: string, messageId: string, attachmentId: string): Promise<AttachmentBytes> {
    const response = await this.request(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "GET" },
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      mime_type: response.headers.get("Content-Type") ?? "application/octet-stream",
      filename: filenameFromContentDisposition(response.headers.get("Content-Disposition")),
      bytes,
    }
  }

  async retryRun(threadId: string, runId: string): Promise<RebornRetryRunResponse> {
    return this.requestJson<RebornRetryRunResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/retry`,
      {
        method: "POST",
        body: JSON.stringify({ client_action_id: actionId("retry") }),
      },
    )
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

  async connectableChannels(): Promise<ConnectableChannelListResponse> {
    return this.requestJson<ConnectableChannelListResponse>("/api/webchat/v2/channels/connectable", { method: "GET" })
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

  async upsertLlmProvider(payload: LlmProviderUpsertPayload): Promise<LlmConfigSnapshot> {
    return this.requestJson<LlmConfigSnapshot>("/api/webchat/v2/llm/providers", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async deleteLlmProvider(providerId: string): Promise<LlmConfigSnapshot> {
    return this.requestJson<LlmConfigSnapshot>(`/api/webchat/v2/llm/providers/${encodeURIComponent(providerId)}/delete`, {
      method: "POST",
    })
  }

  async testLlmProvider(provider: LlmProviderView, model?: string | null): Promise<LlmProviderTestResult> {
    return this.requestJson<LlmProviderTestResult>("/api/webchat/v2/llm/test-connection", {
      method: "POST",
      body: JSON.stringify(llmProviderActionPayload(provider, model)),
    })
  }

  async listLlmProviderModels(provider: LlmProviderView, model?: string | null): Promise<LlmProviderModelsResult> {
    return this.requestJson<LlmProviderModelsResult>("/api/webchat/v2/llm/list-models", {
      method: "POST",
      body: JSON.stringify(llmProviderActionPayload(provider, model)),
    })
  }

  async startNearAiLogin(provider: NearAiAuthProvider, origin: string): Promise<NearAiLoginStart> {
    return this.requestJson<NearAiLoginStart>("/api/webchat/v2/llm/nearai/login", {
      method: "POST",
      body: JSON.stringify({ provider, origin }),
    })
  }

  async completeNearAiWalletLogin(payload: NearAiWalletLoginRequest): Promise<NearAiWalletLoginResult> {
    return this.requestJson<NearAiWalletLoginResult>("/api/webchat/v2/llm/nearai/wallet", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async startCodexLogin(): Promise<CodexLoginStart> {
    return this.requestJson<CodexLoginStart>("/api/webchat/v2/llm/codex/login", { method: "POST" })
  }

  // ---- Skills (remote HTTP) ----

  async skills(): Promise<SkillListResponse> {
    return this.requestJson<SkillListResponse>("/api/webchat/v2/skills", { method: "GET" })
  }

  async searchSkills(query: string): Promise<SkillSearchResponse> {
    return this.requestJson<SkillSearchResponse>("/api/webchat/v2/skills/search", {
      method: "POST",
      body: JSON.stringify({ query }),
    })
  }

  async installSkill(name: string, content?: string | null): Promise<SkillActionResponse> {
    return this.requestJson<SkillActionResponse>("/api/webchat/v2/skills/install", {
      method: "POST",
      body: JSON.stringify({ name, ...(content != null ? { content } : {}) }),
    })
  }

  async skillContent(name: string): Promise<SkillContentResponse> {
    return this.requestJson<SkillContentResponse>(
      `/api/webchat/v2/skills/${encodeURIComponent(name)}`,
      { method: "GET" },
    )
  }

  async updateSkill(name: string, content: string): Promise<SkillActionResponse> {
    return this.requestJson<SkillActionResponse>(
      `/api/webchat/v2/skills/${encodeURIComponent(name)}`,
      { method: "PUT", body: JSON.stringify({ content }) },
    )
  }

  async removeSkill(name: string): Promise<SkillActionResponse> {
    return this.requestJson<SkillActionResponse>(
      `/api/webchat/v2/skills/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    )
  }

  async setSkillAutoActivate(name: string, enabled: boolean): Promise<SkillActionResponse> {
    return this.requestJson<SkillActionResponse>(
      `/api/webchat/v2/skills/${encodeURIComponent(name)}/auto-activate`,
      { method: "POST", body: JSON.stringify({ enabled }) },
    )
  }

  async setAutoActivateLearned(enabled: boolean): Promise<SkillActionResponse> {
    return this.requestJson<SkillActionResponse>("/api/webchat/v2/skills/auto-activate-learned", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    })
  }

  // ---- Settings: tools / approvals ----

  async settingsTools(): Promise<SettingsToolsResponse> {
    return this.requestJson<SettingsToolsResponse>("/api/webchat/v2/settings/tools", { method: "GET" })
  }

  async setSettingsToolsAutoApprove(enabled: boolean): Promise<SettingsToolEntryResponse> {
    return this.requestJson<SettingsToolEntryResponse>("/api/webchat/v2/settings/tools", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    })
  }

  async setSettingsToolPermission(
    capabilityId: string,
    state: SettingsToolPermissionState,
  ): Promise<SettingsToolEntryResponse> {
    return this.requestJson<SettingsToolEntryResponse>(
      `/api/webchat/v2/settings/tools/${encodeURIComponent(capabilityId)}`,
      { method: "POST", body: JSON.stringify({ state }) },
    )
  }

  // ---- Automation mutations ----

  async pauseAutomation(automationId: string): Promise<AutomationMutationResponse> {
    return this.requestJson<AutomationMutationResponse>(
      `/api/webchat/v2/automations/${encodeURIComponent(automationId)}/pause`,
      { method: "POST" },
    )
  }

  async resumeAutomation(automationId: string): Promise<AutomationMutationResponse> {
    return this.requestJson<AutomationMutationResponse>(
      `/api/webchat/v2/automations/${encodeURIComponent(automationId)}/resume`,
      { method: "POST" },
    )
  }

  async renameAutomation(automationId: string, name: string): Promise<AutomationMutationResponse> {
    return this.requestJson<AutomationMutationResponse>(
      `/api/webchat/v2/automations/${encodeURIComponent(automationId)}`,
      { method: "POST", body: JSON.stringify({ name }) },
    )
  }

  async deleteAutomation(automationId: string): Promise<AutomationMutationResponse> {
    return this.requestJson<AutomationMutationResponse>(
      `/api/webchat/v2/automations/${encodeURIComponent(automationId)}`,
      { method: "DELETE" },
    )
  }

  // ---- Outbound preferences / targets ----

  async outboundPreferences(): Promise<OutboundPreferencesResponse> {
    return this.requestJson<OutboundPreferencesResponse>("/api/webchat/v2/outbound/preferences", {
      method: "GET",
    })
  }

  // Passing null clears the saved final-reply target. `default_modality` is
  // response-only in the server contract, so it is never sent here.
  async setOutboundPreferences(finalReplyTargetId: string | null): Promise<OutboundPreferencesResponse> {
    return this.requestJson<OutboundPreferencesResponse>("/api/webchat/v2/outbound/preferences", {
      method: "POST",
      body: JSON.stringify({ final_reply_target_id: finalReplyTargetId }),
    })
  }

  async outboundTargets(): Promise<OutboundDeliveryTargetListResponse> {
    return this.requestJson<OutboundDeliveryTargetListResponse>("/api/webchat/v2/outbound/targets", {
      method: "GET",
    })
  }

  // ---- Logs ----

  async logs(query: LogQuery = {}): Promise<LogQueryResponse> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      params.set(key, String(value))
    }
    const search = params.toString()
    return this.requestJson<LogQueryResponse>(`/api/webchat/v2/logs${search ? `?${search}` : ""}`, {
      method: "GET",
    })
  }

  // ---- Traces ----

  async traceCredits(): Promise<TraceCreditsResponse> {
    return this.requestJson<TraceCreditsResponse>("/api/webchat/v2/traces/credit", { method: "GET" })
  }

  async traceAccount(): Promise<AccountTracesResponse> {
    return this.requestJson<AccountTracesResponse>("/api/webchat/v2/traces/account", { method: "GET" })
  }

  async traceAccountLoginLink(): Promise<AccountLoginLinkResponse> {
    return this.requestJson<AccountLoginLinkResponse>("/api/webchat/v2/traces/account-login-link", {
      method: "POST",
    })
  }

  async authorizeTraceHold(submissionId: string): Promise<TraceHoldAuthorizeResponse> {
    return this.requestJson<TraceHoldAuthorizeResponse>(
      `/api/webchat/v2/traces/holds/${encodeURIComponent(submissionId)}/authorize`,
      { method: "POST" },
    )
  }

  // ---- Thread-scoped project files ----

  async threadFiles(threadId: string, path?: string): Promise<ProjectFsListResponse> {
    const params = new URLSearchParams()
    if (path) params.set("path", path)
    const search = params.toString()
    return this.requestJson<ProjectFsListResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/files${search ? `?${search}` : ""}`,
      { method: "GET" },
    )
  }

  async threadFileStat(threadId: string, path: string): Promise<ProjectFsStatResponse> {
    const params = new URLSearchParams({ path })
    return this.requestJson<ProjectFsStatResponse>(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/files/stat?${params}`,
      { method: "GET" },
    )
  }

  async threadFileContent(threadId: string, path: string): Promise<AttachmentBytes> {
    const params = new URLSearchParams({ path })
    const response = await this.request(
      `/api/webchat/v2/threads/${encodeURIComponent(threadId)}/files/content?${params}`,
      { method: "GET" },
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      mime_type: response.headers.get("Content-Type") ?? "application/octet-stream",
      filename: filenameFromContentDisposition(response.headers.get("Content-Disposition")),
      bytes,
    }
  }

  // ---- Global filesystem mounts ----

  async fsMounts(): Promise<FsMountsResponse> {
    return this.requestJson<FsMountsResponse>("/api/webchat/v2/fs/mounts", { method: "GET" })
  }

  async fsList(mount: string, path?: string, projectId?: string): Promise<FsListResponse> {
    const params = new URLSearchParams({ mount })
    if (path) params.set("path", path)
    if (projectId) params.set("project_id", projectId)
    return this.requestJson<FsListResponse>(`/api/webchat/v2/fs/list?${params}`, { method: "GET" })
  }

  async fsStat(mount: string, path: string, projectId?: string): Promise<ProjectFsStatResponse> {
    const params = new URLSearchParams({ mount, path })
    if (projectId) params.set("project_id", projectId)
    return this.requestJson<ProjectFsStatResponse>(`/api/webchat/v2/fs/stat?${params}`, { method: "GET" })
  }

  async fsContent(mount: string, path: string, projectId?: string): Promise<AttachmentBytes> {
    const params = new URLSearchParams({ mount, path })
    if (projectId) params.set("project_id", projectId)
    const response = await this.request(`/api/webchat/v2/fs/content?${params}`, { method: "GET" })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      mime_type: response.headers.get("Content-Type") ?? "application/octet-stream",
      filename: filenameFromContentDisposition(response.headers.get("Content-Disposition")),
      bytes,
    }
  }

  // ---- Projects (feature-gated by features.reborn_projects) ----

  async projects(limit?: number): Promise<ProjectListResponse> {
    const params = new URLSearchParams()
    if (limit != null) params.set("limit", String(limit))
    const search = params.toString()
    return this.requestJson<ProjectListResponse>(`/api/webchat/v2/projects${search ? `?${search}` : ""}`, {
      method: "GET",
    })
  }

  async createProject(payload: CreateProjectRequest): Promise<ProjectResponse> {
    return this.requestJson<ProjectResponse>("/api/webchat/v2/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async project(projectId: string): Promise<ProjectResponse> {
    return this.requestJson<ProjectResponse>(
      `/api/webchat/v2/projects/${encodeURIComponent(projectId)}`,
      { method: "GET" },
    )
  }

  async deleteProject(projectId: string): Promise<unknown> {
    return this.requestJson<unknown>(`/api/webchat/v2/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    })
  }

  async projectMembers(projectId: string): Promise<ProjectMemberListResponse> {
    return this.requestJson<ProjectMemberListResponse>(
      `/api/webchat/v2/projects/${encodeURIComponent(projectId)}/members`,
      { method: "GET" },
    )
  }

  async addProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<unknown> {
    return this.requestJson<unknown>(
      `/api/webchat/v2/projects/${encodeURIComponent(projectId)}/members`,
      { method: "POST", body: JSON.stringify({ user_id: userId, role }) },
    )
  }

  async updateProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<unknown> {
    return this.requestJson<unknown>(
      `/api/webchat/v2/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      { method: "POST", body: JSON.stringify({ role }) },
    )
  }

  async removeProjectMember(projectId: string, userId: string): Promise<unknown> {
    return this.requestJson<unknown>(
      `/api/webchat/v2/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    )
  }

  // Long-lived SSE subscription with automatic resume. On a keep-alive-closed
  // stream (server forces a reconnect at max lifetime), a retryable error frame,
  // or a retryable HTTP status (429 busy / 503), the loop reconnects with
  // `?after_cursor=<last SSE id>` (Last-Event-ID semantics) after an exponential
  // backoff. A non-retryable error surfaces an `error` AppEvent and stops.
  async *events(threadId?: string | null, lastEventId?: string): AsyncGenerator<AppEvent> {
    if (!threadId) return
    let cursor = lastEventId
    let backoffMs = SSE_BASE_BACKOFF_MS

    while (true) {
      const params = new URLSearchParams({ token: this.config.token })
      if (cursor) params.set("after_cursor", cursor)

      let response: Response
      try {
        response = await fetch(
          `${this.config.baseUrl}/api/webchat/v2/threads/${encodeURIComponent(threadId)}/events?${params}`,
        )
      } catch (error) {
        // Transport error (connection reset, DNS, etc.) — treat as retryable.
        yield { type: "warning", source: "sse", message: `stream disconnected: ${String(error)}`, thread_id: threadId }
        await sleep(backoffMs)
        backoffMs = nextBackoff(backoffMs)
        continue
      }

      if (!response.ok) {
        const body = await parseGatewayErrorBody(response)
        if (isRetryableStatus(response.status, body)) {
          yield {
            type: "warning",
            source: "sse",
            message: `stream unavailable (HTTP ${response.status}${body?.kind ? `, ${body.kind}` : ""}); retrying`,
            thread_id: threadId,
          }
          await sleep(backoffMs)
          backoffMs = nextBackoff(backoffMs)
          continue
        }
        yield { type: "error", message: `SSE failed: HTTP ${response.status}${body?.error ? ` ${body.error}` : ""}`, thread_id: threadId }
        return
      }

      // Connected: reset backoff so the next transient blip starts small again.
      backoffMs = SSE_BASE_BACKOFF_MS
      let closedCleanly = true
      try {
        for await (const frame of parseSse(response)) {
          if (frame.id) cursor = frame.id
          if (frame.event === "error") {
            const errorFrame = parseSseErrorFrame(frame.data)
            if (errorFrame && !errorFrame.retryable) {
              yield { type: "error", message: `stream error: ${errorFrame.error}`, thread_id: threadId }
              return
            }
            yield {
              type: "warning",
              source: "sse",
              message: `stream error: ${errorFrame?.error ?? "unknown"}; reconnecting`,
              thread_id: threadId,
            }
            closedCleanly = false
            break
          }
          for (const event of mapWebChatEvents(parseWebChatEvent(frame.data), threadId)) {
            yield event
          }
        }
      } catch (error) {
        yield { type: "warning", source: "sse", message: `stream read failed: ${String(error)}`, thread_id: threadId }
        closedCleanly = false
      }

      // Stream ended (max-lifetime close or a retryable error frame). Reconnect
      // from the last cursor after a short backoff.
      if (!closedCleanly) {
        await sleep(backoffMs)
        backoffMs = nextBackoff(backoffMs)
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
      throw GatewayError.fromResponse(response.status, text || response.statusText)
    }

    return response
  }
}

function llmProviderActionPayload(provider: LlmProviderView, model?: string | null): LlmProviderActionPayload {
  return {
    provider_id: provider.id,
    provider_type: provider.builtin ? "builtin" : "custom",
    adapter: provider.adapter,
    base_url: provider.base_url ?? null,
    model: model || provider.active_model || provider.default_model || null,
  }
}

// Typed error for WebChat v2 responses. Parses the wire error body
// {error,kind,retryable,field?,validation_code?} (WebUiV2HttpErrorBody) so
// callers can branch on `kind`/`retryable` instead of scraping strings.
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly parsed: GatewayErrorBody | null,
  ) {
    super(
      parsed
        ? `HTTP ${status}: ${parsed.error}${parsed.kind ? ` (${parsed.kind})` : ""}`
        : `HTTP ${status}: ${body}`,
    )
    this.name = "GatewayError"
  }

  static fromResponse(status: number, body: string): GatewayError {
    return new GatewayError(status, body, parseGatewayErrorBodyText(body))
  }

  get errorCode(): string | null {
    return this.parsed?.error ?? null
  }

  get kind(): string | null {
    return this.parsed?.kind ?? null
  }

  get retryable(): boolean {
    return this.parsed?.retryable ?? false
  }

  get field(): string | null {
    return this.parsed?.field ?? null
  }

  get validationCode(): string | null {
    return this.parsed?.validation_code ?? null
  }
}

function parseGatewayErrorBodyText(body: string): GatewayErrorBody | null {
  try {
    const parsed = JSON.parse(body) as Partial<GatewayErrorBody>
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string" && typeof parsed.kind === "string") {
      return {
        error: parsed.error,
        kind: parsed.kind,
        retryable: parsed.retryable === true,
        field: typeof parsed.field === "string" ? parsed.field : null,
        validation_code: typeof parsed.validation_code === "string" ? parsed.validation_code : null,
      }
    }
  } catch {
    // fall through
  }
  return null
}

async function parseGatewayErrorBody(response: Response): Promise<GatewayErrorBody | null> {
  try {
    return parseGatewayErrorBodyText(await response.text())
  } catch {
    return null
  }
}

const SSE_BASE_BACKOFF_MS = 500
const SSE_MAX_BACKOFF_MS = 15_000

function nextBackoff(current: number): number {
  return Math.min(current * 2, SSE_MAX_BACKOFF_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Retryable transports: 429 busy (over SSE stream cap) and 503 service_unavailable.
function isRetryableStatus(status: number, body: GatewayErrorBody | null): boolean {
  if (body?.retryable) return true
  return status === 429 || status === 503
}

function parseSseErrorFrame(data: string): { error: string; kind?: string; retryable: boolean } | null {
  if (!data.trim()) return null
  try {
    const parsed = JSON.parse(data) as { error?: unknown; kind?: unknown; retryable?: unknown }
    if (typeof parsed.error !== "string") return null
    return {
      error: parsed.error,
      kind: typeof parsed.kind === "string" ? parsed.kind : undefined,
      retryable: parsed.retryable === true,
    }
  } catch {
    return null
  }
}

function isUnavailableThreadList(error: unknown): boolean {
  if (!(error instanceof GatewayError) || error.status !== 503) return false
  const body = error.parsed
  return body?.error === "unavailable" && body?.kind === "service_unavailable" && body?.retryable === true
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
      return compactEvents(
        {
          type: "run_status",
          status: frame.run_state?.status ?? "failed",
          run_id: frame.run_state?.run_id,
          failure_category: frame.run_state?.failure?.category,
          thread_id: threadId,
        },
        runUsageEvent(frame, threadId),
      )
    case "cancelled": {
      const cancel = isCancelResponse(frame.response) ? frame.response : null
      return [{
        type: "run_cancelled",
        run_id: cancel?.run_id ?? null,
        status: cancel?.status ?? "cancelled",
        already_terminal: cancel?.already_terminal ?? null,
        thread_id: threadId,
      }]
    }
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

function runUsageEvent(frame: RebornWebChatEventFrame, threadId: string): AppEvent | null {
  const usage = frame.run_state?.usage ?? null
  const cost = frame.run_state?.cost ?? null
  if (!usage && !cost) return null
  return {
    type: "run_usage",
    run_id: frame.run_state?.run_id ?? null,
    usage,
    cost,
    thread_id: threadId,
  }
}

function isCancelResponse(value: unknown): value is RebornCancelRunResponse {
  return Boolean(value) && typeof value === "object" && "run_id" in (value as Record<string, unknown>)
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

// Fold the RebornSubmitTurnResponse tagged union into the flat SendMessageResponse
// the UI consumes. `rejected_busy` is not an error: its `notice` is surfaced so the
// caller can show a non-error notice and keep the composer intact.
function submitTurnToSendResponse(response: RebornSubmitTurnResponse): SendMessageResponse {
  if (response.outcome === "rejected_busy") {
    return {
      message_id: response.accepted_message_ref,
      status: response.status ?? "rejected_busy",
      thread_id: response.thread_id,
      run_id: response.active_run_id ?? null,
      outcome: "rejected_busy",
      notice: response.notice,
    }
  }
  return {
    message_id: response.accepted_message_ref,
    status: response.status,
    thread_id: response.thread_id,
    run_id: response.run_id,
    outcome: response.outcome,
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""))
    } catch {
      return star[1].trim().replace(/^"|"$/g, "")
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i)
  return plain?.[1]?.trim() ?? null
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

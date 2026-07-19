export type SendMessageRequest = {
  content: string
  thread_id?: string | null
  timezone?: string | null
  images?: Array<{ media_type: string; data: string }>
  attachments?: Array<{ mime_type: string; filename?: string | null; data_base64: string }>
}

export type SendMessageResponse = {
  message_id: string
  status: string
  thread_id?: string | null
  run_id?: string | null
  response?: unknown
  outcome?: "submitted" | "rejected_busy" | "already_submitted" | "resolved"
  // Present only on a `rejected_busy` outcome — a non-error notice for the UI.
  notice?: string | null
}

export type ThreadInfo = {
  id: string
  state: string
  turn_count: number
  created_at: string
  updated_at: string
  title?: string | null
  thread_type?: string | null
  channel?: string | null
}

export type RebornThreadRecord = {
  thread_id: string
  title?: string | null
  created_at?: string | null
  updated_at?: string | null
  created_by_actor_id?: string | null
  metadata_json?: string | null
}

// Reference to a landed attachment on a timeline message.
export type RebornAttachmentRef = {
  attachment_id: string
  filename?: string | null
  mime_type?: string | null
  size_bytes?: number | null
}

export type RebornMessageRecord = {
  message_id: string
  thread_id: string
  sequence: number
  kind:
    | "user"
    | "assistant"
    | "system"
    | "summary"
    | "checkpoint_reference"
    | "tool_result_reference"
    | "capability_display_preview"
  status: string
  content?: string | null
  tool_result_ref?: string | null
  turn_id?: string | null
  turn_run_id?: string | null
  attachments?: RebornAttachmentRef[] | null
}

export type RebornCreateThreadResponse = {
  thread: RebornThreadRecord
}

export type RebornListThreadsResponse = {
  threads: RebornThreadRecord[]
  next_cursor?: string | null
}

export type RebornTimelineResponse = {
  thread: RebornThreadRecord
  messages: RebornMessageRecord[]
  next_cursor?: string | null
}

// Tagged union keyed on `outcome` (serde tag = "outcome", snake_case), mirroring
// ironclaw_product_workflow::reborn_services::types::RebornSubmitTurnResponse.
// `rejected_busy` is a normal, non-error outcome (a run is already active on the
// thread); the client surfaces `notice` rather than throwing.
export type RebornSubmitTurnResponse =
  | {
      outcome: "submitted"
      thread_id: string
      accepted_message_ref: string
      turn_id: string
      run_id: string
      status: string
      resolved_run_profile_id: string
      resolved_run_profile_version: number
      event_cursor: unknown
    }
  | {
      outcome: "rejected_busy"
      thread_id: string
      accepted_message_ref: string
      active_run_id?: string | null
      status?: string | null
      event_cursor?: unknown
      notice: string
    }
  | {
      outcome: "already_submitted"
      thread_id: string
      accepted_message_ref: string
      run_id: string
      status: string
      event_cursor: unknown
    }

export type RebornCancelRunResponse = {
  run_id: string
  status: string
  event_cursor?: unknown
  already_terminal?: boolean
}

// POST /threads/{id}/runs/{run}/retry → RebornRetryRunResponse
export type RebornRetryRunResponse = {
  run_id: string
  status: string
  event_cursor?: unknown
}

// POST /threads/{id}/runs/{run}/gates/{gate}/resolve → tagged union (tag = "outcome").
export type RebornResolveGateResponse =
  | { outcome: "resumed"; run_id: string; status: string; event_cursor?: unknown }
  | {
      outcome: "cancelled"
      run_id: string
      status: string
      event_cursor?: unknown
      already_terminal?: boolean
    }

// Per-run token usage from RebornGetRunStateResponse.usage (LoopModelUsage).
export type RebornRunUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// Per-run USD cost from RebornGetRunStateResponse.cost (RunCost); amounts are strings.
export type RebornRunCost = {
  input_cost_usd: string
  cached_input_cost_usd: string
  output_cost_usd: string
  total_cost_usd: string
  currency: string
}

export type ChannelConnectStrategy = "inbound_proof_code" | "web_generated_code" | "qr_code" | "oauth" | string

export type ChannelConnectAction = {
  title: string
  instructions: string
  code_placeholder: string
  submit_label: string
  success_message: string
  error_message: string
}

export type ConnectableChannelInfo = {
  channel: string
  display_name: string
  strategy: ChannelConnectStrategy
  action: ChannelConnectAction
  command_aliases?: string[]
}

export type ConnectableChannelListResponse = {
  channels: ConnectableChannelInfo[]
}

export type RebornWebChatEventFrame = {
  cursor?: unknown
  type: string
  reply?: { turn_run_id?: string; text?: string }
  progress?: { turn_run_id?: string; kind?: string }
  activity?: {
    invocation_id?: string
    thread_id?: string | null
    capability_id?: string
    status?: "started" | "running" | "completed" | "failed" | "killed" | string
    provider?: string | null
    runtime?: string | null
    process_id?: string | null
    output_bytes?: number | null
    error_kind?: string | null
    updated_at?: string
  }
  preview?: {
    timeline_message_id?: string | null
    invocation_id?: string
    thread_id?: string | null
    capability_id?: string
    status?: "started" | "running" | "completed" | "failed" | "killed" | string
    title?: string
    subtitle?: string | null
    input_summary?: string | null
    output_summary?: string | null
    output_preview?: string | null
    output_kind?: string | null
    output_bytes?: number | null
    result_ref?: string | null
    truncated?: boolean
    updated_at?: string
  }
  prompt?: {
    turn_run_id?: string
    gate_ref?: string
    auth_request_ref?: string
    challenge_kind?: "oauth_url" | "manual_token" | "other" | string
    provider?: string
    account_label?: string
    authorization_url?: string | null
    expires_at?: string | null
    headline?: string
    body?: string
    allow_always?: boolean
    approval_context?: ApprovalContext
  }
  run_state?: {
    run_id?: string | null
    status?: string | null
    failure?: { category?: string | null } | null
    usage?: RebornRunUsage | null
    cost?: RebornRunCost | null
  }
  ack?: RebornSubmitTurnResponse
  // `cancelled` event payload (RebornCancelRunResponse).
  response?: RebornCancelRunResponse | unknown
  state?: { thread_id?: string; items?: Array<Record<string, unknown>> }
}

// GET /session → WebUiV2SessionResponse. Drives UI capability/feature gating.
export type SessionResponse = {
  tenant_id: string
  user_id: string
  capabilities: {
    operator_webui_config: boolean
  }
  features: {
    reborn_projects: boolean
    global_auto_approve: boolean
  }
  attachments: {
    accept: string[]
    max_count: number
    max_file_bytes: number
    max_total_bytes: number
  }
}

// One attachment on an outgoing message (WebUiSendMessageRequest.attachments[]).
export type OutgoingAttachment = {
  mime_type: string
  filename?: string | null
  data_base64: string
}

// Raw bytes of a landed attachment (GET .../attachments/{id}).
export type AttachmentBytes = {
  mime_type: string
  filename?: string | null
  bytes: Uint8Array
}

export type ThreadListResponse = {
  assistant_thread?: ThreadInfo | null
  threads: ThreadInfo[]
  active_thread?: string | null
}

export type ToolResultReferenceInfo = {
  kind: "tool_result_reference"
  name: string
  has_result: true
  has_error: false
  call_id?: string | null
  result_preview?: string | null
  result?: string | null
  error?: string | null
  rationale?: string | null
}

export type CapabilityDisplayPreviewInfo = {
  kind: "capability_display_preview"
  message_id?: string | null
  name: string
  has_result: boolean
  has_error: boolean
  call_id?: string | null
  capability_id?: string | null
  status?: string | null
  subtitle?: string | null
  input_summary?: string | null
  output_summary?: string | null
  output_preview?: string | null
  output_kind?: string | null
  output_bytes?: number | null
  result_ref?: string | null
  truncated?: boolean | null
  result_preview?: string | null
  result?: string | null
  error?: string | null
  rationale?: string | null
}

export type ToolCallInfo = ToolResultReferenceInfo | CapabilityDisplayPreviewInfo

export type TimelineMessageInfo =
  | {
      kind: "user" | "assistant" | "system" | "summary"
      id: string
      thread_id: string
      sequence: number
      status: string
      content: string
    }
  | {
      kind: "tool_result_reference" | "capability_display_preview"
      id: string
      thread_id: string
      sequence: number
      status: string
      activity: ToolCallInfo
    }

export type TurnInfo = {
  turn_number: number
  user_message_id?: string | null
  user_input: string
  response?: string | null
  state: string
  started_at: string
  completed_at?: string | null
  tool_calls: ToolCallInfo[]
  narrative?: string | null
}

// Structured details for an approval gate (WebChat v2 gate prompt).
export type ApprovalContext = {
  tool_name?: string | null
  action?: string | null
  scope?: string | null
  destination?: string | null
  details?: string[]
}

export type PendingGateInfo = {
  request_id: string
  thread_id: string
  run_id?: string | null
  gate_ref?: string | null
  gate_name: string
  tool_name: string
  description: string
  parameters: string
  extension_name?: string | null
  provider?: string | null
  account_label?: string | null
  challenge_kind?: string | null
  authorization_url?: string | null
  expires_at?: string | null
  allow_always?: boolean
  approval_context?: ApprovalContext | null
  resume_kind: unknown
}

export type InProgressInfo = {
  turn_number: number
  user_message_id?: string | null
  state: string
  user_input: string
  started_at: string
}

export type MessageAttachments = {
  message_id: string
  refs: RebornAttachmentRef[]
}

export type HistoryResponse = {
  thread_id: string
  messages?: TimelineMessageInfo[]
  turns: TurnInfo[]
  has_more: boolean
  next_cursor?: string | null
  oldest_timestamp?: string | null
  channel?: string | null
  pending_gate?: PendingGateInfo | null
  in_progress?: InProgressInfo | null
  // Attachment refs per timeline message (for /save), newest last.
  message_attachments?: MessageAttachments[]
}

export type GateResolveRequest =
  | { request_id: string; thread_id?: string | null; run_id?: string | null; gate_ref?: string | null; resolution: "approved"; always?: boolean }
  | { request_id: string; thread_id?: string | null; run_id?: string | null; gate_ref?: string | null; resolution: "denied" }
  | { request_id: string; thread_id?: string | null; run_id?: string | null; gate_ref?: string | null; resolution: "credential_provided"; credential_ref: string }
  | { request_id: string; thread_id?: string | null; run_id?: string | null; gate_ref?: string | null; resolution: "cancelled" }

export type ManualTokenSubmitRequest = {
  provider: string
  account_label: string
  token: string
  thread_id?: string | null
  run_id: string
  gate_ref: string
}

export type ManualTokenSetupResponse = {
  interaction_id: string
  provider?: string | null
  label?: string | null
  expires_at?: string | null
  invocation_id: string
}

export type ManualTokenSecretSubmitRequest = {
  interaction_id: string
  token: string
  thread_id?: string | null
  invocation_id: string
}

export type ManualTokenSubmitResponse = {
  credential_ref?: string | null
  status?: string | null
  continuation?: unknown
}

export type AutomationInfo = {
  automation_id: string
  name: string
  source?: { type?: string; cron?: string } | null
  state: "active" | "scheduled" | "paused" | "disabled" | "inactive" | "completed" | "unknown" | string
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: "ok" | "error" | string | null
  is_active?: boolean
  created_at?: string | null
}

export type AutomationListResponse = {
  automations: AutomationInfo[]
}

export type LifecyclePackageRef = {
  id: string
  kind: string
}

export type ExtensionInfo = {
  package_ref: LifecyclePackageRef
  display_name: string
  kind: string
  description: string
  authenticated?: boolean
  active?: boolean
  tools?: string[]
  needs_setup?: boolean
  has_auth?: boolean
  activation_status?: string | null
  activation_error?: string | null
  version?: string | null
  onboarding_state?: string | null
  onboarding?: Record<string, unknown> | null
}

export type ExtensionRegistryEntry = {
  package_ref: LifecyclePackageRef
  display_name: string
  kind: string
  description: string
  installed?: boolean
  keywords?: string[]
  version?: string | null
}

export type ExtensionListResponse = {
  extensions: ExtensionInfo[]
}

export type ExtensionRegistryResponse = {
  entries: ExtensionRegistryEntry[]
}

export type ExtensionActionResponse = {
  success: boolean
  message?: string | null
  activated?: boolean | null
  auth_url?: string | null
  awaiting_token?: boolean | null
  instructions?: string | null
  onboarding_state?: string | null
  onboarding?: Record<string, unknown> | null
}

export type ExtensionSetupSecret = {
  name: string
  provider: string
  prompt: string
  optional: boolean
  provided: boolean
  credential_ref?: string | null
  setup?: Record<string, unknown> | null
}

export type ExtensionSetupField = {
  name: string
  label?: string | null
  prompt?: string | null
  value?: string | null
  required?: boolean | null
  secret?: boolean | null
}

export type ExtensionSetupResponse = {
  package_ref: LifecyclePackageRef
  phase?: string | null
  blockers?: Array<Record<string, unknown>>
  payload?: Record<string, unknown> | null
  secrets?: ExtensionSetupSecret[]
  fields?: ExtensionSetupField[]
  onboarding?: Record<string, unknown> | null
}

export type LlmProviderView = {
  id: string
  description: string
  adapter: string
  default_model: string
  base_url?: string | null
  builtin: boolean
  active: boolean
  active_model?: string | null
  api_key_required: boolean
  accepts_api_key: boolean
  api_key_set: boolean
  can_list_models: boolean
}

export type LlmProviderActionPayload = {
  provider_id: string
  provider_type?: "builtin" | "custom" | string
  adapter?: string
  base_url?: string | null
  model?: string | null
}

export type LlmProviderUpsertPayload = {
  id: string
  name?: string
  adapter: string
  base_url?: string | null
  default_model?: string | null
  api_key?: string
  set_active?: boolean
  model?: string | null
}

export type LlmProviderTestResult = {
  success?: boolean
  ok?: boolean
  message?: string | null
  error?: string | null
  latency_ms?: number | null
}

export type LlmProviderModelsResult = {
  models?: string[]
  error?: string | null
}

export type NearAiLoginStart = {
  auth_url?: string | null
}

export type NearAiAuthProvider = "github" | "google"

export type NearAiWalletLoginRequest = {
  account_id: string
  public_key: string
  signature: string
  message: string
  recipient: string
  nonce: number[]
  callback_url?: string | null
}

export type NearAiWalletLoginResult = {
  active?: boolean
}

export type CodexLoginStart = {
  user_code?: string | null
  verification_uri?: string | null
}

export type LlmActiveSelection = {
  provider_id: string
  model?: string | null
}

export type LlmConfigSnapshot = {
  providers: LlmProviderView[]
  active?: LlmActiveSelection | null
}

export type RebornDeleteThreadResponse = {
  thread_id: string
  deleted: boolean
}

// ---- Skills (remote HTTP) ----

export type SkillTrustLevel = "trusted" | "installed" | string
export type SkillSourceKind = "user" | "installed" | "workspace" | "system" | string

export type SkillInfo = {
  name: string
  description: string
  version: string
  trust: SkillTrustLevel
  source: SkillSourceKind
  source_kind: SkillSourceKind
  keywords: string[]
  usage_hint?: string | null
  setup_hint?: string | null
  bundle_path?: string | null
  install_source_url?: string | null
  has_requirements: boolean
  has_scripts: boolean
  can_edit: boolean
  can_delete: boolean
  auto_activate: boolean
}

export type SkillListResponse = {
  skills: SkillInfo[]
  count: number
  auto_activate_learned: boolean
}

export type SkillSearchResponse = {
  catalog: unknown[]
  installed: SkillInfo[]
  registry_url: string
  catalog_error?: string | null
}

export type SkillContentResponse = {
  name: string
  content: string
}

export type SkillActionResponse = {
  success: boolean
  message: string
}

// ---- Settings tools / approvals ----

// Wire vocabulary of the settings/tools per-capability permission request body.
export type SettingsToolPermissionState = "default" | "always_allow" | "ask_each_time" | "disabled"

export type SettingsToolEntry = {
  key: string
  value: unknown
  source: string
  redacted: boolean
  mutable: boolean
}

export type SettingsToolsResponse = {
  entries: SettingsToolEntry[]
  precedence: string[]
  diagnostics: unknown[]
}

export type SettingsToolEntryResponse = {
  entry: SettingsToolEntry
}

// ---- Automation mutation ----

export type AutomationMutationResponse = {
  updated: boolean
  automation?: AutomationInfo | null
}

// ---- Outbound preferences / targets ----

export type OutboundDeliveryModality = "text" | string
export type OutboundDeliveryTargetStatus = "none_configured" | "available" | "unavailable" | string

export type OutboundDeliveryTargetSummary = {
  target_id: string
  channel: string
  display_name: string
  description?: string | null
}

export type OutboundPreferencesResponse = {
  final_reply_target?: OutboundDeliveryTargetSummary | null
  final_reply_target_status: OutboundDeliveryTargetStatus
  default_modality: OutboundDeliveryModality
}

export type OutboundDeliveryTargetCapabilities = {
  final_replies: boolean
  gate_prompts: boolean
  auth_prompts: boolean
}

export type OutboundDeliveryTargetOption = {
  target: OutboundDeliveryTargetSummary
  capabilities: OutboundDeliveryTargetCapabilities
}

export type OutboundDeliveryTargetListResponse = {
  targets: OutboundDeliveryTargetOption[]
  next_cursor?: string | null
}

// ---- Logs ----

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error"

export type LogQuery = {
  limit?: number
  cursor?: string
  level?: LogLevel
  target?: string
  thread_id?: string
  run_id?: string
  turn_id?: string
  tool_call_id?: string
  tool_name?: string
  source?: string
  tail?: boolean
  follow?: boolean
}

export type LogEntry = {
  id: string
  timestamp: string
  level: LogLevel
  target: string
  message: string
  thread_id?: string | null
  run_id?: string | null
  turn_id?: string | null
  tool_call_id?: string | null
  tool_name?: string | null
  source?: string | null
}

export type LogQueryResponse = {
  source: string
  entries: LogEntry[]
  next_cursor?: string | null
  tail_supported: boolean
  follow_supported: boolean
}

// ---- Traces ----

export type TraceHold = {
  submission_id: string
  reason: string
}

export type TraceCreditsResponse = {
  enrolled: boolean
  pending_credit: number
  final_credit: number
  delayed_credit_delta: number
  submissions_total: number
  submissions_submitted: number
  submissions_accepted: number
  submissions_revoked: number
  submissions_expired: number
  credit_events_total: number
  last_submission_at?: string | null
  last_credit_sync_at?: string | null
  recent_explanations: string[]
  manual_review_hold_count: number
  holds: TraceHold[]
  note: string
}

export type AccountTrace = {
  submission_id: string
  status: string
  pending_credit: number
  final_credit?: number | null
  received_at?: string | null
}

export type AccountTracesResponse = {
  enrolled: boolean
  traces: AccountTrace[]
}

export type AccountLoginLinkResponse = {
  minted: boolean
  enrolled: boolean
  url?: string | null
}

export type TraceHoldAuthorizeResponse = {
  authorized: boolean
}

// ---- Filesystem (thread project files + global mounts) ----

export type ProjectFsEntryKind = "file" | "directory" | "symlink" | "other" | string

export type ProjectFsEntry = {
  name: string
  path: string
  kind: ProjectFsEntryKind
}

export type ProjectFsStat = {
  path: string
  kind: ProjectFsEntryKind
  size_bytes: number
  mime_type: string
}

export type ProjectFsListResponse = {
  entries: ProjectFsEntry[]
}

export type ProjectFsStatResponse = {
  stat: ProjectFsStat
}

export type FsMount = "memory" | "workspace" | "skills" | string

export type FsMountInfo = {
  mount: FsMount
  label: string
}

export type FsMountsResponse = {
  mounts: FsMountInfo[]
}

export type FsListResponse = {
  mount: FsMount
  path: string
  entries: ProjectFsEntry[]
}

// ---- Projects (feature-gated) ----

export type ProjectRole = "owner" | "editor" | "viewer" | string
export type ProjectState = "active" | "archived" | string
export type ProjectMemberStatus = "active" | "revoked" | string

export type ProjectInfo = {
  project_id: string
  name: string
  description: string
  icon?: string | null
  color?: string | null
  metadata: unknown
  state: ProjectState
  role: ProjectRole
  created_at: string
  updated_at: string
}

export type ProjectListResponse = {
  projects: ProjectInfo[]
}

export type ProjectResponse = {
  project: ProjectInfo
}

export type CreateProjectRequest = {
  name: string
  description?: string
  icon?: string | null
  color?: string | null
  metadata?: unknown
}

export type ProjectMemberInfo = {
  user_id: string
  role: ProjectRole
  status: ProjectMemberStatus
  granted_by: string
  created_at: string
  updated_at: string
}

export type ProjectMemberListResponse = {
  members: ProjectMemberInfo[]
}

// ---- Typed v2 error body ----

// Wire shape of a WebChat v2 error response (WebUiV2HttpErrorBody).
export type GatewayErrorBody = {
  error: string
  kind: string
  retryable: boolean
  field?: string | null
  validation_code?: string | null
}

export type ToolDecisionDto = {
  tool_name: string
  rationale: string
}

export type PlanStepDto = {
  index: number
  title: string
  status: string
  result?: string | null
}

// `replayed` marks an event sourced from a projection_snapshot replay (sent on
// every SSE (re)connect) rather than a live incremental update. The UI uses it
// to suppress notifications for backlog it has already surfaced, so a reconnect
// does not re-page the user for old replies/gates/failures.
export type AppEvent =
  | { type: "response"; content: string; thread_id: string; replayed?: boolean }
  | { type: "run_status"; status: string; run_id?: string | null; thread_id?: string | null; failure_category?: string | null; replayed?: boolean }
  | { type: "thinking"; message: string; thread_id?: string | null }
  | { type: "thinking_update"; id: string; content: string; thread_id?: string | null }
  | { type: "work_summary_update"; id: string; run_id?: string | null; phase: string; content: string; thread_id?: string | null }
  | {
      type: "capability_activity"
      invocation_id: string
      capability_id: string
      status: "started" | "running" | "completed" | "failed" | "killed" | string
      provider?: string | null
      runtime?: string | null
      process_id?: string | null
      output_bytes?: number | null
      error_kind?: string | null
      thread_id?: string | null
    }
  | {
      type: "capability_display_preview"
      timeline_message_id?: string | null
      invocation_id: string
      capability_id: string
      status: "started" | "running" | "completed" | "failed" | "killed" | string
      title: string
      subtitle?: string | null
      input_summary?: string | null
      output_summary?: string | null
      output_preview?: string | null
      output_kind?: string | null
      output_bytes?: number | null
      result_ref?: string | null
      truncated: boolean
      thread_id?: string | null
    }
  | { type: "tool_started"; name: string; detail?: string | null; call_id?: string | null; thread_id?: string | null }
  | { type: "tool_completed"; name: string; success: boolean; error?: string | null; parameters?: string | null; call_id?: string | null; duration_ms?: number | null; thread_id?: string | null }
  | { type: "tool_result"; name: string; preview: string; call_id?: string | null; thread_id?: string | null }
  | { type: "tool_result_full"; name: string; output: string; truncated?: boolean | null; call_id?: string | null; thread_id?: string | null }
  | { type: "stream_chunk"; content: string; thread_id?: string | null }
  | { type: "status"; message: string; thread_id?: string | null }
  | { type: "approval_needed"; request_id: string; tool_name: string; description: string; parameters: string; thread_id?: string | null; allow_always: boolean }
  | { type: "gate_required"; request_id: string; gate_name: string; tool_name: string; description: string; parameters: string; extension_name?: string | null; provider?: string | null; account_label?: string | null; challenge_kind?: string | null; authorization_url?: string | null; expires_at?: string | null; allow_always?: boolean; approval_context?: ApprovalContext | null; resume_kind: unknown; thread_id?: string | null; run_id?: string | null; gate_ref?: string | null; replayed?: boolean }
  | { type: "gate_resolved"; request_id: string; gate_name: string; tool_name: string; resolution: string; message: string; thread_id?: string | null }
  | { type: "onboarding_state"; extension_name: string; state: "setup_required" | "auth_required" | "pairing_required" | "ready" | "failed"; request_id?: string | null; message?: string | null; instructions?: string | null; auth_url?: string | null; setup_url?: string | null; onboarding?: unknown; thread_id?: string | null }
  | { type: "reasoning_update"; narrative: string; decisions: ToolDecisionDto[]; thread_id?: string | null }
  | { type: "plan_update"; plan_id: string; title: string; status: string; steps: PlanStepDto[]; mission_id?: string | null; thread_id?: string | null }
  | { type: "thread_state_changed"; thread_id: string; from_state: string; to_state: string; reason?: string | null }
  | { type: "image_generated"; event_id: string; data_url: string; path?: string | null; thread_id?: string | null }
  | { type: "suggestions"; suggestions: string[]; thread_id?: string | null }
  | { type: "turn_cost"; input_tokens: number; output_tokens: number; cost_usd: string; thread_id?: string | null }
  | { type: "run_cancelled"; run_id?: string | null; status?: string | null; already_terminal?: boolean | null; thread_id?: string | null }
  | { type: "run_usage"; run_id?: string | null; usage?: RebornRunUsage | null; cost?: RebornRunCost | null; thread_id?: string | null }
  | { type: "notice"; message: string; thread_id?: string | null }
  | { type: "skill_activated"; id?: string | null; run_id?: string | null; skill_names: string[]; thread_id?: string | null; feedback?: string[] }
  | { type: "extension_status"; extension_name: string; status: string; message?: string | null }
  | { type: "warning"; source: string; message: string; thread_id?: string | null }
  | { type: "error"; message: string; thread_id?: string | null }
  | { type: "heartbeat" }

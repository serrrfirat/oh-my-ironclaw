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

export type RebornSubmitTurnResponse =
  | {
      outcome: "submitted" | "already_submitted"
      thread_id: string
      run_id: string
      status: string
      accepted_message_ref: string
    }
  | {
      outcome: "deferred_busy"
      thread_id: string
      active_run_id: string
      status: string
      accepted_message_ref: string
    }

export type RebornCancelRunResponse = {
  run_id: string
  status: string
  event_cursor?: unknown
  already_terminal?: boolean
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
  }
  run_state?: {
    run_id?: string | null
    status?: string | null
    failure?: { category?: string | null } | null
  }
  ack?: RebornSubmitTurnResponse
  response?: unknown
  state?: { thread_id?: string; items?: Array<Record<string, unknown>> }
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
  resume_kind: unknown
}

export type InProgressInfo = {
  turn_number: number
  user_message_id?: string | null
  state: string
  user_input: string
  started_at: string
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

export type LlmActiveSelection = {
  provider_id: string
  model?: string | null
}

export type LlmConfigSnapshot = {
  providers: LlmProviderView[]
  active?: LlmActiveSelection | null
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

export type AppEvent =
  | { type: "response"; content: string; thread_id: string }
  | { type: "run_status"; status: string; run_id?: string | null; thread_id?: string | null; failure_category?: string | null }
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
  | { type: "gate_required"; request_id: string; gate_name: string; tool_name: string; description: string; parameters: string; extension_name?: string | null; provider?: string | null; account_label?: string | null; challenge_kind?: string | null; authorization_url?: string | null; expires_at?: string | null; resume_kind: unknown; thread_id?: string | null; run_id?: string | null; gate_ref?: string | null }
  | { type: "gate_resolved"; request_id: string; gate_name: string; tool_name: string; resolution: string; message: string; thread_id?: string | null }
  | { type: "onboarding_state"; extension_name: string; state: "setup_required" | "auth_required" | "pairing_required" | "ready" | "failed"; request_id?: string | null; message?: string | null; instructions?: string | null; auth_url?: string | null; setup_url?: string | null; onboarding?: unknown; thread_id?: string | null }
  | { type: "reasoning_update"; narrative: string; decisions: ToolDecisionDto[]; thread_id?: string | null }
  | { type: "plan_update"; plan_id: string; title: string; status: string; steps: PlanStepDto[]; mission_id?: string | null; thread_id?: string | null }
  | { type: "thread_state_changed"; thread_id: string; from_state: string; to_state: string; reason?: string | null }
  | { type: "image_generated"; event_id: string; data_url: string; path?: string | null; thread_id?: string | null }
  | { type: "suggestions"; suggestions: string[]; thread_id?: string | null }
  | { type: "turn_cost"; input_tokens: number; output_tokens: number; cost_usd: string; thread_id?: string | null }
  | { type: "skill_activated"; id?: string | null; run_id?: string | null; skill_names: string[]; thread_id?: string | null; feedback?: string[] }
  | { type: "extension_status"; extension_name: string; status: string; message?: string | null }
  | { type: "warning"; source: string; message: string; thread_id?: string | null }
  | { type: "error"; message: string; thread_id?: string | null }
  | { type: "heartbeat" }

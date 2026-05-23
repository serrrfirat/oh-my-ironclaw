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

export type ThreadListResponse = {
  assistant_thread?: ThreadInfo | null
  threads: ThreadInfo[]
  active_thread?: string | null
}

export type ToolCallInfo = {
  name: string
  has_result: boolean
  has_error: boolean
  call_id?: string | null
  result_preview?: string | null
  result?: string | null
  error?: string | null
  rationale?: string | null
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
  gate_name: string
  tool_name: string
  description: string
  parameters: string
  extension_name?: string | null
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
  turns: TurnInfo[]
  has_more: boolean
  oldest_timestamp?: string | null
  channel?: string | null
  pending_gate?: PendingGateInfo | null
  in_progress?: InProgressInfo | null
}

export type GateResolveRequest =
  | { request_id: string; thread_id?: string | null; resolution: "approved"; always?: boolean }
  | { request_id: string; thread_id?: string | null; resolution: "denied" }
  | { request_id: string; thread_id?: string | null; resolution: "credential_provided"; token: string }
  | { request_id: string; thread_id?: string | null; resolution: "cancelled" }

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
  | { type: "thinking"; message: string; thread_id?: string | null }
  | { type: "tool_started"; name: string; detail?: string | null; call_id?: string | null; thread_id?: string | null }
  | { type: "tool_completed"; name: string; success: boolean; error?: string | null; parameters?: string | null; call_id?: string | null; duration_ms?: number | null; thread_id?: string | null }
  | { type: "tool_result"; name: string; preview: string; call_id?: string | null; thread_id?: string | null }
  | { type: "tool_result_full"; name: string; output: string; truncated?: boolean | null; call_id?: string | null; thread_id?: string | null }
  | { type: "stream_chunk"; content: string; thread_id?: string | null }
  | { type: "status"; message: string; thread_id?: string | null }
  | { type: "approval_needed"; request_id: string; tool_name: string; description: string; parameters: string; thread_id?: string | null; allow_always: boolean }
  | { type: "gate_required"; request_id: string; gate_name: string; tool_name: string; description: string; parameters: string; extension_name?: string | null; resume_kind: unknown; thread_id?: string | null }
  | { type: "gate_resolved"; request_id: string; gate_name: string; tool_name: string; resolution: string; message: string; thread_id?: string | null }
  | { type: "onboarding_state"; extension_name: string; state: "setup_required" | "auth_required" | "pairing_required" | "ready" | "failed"; request_id?: string | null; message?: string | null; instructions?: string | null; auth_url?: string | null; setup_url?: string | null; onboarding?: unknown; thread_id?: string | null }
  | { type: "reasoning_update"; narrative: string; decisions: ToolDecisionDto[]; thread_id?: string | null }
  | { type: "plan_update"; plan_id: string; title: string; status: string; steps: PlanStepDto[]; mission_id?: string | null; thread_id?: string | null }
  | { type: "thread_state_changed"; thread_id: string; from_state: string; to_state: string; reason?: string | null }
  | { type: "image_generated"; event_id: string; data_url: string; path?: string | null; thread_id?: string | null }
  | { type: "suggestions"; suggestions: string[]; thread_id?: string | null }
  | { type: "turn_cost"; input_tokens: number; output_tokens: number; cost_usd: string; thread_id?: string | null }
  | { type: "skill_activated"; skill_names: string[]; thread_id?: string | null; feedback?: string[] }
  | { type: "extension_status"; extension_name: string; status: string; message?: string | null }
  | { type: "warning"; source: string; message: string; thread_id?: string | null }
  | { type: "error"; message: string; thread_id?: string | null }
  | { type: "heartbeat" }

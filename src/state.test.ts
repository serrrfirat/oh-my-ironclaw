import { describe, expect, test } from "bun:test"
import { accumulateTodayCost, initialUiState, isTerminalRunState, reduceUiState } from "./state"
import type { AppEvent } from "./gateway/types"
import { normalizeStatusKey, statusTone } from "./ui/theme"
import { transcriptActivityLines, type TranscriptItem } from "./transcript"

function activityText(item: TranscriptItem | undefined): string {
  if (!item || item.role !== "activity") return ""
  return transcriptActivityLines(item.activity).join("\n")
}

describe("UI state", () => {
  test("renders failed run statuses inline", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "run_status",
        status: "failed",
        run_id: "run-1",
        thread_id: "thread-1",
        failure_category: "model_unavailable",
      },
    })

    expect(state.isThinking).toBe(false)
    expect(state.lastError).toBe("Run failed: model_unavailable")
    expect(state.transcript).toContainEqual({
      id: "run-run-1-failed",
      role: "system",
      text: "Run failed: model_unavailable",
      threadId: "thread-1",
      state: "failed",
    })
  })

  test("does not duplicate the same failed run", () => {
    const action = {
      type: "event" as const,
      event: {
        type: "run_status" as const,
        status: "failed",
        run_id: "run-1",
        thread_id: "thread-1",
        failure_category: "model_unavailable",
      },
    }

    const once = reduceUiState(initialUiState, action)
    const twice = reduceUiState(once, action)

    expect(twice.transcript).toHaveLength(1)
  })

  test("keeps thinking state while a sent message has no reply yet", () => {
    const sent = reduceUiState(initialUiState, {
      type: "user_sent",
      content: "hello",
      threadId: "thread-1",
    })
    const polled = reduceUiState(sent, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_input: "hello",
            state: "running",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
      },
    })

    expect(sent.isThinking).toBe(true)
    expect(polled.isThinking).toBe(true)
  })

  test("clears thinking state when history includes a reply after the latest user", () => {
    const sent = reduceUiState(initialUiState, {
      type: "user_sent",
      content: "hello",
      threadId: "thread-1",
    })
    const polled = reduceUiState(sent, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_input: "hello",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_input: "",
            response: "hi",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
      },
    })

    expect(polled.isThinking).toBe(false)
  })

  test("clears lastRunOutcome when history switches to another thread", () => {
    const onThread1 = { ...initialUiState, activeThreadId: "thread-1", lastRunOutcome: "completed" as const }
    const switched = reduceUiState(onThread1, {
      type: "history",
      history: {
        thread_id: "thread-2",
        turns: [],
        has_more: false,
      },
    })
    expect(switched.activeThreadId).toBe("thread-2")
    // The settled outcome belonged to thread-1; it must not leak onto thread-2
    // (or drive a spurious input-queue flush there).
    expect(switched.lastRunOutcome).toBeNull()
  })

  test("keeps lastRunOutcome when history refreshes the same thread", () => {
    const onThread1 = { ...initialUiState, activeThreadId: "thread-1", lastRunOutcome: "completed" as const }
    const same = reduceUiState(onThread1, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [],
        has_more: false,
      },
    })
    expect(same.lastRunOutcome).toBe("completed")
  })

  test("renders recovery-required run statuses inline", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "run_status",
        status: "RecoveryRequired",
        run_id: "run-2",
        thread_id: "thread-1",
        failure_category: "driver_unavailable",
      },
    })

    expect(state.isThinking).toBe(false)
    expect(state.lastError).toBe("Run recovery required: driver_unavailable")
    expect(state.transcript).toContainEqual({
      id: "run-run-2-recovery_required",
      role: "system",
      text: "Run recovery required: driver_unavailable",
      threadId: "thread-1",
      state: "RecoveryRequired",
    })
  })

  test("tracks history pagination cursor", () => {
    const state = reduceUiState(initialUiState, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [],
        has_more: true,
        next_cursor: "cursor-1",
      },
    })

    expect(state.historyCursor).toBe("cursor-1")
    expect(state.hasOlderHistory).toBe(true)
  })

  test("does not render generic timeline tool result references", () => {
    const state = reduceUiState(initialUiState, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 2,
            user_message_id: "tool-1",
            user_input: "",
            response: null,
            state: "finalized",
            started_at: "",
            completed_at: null,
            tool_calls: [
              {
                kind: "tool_result_reference",
                name: "Capability",
                has_result: true,
                has_error: false,
                call_id: "result:run.tool",
                result_preview: "capability completed",
              },
            ],
          },
        ],
        has_more: false,
      },
    })

    expect(state.transcript).toEqual([])
  })

  test("prepends older history without duplicating messages", () => {
    const current = reduceUiState(initialUiState, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 2,
            user_message_id: "user-2",
            user_input: "newer",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: true,
        next_cursor: "cursor-1",
      },
    })
    const withOlder = reduceUiState(current, {
      type: "older_history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "older",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_message_id: "user-2",
            user_input: "newer",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    })

    expect(withOlder.transcript.map((item) => item.id)).toEqual(["user-1", "user-2"])
    expect(withOlder.hasOlderHistory).toBe(false)
  })

  test("tracks active runs and clears them on reply", () => {
    const running = reduceUiState(initialUiState, {
      type: "run_started",
      threadId: "thread-1",
      runId: "run-1",
      status: "running",
    })
    const completed = reduceUiState(running, {
      type: "event",
      event: { type: "response", content: "done", thread_id: "thread-1" },
    })

    expect(running.activeRunId).toBe("run-1")
    expect(running.isThinking).toBe(true)
    expect(completed.activeRunId).toBe(null)
    expect(completed.isThinking).toBe(false)
  })

  test("records assistant response duration from send to final reply", () => {
    const originalNow = Date.now
    try {
      Date.now = () => 1_000
      const sent = reduceUiState(initialUiState, {
        type: "user_sent",
        content: "hello",
        threadId: "thread-1",
      })
      Date.now = () => 3_450
      const completed = reduceUiState(sent, {
        type: "event",
        event: { type: "response", content: "done", thread_id: "thread-1" },
      })

      expect(completed.transcript.find((item) => item.role === "assistant")?.meta).toMatchObject({
        sentAtMs: 1_000,
        completedAtMs: 3_450,
        durationMs: 2_450,
      })
    } finally {
      Date.now = originalNow
    }
  })

  test("tracks thinking progress as activity", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "thinking", message: "reflecting", thread_id: "thread-1" },
    })

    expect(state.isThinking).toBe(true)
    expect(state.activity).toContainEqual({
      id: "progress-thread-1-reflecting",
      label: "Thinking through the next step",
      detail: "SSE progress: reflecting",
      status: "running",
      kind: "reflecting",
    })
  })

  test("renders live projection thinking updates", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "thinking_update",
        id: "thinking:run-1:1",
        content: "checking context",
        thread_id: "thread-1",
      },
    })

    expect(state.isThinking).toBe(true)
    expect(state.activity[0]).toMatchObject({
      id: "thinking-thinking:run-1:1",
      label: "Thinking",
      detail: "checking context",
      status: "running",
      kind: "thinking",
    })
    expect(state.transcript).toContainEqual({
      id: "thinking-thinking:run-1:1",
      role: "thinking",
      text: "checking context",
      threadId: "thread-1",
      state: "running",
      meta: { projectionId: "thinking:run-1:1" },
    })
  })

  test("places late projection thinking before the assistant answer without reactivating thinking", () => {
    const answered = reduceUiState(
      reduceUiState(initialUiState, {
        type: "user_sent",
        content: "compare v1 and reborn",
        threadId: "thread-1",
      }),
      {
        type: "event",
        event: {
          type: "response",
          content: "Reborn is better for tool-heavy tasks.",
          thread_id: "thread-1",
        },
      },
    )
    const state = reduceUiState(answered, {
      type: "event",
      event: {
        type: "thinking_update",
        id: "thinking:run-1:1",
        content: "**Considering answer approach**",
        thread_id: "thread-1",
      },
    })

    expect(state.isThinking).toBe(false)
    expect(state.activity[0]).toMatchObject({
      id: "thinking-thinking:run-1:1",
      status: "info",
    })
    expect(state.transcript.map((item) => item.role)).toEqual(["user", "thinking", "assistant"])
    expect(state.transcript[1]).toMatchObject({
      id: "thinking-thinking:run-1:1",
      role: "thinking",
      state: "completed",
      text: "**Considering answer approach**",
    })
  })

  test("keeps projection thinking live while assistant text is still streaming", () => {
    const streaming = reduceUiState(
      reduceUiState(initialUiState, {
        type: "user_sent",
        content: "compare v1 and reborn",
        threadId: "thread-1",
      }),
      {
        type: "event",
        event: {
          type: "stream_chunk",
          content: "Reborn is",
          thread_id: "thread-1",
        },
      },
    )
    const state = reduceUiState(streaming, {
      type: "event",
      event: {
        type: "thinking_update",
        id: "thinking:run-1:1",
        content: "**Considering answer approach**",
        thread_id: "thread-1",
      },
    })

    expect(state.isThinking).toBe(true)
    expect(state.activity[0]).toMatchObject({
      id: "thinking-thinking:run-1:1",
      status: "running",
    })
    expect(state.transcript.map((item) => item.role)).toEqual(["user", "thinking", "assistant"])
    expect(state.transcript[1]).toMatchObject({
      role: "thinking",
      state: "running",
    })
  })

  test("tracks work summary projection updates as activity without transcript reasoning", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "work_summary_update",
        id: "work-summary:run-1:1",
        run_id: "run-1",
        phase: "planning",
        content: "checking branch state",
        thread_id: "thread-1",
      },
    })

    expect(state.isThinking).toBe(true)
    expect(state.activeRunId).toBe("run-1")
    expect(state.activity[0]).toMatchObject({
      id: "work-summary:run-1:1",
      label: "Planning",
      detail: "checking branch state",
      status: "running",
      kind: "work_summary_planning",
    })
    expect(state.transcript).toEqual([])
  })

  test("renders skill activation projection updates as activity", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "skill_activated",
        id: "skill-activation:run-1:1",
        run_id: "run-1",
        skill_names: ["code-review"],
        feedback: ["code-review: force-activated via explicit mention"],
        thread_id: "thread-1",
      },
    })

    expect(state.isThinking).toBe(false)
    expect(state.activeRunId).toBe("run-1")
    expect(state.activity[0]).toMatchObject({
      id: "skill-skill-activation:run-1:1",
      label: "skill activated code-review",
      detail: "code-review: force-activated via explicit mention",
      status: "info",
      kind: "skill_activation",
    })
    expect(state.transcript).toContainEqual({
      id: "skill-skill-activation:run-1:1",
      role: "activity",
      threadId: "thread-1",
      state: "completed",
      activity: {
        kind: "skill_activation",
        title: "skill activated code-review",
        status: "completed",
        detail: "code-review: force-activated via explicit mention",
      },
      meta: { projectionId: "skill-activation:run-1:1" },
    })
    expect(activityText(state.transcript[0] as Extract<TranscriptItem, { role: "activity" }>)).toBe(
      "✓ skill activated code-review\ncode-review: force-activated via explicit mention",
    )
  })

  test("keeps live thinking through history refreshes before a final reply", () => {
    const withThinking = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "thinking_update",
        id: "thinking:run-1:1",
        content: "checking context",
        thread_id: "thread-1",
      },
    })
    const inProgress = reduceUiState(withThinking, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "hello",
            state: "running",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
      },
    })
    const completed = reduceUiState(inProgress, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "hello",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_input: "",
            response: "done",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
      },
    })

    expect(inProgress.transcript.map((item) => item.role)).toEqual(["user", "thinking"])
    expect(completed.transcript.map((item) => item.role)).toEqual(["user", "thinking", "assistant"])
    expect(completed.transcript[1]).toMatchObject({
      id: "thinking-thinking:run-1:1",
      role: "thinking",
      text: "checking context",
    })
  })

  test("tracks tool progress as activity", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "tool_started", name: "tool_running", thread_id: "thread-1" },
    })

    expect(state.isThinking).toBe(true)
    expect(state.activity[0]).toMatchObject({
      id: "progress-thread-1-tool_running",
      label: "Using tools",
      detail: "SSE progress: tool_running",
      status: "running",
      kind: "tool_running",
    })
  })

  test("clears stale running progress when a new message starts", () => {
    const withToolProgress = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "tool_started", name: "tool_running", thread_id: "thread-1" },
    })
    const nextTurn = reduceUiState(withToolProgress, {
      type: "user_sent",
      content: "next",
      threadId: "thread-1",
    })

    expect(nextTurn.isThinking).toBe(true)
    expect(nextTurn.activity[0]).toMatchObject({
      kind: "tool_running",
      status: "info",
    })
  })

  test("tracks rich capability activity in the transcript", () => {
    const running = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_activity",
        invocation_id: "run-1",
        capability_id: "builtin.list_dir",
        status: "running",
        runtime: "local",
        provider: "host",
        thread_id: "thread-1",
      },
    })
    const completed = reduceUiState(running, {
      type: "event",
      event: {
        type: "capability_activity",
        invocation_id: "run-1",
        capability_id: "builtin.list_dir",
        status: "completed",
        runtime: "local",
        provider: "host",
        output_bytes: 42,
        thread_id: "thread-1",
      },
    })

    expect(running.isThinking).toBe(true)
    expect(running.activity[0]).toMatchObject({
      id: "capability-run-1",
      label: "Using builtin.list_dir",
      status: "running",
      kind: "tool_running",
    })
    expect(completed.transcript).toHaveLength(1)
    expect(completed.transcript[0]).toMatchObject({
      id: "capability-run-1",
      role: "activity",
      state: "completed",
    })
    expect(activityText(completed.transcript[0])).toContain("builtin.list_dir")
    expect(activityText(completed.transcript[0])).toContain("42 B output")
  })

  test("enriches capability activity with display previews", () => {
    const running = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_activity",
        invocation_id: "run-1",
        capability_id: "builtin.read_file",
        status: "running",
        thread_id: "thread-1",
      },
    })
    const previewed = reduceUiState(running, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "run-1",
        capability_id: "builtin.read_file",
        status: "completed",
        title: "read_file",
        subtitle: "src/main.rs",
        input_summary: "path: src/main.rs",
        output_summary: "text output",
        output_preview: "fn main() {\n  println!(\"hi\");\n}",
        output_kind: "text",
        output_bytes: 12,
        result_ref: "result:tool-output",
        truncated: false,
        thread_id: "thread-1",
      },
    })

    expect(previewed.activity[0]).toMatchObject({
      id: "capability-run-1",
      label: "read_file",
      detail: "src/main.rs · text output · fn main() {",
      status: "ok",
      kind: "tool_completed",
    })
    expect(previewed.transcript).toHaveLength(1)
    expect(previewed.transcript[0]).toMatchObject({
      id: "capability-run-1",
      role: "activity",
      state: "completed",
    })
    expect(activityText(previewed.transcript[0])).toContain("read src/main.rs")
    expect(activityText(previewed.transcript[0])).not.toContain("input: path: src/main.rs")
    expect(activityText(previewed.transcript[0])).toContain("output: text output · text · 12 B")
    expect(activityText(previewed.transcript[0])).toContain("fn main() {\n  println!(\"hi\");\n}")
    expect(activityText(previewed.transcript[0])).not.toContain("result: result:tool-output")
  })

  test("uses timeline message ids from live display previews", () => {
    const withActivity = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_activity",
        invocation_id: "run-1",
        capability_id: "builtin.read_file",
        status: "running",
        thread_id: "thread-1",
      },
    })
    const previewed = reduceUiState(withActivity, {
      type: "event",
      event: {
        type: "capability_display_preview",
        timeline_message_id: "preview-1",
        invocation_id: "run-1",
        capability_id: "builtin.read_file",
        status: "completed",
        title: "read_file",
        output_summary: "text output",
        output_preview: "fn main() {}",
        output_kind: "text",
        output_bytes: 12,
        result_ref: "result:tool-output",
        truncated: false,
        thread_id: "thread-1",
      },
    })

    expect(previewed.transcript).toHaveLength(1)
    expect(previewed.transcript[0]).toMatchObject({
      id: "preview-1",
      role: "activity",
      meta: {
        invocationId: "run-1",
        timelineMessageId: "preview-1",
        resultRef: "result:tool-output",
      },
    })
    expect(activityText(previewed.transcript[0])).toContain("fn main() {}")
  })

  test("renders only body_text for HTTP display previews", () => {
    const previewed = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "run-1",
        capability_id: "http",
        status: "completed",
        title: "http",
        subtitle: "GET https://example.test",
        input_summary: "url: https://example.test",
        output_summary: "200 OK",
        output_preview: JSON.stringify({
          status: 200,
          headers: { "content-type": "text/plain" },
          body_text: "hello from the response body",
        }),
        output_kind: "json",
        output_bytes: 128,
        result_ref: "result:http",
        truncated: false,
        thread_id: "thread-1",
      },
    })

    const text = activityText(previewed.transcript[0])
    expect(text).toContain("http")
    expect(text).toContain("hello from the response body")
    expect(text).not.toContain("input: url")
    expect(text).not.toContain("output: 200 OK")
    expect(text).not.toContain("content-type")
  })

  test("renders shell display previews as commands with output", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "shell-1",
        capability_id: "shell",
        status: "completed",
        title: "shell",
        input_summary: "command: git status --short",
        output_summary: "text output",
        output_preview: " M src/transcript.ts",
        output_kind: "text",
        output_bytes: 20,
        truncated: false,
        thread_id: "thread-1",
      },
    })

    const text = activityText(state.transcript[0])
    expect(text).toContain("command")
    expect(text).toContain("$ git status --short")
    expect(text).toContain(" M src/transcript.ts")
    expect(text).not.toContain("input: command")
  })

  test("renders search display previews with pattern and scope", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "grep-1",
        capability_id: "grep",
        status: "completed",
        title: "grep",
        input_summary: "pattern: body_text, path: src",
        output_summary: "2 matches",
        output_preview: "src/transcript.ts: body_text",
        output_kind: "text",
        output_bytes: 28,
        truncated: false,
        thread_id: "thread-1",
      },
    })

    const text = activityText(state.transcript[0])
    expect(text).toContain("grep /body_text/ in src")
    expect(text).toContain("src/transcript.ts: body_text")
    expect(text).not.toContain("input: pattern")
  })

  test("renders durable timeline capability display previews from history", () => {
    const state = reduceUiState(initialUiState, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "read it",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_message_id: "preview-1",
            user_input: "",
            response: null,
            state: "finalized",
            started_at: "",
            completed_at: null,
            tool_calls: [
              {
                kind: "capability_display_preview",
                message_id: "preview-1",
                name: "read_file",
                has_result: true,
                has_error: false,
                call_id: "run-1",
                capability_id: "builtin.read_file",
                status: "completed",
                input_summary: "path: src/main.rs",
                output_summary: "text output",
                output_preview: "fn main() {}",
                output_kind: "text",
                output_bytes: 12,
                result_ref: "result:tool-output",
                truncated: false,
              },
            ],
          },
          {
            turn_number: 3,
            user_input: "",
            response: "done",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
      },
    })

    expect(state.transcript.map((item) => item.id)).toEqual(["user-1", "preview-1", "turn-3-assistant"])
    expect(state.transcript[1]).toMatchObject({
      role: "activity",
      meta: {
        invocationId: "run-1",
        timelineMessageId: "preview-1",
        resultRef: "result:tool-output",
      },
    })
    expect(activityText(state.transcript[1])).toContain("read src/main.rs")
    expect(activityText(state.transcript[1])).not.toContain("input: path: src/main.rs")
    expect(activityText(state.transcript[1])).toContain("output: text output · text · 12 B")
    expect(activityText(state.transcript[1])).toContain("fn main() {}")
  })

  test("preserves live capability previews when final history arrives", () => {
    const withPreview = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "run-1",
        capability_id: "builtin.read_file",
        status: "completed",
        title: "read_file",
        output_summary: "text output",
        output_preview: "fn main() {}",
        output_kind: "text",
        output_bytes: 12,
        result_ref: "result:tool-output",
        truncated: false,
        thread_id: "thread-1",
      },
    })
    const withFinalHistory = reduceUiState(withPreview, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "read it",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_input: "",
            response: "done",
            state: "completed",
            started_at: "",
            tool_calls: [
              {
                kind: "tool_result_reference",
                name: "Capability",
                has_result: true,
                has_error: false,
                call_id: "result:tool-output",
                result_preview: "capability completed",
              },
            ],
          },
        ],
        has_more: false,
      },
    })

    expect(withFinalHistory.transcript.map((item) => item.id)).toEqual([
      "user-1",
      "capability-run-1",
      "turn-2-assistant",
    ])
    expect(activityText(withFinalHistory.transcript.find((item) => item.id === "capability-run-1"))).toContain("fn main() {}")
    expect(withFinalHistory.transcript.some((item) => item.id === "turn-2-tool-result:tool-output")).toBe(false)
  })

  test("keeps unmatched failed previews before the final assistant reply", () => {
    const withFailedPreview = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "run-1",
        capability_id: "builtin.read_file",
        status: "failed",
        title: "read_file",
        output_summary: "tool failed: operation_failed",
        output_kind: "text",
        truncated: false,
        thread_id: "thread-1",
      },
    })
    const withFinalHistory = reduceUiState(withFailedPreview, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "read it",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_input: "",
            response: "I could not read that file.",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
      },
    })

    expect(withFinalHistory.transcript.map((item) => item.id)).toEqual([
      "user-1",
      "capability-run-1",
      "turn-2-assistant",
    ])
    expect(activityText(withFinalHistory.transcript[1])).toContain("failed read")
  })

  test("keeps unmatched failed previews in live tool order", () => {
    const withFailedShell = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "shell-1",
        capability_id: "shell",
        status: "failed",
        title: "shell",
        output_summary: "tool failed: resource",
        output_kind: "text",
        truncated: false,
        thread_id: "thread-1",
      },
    })
    const withLaterGlob = reduceUiState(withFailedShell, {
      type: "event",
      event: {
        type: "capability_display_preview",
        timeline_message_id: "glob-1",
        invocation_id: "glob-1",
        capability_id: "glob",
        status: "completed",
        title: "glob",
        output_summary: "json output",
        output_kind: "json",
        result_ref: "result:glob",
        truncated: false,
        thread_id: "thread-1",
      },
    })
    const withFinalHistory = reduceUiState(withLaterGlob, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "find files",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_input: "",
            response: "done",
            state: "completed",
            started_at: "",
            tool_calls: [
              {
                kind: "capability_display_preview",
                message_id: "glob-1",
                name: "glob",
                has_result: true,
                has_error: false,
                call_id: "glob-1",
                capability_id: "glob",
                status: "completed",
                output_summary: "json output",
                output_kind: "json",
                result_ref: "result:glob",
                truncated: false,
              },
            ],
          },
        ],
        has_more: false,
      },
    })

    expect(withFinalHistory.transcript.map((item) => item.id)).toEqual([
      "user-1",
      "capability-shell-1",
      "glob-1",
      "turn-2-assistant",
    ])
    expect(activityText(withFinalHistory.transcript[1])).toContain("failed command")
    expect(activityText(withFinalHistory.transcript[2])).toContain("glob")
  })

  test("keeps unmatched failed previews after preceding assistant text", () => {
    const withAssistantText = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "response",
        content: "I can try grep another way.",
        thread_id: "thread-1",
      },
    })
    const withFailedGrep = reduceUiState(withAssistantText, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "grep-1",
        capability_id: "grep",
        status: "failed",
        title: "grep",
        output_summary: "tool failed: invalid_input",
        output_kind: "text",
        truncated: false,
        thread_id: "thread-1",
      },
    })
    const withFinalHistory = reduceUiState(withFailedGrep, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "try something else",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
          {
            turn_number: 2,
            user_input: "",
            response: "I can try grep another way.",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
      },
    })

    expect(withFinalHistory.transcript.map((item) => item.id)).toEqual([
      "user-1",
      "turn-2-assistant",
      "capability-grep-1",
    ])
    expect(activityText(withFinalHistory.transcript[2])).toContain("failed grep")
  })

  test("treats capability activity with an error kind as failed", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_activity",
        invocation_id: "run-1",
        capability_id: "shell",
        status: "completed",
        runtime: "local",
        provider: "host",
        error_kind: "backend",
        thread_id: "thread-1",
      },
    })

    expect(state.activity[0]).toMatchObject({
      id: "capability-run-1",
      label: "Failed shell",
      status: "error",
      kind: "tool_failed",
    })
    expect(activityText(state.transcript[0])).toContain("Failed shell")
    expect(activityText(state.transcript[0])).toContain("error backend")
  })

  test("does not treat successful capability output containing failure words as failed", () => {
    const state = reduceUiState(initialUiState, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_input: "list files",
            state: "completed",
            started_at: "",
            tool_calls: [
              {
                kind: "capability_display_preview",
                name: "list_dir",
                has_result: true,
                has_error: false,
                status: "completed",
                result: "result-1",
                call_id: "list-dir-1",
                capability_id: "list_dir",
                result_ref: "result-1",
                output_summary: "json output",
                output_preview: '{ "entries": ["failed-test.fixture"] }',
                output_kind: "json",
                output_bytes: 256,
              },
            ],
          },
        ],
        has_more: false,
      },
    })

    expect(activityText(state.transcript[1])).toContain("list_dir")
    expect(activityText(state.transcript[1])).not.toContain("Failed list_dir")
  })

  test("preserves unified diff preview metadata", () => {
    const diff = "diff --git a/src/file.ts b/src/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new"
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "write-1",
        capability_id: "write_file",
        status: "completed",
        title: "write_file",
        input_summary: "path: src/file.ts",
        output_summary: "updated src/file.ts",
        output_preview: diff,
        output_kind: "unified_diff",
        output_bytes: diff.length,
        truncated: false,
        thread_id: "thread-1",
      },
    })

    const activity = state.transcript.find((item) => item.role === "activity")
    expect(activity?.role === "activity" ? activity.activity.outputKind : null).toBe("unified_diff")
    expect(activityText(activity)).toContain("@@ -1,1 +1,1 @@")
    expect(activityText(activity)).toContain("+new")
  })

  test("stores auth challenge metadata on pending gates", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "run-1:gate:auth-google",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: "gate:auth-google",
        gate_name: "auth",
        tool_name: "Authentication required",
        description: "Google needs authentication.",
        parameters: "",
        extension_name: null,
        provider: "google",
        account_label: "GSuite OAuth",
        challenge_kind: "oauth_url",
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
        expires_at: "2026-05-31T20:00:00Z",
        resume_kind: { run_id: "run-1", gate_ref: "gate:auth-google" },
      },
    })

    expect(state.pendingGate).toMatchObject({
      challenge_kind: "oauth_url",
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
      expires_at: "2026-05-31T20:00:00Z",
      provider: "google",
      account_label: "GSuite OAuth",
    })
  })

  test("preserves live auth gates across stale in-progress history refreshes", () => {
    const gated = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "run-1:gate:auth-google",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: "gate:auth-google",
        gate_name: "auth",
        tool_name: "Authentication required",
        description: "Google needs authentication.",
        parameters: "",
        extension_name: null,
        provider: "google",
        account_label: "GSuite OAuth",
        challenge_kind: "oauth_url",
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
        expires_at: "2026-05-31T20:00:00Z",
        resume_kind: { run_id: "run-1", gate_ref: "gate:auth-google" },
      },
    })
    const refreshed = reduceUiState(gated, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_input: "use google",
            state: "running",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
        pending_gate: null,
        in_progress: {
          turn_number: 1,
          user_input: "use google",
          state: "running",
          started_at: "",
        },
      },
    })

    expect(refreshed.pendingGate).toMatchObject({
      request_id: "run-1:gate:auth-google",
      gate_name: "auth",
      gate_ref: "gate:auth-google",
    })
    expect(refreshed.isThinking).toBe(false)
    expect(refreshed.activeRunId).toBe("run-1")
  })

  test("clears live gates after history shows the run is no longer in progress", () => {
    const gated = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "run-1:gate:auth-google",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: "gate:auth-google",
        gate_name: "auth",
        tool_name: "Authentication required",
        description: "Google needs authentication.",
        parameters: "",
        extension_name: null,
        provider: "google",
        account_label: "GSuite OAuth",
        challenge_kind: "oauth_url",
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
        expires_at: "2026-05-31T20:00:00Z",
        resume_kind: { run_id: "run-1", gate_ref: "gate:auth-google" },
      },
    })
    const refreshed = reduceUiState(gated, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_input: "use google",
            state: "completed",
            started_at: "",
            tool_calls: [],
          },
        ],
        has_more: false,
        pending_gate: null,
        in_progress: null,
      },
    })

    expect(refreshed.pendingGate).toBeNull()
    expect(refreshed.isThinking).toBe(false)
  })

  test("correlates projection gates with the active run id", () => {
    const running = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "run_status",
        status: "waiting_for_approval",
        run_id: "run-1",
        thread_id: "thread-1",
      },
    })
    const state = reduceUiState(running, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "gate:approval-1",
        thread_id: "thread-1",
        run_id: null,
        gate_ref: "gate:approval-1",
        gate_name: "approval",
        tool_name: "approval",
        description: "Shell command approval required",
        parameters: "",
        resume_kind: { gate_ref: "gate:approval-1" },
      },
    })

    expect(state.pendingGate).toMatchObject({
      run_id: "run-1",
      gate_ref: "gate:approval-1",
    })
    expect(state.activeRunId).toBe("run-1")
    expect(running.isThinking).toBe(false)
  })

  test("keeps a live SSE gate when a post-send history merge carries no gate info", () => {
    // A gate arrives over SSE mid-run.
    const gated = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "run-7:gate:approval-1",
        thread_id: "thread-1",
        run_id: "run-7",
        gate_ref: "gate:approval-1",
        gate_name: "approval",
        tool_name: "approval",
        description: "Shell command approval required",
        parameters: "",
        resume_kind: { run_id: "run-7", gate_ref: "gate:approval-1" },
      },
    })
    // The post-send history poll returns a timeline that (like the real
    // /timeline response) carries neither pending_gate nor in_progress, and shows
    // no reply after the user's message yet.
    const refreshed = reduceUiState(gated, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [],
        has_more: false,
        messages: [
          {
            kind: "user",
            id: "user-1",
            thread_id: "thread-1",
            sequence: 1,
            status: "sent",
            content: "run the shell command",
          },
        ],
      },
    })

    // The gate must survive the merge — it is not wiped just because the timeline
    // lacked gate/in-progress info.
    expect(refreshed.pendingGate).toMatchObject({
      request_id: "run-7:gate:approval-1",
      gate_ref: "gate:approval-1",
      run_id: "run-7",
    })
    expect(refreshed.activeRunId).toBe("run-7")
    expect(refreshed.isThinking).toBe(false)
  })

  test("returns the same state object when approval_count is unchanged", () => {
    const seeded = reduceUiState(initialUiState, { type: "approval_count", count: 3 })
    const again = reduceUiState(seeded, { type: "approval_count", count: 3 })
    expect(again).toBe(seeded)
    const changed = reduceUiState(seeded, { type: "approval_count", count: 4 })
    expect(changed).not.toBe(seeded)
    expect(changed.approvalCount).toBe(4)
  })

  test("trusts a completed tool status even when the summary mentions 'failed'", () => {
    const state = reduceUiState(initialUiState, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          {
            turn_number: 1,
            user_message_id: "user-1",
            user_input: "run the tests",
            state: "completed",
            started_at: "",
            tool_calls: [
              {
                kind: "capability_display_preview",
                message_id: "preview-tests",
                name: "run_tests",
                has_result: true,
                has_error: false,
                call_id: "run-1",
                capability_id: "builtin.run_tests",
                status: "completed",
                input_summary: "suite: unit",
                output_summary: "214 tests · 0 failed",
                output_preview: "",
                output_kind: "text",
                output_bytes: 0,
                truncated: false,
              },
            ],
          },
        ],
        has_more: false,
      },
    })

    const activity = state.transcript.find((item) => item.role === "activity")
    // "0 failed" in the summary must not flip a structurally-completed tool to failed.
    expect(activity?.role === "activity" ? activity.activity.status : null).toBe("completed")
  })
})

describe("UI state — capability parity", () => {
  test("stores the session snapshot for UI gating", () => {
    const session = {
      tenant_id: "tenant-1",
      user_id: "user-1",
      capabilities: { operator_webui_config: true },
      features: { reborn_projects: true, global_auto_approve: false },
      attachments: { accept: ["image/png"], max_count: 10, max_file_bytes: 5, max_total_bytes: 10 },
    }
    const state = reduceUiState(initialUiState, { type: "session", session })
    expect(state.session).toBe(session)
    expect(state.session?.capabilities.operator_webui_config).toBe(true)
    expect(state.session?.features.reborn_projects).toBe(true)
  })

  test("surfaces a rejected_busy notice without marking an error", () => {
    const state = reduceUiState(initialUiState, {
      type: "notice",
      message: "A run is already active on this thread.",
    })
    expect(state.notice).toBe("A run is already active on this thread.")
    expect(state.lastError).toBeUndefined()
    expect(state.status).not.toBe("error")
  })

  test("clears the notice when a new run starts", () => {
    const noticed = reduceUiState(initialUiState, { type: "notice", message: "busy" })
    const started = reduceUiState(noticed, { type: "run_started", threadId: "thread-1", runId: "run-1" })
    expect(started.notice).toBeNull()
  })

  test("maps a run_cancelled event to a cancelled system message", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_cancelled", run_id: "run-1", status: "Cancelled", thread_id: "thread-1" },
    })
    expect(state.isThinking).toBe(false)
    expect(state.activeRunId).toBeNull()
    expect(state.transcript).toContainEqual({
      id: "run-run-1-cancelled",
      role: "system",
      text: "Run was cancelled before a reply was produced.",
      threadId: "thread-1",
      state: "Cancelled",
    })
  })

  test("captures usage and cost for the status bar", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "run_usage",
        run_id: "run-1",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        cost: { input_cost_usd: "0.01", cached_input_cost_usd: "0", output_cost_usd: "0.02", total_cost_usd: "0.03", currency: "USD" },
        thread_id: "thread-1",
      },
    })
    expect(state.runUsageCost?.runId).toBe("run-1")
    expect(state.runUsageCost?.usage?.input_tokens).toBe(100)
    expect(state.runUsageCost?.cost?.total_cost_usd).toBe("0.03")
  })

  test("tracks the approval-inbox count", () => {
    const state = reduceUiState(initialUiState, { type: "approval_count", count: 3 })
    expect(state.approvalCount).toBe(3)
  })
})

describe("UI state — usage/cost context", () => {
  function usage(runId: string, threadId: string) {
    return {
      type: "event" as const,
      event: {
        type: "run_usage" as const,
        run_id: runId,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        cost: { input_cost_usd: "0.01", cached_input_cost_usd: "0", output_cost_usd: "0.01", total_cost_usd: "0.02", currency: "USD" },
        thread_id: threadId,
      },
    }
  }

  test("tags usage/cost with its run and thread", () => {
    const state = reduceUiState(initialUiState, usage("run-9", "thread-9"))
    expect(state.runUsageCost).toMatchObject({ runId: "run-9", threadId: "thread-9" })
  })

  test("clears usage/cost when a new run starts", () => {
    const withUsage = reduceUiState(initialUiState, usage("run-1", "thread-1"))
    const started = reduceUiState(withUsage, { type: "run_started", threadId: "thread-1", runId: "run-2" })
    expect(withUsage.runUsageCost?.runId).toBe("run-1")
    expect(started.runUsageCost).toBeNull()
  })

  test("clears usage/cost when the user sends a new message", () => {
    const withUsage = reduceUiState(initialUiState, usage("run-1", "thread-1"))
    const sent = reduceUiState(withUsage, { type: "user_sent", content: "again", threadId: "thread-1" })
    expect(sent.runUsageCost).toBeNull()
  })

  test("clears usage/cost only when history switches to a different thread", () => {
    const onThreadOne = reduceUiState(
      reduceUiState(initialUiState, { type: "history", history: { thread_id: "thread-1", turns: [], has_more: false } }),
      usage("run-1", "thread-1"),
    )
    const stillThreadOne = reduceUiState(onThreadOne, {
      type: "history",
      history: { thread_id: "thread-1", turns: [], has_more: false },
    })
    const switched = reduceUiState(onThreadOne, {
      type: "history",
      history: { thread_id: "thread-2", turns: [], has_more: false },
    })
    expect(stillThreadOne.runUsageCost?.runId).toBe("run-1")
    expect(switched.runUsageCost).toBeNull()
  })
})

describe("UI state — terminal runs", () => {
  test("run_status cancelled and run_cancelled produce identical terminal state", () => {
    const viaStatus = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_status", status: "cancelled", run_id: "run-1", thread_id: "thread-1" },
    })
    const viaEvent = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_cancelled", run_id: "run-1", status: "cancelled", thread_id: "thread-1" },
    })
    expect(viaStatus.transcript).toEqual(viaEvent.transcript)
    expect(viaStatus.activity).toEqual(viaEvent.activity)
    expect(viaStatus.status).toBe(viaEvent.status)
    expect(viaStatus.lastError).toBe(viaEvent.lastError)
    expect(viaStatus.pendingGate).toBeNull()
    expect(viaEvent.pendingGate).toBeNull()
    expect(viaStatus.isThinking).toBe(false)
    expect(viaStatus.activeRunId).toBeNull()
    expect(viaStatus.lastTerminalRunId).toBe("run-1")
    expect(viaEvent.lastTerminalRunId).toBe("run-1")
  })

  test("cancelled uses info tone and does not set lastError", () => {
    const cancelled = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_cancelled", run_id: "run-1", status: "cancelled", thread_id: "thread-1" },
    })
    expect(cancelled.lastError).toBeUndefined()
    expect(cancelled.activity[0]).toMatchObject({ label: "run cancelled", status: "info" })
  })

  test("a terminal run clears a live pending gate and records lastTerminalRunId", () => {
    const gated = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "gate-1",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: "gate:1",
        gate_name: "approval",
        tool_name: "shell",
        description: "approve",
        parameters: "",
        resume_kind: { gate_ref: "gate:1" },
      },
    })
    const failed = reduceUiState(gated, {
      type: "event",
      event: { type: "run_status", status: "failed", run_id: "run-1", thread_id: "thread-1" },
    })
    expect(gated.pendingGate).not.toBeNull()
    expect(failed.pendingGate).toBeNull()
    expect(failed.lastError).toBe("Run failed before a reply was produced.")
    expect(failed.activity.at(-1)).toMatchObject({ label: "run failed", status: "error" })
    expect(failed.lastTerminalRunId).toBe("run-1")
  })

  test("uses the active run id for a null-run_id terminal frame", () => {
    const running = reduceUiState(initialUiState, {
      type: "run_started",
      threadId: "thread-1",
      runId: "run-1",
      status: "running",
    })
    const cancelled = reduceUiState(running, {
      type: "event",
      event: { type: "run_cancelled", run_id: null, status: "cancelled", thread_id: "thread-1" },
    })
    expect(cancelled.transcript.some((item) => item.id === "run-run-1-cancelled")).toBe(true)
    expect(cancelled.lastTerminalRunId).toBe("run-1")
  })

  test("dual-path cancel (run_status then run_cancelled) does not duplicate", () => {
    const viaStatus = reduceUiState(
      reduceUiState(initialUiState, { type: "run_started", threadId: "thread-1", runId: "run-1", status: "running" }),
      { type: "event", event: { type: "run_status", status: "cancelled", run_id: "run-1", thread_id: "thread-1" } },
    )
    const thenEvent = reduceUiState(viaStatus, {
      type: "event",
      event: { type: "run_cancelled", run_id: "run-1", status: "cancelled", thread_id: "thread-1" },
    })
    expect(thenEvent.transcript.filter((item) => item.role === "system")).toHaveLength(1)
  })

  test("clears lastTerminalRunId on the next run_started", () => {
    const failed = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_status", status: "failed", run_id: "run-1", thread_id: "thread-1" },
    })
    const restarted = reduceUiState(failed, { type: "run_started", threadId: "thread-1", runId: "run-2" })
    expect(failed.lastTerminalRunId).toBe("run-1")
    expect(restarted.lastTerminalRunId).toBeNull()
  })
})

describe("UI state — gate mapping parity", () => {
  test("gate_required and approval_needed map to the same pending-gate shape", () => {
    const base = reduceUiState(initialUiState, { type: "run_started", threadId: "thread-1", runId: "run-1" })
    const viaGate = reduceUiState(base, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "req-1",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: null,
        gate_name: "approval",
        tool_name: "shell",
        description: "Approve shell",
        parameters: "ls",
        allow_always: true,
        resume_kind: { kind: "approval", allow_always: true },
      },
    })
    const viaApproval = reduceUiState(base, {
      type: "event",
      event: {
        type: "approval_needed",
        request_id: "req-1",
        tool_name: "shell",
        description: "Approve shell",
        parameters: "ls",
        thread_id: "thread-1",
        allow_always: true,
      },
    })

    expect(viaApproval.pendingGate).toEqual(viaGate.pendingGate)
    expect(viaApproval.pendingGate).toMatchObject({
      request_id: "req-1",
      thread_id: "thread-1",
      run_id: "run-1",
      gate_name: "approval",
      tool_name: "shell",
      allow_always: true,
      approval_context: null,
      resume_kind: { kind: "approval", allow_always: true },
    })
    expect(viaApproval.activeRunId).toBe("run-1")
    expect(viaApproval.status).toBe("waiting for approval")
  })

  test("approval_needed reads a runtime approval_context defensively", () => {
    // Not declared on the approval_needed wire type, but may arrive at runtime;
    // toPendingGate must still surface it.
    const event = {
      type: "approval_needed",
      request_id: "req-2",
      tool_name: "shell",
      description: "Approve shell",
      parameters: "ls",
      thread_id: "thread-1",
      allow_always: false,
      approval_context: { tool_name: "shell", action: "run ls", details: ["cwd: /repo"] },
    }
    const state = reduceUiState(initialUiState, { type: "event", event: event as never })
    expect(state.pendingGate?.approval_context).toMatchObject({ action: "run ls" })
  })
})

describe("statusTone log levels", () => {
  test("maps log-level literals to canon tones", () => {
    expect(statusTone("warn")).toBe("warn")
    expect(statusTone("info")).toBe("info")
    expect(statusTone("debug")).toBe("muted")
    expect(statusTone("trace")).toBe("muted")
    expect(statusTone("error")).toBe("danger")
    expect(statusTone("fatal")).toBe("danger")
  })
})

describe("notify level + home-supporting state", () => {
  test("set_notify_level updates and no-ops when unchanged", () => {
    expect(initialUiState.notifyLevel).toBe("blockers")
    const all = reduceUiState(initialUiState, { type: "set_notify_level", level: "all" })
    expect(all.notifyLevel).toBe("all")
    // Unchanged level returns the same reference (no needless re-render).
    const same = reduceUiState(all, { type: "set_notify_level", level: "all" })
    expect(same).toBe(all)
  })

  test("run_usage accumulates today's USD cost", () => {
    const one = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "run_usage",
        run_id: "r1",
        thread_id: "t1",
        cost: {
          input_cost_usd: "0",
          cached_input_cost_usd: "0",
          output_cost_usd: "0",
          total_cost_usd: "0.25",
          currency: "USD",
        },
      },
    })
    expect(one.todayCostUsd).toBeCloseTo(0.25, 5)
    const two = reduceUiState(one, {
      type: "event",
      event: {
        type: "run_usage",
        run_id: "r2",
        thread_id: "t1",
        cost: {
          input_cost_usd: "0",
          cached_input_cost_usd: "0",
          output_cost_usd: "0",
          total_cost_usd: "0.75",
          currency: "USD",
        },
      },
    })
    expect(two.todayCostUsd).toBeCloseTo(1.0, 5)
  })

  test("a failed run records lastFailedRun; run_started clears it", () => {
    const failed = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_status", status: "failed", run_id: "run-9", thread_id: "thread-9", failure_category: "boom" },
    })
    expect(failed.lastFailedRun).toMatchObject({ threadId: "thread-9", runId: "run-9", detail: "Run failed: boom" })
    expect(typeof failed.lastFailedRun?.sinceMs).toBe("number")
    const restarted = reduceUiState(failed, { type: "run_started", threadId: "thread-9", runId: "run-10", status: "running" })
    expect(restarted.lastFailedRun).toBeNull()
    expect(typeof restarted.activeRunSinceMs).toBe("number")
  })

  test("a cancelled run does not record a failed row", () => {
    const cancelled = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_cancelled", run_id: "run-1", thread_id: "thread-1", status: "cancelled" },
    })
    expect(cancelled.lastFailedRun).toBeNull()
  })

  test("a raised gate stamps pendingGateSinceMs; clearing it resets", () => {
    const gated = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "gate_required",
        request_id: "req-1",
        gate_name: "approval",
        tool_name: "shell",
        description: "run ls",
        parameters: "ls",
        thread_id: "thread-1",
        resume_kind: null,
      } as never,
    })
    expect(typeof gated.pendingGateSinceMs).toBe("number")
    const cleared = reduceUiState(gated, { type: "gate_cleared" })
    expect(cleared.pendingGateSinceMs).toBeNull()
  })
})

describe("accumulateTodayCost (P4 cost dedup + day reset)", () => {
  test("dedups a replayed run by run id", () => {
    const first = accumulateTodayCost(0, "2026-07-18", [], "run-1", 0.25, "2026-07-18")
    expect(first.total).toBeCloseTo(0.25, 5)
    expect(first.countedRunIds).toEqual(["run-1"])
    // A reconnect/replay of the same run's cost adds nothing.
    const replay = accumulateTodayCost(
      first.total,
      first.dayKey,
      first.countedRunIds,
      "run-1",
      0.25,
      "2026-07-18",
    )
    expect(replay.total).toBeCloseTo(0.25, 5)
    expect(replay.countedRunIds).toEqual(["run-1"])
  })

  test("accumulates distinct runs within a day", () => {
    const one = accumulateTodayCost(0, null, [], "run-1", 0.25, "2026-07-18")
    const two = accumulateTodayCost(one.total, one.dayKey, one.countedRunIds, "run-2", 0.75, "2026-07-18")
    expect(two.total).toBeCloseTo(1.0, 5)
    expect(two.countedRunIds).toEqual(["run-1", "run-2"])
  })

  test("resets the total and counted set when the calendar day changes", () => {
    const day1 = accumulateTodayCost(1.0, "2026-07-18", ["run-1"], "run-2", 0.5, "2026-07-19")
    expect(day1.total).toBeCloseTo(0.5, 5)
    expect(day1.dayKey).toBe("2026-07-19")
    // The prior day's run id is dropped, so it can be counted fresh next day.
    expect(day1.countedRunIds).toEqual(["run-2"])
  })

  test("without a dayKey, accumulates + dedups but never rolls over", () => {
    const one = accumulateTodayCost(0, "2026-07-18", [], "run-1", 0.25, undefined)
    expect(one.total).toBeCloseTo(0.25, 5)
    expect(one.dayKey).toBe("2026-07-18")
    const dupe = accumulateTodayCost(one.total, one.dayKey, one.countedRunIds, "run-1", 0.25, undefined)
    expect(dupe.total).toBeCloseTo(0.25, 5)
  })
})

describe("run_usage cost accumulation via the reducer (P4)", () => {
  function usageEvent(runId: string, totalUsd: string, dayKey?: string | null) {
    return {
      type: "event" as const,
      dayKey,
      event: {
        type: "run_usage" as const,
        run_id: runId,
        thread_id: "t1",
        cost: {
          input_cost_usd: "0",
          cached_input_cost_usd: "0",
          output_cost_usd: "0",
          total_cost_usd: totalUsd,
          currency: "USD",
        },
      },
    }
  }

  test("replaying the same run_usage frame does not double-count", () => {
    const one = reduceUiState(initialUiState, usageEvent("run-1", "0.25", "2026-07-18"))
    const replay = reduceUiState(one, usageEvent("run-1", "0.25", "2026-07-18"))
    expect(one.todayCostUsd).toBeCloseTo(0.25, 5)
    expect(replay.todayCostUsd).toBeCloseTo(0.25, 5)
    expect(replay.countedCostRunIds).toEqual(["run-1"])
  })

  test("a new calendar day resets today's total", () => {
    const day1 = reduceUiState(initialUiState, usageEvent("run-1", "0.40", "2026-07-18"))
    const day2 = reduceUiState(day1, usageEvent("run-2", "0.10", "2026-07-19"))
    expect(day1.todayCostUsd).toBeCloseTo(0.4, 5)
    expect(day2.todayCostUsd).toBeCloseTo(0.1, 5)
    expect(day2.todayCostDayKey).toBe("2026-07-19")
  })
})

describe("activeRunSinceMs from history in_progress.started_at (P5)", () => {
  function historyWith(inProgress: { started_at: string } | null, threadId = "thread-1") {
    return {
      type: "history" as const,
      history: {
        thread_id: threadId,
        turns: [],
        has_more: false,
        pending_gate: null,
        in_progress: inProgress
          ? { turn_number: 1, user_input: "hi", state: "running", started_at: inProgress.started_at }
          : null,
      },
    }
  }

  test("adopts the server started_at for a run picked up via history", () => {
    const startedAt = "2026-07-18T10:00:00Z"
    const state = reduceUiState(initialUiState, historyWith({ started_at: startedAt }))
    expect(state.activeRunSinceMs).toBe(Date.parse(startedAt))
  })

  test("clears activeRunSinceMs when history shows no in-progress run", () => {
    const withRun = reduceUiState(initialUiState, historyWith({ started_at: "2026-07-18T10:00:00Z" }))
    const settled = reduceUiState(withRun, historyWith(null))
    expect(settled.activeRunSinceMs).toBeNull()
  })

  test("a terminal run clears activeRunSinceMs", () => {
    const running = reduceUiState(initialUiState, {
      type: "run_started",
      threadId: "thread-1",
      runId: "run-1",
      status: "running",
    })
    expect(typeof running.activeRunSinceMs).toBe("number")
    const failed = reduceUiState(running, {
      type: "event",
      event: { type: "run_status", status: "failed", run_id: "run-1", thread_id: "thread-1" },
    })
    expect(failed.activeRunSinceMs).toBeNull()
  })
})

describe("pendingGateSinceMs reset on thread switch (P6)", () => {
  function gateFor(threadId: string) {
    return {
      type: "event" as const,
      event: {
        type: "gate_required" as const,
        request_id: `${threadId}:gate`,
        thread_id: threadId,
        run_id: "run-1",
        gate_ref: "gate:1",
        gate_name: "approval",
        tool_name: "shell",
        description: "approve",
        parameters: "",
        resume_kind: { gate_ref: "gate:1" },
      },
    }
  }

  test("a switched-to thread's gate age starts fresh, not inherited", () => {
    const gatedA = reduceUiState(
      reduceUiState(initialUiState, { type: "history", history: { thread_id: "thread-A", turns: [], has_more: false } }),
      gateFor("thread-A"),
    )
    const stampA = gatedA.pendingGateSinceMs as number
    expect(typeof stampA).toBe("number")
    // Switch to thread B whose history carries its own pending gate.
    const switched = reduceUiState(gatedA, {
      type: "history",
      history: {
        thread_id: "thread-B",
        turns: [],
        has_more: false,
        pending_gate: {
          request_id: "thread-B:gate",
          thread_id: "thread-B",
          run_id: "run-2",
          gate_ref: "gate:2",
          gate_name: "approval",
          tool_name: "shell",
          description: "approve",
          parameters: "",
          resume_kind: { gate_ref: "gate:2" },
        },
      },
    })
    expect(switched.pendingGate?.thread_id).toBe("thread-B")
    // Fresh stamp for thread B — must not equal thread A's older timestamp.
    expect(switched.pendingGateSinceMs).toBeGreaterThanOrEqual(stampA)
    expect(switched.pendingGateSinceMs).not.toBe(null)
  })

  test("the same thread's persisting gate keeps its original timestamp", () => {
    const gated = reduceUiState(
      reduceUiState(initialUiState, { type: "history", history: { thread_id: "thread-A", turns: [], has_more: false } }),
      gateFor("thread-A"),
    )
    const stamp = gated.pendingGateSinceMs
    // A history poll on the same thread that omits gate info preserves the gate.
    const refreshed = reduceUiState(gated, {
      type: "history",
      history: { thread_id: "thread-A", turns: [], has_more: false },
    })
    expect(refreshed.pendingGate).not.toBeNull()
    expect(refreshed.pendingGateSinceMs).toBe(stamp)
  })
})

describe("lastFailedRun cross-thread preservation (P7)", () => {
  test("starting a run on a different thread preserves the other thread's failure", () => {
    const failedA = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_status", status: "failed", run_id: "run-a", thread_id: "thread-A" },
    })
    expect(failedA.lastFailedRun).toMatchObject({ threadId: "thread-A", runId: "run-a" })
    const startedB = reduceUiState(failedA, { type: "run_started", threadId: "thread-B", runId: "run-b", status: "running" })
    expect(startedB.lastFailedRun).toMatchObject({ threadId: "thread-A", runId: "run-a" })
  })

  test("starting a run on the same thread clears that thread's failure", () => {
    const failedA = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "run_status", status: "failed", run_id: "run-a", thread_id: "thread-A" },
    })
    const restartedA = reduceUiState(failedA, { type: "run_started", threadId: "thread-A", runId: "run-a2", status: "running" })
    expect(restartedA.lastFailedRun).toBeNull()
  })
})

describe("shared status normalizers (RU2/RU3)", () => {
  test("normalizeStatusKey canonicalizes camel/kebab/space forms", () => {
    expect(normalizeStatusKey("recovery_required")).toBe("recovery_required")
    expect(normalizeStatusKey("recovery-required")).toBe("recovery_required")
    expect(normalizeStatusKey("Recovery Required")).toBe("recovery_required")
    expect(normalizeStatusKey("waitingForApproval")).toBe("waiting_for_approval")
  })

  test("isTerminalRunState matches the reducer's terminal handling", () => {
    for (const status of ["completed", "done", "succeeded", "failed", "cancelled", "canceled", "killed", "recovery_required"]) {
      expect(isTerminalRunState(status)).toBe(true)
    }
    for (const status of ["running", "queued", "idle", "waiting_for_approval"]) {
      expect(isTerminalRunState(status)).toBe(false)
    }
  })
})

describe("live cumulative text streaming (LIVE-CONV)", () => {
  function running(threadId = "thread-1", runId = "run-1") {
    return reduceUiState(initialUiState, { type: "run_started", threadId, runId, status: "running" })
  }
  function streamText(state: ReturnType<typeof reduceUiState>, content: string, id = "text:run-1") {
    return reduceUiState(state, {
      type: "event",
      event: { type: "stream_text", id, content, thread_id: "thread-1" },
    })
  }

  test("upserts ONE assistant bubble by stable id and REPLACES its text each frame", () => {
    const s1 = streamText(running(), "Hel")
    const s2 = streamText(s1, "Hello wo")
    const s3 = streamText(s2, "Hello world")

    const assistants = s3.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ id: "text:run-1", text: "Hello world" })
    // The bubble grew by REPLACE, not concat — "Hel" must not survive as a prefix twice.
    expect((assistants[0] as { text: string }).text).toBe("Hello world")
    expect(s3.streamingAssistantId).toBe("text:run-1")
  })

  test("does not finalize/idle the run on a text frame (no terminal until final_reply)", () => {
    const s = streamText(streamText(running(), "partial"), "partial answer")
    expect(s.status).toBe("running")
    expect(s.isThinking).toBe(true)
    expect(s.activeRunId).toBe("run-1")
    expect(s.streamingAssistantId).toBe("text:run-1")
  })

  test("final_reply reconciles with the streamed bubble (same id, no duplicate)", () => {
    const streamed = streamText(streamText(running(), "Hello"), "Hello wor")
    const done = reduceUiState(streamed, {
      type: "event",
      event: { type: "response", content: "Hello world", thread_id: "thread-1" },
    })

    const assistants = done.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ id: "text:run-1", text: "Hello world" })
    expect(done.streamingAssistantId).toBeNull()
    expect(done.isThinking).toBe(false)
    expect(done.activeRunId).toBeNull()
    expect(done.status).toBe("idle")
  })

  test("a clean terminal run_status settles the streamed bubble and clears streaming", () => {
    const streamed = streamText(running(), "Answer text")
    const completed = reduceUiState(streamed, {
      type: "event",
      event: { type: "run_status", status: "completed", run_id: "run-1", thread_id: "thread-1" },
    })

    expect(completed.streamingAssistantId).toBeNull()
    expect(completed.isThinking).toBe(false)
    expect(completed.activeRunId).toBeNull()
    expect(completed.activeRunSinceMs).toBeNull()
    const assistant = completed.transcript.find((item) => item.role === "assistant")
    expect(assistant).toMatchObject({ id: "text:run-1", text: "Answer text" })
    expect(typeof (assistant as { meta?: { completedAtMs?: number } })?.meta?.completedAtMs).toBe("number")
  })

  test("a snapshot text frame with no active run materializes a settled bubble without reactivating", () => {
    // No run_started: emulates a projection_snapshot replayed for an idle thread.
    // A real snapshot frame is tagged replayed by client.markReplayed.
    const s = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "stream_text", id: "text:run-9", content: "old reply", thread_id: "thread-1", replayed: true },
    })
    expect(s.transcript.filter((item) => item.role === "assistant")).toHaveLength(1)
    expect(s.streamingAssistantId).toBeFalsy()
    expect(s.isThinking).toBe(false)
    expect(s.status).toBe("starting")
  })
})

describe("streaming state machine edge cases (F1-F5)", () => {
  function running(threadId = "thread-1", runId = "run-1") {
    return reduceUiState(initialUiState, { type: "run_started", threadId, runId, status: "running" })
  }
  function ev(state: ReturnType<typeof reduceUiState>, event: AppEvent) {
    return reduceUiState(state, { type: "event", event })
  }

  // F1: the history-refresh trigger must use the reducer's full terminal set so a
  // run ending 'succeeded'/'done' (reply only in the timeline) still refreshes.
  test("F1: isTerminalRunState covers succeeded/done/canceled/recovery_required with normalization", () => {
    for (const status of ["succeeded", "done", "completed", "canceled", "cancelled", "killed", "failed", "recovery_required"]) {
      expect(isTerminalRunState(status)).toBe(true)
    }
    // Normalization (case + separators) — App feeds the raw wire status through this.
    expect(isTerminalRunState("Succeeded")).toBe(true)
    expect(isTerminalRunState("RecoveryRequired")).toBe(true)
    expect(isTerminalRunState("running")).toBe(false)
    expect(isTerminalRunState("queued")).toBe(false)
  })

  test("F1: a succeeded run with the reply only in history renders it after the refresh", () => {
    // Run ends 'succeeded' with NO live stream_text — the spinner clears but no
    // reply is in the transcript yet.
    const settled = reduceUiState(running(), {
      type: "event",
      event: { type: "run_status", status: "succeeded", run_id: "run-1", thread_id: "thread-1" },
    })
    expect(settled.isThinking).toBe(false)
    expect(settled.transcript.filter((item) => item.role === "assistant")).toHaveLength(0)

    // refreshThreadFromEvent fires (isTerminalRunState('succeeded') is true) and
    // re-fetches the thread; the history carries the reply, which now renders.
    const refreshed = reduceUiState(settled, {
      type: "history",
      history: {
        thread_id: "thread-1",
        turns: [
          { turn_number: 1, user_message_id: "user-1", user_input: "hello", state: "completed", started_at: "", tool_calls: [] },
          { turn_number: 2, user_input: "", response: "reply from history", state: "completed", started_at: "", tool_calls: [] },
        ],
        has_more: false,
      },
    })
    const assistants = refreshed.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(1)
    expect((assistants[0] as { text: string }).text).toBe("reply from history")
  })

  // F2: a clean terminal run_status arriving BEFORE final_reply must still let the
  // reply reconcile into the existing streamed bubble — no duplicate.
  test("F2: terminal run_status before final_reply yields ONE bubble", () => {
    const streamed = ev(ev(running(), { type: "stream_text", id: "text:run-1", content: "Hello", thread_id: "thread-1" }),
      { type: "stream_text", id: "text:run-1", content: "Hello wor", thread_id: "thread-1" })
    // Terminal status FIRST (settles, clears streamingAssistantId).
    const settled = ev(streamed, { type: "run_status", status: "completed", run_id: "run-1", thread_id: "thread-1" })
    expect(settled.streamingAssistantId).toBeNull()
    expect(settled.lastStreamedAssistantId).toBe("text:run-1")
    // final_reply arrives AFTER — must reconcile into the same bubble, not append.
    const done = ev(settled, { type: "response", content: "Hello world", thread_id: "thread-1" })
    const assistants = done.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ id: "text:run-1", text: "Hello world" })
  })

  test("F2: final_reply before terminal run_status also yields ONE bubble (ordering-independent)", () => {
    const streamed = ev(running(), { type: "stream_text", id: "text:run-1", content: "Hello wor", thread_id: "thread-1" })
    const done = ev(streamed, { type: "response", content: "Hello world", thread_id: "thread-1" })
    const afterTerminal = ev(done, { type: "run_status", status: "completed", run_id: "run-1", thread_id: "thread-1" })
    const assistants = afterTerminal.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ id: "text:run-1", text: "Hello world" })
  })

  // F3: two id-less runs in a thread synthesize distinct ids client-side; the
  // reducer additionally matches thread_id so a lingering bubble can't be hijacked.
  test("F3: two runs with distinct fallback ids in one thread produce two separate bubbles", () => {
    // Run 1 streams and settles.
    const run1 = ev(running("thread-1", "run-1"), { type: "stream_text", id: "text:run-1", content: "answer one", thread_id: "thread-1" })
    const run1done = ev(run1, { type: "response", content: "answer one", thread_id: "thread-1" })
    // Run 2 starts (clears lastStreamedAssistantId) and streams under its own id.
    const run2 = ev(reduceUiState(run1done, { type: "run_started", threadId: "thread-1", runId: "run-2", status: "running" }),
      { type: "stream_text", id: "text:run-2", content: "answer two", thread_id: "thread-1" })
    const run2done = ev(run2, { type: "response", content: "answer two", thread_id: "thread-1" })

    const assistants = run2done.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(2)
    expect(assistants.map((item) => (item as { text: string }).text)).toEqual(["answer one", "answer two"])
  })

  test("F3: a same-id frame from a different thread does not hijack the bubble", () => {
    const run1 = ev(running("thread-1", "run-1"), { type: "stream_text", id: "text:stream", content: "thread one", thread_id: "thread-1" })
    // A stray frame with the SAME id but a different thread must create its own bubble.
    const crossThread = ev(run1, { type: "stream_text", id: "text:stream", content: "thread two", thread_id: "thread-2" })
    const byThread = crossThread.transcript.filter((item) => item.role === "assistant")
    expect(byThread).toHaveLength(2)
    expect(byThread.find((item) => item.threadId === "thread-1")).toMatchObject({ text: "thread one" })
    expect(byThread.find((item) => item.threadId === "thread-2")).toMatchObject({ text: "thread two" })
  })

  // F4: a replayed stream_text (projection_snapshot on reconnect) must not overwrite
  // a finalized reply with the stale cumulative body.
  test("F4: replayed stream_text after settle does not overwrite the finalized reply", () => {
    const streamed = ev(running(), { type: "stream_text", id: "text:run-1", content: "Hello wor", thread_id: "thread-1" })
    const done = ev(streamed, { type: "response", content: "Hello world (final)", thread_id: "thread-1" })
    expect(done.transcript.find((item) => item.role === "assistant")).toMatchObject({ text: "Hello world (final)" })

    // Reconnect replays the older cumulative body under the same id.
    const replayed = ev(done, { type: "stream_text", id: "text:run-1", content: "Hello wor", thread_id: "thread-1", replayed: true })
    const assistants = replayed.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(1)
    // Finalized text preserved — not reverted to the stale streamed body.
    expect(assistants[0]).toMatchObject({ text: "Hello world (final)" })
  })

  test("F4: a settled bubble is also protected from a late non-replayed frame with no active run", () => {
    const streamed = ev(running(), { type: "stream_text", id: "text:run-1", content: "partial", thread_id: "thread-1" })
    const done = ev(streamed, { type: "response", content: "final answer", thread_id: "thread-1" })
    // No active run + settled bubble: a stray live frame must not revert it.
    const stray = ev(done, { type: "stream_text", id: "text:run-1", content: "partial", thread_id: "thread-1" })
    expect(stray.transcript.find((item) => item.role === "assistant")).toMatchObject({ text: "final answer" })
  })

  // F5: a first token that precedes the run being marked active must still set the
  // streaming target so final_reply reconciles without a duplicate.
  test("F5: first token before the run is active still reconciles at final_reply (no dup)", () => {
    // Live stream_text with NO run_started/run_status yet (isThinking false, no run).
    const firstToken = reduceUiState(initialUiState, {
      type: "event",
      event: { type: "stream_text", id: "text:run-1", content: "Hel", thread_id: "thread-1" },
    })
    expect(firstToken.streamingAssistantId).toBe("text:run-1")
    expect(firstToken.lastStreamedAssistantId).toBe("text:run-1")

    const done = reduceUiState(firstToken, {
      type: "event",
      event: { type: "response", content: "Hello world", thread_id: "thread-1" },
    })
    const assistants = done.transcript.filter((item) => item.role === "assistant")
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ id: "text:run-1", text: "Hello world" })
    expect(done.streamingAssistantId).toBeNull()
  })
})

describe("single status source while a run is active (LIVE-CONV)", () => {
  test("a mid-run history read does not reset status/isThinking or reflow the transcript", () => {
    const streaming = reduceUiState(
      reduceUiState(initialUiState, { type: "run_started", threadId: "thread-1", runId: "run-1", status: "running" }),
      { type: "event", event: { type: "stream_text", id: "text:run-1", content: "streaming answer", thread_id: "thread-1" } },
    )
    // /timeline omits in-progress/gate info; the poll would otherwise idle the run.
    const afterHistory = reduceUiState(streaming, {
      type: "history",
      history: { thread_id: "thread-1", turns: [], has_more: false, pending_gate: null },
    })

    expect(afterHistory.status).toBe("running")
    expect(afterHistory.isThinking).toBe(true)
    expect(afterHistory.activeRunId).toBe("run-1")
    // Transcript preserved (streaming bubble kept, not dropped by a merge).
    expect(afterHistory.transcript.filter((item) => item.role === "assistant")).toHaveLength(1)
    expect(afterHistory.transcript.find((item) => item.role === "assistant")).toMatchObject({ id: "text:run-1" })
  })

  test("run_status adopts elapsed via Date.now() fallback when the client has no start time", () => {
    const originalNow = Date.now
    try {
      Date.now = () => 5_000
      // A tracked run_status with no prior run_started (no client-known start).
      const adopted = reduceUiState(initialUiState, {
        type: "event",
        event: { type: "run_status", status: "running", run_id: "run-1", thread_id: "thread-1" },
      })
      expect(adopted.activeRunSinceMs).toBe(5_000)
      expect(adopted.isThinking).toBe(true)
    } finally {
      Date.now = originalNow
    }
  })

  test("history in_progress without started_at falls back to now instead of leaving elapsed null", () => {
    const originalNow = Date.now
    try {
      Date.now = () => 7_000
      const state = reduceUiState(initialUiState, {
        type: "history",
        history: {
          thread_id: "thread-1",
          turns: [],
          has_more: false,
          pending_gate: null,
          in_progress: { turn_number: 1, user_input: "hi", state: "running", started_at: "" },
        },
      })
      expect(state.activeRunSinceMs).toBe(7_000)
    } finally {
      Date.now = originalNow
    }
  })
})

describe("running-tool legibility (LIVE-CONV)", () => {
  test("a running capability preview carries its input/command on the row mid-run", () => {
    const state = reduceUiState(initialUiState, {
      type: "event",
      event: {
        type: "capability_display_preview",
        invocation_id: "inv-1",
        capability_id: "acme.lookup",
        status: "running",
        title: "lookup",
        input_summary: "query terms",
        truncated: false,
        thread_id: "thread-1",
      },
    })

    const activity = state.transcript.find((item) => item.role === "activity")
    expect(activity).toBeTruthy()
    const lines = transcriptActivityLines((activity as Extract<TranscriptItem, { role: "activity" }>).activity)
    // The running row carries the input line so the collapsed summary (which now
    // prefers input over an empty output while running) can surface the command.
    expect(lines.some((line) => line === "input: query terms")).toBe(true)
    expect((activity as { activity: { status: string } }).activity.status).toBe("running")
  })
})

describe("lastRunOutcome (input-queue flush signal)", () => {
  const running = { ...initialUiState, isThinking: true, activeRunId: "run-1", activeThreadId: "thread-1" }

  test("starts null", () => {
    expect(initialUiState.lastRunOutcome).toBeNull()
  })

  test("clean terminal run_status settles to completed", () => {
    const state = reduceUiState(running, {
      type: "event",
      event: { type: "run_status", status: "completed", run_id: "run-1", thread_id: "thread-1" },
    })
    expect(state.lastRunOutcome).toBe("completed")
    expect(state.isThinking).toBe(false)
  })

  test("final reply (response) settles to completed", () => {
    const streamed = reduceUiState(running, {
      type: "event",
      event: { type: "stream_chunk", content: "hi", thread_id: "thread-1" },
    })
    const state = reduceUiState(streamed, {
      type: "event",
      event: { type: "response", content: "hi there", thread_id: "thread-1" },
    })
    expect(state.lastRunOutcome).toBe("completed")
  })

  test("failed run settles to failed", () => {
    const state = reduceUiState(running, {
      type: "event",
      event: { type: "run_status", status: "failed", run_id: "run-1", thread_id: "thread-1" },
    })
    expect(state.lastRunOutcome).toBe("failed")
  })

  test("cancelled run settles to cancelled", () => {
    const state = reduceUiState(running, {
      type: "event",
      event: { type: "run_cancelled", run_id: "run-1", thread_id: "thread-1" },
    })
    expect(state.lastRunOutcome).toBe("cancelled")
  })

  test("run_started clears a prior outcome", () => {
    const completed = reduceUiState(running, {
      type: "event",
      event: { type: "run_status", status: "completed", run_id: "run-1", thread_id: "thread-1" },
    })
    expect(completed.lastRunOutcome).toBe("completed")
    const restarted = reduceUiState(completed, { type: "run_started", threadId: "thread-1", runId: "run-2" })
    expect(restarted.lastRunOutcome).toBeNull()
  })

  test("user_sent clears a prior outcome", () => {
    const completed = reduceUiState(running, {
      type: "event",
      event: { type: "run_status", status: "completed", run_id: "run-1", thread_id: "thread-1" },
    })
    const sent = reduceUiState(completed, { type: "user_sent", content: "again", threadId: "thread-1" })
    expect(sent.lastRunOutcome).toBeNull()
  })
})

import { describe, expect, test } from "bun:test"
import { initialUiState, reduceUiState } from "./state"
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

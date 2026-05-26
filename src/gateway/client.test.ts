import { describe, expect, test } from "bun:test"
import { GatewayClient, mapWebChatEvent, mapWebChatEvents } from "./client"

describe("WebChat event mapping", () => {
  test("maps timeline tool result references to tool summaries", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          thread: { thread_id: "thread-1" },
          messages: [
            {
              message_id: "tool-1",
              thread_id: "thread-1",
              sequence: 2,
              kind: "tool_result_reference",
              status: "finalized",
              content: JSON.stringify({
                result_ref: "result:run.tool",
                safe_summary: "capability completed",
              }),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch

    try {
      const history = await client.history("thread-1")
      expect(history.turns).toEqual([
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
              result: "result:run.tool",
            },
          ],
        },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("maps durable timeline capability display previews to tool summaries", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          thread: { thread_id: "thread-1" },
          messages: [
            {
              message_id: "preview-1",
              thread_id: "thread-1",
              sequence: 2,
              kind: "capability_display_preview",
              status: "finalized",
              tool_result_ref: "result:tool-output",
              content: JSON.stringify({
                invocation_id: "run-1",
                capability_id: "builtin.read_file",
                status: "completed",
                title: "read_file",
                subtitle: "src/main.rs",
                input_summary: "path: src/main.rs",
                output_summary: "text output",
                output_preview: "fn main() {}",
                output_kind: "text",
                output_bytes: 12,
                result_ref: "result:tool-output",
                truncated: false,
              }),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch

    try {
      const history = await client.history("thread-1")
      expect(history.turns).toEqual([
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
              subtitle: "src/main.rs",
              input_summary: "path: src/main.rs",
              output_summary: "text output",
              output_preview: "fn main() {}",
              output_kind: "text",
              output_bytes: 12,
              result_ref: "result:tool-output",
              truncated: false,
              result_preview: "text output",
              result: "result:tool-output",
              error: null,
            },
          ],
        },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("uses the latest projection item instead of replaying old text", () => {
    const event = mapWebChatEvent(
      {
        type: "projection_update",
        cursor: "cursor-1",
        state: {
          thread_id: "thread-1",
          items: [
            { text: { id: "old-reply", body: "old assistant reply" } },
            { run_status: { run_id: "run-1", status: "failed" } },
          ],
        },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "run_status",
      status: "failed",
      run_id: "run-1",
      failure_category: null,
      thread_id: "thread-1",
    })
  })

  test("maps running progress to thinking state", () => {
    const event = mapWebChatEvent(
      {
        type: "running",
        cursor: "cursor-1",
        progress: { turn_run_id: "run-1", kind: "reflecting" },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "thinking",
      message: "reflecting",
      thread_id: "thread-1",
    })
  })

  test("maps projection thinking items to live thinking updates", () => {
    const event = mapWebChatEvent(
      {
        type: "projection_update",
        cursor: "cursor-1",
        state: {
          thread_id: "thread-1",
          items: [{ thinking: { id: "thinking:run-1:1", body: "checking context" } }],
        },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "thinking_update",
      id: "thinking:run-1:1",
      content: "checking context",
      thread_id: "thread-1",
    })
  })

  test("emits every renderable projection item in frame order", () => {
    const events = mapWebChatEvents(
      {
        type: "projection_update",
        cursor: "cursor-1",
        state: {
          thread_id: "thread-1",
          items: [
            { text: { id: "reply-1", body: "final answer" } },
            { thinking: { id: "thinking:run-1:1", body: "checking context" } },
          ],
        },
      },
      "thread-1",
    )

    expect(events).toEqual([
      {
        type: "response",
        content: "final answer",
        thread_id: "thread-1",
      },
      {
        type: "thinking_update",
        id: "thinking:run-1:1",
        content: "checking context",
        thread_id: "thread-1",
      },
    ])
  })

  test("maps tool progress to a tool activity event", () => {
    const event = mapWebChatEvent(
      {
        type: "capability_progress",
        cursor: "cursor-1",
        progress: { turn_run_id: "run-1", kind: "tool_running" },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "tool_started",
      name: "tool_running",
      thread_id: "thread-1",
    })
  })

  test("maps rich capability activity to a first-class UI event", () => {
    const event = mapWebChatEvent(
      {
        type: "capability_activity",
        cursor: "cursor-1",
        activity: {
          invocation_id: "run-1",
          thread_id: "thread-1",
          capability_id: "builtin.list_dir",
          status: "completed",
          provider: "host",
          runtime: "local",
          output_bytes: 42,
        },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "capability_activity",
      invocation_id: "run-1",
      capability_id: "builtin.list_dir",
      status: "completed",
      provider: "host",
      runtime: "local",
      process_id: null,
      output_bytes: 42,
      error_kind: null,
      thread_id: "thread-1",
    })
  })

  test("maps capability display previews to a first-class UI event", () => {
    const event = mapWebChatEvent(
      {
        type: "capability_display_preview",
        cursor: "cursor-1",
        preview: {
          invocation_id: "run-1",
          thread_id: "thread-1",
          capability_id: "builtin.read_file",
          status: "completed",
          title: "read_file",
          subtitle: "src/main.rs",
          input_summary: "path: src/main.rs",
          output_summary: "text output",
          output_preview: "fn main() {}",
          output_kind: "text",
          output_bytes: 12,
          result_ref: "result:tool-output",
          timeline_message_id: "preview-1",
          truncated: false,
        },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "capability_display_preview",
      timeline_message_id: "preview-1",
      invocation_id: "run-1",
      capability_id: "builtin.read_file",
      status: "completed",
      title: "read_file",
      subtitle: "src/main.rs",
      input_summary: "path: src/main.rs",
      output_summary: "text output",
      output_preview: "fn main() {}",
      output_kind: "text",
      output_bytes: 12,
      result_ref: "result:tool-output",
      truncated: false,
      thread_id: "thread-1",
    })
  })
})

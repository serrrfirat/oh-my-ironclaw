import { describe, expect, test } from "bun:test"
import { GatewayClient, mapWebChatEvent, mapWebChatEvents } from "./client"

describe("Gateway client", () => {
  test("loads every paginated thread page", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    const requests: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      const cursor = new URL(url).searchParams.get("cursor")
      return new Response(
        JSON.stringify(cursor
          ? {
              threads: [{
                thread_id: "thread-2",
                title: null,
                created_at: "2026-05-02T10:00:00Z",
                updated_at: "2026-05-03T10:00:00Z",
              }],
              next_cursor: null,
            }
          : {
              threads: [{
                thread_id: "thread-1",
                title: "First thread",
                created_at: "2026-05-01T10:00:00Z",
              }],
              next_cursor: "cursor-1",
            }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch

    try {
      const response = await client.threads()
      expect(response.threads.map((thread) => thread.id)).toEqual(["thread-1", "thread-2"])
      expect(response.threads[1]?.updated_at).toBe("2026-05-03T10:00:00Z")
      expect(requests.map((url) => new URL(url).searchParams.get("cursor"))).toEqual([null, "cursor-1"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("submits manual auth tokens through the product-auth secret-submit contract", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body))
      requests.push({ url, body })
      if (url.endsWith("/manual-token/setup")) {
        return new Response(JSON.stringify({ interaction_id: "interaction-1", invocation_id: "invocation-1", status: "pending" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ credential_ref: "credential:github", status: "ready" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      const response = await client.submitManualToken({
        provider: "github",
        account_label: "GitHub token",
        token: "ghp_secret",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: "gate:auth-github",
      })

      expect(requests.map((request) => request.url)).toEqual([
        "http://example.test/api/reborn/product-auth/manual-token/setup",
        "http://example.test/api/reborn/product-auth/manual-token/secret-submit",
      ])
      expect(requests[0]?.body).toEqual({
        provider: "github",
        account_label: "GitHub token",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: "gate:auth-github",
      })
      expect(requests[1]?.body).toEqual({
        interaction_id: "interaction-1",
        token: "ghp_secret",
        thread_id: "thread-1",
        invocation_id: "invocation-1",
      })
      expect(response.credential_ref).toBe("credential:github")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("resolves auth gates with credential refs only", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    let requestUrl = ""
    let requestBody: Record<string, unknown> = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      await client.resolveGate({
        request_id: "run-1:gate:auth-github",
        thread_id: "thread-1",
        run_id: "run-1",
        gate_ref: "gate:auth-github",
        resolution: "credential_provided",
        credential_ref: "credential:github",
      })

      expect(requestUrl).toBe("http://example.test/api/webchat/v2/threads/thread-1/runs/run-1/gates/gate%3Aauth-github/resolve")
      expect(requestBody.resolution).toBe("credential_provided")
      expect(requestBody.credential_ref).toBe("credential:github")
      expect("token" in requestBody).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

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
      expect(history.turns).toEqual([])
      expect(history.messages).toEqual([
        {
          kind: "tool_result_reference",
          id: "tool-1",
          thread_id: "thread-1",
          sequence: 2,
          status: "finalized",
          activity: {
            kind: "tool_result_reference",
            name: "Capability",
            has_result: true,
            has_error: false,
            call_id: "result:run.tool",
            result_preview: "capability completed",
            result: "result:run.tool",
          },
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
      expect(history.turns).toEqual([])
      expect(history.messages).toEqual([
        {
          kind: "capability_display_preview",
          id: "preview-1",
          thread_id: "thread-1",
          sequence: 2,
          status: "finalized",
          activity: {
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

  test("maps projection work summaries to live activity updates", () => {
    const event = mapWebChatEvent(
      {
        type: "projection_update",
        cursor: "cursor-1",
        state: {
          thread_id: "thread-1",
          items: [{
            work_summary: {
              id: "work-summary:run-1:1",
              run_id: "run-1",
              phase: "planning",
              body: "checking branch state",
            },
          }],
        },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "work_summary_update",
      id: "work-summary:run-1:1",
      run_id: "run-1",
      phase: "planning",
      content: "checking branch state",
      thread_id: "thread-1",
    })
  })

  test("maps projection skill activations to activity updates", () => {
    const event = mapWebChatEvent(
      {
        type: "projection_update",
        cursor: "cursor-1",
        state: {
          thread_id: "thread-1",
          items: [{
            skill_activation: {
              id: "skill-activation:run-1:1",
              run_id: "run-1",
              skill_names: ["code-review"],
              feedback: ["code-review: force-activated via explicit mention"],
            },
          }],
        },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "skill_activated",
      id: "skill-activation:run-1:1",
      run_id: "run-1",
      skill_names: ["code-review"],
      feedback: ["code-review: force-activated via explicit mention"],
      thread_id: "thread-1",
    })
  })

  test("emits live projection context before final text", () => {
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
        type: "thinking_update",
        id: "thinking:run-1:1",
        content: "checking context",
        thread_id: "thread-1",
      },
      {
        type: "response",
        content: "final answer",
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

  test("maps auth-required prompts to pending gates", () => {
    const event = mapWebChatEvent(
      {
        type: "auth_required",
        cursor: "cursor-1",
        prompt: {
          turn_run_id: "run-1",
          auth_request_ref: "gate:auth-github",
          provider: "github",
          account_label: "GitHub token",
          challenge_kind: "oauth_url",
          authorization_url: "https://github.com/login/oauth/authorize",
          expires_at: "2026-05-31T20:00:00Z",
          headline: "Authentication required",
          body: "GitHub needs authentication.",
        },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "gate_required",
      request_id: "run-1:gate:auth-github",
      gate_name: "auth",
      tool_name: "Authentication required",
      description: "GitHub needs authentication.",
      parameters: "",
      extension_name: null,
      provider: "github",
      account_label: "GitHub token",
      challenge_kind: "oauth_url",
      authorization_url: "https://github.com/login/oauth/authorize",
      expires_at: "2026-05-31T20:00:00Z",
      run_id: "run-1",
      gate_ref: "gate:auth-github",
      resume_kind: { run_id: "run-1", gate_ref: "gate:auth-github" },
      thread_id: "thread-1",
    })
  })

  test("maps legacy auth-required prompts to manual-token gates", () => {
    const event = mapWebChatEvent(
      {
        type: "auth_required",
        prompt: {
          turn_run_id: "run-1",
          auth_request_ref: "gate:auth-github",
          headline: "Authentication required",
          body: "GitHub needs authentication.",
        },
      },
      "thread-1",
    )

    expect(event).toMatchObject({
      type: "gate_required",
      gate_name: "auth",
      challenge_kind: "manual_token",
      provider: null,
      account_label: null,
      authorization_url: null,
      expires_at: null,
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

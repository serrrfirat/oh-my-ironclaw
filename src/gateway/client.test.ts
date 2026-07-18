import { describe, expect, test } from "bun:test"
import {
  GatewayClient,
  GatewayError,
  SseTerminalError,
  SSE_MAX_BACKOFF_MS,
  SSE_MIN_RECONNECT_MS,
  mapWebChatEvent,
  mapWebChatEvents,
  nextBackoff,
} from "./client"

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

  test("uses WebChat v2 LLM provider action payloads", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
      const url = urlFor(input)
      const body = url.endsWith("/channels/connectable")
        ? { channels: [{ channel: "slack", display_name: "Slack", strategy: "inbound_proof_code", action: { title: "Slack", instructions: "Enter code", code_placeholder: "code", submit_label: "Connect", success_message: "ok", error_message: "bad" }, command_aliases: ["slack"] }] }
        : url.endsWith("/llm/providers") || url.endsWith("/delete")
          ? { providers: [], active: null }
          : url.endsWith("/nearai/login")
            ? { auth_url: "https://near.ai/login" }
            : url.endsWith("/nearai/wallet")
              ? { active: true }
              : url.endsWith("/codex/login")
                ? { user_code: "ABCD", verification_uri: "https://login.example" }
                : { ok: true, models: ["qwen"] }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      const provider = {
        id: "qwen",
        description: "Qwen",
        adapter: "open_ai_completions",
        default_model: "qwen-plus",
        base_url: "https://dashscope.example/v1",
        builtin: false,
        active: false,
        active_model: null,
        api_key_required: true,
        accepts_api_key: true,
        api_key_set: true,
        can_list_models: true,
      }

      await client.testLlmProvider(provider)
      await client.listLlmProviderModels(provider)
      await client.upsertLlmProvider({
        id: "qwen",
        name: "Qwen",
        adapter: "open_ai_completions",
        base_url: "https://dashscope.example/v1",
        default_model: "qwen-plus",
        api_key: "sk-qwen",
      })
      await client.deleteLlmProvider("qwen")
      await client.startNearAiLogin("google", "http://localhost:3000")
      await client.completeNearAiWalletLogin({
        account_id: "firat.near",
        public_key: "ed25519:public",
        signature: "base64sig",
        message: "Log in to NEAR AI",
        recipient: "near.ai",
        nonce: [1, 2, 3],
        callback_url: "http://localhost:3000",
      })
      await client.startCodexLogin()
      const channels = await client.connectableChannels()

      expect(requests.map((request) => request.url)).toEqual([
        "http://example.test/api/webchat/v2/llm/test-connection",
        "http://example.test/api/webchat/v2/llm/list-models",
        "http://example.test/api/webchat/v2/llm/providers",
        "http://example.test/api/webchat/v2/llm/providers/qwen/delete",
        "http://example.test/api/webchat/v2/llm/nearai/login",
        "http://example.test/api/webchat/v2/llm/nearai/wallet",
        "http://example.test/api/webchat/v2/llm/codex/login",
        "http://example.test/api/webchat/v2/channels/connectable",
      ])
      expect(requests[0]?.body).toEqual({
        provider_id: "qwen",
        provider_type: "custom",
        adapter: "open_ai_completions",
        base_url: "https://dashscope.example/v1",
        model: "qwen-plus",
      })
      expect(requests[1]?.body).toEqual(requests[0]?.body)
      expect(requests[2]?.body).toEqual({
        id: "qwen",
        name: "Qwen",
        adapter: "open_ai_completions",
        base_url: "https://dashscope.example/v1",
        default_model: "qwen-plus",
        api_key: "sk-qwen",
      })
      expect(requests[3]?.body).toBeNull()
      expect(requests[4]?.body).toEqual({ provider: "google", origin: "http://localhost:3000" })
      expect(requests[5]?.body).toEqual({
        account_id: "firat.near",
        public_key: "ed25519:public",
        signature: "base64sig",
        message: "Log in to NEAR AI",
        recipient: "near.ai",
        nonce: [1, 2, 3],
        callback_url: "http://localhost:3000",
      })
      expect(requests[6]?.body).toBeNull()
      expect(requests[7]?.body).toBeNull()
      expect(channels.channels[0]?.channel).toBe("slack")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

function urlFor(input: RequestInfo | URL): string {
  return String(input)
}

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

  test("message_attachments only includes non-user (reply) attachments", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          thread: { thread_id: "thread-1" },
          messages: [
            {
              message_id: "user-1",
              thread_id: "thread-1",
              sequence: 1,
              kind: "user",
              status: "sent",
              content: "here is my file",
              attachments: [{ attachment_id: "up-1", filename: "mine.png" }],
            },
            {
              message_id: "assistant-1",
              thread_id: "thread-1",
              sequence: 2,
              kind: "assistant",
              status: "completed",
              content: "here is the chart",
              attachments: [{ attachment_id: "reply-1", filename: "chart.png" }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch

    try {
      const history = await client.history("thread-1")
      // The user's own upload must not be a /save target; only the reply's is.
      expect(history.message_attachments).toEqual([
        { message_id: "assistant-1", refs: [{ attachment_id: "reply-1", filename: "chart.png" }] },
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

  test("maps projection gates to approval requests after run status", () => {
    const events = mapWebChatEvents(
      {
        type: "projection_update",
        cursor: "cursor-1",
        state: {
          thread_id: "thread-1",
          items: [
            { run_status: { run_id: "run-1", status: "waiting_for_approval" } },
            { gate: { gate_ref: "gate:approval-1", headline: "Shell command approval required" } },
          ],
        },
      },
      "thread-1",
    )

    expect(events).toEqual([
      {
        type: "run_status",
        status: "waiting_for_approval",
        run_id: "run-1",
        failure_category: null,
        thread_id: "thread-1",
      },
      {
        type: "gate_required",
        request_id: "gate:approval-1",
        gate_name: "approval",
        tool_name: "approval",
        description: "Shell command approval required",
        parameters: "",
        resume_kind: { gate_ref: "gate:approval-1" },
        thread_id: "thread-1",
        run_id: null,
        gate_ref: "gate:approval-1",
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
      allow_always: false,
      approval_context: null,
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

  test("maps a cancelled event to a run-cancelled UI event", () => {
    const event = mapWebChatEvent(
      {
        type: "cancelled",
        cursor: "cursor-1",
        response: { run_id: "run-1", status: "Cancelled", event_cursor: 12, already_terminal: false },
      },
      "thread-1",
    )

    expect(event).toEqual({
      type: "run_cancelled",
      run_id: "run-1",
      status: "Cancelled",
      already_terminal: false,
      thread_id: "thread-1",
    })
  })

  test("captures usage and cost from a failed run_state", () => {
    const events = mapWebChatEvents(
      {
        type: "failed",
        cursor: "cursor-1",
        run_state: {
          run_id: "run-1",
          status: "Failed",
          failure: { category: "model_unavailable" },
          usage: {
            input_tokens: 1200,
            output_tokens: 340,
            cache_read_input_tokens: 800,
            cache_creation_input_tokens: 0,
          },
          cost: {
            input_cost_usd: "0.012",
            cached_input_cost_usd: "0.001",
            output_cost_usd: "0.02",
            total_cost_usd: "0.033",
            currency: "USD",
          },
        },
      },
      "thread-1",
    )

    expect(events[0]).toEqual({
      type: "run_status",
      status: "Failed",
      run_id: "run-1",
      failure_category: "model_unavailable",
      thread_id: "thread-1",
    })
    expect(events[1]).toEqual({
      type: "run_usage",
      run_id: "run-1",
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 0,
      },
      cost: {
        input_cost_usd: "0.012",
        cached_input_cost_usd: "0.001",
        output_cost_usd: "0.02",
        total_cost_usd: "0.033",
        currency: "USD",
      },
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function recordingClient(handler: (url: string, init?: RequestInit) => unknown) {
  const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
  const requests: Array<{ url: string; method: string; body: unknown }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    const result = handler(url, init)
    return result instanceof Response ? result : jsonResponse(result)
  }) as unknown as typeof fetch
  return { client, requests, restore: () => { globalThis.fetch = originalFetch } }
}

describe("WebChat v2 message + session surface", () => {
  test("sends client_action_id, attachments and model, folding rejected_busy into a notice", async () => {
    const { client, requests, restore } = recordingClient(() => ({
      outcome: "rejected_busy",
      thread_id: "thread-1",
      accepted_message_ref: "msg-1",
      active_run_id: "run-9",
      status: "Running",
      notice: "A run is already active on this thread.",
    }))

    try {
      const response = await client.send("hello", "thread-1", {
        attachments: [{ mime_type: "image/png", filename: "a.png", data_base64: "AAA" }],
        model: "gpt-5.5",
      })

      expect(requests[0]?.url).toBe("http://example.test/api/webchat/v2/threads/thread-1/messages")
      const body = requests[0]?.body as Record<string, unknown>
      expect(typeof body.client_action_id).toBe("string")
      expect(body.content).toBe("hello")
      expect(body.attachments).toEqual([{ mime_type: "image/png", filename: "a.png", data_base64: "AAA" }])
      expect(body.model).toBe("gpt-5.5")
      expect(response.outcome).toBe("rejected_busy")
      expect(response.notice).toBe("A run is already active on this thread.")
      expect(response.run_id).toBe("run-9")
    } finally {
      restore()
    }
  })

  test("maps a submitted outcome to the run id", async () => {
    const { client, requests, restore } = recordingClient(() => ({
      outcome: "submitted",
      thread_id: "thread-1",
      accepted_message_ref: "msg-1",
      turn_id: "turn-1",
      run_id: "run-1",
      status: "Queued",
      resolved_run_profile_id: "profile",
      resolved_run_profile_version: 3,
      event_cursor: 0,
    }))

    try {
      const response = await client.send("hi", "thread-1")
      expect(response.outcome).toBe("submitted")
      expect(response.run_id).toBe("run-1")
      expect((requests[0]?.body as Record<string, unknown>).attachments).toBeUndefined()
    } finally {
      restore()
    }
  })

  test("deletes a thread", async () => {
    const { client, requests, restore } = recordingClient(() => ({ thread_id: "thread-1", deleted: true }))
    try {
      const response = await client.deleteThread("thread-1")
      expect(requests[0]?.method).toBe("DELETE")
      expect(requests[0]?.url).toBe("http://example.test/api/webchat/v2/threads/thread-1")
      expect(response.deleted).toBe(true)
    } finally {
      restore()
    }
  })

  test("fetches the session snapshot", async () => {
    const session = {
      tenant_id: "tenant-1",
      user_id: "user-1",
      capabilities: { operator_webui_config: true },
      features: { reborn_projects: false, global_auto_approve: true },
      attachments: { accept: ["image/png"], max_count: 10, max_file_bytes: 5, max_total_bytes: 10 },
    }
    const { client, requests, restore } = recordingClient(() => session)
    try {
      const response = await client.session()
      expect(requests[0]?.url).toBe("http://example.test/api/webchat/v2/session")
      expect(response.capabilities.operator_webui_config).toBe(true)
      expect(response.features.global_auto_approve).toBe(true)
    } finally {
      restore()
    }
  })

  test("counts the approval inbox with the needs_approval query param", async () => {
    const { client, requests, restore } = recordingClient(() => ({
      threads: [{ thread_id: "thread-1" }, { thread_id: "thread-2" }],
      next_cursor: null,
    }))
    try {
      const inbox = await client.approvalInbox()
      const url = new URL(requests[0]?.url ?? "")
      expect(url.searchParams.get("needs_approval")).toBe("true")
      expect(inbox.count).toBe(2)
    } finally {
      restore()
    }
  })

  test("retries a failed run", async () => {
    const { client, requests, restore } = recordingClient(() => ({ run_id: "run-2", status: "Queued", event_cursor: 5 }))
    try {
      const response = await client.retryRun("thread-1", "run-1")
      expect(requests[0]?.method).toBe("POST")
      expect(requests[0]?.url).toBe("http://example.test/api/webchat/v2/threads/thread-1/runs/run-1/retry")
      expect(typeof (requests[0]?.body as Record<string, unknown>).client_action_id).toBe("string")
      expect(response.run_id).toBe("run-2")
    } finally {
      restore()
    }
  })

  test("downloads attachment bytes with filename from Content-Disposition", async () => {
    const { client, restore } = recordingClient(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Content-Disposition": 'attachment; filename="pic.png"',
          },
        }),
    )
    try {
      const file = await client.attachment("thread-1", "msg-1", "att-1")
      expect(file.mime_type).toBe("image/png")
      expect(file.filename).toBe("pic.png")
      expect(Array.from(file.bytes)).toEqual([1, 2, 3])
    } finally {
      restore()
    }
  })
})

describe("WebChat v2 skills / settings / automations / outbound / logs / traces", () => {
  test("issues the skills request surface", async () => {
    const { client, requests, restore } = recordingClient((url) => {
      if (url.endsWith("/skills")) return { skills: [], count: 0, auto_activate_learned: true }
      if (url.endsWith("/skills/search")) return { catalog: [], installed: [], registry_url: "r" }
      if (url.endsWith("/skills/content")) return { name: "x", content: "c" }
      return { success: true, message: "ok" }
    })
    try {
      await client.skills()
      await client.searchSkills("deploy")
      await client.installSkill("deploy", "# deploy")
      await client.updateSkill("deploy", "# v2")
      await client.setSkillAutoActivate("deploy", true)
      await client.setAutoActivateLearned(false)
      await client.removeSkill("deploy")

      expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
        "GET /api/webchat/v2/skills",
        "POST /api/webchat/v2/skills/search",
        "POST /api/webchat/v2/skills/install",
        "PUT /api/webchat/v2/skills/deploy",
        "POST /api/webchat/v2/skills/deploy/auto-activate",
        "POST /api/webchat/v2/skills/auto-activate-learned",
        "DELETE /api/webchat/v2/skills/deploy",
      ])
      expect(requests[1]?.body).toEqual({ query: "deploy" })
      expect(requests[2]?.body).toEqual({ name: "deploy", content: "# deploy" })
      expect(requests[3]?.body).toEqual({ content: "# v2" })
      expect(requests[4]?.body).toEqual({ enabled: true })
      expect(requests[5]?.body).toEqual({ enabled: false })
    } finally {
      restore()
    }
  })

  test("sets tool permission state with the wire vocabulary", async () => {
    const { client, requests, restore } = recordingClient(() => ({ entry: { key: "tool.shell", value: null, source: "user", redacted: false, mutable: true } }))
    try {
      await client.settingsTools()
      await client.setSettingsToolsAutoApprove(true)
      await client.setSettingsToolPermission("tool.shell", "always_allow")

      expect(requests[0]?.method).toBe("GET")
      expect(requests[1]?.body).toEqual({ enabled: true })
      expect(requests[2]?.url).toBe("http://example.test/api/webchat/v2/settings/tools/tool.shell")
      expect(requests[2]?.body).toEqual({ state: "always_allow" })
    } finally {
      restore()
    }
  })

  test("mutates automations", async () => {
    const { client, requests, restore } = recordingClient(() => ({ updated: true }))
    try {
      await client.pauseAutomation("auto-1")
      await client.resumeAutomation("auto-1")
      await client.renameAutomation("auto-1", "Nightly")
      await client.deleteAutomation("auto-1")

      expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
        "POST /api/webchat/v2/automations/auto-1/pause",
        "POST /api/webchat/v2/automations/auto-1/resume",
        "POST /api/webchat/v2/automations/auto-1",
        "DELETE /api/webchat/v2/automations/auto-1",
      ])
      expect(requests[2]?.body).toEqual({ name: "Nightly" })
    } finally {
      restore()
    }
  })

  test("clears the outbound final-reply target by sending null", async () => {
    const { client, requests, restore } = recordingClient(() => ({
      final_reply_target_status: "none_configured",
      default_modality: "text",
    }))
    try {
      await client.setOutboundPreferences(null)
      await client.setOutboundPreferences("target-7")
      expect(requests[0]?.body).toEqual({ final_reply_target_id: null })
      expect(requests[1]?.body).toEqual({ final_reply_target_id: "target-7" })
    } finally {
      restore()
    }
  })

  test("passes log filters as query params", async () => {
    const { client, requests, restore } = recordingClient(() => ({
      source: "caller",
      entries: [],
      tail_supported: true,
      follow_supported: false,
    }))
    try {
      await client.logs({ limit: 50, level: "error", thread_id: "thread-1", tail: true })
      const url = new URL(requests[0]?.url ?? "")
      expect(url.pathname).toBe("/api/webchat/v2/logs")
      expect(url.searchParams.get("limit")).toBe("50")
      expect(url.searchParams.get("level")).toBe("error")
      expect(url.searchParams.get("thread_id")).toBe("thread-1")
      expect(url.searchParams.get("tail")).toBe("true")
    } finally {
      restore()
    }
  })

  test("authorizes a trace hold", async () => {
    const { client, requests, restore } = recordingClient(() => ({ authorized: true }))
    try {
      const response = await client.authorizeTraceHold("submission-1")
      expect(requests[0]?.method).toBe("POST")
      expect(requests[0]?.url).toBe("http://example.test/api/webchat/v2/traces/holds/submission-1/authorize")
      expect(response.authorized).toBe(true)
    } finally {
      restore()
    }
  })

  test("browses filesystem mounts with mount and path params", async () => {
    const { client, requests, restore } = recordingClient((url) => {
      if (url.includes("/fs/mounts")) return { mounts: [{ mount: "workspace", label: "Workspace" }] }
      return { mount: "workspace", path: "/src", entries: [] }
    })
    try {
      await client.fsMounts()
      await client.fsList("workspace", "/src", "project-1")
      const listUrl = new URL(requests[1]?.url ?? "")
      expect(listUrl.searchParams.get("mount")).toBe("workspace")
      expect(listUrl.searchParams.get("path")).toBe("/src")
      expect(listUrl.searchParams.get("project_id")).toBe("project-1")
    } finally {
      restore()
    }
  })
})

describe("Gateway error parsing", () => {
  test("parses the typed v2 error body", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: "invalid_request", kind: "validation", retryable: false, field: "content", validation_code: "missing_field" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch
    try {
      await client.session()
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError)
      const gatewayError = error as GatewayError
      expect(gatewayError.status).toBe(400)
      expect(gatewayError.errorCode).toBe("invalid_request")
      expect(gatewayError.kind).toBe("validation")
      expect(gatewayError.retryable).toBe(false)
      expect(gatewayError.field).toBe("content")
      expect(gatewayError.validationCode).toBe("missing_field")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("SSE robustness", () => {
  function sseResponse(frames: string[]): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
  }

  test("reconnects with after_cursor after a stream closes", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    const urls: string[] = []
    let call = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      call += 1
      if (call === 1) {
        return sseResponse([
          'id: 41\nevent: final_reply\ndata: {"type":"final_reply","cursor":41,"reply":{"text":"hi"}}\n\n',
        ])
      }
      return sseResponse([
        'id: 42\nevent: final_reply\ndata: {"type":"final_reply","cursor":42,"reply":{"text":"again"}}\n\n',
      ])
    }) as unknown as typeof fetch

    try {
      const events: string[] = []
      for await (const event of client.events("thread-1")) {
        if (event.type === "response") events.push(event.content)
        if (events.length >= 2) break
      }
      expect(events).toEqual(["hi", "again"])
      expect(new URL(urls[0] ?? "").searchParams.get("after_cursor")).toBeNull()
      expect(new URL(urls[1] ?? "").searchParams.get("after_cursor")).toBe("41")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("surfaces a non-retryable error frame then throws to stop the consumer", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      sseResponse([
        'event: error\ndata: {"error":"replay unavailable","kind":"replay_unavailable","retryable":false}\n\n',
      ])) as unknown as typeof fetch

    try {
      const events = []
      let thrown: unknown
      try {
        for await (const event of client.events("thread-1")) {
          events.push(event)
        }
      } catch (error) {
        thrown = error
      }
      // The error AppEvent is still surfaced so the UI can show it...
      expect(events.at(-1)).toEqual({ type: "error", message: "stream error: replay unavailable", thread_id: "thread-1" })
      // ...but the generator then throws so the consumer's catch/backoff runs
      // instead of the outer loop re-invoking events() with zero delay.
      expect(thrown).toBeInstanceOf(SseTerminalError)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("yields an error then throws SseTerminalError on a non-retryable HTTP status", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(JSON.stringify({ error: "unauthorized", kind: "auth", retryable: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      const events = []
      let thrown: unknown
      try {
        for await (const event of client.events("thread-1")) {
          events.push(event)
        }
      } catch (error) {
        thrown = error
      }
      expect(events).toEqual([{ type: "error", message: "SSE failed: HTTP 401 unauthorized", thread_id: "thread-1" }])
      expect(thrown).toBeInstanceOf(SseTerminalError)
      // A persistent 401 must not spin the loop: exactly one request per invocation.
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("releasing the generator cancels the underlying stream reader", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    const encoder = new TextEncoder()
    let readerCancelled = false
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('id: 1\nevent: final_reply\ndata: {"type":"final_reply","cursor":1,"reply":{"text":"hi"}}\n\n'),
          )
          // Intentionally left open so the reader is still active when we break.
        },
        cancel() {
          readerCancelled = true
        },
      })
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }) as unknown as typeof fetch

    try {
      for await (const event of client.events("thread-1", undefined, new AbortController().signal)) {
        if (event.type === "response") break
      }
      // Breaking the for-await drives the generator's .return(), whose finally
      // cancels the reader and closes the connection.
      expect(readerCancelled).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("aborting the signal stops the generator without reconnecting", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    const controller = new AbortController()
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(JSON.stringify({ error: "unavailable", kind: "service_unavailable", retryable: true }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      const gen = client.events("thread-1", undefined, controller.signal)
      const first = await gen.next()
      expect(first.value?.type).toBe("warning")
      controller.abort()
      const second = await gen.next()
      expect(second.done).toBe(true)
      // Aborting before the reconnect fires means no second fetch.
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("backs off and reconnects on a retryable 429", async () => {
    const client = new GatewayClient({ baseUrl: "http://example.test", token: "token" } as never)
    const originalFetch = globalThis.fetch
    let call = 0
    globalThis.fetch = (async () => {
      call += 1
      if (call === 1) {
        return new Response(JSON.stringify({ error: "rate_limited", kind: "busy", retryable: true }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        })
      }
      return sseResponse(['id: 1\nevent: final_reply\ndata: {"type":"final_reply","cursor":1,"reply":{"text":"ok"}}\n\n'])
    }) as unknown as typeof fetch

    try {
      const events: string[] = []
      for await (const event of client.events("thread-1")) {
        if (event.type === "response") {
          events.push(event.content)
          break
        }
      }
      expect(call).toBeGreaterThanOrEqual(2)
      expect(events).toEqual(["ok"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("SSE reconnect backoff", () => {
  test("stays within jittered bounds and never drops below the reconnect floor", () => {
    let current = SSE_MIN_RECONNECT_MS
    for (let i = 0; i < 200; i += 1) {
      const next = nextBackoff(current)
      const target = Math.min(Math.max(current, SSE_MIN_RECONNECT_MS) * 2, SSE_MAX_BACKOFF_MS)
      expect(next).toBeGreaterThanOrEqual(target / 2)
      expect(next).toBeLessThanOrEqual(target)
      expect(next).toBeGreaterThanOrEqual(SSE_MIN_RECONNECT_MS)
      expect(next).toBeLessThanOrEqual(SSE_MAX_BACKOFF_MS)
      current = next
    }
  })

  test("escalates and caps at the maximum backoff", () => {
    let current = SSE_MIN_RECONNECT_MS
    for (let i = 0; i < 100; i += 1) current = nextBackoff(current)
    expect(current).toBeGreaterThanOrEqual(SSE_MAX_BACKOFF_MS / 2)
    expect(current).toBeLessThanOrEqual(SSE_MAX_BACKOFF_MS)
  })

  test("applies jitter so retries do not synchronize", () => {
    const values = new Set<number>()
    for (let i = 0; i < 25; i += 1) values.add(nextBackoff(SSE_MIN_RECONNECT_MS))
    expect(values.size).toBeGreaterThan(1)
  })
})

describe("submit turn outcome folding", () => {
  test("folds an unknown outcome into a safe busy notice, mapping active_run_id", async () => {
    const { client, restore } = recordingClient(() => ({
      outcome: "deferred_busy",
      thread_id: "thread-1",
      accepted_message_ref: "msg-1",
      active_run_id: "run-7",
      notice: "Deferred while another run finishes.",
    }))
    try {
      const response = await client.send("hi", "thread-1")
      expect(response.outcome).toBe("rejected_busy")
      expect(response.run_id).toBe("run-7")
      expect(response.status).toBe("deferred_busy")
      expect(response.notice).toBe("Deferred while another run finishes.")
      expect(response.message_id).toBe("msg-1")
    } finally {
      restore()
    }
  })

  test("never emits an undefined run_id for an unknown outcome without a run", async () => {
    const { client, restore } = recordingClient(() => ({
      outcome: "queued_elsewhere",
      thread_id: "thread-1",
      accepted_message_ref: "msg-2",
    }))
    try {
      const response = await client.send("hi", "thread-1")
      expect(response.run_id).toBeNull()
      expect(response.run_id).not.toBeUndefined()
      expect(response.outcome).toBe("rejected_busy")
      expect(response.status).toBe("queued_elsewhere")
      expect(response.notice).toBeNull()
    } finally {
      restore()
    }
  })
})

describe("binary content decoding parity", () => {
  test("decodes thread file and fs content identically to attachment bytes", async () => {
    const { client, requests, restore } = recordingClient(
      () =>
        new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
            "Content-Disposition": 'attachment; filename="notes.txt"',
          },
        }),
    )
    try {
      const threadFile = await client.threadFileContent("thread-1", "/notes.txt")
      const fsFile = await client.fsContent("workspace", "/notes.txt", "project-1")
      for (const file of [threadFile, fsFile]) {
        expect(file.mime_type).toBe("text/plain")
        expect(file.filename).toBe("notes.txt")
        expect(Array.from(file.bytes)).toEqual([9, 8, 7])
      }
      expect(requests.map((r) => r.method)).toEqual(["GET", "GET"])
    } finally {
      restore()
    }
  })

  test("falls back to octet-stream when Content-Type is absent", async () => {
    const { client, restore } = recordingClient(
      () => new Response(new Uint8Array([1]), { status: 200 }),
    )
    try {
      const file = await client.fsContent("workspace", "/blob.bin")
      expect(file.mime_type).toBe("application/octet-stream")
      expect(file.filename).toBeNull()
      expect(Array.from(file.bytes)).toEqual([1])
    } finally {
      restore()
    }
  })
})

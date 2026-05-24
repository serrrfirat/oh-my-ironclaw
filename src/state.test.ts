import { describe, expect, test } from "bun:test"
import { initialUiState, reduceUiState } from "./state"

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
})

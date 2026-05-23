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

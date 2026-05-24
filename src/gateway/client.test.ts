import { describe, expect, test } from "bun:test"
import { mapWebChatEvent } from "./client"

describe("WebChat event mapping", () => {
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
})

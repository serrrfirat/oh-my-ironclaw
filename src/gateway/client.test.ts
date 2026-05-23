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
})

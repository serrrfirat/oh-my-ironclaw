import { describe, expect, test } from "bun:test"
import { filterThreads, threadDisplayTitle, threadPreviewFromHistory } from "./threadPreviews"

describe("thread previews", () => {
  test("uses the first timeline sentence as a thread preview", () => {
    expect(threadPreviewFromHistory({
      thread_id: "thread-1",
      has_more: false,
      turns: [],
      messages: [{
        kind: "user",
        id: "message-1",
        thread_id: "thread-1",
        sequence: 1,
        status: "completed",
        content: "Explain this codebase. Then list the risks.",
      }],
    })).toBe("Explain this codebase.")
  })

  test("does not display raw thread ids as titles", () => {
    expect(threadDisplayTitle({
      id: "thread-1",
      state: "active",
      turn_count: 0,
      created_at: "",
      updated_at: "",
      title: "thread-1",
    }, {})).toBe("New session")
  })

  test("filters threads by cached preview", () => {
    const threads = [
      { id: "thread-1", state: "active", turn_count: 0, created_at: "", updated_at: "", title: null },
      { id: "thread-2", state: "active", turn_count: 0, created_at: "", updated_at: "", title: null },
    ]

    expect(filterThreads(threads, "billing", { "thread-2": "Debug billing trace" }).map((thread) => thread.id)).toEqual(["thread-2"])
  })
})

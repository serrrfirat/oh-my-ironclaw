import { describe, expect, test } from "bun:test"
import type { TranscriptActivity, TranscriptItem } from "../transcript"
import { groupTranscriptEntries } from "./activityGroups"
import { copyTextForItem, moveSelection, searchTranscript, selectableTranscriptIds } from "./transcriptNav"

function text(id: string, role: "user" | "assistant" | "system", body: string): TranscriptItem {
  return { id, role, text: body }
}

function activity(id: string, over: Partial<TranscriptActivity> = {}): TranscriptItem {
  return {
    id,
    role: "activity",
    activity: {
      kind: "capability_display_preview",
      title: "read",
      status: "completed",
      ...over,
    },
  }
}

describe("selectableTranscriptIds", () => {
  test("flattens items and activity-group members in transcript order", () => {
    const transcript: TranscriptItem[] = [
      text("u1", "user", "hello"),
      activity("t1"),
      activity("t2"),
      text("a1", "assistant", "hi"),
    ]
    const entries = groupTranscriptEntries(transcript)
    // The two consecutive activities collapse into one activity_group entry...
    expect(entries.map((e) => e.kind)).toEqual(["item", "activity_group", "item"])
    // ...but every activity is still individually selectable.
    expect(selectableTranscriptIds(entries)).toEqual(["u1", "t1", "t2", "a1"])
  })

  test("empty transcript yields no selectable ids", () => {
    expect(selectableTranscriptIds([])).toEqual([])
  })
})

describe("moveSelection", () => {
  const ids = ["a", "b", "c"]

  test("moves down and up within bounds", () => {
    expect(moveSelection(ids, "a", 1)).toBe("b")
    expect(moveSelection(ids, "b", -1)).toBe("a")
  })

  test("clamps at the ends without wrapping", () => {
    expect(moveSelection(ids, "a", -1)).toBe("a")
    expect(moveSelection(ids, "c", 1)).toBe("c")
    expect(moveSelection(ids, "a", 5)).toBe("c")
  })

  test("with no current selection, negative delta lands on the last, positive on the first", () => {
    expect(moveSelection(ids, null, -1)).toBe("c")
    expect(moveSelection(ids, null, 1)).toBe("a")
  })

  test("unknown current id falls back like no selection", () => {
    expect(moveSelection(ids, "zzz", -1)).toBe("c")
  })

  test("empty id list returns null", () => {
    expect(moveSelection([], null, -1)).toBeNull()
  })
})

describe("searchTranscript", () => {
  const transcript: TranscriptItem[] = [
    text("u1", "user", "Deploy the API service"),
    text("a1", "assistant", "Done deploying."),
    activity("t1", { title: "grep", inputSummary: "pattern: Deploy" }),
    activity("t2", { title: "read", detail: "src/index.ts" }),
  ]

  test("empty query matches nothing", () => {
    expect(searchTranscript(transcript, "")).toEqual([])
  })

  test("is case-insensitive and ordered", () => {
    expect(searchTranscript(transcript, "deploy")).toEqual(["u1", "a1", "t1"])
  })

  test("matches tool titles and output", () => {
    expect(searchTranscript(transcript, "index.ts")).toEqual(["t2"])
    expect(searchTranscript(transcript, "grep")).toEqual(["t1"])
  })

  test("no match yields empty", () => {
    expect(searchTranscript(transcript, "nonexistent-token")).toEqual([])
  })
})

describe("copyTextForItem", () => {
  test("returns message text for text roles", () => {
    expect(copyTextForItem(text("u1", "user", "copy me"))).toBe("copy me")
  })

  test("returns rendered activity text when no detail lines are given", () => {
    const item = activity("t1", { title: "read", detail: "src/index.ts" })
    expect(copyTextForItem(item)).toBe(copyTextForItem(item))
    expect(copyTextForItem(item)).toContain("read")
  })

  test("prefers explicit detail lines for an activity", () => {
    const item = activity("t1", { title: "command" })
    expect(copyTextForItem(item, ["$ ls", "output: file.txt"])).toBe("$ ls\noutput: file.txt")
  })

  test("ignores empty detail lines and falls back to activity text", () => {
    const item = activity("t1", { title: "read" })
    expect(copyTextForItem(item, [])).toBe(copyTextForItem(item))
  })
})

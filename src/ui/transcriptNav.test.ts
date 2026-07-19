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

// The id groupTranscriptEntries assigns an activity_group is derived from its
// members' ids, so the tests reference it via the produced entry rather than
// hard-coding the format.
function groupIdOf(entries: ReturnType<typeof groupTranscriptEntries>): string {
  const group = entries.find((entry) => entry.kind === "activity_group")
  if (!group || group.kind !== "activity_group") throw new Error("expected an activity_group entry")
  return group.id
}

describe("selectableTranscriptIds", () => {
  test("flattens items and expanded activity-group members in transcript order", () => {
    const transcript: TranscriptItem[] = [
      text("u1", "user", "hello"),
      activity("t1"),
      activity("t2"),
      text("a1", "assistant", "hi"),
    ]
    const entries = groupTranscriptEntries(transcript)
    // The two consecutive activities collapse into one activity_group entry...
    expect(entries.map((e) => e.kind)).toEqual(["item", "activity_group", "item"])
    // ...and while the group is expanded, every activity is individually selectable.
    expect(selectableTranscriptIds(entries)).toEqual(["u1", "t1", "t2", "a1"])
  })

  test("a collapsed group is represented by its group id, not its unmounted members", () => {
    const transcript: TranscriptItem[] = [
      text("u1", "user", "hello"),
      activity("t1"),
      activity("t2"),
      text("a1", "assistant", "hi"),
    ]
    const entries = groupTranscriptEntries(transcript)
    const groupId = groupIdOf(entries)
    // With the group collapsed, its inner activities are not rendered, so the
    // selectable anchor is the group id in their place.
    expect(selectableTranscriptIds(entries, new Set([groupId]))).toEqual(["u1", groupId, "a1"])
  })

  test("an unrelated collapsed id does not affect the group", () => {
    const entries = groupTranscriptEntries([activity("t1"), activity("t2")])
    // Only the group's own id collapses it; a stray id leaves members selectable.
    expect(selectableTranscriptIds(entries, new Set(["not-a-group"]))).toEqual(["t1", "t2"])
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
  const entries = groupTranscriptEntries(transcript)

  test("empty query matches nothing", () => {
    expect(searchTranscript(entries, "")).toEqual([])
  })

  test("is case-insensitive and ordered", () => {
    expect(searchTranscript(entries, "deploy")).toEqual(["u1", "a1", "t1"])
  })

  test("matches tool titles and output", () => {
    expect(searchTranscript(entries, "index.ts")).toEqual(["t2"])
    expect(searchTranscript(entries, "grep")).toEqual(["t1"])
  })

  test("no match yields empty", () => {
    expect(searchTranscript(entries, "nonexistent-token")).toEqual([])
  })

  test("matches inside a collapsed group map to the group id, deduped", () => {
    const groupId = groupIdOf(entries)
    const collapsed = new Set([groupId])
    // Both t1 (pattern: Deploy) and the group's members would otherwise match
    // separately; collapsed, the whole group contributes a single group-id match.
    expect(searchTranscript(entries, "deploy", collapsed)).toEqual(["u1", "a1", groupId])
    // A match that only exists on an unmounted member still surfaces via the group.
    expect(searchTranscript(entries, "index.ts", collapsed)).toEqual([groupId])
  })

  test("a collapsed group with no matching member contributes nothing", () => {
    const groupId = groupIdOf(entries)
    expect(searchTranscript(entries, "API", new Set([groupId]))).toEqual(["u1"])
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

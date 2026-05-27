import { describe, expect, test } from "bun:test"
import type { TranscriptItem } from "../transcript"
import { activityGroupSummary, groupTranscriptEntries } from "./activityGroups"

describe("activity groups", () => {
  test("groups consecutive activity transcript items", () => {
    const transcript: TranscriptItem[] = [
      { id: "assistant-1", role: "assistant", text: "before" },
      activity("tool-1", "write_file"),
      activity("tool-2", "glob"),
      { id: "assistant-2", role: "assistant", text: "after" },
      activity("tool-3", "shell"),
    ]

    expect(groupTranscriptEntries(transcript).map((entry) => entry.kind)).toEqual([
      "item",
      "activity_group",
      "item",
      "activity_group",
    ])
  })

  test("summarizes activity groups by tool category", () => {
    expect(activityGroupSummary([
      activity("tool-1", "write_file"),
      activity("tool-2", "read_file"),
      activity("tool-3", "glob"),
      activity("tool-4", "grep"),
      activity("tool-5", "shell"),
      activity("tool-6", "Failed shell"),
    ])).toBe("Edited 1 file, explored 1 file, 2 searches, ran 2 commands")
  })
})

function activity(id: string, title: string): Extract<TranscriptItem, { role: "activity" }> {
  return {
    id,
    role: "activity",
    activity: {
      kind: "capability_display_preview",
      title,
      status: title.startsWith("Failed") ? "failed" : "completed",
    },
  }
}

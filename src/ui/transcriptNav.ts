import { transcriptActivityText, type TranscriptItem } from "../transcript"
import type { TranscriptRenderEntry } from "./activityGroups"

// Pure, rendering-agnostic helpers backing transcript navigation, per-message
// actions, and in-thread search. Kept free of React/opentui so they can be
// unit-tested in isolation (see transcriptNav.test.ts).

// Ordered list of the transcript ids that navigation can land on. Activity
// groups are transparent — each activity inside a group is individually
// selectable — so the returned order matches the flat transcript order.
export function selectableTranscriptIds(entries: TranscriptRenderEntry[]): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.kind === "activity_group") {
      for (const item of entry.items) ids.push(item.id)
    } else {
      ids.push(entry.item.id)
    }
  }
  return ids
}

// Move the selection by `delta` messages, clamped to the ends (no wrapping past
// the first/last message). With no current selection, a negative delta lands on
// the last message (entering nav from the composer via up), a positive delta on
// the first.
export function moveSelection(ids: string[], currentId: string | null, delta: number): string | null {
  if (ids.length === 0) return null
  const index = currentId ? ids.indexOf(currentId) : -1
  if (index < 0) return delta < 0 ? (ids[ids.length - 1] ?? null) : (ids[0] ?? null)
  const next = Math.min(ids.length - 1, Math.max(0, index + delta))
  return ids[next] ?? null
}

// Case-insensitive substring search over rendered message text + tool
// titles/output, returning the matching ids in transcript order. An empty query
// matches nothing (returns []).
export function searchTranscript(items: TranscriptItem[], query: string): string[] {
  if (query.length === 0) return []
  const needle = query.toLowerCase()
  const matches: string[] = []
  for (const item of items) {
    if (transcriptSearchText(item).toLowerCase().includes(needle)) matches.push(item.id)
  }
  return matches
}

// The string a message contributes to search (and the haystack the highlight
// uses): a text message's text, or an activity card's full rendered tool lines.
export function transcriptSearchText(item: TranscriptItem): string {
  if (item.role === "activity") return transcriptActivityText(item.activity)
  return item.text
}

// The text to copy for a selected transcript item: a text message's text, or a
// tool/activity card's output. `detailLines` lets the caller pass the exact
// rendered lines (command + output) so the copy matches what's on screen; when
// omitted it falls back to the activity's full text.
export function copyTextForItem(item: TranscriptItem, detailLines?: string[]): string {
  if (item.role === "activity") {
    if (detailLines && detailLines.length > 0) return detailLines.join("\n")
    return transcriptActivityText(item.activity)
  }
  return item.text
}

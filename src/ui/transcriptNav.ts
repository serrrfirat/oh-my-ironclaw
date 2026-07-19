import { transcriptActivityText, type TranscriptItem } from "../transcript"
import type { TranscriptRenderEntry } from "./activityGroups"

// Pure, rendering-agnostic helpers backing transcript navigation, per-message
// actions, and in-thread search. Kept free of React/opentui so they can be
// unit-tested in isolation (see transcriptNav.test.ts).

const NO_COLLAPSED_GROUPS: ReadonlySet<string> = new Set()

// Ordered list of the transcript ids that navigation can land on. Selection may
// only target *rendered* anchors: an expanded activity group is transparent (each
// activity inside it is individually selectable), but a COLLAPSED group renders
// only its summary line — its inner activities are unmounted, so the group is
// represented by its group id instead (selecting it, and `enter`-expanding it,
// operate on the visible summary rather than a hidden child). `collapsedGroupIds`
// is the set of activity-group ids currently collapsed.
export function selectableTranscriptIds(
  entries: TranscriptRenderEntry[],
  collapsedGroupIds: ReadonlySet<string> = NO_COLLAPSED_GROUPS,
): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.kind === "activity_group") {
      if (collapsedGroupIds.has(entry.id)) ids.push(entry.id)
      else for (const item of entry.items) ids.push(item.id)
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
// titles/output, returning the matching *rendered-anchor* ids in transcript
// order. An empty query matches nothing (returns []). Matches inside a COLLAPSED
// activity group map to that group's id (its inner activities are unmounted), so
// jumps and highlights only ever target a mounted anchor; a group contributes at
// most one match. `collapsedGroupIds` is the set of collapsed activity-group ids.
export function searchTranscript(
  entries: TranscriptRenderEntry[],
  query: string,
  collapsedGroupIds: ReadonlySet<string> = NO_COLLAPSED_GROUPS,
): string[] {
  if (query.length === 0) return []
  const needle = query.toLowerCase()
  const matches: string[] = []
  const hit = (item: TranscriptItem) => transcriptSearchText(item).toLowerCase().includes(needle)
  for (const entry of entries) {
    if (entry.kind === "activity_group") {
      if (collapsedGroupIds.has(entry.id)) {
        if (entry.items.some(hit)) matches.push(entry.id)
      } else {
        for (const item of entry.items) if (hit(item)) matches.push(item.id)
      }
    } else if (hit(entry.item)) {
      matches.push(entry.item.id)
    }
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

import type { TranscriptItem } from "../transcript"

export type TranscriptRenderEntry =
  | { kind: "item"; item: TranscriptItem }
  | { kind: "activity_group"; id: string; items: Array<Extract<TranscriptItem, { role: "activity" }>> }

export function groupTranscriptEntries(items: TranscriptItem[]): TranscriptRenderEntry[] {
  const entries: TranscriptRenderEntry[] = []
  let group: Array<Extract<TranscriptItem, { role: "activity" }>> = []

  const flushGroup = () => {
    if (group.length === 0) return
    entries.push({
      kind: "activity_group",
      id: `activity-group:${group.map((item) => item.id).join(":")}`,
      items: group,
    })
    group = []
  }

  for (const item of items) {
    if (item.role === "activity") {
      group.push(item)
      continue
    }
    flushGroup()
    entries.push({ kind: "item", item })
  }

  flushGroup()
  return entries
}

export function activityGroupSummary(items: Array<Extract<TranscriptItem, { role: "activity" }>>): string {
  const counts = {
    edited: 0,
    explored: 0,
    searched: 0,
    ran: 0,
    used: 0,
  }

  for (const item of items) {
    switch (activityKind(item.activity.title)) {
      case "edited":
        counts.edited += 1
        break
      case "explored":
        counts.explored += 1
        break
      case "searched":
        counts.searched += 1
        break
      case "ran":
        counts.ran += 1
        break
      case "used":
        counts.used += 1
        break
    }
  }

  const parts = [
    counts.edited ? `Edited ${counts.edited} ${plural("file", counts.edited)}` : null,
    counts.explored ? `explored ${counts.explored} ${plural("file", counts.explored)}` : null,
    counts.searched ? `${counts.searched} ${plural("search", counts.searched, "searches")}` : null,
    counts.ran ? `ran ${counts.ran} ${plural("command", counts.ran)}` : null,
    counts.used ? `used ${counts.used} ${plural("tool", counts.used)}` : null,
  ].filter(Boolean)

  return parts.join(", ") || `Used ${items.length} ${plural("tool", items.length)}`
}

function activityKind(title: string): "edited" | "explored" | "searched" | "ran" | "used" {
  const normalized = title
    .toLowerCase()
    .replace(/^(using|failed|killed)\s+/, "")
    .replace(/[^a-z0-9_ -]/g, "")

  if (/\b(write_file|edit|apply_patch|patch)\b/.test(normalized)) return "edited"
  if (/\b(grep|glob|search|find)\b/.test(normalized)) return "searched"
  if (/\b(shell|exec|command|bash|zsh)\b/.test(normalized)) return "ran"
  if (/\b(read_file|list_dir|ls|cat)\b/.test(normalized)) return "explored"
  return "used"
}

function plural(singular: string, count: number, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm
}

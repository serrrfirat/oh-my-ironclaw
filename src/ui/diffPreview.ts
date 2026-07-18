import { theme } from "./theme"

export function isUnifiedDiffKind(kind?: string | null): boolean {
  return kind === "unified_diff"
}

export function diffPreviewLineColor(line: string, failed = false): string {
  if (failed) return theme.danger
  // Hunk headers get a distinct accent so the reader can find each hunk.
  if (line.startsWith("@@")) return theme.accentText
  // File/git headers are structural chrome, dimmed below the content. The +++/---
  // file markers are headers (not add/remove content), so they share this tone.
  if (line.startsWith("diff --git") || line.startsWith("index ")) return theme.textFaint
  if (line.startsWith("+++") || line.startsWith("---")) return theme.textFaint
  if (line.startsWith("+")) return theme.ok
  if (line.startsWith("-")) return theme.danger
  // Context lines sit between the faint headers and the bright edits.
  return theme.textMuted
}

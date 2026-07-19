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

// Line-background tint for a diff line, layered under diffPreviewLineColor so
// tool-output diffs read like the assistant <diff> renderer (added lines on a
// soft-green fill, removed lines on a soft-red fill). Headers and context lines
// stay untinted. A failed tool already renders every line in the danger tone,
// so we skip the per-line fill there to avoid a wall of red.
export function diffPreviewLineBg(line: string, failed = false): string | undefined {
  if (failed) return undefined
  // +++/--- file markers are headers, not add/remove content — leave untinted.
  if (line.startsWith("+++") || line.startsWith("---")) return undefined
  if (line.startsWith("+")) return theme.okSoftBg
  if (line.startsWith("-")) return theme.dangerSoftBg
  return undefined
}

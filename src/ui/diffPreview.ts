import { theme } from "./theme"

export function isUnifiedDiffKind(kind?: string | null): boolean {
  return kind === "unified_diff"
}

export function diffPreviewLineColor(line: string, failed = false): string {
  if (failed) return theme.danger
  if (line.startsWith("@@")) return theme.textMuted
  if (line.startsWith("diff --git") || line.startsWith("index ")) return theme.textMuted
  if (line.startsWith("+++")) return theme.ok
  if (line.startsWith("---")) return theme.danger
  if (line.startsWith("+")) return theme.ok
  if (line.startsWith("-")) return theme.danger
  return theme.textMuted
}

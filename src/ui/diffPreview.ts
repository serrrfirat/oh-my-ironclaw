export function isUnifiedDiffKind(kind?: string | null): boolean {
  return kind === "unified_diff"
}

export function diffPreviewLineColor(line: string, failed = false): string {
  if (failed) return "#f08a8a"
  if (line.startsWith("@@")) return "#8fc8f2"
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "#8a8a8a"
  if (line.startsWith("+++")) return "#8cffb0"
  if (line.startsWith("---")) return "#ff9b9b"
  if (line.startsWith("+")) return "#8cffb0"
  if (line.startsWith("-")) return "#ff9b9b"
  return "#d8cfaa"
}

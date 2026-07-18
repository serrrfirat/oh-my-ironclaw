import { SyntaxStyle } from "@opentui/core"
import { transcriptActivityLines, type TranscriptItem } from "../transcript"
import { diffPreviewLineColor, isUnifiedDiffKind } from "./diffPreview"
import { theme } from "./theme"

const ACTIVITY_DETAIL_LINE_LIMIT = 48

export function TranscriptMessage({
  item,
  expanded,
  markdownStyle,
  selectedModel,
  spinner,
  width,
  onToggleActivityExpanded,
}: {
  item: TranscriptItem
  expanded: boolean
  markdownStyle: SyntaxStyle
  selectedModel: string
  spinner: string
  width: number
  onToggleActivityExpanded: (id: string) => void
}) {
  if (item.role === "user") {
    return (
      <box style={{ width, flexDirection: "row", backgroundColor: theme.bgSoft, marginBottom: 2 }}>
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 3, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
          <markdown content={item.text || " "} syntaxStyle={markdownStyle} />
        </box>
      </box>
    )
  }

  if (item.role === "assistant") {
    return (
      <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
        <markdown content={item.text || " "} syntaxStyle={markdownStyle} />
        <BuildLine durationMs={item.meta?.durationMs} selectedModel={selectedModel} />
      </box>
    )
  }

  if (item.role === "thinking") {
    const lines = item.text.split(/\r?\n/).filter(Boolean)
    const [firstLine, ...rest] = lines.length > 0 ? lines : ["thinking"]
    return (
      <box style={{ width, flexDirection: "row", marginBottom: 1 }}>
        <box style={{ width: 1, backgroundColor: theme.border }} />
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2 }}>
          <box style={{ height: 1, flexDirection: "row" }}>
            <text fg={theme.textMuted}>{spinner}</text>
            <text fg={theme.textMuted}> {truncate(firstLine, Math.max(1, width - 7))}</text>
          </box>
          {activityDetailLines(rest).map((line, index) => (
            <text key={`${item.id}-thinking-${index}`} fg={theme.textFaint}>
              {truncate(line || " ", Math.max(1, width - 5))}
            </text>
          ))}
        </box>
      </box>
    )
  }

  if (item.role === "activity") {
    const lines = transcriptActivityLines(item.activity)
    const [headline, ...detail] = lines
    const status = item.activity.status
    const failed = status === "failed" || status === "killed"
    const running = status === "started" || status === "running"
    const activityColor = failed ? theme.danger : running ? theme.textMuted : theme.text
    const title = activityTitle(headline)
    const icon = running ? spinner : failed ? "!" : "✓"
    const unifiedDiff = isUnifiedDiffKind(item.activity.outputKind)
    const detailLines = expanded ? activityDetailLines(detail) : []
    const summary = collapsedActivitySummary(detail)
    const hint = expanded ? "click to collapse" : "click to expand"
    return (
      // Glass: tool output sits in a rounded card (card-bg fill + card frame).
      // Border (1/side) + inner padding (2 left / 1 right) preserves the former
      // 3-left / 2-right content inset, so the truncation budgets below still hold.
      <box
        onMouseDown={() => onToggleActivityExpanded(item.id)}
        style={{ width, flexDirection: "row", backgroundColor: theme.cardBg, border: true, borderStyle: "rounded", borderColor: theme.cardBorder, marginBottom: 1 }}
      >
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 1 }}>
          <box style={{ height: 1, flexDirection: "row" }}>
            <text fg={theme.textFaint}>{expanded ? "▾ " : "▸ "}</text>
            <text fg={activityColor}>{icon}</text>
            <text fg={activityColor}> {truncate(title || "tool", Math.max(1, width - 10))}</text>
          </box>
          <text fg={failed ? theme.danger : theme.textFaint}>
            {truncate(`${hint}${summary ? ` · ${summary}` : ""}`, Math.max(1, width - 5))}
          </text>
          {detailLines.map((line, index) => (
            <ActivityDetailLine
              key={`${item.id}-detail-${index}`}
              failed={failed}
              line={line}
              unifiedDiff={unifiedDiff}
              width={width}
            />
          ))}
        </box>
      </box>
    )
  }

  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <text fg={theme.warn}>{item.text || " "}</text>
    </box>
  )
}

function ActivityDetailLine({ failed, line, unifiedDiff, width }: { failed: boolean; line: string; unifiedDiff?: boolean; width: number }) {
  const max = Math.max(1, width - 5)
  if (line.startsWith("input: ")) {
    return (
      <text fg={failed ? theme.danger : theme.text}>
        {truncate(line, max)}
      </text>
    )
  }
  if (line.startsWith("output: ")) {
    return (
      <text fg={failed ? theme.danger : theme.textMuted}>
        {truncate(line, max)}
      </text>
    )
  }
  if (line === "truncated") {
    return <text fg={theme.textMuted}>{truncate("... truncated", max)}</text>
  }
  if (unifiedDiff) {
    return (
      <text fg={diffPreviewLineColor(line, failed)}>
        {truncate(line || " ", max)}
      </text>
    )
  }
  return (
    <text fg={failed ? theme.danger : theme.text}>
      {truncate(line || " ", max)}
    </text>
  )
}

function BuildLine({ durationMs, selectedModel }: { durationMs?: number; selectedModel: string }) {
  return (
    <box style={{ height: 1, flexDirection: "row", marginTop: 1 }}>
      <text fg={theme.accent}>▣</text>
      <text fg={theme.accent}> Build</text>
      <text fg={theme.textMuted}> · </text>
      <text fg={theme.text}>{selectedModel}</text>
      {typeof durationMs === "number" ? <text fg={theme.textMuted}> · {formatDuration(durationMs)}</text> : null}
    </box>
  )
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

function activityDetailLines(lines: string[]): string[] {
  if (lines.length <= ACTIVITY_DETAIL_LINE_LIMIT) return lines
  return [...lines.slice(0, ACTIVITY_DETAIL_LINE_LIMIT - 1), "..."]
}

function activityTitle(headline: string): string {
  return headline.replace(/^[!✓·∙✕]\s+/, "").trim()
}

function collapsedActivitySummary(lines: string[]): string | null {
  const output = lines.find((line) => line.startsWith("output: "))
  if (output) return output.slice("output: ".length)
  const firstVisible = lines.find((line) => line && !line.startsWith("result: ") && !line.startsWith("input: "))
  return firstVisible ?? null
}

import { SyntaxStyle } from "@opentui/core"
import { transcriptActivityLines, type TranscriptItem } from "../transcript"

const ACTIVITY_DETAIL_LINE_LIMIT = 14

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
      <box style={{ width, flexDirection: "row", backgroundColor: "#141414", marginBottom: 2 }}>
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
        <box style={{ width: 1, backgroundColor: "#3a3a3a" }} />
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2 }}>
          <box style={{ height: 1, flexDirection: "row" }}>
            <text fg="#777777">{spinner}</text>
            <text fg="#8a8a8a"> {truncate(firstLine, Math.max(1, width - 7))}</text>
          </box>
          {activityDetailLines(rest).map((line, index) => (
            <text key={`${item.id}-thinking-${index}`} fg="#686868">
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
    const activityColor = failed ? "#ff6b6b" : running ? "#a8a8a8" : "#d0d0d0"
    const title = activityTitle(headline)
    const icon = running ? spinner : failed ? "!" : "✓"
    const detailLines = expanded ? activityDetailLines(detail) : []
    const summary = collapsedActivitySummary(detail)
    const hint = expanded ? "click to collapse" : "click to expand"
    return (
      <box
        onMouseDown={() => onToggleActivityExpanded(item.id)}
        style={{ width, flexDirection: "row", backgroundColor: "#0d0d0d", marginBottom: 1 }}
      >
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 3, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
          <box style={{ height: 1, flexDirection: "row" }}>
            <text fg="#555555">{expanded ? "▾ " : "▸ "}</text>
            <text fg={activityColor}>{icon}</text>
            <text fg={activityColor}> {truncate(title || "tool", Math.max(1, width - 10))}</text>
          </box>
          <text fg={failed ? "#f08a8a" : "#686868"}>
            {truncate(`${hint}${summary ? ` · ${summary}` : ""}`, Math.max(1, width - 5))}
          </text>
          {detailLines.map((line, index) => (
            <text key={`${item.id}-detail-${index}`} fg={failed ? "#f08a8a" : "#8a8a8a"}>
              {truncate(line || " ", Math.max(1, width - 5))}
            </text>
          ))}
        </box>
      </box>
    )
  }

  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <text fg="#d29922">{item.text || " "}</text>
    </box>
  )
}

function BuildLine({ durationMs, selectedModel }: { durationMs?: number; selectedModel: string }) {
  return (
    <box style={{ height: 1, flexDirection: "row", marginTop: 1 }}>
      <text fg="#2ee66b">▣</text>
      <text fg="#2ee66b"> Build</text>
      <text fg="#777777"> · </text>
      <text fg="#d0d0d0">{selectedModel}</text>
      {typeof durationMs === "number" ? <text fg="#777777"> · {formatDuration(durationMs)}</text> : null}
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

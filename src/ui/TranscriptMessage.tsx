import { SyntaxStyle } from "@opentui/core"
import { transcriptActivityLines, type TranscriptItem } from "../transcript"
import { markdownRenderNodeFor, type MarkdownRenderNode } from "./codeWell"
import { diffPreviewLineBg, diffPreviewLineColor, isUnifiedDiffKind } from "./diffPreview"
import { theme } from "./theme"

// Glass-tinted, borderless aligned columns for markdown tables. Shared by both
// the user and assistant <markdown> renderers.
const MARKDOWN_TABLE_OPTIONS = { style: "columns", borderColor: theme.border } as const

const ACTIVITY_DETAIL_LINE_LIMIT = 48

// Anchor id given to a message's outermost box so the scrollbox can bring a
// selected / search-matched message into view (scrollChildIntoView).
export function transcriptMessageAnchorId(id: string): string {
  return `msg:${id}`
}

// Glass highlight for a navigated / searched message. The current selection (nav
// cursor or the active search match) reads as an accent-tinted fill + accent
// edge — the same "selected row" language as ListRow, and distinct from both a
// normal row and the composer's accent-bordered well. Other search matches wear
// the warn tone so they stand out as "found" without competing with the cursor.
type MessageHighlight = { bg: string; edge: string } | null
function messageHighlight(selected: boolean, searchMatch: boolean): MessageHighlight {
  if (selected) return { bg: theme.accentSoftBg, edge: theme.accent }
  if (searchMatch) return { bg: theme.warnSoftBg, edge: theme.warn }
  return null
}

export function TranscriptMessage({
  item,
  expanded,
  markdownStyle,
  markdownRenderNode,
  streaming = false,
  selectedModel,
  spinner,
  width,
  selected = false,
  searchMatch = false,
  onToggleActivityExpanded,
  onSelectMessage,
}: {
  item: TranscriptItem
  expanded: boolean
  markdownStyle: SyntaxStyle
  // Renders fenced code / diff blocks as themed wells with a copy affordance;
  // every other markdown token falls back to the default renderer. Optional so
  // callers that don't supply it keep plain (native) code rendering.
  markdownRenderNode?: MarkdownRenderNode
  // True only for the actively-streaming assistant bubble. While streaming we
  // skip the custom renderNode (it freezes on incremental content updates) and
  // render native, live-updating code instead; the differing markdown `key`
  // remounts the bubble with the themed well once the reply settles.
  streaming?: boolean
  selectedModel: string
  spinner: string
  width: number
  selected?: boolean
  searchMatch?: boolean
  onToggleActivityExpanded: (id: string) => void
  // Mouse: clicking a text message enters transcript-nav on it (the App guards
  // against stealing a pending gate's input). Tool/activity cards keep their own
  // expand-toggle click instead.
  onSelectMessage?: (id: string) => void
}) {
  const anchorId = transcriptMessageAnchorId(item.id)
  const highlight = messageHighlight(selected, searchMatch)
  const selectOnClick = onSelectMessage ? () => onSelectMessage(item.id) : undefined
  // Gate the well renderNode on streaming, and force a one-time remount at the
  // streaming→settled boundary so the settled bubble mounts fresh with the
  // complete text + renderNode (the known-correct render path).
  const messageRenderNode = markdownRenderNodeFor(streaming, markdownRenderNode)
  const markdownKey = streaming ? "md-live" : "md-final"

  if (item.role === "user") {
    return (
      <box id={anchorId} onMouseDown={selectOnClick} style={{ width, flexDirection: "row", backgroundColor: highlight?.bg ?? theme.bgSoft, border: ["left"], borderStyle: "single", borderColor: highlight?.edge ?? theme.bgSoft, marginBottom: 2 }}>
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
          <markdown key={markdownKey} content={item.text || " "} syntaxStyle={markdownStyle} renderNode={messageRenderNode} tableOptions={MARKDOWN_TABLE_OPTIONS} internalBlockMode="top-level" />
        </box>
      </box>
    )
  }

  if (item.role === "assistant") {
    return (
      <box id={anchorId} onMouseDown={selectOnClick} style={{ width, flexDirection: "row", backgroundColor: highlight?.bg, border: ["left"], borderStyle: "single", borderColor: highlight?.edge ?? theme.bg, marginBottom: 2 }}>
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2 }}>
          <markdown key={markdownKey} content={item.text || " "} syntaxStyle={markdownStyle} renderNode={messageRenderNode} tableOptions={MARKDOWN_TABLE_OPTIONS} internalBlockMode="top-level" />
          <BuildLine durationMs={item.meta?.durationMs} selectedModel={selectedModel} />
        </box>
      </box>
    )
  }

  if (item.role === "thinking") {
    const lines = item.text.split(/\r?\n/).filter(Boolean)
    const [firstLine, ...rest] = lines.length > 0 ? lines : ["thinking"]
    return (
      <box id={anchorId} onMouseDown={selectOnClick} style={{ width, flexDirection: "row", backgroundColor: highlight?.bg, marginBottom: 1 }}>
        <box style={{ width: 1, backgroundColor: highlight?.edge ?? theme.border }} />
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
    const summary = collapsedActivitySummary(detail, running)
    const hint = expanded ? "click to collapse" : "click to expand"
    return (
      // Glass: tool output sits in a rounded card (card-bg fill + card frame).
      // Border (1/side) + inner padding (2 left / 1 right) preserves the former
      // 3-left / 2-right content inset, so the truncation budgets below still hold.
      // Reserve the last column for the scrollbox gutter so the right border
      // isn't overdrawn by the scrollbar (gate/composer sit outside the scrollbox
      // and don't need this).
      <box
        id={anchorId}
        onMouseDown={() => onToggleActivityExpanded(item.id)}
        style={{ width: Math.max(1, width - 1), flexDirection: "row", backgroundColor: highlight?.bg ?? theme.cardBg, border: true, borderStyle: "rounded", borderColor: highlight?.edge ?? theme.cardBorder, marginBottom: 1 }}
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
    <box id={anchorId} onMouseDown={selectOnClick} style={{ width, flexDirection: "row", backgroundColor: highlight?.bg, border: ["left"], borderStyle: "single", borderColor: highlight?.edge ?? theme.bg, marginBottom: 2 }}>
      <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2 }}>
        <text fg={theme.warn}>{item.text || " "}</text>
      </box>
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
      <text fg={diffPreviewLineColor(line, failed)} bg={diffPreviewLineBg(line, failed)}>
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

function collapsedActivitySummary(lines: string[], running = false): string | null {
  const output = lines.find((line) => line.startsWith("output: "))
  if (output) return output.slice("output: ".length)
  // A still-running tool has no output yet: surface its input/command (available
  // mid-run via the running display preview) so the collapsed row is legible
  // instead of showing only a spinner + "click to expand".
  if (running) {
    const input = lines.find((line) => line.startsWith("input: "))
    if (input) return input.slice("input: ".length)
  }
  const firstVisible = lines.find((line) => line && !line.startsWith("result: ") && !line.startsWith("input: "))
  return firstVisible ?? null
}

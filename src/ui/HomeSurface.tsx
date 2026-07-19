import type { ThreadInfo } from "../gateway/types"
import { threadDisplayTitle, type ThreadPreviewMap } from "../threadPreviews"
import type { ActiveRow, AutomationsSummary, HomeVitals, NeedsYouRow } from "./homeData"
import { theme, toneColors, type Tone } from "./theme"
import { formatDate, Hairline, Hint, ListRow, Surface, truncate } from "./pixel"

// Which section holds keyboard focus. Selection is a single flat index across
// NEEDS YOU + ACTIVE + RECENT rows (section headers are skipped); `focused`
// only drives header emphasis.
export type HomeSection = "needsYou" | "active" | "recent"

// Prop contract for the homepage. Wave 2 (App) imports this, builds the
// view-model via homeData selectors, owns selectedIndex, and handles keys /
// Enter routing. The component is purely presentational — no fetch, no keys.
export interface HomeSurfaceProps {
  needsYou: NeedsYouRow[]
  active: ActiveRow[]
  automations: AutomationsSummary
  recent: ThreadInfo[]
  threadPreviews: ThreadPreviewMap
  vitals: HomeVitals
  // Flat selection index over [needsYou…, active…, recent…]; -1 selects nothing.
  selectedIndex: number
  focused?: HomeSection
  width: number
  height: number
  // Mouse: click a row to select + open it (same flat index the keyboard uses).
  onRowClick?: (index: number) => void
}

const NEEDS_YOU_GLYPH: Record<NeedsYouRow["kind"], string> = {
  approval: "⚑",
  auth: "⚷",
  failed: "✕",
}

const NEEDS_YOU_TONE: Record<NeedsYouRow["kind"], Tone> = {
  approval: "warn",
  auth: "warn",
  failed: "danger",
}

export function HomeSurface({
  needsYou,
  active,
  automations,
  recent,
  threadPreviews,
  vitals,
  selectedIndex,
  focused,
  width,
  height,
  onRowClick,
}: HomeSurfaceProps) {
  const contentWidth = Math.max(1, width - 4)
  // Flat index ranges: needs-you first, then active, then recent.
  const activeStart = needsYou.length
  const recentStart = needsYou.length + active.length
  const meta = `${vitals.connected ? "connected" : "offline"} · ${vitals.model}`

  return (
    <Surface title="home" meta={meta} width={width} height={height}>
      <SectionHeader label="NEEDS YOU" tone="warn" focused={focused === "needsYou"} width={contentWidth} />
      {needsYou.length ? (
        needsYou.map((row, index) => (
          <NeedsYouListRow
            key={`needs-${row.threadId}-${index}`}
            row={row}
            selected={selectedIndex === index}
            width={contentWidth}
            onMouseDown={onRowClick ? () => onRowClick(index) : undefined}
          />
        ))
      ) : (
        <EmptyLine text="Nothing needs you" width={contentWidth} />
      )}

      <box style={{ height: 1 }} />
      <SectionHeader label="ACTIVE" tone="info" focused={focused === "active"} width={contentWidth} />
      {active.length ? (
        active.map((row, index) => (
          <ActiveListRow
            key={`active-${row.threadId}-${index}`}
            row={row}
            selected={selectedIndex === activeStart + index}
            width={contentWidth}
            onMouseDown={onRowClick ? () => onRowClick(activeStart + index) : undefined}
          />
        ))
      ) : (
        <EmptyLine text="No active runs" width={contentWidth} />
      )}

      <box style={{ height: 1 }} />
      <SectionHeader label="AUTOMATIONS" tone="muted" focused={false} width={contentWidth} />
      <AutomationsLine summary={automations} width={contentWidth} />

      <box style={{ height: 1 }} />
      <SectionHeader label="RECENT" tone="muted" focused={focused === "recent"} width={contentWidth} />
      {recent.length ? (
        recent.map((thread, index) => (
          <RecentListRow
            key={`recent-${thread.id}`}
            thread={thread}
            previews={threadPreviews}
            selected={selectedIndex === recentStart + index}
            width={contentWidth}
            onMouseDown={onRowClick ? () => onRowClick(recentStart + index) : undefined}
          />
        ))
      ) : (
        <EmptyLine text="No recent sessions" width={contentWidth} />
      )}

      <box style={{ flexGrow: 1 }} />
      <Hairline width={contentWidth} />
      <VitalsFooter vitals={vitals} width={contentWidth} />
      <Hint text="↑/↓ select · enter open · ctrl+h conversation" width={contentWidth} />
    </Surface>
  )
}

function SectionHeader({ label, tone, focused, width }: { label: string; tone: Tone; focused: boolean; width: number }) {
  const color = focused ? toneColors(tone).fg : theme.textMuted
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg={color}>{focused ? "› " : "  "}</text>
      <text fg={color}>{label}</text>
    </box>
  )
}

function EmptyLine({ text, width }: { text: string; width: number }) {
  return (
    <box style={{ width, height: 1, paddingLeft: 2 }}>
      <text fg={theme.textFaint}>{truncate(text, Math.max(1, width - 2))}</text>
    </box>
  )
}

function NeedsYouListRow({ row, selected, width, onMouseDown }: { row: NeedsYouRow; selected: boolean; width: number; onMouseDown?: () => void }) {
  const tone = NEEDS_YOU_TONE[row.kind]
  const glyph = NEEDS_YOU_GLYPH[row.kind]
  const text = row.detail ? `${row.threadTitle} · ${row.detail}` : row.threadTitle
  return (
    <ListRow
      selected={selected}
      railTone="warn"
      leading={<text fg={toneColors(tone).fg}>{glyph} </text>}
      text={text}
      suffix={row.ageLabel}
      alignSuffix="end"
      width={width}
      onMouseDown={onMouseDown}
    />
  )
}

function ActiveListRow({ row, selected, width, onMouseDown }: { row: ActiveRow; selected: boolean; width: number; onMouseDown?: () => void }) {
  const text = row.phase ? `${row.threadTitle} · ${row.phase}` : row.threadTitle
  return (
    <ListRow
      selected={selected}
      leading={<text fg={theme.info}>◇ </text>}
      text={text}
      suffix={row.elapsedLabel}
      alignSuffix="end"
      width={width}
      onMouseDown={onMouseDown}
    />
  )
}

function RecentListRow({
  thread,
  previews,
  selected,
  width,
  onMouseDown,
}: {
  thread: ThreadInfo
  previews: ThreadPreviewMap
  selected: boolean
  width: number
  onMouseDown?: () => void
}) {
  return <ListRow selected={selected} text={threadDisplayTitle(thread, previews)} width={width} onMouseDown={onMouseDown} />
}

function AutomationsLine({ summary, width }: { summary: AutomationsSummary; width: number }) {
  const nextLabel = summary.nextLabel ? formatDate(summary.nextLabel, "none") : "none"
  return (
    <box style={{ width, height: 1, flexDirection: "row", paddingLeft: 2 }}>
      <text fg={summary.schedulerEnabled ? theme.ok : theme.warn}>
        scheduler {summary.schedulerEnabled ? "on" : "off"}
      </text>
      <text fg={theme.textFaint}> · next </text>
      <text fg={theme.text}>{truncate(nextLabel, Math.max(6, width - 44))}</text>
      <text fg={theme.textFaint}> · </text>
      <text fg={toneColors("muted").fg}>paused {summary.pausedCount}</text>
      <text fg={theme.textFaint}> · </text>
      <text fg={summary.heldCount > 0 ? theme.warn : theme.textFaint}>held {summary.heldCount}</text>
    </box>
  )
}

function VitalsFooter({ vitals, width }: { vitals: HomeVitals; width: number }) {
  const parts = [
    vitals.credits ? `credits ${vitals.credits}` : null,
    vitals.todayCost ? `today ${vitals.todayCost}` : null,
    `${vitals.pendingApprovals} need approval`,
  ].filter((part): part is string => Boolean(part))
  return (
    <box style={{ width, height: 1 }}>
      <text fg={theme.textFaint}>{truncate(parts.join(" · "), width)}</text>
    </box>
  )
}

import type { ThreadInfo } from "../gateway/types"
import { statusTone, type Tone } from "./theme"

// Persistent threads sidebar (Glass two-pane conversation layout). Pure layout +
// status-mapping helpers live here so they can be unit-tested without a renderer.

// Default sidebar width in columns (spec: ~26-30). Kept narrow enough that the
// chat pane still has room on an 90-col terminal.
export const SIDEBAR_WIDTH = 28

// Below this total width the sidebar auto-collapses so the chat gets the full
// body; the toggle still works to force it back if the user insists.
export const SIDEBAR_MIN_TOTAL_WIDTH = 90

// The chat pane never shrinks below this — if honoring the full sidebar width
// would starve the chat, the sidebar is trimmed instead of overflowing the body.
export const SIDEBAR_MIN_CHAT_WIDTH = 48

export type SidebarLayout = {
  visible: boolean
  sidebarWidth: number
  chatWidth: number
}

// Resolve the two-pane split for a given terminal width and user toggle. Always
// returns widths that sum to <= totalWidth (never overflow the body).
export function computeSidebarLayout(
  totalWidth: number,
  collapsed: boolean,
  preferredWidth: number = SIDEBAR_WIDTH,
): SidebarLayout {
  const autoCollapsed = totalWidth < SIDEBAR_MIN_TOTAL_WIDTH
  const visible = !collapsed && !autoCollapsed
  if (!visible) {
    return { visible: false, sidebarWidth: 0, chatWidth: Math.max(1, totalWidth) }
  }
  const sidebarWidth = Math.max(0, Math.min(preferredWidth, totalWidth - SIDEBAR_MIN_CHAT_WIDTH))
  if (sidebarWidth <= 0) {
    return { visible: false, sidebarWidth: 0, chatWidth: Math.max(1, totalWidth) }
  }
  return { visible: true, sidebarWidth, chatWidth: Math.max(1, totalWidth - sidebarWidth) }
}

export type ThreadDotContext = {
  activeThreadId?: string | null
  activeRunning?: boolean
  approvalThreadIds?: ReadonlySet<string>
}

// Map a thread to its sidebar status-dot tone, following the status canon:
// needs-approval → warn, running → info, everything else (idle/paused) → muted.
export function threadStatusDotTone(
  thread: { id: string; state?: string | null },
  context: ThreadDotContext = {},
): Tone {
  if (context.approvalThreadIds?.has(thread.id)) return "warn"
  if (context.activeRunning && thread.id === context.activeThreadId) return "info"
  const tone = statusTone(thread.state ?? "")
  if (tone === "warn") return "warn"
  if (tone === "info") return "info"
  return "muted"
}

// Windowed slice of a thread list so the selected/active row stays visible in a
// fixed-height sidebar. Returns the visible threads plus the offset applied.
export function windowThreads<T>(
  threads: T[],
  selectedIndex: number,
  visibleCount: number,
): { visible: T[]; start: number } {
  if (visibleCount <= 0 || threads.length === 0) return { visible: [], start: 0 }
  if (threads.length <= visibleCount) return { visible: threads, start: 0 }
  const clampedSelected = Math.max(0, Math.min(selectedIndex, threads.length - 1))
  const start = Math.min(
    Math.max(0, clampedSelected - visibleCount + 1),
    Math.max(0, threads.length - visibleCount),
  )
  return { visible: threads.slice(start, start + visibleCount), start }
}

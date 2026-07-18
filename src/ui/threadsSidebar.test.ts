import { describe, expect, test } from "bun:test"
import {
  SIDEBAR_MIN_CHAT_WIDTH,
  SIDEBAR_WIDTH,
  computeSidebarLayout,
  threadStatusDotTone,
  windowThreads,
} from "./threadsSidebar"

describe("computeSidebarLayout", () => {
  test("shows the sidebar and splits the body on a wide terminal", () => {
    const layout = computeSidebarLayout(140, false)
    expect(layout.visible).toBe(true)
    expect(layout.sidebarWidth).toBe(SIDEBAR_WIDTH)
    expect(layout.chatWidth).toBe(140 - SIDEBAR_WIDTH)
  })

  test("hides the sidebar when the user collapses it (chat takes full width)", () => {
    const layout = computeSidebarLayout(140, true)
    expect(layout.visible).toBe(false)
    expect(layout.sidebarWidth).toBe(0)
    expect(layout.chatWidth).toBe(140)
  })

  test("auto-collapses below the responsive threshold even when not collapsed", () => {
    const layout = computeSidebarLayout(80, false)
    expect(layout.visible).toBe(false)
    expect(layout.sidebarWidth).toBe(0)
    expect(layout.chatWidth).toBe(80)
  })

  test("never overflows the body: widths always sum to <= total", () => {
    for (const width of [30, 60, 89, 90, 100, 200]) {
      for (const collapsed of [false, true]) {
        const layout = computeSidebarLayout(width, collapsed)
        expect(layout.sidebarWidth + layout.chatWidth).toBeLessThanOrEqual(width)
        expect(layout.chatWidth).toBeGreaterThanOrEqual(1)
      }
    }
  })

  test("trims the sidebar rather than starving the chat when space is tight", () => {
    // Just above the responsive threshold, honoring the full 28-col sidebar would
    // leave the chat below its floor — so the sidebar is narrowed to keep the
    // chat at least SIDEBAR_MIN_CHAT_WIDTH.
    const layout = computeSidebarLayout(90, false)
    expect(layout.visible).toBe(true)
    expect(layout.chatWidth).toBeGreaterThanOrEqual(SIDEBAR_MIN_CHAT_WIDTH)
    expect(layout.sidebarWidth).toBeLessThanOrEqual(SIDEBAR_WIDTH)
  })
})

describe("threadStatusDotTone", () => {
  const thread = (id: string, state = "idle") => ({ id, state })

  test("needs-approval wins → warn", () => {
    const tone = threadStatusDotTone(thread("t1", "running"), {
      activeThreadId: "t1",
      activeRunning: true,
      approvalThreadIds: new Set(["t1"]),
    })
    expect(tone).toBe("warn")
  })

  test("active + running → info", () => {
    expect(
      threadStatusDotTone(thread("t1", "idle"), { activeThreadId: "t1", activeRunning: true }),
    ).toBe("info")
  })

  test("a thread whose own state is running → info", () => {
    expect(threadStatusDotTone(thread("t2", "running"), {})).toBe("info")
  })

  test("a thread whose state waits for approval → warn", () => {
    expect(threadStatusDotTone(thread("t3", "waiting_for_approval"), {})).toBe("warn")
  })

  test("idle / paused / unknown → muted", () => {
    expect(threadStatusDotTone(thread("t4", "idle"), {})).toBe("muted")
    expect(threadStatusDotTone(thread("t5", "paused"), {})).toBe("muted")
    expect(threadStatusDotTone(thread("t6", ""), {})).toBe("muted")
  })

  test("the active thread is not marked running when nothing is in flight", () => {
    expect(
      threadStatusDotTone(thread("t1", "idle"), { activeThreadId: "t1", activeRunning: false }),
    ).toBe("muted")
  })
})

describe("windowThreads", () => {
  const items = Array.from({ length: 10 }, (_, i) => `t${i}`)

  test("returns everything when it fits", () => {
    const { visible, start } = windowThreads(items.slice(0, 3), 0, 5)
    expect(start).toBe(0)
    expect(visible).toEqual(["t0", "t1", "t2"])
  })

  test("keeps the selected row in view by scrolling the window", () => {
    const { visible, start } = windowThreads(items, 9, 4)
    expect(start).toBe(6)
    expect(visible).toEqual(["t6", "t7", "t8", "t9"])
  })

  test("clamps the window to the top for early selections", () => {
    const { visible, start } = windowThreads(items, 0, 4)
    expect(start).toBe(0)
    expect(visible).toEqual(["t0", "t1", "t2", "t3"])
  })

  test("handles an empty list", () => {
    expect(windowThreads([], 0, 5)).toEqual({ visible: [], start: 0 })
  })
})

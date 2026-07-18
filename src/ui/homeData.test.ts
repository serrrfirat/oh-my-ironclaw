import { describe, expect, test } from "bun:test"
import type { AutomationInfo } from "../gateway/types"
import type { HomeInputs } from "./homeData"
import {
  buildActiveRows,
  buildAutomationsSummary,
  buildNeedsYou,
  buildVitals,
  formatAge,
  formatUsd,
  homeSelectableCount,
  resolveHomeTarget,
} from "./homeData"

const NOW = 1_000_000_000_000

function inputs(overrides: Partial<HomeInputs> = {}): HomeInputs {
  return {
    connected: true,
    model: "opus",
    credits: null,
    todayCost: null,
    pendingApprovals: 0,
    gates: [],
    failedRuns: [],
    activeRuns: [],
    heldAutomations: [],
    ...overrides,
  }
}

function automation(overrides: Partial<AutomationInfo> = {}): AutomationInfo {
  return {
    automation_id: "auto-1",
    name: "Daily digest",
    state: "active",
    ...overrides,
  }
}

describe("formatAge boundaries", () => {
  test("sub-minute and zero", () => {
    expect(formatAge(0)).toBe("0s")
    expect(formatAge(45_000)).toBe("45s")
    expect(formatAge(59_999)).toBe("59s")
  })

  test("minutes", () => {
    expect(formatAge(60_000)).toBe("1m")
    expect(formatAge(120_000)).toBe("2m")
    expect(formatAge(59 * 60_000)).toBe("59m")
  })

  test("hours pad the minutes", () => {
    expect(formatAge(60 * 60_000)).toBe("1h 00m")
    expect(formatAge(64 * 60_000)).toBe("1h 04m")
    expect(formatAge(23 * 3_600_000 + 59 * 60_000)).toBe("23h 59m")
  })

  test("days and negative clamp", () => {
    expect(formatAge(24 * 3_600_000)).toBe("1d")
    expect(formatAge(3 * 24 * 3_600_000)).toBe("3d")
    expect(formatAge(-5_000)).toBe("0s")
  })
})

describe("buildNeedsYou", () => {
  test("empty input yields no rows", () => {
    expect(buildNeedsYou(inputs(), NOW)).toEqual([])
  })

  test("maps gate kind from challengeKind and failed runs", () => {
    const rows = buildNeedsYou(
      inputs({
        gates: [
          { threadId: "t1", threadTitle: "Approve deploy", sinceMs: NOW - 120_000 },
          {
            threadId: "t2",
            threadTitle: "Connect GitHub",
            challengeKind: "oauth_url",
            sinceMs: NOW - 60_000,
          },
        ],
        failedRuns: [{ threadId: "t3", threadTitle: "Build", detail: "run failed", sinceMs: NOW - 5_000 }],
      }),
      NOW,
    )
    expect(rows.map((r) => [r.threadId, r.kind])).toEqual([
      ["t1", "approval"],
      ["t2", "auth"],
      ["t3", "failed"],
    ])
    // Default detail is filled for the approval gate (empty detail provided).
    expect(rows[0]?.detail).toBe("approval required")
    expect(rows[0]?.ageLabel).toBe("2m")
  })

  test("held automations surface as failed rows keyed by automation id", () => {
    const rows = buildNeedsYou(
      inputs({ heldAutomations: [{ automationId: "auto-9", name: "Nightly sync", sinceMs: NOW - 3_600_000 }] }),
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ threadId: "auto-9", threadTitle: "Nightly sync", kind: "failed" })
    expect(rows[0]?.ageLabel).toBe("1h 00m")
  })

  test("sorts oldest-first with undated rows last", () => {
    const rows = buildNeedsYou(
      inputs({
        gates: [
          { threadId: "new", threadTitle: "New", sinceMs: NOW - 10_000 },
          { threadId: "undated", threadTitle: "Undated" },
          { threadId: "old", threadTitle: "Old", sinceMs: NOW - 500_000 },
        ],
      }),
      NOW,
    )
    expect(rows.map((r) => r.threadId)).toEqual(["old", "new", "undated"])
    expect(rows[2]?.ageLabel).toBe("—")
  })
})

describe("buildActiveRows", () => {
  test("projects phase from run status and filters terminal runs", () => {
    const rows = buildActiveRows(
      inputs({
        activeRuns: [
          { threadId: "a", threadTitle: "Thinker", status: "thinking", startedAtMs: NOW - 120_000 },
          { threadId: "b", threadTitle: "Tooler", status: "tool_running", capabilityId: "web_search", startedAtMs: NOW - 5_000 },
          { threadId: "c", threadTitle: "Reflector", status: "reflecting" },
          { threadId: "d", threadTitle: "Done", status: "completed" },
        ],
      }),
      NOW,
    )
    expect(rows.map((r) => [r.threadId, r.phase])).toEqual([
      ["a", "thinking"],
      ["b", "tool:web_search"],
      ["c", "reflecting"],
    ])
    expect(rows[0]?.elapsedLabel).toBe("2m")
    expect(rows[2]?.elapsedLabel).toBe("—")
  })

  test("filters idle plus every shared terminal run state (RU3)", () => {
    const rows = buildActiveRows(
      inputs({
        activeRuns: [
          { threadId: "keep", threadTitle: "Live", status: "running" },
          { threadId: "x1", threadTitle: "Idle", status: "idle" },
          { threadId: "x2", threadTitle: "Done", status: "completed" },
          { threadId: "x3", threadTitle: "Failed", status: "failed" },
          { threadId: "x4", threadTitle: "Killed", status: "killed" },
          { threadId: "x5", threadTitle: "Recover", status: "recovery_required" },
          { threadId: "x6", threadTitle: "Cancelled", status: "cancelled" },
        ],
      }),
      NOW,
    )
    expect(rows.map((r) => r.threadId)).toEqual(["keep"])
  })
})

describe("buildVitals", () => {
  test("passes through and clamps approvals", () => {
    expect(
      buildVitals(inputs({ connected: false, model: "sonnet", credits: "$4.20", todayCost: "$1.10", pendingApprovals: 3 })),
    ).toEqual({ connected: false, model: "sonnet", credits: "$4.20", todayCost: "$1.10", pendingApprovals: 3 })
  })

  test("defaults missing model and never negative approvals", () => {
    const vitals = buildVitals(inputs({ model: "", pendingApprovals: -2 }))
    expect(vitals.model).toBe("—")
    expect(vitals.pendingApprovals).toBe(0)
  })
})

describe("buildAutomationsSummary", () => {
  test("counts paused/held and picks soonest next run", () => {
    const summary = buildAutomationsSummary(
      [
        automation({ automation_id: "a", state: "active", next_run_at: "2030-01-01T10:00:00Z" }),
        automation({ automation_id: "b", state: "paused" }),
        automation({ automation_id: "c", state: "disabled" }),
        automation({ automation_id: "d", state: "active", last_status: "error", next_run_at: "2030-01-01T08:00:00Z" }),
      ],
      true,
    )
    expect(summary.schedulerEnabled).toBe(true)
    expect(summary.pausedCount).toBe(2)
    expect(summary.heldCount).toBe(1)
    expect(summary.nextLabel).toBe("2030-01-01T08:00:00.000Z")
  })

  test("empty list is total", () => {
    expect(buildAutomationsSummary([], false)).toEqual({
      schedulerEnabled: false,
      pausedCount: 0,
      heldCount: 0,
      nextLabel: null,
    })
  })
})

describe("formatUsd", () => {
  test("two decimals at or above a cent, four below", () => {
    expect(formatUsd(4.2)).toBe("$4.20")
    expect(formatUsd(0.005)).toBe("$0.0050")
    expect(formatUsd(0)).toBe("$0.00")
    expect(formatUsd(12)).toBe("$12.00")
  })

  test("nullish / non-finite yields null", () => {
    expect(formatUsd(null)).toBeNull()
    expect(formatUsd(undefined)).toBeNull()
    expect(formatUsd(Number.NaN)).toBeNull()
  })
})

describe("homeSelectableCount + resolveHomeTarget", () => {
  const withRows = inputs({
    gates: [{ threadId: "gate-thread", threadTitle: "Approve", sinceMs: NOW - 60_000 }],
    heldAutomations: [{ automationId: "auto-held", name: "Nightly", sinceMs: NOW - 120_000 }],
    activeRuns: [{ threadId: "active-thread", threadTitle: "Builder", status: "thinking", startedAtMs: NOW - 10_000 }],
  })
  const recent = ["recent-1", "recent-2"]

  test("count spans needs-you + active + recent", () => {
    // 1 gate + 1 held automation (needs-you) + 1 active + 2 recent = 5
    expect(homeSelectableCount(withRows, recent.length, NOW)).toBe(5)
  })

  test("routes each flat index to the right target", () => {
    // Order: needs-you (oldest-first: held@-120s, gate@-60s), active, recent.
    expect(resolveHomeTarget(withRows, recent, NOW, 0)).toEqual({ kind: "automations" })
    expect(resolveHomeTarget(withRows, recent, NOW, 1)).toEqual({ kind: "thread", threadId: "gate-thread" })
    expect(resolveHomeTarget(withRows, recent, NOW, 2)).toEqual({ kind: "thread", threadId: "active-thread" })
    expect(resolveHomeTarget(withRows, recent, NOW, 3)).toEqual({ kind: "thread", threadId: "recent-1" })
    expect(resolveHomeTarget(withRows, recent, NOW, 4)).toEqual({ kind: "thread", threadId: "recent-2" })
  })

  test("out-of-range index resolves to null", () => {
    expect(resolveHomeTarget(withRows, recent, NOW, 5)).toBeNull()
    expect(resolveHomeTarget(withRows, recent, NOW, -1)).toBeNull()
    expect(resolveHomeTarget(inputs(), [], NOW, 0)).toBeNull()
  })
})

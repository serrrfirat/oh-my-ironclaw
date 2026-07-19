import { describe, expect, test } from "bun:test"
import { diffPreviewLineBg, diffPreviewLineColor, isUnifiedDiffKind } from "./diffPreview"
import { theme } from "./theme"

describe("diff preview rendering", () => {
  test("detects unified diff output kind", () => {
    expect(isUnifiedDiffKind("unified_diff")).toBe(true)
    expect(isUnifiedDiffKind("text")).toBe(false)
    expect(isUnifiedDiffKind(null)).toBe(false)
  })

  test("colors unified diff lines by prefix", () => {
    expect(diffPreviewLineColor("@@ -1,1 +1,1 @@")).toBe(theme.accentText)
    expect(diffPreviewLineColor("+added")).toBe(theme.ok)
    expect(diffPreviewLineColor("-removed")).toBe(theme.danger)
    // +++/--- file markers are headers, dimmed with the other git chrome.
    expect(diffPreviewLineColor("+++ b/src/file.ts")).toBe(theme.textFaint)
    expect(diffPreviewLineColor("--- a/src/file.ts")).toBe(theme.textFaint)
    expect(diffPreviewLineColor("diff --git a/src/file.ts b/src/file.ts")).toBe(theme.textFaint)
    expect(diffPreviewLineColor("index abc..def 100644")).toBe(theme.textFaint)
    expect(diffPreviewLineColor(" context")).toBe(theme.textMuted)
  })

  test("hunk headers, git headers, and context lines use three distinct tones", () => {
    const hunk = diffPreviewLineColor("@@ -1,1 +1,1 @@")
    const header = diffPreviewLineColor("diff --git a/x b/x")
    const context = diffPreviewLineColor(" untouched")
    expect(new Set([hunk, header, context]).size).toBe(3)
  })

  test("failed diff lines render in danger tone", () => {
    expect(diffPreviewLineColor("+added", true)).toBe(theme.danger)
    expect(diffPreviewLineColor(" context", true)).toBe(theme.danger)
  })

  test("tints added / removed lines with soft backgrounds", () => {
    expect(diffPreviewLineBg("+added")).toBe(theme.okSoftBg)
    expect(diffPreviewLineBg("-removed")).toBe(theme.dangerSoftBg)
  })

  test("leaves headers and context lines untinted", () => {
    expect(diffPreviewLineBg("@@ -1,1 +1,1 @@")).toBeUndefined()
    // +++/--- file markers are headers, not add/remove content.
    expect(diffPreviewLineBg("+++ b/src/file.ts")).toBeUndefined()
    expect(diffPreviewLineBg("--- a/src/file.ts")).toBeUndefined()
    expect(diffPreviewLineBg("diff --git a/x b/x")).toBeUndefined()
    expect(diffPreviewLineBg(" context")).toBeUndefined()
  })

  test("skips the per-line fill for a failed tool (already all danger)", () => {
    expect(diffPreviewLineBg("+added", true)).toBeUndefined()
    expect(diffPreviewLineBg("-removed", true)).toBeUndefined()
  })
})

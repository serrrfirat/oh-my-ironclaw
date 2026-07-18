import { describe, expect, test } from "bun:test"
import { diffPreviewLineColor, isUnifiedDiffKind } from "./diffPreview"
import { theme } from "./theme"

describe("diff preview rendering", () => {
  test("detects unified diff output kind", () => {
    expect(isUnifiedDiffKind("unified_diff")).toBe(true)
    expect(isUnifiedDiffKind("text")).toBe(false)
    expect(isUnifiedDiffKind(null)).toBe(false)
  })

  test("colors unified diff lines by prefix", () => {
    expect(diffPreviewLineColor("@@ -1,1 +1,1 @@")).toBe(theme.textMuted)
    expect(diffPreviewLineColor("+added")).toBe(theme.ok)
    expect(diffPreviewLineColor("-removed")).toBe(theme.danger)
    expect(diffPreviewLineColor("+++ b/src/file.ts")).toBe(theme.ok)
    expect(diffPreviewLineColor("--- a/src/file.ts")).toBe(theme.danger)
    expect(diffPreviewLineColor("diff --git a/src/file.ts b/src/file.ts")).toBe(theme.textMuted)
    expect(diffPreviewLineColor(" context")).toBe(theme.textMuted)
  })

  test("failed diff lines render in danger tone", () => {
    expect(diffPreviewLineColor("+added", true)).toBe(theme.danger)
    expect(diffPreviewLineColor(" context", true)).toBe(theme.danger)
  })
})

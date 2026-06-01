import { describe, expect, test } from "bun:test"
import { diffPreviewLineColor, isUnifiedDiffKind } from "./diffPreview"

describe("diff preview rendering", () => {
  test("detects unified diff output kind", () => {
    expect(isUnifiedDiffKind("unified_diff")).toBe(true)
    expect(isUnifiedDiffKind("text")).toBe(false)
    expect(isUnifiedDiffKind(null)).toBe(false)
  })

  test("colors unified diff lines by prefix", () => {
    expect(diffPreviewLineColor("@@ -1,1 +1,1 @@")).toBe("#8fc8f2")
    expect(diffPreviewLineColor("+added")).toBe("#8cffb0")
    expect(diffPreviewLineColor("-removed")).toBe("#ff9b9b")
    expect(diffPreviewLineColor("+++ b/src/file.ts")).toBe("#8cffb0")
    expect(diffPreviewLineColor("--- a/src/file.ts")).toBe("#ff9b9b")
    expect(diffPreviewLineColor("diff --git a/src/file.ts b/src/file.ts")).toBe("#8a8a8a")
    expect(diffPreviewLineColor(" context")).toBe("#d8cfaa")
  })
})

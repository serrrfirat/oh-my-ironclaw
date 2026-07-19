import { describe, expect, test } from "bun:test"
import { codeBlockCopyText, isDiffFence } from "./codeWell"

describe("code well helpers", () => {
  test("isDiffFence detects the ```diff language, case/space insensitively", () => {
    expect(isDiffFence("diff")).toBe(true)
    expect(isDiffFence("DIFF")).toBe(true)
    expect(isDiffFence("  diff  ")).toBe(true)
    expect(isDiffFence("ts")).toBe(false)
    expect(isDiffFence("")).toBe(false)
    expect(isDiffFence(undefined)).toBe(false)
    expect(isDiffFence(null)).toBe(false)
  })

  test("codeBlockCopyText returns the raw code text, never the fence", () => {
    expect(codeBlockCopyText({ text: "const x = 1\n" })).toBe("const x = 1\n")
    // Robust to a partial / incomplete streamed token with no text yet.
    expect(codeBlockCopyText({})).toBe("")
    expect(codeBlockCopyText({ text: undefined })).toBe("")
  })
})

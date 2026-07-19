import { describe, expect, test } from "bun:test"
import { codeBlockCopyText, isDiffFence, markdownRenderNodeFor } from "./codeWell"

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

  test("markdownRenderNodeFor gates the well renderNode on streaming state", () => {
    // A stand-in renderNode: identity of the reference is all that matters here.
    const renderNode = (() => undefined) as unknown as Parameters<typeof markdownRenderNodeFor>[1]
    // Actively streaming → no custom renderNode (native, live-updating code).
    expect(markdownRenderNodeFor(true, renderNode)).toBeUndefined()
    // Settled → the themed-well renderNode (the known-correct fresh render).
    expect(markdownRenderNodeFor(false, renderNode)).toBe(renderNode)
    // Absent renderNode stays absent regardless of streaming state.
    expect(markdownRenderNodeFor(true, undefined)).toBeUndefined()
    expect(markdownRenderNodeFor(false, undefined)).toBeUndefined()
  })
})

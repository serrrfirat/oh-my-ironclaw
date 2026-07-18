import { describe, expect, test } from "bun:test"
import type { AttachmentBudget, StagedAttachment } from "./attachments"
import { attachmentChipLabel, basename, formatBytes, mimeFromExtension, validateStagedAttachment } from "./attachments"

const budget: AttachmentBudget = {
  accept: ["image/*", "application/pdf"],
  max_count: 2,
  max_file_bytes: 1024,
  max_total_bytes: 1536,
}

function staged(overrides: Partial<StagedAttachment> = {}): StagedAttachment {
  return { filename: "a.png", mime_type: "image/png", size_bytes: 512, data_base64: "AA==", ...overrides }
}

describe("mime + path helpers", () => {
  test("derives mime from extension", () => {
    expect(mimeFromExtension("photo.PNG")).toBe("image/png")
    expect(mimeFromExtension("doc.pdf")).toBe("application/pdf")
    expect(mimeFromExtension("data.unknownext")).toBe("application/octet-stream")
  })

  test("basename strips directories", () => {
    expect(basename("/home/user/photo.png")).toBe("photo.png")
    expect(basename("photo.png")).toBe("photo.png")
  })

  test("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB")
  })

  test("chip label", () => {
    expect(attachmentChipLabel(staged())).toBe("a.png · 512 B")
  })
})

describe("attachment staging validation", () => {
  test("accepts a valid file within budget", () => {
    expect(validateStagedAttachment({ filename: "a.png", mime_type: "image/png", size_bytes: 512 }, [], budget)).toEqual({ ok: true })
  })

  test("rejects empty files", () => {
    const result = validateStagedAttachment({ filename: "a.png", mime_type: "image/png", size_bytes: 0 }, [], budget)
    expect(result.ok).toBe(false)
  })

  test("enforces per-file byte limit", () => {
    const result = validateStagedAttachment({ filename: "big.png", mime_type: "image/png", size_bytes: 2048 }, [], budget)
    expect(result).toMatchObject({ ok: false })
  })

  test("enforces max count", () => {
    const existing = [staged({ filename: "a.png" }), staged({ filename: "b.png" })]
    const result = validateStagedAttachment({ filename: "c.png", mime_type: "image/png", size_bytes: 100 }, existing, budget)
    expect(result).toMatchObject({ ok: false })
  })

  test("enforces total byte limit", () => {
    const existing = [staged({ filename: "a.png", size_bytes: 900 })]
    const result = validateStagedAttachment({ filename: "b.png", mime_type: "image/png", size_bytes: 900 }, existing, budget)
    expect(result).toMatchObject({ ok: false })
  })

  test("enforces accepted mime types", () => {
    const result = validateStagedAttachment({ filename: "a.zip", mime_type: "application/zip", size_bytes: 100 }, [], budget)
    expect(result).toMatchObject({ ok: false })
  })

  test("empty accept list accepts anything", () => {
    const open: AttachmentBudget = { ...budget, accept: [] }
    expect(validateStagedAttachment({ filename: "a.zip", mime_type: "application/zip", size_bytes: 100 }, [], open)).toEqual({ ok: true })
  })
})

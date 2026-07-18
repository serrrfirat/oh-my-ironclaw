import type { OutgoingAttachment, SessionResponse } from "../gateway/types"
import { formatBytes } from "../transcript"

// Re-export the shared byte formatter so existing importers of
// `./attachments` keep working while the implementation lives in one place.
export { formatBytes }

// One locally-staged attachment, ready to send as an OutgoingAttachment.
export type StagedAttachment = {
  filename: string
  mime_type: string
  size_bytes: number
  data_base64: string
}

export type AttachmentBudget = SessionResponse["attachments"]

const DEFAULT_BUDGET: AttachmentBudget = {
  accept: [],
  max_count: 10,
  max_file_bytes: 25 * 1024 * 1024,
  max_total_bytes: 100 * 1024 * 1024,
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
}

export function mimeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream"
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "")
  const parts = normalized.split("/")
  return parts[parts.length - 1] || path
}

export function attachmentBudget(session?: SessionResponse | null): AttachmentBudget {
  return session?.attachments ?? DEFAULT_BUDGET
}

function mimeAccepted(mime: string, accept: string[]): boolean {
  if (accept.length === 0) return true
  return accept.some((pattern) => {
    if (pattern === "*/*" || pattern === "*") return true
    if (pattern.endsWith("/*")) return mime.startsWith(pattern.slice(0, -1))
    return pattern === mime
  })
}

export type AttachmentValidation = { ok: true } | { ok: false; error: string }

// Validate a candidate against the session budget and the already-staged set,
// without touching the filesystem (pure — the bytes are provided).
export function validateStagedAttachment(
  candidate: { filename: string; mime_type: string; size_bytes: number },
  existing: StagedAttachment[],
  budget: AttachmentBudget,
): AttachmentValidation {
  if (candidate.size_bytes <= 0) {
    return { ok: false, error: `${candidate.filename} is empty` }
  }
  if (existing.length >= budget.max_count) {
    return { ok: false, error: `attachment limit reached (${budget.max_count})` }
  }
  if (budget.max_file_bytes > 0 && candidate.size_bytes > budget.max_file_bytes) {
    return {
      ok: false,
      error: `${candidate.filename} is ${formatBytes(candidate.size_bytes)}, over the ${formatBytes(budget.max_file_bytes)} per-file limit`,
    }
  }
  const total = existing.reduce((sum, item) => sum + item.size_bytes, 0) + candidate.size_bytes
  if (budget.max_total_bytes > 0 && total > budget.max_total_bytes) {
    return {
      ok: false,
      error: `total attachments would be ${formatBytes(total)}, over the ${formatBytes(budget.max_total_bytes)} limit`,
    }
  }
  if (!mimeAccepted(candidate.mime_type, budget.accept)) {
    return { ok: false, error: `${candidate.mime_type} is not an accepted attachment type` }
  }
  return { ok: true }
}

export function toOutgoingAttachment(staged: StagedAttachment): OutgoingAttachment {
  return {
    mime_type: staged.mime_type,
    filename: staged.filename,
    data_base64: staged.data_base64,
  }
}

// Render a compact chip label for the composer: "photo.png · 12.4 KB".
export function attachmentChipLabel(staged: StagedAttachment): string {
  return `${staged.filename} · ${formatBytes(staged.size_bytes)}`
}

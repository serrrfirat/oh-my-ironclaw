import type { AppEvent } from "./types"

export type SseMessage = {
  id?: string
  event?: string
  data: string
}

export async function* parseSse(response: Response): AsyncGenerator<SseMessage> {
  if (!response.body) {
    throw new Error("SSE response has no body")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let splitAt: number
    while ((splitAt = findFrameBoundary(buffer)) >= 0) {
      const raw = buffer.slice(0, splitAt)
      buffer = buffer.slice(splitAt + frameBoundaryLength(buffer, splitAt))
      const message = parseFrame(raw)
      if (message) yield message
    }
  }

  const trailing = parseFrame(buffer)
  if (trailing) yield trailing
}

export function parseAppEvent(message: SseMessage): AppEvent | null {
  if (!message.data.trim()) return null
  return JSON.parse(message.data) as AppEvent
}

function findFrameBoundary(value: string): number {
  const candidates = [value.indexOf("\n\n"), value.indexOf("\r\n\r\n")]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
  return candidates[0] ?? -1
}

function frameBoundaryLength(value: string, index: number): number {
  return value.startsWith("\r\n\r\n", index) ? 4 : 2
}

function parseFrame(raw: string): SseMessage | null {
  const lines = raw.split(/\r?\n/)
  const data: string[] = []
  let id: string | undefined
  let event: string | undefined

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon >= 0 ? line.slice(0, colon) : line
    const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, "") : ""
    if (field === "data") data.push(value)
    if (field === "id") id = value
    if (field === "event") event = value
  }

  if (!id && !event && data.length === 0) return null
  return { id, event, data: data.join("\n") }
}


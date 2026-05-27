import type { HistoryResponse, ThreadInfo } from "./gateway/types"

export type ThreadPreviewMap = Record<string, string>

export function threadPreviewFromHistory(history: HistoryResponse): string {
  const content = firstHistoryContent(history)
  return firstSentence(content)
}

export function threadDisplayTitle(thread: ThreadInfo, previews: ThreadPreviewMap): string {
  const preview = previews[thread.id]?.trim()
  if (preview) return preview
  const title = thread.title?.trim()
  if (title && title !== thread.id) return firstSentence(title)
  return "New session"
}

export function filterThreads(threads: ThreadInfo[], query: string, previews: ThreadPreviewMap): ThreadInfo[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return threads
  return threads.filter((thread) => {
    const haystack = [
      threadDisplayTitle(thread, previews),
      thread.title,
      thread.id,
      thread.state,
    ].filter(Boolean).join(" ").toLowerCase()
    return haystack.includes(needle)
  })
}

function firstHistoryContent(history: HistoryResponse): string {
  if (history.messages) {
    const message = history.messages.find((item) =>
      "content" in item &&
      item.content.trim(),
    )
    return message && "content" in message ? message.content : ""
  }

  for (const turn of history.turns) {
    if (turn.user_input.trim()) return turn.user_input
    if (turn.response?.trim()) return turn.response
    if (turn.narrative?.trim()) return turn.narrative
  }
  return ""
}

function firstSentence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  const match = /^(.{12,}?[.!?])\s/.exec(normalized)
  return match?.[1] ?? normalized
}

// Pure notification module: writes ANSI/OSC escape sequences to a writable
// stream (default process.stdout) to page the user via terminal bell, OS
// desktop notification, and terminal title. No React, no other deps.

// A minimal writable-stream shape so tests can inject a capture stub.
export interface NotifyStream {
  write(chunk: string): unknown
}

export type NotifyKind = "gate" | "auth" | "failed" | "final_reply" | "inbox"

// User preference for how aggressively to notify.
export type NotifyLevel = "off" | "blockers" | "all"

export interface NotifyEvent {
  kind: NotifyKind
  threadId: string
  threadTitle: string
  summary: string
}

// Kinds that block progress and always warrant a page (unless the user is
// already looking at the thread, or notifications are off).
const BLOCKING_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["gate", "auth", "failed"])

// Per-kind glyph shown in the notification title.
const KIND_GLYPH: Record<NotifyKind, string> = {
  gate: "⚑",
  auth: "⚑",
  failed: "✕",
  final_reply: "✓",
  inbox: "●",
}

const BEL = "\x07"

// Strip escape-introducer and BEL so interpolated text can't break out of the
// escape sequence we build around it.
function sanitize(text: string): string {
  return text.replace(/[\x1b\x07]/g, "")
}

function resolveStream(stream?: NotifyStream): NotifyStream {
  return stream ?? (process.stdout as unknown as NotifyStream)
}

// Decide whether an event should page the user given their preference and
// whether they're already looking at the relevant thread.
export function shouldNotify(input: {
  event: NotifyEvent
  level: NotifyLevel
  isActiveThreadVisible: boolean
}): boolean {
  const { event, level, isActiveThreadVisible } = input
  if (level === "off") return false
  // The user is already looking at this thread's conversation — even a blocking
  // gate in front of them needs no popup.
  if (isActiveThreadVisible) return false
  if (BLOCKING_KINDS.has(event.kind)) return true
  // Non-blocking kinds (final_reply, inbox) only page at the "all" level.
  return level === "all"
}

// Emit a bell + OS desktop notification for an event. Optionally also update
// the terminal title (opts.title) to flag the kind. Everything is written as a
// single escape write.
export function notify(event: NotifyEvent, opts?: { stream?: NotifyStream; title?: boolean }): void {
  const stream = resolveStream(opts?.stream)
  const glyph = KIND_GLYPH[event.kind]
  const title = `ironclaw ${glyph}`
  const body = `${sanitize(event.threadTitle)} · ${sanitize(event.summary)}`
  // BEL followed by an OSC 9 desktop notification, in one write.
  stream.write(`${BEL}\x1b]9;${title} — ${body}${BEL}`)
  if (opts?.title) {
    stream.write(`\x1b]0;${glyph} ironclaw${BEL}`)
  }
}

// Update the terminal (and tmux window) title to reflect a pending count.
export function setPendingTitle(count: number, opts?: { stream?: NotifyStream }): void {
  const stream = resolveStream(opts?.stream)
  if (count > 0) {
    stream.write(`\x1b]0;⚑ ${count} · ironclaw${BEL}`)
  } else {
    stream.write(`\x1b]0;ironclaw${BEL}`)
  }
}

// Reset the terminal title back to the plain "ironclaw" label.
export function clearTitle(opts?: { stream?: NotifyStream }): void {
  const stream = resolveStream(opts?.stream)
  stream.write(`\x1b]0;ironclaw${BEL}`)
}

// Debounce helper: within a single run, collapse repeated notifications for the
// same (threadId+kind+summary) key so one run emitting failure+projection+status
// pages the user only once. `seen(key)` returns true the first time a key is
// seen and false on immediate repeats.
export function makeNotifyGate(): { seen(key: string): boolean } {
  const keys = new Set<string>()
  return {
    seen(key: string): boolean {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    },
  }
}

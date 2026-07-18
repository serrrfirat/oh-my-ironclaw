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
  // Optional run id used only to scope the debounce key (see notifyDedupKey), so
  // an identical event in a *later* run is not swallowed as a repeat of an
  // earlier run's page. Not shown to the user.
  runId?: string | null
}

// Kinds that block progress and always warrant a page (unless the user is
// already looking at the thread, or notifications are off). "inbox" is blocking
// because it is only ever emitted for a genuinely-new pending approval on a
// background thread, and a pending approval is definitionally a blocker.
const BLOCKING_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["gate", "auth", "failed", "inbox"])

// Per-kind glyph shown in the notification title.
const KIND_GLYPH: Record<NotifyKind, string> = {
  gate: "⚑",
  auth: "⚑",
  failed: "✕",
  final_reply: "✓",
  inbox: "●",
}

const BEL = "\x07"

// Strip every control byte so interpolated server/tool text can't break out of
// the escape sequence we build around it or smuggle its own. This covers all C0
// controls (\x00-\x1f, incl. ESC \x1b and BEL \x07), DEL (\x7f), and the 8-bit
// C1 controls (\x80-\x9f). C1 bytes are honored as escape introducers by some
// terminals (e.g. \x9b = CSI, \x9d = OSC, \x90 = DCS, \x9c = ST), so an
// 8-bit-clean terminal would let \x9d…\x9c inject a title or \x9b…J clear the
// screen unless they are dropped here too.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f\x80-\x9f]/g
function sanitize(text: string): string {
  return text.replace(CONTROL_CHARS, "")
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
  // Non-blocking kinds (final_reply) only page at the "all" level.
  return level === "all"
}

// Debounce key for an event. Includes the run id so the same logical event
// repeated *within* a run collapses to one page, while an identical-looking
// event in a *later* run (a second failure, a recurring gate) is treated as new
// and still pages. Events without a run id (e.g. inbox rollups) key on
// thread+kind+summary alone.
export function notifyDedupKey(event: NotifyEvent): string {
  return `${event.threadId}|${event.kind}|${event.runId ?? ""}|${event.summary}`
}

// The count of things waiting on the user, for the terminal title flag. The
// approval inbox already counts every thread with a pending approval — including
// the active thread's own live gate — so the live gate is added only when its
// thread is not already represented in the inbox (covers the window between a
// gate appearing over SSE and the next inbox poll catching up). Deriving from a
// single set avoids the "⚑ 2 when 1 pending" double-count.
export function pendingApprovalTitleCount(input: {
  approvalCount: number
  pendingGateThreadId: string | null
  approvalThreadIds: ReadonlySet<string>
}): number {
  const { approvalCount, pendingGateThreadId, approvalThreadIds } = input
  const gateAlreadyCounted =
    pendingGateThreadId !== null && approvalThreadIds.has(pendingGateThreadId)
  const extraGate = pendingGateThreadId !== null && !gateAlreadyCounted ? 1 : 0
  return approvalCount + extraGate
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

import { describe, expect, test } from "bun:test"
import {
  clearTitle,
  makeNotifyGate,
  notify,
  setPendingTitle,
  shouldNotify,
  type NotifyEvent,
  type NotifyKind,
  type NotifyLevel,
  type NotifyStream,
} from "./notify"

function fakeStream(): NotifyStream & { chunks: string[] } {
  const chunks: string[] = []
  return {
    chunks,
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
  }
}

function event(overrides: Partial<NotifyEvent> = {}): NotifyEvent {
  return {
    kind: "gate",
    threadId: "thread-1",
    threadTitle: "Deploy pipeline",
    summary: "Approve shell command",
    ...overrides,
  }
}

describe("shouldNotify", () => {
  const blockingKinds: NotifyKind[] = ["gate", "auth", "failed"]
  const nonBlockingKinds: NotifyKind[] = ["final_reply", "inbox"]
  const levels: NotifyLevel[] = ["off", "blockers", "all"]

  test("level off never notifies", () => {
    for (const kind of [...blockingKinds, ...nonBlockingKinds]) {
      for (const isActiveThreadVisible of [false, true]) {
        expect(
          shouldNotify({ event: event({ kind }), level: "off", isActiveThreadVisible }),
        ).toBe(false)
      }
    }
  })

  test("blocking kinds notify at blockers/all when the thread is not actively visible", () => {
    for (const kind of blockingKinds) {
      for (const level of ["blockers", "all"] as NotifyLevel[]) {
        expect(
          shouldNotify({ event: event({ kind }), level, isActiveThreadVisible: false }),
        ).toBe(true)
      }
    }
  })

  test("blocking kinds still suppress when the thread is actively visible", () => {
    for (const kind of blockingKinds) {
      for (const level of ["blockers", "all"] as NotifyLevel[]) {
        expect(
          shouldNotify({ event: event({ kind }), level, isActiveThreadVisible: true }),
        ).toBe(false)
      }
    }
  })

  test("non-blocking kinds notify only at level all", () => {
    for (const kind of nonBlockingKinds) {
      expect(
        shouldNotify({ event: event({ kind }), level: "all", isActiveThreadVisible: false }),
      ).toBe(true)
      expect(
        shouldNotify({ event: event({ kind }), level: "blockers", isActiveThreadVisible: false }),
      ).toBe(false)
    }
  })

  test("non-blocking kinds suppress when actively visible even at level all", () => {
    for (const kind of nonBlockingKinds) {
      expect(
        shouldNotify({ event: event({ kind }), level: "all", isActiveThreadVisible: true }),
      ).toBe(false)
    }
  })

  test("full truth table", () => {
    const expected: Record<string, boolean> = {}
    for (const kind of [...blockingKinds, ...nonBlockingKinds]) {
      for (const level of levels) {
        for (const visible of [false, true]) {
          const blocking = blockingKinds.includes(kind)
          let want = false
          if (level !== "off" && !visible) {
            want = blocking || level === "all"
          }
          expected[`${kind}:${level}:${visible}`] = want
          expect(
            shouldNotify({ event: event({ kind }), level, isActiveThreadVisible: visible }),
          ).toBe(want)
        }
      }
    }
  })
})

describe("notify", () => {
  test("emits BEL + OSC 9 with per-kind title glyph and body in one write", () => {
    const stream = fakeStream()
    notify(event({ kind: "gate", threadTitle: "Deploy", summary: "Approve" }), { stream })
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]).toBe("\x07\x1b]9;ironclaw ⚑ — Deploy · Approve\x07")
  })

  test("uses the correct glyph per kind", () => {
    const cases: Array<[NotifyKind, string]> = [
      ["gate", "⚑"],
      ["auth", "⚑"],
      ["failed", "✕"],
      ["final_reply", "✓"],
      ["inbox", "●"],
    ]
    for (const [kind, glyph] of cases) {
      const stream = fakeStream()
      notify(event({ kind }), { stream })
      expect(stream.chunks[0]).toContain(`\x1b]9;ironclaw ${glyph} — `)
    }
  })

  test("strips control chars (ESC and BEL) from interpolated title and summary", () => {
    const stream = fakeStream()
    notify(
      event({
        threadTitle: "De\x1bploy\x07",
        summary: "run \x1b]0;evil\x07 command",
      }),
      { stream },
    )
    // Exactly two BEL: the leading bell and the OSC 9 terminator. None smuggled
    // in from the interpolated text.
    expect(stream.chunks[0].split("\x07")).toHaveLength(3)
    // No ESC other than the single OSC 9 introducer.
    expect(stream.chunks[0].split("\x1b")).toHaveLength(2)
    expect(stream.chunks[0]).toBe("\x07\x1b]9;ironclaw ⚑ — Deploy · run ]0;evil command\x07")
  })

  test("optionally updates the terminal title when opts.title is set", () => {
    const stream = fakeStream()
    notify(event({ kind: "failed" }), { stream, title: true })
    expect(stream.chunks).toHaveLength(2)
    expect(stream.chunks[1]).toBe("\x1b]0;✕ ironclaw\x07")
  })

  test("does not touch the title by default", () => {
    const stream = fakeStream()
    notify(event(), { stream })
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]).not.toContain("\x1b]0;")
  })
})

describe("setPendingTitle / clearTitle", () => {
  test("count > 0 shows a flagged count", () => {
    const stream = fakeStream()
    setPendingTitle(3, { stream })
    expect(stream.chunks[0]).toBe("\x1b]0;⚑ 3 · ironclaw\x07")
  })

  test("count 0 resets to plain ironclaw", () => {
    const stream = fakeStream()
    setPendingTitle(0, { stream })
    expect(stream.chunks[0]).toBe("\x1b]0;ironclaw\x07")
  })

  test("clearTitle resets to plain ironclaw", () => {
    const stream = fakeStream()
    clearTitle({ stream })
    expect(stream.chunks[0]).toBe("\x1b]0;ironclaw\x07")
  })
})

describe("makeNotifyGate", () => {
  test("returns true the first time a key is seen and false on repeats", () => {
    const gate = makeNotifyGate()
    const key = "thread-1|failed|run failed"
    expect(gate.seen(key)).toBe(true)
    expect(gate.seen(key)).toBe(false)
    expect(gate.seen(key)).toBe(false)
  })

  test("collapses a burst of related events from one run into one notification", () => {
    const gate = makeNotifyGate()
    const key = "thread-1|failed|Run failed: model_unavailable"
    // A single run emits failure + projection + status for the same logical event.
    const emissions = [key, key, key].filter((k) => gate.seen(k))
    expect(emissions).toHaveLength(1)
  })

  test("distinct keys each notify once", () => {
    const gate = makeNotifyGate()
    expect(gate.seen("a")).toBe(true)
    expect(gate.seen("b")).toBe(true)
    expect(gate.seen("a")).toBe(false)
    expect(gate.seen("b")).toBe(false)
  })
})

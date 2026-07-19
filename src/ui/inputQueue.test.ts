import { describe, expect, test } from "bun:test"
import {
  clearThreadQueue,
  dequeueOldest,
  enqueue,
  enqueueFront,
  isFlushEligible,
  migrateThreadQueue,
  peekOldest,
  popNewest,
  queueCount,
  type QueuedMessage,
  type QueuedMessageMap,
} from "./inputQueue"

function msg(text: string): QueuedMessage {
  return { text, attachments: [] }
}

describe("inputQueue", () => {
  test("enqueue preserves FIFO order (newest last)", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("a"))
    map = enqueue(map, "t1", msg("b"))
    map = enqueue(map, "t1", msg("c"))
    expect(map.t1?.map((m) => m.text)).toEqual(["a", "b", "c"])
  })

  test("enqueue is immutable — original map untouched", () => {
    const empty: QueuedMessageMap = {}
    const next = enqueue(empty, "t1", msg("a"))
    expect(empty).toEqual({})
    expect(next).not.toBe(empty)
  })

  test("dequeueOldest returns the front message and shrinks the queue", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("a"))
    map = enqueue(map, "t1", msg("b"))
    const result = dequeueOldest(map, "t1")
    expect(result.msg?.text).toBe("a")
    expect(result.map.t1?.map((m) => m.text)).toEqual(["b"])
  })

  test("dequeueOldest on an empty queue yields null and the same map", () => {
    const map: QueuedMessageMap = {}
    const result = dequeueOldest(map, "t1")
    expect(result.msg).toBeNull()
    expect(result.map).toBe(map)
  })

  test("dequeueOldest drops the thread key when it empties", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("only"))
    const result = dequeueOldest(map, "t1")
    expect(result.msg?.text).toBe("only")
    expect("t1" in result.map).toBe(false)
    expect(queueCount(result.map, "t1")).toBe(0)
  })

  test("popNewest returns the back message for edit/restore", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("a"))
    map = enqueue(map, "t1", msg("b"))
    map = enqueue(map, "t1", msg("c"))
    const result = popNewest(map, "t1")
    expect(result.msg?.text).toBe("c")
    expect(result.map.t1?.map((m) => m.text)).toEqual(["a", "b"])
  })

  test("popNewest on an empty queue yields null and the same map", () => {
    const map: QueuedMessageMap = {}
    const result = popNewest(map, "t1")
    expect(result.msg).toBeNull()
    expect(result.map).toBe(map)
  })

  test("queueCount reflects per-thread length", () => {
    let map: QueuedMessageMap = {}
    expect(queueCount(map, "t1")).toBe(0)
    map = enqueue(map, "t1", msg("a"))
    map = enqueue(map, "t1", msg("b"))
    expect(queueCount(map, "t1")).toBe(2)
  })

  test("peekOldest returns the front without removing it", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("a"))
    map = enqueue(map, "t1", msg("b"))
    expect(peekOldest(map, "t1")?.text).toBe("a")
    expect(queueCount(map, "t1")).toBe(2)
    expect(peekOldest({}, "missing")).toBeNull()
  })

  test("queues are isolated per thread", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("a1"))
    map = enqueue(map, "t2", msg("b1"))
    map = enqueue(map, "t1", msg("a2"))
    expect(map.t1?.map((m) => m.text)).toEqual(["a1", "a2"])
    expect(map.t2?.map((m) => m.text)).toEqual(["b1"])
    const afterT1 = dequeueOldest(map, "t1")
    expect(afterT1.map.t2?.map((m) => m.text)).toEqual(["b1"])
  })

  test("attachments ride along with the message", () => {
    const att = { filename: "a.png", mime_type: "image/png", size_bytes: 10, data_base64: "Zg==" }
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", { text: "look", attachments: [att] })
    expect(peekOldest(map, "t1")?.attachments).toEqual([att])
    expect(dequeueOldest(map, "t1").msg?.attachments).toEqual([att])
  })

  test("clearThreadQueue drops one thread's queue only", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("a"))
    map = enqueue(map, "t2", msg("b"))
    const cleared = clearThreadQueue(map, "t1")
    expect("t1" in cleared).toBe(false)
    expect(cleared.t2?.map((m) => m.text)).toEqual(["b"])
    expect(clearThreadQueue({}, "missing")).toEqual({})
  })

  test("enqueueFront prepends — a bounced flush preserves FIFO order", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "t1", msg("M"))
    map = enqueue(map, "t1", msg("N"))
    // Flush pops M (dequeueOldest); its send bounces rejected_busy → re-enqueue front.
    const afterFlush = dequeueOldest(map, "t1")
    expect(afterFlush.msg?.text).toBe("M")
    expect(afterFlush.map.t1?.map((m) => m.text)).toEqual(["N"])
    const requeued = enqueueFront(afterFlush.map, "t1", msg("M"))
    expect(requeued.t1?.map((m) => m.text)).toEqual(["M", "N"])
  })

  test("enqueueFront is immutable and seeds an empty thread", () => {
    const empty: QueuedMessageMap = {}
    const next = enqueueFront(empty, "t1", msg("a"))
    expect(empty).toEqual({})
    expect(next).not.toBe(empty)
    expect(next.t1?.map((m) => m.text)).toEqual(["a"])
  })

  test("migrateThreadQueue moves local entries onto the real thread id (older first)", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "local", msg("a"))
    map = enqueue(map, "local", msg("b"))
    const moved = migrateThreadQueue(map, "local", "thread-1")
    expect("local" in moved).toBe(false)
    expect(moved["thread-1"]?.map((m) => m.text)).toEqual(["a", "b"])
  })

  test("migrateThreadQueue merges ahead of existing destination entries", () => {
    let map: QueuedMessageMap = {}
    map = enqueue(map, "local", msg("a"))
    map = enqueue(map, "thread-1", msg("z"))
    const moved = migrateThreadQueue(map, "local", "thread-1")
    expect(moved["thread-1"]?.map((m) => m.text)).toEqual(["a", "z"])
  })

  test("migrateThreadQueue is a no-op (same ref) when there is nothing to move", () => {
    const map: QueuedMessageMap = { "thread-1": [msg("z")] }
    expect(migrateThreadQueue(map, "local", "thread-1")).toBe(map)
    expect(migrateThreadQueue(map, "thread-1", "thread-1")).toBe(map)
  })

  test("isFlushEligible requires idle + completed + non-empty", () => {
    expect(isFlushEligible({ idle: true, outcome: "completed", queued: 1 })).toBe(true)
    expect(isFlushEligible({ idle: false, outcome: "completed", queued: 1 })).toBe(false)
    expect(isFlushEligible({ idle: true, outcome: "failed", queued: 1 })).toBe(false)
    expect(isFlushEligible({ idle: true, outcome: "cancelled", queued: 1 })).toBe(false)
    expect(isFlushEligible({ idle: true, outcome: null, queued: 1 })).toBe(false)
    expect(isFlushEligible({ idle: true, outcome: "completed", queued: 0 })).toBe(false)
  })
})

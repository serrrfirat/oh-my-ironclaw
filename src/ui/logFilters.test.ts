import { describe, expect, test } from "bun:test"
import { buildLogQuery, cycleLogLevel, DEFAULT_LOG_FILTER, logLevelLabel } from "./logFilters"

describe("log level cycling", () => {
  test("cycles forward through all levels and wraps via 'all'", () => {
    expect(cycleLogLevel(undefined, 1)).toBe("trace")
    expect(cycleLogLevel("trace", 1)).toBe("debug")
    expect(cycleLogLevel("error", 1)).toBe(undefined)
  })

  test("cycles backward", () => {
    expect(cycleLogLevel(undefined, -1)).toBe("error")
    expect(cycleLogLevel("trace", -1)).toBe(undefined)
  })

  test("label for the all-levels sentinel", () => {
    expect(logLevelLabel(undefined)).toBe("all")
    expect(logLevelLabel("warn")).toBe("warn")
  })
})

describe("log query building", () => {
  test("drops empty fields and keeps set ones", () => {
    const query = buildLogQuery({ ...DEFAULT_LOG_FILTER, level: "warn", target: "  ", threadId: "t1", tail: true, follow: false })
    expect(query).toEqual({ limit: 100, level: "warn", thread_id: "t1", tail: true })
  })

  test("includes follow and cursor when set", () => {
    const query = buildLogQuery({ ...DEFAULT_LOG_FILTER, tail: false, follow: true, cursor: "c1", target: "reborn::run" })
    expect(query).toMatchObject({ follow: true, cursor: "c1", target: "reborn::run" })
    expect(query.tail).toBeUndefined()
  })
})

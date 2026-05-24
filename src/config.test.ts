import { describe, expect, test } from "bun:test"
import { readConfig } from "./config"

describe("readConfig", () => {
  test("defaults to remote mode", () => {
    const previousMode = process.env.OPEN_IRONCLAW_MODE
    let config: ReturnType<typeof readConfig>
    try {
      delete process.env.OPEN_IRONCLAW_MODE
      config = readConfig(["bun", "src/main.tsx"])
    } finally {
      if (previousMode === undefined) delete process.env.OPEN_IRONCLAW_MODE
      else process.env.OPEN_IRONCLAW_MODE = previousMode
    }

    expect(config.mode).toBe("remote")
  })

  test("accepts local mode and reborn binary override", () => {
    const config = readConfig([
      "bun",
      "src/main.tsx",
      "--mode",
      "local",
      "--reborn-bin",
      "/tmp/ironclaw-reborn",
    ])

    expect(config.mode).toBe("local")
    expect(config.rebornBin).toBe("/tmp/ironclaw-reborn")
  })

  test("rejects unknown modes", () => {
    expect(() => readConfig(["bun", "src/main.tsx", "--mode", "nearby"])).toThrow("Expected")
  })
})

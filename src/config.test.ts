import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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
    expect(config.rebornSource).toBe(null)
    expect(config.rebornFeatures).toBe(null)
  })

  test("accepts source checkout override for local CLI commands", () => {
    const config = readConfig([
      "bun",
      "src/main.tsx",
      "--mode",
      "local",
      "--reborn-source",
      "/tmp/ironclaw",
    ])

    expect(config.rebornSource).toBe("/tmp/ironclaw")
    expect(config.rebornFeatures).toBe(null)
  })

  test("accepts source feature override", () => {
    const config = readConfig([
      "bun",
      "src/main.tsx",
      "--mode",
      "local",
      "--reborn-source",
      "/tmp/ironclaw",
      "--reborn-features",
      "webui-v2-beta,extra",
    ])

    expect(config.rebornFeatures).toBe("webui-v2-beta,extra")
  })

  test("uses Ironclaw model environment as the initial model", () => {
    const previousBackend = process.env.LLM_BACKEND
    const previousModel = process.env.NEARAI_MODEL
    const previousOpenModel = process.env.OPEN_IRONCLAW_MODEL
    const previousOpenProvider = process.env.OPEN_IRONCLAW_PROVIDER
    try {
      delete process.env.OPEN_IRONCLAW_PROVIDER
      process.env.LLM_BACKEND = "nearai"
      process.env.NEARAI_MODEL = "qwen3-coder"
      delete process.env.OPEN_IRONCLAW_MODEL

      const config = readConfig(["bun", "src/main.tsx"])

      expect(config.provider).toBe("nearai")
      expect(config.model).toBe("qwen3-coder")
    } finally {
      if (previousBackend === undefined) delete process.env.LLM_BACKEND
      else process.env.LLM_BACKEND = previousBackend
      if (previousModel === undefined) delete process.env.NEARAI_MODEL
      else process.env.NEARAI_MODEL = previousModel
      if (previousOpenModel === undefined) delete process.env.OPEN_IRONCLAW_MODEL
      else process.env.OPEN_IRONCLAW_MODEL = previousOpenModel
      if (previousOpenProvider === undefined) delete process.env.OPEN_IRONCLAW_PROVIDER
      else process.env.OPEN_IRONCLAW_PROVIDER = previousOpenProvider
    }
  })

  test("uses persisted Ironclaw settings when process environment does not name a model", () => {
    const previousHome = process.env.HOME
    const previousBackend = process.env.LLM_BACKEND
    const previousNearModel = process.env.NEARAI_MODEL
    const previousOpenModel = process.env.OPEN_IRONCLAW_MODEL
    const previousOpenProvider = process.env.OPEN_IRONCLAW_PROVIDER
    const home = mkdtempSync(`${tmpdir()}/oh-my-ironclaw-config-`)
    try {
      process.env.HOME = home
      delete process.env.LLM_BACKEND
      delete process.env.NEARAI_MODEL
      delete process.env.OPEN_IRONCLAW_MODEL
      delete process.env.OPEN_IRONCLAW_PROVIDER
      mkdirSync(`${home}/.ironclaw-reborn`)
      writeFileSync(`${home}/.ironclaw-reborn/config.toml`, 'llm_backend = "nearai"\nselected_model = "qwen3-coder"\n')

      const config = readConfig(["bun", "src/main.tsx"])

      expect(config.provider).toBe("nearai")
      expect(config.model).toBe("qwen3-coder")
    } finally {
      rmSync(home, { recursive: true, force: true })
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousBackend === undefined) delete process.env.LLM_BACKEND
      else process.env.LLM_BACKEND = previousBackend
      if (previousNearModel === undefined) delete process.env.NEARAI_MODEL
      else process.env.NEARAI_MODEL = previousNearModel
      if (previousOpenModel === undefined) delete process.env.OPEN_IRONCLAW_MODEL
      else process.env.OPEN_IRONCLAW_MODEL = previousOpenModel
      if (previousOpenProvider === undefined) delete process.env.OPEN_IRONCLAW_PROVIDER
      else process.env.OPEN_IRONCLAW_PROVIDER = previousOpenProvider
    }
  })

  test("lets the TUI-specific model override provider environment", () => {
    const previousModel = process.env.NEARAI_MODEL
    const previousOpenModel = process.env.OPEN_IRONCLAW_MODEL
    try {
      process.env.NEARAI_MODEL = "qwen3-coder"
      process.env.OPEN_IRONCLAW_MODEL = "custom-tui-model"

      const config = readConfig(["bun", "src/main.tsx"])

      expect(config.model).toBe("custom-tui-model")
    } finally {
      if (previousModel === undefined) delete process.env.NEARAI_MODEL
      else process.env.NEARAI_MODEL = previousModel
      if (previousOpenModel === undefined) delete process.env.OPEN_IRONCLAW_MODEL
      else process.env.OPEN_IRONCLAW_MODEL = previousOpenModel
    }
  })

  test("rejects unknown modes", () => {
    expect(() => readConfig(["bun", "src/main.tsx", "--mode", "nearby"])).toThrow("Expected")
  })
})

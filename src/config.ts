import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"

export type ClientMode = "remote" | "local"

export type ClientConfig = {
  mode: ClientMode
  baseUrl: string
  token: string
  rebornBin: string
  rebornSource: string | null
  rebornFeatures: string | null
  provider: string
  model: string
  models: string[]
  debugEvents: boolean
}

export function readConfig(argv = Bun.argv): ClientConfig {
  const args = argv.slice(2)
  const valueAfter = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }

  const mode = parseMode(valueAfter("--mode") ?? process.env.OPEN_IRONCLAW_MODE)
  const baseUrl =
    valueAfter("--url") ??
    process.env.OPEN_IRONCLAW_URL ??
    process.env.IRONCLAW_REBORN_WEBUI_URL ??
    "http://127.0.0.1:3000"

  const token =
    valueAfter("--token") ??
    process.env.OPEN_IRONCLAW_TOKEN ??
    process.env.IRONCLAW_REBORN_WEBUI_TOKEN ??
    ""
  const rebornBin = valueAfter("--reborn-bin") ?? process.env.OPEN_IRONCLAW_REBORN_BIN ?? "ironclaw-reborn"
  const rebornSource = valueAfter("--reborn-source") ?? process.env.OPEN_IRONCLAW_REBORN_SOURCE ?? null
  const rebornFeatures = valueAfter("--reborn-features") ?? process.env.OPEN_IRONCLAW_REBORN_FEATURES ?? null

  const ironclawSettings = readIronclawSettings()
  const models = parseModelList(valueAfter("--models") ?? process.env.OPEN_IRONCLAW_MODELS)
  const provider = providerFromEnv(
    valueAfter("--provider") ??
    process.env.OPEN_IRONCLAW_PROVIDER ??
    process.env.LLM_BACKEND ??
    ironclawSettings.provider,
  )
  const model =
    valueAfter("--model") ??
    process.env.OPEN_IRONCLAW_MODEL ??
    providerModelFromEnv(provider) ??
    ironclawSettings.model ??
    models[0] ??
    defaultModelForProvider(provider)

  return {
    mode,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    rebornBin,
    rebornSource,
    rebornFeatures,
    provider,
    model,
    models,
    debugEvents: args.includes("--debug-events") || process.env.OPEN_IRONCLAW_DEBUG === "1",
  }
}

function parseMode(value?: string): ClientMode {
  if (!value) return "remote"
  if (value === "remote" || value === "local") return value
  throw new Error(`Invalid OPEN_IRONCLAW_MODE or --mode "${value}". Expected "remote" or "local".`)
}

function parseModelList(value?: string): string[] {
  const models = (value ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
  return Array.from(new Set(models))
}

function providerFromEnv(value?: string): string {
  const provider = value?.trim().toLowerCase()
  if (!provider) return "nearai"
  if (provider === "near" || provider === "near_ai") return "nearai"
  return provider
}

function providerModelFromEnv(provider: string): string | undefined {
  const value = (() => {
    switch (provider) {
      case "nearai":
        return process.env.NEARAI_MODEL
      case "openai":
        return process.env.OPENAI_MODEL
      case "anthropic":
        return process.env.ANTHROPIC_MODEL
      case "gemini":
      case "google":
        return process.env.GEMINI_MODEL ?? process.env.GOOGLE_MODEL
      case "ollama":
        return process.env.OLLAMA_MODEL
      default:
        return process.env.LLM_MODEL
    }
  })()
  return stringOrUndefined(value)
}

function defaultModelForProvider(provider: string): string {
  switch (provider) {
    case "nearai":
      return "qwen2.5-72b-instruct:free"
    case "openai":
      return "gpt-5.5"
    default:
      return "model"
  }
}

function readIronclawSettings(): { provider?: string; model?: string } {
  const baseDir = `${process.env.HOME ?? homedir()}/.ironclaw-reborn`
  const dotenv = readTextIfExists(`${baseDir}/.env`)
  const toml = readTextIfExists(`${baseDir}/config.toml`)
  const dotenvVars = dotenv ? parseDotenv(dotenv) : {}

  return {
    provider: stringOrUndefined(dotenvVars.LLM_BACKEND) ?? tomlStringValue(toml, "llm_backend"),
    model:
      stringOrUndefined(dotenvVars.NEARAI_MODEL) ??
      stringOrUndefined(dotenvVars.OPENAI_MODEL) ??
      stringOrUndefined(dotenvVars.ANTHROPIC_MODEL) ??
      stringOrUndefined(dotenvVars.GEMINI_MODEL) ??
      stringOrUndefined(dotenvVars.GOOGLE_MODEL) ??
      stringOrUndefined(dotenvVars.OLLAMA_MODEL) ??
      stringOrUndefined(dotenvVars.LLM_MODEL) ??
      tomlStringValue(toml, "selected_model"),
  }
}

function readTextIfExists(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const equals = trimmed.indexOf("=")
    if (equals <= 0) continue
    const key = trimmed.slice(0, equals).trim()
    const value = trimmed.slice(equals + 1).trim().replace(/^['"]|['"]$/g, "")
    if (key) values[key] = value
  }
  return values
}

function tomlStringValue(content: string | null, key: string): string | undefined {
  const match = content?.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"))
  return match?.[1]
}

function stringOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

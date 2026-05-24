export type ClientMode = "remote" | "local"

export type ClientConfig = {
  mode: ClientMode
  baseUrl: string
  token: string
  rebornBin: string
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

  const models = parseModelList(valueAfter("--models") ?? process.env.OPEN_IRONCLAW_MODELS)
  const model = valueAfter("--model") ?? process.env.OPEN_IRONCLAW_MODEL ?? models[0] ?? "GPT-5.5"

  return {
    mode,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    rebornBin,
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

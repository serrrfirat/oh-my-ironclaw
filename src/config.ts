export type ClientConfig = {
  baseUrl: string
  token: string
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

  const models = parseModelList(valueAfter("--models") ?? process.env.OPEN_IRONCLAW_MODELS)
  const model = valueAfter("--model") ?? process.env.OPEN_IRONCLAW_MODEL ?? models[0] ?? "GPT-5.5"

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    model,
    models: models.includes(model) ? models : [model, ...models],
    debugEvents: args.includes("--debug-events") || process.env.OPEN_IRONCLAW_DEBUG === "1",
  }
}

function parseModelList(value?: string): string[] {
  const models = (value ?? "GPT-5.5,gpt-5.3-codex")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
  return Array.from(new Set(models))
}

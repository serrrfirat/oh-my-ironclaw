export type ClientConfig = {
  baseUrl: string
  token: string
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

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    debugEvents: args.includes("--debug-events") || process.env.OPEN_IRONCLAW_DEBUG === "1",
  }
}

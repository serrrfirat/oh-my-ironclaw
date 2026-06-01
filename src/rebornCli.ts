import type { ClientConfig } from "./config"

export type CliResult = {
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

export async function runRebornCli(config: ClientConfig, args: string[]): Promise<CliResult> {
  const invocation = rebornCliInvocation(config, args)
  const proc = Bun.spawn(invocation.argv, {
    cwd: invocation.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { command: invocation.command, exitCode, stdout, stderr }
}

export function formatRebornCliCommand(config: ClientConfig, args: string[]): string {
  return rebornCliInvocation(config, args).command
}

export function formatLocalCliResult(result: CliResult): string {
  const body = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n\n")
  const suffix = result.exitCode === 0 ? "" : `\n\n(exit ${result.exitCode})`
  return `$ ${result.command}\n\n${body || "(no output)"}${suffix}`
}

function rebornCliInvocation(config: ClientConfig, args: string[]): { argv: string[]; command: string; cwd?: string } {
  if (!config.rebornSource) {
    const argv = [config.rebornBin, ...args]
    return { argv, command: shellCommand(argv) }
  }

  const argv = ["cargo", "run", "-p", "ironclaw_reborn_cli"]
  if (config.rebornFeatures) argv.push("--features", config.rebornFeatures)
  argv.push("--bin", "ironclaw-reborn", "--", ...args)
  return {
    argv,
    command: `(cd ${shellWord(config.rebornSource)} && ${shellCommand(argv)})`,
    cwd: config.rebornSource,
  }
}

function shellCommand(argv: string[]): string {
  return argv.map(shellWord).join(" ")
}

function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

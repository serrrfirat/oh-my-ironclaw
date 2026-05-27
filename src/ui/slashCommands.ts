import type { ClientMode } from "../config"

export type SlashCommandAction = "threads" | "models" | "skills" | "new-thread" | "cancel-run" | "load-older" | "settings" | "local-command" | "quit"
export type SlashCommandSource = "remote" | "local" | "tui"
export type SlashCommand = {
  name: string
  description: string
  source: SlashCommandSource
  action?: SlashCommandAction
  localArgs?: string[]
}

const REMOTE_PRODUCT_COMMANDS: SlashCommand[] = [
  { name: "/model", description: "Show or switch the active model", source: "remote", action: "models" },
  { name: "/models", description: "Show available models in the picker", source: "remote", action: "models" },
  { name: "/status", description: "Show Reborn product workflow status", source: "remote" },
  { name: "/progress", description: "Alias for Reborn product workflow status", source: "remote" },
]

const REMOTE_SKILLS_COMMAND: SlashCommand = {
  name: "/skills",
  description: "Show product workflow skill catalog",
  source: "remote",
}

const REMOTE_EXTENSION_COMMAND: SlashCommand = {
  name: "/extension",
  description: "Show product workflow extension lifecycle",
  source: "remote",
}

const LOCAL_SKILLS_COMMAND: SlashCommand = {
  name: "/skills",
  description: "Show Reborn local skill catalog",
  source: "local",
  action: "skills",
}

const LOCAL_EXTENSION_COMMAND: SlashCommand = {
  name: "/extension",
  description: "Search Reborn local extensions",
  source: "local",
  action: "local-command",
  localArgs: ["extension", "search"],
}

const LOCAL_CLI_COMMANDS: SlashCommand[] = [
  { name: "/doctor", description: "Run ironclaw-reborn doctor", source: "local", action: "local-command", localArgs: ["doctor"] },
  {
    name: "/profile",
    description: "Run ironclaw-reborn profile list",
    source: "local",
    action: "local-command",
    localArgs: ["profile", "list"],
  },
  {
    name: "/channels",
    description: "Run ironclaw-reborn channels list",
    source: "local",
    action: "local-command",
    localArgs: ["channels", "list"],
  },
  { name: "/hooks", description: "Run ironclaw-reborn hooks list", source: "local", action: "local-command", localArgs: ["hooks", "list"] },
  {
    name: "/model-status",
    description: "Run ironclaw-reborn models status",
    source: "local",
    action: "local-command",
    localArgs: ["models", "status"],
  },
  { name: "/logs", description: "Run ironclaw-reborn logs", source: "local", action: "local-command", localArgs: ["logs"] },
  {
    name: "/logs-json",
    description: "Run ironclaw-reborn logs --json",
    source: "local",
    action: "local-command",
    localArgs: ["logs", "--json"],
  },
  {
    name: "/config-path",
    description: "Run ironclaw-reborn config path",
    source: "local",
    action: "local-command",
    localArgs: ["config", "path"],
  },
  {
    name: "/traces-status",
    description: "Run ironclaw-reborn traces status",
    source: "local",
    action: "local-command",
    localArgs: ["traces", "status"],
  },
  {
    name: "/traces-queue",
    description: "Run ironclaw-reborn traces queue-status",
    source: "local",
    action: "local-command",
    localArgs: ["traces", "queue-status"],
  },
  {
    name: "/traces-credit",
    description: "Run ironclaw-reborn traces credit",
    source: "local",
    action: "local-command",
    localArgs: ["traces", "credit"],
  },
]

const TUI_CONTROL_COMMANDS: SlashCommand[] = [
  { name: "/new", description: "Start a new thread", source: "tui", action: "new-thread" },
  { name: "/settings", description: "Open settings dashboard", source: "tui", action: "settings" },
  { name: "/threads", description: "Open thread picker", source: "tui", action: "threads" },
  { name: "/history", description: "Load older timeline messages", source: "tui", action: "load-older" },
  { name: "/run-cancel", description: "Cancel the active WebChat run", source: "tui", action: "cancel-run" },
  { name: "/quit", description: "Quit this TUI", source: "tui", action: "quit" },
]

export function slashCommandsForMode(mode: ClientMode): SlashCommand[] {
  return [
    ...REMOTE_PRODUCT_COMMANDS,
    mode === "local" ? LOCAL_SKILLS_COMMAND : REMOTE_SKILLS_COMMAND,
    mode === "local" ? LOCAL_EXTENSION_COMMAND : REMOTE_EXTENSION_COMMAND,
    ...(mode === "local" ? LOCAL_CLI_COMMANDS : []),
    ...TUI_CONTROL_COMMANDS,
  ]
}

export function localCliCommandForInput(input: string, mode: ClientMode): string[] | null {
  if (mode !== "local") return null
  const trimmed = input.trim()
  if (LOCAL_EXTENSION_COMMAND.name === trimmed) return LOCAL_EXTENSION_COMMAND.localArgs ?? null
  const command = LOCAL_CLI_COMMANDS.find((candidate) => candidate.name === trimmed)
  return command?.localArgs ?? null
}

export function filteredSlashCommands(input: string, commands: SlashCommand[]): SlashCommand[] {
  if (!isSlashCommandInput(input)) return []
  const query = slashCommandQuery(input)
  if (!query) return commands
  return commands.filter((command) => {
    const haystack = `${command.name} ${command.source} ${command.description}`.toLowerCase()
    return haystack.includes(query)
  })
}

export function isSlashCommandInput(input: string): boolean {
  const trimmed = input.trimStart()
  return trimmed.startsWith("/") && !trimmed.includes(" ")
}

export function sourceColor(source: SlashCommandSource): string {
  switch (source) {
    case "remote":
      return "#8cffb0"
    case "local":
      return "#f6ad3c"
    case "tui":
      return "#7aa2f7"
  }
}

function slashCommandQuery(input: string): string {
  if (!isSlashCommandInput(input)) return ""
  return input.trimStart().slice(1).toLowerCase()
}

import type { ClientMode } from "../config"
import { sourceColor as themeSourceColor } from "./theme"

export type SlashCommandAction =
  | "threads"
  | "models"
  | "skills"
  | "extensions"
  | "automations"
  | "channels"
  | "new-thread"
  | "cancel-run"
  | "load-older"
  | "settings"
  | "logs"
  | "traces"
  | "workspace"
  | "projects"
  | "inbox"
  | "retry"
  | "delete-thread"
  | "outbound"
  | "tools"
  | "attach"
  | "save"
  | "local-command"
  | "quit"
export type SlashCommandSource = "remote" | "local" | "tui"
export type SlashCommand = {
  name: string
  description: string
  source: SlashCommandSource
  action?: SlashCommandAction
  localArgs?: string[]
}

const REMOTE_PRODUCT_COMMANDS: SlashCommand[] = [
  { name: "/model", description: "Show or switch the active model (set-provider passthrough)", source: "remote", action: "models" },
  { name: "/models", description: "Show available models in the picker", source: "remote", action: "models" },
  { name: "/status", description: "Show Reborn product workflow status", source: "remote" },
  { name: "/progress", description: "Alias for Reborn product workflow status", source: "remote" },
]

const REMOTE_SKILLS_COMMAND: SlashCommand = {
  name: "/skills",
  description: "Open the WebChat v2 skills surface",
  source: "remote",
  action: "skills",
}

const REMOTE_EXTENSION_COMMAND: SlashCommand = {
  name: "/extension",
  description: "Show product workflow extension lifecycle",
  source: "remote",
  action: "extensions",
}

const LOCAL_SKILLS_COMMAND: SlashCommand = {
  name: "/skills",
  description: "Show Reborn local skill catalog",
  source: "local",
  action: "skills",
}

const EXTENSION_OVERLAY_COMMAND: SlashCommand = {
  name: "/extension",
  description: "Show product workflow extension lifecycle",
  source: "tui",
  action: "extensions",
}

const LOCAL_EXTENSION_SEARCH_COMMAND: SlashCommand = {
  name: "/extension-search",
  description: "Search Reborn local extensions",
  source: "local",
  action: "local-command",
  localArgs: ["extension", "search"],
}

// Remote observability + files surfaces (WebChat v2 HTTP).
const REMOTE_SURFACE_COMMANDS: SlashCommand[] = [
  { name: "/logs", description: "Open the remote log viewer (level/target/thread filters, follow)", source: "remote", action: "logs" },
  { name: "/traces", description: "Open trace credit / holds / account", source: "remote", action: "traces" },
  { name: "/projects", description: "Open projects (requires reborn_projects feature)", source: "remote", action: "projects" },
]

const LOCAL_CLI_COMMANDS: SlashCommand[] = [
  { name: "/doctor", description: "Run ironclaw-reborn doctor", source: "local", action: "local-command", localArgs: ["doctor"] },
  { name: "/profile", description: "Run ironclaw-reborn profile list", source: "local", action: "local-command", localArgs: ["profile", "list"] },
  { name: "/channels-list", description: "Run ironclaw-reborn channels list", source: "local", action: "local-command", localArgs: ["channels", "list"] },
  { name: "/hooks", description: "Run ironclaw-reborn hooks list", source: "local", action: "local-command", localArgs: ["hooks", "list"] },
  { name: "/model-status", description: "Run ironclaw-reborn models status", source: "local", action: "local-command", localArgs: ["models", "status"] },
  { name: "/logs", description: "Run ironclaw-reborn logs", source: "local", action: "local-command", localArgs: ["logs"] },
  { name: "/logs-json", description: "Run ironclaw-reborn logs --json", source: "local", action: "local-command", localArgs: ["logs", "--json"] },
  { name: "/config-path", description: "Run ironclaw-reborn config path", source: "local", action: "local-command", localArgs: ["config", "path"] },
  { name: "/traces-status", description: "Run ironclaw-reborn traces status", source: "local", action: "local-command", localArgs: ["traces", "status"] },
  { name: "/traces-queue", description: "Run ironclaw-reborn traces queue-status", source: "local", action: "local-command", localArgs: ["traces", "queue-status"] },
  { name: "/traces-credit", description: "Run ironclaw-reborn traces credit", source: "local", action: "local-command", localArgs: ["traces", "credit"] },
]

const TUI_CONTROL_COMMANDS: SlashCommand[] = [
  { name: "/new", description: "Start a new thread", source: "tui", action: "new-thread" },
  { name: "/automations", description: "Open schedule automation dashboard (pause/resume/rename/delete)", source: "tui", action: "automations" },
  { name: "/channels", description: "Open connectable channel dashboard", source: "tui", action: "channels" },
  { name: "/settings", description: "Open settings dashboard", source: "tui", action: "settings" },
  { name: "/tools", description: "Open per-tool permissions", source: "tui", action: "tools" },
  { name: "/outbound", description: "Open outbound delivery defaults", source: "tui", action: "outbound" },
  { name: "/workspace", description: "Browse filesystem mounts (read-only)", source: "tui", action: "workspace" },
  { name: "/files", description: "Alias for /workspace", source: "tui", action: "workspace" },
  { name: "/threads", description: "Open thread picker", source: "tui", action: "threads" },
  { name: "/inbox", description: "Jump to the next thread needing approval", source: "tui", action: "inbox" },
  { name: "/retry", description: "Retry the last failed or cancelled run", source: "tui", action: "retry" },
  { name: "/delete-thread", description: "Delete the active thread", source: "tui", action: "delete-thread" },
  { name: "/attach", description: "Stage a local file: /attach <path>", source: "tui", action: "attach" },
  { name: "/save", description: "Save the nth attachment of the latest reply: /save <n>", source: "tui", action: "save" },
  { name: "/history", description: "Load older timeline messages", source: "tui", action: "load-older" },
  { name: "/run-cancel", description: "Cancel the active WebChat run", source: "tui", action: "cancel-run" },
  { name: "/quit", description: "Quit this TUI", source: "tui", action: "quit" },
]

export function slashCommandsForMode(mode: ClientMode): SlashCommand[] {
  return [
    ...REMOTE_PRODUCT_COMMANDS,
    mode === "local" ? LOCAL_SKILLS_COMMAND : REMOTE_SKILLS_COMMAND,
    mode === "local" ? EXTENSION_OVERLAY_COMMAND : REMOTE_EXTENSION_COMMAND,
    ...(mode === "local" ? [] : REMOTE_SURFACE_COMMANDS),
    ...(mode === "local" ? LOCAL_CLI_COMMANDS : []),
    ...(mode === "local" ? [LOCAL_EXTENSION_SEARCH_COMMAND] : []),
    ...TUI_CONTROL_COMMANDS,
  ]
}

export function localCliCommandForInput(input: string, mode: ClientMode): string[] | null {
  if (mode !== "local") return null
  const trimmed = input.trim()
  if (LOCAL_EXTENSION_SEARCH_COMMAND.name === trimmed) return LOCAL_EXTENSION_SEARCH_COMMAND.localArgs ?? null
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
  return themeSourceColor(source)
}

function slashCommandQuery(input: string): string {
  if (!isSlashCommandInput(input)) return ""
  return input.trimStart().slice(1).toLowerCase()
}

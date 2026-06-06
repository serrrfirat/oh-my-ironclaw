import type { ClientConfig } from "../config"
import type { LlmConfigSnapshot } from "../gateway/types"

export type SettingsSection = "Profile" | "Connection" | "Providers" | "Extensions" | "Channels" | "Skills" | "Automations" | "Tools" | "Approvals"
type SettingsMenuItem = { label: SettingsSection; meta: string }

const SETTINGS_SECTIONS: SettingsSection[] = ["Profile", "Connection", "Providers", "Extensions", "Channels", "Skills", "Automations", "Tools", "Approvals"]

export const SETTINGS_SECTION_COUNT = SETTINGS_SECTIONS.length

export function settingsSectionAt(index: number): SettingsSection {
  return SETTINGS_SECTIONS[wrapIndex(index, SETTINGS_SECTIONS.length)] ?? SETTINGS_SECTIONS[0]
}

export function SettingsSurface({
  config,
  connected,
  height,
  selectedIndex,
  selectedModel,
  selectedProvider,
  llmConfig,
  llmConfigError,
  extensionCount = 0,
  extensionSetupCount = 0,
  automationCount = 0,
  channelCount = 0,
  skillCount = 0,
  skillsAvailable = false,
  status,
  width,
}: {
  config: ClientConfig
  connected: boolean
  height: number
  selectedIndex: number
  selectedModel: string
  selectedProvider: string
  llmConfig?: LlmConfigSnapshot | null
  llmConfigError?: string | null
  extensionCount?: number
  extensionSetupCount?: number
  automationCount?: number
  channelCount?: number
  skillCount?: number
  skillsAvailable?: boolean
  status: string
  width: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const narrow = width < 86
  const profileName = config.mode === "local" ? "local-dev" : "remote"
  const serverState = connected ? "online" : "offline"
  const authState = config.token ? "present" : "missing"
  const sourcePath = config.rebornSource ?? "not configured"
  const menu: SettingsMenuItem[] = SETTINGS_SECTIONS.map((section) => ({
    label: section,
    meta: settingsMenuMeta(section, {
      automationCount,
      channelCount,
      config,
      extensionCount,
      extensionSetupCount,
      selectedModel,
      selectedProvider,
      skillCount,
      skillsAvailable,
      serverState,
      profileName,
    }),
  }))
  const selectedItem = menu[wrapIndex(selectedIndex, menu.length)] ?? menu[0]

  if (narrow) {
    return (
      <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <SettingsHeader width={contentWidth} />
        <box style={{ height: 1 }} />
        <text fg="#f2f2f2">Settings</text>
        <box style={{ height: 1 }} />
        <SettingsMenu items={menu} selectedIndex={selectedIndex} width={contentWidth} />
        <box style={{ height: 1 }} />
        <SettingsPreview
          authState={authState}
          config={config}
          connected={connected}
          item={selectedItem}
          llmConfig={llmConfig}
          llmConfigError={llmConfigError}
          automationCount={automationCount}
          channelCount={channelCount}
          extensionCount={extensionCount}
          extensionSetupCount={extensionSetupCount}
          skillCount={skillCount}
          skillsAvailable={skillsAvailable}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          sourcePath={sourcePath}
          status={status}
          width={contentWidth}
        />
        <SettingsFooter width={contentWidth} />
      </box>
    )
  }

  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SettingsHeader width={contentWidth} />
      <box style={{ height: 1 }} />
      <box style={{ width: contentWidth, flexDirection: "row" }}>
        <box style={{ width: 32, flexDirection: "column" }}>
          <text fg="#f2f2f2">Settings</text>
          <box style={{ height: 1 }} />
          <SettingsMenu items={menu} selectedIndex={selectedIndex} width={32} />
        </box>
        <box style={{ width: 2 }} />
        <SettingsPreview
          authState={authState}
          config={config}
          connected={connected}
          item={selectedItem}
          llmConfig={llmConfig}
          llmConfigError={llmConfigError}
          automationCount={automationCount}
          channelCount={channelCount}
          extensionCount={extensionCount}
          extensionSetupCount={extensionSetupCount}
          skillCount={skillCount}
          skillsAvailable={skillsAvailable}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          sourcePath={sourcePath}
          status={status}
          width={Math.max(1, contentWidth - 34)}
        />
      </box>
      <SettingsFooter width={contentWidth} />
    </box>
  )
}

function SettingsHeader({ width }: { width: number }) {
  return (
    <box style={{ width, height: 2, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#8cffb0">ironclaw</text>
        <text fg="#777777">{padEnd("", Math.max(1, width - 18))}</text>
        <text fg="#d0d0d0">settings</text>
      </box>
      <SettingsDivider width={width} />
    </box>
  )
}

function SettingsMenu({
  items,
  selectedIndex,
  width,
}: {
  items: SettingsMenuItem[]
  selectedIndex: number
  width: number
}) {
  return (
    <box style={{ width, flexDirection: "column" }}>
      {items.map((item, index) => (
        <SettingsMenuRow
          key={item.label}
          item={item}
          selected={index === selectedIndex}
          width={width}
        />
      ))}
    </box>
  )
}

function SettingsMenuRow({
  item,
  selected,
  width,
}: {
  item: SettingsMenuItem
  selected: boolean
  width: number
}) {
  const metaWidth = Math.max(0, width - 15)
  return (
    <box style={{ width, height: 1, flexDirection: "row", backgroundColor: selected ? "#141414" : "#050505" }}>
      <box style={{ width: 1, backgroundColor: selected ? "#2ee66b" : "#050505" }} />
      <text fg={selected ? "#2ee66b" : "#707070"}>{selected ? "> " : "  "}</text>
      <text fg={selected ? "#f2f2f2" : "#d0d0d0"}>{padEnd(item.label, 12)}</text>
      <text fg="#777777">{truncate(item.meta, metaWidth)}</text>
    </box>
  )
}

function SettingsPreview({
  authState,
  config,
  connected,
  item,
  llmConfig,
  llmConfigError,
  automationCount,
  channelCount,
  extensionCount,
  extensionSetupCount,
  skillCount,
  skillsAvailable,
  selectedModel,
  selectedProvider,
  sourcePath,
  status,
  width,
}: {
  authState: string
  config: ClientConfig
  connected: boolean
  item: SettingsMenuItem
  llmConfig?: LlmConfigSnapshot | null
  llmConfigError?: string | null
  automationCount: number
  channelCount: number
  extensionCount: number
  extensionSetupCount: number
  skillCount: number
  skillsAvailable: boolean
  selectedModel: string
  selectedProvider: string
  sourcePath: string
  status: string
  width: number
}) {
  const fields = settingsFieldsForSection(item.label, {
    authState,
    config,
    connected,
    llmConfig,
    llmConfigError,
    automationCount,
    channelCount,
    extensionCount,
    extensionSetupCount,
    skillCount,
    skillsAvailable,
    selectedModel,
    selectedProvider,
    sourcePath,
    status,
  })

  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <text fg="#f2f2f2">{item.label}</text>
      <box style={{ height: 1 }} />
      {fields.map((field) => (
        <SettingsField key={field.label} label={field.label} value={field.value} width={width - 4} />
      ))}
      <box style={{ height: 1 }} />
      <text fg="#777777">{truncate(settingsActionHint(item.label), Math.max(1, width - 4))}</text>
    </box>
  )
}

function settingsMenuMeta(
  section: SettingsSection,
  context: {
    automationCount: number
    channelCount: number
    config: ClientConfig
    extensionCount: number
    extensionSetupCount: number
    profileName: string
    skillCount: number
    skillsAvailable: boolean
    selectedModel: string
    selectedProvider: string
    serverState: string
  },
) {
  const { automationCount, channelCount, config, extensionCount, extensionSetupCount, profileName, selectedModel, selectedProvider, serverState, skillCount, skillsAvailable } = context
  switch (section) {
    case "Connection":
      return serverState
    case "Providers":
      return selectedProvider ? `${selectedModel} · ${selectedProvider}` : selectedModel
    case "Extensions":
      return extensionSetupCount ? `${extensionSetupCount} need setup` : `${extensionCount} installed`
    case "Channels":
      return `${channelCount} connectable`
    case "Skills":
      return skillsAvailable ? `${skillCount} local` : "backend pending"
    case "Automations":
      return `${automationCount} schedules`
    case "Tools":
      return config.mode === "local" ? "local + remote" : "remote"
    case "Approvals":
      return "ask"
    default:
      return profileName
  }
}

function settingsFieldsForSection(
  section: SettingsSection,
  context: {
    authState: string
    config: ClientConfig
    connected: boolean
    llmConfig?: LlmConfigSnapshot | null
    llmConfigError?: string | null
    automationCount: number
    channelCount: number
    extensionCount: number
    extensionSetupCount: number
    skillCount: number
    skillsAvailable: boolean
    selectedModel: string
    selectedProvider: string
    sourcePath: string
    status: string
  },
) {
  const { authState, automationCount, channelCount, config, connected, extensionCount, extensionSetupCount, llmConfig, llmConfigError, selectedModel, selectedProvider, skillCount, skillsAvailable, sourcePath, status } = context
  switch (section) {
    case "Connection":
      return [
        { label: "server", value: config.baseUrl },
        { label: "state", value: connected ? "online" : "offline" },
        { label: "status", value: status },
        { label: "mode", value: config.mode },
      ]
    case "Providers":
      if (llmConfigError) {
        return [
          { label: "error", value: llmConfigError },
          { label: "active", value: selectedModel },
          { label: "provider", value: selectedProvider || "unknown" },
          { label: "source", value: "WebChat v2 LLM providers" },
        ]
      }
      return [
        { label: "active", value: selectedModel },
        { label: "provider", value: llmConfig?.active?.provider_id || selectedProvider || "unknown" },
        { label: "providers", value: String(llmConfig?.providers?.length ?? 0) },
        { label: "api keys", value: providerKeySummary(llmConfig) },
        { label: "models", value: providerModelSummary(llmConfig) },
        { label: "source", value: "WebChat v2 LLM providers" },
      ]
    case "Extensions":
      return [
        { label: "installed", value: String(extensionCount) },
        { label: "need setup", value: String(extensionSetupCount) },
        { label: "registry", value: "WebChat v2 extension registry" },
        { label: "setup", value: "install · activate · secret/field input" },
      ]
    case "Channels":
      return [
        { label: "connectable", value: String(channelCount) },
        { label: "source", value: "WebChat v2 connectable channels" },
        { label: "setup", value: "backend returns pairing/action metadata" },
        { label: "submit", value: "pairing submit route pending" },
      ]
    case "Skills":
      return [
        { label: "configured", value: skillsAvailable ? String(skillCount) : "unknown" },
        { label: "source", value: skillsAvailable ? sourcePath : "WebChat v2 skills endpoint pending" },
        { label: "browse", value: skillsAvailable ? "local skills list" : "not available in remote mode" },
        { label: "setup", value: "waiting on v2 skills install/remove endpoint" },
      ]
    case "Automations":
      return [
        { label: "schedules", value: String(automationCount) },
        { label: "source", value: "WebChat v2 automations" },
        { label: "view", value: "schedule dashboard" },
        { label: "mutations", value: "backend route pending in TUI" },
      ]
    case "Tools":
      return [
        { label: "remote", value: "product workflow commands" },
        { label: "local", value: config.mode === "local" ? "CLI commands enabled" : "disabled" },
        { label: "source", value: sourcePath },
        { label: "approval", value: "ask" },
      ]
    case "Approvals":
      return [
        { label: "default", value: "ask" },
        { label: "shell", value: "ask" },
        { label: "writes", value: "ask" },
        { label: "network", value: "ask" },
      ]
    default:
      return [
        { label: "mode", value: config.mode },
        { label: "model", value: selectedModel },
        { label: "server", value: `${connected ? "online" : "offline"} · ${config.baseUrl}` },
        { label: "auth", value: `env token · ${authState}` },
        { label: "source", value: sourcePath },
        { label: "status", value: status },
      ]
  }
}

function SettingsField({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = 18
  const valueWidth = Math.max(8, width - labelWidth - 1)
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg="#8a8a8a">{padEnd(label, labelWidth)}</text>
      <text fg="#d0d0d0">{truncate(value, valueWidth)}</text>
    </box>
  )
}

function settingsActionHint(section: SettingsSection): string {
  switch (section) {
    case "Providers":
      return "enter opens provider setup"
    case "Extensions":
      return "enter opens extension setup"
    case "Channels":
      return "enter opens channel connection metadata"
    case "Skills":
      return "enter opens skills browser when available"
    case "Automations":
      return "enter opens automations"
    case "Connection":
      return "connection is read-only"
    default:
      return "read-only summary"
  }
}

function providerKeySummary(llmConfig?: LlmConfigSnapshot | null): string {
  const providers = llmConfig?.providers ?? []
  if (providers.length === 0) return "unknown"
  const required = providers.filter((provider) => provider.api_key_required).length
  const set = providers.filter((provider) => provider.api_key_set).length
  return `${set} set · ${required} required`
}

function providerModelSummary(llmConfig?: LlmConfigSnapshot | null): string {
  const activeProvider = llmConfig?.providers?.find((provider) => provider.active)
  if (!activeProvider) return "unknown"
  const activeModel = activeProvider.active_model || llmConfig?.active?.model || activeProvider.default_model
  return `${activeModel} · ${activeProvider.can_list_models ? "listable" : "fixed"}`
}

function SettingsFooter({ width }: { width: number }) {
  return (
    <box style={{ width, height: 1, flexDirection: "row", marginTop: 1 }}>
      <text fg="#777777">{truncate("up/down section · enter open · esc back", width)}</text>
    </box>
  )
}

function SettingsDivider({ width }: { width: number }) {
  return (
    <box style={{ height: 1 }}>
      <text fg="#1f1f1f">{padEnd("", width).replaceAll(" ", "-")}</text>
    </box>
  )
}

function padEnd(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length)
}

function truncate(value: string, width: number) {
  if (width <= 0) return ""
  if (value.length <= width) return value
  if (width <= 3) return ".".repeat(width)
  return `${value.slice(0, width - 3)}...`
}

function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

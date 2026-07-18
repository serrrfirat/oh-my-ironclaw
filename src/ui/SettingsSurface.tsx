import type { ClientConfig } from "../config"
import type { LlmConfigSnapshot, SessionResponse } from "../gateway/types"
import { theme } from "./theme"
import { Field, padEnd, Surface, truncate, wrapIndex } from "./pixel"

export type SettingsSection = "Profile" | "Connection" | "Providers" | "Extensions" | "Channels" | "Skills" | "Automations" | "Tools" | "Outbound"
type SettingsMenuItem = { label: SettingsSection; meta: string }

const SETTINGS_SECTIONS: SettingsSection[] = ["Profile", "Connection", "Providers", "Extensions", "Channels", "Skills", "Automations", "Tools", "Outbound"]

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
  session,
  operatorOnly = false,
  extensionCount = 0,
  extensionSetupCount = 0,
  automationCount = 0,
  channelCount = 0,
  skillCount = 0,
  skillsRemote = false,
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
  session?: SessionResponse | null
  operatorOnly?: boolean
  extensionCount?: number
  extensionSetupCount?: number
  automationCount?: number
  channelCount?: number
  skillCount?: number
  skillsRemote?: boolean
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
      skillsRemote,
      serverState,
      profileName,
      operatorOnly,
    }),
  }))
  const selectedItem = menu[wrapIndex(selectedIndex, menu.length)] ?? menu[0]

  const preview = (
    <SettingsPreview
      authState={authState}
      config={config}
      connected={connected}
      item={selectedItem}
      llmConfig={llmConfig}
      llmConfigError={llmConfigError}
      session={session}
      operatorOnly={operatorOnly}
      automationCount={automationCount}
      channelCount={channelCount}
      extensionCount={extensionCount}
      extensionSetupCount={extensionSetupCount}
      skillCount={skillCount}
      skillsRemote={skillsRemote}
      selectedModel={selectedModel}
      selectedProvider={selectedProvider}
      sourcePath={sourcePath}
      status={status}
      width={narrow ? contentWidth : Math.max(1, contentWidth - 34)}
    />
  )

  return (
    <Surface title="settings" width={width} height={height}>
      {narrow ? (
        <box style={{ flexDirection: "column" }}>
          <text fg={theme.textStrong}>Settings</text>
          <box style={{ height: 1 }} />
          <SettingsMenu items={menu} selectedIndex={selectedIndex} width={contentWidth} />
          <box style={{ height: 1 }} />
          {preview}
        </box>
      ) : (
        <box style={{ width: contentWidth, flexDirection: "row" }}>
          <box style={{ width: 32, flexDirection: "column" }}>
            <text fg={theme.textStrong}>Settings</text>
            <box style={{ height: 1 }} />
            <SettingsMenu items={menu} selectedIndex={selectedIndex} width={32} />
          </box>
          <box style={{ width: 2 }} />
          {preview}
        </box>
      )}
      <SettingsFooter width={contentWidth} />
    </Surface>
  )
}

function SettingsMenu({ items, selectedIndex, width }: { items: SettingsMenuItem[]; selectedIndex: number; width: number }) {
  return (
    <box style={{ width, flexDirection: "column" }}>
      {items.map((item, index) => (
        <SettingsMenuRow key={item.label} item={item} selected={index === wrapIndex(selectedIndex, items.length)} width={width} />
      ))}
    </box>
  )
}

function SettingsMenuRow({ item, selected, width }: { item: SettingsMenuItem; selected: boolean; width: number }) {
  const metaWidth = Math.max(0, width - 15)
  return (
    <box style={{ width, height: 1, flexDirection: "row", backgroundColor: selected ? theme.accentSoftBg : theme.bg }}>
      <box style={{ width: 1, backgroundColor: selected ? theme.accent : theme.border }} />
      <text fg={selected ? theme.accent : theme.textMuted}>{selected ? " › " : "   "}</text>
      <text fg={selected ? theme.accentText : theme.text}>{padEnd(item.label, 12)}</text>
      <text fg={theme.textFaint}>{truncate(item.meta, metaWidth)}</text>
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
  session,
  operatorOnly,
  automationCount,
  channelCount,
  extensionCount,
  extensionSetupCount,
  skillCount,
  skillsRemote,
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
  session?: SessionResponse | null
  operatorOnly: boolean
  automationCount: number
  channelCount: number
  extensionCount: number
  extensionSetupCount: number
  skillCount: number
  skillsRemote: boolean
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
    session,
    operatorOnly,
    automationCount,
    channelCount,
    extensionCount,
    extensionSetupCount,
    skillCount,
    skillsRemote,
    selectedModel,
    selectedProvider,
    sourcePath,
    status,
  })

  return (
    <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <text fg={theme.textStrong}>{item.label}</text>
      <box style={{ height: 1 }} />
      {fields.map((field) => (
        <Field key={field.label} label={field.label} value={field.value} width={width - 4} labelWidth={18} />
      ))}
      <box style={{ height: 1 }} />
      <text fg={theme.textFaint}>{truncate(settingsActionHint(item.label), Math.max(1, width - 4))}</text>
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
    skillsRemote: boolean
    selectedModel: string
    selectedProvider: string
    serverState: string
    operatorOnly: boolean
  },
) {
  const { automationCount, channelCount, config, extensionCount, extensionSetupCount, profileName, selectedModel, selectedProvider, serverState, skillCount, skillsRemote, operatorOnly } = context
  switch (section) {
    case "Connection":
      return serverState
    case "Providers":
      return operatorOnly ? "operator only" : selectedProvider ? `${selectedModel} · ${selectedProvider}` : selectedModel
    case "Extensions":
      return extensionSetupCount ? `${extensionSetupCount} need setup` : `${extensionCount} installed`
    case "Channels":
      return `${channelCount} connectable`
    case "Skills":
      return skillsRemote ? `${skillCount} remote` : `${skillCount} local`
    case "Automations":
      return `${automationCount} schedules`
    case "Tools":
      return config.mode === "local" ? "local commands" : "permissions"
    case "Outbound":
      return "delivery defaults"
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
    session?: SessionResponse | null
    operatorOnly: boolean
    automationCount: number
    channelCount: number
    extensionCount: number
    extensionSetupCount: number
    skillCount: number
    skillsRemote: boolean
    selectedModel: string
    selectedProvider: string
    sourcePath: string
    status: string
  },
) {
  const { authState, automationCount, channelCount, config, connected, extensionCount, extensionSetupCount, llmConfig, llmConfigError, session, operatorOnly, selectedModel, selectedProvider, skillCount, skillsRemote, sourcePath, status } = context
  switch (section) {
    case "Connection":
      return [
        { label: "server", value: config.baseUrl },
        { label: "state", value: connected ? "online" : "offline" },
        { label: "status", value: status },
        { label: "mode", value: config.mode },
        { label: "tenant", value: session?.tenant_id ?? "unknown" },
        { label: "user", value: session?.user_id ?? "unknown" },
      ]
    case "Providers":
      if (operatorOnly) {
        return [
          { label: "access", value: "operator capability required" },
          { label: "active", value: selectedModel },
          { label: "provider", value: selectedProvider || "unknown" },
        ]
      }
      if (llmConfigError) {
        return [
          { label: "error", value: llmConfigError },
          { label: "active", value: selectedModel },
          { label: "provider", value: selectedProvider || "unknown" },
        ]
      }
      return [
        { label: "active", value: selectedModel },
        { label: "provider", value: llmConfig?.active?.provider_id || selectedProvider || "unknown" },
        { label: "providers", value: String(llmConfig?.providers?.length ?? 0) },
        { label: "api keys", value: providerKeySummary(llmConfig) },
        { label: "models", value: providerModelSummary(llmConfig) },
      ]
    case "Extensions":
      return [
        { label: "installed", value: String(extensionCount) },
        { label: "need setup", value: String(extensionSetupCount) },
        { label: "registry", value: "WebChat v2 extension registry" },
      ]
    case "Channels":
      return [
        { label: "connectable", value: String(channelCount) },
        { label: "source", value: "WebChat v2 connectable channels" },
      ]
    case "Skills":
      return [
        { label: "configured", value: String(skillCount) },
        { label: "mode", value: skillsRemote ? "remote HTTP" : "local CLI" },
        { label: "actions", value: skillsRemote ? "install · remove · auto-activate" : "browse local catalog" },
      ]
    case "Automations":
      return [
        { label: "schedules", value: String(automationCount) },
        { label: "actions", value: "pause · resume · rename · delete" },
      ]
    case "Tools":
      return [
        { label: "permissions", value: "per-tool default/allow/ask/disabled" },
        { label: "auto-approve", value: session?.features.global_auto_approve ? "on" : "off" },
        { label: "local", value: config.mode === "local" ? "CLI commands enabled" : "disabled" },
      ]
    case "Outbound":
      return [
        { label: "final reply", value: "select delivery target" },
        { label: "modality", value: "server default (read-only)" },
        { label: "source", value: "WebChat v2 outbound preferences" },
      ]
    default:
      return [
        { label: "mode", value: config.mode },
        { label: "model", value: selectedModel },
        { label: "server", value: `${connected ? "online" : "offline"} · ${config.baseUrl}` },
        { label: "auth", value: `env token · ${authState}` },
        { label: "features", value: session ? `projects ${session.features.reborn_projects ? "on" : "off"}` : "unknown" },
        { label: "source", value: sourcePath },
        { label: "status", value: status },
      ]
  }
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
      return "enter opens skills browser"
    case "Automations":
      return "enter opens automations (pause/resume/rename/delete)"
    case "Tools":
      return "enter opens per-tool permissions"
    case "Outbound":
      return "enter opens delivery defaults"
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
      <text fg={theme.textFaint}>{truncate("up/down section · enter open · esc back", width)}</text>
    </box>
  )
}

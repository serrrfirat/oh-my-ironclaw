import type { ClientConfig } from "../config"

type SettingsSection = "Profile" | "Connection" | "Models" | "Secrets" | "Tools" | "Approvals"
type SettingsMenuItem = { label: SettingsSection; meta: string }

const SETTINGS_SECTIONS: SettingsSection[] = ["Profile", "Connection", "Models", "Secrets", "Tools", "Approvals"]

export const SETTINGS_SECTION_COUNT = SETTINGS_SECTIONS.length

export function SettingsSurface({
  config,
  connected,
  height,
  selectedIndex,
  selectedModel,
  status,
  width,
}: {
  config: ClientConfig
  connected: boolean
  height: number
  selectedIndex: number
  selectedModel: string
  status: string
  width: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const narrow = width < 86
  const profileName = config.mode === "local" ? "local-dev" : "remote"
  const serverState = connected ? "online" : "offline"
  const authState = config.token ? "present" : "missing"
  const secretCount = config.token ? "1 set · 2 unknown" : "1 missing · 2 unknown"
  const sourcePath = config.rebornSource ?? "not configured"
  const menu: SettingsMenuItem[] = SETTINGS_SECTIONS.map((section) => ({
    label: section,
    meta: settingsMenuMeta(section, {
      config,
      secretCount,
      selectedModel,
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
          selectedModel={selectedModel}
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
          selectedModel={selectedModel}
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
  selectedModel,
  sourcePath,
  status,
  width,
}: {
  authState: string
  config: ClientConfig
  connected: boolean
  item: SettingsMenuItem
  selectedModel: string
  sourcePath: string
  status: string
  width: number
}) {
  const fields = settingsFieldsForSection(item.label, {
    authState,
    config,
    connected,
    selectedModel,
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
      <text fg="#777777">{truncate("enter opens this section once settings are wired", Math.max(1, width - 4))}</text>
    </box>
  )
}

function settingsMenuMeta(
  section: SettingsSection,
  context: {
    config: ClientConfig
    profileName: string
    secretCount: string
    selectedModel: string
    serverState: string
  },
) {
  const { config, profileName, secretCount, selectedModel, serverState } = context
  switch (section) {
    case "Connection":
      return serverState
    case "Models":
      return selectedModel
    case "Secrets":
      return secretCount
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
    selectedModel: string
    sourcePath: string
    status: string
  },
) {
  const { authState, config, connected, selectedModel, sourcePath, status } = context
  switch (section) {
    case "Connection":
      return [
        { label: "server", value: config.baseUrl },
        { label: "state", value: connected ? "online" : "offline" },
        { label: "status", value: status },
        { label: "mode", value: config.mode },
      ]
    case "Models":
      return [
        { label: "active", value: selectedModel },
        { label: "provider", value: "OpenAI" },
        { label: "command", value: "/model" },
        { label: "source", value: "Reborn product workflow" },
      ]
    case "Secrets":
      return [
        { label: "webui token", value: authState },
        { label: "user id", value: "unknown" },
        { label: "storage", value: "env preview only" },
        { label: "reveal", value: "not wired" },
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
      <text fg="#1f1f1f">{padEnd("", width).replaceAll(" ", "─")}</text>
    </box>
  )
}

function padEnd(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length)
}

function truncate(value: string, width: number) {
  if (width <= 0) return ""
  if (value.length <= width) return value
  if (width <= 1) return "…".slice(0, width)
  return `${value.slice(0, width - 1)}…`
}

function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

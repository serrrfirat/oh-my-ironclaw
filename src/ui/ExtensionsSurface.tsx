import type { ExtensionInfo, ExtensionRegistryEntry, ExtensionSetupResponse } from "../gateway/types"
import { theme } from "./theme"
import { Surface } from "./pixel"

export type ExtensionRow =
  | { source: "installed"; id: string; name: string; kind: string; description: string; installed: true; active: boolean; needsSetup: boolean; status: string; version?: string | null; info: ExtensionInfo }
  | { source: "registry"; id: string; name: string; kind: string; description: string; installed: false; active: false; needsSetup: false; status: string; version?: string | null; entry: ExtensionRegistryEntry }

const EXTENSION_VISIBLE_LIMIT = 14

export function extensionRows(extensions: ExtensionInfo[], registry: ExtensionRegistryEntry[]): ExtensionRow[] {
  const installedIds = new Set(extensions.map((extension) => extension.package_ref.id))
  return [
    ...extensions.map((extension): ExtensionRow => ({
      source: "installed",
      id: extension.package_ref.id,
      name: extension.display_name,
      kind: extension.kind,
      description: extension.description,
      installed: true,
      active: Boolean(extension.active),
      needsSetup: Boolean(extension.needs_setup),
      status: extension.activation_error || extension.activation_status || extension.onboarding_state || (extension.active ? "active" : "installed"),
      version: extension.version,
      info: extension,
    })),
    ...registry.filter((entry) => !entry.installed && !installedIds.has(entry.package_ref.id)).map((entry): ExtensionRow => ({
      source: "registry",
      id: entry.package_ref.id,
      name: entry.display_name,
      kind: entry.kind,
      description: entry.description,
      installed: false,
      active: false,
      needsSetup: false,
      status: "available",
      version: entry.version,
      entry,
    })),
  ].sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
}

export function ExtensionsSurface({
  actionMessage,
  error,
  height,
  loading,
  rows,
  selectedIndex,
  setup,
  setupInput,
  setupInputLabel,
  width,
}: {
  actionMessage?: string | null
  error?: string | null
  height: number
  loading: boolean
  rows: ExtensionRow[]
  selectedIndex: number
  setup?: ExtensionSetupResponse | null
  setupInput?: string
  setupInputLabel?: string | null
  width: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const selected = rows[wrapIndex(selectedIndex, rows.length)] ?? null
  const installed = rows.filter((row) => row.installed).length
  const available = rows.length - installed
  const listWidth = Math.min(58, Math.max(36, Math.floor(contentWidth * 0.46)))
  const narrow = width < 94
  return (
    <Surface title="extensions" meta={loading ? "loading" : `${installed} installed · ${available} available`} width={width} height={height}>
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : actionMessage ? <text fg={theme.accentText}>{truncate(actionMessage, contentWidth)}</text> : null}
      {narrow ? (
        <box style={{ flexDirection: "column" }}>
          <ExtensionList rows={rows} selectedIndex={selectedIndex} width={contentWidth} />
          <box style={{ height: 1 }} />
          <ExtensionDetail row={selected} setup={setup} setupInput={setupInput} setupInputLabel={setupInputLabel} width={contentWidth} />
        </box>
      ) : (
        <box style={{ flexDirection: "row", width: contentWidth }}>
          <ExtensionList rows={rows} selectedIndex={selectedIndex} width={listWidth} />
          <box style={{ width: 2 }} />
          <ExtensionDetail row={selected} setup={setup} setupInput={setupInput} setupInputLabel={setupInputLabel} width={Math.max(1, contentWidth - listWidth - 2)} />
        </box>
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.textMuted}>{truncate("up/down select · enter install/activate · s setup · x remove · r refresh · esc back", contentWidth)}</text>
    </Surface>
  )
}

function ExtensionList({ rows, selectedIndex, width }: { rows: ExtensionRow[]; selectedIndex: number; width: number }) {
  const selected = wrapIndex(selectedIndex, rows.length)
  const start = clamp(selected - EXTENSION_VISIBLE_LIMIT + 1, 0, Math.max(0, rows.length - EXTENSION_VISIBLE_LIMIT))
  const visible = rows.slice(start, start + EXTENSION_VISIBLE_LIMIT)
  return (
    <box style={{ width, flexDirection: "column" }}>
      {visible.length ? visible.map((row, index) => (
        <ExtensionListRow key={`${row.source}-${row.id}`} row={row} selected={start + index === selected} width={width} />
      )) : (
        <box style={{ height: 3, backgroundColor: theme.bgCode, paddingLeft: 2, paddingTop: 1 }}>
          <text fg={theme.textMuted}>No extensions</text>
        </box>
      )}
    </box>
  )
}

function ExtensionListRow({ row, selected, width }: { row: ExtensionRow; selected: boolean; width: number }) {
  const marker = selected ? ">" : row.active ? "*" : " "
  const suffix = row.installed ? row.status : "available"
  return (
    <box style={{ height: 1, flexDirection: "row", backgroundColor: selected ? theme.bgSoft : theme.bgCode, paddingLeft: 2, paddingRight: 2 }}>
      <text fg={selected || row.active ? theme.accent : theme.textMuted}>{marker} </text>
      <text fg={selected ? theme.textStrong : theme.text}>{truncate(row.name, Math.max(8, width - suffix.length - 10))}</text>
      <text fg={rowStatusColor(row)}> {truncate(suffix, 12)}</text>
    </box>
  )
}

function ExtensionDetail({
  row,
  setup,
  setupInput,
  setupInputLabel,
  width,
}: {
  row: ExtensionRow | null
  setup?: ExtensionSetupResponse | null
  setupInput?: string
  setupInputLabel?: string | null
  width: number
}) {
  if (!row) {
    return (
      <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
        <text fg={theme.textMuted}>Select an extension</text>
      </box>
    )
  }
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <text fg={theme.textStrong}>{truncate(row.name, Math.max(1, width - 4))}</text>
      <text fg={theme.textMuted}>{truncate(row.description || "No description", Math.max(1, width - 4))}</text>
      <box style={{ height: 1 }} />
      <Field label="package" value={row.id} width={width - 4} />
      <Field label="kind" value={row.kind} width={width - 4} />
      <Field label="state" value={row.status} width={width - 4} />
      <Field label="version" value={row.version || "unknown" } width={width - 4} />
      {row.installed ? <Field label="tools" value={row.info.tools?.join(", ") || "none"} width={width - 4} /> : null}
      <box style={{ height: 1 }} />
      <text fg={theme.textMuted}>{truncate(actionHint(row), Math.max(1, width - 4))}</text>
      {setup ? <SetupPreview setup={setup} setupInput={setupInput} setupInputLabel={setupInputLabel} width={width - 4} /> : null}
    </box>
  )
}

function SetupPreview({
  setup,
  setupInput,
  setupInputLabel,
  width,
}: {
  setup: ExtensionSetupResponse
  setupInput?: string
  setupInputLabel?: string | null
  width: number
}) {
  const secrets = setup.secrets ?? []
  const fields = setup.fields ?? []
  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <text fg={theme.warn}>setup · {setup.phase || "unknown"}</text>
      {secrets.map((secret) => (
        <Field key={`secret-${secret.name}`} label={secret.name} value={secret.provided ? "provided" : secret.optional ? "optional" : "required"} width={width} />
      ))}
      {fields.map((field) => (
        <Field key={`field-${field.name}`} label={field.label || field.name} value={field.value || (field.required ? "required" : "optional")} width={width} />
      ))}
      {setupInputLabel ? (
        <box style={{ height: 3, flexDirection: "column", backgroundColor: theme.accentSoftBg, paddingLeft: 1, paddingRight: 1, marginTop: 1 }}>
          <text fg={theme.textMuted}>{truncate(setupInputLabel, width - 2)}</text>
          <text fg={theme.textStrong}>{truncate(setupInput ? "*".repeat(setupInput.length) : "type value, enter submit", width - 2)}</text>
        </box>
      ) : null}
    </box>
  )
}

function Field({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = 14
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg={theme.textMuted}>{padEnd(label, labelWidth)}</text>
      <text fg={theme.text}>{truncate(value, Math.max(1, width - labelWidth))}</text>
    </box>
  )
}

function actionHint(row: ExtensionRow): string {
  if (!row.installed) return "enter installs from registry"
  if (row.needsSetup) return "s opens setup, enter activates after setup"
  if (!row.active) return "enter activates, x removes"
  return "active, x removes"
}

function rowStatusColor(row: ExtensionRow): string {
  if (row.active) return theme.ok
  if (row.needsSetup || row.status.includes("required")) return theme.warn
  if (row.status.includes("error") || row.status.includes("failed")) return theme.danger
  return theme.textMuted
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

import type { ExtensionInfo, ExtensionRegistryEntry, ExtensionSetupResponse } from "../gateway/types"

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
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="extensions" meta={loading ? "loading" : `${installed} installed · ${available} available`} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg="#f08a8a">{truncate(error, contentWidth)}</text> : actionMessage ? <text fg="#8cffb0">{truncate(actionMessage, contentWidth)}</text> : null}
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
      <text fg="#777777">{truncate("up/down select · enter install/activate · s setup · x remove · r refresh · esc back", contentWidth)}</text>
    </box>
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
        <box style={{ height: 3, backgroundColor: "#101010", paddingLeft: 2, paddingTop: 1 }}>
          <text fg="#777777">No extensions</text>
        </box>
      )}
    </box>
  )
}

function ExtensionListRow({ row, selected, width }: { row: ExtensionRow; selected: boolean; width: number }) {
  const marker = selected ? ">" : row.active ? "*" : " "
  const suffix = row.installed ? row.status : "available"
  return (
    <box style={{ height: 1, flexDirection: "row", backgroundColor: selected ? "#1b1b1b" : "#101010", paddingLeft: 2, paddingRight: 2 }}>
      <text fg={selected || row.active ? "#2ee66b" : "#707070"}>{marker} </text>
      <text fg={selected ? "#f2f2f2" : "#d0d0d0"}>{truncate(row.name, Math.max(8, width - suffix.length - 10))}</text>
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
      <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
        <text fg="#777777">Select an extension</text>
      </box>
    )
  }
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <text fg="#f2f2f2">{truncate(row.name, Math.max(1, width - 4))}</text>
      <text fg="#777777">{truncate(row.description || "No description", Math.max(1, width - 4))}</text>
      <box style={{ height: 1 }} />
      <Field label="package" value={row.id} width={width - 4} />
      <Field label="kind" value={row.kind} width={width - 4} />
      <Field label="state" value={row.status} width={width - 4} />
      <Field label="version" value={row.version || "unknown" } width={width - 4} />
      {row.installed ? <Field label="tools" value={row.info.tools?.join(", ") || "none"} width={width - 4} /> : null}
      <box style={{ height: 1 }} />
      <text fg="#8a8a8a">{truncate(actionHint(row), Math.max(1, width - 4))}</text>
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
      <text fg="#f0b45f">setup · {setup.phase || "unknown"}</text>
      {secrets.map((secret) => (
        <Field key={`secret-${secret.name}`} label={secret.name} value={secret.provided ? "provided" : secret.optional ? "optional" : "required"} width={width} />
      ))}
      {fields.map((field) => (
        <Field key={`field-${field.name}`} label={field.label || field.name} value={field.value || (field.required ? "required" : "optional")} width={width} />
      ))}
      {setupInputLabel ? (
        <box style={{ height: 3, flexDirection: "column", backgroundColor: "#0b1118", paddingLeft: 1, paddingRight: 1, marginTop: 1 }}>
          <text fg="#8a8a8a">{truncate(setupInputLabel, width - 2)}</text>
          <text fg="#f2f2f2">{truncate(setupInput ? "*".repeat(setupInput.length) : "type value, enter submit", width - 2)}</text>
        </box>
      ) : null}
    </box>
  )
}

function Field({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = 14
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg="#8a8a8a">{padEnd(label, labelWidth)}</text>
      <text fg="#d0d0d0">{truncate(value, Math.max(1, width - labelWidth))}</text>
    </box>
  )
}

function SurfaceHeader({ title, meta, width }: { title: string; meta: string; width: number }) {
  return (
    <box style={{ width, height: 2, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#8cffb0">ironclaw</text>
        <text fg="#777777">{padEnd("", Math.max(1, width - title.length - meta.length - 12))}</text>
        <text fg="#d0d0d0">{title}</text>
        <text fg="#777777"> · {meta}</text>
      </box>
      <text fg="#1f1f1f">{padEnd("", width).replaceAll(" ", "-")}</text>
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
  if (row.active) return "#8cffb0"
  if (row.needsSetup || row.status.includes("required")) return "#ffb887"
  if (row.status.includes("error") || row.status.includes("failed")) return "#f08a8a"
  return "#777777"
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

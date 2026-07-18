import type { SettingsToolEntry, SettingsToolPermissionState } from "../gateway/types"
import type { Tone } from "./theme"

// Ordered cycle for the per-tool permission control (enter cycles forward).
export const TOOL_PERMISSION_CYCLE: SettingsToolPermissionState[] = [
  "default",
  "always_allow",
  "ask_each_time",
  "disabled",
]

export function nextToolPermission(state: SettingsToolPermissionState): SettingsToolPermissionState {
  const index = TOOL_PERMISSION_CYCLE.indexOf(state)
  const next = TOOL_PERMISSION_CYCLE[(index + 1) % TOOL_PERMISSION_CYCLE.length]
  return next ?? "default"
}

export function toolPermissionLabel(state: SettingsToolPermissionState): string {
  switch (state) {
    case "always_allow":
      return "always allow"
    case "ask_each_time":
      return "ask each time"
    case "disabled":
      return "disabled"
    default:
      return "default"
  }
}

export function toolPermissionTone(state: SettingsToolPermissionState): Tone {
  switch (state) {
    case "always_allow":
      return "ok"
    case "ask_each_time":
      return "warn"
    case "disabled":
      return "danger"
    default:
      return "muted"
  }
}

// Coerce an arbitrary settings entry value into a known permission state.
export function toolPermissionStateFromValue(value: unknown): SettingsToolPermissionState {
  const key = typeof value === "string" ? value : readNestedState(value)
  const normalized = key?.trim().toLowerCase().replace(/[-\s]+/g, "_")
  if (normalized && (TOOL_PERMISSION_CYCLE as string[]).includes(normalized)) {
    return normalized as SettingsToolPermissionState
  }
  return "default"
}

function readNestedState(value: unknown): string | undefined {
  if (value && typeof value === "object" && "state" in value) {
    const state = (value as { state?: unknown }).state
    if (typeof state === "string") return state
  }
  return undefined
}

// A tool row derived from a settings/tools entry. `capabilityId` is the id used
// for the per-tool POST; `permission` is the cycled state.
export type ToolPermissionRow = {
  capabilityId: string
  label: string
  permission: SettingsToolPermissionState
  mutable: boolean
  source: string
}

// Extract per-tool permission rows from the generic settings entries. Entries
// whose key names a tool capability permission become rows; anything else
// (global flags, diagnostics) is ignored.
export function toolPermissionRows(entries: SettingsToolEntry[]): ToolPermissionRow[] {
  const rows: ToolPermissionRow[] = []
  for (const entry of entries) {
    const capabilityId = toolCapabilityId(entry.key)
    if (!capabilityId) continue
    rows.push({
      capabilityId,
      label: capabilityId,
      permission: toolPermissionStateFromValue(entry.value),
      mutable: entry.mutable !== false,
      source: entry.source ?? "default",
    })
  }
  return rows
}

// Recognizes keys shaped like "tools.<id>.permission" or "tool_permission.<id>"
// or a bare capability id, returning the capability id or null.
export function toolCapabilityId(key: string): string | null {
  if (!key) return null
  const dotted = key.match(/^tools?\.(.+?)\.permission$/)
  if (dotted?.[1]) return dotted[1]
  const prefixed = key.match(/^tool_permission\.(.+)$/)
  if (prefixed?.[1]) return prefixed[1]
  if (key === "global_auto_approve" || key === "auto_approve" || key.includes(".")) return null
  return key
}

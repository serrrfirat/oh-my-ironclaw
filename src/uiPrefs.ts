// Client-side TUI preferences persisted as JSON under the same
// ~/.ironclaw-reborn directory the config reader uses. Parsing is pure and
// total (bad/missing files fall back to defaults); load/save touch the
// filesystem and accept an injectable path so tests never touch a real home.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { homedir } from "node:os"
import type { NotifyLevel } from "./ui/notify"

export interface UiPrefs {
  notifyLevel: NotifyLevel
}

export const DEFAULT_UI_PREFS: UiPrefs = { notifyLevel: "blockers" }

const NOTIFY_LEVELS: readonly NotifyLevel[] = ["off", "blockers", "all"]

export function prefsPath(): string {
  return `${process.env.HOME ?? homedir()}/.ironclaw-reborn/tui-prefs.json`
}

function isNotifyLevel(value: unknown): value is NotifyLevel {
  return typeof value === "string" && (NOTIFY_LEVELS as readonly string[]).includes(value)
}

// Parse raw prefs JSON into a total UiPrefs. Any parse error or unknown value
// falls back to the defaults so a corrupt file never crashes the TUI.
export function parseUiPrefs(raw: string | null | undefined): UiPrefs {
  if (!raw) return { ...DEFAULT_UI_PREFS }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      notifyLevel: isNotifyLevel(parsed.notifyLevel) ? parsed.notifyLevel : DEFAULT_UI_PREFS.notifyLevel,
    }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

// Serialize prefs to the JSON string written to disk.
export function serializeUiPrefs(prefs: UiPrefs): string {
  return `${JSON.stringify(prefs, null, 2)}\n`
}

export function loadUiPrefs(path: string = prefsPath()): UiPrefs {
  try {
    if (!existsSync(path)) return { ...DEFAULT_UI_PREFS }
    return parseUiPrefs(readFileSync(path, "utf8"))
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

// Persist the notify level, merging over whatever raw prefs already exist on
// disk so unrelated (e.g. future) keys survive. Best-effort: a write failure is
// swallowed — the in-memory level still applies for the session.
export function saveNotifyLevel(level: NotifyLevel, path: string = prefsPath()): void {
  try {
    const existing = readExistingRaw(path)
    const next = { ...existing, notifyLevel: level }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  } catch {
    // best-effort persistence
  }
}

function readExistingRaw(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

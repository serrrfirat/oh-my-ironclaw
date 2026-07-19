import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_UI_PREFS,
  loadUiPrefs,
  parseUiPrefs,
  saveNotifyLevel,
  serializeUiPrefs,
} from "./uiPrefs"

describe("parseUiPrefs", () => {
  test("valid notify level round-trips", () => {
    expect(parseUiPrefs('{"notifyLevel":"all"}')).toEqual({ notifyLevel: "all" })
    expect(parseUiPrefs('{"notifyLevel":"off"}')).toEqual({ notifyLevel: "off" })
  })

  test("unknown / missing / malformed fall back to defaults", () => {
    expect(parseUiPrefs(null)).toEqual(DEFAULT_UI_PREFS)
    expect(parseUiPrefs("")).toEqual(DEFAULT_UI_PREFS)
    expect(parseUiPrefs("not json")).toEqual(DEFAULT_UI_PREFS)
    expect(parseUiPrefs('{"notifyLevel":"loud"}')).toEqual(DEFAULT_UI_PREFS)
    expect(parseUiPrefs('{"notifyLevel":42}')).toEqual(DEFAULT_UI_PREFS)
  })

  test("default level is blockers", () => {
    expect(DEFAULT_UI_PREFS.notifyLevel).toBe("blockers")
  })
})

describe("serializeUiPrefs", () => {
  test("emits parseable JSON", () => {
    const raw = serializeUiPrefs({ notifyLevel: "all" })
    expect(parseUiPrefs(raw)).toEqual({ notifyLevel: "all" })
  })
})

describe("loadUiPrefs / saveNotifyLevel", () => {
  test("missing file loads defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "ic-prefs-"))
    try {
      expect(loadUiPrefs(join(dir, "nope.json"))).toEqual(DEFAULT_UI_PREFS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("save then load round-trips and creates the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ic-prefs-"))
    const path = join(dir, "nested", "tui-prefs.json")
    try {
      saveNotifyLevel("all", path)
      expect(existsSync(path)).toBe(true)
      expect(loadUiPrefs(path)).toEqual({ notifyLevel: "all" })
      saveNotifyLevel("off", path)
      expect(loadUiPrefs(path)).toEqual({ notifyLevel: "off" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("save merges over existing on-disk prefs, preserving unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "ic-prefs-"))
    const path = join(dir, "tui-prefs.json")
    try {
      writeFileSync(path, JSON.stringify({ notifyLevel: "blockers", futureKey: "keep" }))
      saveNotifyLevel("all", path)
      const onDisk = JSON.parse(readFileSync(path, "utf8"))
      expect(onDisk.notifyLevel).toBe("all")
      expect(onDisk.futureKey).toBe("keep")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

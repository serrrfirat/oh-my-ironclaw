import { describe, expect, test } from "bun:test"
import { activeProfileFromCliResult, activeProfileFromJson, isLocalDevYoloProfile, shouldUseLocalDevYoloSplash } from "./rebornProfile"

describe("reborn profile detection", () => {
  test("reads the active profile from profile list JSON", () => {
    const stdout = JSON.stringify([
      { name: "local-sandbox", active: false },
      { name: "local", active: true },
    ])

    expect(activeProfileFromJson(stdout)).toBe("local")
  })

  test("ignores failed CLI results", () => {
    expect(activeProfileFromCliResult({ exitCode: 1, stdout: JSON.stringify([{ name: "local", active: true }]) })).toBe(null)
  })

  test("treats unsandboxed local profile as local dev yolo", () => {
    expect(isLocalDevYoloProfile("local")).toBe(true)
    expect(isLocalDevYoloProfile("local-sandbox")).toBe(false)
    expect(isLocalDevYoloProfile("LocalDevYolo")).toBe(true)
  })

  test("uses yolo splash for local mode unless the CLI reports sandbox", () => {
    expect(shouldUseLocalDevYoloSplash("local", null)).toBe(true)
    expect(shouldUseLocalDevYoloSplash("local", "local")).toBe(true)
    expect(shouldUseLocalDevYoloSplash("local", "local-sandbox")).toBe(false)
    expect(shouldUseLocalDevYoloSplash("remote", "local")).toBe(false)
  })
})

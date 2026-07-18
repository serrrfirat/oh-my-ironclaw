import { describe, expect, test } from "bun:test"
import type { SettingsToolEntry } from "../gateway/types"
import {
  nextToolPermission,
  toolCapabilityId,
  toolPermissionLabel,
  toolPermissionRows,
  toolPermissionStateFromValue,
} from "./toolPermissions"

describe("tool permission cycling", () => {
  test("cycles default → always_allow → ask_each_time → disabled → default", () => {
    expect(nextToolPermission("default")).toBe("always_allow")
    expect(nextToolPermission("always_allow")).toBe("ask_each_time")
    expect(nextToolPermission("ask_each_time")).toBe("disabled")
    expect(nextToolPermission("disabled")).toBe("default")
  })

  test("labels are human readable", () => {
    expect(toolPermissionLabel("always_allow")).toBe("always allow")
    expect(toolPermissionLabel("ask_each_time")).toBe("ask each time")
    expect(toolPermissionLabel("default")).toBe("default")
  })

  test("coerces arbitrary values to a known state", () => {
    expect(toolPermissionStateFromValue("always_allow")).toBe("always_allow")
    expect(toolPermissionStateFromValue("ask-each-time")).toBe("ask_each_time")
    expect(toolPermissionStateFromValue({ state: "disabled" })).toBe("disabled")
    expect(toolPermissionStateFromValue("nonsense")).toBe("default")
    expect(toolPermissionStateFromValue(42)).toBe("default")
  })
})

describe("tool capability id extraction", () => {
  test("parses dotted and prefixed permission keys", () => {
    expect(toolCapabilityId("tools.shell.permission")).toBe("shell")
    expect(toolCapabilityId("tool.web_search.permission")).toBe("web_search")
    expect(toolCapabilityId("tool_permission.fs_write")).toBe("fs_write")
    expect(toolCapabilityId("shell")).toBe("shell")
  })

  test("ignores global flags and unrelated dotted keys", () => {
    expect(toolCapabilityId("global_auto_approve")).toBeNull()
    expect(toolCapabilityId("auto_approve")).toBeNull()
    expect(toolCapabilityId("diagnostics.some.thing")).toBeNull()
  })
})

describe("tool permission rows", () => {
  test("derives mutable per-tool rows from settings entries", () => {
    const entries: SettingsToolEntry[] = [
      { key: "tools.shell.permission", value: "always_allow", source: "user", redacted: false, mutable: true },
      { key: "global_auto_approve", value: true, source: "user", redacted: false, mutable: true },
      { key: "tools.fs_write.permission", value: { state: "disabled" }, source: "default", redacted: false, mutable: false },
    ]
    const rows = toolPermissionRows(entries)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ capabilityId: "shell", permission: "always_allow", mutable: true })
    expect(rows[1]).toMatchObject({ capabilityId: "fs_write", permission: "disabled", mutable: false })
  })
})

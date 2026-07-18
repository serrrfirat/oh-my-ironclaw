import { describe, expect, test } from "bun:test"
import { localCliCommandForInput, slashCommandsForMode } from "./slashCommands"

describe("slash commands", () => {
  test("uses product workflow skills command in remote mode", () => {
    expect(slashCommandsForMode("remote")).toContainEqual(expect.objectContaining({
      name: "/skills",
      source: "remote",
    }))
  })

  test("uses product workflow extension command in remote mode", () => {
    expect(slashCommandsForMode("remote")).toContainEqual(expect.objectContaining({
      name: "/extension",
      source: "remote",
      action: "extensions",
    }))
  })

  test("exposes automations overlay command in every mode", () => {
    for (const mode of ["remote", "local"] as const) {
      expect(slashCommandsForMode(mode)).toContainEqual(expect.objectContaining({
        name: "/automations",
        source: "tui",
        action: "automations",
      }))
    }
  })

  test("exposes channels overlay command in every mode", () => {
    for (const mode of ["remote", "local"] as const) {
      expect(slashCommandsForMode(mode)).toContainEqual(expect.objectContaining({
        name: "/channels",
        source: "tui",
        action: "channels",
      }))
    }
  })

  test("exposes TUI new thread command in every mode", () => {
    for (const mode of ["remote", "local"] as const) {
      expect(slashCommandsForMode(mode)).toContainEqual(expect.objectContaining({
        name: "/new",
        source: "tui",
        action: "new-thread",
      }))
    }
  })

  test("uses local Reborn skill catalog command in local mode", () => {
    const commands = slashCommandsForMode("local")

    expect(commands).toContainEqual(expect.objectContaining({
      name: "/skills",
      source: "local",
      action: "skills",
    }))
    expect(commands.filter((command) => command.name === "/skills")).toHaveLength(1)
  })

  test("uses extension overlay command in local mode", () => {
    const commands = slashCommandsForMode("local")

    expect(commands).toContainEqual(expect.objectContaining({
      name: "/extension",
      source: "tui",
      action: "extensions",
    }))
    expect(commands.filter((command) => command.name === "/extension")).toHaveLength(1)
  })

  test("keeps local Reborn extension search as explicit command in local mode", () => {
    expect(slashCommandsForMode("local")).toContainEqual(expect.objectContaining({
      name: "/extension-search",
      source: "local",
      action: "local-command",
      localArgs: ["extension", "search"],
    }))
  })

  test("does not map local mode skills input to a transcript CLI command", () => {
    expect(localCliCommandForInput("/skills", "local")).toBeNull()
  })

  test("does not map extension overlay input to local CLI args", () => {
    expect(localCliCommandForInput("/extension", "local")).toBeNull()
  })

  test("maps local extension search input to local CLI args", () => {
    expect(localCliCommandForInput("/extension-search", "local")).toEqual(["extension", "search"])
  })

  test("keeps local channels CLI as an explicit alternate command", () => {
    expect(localCliCommandForInput("/channels-list", "local")).toEqual(["channels", "list"])
    expect(localCliCommandForInput("/channels", "local")).toBeNull()
  })

  test("does not intercept skills in remote mode", () => {
    expect(localCliCommandForInput("/skills", "remote")).toBeNull()
  })

  test("does not intercept extension in remote mode", () => {
    expect(localCliCommandForInput("/extension", "remote")).toBeNull()
  })

  test("remote mode exposes observability + files surfaces", () => {
    const commands = slashCommandsForMode("remote")
    expect(commands).toContainEqual(expect.objectContaining({ name: "/logs", source: "remote", action: "logs" }))
    expect(commands).toContainEqual(expect.objectContaining({ name: "/traces", source: "remote", action: "traces" }))
    expect(commands).toContainEqual(expect.objectContaining({ name: "/projects", source: "remote", action: "projects" }))
    expect(commands).toContainEqual(expect.objectContaining({ name: "/skills", source: "remote", action: "skills" }))
  })

  test("local mode keeps /logs as a CLI passthrough, not the remote surface", () => {
    expect(localCliCommandForInput("/logs", "local")).toEqual(["logs"])
    const commands = slashCommandsForMode("local")
    expect(commands.some((command) => command.name === "/logs" && command.action === "logs")).toBe(false)
  })

  test("exposes new TUI control commands in every mode", () => {
    for (const mode of ["remote", "local"] as const) {
      const commands = slashCommandsForMode(mode)
      for (const name of ["/inbox", "/retry", "/delete-thread", "/workspace", "/outbound", "/tools", "/attach", "/save"]) {
        expect(commands.some((command) => command.name === name && command.source === "tui")).toBe(true)
      }
    }
  })
})

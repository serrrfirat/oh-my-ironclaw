import { describe, expect, test } from "bun:test"
import { localCliCommandForInput, slashCommandsForMode } from "./slashCommands"

describe("slash commands", () => {
  test("exposes Reborn skill catalog commands in local mode", () => {
    const commands = slashCommandsForMode("local")

    expect(commands).toContainEqual(expect.objectContaining({
      name: "/skills",
      localArgs: ["skills", "list"],
    }))
    expect(commands).toContainEqual(expect.objectContaining({
      name: "/skills-verbose",
      localArgs: ["skills", "list", "--verbose"],
    }))
    expect(commands).toContainEqual(expect.objectContaining({
      name: "/skills-json",
      localArgs: ["skills", "list", "--json", "--verbose"],
    }))
  })

  test("maps skill catalog command input to local CLI args", () => {
    expect(localCliCommandForInput("/skills", "local")).toEqual(["skills", "list"])
    expect(localCliCommandForInput("/skills-verbose", "local")).toEqual(["skills", "list", "--verbose"])
    expect(localCliCommandForInput("/skills-json", "local")).toEqual(["skills", "list", "--json", "--verbose"])
  })

  test("does not expose local skill commands in remote mode", () => {
    expect(slashCommandsForMode("remote").some((command) => command.name.startsWith("/skills"))).toBe(false)
    expect(localCliCommandForInput("/skills", "remote")).toBeNull()
  })
})

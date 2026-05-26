import { describe, expect, test } from "bun:test"
import { localCliCommandForInput, slashCommandsForMode } from "./slashCommands"

describe("slash commands", () => {
  test("uses product workflow skills command in remote mode", () => {
    expect(slashCommandsForMode("remote")).toContainEqual(expect.objectContaining({
      name: "/skills",
      source: "remote",
    }))
  })

  test("uses local Reborn skill catalog command in local mode", () => {
    const commands = slashCommandsForMode("local")

    expect(commands).toContainEqual(expect.objectContaining({
      name: "/skills",
      source: "local",
      localArgs: ["skills", "list"],
    }))
    expect(commands.filter((command) => command.name === "/skills")).toHaveLength(1)
  })

  test("maps local mode skills input to local CLI args", () => {
    expect(localCliCommandForInput("/skills", "local")).toEqual(["skills", "list"])
  })

  test("does not intercept skills in remote mode", () => {
    expect(localCliCommandForInput("/skills", "remote")).toBeNull()
  })
})

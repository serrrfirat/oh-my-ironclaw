import { describe, expect, test } from "bun:test"
import { parseModelListResponse, selectedModelFromSwitchResponse, withSelectedModel } from "./modelCommands"

describe("model command responses", () => {
  test("parses active and available models from the Reborn command response", () => {
    const parsed = parseModelListResponse(
      "Active model: gpt-5\n\nAvailable models:\n  gpt-5 (active)\n  gpt-4o\n\nUse /model <name> to switch.",
    )

    expect(parsed).toEqual({
      activeModel: "gpt-5",
      models: ["gpt-5", "gpt-4o"],
    })
  })

  test("keeps active model even when the provider cannot list models", () => {
    const parsed = parseModelListResponse("Active model: gpt-5\n\nCould not fetch model list. Use /model <name> to switch.")

    expect(parsed).toEqual({
      activeModel: "gpt-5",
      models: ["gpt-5"],
    })
  })

  test("parses model switch acknowledgements", () => {
    expect(selectedModelFromSwitchResponse("Switched model to: gpt-4o")).toBe("gpt-4o")
    expect(selectedModelFromSwitchResponse("Model preference set to: claude-sonnet-4-5 (per-user)")).toBe("claude-sonnet-4-5")
  })

  test("adds selected model to an empty or missing model list", () => {
    expect(withSelectedModel([], "gpt-5")).toEqual(["gpt-5"])
    expect(withSelectedModel(["gpt-4o"], "gpt-5")).toEqual(["gpt-5", "gpt-4o"])
  })
})

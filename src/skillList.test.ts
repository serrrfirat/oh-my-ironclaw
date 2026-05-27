import { describe, expect, test } from "bun:test"
import { filterSkills, parseSkillListJson, parseSkillListOutput, parseSkillListText, skillDetailPath } from "./skillList"

describe("skill list", () => {
  test("parses Reborn CLI skills JSON", () => {
    const parsed = parseSkillListJson(JSON.stringify({
      configured: 1,
      source: "reborn-local-dev",
      details: {
        profile: "local-dev",
        reborn_home: "/tmp/reborn-home",
        local_dev_root: "/tmp/reborn-home/local-dev",
        owner_id: "reborn-cli",
      },
      skills: [{
        name: "catalog-helper",
        version: "1.2.3",
        description: "catalog helper",
        source: "user",
        keywords: ["catalog"],
        tags: ["local-dev"],
        requires_skills: ["companion-helper"],
      }],
    }))

    expect(parsed.configured).toBe(1)
    expect(parsed.source).toBe("reborn-local-dev")
    expect(parsed.details.localDevRoot).toBe("/tmp/reborn-home/local-dev")
    expect(parsed.skills[0]).toEqual({
      name: "catalog-helper",
      version: "1.2.3",
      description: "catalog helper",
      source: "user",
      keywords: ["catalog"],
      tags: ["local-dev"],
      requiresSkills: ["companion-helper"],
      content: undefined,
      path: undefined,
    })
  })

  test("parses JSON embedded in wrapper output", () => {
    const parsed = parseSkillListOutput(`building local CLI\n{"configured":1,"source":"reborn-local-dev","skills":[{"name":"json-helper","description":"json helper","source":"user"}]}\n`)

    expect(parsed.configured).toBe(1)
    expect(parsed.skills[0]?.name).toBe("json-helper")
  })

  test("falls back to text output when brace-shaped diagnostics are not JSON", () => {
    const parsed = parseSkillListOutput(`IronClaw Reborn skills
configured: 1
source: reborn-local-dev
warning: ignored metadata {not-json}
- text-helper (user)
  description: text helper
`)

    expect(parsed.configured).toBe(1)
    expect(parsed.skills[0]?.name).toBe("text-helper")
    expect(parsed.skills[0]?.description).toBe("text helper")
  })

  test("falls back to text output from Reborn CLI skills list", () => {
    const parsed = parseSkillListText(`IronClaw Reborn skills
configured: 1
source: reborn-local-dev
profile: local-dev
reborn_home: /tmp/reborn-home
local_dev_root: /tmp/reborn-home/local-dev
owner_id: reborn-cli
- catalog-helper (user)
  description: catalog helper
  version: 1.2.3
  keywords: catalog, helper
  tags: local-dev
  requires_skills: companion-helper
`)

    expect(parsed.configured).toBe(1)
    expect(parsed.source).toBe("reborn-local-dev")
    expect(parsed.details.localDevRoot).toBe("/tmp/reborn-home/local-dev")
    expect(parsed.skills[0]).toEqual({
      name: "catalog-helper",
      version: "1.2.3",
      description: "catalog helper",
      source: "user",
      keywords: ["catalog", "helper"],
      tags: ["local-dev"],
      requiresSkills: ["companion-helper"],
    })
  })

  test("filters skills across name, description, and metadata", () => {
    const skills = parseSkillListJson(JSON.stringify({
      skills: [
        { name: "review-helper", description: "prepare pull requests", source: "user", keywords: ["pr"] },
        { name: "sprite-tools", description: "asset export", source: "system", tags: ["art"] },
      ],
    })).skills

    expect(filterSkills(skills, "pull").map((skill) => skill.name)).toEqual(["review-helper"])
    expect(filterSkills(skills, "art").map((skill) => skill.name)).toEqual(["sprite-tools"])
  })

  test("resolves selected local-dev skill markdown path from CLI details", () => {
    expect(skillDetailPath(
      { name: "review-helper", version: "", description: "", source: "user", keywords: [], tags: [], requiresSkills: [] },
      { localDevRoot: "/tmp/reborn-home/local-dev" },
    )).toBe("/tmp/reborn-home/local-dev/skills/review-helper/SKILL.md")

    expect(skillDetailPath(
      { name: "system-helper", version: "", description: "", source: "system", keywords: [], tags: [], requiresSkills: [] },
      { localDevRoot: "/tmp/reborn-home/local-dev" },
    )).toBe("/tmp/reborn-home/local-dev/system/skills/system-helper/SKILL.md")
  })
})

export type SkillListItem = {
  name: string
  version: string
  description: string
  source: string
  keywords: string[]
  tags: string[]
  requiresSkills: string[]
  content?: string
  path?: string
}

export type SkillListResult = {
  configured: number
  source: string
  skills: SkillListItem[]
  details: {
    rebornHome?: string
    localDevRoot?: string
    ownerId?: string
    profile?: string
  }
}

export function parseSkillListJson(stdout: string): SkillListResult {
  const value = JSON.parse(stdout) as Record<string, unknown>
  const skills = Array.isArray(value.skills) ? value.skills.map(parseSkillItem) : []
  return {
    configured: numberValue(value.configured, skills.length),
    source: stringValue(value.source),
    skills,
    details: parseDetails(value.details),
  }
}

export function filterSkills(skills: SkillListItem[], query: string): SkillListItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return skills
  return skills.filter((skill) => {
    const haystack = [
      skill.name,
      skill.description,
      skill.source,
      skill.version,
      ...skill.keywords,
      ...skill.tags,
      ...skill.requiresSkills,
    ].join(" ").toLowerCase()
    return haystack.includes(needle)
  })
}

export function skillDetailPath(skill: SkillListItem, details: SkillListResult["details"]): string | null {
  if (skill.path) return skill.path
  if (!details.localDevRoot || !safePathSegment(skill.name)) return null
  const root = details.localDevRoot.replace(/\/+$/, "")
  if (skill.source === "system") return `${root}/system/skills/${skill.name}/SKILL.md`
  return `${root}/skills/${skill.name}/SKILL.md`
}

function parseSkillItem(value: unknown): SkillListItem {
  const item = isRecord(value) ? value : {}
  return {
    name: stringValue(item.name),
    version: stringValue(item.version),
    description: stringValue(item.description),
    source: stringValue(item.source),
    keywords: stringArray(item.keywords),
    tags: stringArray(item.tags),
    requiresSkills: stringArray(item.requires_skills),
    content: optionalString(item.content) ?? optionalString(item.markdown),
    path: optionalString(item.path) ?? optionalString(item.skill_path),
  }
}

function parseDetails(value: unknown): SkillListResult["details"] {
  if (!isRecord(value)) return {}
  return {
    rebornHome: optionalString(value.reborn_home),
    localDevRoot: optionalString(value.local_dev_root),
    ownerId: optionalString(value.owner_id),
    profile: optionalString(value.profile),
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value)
  return text ? text : undefined
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function safePathSegment(value: string): boolean {
  return Boolean(value) && !value.includes("/") && !value.includes("\\") && value !== "." && value !== ".."
}

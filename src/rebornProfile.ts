export type CliProfileResult = {
  exitCode: number
  stdout: string
}

type RebornProfile = {
  name?: unknown
  active?: unknown
}

export function activeProfileFromCliResult(result: CliProfileResult): string | null {
  if (result.exitCode !== 0) return null
  return activeProfileFromJson(result.stdout)
}

export function activeProfileFromJson(stdout: string): string | null {
  let profiles: RebornProfile[]
  try {
    profiles = JSON.parse(stdout) as RebornProfile[]
  } catch {
    return null
  }

  if (!Array.isArray(profiles)) return null
  const active = profiles.find(isActiveProfile)
  return active?.name ?? null
}

function isActiveProfile(profile: RebornProfile): profile is { name: string; active: true } {
  return profile.active === true && typeof profile.name === "string"
}

export function isLocalDevYoloProfile(profile: string | null): boolean {
  if (!profile) return false
  const normalized = profile.toLowerCase().replaceAll(/[_\s]+/g, "-")
  return normalized === "local" || normalized === "local-dev-yolo" || normalized === "localdevyolo" || normalized.includes("yolo")
}

export function shouldUseLocalDevYoloSplash(mode: string, profile: string | null): boolean {
  if (mode !== "local") return false
  if (!profile) return true
  return isLocalDevYoloProfile(profile)
}

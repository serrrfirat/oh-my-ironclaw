export type ModelCommandResponse = {
  activeModel: string
  models: string[]
}

export function parseModelListResponse(content: string): ModelCommandResponse | null {
  const lines = content.split(/\r?\n/)
  const activeLine = lines.find((line) => line.trim().startsWith("Active model:"))
  const activeModel = activeLine?.trim().slice("Active model:".length).trim()
  if (!activeModel) return null

  const models: string[] = []
  const availableIndex = lines.findIndex((line) => line.trim() === "Available models:")
  if (availableIndex >= 0) {
    for (const line of lines.slice(availableIndex + 1)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("Use /model ")) break
      const model = trimmed
        .replace(/^[-*]\s+/, "")
        .replace(/\s+\(active\)$/, "")
        .trim()
      if (model) models.push(model)
    }
  }

  return {
    activeModel,
    models: withSelectedModel(models, activeModel),
  }
}

export function selectedModelFromSwitchResponse(content: string): string | null {
  const trimmed = content.trim()
  for (const prefix of ["Switched model to:", "Model preference set to:"]) {
    if (!trimmed.startsWith(prefix)) continue
    const value = trimmed.slice(prefix.length).trim()
    const model = value.replace(/\s+\(per-user\)$/, "").trim()
    return model || null
  }
  return null
}

export function withSelectedModel(models: string[], selectedModel: string): string[] {
  const uniqueModels = Array.from(new Set(models.filter(Boolean)))
  if (!selectedModel || uniqueModels.includes(selectedModel)) return uniqueModels
  return [selectedModel, ...uniqueModels]
}

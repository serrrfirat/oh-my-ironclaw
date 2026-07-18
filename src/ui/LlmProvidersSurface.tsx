import type { LlmConfigSnapshot, LlmProviderView } from "../gateway/types"
import { theme } from "./theme"
import { Surface } from "./pixel"

const PROVIDER_VISIBLE_LIMIT = 14

export type LlmProviderFormView = {
  title: string
  fieldLabel: string
  fieldIndex: number
  fieldCount: number
  input: string
  currentValue?: string | null
}

export function LlmProvidersSurface({
  actionMessage,
  availableModels,
  error,
  form,
  height,
  loading,
  nearAiWalletInput,
  nearAiWalletInputActive,
  selectedIndex,
  setupInput,
  setupInputLabel,
  snapshot,
  width,
}: {
  actionMessage?: string | null
  availableModels?: string[]
  error?: string | null
  form?: LlmProviderFormView | null
  height: number
  loading: boolean
  nearAiWalletInput?: string
  nearAiWalletInputActive?: boolean
  selectedIndex: number
  setupInput?: string
  setupInputLabel?: string | null
  snapshot?: LlmConfigSnapshot | null
  width: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const providers = providerRows(snapshot)
  const selected = providers[wrapIndex(selectedIndex, providers.length)] ?? null
  const configured = providers.filter((provider) => providerConfigured(provider)).length
  const listWidth = Math.min(58, Math.max(36, Math.floor(contentWidth * 0.46)))
  const narrow = width < 94
  return (
    <Surface title="providers" meta={loading ? "loading" : `${configured}/${providers.length} configured`} width={width} height={height}>
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : actionMessage ? <text fg={theme.accentText}>{truncate(actionMessage, contentWidth)}</text> : null}
      {narrow ? (
        <box style={{ flexDirection: "column" }}>
          <ProviderList providers={providers} selectedIndex={selectedIndex} width={contentWidth} />
          <box style={{ height: 1 }} />
          <ProviderDetail provider={selected} availableModels={availableModels ?? []} form={form} nearAiWalletInput={nearAiWalletInput} nearAiWalletInputActive={nearAiWalletInputActive} setupInput={setupInput} setupInputLabel={setupInputLabel} width={contentWidth} />
        </box>
      ) : (
        <box style={{ flexDirection: "row", width: contentWidth }}>
          <ProviderList providers={providers} selectedIndex={selectedIndex} width={listWidth} />
          <box style={{ width: 2 }} />
          <ProviderDetail provider={selected} availableModels={availableModels ?? []} form={form} nearAiWalletInput={nearAiWalletInput} nearAiWalletInputActive={nearAiWalletInputActive} setupInput={setupInput} setupInputLabel={setupInputLabel} width={Math.max(1, contentWidth - listWidth - 2)} />
        </box>
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.textMuted}>{truncate("up/down select · n new · e edit · enter active · s key · l github · g google · w wallet · t test · m models · x delete · r refresh · esc back", contentWidth)}</text>
    </Surface>
  )
}

function ProviderList({ providers, selectedIndex, width }: { providers: LlmProviderView[]; selectedIndex: number; width: number }) {
  const selected = wrapIndex(selectedIndex, providers.length)
  const start = clamp(selected - PROVIDER_VISIBLE_LIMIT + 1, 0, Math.max(0, providers.length - PROVIDER_VISIBLE_LIMIT))
  const visible = providers.slice(start, start + PROVIDER_VISIBLE_LIMIT)
  return (
    <box style={{ width, flexDirection: "column" }}>
      {visible.length ? visible.map((provider, index) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          selected={start + index === selected}
          width={width}
        />
      )) : (
        <box style={{ height: 3, backgroundColor: theme.bgCode, paddingLeft: 2, paddingTop: 1 }}>
          <text fg={theme.textMuted}>No providers</text>
        </box>
      )}
    </box>
  )
}

function ProviderRow({ provider, selected, width }: { provider: LlmProviderView; selected: boolean; width: number }) {
  const marker = selected ? ">" : provider.active ? "*" : " "
  const suffix = provider.active ? "active" : providerConfigured(provider) ? "ready" : "setup"
  return (
    <box style={{ height: 1, flexDirection: "row", backgroundColor: selected ? theme.bgSoft : theme.bgCode, paddingLeft: 2, paddingRight: 2 }}>
      <text fg={selected || provider.active ? theme.accent : theme.textMuted}>{marker} </text>
      <text fg={selected ? theme.textStrong : theme.text}>{truncate(provider.description || provider.id, Math.max(8, width - suffix.length - 10))}</text>
      <text fg={provider.active || providerConfigured(provider) ? theme.accentText : theme.warn}> {truncate(suffix, 12)}</text>
    </box>
  )
}

function ProviderDetail({
  availableModels,
  form,
  nearAiWalletInput,
  nearAiWalletInputActive,
  provider,
  setupInput,
  setupInputLabel,
  width,
}: {
  availableModels: string[]
  form?: LlmProviderFormView | null
  nearAiWalletInput?: string
  nearAiWalletInputActive?: boolean
  provider: LlmProviderView | null
  setupInput?: string
  setupInputLabel?: string | null
  width: number
}) {
  if (!provider) {
    return (
      <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
        <text fg={theme.textMuted}>Select a provider</text>
      </box>
    )
  }
  const model = provider.active_model || provider.default_model || "unknown"
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <text fg={theme.textStrong}>{truncate(provider.description || provider.id, Math.max(1, width - 4))}</text>
      <text fg={theme.textMuted}>{truncate(provider.id, Math.max(1, width - 4))}</text>
      <box style={{ height: 1 }} />
      <Field label="adapter" value={provider.adapter || "unknown"} width={width - 4} />
      <Field label="model" value={model} width={width - 4} />
      <Field label="base url" value={provider.base_url || "default"} width={width - 4} />
      <Field label="api key" value={provider.api_key_required ? (provider.api_key_set ? "set" : "required") : provider.accepts_api_key ? "optional" : "not used"} width={width - 4} />
      <Field label="kind" value={provider.builtin ? "built-in" : "custom"} width={width - 4} />
      <Field label="models" value={provider.can_list_models ? "listable" : "fixed/default"} width={width - 4} />
      <box style={{ height: 1 }} />
      <text fg={theme.textMuted}>{truncate(actionHint(provider), Math.max(1, width - 4))}</text>
      {setupInputLabel ? (
        <box style={{ height: 3, flexDirection: "column", backgroundColor: theme.accentSoftBg, paddingLeft: 1, paddingRight: 1, marginTop: 1 }}>
          <text fg={theme.textMuted}>{truncate(setupInputLabel, width - 6)}</text>
          <text fg={theme.textStrong}>{truncate(setupInput ? "*".repeat(setupInput.length) : "type API key, enter submit", width - 6)}</text>
        </box>
      ) : null}
      {form ? <ProviderFormPreview form={form} width={width - 4} /> : null}
      {nearAiWalletInputActive ? <WalletLoginPreview input={nearAiWalletInput ?? ""} width={width - 4} /> : null}
      {availableModels.length ? (
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          <text fg={theme.warn}>available models</text>
          {availableModels.slice(0, 5).map((availableModel) => (
            <text key={availableModel} fg={theme.text}>{truncate(availableModel, Math.max(1, width - 4))}</text>
          ))}
          {availableModels.length > 5 ? <text fg={theme.textMuted}>{`${availableModels.length - 5} more`}</text> : null}
        </box>
      ) : null}
    </box>
  )
}

function ProviderFormPreview({ form, width }: { form: LlmProviderFormView; width: number }) {
  const current = form.currentValue ? `current: ${form.currentValue}` : "blank keeps default when available"
  return (
    <box style={{ height: 5, flexDirection: "column", backgroundColor: theme.accentSoftBg, paddingLeft: 1, paddingRight: 1, marginTop: 1 }}>
      <text fg={theme.warn}>{truncate(`${form.title} ${form.fieldIndex + 1}/${form.fieldCount}`, width - 2)}</text>
      <text fg={theme.textMuted}>{truncate(form.fieldLabel, width - 2)}</text>
      <text fg={theme.textMuted}>{truncate(current, width - 2)}</text>
      <text fg={theme.textStrong}>{truncate(form.fieldLabel === "api key" && form.input ? "*".repeat(form.input.length) : form.input || "type value, enter next", width - 2)}</text>
    </box>
  )
}

function WalletLoginPreview({ input, width }: { input: string; width: number }) {
  return (
    <box style={{ height: 4, flexDirection: "column", backgroundColor: theme.accentSoftBg, paddingLeft: 1, paddingRight: 1, marginTop: 1 }}>
      <text fg={theme.warn}>{truncate("near ai wallet login", width - 2)}</text>
      <text fg={theme.textMuted}>{truncate("paste signed JSON payload, enter submit", width - 2)}</text>
      <text fg={theme.textStrong}>{truncate(input || "{}", width - 2)}</text>
    </box>
  )
}

function Field({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = 14
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg={theme.textMuted}>{padEnd(label, labelWidth)}</text>
      <text fg={theme.text}>{truncate(value, Math.max(1, width - labelWidth))}</text>
    </box>
  )
}

function providerRows(snapshot?: LlmConfigSnapshot | null): LlmProviderView[] {
  return [...(snapshot?.providers ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || (a.description || a.id).localeCompare(b.description || b.id))
}

function providerConfigured(provider: LlmProviderView): boolean {
  return !provider.api_key_required || provider.api_key_set
}

function actionHint(provider: LlmProviderView): string {
  if (!providerConfigured(provider)) return "s adds provider credentials"
  if (provider.id === "nearai" || provider.adapter === "nearai") return "l GitHub, g Google, w wallet JSON, s stores API key"
  if (provider.id === "openai_codex" || provider.adapter === "openai_codex") return "l starts device login"
  if (provider.active) return "active provider, t tests connection"
  return provider.builtin ? "e edits override, enter sets active" : "e edits, x deletes custom provider"
}

function padEnd(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length)
}

function truncate(value: string, width: number) {
  if (width <= 0) return ""
  if (value.length <= width) return value
  if (width <= 3) return ".".repeat(width)
  return `${value.slice(0, width - 3)}...`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

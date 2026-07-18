import type { OutboundDeliveryTargetOption, OutboundPreferencesResponse } from "../gateway/types"
import { theme } from "./theme"
import { Field, Hint, SurfaceHeader, Tag, truncate, wrapIndex } from "./pixel"

const TARGET_VISIBLE_LIMIT = 12

export function OutboundSurface({
  preferences,
  targets,
  selectedIndex,
  message,
  loading,
  error,
  width,
  height,
}: {
  preferences: OutboundPreferencesResponse | null
  targets: OutboundDeliveryTargetOption[]
  selectedIndex: number
  message: string | null
  loading: boolean
  error: string | null
  width: number
  height: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const currentTargetId = preferences?.final_reply_target?.target_id ?? null
  const selected = wrapIndex(selectedIndex, targets.length)
  const start = Math.min(Math.max(0, selected - TARGET_VISIBLE_LIMIT + 1), Math.max(0, targets.length - TARGET_VISIBLE_LIMIT))
  const visible = targets.slice(start, start + TARGET_VISIBLE_LIMIT)
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: theme.bg, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="outbound" meta={loading ? "loading" : `${targets.length} targets`} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      {message ? <text fg={theme.accentText}>{truncate(message, contentWidth)}</text> : null}
      {preferences ? (
        <box style={{ flexDirection: "column" }}>
          <Field label="final reply → " value={preferences.final_reply_target?.display_name ?? "not configured"} width={contentWidth} labelWidth={14} />
          <Field label="status" value={preferences.final_reply_target_status} width={contentWidth} labelWidth={14} />
          <Field label="modality" value={preferences.default_modality} width={contentWidth} labelWidth={14} />
        </box>
      ) : null}
      <box style={{ height: 1 }} />
      <text fg={theme.text}>Delivery targets</text>
      {visible.length ? (
        visible.map((option, index) => {
          const isSelected = start + index === selected
          const isCurrent = option.target.target_id === currentTargetId
          return (
            <box key={option.target.target_id} style={{ width: contentWidth, height: 1, flexDirection: "row", backgroundColor: isSelected ? theme.accentSoftBg : theme.bg }}>
              <box style={{ width: 1, backgroundColor: isSelected ? theme.accent : theme.border }} />
              <text fg={isSelected ? theme.accent : theme.textMuted}> {isSelected ? "›" : " "} </text>
              <text fg={isSelected ? theme.accentText : theme.text}>{truncate(option.target.display_name || option.target.target_id, Math.max(8, contentWidth - 28))}</text>
              <text fg={theme.textFaint}> {truncate(option.target.channel, 10)}</text>
              <box style={{ flexGrow: 1 }} />
              {isCurrent ? <Tag label="current" tone="ok" /> : option.capabilities.final_replies ? null : <Tag label="no replies" tone="muted" />}
            </box>
          )
        })
      ) : (
        <text fg={theme.textMuted}>{loading ? "loading targets…" : "no delivery targets"}</text>
      )}
      <box style={{ flexGrow: 1 }} />
      <Hint text="up/down select · enter set final-reply target · c clear · r refresh · esc back" width={contentWidth} />
    </box>
  )
}

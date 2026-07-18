import type { SessionResponse } from "../gateway/types"
import type { ToolPermissionRow } from "./toolPermissions"
import { toolPermissionLabel, toolPermissionTone } from "./toolPermissions"
import { theme, toneColors } from "./theme"
import { Field, Hint, SurfaceHeader, Tag, truncate, wrapIndex } from "./pixel"

const TOOL_VISIBLE_LIMIT = 14

export function ToolsSurface({
  rows,
  globalAutoApprove,
  session,
  selectedIndex,
  message,
  loading,
  error,
  width,
  height,
}: {
  rows: ToolPermissionRow[]
  globalAutoApprove: boolean
  session: SessionResponse | null
  selectedIndex: number
  message: string | null
  loading: boolean
  error: string | null
  width: number
  height: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const selected = wrapIndex(selectedIndex, rows.length)
  const start = Math.min(Math.max(0, selected - TOOL_VISIBLE_LIMIT + 1), Math.max(0, rows.length - TOOL_VISIBLE_LIMIT))
  const visible = rows.slice(start, start + TOOL_VISIBLE_LIMIT)
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: theme.bg, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="tools" meta={loading ? "loading" : `${rows.length} capabilities`} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      {message ? <text fg={theme.accentText}>{truncate(message, contentWidth)}</text> : null}
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={theme.textMuted}>global auto-approve </text>
        <Tag label={globalAutoApprove ? "on" : "off"} tone={globalAutoApprove ? "ok" : "muted"} />
        <text fg={theme.textFaint}>  (g to toggle)</text>
      </box>
      <box style={{ height: 1 }} />
      {session ? (
        <box style={{ flexDirection: "column" }}>
          <Field label="tenant" value={session.tenant_id} width={contentWidth} />
          <Field label="user" value={session.user_id} width={contentWidth} />
          <Field
            label="features"
            value={`projects ${session.features.reborn_projects ? "on" : "off"} · auto-approve ${session.features.global_auto_approve ? "on" : "off"}`}
            width={contentWidth}
          />
          <Field label="operator" value={session.capabilities.operator_webui_config ? "yes" : "no"} width={contentWidth} />
        </box>
      ) : null}
      <box style={{ height: 1 }} />
      <text fg={theme.text}>Per-tool permission</text>
      {visible.length ? (
        visible.map((row, index) => {
          const isSelected = start + index === selected
          const tone = toolPermissionTone(row.permission)
          return (
            <box key={row.capabilityId} style={{ width: contentWidth, height: 1, flexDirection: "row", backgroundColor: isSelected ? theme.accentSoftBg : theme.bg }}>
              <box style={{ width: 1, backgroundColor: isSelected ? theme.accent : theme.border }} />
              <text fg={isSelected ? theme.accent : theme.textMuted}> {isSelected ? "›" : " "} </text>
              <text fg={isSelected ? theme.accentText : theme.text}>{truncate(row.label, Math.max(8, contentWidth - 24))}</text>
              <box style={{ flexGrow: 1 }} />
              <text fg={toneColors(tone).fg}>{toolPermissionLabel(row.permission)}</text>
              {!row.mutable ? <text fg={theme.textFaint}> (locked)</text> : null}
            </box>
          )
        })
      ) : (
        <text fg={theme.textMuted}>{loading ? "loading tools…" : "no per-tool entries"}</text>
      )}
      <box style={{ flexGrow: 1 }} />
      <Hint text="up/down select · enter cycle permission · g global auto-approve · r refresh · esc back" width={contentWidth} />
    </box>
  )
}

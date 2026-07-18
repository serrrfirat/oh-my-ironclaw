import type { SyntaxStyle } from "@opentui/core"
import type { SkillInfo } from "../gateway/types"
import { theme, statusColor } from "./theme"
import { Hint, ListRow, Surface, Tag, truncate, wrapIndex } from "./pixel"

const SKILL_VISIBLE_LIMIT = 14

export type RemoteSkillDetail = {
  name: string
  content: string
  loading: boolean
  error: string | null
  offset: number
}

export type SkillInstallState = {
  step: "name" | "content"
  name: string
  content: string
}

export function SkillsRemoteSurface({
  skills,
  query,
  autoActivateLearned,
  selectedIndex,
  detail,
  install,
  confirmingRemove,
  message,
  loading,
  error,
  markdownStyle,
  width,
  height,
}: {
  skills: SkillInfo[]
  query: string
  autoActivateLearned: boolean
  selectedIndex: number
  detail: RemoteSkillDetail | null
  install: SkillInstallState | null
  confirmingRemove: boolean
  message: string | null
  loading: boolean
  error: string | null
  markdownStyle: SyntaxStyle
  width: number
  height: number
}) {
  const contentWidth = Math.max(1, width - 4)
  return (
    <Surface title="skills" meta={loading ? "loading" : `${skills.length} · learned ${autoActivateLearned ? "on" : "off"}`} width={width} height={height}>
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      {message ? <text fg={theme.accentText}>{truncate(message, contentWidth)}</text> : null}
      {install ? (
        <InstallPanel install={install} width={contentWidth} />
      ) : detail ? (
        <SkillDetailPane detail={detail} markdownStyle={markdownStyle} height={height} width={contentWidth} />
      ) : (
        <SkillList skills={skills} query={query} selectedIndex={selectedIndex} confirmingRemove={confirmingRemove} loading={loading} width={contentWidth} />
      )}
      <box style={{ flexGrow: 1 }} />
      <Hint text={hintText(Boolean(detail), Boolean(install), confirmingRemove)} width={contentWidth} />
    </Surface>
  )
}

function hintText(detail: boolean, install: boolean, confirmingRemove: boolean): string {
  if (install) return "type value · enter next/confirm · esc cancel"
  if (detail) return "up/down scroll · esc back"
  if (confirmingRemove) return "remove skill? y confirm · n cancel"
  return "type search · enter view · i install · x remove · a auto-activate · L learned · esc back"
}

function SkillList({
  skills,
  query,
  selectedIndex,
  confirmingRemove,
  loading,
  width,
}: {
  skills: SkillInfo[]
  query: string
  selectedIndex: number
  confirmingRemove: boolean
  loading: boolean
  width: number
}) {
  const selected = wrapIndex(selectedIndex, skills.length)
  const start = Math.min(Math.max(0, selected - SKILL_VISIBLE_LIMIT + 1), Math.max(0, skills.length - SKILL_VISIBLE_LIMIT))
  const visible = skills.slice(start, start + SKILL_VISIBLE_LIMIT)
  return (
    <box style={{ flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={theme.warn}>{query ? "" : " "}</text>
        <text fg={query ? theme.textStrong : theme.textFaint}>{truncate(query || "search skills…", width - 2)}</text>
      </box>
      <box style={{ height: 1 }} />
      {visible.length ? (
        visible.map((skill, index) => {
          const isSelected = start + index === selected
          const nameWidth = Math.max(8, Math.floor(width * 0.32))
          return (
            <ListRow
              key={`${skill.source}:${skill.name}`}
              selected={isSelected}
              marker={isSelected && confirmingRemove ? "✕" : isSelected ? "›" : " "}
              leading={skill.auto_activate ? <Tag label="auto" tone="ok" /> : undefined}
              text={` ${truncate(skill.name, nameWidth)}`}
              textWidth={width}
              trailing={
                <>
                  <text fg={statusColor(skill.trust)}> {truncate(skill.trust, 9)}</text>
                  <text fg={theme.textFaint}> {truncate(skill.description || "", Math.max(6, width - nameWidth - 22))}</text>
                </>
              }
              width={width}
            />
          )
        })
      ) : (
        <text fg={theme.textMuted}>{loading ? "loading skills…" : query ? "no skills match" : "no skills installed"}</text>
      )}
    </box>
  )
}

function SkillDetailPane({
  detail,
  markdownStyle,
  height,
  width,
}: {
  detail: RemoteSkillDetail
  markdownStyle: SyntaxStyle
  height: number
  width: number
}) {
  const visibleHeight = Math.max(4, height - 10)
  const content = detail.loading
    ? "Loading skill…"
    : detail.error
      ? detail.error
      : detail.content.split(/\r?\n/).slice(detail.offset, detail.offset + visibleHeight).join("\n")
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.textStrong}>{truncate(detail.name, width)}</text>
      <box style={{ height: 1 }} />
      <box style={{ height: visibleHeight, flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 1, paddingRight: 1 }}>
        <markdown content={content || " "} syntaxStyle={markdownStyle} />
      </box>
    </box>
  )
}

function InstallPanel({ install, width }: { install: SkillInstallState; width: number }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.text}>Install skill</text>
      <box style={{ height: 1 }} />
      <InstallField label="name" value={install.name} active={install.step === "name"} width={width} />
      <InstallField
        label="content"
        value={install.content ? `${install.content.length} chars` : "(blank = install by name)"}
        active={install.step === "content"}
        width={width}
      />
    </box>
  )
}

function InstallField({ label, value, active, width }: { label: string; value: string; active: boolean; width: number }) {
  return (
    <box style={{ width, height: 1, flexDirection: "row", backgroundColor: active ? theme.accentSoftBg : theme.bg }}>
      <text fg={active ? theme.accent : theme.textMuted}>{active ? "› " : "  "}</text>
      <text fg={theme.textMuted}>{label.padEnd(9)}</text>
      <text fg={active ? theme.textStrong : theme.text}>{truncate(active ? `${value}▏` : value, Math.max(4, width - 12))}</text>
    </box>
  )
}

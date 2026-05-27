import type { SyntaxStyle } from "@opentui/core"
import type { SkillListItem } from "../skillList"

export type SkillDetailView = {
  skill: SkillListItem
  content: string
  error: string | null
  loading: boolean
  path: string | null
  offset: number
}

export function SkillsSurface({
  detail,
  error,
  filteredSkills,
  height,
  loading,
  markdownStyle,
  query,
  selectedIndex,
  source,
  totalCount,
  width,
}: {
  detail: SkillDetailView | null
  error: string | null
  filteredSkills: SkillListItem[]
  height: number
  loading: boolean
  markdownStyle: SyntaxStyle
  query: string
  selectedIndex: number
  source: string
  totalCount: number
  width: number
}) {
  const modalWidth = clamp(Math.floor(width * 0.62), 64, Math.max(64, width - 10))
  const modalHeight = clamp(Math.floor(height * 0.58), 18, Math.max(18, height - 6))
  const top = Math.max(1, Math.floor((height - modalHeight) / 2))
  const selected = wrapIndex(selectedIndex, filteredSkills.length)
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505" }}>
      <box style={{ height: top }} />
      <box style={{ width, flexDirection: "row", justifyContent: "center" }}>
        <box style={{ width: modalWidth, height: modalHeight, flexDirection: "column", backgroundColor: "#171717", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
          {detail ? (
            <SkillDetail
              detail={detail}
              height={modalHeight - 2}
              markdownStyle={markdownStyle}
              width={modalWidth - 4}
            />
          ) : (
            <SkillList
              error={error}
              filteredSkills={filteredSkills}
              height={modalHeight - 2}
              loading={loading}
              query={query}
              selectedIndex={selected}
              source={source}
              totalCount={totalCount}
              width={modalWidth - 4}
            />
          )}
        </box>
      </box>
    </box>
  )
}

function SkillList({
  error,
  filteredSkills,
  height,
  loading,
  query,
  selectedIndex,
  source,
  totalCount,
  width,
}: {
  error: string | null
  filteredSkills: SkillListItem[]
  height: number
  loading: boolean
  query: string
  selectedIndex: number
  source: string
  totalCount: number
  width: number
}) {
  const rows = Math.max(1, height - 7)
  const start = clamp(selectedIndex - rows + 1, 0, Math.max(0, filteredSkills.length - rows))
  const visibleSkills = filteredSkills.slice(start, start + rows)
  return (
    <>
      <box style={{ height: 2, flexDirection: "row" }}>
        <text fg="#e8e8e8">Skills</text>
        <text fg="#777777"> {loading ? "loading" : `${filteredSkills.length}/${totalCount}`}</text>
        {source ? <text fg="#777777"> · {source}</text> : null}
        <text fg="#777777">{padLeft("esc", Math.max(1, width - 18 - source.length))}</text>
      </box>
      <box style={{ height: 2, flexDirection: "row" }}>
        <text fg="#ffb887">{query ? "" : " "}</text>
        <text fg={query ? "#f0f0f0" : "#8a8a8a"}>{truncate(query || "Search skills...", width - 2)}</text>
      </box>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#a78bfa">Skills</text>
      </box>
      {error ? (
        <text fg="#f08a8a">{truncate(error, width)}</text>
      ) : loading ? (
        <text fg="#777777">Loading skills from Reborn CLI...</text>
      ) : visibleSkills.length ? (
        visibleSkills.map((skill, index) => (
          <SkillRow
            key={`${skill.source}:${skill.name}`}
            selected={start + index === selectedIndex}
            skill={skill}
            width={width}
          />
        ))
      ) : (
        <text fg="#777777">{query ? "No skills match your search." : "No skills configured."}</text>
      )}
      <box style={{ height: 1, flexDirection: "row", marginTop: 1 }}>
        <text fg="#606060">{truncate("type to search · up/down select · enter open SKILL.md · esc close", width)}</text>
      </box>
    </>
  )
}

function SkillRow({ selected, skill, width }: { selected: boolean; skill: SkillListItem; width: number }) {
  const nameWidth = clamp(Math.floor(width * 0.38), 18, 40)
  const descriptionWidth = Math.max(10, width - nameWidth - 4)
  return (
    <box style={{ height: 1, flexDirection: "row", backgroundColor: selected ? "#ffb887" : "#171717" }}>
      <text fg={selected ? "#101010" : "#dcdcdc"}>{selected ? " " : "  "}</text>
      <text fg={selected ? "#101010" : "#f0f0f0"}>{padEnd(skill.name, nameWidth)}</text>
      <text fg={selected ? "#101010" : "#777777"}>{truncate(skill.description || skill.source || "No description.", descriptionWidth)}</text>
    </box>
  )
}

function SkillDetail({
  detail,
  height,
  markdownStyle,
  width,
}: {
  detail: SkillDetailView
  height: number
  markdownStyle: SyntaxStyle
  width: number
}) {
  const contentHeight = Math.max(3, height - 5)
  const content = detail.loading ? "Loading SKILL.md..." : detail.error ? detail.error : visibleMarkdown(detail.content, detail.offset, contentHeight)
  return (
    <>
      <box style={{ height: 2, flexDirection: "row" }}>
        <text fg="#e8e8e8">{truncate(detail.skill.name, width - 14)}</text>
        <text fg="#777777">{padLeft("esc", 12)}</text>
      </box>
      <text fg="#777777">{truncate(detail.path ?? "SKILL.md path unavailable from CLI metadata", width)}</text>
      <box style={{ height: 1 }} />
      <box style={{ height: contentHeight, flexDirection: "column" }}>
        <markdown content={content || " "} syntaxStyle={markdownStyle} />
      </box>
      <box style={{ height: 1 }}>
        <text fg="#606060">{truncate("up/down scroll · esc close", width)}</text>
      </box>
    </>
  )
}

function visibleMarkdown(content: string, offset: number, height: number): string {
  return content.split(/\r?\n/).slice(offset, offset + height).join("\n")
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}

function padEnd(value: string, length: number): string {
  return value.length >= length ? value.slice(0, length) : value + " ".repeat(length - value.length)
}

function padLeft(value: string, length: number): string {
  return value.length >= length ? value.slice(0, length) : " ".repeat(length - value.length) + value
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

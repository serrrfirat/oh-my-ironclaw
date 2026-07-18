import type { ProjectInfo, ProjectMemberInfo } from "../gateway/types"
import { theme, statusColor } from "./theme"
import { Field, Hint, SurfaceHeader, Tag, truncate, wrapIndex } from "./pixel"

const PROJECT_VISIBLE_LIMIT = 14

export type ProjectsView = "list" | "members" | "create"

export function ProjectsSurface({
  view,
  projects,
  members,
  selectedIndex,
  createInput,
  confirmingDelete,
  message,
  loading,
  error,
  width,
  height,
}: {
  view: ProjectsView
  projects: ProjectInfo[]
  members: ProjectMemberInfo[]
  selectedIndex: number
  createInput: string
  confirmingDelete: boolean
  message: string | null
  loading: boolean
  error: string | null
  width: number
  height: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const selected = projects[wrapIndex(selectedIndex, projects.length)] ?? null
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: theme.bg, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="projects" meta={loading ? "loading" : `${projects.length} projects`} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      {message ? <text fg={theme.accentText}>{truncate(message, contentWidth)}</text> : null}
      {view === "create" ? (
        <CreatePanel input={createInput} width={contentWidth} />
      ) : view === "members" ? (
        <MembersPanel project={selected} members={members} loading={loading} width={contentWidth} />
      ) : (
        <box style={{ flexDirection: "row", width: contentWidth }}>
          <ProjectList projects={projects} selectedIndex={selectedIndex} width={Math.min(48, Math.max(28, Math.floor(contentWidth * 0.45)))} />
          <box style={{ width: 2 }} />
          <ProjectDetail project={selected} confirmingDelete={confirmingDelete} width={Math.max(1, contentWidth - Math.min(48, Math.max(28, Math.floor(contentWidth * 0.45))) - 2)} />
        </box>
      )}
      <box style={{ flexGrow: 1 }} />
      <Hint text={hintForView(view, confirmingDelete)} width={contentWidth} />
    </box>
  )
}

function hintForView(view: ProjectsView, confirmingDelete: boolean): string {
  if (view === "create") return "type name · enter create · esc cancel"
  if (view === "members") return "esc back to list"
  if (confirmingDelete) return "delete project? y confirm · n cancel"
  return "up/down select · n new · m members · d delete · r refresh · esc back"
}

function ProjectList({ projects, selectedIndex, width }: { projects: ProjectInfo[]; selectedIndex: number; width: number }) {
  const selected = wrapIndex(selectedIndex, projects.length)
  const start = Math.min(Math.max(0, selected - PROJECT_VISIBLE_LIMIT + 1), Math.max(0, projects.length - PROJECT_VISIBLE_LIMIT))
  const visible = projects.slice(start, start + PROJECT_VISIBLE_LIMIT)
  if (!projects.length) return <box style={{ width, flexDirection: "column" }}><text fg={theme.textMuted}>no projects</text></box>
  return (
    <box style={{ width, flexDirection: "column" }}>
      {visible.map((project, index) => {
        const isSelected = start + index === selected
        return (
          <box key={project.project_id} style={{ width, height: 1, flexDirection: "row", backgroundColor: isSelected ? theme.accentSoftBg : theme.bg }}>
            <box style={{ width: 1, backgroundColor: isSelected ? theme.accent : theme.border }} />
            <text fg={isSelected ? theme.accent : theme.textMuted}> {isSelected ? "›" : " "} </text>
            <text fg={isSelected ? theme.accentText : theme.text}>{truncate(project.name || "untitled", Math.max(6, width - 14))}</text>
            <text fg={statusColor(project.state)}> {truncate(project.role, 8)}</text>
          </box>
        )
      })}
    </box>
  )
}

function ProjectDetail({ project, confirmingDelete, width }: { project: ProjectInfo | null; confirmingDelete: boolean; width: number }) {
  if (!project) {
    return (
      <box style={{ width, flexDirection: "column" }}>
        <text fg={theme.textMuted}>select a project</text>
      </box>
    )
  }
  return (
    <box style={{ width, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={theme.textStrong}>{truncate(project.name, Math.max(1, width - 12))} </text>
        <Tag label={project.state} tone={project.state === "active" ? "ok" : "muted"} />
      </box>
      <box style={{ height: 1 }} />
      <Field label="id" value={project.project_id} width={width} />
      <Field label="role" value={project.role} width={width} />
      <Field label="description" value={project.description || "—"} width={width} />
      <Field label="created" value={project.created_at} width={width} />
      {confirmingDelete ? (
        <box style={{ marginTop: 1 }}>
          <text fg={theme.danger}>Delete this project? y / n</text>
        </box>
      ) : null}
    </box>
  )
}

function MembersPanel({ project, members, loading, width }: { project: ProjectInfo | null; members: ProjectMemberInfo[]; loading: boolean; width: number }) {
  return (
    <box style={{ width, flexDirection: "column" }}>
      <text fg={theme.textStrong}>{project ? `${project.name} · members` : "members"}</text>
      <box style={{ height: 1 }} />
      {members.length ? (
        members.map((member) => (
          <box key={member.user_id} style={{ width, height: 1, flexDirection: "row" }}>
            <box style={{ width: 1, backgroundColor: theme.border }} />
            <text fg={theme.text}> {truncate(member.user_id, Math.max(6, width - 24))}</text>
            <text fg={theme.accentText}> {member.role}</text>
            <text fg={statusColor(member.status)}> {member.status}</text>
          </box>
        ))
      ) : (
        <text fg={theme.textMuted}>{loading ? "loading members…" : "no members"}</text>
      )}
    </box>
  )
}

function CreatePanel({ input, width }: { input: string; width: number }) {
  return (
    <box style={{ width, flexDirection: "column" }}>
      <text fg={theme.text}>New project name</text>
      <box style={{ height: 1 }} />
      <box style={{ width, height: 1, flexDirection: "row", backgroundColor: theme.bgCode, paddingLeft: 1 }}>
        <text fg={theme.accent}>› </text>
        <text fg={input ? theme.textStrong : theme.textFaint}>{input ? `${input}▏` : "project name"}</text>
      </box>
    </box>
  )
}

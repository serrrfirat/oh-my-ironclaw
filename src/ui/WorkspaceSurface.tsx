import type { FsMountInfo, ProjectFsEntry, ProjectFsStat } from "../gateway/types"
import { theme } from "./theme"
import { Field, Hint, ListRow, Surface, truncate, wrapIndex } from "./pixel"

const ENTRY_VISIBLE_LIMIT = 16
const FILE_LINE_LIMIT = 20

export type WorkspaceView =
  | { kind: "mounts" }
  | { kind: "browse"; mount: string; path: string }
  | { kind: "file"; mount: string; path: string }

export function WorkspaceSurface({
  view,
  mounts,
  entries,
  stat,
  fileContent,
  fileOffset,
  selectedIndex,
  loading,
  error,
  width,
  height,
}: {
  view: WorkspaceView
  mounts: FsMountInfo[]
  entries: ProjectFsEntry[]
  stat: ProjectFsStat | null
  fileContent: string | null
  fileOffset: number
  selectedIndex: number
  loading: boolean
  error: string | null
  width: number
  height: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const meta = view.kind === "mounts" ? `${mounts.length} mounts` : `${view.mount}:${view.path || "/"}`
  return (
    <Surface title="workspace" meta={loading ? "loading" : meta} width={width} height={height}>
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      {view.kind === "file" ? (
        <FilePane stat={stat} content={fileContent} offset={fileOffset} height={height} width={contentWidth} />
      ) : view.kind === "mounts" ? (
        <MountList mounts={mounts} selectedIndex={selectedIndex} loading={loading} width={contentWidth} />
      ) : (
        <EntryList entries={entries} selectedIndex={selectedIndex} loading={loading} width={contentWidth} />
      )}
      <box style={{ flexGrow: 1 }} />
      <Hint text={hintForView(view)} width={contentWidth} />
    </Surface>
  )
}

function hintForView(view: WorkspaceView): string {
  if (view.kind === "mounts") return "up/down select · enter open mount · esc back"
  if (view.kind === "file") return "up/down scroll · backspace back · esc close"
  return "up/down select · enter open · backspace up · esc back"
}

function MountList({ mounts, selectedIndex, loading, width }: { mounts: FsMountInfo[]; selectedIndex: number; loading: boolean; width: number }) {
  const selected = wrapIndex(selectedIndex, mounts.length)
  if (!mounts.length) return <text fg={theme.textMuted}>{loading ? "loading mounts…" : "no mounts available"}</text>
  return (
    <box style={{ flexDirection: "column" }}>
      {mounts.map((mount, index) => (
        <ListRow
          key={mount.mount}
          selected={index === selected}
          text={mount.label || mount.mount}
          textWidth={24}
          suffix={mount.mount}
          width={width}
        />
      ))}
    </box>
  )
}

function EntryList({ entries, selectedIndex, loading, width }: { entries: ProjectFsEntry[]; selectedIndex: number; loading: boolean; width: number }) {
  const selected = wrapIndex(selectedIndex, entries.length)
  const start = Math.min(Math.max(0, selected - ENTRY_VISIBLE_LIMIT + 1), Math.max(0, entries.length - ENTRY_VISIBLE_LIMIT))
  const visible = entries.slice(start, start + ENTRY_VISIBLE_LIMIT)
  if (!entries.length) return <text fg={theme.textMuted}>{loading ? "loading…" : "empty directory"}</text>
  return (
    <box style={{ flexDirection: "column" }}>
      {visible.map((entry, index) => {
        const isSelected = start + index === selected
        const isDir = entry.kind === "directory"
        return (
          <ListRow
            key={entry.path}
            selected={isSelected}
            leading={<text fg={isDir ? theme.accentText : theme.textFaint}>{isDir ? "▸ " : "  "}</text>}
            text={entry.name}
            textWidth={Math.max(4, width - 6)}
            width={width}
          />
        )
      })}
    </box>
  )
}

function FilePane({ stat, content, offset, height, width }: { stat: ProjectFsStat | null; content: string | null; offset: number; height: number; width: number }) {
  const lines = (content ?? "").split(/\r?\n/)
  const visibleHeight = Math.max(3, Math.min(FILE_LINE_LIMIT, height - 10))
  const visible = lines.slice(offset, offset + visibleHeight)
  return (
    <box style={{ flexDirection: "column" }}>
      {stat ? (
        <box style={{ flexDirection: "column" }}>
          <Field label="path" value={stat.path} width={width} />
          <Field label="type" value={`${stat.kind} · ${stat.mime_type}`} width={width} />
          <Field label="size" value={`${stat.size_bytes} bytes`} width={width} />
        </box>
      ) : null}
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "column", backgroundColor: theme.bgCode, paddingLeft: 1, paddingRight: 1 }}>
        {content === null ? (
          <text fg={theme.textMuted}>loading…</text>
        ) : (
          visible.map((line, index) => (
            <text key={index} fg={theme.textMuted}>{truncate(line || " ", Math.max(1, width - 2))}</text>
          ))
        )}
      </box>
    </box>
  )
}

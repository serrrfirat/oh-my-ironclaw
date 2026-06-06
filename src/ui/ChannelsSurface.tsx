import type { ConnectableChannelInfo } from "../gateway/types"

const CHANNEL_VISIBLE_LIMIT = 14

export function ChannelsSurface({
  channels,
  error,
  height,
  loading,
  selectedIndex,
  width,
}: {
  channels: ConnectableChannelInfo[]
  error?: string | null
  height: number
  loading: boolean
  selectedIndex: number
  width: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const selected = channels[wrapIndex(selectedIndex, channels.length)] ?? null
  const listWidth = Math.min(58, Math.max(36, Math.floor(contentWidth * 0.46)))
  const narrow = width < 94
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="channels" meta={loading ? "loading" : `${channels.length} connectable`} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg="#f08a8a">{truncate(error, contentWidth)}</text> : null}
      {narrow ? (
        <box style={{ flexDirection: "column" }}>
          <ChannelList channels={channels} selectedIndex={selectedIndex} width={contentWidth} />
          <box style={{ height: 1 }} />
          <ChannelDetail channel={selected} width={contentWidth} />
        </box>
      ) : (
        <box style={{ flexDirection: "row", width: contentWidth }}>
          <ChannelList channels={channels} selectedIndex={selectedIndex} width={listWidth} />
          <box style={{ width: 2 }} />
          <ChannelDetail channel={selected} width={Math.max(1, contentWidth - listWidth - 2)} />
        </box>
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg="#777777">{truncate("up/down select · r refresh · esc back", contentWidth)}</text>
    </box>
  )
}

function ChannelList({ channels, selectedIndex, width }: { channels: ConnectableChannelInfo[]; selectedIndex: number; width: number }) {
  const selected = wrapIndex(selectedIndex, channels.length)
  const start = clamp(selected - CHANNEL_VISIBLE_LIMIT + 1, 0, Math.max(0, channels.length - CHANNEL_VISIBLE_LIMIT))
  const visible = channels.slice(start, start + CHANNEL_VISIBLE_LIMIT)
  return (
    <box style={{ width, flexDirection: "column" }}>
      {visible.length ? visible.map((channel, index) => (
        <ChannelRow key={channel.channel} channel={channel} selected={start + index === selected} width={width} />
      )) : (
        <box style={{ height: 3, backgroundColor: "#101010", paddingLeft: 2, paddingTop: 1 }}>
          <text fg="#777777">No connectable channels</text>
        </box>
      )}
    </box>
  )
}

function ChannelRow({ channel, selected, width }: { channel: ConnectableChannelInfo; selected: boolean; width: number }) {
  return (
    <box style={{ height: 1, flexDirection: "row", backgroundColor: selected ? "#1b1b1b" : "#101010", paddingLeft: 2, paddingRight: 2 }}>
      <text fg={selected ? "#2ee66b" : "#707070"}>{selected ? "> " : "  "}</text>
      <text fg={selected ? "#f2f2f2" : "#d0d0d0"}>{truncate(channel.display_name || channel.channel, Math.max(8, width - 18))}</text>
      <text fg="#777777"> {truncate(channel.strategy, 14)}</text>
    </box>
  )
}

function ChannelDetail({ channel, width }: { channel: ConnectableChannelInfo | null; width: number }) {
  if (!channel) {
    return (
      <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
        <text fg="#777777">Select a channel</text>
      </box>
    )
  }
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <text fg="#f2f2f2">{truncate(channel.display_name || channel.channel, Math.max(1, width - 4))}</text>
      <text fg="#777777">{truncate(channel.channel, Math.max(1, width - 4))}</text>
      <box style={{ height: 1 }} />
      <Field label="strategy" value={channel.strategy} width={width - 4} />
      <Field label="aliases" value={channel.command_aliases?.join(", ") || "none"} width={width - 4} />
      <Field label="submit" value={channel.action.submit_label} width={width - 4} />
      <Field label="placeholder" value={channel.action.code_placeholder} width={width - 4} />
      <box style={{ height: 1 }} />
      <text fg="#f0b45f">{truncate(channel.action.title, Math.max(1, width - 4))}</text>
      <text fg="#d0d0d0">{truncate(channel.action.instructions, Math.max(1, width - 4))}</text>
      <box style={{ height: 1 }} />
      <Field label="success" value={channel.action.success_message} width={width - 4} />
      <Field label="error" value={channel.action.error_message} width={width - 4} />
    </box>
  )
}

function SurfaceHeader({ title, meta, width }: { title: string; meta: string; width: number }) {
  return (
    <box style={{ width, height: 2, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#8cffb0">ironclaw</text>
        <text fg="#777777">{padEnd("", Math.max(1, width - title.length - meta.length - 12))}</text>
        <text fg="#d0d0d0">{title}</text>
        <text fg="#777777"> · {meta}</text>
      </box>
      <text fg="#1f1f1f">{padEnd("", width).replaceAll(" ", "-")}</text>
    </box>
  )
}

function Field({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = 14
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg="#8a8a8a">{padEnd(label, labelWidth)}</text>
      <text fg="#d0d0d0">{truncate(value, Math.max(1, width - labelWidth))}</text>
    </box>
  )
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

import { theme, toneColors, type Tone } from "./theme"

// Shared "Glass" primitives for the surfaces: rounded-border framed panels and
// cards over the zinc canvas, elevated fills, pill tag chips, accent brand mark.
// (Formerly the flat "Pixel" look; exported names/props are kept stable so call
// sites don't churn.)

export function truncate(value: string, max: number): string {
  if (max <= 0) return ""
  if (value.length <= max) return value
  if (max <= 3) return ".".repeat(max)
  return `${value.slice(0, max - 3)}...`
}

export function padEnd(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length)
}

export function padLeft(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : " ".repeat(width - value.length) + value
}

export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatDate(value?: string | null, fallback = "—"): string {
  if (!value) return fallback
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return fallback
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

// Glass top bar: brand "◆ ironclaw" (◆ accent) + surface title + right-aligned
// meta, elevated on a subtle fill with a bottom border edge (rather than a bare
// hairline) so the header reads as a bar sitting above the panel body.
export function SurfaceHeader({ title, meta, width }: { title: string; meta?: string; width: number }) {
  const right = meta ?? ""
  const spacer = Math.max(1, width - 10 - title.length - right.length - 4)
  return (
    <box
      style={{
        width,
        height: 2,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.barBg,
        border: ["bottom"],
        borderStyle: "single",
        borderColor: theme.border,
      }}
    >
      <text fg={theme.accent}>◆ </text>
      <text fg={theme.textStrong}>ironclaw</text>
      <text fg={theme.textFaint}>{padEnd("", spacer)}</text>
      <text fg={theme.text}>{title}</text>
      {right ? <text fg={theme.textFaint}> · {right}</text> : null}
    </box>
  )
}

export function Hairline({ width }: { width: number }) {
  return (
    <box style={{ height: 1 }}>
      <text fg={theme.border}>{padEnd("", width).replaceAll(" ", "─")}</text>
    </box>
  )
}

// Pill tag chip: uppercase colored text on a soft tone tint with horizontal
// padding, e.g. " RUNNING ". Terminals can't round a text background, so the
// padded fill is the pill.
export function Tag({ label, tone }: { label: string; tone: Tone }) {
  const { fg, bg } = toneColors(tone)
  return (
    <box style={{ height: 1, backgroundColor: bg, paddingLeft: 1, paddingRight: 1 }}>
      <text fg={fg}>{label.toUpperCase()}</text>
    </box>
  )
}

// Glass card: a rounded-border framed panel with an elevated fill, for
// tool-output wells and gate/auth blocks. A neutral card uses the card tokens;
// passing a `tone` tints the frame + fill to that status (warn for approvals,
// accent for auth). The border consumes 1 cell per side — callers that pass a
// fixed `width` get inner content of `width - 2`, minus any padding they add.
export function Card({
  tone,
  width,
  title,
  focused,
  padded = true,
  onMouseDown,
  children,
}: {
  tone?: Tone
  width?: number
  title?: string
  focused?: boolean
  padded?: boolean
  onMouseDown?: () => void
  children: React.ReactNode
}) {
  const borderColor = tone ? toneColors(tone).fg : theme.cardBorder
  const backgroundColor = tone ? toneColors(tone).bg : theme.cardBg
  return (
    <box
      focused={focused}
      title={title}
      onMouseDown={onMouseDown}
      style={{
        width,
        flexDirection: "column",
        border: true,
        borderStyle: "rounded",
        borderColor,
        backgroundColor,
        paddingLeft: padded ? 1 : 0,
        paddingRight: padded ? 1 : 0,
      }}
    >
      {children}
    </box>
  )
}

export function Field({ label, value, width, labelWidth = 16 }: { label: string; value: string; width: number; labelWidth?: number }) {
  return (
    <box style={{ width, height: 1, flexDirection: "row" }}>
      <text fg={theme.textMuted}>{padEnd(label, labelWidth)}</text>
      <text fg={theme.text}>{truncate(value, Math.max(1, width - labelWidth))}</text>
    </box>
  )
}

export function Hint({ text, width }: { text: string; width: number }) {
  return (
    <box style={{ width, height: 1, marginTop: 1 }}>
      <text fg={theme.textFaint}>{truncate(text, width)}</text>
    </box>
  )
}

// A list row with a 2px left rail + indent (Pixel: no card fill). Selected rows
// get an accentSoftBg strip + accentText marker instead of a fill.
//
// The common shape is rail + marker + text + a plain textFaint `suffix`. The
// optional slots cover the surface variants without duplicating the markup:
//   railTone     – recolor the selected rail (e.g. Traces holds use warn)
//   leading      – node rendered between the marker and text (chip / dir arrow)
//   textWidth    – explicit truncation budget when a surface sizes text itself
//   alignSuffix  – push everything after the text to the right edge (flexGrow)
//   trailing     – node(s) rendered after the suffix (extra chips / statuses)
export function ListRow({
  selected,
  marker,
  railTone,
  leading,
  text,
  textWidth,
  suffix,
  suffixTone,
  alignSuffix,
  trailing,
  width,
  onMouseDown,
}: {
  selected: boolean
  marker?: string
  railTone?: Tone
  leading?: React.ReactNode
  text: string
  textWidth?: number
  suffix?: string
  suffixTone?: Tone
  alignSuffix?: "end"
  trailing?: React.ReactNode
  width: number
  // Left-click handler. Wiring a row's click to select+activate is done by the
  // surface (which knows the row's absolute index); the mouse is additive to the
  // keyboard cursor.
  onMouseDown?: () => void
}) {
  // Glass list: only the SELECTED row is emphasised — an accentSoftBg fill with
  // a coloured left edge (railTone recolors it) reads as a filled chip. A true
  // per-row rounded border isn't viable at 1 row tall, so the fill + edge is the
  // chip. Unselected rows stay quiet: the left edge is painted in the canvas bg
  // (invisible) so widths still line up but the list isn't a grid of rails.
  const bg = selected ? theme.accentSoftBg : theme.bg
  const railColor = selected ? (railTone ? toneColors(railTone).fg : theme.accent) : theme.bg
  const suffixColor = suffixTone ? toneColors(suffixTone).fg : theme.textFaint
  const suffixText = suffix ? ` ${suffix}` : ""
  const resolvedTextWidth = textWidth ?? Math.max(4, width - 3 - suffixText.length)
  return (
    <box onMouseDown={onMouseDown} style={{ width, height: 1, flexDirection: "row", backgroundColor: bg }}>
      <box style={{ width: 1, backgroundColor: railColor }} />
      <text fg={selected ? theme.accent : theme.textMuted}> {marker ?? (selected ? "›" : " ")} </text>
      {leading}
      <text fg={selected ? theme.accentText : theme.text}>{truncate(text, resolvedTextWidth)}</text>
      {suffixText ? <text fg={suffixColor}>{suffixText}</text> : null}
      {alignSuffix === "end" ? <box style={{ flexGrow: 1 }} /> : null}
      {trailing}
    </box>
  )
}

// Full-screen surface chrome: a rounded-border framed Glass panel over the
// canvas, header inside. The frame's border (1 cell/side) plus 1 cell of padding
// per side keeps the inner content width at exactly `width - 4` — the same
// budget the flat Pixel surface exposed — so every child surface's existing
// `width - 4` math still lines up without churn.
export function Surface({
  title,
  meta,
  width,
  height,
  children,
}: {
  title: string
  meta?: string
  width: number
  height: number
  children: React.ReactNode
}) {
  const contentWidth = Math.max(1, width - 4)
  return (
    <box
      style={{
        width,
        height,
        flexDirection: "column",
        backgroundColor: theme.bg,
        border: true,
        borderStyle: "rounded",
        borderColor: theme.border,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
      }}
    >
      <SurfaceHeader title={title} meta={meta} width={contentWidth} />
      <box style={{ height: 1 }} />
      {children}
    </box>
  )
}

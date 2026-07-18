import { theme, toneColors, type Tone } from "./theme"

// Shared Pixel-theme primitives for the surfaces. Flat canvas, hairline
// separators, square uppercase tag chips, accent brand mark.

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

// Top bar: brand "◆ ironclaw" (◆ accent) + surface title + right-aligned meta,
// with a hairline separator below.
export function SurfaceHeader({ title, meta, width }: { title: string; meta?: string; width: number }) {
  const right = meta ?? ""
  const spacer = Math.max(1, width - 10 - title.length - right.length - 4)
  return (
    <box style={{ width, height: 2, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={theme.accent}>◆ </text>
        <text fg={theme.textStrong}>ironclaw</text>
        <text fg={theme.textFaint}>{padEnd("", spacer)}</text>
        <text fg={theme.text}>{title}</text>
        {right ? <text fg={theme.textFaint}> · {right}</text> : null}
      </box>
      <Hairline width={width} />
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

// Square uppercase tag chip: colored text on a soft tone tint, e.g. " RUNNING ".
export function Tag({ label, tone }: { label: string; tone: Tone }) {
  const { fg, bg } = toneColors(tone)
  return (
    <box style={{ height: 1, backgroundColor: bg, paddingLeft: 1, paddingRight: 1 }}>
      <text fg={fg}>{label.toUpperCase()}</text>
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
export function ListRow({
  selected,
  marker,
  text,
  suffix,
  suffixTone,
  width,
}: {
  selected: boolean
  marker?: string
  text: string
  suffix?: string
  suffixTone?: Tone
  width: number
}) {
  const bg = selected ? theme.accentSoftBg : theme.bg
  const railColor = selected ? theme.accent : theme.border
  const suffixColor = suffixTone ? toneColors(suffixTone).fg : theme.textFaint
  const suffixText = suffix ? ` ${suffix}` : ""
  const textWidth = Math.max(4, width - 3 - suffixText.length)
  return (
    <box style={{ width, height: 1, flexDirection: "row", backgroundColor: bg }}>
      <box style={{ width: 1, backgroundColor: railColor }} />
      <text fg={selected ? theme.accent : theme.textMuted}> {marker ?? (selected ? "›" : " ")} </text>
      <text fg={selected ? theme.accentText : theme.text}>{truncate(text, textWidth)}</text>
      {suffixText ? <text fg={suffixColor}>{suffixText}</text> : null}
    </box>
  )
}

// Full-screen surface chrome: flat canvas with header + padded content.
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
    <box style={{ width, height, flexDirection: "column", backgroundColor: theme.bg, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title={title} meta={meta} width={contentWidth} />
      <box style={{ height: 1 }} />
      {children}
    </box>
  )
}

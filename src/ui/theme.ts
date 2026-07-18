// IronClaw DS (PR #5563) "Pixel" theme — single source of design tokens for the TUI.
// Every surface imports from here; no inline hex should live in UI files.
//
// Terminals have no alpha channel, so "soft" tints are precomputed as solid hex
// composited over the canvas (#09090b).

export const theme = {
  bg: "#09090b", // canvas (nux zinc-dark)
  bgCode: "#111113", // code/output wells
  bgSoft: "#131316", // hover/selection fallback surface
  border: "#232326", // hairline (white 10% on canvas)
  borderSoft: "#1c1c1f", // white 8%
  // Glass elevation: framed panels/cards sit on a slightly lifted fill with a
  // marginally brighter edge than the flat hairline, so a bordered card reads as
  // "above" the canvas rather than drawn on it.
  cardBg: "#16191d", // card / tool-output well fill (elevated over canvas)
  cardBorder: "#2c2c31", // card frame edge (a touch brighter than border)
  barBg: "#0e0e11", // glass bar fill (top/status bars, composer)
  text: "#e0e0e0",
  textStrong: "#fafafa",
  textMuted: "#a1a1aa",
  textFaint: "#888888",
  accent: "#4ca7e6", // signal blue — brand, focus, selection, links
  accentStrong: "#2882c8", // pressed / primary action bg
  accentText: "#6bb8ec",
  accentSoftBg: "#13212c", // accent 15% tint
  info: "#60a5fa",
  infoSoftBg: "#16202f", // running / in-progress
  ok: "#34d399",
  okSoftBg: "#0f2720", // success / completed
  warn: "#f5a623",
  warnSoftBg: "#2c210f", // attention / approvals / degraded
  danger: "#e64c4c",
  dangerSoftBg: "#2a1315", // failure / error / cancelled
  onAccent: "#ffffff",
} as const

export type Theme = typeof theme

// Status canon → { fg, bg } tone. Follows the spec everywhere (runs, jobs,
// automations, tools). Never mix tones.
export type Tone = "info" | "ok" | "warn" | "danger" | "muted" | "accent"

export function toneColors(tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "info":
      return { fg: theme.info, bg: theme.infoSoftBg }
    case "ok":
      return { fg: theme.ok, bg: theme.okSoftBg }
    case "warn":
      return { fg: theme.warn, bg: theme.warnSoftBg }
    case "danger":
      return { fg: theme.danger, bg: theme.dangerSoftBg }
    case "accent":
      return { fg: theme.accentText, bg: theme.accentSoftBg }
    case "muted":
    default:
      return { fg: theme.textMuted, bg: theme.bgSoft }
  }
}

// Normalize an arbitrary status string to a canon key. Single source of truth —
// state.ts and homeData.ts import this rather than re-declaring it.
export function normalizeStatusKey(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

// Map any run/job/tool/automation status to its canon tone.
export function statusTone(status: string): Tone {
  switch (normalizeStatusKey(status)) {
    case "info":
    case "running":
    case "in_progress":
    case "active":
    case "accepted":
    case "queued":
    case "started":
    case "streaming":
    case "thinking":
    case "reasoning":
    case "sent":
      return "info"
    case "ok":
    case "success":
    case "succeeded":
    case "completed":
    case "done":
    case "resolved":
    case "resumed":
    case "scheduled":
      return "ok"
    case "warn":
    case "warning":
    case "degraded":
    case "attention":
    case "waiting_for_approval":
    case "waiting_for_auth":
    case "waiting":
    case "needs_setup":
    case "recovery_required":
      return "warn"
    case "failure":
    case "failed":
    case "error":
    case "fatal":
    case "cancelled":
    case "canceled":
    case "killed":
    case "revoked":
      return "danger"
    case "paused":
    case "idle":
    case "disabled":
    case "inactive":
    case "unknown":
    case "debug":
    case "trace":
      return "muted"
    default:
      return "muted"
  }
}

// Boolean on/off canon: enabled → ok, disabled → muted. Route toggle indicators
// (global auto-approve, feature flags) through this instead of an inline ternary
// so the two states stay tied to the shared tone palette.
export function booleanTone(enabled: boolean): Tone {
  return enabled ? "ok" : "muted"
}

export function statusColor(status: string): string {
  return toneColors(statusTone(status)).fg
}

// Slash-command source badge colors (remote/local/tui). The three must read as
// clearly distinct at a glance, so tui uses the ok green rather than the info
// blue (which was near-identical to remote's accent blue).
export function sourceColor(source: "remote" | "local" | "tui"): string {
  switch (source) {
    case "remote":
      return theme.accentText
    case "local":
      return theme.warn
    case "tui":
      return theme.ok
  }
}

// Accent-blue spinner/rail ramp (#2882c8 → #4ca7e6 → #6bb8ec). Replaces the
// former brand-green rail. LocalDevYolo rainbow stays as-is elsewhere.
export const accentRamp: string[] = [
  theme.accentStrong,
  "#3795d7",
  theme.accent,
  "#5cb0e9",
  theme.accentText,
  "#5cb0e9",
  theme.accent,
  "#3795d7",
]

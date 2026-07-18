import type { AccountTracesResponse, TraceCreditsResponse } from "../gateway/types"
import { theme } from "./theme"
import { Field, Hint, SurfaceHeader, Tag, truncate, wrapIndex } from "./pixel"

export function TracesSurface({
  credits,
  account,
  loginLink,
  selectedHoldIndex,
  message,
  loading,
  error,
  width,
  height,
}: {
  credits: TraceCreditsResponse | null
  account: AccountTracesResponse | null
  loginLink: string | null
  selectedHoldIndex: number
  message: string | null
  loading: boolean
  error: string | null
  width: number
  height: number
}) {
  const contentWidth = Math.max(1, width - 4)
  const holds = credits?.holds ?? []
  const selectedHold = wrapIndex(selectedHoldIndex, holds.length)
  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: theme.bg, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <SurfaceHeader title="traces" meta={loading ? "loading" : credits?.enrolled ? "enrolled" : "not enrolled"} width={contentWidth} />
      <box style={{ height: 1 }} />
      {error ? <text fg={theme.danger}>{truncate(error, contentWidth)}</text> : null}
      {message ? <text fg={theme.accentText}>{truncate(message, contentWidth)}</text> : null}
      {credits ? (
        <box style={{ flexDirection: "column" }}>
          <text fg={theme.text}>Credit</text>
          <Field label="pending" value={String(credits.pending_credit)} width={contentWidth} />
          <Field label="final" value={String(credits.final_credit)} width={contentWidth} />
          <Field label="submissions" value={`${credits.submissions_accepted} accepted · ${credits.submissions_total} total`} width={contentWidth} />
          <Field label="holds" value={String(credits.manual_review_hold_count)} width={contentWidth} />
          {credits.note ? <Field label="note" value={credits.note} width={contentWidth} /> : null}
        </box>
      ) : null}
      <box style={{ height: 1 }} />
      <text fg={theme.text}>Holds ({holds.length})</text>
      {holds.length ? (
        holds.map((hold, index) => (
          <box key={hold.submission_id} style={{ width: contentWidth, height: 1, flexDirection: "row", backgroundColor: index === selectedHold ? theme.accentSoftBg : theme.bg }}>
            <box style={{ width: 1, backgroundColor: index === selectedHold ? theme.warn : theme.border }} />
            <text fg={index === selectedHold ? theme.accent : theme.textMuted}> {index === selectedHold ? "›" : " "} </text>
            <Tag label="hold" tone="warn" />
            <text fg={index === selectedHold ? theme.accentText : theme.text}> {truncate(`${hold.submission_id} · ${hold.reason}`, Math.max(8, contentWidth - 12))}</text>
          </box>
        ))
      ) : (
        <text fg={theme.textMuted}>no holds awaiting authorization</text>
      )}
      <box style={{ height: 1 }} />
      <text fg={theme.text}>Account</text>
      <Field label="enrolled" value={account ? (account.enrolled ? "yes" : "no") : "unknown"} width={contentWidth} />
      <Field label="traces" value={account ? String(account.traces.length) : "—"} width={contentWidth} />
      {loginLink ? <Field label="login link" value={loginLink} width={contentWidth} /> : null}
      <box style={{ flexGrow: 1 }} />
      <Hint text="a authorize hold · L account login link · r refresh · esc back" width={contentWidth} />
    </box>
  )
}

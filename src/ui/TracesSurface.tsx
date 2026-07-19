import type { AccountTracesResponse, TraceCreditsResponse } from "../gateway/types"
import { theme } from "./theme"
import { Field, Hint, ListRow, Surface, Tag, truncate, wrapIndex } from "./pixel"

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
  onHoldClick,
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
  // Select-only: click highlights a hold (then `a` authorizes it) — a click
  // never authorizes on its own, since that is a consequential single action.
  onHoldClick?: (index: number) => void
}) {
  const contentWidth = Math.max(1, width - 4)
  const holds = credits?.holds ?? []
  const selectedHold = wrapIndex(selectedHoldIndex, holds.length)
  return (
    <Surface title="traces" meta={loading ? "loading" : error ? "unavailable" : credits?.enrolled ? "enrolled" : "not enrolled"} width={width} height={height}>
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
          <ListRow
            key={hold.submission_id}
            selected={index === selectedHold}
            railTone="warn"
            leading={<Tag label="hold" tone="warn" />}
            text={` ${truncate(`${hold.submission_id} · ${hold.reason}`, Math.max(8, contentWidth - 12))}`}
            textWidth={contentWidth}
            width={contentWidth}
            onMouseDown={onHoldClick ? () => onHoldClick(index) : undefined}
          />
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
    </Surface>
  )
}

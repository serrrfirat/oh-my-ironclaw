// Per-code-block "wells" for the transcript's <markdown> renderer.
//
// A `renderNode` callback lets us intercept fenced code blocks and render them
// as a themed box (a code well) with a header row that names the language and
// offers a clickable "copy" affordance, while delegating every other token
// (prose, tables, lists, streaming text) back to the markdown renderer's own
// default rendering via `context.defaultRender()`.
//
// A ```diff fence is rendered through the structured <diff> view instead, with
// added/removed line tints drawn from the Glass palette so it matches the
// tool-output diff renderer.
import {
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  TextRenderable,
  infoStringToFiletype,
  type MarkdownOptions,
  type MouseEvent,
  type RenderContext,
  type Renderable,
  type SyntaxStyle,
} from "@opentui/core"
import { theme } from "./theme"

// The marked `code` token shape we rely on. Kept structural so we don't take a
// direct dependency on marked's exported types.
type CodeToken = { type: string; text?: string; lang?: string }

export type MarkdownRenderNode = NonNullable<MarkdownOptions["renderNode"]>

// A ```diff fenced block renders through the structured diff view rather than a
// plain code well.
export function isDiffFence(lang?: string | null): boolean {
  return (lang ?? "").trim().toLowerCase() === "diff"
}

// Text a per-block "copy" affordance places on the clipboard: the raw code,
// never the surrounding fence. Robust to a token with no text (partial stream).
export function codeBlockCopyText(token: { text?: string }): string {
  return token?.text ?? ""
}

// Build a renderNode that turns fenced code into themed wells and leaves every
// other markdown token to its default renderer. `onCopyCode` owns clipboard +
// notice (threaded from App) so this module never duplicates that logic.
export function makeCodeWellRenderNode({
  ctx,
  syntaxStyle,
  onCopyCode,
}: {
  ctx: RenderContext
  syntaxStyle: SyntaxStyle
  onCopyCode: (text: string) => void
}): MarkdownRenderNode {
  return (token, context) => {
    // Everything that isn't a fenced code block stays native (prose, tables,
    // lists, inline code, streaming text).
    if (token.type !== "code") return context.defaultRender()
    const code = token as CodeToken
    const lang = (code.lang ?? "").trim()
    return isDiffFence(lang)
      ? buildDiffWell(ctx, code, syntaxStyle, onCopyCode)
      : buildCodeWell(ctx, code, lang, syntaxStyle, onCopyCode)
  }
}

// Frame + header shared by code and diff wells. Returns the outer well and the
// body box the caller fills with a <code> or <diff> renderable.
function buildWellFrame(
  ctx: RenderContext,
  langLabel: string,
  copyText: string,
  onCopyCode: (text: string) => void,
): { well: BoxRenderable; body: BoxRenderable } {
  const well = new BoxRenderable(ctx, {
    backgroundColor: theme.bgCode,
    border: true,
    borderStyle: "rounded",
    borderColor: theme.border,
    flexDirection: "column",
    width: "100%",
    paddingLeft: 1,
    paddingRight: 1,
  })
  const header = new BoxRenderable(ctx, {
    flexDirection: "row",
    width: "100%",
    height: 1,
    backgroundColor: theme.bgCode,
  })
  const label = new TextRenderable(ctx, {
    content: langLabel || "text",
    fg: theme.textMuted,
    selectable: false,
  })
  const spacer = new BoxRenderable(ctx, { flexGrow: 1, height: 1, backgroundColor: theme.bgCode })
  const copy = new TextRenderable(ctx, {
    content: "⧉ copy",
    fg: theme.accentText,
    selectable: false,
    // Stop the click from bubbling to the message box (which would enter
    // transcript-nav / selection instead of copying).
    onMouseDown: (event: MouseEvent) => {
      event.stopPropagation()
      onCopyCode(copyText)
    },
  })
  header.add(label)
  header.add(spacer)
  header.add(copy)
  const body = new BoxRenderable(ctx, {
    flexDirection: "column",
    width: "100%",
    backgroundColor: theme.bgCode,
  })
  well.add(header)
  well.add(body)
  return { well, body }
}

function buildCodeWell(
  ctx: RenderContext,
  token: CodeToken,
  lang: string,
  syntaxStyle: SyntaxStyle,
  onCopyCode: (text: string) => void,
): Renderable {
  const { well, body } = buildWellFrame(ctx, lang, codeBlockCopyText(token), onCopyCode)
  const code = new CodeRenderable(ctx, {
    content: token.text ?? "",
    // Normalize the info string the same way the default renderer does
    // ("typescript" → "ts", etc.); unknown/absent langs fall back to plain.
    filetype: infoStringToFiletype(lang) ?? lang,
    syntaxStyle,
    width: "100%",
    // drawUnstyledText defaults on, so partial / incomplete streamed code shows
    // immediately as plain text and is colored once highlighting resolves.
    selectable: true,
  })
  body.add(code)
  return well
}

function buildDiffWell(
  ctx: RenderContext,
  token: CodeToken,
  syntaxStyle: SyntaxStyle,
  onCopyCode: (text: string) => void,
): Renderable {
  const { well, body } = buildWellFrame(ctx, "diff", codeBlockCopyText(token), onCopyCode)
  const diff = new DiffRenderable(ctx, {
    diff: token.text ?? "",
    view: "unified",
    syntaxStyle,
    width: "100%",
    addedBg: theme.okSoftBg,
    removedBg: theme.dangerSoftBg,
    addedSignColor: theme.ok,
    removedSignColor: theme.danger,
    showLineNumbers: false,
  })
  body.add(diff)
  return well
}

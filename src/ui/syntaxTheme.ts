// Themed tree-sitter / markdown syntax style for the transcript's <markdown>
// renderer. The default SyntaxStyle.create() ships with no token colors, so
// code and prose render flat. This maps the scope names emitted by opentui's
// markdown + tree-sitter highlighters (js / ts / zig grammars, plus markdown
// prose scopes) onto the Glass palette in theme.ts.
//
// Scope names are the tree-sitter capture names with the leading "@" stripped
// (e.g. `@keyword.return` → `keyword.return`) and the markdown prose scopes
// (`markup.heading`, `markup.strong`, ...). Resolution is hierarchical: a scope
// with no exact entry falls back to its base name (`variable.member` →
// `variable`), so registering the base scopes covers the long tail.
import { SyntaxStyle, type StyleDefinitionInput } from "@opentui/core"
import { theme } from "./theme"

export const SYNTAX_THEME_STYLES: Record<string, StyleDefinitionInput> = {
  // Fallback for any un-scoped code / prose run.
  default: { fg: theme.text },

  // --- code: keywords / control flow ---
  keyword: { fg: theme.accent },
  "keyword.return": { fg: theme.accent },
  "keyword.import": { fg: theme.accent },
  "keyword.conditional": { fg: theme.accent },

  // --- code: literals ---
  string: { fg: theme.ok },
  "string.escape": { fg: theme.ok },
  "string.regexp": { fg: theme.ok },
  number: { fg: theme.warn },
  boolean: { fg: theme.warn },
  constant: { fg: theme.warn },
  "constant.builtin": { fg: theme.warn },

  // --- code: comments ---
  comment: { fg: theme.textFaint, italic: true, dim: true },

  // --- code: callables / types ---
  function: { fg: theme.info },
  "function.call": { fg: theme.info },
  "function.method": { fg: theme.info },
  "function.builtin": { fg: theme.info },
  type: { fg: theme.accentText },
  "type.builtin": { fg: theme.accentText },
  constructor: { fg: theme.accentText },
  module: { fg: theme.accentText },

  // --- code: identifiers ---
  variable: { fg: theme.text },
  "variable.member": { fg: theme.text },
  "variable.parameter": { fg: theme.text },
  property: { fg: theme.text },

  // --- code: punctuation / operators ---
  operator: { fg: theme.textMuted },
  punctuation: { fg: theme.textMuted },
  "punctuation.bracket": { fg: theme.textMuted },
  "punctuation.delimiter": { fg: theme.textMuted },
  "punctuation.special": { fg: theme.textMuted },

  // --- prose: headings + emphasis ---
  // Register the numbered heading scopes explicitly: some grammars emit
  // `markup.heading.1`…`.6` and the numeric leaf doesn't always fall back to the
  // base `markup.heading`, so headings rendered at regular weight without these.
  "markup.heading": { fg: theme.textStrong, bold: true },
  "markup.heading.1": { fg: theme.textStrong, bold: true },
  "markup.heading.2": { fg: theme.textStrong, bold: true },
  "markup.heading.3": { fg: theme.textStrong, bold: true },
  "markup.heading.4": { fg: theme.textStrong, bold: true },
  "markup.heading.5": { fg: theme.textStrong, bold: true },
  "markup.heading.6": { fg: theme.textStrong, bold: true },
  "markup.strong": { fg: theme.textStrong, bold: true },
  strong: { fg: theme.textStrong, bold: true },
  "markup.italic": { fg: theme.text, italic: true },
  italic: { fg: theme.text, italic: true },
  "markup.strikethrough": { fg: theme.textMuted },

  // --- prose: links ---
  "markup.link": { fg: theme.accentText, underline: true },
  "markup.link.label": { fg: theme.accentText, underline: true },
  "markup.link.url": { fg: theme.accentText, underline: true },
  link: { fg: theme.accentText, underline: true },

  // --- prose: inline / fenced code + quotes + lists ---
  // Inline `code` reads as a subtle chip (accent text on the code well bg) so it
  // stands apart from body prose. Fenced blocks (raw.block) are rendered as full
  // code wells via renderNode, so their scope styling here is a plain fallback.
  "markup.raw": { fg: theme.accentText, bg: theme.bgCode },
  "markup.raw.block": { fg: theme.text },
  "markup.quote": { fg: theme.textMuted, italic: true },
  "markup.list": { fg: theme.textMuted },
}

// Build the shared SyntaxStyle instance used by every <markdown> renderer.
// Constructs the native style object, so it must be called inside the renderer
// (e.g. via useMemo in App), not at module load.
export function createMarkdownSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles(SYNTAX_THEME_STYLES)
}

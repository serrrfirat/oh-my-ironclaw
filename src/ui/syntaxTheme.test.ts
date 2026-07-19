import { describe, expect, test } from "bun:test"
import { SYNTAX_THEME_STYLES } from "./syntaxTheme"
import { theme } from "./theme"

describe("syntax theme style map", () => {
  test("registers the core code + prose scopes", () => {
    const scopes = Object.keys(SYNTAX_THEME_STYLES)
    for (const scope of [
      "default",
      "keyword",
      "string",
      "comment",
      "number",
      "boolean",
      "constant",
      "function",
      "type",
      "variable",
      "property",
      "operator",
      "punctuation",
      "constructor",
      "module",
      "markup.heading",
      "markup.strong",
      "markup.italic",
      "markup.link",
      "markup.raw",
    ]) {
      expect(scopes).toContain(scope)
    }
  })

  test("maps code scopes to the expected Glass palette tones", () => {
    expect(SYNTAX_THEME_STYLES.keyword.fg).toBe(theme.accent)
    expect(SYNTAX_THEME_STYLES.string.fg).toBe(theme.ok)
    expect(SYNTAX_THEME_STYLES.comment.fg).toBe(theme.textFaint)
    expect(SYNTAX_THEME_STYLES.number.fg).toBe(theme.warn)
    expect(SYNTAX_THEME_STYLES.boolean.fg).toBe(theme.warn)
    expect(SYNTAX_THEME_STYLES.constant.fg).toBe(theme.warn)
    expect(SYNTAX_THEME_STYLES.function.fg).toBe(theme.info)
    expect(SYNTAX_THEME_STYLES.type.fg).toBe(theme.accentText)
    expect(SYNTAX_THEME_STYLES.variable.fg).toBe(theme.text)
    expect(SYNTAX_THEME_STYLES.property.fg).toBe(theme.text)
    expect(SYNTAX_THEME_STYLES.operator.fg).toBe(theme.textMuted)
    expect(SYNTAX_THEME_STYLES.punctuation.fg).toBe(theme.textMuted)
    expect(SYNTAX_THEME_STYLES["constructor"].fg).toBe(theme.accentText)
    expect(SYNTAX_THEME_STYLES.module.fg).toBe(theme.accentText)
    expect(SYNTAX_THEME_STYLES.default.fg).toBe(theme.text)
  })

  test("maps prose scopes to the expected tones + attributes", () => {
    expect(SYNTAX_THEME_STYLES["markup.heading"].fg).toBe(theme.textStrong)
    expect(SYNTAX_THEME_STYLES["markup.heading"].bold).toBe(true)
    expect(SYNTAX_THEME_STYLES["markup.strong"].fg).toBe(theme.textStrong)
    expect(SYNTAX_THEME_STYLES["markup.strong"].bold).toBe(true)
    expect(SYNTAX_THEME_STYLES["markup.italic"].fg).toBe(theme.text)
    expect(SYNTAX_THEME_STYLES["markup.italic"].italic).toBe(true)
    expect(SYNTAX_THEME_STYLES["markup.link"].fg).toBe(theme.accentText)
    expect(SYNTAX_THEME_STYLES["markup.link"].underline).toBe(true)
    expect(SYNTAX_THEME_STYLES["markup.raw"].fg).toBe(theme.text)
  })

  test("comment is dimmed + italic for a de-emphasized read", () => {
    expect(SYNTAX_THEME_STYLES.comment.dim).toBe(true)
    expect(SYNTAX_THEME_STYLES.comment.italic).toBe(true)
  })

  test("every registered scope carries a foreground color", () => {
    for (const [scope, style] of Object.entries(SYNTAX_THEME_STYLES)) {
      expect(typeof style.fg, `scope ${scope} must define fg`).toBe("string")
    }
  })
})

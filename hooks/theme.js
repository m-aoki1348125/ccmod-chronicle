// The pane's visual vocabulary: glyphs, severity, section headings, meta lines, stats and text
// buttons. Colors are theme keys, so the pane follows the person's light or dark theme, and every
// color comes with a word, so nothing is told by color alone. No mods API here.

import { RAINBOW } from './rainbow-client.js'

// Plain Unicode that Claude Code's own interface already draws (so every terminal it runs in draws
// it one cell wide and in the text font): no emoji, nothing that depends on an emoji font.
export const GLYPH = Object.freeze({
  dot: '●',
  ring: '○',
  arrow: '→',
  external: '↗',
  check: '✓',
  sep: '·',
  rule: '─',
})
const ACCENT = 'claude'

// Severity differs by color and by the word written beside it; low is also a hollow ring.
const SEVERITY = Object.freeze({
  high: { glyph: GLYPH.dot, color: 'error', word: 'sevHigh' },
  mid: { glyph: GLYPH.dot, color: 'warning', word: 'sevMid' },
  low: { glyph: GLYPH.ring, color: 'suggestion', word: 'sevLow' },
})

export const severityOf = (f) => SEVERITY[f?.severity] || SEVERITY.low

// A hairline across the pane body, as the section rules of the host's own screens. The body
// width comes from the surface; a width that is not a number, or past any pane, draws a short one.
const MAX_RULE = 512
export function rule(el, cols) {
  const n = Number.isFinite(cols) ? Math.min(MAX_RULE, Math.max(1, Math.floor(cols))) : 1
  return el.Text({ dimColor: true, wrap: 'truncate', children: [GLYPH.rule.repeat(n)] })
}

// A bold title with an optional dim trailing part, pushed to the right edge.
export function heading(el, title, trailing) {
  const { Box, Text } = el
  const parts = Array.isArray(trailing) ? trailing : trailing ? [Text({ dimColor: true, wrap: 'truncate-end', children: [trailing] })] : []
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    justifyContent: 'space-between',
    children: [Text({ bold: true, children: [title] }), ...parts],
  })
}

// Dim secondary text; several parts are joined with a middle dot.
export function meta(el, parts, props = {}) {
  const text = (Array.isArray(parts) ? parts : [parts]).filter((p) => p !== null && p !== undefined && p !== '').join(` ${GLYPH.sep} `)
  return el.Text({ dimColor: true, ...props, children: [text] })
}

// A one-cell glyph, then text that wraps under itself (a hanging indent), not under the glyph.
export function glyphLine(el, glyph, text, textProps = {}, glyphProps = {}) {
  const { Box, Text } = el
  return Box({ flexDirection: 'row', columnGap: 1, children: [Text({ ...glyphProps, children: [glyph] }), Text({ ...textProps, children: [text] })] })
}

// A dim label in a fixed column, then the text: `commits  feat: …`.
export function labelled(el, label, text, width, textProps = {}) {
  const { Box, Text } = el
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [Box({ width, flexShrink: 0, children: [Text({ dimColor: true, wrap: 'truncate-end', children: [label] })] }), Text({ ...textProps, children: [text] })],
  })
}

// A stat: a dim label over a bold figure, with an optional dim note. No frame; the figures line
// up as a row of columns, as the host's own summaries do.
function stat(el, { label, value, color, note }) {
  const { Box, Text } = el
  return Box({
    flexDirection: 'column',
    children: [
      Text({ dimColor: true, wrap: 'truncate-end', children: [label] }),
      Text({ bold: true, ...(color ? { color } : {}), children: [String(value)] }),
      note ? Text({ dimColor: true, wrap: 'truncate-end', children: [note] }) : null,
    ].filter(Boolean),
  })
}

export function statRow(el, stats) {
  return el.Box({ flexDirection: 'row', columnGap: 4, rowGap: 1, flexWrap: 'wrap', children: stats.map((s) => stat(el, s)) })
}

// A text button, no chrome: accent for the actions that lead somewhere, dim for the quiet ones.
// With a hotkey the terminal writes it first (`b: Back`), as the host's own rows read.
export function textButton(el, { key, label, hotkey, onPress, tone = 'accent' }) {
  const { Button, Text } = el
  const base = { key, plain: true, onPress, ...(hotkey ? { hotkey } : {}) }
  if (tone === 'dim') return Button({ ...base, label, dimColor: true })
  if (tone === 'plain') return Button({ ...base, label })
  return Button({ ...base, children: [Text({ color: ACCENT, children: [label] })] })
}

// Rainbow letters, as the prompt highlights `ultrathink`: `rainbow` animates them where the
// surface draws a Client (terminal, desktop), `still` colors them once, `plain` uses one color.
export function rainbowText(el, { key, text, effect, bold = true, color = 'warning' }) {
  if (effect === 'plain') return el.Text({ bold, color, children: [text] })
  if (effect === 'rainbow' && el.Client) return el.Client({ key, module: './rainbow-client.js', props: { text, bold } })
  const chars = Array.from(text)
  return el.Text({ bold, children: chars.map((c, i) => el.Text({ color: RAINBOW[i % RAINBOW.length], children: [c] })) })
}

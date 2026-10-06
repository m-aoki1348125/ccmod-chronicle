// The pane's visual vocabulary: icons, severity chips, section headers and stat tiles. Colors are
// theme keys, so the pane follows the person's light or dark theme; every color comes with an
// icon or a word, so nothing is told by color alone. No mods API here.

// Emoji with default emoji presentation (no variation selector), so every terminal draws them
// two cells wide and in color. Severity differs in shape as well as color (circle, orange and
// blue diamonds), so it reads without color too.
export const TAB_ICON = Object.freeze({ now: '🎯', cost: '💰', tips: '💡', standup: '📋', improve: '📈', settings: '🔧' })
const SEVERITY = Object.freeze({
  high: { icon: '🔴', color: 'error', word: 'sevHigh' },
  mid: { icon: '🔶', color: 'warning', word: 'sevMid' },
  low: { icon: '🔷', color: 'suggestion', word: 'sevLow' },
})
export const STATUS_ICON = Object.freeze({ error: '❌', indexing: '⏳', indexed: '✅', none: '⚪' })
export const ICON = Object.freeze({ evidence: '📊', action: '👉', ai: '🤖', folder: '📁', commit: '🔀', file: '📄', recap: '💬', empty: '✨', session: '💭' })
export const ACCENT = 'claude'

export const severityOf = (f) => SEVERITY[f?.severity] || SEVERITY.low

// A word on a colored band: ` HIGH `. The text uses the theme's inverse color so it reads on
// the band in both light and dark themes.
export function chip(el, text, color) {
  return el.Text({ backgroundColor: color, color: 'inverseText', bold: true, children: [` ${text} `] })
}

// ▌ Title  subtitle — the accent bar starts each section.
export function section(el, title, subtitle) {
  const { Box, Text } = el
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Text({ color: ACCENT, bold: true, children: ['▌'] }),
      Text({ bold: true, children: [title] }),
      subtitle ? Text({ dimColor: true, wrap: 'truncate-end', children: [subtitle] }) : null,
    ].filter(Boolean),
  })
}

// An icon, then text that wraps under itself (a hanging indent), not under the icon.
export function iconLine(el, icon, text, textProps = {}) {
  const { Box, Text } = el
  return Box({ flexDirection: 'row', columnGap: 1, children: [Text({ children: [icon] }), Text({ ...textProps, children: [text] })] })
}

// A stat tile: a small label over a big bold number, in a rounded frame.
function tile(el, { label, value, color, note }) {
  const { Box, Text } = el
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: color || 'subtle',
    paddingX: 1,
    children: [
      Text({ dimColor: true, wrap: 'truncate-end', children: [label] }),
      Text({ bold: true, ...(color ? { color } : {}), children: [String(value)] }),
      note ? Text({ dimColor: true, wrap: 'truncate-end', children: [note] }) : null,
    ].filter(Boolean),
  })
}

export function tileRow(el, tiles) {
  return el.Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: tiles.map((t) => tile(el, t)) })
}

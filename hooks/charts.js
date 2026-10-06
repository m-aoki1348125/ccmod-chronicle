// Rich pane charts: the data each chart shows, and the two ways to draw it — Raster cells for the
// terminal, SVG for the desktop app. Pure functions, no mods API. Colors and forms follow the
// dataviz method: categorical slots in fixed order (validated light and dark), one blue for
// magnitude, status colors only for state and always beside an icon and a word.

import { THRESHOLDS, TRIGGERS, sessionCacheRead, sessionLabel, totals } from './rules.js'

// Dark-surface steps: the terminal's background is unknown, and most are dark.
export const SERIES = Object.freeze(['#3987e5', '#d95926', '#199e70', '#c98500'])
const SERIES_LIGHT = Object.freeze(['#2a78d6', '#eb6834', '#1baf7a', '#eda100'])
export const OTHER = '#8a8983'
export const SEQUENTIAL = '#3987e5'
export const STATUS = Object.freeze({ good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' })
const TRACK = '#4a4a46'
const MAX_SERIES = 4
const TOP_ROWS = 5
const SPARK_DAYS = 30
const COMPACT_ROWS = 8

const hex = (c) => parseInt(c.slice(1), 16)
const DEFAULT_COLOR = 0x01000000

// ---------- data ----------

const finitePct = (v) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null)

// Context warns from 60% and is high from 80%; a plan limit warns from 80%, as the Now rules do.
export function statusOf(pct, kind = 'context') {
  if (kind === 'rate') return pct >= THRESHOLDS.rateLimitWarnPct ? 'warning' : 'good'
  if (pct >= THRESHOLDS.contextHighPct) return 'critical'
  if (pct >= THRESHOLDS.contextWarnPct) return 'warning'
  return 'good'
}

// Part-to-whole: the top models by output tokens, the rest folded into "Other" (never a 5th hue).
function modelMix(tot) {
  const rows = Object.entries(tot.usage).map(([m, u]) => ({ label: m.replace('claude-', ''), value: u.out })).filter((r) => r.value > 0)
  rows.sort((a, b) => b.value - a.value)
  const top = rows.slice(0, MAX_SERIES).map((r, i) => ({ ...r, color: SERIES[i] }))
  const rest = rows.slice(MAX_SERIES).reduce((n, r) => n + r.value, 0)
  return rest ? [...top, { label: 'other', value: rest, color: OTHER }] : top
}

// The indexer keys byDay by local date, so the last days are local dates too (stepped by calendar
// day, not 24 h, so a DST change never skips or repeats one).
export const localDay = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lastDays(byDay = {}, nowMs) {
  return Array.from({ length: SPARK_DAYS }, (_, k) => {
    const d = new Date(nowMs)
    d.setDate(d.getDate() - (SPARK_DAYS - 1 - k))
    const day = localDay(d.getTime())
    return { label: day, value: byDay[day] || 0 }
  })
}

// The digest's charts; they change only with the digest and the local date, so callers memoize them.
export function digestCharts(digest, nowMs) {
  const tot = totals(digest)
  const heavy = (digest?.sessions || []).map((s) => ({ label: sessionLabel(s), value: sessionCacheRead(s) })).filter((r) => r.value > 0)
  heavy.sort((a, b) => b.value - a.value)
  const compactions = tot.compactions.filter((c) => c.preTokens).slice(-COMPACT_ROWS)
  return Object.freeze({
    modelMix: modelMix(tot),
    heavy: heavy.slice(0, TOP_ROWS),
    compactions: compactions.map((c) => ({ label: `${String(c.at || '').slice(5, 10)} ${TRIGGERS.has(c.trigger) ? c.trigger : '?'}`, value: c.preTokens })),
    perDay: lastDays(digest?.history?.byDay, nowMs),
  })
}

// The live session's meters, rebuilt on every draw.
export function liveCharts(live) {
  const context = finitePct(live?.context?.percent)
  const rates = (live?.rateLimits || []).map((r) => ({ kind: String(r.kind ?? ''), pct: finitePct(r.percentUsed) })).filter((r) => r.pct !== null)
  return Object.freeze({ context: context === null ? null : { pct: context }, rates })
}

export const chartData = (digest, live, nowMs) => Object.freeze({ ...digestCharts(digest, nowMs), ...liveCharts(live) })

// ---------- terminal: Raster cells ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64, written out so it does not depend on Uint8Array.prototype.toBase64.
function base64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

// cells: one row of [char, '#rrggbb' | null] -> RasterProps for that row.
// Written through a DataView so the bytes are little-endian whatever the host's byte order.
export function rasterRow(key, cells) {
  const view = new DataView(new ArrayBuffer(cells.length * 12))
  cells.forEach(([ch, fg], i) => {
    view.setUint32(i * 12, ch.codePointAt(0), true)
    view.setUint32(i * 12 + 4, fg ? hex(fg) : DEFAULT_COLOR, true)
    view.setUint32(i * 12 + 8, DEFAULT_COLOR, true)
  })
  return { key, columns: cells.length, rows: 1, cells: base64(new Uint8Array(view.buffer)) }
}

const widthOf = (value, max, cols) => (max > 0 ? Math.max(value > 0 ? 1 : 0, Math.round((value / max) * cols)) : 0)

export function meterCells(pct, cols, color) {
  const filled = widthOf(Math.min(100, Math.max(0, pct)), 100, cols)
  return Array.from({ length: cols }, (_, i) => (i < filled ? ['█', color] : ['░', TRACK]))
}

// Widths that sum to exactly `room`, every segment at least one cell (largest remainder; the
// cells a tiny segment borrows come from the widest one).
export function allocate(values, room) {
  const total = values.reduce((a, b) => a + b, 0) || 1
  const exact = values.map((v) => (v / total) * room)
  const out = exact.map((x) => Math.max(1, Math.floor(x)))
  let left = room - out.reduce((a, b) => a + b, 0)
  const byRemainder = exact.map((x, i) => [x % 1, i]).sort((a, b) => b[0] - a[0])
  for (const [, i] of byRemainder) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  while (left < 0) {
    const i = out.indexOf(Math.max(...out))
    out[i] -= 1
    left += 1
  }
  return out
}

// Segments side by side with a one-cell gap between them (the surface gap between fills). Where
// the columns cannot hold a cell and a gap for each, the smallest segments fold away.
export function stackedCells(segments, cols) {
  const shown = segments.slice(0, Math.max(1, Math.floor((cols + 1) / 2)))
  const widths = allocate(shown.map((s) => s.value), Math.max(shown.length, cols - (shown.length - 1)))
  return shown.flatMap((s, i) => [...(i > 0 ? [[' ', null]] : []), ...Array.from({ length: widths[i] }, () => ['█', s.color])])
}

export function barCells(value, max, cols, color) {
  return Array.from({ length: widthOf(value, max, cols) }, () => ['█', color])
}

const LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function sparkCells(values, color) {
  const max = Math.max(1, ...values)
  return values.map((v) => (v > 0 ? [LEVELS[Math.min(7, Math.floor((v / max) * 7.999))], color] : ['▁', TRACK]))
}

// ---------- desktop: SVG ----------

// Characters XML 1.0 does not allow (C0 controls, U+FFFE/FFFF, lone surrogates) would make the SVG
// fail to parse, so they are dropped before escaping.
const XML_INVALID = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu
const esc = (s) => String(s).replace(XML_INVALID, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const BAR_H = 10

// Light steps by default, dark steps under the desktop's dark scheme; each mark carries a tooltip.
function svgDoc(width, height, body, colors) {
  const light = colors.map((c, i) => `.c${i}{fill:${c.light}}`).join('')
  const dark = colors.map((c, i) => `.c${i}{fill:${c.dark}}`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<style>.t{fill:#d6d5cf}${light}@media (prefers-color-scheme: dark){.t{fill:#4a4a46}${dark}}</style>${body}</svg>`
}

const pair = (c) => ({ light: SERIES_LIGHT[SERIES.indexOf(c)] || c, dark: c })

export function svgMeter(pct, width, color) {
  const w = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  const body = `<rect class="t" x="0" y="0" width="${width}" height="${BAR_H}" rx="4"/>`
    + `<rect class="c0" x="0" y="0" width="${w}" height="${BAR_H}" rx="4"><title>${esc(Math.round(pct) + '%')}</title></rect>`
  return svgDoc(width, BAR_H, body, [pair(color)])
}

export function svgStacked(segments, width) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1
  // Same allocation as the terminal: widths sum to the room left after the 2px gaps.
  const widths = allocate(segments.map((s) => s.value), Math.max(segments.length, width - 2 * (segments.length - 1)))
  let x = 0
  const body = segments.map((s, i) => {
    const w = widths[i]
    const rect = `<rect class="c${i}" x="${x}" y="0" width="${w}" height="${BAR_H}" rx="2"><title>${esc(s.label + ' ' + Math.round((s.value / total) * 100) + '%')}</title></rect>`
    x += w + 2
    return rect
  }).join('')
  return svgDoc(width, BAR_H, body, segments.map((s) => pair(s.color)))
}

export function svgBar(value, max, width, color, title) {
  const w = Math.max(value > 0 ? 2 : 0, Math.round((value / (max || 1)) * width))
  return svgDoc(width, BAR_H, `<rect class="c0" x="0" y="0" width="${w}" height="${BAR_H}" rx="4"><title>${esc(title)}</title></rect>`, [pair(color)])
}

export function svgSpark(points, width, height, color) {
  const max = Math.max(1, ...points.map((p) => p.value))
  const step = width / points.length
  const body = points.map((p, i) => {
    const h = Math.max(1, Math.round((p.value / max) * height))
    return `<rect class="c0" x="${(i * step).toFixed(1)}" y="${height - h}" width="${Math.max(1, step - 2).toFixed(1)}" height="${h}" rx="1"><title>${esc(p.label + ': ' + p.value)}</title></rect>`
  }).join('')
  return svgDoc(width, height, body, [pair(color)])
}


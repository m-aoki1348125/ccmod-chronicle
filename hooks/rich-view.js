// Rich pane: charts above each tab's findings. Raster on the terminal, Svg elsewhere;
// no mods API here. Values, labels and legends stay in text color; a colored mark carries
// identity, and status always comes with an icon and a word.

import { THRESHOLDS, fmt } from './rules.js'
import { section, tileRow } from './theme.js'
import { SEQUENTIAL, STATUS, barCells, meterCells, rasterRow, sparkCells, stackedCells, statusOf, svgBar, svgMeter, svgSpark, svgStacked } from './charts.js'

const ICON = { good: '🟢', warning: '🟡', critical: '🔴' }
// The same states as theme colors, for tiles and frames that follow the person's theme.
const THEME = { good: 'success', warning: 'warning', critical: 'error' }
const WORD = { good: 'statusGood', warning: 'statusWarning', critical: 'statusCritical' }
const LABEL_COLS = 18
const VALUE_COLS = 8
const MIN_BAR = 1
const MAX_COLS = 512
const PX_PER_COL = 8

// One chart mark, drawn for the surface: a Raster row of cells on the terminal, SVG elsewhere.
function mark(el, model, key, cells, svg, alt) {
  const cols = Math.min(MAX_COLS, Math.max(1, model.cols))
  if (model.surface !== 'terminal') return el.Svg({ source: svg(cols * PX_PER_COL), alt, width: cols * PX_PER_COL, isInteractive: true })
  const row = cells(cols)
  // A Raster needs at least one cell; an empty bar draws as one blank.
  return el.Raster(rasterRow(key, row.length ? row : [[' ', null]]))
}

// A chart under a section header, indented; charts inside are sized with `indented(model)`.
const INDENT = 2
const indented = (model) => ({ ...model, cols: Math.max(1, model.cols - INDENT) })

function block(el, title, children, subtitle) {
  const { Box } = el
  return Box({ flexDirection: 'column', children: [section(el, title, subtitle), Box({ flexDirection: 'column', paddingLeft: INDENT, children })] })
}

function meter(el, model, key, title, pct, kind) {
  const { Box, Text } = el
  const state = statusOf(pct, kind)
  const head = Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Text({ bold: true, children: [title] }),
      Text({ color: STATUS[state], children: [ICON[state]] }),
      Text({ bold: true, color: THEME[state], children: [`${Math.round(pct)}% ${model.t(WORD[state])}`] }),
    ],
  })
  const bar = mark(el, model, key, (cols) => meterCells(pct, cols, STATUS[state]), (w) => svgMeter(pct, w, STATUS[state]), `${title} ${Math.round(pct)}%`)
  return Box({ flexDirection: 'column', children: [head, bar] })
}

// Labelled horizontal bars sharing one scale (magnitude: one hue).
function bars(el, model, keyBase, rows, max) {
  const { Box, Text } = el
  // The label column shrinks with the pane so the bar and its number always fit beside it.
  const labelCols = Math.min(LABEL_COLS, Math.floor(model.cols / 3))
  const sub = { ...model, cols: Math.max(MIN_BAR, model.cols - labelCols - VALUE_COLS - 2) }
  return rows.map((r, i) => Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Box({ width: labelCols, children: [Text({ wrap: 'truncate-end', children: [model.clean(r.label)] })] }),
      mark(el, sub, `${keyBase}-${i}`, (cols) => barCells(r.value, max, cols, SEQUENTIAL), (w) => svgBar(r.value, max, w, SEQUENTIAL, `${model.clean(r.label)}: ${fmt(r.value)}`), `${model.clean(r.label)} ${fmt(r.value)}`),
      Text({ dimColor: true, children: [fmt(r.value)] }),
    ],
  }))
}

function mix(el, model) {
  const { Box, Text } = el
  const segments = model.charts.modelMix
  if (!segments.length) return null
  const total = segments.reduce((n, s) => n + s.value, 0)
  const share = (s) => `${s.label} ${Math.round((s.value / total) * 100)}%`
  const stacked = mark(el, indented(model), 'mix', (cols) => stackedCells(segments, cols), (w) => svgStacked(segments, w), segments.map(share).join(', '))
  // Legend: always present for 2+ series, with the share written out (direct labels).
  const legend = Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: segments.map((s) => Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [Text({ color: s.color, children: ['■'] }), Text({ children: [share(s)] })],
    })),
  })
  return block(el, model.t('chartMix'), [stacked, legend])
}

function nowTiles(el, model) {
  const c = model.charts
  const u = model.aiUsage
  const ctx = c.context ? { value: `${Math.round(c.context.pct)}%`, color: THEME[statusOf(c.context.pct)] } : { value: '—' }
  return tileRow(el, [
    { label: '🧠 ' + model.t('tileContext'), ...ctx },
    { label: '📝 ' + model.t('tileUnreviewed'), value: c.unreviewed, ...(c.unreviewed >= THRESHOLDS.unreviewedEdits ? { color: 'warning' } : {}) },
    { label: '🤖 ' + model.t('tileAiCalls'), value: u.calls, note: model.t('tileTokens', { in: fmt(u.in), out: fmt(u.out) }) },
  ])
}

function costTiles(el, model) {
  const s = model.charts.summary
  return tileRow(el, [
    { label: '💬 ' + model.t('tileSessions'), value: s.sessions },
    { label: '📤 ' + model.t('tileOutput'), value: fmt(s.out), color: 'suggestion' },
    { label: '🔁 ' + model.t('tileCacheRead'), value: fmt(s.cacheRead) },
    { label: '📉 ' + model.t('tileCompactions'), value: s.compactions, ...(s.compactions ? { color: 'warning' } : {}) },
  ])
}

function standupTiles(el, model) {
  const rows = model.standup || []
  return tileRow(el, [
    { label: '💬 ' + model.t('tileSessions'), value: rows.reduce((n, r) => n + r.sessions.length, 0) },
    { label: '📁 ' + model.t('tileProjects'), value: rows.length },
    { label: '🔀 ' + model.t('tileCommits'), value: rows.reduce((n, r) => n + r.commits.length, 0) },
  ])
}

function nowCharts(el, model) {
  const c = model.charts
  const out = [nowTiles(el, model)]
  if (c.context) out.push(meter(el, model, 'ctx', model.t('chartContext'), c.context.pct))
  c.rates.forEach((r, i) => out.push(meter(el, model, 'rate-' + i, model.t('chartRate', { kind: r.kind }), r.pct, 'rate')))
  return out
}

function costCharts(el, model) {
  const c = model.charts
  const out = [costTiles(el, model), mix(el, model)].filter(Boolean)
  if (c.heavy.length) out.push(block(el, model.t('chartHeavy'), bars(el, indented(model), 'heavy', c.heavy, c.heavy[0].value)))
  if (c.compactions.length) {
    const window = Math.max(1_000_000, ...c.compactions.map((x) => x.value))
    out.push(block(el, model.t('chartCompact', { window: fmt(window) }), bars(el, indented(model), 'compact', c.compactions, window)))
  }
  if (out.length === 1) return [out[0], el.Text({ dimColor: true, children: ['✨ ' + model.t('noChartData')] })]
  return out
}

function standupCharts(el, model) {
  const inner = indented(model)
  // A pane narrower than 30 columns shows the most recent days that fit.
  const points = model.charts.perDay.slice(-Math.min(MAX_COLS, inner.cols))
  const max = Math.max(0, ...points.map((p) => p.value))
  // Each day takes up to three cells, so the spark spans the pane rather than a 30-cell corner.
  const per = Math.max(1, Math.min(3, Math.floor(Math.min(MAX_COLS, inner.cols) / points.length)))
  const sub = { ...inner, cols: points.length * per }
  const spark = mark(el, sub, 'per-day', () => sparkCells(points.map((p) => p.value), SEQUENTIAL).flatMap((c) => Array.from({ length: per }, () => c)), (w) => svgSpark(points, w, 24, SEQUENTIAL), points.map((p) => `${p.label} ${p.value}`).join(', '))
  return [standupTiles(el, model), block(el, model.t('chartPerDay', { max }), [spark])]
}

const BY_TAB = { now: nowCharts, cost: costCharts, standup: standupCharts }

// Labels come from transcripts (model names, folder names, triggers): clean them once, here, so
// every Text, alt and SVG tooltip below gets the same control- and bidi-free text.
function cleanCharts(c, clean) {
  const rows = (list) => list.map((r) => ({ ...r, label: clean(r.label) }))
  return { ...c, modelMix: rows(c.modelMix), heavy: rows(c.heavy), compactions: rows(c.compactions), rates: c.rates.map((r) => ({ ...r, kind: clean(r.kind) })) }
}

// The charts for the open tab, or nothing where the tab has none or the surface draws neither.
export function richCharts(el, model) {
  const build = BY_TAB[model.tab]
  if (!build || !model.charts) return []
  if (model.surface === 'terminal' ? !el.Raster : !el.Svg) return []
  return build(el, { ...model, charts: cleanCharts(model.charts, model.clean) })
}

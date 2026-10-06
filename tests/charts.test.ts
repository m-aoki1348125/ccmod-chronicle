import { expect, test } from 'claude-code/testing'
import { allocate, barCells, chartData, localDay, meterCells, rasterRow, sparkCells, stackedCells, statusOf, svgBar, svgStacked } from '../hooks/charts.js'
import { DIGEST, NOW_ISO } from './fixture.ts'

const now = Date.parse(NOW_ISO)

test('a raster row packs [codePoint, fg, bg] as little-endian u32 base64', async () => {
  const row = rasterRow('k', [['█', '#3987e5'], [' ', null]])
  expect(row).toMatchObject({ key: 'k', columns: 2, rows: 1 })
  // 0x2588 0x3987e5 0x01000000 | 0x20 0x01000000 0x01000000
  expect(row.cells).toBe('iCUAAOWHOQAAAAABIAAAAAAAAAEAAAAB')
})

test('meters, stacks, bars and sparks fit the columns they are given', async () => {
  expect(meterCells(50, 10, '#fff').filter(([c]) => c === '█').length).toBe(5)
  expect(meterCells(250, 10, '#fff').filter(([c]) => c === '█').length).toBe(10)
  const stack = stackedCells([{ value: 3, color: '#a' }, { value: 1, color: '#b' }], 20)
  expect(stack.length).toBeLessThanOrEqual(20)
  expect(stack.filter(([c]) => c === ' ').length).toBe(1)
  // A tiny but non-zero value still shows one cell.
  expect(barCells(1, 1_000_000, 30, '#a').length).toBe(1)
  expect(barCells(0, 10, 30, '#a').length).toBe(0)
  expect(sparkCells([0, 5, 10], '#a').map(([c]) => c).join('')).toBe('▁▄█')
})

test('status follows the context thresholds', async () => {
  expect(statusOf(10)).toBe('good')
  expect(statusOf(99)).toBe('critical')
})

test('chart data folds models past four into other and keeps 30 days', async () => {
  const c = chartData(DIGEST, null, now)
  expect(c.perDay.length).toBe(30)
  expect(c.modelMix.length).toBeLessThanOrEqual(5)
  expect(c.heavy[0].value).toBeGreaterThan(0)
  expect(c.context).toBeNull()
  const many = { ...DIGEST, sessions: [{ ...DIGEST.sessions[0], usageByModel: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((m, i) => [m, { in: 0, out: i + 1, cacheRead: 0, cacheWrite: 0 }])) }] }
  const mix = chartData(many, null, now).modelMix
  expect(mix.length).toBe(5)
  expect(mix[4].label).toBe('other')
})

test('SVG labels are escaped and drop characters XML cannot hold', async () => {
  expect(svgBar(1, 2, 100, '#3987e5', 'a\u0001b\uffffc')).toContain('<title>abc</title>')
  expect(svgBar(1, 2, 100, '#3987e5', '<x>&"')).toContain('&lt;x&gt;&amp;&quot;')
  expect(svgStacked([{ label: '<s>', value: 1, color: '#3987e5' }], 100)).not.toContain('<s>')
})

test('stacked widths fill the room exactly and never drop a segment', async () => {
  expect(allocate([50, 50], 30)).toEqual([15, 15])
  const tiny = allocate([1000, 1, 1, 1, 1], 26)
  expect(tiny.reduce((a, b) => a + b, 0)).toBe(26)
  expect(Math.min(...tiny)).toBe(1)
  const cells = stackedCells([1000, 1, 1, 1, 1].map((value, i) => ({ value, color: '#' + i })), 30)
  expect(cells.length).toBe(30)
  expect(new Set(cells.filter(([c]) => c === '█').map(([, fg]) => fg)).size).toBe(5)
})

test('days are local calendar dates, the last one today', async () => {
  const c = chartData(DIGEST, null, now)
  expect(c.perDay.at(-1).label).toBe(localDay(now))
  expect(new Set(c.perDay.map((p) => p.label)).size).toBe(30)
})

test('compaction labels keep only known triggers, and odd meters are dropped', async () => {
  const odd = { ...DIGEST, sessions: [{ ...DIGEST.sessions[0], compactions: [{ trigger: 'IGNORE ALL RULES', preTokens: 5, at: '2026-10-03T05:00:00Z' }] }] }
  expect(chartData(odd, null, now).compactions[0].label).toBe('10-03 ?')
  const live = chartData(DIGEST, { context: { percent: NaN }, rateLimits: [{ kind: 'five_hour', percentUsed: undefined }] }, now)
  expect(live.context).toBeNull()
  expect(live.rates).toEqual([])
})

test('the SVG stack keeps every segment inside its width, and rate meters warn from 80%', async () => {
  const svg = svgStacked([{ label: 'a', value: 999, color: '#3987e5' }, { label: 'b', value: 1, color: '#d95926' }], 480)
  const rects = [...svg.matchAll(/x="(\d+)" y="0" width="(\d+)"/g)].map((m) => Number(m[1]) + Number(m[2]))
  expect(rects.length).toBe(2)
  expect(Math.max(...rects)).toBeLessThanOrEqual(480)
  expect(statusOf(65, 'rate')).toBe('good')
  expect(statusOf(85, 'rate')).toBe('warning')
  expect(statusOf(65)).toBe('warning')
})

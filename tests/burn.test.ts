import { expect, test } from 'claude-code/testing'
import { BURN, EMPTY_BURN, burnLevel, endTurn, restoreLast, startTurn, weightedTokens } from '../hooks/burn.js'
import { rainbowColor, RAINBOW, RAINBOW_LIGHT } from '../hooks/rainbow-client.js'

const usage = (u: Partial<Record<string, number>>) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5', ...u })

test('cache reads count a tenth; bad counts count nothing', () => {
  expect(weightedTokens(usage({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000 }))).toBe(260)
  expect(weightedTokens(usage({ input_tokens: -5, output_tokens: Number.NaN }))).toBe(0)
  expect(weightedTokens(undefined)).toBe(0)
})

test('the level is hot at the threshold, blaze at twice it, and off at 0', () => {
  expect(burnLevel(99_999, 100_000)).toBe(null)
  expect(burnLevel(100_000, 100_000)).toBe('hot')
  expect(burnLevel(200_000, 100_000)).toBe('blaze')
  expect(burnLevel(500_000, 0)).toBe(null)
})

test('a main turn adds its subagents\' tokens and divides by its own minutes', () => {
  let b = startTurn(EMPTY_BURN, 't1', 0)
  b = endTurn(b, { turnId: 'a1', agentId: 'sub', durationMs: 30_000, usage: usage({ output_tokens: 60_000 }) }, 100_000, 30_000)
  expect(b.turn?.tokens).toBe(60_000)
  b = endTurn(b, { turnId: 't1', durationMs: 30_000, usage: usage({ output_tokens: 40_000 }) }, 100_000, 30_000)
  expect(b.turn).toBe(null)
  expect(b.last).toEqual({ tokens: 100_000, ms: 30_000, perMin: 200_000, level: 'blaze', threshold: 100_000 })
})

test('a subagent run that began before the main turn is left out', () => {
  let b = startTurn(EMPTY_BURN, 't1', 100_000)
  b = endTurn(b, { turnId: 'a0', agentId: 'bg', durationMs: 300_000, usage: usage({ output_tokens: 500_000 }) }, 100_000, 106_000)
  b = endTurn(b, { turnId: 't1', durationMs: 6_000, usage: usage({ output_tokens: 1_000 }) }, 100_000, 106_000)
  expect([b.last?.tokens, b.last?.level]).toEqual([1_000, null])
})

test('a restored turn is judged by the threshold in effect now, and bad values are dropped', () => {
  const saved = { tokens: 300_000, ms: 60_000, perMin: 300_000, level: 'blaze', threshold: 100_000 }
  expect(restoreLast(saved, 500_000)).toEqual({ ...saved, level: null, threshold: 500_000 })
  expect(restoreLast(saved, 0)?.level).toBe(null)
  expect(restoreLast(saved, 200_000)?.level).toBe('hot')
  expect(restoreLast({ ...saved, perMin: 'x' }, 1)).toBe(null)
  expect(restoreLast(undefined, 1)).toBe(null)
})

test('short or small turns are measured but never flagged', () => {
  const small = endTurn(startTurn(EMPTY_BURN, 't', 0), { turnId: 't', durationMs: 6_000, usage: usage({ output_tokens: BURN.minTurnTokens - 1 }) }, 1)
  expect(small.last?.level).toBe(null)
  const short = endTurn(startTurn(EMPTY_BURN, 't', 0), { turnId: 't', durationMs: BURN.minTurnMs - 1, usage: usage({ output_tokens: 1_000_000 }) }, 1)
  expect(short.last?.level).toBe(null)
})

test('a new heavy turn shows a hidden alert again; a turn with no start changes nothing', () => {
  const hidden = { ...EMPTY_BURN, hidden: true }
  expect(endTurn(hidden, { turnId: 'x', durationMs: 60_000 }, 1)).toBe(hidden)
  const b = endTurn(startTurn(hidden, 't', 0), { turnId: 't', durationMs: 60_000, usage: usage({ output_tokens: 300_000 }) }, 100_000)
  expect([b.last?.level, b.hidden]).toEqual(['blaze', false])
})

test('rainbow letters cycle the palette and a lighter band sweeps across', () => {
  const at = (tick: number) => Array.from({ length: 7 }, (_, i) => rainbowColor(i, tick, 7))
  expect(at(0)).toEqual([...RAINBOW])
  expect(at(1)[0]).toBe(RAINBOW_LIGHT[RAINBOW.length - 1])
  expect(at(1).slice(1)).toEqual(RAINBOW.slice(0, 6))
  expect(at(4).slice(1, 4).every((c) => RAINBOW_LIGHT.includes(c))).toBe(true)
})

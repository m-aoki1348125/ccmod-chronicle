import { expect, test } from 'claude-code/testing'
import { buildCost, buildImprove, buildStandup, totals, workSessions } from '../hooks/rules.js'
import { buildTips } from '../hooks/catalog.js'
import { localFacts, makeCtx, ruleConfig } from '../hooks/i18n.js'
import { DIGEST, NOW_ISO } from './fixture.ts'

const ids = (list: { id: string }[]) => list.map((f) => f.id)
const [work, old] = [DIGEST.sessions[0], DIGEST.sessions[1]]
// A desktop helper's one-shot call the indexer marked automated, ended today with a prompt of its own.
const helper = { ...old, id: 'h1', project: '/work/helper', end: '2026-10-03T09:30:00Z', firstPrompt: 'summarize this', automated: true, usageByModel: { 'claude-haiku-5-5': { in: 1, out: 9_000_000, cacheRead: 0, cacheWrite: 0 } } }
const withHelper = { ...DIGEST, sessions: [...DIGEST.sessions, helper] }

test('automated runs stay out of the standup, the totals and the model mix', () => {
  expect(workSessions(withHelper).map((s: any) => s.id)).toEqual(['s1', 's0'])
  expect(buildStandup(withHelper, 1, Date.parse(NOW_ISO)).map((r: any) => r.project)).toEqual(['/work/demo-app'])
  expect(totals(withHelper).usage['claude-haiku-5-5']).toBeUndefined()
  const mix = buildCost(withHelper).find((f: any) => f.id === 'cost-model-mix')
  expect(mix?.title).toMatch(/ 0%/)
})

test('a compaction repeated in a copied session file counts once', () => {
  const copy = { ...work, id: 's1-copy' }
  expect(totals({ ...DIGEST, sessions: [work, copy] }).compactions.length).toBe(1)
})

test('effort set in settings silences the effort tip', () => {
  const base = { ...DIGEST, history: { ...DIGEST.history, slash: { '/model': 139, '/effort': 2 } } }
  expect(ids(buildTips(base))).toContain('tip-effort')
  const set = makeCtx('en', ruleConfig(), localFacts({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }))
  expect(ids(buildTips(base, set))).not.toContain('tip-effort')
  expect(localFacts({ effortLevel: 'high' }).effortConfigured).toBe(true)
  expect(localFacts({}).effortConfigured).toBe(false)
})

test('tool errors are flagged by their share of tool calls, not a bare count', () => {
  const busy = { ...work, tools: { Bash: 5000 }, toolErrors: 150 }
  expect(ids(buildImprove({ ...DIGEST, sessions: [busy] }))).not.toContain('improve-tool-errors')
  expect(ids(buildImprove({ ...DIGEST, sessions: [{ ...busy, toolErrors: 300 }] }))).toContain('improve-tool-errors')
})

test('Tips and Improve agree on whether redo prompts are a pattern', () => {
  const rare = { ...DIGEST, history: { ...DIGEST.history, correctionPrompts: 15, prompts: 1258 } }
  expect(ids(buildImprove(rare))).not.toContain('improve-corrections')
  expect(ids(buildTips(rare))).not.toContain('tip-rewind')
  expect(ids(buildTips(rare))).not.toContain('tip-plan-mode')
  expect(ids(buildImprove(DIGEST))).toContain('improve-corrections')
  expect(ids(buildTips(DIGEST))).toContain('tip-rewind')
})

import { expect, test } from 'claude-code/testing'
import { buildCost, buildImprove, buildNow, buildStandup, rankFindings, isReviewer } from '../hooks/rules.js'
import { buildTips } from '../hooks/catalog.js'
import { DIGEST, NOW_ISO } from './fixture.ts'
import { makeCtx, ruleConfig } from '../hooks/i18n.js'

// The user's own setup, as they would enter it in /config.
const MINE = makeCtx('en', ruleConfig({ memoryTools: 'mcp__notes__,notes', reviewerAgents: 'code-reviewer,security-reviewer,qa-agent' }))

const ids = (list: { id: string }[]) => list.map((f) => f.id)

test('cost flags late compaction, heavy sessions, credits and long turns', async () => {
  const got = ids(buildCost(DIGEST))
  expect(got).toContain('cost-late-compact')
  expect(got).toContain('cost-heavy-sessions')
  expect(got).toContain('cost-credits')
  expect(got).toContain('cost-long-turns')
})

test('improve flags the missing review gate and repeated corrections', async () => {
  const got = ids(buildImprove(DIGEST, MINE))
  expect(got).toContain('improve-review-gate')
  expect(got).toContain('improve-corrections')
  expect(got).toContain('improve-tool-errors')
  // 5 memory cues vs 2 notes calls -> recall finding fires
  expect(got).toContain('improve-recall')
})

test('tips use real usage numbers', async () => {
  const tips = buildTips(DIGEST)
  expect(ids(tips)).toContain('tip-loop')
  expect(ids(tips)).toContain('tip-effort')
  const loop = tips.find((t) => t.id === 'tip-loop')
  expect(loop?.evidence).toMatch(/47/)
})

test('now warns on context, rate limit, unreviewed code and risky commands', async () => {
  const got = ids(buildNow({
    context: { tokens: 850000, window: 1000000, percent: 85 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-03T13:10:00Z' }],
    unreviewed: ['/a.ts', '/b.ts', '/c.py'],
    risky: { 'force push': 1 },
    permissionMode: 'auto',
  }))
  expect(got).toEqual(['now-context', 'now-rate-five_hour', 'now-unreviewed', 'now-risky-force push'])
})

test('now stays quiet for a healthy session', async () => {
  expect(buildNow({ context: { tokens: 10, window: 100, percent: 10 }, rateLimits: [], unreviewed: [], risky: {} })).toEqual([])
})

test('standup keeps only the window and marks prompt-derived titles', async () => {
  const rows = buildStandup(DIGEST, 1, Date.parse(NOW_ISO), { '/work/demo-app': ['fix eval'] })
  expect(rows.length).toBe(1)
  expect(rows[0].project).toBe('/work/demo-app')
  expect(rows[0].sessions[0]).toMatchObject({ title: 'Ship the settings page', fromPrompt: false })
  expect(rows[0].commits).toEqual(['fix eval'])
  const week = buildStandup(DIGEST, 60, Date.parse(NOW_ISO))
  expect(week.find((r) => r.project === '/work/old')?.sessions[0].fromPrompt).toBe(true)
})

test('rankFindings sorts by severity and hides dismissed ids', async () => {
  const list = [
    { id: 'a', severity: 'low' }, { id: 'b', severity: 'high' }, { id: 'c', severity: 'mid' },
  ]
  expect(ids(rankFindings(list, ['c']))).toEqual(['b', 'a'])
})

test('reviewer detection accepts plugin-scoped agent names', async () => {
  const reviewers = ['code-reviewer', 'qa-agent']
  expect(isReviewer('code-reviewer', reviewers)).toBe(true)
  expect(isReviewer('my-plugin:qa-agent', reviewers)).toBe(true)
  expect(isReviewer('general-purpose', reviewers)).toBe(false)
})

test('generic defaults: no recall check without a note tool, no review checks without reviewers', async () => {
  expect(ids(buildImprove(DIGEST))).not.toContain('improve-recall')
  const noReviewers = makeCtx('en', ruleConfig({ reviewerAgents: '' }))
  expect(ids(buildImprove(DIGEST, noReviewers))).not.toContain('improve-review-gate')
  const live = { context: null, rateLimits: [], unreviewed: ['/a.ts', '/b.ts', '/c.ts'], risky: {} }
  expect(ids(buildNow(live, noReviewers))).toEqual([])
  expect(buildNow(live)[0].action).toMatch(/code-reviewer, security-reviewer/)
})

test('English and Japanese render the same findings with their own wording and doc links', async () => {
  const en = buildCost(DIGEST, makeCtx('en'))
  const ja = buildCost(DIGEST, makeCtx('ja'))
  expect(ids(en)).toEqual(ids(ja))
  expect(en[0].title).toMatch(/compactions happened above/)
  expect(ja[0].title).toMatch(/回中/)
  expect(en[0].doc).toMatch(/\/docs\/en\//)
  expect(ja[0].doc).toMatch(/\/docs\/ja\//)
})

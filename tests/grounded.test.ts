import { expect, test } from 'claude-code/testing'
import { buildImprove } from '../hooks/rules.js'
import { buildTips } from '../hooks/catalog.js'
import { groundedImprove, ownAssetTips, repoSessions } from '../hooks/grounded.js'
import { shareableFinding } from '../hooks/privacy.js'
import { makeCtx, ruleConfig } from '../hooks/i18n.js'
import { DIGEST } from './fixture.ts'

const base = DIGEST.sessions[0]
const session = (id: string, project: string, extra: object) => ({ ...base, id, project, dir: '-w-app', end: `2026-10-0${id.length}T09:00:00Z`, compactions: [], ...extra })
const digest = {
  ...DIGEST,
  sessions: [
    session('a', '/w/app', { friction: { 'npm test': 2, Read: 9 }, corrections: 3 }),
    session('bb', '/w/app/web', { friction: { 'npm test': 2 }, corrections: 2 }),
    session('ccc', '/w/other', { friction: { 'npm test': 50 }, corrections: 9 }),
    session('dddd', '/w/app', { friction: { 'npm test': 9 }, automated: true }),
  ],
}
const local = { cwd: '/w/app', isRepo: true, claudeDir: '/h/.claude', agents: [{ name: 'code-reviewer' }, { name: 'fable-eye' }, { name: 'planner' }], skills: [{ name: 'verify' }, { name: 'orchestrate' }] }
const ctx = makeCtx('ja', ruleConfig(), local)
const ids = (list: { id: string }[]) => list.map((f) => f.id)

test('only this repository\'s work sessions count, its subfolders included', () => {
  expect(repoSessions(digest, '/w/app/', true).map((s: any) => s.id)).toEqual(['a', 'bb'])
  // Windows paths match whatever their slashes and letter case.
  const win = { ...digest, sessions: [{ ...digest.sessions[0], project: 'C:\\W\\App\\web' }] }
  expect(repoSessions(win, 'c:/w/app', true).length).toBe(1)
  expect(repoSessions(digest, '')).toEqual([])
  // Outside a git repository (a home folder) subfolders are other projects.
  expect(repoSessions(digest, '/w/app', false).map((s: any) => s.id)).toEqual(['a'])
})

test('a command that fails across sessions is named, with the transcripts to read', () => {
  const f = groundedImprove(digest, ctx).find((x: any) => x.id.startsWith('improve-friction-') && x.id.endsWith('-npm test'))
  expect(f?.title).toBe('このリポジトリで `npm test` が 4 回失敗（2 セッション）')
  expect(f?.applyPrompt).toContain('/h/.claude/projects/-w-app/a.jsonl')
  expect(f?.applyPrompt).toContain('/h/.claude/projects/-w-app/bb.jsonl')
  expect(f?.applyPrompt).not.toContain('ccc.jsonl')
  // Generic file-tool failures are not advice.
  // Dismissing it in this repository leaves the same finding of another one.
  const other = groundedImprove({ ...digest, sessions: digest.sessions.map((s: any) => ({ ...s, project: s.project.replace('/w/app', '/w/two') })) }, makeCtx('ja', ruleConfig(), { ...local, cwd: '/w/two' }))
  expect(other.find((x: any) => x.id.endsWith('-npm test'))?.id).not.toBe(f?.id)
  // The model reads neither the command nor the transcript paths.
  const shared = JSON.stringify(shareableFinding(f!))
  expect(shared).not.toContain('npm')
  expect(shared).not.toContain('.jsonl')
  const noisy = { ...digest, sessions: digest.sessions.map((s: any) => ({ ...s, friction: { head: 9, ls: 9 } })) }
  expect(groundedImprove(digest, makeCtx('ja', ruleConfig(), { ...local, isRepo: false })).find((x: any) => x.id.endsWith('-npm test'))).toBeUndefined()
  expect(ids(groundedImprove(noisy, ctx)).filter((id: string) => id.startsWith('improve-friction'))).toEqual([])
})

test('one session alone is not a pattern', () => {
  const once = { ...digest, sessions: [digest.sessions[0], { ...digest.sessions[1], friction: {}, corrections: 0 }] }
  expect(ids(groundedImprove(once, ctx)).filter((id: string) => id !== 'improve-setup-reviewers')).toEqual([])
})

test('repeated corrections in this repository ask Claude to draft CLAUDE.md lines', () => {
  const f = groundedImprove(digest, ctx).find((x: any) => x.id.startsWith('improve-repo-corrections-'))
  expect(f?.title).toBe('このリポジトリでやり直しの依頼が 5 回（2 セッション）')
  expect(f?.applyPrompt).toMatch(/CLAUDE\.md/)
})

test('own review agents are suggested while the review check is off, and not once it is on', () => {
  const f = groundedImprove(digest, ctx).find((x: any) => x.id === 'improve-setup-reviewers')
  expect(f?.evidence).toBe('code-reviewer, fable-eye')
  expect(JSON.stringify(shareableFinding(f!))).not.toContain('reviewer')
  const on = makeCtx('ja', ruleConfig({ reviewerAgents: 'code-reviewer' }), local)
  expect(ids(buildImprove(digest, on))).not.toContain('improve-setup-reviewers')
})

test('unused own agents and skills lead the Tips, by name, and their names never reach a model', () => {
  const tips = buildTips(DIGEST, ctx)
  expect(ids(tips).slice(0, 2)).toEqual(['tip-own-agents', 'tip-own-skills'])
  // They come on top of the catalog's tips, not in place of them.
  expect(tips.length).toBe(ids(buildTips(DIGEST)).length + 2)
  // The fixture used code-reviewer once.
  expect(tips[0].evidence).toBe('fable-eye, planner')
  const shared = JSON.stringify(shareableFinding(tips[0]))
  expect(shared).not.toContain('planner')
})

test('without a working directory or assets nothing is grounded', () => {
  expect(groundedImprove(digest, makeCtx('ja'))).toEqual([])
  expect(ownAssetTips(digest, makeCtx('ja'))).toEqual([])
})

test('no finding of any tab hands the model a local name, a command or a path', () => {
  const secretDigest = { ...digest, sessions: digest.sessions.map((s: any) => ({ ...s, friction: { 'deploy-acme-prod': 9 } })) }
  const secretCtx = makeCtx('en', ruleConfig(), { ...local, agents: [{ name: 'acme-internal-reviewer' }, { name: 'acme-helper' }], skills: [{ name: 'acme-skill' }] })
  const all = [...buildImprove(secretDigest, secretCtx), ...buildTips(secretDigest, secretCtx)]
  expect(all.length).toBeGreaterThan(3)
  const sent = JSON.stringify(all.map((f: any) => shareableFinding(f)))
  for (const leak of ['acme', '.jsonl', '/h/.claude']) expect(sent).not.toContain(leak)
})

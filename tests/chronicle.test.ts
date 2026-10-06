import { expect, mock, test } from 'claude-code/testing'
import { DIGEST, NOW_ISO } from './fixture.ts'

const PANE = {
  plugin: 'ccmod-chronicle',
  component: 'Pane',
  requestId: 'ccmod-chronicle',
  viewport: { columns: 200, rows: 50 },
  props: { title: 'Chronicle', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Claude Code ships no review agent; tests that exercise review checks name the usual pair.
const WITH_REVIEWERS = { options: { reviewerAgents: 'code-reviewer,security-reviewer' } }

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Shared stubs: indexer, digest file, git, store, UI calls. Returns recorders.
function stubEngine(on: any, opts: { indexerExit?: number; modelText?: string; slowIndexerMs?: number; model?: (e: any) => any; claudeLanguage?: string; surfaces?: string[]; version?: string } = {}) {
  const rec = { argv: [] as string[][], toasts: [] as string[], saved: new Map<string, unknown>(), submitted: [] as string[], modelPrompts: [] as string[], copied: [] as string[], modelCalls: [] as any[], configSets: [] as any[] }
  // Pin the clock to the fixture's 'now' so day windows do not depend on the real date.
  const clock = mock.clock(on, { now: Date.parse(NOW_ISO) })
  mock.env(on, { HOME: '/home/u' })
  on('session.start', () => ({ cwd: '/work' }))
  // Claude Code's own settings: Japanese unless a test asks otherwise, so `language: auto` picks ja.
  on('settings.read', () => ({ value: { language: opts.claudeLanguage ?? 'Japanese', cleanupPeriodDays: 30 } }))
  on('session.version', () => ({ value: { version: opts.version ?? '2.1.288' } }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('store.delete', ($: any, e: any) => { rec.saved.delete(e.key); return { value: undefined } })
  on('command.register', () => ({ value: undefined }))
  on('store.get', ($: any, e: any) => ({ value: rec.saved.get(e.key) }))
  on('store.set', ($: any, e: any) => { rec.saved.set(e.key, e.value); return { value: undefined } })
  on('process.run', async ($: any, e: any) => {
    rec.argv.push(e.argv)
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: 'feat: tune agent\n', stderr: '' } }
    if (opts.slowIndexerMs) await clock.sleep(opts.slowIndexerMs)
    return { value: { exitCode: opts.indexerExit ?? 0, stdout: '{"ok":true}', stderr: opts.indexerExit ? 'boom' : '' } }
  })
  on('fs.read', ($: any, e: any) => ({ value: e.path.endsWith('digest.json') ? JSON.stringify(DIGEST) : '' }))
  on('ui.toast', ($: any, e: any) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.copy', ($: any, e: any) => { rec.copied.push(e.text); return { value: { isCopied: true } } })
  on('prompt.submit', ($: any, e: any) => { rec.submitted.push(e.text); return { text: e.text } })
  on('model.complete', ($: any, e: any) => {
    rec.modelPrompts.push(e.system + '\n' + e.prompt)
    rec.modelCalls.push({ model: e.model, effort: e.effort, maxTokens: e.maxTokens, explain: String(e.prompt).includes('data の指摘を解説する') })
    if (opts.model) return opts.model(e)
    return { value: { isAnswered: true, text: opts.modelText ?? '- まず /compact を習慣にする', usage: USAGE } }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('config.set', ($: any, e: any) => { rec.configSets.push([e.key, e.value]); return { value: e.value } })
  // A --plugin-dir load may key our /config rows as `<name>@inline.<field>`.
  on('config.list', () => ({ value: ['aiModel', 'aiEffort', 'autoExplain', 'cacheExplanations', 'excludeProjects'].map((f) => ({ key: 'ccmod-chronicle@inline.' + f, label: f, kind: 'text', value: '', provider: { plugin: 'ccmod-chronicle', tier: 'user' }, isLocked: false })) }))
  return { rec, clock }
}

async function start($: any, clock: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(1500)
}

test('startup runs the indexer, loads the digest and toasts high findings', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  const indexer = rec.argv.find((a) => a[0] === 'python3')
  expect(indexer?.slice(1, 5)).toEqual([expect.stringMatching(/indexer\/chronicle_index\.py$/), '--claude-dir=/home/u/.claude', '--out-dir=/home/u/.claude/chronicle', '--retention-days=30'])
  expect(rec.toasts.length).toBe(1)
  expect(rec.toasts[0]).toMatch(/重要な提案 \d+ 件/)
})

test('cost tab renders findings and AI summary sends no raw prompt text', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /compaction 1 回中 1 回/ })).toBeDefined()
  await ui.press({ key: 'ai-cost' })
  expect(await ui.find({ key: 'ai-text-cost' })).toBeDefined()
  expect(rec.modelPrompts.join('')).not.toMatch(/secret first prompt/)
  await ui.unmount()
})

test('standup shows the session and git commits, AI payload drops prompt titles', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-standup' })
  await ui.press({ key: 'days-7' })
  expect(await ui.find({ type: 'Text', text: /Ship the settings page/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /feat: tune agent/ })).toBeDefined()
  await ui.press({ key: 'days-1' })
  await ui.press({ key: 'ai-standup' })
  expect(rec.modelPrompts.at(-1)).toMatch(/Ship the settings page/)
  expect(rec.modelPrompts.at(-1)).not.toMatch(/secret first prompt|\/work\/demo-app/)
  await ui.unmount()
})

test('dismiss hides a finding and persists it', WITH_REVIEWERS, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'improve' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'hide-improve-review-gate' })).toBeDefined()
  await ui.press({ key: 'hide-improve-review-gate' })
  expect(await ui.find({ key: 'hide-improve-review-gate' })).toBeUndefined()
  expect(rec.saved.get('dismissed')).toEqual(['improve-review-gate'])
  await ui.unmount()
})

test('apply asks Claude through a prompt instead of writing files', WITH_REVIEWERS, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'improve' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'apply-improve-review-gate' })
  expect(rec.submitted.at(-1)).toMatch(/差分を見せてから/)
  await ui.unmount()
})

test('now tab tracks unreviewed code edits and clears after a reviewer runs', WITH_REVIEWERS, async ($, on) => {
  const { clock } = stubEngine(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  await start($, clock)
  for (const f of ['/w/a.ts', '/w/b.ts', '/w/c.py']) await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'x', new_string: 'y' })
  await $.command.run({ command: 'chronicle', args: 'now' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /未レビューのコード変更 3 ファイル/ })).toBeDefined()
  await $.agent.spawn({ prompt: 'review', description: 'review', subagentType: 'code-reviewer' })
  expect(await ui.find({ type: 'Text', text: /未レビュー/ })).toBeUndefined()
  await ui.unmount()
})

test('indexer failure is shown instead of crashing', async ($, on) => {
  const { clock } = stubEngine(on, { indexerExit: 1 })
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /集計エラー/ })).toBeDefined()
  await ui.unmount()
})

test('AI answer links are removed and the payload marks data as untrusted', async ($, on) => {
  const { rec, clock } = stubEngine(on, { modelText: '- see [this](https://evil.example) or https://evil.example/x' })
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ai-cost' })
  const md = await ui.find({ key: 'ai-text-cost' })
  expect(JSON.stringify(md)).not.toMatch(/evil\.example/)
  expect(rec.modelPrompts.at(-1)).toMatch(/信頼できないデータ/)
  expect(rec.modelPrompts.at(-1)).toMatch(/"data":/)
  await ui.unmount()
})

test('git runs with repo hooks neutralized and excludes are passed as one argv each', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-standup' })
  const git = rec.argv.find((a) => a[0] === 'git')
  expect(git?.slice(0, 7)).toEqual(['git', '-c', 'log.showSignature=false', '-c', 'core.fsmonitor=false', '-c', 'diff.external='])
  expect(git).toContain('--no-show-signature')
  await ui.unmount()
})

test('dismiss merges with what another session saved, and now-* stays session-only', WITH_REVIEWERS, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  // Another session saved a dismissal after this one started.
  rec.saved.set('dismissed', ['cost-credits'])
  await $.command.run({ command: 'chronicle', args: 'improve' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'hide-improve-review-gate' })
  expect(rec.saved.get('dismissed')).toEqual(['cost-credits', 'improve-review-gate'])
  for (const f of ['/w/a.ts', '/w/b.ts', '/w/c.py']) await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'x', new_string: 'y' })
  await ui.press({ key: 'tab-now' })
  await ui.press({ key: 'hide-now-unreviewed' })
  expect(await ui.find({ key: 'hide-now-unreviewed' })).toBeUndefined()
  expect(rec.saved.get('dismissed')).toEqual(['cost-credits', 'improve-review-gate'])
  await ui.unmount()
})

test('unknown tab is reported and /clear resets live warnings', async ($, on) => {
  const { clock } = stubEngine(on)
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  await start($, clock)
  const bad = await $.command.run({ command: 'chronicle', args: 'nope' })
  expect(bad.text).toMatch(/不明なタブ "nope"/)
  for (const f of ['/w/a.ts', '/w/b.ts', '/w/c.py']) await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'x', new_string: 'y' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: undefined })
  await $.command.run({ command: 'chronicle', args: 'now' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /未レビュー/ })).toBeUndefined()
  await ui.unmount()
})

test('/chronicle refresh opens the pane without waiting for the indexer', async ($, on) => {
  const { clock } = stubEngine(on, { slowIndexerMs: 60000 })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const answer = await $.command.run({ command: 'chronicle', args: 'refresh' })
  expect(answer).toEqual({})
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /集計中/ })).toBeDefined()
  await clock.advance(60000)
  expect(await ui.find({ type: 'Text', text: /集計: / })).toBeDefined()
  await ui.unmount()
})

test('詳しく shows the detail inside the pane and sends nothing to the conversation', async ($, on) => {
  const { rec, clock } = stubEngine(on, { modelText: '## なぜ重要か\n長いセッションは毎ターン読み直す。' })
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'ask-cost-heavy-sessions' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '根拠の内訳' })).toBeDefined()
    expect(await ui.find({ key: 'explain-cost-heavy-sessions' })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'ask-cost-heavy-sessions' })).toBeDefined()
    await ui.unmount()
  }
  expect(rec.submitted).toEqual([])
  // The explanation was generated once and reused on the second surface.
  const explains = rec.modelPrompts.filter((p) => p.includes('data の指摘を解説する'))
  expect(explains.length).toBe(1)
  expect(explains[0]).toMatch(/信頼できないデータ/)
})

test('detail of a live warning copies its prompt and keeps file names out of the AI call', WITH_REVIEWERS, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  for (const f of ['/w/alpha.ts', '/w/beta.ts', '/w/gamma.py']) await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'x', new_string: 'y' })
  await $.command.run({ command: 'chronicle', args: 'now' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-now-unreviewed' })
  expect(await ui.find({ type: 'Text', text: /gamma\.py/ })).toBeDefined()
  await ui.press({ key: 'copy-now-unreviewed' })
  expect(rec.copied.at(-1)).toMatch(/code-reviewer/)
  expect(rec.submitted).toEqual([])
  const explain = rec.modelPrompts.find((p) => p.includes('data の指摘を解説する')) || ''
  expect(explain).not.toMatch(/alpha|beta|gamma/)
  await ui.unmount()
})

test('switching tabs leaves the detail view', WITH_REVIEWERS, async ($, on) => {
  const { clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'improve' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-improve-review-gate' })
  expect(await ui.find({ key: 'tab-cost' })).toBeUndefined()
  await $.command.run({ command: 'chronicle', args: 'cost' })
  expect(await ui.find({ key: 'tab-cost' })).toBeDefined()
  await ui.unmount()
})

test('a failed explanation is retried on the next 詳しく press', async ($, on) => {
  let calls = 0
  const { rec, clock } = stubEngine(on, {
    model: () => {
      calls += 1
      return calls === 1 ? { deny: 'api down' } : { value: { isAnswered: true, text: '## なぜ重要か\nok', usage: USAGE } }
    },
  })
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(await ui.find({ type: 'Text', text: /解説の生成に失敗/ })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(await ui.find({ key: 'explain-cost-heavy-sessions' })).toBeDefined()
  expect(rec.submitted).toEqual([])
  await ui.unmount()
})

test('a live warning detail shows it resolved, and /clear closes the detail', WITH_REVIEWERS, async ($, on) => {
  const { clock } = stubEngine(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  await start($, clock)
  for (const f of ['/w/a.ts', '/w/b.ts', '/w/c.py']) await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'x', new_string: 'y' })
  await $.command.run({ command: 'chronicle', args: 'now' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-now-unreviewed' })
  await $.agent.spawn({ prompt: 'review', description: 'review', subagentType: 'code-reviewer' })
  expect(await ui.find({ type: 'Text', text: /解消されました/ })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: undefined })
  await $.command.run({ command: 'chronicle', args: '' })
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /c\.py/ })).toBeUndefined()
  await ui.unmount()
})

test('適用を依頼 leaves the detail view so the next /chronicle opens the list', WITH_REVIEWERS, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'improve' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-improve-review-gate' })
  await ui.press({ key: 'apply-improve-review-gate' })
  expect(rec.submitted.at(-1)).toMatch(/差分を見せてから/)
  await $.command.run({ command: 'chronicle', args: '' })
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

test('a live warning keeps its explanation while numbers move and across a re-index', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  on('session.measure', ($: any, e: any) => ({ changed: [] }))
  await start($, clock)
  await $.session.measure({ context: { tokens: 700000, window: 1000000, percent: 70 }, rateLimits: [] })
  await $.command.run({ command: 'chronicle', args: 'now' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-now-context' })
  expect(await ui.find({ key: 'explain-now-context' })).toBeDefined()
  await $.session.measure({ context: { tokens: 704000, window: 1000000, percent: 70.4 }, rateLimits: [] })
  expect(await ui.find({ key: 'explain-now-context' })).toBeDefined()
  await $.command.run({ command: 'chronicle', args: 'refresh' })
  await clock.settle()
  expect(await ui.find({ key: 'explain-now-context' })).toBeDefined()
  expect(rec.modelPrompts.filter((p) => p.includes('data の指摘を解説する')).length).toBe(1)
  await ui.unmount()
})

const explainCalls = (rec: any) => rec.modelCalls.filter((c: any) => c.explain)

test('explanations default to haiku, low effort and a short reply, and show their token use', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(explainCalls(rec)).toEqual([{ model: 'haiku', effort: 'low', maxTokens: 700, explain: true }])
  expect(await ui.find({ type: 'Text', text: /haiku · 入力 1 \/ 出力 1 tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /このセッションの AI 消費: 1 回/ })).toBeDefined()
  await ui.unmount()
})

test('userConfig chooses the model and effort', { options: { aiModel: 'sonnet', aiEffort: 'medium' } }, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'ai-cost' })
  expect(rec.modelCalls.map((c: any) => [c.model, c.effort])).toEqual([['sonnet', 'medium'], ['sonnet', 'medium']])
  await ui.unmount()
})

test('with autoExplain off, 詳しく makes no model call until g is pressed', { options: { autoExplain: false } }, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(explainCalls(rec)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /g で AI 解説を生成/ })).toBeDefined()
  await ui.press({ key: 'explain-again' })
  expect(explainCalls(rec).length).toBe(1)
  await ui.unmount()
})

test('a digest explanation is reused from the store after a re-index, at no token cost', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  await ui.press({ key: 'back' })
  await $.command.run({ command: 'chronicle', args: 'refresh' })
  await clock.settle()
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(explainCalls(rec).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /キャッシュから表示（トークン消費なし）/ })).toBeDefined()
  expect(Object.keys(rec.saved.get('explainCache') as object).length).toBe(1)
  await ui.unmount()
})

test('the pane picker and /config both change the model for the next call', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  await ui.select({ key: 'ai-model', value: 'sonnet' })
  expect(rec.configSets.at(-1)).toEqual(['ccmod-chronicle@inline.aiModel', 'sonnet'])
  await ui.press({ key: 'explain-again' })
  await $.config.set({ key: 'ccmod-chronicle@inline.aiModel', value: 'opus' })
  await ui.press({ key: 'explain-again' })
  expect(explainCalls(rec).map((c: any) => c.model)).toEqual(['haiku', 'sonnet', 'opus'])
  await ui.unmount()
})

test('pressing 詳しく again while an explanation is pending makes one call', async ($, on) => {
  let clockRef: any
  const { rec, clock } = stubEngine(on, {
    model: async () => {
      await clockRef.sleep(1000)
      return { value: { isAnswered: true, text: '## なぜ重要か\nok', usage: USAGE } }
    },
  })
  clockRef = clock
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  await clock.advance(1000)
  expect(explainCalls(rec).length).toBe(1)
  await ui.unmount()
})

test('a credit-billed model never explains on open, only on g', { options: { aiModel: 'fable' } }, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(explainCalls(rec)).toEqual([])
  await ui.press({ key: 'explain-again' })
  expect(explainCalls(rec).map((c: any) => c.model)).toEqual(['fable'])
  await ui.unmount()
})

test('a re-index during a pending explanation still shows it, at one call', async ($, on) => {
  let clockRef: any
  const { rec, clock } = stubEngine(on, {
    model: async () => {
      await clockRef.sleep(1000)
      return { value: { isAnswered: true, text: '## なぜ重要か\nok', usage: USAGE } }
    },
  })
  clockRef = clock
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  await $.command.run({ command: 'chronicle', args: 'refresh' })
  await clock.settle()
  await clock.advance(1000)
  await clock.settle()
  expect(await ui.find({ key: 'explain-cost-heavy-sessions' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /自動生成はオフ/ })).toBeUndefined()
  expect(explainCalls(rec).length).toBe(1)
  await ui.unmount()
})

test('/clear resets the session token total', async ($, on) => {
  const { clock } = stubEngine(on)
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(await ui.find({ type: 'Text', text: /このセッションの AI 消費: 1 回/ })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: undefined })
  await $.command.run({ command: 'chronicle', args: 'cost' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(await ui.find({ type: 'Text', text: /このセッションの AI 消費: 0 回/ })).toBeDefined()
  await ui.unmount()
})

test('after a reload, a restored detail whose live finding is gone is not reopened', WITH_REVIEWERS, async ($, on) => {
  const { clock } = stubEngine(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  await start($, clock)
  for (const f of ['/w/a.ts', '/w/b.ts', '/w/c.py']) await $.tool.call({ tool: 'Edit', file_path: f, old_string: 'x', new_string: 'y' })
  await $.command.run({ command: 'chronicle', args: 'now' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-now-unreviewed' })
  await $.agent.spawn({ prompt: 'review', description: 'review', subagentType: 'code-reviewer' })
  // A reload re-runs session.start, which restores the view from $.state.
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'chronicle', args: '' })
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

test('moving on before the re-index cancels a detail waiting to be restored', WITH_REVIEWERS, async ($, on) => {
  const { clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  // A reload: session.start restores the view, and the digest detail waits for the re-index.
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'chronicle', args: 'now' })
  await clock.advance(1500)
  await clock.settle()
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  expect(await ui.find({ key: 'tab-now' })).toBeDefined()
  await ui.unmount()
})

test('an English Claude Code gets an English pane, prompts and docs', async ($, on) => {
  const { rec, clock } = stubEngine(on, { claudeLanguage: 'English' })
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /compactions happened above/ })).toBeDefined()
  await ui.press({ key: 'ask-cost-heavy-sessions' })
  expect(await ui.find({ type: 'Text', text: 'Breakdown' })).toBeDefined()
  expect(rec.modelPrompts.at(-1)).toMatch(/Explain the finding in data/)
  expect(rec.modelPrompts.at(-1)).toMatch(/untrusted/)
  await ui.unmount()
})

test('the language option overrides Claude Code\'s setting', { options: { language: 'en' } }, async ($, on) => {
  const { clock } = stubEngine(on)
  await start($, clock)
  const bad = await $.command.run({ command: 'chronicle', args: 'nope' })
  expect(bad.text).toMatch(/Unknown tab "nope"/)
})

test('/chronicle purge deletes the index and the explanation cache', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  rec.saved.set('explainCache', { k: { text: 'x', model: 'haiku', at: 1 } })
  rec.saved.set('dismissed', ['cost-credits'])
  const answer = await $.command.run({ command: 'chronicle', args: 'purge' })
  expect(answer.text).toMatch(/削除しました/)
  expect(rec.argv.at(-1)).toContain('--purge')
  expect(rec.saved.has('explainCache')).toBe(false)
  expect(rec.saved.has('dismissed')).toBe(false)
})

test('where the pane cannot show (VS Code), /chronicle answers in text', async ($, on) => {
  const { clock } = stubEngine(on, { surfaces: ['vscode'] })
  await start($, clock)
  const answer = await $.command.run({ command: 'chronicle', args: '' })
  expect(answer.text).toMatch(/サイドバー/)
  expect(answer.text).toMatch(/compaction/)
})

test('extra risky commands from the settings are flagged live and passed to the indexer', { options: { extraRiskyCommands: 'terraform apply' } }, async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.tool.call({ tool: 'Bash', command: 'terraform apply -auto-approve' })
  await $.command.run({ command: 'chronicle', args: 'now' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /terraform apply × 1/ })).toBeDefined()
  expect(rec.argv.find((a) => a[0] === 'python3')).toContain('--risky=terraform apply')
  await ui.unmount()
})

test('an old Claude Code keeps its warning after the startup index', async ($, on) => {
  const { clock } = stubEngine(on, { version: '2.1.200', claudeLanguage: 'English' })
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /2\.1\.200 is older than 2\.1\.287/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Indexed/ })).toBeDefined()
  await ui.unmount()
})

test('Standup AI summary withholds titles, recaps and commits that contain paths', async ($, on) => {
  const { rec, clock } = stubEngine(on)
  await start($, clock)
  await $.command.run({ command: 'chronicle', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-standup' })
  await ui.press({ key: 'days-7' })
  await ui.press({ key: 'ai-standup' })
  expect(rec.modelPrompts.at(-1)).toMatch(/Ship the settings page/)
  expect(rec.modelPrompts.at(-1)).not.toMatch(/\/home\/alice/)
  await ui.unmount()
})

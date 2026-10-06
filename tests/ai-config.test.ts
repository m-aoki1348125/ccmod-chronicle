import { expect, test } from 'claude-code/testing'
import { resolveLang } from '../hooks/i18n.js'
import { addUsage, explainCacheKey, isCacheEntry, mergeSetting, normalizeSettings, pruneCache, settingsField, tokensOf } from '../hooks/ai-config.js'

test('unknown option values fall back to the defaults', async () => {
  expect(normalizeSettings({ aiModel: 'claude-x-9', aiEffort: 'max', autoExplain: 'yes' })).toEqual({ model: 'haiku', effort: 'low', autoExplain: true, cacheExplanations: true, language: 'auto', paneStyle: 'simple' })
  expect(mergeSetting(normalizeSettings({}), 'aiModel', 'opus').model).toBe('opus')
})

test('settingsField accepts <name>. and <name>@x. keys for our fields only', async () => {
  expect(settingsField('ccmod-chronicle.aiModel', 'ccmod-chronicle')).toBe('aiModel')
  expect(settingsField('ccmod-chronicle@inline.aiEffort', 'ccmod-chronicle')).toBe('aiEffort')
  expect(settingsField('ccmod-chronicle-evil.aiModel', 'ccmod-chronicle')).toBe(null)
  expect(settingsField('other.aiModel', 'ccmod-chronicle')).toBe(null)
  expect(settingsField('ccmod-chronicle.theme', 'ccmod-chronicle')).toBe(null)
})

test('the cache key changes with model, effort, exclusions and content', async () => {
  const s = normalizeSettings({})
  const base = explainCacheKey({ a: 1 }, s, [])
  expect(base).toMatch(/^[0-9a-f]{16}$/)
  expect(explainCacheKey({ a: 1 }, s, [])).toBe(base)
  expect(explainCacheKey({ a: 1 }, mergeSetting(s, 'aiModel', 'sonnet'), [])).not.toBe(base)
  expect(explainCacheKey({ a: 1 }, mergeSetting(s, 'aiEffort', 'high'), [])).not.toBe(base)
  expect(explainCacheKey({ a: 1 }, s, ['/w/secret'])).not.toBe(base)
  expect(explainCacheKey({ a: 2 }, s, [])).not.toBe(base)
})

test('pruneCache drops malformed and expired entries and keeps the newest 40', async () => {
  const day = 24 * 3600 * 1000
  const now = 100 * day
  const entries: Record<string, unknown> = { bad: { text: 5, model: 'haiku', at: now }, evil: { text: 'x', model: 'gpt', at: now }, old: { text: 'x', model: 'haiku', at: now - 15 * day } }
  for (let i = 0; i < 45; i += 1) entries['k' + i] = { text: 't' + i, model: 'haiku', at: now - i }
  const out = pruneCache(entries, now)
  expect(Object.keys(out).length).toBe(40)
  expect(out.k0).toBeDefined()
  expect(out.k44).toBeUndefined()
  expect(out.bad).toBeUndefined()
  expect(out.evil).toBeUndefined()
  expect(out.old).toBeUndefined()
  expect(isCacheEntry({ text: 'x'.repeat(9001), model: 'haiku', at: 1 })).toBe(false)
})

test('per-answer and session token figures use one definition', async () => {
  const u = { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 7 }
  expect(tokensOf(u)).toEqual({ in: 115, out: 7 })
  expect(addUsage({ calls: 0, in: 0, out: 0 }, u)).toEqual({ calls: 1, in: 115, out: 7 })
})

test('auto language detects Japanese but not Javanese', async () => {
  expect(['Japanese', '日本語', 'ja', 'ja-JP', 'Javanese', 'English', ''].map((l) => resolveLang('auto', l))).toEqual(['ja', 'ja', 'ja', 'ja', 'en', 'en', 'en'])
  expect(resolveLang('en', 'Japanese')).toBe('en')
})

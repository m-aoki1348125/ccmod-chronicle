// Model settings, prompts and the persistent explanation cache. Pure functions, no mods API.

import { LANGUAGE_OPTIONS } from './i18n.js'

export const MODEL_OPTIONS = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORT_OPTIONS = ['low', 'medium', 'high']
export const PANE_STYLES = ['simple', 'rich']
export const DEFAULT_SETTINGS = Object.freeze({ model: 'haiku', effort: 'low', autoExplain: true, cacheExplanations: true, language: 'auto', paneStyle: 'simple' })
// Models billed to usage credits: never called without an explicit press.
export const CREDIT_MODELS = new Set(['fable'])
const CACHE_TEXT_MAX = 9000
// Short answers keep output tokens bounded; the prompts ask for the same length. Higher effort
// may spend part of the cap on thinking, so the cap grows with it rather than cutting the reply.
const MAX_TOKENS_BY_EFFORT = Object.freeze({ low: 700, medium: 1200, high: 2000 })
export const maxTokensFor = (settings) => MAX_TOKENS_BY_EFFORT[settings.effort] || MAX_TOKENS_BY_EFFORT.low
const CACHE_MAX_ENTRIES = 40
const CACHE_TTL_MS = 14 * 24 * 3600 * 1000
// Bump when the prompts change so cached answers from old prompts are not reused.
const PROMPT_VERSION = 3

// System prompts in the pane's language; the untrusted-data rule is always appended.
export function systemPrompt(kind, t) {
  return [t(kind === 'explain' ? 'explainSystem' : 'summarySystem'), t('untrusted')].join('\n')
}

// userConfig values (or a /config change) -> settings; unknown values fall back to defaults.
export function normalizeSettings(options = {}) {
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
  return Object.freeze({
    model: pick(options.aiModel, MODEL_OPTIONS, DEFAULT_SETTINGS.model),
    effort: pick(options.aiEffort, EFFORT_OPTIONS, DEFAULT_SETTINGS.effort),
    autoExplain: typeof options.autoExplain === 'boolean' ? options.autoExplain : DEFAULT_SETTINGS.autoExplain,
    cacheExplanations: typeof options.cacheExplanations === 'boolean' ? options.cacheExplanations : DEFAULT_SETTINGS.cacheExplanations,
    language: pick(options.language, LANGUAGE_OPTIONS, DEFAULT_SETTINGS.language),
    paneStyle: pick(options.paneStyle, PANE_STYLES, DEFAULT_SETTINGS.paneStyle),
  })
}

// Settings with one userConfig field replaced (aiModel | aiEffort | autoExplain).
export function mergeSetting(settings, field, value) {
  const current = { aiModel: settings.model, aiEffort: settings.effort, autoExplain: settings.autoExplain, cacheExplanations: settings.cacheExplanations, language: settings.language, paneStyle: settings.paneStyle }
  return normalizeSettings({ ...current, [field]: value })
}

// Every userConfig field, as the Settings tab can change them (tests keep this equal to SETTING_KEYS).
export const FIELDS = ['language', 'paneStyle', 'aiModel', 'aiEffort', 'autoExplain', 'cacheExplanations', 'reviewerAgents', 'memoryTools', 'memoryCueWords', 'extraRiskyCommands', 'excludeProjects', 'retentionDays']
// The fields applied in place; the others take effect when the options change reloads the mod.
export const LIVE_FIELDS = new Set(['language', 'paneStyle', 'aiModel', 'aiEffort', 'autoExplain', 'cacheExplanations'])

// The userConfig field a /config key names, when it is one of ours. A --plugin-dir load may key
// the plugin as `<name>` or `<name>@inline`, so both `<name>.<field>` and `<name>@x.<field>` match.
export function settingsField(key, pluginName) {
  if (typeof key !== 'string' || typeof pluginName !== 'string') return null
  const head = key.slice(0, key.lastIndexOf('.'))
  const field = key.slice(key.lastIndexOf('.') + 1)
  const isOurs = head === pluginName || head.startsWith(pluginName + '@')
  return isOurs && FIELDS.includes(field) ? field : null
}

// Two FNV-1a passes with different offsets: a stable 64-bit key, dependency-free (not for security).
function fnv1a(text, seed) {
  let h = seed
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// Same finding content + model/effort + language + prompt version + exclusions -> same answer.
// Exclusions are part of the key so changing excludeProjects never surfaces older answers.
export function explainCacheKey(payload, settings, excludes = [], lang = 'en') {
  const text = JSON.stringify([PROMPT_VERSION, lang, settings.model, settings.effort, [...excludes].sort(), payload])
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x050c5d1f)
}

// The store is a shared JSON file: accept only well-formed entries from it.
export function isCacheEntry(v) {
  return Boolean(v) && typeof v.text === 'string' && v.text.length <= CACHE_TEXT_MAX && MODEL_OPTIONS.includes(v.model) && Number.isFinite(v.at)
}

// Drop expired entries and keep the newest CACHE_MAX_ENTRIES, so $.store stays small.
export function pruneCache(cache, nowMs) {
  const live = Object.entries(cache || {}).filter(([, v]) => isCacheEntry(v) && nowMs - v.at < CACHE_TTL_MS)
  return Object.fromEntries(live.sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX_ENTRIES))
}

// One definition for every token figure shown: input counts cached and cache-written tokens too.
export function tokensOf(usage) {
  return {
    in: (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0),
    out: usage?.output_tokens || 0,
  }
}

export function addUsage(total, usage) {
  const t = tokensOf(usage)
  return { calls: total.calls + 1, in: total.in + t.in, out: total.out + t.out }
}

// Language, strings and the user-tunable rule settings, bundled into the ctx every rule takes.
// Pure functions, no mods API.

import { EN } from './strings-en.js'
import { JA } from './strings-ja.js'

const DICTS = { en: EN, ja: JA }
export const LANGUAGE_OPTIONS = ['auto', 'en', 'ja']

// `auto` follows Claude Code's own `language` setting ("Japanese", "日本語", "ja", ...).
export function resolveLang(option, settingsLanguage) {
  if (option === 'en' || option === 'ja') return option
  const s = String(settingsLanguage || '').toLowerCase()
  // "ja", "ja-JP", "Japanese", "日本語" (but not "Javanese").
  return /^ja([-_]|$)/.test(s) || s.includes('japan') || s.includes('日本') ? 'ja' : 'en'
}

export function makeT(lang) {
  const dict = DICTS[lang] || EN
  return (key, params = {}) => {
    const entry = key in dict ? dict[key] : EN[key]
    if (entry === undefined) return key
    return typeof entry === 'function' ? entry(params) : entry
  }
}

export const docUrl = (lang, slug) => `https://code.claude.com/docs/${lang === 'ja' ? 'ja' : 'en'}/${slug}`

const list = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// Defaults suit anyone; people with their own agents or note tools extend them in /config.
export const RULE_DEFAULTS = Object.freeze({
  // Claude Code ships no review agent, so the review checks stay off until you name yours.
  reviewerAgents: '',
  memoryTools: '',
  memoryCueWords: '',
  extraRiskyCommands: '',
})

// Built-in words that mean "this needs earlier context", used when memoryCueWords is empty.
export const DEFAULT_MEMORY_CUES = ['前回', '以前', '覚えて', 'last time', 'previously', 'remember when']

export function ruleConfig(options = {}) {
  const get = (k) => (typeof options[k] === 'string' ? options[k] : RULE_DEFAULTS[k])
  const cues = list(get('memoryCueWords'))
  return Object.freeze({
    reviewers: Object.freeze(list(get('reviewerAgents'))),
    memoryTools: Object.freeze(list(get('memoryTools'))),
    memoryCues: Object.freeze(cues.length ? cues : DEFAULT_MEMORY_CUES),
    extraRisky: Object.freeze(list(get('extraRiskyCommands'))),
  })
}

export function makeCtx(lang = 'en', cfg = ruleConfig()) {
  return Object.freeze({ lang, t: makeT(lang), doc: (slug) => docUrl(lang, slug), cfg })
}

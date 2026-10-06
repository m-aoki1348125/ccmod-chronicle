// The Settings tab: every userConfig option, its control, and how a typed value is checked.
// Pure functions, no mods API. Keys and defaults must match .claude-plugin/plugin.json.

import { EFFORT_OPTIONS, MODEL_OPTIONS, PANE_STYLES } from './ai-config.js'
import { LANGUAGE_OPTIONS } from './i18n.js'

const MAX_RETENTION_DAYS = 3650
const MAX_TEXT = 2000
// Same characters view.js strips for display: controls, line/paragraph separators, bidi overrides.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

// kind: 'select' (fixed options) | 'bool' | 'list' (comma-separated text) | 'number'
export const SETTINGS_SPEC = Object.freeze([
  { key: 'language', kind: 'select', options: LANGUAGE_OPTIONS, default: 'auto' },
  { key: 'paneStyle', kind: 'select', options: PANE_STYLES, default: 'simple' },
  { key: 'aiModel', kind: 'select', options: MODEL_OPTIONS, default: 'haiku' },
  { key: 'aiEffort', kind: 'select', options: EFFORT_OPTIONS, default: 'low' },
  { key: 'autoExplain', kind: 'bool', default: true },
  { key: 'cacheExplanations', kind: 'bool', default: true },
  { key: 'reviewerAgents', kind: 'list', default: '' },
  { key: 'memoryTools', kind: 'list', default: '' },
  { key: 'memoryCueWords', kind: 'list', default: '' },
  { key: 'extraRiskyCommands', kind: 'list', default: '' },
  { key: 'excludeProjects', kind: 'list', default: '' },
  { key: 'retentionDays', kind: 'number', default: 0, min: 0, max: MAX_RETENTION_DAYS },
])

export const SETTING_KEYS = Object.freeze(SETTINGS_SPEC.map((s) => s.key))

// A comma- or newline-separated option as entries, the way the mod reads it everywhere.
export const listEntries = (v) => String(v ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
const byKey = Object.fromEntries(SETTINGS_SPEC.map((s) => [s.key, s]))

// The options the mod was loaded with, defaults filled in for anything unset or unusable
// (a hand-edited settings.json may hold a model that is not offered, or "false" as a string).
export function currentValues(options = {}) {
  return Object.freeze(Object.fromEntries(SETTINGS_SPEC.map((s) => [s.key, normalized(s, options[s.key])])))
}

function normalized(spec, v) {
  if (v === undefined || v === null) return spec.default
  if (spec.kind === 'select') return spec.options.includes(v) ? v : spec.default
  if (spec.kind === 'bool') return v === true || v === 'true' ? true : v === false || v === 'false' ? false : spec.default
  // Whole days, rounded down like the mod applies them (register.js clampDays).
  if (spec.kind === 'number') {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n >= spec.min && n <= spec.max ? n : spec.default
  }
  return String(v)
}

// What the user picked or typed -> the value /config stores, or an error key for the strings.
export function parseSetting(key, raw) {
  const spec = byKey[key]
  if (!spec) return { error: 'settingUnknown' }
  if (spec.kind === 'select') return spec.options.includes(raw) ? { value: raw } : { error: 'settingInvalid' }
  if (spec.kind === 'bool') return raw === 'on' || raw === true ? { value: true } : raw === 'off' || raw === false ? { value: false } : { error: 'settingInvalid' }
  if (spec.kind === 'number') {
    // NFKC turns full-width digits typed through an IME (３０) into 30.
    const text = String(raw ?? '').normalize('NFKC').trim()
    const n = Number(text)
    if (!/^\d+$/.test(text) || n < spec.min || n > spec.max) return { error: 'settingRange', params: { min: spec.min, max: spec.max } }
    return { value: n }
  }
  // list: comma or newline separated; trimmed, empty entries dropped, no control characters.
  // Newlines (including Windows \r\n) separate entries like commas do.
  const text = String(raw ?? '').replace(/\r\n?/g, '\n')
  if (text.length > MAX_TEXT || CONTROL.test(text.replace(/\n/g, ''))) return { error: 'settingInvalid' }
  return { value: listEntries(text).join(',') }
}

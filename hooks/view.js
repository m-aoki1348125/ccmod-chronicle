// Pane rendering. Receives the element functions from $.ui.resolve(e), plain callbacks from
// register.js and the strings function `model.t`, so this file never touches the mods API.

import { CREDIT_MODELS, EFFORT_OPTIONS, MODEL_OPTIONS } from './ai-config.js'
import { SETTINGS_SPEC } from './settings-spec.js'

export const TABS = [
  { id: 'now', label: 'Now', hotkey: '1' },
  { id: 'cost', label: 'Cost', hotkey: '2' },
  { id: 'tips', label: 'Tips', hotkey: '3' },
  { id: 'standup', label: 'Standup', hotkey: '4' },
  { id: 'improve', label: 'Improve', hotkey: '5' },
  { id: 'settings', label: 'Settings', hotkey: '6' },
]

const MARK = { high: '●', mid: '◐', low: '○' }
const COLOR = { high: 'error', mid: 'warning' }
const AI_TABS = new Set(['cost', 'tips', 'standup', 'improve'])
// Titles, recaps, commit subjects and file names come from transcripts: drop control characters.
// Bidi overrides and line/paragraph separators can disguise text, so they go too.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
const DETAIL_MAX = 12
const clean = (text) => String(text ?? '').replace(CONTROL_CHARS, '')
const folder = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/')

export function renderPane(el, model, h) {
  const { Box } = el
  if (model.detail) return renderDetail(el, model, h)
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [tabRow(el, model, h), statusLine(el, model, h), ...body(el, model, h), aiBlock(el, model, h)].filter(Boolean),
  })
}

function tabRow(el, model, h) {
  const { Box, Button } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: TABS.map((tab) => Button({
      key: 'tab-' + tab.id,
      label: tab.label + countBadge(model, tab.id),
      hotkey: tab.hotkey,
      plain: true,
      ...(model.tab === tab.id ? {} : { dimColor: true }),
      onPress: () => h.onTab(tab.id),
    })),
  })
}

function countBadge(model, tab) {
  const n = model.lists[tab]?.length
  return n ? ` (${n})` : ''
}

function statusLine(el, model, h) {
  const { Box, Text, Button } = el
  const { t, status: s } = model
  const text = s.error ? t('indexError', { error: s.error })
    : s.indexing ? t('indexing')
    : s.generatedAt ? t('indexed', { at: s.generatedAt.slice(0, 16).replace('T', ' '), n: s.sessions })
    : t('notIndexed')
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({ dimColor: true, wrap: 'truncate-end', children: [clean(text)] }),
      model.versionWarning ? Text({ color: 'warning', wrap: 'truncate-end', children: [t('oldVersion', model.versionWarning)] }) : null,
      Button({ key: 'refresh', label: t('refresh'), hotkey: 'r', plain: true, onPress: () => h.onRefresh() }),
    ].filter(Boolean),
  })
}

function body(el, model, h) {
  if (model.tab === 'standup') return standup(el, model, h)
  if (model.tab === 'settings') return settingsTab(el, model, h)
  const list = model.lists[model.tab] || []
  if (!list.length) return [el.Text({ dimColor: true, children: [model.t(model.tab === 'now' ? 'emptyNow' : 'emptyList')] })]
  return list.map((f) => findingCard(el, model.t, f, h))
}

function findingCard(el, t, f, h) {
  const { Box, Text, Button, Link } = el
  const actions = [
    Button({ key: 'ask-' + f.id, label: t('ask'), onPress: () => h.onAsk(f) }),
    f.applyPrompt ? Button({ key: 'apply-' + f.id, label: t('apply'), onPress: () => h.onApply(f) }) : null,
    Button({ key: 'hide-' + f.id, label: t('dismiss'), onPress: () => h.onDismiss(f) }),
    f.doc ? Link({ href: f.doc, label: t('docs') }) : null,
  ].filter(Boolean)
  return Box({
    key: 'card-' + f.id,
    flexDirection: 'column',
    children: [
      Text({ bold: true, ...(COLOR[f.severity] ? { color: COLOR[f.severity] } : {}), children: [clean(`${MARK[f.severity]} ${f.title}`)] }),
      Text({ dimColor: true, children: [clean('  ' + f.evidence)] }),
      Text({ children: [clean('  → ' + f.action)] }),
      Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: actions }),
    ],
  })
}

function standup(el, model, h) {
  const { Box, Text, Button } = el
  const { t } = model
  const header = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [1, 3, 7].map((d) => Button({
      key: 'days-' + d, label: t('days', { d }), plain: true,
      ...(model.days === d ? {} : { dimColor: true }),
      onPress: () => h.onDays(d),
    })),
  })
  if (!model.standup.length) return [header, Text({ dimColor: true, children: [t('noSessions', { d: model.days })] })]
  return [header, ...model.standup.map((row) => Box({
    key: 'su-' + row.project,
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: [clean('■ ' + folder(row.project))] }),
      ...row.sessions.slice(-4).map((s) => Text({ children: [clean('  • ' + s.title)] })),
      ...row.sessions.filter((s) => s.away).slice(-1).map((s) => Text({ dimColor: true, children: [clean('  ' + t('recap') + s.away)] })),
      row.commits.length ? Text({ dimColor: true, children: [clean('  ' + t('commits') + row.commits.slice(0, 5).join(' / '))] }) : null,
      row.files.length ? Text({ dimColor: true, wrap: 'truncate-end', children: [clean('  ' + t('files') + row.files.join(', '))] }) : null,
    ].filter(Boolean),
  }))]
}

function aiBlock(el, model, h) {
  if (!AI_TABS.has(model.tab)) return null
  const { Box, Button, Markdown, Text } = el
  const { t } = model
  const ai = model.ai[model.tab]
  const children = [Button({ key: 'ai-' + model.tab, label: ai?.loading ? t('summarizing') : t('summarize', { model: model.settings.model }), hotkey: 'a', onPress: () => h.onAi(model.tab) })]
  if (ai?.text) children.push(Markdown({ key: 'ai-text-' + model.tab, text: clean(ai.text).slice(0, 9000) }))
  if (ai?.error) children.push(Text({ color: 'error', children: [clean(t('summaryFailed', { error: ai.error }))] }))
  children.push(Text({ dimColor: true, children: [t('summaryNote')] }))
  return Box({ flexDirection: 'column', children })
}

// Details: the finding's numbers, the rule's breakdown and an AI explanation, all inside the pane.
function renderDetail(el, model, h) {
  const { Box, Text, Code } = el
  const { t } = model
  const f = model.detail
  const details = f.details || []
  const shown = details.slice(0, DETAIL_MAX).map((d) => Text({ children: [clean('  • ' + d)] }))
  if (details.length > DETAIL_MAX) shown.push(Text({ dimColor: true, children: [t('more', { n: details.length - DETAIL_MAX })] }))
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      detailActions(el, t, f, h),
      f.isResolved ? Text({ color: 'success', children: [t('resolved')] }) : null,
      Text({ bold: true, ...(COLOR[f.severity] ? { color: COLOR[f.severity] } : {}), children: [clean(`${MARK[f.severity]} ${f.title}`)] }),
      Text({ dimColor: true, children: [clean(f.evidence)] }),
      shown.length ? Box({ flexDirection: 'column', children: [Text({ bold: true, children: [t('breakdown')] }), ...shown] }) : null,
      Box({ flexDirection: 'column', children: [Text({ bold: true, children: [t('actionHead')] }), Text({ children: [clean('  ' + f.action)] })] }),
      Box({ flexDirection: 'column', children: [Text({ bold: true, children: [t('promptHead')] }), Code({ source: clean(f.copyText) })] }),
      explainBlock(el, model, h),
    ].filter(Boolean),
  })
}

function detailActions(el, t, f, h) {
  const { Box, Button, Link } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: [
      Button({ key: 'back', label: t('back'), hotkey: 'b', plain: true, onPress: () => h.onBack() }),
      Button({ key: 'copy-' + f.id, label: t('copy'), hotkey: 'c', plain: true, onPress: (press) => h.onCopy(f.copyText, press) }),
      f.applyPrompt ? Button({ key: 'apply-' + f.id, label: t('applyChat'), onPress: () => h.onApply(f) }) : null,
      f.doc ? Link({ href: f.doc, label: t('docs') }) : null,
    ].filter(Boolean),
  })
}

function explainBlock(el, model, h) {
  const { Box, Text, Button, Markdown } = el
  const { t } = model
  const f = model.detail
  const ex = model.explain
  const body = ex?.loading ? [Text({ dimColor: true, children: [t('explaining', { model: ex.model })] })]
    : ex?.error ? [Text({ color: 'error', children: [clean(t('explainFailed', { error: ex.error }))] })]
    : ex?.text ? [Markdown({ key: 'explain-' + f.id, text: clean(ex.text).slice(0, 9000) }), Text({ dimColor: true, children: [usageLine(t, ex)] })]
    : [Text({ dimColor: true, children: [generateHint(t, model.settings)] })]
  return Box({
    flexDirection: 'column',
    children: [
      Box({ flexDirection: 'row', columnGap: 2, children: [Text({ bold: true, children: [t('explainHead')] }), Button({ key: 'explain-again', label: t(ex?.text ? 'regenerate' : 'generate'), hotkey: 'g', plain: true, onPress: () => h.onExplainAgain(f) })] }),
      ...body,
      settingsRow(el, model, h),
      Text({ dimColor: true, children: [t(f.localDetails ? 'sendLocal' : 'sendDetail')] }),
    ],
  })
}

// Why there is no explanation yet, so the hint never claims a setting that is not in effect.
function generateHint(t, settings) {
  if (!settings.autoExplain) return t('hintOff')
  if (CREDIT_MODELS.has(settings.model)) return t('hintCredit', { model: settings.model })
  return t('hint')
}

function usageLine(t, ex) {
  if (ex.isCached) return t('cached', { model: ex.model })
  return ex.tokens ? t('usage', { model: ex.model, in: ex.tokens.in, out: ex.tokens.out }) : ex.model || ''
}

// Model and effort pickers; a change is saved to this plugin's /config fields.
function settingsRow(el, model, h) {
  const { Box, Text, Select } = el
  const { t, settings, aiUsage } = model
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 2,
        flexWrap: 'wrap',
        children: [
          Select({ key: 'ai-model', label: t('modelLabel'), value: settings.model, options: MODEL_OPTIONS.map((m) => ({ value: m, label: CREDIT_MODELS.has(m) ? t('creditLabel', { model: m }) : m })), onSelect: (v) => h.onSetting('aiModel', v) }),
          Select({ key: 'ai-effort', label: 'effort', value: settings.effort, options: EFFORT_OPTIONS.map((x) => ({ value: x, label: x })), onSelect: (v) => h.onSetting('aiEffort', v) }),
        ],
      }),
      Text({ dimColor: true, children: [t('sessionUsage', aiUsage)] }),
    ],
  })
}

// Settings tab: one control per userConfig option; a change is saved through h.onSetting.
function settingsTab(el, model, h) {
  const { Box, Text } = el
  const { t } = model
  return [
    Text({ dimColor: true, children: [t('settingsIntro')] }),
    ...SETTINGS_SPEC.map((spec) => Box({
      key: 'setting-' + spec.key,
      flexDirection: 'column',
      children: [settingControl(el, t, spec, model.config[spec.key], h), Text({ dimColor: true, children: ['  ' + t('cfgHelp_' + spec.key)] })],
    })),
  ]
}

function settingControl(el, t, spec, value, h) {
  const { Select, Input } = el
  const key = 'set-' + spec.key
  const label = t('cfg_' + spec.key)
  const save = (v) => h.onSetting(spec.key, v)
  if (spec.kind === 'select') {
    return Select({ key, label, value: String(value), options: spec.options.map((o) => ({ value: o, label: CREDIT_MODELS.has(o) ? t('creditLabel', { model: o }) : o })), onSelect: save })
  }
  if (spec.kind === 'bool') {
    return Select({ key, label, value: value ? 'on' : 'off', options: [{ value: 'on', label: t('settingOn') }, { value: 'off', label: t('settingOff') }], onSelect: save })
  }
  return Input({ key, label, value: clean(value), submitLabel: t('settingSave'), onSubmit: save })
}

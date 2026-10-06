// Pane rendering. Receives the element functions from $.ui.resolve(e), plain callbacks from
// register.js and the strings function `model.t`, so this file never touches the mods API.
// Both styles share the icons and severity colors in theme.js; the rich style adds frames,
// tiles and charts (rich-view.js).

import { CREDIT_MODELS, EFFORT_OPTIONS, MODEL_OPTIONS } from './ai-config.js'
import { SETTINGS_SPEC } from './settings-spec.js'
import { richCharts } from './rich-view.js'
import { ACCENT, ICON, STATUS_ICON, TAB_ICON, chip, iconLine, section, severityOf } from './theme.js'

export const TABS = Object.freeze([
  { id: 'now', label: 'Now', hotkey: '1' },
  { id: 'cost', label: 'Cost', hotkey: '2' },
  { id: 'tips', label: 'Tips', hotkey: '3' },
  { id: 'standup', label: 'Standup', hotkey: '4' },
  { id: 'improve', label: 'Improve', hotkey: '5' },
  { id: 'settings', label: 'Settings', hotkey: '6' },
])

// The Settings tab's groups, in order; together they hold every option once (tests check).
export const SETTING_GROUPS = Object.freeze([
  { id: 'display', icon: '🌐', keys: ['language', 'paneStyle'] },
  { id: 'ai', icon: '🤖', keys: ['aiModel', 'aiEffort', 'autoExplain', 'cacheExplanations'] },
  { id: 'rules', icon: '🔍', keys: ['reviewerAgents', 'memoryTools', 'memoryCueWords', 'extraRiskyCommands'] },
  { id: 'data', icon: '📦', keys: ['excludeProjects', 'retentionDays'] },
])

const AI_TABS = new Set(['cost', 'tips', 'standup', 'improve'])
// Titles, recaps, commit subjects and file names come from transcripts: drop control characters.
// Bidi overrides and line/paragraph separators can disguise text, so they go too.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
const DETAIL_MAX = 12
const clean = (text) => String(text ?? '').replace(CONTROL_CHARS, '')
const folder = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/')
const isRich = (model) => model.settings.paneStyle === 'rich'

export function renderPane(el, model, h) {
  const { Box } = el
  if (model.detail) return renderDetail(el, model, h)
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [tabRow(el, model, h), statusLine(el, model, h), ...charts(el, model), ...body(el, model, h), aiBlock(el, model, h)].filter(Boolean),
  })
}

function charts(el, model) {
  return isRich(model) ? richCharts(el, { ...model, clean }) : []
}

// Tabs with an icon each; the open one is marked ▸ and drawn at full strength.
function tabRow(el, model, h) {
  const { Box, Button } = el
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    flexWrap: 'wrap',
    children: TABS.map((tab) => Button({
      key: 'tab-' + tab.id,
      label: `${model.tab === tab.id ? '▸' : ''}${TAB_ICON[tab.id]} ${tab.label}${countBadge(model, tab.id)}`,
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

function statusText(t, s) {
  if (s.error) return [STATUS_ICON.error, t('indexError', { error: s.error }), 'error']
  if (s.indexing) return [STATUS_ICON.indexing, t('indexing'), 'warning']
  if (s.generatedAt) return [STATUS_ICON.indexed, t('indexed', { at: s.generatedAt.slice(0, 16).replace('T', ' '), n: s.sessions }), null]
  return [STATUS_ICON.none, t('notIndexed'), null]
}

function statusLine(el, model, h) {
  const { Box, Text, Button } = el
  const { t } = model
  const [icon, text, color] = statusText(t, model.status)
  const rich = isRich(model)
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: [
      Box({ flexDirection: 'row', columnGap: 1, children: [Text({ children: [icon] }), Text({ ...(color ? { color } : { dimColor: true }), wrap: 'truncate-end', children: [clean(text)] })] }),
      model.versionWarning ? Text({ color: 'warning', wrap: 'truncate-end', children: ['❗ ' + t('oldVersion', model.versionWarning)] }) : null,
      Button({ key: 'refresh', label: '↻ ' + t('refresh'), hotkey: 'r', plain: true, onPress: () => h.onRefresh() }),
      Button({ key: 'pane-style', label: t(rich ? 'styleSimple' : 'styleRich'), hotkey: 'v', plain: true, onPress: () => h.onSetting('paneStyle', rich ? 'simple' : 'rich') }),
    ].filter(Boolean),
  })
}

function body(el, model, h) {
  if (model.tab === 'standup') return standup(el, model, h)
  if (model.tab === 'settings') return settingsTab(el, model, h)
  const list = model.lists[model.tab] || []
  if (!list.length) return [iconLine(el, ICON.empty, model.t(model.tab === 'now' ? 'emptyNow' : 'emptyList'), { color: 'success' })]
  const cards = list.map((f) => findingCard(el, model.t, f, h, isRich(model)))
  return isRich(model) ? [section(el, model.t('findingsHead'), model.t('findingsCount', { n: list.length })), ...cards] : cards
}

// Severity: a colored icon and title in both styles, plus a word chip and a frame in the rich one.
function findingHead(el, t, f, rich) {
  const { Box, Text } = el
  const sev = severityOf(f)
  return Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      Text({ children: [sev.icon] }),
      rich ? chip(el, t(sev.word), sev.color) : null,
      Text({ bold: true, color: sev.color, children: [clean(f.title)] }),
    ].filter(Boolean),
  })
}

function findingCard(el, t, f, h, rich = false) {
  const { Box, Button, Link } = el
  const actions = [
    Button({ key: 'ask-' + f.id, label: t('ask'), onPress: () => h.onAsk(f) }),
    f.applyPrompt ? Button({ key: 'apply-' + f.id, label: t('apply'), onPress: () => h.onApply(f) }) : null,
    Button({ key: 'hide-' + f.id, label: t('dismiss'), onPress: () => h.onDismiss(f) }),
    f.doc ? Link({ href: f.doc, label: '📖 ' + t('docs') }) : null,
  ].filter(Boolean)
  const frame = rich ? { borderStyle: 'round', borderColor: severityOf(f).color, paddingX: 1 } : {}
  return Box({
    key: 'card-' + f.id,
    flexDirection: 'column',
    ...frame,
    children: [
      findingHead(el, t, f, rich),
      Box({
        flexDirection: 'column',
        paddingLeft: 3,
        children: [iconLine(el, ICON.evidence, clean(f.evidence), { dimColor: true }), iconLine(el, ICON.action, clean(f.action))],
      }),
      Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', paddingLeft: 3, children: actions }),
    ],
  })
}

function standupHeader(el, model, h) {
  const { Box, Button } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [1, 3, 7].map((d) => Button({
      key: 'days-' + d, label: model.t('days', { d }), plain: true,
      ...(model.days === d ? {} : { dimColor: true }),
      onPress: () => h.onDays(d),
    })),
  })
}

function standupRow(el, model, row) {
  const { Box, Text } = el
  const { t } = model
  const lines = [
    ...row.sessions.slice(-4).map((s) => iconLine(el, ICON.session, clean(s.title))),
    ...row.sessions.filter((s) => s.away).slice(-1).map((s) => iconLine(el, ICON.recap, clean(t('recap') + s.away), { dimColor: true })),
    row.commits.length ? iconLine(el, ICON.commit, clean(t('commits') + row.commits.slice(0, 5).join(' / ')), { dimColor: true }) : null,
    row.files.length ? iconLine(el, ICON.file, clean(t('files') + row.files.join(', ')), { dimColor: true, wrap: 'truncate-end' }) : null,
  ].filter(Boolean)
  const frame = isRich(model) ? { borderStyle: 'round', borderColor: 'subtle', paddingX: 1 } : {}
  const head = Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [Text({ children: [ICON.folder] }), Text({ bold: true, color: ACCENT, children: [clean(folder(row.project))] }), Text({ dimColor: true, children: [t('sessionCount', { n: row.sessions.length })] })],
  })
  return Box({ key: 'su-' + row.project, flexDirection: 'column', ...frame, children: [head, Box({ flexDirection: 'column', paddingLeft: 3, children: lines })] })
}

function standup(el, model, h) {
  const header = standupHeader(el, model, h)
  if (!model.standup.length) return [header, iconLine(el, ICON.empty, model.t('noSessions', { d: model.days }), { dimColor: true })]
  return [header, ...model.standup.map((row) => standupRow(el, model, row))]
}

function aiBlock(el, model, h) {
  if (!AI_TABS.has(model.tab)) return null
  const { Box, Button, Markdown, Text } = el
  const { t } = model
  const ai = model.ai[model.tab]
  const children = [Button({ key: 'ai-' + model.tab, label: `${ICON.ai} ` + (ai?.loading ? t('summarizing') : t('summarize', { model: model.settings.model })), hotkey: 'a', onPress: () => h.onAi(model.tab) })]
  if (ai?.text) children.push(Markdown({ key: 'ai-text-' + model.tab, text: clean(ai.text).slice(0, 9000) }))
  if (ai?.error) children.push(Text({ color: 'error', children: [clean('❌ ' + t('summaryFailed', { error: ai.error }))] }))
  children.push(Text({ dimColor: true, children: [t('summaryNote')] }))
  const frame = isRich(model) ? { borderStyle: 'round', borderColor: ACCENT, paddingX: 1 } : {}
  return Box({ flexDirection: 'column', ...frame, children })
}

// Details: the finding's numbers, the rule's breakdown and an AI explanation, all inside the pane.
function renderDetail(el, model, h) {
  const { Box, Text, Code } = el
  const { t } = model
  const f = model.detail
  const details = f.details || []
  const shown = details.slice(0, DETAIL_MAX).map((d) => Text({ children: [clean('• ' + d)] }))
  if (details.length > DETAIL_MAX) shown.push(Text({ dimColor: true, children: [t('more', { n: details.length - DETAIL_MAX })] }))
  const rich = isRich(model)
  const frame = rich ? { borderStyle: 'round', borderColor: severityOf(f).color, paddingX: 1 } : {}
  const head = Box({ flexDirection: 'column', ...frame, children: [findingHead(el, t, f, rich), iconLine(el, ICON.evidence, clean(f.evidence), { dimColor: true })] })
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      detailActions(el, t, f, h),
      f.isResolved ? iconLine(el, '✅', t('resolved'), { color: 'success' }) : null,
      head,
      shown.length ? Box({ flexDirection: 'column', children: [section(el, t('breakdown')), Box({ flexDirection: 'column', paddingLeft: 2, children: shown })] }) : null,
      Box({ flexDirection: 'column', children: [section(el, t('actionHead')), Box({ paddingLeft: 2, children: [iconLine(el, ICON.action, clean(f.action), { bold: true })] })] }),
      Box({ flexDirection: 'column', children: [section(el, t('promptHead')), Code({ source: clean(f.copyText) })] }),
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
      Button({ key: 'back', label: '← ' + t('back'), hotkey: 'b', plain: true, onPress: () => h.onBack() }),
      Button({ key: 'copy-' + f.id, label: '📋 ' + t('copy'), hotkey: 'c', plain: true, onPress: (press) => h.onCopy(f.copyText, press) }),
      f.applyPrompt ? Button({ key: 'apply-' + f.id, label: t('applyChat'), onPress: () => h.onApply(f) }) : null,
      f.doc ? Link({ href: f.doc, label: '📖 ' + t('docs') }) : null,
    ].filter(Boolean),
  })
}

function explainBody(el, model) {
  const { Text, Markdown } = el
  const { t } = model
  const ex = model.explain
  if (ex?.loading) return [iconLine(el, '⏳', t('explaining', { model: ex.model }), { dimColor: true })]
  if (ex?.error) return [Text({ color: 'error', children: [clean('❌ ' + t('explainFailed', { error: ex.error }))] })]
  if (ex?.text) return [Markdown({ key: 'explain-' + model.detail.id, text: clean(ex.text).slice(0, 9000) }), Text({ dimColor: true, children: [usageLine(t, ex)] })]
  return [Text({ dimColor: true, children: [generateHint(t, model.settings)] })]
}

function explainBlock(el, model, h) {
  const { Box, Text, Button } = el
  const { t } = model
  const f = model.detail
  const head = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [Text({ bold: true, color: ACCENT, children: [`${ICON.ai} ${t('explainHead')}`] }), Button({ key: 'explain-again', label: '↻ ' + t(model.explain?.text ? 'regenerate' : 'generate'), hotkey: 'g', plain: true, onPress: () => h.onExplainAgain(f) })],
  })
  const frame = isRich(model) ? { borderStyle: 'round', borderColor: ACCENT, paddingX: 1 } : {}
  return Box({
    flexDirection: 'column',
    ...frame,
    children: [head, ...explainBody(el, model), settingsRow(el, model, h), Text({ dimColor: true, children: [t(f.localDetails ? 'sendLocal' : 'sendDetail')] })],
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

// Settings tab: the options in four groups, one control each; a change is saved through h.onSetting.
const SPEC_BY_KEY = Object.fromEntries(SETTINGS_SPEC.map((s) => [s.key, s]))

function settingsTab(el, model, h) {
  const { Box, Text } = el
  const { t } = model
  const frame = isRich(model) ? { borderStyle: 'round', borderColor: 'subtle', paddingX: 1 } : {}
  return [
    iconLine(el, '📌', t('settingsIntro'), { dimColor: true }),
    ...SETTING_GROUPS.map((g) => Box({
      key: 'group-' + g.id,
      flexDirection: 'column',
      ...frame,
      children: [
        section(el, `${g.icon} ${t('group_' + g.id)}`),
        ...g.keys.map((key) => Box({
          key: 'setting-' + key,
          flexDirection: 'column',
          paddingLeft: 2,
          children: [settingControl(el, t, SPEC_BY_KEY[key], model.config[key], h), Text({ dimColor: true, children: ['  ' + t('cfgHelp_' + key)] })],
        })),
      ],
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
    return Select({ key, label, value: value ? 'on' : 'off', options: [{ value: 'on', label: '✅ ' + t('settingOn') }, { value: 'off', label: '⬜ ' + t('settingOff') }], onSelect: save })
  }
  return Input({ key, label, value: clean(value), submitLabel: t('settingSave'), onSubmit: save })
}

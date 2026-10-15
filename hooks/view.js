// Pane rendering. Receives the element functions from $.ui.resolve(e), plain callbacks from
// register.js and the strings function `model.t`, so this file never touches the mods API.
// One visual language for both pane styles: `rich` adds stats and charts (rich-view.js) above
// the same list; nothing else changes between them.

import { CREDIT_MODELS, EFFORT_OPTIONS, MODEL_OPTIONS } from './ai-config.js'
import { SETTINGS_SPEC } from './settings-spec.js'
import { richCharts } from './rich-view.js'
import { fmt } from './rules.js'
import { GLYPH, glyphLine, heading, labelled, meta, rainbowText, rule, severityOf, textButton } from './theme.js'

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
  { id: 'display', keys: ['language', 'paneStyle'] },
  { id: 'ai', keys: ['aiModel', 'aiEffort', 'autoExplain', 'cacheExplanations'] },
  { id: 'burn', keys: ['burnAlert', 'burnEffect'] },
  { id: 'rules', keys: ['reviewerAgents', 'memoryTools', 'memoryCueWords', 'extraRiskyCommands'] },
  { id: 'data', keys: ['excludeProjects', 'retentionDays'] },
])

const AI_TABS = new Set(['cost', 'tips', 'standup', 'improve'])
// Titles, recaps, commit subjects and file names come from transcripts: drop control characters.
// Bidi overrides and line/paragraph separators can disguise text, so they go too.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
const DETAIL_MAX = 12
const INDENT = 2
const LABEL_COLS = 8
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const clean = (text) => String(text ?? '').replace(CONTROL_CHARS, '')
const folder = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/')
const isRich = (model) => model.settings.paneStyle === 'rich'
const indent = (el, children) => el.Box({ flexDirection: 'column', paddingLeft: INDENT, children })
// A hairline is cell graphics: only the terminal draws it true to the pane's width; elsewhere the
// row gap alone separates the sections.
const hairline = (el, model) => (model.surface === 'terminal' ? rule(el, model.cols) : null)

export function renderPane(el, model, h) {
  const { Box } = el
  if (model.detail) return renderDetail(el, model, h)
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [header(el, model, h), ...charts(el, model), ...body(el, model, h), aiBlock(el, model, h)].filter(Boolean),
  })
}

// The band above the prompt: the burn pace in rainbow letters, its figures, and two actions.
export function renderBand(el, { t, last, effect }, h) {
  const { Box } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: [
      rainbowText(el, { key: 'burn-band', text: t(last.level === 'blaze' ? 'bandBlaze' : 'bandHot'), effect }),
      meta(el, t('bandEvidence', { rate: fmt(last.perMin), limit: fmt(last.threshold) }), { wrap: 'truncate-end' }),
      textButton(el, { key: 'burn-detail', label: t('bandDetail'), onPress: () => h.onBurnDetail() }),
      textButton(el, { key: 'burn-hide', label: t('bandHide'), tone: 'dim', onPress: () => h.onBurnHide() }),
    ],
  })
}

function charts(el, model) {
  return isRich(model) ? richCharts(el, { ...model, clean }) : []
}

// Tabs, the index status with its two controls, and a rule under them.
function header(el, model, h) {
  const { Box } = el
  return Box({ flexDirection: 'column', children: [tabRow(el, model, h), statusLine(el, model, h), hairline(el, model)].filter(Boolean) })
}

// The open tab reads bold at full strength; the others dim. A count follows a tab that has items.
function tabRow(el, model, h) {
  const { Box, Button, Text } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: TABS.map((tab) => {
      const active = model.tab === tab.id
      const n = model.lists[tab.id]?.length
      return Button({
        key: 'tab-' + tab.id,
        hotkey: tab.hotkey,
        plain: true,
        ...(active ? {} : { dimColor: true }),
        onPress: () => h.onTab(tab.id),
        children: [Text({ bold: active, children: [tab.label] }), ...(n ? [Text({ dimColor: true, children: [` ${n}`] })] : [])],
      })
    }),
  })
}

// "5 min ago" for a recent index, the date and time for an older one.
export function ago(t, nowMs, at) {
  const iso = String(at ?? '')
  const ms = nowMs - Date.parse(iso)
  // A stamp up to a minute ahead is clock skew between the indexer and the engine, not the future.
  if (!Number.isFinite(ms) || ms < -MINUTE_MS) return iso.slice(0, 16).replace('T', ' ')
  if (ms < MINUTE_MS) return t('agoNow')
  if (ms < HOUR_MS) return t('agoMin', { n: Math.floor(ms / MINUTE_MS) })
  if (ms < DAY_MS) return t('agoHour', { n: Math.floor(ms / HOUR_MS) })
  return iso.slice(0, 16).replace('T', ' ')
}

function statusText(model) {
  const { t, status: s } = model
  if (s.error) return [t('indexError', { error: s.error }), 'error']
  if (s.indexing) return [t('indexing'), 'warning']
  if (s.generatedAt) return [t('indexed', { at: ago(t, model.nowMs, s.generatedAt), n: s.sessions }), null]
  return [t('notIndexed'), null]
}

function statusLine(el, model, h) {
  const { Box, Text } = el
  const { t } = model
  const [text, color] = statusText(model)
  const rich = isRich(model)
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    children: [
      Box({
        flexDirection: 'column',
        children: [
          Text({ ...(color ? { color } : { dimColor: true }), wrap: 'truncate-end', children: [clean(text)] }),
          model.versionWarning ? Text({ color: 'warning', wrap: 'truncate-end', children: [t('oldVersion', model.versionWarning)] }) : null,
        ].filter(Boolean),
      }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          textButton(el, { key: 'refresh', label: t('refresh'), hotkey: 'r', tone: 'dim', onPress: () => h.onRefresh() }),
          textButton(el, { key: 'pane-style', label: t(rich ? 'styleSimple' : 'styleRich'), hotkey: 'v', tone: 'dim', onPress: () => h.onSetting('paneStyle', rich ? 'simple' : 'rich') }),
        ],
      }),
    ],
  })
}

function body(el, model, h) {
  if (model.tab === 'standup') return standup(el, model, h)
  if (model.tab === 'settings') return settingsTab(el, model, h)
  const list = model.lists[model.tab] || []
  if (!list.length) return [emptyState(el, model)]
  const cards = list.map((f) => findingCard(el, model.t, f, h, model.burnEffect))
  return isRich(model) ? [heading(el, model.t('findingsHead'), model.t('findingsCount', { n: list.length })), ...cards] : cards
}

function emptyState(el, model) {
  const { t } = model
  if (model.tab === 'now') return glyphLine(el, GLYPH.check, t('emptyNow'), { color: 'success' }, { color: 'success' })
  return meta(el, t('emptyList'))
}

// A finding: a severity dot and the title, then the severity word with the evidence, the next
// step, and its actions. The dot carries the color; the word carries the meaning. A rainbow
// finding (the burn pace) draws its title in the burnEffect.
function findingHead(el, t, f, effect) {
  const { Box, Text } = el
  const sev = severityOf(f)
  const title = f.rainbow ? rainbowText(el, { key: 'rainbow-' + f.id, text: clean(f.title), effect }) : Text({ bold: true, children: [clean(f.title)] })
  return Box({
    flexDirection: 'column',
    children: [
      Box({ flexDirection: 'row', columnGap: 1, children: [Text({ color: sev.color, children: [sev.glyph] }), title] }),
      indent(el, [meta(el, [t(sev.word), clean(f.evidence)])]),
    ],
  })
}

function docsLink(el, t, f) {
  return f.doc ? el.Link({ href: f.doc, label: `${t('docs')} ${GLYPH.external}` }) : null
}

function findingCard(el, t, f, h, effect) {
  const { Box } = el
  const actions = [
    textButton(el, { key: 'ask-' + f.id, label: t('ask'), onPress: () => h.onAsk(f) }),
    f.applyPrompt ? textButton(el, { key: 'apply-' + f.id, label: t('apply'), onPress: () => h.onApply(f) }) : null,
    textButton(el, { key: 'hide-' + f.id, label: t('dismiss'), tone: 'dim', onPress: () => h.onDismiss(f) }),
    docsLink(el, t, f),
  ].filter(Boolean)
  return Box({
    key: 'card-' + f.id,
    flexDirection: 'column',
    children: [
      findingHead(el, t, f, effect),
      indent(el, [glyphLine(el, GLYPH.arrow, clean(f.action), {}, { dimColor: true }), Box({ flexDirection: 'row', columnGap: 2, flexWrap: 'wrap', children: actions })]),
    ],
  })
}

function standupHeader(el, model, h) {
  const { Box } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [1, 3, 7].map((d) => textButton(el, { key: 'days-' + d, label: model.t('days', { d }), tone: model.days === d ? 'plain' : 'dim', onPress: () => h.onDays(d) })),
  })
}

function standupRow(el, model, row) {
  const { Box } = el
  const { t } = model
  const lines = [
    ...row.sessions.slice(-4).map((s) => glyphLine(el, GLYPH.sep, clean(s.title), {}, { dimColor: true })),
    ...row.sessions.filter((s) => s.away).slice(-1).map((s) => labelled(el, t('recap'), clean(s.away), LABEL_COLS, { dimColor: true })),
    row.commits.length ? labelled(el, t('commits'), clean(row.commits.slice(0, 5).join(' / ')), LABEL_COLS, { dimColor: true }) : null,
    row.files.length ? labelled(el, t('files'), clean(row.files.join(', ')), LABEL_COLS, { dimColor: true, wrap: 'truncate-end' }) : null,
  ].filter(Boolean)
  const head = heading(el, clean(folder(row.project)), t('sessionCount', { n: row.sessions.length }))
  return Box({ key: 'su-' + row.project, flexDirection: 'column', children: [head, indent(el, lines)] })
}

function standup(el, model, h) {
  const header = standupHeader(el, model, h)
  if (!model.standup.length) return [header, meta(el, model.t('noSessions', { d: model.days }))]
  return [header, ...model.standup.map((row) => standupRow(el, model, row))]
}

function aiBlock(el, model, h) {
  if (!AI_TABS.has(model.tab)) return null
  const { Box, Markdown, Text } = el
  const { t } = model
  const ai = model.ai[model.tab]
  const children = [
    hairline(el, model),
    textButton(el, { key: 'ai-' + model.tab, label: ai?.loading ? t('summarizing') : t('summarize', { model: model.settings.model }), hotkey: 'a', onPress: () => h.onAi(model.tab) }),
  ]
  if (ai?.text) children.push(Markdown({ key: 'ai-text-' + model.tab, text: clean(ai.text).slice(0, 9000) }))
  if (ai?.error) children.push(Text({ color: 'error', children: [clean(t('summaryFailed', { error: ai.error }))] }))
  children.push(meta(el, t('summaryNote')))
  return Box({ flexDirection: 'column', children: children.filter(Boolean) })
}

// Details: the finding's numbers, the rule's breakdown and an AI explanation, all inside the pane.
function renderDetail(el, model, h) {
  const { Box, Code } = el
  const { t } = model
  const f = model.detail
  const details = f.details || []
  const shown = details.slice(0, DETAIL_MAX).map((d) => glyphLine(el, GLYPH.sep, clean(d), {}, { dimColor: true }))
  if (details.length > DETAIL_MAX) shown.push(meta(el, t('more', { n: details.length - DETAIL_MAX })))
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Box({ flexDirection: 'column', children: [detailActions(el, t, f, h), hairline(el, model)].filter(Boolean) }),
      findingHead(el, t, f, model.burnEffect),
      f.isResolved ? glyphLine(el, GLYPH.check, t('resolved'), { color: 'success' }, { color: 'success' }) : null,
      shown.length ? Box({ flexDirection: 'column', children: [heading(el, t('breakdown')), indent(el, shown)] }) : null,
      Box({ flexDirection: 'column', children: [heading(el, t('actionHead')), indent(el, [glyphLine(el, GLYPH.arrow, clean(f.action), { bold: true }, { dimColor: true })])] }),
      Box({ flexDirection: 'column', children: [heading(el, t('promptHead'), t('promptHint')), Code({ source: clean(f.copyText) })] }),
      explainBlock(el, model, h),
    ].filter(Boolean),
  })
}

function detailActions(el, t, f, h) {
  const { Box } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: [
      textButton(el, { key: 'back', label: t('back'), hotkey: 'b', tone: 'plain', onPress: () => h.onBack() }),
      textButton(el, { key: 'copy-' + f.id, label: t('copy'), hotkey: 'c', tone: 'dim', onPress: (press) => h.onCopy(f.copyText, press) }),
      f.applyPrompt ? textButton(el, { key: 'apply-' + f.id, label: t('applyChat'), onPress: () => h.onApply(f) }) : null,
      docsLink(el, t, f),
    ].filter(Boolean),
  })
}

function explainBody(el, model) {
  const { Text, Markdown } = el
  const { t } = model
  const ex = model.explain
  if (ex?.loading) return [meta(el, t('explaining', { model: ex.model }))]
  if (ex?.error) return [Text({ color: 'error', children: [clean(t('explainFailed', { error: ex.error }))] })]
  if (ex?.text) return [Markdown({ key: 'explain-' + model.detail.id, text: clean(ex.text).slice(0, 9000) }), meta(el, usageLine(t, ex))]
  return [meta(el, generateHint(t, model.settings))]
}

function explainBlock(el, model, h) {
  const { Box } = el
  const { t } = model
  const f = model.detail
  const again = textButton(el, { key: 'explain-again', label: t(model.explain?.text ? 'regenerate' : 'generate'), hotkey: 'g', tone: 'dim', onPress: () => h.onExplainAgain(f) })
  return Box({
    flexDirection: 'column',
    children: [heading(el, t('explainHead'), [again]), indent(el, [...explainBody(el, model), settingsRow(el, model, h), meta(el, t(f.localDetails ? 'sendLocal' : 'sendDetail'))])],
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
  const { Box, Select } = el
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
          Select({ key: 'ai-effort', label: t('effortLabel'), value: settings.effort, options: EFFORT_OPTIONS.map((x) => ({ value: x, label: x })), onSelect: (v) => h.onSetting('aiEffort', v) }),
        ],
      }),
      meta(el, t('sessionUsage', aiUsage)),
    ],
  })
}

// Settings tab: the options in four groups, one control each; a change is saved through h.onSetting.
const SPEC_BY_KEY = Object.fromEntries(SETTINGS_SPEC.map((s) => [s.key, s]))

function settingsTab(el, model, h) {
  const { Box } = el
  const { t } = model
  return [
    meta(el, t('settingsIntro')),
    ...SETTING_GROUPS.map((g) => Box({
      key: 'group-' + g.id,
      flexDirection: 'column',
      children: [
        heading(el, t('group_' + g.id)),
        ...g.keys.map((key) => indent(el, [settingControl(el, t, SPEC_BY_KEY[key], model.config[key], h), indent(el, [meta(el, t('cfgHelp_' + key))])])),
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
    return Select({ key, label, value: value ? 'on' : 'off', options: [{ value: 'on', label: t('settingOn') }, { value: 'off', label: t('settingOff') }], onSelect: save })
  }
  return Input({ key, label, value: clean(value), submitLabel: t('settingSave'), onSubmit: save })
}

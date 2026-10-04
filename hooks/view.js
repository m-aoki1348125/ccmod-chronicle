// Pane rendering. Receives the element functions from $.ui.resolve(e) and plain
// callbacks from register.js, so this file never touches the mods API itself.

export const TABS = [
  { id: 'now', label: 'Now', hotkey: '1' },
  { id: 'cost', label: 'Cost', hotkey: '2' },
  { id: 'tips', label: 'Tips', hotkey: '3' },
  { id: 'standup', label: 'Standup', hotkey: '4' },
  { id: 'improve', label: 'Improve', hotkey: '5' },
]

const MARK = { high: '●', mid: '◐', low: '○' }
const COLOR = { high: 'error', mid: 'warning' }
const AI_TABS = new Set(['cost', 'tips', 'standup', 'improve'])
// Titles, recaps, commit subjects and file names come from transcripts: drop control characters.
// Bidi overrides and line/paragraph separators can disguise text, so they go too.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
const DETAIL_MAX = 12
const clean = (text) => String(text ?? '').replace(CONTROL_CHARS, '')

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
    children: TABS.map((t) => Button({
      key: 'tab-' + t.id,
      label: t.label + countBadge(model, t.id),
      hotkey: t.hotkey,
      plain: true,
      ...(model.tab === t.id ? {} : { dimColor: true }),
      onPress: () => h.onTab(t.id),
    })),
  })
}

function countBadge(model, tab) {
  const n = model.lists[tab]?.length
  return n ? ` (${n})` : ''
}

function statusLine(el, model, h) {
  const { Box, Text, Button } = el
  const s = model.status
  const text = s.error ? '集計エラー: ' + s.error
    : s.indexing ? '集計中…'
    : s.generatedAt ? `集計: ${s.generatedAt.slice(0, 16).replace('T', ' ')} · ${s.sessions} sessions`
    : 'まだ集計していません'
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({ dimColor: true, wrap: 'truncate-end', children: [text] }),
      Button({ key: 'refresh', label: '再集計', hotkey: 'r', plain: true, onPress: () => h.onRefresh() }),
    ],
  })
}

function body(el, model, h) {
  if (model.tab === 'standup') return standup(el, model, h)
  const list = model.lists[model.tab] || []
  if (!list.length) {
    const empty = model.tab === 'now' ? 'このセッションで注意すべき点はまだありません。' : '該当する提案はありません。'
    return [el.Text({ dimColor: true, children: [empty] })]
  }
  return list.map((f) => findingCard(el, f, h))
}

function findingCard(el, f, h) {
  const { Box, Text, Button, Link } = el
  const actions = [
    Button({ key: 'ask-' + f.id, label: '詳しく', onPress: () => h.onAsk(f) }),
    f.applyPrompt ? Button({ key: 'apply-' + f.id, label: '適用を依頼', onPress: () => h.onApply(f) }) : null,
    Button({ key: 'hide-' + f.id, label: '無視', onPress: () => h.onDismiss(f) }),
    f.doc ? Link({ href: f.doc, label: 'docs' }) : null,
  ].filter(Boolean)
  return Box({
    key: 'card-' + f.id,
    flexDirection: 'column',
    children: [
      Text({ bold: true, ...(COLOR[f.severity] ? { color: COLOR[f.severity] } : {}), children: [`${MARK[f.severity]} ${f.title}`] }),
      Text({ dimColor: true, children: ['  ' + f.evidence] }),
      Text({ children: ['  → ' + f.action] }),
      Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: actions }),
    ],
  })
}

function standup(el, model, h) {
  const { Box, Text, Button } = el
  const header = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [1, 3, 7].map((d) => Button({
      key: 'days-' + d, label: `${d}日`, plain: true,
      ...(model.days === d ? {} : { dimColor: true }),
      onPress: () => h.onDays(d),
    })),
  })
  if (!model.standup.length) return [header, Text({ dimColor: true, children: [`過去 ${model.days} 日のセッションはありません。`] })]
  return [header, ...model.standup.map((row) => Box({
    key: 'su-' + row.project,
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: [clean('■ ' + row.project.split('/').slice(-2).join('/'))] }),
      ...row.sessions.slice(-4).map((s) => Text({ children: [clean('  ・' + s.title)] })),
      ...row.sessions.filter((s) => s.away).slice(-1).map((s) => Text({ dimColor: true, children: [clean('  要約: ' + s.away)] })),
      row.commits.length ? Text({ dimColor: true, children: [clean('  commits: ' + row.commits.slice(0, 5).join(' / '))] }) : null,
      row.files.length ? Text({ dimColor: true, wrap: 'truncate-end', children: [clean('  files: ' + row.files.join(', '))] }) : null,
    ].filter(Boolean),
  }))]
}

function aiBlock(el, model, h) {
  if (!AI_TABS.has(model.tab)) return null
  const { Box, Button, Markdown, Text } = el
  const ai = model.ai[model.tab]
  const children = [Button({ key: 'ai-' + model.tab, label: ai?.loading ? '要約中…' : 'AIで要約 (sonnet)', hotkey: 'a', onPress: () => h.onAi(model.tab) })]
  if (ai?.text) children.push(Markdown({ key: 'ai-text-' + model.tab, text: clean(ai.text).slice(0, 9000) }))
  if (ai?.error) children.push(Text({ color: 'error', children: ['要約に失敗: ' + ai.error] }))
  children.push(Text({ dimColor: true, children: ['送信内容: 指摘・集計値・プロジェクト名（Standup はタイトル・要約・コミット件名も）'] }))
  return Box({ flexDirection: 'column', children })
}

// 詳しく: the finding's numbers, the rule's details, and an AI explanation, all inside the pane.
function renderDetail(el, model, h) {
  const { Box, Text, Button, Code } = el
  const f = model.detail
  const details = f.details || []
  const shown = details.slice(0, DETAIL_MAX).map((d) => Text({ children: [clean('  ・' + d)] }))
  if (details.length > DETAIL_MAX) shown.push(Text({ dimColor: true, children: [`  ほか ${details.length - DETAIL_MAX} 件`] }))
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      detailActions(el, f, h),
      f.isResolved ? Text({ color: 'success', children: ['✓ この指摘は解消されました（最後に表示した内容です）'] }) : null,
      Text({ bold: true, ...(COLOR[f.severity] ? { color: COLOR[f.severity] } : {}), children: [clean(`${MARK[f.severity]} ${f.title}`)] }),
      Text({ dimColor: true, children: [clean(f.evidence)] }),
      shown.length ? Box({ flexDirection: 'column', children: [Text({ bold: true, children: ['根拠の内訳'] }), ...shown] }) : null,
      Box({ flexDirection: 'column', children: [Text({ bold: true, children: ['推奨アクション'] }), Text({ children: [clean('  ' + f.action)] })] }),
      Box({ flexDirection: 'column', children: [Text({ bold: true, children: ['プロンプト（c でコピー）'] }), Code({ source: clean(f.copyText) })] }),
      explainBlock(el, model, h),
    ].filter(Boolean),
  })
}

function detailActions(el, f, h) {
  const { Box, Button, Link } = el
  return Box({
    flexDirection: 'row',
    columnGap: 2,
    flexWrap: 'wrap',
    children: [
      Button({ key: 'back', label: '戻る', hotkey: 'b', plain: true, onPress: () => h.onBack() }),
      Button({ key: 'copy-' + f.id, label: 'プロンプトをコピー', hotkey: 'c', plain: true, onPress: (press) => h.onCopy(f.copyText, press) }),
      f.applyPrompt ? Button({ key: 'apply-' + f.id, label: '適用を依頼（チャットに送信）', onPress: () => h.onApply(f) }) : null,
      f.doc ? Link({ href: f.doc, label: 'docs' }) : null,
    ].filter(Boolean),
  })
}

function explainBlock(el, model, h) {
  const { Box, Text, Button, Markdown } = el
  const f = model.detail
  const ex = model.explain
  const body = ex?.loading ? [Text({ dimColor: true, children: ['AI 解説を生成中… (sonnet)'] })]
    : ex?.error ? [Text({ color: 'error', children: ['解説の生成に失敗: ' + clean(ex.error) + '（g で再試行）'] })]
    : ex?.text ? [Markdown({ key: 'explain-' + f.id, text: clean(ex.text).slice(0, 9000) })]
    : []
  return Box({
    flexDirection: 'column',
    children: [
      Box({ flexDirection: 'row', columnGap: 2, children: [Text({ bold: true, children: ['AI 解説'] }), Button({ key: 'explain-again', label: '再生成', hotkey: 'g', plain: true, onPress: () => h.onExplainAgain(f) })] }),
      ...body,
      Text({ dimColor: true, children: [f.localDetails ? '送信内容: 指摘と集計値のみ（ファイル名は送りません）' : '送信内容: 指摘・集計値・根拠の内訳（パスを含む行は送りません）'] }),
    ],
  })
}

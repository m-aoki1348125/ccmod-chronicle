// Pure rule engine: digest (from the indexer) + live session data -> findings.
// No mods API calls here, so it can be imported and unit-tested freely.

export const THRESHOLDS = {
  contextWarnPct: 60,
  contextHighPct: 80,
  rateLimitWarnPct: 80,
  compactHighTokens: 700_000,
  heavySessions: 3,
  heavyShareHigh: 0.5,
  unreviewedEdits: 3,
  reviewerRatioLow: 0.1,
  resumeHigh: 20,
  correctionHigh: 10,
  longTurnMs: 30 * 60 * 1000,
  toolErrorsHigh: 100,
}

// Kept in step with RISKY_PATTERNS in indexer/chronicle_index.py.
export const RISKY_COMMANDS = [
  [/\brm\s+-\w*r/, 'rm -r'],
  [/git\s+push\b.*(\s-f\b|--force(?!-with-lease))/, 'force push'],
  [/git\s+reset\s+--hard/, 'reset --hard'],
  [/terraform\s+apply/, 'terraform apply'],
  [/(^|[\s;&|])(ssh|scp|rsync)\s/, 'remote copy/shell'],
  [/(^|[\s;&|])sudo\s/, 'sudo'],
]
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.swift', '.kt', '.java', '.c', '.cpp', '.cs', '.rb'])
const REVIEWERS = new Set(['code-reviewer', 'security-reviewer', 'qa-agent'])
const DOC = 'https://code.claude.com/docs/ja/'

const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n))
const finding = (f) => ({ severity: 'mid', details: [], ...f })
const DETAIL_ROWS = 6
const TRIGGERS = new Set(['auto', 'manual'])
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0) + '%'
const sessionLabel = (s) => `${(s.project || '?').split('/').pop()} ${String(s.end || '').slice(5, 10)}`
// Details are built from counts, model names, dates and project folder names only.
const topSessions = (digest, score, render) => (digest?.sessions || [])
  .map((s) => ({ s, v: score(s) })).filter((r) => r.v > 0)
  .sort((a, b) => b.v - a.v).slice(0, DETAIL_ROWS).map(render)

export function isCodePath(path) {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && CODE_EXTS.has(path.slice(dot).toLowerCase())
}

export function isReviewer(agentType) {
  return REVIEWERS.has(String(agentType || '').split(':').pop())
}

// Fold every session into one set of totals.
export function totals(digest) {
  const t = { tools: {}, agents: {}, risky: {}, permModes: {}, apiErrors: {}, usage: {}, editExts: {}, compactions: [], turns: [], sessions: 0 }
  const add = (dst, src) => { for (const [k, v] of Object.entries(src || {})) dst[k] = (dst[k] || 0) + v }
  for (const s of digest?.sessions || []) {
    t.sessions += 1
    add(t.tools, s.tools); add(t.agents, s.agents); add(t.risky, s.risky)
    add(t.permModes, s.permModes); add(t.apiErrors, s.apiErrors); add(t.editExts, s.editExts)
    for (const src of [s.usageByModel, s.subUsage]) {
      for (const [model, u] of Object.entries(src || {})) {
        const row = (t.usage[model] ||= { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 })
        for (const k of Object.keys(row)) row[k] += u[k] || 0
      }
    }
    t.compactions.push(...(s.compactions || []))
    if (s.turns?.count) t.turns.push(s.turns)
  }
  return t
}

// Live state after one tool call: code files edited since the last review, risky commands run.
export function trackToolCall(state, e) {
  let next = state
  if ((e.tool === 'Edit' || e.tool === 'Write') && typeof e.file_path === 'string' && isCodePath(e.file_path)) {
    if (!next.unreviewed.includes(e.file_path)) next = { ...next, unreviewed: [...next.unreviewed, e.file_path] }
  }
  if (e.tool === 'Bash' && typeof e.command === 'string') {
    for (const [re, label] of RISKY_COMMANDS) {
      if (re.test(e.command)) next = { ...next, risky: { ...next.risky, [label]: (next.risky[label] || 0) + 1 } }
    }
  }
  return next
}

export function buildNow(live) {
  const out = []
  const pct = live?.context?.percent
  if (typeof pct === 'number' && pct >= THRESHOLDS.contextWarnPct) {
    out.push(finding({
      id: 'now-context', severity: pct >= THRESHOLDS.contextHighPct ? 'high' : 'mid',
      title: `コンテキスト ${Math.round(pct)}% 使用中`,
      evidence: `${fmt(live.context.tokens || 0)} / ${fmt(live.context.window || 0)} tokens`,
      action: '区切りの良いところで `/compact <残したい論点>` を実行する。話題が変わるなら `/clear`。',
      doc: DOC + 'context-window',
    }))
  }
  for (const rl of live?.rateLimits || []) {
    if (rl.percentUsed >= THRESHOLDS.rateLimitWarnPct) {
      out.push(finding({
        id: 'now-rate-' + rl.kind, severity: 'high',
        title: `${rl.kind} 上限 ${Math.round(rl.percentUsed)}%`,
        evidence: rl.resetsAt ? `解除: ${rl.resetsAt}` : '解除時刻不明',
        action: '重い作業は解除後に回す。サブエージェントは sonnet / haiku を指定して消費を抑える。',
        doc: DOC + 'costs',
      }))
    }
  }
  const pending = live?.unreviewed?.length || 0
  if (pending >= THRESHOLDS.unreviewedEdits) {
    out.push(finding({
      id: 'now-unreviewed', severity: 'high',
      title: `未レビューのコード変更 ${pending} ファイル`,
      evidence: live.unreviewed.slice(0, 5).map((p) => p.split('/').pop()).join(', '),
      action: 'CLAUDE.md の規約どおり code-reviewer + security-reviewer を並列で、最後に qa-agent を実行する。',
      prompt: '今回変更したコードに対して code-reviewer と security-reviewer を並列で実行し、その後 qa-agent で最終確認して。',
      details: live.unreviewed.map((p) => p.split('/').pop()),
      // File names stay on this machine: the AI explanation is sent without these details.
      localDetails: true,
    }))
  }
  for (const [label, n] of Object.entries(live?.risky || {})) {
    out.push(finding({
      id: 'now-risky-' + label, severity: 'mid',
      title: `外部影響のある操作: ${label} × ${n}`,
      evidence: 'このセッションで実行済み',
      action: '提出や push の前に、ガード用の mod か permissions の ask ルールで確認を挟む。',
      doc: DOC + 'permissions',
    }))
  }
  return out
}

export function buildCost(digest) {
  const t = totals(digest)
  const out = []
  const big = t.compactions.filter((c) => (c.preTokens || 0) >= THRESHOLDS.compactHighTokens)
  if (big.length) {
    out.push(finding({
      id: 'cost-late-compact', severity: 'high',
      title: `compaction ${t.compactions.length} 回中 ${big.length} 回が ${fmt(THRESHOLDS.compactHighTokens)} tokens 超`,
      evidence: '最大 ' + fmt(Math.max(...big.map((c) => c.preTokens))) + ' tokens',
      action: '1M の枠を使い切る前に compaction する。model-config の auto-compact window を下げるか、60% 付近で手動の `/compact` を習慣にする。',
      doc: DOC + 'model-config',
      details: big.map((c) => `${String(c.at || '').slice(0, 10)} ${TRIGGERS.has(c.trigger) ? c.trigger : '?'} ${fmt(c.preTokens)} tokens`),
    }))
  }
  out.push(...heavySessionFindings(digest))
  out.push(...modelMixFindings(t))
  const credits = t.apiErrors.credits || 0
  if (credits) {
    out.push(finding({
      id: 'cost-credits', severity: 'mid',
      title: `usage credits / spend limit のエラー ${credits} 回`,
      evidence: `rate limit ${t.apiErrors.rateLimit || 0} 回 / auth ${t.apiErrors.auth || 0} 回`,
      action: 'Fable など credits を消費するモデルは明示的に選んだときだけ使う。既定は opus、実装やレビューは sonnet。',
      doc: DOC + 'model-config',
      details: Object.entries(t.apiErrors).map(([k, n]) => `${k}: ${n} 回`),
    }))
  }
  const longTurns = t.turns.filter((x) => x.maxMs >= THRESHOLDS.longTurnMs).length
  if (longTurns) {
    out.push(finding({
      id: 'cost-long-turns', severity: 'low',
      title: `${THRESHOLDS.longTurnMs / 60000} 分を超えるターンを含むセッション ${longTurns} 件`,
      evidence: '最長 ' + Math.round(Math.max(...t.turns.map((x) => x.maxMs)) / 60000) + ' 分',
      action: '長い自律作業は /goal や Workflow に分け、途中の結果をファイルに残してコンテキストを軽く保つ。',
      doc: DOC + 'workflows',
      details: topSessions(digest, (s) => s.turns?.maxMs || 0, (r) => `${sessionLabel(r.s)} 最長 ${Math.round(r.v / 60000)} 分`),
    }))
  }
  return out
}

const sessionCacheRead = (s) => sum([s.usageByModel, s.subUsage].flatMap((src) => Object.values(src || {}).map((u) => u.cacheRead || 0)))

// A few very long sessions usually dominate cache reads; name them so they can be split.
// Evidence uses project folder names and dates only, never transcript text.
function heavySessionFindings(digest) {
  const rows = (digest?.sessions || []).map((s) => ({ s, read: sessionCacheRead(s) })).filter((r) => r.read > 0)
  const total = sum(rows.map((r) => r.read))
  if (!total) return []
  const top = [...rows].sort((a, b) => b.read - a.read).slice(0, THRESHOLDS.heavySessions)
  const share = sum(top.map((r) => r.read)) / total
  const label = (r) => `${(r.s.project || '?').split('/').pop()} ${String(r.s.end || '').slice(5, 10)} ${fmt(r.read)}`
  return [finding({
    id: 'cost-heavy-sessions', severity: share >= THRESHOLDS.heavyShareHigh ? 'mid' : 'low',
    title: `上位 ${top.length} セッションで cache read の ${Math.round(share * 100)}%`,
    evidence: top.map(label).join(' · ') + ` / 全体 ${fmt(total)}`,
    action: '長く続けたセッションほど毎ターン全文を読み直す。区切りごとに /clear して要点だけ引き継ぐか、調査をサブエージェントに任せて本線を短く保つ。',
    doc: DOC + 'prompt-caching',
    details: topSessions(digest, sessionCacheRead, (r) => `${sessionLabel(r.s)} ${fmt(r.v)} (${pct(r.v, total)}) · compaction ${r.s.compactions?.length || 0} 回`),
  })]
}

function modelMixFindings(t) {
  const outByModel = Object.entries(t.usage).map(([m, u]) => [m, u.out]).filter(([, n]) => n > 0)
  const total = sum(outByModel.map(([, n]) => n))
  if (!total) return []
  const top = outByModel.sort((a, b) => b[1] - a[1]).slice(0, 4)
  const cheap = sum(outByModel.filter(([m]) => /sonnet|haiku/.test(m)).map(([, n]) => n))
  return [finding({
    id: 'cost-model-mix', severity: cheap / total < 0.15 ? 'mid' : 'low',
    title: `出力トークンのうち sonnet/haiku は ${Math.round((cheap / total) * 100)}%`,
    evidence: top.map(([m, n]) => `${m.replace('claude-', '')} ${Math.round((n / total) * 100)}%`).join(' · '),
    action: 'レビュー、検索、機械的な編集はサブエージェントに sonnet / haiku を指定して任せる。',
    doc: DOC + 'sub-agents',
    details: outByModel.map(([m, n]) => `${m.replace('claude-', '')}: ${fmt(n)} (${pct(n, total)})`),
  })]
}

function reviewGateDetails(t) {
  const exts = Object.entries(t.editExts).filter(([ext]) => CODE_EXTS.has(ext)).sort((a, b) => b[1] - a[1]).slice(0, DETAIL_ROWS)
  // Only the known reviewer names are shown; user-defined agent names may carry customer names.
  const reviewers = Object.entries(t.agents).filter(([a]) => isReviewer(a)).sort((a, b) => b[1] - a[1])
  const others = sum(Object.entries(t.agents).filter(([a]) => !isReviewer(a)).map(([, n]) => n))
  return [
    ...exts.map(([ext, n]) => `編集 ${ext}: ${n} 回`),
    ...reviewers.map(([a, n]) => `レビュー系 ${a.split(':').pop()}: ${n} 回`),
    `その他のエージェント: ${others} 回`,
  ]
}

function toolErrorFindings(digest) {
  const denials = sum((digest?.sessions || []).map((s) => s.denials || 0))
  const errors = sum((digest?.sessions || []).map((s) => s.toolErrors || 0))
  if (errors < THRESHOLDS.toolErrorsHigh) return []
  return [finding({
    id: 'improve-tool-errors', severity: 'low',
    title: `ツールエラー ${errors} 回（拒否 ${denials} 回）`,
    evidence: 'Bash の失敗や存在しないパスの読み込みなど',
    action: 'よく失敗するコマンド（venv のパス、テストの実行方法など）をプロジェクトの CLAUDE.md に書いておく。',
    doc: DOC + 'memory',
    details: topSessions(digest, (s) => s.toolErrors || 0, (r) => `${sessionLabel(r.s)} エラー ${r.v} 回`),
  })]
}

export function buildImprove(digest) {
  const t = totals(digest)
  const h = digest?.history || {}
  const out = []
  const codeEdits = sum(Object.entries(t.editExts).filter(([ext]) => CODE_EXTS.has(ext)).map(([, n]) => n))
  const reviews = sum(Object.entries(t.agents).filter(([a]) => isReviewer(a)).map(([, n]) => n))
  if (codeEdits && reviews / codeEdits < THRESHOLDS.reviewerRatioLow) {
    out.push(finding({
      id: 'improve-review-gate', severity: 'high',
      title: `コード編集 ${codeEdits} 回に対し、レビュー系エージェントの起動は ${reviews} 回`,
      evidence: Object.entries(t.agents).filter(([a]) => isReviewer(a)).map(([a, n]) => `${a} ${n}`).join(' · ') || 'なし',
      action: '「コードを書いたらレビュー」を意志ではなく仕組みで担保する。Stop の settings hook か、この mod の Now タブの警告で漏れを止める。',
      doc: DOC + 'hooks-guide',
      details: reviewGateDetails(t),
      applyPrompt: '~/.claude/CLAUDE.md の Subagents 節を読み、「コード変更を含むターンの終わりには code-reviewer と security-reviewer を必ず実行する」ことを明確にする追記案を作って、差分を見せてから適用して。',
    }))
  }
  const qmdAll = sum(Object.entries(t.tools).filter(([k]) => k.startsWith('mcp__notes__') || k === 'bash:notes').map(([, n]) => n))
  if ((h.memoryCuePrompts || 0) > qmdAll) {
    out.push(finding({
      id: 'improve-recall', severity: 'mid',
      title: `「前回・以前」を含むプロンプト ${h.memoryCuePrompts} 件 / notes の検索 ${qmdAll} 回`,
      evidence: '過去の文脈が必要な場面で検索が後回しになっている可能性',
      action: 'UserPromptSubmit hook でキーワードを検出し、notes 検索を促すコンテキストを足す。',
      doc: DOC + 'hooks',
    }))
  }
  if ((h.correctionPrompts || 0) >= THRESHOLDS.correctionHigh) {
    out.push(finding({
      id: 'improve-corrections', severity: 'mid',
      title: `やり直しを求めるプロンプト ${h.correctionPrompts} 件`,
      evidence: '「違う」「まだ」「改善されていない」などを含む入力',
      action: '完了条件（目視確認の手順や合格基準）を最初に書く。繰り返す指摘は CLAUDE.md かプロジェクトの skill にする。',
      doc: DOC + 'best-practices',
      applyPrompt: 'このプロジェクトで私が繰り返し指摘している点を会話履歴から 3 つ挙げ、プロジェクトの CLAUDE.md に追記する案を差分で見せて。承認したら適用して。',
    }))
  }
  out.push(...toolErrorFindings(digest))
  return out
}

export function buildStandup(digest, days, nowMs, gitLogs = {}) {
  const since = nowMs - days * 24 * 3600 * 1000
  const byProject = new Map()
  for (const s of digest?.sessions || []) {
    if (!s.end || Date.parse(s.end) < since) continue
    // Sessions with neither a title nor a typed prompt (e.g. `claude -p /cmd`) carry no work to report.
    if (!s.title && !s.firstPrompt) continue
    const key = s.project || '(unknown)'
    const row = byProject.get(key) || { project: key, sessions: [], files: new Set() }
    row.sessions.push({ title: s.title || s.firstPrompt || '(無題)', fromPrompt: !s.title, away: s.away?.at(-1) || null, end: s.end })
    for (const f of s.editedFiles || []) row.files.add(f.split('/').pop())
    byProject.set(key, row)
  }
  return [...byProject.values()]
    .map((r) => ({ ...r, files: [...r.files].slice(0, 8), commits: gitLogs[r.project] || [] }))
    .sort((a, b) => (b.sessions.at(-1)?.end || '').localeCompare(a.sessions.at(-1)?.end || ''))
}

export function rankFindings(list, dismissed = []) {
  const order = { high: 0, mid: 1, low: 2 }
  const hidden = new Set(dismissed)
  return list.filter((f) => !hidden.has(f.id)).sort((a, b) => order[a.severity] - order[b.severity])
}

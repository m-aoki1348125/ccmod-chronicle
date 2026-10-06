// Pure rule engine: digest (from the indexer) + live session data -> findings.
// No mods API calls here, so it can be imported and unit-tested freely. Every builder takes a
// ctx from i18n.js (language, strings, doc links, user rule settings); omitted, it is English
// with the default rules.

import { makeCtx } from './i18n.js'

export const THRESHOLDS = {
  contextWarnPct: 60,
  contextHighPct: 80,
  rateLimitWarnPct: 80,
  compactHighTokens: 700_000,
  heavySessions: 3,
  heavyShareHigh: 0.5,
  unreviewedEdits: 3,
  reviewerRatioLow: 0.1,
  correctionHigh: 10,
  correctionShare: 0.02,
  longTurnMs: 30 * 60 * 1000,
  toolErrorsHigh: 100,
  cheapShareLow: 0.15,
}

// Kept in step with RISKY_PATTERNS in indexer/chronicle_index.py.
export const RISKY_COMMANDS = [
  [/\brm\s+-\w*r/, 'rm -r'],
  [/git\s+push\b.*(\s-f\b|--force(?!-with-lease))/, 'force push'],
  [/git\s+reset\s+--hard/, 'reset --hard'],
  [/(^|[\s;&|])(ssh|scp|rsync)\s/, 'remote copy/shell'],
  [/(^|[\s;&|])sudo\s/, 'sudo'],
]
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.swift', '.kt', '.java', '.c', '.cpp', '.cs', '.rb'])

const sum = (xs) => xs.reduce((a, b) => a + b, 0)
export const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n))
const finding = (f) => ({ severity: 'mid', details: [], ...f })
const DETAIL_ROWS = 6
export const TRIGGERS = new Set(['auto', 'manual'])
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0)
const basename = (p) => String(p || '?').split(/[\\/]/).filter(Boolean).pop() || '?'
export const sessionLabel = (s) => `${basename(s.project)} ${String(s.end || '').slice(5, 10)}`
// Details are built from counts, model names, dates and project folder names only.
const topSessions = (digest, score, render) => (digest?.sessions || [])
  .map((s) => ({ s, v: score(s) })).filter((r) => r.v > 0)
  .sort((a, b) => b.v - a.v).slice(0, DETAIL_ROWS).map(render)

export function isCodePath(path) {
  const dot = path.lastIndexOf('.')
  return dot >= 0 && CODE_EXTS.has(path.slice(dot).toLowerCase())
}

// A plugin-scoped agent (`my-plugin:code-reviewer`) counts by its last segment.
export function isReviewer(agentType, reviewers) {
  return reviewers.includes(String(agentType || '').split(':').pop())
}

// Built-in risky commands plus the user's extra substrings (labelled by the substring itself).
export function riskyCommands(cfg) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const builtIn = new Set(RISKY_COMMANDS.map(([, label]) => label))
  // A string equal to a built-in label would count the same command twice.
  return [...RISKY_COMMANDS, ...cfg.extraRisky.filter((s) => !builtIn.has(s)).map((s) => [new RegExp(escape(s)), s])]
}

// Fold every session into one set of totals.
export function totals(digest) {
  const t = { tools: {}, agents: {}, risky: {}, permModes: {}, apiErrors: {}, usage: {}, editExts: {}, bashHeads: {}, compactions: [], turns: [], sessions: 0 }
  const add = (dst, src) => { for (const [k, v] of Object.entries(src || {})) dst[k] = (dst[k] || 0) + v }
  for (const s of digest?.sessions || []) {
    t.sessions += 1
    add(t.tools, s.tools); add(t.agents, s.agents); add(t.risky, s.risky); add(t.bashHeads, s.bashHeads)
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
export function trackToolCall(state, e, risky = RISKY_COMMANDS) {
  let next = state
  if ((e.tool === 'Edit' || e.tool === 'Write') && typeof e.file_path === 'string' && isCodePath(e.file_path)) {
    if (!next.unreviewed.includes(e.file_path)) next = { ...next, unreviewed: [...next.unreviewed, e.file_path] }
  }
  if (e.tool === 'Bash' && typeof e.command === 'string') {
    for (const [re, label] of risky) {
      if (re.test(e.command)) next = { ...next, risky: { ...next.risky, [label]: (next.risky[label] || 0) + 1 } }
    }
  }
  return next
}

export function buildNow(live, ctx = makeCtx()) {
  const { t, doc, cfg } = ctx
  const out = []
  const used = live?.context?.percent
  if (typeof used === 'number' && used >= THRESHOLDS.contextWarnPct) {
    out.push(finding({
      id: 'now-context', severity: used >= THRESHOLDS.contextHighPct ? 'high' : 'mid',
      title: t('nowContextTitle', { pct: Math.round(used) }),
      evidence: `${fmt(live.context.tokens || 0)} / ${fmt(live.context.window || 0)} tokens`,
      action: t('nowContextAction'),
      doc: doc('context-window'),
    }))
  }
  for (const rl of live?.rateLimits || []) {
    if (rl.percentUsed < THRESHOLDS.rateLimitWarnPct) continue
    out.push(finding({
      id: 'now-rate-' + rl.kind, severity: 'high',
      title: t('nowRateTitle', { kind: rl.kind, pct: Math.round(rl.percentUsed) }),
      evidence: rl.resetsAt ? t('nowRateResets', { at: rl.resetsAt }) : t('nowRateUnknown'),
      action: t('nowRateAction'),
      doc: doc('costs'),
    }))
  }
  out.push(...unreviewedFindings(live, ctx))
  for (const [label, n] of Object.entries(live?.risky || {})) {
    out.push(finding({
      id: 'now-risky-' + label, severity: 'mid',
      title: t('nowRiskyTitle', { label, n }),
      evidence: t('nowRiskyEvidence'),
      action: t('nowRiskyAction'),
      doc: doc('permissions'),
    }))
  }
  return out
}

function unreviewedFindings(live, { t, cfg }) {
  const pending = live?.unreviewed?.length || 0
  // With no review agents configured there is nothing to recommend running.
  if (pending < THRESHOLDS.unreviewedEdits || !cfg.reviewers.length) return []
  const agents = cfg.reviewers.join(', ')
  return [finding({
    id: 'now-unreviewed', severity: 'high',
    title: t('nowUnreviewedTitle', { n: pending }),
    evidence: live.unreviewed.slice(0, 5).map(basename).join(', '),
    action: t('nowUnreviewedAction', { agents }),
    prompt: t('nowUnreviewedPrompt', { agents }),
    details: live.unreviewed.map(basename),
    // File names stay on this machine: the AI explanation is sent without these details.
    localDetails: true,
  })]
}

export function buildCost(digest, ctx = makeCtx()) {
  const tot = totals(digest)
  return [
    ...lateCompactFindings(tot, ctx),
    ...heavySessionFindings(digest, ctx),
    ...modelMixFindings(tot, ctx),
    ...creditFindings(tot, ctx),
    ...longTurnFindings(digest, tot, ctx),
  ]
}

function lateCompactFindings(tot, { t, doc }) {
  const big = tot.compactions.filter((c) => (c.preTokens || 0) >= THRESHOLDS.compactHighTokens)
  if (!big.length) return []
  return [finding({
    id: 'cost-late-compact', severity: 'high',
    title: t('lateCompactTitle', { big: big.length, all: tot.compactions.length, limit: fmt(THRESHOLDS.compactHighTokens) }),
    evidence: t('lateCompactEvidence', { max: fmt(Math.max(...big.map((c) => c.preTokens))) }),
    action: t('lateCompactAction'),
    doc: doc('model-config'),
    details: big.map((c) => `${String(c.at || '').slice(0, 10)} ${TRIGGERS.has(c.trigger) ? c.trigger : '?'} ${fmt(c.preTokens)} tokens`),
  })]
}

export const sessionCacheRead = (s) => sum([s.usageByModel, s.subUsage].flatMap((src) => Object.values(src || {}).map((u) => u.cacheRead || 0)))

// A few very long sessions usually dominate cache reads; name them so they can be split.
// Evidence uses project folder names and dates only, never transcript text.
function heavySessionFindings(digest, { t, doc }) {
  const rows = (digest?.sessions || []).map((s) => ({ s, read: sessionCacheRead(s) })).filter((r) => r.read > 0)
  const total = sum(rows.map((r) => r.read))
  if (!total) return []
  const top = [...rows].sort((a, b) => b.read - a.read).slice(0, THRESHOLDS.heavySessions)
  const share = sum(top.map((r) => r.read)) / total
  return [finding({
    id: 'cost-heavy-sessions', severity: share >= THRESHOLDS.heavyShareHigh ? 'mid' : 'low',
    title: t('heavyTitle', { n: top.length, pct: Math.round(share * 100) }),
    evidence: t('heavyEvidence', { top: top.map((r) => `${sessionLabel(r.s)} ${fmt(r.read)}`).join(' · '), total: fmt(total) }),
    action: t('heavyAction'),
    doc: doc('prompt-caching'),
    details: topSessions(digest, sessionCacheRead, (r) => t('heavyDetail', { label: sessionLabel(r.s), read: fmt(r.v), pct: pct(r.v, total) + '%', n: r.s.compactions?.length || 0 })),
  })]
}

function modelMixFindings(tot, { t, doc }) {
  const outByModel = Object.entries(tot.usage).map(([m, u]) => [m, u.out]).filter(([, n]) => n > 0)
  const total = sum(outByModel.map(([, n]) => n))
  if (!total) return []
  const top = [...outByModel].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const cheap = sum(outByModel.filter(([m]) => /sonnet|haiku/.test(m)).map(([, n]) => n))
  return [finding({
    id: 'cost-model-mix', severity: cheap / total < THRESHOLDS.cheapShareLow ? 'mid' : 'low',
    title: t('mixTitle', { pct: pct(cheap, total) }),
    evidence: top.map(([m, n]) => `${m.replace('claude-', '')} ${pct(n, total)}%`).join(' · '),
    action: t('mixAction'),
    doc: doc('sub-agents'),
    details: outByModel.map(([m, n]) => `${m.replace('claude-', '')}: ${fmt(n)} (${pct(n, total)}%)`),
  })]
}

function creditFindings(tot, { t, doc }) {
  const credits = tot.apiErrors.credits || 0
  if (!credits) return []
  return [finding({
    id: 'cost-credits', severity: 'mid',
    title: t('creditsTitle', { n: credits }),
    evidence: t('creditsEvidence', { rate: tot.apiErrors.rateLimit || 0, auth: tot.apiErrors.auth || 0 }),
    action: t('creditsAction'),
    doc: doc('model-config'),
    details: Object.entries(tot.apiErrors).map(([kind, n]) => t('errorCount', { kind, n })),
  })]
}

function longTurnFindings(digest, tot, { t, doc }) {
  const longTurns = tot.turns.filter((x) => x.maxMs >= THRESHOLDS.longTurnMs).length
  if (!longTurns) return []
  return [finding({
    id: 'cost-long-turns', severity: 'low',
    title: t('longTitle', { n: longTurns, min: THRESHOLDS.longTurnMs / 60000 }),
    evidence: t('longEvidence', { min: Math.round(Math.max(...tot.turns.map((x) => x.maxMs)) / 60000) }),
    action: t('longAction'),
    doc: doc('workflows'),
    details: topSessions(digest, (s) => s.turns?.maxMs || 0, (r) => t('longDetail', { label: sessionLabel(r.s), min: Math.round(r.v / 60000) })),
  })]
}

export function buildImprove(digest, ctx = makeCtx()) {
  const tot = totals(digest)
  return [
    ...reviewGateFindings(tot, ctx),
    ...recallFindings(tot, digest?.history || {}, ctx),
    ...correctionFindings(digest?.history || {}, ctx),
    ...toolErrorFindings(digest, ctx),
  ]
}

function reviewGateFindings(tot, ctx) {
  const { t, doc, cfg } = ctx
  if (!cfg.reviewers.length) return []
  const codeEdits = sum(Object.entries(tot.editExts).filter(([ext]) => CODE_EXTS.has(ext)).map(([, n]) => n))
  const reviewerRows = Object.entries(tot.agents).filter(([a]) => isReviewer(a, cfg.reviewers)).sort((a, b) => b[1] - a[1])
  const reviews = sum(reviewerRows.map(([, n]) => n))
  if (!codeEdits || reviews / codeEdits >= THRESHOLDS.reviewerRatioLow) return []
  const agents = cfg.reviewers.join(', ')
  return [finding({
    id: 'improve-review-gate', severity: 'high',
    title: t('gateTitle', { edits: codeEdits, reviews }),
    evidence: reviewerRows.map(([a, n]) => `${a.split(':').pop()} ${n}`).join(' · ') || t('gateNone'),
    action: t('gateAction'),
    doc: doc('hooks-guide'),
    details: reviewGateDetails(tot, reviewerRows, ctx),
    applyPrompt: t('gateApply', { agents }),
  })]
}

function reviewGateDetails(tot, reviewerRows, { t, cfg }) {
  const exts = Object.entries(tot.editExts).filter(([ext]) => CODE_EXTS.has(ext)).sort((a, b) => b[1] - a[1]).slice(0, DETAIL_ROWS)
  // Only the configured reviewer names are shown; other agent names may carry customer names.
  const others = sum(Object.entries(tot.agents).filter(([a]) => !isReviewer(a, cfg.reviewers)).map(([, n]) => n))
  return [
    ...exts.map(([ext, n]) => t('gateEdits', { ext, n })),
    ...reviewerRows.map(([a, n]) => t('gateReviewer', { name: a.split(':').pop(), n })),
    t('gateOthers', { n: others }),
  ]
}

// Searches of the user's notes: MCP tools by name prefix, CLIs by the first word of a Bash command.
function memorySearches(tot, memoryTools) {
  const tools = sum(Object.entries(tot.tools).filter(([k]) => memoryTools.some((p) => k.startsWith(p))).map(([, n]) => n))
  const clis = sum(Object.entries(tot.bashHeads).filter(([k]) => memoryTools.includes(k)).map(([, n]) => n))
  return tools + clis
}

function recallFindings(tot, h, { t, doc, cfg }) {
  // Without a configured note tool there is nothing to compare the cues against.
  if (!cfg.memoryTools.length) return []
  const searches = memorySearches(tot, cfg.memoryTools)
  const cues = h.memoryCuePrompts || 0
  if (cues <= searches) return []
  return [finding({
    id: 'improve-recall', severity: 'mid',
    title: t('recallTitle', { cues, searches }),
    evidence: t('recallEvidence'),
    action: t('recallAction'),
    doc: doc('hooks'),
  })]
}

function correctionFindings(h, { t, doc }) {
  // Phrases like "try again" turn up in any long history, so require a share of prompts as well.
  const n = h.correctionPrompts || 0
  if (n < THRESHOLDS.correctionHigh || n < (h.prompts || 0) * THRESHOLDS.correctionShare) return []
  return [finding({
    id: 'improve-corrections', severity: 'mid',
    title: t('correctionsTitle', { n: h.correctionPrompts }),
    evidence: t('correctionsEvidence'),
    action: t('correctionsAction'),
    doc: doc('best-practices'),
    applyPrompt: t('correctionsApply'),
  })]
}

function toolErrorFindings(digest, { t, doc }) {
  const denials = sum((digest?.sessions || []).map((s) => s.denials || 0))
  const errors = sum((digest?.sessions || []).map((s) => s.toolErrors || 0))
  if (errors < THRESHOLDS.toolErrorsHigh) return []
  return [finding({
    id: 'improve-tool-errors', severity: 'low',
    title: t('errorsTitle', { errors, denials }),
    evidence: t('errorsEvidence'),
    action: t('errorsAction'),
    doc: doc('memory'),
    details: topSessions(digest, (s) => s.toolErrors || 0, (r) => t('errorsDetail', { label: sessionLabel(r.s), n: r.v })),
  })]
}

export function buildStandup(digest, days, nowMs, gitLogs = {}, ctx = makeCtx()) {
  const since = nowMs - days * 24 * 3600 * 1000
  const byProject = new Map()
  for (const s of digest?.sessions || []) {
    if (!s.end || Date.parse(s.end) < since) continue
    // Sessions with neither a title nor a typed prompt (e.g. `claude -p /cmd`) carry no work to report.
    if (!s.title && !s.firstPrompt) continue
    const key = s.project || '(unknown)'
    const row = byProject.get(key) || { project: key, sessions: [], files: new Set() }
    row.sessions.push({ title: s.title || s.firstPrompt || ctx.t('untitled'), fromPrompt: !s.title, away: s.away?.at(-1) || null, end: s.end })
    for (const f of s.editedFiles || []) row.files.add(basename(f))
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

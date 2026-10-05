// session-chronicle: a sidebar that analyzes how you use Claude Code.
// Heavy lifting (reading ~800MB of transcripts) runs in indexer/chronicle_index.py
// via $.process.run; this module renders the digest plus live session signals.

import { buildNow, buildCost, buildImprove, buildStandup, rankFindings, isReviewer, trackToolCall } from './rules.js'
import { buildTips } from './catalog.js'
import { renderPane, TABS } from './view.js'
import { copyText, shareableFinding, stripLinks } from './privacy.js'
import { atom, read, update } from 'claude-code'
import { addUsage, CREDIT_MODELS, explainCacheKey, isCacheEntry, maxTokensFor, mergeSetting, tokensOf, normalizeSettings, pruneCache, settingsField, EXPLAIN_SYSTEM, SUMMARY_SYSTEM } from './ai-config.js'

const PANE = 'session-chronicle'
const INDEX_TIMEOUT_MS = 10 * 60 * 1000
const GIT_TIMEOUT_MS = 5000
const MAX_GIT_PROJECTS = 8
const MAX_DIGEST_BYTES = 3.5 * 1024 * 1024
const ERROR_CHARS = 200
// Repo-local config could make `git log` launch programs (gpg, fsmonitor); turn those off.
const GIT_SAFE = ['git', '-c', 'log.showSignature=false', '-c', 'core.fsmonitor=false', '-c', 'diff.external=']
const AI_TIMEOUT_MS = 60000
const STARTUP_DELAY_MS = 1500
const TAB_IDS = new Set(TABS.map((t) => t.id))
// Live warnings describe this session only; dismissing them must not persist.
const isSessionOnly = (id) => id.startsWith('now-')
const EMPTY_LIVE = Object.freeze({ context: null, rateLimits: [], unreviewed: [], risky: {} })

let excludes = []
let digest = null
let findings = null
let tab = 'now'
let days = 1
let dismissed = []
let sessionDismissed = []
let gitLogs = {}
let gitSeq = 0
let ai = {}
// The detail view holds an id and is re-resolved on every render, so it follows live data.
// lastDetail is shown (marked resolved) once the finding is gone. Explanations are keyed by
// finding id: digest findings only change on re-index (which drops their explanations), and
// live now-* findings keep theirs while their numbers move. The epochs discard answers that
// arrive after a re-index (digestEpoch) or /clear (sessionEpoch).
let detailId = null
let lastDetail = null
let explain = {}
let digestEpoch = 0
let sessionEpoch = 0
// AI settings from userConfig, kept current by config.set; usage totals for this session.
let settings = normalizeSettings({})
let aiUsage = { calls: 0, in: 0, out: 0 }
let inflight = new Set()
let saveChain = Promise.resolve()
// Survives the reload an options change triggers (see types/index.d.ts); reset by /clear.
const VIEW = atom({ plugin: 'session-chronicle', key: 'view' }, { tab: 'now', detailId: null, days: 1, aiUsage: { calls: 0, in: 0, out: 0 }, nowExplain: {}, live: { unreviewed: [], risky: {} }, sessionDismissed: [] })
// A restored digest-finding detail waits for the re-index before it is reopened (or dropped).
let pendingDetailId = null
let persistChain = Promise.resolve()
let status = { indexing: false, generatedAt: null, sessions: 0, error: null }
let live = EMPTY_LIVE

export function register(on, options) {
  settings = normalizeSettings(options || {})
  excludes = String(options?.excludeProjects || '').split(/[,:\n]/).map((s) => s.trim()).filter(Boolean)

  on('session.start', async ($, e, next) => {
    await startSession($)
    return next(e)
  })

  // /clear, /resume and /branch end the conversation without a new session.start.
  on('session.end', async ($, e, next) => {
    await resetSession($)
    return next(e)
  })

  // /config (or this pane's model picker) changed one of our fields: use it from the next call.
  on('config.set', async ($, e, next) => onConfigSet($, e, await next(e)))

  on('command.run', { command: 'chronicle' }, async ($, e) => runCommand($, String(e.args || '').trim()))

  on('session.measure', async ($, e, next) => {
    live = { ...live, context: e.context, rateLimits: e.rateLimits || [] }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    onToolCall($, e)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (isReviewer(e.subagentType) && live.unreviewed.length) {
      live = { ...live, unreviewed: [] }
      $.ui.invalidate('ui.render')
      persistView($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const el = $.ui.resolve(e)
    return renderPane(el, viewModel(await $.clock.now()), handlersFor($))
  })
}

function onToolCall($, e) {
  const before = live
  live = trackToolCall(live, e)
  if (live === before) return
  $.ui.invalidate('ui.render')
  persistView($)
}

function onConfigSet($, e, result) {
  const field = settingsField(e.key, $.plugin.name)
  if (field && !result?.deny) {
    settings = mergeSetting(settings, field, result.value)
    $.ui.invalidate('ui.render')
  }
  return result
}

// The conversation is gone: drop everything that described it and rewrite the $.state mirror.
async function resetSession($) {
  live = EMPTY_LIVE
  sessionDismissed = []
  aiUsage = { calls: 0, in: 0, out: 0 }
  ai = {}
  tab = 'now'
  pendingDetailId = null
  closeDetail(true)
  await persistView($)
}

async function startSession($) {
  dismissed = await loadDismissed($)
  const isReload = await restoreView($)
  // After a reload (e.g. a model change) the startup toast would only repeat itself.
  $.clock.after(STARTUP_DELAY_MS, () => refresh($, !isReload))
  await $.command.register({
    name: 'chronicle',
    description: 'Open the usage-analysis sidebar (now | cost | tips | standup | improve | refresh)',
    argumentHint: '[tab|refresh]',
    immediate: true,
  })
}

async function restoreView($) {
  const v = await read($, VIEW)
  if (TAB_IDS.has(v.tab)) tab = v.tab
  if ([1, 3, 7].includes(v.days)) days = v.days
  aiUsage = v.aiUsage || aiUsage
  explain = { ...explain, ...(v.nowExplain || {}) }
  sessionDismissed = Array.isArray(v.sessionDismissed) ? v.sessionDismissed : []
  if (v.live) live = { ...live, unreviewed: v.live.unreviewed || [], risky: v.live.risky || {} }
  restoreDetail(v.detailId)
  return Boolean(v.detailId || v.aiUsage?.calls || v.tab !== 'now')
}

// Reopen a restored detail only if its finding still exists; digest ones wait for the re-index.
function restoreDetail(id) {
  if (!id) return
  if (!isSessionOnly(id)) {
    pendingDetailId = id
    return
  }
  const current = buildNow(live).find((f) => f.id === id)
  detailId = current ? id : null
  lastDetail = current || null
}

// Mirror the view into $.state after each change; never called from ui.render, never throws.
function viewSnapshot() {
  const nowExplain = Object.fromEntries(Object.entries(explain)
    .filter(([id, v]) => isSessionOnly(id) && v?.text)
    .map(([id, v]) => [id, { text: v.text, model: v.model, ...(v.tokens ? { tokens: v.tokens } : {}) }]))
  return { tab, detailId: detailId || pendingDetailId, days, aiUsage, nowExplain, live: { unreviewed: live.unreviewed, risky: live.risky }, sessionDismissed }
}

// Writes are chained and each one snapshots the view when it runs, so an older snapshot can
// never land after a newer one.
function persistView($) {
  persistChain = persistChain.then(() => writeView($))
  return persistChain
}

async function writeView($) {
  try {
    await update($, VIEW, () => viewSnapshot())
  } catch {
    // Losing the mirror only matters on the next reload; the pane keeps working.
  }
}

async function runCommand($, arg) {
  // Indexing can take minutes; never hold the command hook on it.
  if (arg === 'refresh') refresh($, false)
  else if (TAB_IDS.has(arg)) {
    tab = arg
    closeDetail(false)
  }
  if (tab === 'standup') loadGitLogs($)
  await persistView($)
  await $.ui.open({ id: PANE, title: 'Chronicle', focus: true, closeOnEscape: true })
  $.ui.invalidate('ui.render')
  const unknown = arg && arg !== 'refresh' && !TAB_IDS.has(arg)
  return unknown ? { text: `不明なタブ "${arg}"。now | cost | tips | standup | improve | refresh` } : {}
}

// Digest-derived findings change only when the digest does, so compute them once.
function digestFindings() {
  if (!digest) return { cost: [], tips: [], improve: [] }
  if (!findings) findings = { cost: buildCost(digest), tips: buildTips(digest), improve: buildImprove(digest) }
  return findings
}

// nowMs comes from $.clock.now() so the standup window follows the engine's (and tests') clock.
function viewModel(nowMs) {
  const lists = { now: buildNow(live), ...digestFindings() }
  const hidden = [...dismissed, ...sessionDismissed]
  const ranked = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, rankFindings(v, hidden)]))
  const detail = resolveDetail(lists)
  return { tab, days, status, ai, settings, aiUsage, detail, explain: detail ? explain[detail.id] : null, lists: ranked, standup: digest ? buildStandup(digest, days, nowMs, gitLogs) : [] }
}

function resolveDetail(lists) {
  if (!detailId) return null
  const current = Object.values(lists).flat().find((f) => f.id === detailId)
  if (current) lastDetail = current
  return lastDetail && { ...lastDetail, isResolved: !current, copyText: copyText(lastDetail) }
}

function closeDetail(dropExplanations) {
  detailId = null
  lastDetail = null
  // The user moved on: a detail waiting to be restored after a reload must not reopen.
  pendingDetailId = null
  if (dropExplanations) {
    explain = {}
    sessionEpoch += 1
  }
}

function handlersFor($) {
  return {
    onTab: (id) => {
      tab = id
      closeDetail(false)
      if (id === 'standup') loadGitLogs($)
      $.ui.invalidate('ui.render')
      persistView($)
    },
    onDays: (d) => {
      days = d
      gitLogs = {}
      ai = { ...ai, standup: undefined }
      loadGitLogs($)
      $.ui.invalidate('ui.render')
      persistView($)
    },
    onRefresh: () => refresh($, false),
    onDismiss: (f) => dismiss($, f.id),
    onAsk: (f) => openDetail($, f),
    onBack: () => {
      closeDetail(false)
      $.ui.invalidate('ui.render')
      persistView($)
    },
    onExplainAgain: (f) => explainFinding($, f, { force: true, allowCall: true }),
    onSetting: (field, value) => setSetting($, field, value),
    onCopy: (text, press) => copyPrompt($, text, press),
    onApply: (f) => applyViaClaude($, f),
    onAi: (id) => summarize($, id),
  }
}

async function refresh($, isStartup) {
  if (status.indexing) return
  status = { ...status, indexing: true, error: null }
  $.ui.invalidate('ui.render')
  try {
    const home = await $.env.get('HOME')
    if (!home) throw new Error('HOME が未設定のため集計先を決められません')
    const out = home + '/.claude/chronicle'
    const argv = ['python3', $.plugin.root + '/indexer/chronicle_index.py', '--out-dir', out, ...excludes.map((x) => '--exclude=' + x)]
    const run = await $.process.run(argv, { timeoutMs: INDEX_TIMEOUT_MS })
    // The last lines of a traceback name the actual exception.
    if (run.exitCode !== 0) throw new Error((run.stdout + run.stderr).trim().slice(-ERROR_CHARS) || 'exit ' + run.exitCode)
    const raw = await $.fs.read(out + '/digest.json')
    digest = JSON.parse(raw)
    findings = null
    ai = {}
    explain = Object.fromEntries(Object.entries(explain).filter(([id]) => isSessionOnly(id)))
    digestEpoch += 1
    status = { indexing: false, generatedAt: digest.generatedAt, sessions: digest.sessions.length, error: new TextEncoder().encode(raw).length > MAX_DIGEST_BYTES ? 'digest.json が 3.5MiB を超えました（上限 4MiB）' : null }
    if (tab === 'standup') loadGitLogs($)
    adoptPendingDetail($)
    // An open detail view now shows re-indexed numbers; explain them afresh.
    const open = resolveDetail({ now: buildNow(live), ...digestFindings() })
    if (open && !open.isResolved) explainFinding($, open, { force: false, allowCall: autoCallAllowed() })
    if (isStartup) await announce($)
  } catch (err) {
    status = { ...status, indexing: false, error: String(err?.message || err).slice(-ERROR_CHARS) }
  }
  $.ui.invalidate('ui.render')
}

function adoptPendingDetail($) {
  if (!pendingDetailId) return
  const found = Object.values(digestFindings()).flat().find((f) => f.id === pendingDetailId)
  if (found && !detailId) {
    detailId = found.id
    lastDetail = found
  }
  pendingDetailId = null
  persistView($)
}

async function announce($) {
  const model = viewModel(await $.clock.now())
  const high = ['cost', 'improve'].reduce((n, k) => n + model.lists[k].filter((f) => f.severity === 'high').length, 0)
  if (high) $.ui.toast(`重要な提案 ${high} 件 — /chronicle で確認`)
}

async function loadDismissed($) {
  const saved = await $.store.get('dismissed')
  return Array.isArray(saved) ? saved.filter((x) => typeof x === 'string') : []
}

async function dismiss($, id) {
  if (isSessionOnly(id)) {
    sessionDismissed = [...new Set([...sessionDismissed, id])]
    $.ui.invalidate('ui.render')
    await persistView($)
    return
  }
  dismissed = [...new Set([...dismissed, id])]
  $.ui.invalidate('ui.render')
  // Re-read right before writing: another session (or a reload) may have saved more.
  const merged = [...new Set([...(await loadDismissed($)), ...dismissed])]
  dismissed = merged
  await $.store.set('dismissed', merged)
}

async function loadGitLogs($) {
  if (!digest) return
  const mine = ++gitSeq
  const d = days
  const rows = buildStandup(digest, d, await $.clock.now()).slice(0, MAX_GIT_PROJECTS).filter((r) => r.project.startsWith('/'))
  const results = await Promise.all(rows.map((row) => gitLog($, row.project, d)))
  if (mine !== gitSeq) return
  gitLogs = Object.fromEntries(rows.map((row, i) => [row.project, results[i]]).filter(([, lines]) => lines.length))
  $.ui.invalidate('ui.render')
}

async function gitLog($, project, d) {
  try {
    const argv = [...GIT_SAFE, '-C', project, 'log', '--no-show-signature', '--no-ext-diff', '--no-textconv', `--since=${d} days ago`, '--pretty=%s', '-n', '10']
    const r = await $.process.run(argv, { timeoutMs: GIT_TIMEOUT_MS })
    return r.exitCode === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : []
  } catch {
    // Not a git repository, git missing or timed out: the standup shows no commits.
    return []
  }
}

// 詳しく: show the finding in the pane itself; nothing is sent to the main conversation.
function openDetail($, f) {
  detailId = f.id
  lastDetail = f
  $.ui.invalidate('ui.render')
  persistView($)
  explainFinding($, f, { force: false, allowCall: autoCallAllowed() })
}

// Credit-billed models only run on an explicit press, whatever autoExplain says.
function autoCallAllowed() {
  return settings.autoExplain && !CREDIT_MODELS.has(settings.model)
}

// Digest findings are cached in $.store by content + model + effort, so reopening one in a
// later session costs no tokens; live now-* findings are kept in $.state for the session.
async function explainFinding($, f, { force, allowCall }) {
  const key = f.id
  // Marked before any await, so a second press or a re-index cannot start a duplicate call.
  if (inflight.has(key) || (explain[key]?.text && !force)) return
  inflight.add(key)
  let retry = false
  try {
    retry = await explainOnce($, f, key, force, allowCall)
  } finally {
    inflight.delete(key)
  }
  // A re-index landed while we waited: explain the finding as it is now. An unchanged finding
  // hits the cache the stale answer was just saved to, so this costs no tokens.
  const current = retry && detailId === key ? Object.values(digestFindings()).flat().find((x) => x.id === key) : null
  if (current) await explainFinding($, current, { force: false, allowCall })
}

async function explainOnce($, f, key, force, allowCall) {
  const used = settings
  const payload = shareableFinding(f)
  const storeKey = isSessionOnly(key) || !used.cacheExplanations ? null : explainCacheKey(payload, used, excludes)
  const stored = storeKey && !force ? (await loadExplainCache($))[storeKey] : null
  if (stored) {
    explain = { ...explain, [key]: { text: stripLinks(stored.text), model: stored.model, isCached: true } }
    $.ui.invalidate('ui.render')
    return
  }
  if (!allowCall) return
  const epochs = [digestEpoch, sessionEpoch]
  explain = { ...explain, [key]: { loading: true, model: used.model } }
  $.ui.invalidate('ui.render')
  const result = await askModel($, used, EXPLAIN_SYSTEM, { instruction: 'data の指摘を解説する', data: payload }, maxTokensFor(used))
  if (epochs[1] !== sessionEpoch) return false
  // The answer matches the content it was asked about, so it is cached even if a re-index won.
  if (storeKey && result.text) await saveExplain($, storeKey, { text: result.text, model: used.model, at: await $.clock.now() })
  if (!isSessionOnly(key) && epochs[0] !== digestEpoch) return true
  explain = { ...explain, [key]: result }
  $.ui.invalidate('ui.render')
  await persistView($)
  return false
}

// One model call with the given settings snapshot; records usage and never throws.
async function askModel($, used, system, input, maxTokens) {
  try {
    const r = await $.model.complete({ model: used.model, effort: used.effort, system, prompt: JSON.stringify(input), maxTokens, timeoutMs: AI_TIMEOUT_MS })
    if (!r.isAnswered) return { error: r.reason || 'no answer', model: used.model }
    aiUsage = addUsage(aiUsage, r.usage)
    return { text: stripLinks(r.text), model: used.model, tokens: tokensOf(r.usage) }
  } catch (err) {
    return { error: String(err?.message || err).slice(-ERROR_CHARS), model: used.model }
  }
}

// Cache I/O never blocks an explanation: a failed read is a miss, a failed write is dropped.
async function loadExplainCache($) {
  try {
    const saved = await $.store.get('explainCache')
    if (!saved || typeof saved !== 'object') return {}
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => isCacheEntry(v)))
  } catch {
    return {}
  }
}

// Writes are chained so two answers finishing together do not overwrite each other.
function saveExplain($, storeKey, entry) {
  saveChain = saveChain.then(() => writeExplain($, storeKey, entry))
  return saveChain
}

async function writeExplain($, storeKey, entry) {
  try {
    // Re-read before writing: another session may have cached answers too.
    const merged = pruneCache({ ...(await loadExplainCache($)), [storeKey]: entry }, entry.at)
    await $.store.set('explainCache', merged)
  } catch {
    // The cache is an optimisation; the answer is already on screen.
  }
}

// Saves to this plugin's /config row; the engine then reloads the plugin with the new options,
// and restoreView brings the pane back as it was.
async function setSetting($, field, value) {
  try {
    const rows = await $.config.list()
    const row = rows.find((r) => settingsField(r.key, $.plugin.name) === field)
    const r = await $.config.set({ key: row ? row.key : $.plugin.name + '.' + field, value })
    if (r?.deny) {
      $.ui.toast('設定を変更できませんでした: ' + r.deny)
      return
    }
  } catch (err) {
    $.ui.toast('設定を変更できませんでした: ' + String(err?.message || err).slice(-ERROR_CHARS))
    return
  }
  settings = mergeSetting(settings, field, value)
  if (field === 'aiModel' && CREDIT_MODELS.has(value)) $.ui.toast(`${value} は usage credits を消費します。解説は g を押したときだけ生成します`)
  $.ui.invalidate('ui.render')
}

async function copyPrompt($, text, press) {
  const r = await $.ui.copy(press?.surface ? { text, surface: press.surface } : { text })
  $.ui.toast(r.isCopied ? 'プロンプトをコピーしました' : 'コピーできませんでした: ' + (r.reason || '不明'))
}

async function applyViaClaude($, f) {
  closeDetail(false)
  await persistView($)
  await $.ui.close({ id: PANE })
  $.prompt.submit({ text: f.applyPrompt })
}

async function summarize($, id) {
  if (ai[id]?.loading) return
  ai = { ...ai, [id]: { loading: true } }
  $.ui.invalidate('ui.render')
  const data = aiPayload(id, await $.clock.now())
  ai = { ...ai, [id]: await askModel($, settings, SUMMARY_SYSTEM, { instruction: 'data を分析して提案を返す', data }, maxTokensFor(settings)) }
  $.ui.invalidate('ui.render')
  await persistView($)
}

// What leaves the machine: findings and counts, project basenames only.
function aiPayload(id, nowMs) {
  const model = viewModel(nowMs)
  if (id === 'standup') {
    return {
      tab: id, days,
      projects: model.standup.map((r) => ({
        project: r.project.split('/').pop(),
        titles: r.sessions.filter((s) => !s.fromPrompt).map((s) => s.title).slice(-6),
        recap: r.sessions.map((s) => s.away).filter(Boolean).slice(-2),
        commits: r.commits.slice(0, 10),
      })),
    }
  }
  return { tab: id, findings: model.lists[id].map(shareableFinding) }
}

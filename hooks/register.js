// ccmod-chronicle: a sidebar that analyzes how you use Claude Code.
// Heavy lifting (reading ~800MB of transcripts) runs in indexer/chronicle_index.py
// via $.process.run; this module renders the digest plus live session signals.

import { buildNow, buildCost, buildImprove, buildStandup, rankFindings, isReviewer, riskyCommands, trackToolCall } from './rules.js'
import { makeCtx, resolveLang, ruleConfig } from './i18n.js'
import { buildTips } from './catalog.js'
import { renderPane, TABS } from './view.js'
import { copyText, isShareableLine, shareableFinding, stripLinks } from './privacy.js'
import { atom, read, update } from 'claude-code'
import { currentValues, listEntries, parseSetting } from './settings-spec.js'
import { addUsage, CREDIT_MODELS, LIVE_FIELDS, explainCacheKey, isCacheEntry, maxTokensFor, mergeSetting, tokensOf, normalizeSettings, pruneCache, settingsField, systemPrompt } from './ai-config.js'

const PANE = 'ccmod-chronicle'
const INDEX_TIMEOUT_MS = 10 * 60 * 1000
const GIT_TIMEOUT_MS = 5000
const MAX_GIT_PROJECTS = 8
const MAX_DIGEST_BYTES = 3.5 * 1024 * 1024
const ERROR_CHARS = 200
// Repo-local config could make `git log` launch programs (gpg, fsmonitor); turn those off.
const GIT_SAFE = ['git', '-c', 'log.showSignature=false', '-c', 'core.fsmonitor=false', '-c', 'diff.external=']
const AI_TIMEOUT_MS = 60000
const STARTUP_DELAY_MS = 1500
// Mods need 2.1.287; userConfig `options` pickers need 2.1.271. Tested with 2.1.288.
const MIN_VERSION = '2.1.287'
// `python3` first; Windows installs often only have `python`.
const PYTHONS = ['python3', 'python']
const WINDOWS_COMMAND_NOT_FOUND = 9009
const DEFAULT_CLEANUP_DAYS = 30
const MAX_RETENTION_DAYS = 3650
const ABSOLUTE_PATH = /^([A-Za-z]:[\\/]|\/)/
const TAB_IDS = new Set(TABS.map((t) => t.id))
// Live warnings describe this session only; dismissing them must not persist.
const isSessionOnly = (id) => id.startsWith('now-')
const EMPTY_LIVE = Object.freeze({ context: null, rateLimits: [], unreviewed: [], risky: {} })

let excludes = []
// Rule settings and the pane's language; ctx is rebuilt when the language is known.
let ruleCfg = ruleConfig()
let risky = riskyCommands(ruleCfg)
let ctx = makeCtx('en', ruleCfg)
let claudeSettings = {}
// The options this activation was loaded with, shown and edited in the Settings tab.
let rawOptions = currentValues()
let retentionDays = 0
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
const VIEW = atom({ plugin: 'ccmod-chronicle', key: 'view' }, { tab: 'now', detailId: null, days: 1, aiUsage: { calls: 0, in: 0, out: 0 }, nowExplain: {}, live: { unreviewed: [], risky: {} }, sessionDismissed: [] })
// A restored digest-finding detail waits for the re-index before it is reopened (or dropped).
let pendingDetailId = null
let persistChain = Promise.resolve()
let status = { indexing: false, generatedAt: null, sessions: 0, error: null }
// Kept apart from status.error, which every index run resets.
let versionWarning = null
let live = EMPTY_LIVE

// The options this activation runs with (an options change reloads the mod and calls this again).
function loadOptions(options = {}) {
  settings = normalizeSettings(options)
  rawOptions = currentValues(options)
  ruleCfg = ruleConfig(options)
  risky = riskyCommands(ruleCfg)
  ctx = makeCtx('en', ruleCfg)
  retentionDays = clampDays(options.retentionDays)
  // Comma or newline only: a ':' would split Windows paths such as C:\\Clients.
  excludes = listEntries(options.excludeProjects)
}

export function register(on, options) {
  loadOptions(options || {})

  on('session.start', async ($, e, next) => {
    await startSession($)
    return next(e)
  }).catch(passThrough)

  // /clear, /resume and /branch end the conversation without a new session.start.
  on('session.end', async ($, e, next) => {
    await resetSession($)
    return next(e)
  }).catch(passThrough)

  // /config (or this pane's model picker) changed one of our fields: use it from the next call.
  on('config.set', async ($, e, next) => onConfigSet($, e, await next(e))).catch(passThrough)

  on('command.run', { command: 'chronicle' }, async ($, e) => runCommand($, String(e.args || '').trim()))

  on('session.measure', async ($, e, next) => {
    live = { ...live, context: e.context, rateLimits: e.rateLimits || [] }
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(passThrough)

  on('tool.call', async ($, e, next) => {
    onToolCall($, e)
    return next(e)
  }).catch(passThrough)

  on('agent.spawn', async ($, e, next) => {
    if (isReviewer(e.subagentType, ruleCfg.reviewers) && live.unreviewed.length) {
      live = { ...live, unreviewed: [] }
      $.ui.invalidate('ui.render')
      persistView($)
    }
    return next(e)
  }).catch(passThrough)

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const el = $.ui.resolve(e)
    return renderPane(el, viewModel(await $.clock.now()), handlersFor($))
  })
}

// These hooks only observe: if one fails, the call it watched goes ahead untouched. In a catch
// handler next is replay-safe (an earlier call is not run again), so next(e) is always right.
function passThrough($, e, next) {
  return next(e)
}

function onToolCall($, e) {
  const before = live
  live = trackToolCall(live, e, risky)
  if (live === before) return
  $.ui.invalidate('ui.render')
  persistView($)
}

function onConfigSet($, e, result) {
  const field = settingsField(e.key, $.plugin.name)
  if (field && !result?.deny) {
    applySetting(field, result.value)
    $.ui.invalidate('ui.render')
  }
  return result
}

// Show a saved value at once. AI and language settings also apply in place; the rest take
// effect when the engine reloads the mod with the new options.
function applySetting(field, value) {
  rawOptions = { ...rawOptions, [field]: value }
  if (!LIVE_FIELDS.has(field)) return
  settings = mergeSetting(settings, field, value)
  if (field === 'language') applyLanguage()
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
  claudeSettings = await readClaudeSettings($)
  applyLanguage()
  dismissed = await loadDismissed($)
  await checkVersion($)
  const isReload = await restoreView($)
  // After a reload (e.g. a model change) the startup toast would only repeat itself.
  $.clock.after(STARTUP_DELAY_MS, () => refresh($, !isReload))
  await $.command.register({
    name: 'chronicle',
    description: 'Open the usage-analysis sidebar (now | cost | tips | standup | improve | settings | refresh | purge)',
    argumentHint: '[tab|settings|refresh|purge]',
    immediate: true,
  })
}

async function readClaudeSettings($) {
  try {
    const s = await $.settings.read()
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

// The pane follows the `language` option, or Claude Code's own `language` setting on auto.
function applyLanguage() {
  ctx = makeCtx(resolveLang(settings.language, claudeSettings.language), ruleCfg)
  findings = null
}

const versionParts = (v) => String(v).split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0)
const isOlder = (a, b) => {
  const [x, y] = [versionParts(a), versionParts(b)]
  const i = x.findIndex((n, k) => n !== y[k])
  return i >= 0 && x[i] < y[i]
}

async function checkVersion($) {
  try {
    const { version } = await $.session.version()
    versionWarning = isOlder(version, MIN_VERSION) ? { v: version, min: MIN_VERSION } : null
  } catch {
    // Unknown version: carry on; a missing API would have failed to load the mod anyway.
  }
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
  const current = buildNow(live, ctx).find((f) => f.id === id)
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
  if (arg === 'purge') return { text: await purgeAll($) }
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
  if (unknown) return { text: ctx.t('unknownTab', { arg }) }
  return (await drawsPane($)) ? {} : { text: textSummary() }
}

// The pane shows in the terminal and the desktop app only (not VS Code, mobile or -p).
async function drawsPane($) {
  try {
    return (await $.session.surfaces()).some((s) => s === 'terminal' || s === 'desktop')
  } catch {
    return true
  }
}

function textSummary() {
  const lists = { now: buildNow(live, ctx), ...digestFindings() }
  const top = rankFindings(Object.values(lists).flat(), [...dismissed, ...sessionDismissed]).slice(0, 5)
  return ctx.t('noPane', { lines: top.map((f) => `- ${f.title} (${f.evidence})`).join('\n') || '- ' + ctx.t('emptyList') })
}

// Digest-derived findings change only when the digest does, so compute them once.
function digestFindings() {
  if (!digest) return { cost: [], tips: [], improve: [] }
  if (!findings) findings = { cost: buildCost(digest, ctx), tips: buildTips(digest, ctx), improve: buildImprove(digest, ctx) }
  return findings
}

// nowMs comes from $.clock.now() so the standup window follows the engine's (and tests') clock.
function viewModel(nowMs) {
  const lists = { now: buildNow(live, ctx), ...digestFindings() }
  const hidden = [...dismissed, ...sessionDismissed]
  const ranked = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, rankFindings(v, hidden)]))
  const detail = resolveDetail(lists)
  return { t: ctx.t, tab, days, status, versionWarning, config: rawOptions, ai, settings, aiUsage, detail, explain: detail ? explain[detail.id] : null, lists: ranked, standup: digest ? buildStandup(digest, days, nowMs, gitLogs, ctx) : [] }
}

function resolveDetail(lists) {
  if (!detailId) return null
  const current = Object.values(lists).flat().find((f) => f.id === detailId)
  if (current) lastDetail = current
  return lastDetail && { ...lastDetail, isResolved: !current, copyText: copyText(lastDetail, ctx.t) }
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
    const paths = await indexPaths($)
    const run = await runIndexer($, indexerArgs(paths))
    // The last lines of a traceback name the actual exception.
    if (run.exitCode !== 0) throw new Error((run.stdout + run.stderr).trim().slice(-ERROR_CHARS) || 'exit ' + run.exitCode)
    const raw = await $.fs.read(paths.outDir + '/digest.json')
    adoptDigest($, raw)
    if (isStartup) await announce($)
  } catch (err) {
    status = { ...status, indexing: false, error: String(err?.message || err).slice(-ERROR_CHARS) }
  }
  $.ui.invalidate('ui.render')
}

function adoptDigest($, raw) {
  digest = JSON.parse(raw)
  findings = null
  ai = {}
  explain = Object.fromEntries(Object.entries(explain).filter(([id]) => isSessionOnly(id)))
  digestEpoch += 1
  const isBig = new TextEncoder().encode(raw).length > MAX_DIGEST_BYTES
  status = { indexing: false, generatedAt: digest.generatedAt, sessions: digest.sessions.length, error: isBig ? ctx.t('digestBig') : null }
  if (tab === 'standup') loadGitLogs($)
  adoptPendingDetail($)
  // An open detail view now shows re-indexed numbers; explain them afresh.
  const open = resolveDetail({ now: buildNow(live, ctx), ...digestFindings() })
  if (open && !open.isResolved) explainFinding($, open, { force: false, allowCall: autoCallAllowed() })
}

// Where Claude Code keeps its files: CLAUDE_CONFIG_DIR when set, else ~/.claude.
async function indexPaths($) {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  if (!configDir && !home) throw new Error(ctx.t('noHome'))
  const claudeDir = configDir || home + '/.claude'
  return { claudeDir, outDir: claudeDir + '/chronicle' }
}

// Summaries are kept as long as Claude Code keeps transcripts, unless retentionDays says otherwise.
function retention() {
  if (retentionDays > 0) return retentionDays
  return clampDays(claudeSettings.cleanupPeriodDays) || DEFAULT_CLEANUP_DAYS
}

// Whole days within 0..MAX_RETENTION_DAYS, so the indexer never gets a fraction or an overflow.
function clampDays(value) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_RETENTION_DAYS) : 0
}

// One argv element per value, so a value starting with '-' can never become an option.
function indexerArgs({ claudeDir, outDir }) {
  return [
    '--claude-dir=' + claudeDir,
    '--out-dir=' + outDir,
    '--retention-days=' + retention(),
    ...excludes.map((x) => '--exclude=' + x),
    ...ruleCfg.extraRisky.map((x) => '--risky=' + x),
    ...ruleCfg.memoryCues.map((x) => '--memory-cue=' + x),
  ]
}

async function runIndexer($, args) {
  const script = $.plugin.root + '/indexer/chronicle_index.py'
  let lastError = null
  for (const python of PYTHONS) {
    try {
      const run = await $.process.run([python, script, ...args], { timeoutMs: INDEX_TIMEOUT_MS })
      if (run.exitCode !== WINDOWS_COMMAND_NOT_FOUND) return run
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error('python3 / python not found')
}

// /chronicle purge: delete the index, the explanation cache, dismissals and the saved view.
async function purgeAll($) {
  // A running index would write the files straight back.
  if (status.indexing) return ctx.t('purgeBusy')
  try {
    const { outDir } = await indexPaths($)
    const run = await runIndexer($, ['--purge', '--out-dir=' + outDir])
    if (run.exitCode !== 0) throw new Error((run.stdout + run.stderr).trim().slice(-ERROR_CHARS))
    await $.store.delete('explainCache')
    await $.store.delete('dismissed')
    dismissed = []
    digest = null
    findings = null
    status = { indexing: false, generatedAt: null, sessions: 0, error: null }
    await resetSession($)
    $.ui.invalidate('ui.render')
    return ctx.t('purged')
  } catch (err) {
    return ctx.t('purgeFailed', { error: String(err?.message || err).slice(-ERROR_CHARS) })
  }
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
  if (high) $.ui.toast(ctx.t('highFindings', { n: high }))
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
  const rows = buildStandup(digest, d, await $.clock.now(), {}, ctx).slice(0, MAX_GIT_PROJECTS).filter((r) => ABSOLUTE_PATH.test(r.project))
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

// Details: show the finding in the pane itself; nothing is sent to the main conversation.
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
  const payload = shareableFinding(f, ctx.t)
  const storeKey = isSessionOnly(key) || !used.cacheExplanations ? null : explainCacheKey(payload, used, excludes, ctx.lang)
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
  const result = await askModel($, used, systemPrompt('explain', ctx.t), { instruction: ctx.t('explainInstruction'), data: payload }, maxTokensFor(used))
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
// and restoreView brings the pane back as it was. Values are checked before anything is written.
async function setSetting($, field, input) {
  const parsed = parseSetting(field, input)
  if (parsed.error) {
    $.ui.toast(ctx.t(parsed.error, parsed.params))
    return
  }
  const value = parsed.value
  try {
    const key = ownConfigKey(await $.config.list(), $.plugin.name, field)
    if (!key) {
      $.ui.toast(ctx.t('settingFailed', { reason: ctx.t('settingAmbiguous') }))
      return
    }
    const r = await $.config.set({ key, value })
    if (r?.deny) {
      $.ui.toast(ctx.t('settingFailed', { reason: r.deny }))
      return
    }
  } catch (err) {
    $.ui.toast(ctx.t('settingFailed', { reason: String(err?.message || err).slice(-ERROR_CHARS) }))
    return
  }
  const lifted = field === 'excludeProjects' ? removedEntries(rawOptions.excludeProjects, value) : 0
  applySetting(field, value)
  const label = ctx.t('cfg_' + field)
  const message = lifted ? ctx.t('exclusionsLifted', { n: lifted })
    : field === 'aiModel' && CREDIT_MODELS.has(value) ? ctx.t('creditWarn', { model: value })
    : ctx.t(LIVE_FIELDS.has(field) ? 'settingSaved' : 'settingSavedReload', { key: label })
  // The save usually reloads the mod; this activation may already be gone, so never let it throw.
  try {
    $.ui.toast(message)
    $.ui.invalidate('ui.render')
  } catch {
    // The reloaded pane draws the new value itself.
  }
}

// This plugin's own /config row for a field. Rows from another plugin with the same name (a fork
// from another marketplace) are skipped; if ours is still ambiguous, nothing is written.
function ownConfigKey(rows, name, field) {
  const mine = rows.filter((r) => settingsField(r.key, name) === field && (!r.provider || r.provider.plugin === name))
  // Two rows of our name (e.g. an installed copy and a --plugin-dir copy) cannot be told apart.
  if (mine.length > 1) return null
  return mine.length === 1 ? mine[0].key : name + '.' + field
}

// How many entries of a comma-separated list a new value drops.
function removedEntries(before, after) {
  const next = new Set(listEntries(after))
  return [...new Set(listEntries(before))].filter((x) => !next.has(x)).length
}

async function copyPrompt($, text, press) {
  const r = await $.ui.copy(press?.surface ? { text, surface: press.surface } : { text })
  $.ui.toast(r.isCopied ? ctx.t('copied') : ctx.t('copyFailed', { reason: r.reason || '?' }))
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
  ai = { ...ai, [id]: await askModel($, settings, systemPrompt('summary', ctx.t), { instruction: ctx.t('summaryInstruction'), data }, maxTokensFor(settings)) }
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
        project: String(r.project).split(/[\\/]/).filter(Boolean).pop(),
        // Free text from transcripts and git: lines that look like paths or URLs stay here.
        titles: r.sessions.filter((s) => !s.fromPrompt).map((s) => s.title).filter(isShareableLine).slice(-6),
        recap: r.sessions.map((s) => s.away).filter(isShareableLine).slice(-2),
        commits: r.commits.filter(isShareableLine).slice(0, 10),
      })),
    }
  }
  return { tab: id, findings: model.lists[id].map((f) => shareableFinding(f, ctx.t)) }
}

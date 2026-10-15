// Findings grounded in what happened in this repository and in what the user already has: commands
// that keep failing, corrections that keep coming back, and their own agents and skills. A pattern
// must recur across sessions, so one bad afternoon does not become advice. Pure functions, no mods
// API; ctx.local carries the working directory, Claude Code's folder and the asset lists (assets.js).

import { fmt, sessionLabel, totals, workSessions } from './rules.js'

export const GROUNDED = Object.freeze({
  frictionFailures: 3,
  minSessions: 2,
  maxFriction: 3,
  repoCorrections: 4,
  maxSources: 5,
})
// Everyday shell utilities fail for generic reasons while exploring (a path that is not there);
// they say nothing a CLAUDE.md line could fix. (The indexer keeps only Bash programs and MCP tools.)
const GENERIC_TOOLS = new Set([
  'Bash', 'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'sed', 'awk', 'sort', 'cut', 'xargs', 'test', 'diff', 'stat', 'file',
  'du', 'df', 'pwd', 'which', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'chmod', 'open', 'sleep', 'kill', 'pkill', 'ps',
])
const REVIEWER_NAME = /review|eye|audit|verif/i
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const lastSegment = (name) => String(name).split(':').pop()

// Sessions of this repository: in a git repository, those started in it or below it; anywhere
// else (a home folder holds every project) only those started in that very folder.
export function repoSessions(digest, cwd, isRepo = false) {
  const root = normalizePath(cwd)
  if (!root) return []
  return workSessions(digest).filter((s) => {
    const p = normalizePath(s.project)
    return p === root || (isRepo && p.startsWith(root + '/'))
  })
}

// Windows paths compare with forward slashes and without letter case.
function normalizePath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:\//.test(s) ? s.toLowerCase() : s
}

// A short stable tag of the repository, so dismissing a finding in one repository leaves others.
function repoTag(cwd) {
  let h = 5381
  for (const c of normalizePath(cwd)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return h.toString(36)
}

const transcript = (local, s) => (local.claudeDir && s.dir ? `${local.claudeDir}/projects/${s.dir}/${s.id}.jsonl` : null)
const sources = (local, sessions) => sessions.slice(-GROUNDED.maxSources).map((s) => transcript(local, s)).filter(Boolean)

export function groundedImprove(digest, ctx) {
  const local = ctx.local || {}
  const sessions = repoSessions(digest, local.cwd, local.isRepo)
  const tag = repoTag(local.cwd)
  return [...frictionFindings(sessions, tag, ctx), ...repoCorrectionFindings(sessions, tag, ctx), ...reviewerSetupFindings(digest, ctx)]
}

function frictionFindings(sessions, tag, { t, doc, local }) {
  const byKey = new Map()
  for (const s of sessions) {
    for (const [key, n] of Object.entries(s.friction || {})) {
      if (GENERIC_TOOLS.has(key) || !(n > 0)) continue
      const row = byKey.get(key) || { key, failures: 0, sessions: [] }
      row.failures += n
      row.sessions.push(s)
      byKey.set(key, row)
    }
  }
  return [...byKey.values()]
    .filter((r) => r.failures >= GROUNDED.frictionFailures && r.sessions.length >= GROUNDED.minSessions)
    .sort((a, b) => b.failures - a.failures)
    .slice(0, GROUNDED.maxFriction)
    .map((r) => ({
      id: `improve-friction-${tag}-${r.key}`, severity: r.failures >= 10 ? 'mid' : 'low', details: r.sessions.map(sessionLabel),
      title: t('frictionTitle', { key: r.key, n: r.failures, sessions: r.sessions.length }),
      // The command name stays on this machine; the model reads "a command".
      sharedTitle: t('frictionTitleShared', { n: r.failures, sessions: r.sessions.length }),
      sharedAction: t('frictionActionShared'),
      evidence: t('frictionEvidence', { dates: r.sessions.slice(-3).map((s) => String(s.end || '').slice(5, 10)).join(', ') }),
      action: t('frictionAction', { key: r.key }),
      doc: doc('memory'),
      applyPrompt: t('frictionApply', { key: r.key, files: sources(local, r.sessions).join('\n') }),
    }))
}

function repoCorrectionFindings(sessions, tag, { t, doc, local }) {
  const hit = sessions.filter((s) => s.corrections > 0)
  const n = sum(hit.map((s) => s.corrections))
  if (n < GROUNDED.repoCorrections || hit.length < GROUNDED.minSessions) return []
  // About one correction a session is ordinary; several in the same sessions is a habit to write down.
  return [{
    id: 'improve-repo-corrections-' + tag, severity: n >= hit.length * 1.5 ? 'mid' : 'low', details: hit.map((s) => `${sessionLabel(s)} · ${s.corrections}`),
    title: t('repoCorrTitle', { n, sessions: hit.length }),
    evidence: t('repoCorrEvidence'),
    action: t('repoCorrAction'),
    doc: doc('memory'),
    applyPrompt: t('repoCorrApply', { files: sources(local, hit).join('\n') }),
  }]
}

// The review checks are off until reviewerAgents names an agent; point at the user's own ones.
function reviewerSetupFindings(digest, { t, doc, cfg, local }) {
  if (cfg.reviewers.length) return []
  const names = (local.agents || []).map((a) => a.name).filter((n) => REVIEWER_NAME.test(n))
  if (!names.length) return []
  return [{
    id: 'improve-setup-reviewers', severity: 'mid', localDetails: true, details: names,
    title: t('setupReviewersTitle', { n: names.length }),
    evidence: names.join(', '),
    action: t('setupReviewersAction', { names: names.join(',') }),
    sharedAction: t('setupReviewersAction', { names: t('theirNames') }),
    doc: doc('sub-agents'),
  }]
}

// Tips about the user's own agents and skills that sat unused in the analysed sessions.
export function ownAssetTips(digest, ctx) {
  const local = ctx.local || {}
  if (!workSessions(digest).length) return []
  const tot = totals(digest)
  const usedAgents = new Set(Object.keys(tot.agents).map(lastSegment))
  const usedSkills = new Set([...Object.keys(tot.skills || {}).map(lastSegment), ...Object.keys(digest?.history?.slash || {}).map((c) => lastSegment(c.slice(1)))])
  const idle = (list, used) => (list || []).map((a) => a.name).filter((n) => !used.has(n))
  return [
    assetTip('tip-own-agents', 'tipOwnAgents', idle(local.agents, usedAgents), (local.agents || []).length, 'sub-agents', ctx),
    assetTip('tip-own-skills', 'tipOwnSkills', idle(local.skills, usedSkills), (local.skills || []).length, 'skills', ctx),
  ].filter(Boolean)
}

function assetTip(id, key, idle, total, slug, { t, doc }) {
  if (!idle.length) return null
  // Names stay on this machine: localDetails sends the AI explanation a count instead.
  return { id, severity: 'low', localDetails: true, details: idle, title: t(key + 'Title', { n: idle.length, total }), evidence: idle.slice(0, 6).join(', ') + (idle.length > 6 ? ` +${fmt(idle.length - 6)}` : ''), action: t(key + 'Concept'), doc: doc(slug) }
}

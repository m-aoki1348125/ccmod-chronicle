// Claude Code features worth knowing, each with a usage check against the digest.
// Doc slugs were taken from https://code.claude.com/docs/llms.txt (2026-10-03); the same slug
// exists under /docs/en/ and /docs/ja/. A check returns null when the tip does not apply, or
// the params for its evidence string when it does.

import { totals } from './rules.js'
import { makeCtx } from './i18n.js'

const slash = (d, cmd) => d?.history?.slash?.[cmd] || 0
const tool = (tot, name) => tot.tools[name] || 0
// null when no permission-mode records exist, so tips don't fire on missing data.
const permRatio = (tot, mode) => {
  const all = Object.values(tot.permModes).reduce((a, b) => a + b, 0)
  return all ? (tot.permModes[mode] || 0) / all : null
}
const agents = (tot) => tool(tot, 'Agent') + tool(tot, 'Task') + tool(tot, 'Workflow')
const prompts = (d) => d.history?.prompts || 0
const redo = (d) => d.history?.correctionPrompts || 0

// Ordered by expected payoff; `key` names the tipXxxTitle / Concept / Evidence strings.
export const CATALOG = [
  {
    id: 'tip-loop', key: 'tipLoop', slug: 'scheduled-tasks',
    check: (d) => ((d.history?.resumePrompts || 0) >= 10 && slash(d, '/loop') < 3 ? { n: d.history.resumePrompts, loop: slash(d, '/loop') } : null),
  },
  {
    id: 'tip-context', key: 'tipContext', slug: 'context-window',
    check: (d, tot) => (slash(d, '/context') === 0 && tot.compactions.length >= 3 ? { n: tot.compactions.length } : null),
  },
  {
    id: 'tip-rewind', key: 'tipRewind', slug: 'checkpointing',
    check: (d) => (slash(d, '/rewind') === 0 && redo(d) >= 5 ? { n: redo(d) } : null),
  },
  {
    id: 'tip-plan-mode', key: 'tipPlan', slug: 'permission-modes',
    check: (d, tot) => {
      const r = permRatio(tot, 'plan')
      return r !== null && r < 0.03 && redo(d) >= 5 ? { pct: Math.round(r * 100), n: redo(d) } : null
    },
  },
  {
    id: 'tip-effort', key: 'tipEffort', slug: 'model-config',
    check: (d) => (slash(d, '/model') >= 30 && slash(d, '/effort') < 10 ? { model: slash(d, '/model'), effort: slash(d, '/effort') } : null),
  },
  {
    id: 'tip-hooks-checks', key: 'tipHooks', slug: 'hooks-guide',
    check: (d, tot) => {
      const r = permRatio(tot, 'auto')
      return r !== null && r >= 0.8 ? { pct: Math.round(r * 100) } : null
    },
  },
  {
    id: 'tip-worktree', key: 'tipWorktree', slug: 'worktrees',
    check: (d, tot) => (tool(tot, 'EnterWorktree') === 0 && agents(tot) >= 30 ? { n: agents(tot) } : null),
  },
  {
    id: 'tip-skills', key: 'tipSkills', slug: 'skills',
    check: (d, tot) => (tool(tot, 'Skill') < 20 && prompts(d) >= 300 ? { n: tool(tot, 'Skill'), prompts: prompts(d) } : null),
  },
  {
    id: 'tip-btw', key: 'tipBtw', slug: 'interactive-mode',
    check: (d) => (slash(d, '/btw') < 5 && prompts(d) >= 300 ? { n: slash(d, '/btw'), prompts: prompts(d) } : null),
  },
  {
    id: 'tip-output-style', key: 'tipStyle', slug: 'output-styles',
    check: (d) => (slash(d, '/output-style') === 0 && prompts(d) >= 500 ? {} : null),
  },
]

export const MAX_TIPS = 5

export function buildTips(digest, ctx = makeCtx(), catalog = CATALOG, limit = MAX_TIPS) {
  const { t, doc } = ctx
  const tot = totals(digest)
  const out = []
  for (const item of catalog) {
    let hit = null
    try {
      hit = item.check(digest || {}, tot)
    } catch {
      // A rule that cannot read this digest simply does not apply.
      hit = null
    }
    if (hit) out.push({ id: item.id, severity: 'low', title: t(item.key + 'Title'), evidence: t(item.key + 'Evidence', hit), action: t(item.key + 'Concept'), doc: doc(item.slug), details: [] })
  }
  return out.slice(0, limit)
}

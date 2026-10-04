// Claude Code features worth knowing, each with a usage check against the digest.
// Doc slugs were taken from https://code.claude.com/docs/llms.txt (2026-10-03).
// A check returns null when the tip does not apply, or { evidence } when it does.

import { totals } from './rules.js'

const DOC = 'https://code.claude.com/docs/ja/'
const slash = (d, cmd) => d?.history?.slash?.[cmd] || 0
const tool = (t, name) => t.tools[name] || 0
// null when no permission-mode records exist, so tips don't fire on missing data.
const permRatio = (t, mode) => {
  const all = Object.values(t.permModes).reduce((a, b) => a + b, 0)
  return all ? (t.permModes[mode] || 0) / all : null
}
const agents = (t) => tool(t, 'Agent') + tool(t, 'Task') + tool(t, 'Workflow')

export const CATALOG = [
  {
    id: 'tip-loop', title: '/loop・routines で定期的な確認を任せる',
    concept: '「状況を確認して」「再開」を手で打つ代わりに、間隔を決めて自動で回す。',
    doc: DOC + 'scheduled-tasks',
    check: (d) => ((d.history?.resumePrompts || 0) >= 10 && slash(d, '/loop') < 3
      ? { evidence: `再開・続行の短いプロンプト ${d.history.resumePrompts} 件、/loop ${slash(d, '/loop')} 回` } : null),
  },
  {
    id: 'tip-context', title: '/context で何がコンテキストを占めているかを見る',
    concept: 'CLAUDE.md、MCP ツール、会話のどれが枠を使っているかを確かめてから削る。',
    doc: DOC + 'context-window',
    check: (d, t) => (slash(d, '/context') === 0 && t.compactions.length >= 3
      ? { evidence: `/context の使用 0 回、compaction ${t.compactions.length} 回` } : null),
  },
  {
    id: 'tip-rewind', title: '/rewind で会話とコードを巻き戻す',
    concept: 'チェックポイントから会話と編集を戻し、別の方針でやり直す。誤った方向の作業を引きずらない。',
    doc: DOC + 'checkpointing',
    check: (d) => (slash(d, '/rewind') === 0 && (d.history?.correctionPrompts || 0) >= 5
      ? { evidence: `/rewind の使用 0 回、やり直しの依頼 ${d.history.correctionPrompts} 件` } : null),
  },
  {
    id: 'tip-plan-mode', title: 'Plan mode で先に計画を合意する',
    concept: '大きな変更の前に読み取り専用で計画を立て、承認してから実装に入る。',
    doc: DOC + 'permission-modes',
    check: (d, t) => (permRatio(t, 'plan') !== null && permRatio(t, 'plan') < 0.03 && (d.history?.correctionPrompts || 0) >= 5
      ? { evidence: `plan mode は権限モード記録の ${Math.round(permRatio(t, 'plan') * 100)}%、やり直しの依頼 ${d.history.correctionPrompts} 件` } : null),
  },
  {
    id: 'tip-effort', title: 'effort をタスクごとに切り替える',
    concept: 'モデルを替える代わりに effort（low〜max）で品質とコストを調整する。',
    doc: DOC + 'model-config',
    check: (d) => (slash(d, '/model') >= 30 && slash(d, '/effort') < 10
      ? { evidence: `/model ${slash(d, '/model')} 回、/effort ${slash(d, '/effort')} 回` } : null),
  },
  {
    id: 'tip-hooks-checks', title: '決まったチェックは hooks に任せる',
    concept: 'lint、型検査、テストは PostToolUse や Stop の hook で毎回実行し、意志に頼らない。',
    doc: DOC + 'hooks-guide',
    check: (d, t) => (permRatio(t, 'auto') !== null && permRatio(t, 'auto') >= 0.8
      ? { evidence: `auto mode が権限モード記録の ${Math.round(permRatio(t, 'auto') * 100)}%` } : null),
  },
  {
    id: 'tip-worktree', title: 'git worktree で並列作業を分離する',
    concept: '同じリポジトリで複数のセッションを動かすとき、作業ツリーを分けて衝突を防ぐ。',
    doc: DOC + 'worktrees',
    check: (d, t) => (tool(t, 'EnterWorktree') === 0 && agents(t) >= 30
      ? { evidence: `Agent / Workflow ${agents(t)} 回、EnterWorktree 0 回` } : null),
  },
  {
    id: 'tip-skills', title: '繰り返す指示を skill にする',
    concept: '毎回貼り付けている手順や基準を SKILL.md にまとめ、必要なときだけ読み込ませる。',
    doc: DOC + 'skills',
    check: (d, t) => {
      const used = tool(t, 'Skill')
      return used < 20 && (d.history?.prompts || 0) >= 300 ? { evidence: `Skill の呼び出し ${used} 回 / プロンプト ${d.history.prompts} 件` } : null
    },
  },
  {
    id: 'tip-btw', title: '/btw で本線を汚さずに質問する',
    concept: '作業の途中の横道の質問を、メインの会話履歴に残さずに聞ける。',
    doc: DOC + 'interactive-mode',
    check: (d) => (slash(d, '/btw') < 5 && (d.history?.prompts || 0) >= 300
      ? { evidence: `/btw の使用 ${slash(d, '/btw')} 回 / プロンプト ${d.history.prompts} 件` } : null),
  },
  {
    id: 'tip-output-style', title: 'output style で応答の形式を固定する',
    concept: '毎回「簡潔に」「日本語で」と頼む代わりに、出力スタイルとして定義する。',
    doc: DOC + 'output-styles',
    check: (d) => (slash(d, '/output-style') === 0 && (d.history?.prompts || 0) >= 500
      ? { evidence: '/output-style の使用 0 回' } : null),
  },
]

// The catalog is ordered by expected payoff; the pane shows the first few that apply.
export const MAX_TIPS = 5

export function buildTips(digest, catalog = CATALOG, limit = MAX_TIPS) {
  const t = totals(digest)
  const out = []
  for (const item of catalog) {
    let hit = null
    try {
      hit = item.check(digest || {}, t)
    } catch {
      hit = null
    }
    if (hit) out.push({ id: item.id, severity: 'low', title: item.title, evidence: hit.evidence, action: item.concept, doc: item.doc })
  }
  return out.slice(0, limit)
}

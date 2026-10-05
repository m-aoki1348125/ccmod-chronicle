# session-chronicle

A Claude Code mod that opens a sidebar analyzing how you use Claude Code, in the
spirit of GitHub Copilot CLI's `/chronicle`. Tested with Claude Code 2.1.288.

| Tab | What it shows |
|---|---|
| Now | Live warnings for this session: context fill, plan-limit windows, unreviewed code edits, risky commands |
| Cost | Late compactions, the few sessions that dominate cache reads, model mix, credit errors, very long turns |
| Tips | Up to 5 Claude Code features you underuse, with the evidence and a docs link |
| Standup | Work per project over the last 1 / 3 / 7 days: titles, recaps, git commits, files |
| Improve | Gaps between your CLAUDE.md rules and actual behavior; "適用を依頼" asks Claude to propose a diff |

## How it works

- `indexer/chronicle_index.py` (Python stdlib only) incrementally summarizes
  `~/.claude/projects/**/*.jsonl` and `~/.claude/history.jsonl` into
  `~/.claude/chronicle/digest.json` (0600). Summaries survive transcript cleanup; usage is
  de-duplicated by message id. Excluded projects are matched after resolving symlinks,
  `..` and case, and sessions with an unknown directory are skipped when any exclude is set.
- The mod runs the indexer at session start and on **再集計 (r)**, then renders rule-based
  findings (`hooks/rules.js`, `hooks/catalog.js`). Live signals come from
  `session.measure`, `tool.call` and `agent.spawn`.
- **AIで要約** (button only) sends findings and counts to `sonnet` via `$.model.complete`.
  Raw prompt text and full project paths are never sent.
- **詳しく** opens the finding inside the sidebar: the rule's breakdown (dates, counts,
  per-model/per-session rows), the recommended action, a copyable prompt (`c`), and a
  sonnet explanation generated on that press and cached until the next re-index (`g`
  regenerates, `b` goes back). Nothing is sent to the main conversation.
- The mod never writes your files. "適用を依頼" is the one button that submits a prompt
  to the conversation, so Claude proposes a diff through the normal permission flow.

## Use

```bash
claude --plugin-dir ~/work/session-chronicle   # one session
# every session: add the absolute path to env.CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json
```

Then `/chronicle [now|cost|tips|standup|improve|refresh]`. Keys: `1`–`5` tabs, `r` re-index,
`a` AI summary, Esc closes; in a detail view `b` back, `c` copy prompt, `g` regenerate.

## Settings

Set these in `/config` (or `/plugin configure`). With `--plugin-dir`, they live under
`pluginConfigs["session-chronicle@inline"]` in `~/.claude/settings.json`.

| Option | Default | What it does |
|---|---|---|
| `aiModel` | `haiku` | Model for 詳しく explanations and AI summaries: `haiku`, `sonnet`, `opus`, `fable`. fable consumes usage credits and only runs when you press `g`. Also switchable from the picker in a detail view, which saves to this setting |
| `aiEffort` | `low` | Effort for those calls: `low`, `medium`, `high` |
| `autoExplain` | `true` | Generate the explanation as soon as 詳しく opens. Off: press `g` |
| `cacheExplanations` | `true` | Keep Cost / Tips / Improve explanations in the plugin store so reopening costs nothing. The store is plain JSON on this machine |
| `excludeProjects` | empty | Comma-separated project path prefixes to leave out of the analysis (e.g. customer work) |

Changing an option reloads the mod (Claude Code re-runs it with the new options). The open tab,
detail view, Standup range, Now warnings and explanations, and this session's token total are
kept in `$.state` and restored. Cost / Tips / Improve refill when the automatic re-index finishes
a moment later; a restored detail reopens only if its finding still exists and you have not moved
on. AI summaries follow the re-index and are not restored (press `a` again).

## Token use

The mod makes no model calls except the two AI buttons. To keep those small:

- Replies are capped by effort (low 700, medium 1200, high 2000 tokens, leaving room for
  thinking) and the prompts ask for 400–500 characters.
- Explanations of Cost / Tips / Improve findings are cached in the plugin store by finding
  content, model, effort and `excludeProjects` (40 entries, 14 days), so reopening one costs nothing until the
  numbers change. Live Now explanations are cached for the session.
- Each answer shows its input/output tokens; the detail view shows this session's total.

## Develop

```bash
claude plugin validate .
claude plugin test
python3 -m unittest discover -s indexer
```

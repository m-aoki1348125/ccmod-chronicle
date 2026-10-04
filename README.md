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
- The mod never writes your files. "適用を依頼" submits a prompt so Claude proposes a
  diff through the normal permission flow.

## Use

```bash
claude --plugin-dir ~/work/session-chronicle   # one session
# every session: add the absolute path to env.CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json
```

Then `/chronicle [now|cost|tips|standup|improve|refresh]`. Keys: `1`–`5` tabs, `r` re-index,
`a` AI summary, Esc closes.

Exclude projects (e.g. customer work) with the `excludeProjects` option: comma-separated
path prefixes. With `--plugin-dir`, set it under `pluginConfigs["session-chronicle@inline"]`.

## Develop

```bash
claude plugin validate .
claude plugin test
python3 -m unittest discover -s indexer
```

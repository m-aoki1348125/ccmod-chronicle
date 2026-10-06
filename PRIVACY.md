# Privacy

Session Chronicle reads your Claude Code history on your machine. This page lists what it reads,
what it stores, what can leave the machine, and how to delete it. (日本語の要約は末尾にあります。)

## What it reads

- Transcripts under `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`), including subagent
  transcripts, for every project except those in `excludeProjects`.
- `~/.claude/history.jsonl` (your prompt history), for counts only.
- Claude Code's merged settings, for `language` and `cleanupPeriodDays`.
- During a session: tool calls (to spot code edits and risky commands) and context / plan-limit usage.

## What it stores, all on your machine

| Where | What | Kept for |
|---|---|---|
| `~/.claude/chronicle/digest.json`, `cache.json` (file mode 0600, folder 0700) | Per-session counts (tools, models, tokens, errors), titles, recap text, the first 80 characters of each session's first prompt, edited file paths, working directories | While the transcript exists, then `retentionDays` (default: Claude Code's `cleanupPeriodDays`) |
| Plugin store (`$.store`, a JSON file Claude Code keeps) | Dismissed findings; cached AI explanations (model output, 40 entries) | Explanations: 14 days. Dismissals: until you clear them or run `/chronicle purge` |
| Session state (`$.state`) | The open tab and detail, Now warnings (file names of code you edited), Now explanations, this session's token total | This session (other installed plugins can read session state) |

Excluded projects are matched after resolving `~`, `..`, symlinks and letter case. A session that
ever ran inside an excluded directory, or whose directory is unknown while any exclusion is set, is
left out entirely.

## What can leave your machine

Only when you press **AI summary** or open **Details** (with `autoExplain` on), the mod calls a model
through Claude Code, using your plan or API key, like any other Claude Code request:

- Findings and their counts, model names, dates and project folder names. Lines that look like paths,
  URLs or control text are withheld, and Now warnings send a count instead of file names.
- For the Standup summary only: session titles, recap text and git commit subjects of the selected
  days. The first-prompt text and full paths are never sent.

**Ask Claude to apply** posts a fixed prompt to your conversation. No telemetry is sent by this mod.

## Deleting it

- `/chronicle purge`: deletes `digest.json`, `cache.json`, the explanation cache, dismissed findings and the saved view.
- Uninstalling the plugin does not delete `~/.claude/chronicle/`; run `/chronicle purge` first, or
  delete that folder.

---

## 日本語の要約

- **読むもの**：除外していない全プロジェクトの会話ログ、プロンプト履歴（件数のみ）、Claude Code の設定
  （言語と保持期間）、セッション中のツール呼び出しと使用率。
- **保存するもの（すべてこのマシン内）**：`~/.claude/chronicle/` に集計結果（件数、タイトル、要約、最初の
  プロンプトの先頭 80 文字、編集したファイルのパス）。会話ログがある間と、その後 `retentionDays` 日まで。
  プラグインの保存領域に、無視した指摘と AI 解説のキャッシュ（14 日）。
- **外に出るもの**：AI のボタンを押したときだけ、指摘と件数・モデル名・日付・フォルダ名をモデルに送ります。
  Standup の要約ではタイトル・要約・コミット件名も送ります。最初のプロンプトの本文やフルパスは送りません。
- **削除**：`/chronicle purge`。アンインストールだけでは `~/.claude/chronicle/` は残ります。

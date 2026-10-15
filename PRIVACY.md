# Privacy

ccmod-chronicle reads your Claude Code history on your machine. This page lists what it reads,
what it stores, what can leave the machine, and how to delete it. (日本語の要約は末尾にあります。)

## What it reads

- Transcripts under `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`), including subagent
  transcripts, for every project except those in `excludeProjects`.
- `~/.claude/history.jsonl` (your prompt history), for counts only.
- Claude Code's merged settings (read whole; only `language` and `cleanupPeriodDays` are used, nothing is stored or sent).
- During a session: tool calls (to spot code edits and risky commands) and context / plan-limit usage.

## What it stores, all on your machine

| Where | What | Kept for |
|---|---|---|
| `~/.claude/chronicle/digest.json`, `cache.json` (file mode 0600, folder 0700) | Per-session counts (tools, models, tokens, errors); names of the subagents, skills, MCP servers and slash commands you used; the first word of your Bash commands (top 60, e.g. `git`, `pytest`); for failed tool calls, the tool or program name (with the subcommand for CLIs such as `npm test` or `git push`, never other arguments or output); the number of redo requests in each session; the transcript's folder name; titles; recap text; the first 80 characters of each session's first prompt; edited file paths; working directories; your `extraRiskyCommands` strings as labels | While the transcript exists; after Claude Code deletes it, until `retentionDays` after the session ended (default: Claude Code's `cleanupPeriodDays`, so usually together with the transcript) |
| Plugin store (`$.store`, a JSON file Claude Code keeps) | Dismissed findings; cached AI explanations (model output, 40 entries) | Explanations: 14 days. Dismissals: until `/chronicle purge` |
| Session state (`$.state`) | The open tab and detail, Now warnings (full paths of code files you edited and risky-command counts), Now explanations, this session's token total | This session (other installed plugins can read session state) |

Excluded projects are matched after resolving `~`, `..`, symlinks and letter case. A session that
ever ran inside an excluded directory, or whose directory is unknown while any exclusion is set, is
left out entirely.

## What can leave your machine

Only when you press **AI summary** or open **Details** (with `autoExplain` on), the mod calls a model
through Claude Code, using your plan or API key, like any other Claude Code request:

- Findings and their counts, model names, dates and project folder names. Lines that look like paths,
  URLs or control text are withheld, and Now warnings send a count instead of file names.
- For the Standup summary only: session titles, recap text and git commit subjects of the selected
  days, as written, except lines that look like paths or URLs, which are withheld. The first-prompt
  text and project paths are never sent.
- Names you configure appear in findings and can be sent with them: your `reviewerAgents` names and
  your `extraRiskyCommands` strings (as typed, unless they look like a path). Other agent, skill and
  command names stay on the machine: findings that name a failed command or your own agents send the
  model a version that says "a command" or "their names" instead.

The mod also lists the names in `~/.claude/agents`, `~/.claude/skills` and this project's
`.claude/agents` and `.claude/skills` to suggest your own agents and skills. It reads names only and
keeps them in memory, not on disk.

**Ask Claude to apply** posts a prompt to your conversation. For the Improve findings of this
repository (a command that keeps failing, redo requests that keep coming back) it includes the
command name and the local paths of the transcripts it refers to, so Claude can read them. No telemetry is sent by this mod.

## Deleting it

- `/chronicle purge`: deletes `digest.json`, `cache.json`, the explanation cache, dismissed findings and
  the saved view. While the plugin stays installed, the next session start indexes again and writes a
  fresh `digest.json`; to stop that, disable or uninstall the plugin.
- Uninstalling the plugin does not delete `~/.claude/chronicle/`; run `/chronicle purge` first, or
  delete that folder.

---

## 日本語の要約

- **読むもの**：除外していない全プロジェクトの会話ログ、プロンプト履歴（件数のみ）、Claude Code の設定
  （言語と保持期間）、セッション中のツール呼び出しと使用率。
- **保存するもの（すべてこのマシン内）**：`~/.claude/chronicle/` に集計結果（件数、タイトル、要約、最初の
  プロンプトの先頭 80 文字、編集したファイルのパス）。会話ログがある間。会話ログが消えた後は、セッションの終了から `retentionDays` 日まで（既定は Claude Code の `cleanupPeriodDays` なので、通常は会話ログと一緒に消えます）。
  プラグインの保存領域に、無視した指摘と AI 解説のキャッシュ（14 日）。
- **外に出るもの**：AI のボタンを押したときだけ、指摘と件数・モデル名・日付・フォルダ名をモデルに送ります。
  Standup の要約ではタイトル・要約・コミット件名も送ります（パスや URL に見える行は除きます）。最初のプロンプトの本文やプロジェクトのパスは送りません。
- **削除**：`/chronicle purge`。インストールしたままだと次の起動で集計し直します（止めるには無効化かアンインストール）。
  アンインストールだけでは `~/.claude/chronicle/` は残ります。
- **ローカルに保存する名前**：使ったサブエージェント・skill・MCP サーバー・スラッシュコマンドの名前と、Bash コマンドの
  先頭の語、失敗したツール呼び出しのツール名・プログラム名（`npm test` のようなサブコマンドまで。ほかの引数や出力は保存しません）、
  セッションごとのやり直しの回数、会話ログのフォルダ名。モデルに送るのは、設定した `reviewerAgents` と `extraRiskyCommands` の
  文字列だけです。失敗したコマンド名や手元のエージェント名を含む指摘は、名前を伏せた文にしてから送ります。
- **読み取る名前**：`~/.claude/agents`・`~/.claude/skills` と、このプロジェクトの `.claude/agents`・`.claude/skills` の
  名前だけを読み、手元のエージェントと skill の提案に使います（ファイルには保存しません）。
- **適用を依頼**：このリポジトリの Improve の指摘（繰り返し失敗するコマンド、繰り返すやり直し）では、コマンド名と根拠となる
  会話ログのパスをプロンプトに含めて会話に送ります。

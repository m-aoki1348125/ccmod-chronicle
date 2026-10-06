# ccmod-chronicle

[English](README.md)

GitHub Copilot CLI の `/chronicle` のように、Claude Code の使い方を分析してサイドバーに表示する
[Claude Code の mod](https://code.claude.com/docs/ja/plugins/mods/overview) です。

| タブ | 内容 |
|---|---|
| Now | このセッションの警告：コンテキストの使用率、プランの上限、レビュー前のコード変更、外部に影響する操作 |
| Cost | 遅い compaction、cache read の大半を占めるセッション、モデルの内訳、credits のエラー、長いターン |
| Tips | あまり使っていない Claude Code の機能（最大 5 件、根拠とドキュメント付き） |
| Standup | 過去 1 / 3 / 7 日のプロジェクトごとの作業：タイトル、要約、git のコミット、ファイル |
| Improve | 使い方の改善点（編集後のレビュー、メモの検索、繰り返すやり直し、ツールエラー） |
| Settings | 下の設定をその場で変更（選択欄と入力欄） |

**詳しく** を押すと、サイドバーの中で根拠の内訳・推奨アクション・コピーできるプロンプト・AI 解説を
表示します。**適用を依頼** を押したとき以外、会話には何も送りません。

## 必要なもの

- Claude Code **2.1.287 以降**（mod）。2.1.288 で確認。ペインはターミナルと Desktop アプリの Code タブに
  表示されます。それ以外（VS Code 拡張機能、モバイル、`claude -p`）では `/chronicle` が文字で答えます。
- `python3` または `python` として実行できる **Python 3.9 以上**（標準ライブラリのみ。何もインストールしません）。
- 組織の管理設定（`allowManagedModsOnly` など）でユーザーの mod が止められている場合は動きません。
  インストール後に `/chronicle` が出ない場合は管理者に確認してください。
- macOS で確認済み。Linux でも動く想定です。Windows は未確認です。

## インストール

```bash
claude plugin marketplace add m-aoki1348125/ccmod-chronicle
claude plugin install ccmod-chronicle@ccmod-chronicle
```

1 セッションだけ試す場合は、クローンして `claude --plugin-dir ./ccmod-chronicle`。

インストールの前に、実行せずに mod が何をするかを一覧できます：
`claude plugin validate ./ccmod-chronicle`（[SECURITY.md](SECURITY.md) 参照）。

## 使い方

`/chronicle [now|cost|tips|standup|improve|settings|refresh|purge]`

キー：`1`〜`6` でタブ、`r` で再集計、`v` でシンプル／リッチ表示の切り替え、`a` で AI 要約、Esc で閉じる。詳細表示では `b` で戻る、
`c` でプロンプトをコピー、`g` で解説を生成・再生成。

`/chronicle purge` で、この mod が保存したものをすべて削除します（[PRIVACY.md](PRIVACY.md) 参照）。

表示は 2 種類です（`paneStyle`）。既定の **simple** は軽量な文字表示です。**rich** では指摘の上にグラフを出し
（Now：コンテキストとプラン上限のメーター、Cost：モデル別の出力トークン・セッション別の cache read・
compaction 時のトークン数、Standup：日ごとのプロンプト数）、指摘を枠付きのカードで表示します。
グラフはターミナルではセル描画、デスクトップアプリでは SVG（カーソルを重ねると値を表示）で、
それ以外の画面では simple と同じ文字表示になります。どのグラフにも数値を併記します。

## 設定

**Settings** タブ（`6` か `/chronicle settings`）、`/config`、または `/plugin` → Installed → ccmod-chronicle → Configure で変更します。`--plugin-dir` で
読み込んだ場合は `~/.claude/settings.json` の `pluginConfigs["ccmod-chronicle@inline"]` に保存されます。
変更すると mod が再読み込みされ、ペインは元の画面に戻ります。

| 設定 | 既定値 | 内容 |
|---|---|---|
| `language` | `auto` | `en`、`ja`、または `auto`（Claude Code の `language` 設定に従う） |
| `paneStyle` | `simple` | `simple`（文字表示）または `rich`（グラフとカード）。`v` で切り替え |
| `aiModel` | `haiku` | 解説と AI 要約のモデル：`haiku`、`sonnet`、`opus`、`fable`。`fable` は usage credits を消費し、`g` を押したときだけ動きます。詳細表示からも変更できます |
| `aiEffort` | `low` | `low`、`medium`、`high`。返答の上限も連動します（700 / 1200 / 2000 tokens） |
| `autoExplain` | `true` | 詳しく を開いた時点で解説を生成。オフなら `g` で生成 |
| `cacheExplanations` | `true` | Cost / Tips / Improve の解説を、数値が変わるまで再利用 |
| `reviewerAgents` | 空 | レビューとして数えるサブエージェント名（例：`code-reviewer,security-reviewer`）。Claude Code には同梱されていないため、設定するまでレビューの確認はしません |
| `memoryTools` | 空 | メモの検索に使う MCP ツールの接頭辞や CLI 名（例：`mcp__notes__,notes-cli`）。空なら検索の確認をしません |
| `memoryCueWords` | 空 | 「過去の文脈が必要」を表す言葉。空なら英語と日本語の既定の言葉を使います |
| `extraRiskyCommands` | 空 | 追加で警告するコマンドの文字列（例：`terraform apply`） |
| `retentionDays` | `0` | Claude Code が会話ログを消したセッションの要約を、セッションの終了から何日まで残すか。`0` は Claude Code の `cleanupPeriodDays`（既定 30 日）を使うので、要約は会話ログと一緒に消えます |
| `excludeProjects` | 空 | 集計から完全に外すプロジェクトのパスの接頭辞（カンマ区切り。顧客案件など） |

## トークンの消費

モデルを呼ぶのは **AI で要約** を押したときと、**詳しく** を開いたとき（`autoExplain` がオンの場合）だけで、
あなたのプランか API キーで課金されます。既定は `haiku`・low effort・短い返答で、解説はキャッシュします
（40 件・14 日。内容・モデル・effort・言語・除外設定がキー）。回答ごとにトークン数を、詳細表示では
このセッションの合計を表示します。

## 仕組み

- `indexer/chronicle_index.py`（Python 標準ライブラリのみ）が、Claude Code が `~/.claude/projects/`
  （または `$CLAUDE_CONFIG_DIR`）に残す会話ログを差分で集計し、`~/.claude/chronicle/digest.json` に書きます。
  会話ログの形式は公開仕様ではないため、Claude Code の更新で形式が変わると、集計スクリプトを直すまで
  指摘が出なくなることがあります。
- mod（`hooks/register.js`）は起動時と `r` で集計スクリプトを実行し、固定のルール（`hooks/rules.js`、
  `hooks/catalog.js`）で指摘を作り、mod のイベントで現在のセッションを見ています。
- 文言は `hooks/strings-en.js` と `hooks/strings-ja.js` にあります。

## 開発

```bash
claude plugin validate --strict .
claude plugin test
python3 -m unittest discover -s indexer
```

## ライセンス

[MIT](LICENSE)

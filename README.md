# ccmod-chronicle

[日本語](README.ja.md)

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that opens a sidebar
analyzing how you use Claude Code, in the spirit of GitHub Copilot CLI's `/chronicle`.

| Tab | What it shows |
|---|---|
| Now | Live warnings for this session: context fill, plan-limit windows, code changed without review, commands with outside effects |
| Cost | Late compactions, the few sessions that dominate cache reads, model mix, credit errors, very long turns |
| Tips | Up to 5 Claude Code features you underuse, with the evidence and a docs link |
| Standup | Work per project over the last 1 / 3 / 7 days: titles, recaps, git commits, files |
| Improve | Gaps between how you work and what helps (review after edits, note searches, repeated corrections, tool errors) |
| Settings | Every option below, changed in place (pickers and text fields) |

**Details** opens a finding inside the sidebar: the breakdown behind it, the recommended action, a
prompt you can copy, and an optional AI explanation. Nothing is posted to your conversation unless
you press **Ask Claude to apply**.

## Requirements

- Claude Code **2.1.287 or later** (mods). Tested with 2.1.288. The pane shows in the terminal and the
  desktop app's Code tab; elsewhere (VS Code extension, mobile, `claude -p`) `/chronicle` answers in text.
- **Python 3.9+** on `PATH` as `python3` or `python` (standard library only; nothing is installed).
- Organizations can block user-installed mods (`allowManagedModsOnly` and related managed settings).
  If `/chronicle` does not exist after installing, ask your administrator.
- Tested on macOS. Linux should work; Windows is untested.

## Install

```bash
claude plugin marketplace add m-aoki1348125/ccmod-chronicle
claude plugin install ccmod-chronicle@ccmod-chronicle
```

Or try it for one session from a clone: `claude --plugin-dir ./ccmod-chronicle`.

Before installing any mod, you can list what it does without running it:
`claude plugin validate ./ccmod-chronicle` (see [SECURITY.md](SECURITY.md)).

## Use

`/chronicle [now|cost|tips|standup|improve|settings|refresh|purge]`

Keys: `1`–`6` tabs, `r` re-index, `v` simple / rich view, `a` AI summary, Esc closes. In a detail view: `b` back,
`c` copy prompt, `g` generate / regenerate the explanation.

`/chronicle purge` deletes everything this mod stored (see [PRIVACY.md](PRIVACY.md)).

Two views (`paneStyle`): **simple**, the light text view, is the default. **rich** adds charts
above the findings (context and plan-limit meters on Now; output tokens by model, cache reads by
session and tokens at compaction on Cost; prompts per day on Standup) and draws each finding in a
bordered card. Charts are cell graphics in the terminal and SVG with hover values in the desktop
app; other surfaces keep the simple view's text. Every chart has its numbers written beside it.

## Settings

Change these in the **Settings** tab (`6` or `/chronicle settings`), in `/config`, or in `/plugin` → Installed → ccmod-chronicle → Configure. With `--plugin-dir`,
they live under `pluginConfigs["ccmod-chronicle@inline"]` in `~/.claude/settings.json`.
Changing one reloads the mod; the pane comes back where it was.

| Option | Default | What it does |
|---|---|---|
| `language` | `auto` | `en`, `ja`, or `auto` (follows Claude Code's `language` setting) |
| `paneStyle` | `simple` | `simple` (text) or `rich` (charts and cards); `v` toggles it |
| `aiModel` | `haiku` | Model for explanations and AI summaries: `haiku`, `sonnet`, `opus`, `fable`. `fable` uses usage credits and only runs when you press `g`. Also switchable from the detail view |
| `aiEffort` | `low` | `low`, `medium`, `high`. The reply cap grows with it (700 / 1200 / 2000 tokens) |
| `autoExplain` | `true` | Generate the explanation as soon as Details opens. Off: press `g` |
| `cacheExplanations` | `true` | Reuse explanations of Cost / Tips / Improve findings until their numbers change |
| `reviewerAgents` | empty | Subagent names that count as review (e.g. `code-reviewer,security-reviewer`). Claude Code ships none, so the review checks stay off until you name yours |
| `memoryTools` | empty | MCP tool prefixes or CLI names you search notes with (e.g. `mcp__notes__,notes-cli`). Empty turns the recall check off |
| `memoryCueWords` | empty | Words meaning "this needs earlier context". Empty uses built-in English and Japanese words |
| `extraRiskyCommands` | empty | Extra command substrings to flag (e.g. `terraform apply`) |
| `retentionDays` | `0` | Once Claude Code has deleted a session's transcript, its summary is kept until this many days after the session ended. `0` uses Claude Code's `cleanupPeriodDays` (30 by default), so summaries go when their transcripts do |
| `excludeProjects` | empty | Comma-separated project path prefixes to leave out entirely (e.g. client work) |

## Token use

The mod calls a model only when you press **AI summary** or open **Details** (with `autoExplain`).
Calls use your plan or API key. Defaults keep them small: `haiku`, low effort, a short reply, and a
cache of explanations (40 entries, 14 days, keyed by content, model, effort, language and
exclusions). Each answer shows its tokens; the detail view shows this session's total.

## How it works

- `indexer/chronicle_index.py` (stdlib Python) incrementally summarizes the transcripts Claude Code
  keeps under `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR`) into `~/.claude/chronicle/digest.json`.
  The transcript format is not a public interface; if a Claude Code release changes it, findings may
  go quiet until the indexer is updated.
- The mod (`hooks/register.js`) runs the indexer at session start and on `r`, turns the digest into
  findings with fixed rules (`hooks/rules.js`, `hooks/catalog.js`) and watches the live session
  through mod events.
- Strings live in `hooks/strings-en.js` and `hooks/strings-ja.js`.

## Develop

```bash
claude plugin validate --strict .
claude plugin test
python3 -m unittest discover -s indexer
```

## License

[MIT](LICENSE)

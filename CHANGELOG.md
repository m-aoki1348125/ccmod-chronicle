# Changelog

## 0.9.0

Findings grounded in what happened, after GitHub Copilot CLI's `/chronicle improve` and `tips`:

- Improve looks at the open repository (in a git repository, its subfolders too; elsewhere only
  that folder). A command that failed 3 or more times across 2 or more sessions is named
  (`npm test` failed 14 times in 3 sessions), and so are redo requests that keep coming back.
  **Apply** asks Claude to read those transcripts and draft CLAUDE.md lines as a diff, then to be
  checked with `/doctor prompt-audit`. A pattern must recur across sessions, so one bad afternoon
  does not become advice; only Bash programs and MCP tools are counted, everyday shell utilities left out.
- Your own agents and skills (`~/.claude` and the project's `.claude`): unused ones lead the Tips,
  by name (`/skill-doctor` for the details), and review agents you have are suggested for
  `reviewerAgents` while the review check is off.
- The model never reads those names: such findings send "a command" or "their names" instead.
  The indexer stores failed tool and program names, per-session redo counts and the transcript
  folder name (schema 11, see PRIVACY.md).

## 0.8.1

Findings checked against real data and corrected:

- Workflow agents' transcripts (`subagents/workflows/*/agent-*.jsonl`) are now counted; they
  held most of the subagent output.
- SDK runs and one-shot calls with no tools and no title are marked `automated` and left out of
  the standup, the totals and the model mix.
- Auto mode classifier failures are counted apart from tool errors; "you haven't granted it yet"
  counts as a denial. Tool errors are flagged by their share of tool calls (5%), not a bare count.
- The effort tip stays quiet when effort is set in settings (`effortLevel` or `modelSettings`).
- Tips citing redo prompts use the same test as Improve; a "continue" right after `/model`,
  `/rate-limit-options` or `/login` is not a resume prompt; a compaction repeated in a copied
  session file counts once; the heavy-sessions finding links to the costs page.

## 0.8.0

- Burn alert: when a turn spends tokens faster than `burnAlert` (100k tokens/min by default;
  cache reads count a tenth, subagents' tokens are included), a band above the prompt says so in
  animated rainbow letters, as `ultrathink` is highlighted, with Details and Hide. The Now tab
  lists it too (high severity at twice the threshold). `burnEffect` picks `rainbow`, `still` or
  `plain`; `burnAlert: 0` turns the alert off.

## 0.7.0

- A quieter pane, drawn in the text font only: no emoji, no frames, no chips. Tabs read as a
  row with the open one bold and a count after each, the index status is a relative time
  ("5 min ago") with the two controls on the right, and a hairline separates the header from the
  list. A finding is a colored dot and its title, the severity word with the evidence, the next
  step after `→`, and text buttons (accent for Details and Apply, dim for Dismiss). The rich view
  keeps its charts and shows its figures as a row of labelled numbers; `v` now reads "Show / Hide
  charts". Standup rows use `recap` / `commits` / `files` label columns; the Settings tab has
  plain on / off pickers.

## 0.6.0

- Easier to read at a glance: tab icons, 🔴 / 🔶 / 🔷 severity with colored titles, 📊 evidence and
  👉 action lines with a hanging indent, status icons. The rich view adds severity chips, frames
  colored by severity, stat tiles on Now, Cost and Standup, a Findings header and plan-limit names
  (5-hour, 7-day). The Settings tab is grouped into Display, AI, Rules and Data.

## 0.5.0

- Rich view (`paneStyle: rich`, or `v` in the pane): charts above the findings and bordered
  finding cards. Terminal charts are Raster cells; the desktop app gets SVG with hover values.
  The simple text view stays the default.

## 0.4.0

- Settings tab (`6` or `/chronicle settings`): every option can be changed from the sidebar, with
  pickers for fixed choices and on/off, and text fields for lists and numbers. Values are checked
  before they are saved to this plugin's `/config` options; language and AI settings apply at once.

## 0.3.0

First public release.

- English and Japanese (`language`; `auto` follows Claude Code's `language` setting).
- Rules that depended on one person's setup are now options with generic defaults:
  `reviewerAgents` (empty: review checks off), `memoryTools`, `memoryCueWords`,
  `extraRiskyCommands`.
- `retentionDays`: summaries of sessions whose transcripts Claude Code has deleted are kept only
  until this many days after the session ended (default: `cleanupPeriodDays`).
  **Upgrading from 0.2.x drops older summaries that 0.2.x kept indefinitely.** Set a large
  `retentionDays` (up to 3650) before the first session on 0.3.0 if you want to keep them.
- `/chronicle purge` deletes everything the mod stored.
- `CLAUDE_CONFIG_DIR`, `USERPROFILE` and `python` fallbacks; a text answer where the pane cannot
  show (VS Code, mobile, `-p`); a warning on Claude Code older than 2.1.287.
- Details opens inside the sidebar; AI explanations default to haiku at low effort and are cached.

# Changelog

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

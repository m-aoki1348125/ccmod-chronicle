# Security

A mod runs inside Claude Code with your user's permissions and is not sandboxed
([mods overview](https://code.claude.com/docs/en/plugins/mods/overview#decide-whether-to-trust-a-mod)).
This page explains every capability ccmod-chronicle uses, so you can check it before installing.

## Check it yourself

```bash
claude plugin validate ./ccmod-chronicle
```

The `hooks:` and `calls:` lines list the events the mod handles and every mods API method it calls.

## Events it handles

| Event | Why | Changes the event? |
|---|---|---|
| `session.start`, `session.end` | Register `/chronicle`, restore or reset the pane | No; passes the event on, also when the hook fails (`.catch`) |
| `command.run` (`/chronicle` only) | Open the pane | Answers its own command |
| `tool.call`, `agent.spawn` | Notice code edits, risky Bash commands and review agents | No: observes and passes the call on, also when the hook fails (`.catch`) |
| `session.measure` | Context and plan-limit usage for the Now tab | No; passes it on, also on failure (`.catch`) |
| `config.set` | Apply a changed option without waiting for the reload | No; passes the result on, also on failure (`.catch`) |
| `ui.render` (its own pane) | Draw the sidebar | Draws only its pane |

It never approves or denies tool calls and does not rewrite prompts.

## Calls it makes

| Call | Used for |
|---|---|
| `$.process.run` | `python3`/`python indexer/chronicle_index.py` (argv, no shell); `git log` for Standup, with repository hooks (`log.showSignature`, `core.fsmonitor`, `diff.external`) turned off and only for absolute paths |
| `$.fs.read` | `~/.claude/chronicle/digest.json` |
| `$.env.get` | `CLAUDE_CONFIG_DIR`, `HOME`, `USERPROFILE` only, to find `~/.claude` |
| `$.settings.read` | Reads the merged settings; uses only `language` and `cleanupPeriodDays`, keeps nothing else |
| `$.model.complete` | AI summary and explanation, on your press, through Claude Code with your plan or key |
| `$.prompt.submit` | **Ask Claude to apply** only: a fixed prompt about CLAUDE.md |
| `$.config.list`, `$.config.set` | The Settings tab and the detail-view pickers write this plugin's own 12 options only, after checking each value. The row is the one keyed `<plugin>.<option>` or `<plugin>@<scope>.<option>` and owned by this plugin; if more than one such row exists (for example an installed copy and a `--plugin-dir` copy, which cannot be told apart), nothing is written. Removing entries from `excludeProjects` shows a notice, since those projects are indexed again |
| `$.store`, `$.state` | Dismissals, explanation cache, pane state; `$.store.delete` for `/chronicle purge` |
| `$.command.register` | Registers `/chronicle` |
| `$.ui.*`, `$.clock.*`, `$.session.version/surfaces` | Drawing, timers, version check, text fallback |

It makes no network requests of its own (`$.http` is not used) and sends no telemetry.

## Untrusted input

Transcript text (titles, recaps, commit subjects, file names) is treated as data: control and bidi
characters are removed before drawing, model input marks it as untrusted, and links are stripped
from model output. The rich view's desktop charts are SVG built from fixed markup: transcript-derived
labels (folder and model names) are cleaned and XML-escaped and appear only as tooltips, with no script.

## Reporting a vulnerability

Please open a [GitHub security advisory](https://github.com/m-aoki1348125/ccmod-chronicle/security/advisories/new)
rather than a public issue.

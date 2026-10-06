#!/usr/bin/env python3
"""Incrementally summarize Claude Code transcripts into a small digest JSON.

Stdlib only. The digest stores counts, titles, recaps, edited file paths and the
first 80 characters of each session's first prompt (for local display). The mod
strips firstPrompt and full paths before anything is sent to a model.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from chronicle_io import (
    any_excluded,
    is_excluded,
    iter_records,
    load_json,
    normalize_path,
    write_atomic,
)
from chronicle_text import classify_api_error, first_plain_text, first_text

SCHEMA_VERSION = 8
CODE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".swift", ".kt", ".java", ".c", ".cpp", ".cs", ".rb"}
RISKY_PATTERNS = [
    (re.compile(r"\brm\s+-\w*r"), "rm -r"),
    (re.compile(r"git\s+push\b.*(\s-f\b|--force(?!-with-lease))"), "force push"),
    (re.compile(r"git\s+reset\s+--hard"), "reset --hard"),
    (re.compile(r"(^|[\s;&|])(ssh|scp|rsync)\s"), "remote copy/shell"),
    (re.compile(r"(^|[\s;&|])sudo\s"), "sudo"),
]
# Short "keep going" prompts, Japanese and English.
RESUME_RE = re.compile(r"^\s*(再開|続けて|進めて|continue|resume|go on|keep going|carry on|proceed)[.!。]?\s*$", re.IGNORECASE)
# Prompts asking for a redo, Japanese and English.
CORRECTION_RE = re.compile(
    r"(違う|違います|まだ.{0,20}(ない|できて|直って|ズレ)|直って(い)?ない|できていない|改善されていない|やり直|ズレ"
    r"|not working|still (not|broken|failing|wrong)|doesn'?t work|that'?s (wrong|not right)|try again|not fixed)",
    re.IGNORECASE,
)
BUILTIN_RISKY_LABELS = {label for _, label in RISKY_PATTERNS}
# A slash command: "/name" or "/plugin:name" as the first word, not a path like /Users/x or /home/x.
SLASH_RE = re.compile(r"^/[A-Za-z][\w:-]*(?=\s|$)")
COMMAND_SPLIT_RE = re.compile(r"\s*(?:&&|\|\||;|\|)\s*")
MAX_BASH_HEADS = 60
DEFAULT_MEMORY_CUES = ("前回", "以前", "覚えて", "last time", "previously", "remember when")
DENIAL_MARKERS = ("doesn't want to proceed", "user rejected", "rejected by the user", "permission to use", "was denied by the user")


@dataclass(frozen=True)
class IndexOptions:
    """What the mod's settings change about indexing (passed as CLI flags)."""
    excludes: tuple = ()
    risky: tuple = ()  # extra (compiled pattern, label) pairs
    memory_re: re.Pattern = re.compile("|".join(re.escape(c) for c in DEFAULT_MEMORY_CUES), re.IGNORECASE)
    retention_days: int = 0  # 0: keep every summary

    def cache_key(self) -> list:
        # Memory cues only affect history counts, which are recomputed every run.
        return [list(self.excludes), [label for _, label in self.risky]]


def make_options(excludes=(), risky=(), memory_cues=(), retention_days=0) -> IndexOptions:
    cues = [c for c in memory_cues if c.strip()] or list(DEFAULT_MEMORY_CUES)
    return IndexOptions(
        excludes=tuple(sorted({normalize_path(e) for e in excludes if e.strip()})),
        # A user string equal to a built-in label would count the same command twice.
        risky=tuple((re.compile(re.escape(r)), r) for r in sorted({r.strip() for r in risky if r.strip()} - BUILTIN_RISKY_LABELS)),
        memory_re=re.compile("|".join(re.escape(c.strip()) for c in cues), re.IGNORECASE),
        retention_days=max(0, int(retention_days or 0)),
    )
MAX_EDITED_FILES = 15
MAX_AWAY = 5
FIRST_PROMPT_CHARS = 80
COMPACT_TRIGGERS = {"auto", "manual"}
LOCAL_TZ = datetime.now().astimezone().tzinfo  # day buckets follow the user's clock


@dataclass
class SessionStats:
    session_id: str
    project: str = ""
    cwds: set = field(default_factory=set)
    start: str | None = None
    end: str | None = None
    title: str | None = None
    first_prompt: str | None = None
    away: list[str] = field(default_factory=list)
    models: Counter = field(default_factory=Counter)
    usage_ledger: dict = field(default_factory=dict)
    tools: Counter = field(default_factory=Counter)
    risky: Counter = field(default_factory=Counter)
    agents: Counter = field(default_factory=Counter)
    skills: Counter = field(default_factory=Counter)
    mcp: Counter = field(default_factory=Counter)
    edit_exts: Counter = field(default_factory=Counter)
    edited_files: Counter = field(default_factory=Counter)
    compactions: list = field(default_factory=list)
    turn_ms: list = field(default_factory=list)
    api_errors: Counter = field(default_factory=Counter)
    tool_errors: int = 0
    denials: int = 0
    perm_modes: Counter = field(default_factory=Counter)
    sub_ledger: dict = field(default_factory=dict)
    sub_tools: Counter = field(default_factory=Counter)
    bash_heads: Counter = field(default_factory=Counter)
    seen_ids: set = field(default_factory=set)

    def to_json(self) -> dict:
        turns = sorted(self.turn_ms)
        return {
            "id": self.session_id,
            "project": self.project,
            "start": self.start,
            "end": self.end,
            "title": self.title,
            # Local display only; the mod strips it before any model call.
            "firstPrompt": self.first_prompt,
            "away": self.away[-MAX_AWAY:],
            "models": dict(self.models),
            "usageByModel": sum_ledger(self.usage_ledger),
            "tools": dict(self.tools),
            "risky": dict(self.risky),
            "agents": dict(self.agents),
            "skills": dict(self.skills),
            "mcp": dict(self.mcp),
            "editExts": dict(self.edit_exts),
            "editedFiles": [p for p, _ in self.edited_files.most_common(MAX_EDITED_FILES)],
            "compactions": self.compactions,
            "turns": {
                "count": len(turns),
                "sumMs": sum(turns),
                "maxMs": turns[-1] if turns else 0,
                "p50Ms": turns[len(turns) // 2] if turns else 0,
            },
            "apiErrors": dict(self.api_errors),
            "toolErrors": self.tool_errors,
            "denials": self.denials,
            "permModes": dict(self.perm_modes),
            "subUsage": sum_ledger(self.sub_ledger),
            "subTools": dict(self.sub_tools),
            # First word of each Bash command segment, so the mod can count CLIs the user names.
            "bashHeads": dict(self.bash_heads.most_common(MAX_BASH_HEADS)),
        }


def as_dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def first_seen(seen: set, msg: dict) -> bool:
    """One API response is written as several records sharing message.id."""
    mid = msg.get("id")
    if not mid:
        return True
    if mid in seen:
        return False
    seen.add(mid)
    return True


USAGE_FIELDS = (("in", "input_tokens"), ("out", "output_tokens"), ("cacheRead", "cache_read_input_tokens"), ("cacheWrite", "cache_creation_input_tokens"))


def add_usage(ledger: dict, model: str, msg: dict) -> None:
    """Records sharing a message.id repeat the response's usage, but in subagent
    transcripts output_tokens can grow across them (5 -> 110): keep each field's max."""
    usage = as_dict(msg.get("usage"))
    key = (model or "unknown", msg.get("id") or f"anon-{len(ledger)}")
    prev = ledger.get(key, {})
    ledger[key] = {k: max(prev.get(k, 0), usage.get(src) or 0) for k, src in USAGE_FIELDS}


def sum_ledger(ledger: dict) -> dict:
    out: dict = {}
    for (model, _), row in ledger.items():
        acc = out.setdefault(model, {k: 0 for k, _ in USAGE_FIELDS})
        for k in acc:
            acc[k] += row[k]
    return out


def record_tool_use(stats: SessionStats, name: str, inp: dict, opts: IndexOptions) -> None:
    stats.tools[name] += 1
    if name.startswith("mcp__"):
        stats.mcp[name.split("__")[1]] += 1
    elif name in ("Agent", "Task"):
        stats.agents[inp.get("subagent_type") or "general-purpose"] += 1
    elif name == "Skill":
        stats.skills[inp.get("skill") or "?"] += 1
    elif name in ("Edit", "Write", "NotebookEdit"):
        fp = inp.get("file_path") or inp.get("notebook_path") or ""
        if fp:
            stats.edit_exts[os.path.splitext(fp)[1].lower() or "(none)"] += 1
            stats.edited_files[fp] += 1
    elif name == "Bash":
        cmd = inp.get("command") or ""
        for pat, label in (*RISKY_PATTERNS, *opts.risky):
            if pat.search(cmd):
                stats.risky[label] += 1
        for segment in COMMAND_SPLIT_RE.split(cmd.strip()):
            # Skip leading VAR=value assignments; count the program, without a Windows .exe suffix.
            words = [w for w in segment.split() if "=" not in w]
            head = words[0] if words else ""
            if head and len(head) <= 40:
                name = re.split(r"[\\/]", head)[-1]
                stats.bash_heads[name[:-4] if name.lower().endswith(".exe") else name] += 1


def record_assistant(stats: SessionStats, d: dict, opts: IndexOptions) -> None:
    msg = d.get("message") if isinstance(d.get("message"), dict) else {}
    if d.get("isApiErrorMessage"):
        stats.api_errors[classify_api_error(first_text(msg.get("content")))] += 1
        return
    model = msg.get("model") or "unknown"
    if model != "<synthetic>" and not d.get("isSidechain"):
        if first_seen(stats.seen_ids, msg):
            stats.models[model] += 1
        add_usage(stats.usage_ledger, model, msg)
    for c in msg.get("content") or []:
        if isinstance(c, dict) and c.get("type") == "tool_use":
            record_tool_use(stats, c.get("name", "?"), c.get("input") or {}, opts)


def record_user(stats: SessionStats, d: dict) -> None:
    msg = d.get("message") if isinstance(d.get("message"), dict) else {}
    content = msg.get("content")
    if stats.first_prompt is None and not d.get("isMeta"):
        text = first_plain_text(content)
        if text:
            stats.first_prompt = " ".join(text.split())[:FIRST_PROMPT_CHARS]
    if not isinstance(content, list):
        return
    for c in content:
        if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("is_error"):
            text = str(c.get("content"))[:300].lower()
            if any(m in text for m in DENIAL_MARKERS):
                stats.denials += 1
            else:
                stats.tool_errors += 1


def record_system(stats: SessionStats, d: dict) -> None:
    sub = d.get("subtype")
    if sub == "turn_duration" and isinstance(d.get("durationMs"), (int, float)):
        stats.turn_ms.append(int(d["durationMs"]))
    elif sub == "compact_boundary":
        meta = d.get("compactMetadata") or {}
        trigger = meta.get("trigger") if meta.get("trigger") in COMPACT_TRIGGERS else None
        pre = meta.get("preTokens") if isinstance(meta.get("preTokens"), int) else None
        stats.compactions.append({"trigger": trigger, "preTokens": pre, "at": d.get("timestamp")})
    elif sub == "away_summary" and d.get("content"):
        stats.away.append(str(d["content"]).split(" (disable recaps")[0][:400])


def summarize_main(path: Path, opts: IndexOptions) -> SessionStats:
    stats = SessionStats(session_id=path.stem)
    for d in iter_records(path):
        ts = d.get("timestamp")
        if isinstance(ts, str):
            stats.start = stats.start or ts
            stats.end = ts
        if isinstance(d.get("cwd"), str) and d["cwd"]:
            stats.cwds.add(d["cwd"])
            stats.project = stats.project or d["cwd"]
        ty = d.get("type")
        if ty == "assistant":
            record_assistant(stats, d, opts)
        elif ty == "user":
            record_user(stats, d)
        elif ty == "system":
            record_system(stats, d)
        elif ty in ("custom-title", "ai-title"):
            title = d.get("customTitle") or d.get("aiTitle") or d.get("title")
            if title and (ty == "custom-title" or not stats.title):
                stats.title = str(title)[:200]
        elif ty == "permission-mode" and d.get("permissionMode"):
            stats.perm_modes[d["permissionMode"]] += 1
    return stats


def merge_subagents(stats: SessionStats, sub_dir: Path) -> None:
    if not sub_dir.is_dir():
        return
    for f in sorted(sub_dir.glob("*.jsonl")):
        for d in iter_records(f):
            if d.get("type") != "assistant":
                continue
            msg = d.get("message") if isinstance(d.get("message"), dict) else {}
            if d.get("isApiErrorMessage"):
                continue
            add_usage(stats.sub_ledger, msg.get("model") or "unknown", msg)
            for c in msg.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    stats.sub_tools[c.get("name", "?")] += 1


def file_signature(path: Path, sub_dir: Path) -> str:
    st = path.stat()
    parts = [f"{st.st_mtime_ns}:{st.st_size}"]
    if sub_dir.is_dir():
        for f in sorted(sub_dir.glob("*.jsonl")):
            s = f.stat()
            parts.append(f"{f.name}:{s.st_mtime_ns}:{s.st_size}")
    return "|".join(parts)


def summarize_history(history: Path, opts: IndexOptions) -> dict:
    slash, by_day = Counter(), Counter()
    resume = corrections = memory_cues = images = total = 0
    if history.exists():
        for d in iter_records(history):
            project = d.get("project") if isinstance(d.get("project"), str) else ""
            if is_excluded(project, opts.excludes):
                continue
            text = d.get("display") if isinstance(d.get("display"), str) else ""
            total += 1
            ts = d.get("timestamp")
            if isinstance(ts, (int, float)):
                by_day[datetime.fromtimestamp(ts / 1000, tz=LOCAL_TZ).strftime("%Y-%m-%d")] += 1
            m = SLASH_RE.match(text)
            if m:
                slash[m.group(0)] += 1
            resume += bool(RESUME_RE.match(text))
            corrections += bool(CORRECTION_RE.search(text))
            memory_cues += bool(opts.memory_re.search(text))
            images += "[Image" in text
    return {
        "prompts": total,
        "slash": dict(slash.most_common(60)),
        "resumePrompts": resume,
        "correctionPrompts": corrections,
        "memoryCuePrompts": memory_cues,
        "imagePrompts": images,
        "byDay": dict(sorted(by_day.items())[-120:]),
    }


def carry_over(cache: dict, opts: IndexOptions) -> dict:
    """Reuse cached entries. On a schema or option change, keep summaries of deleted
    transcripts (drop any now excluded) and force a rescan of the rest."""
    sessions = cache.get("sessions") if isinstance(cache.get("sessions"), dict) else {}
    if cache.get("schema") == SCHEMA_VERSION and cache.get("options") == opts.cache_key():
        return sessions
    kept = {}
    for sid, entry in sessions.items():
        data = entry.get("data") if isinstance(entry, dict) else None
        if not isinstance(data, dict):
            continue
        stored = entry.get("cwds")
        cwds = [c for c in stored if isinstance(c, str)] if isinstance(stored, list) else [str(data.get("project") or "")]
        if any_excluded(cwds, list(opts.excludes)):
            continue
        kept[sid] = {"sig": None, "cwds": cwds, "data": data}
    return kept


def within_retention(entry: dict, cutoff: datetime | None, has_transcript: bool) -> bool:
    """While Claude Code still keeps a transcript its summary stays; once the transcript is gone,
    the summary is kept only within the retention window."""
    if cutoff is None or has_transcript or "data" not in entry:
        return True
    end = entry["data"].get("end")
    try:
        ended = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
    except ValueError:
        return False
    # A timestamp without a zone is read as local time rather than failing the comparison.
    return (ended if ended.tzinfo else ended.astimezone()) >= cutoff


def scan(claude_dir: Path, sessions: dict, opts: IndexOptions) -> tuple[int, int, set]:
    scanned = reused = 0
    seen = set()
    excludes = list(opts.excludes)
    for path in sorted((claude_dir / "projects").glob("*/*.jsonl")):
        seen.add(path.stem)
        sub_dir = path.with_suffix("") / "subagents"
        sig = file_signature(path, sub_dir)
        prev = sessions.get(path.stem)
        if prev and prev.get("sig") == sig:
            reused += 1
            continue
        stats = summarize_main(path, opts)
        if any_excluded(stats.cwds, excludes):
            # Negative cache: remember the signature so the transcript is not re-read.
            sessions[path.stem] = {"sig": sig, "excluded": True}
            continue
        merge_subagents(stats, sub_dir)
        # cwds live in the cache only, so exclusion stays correct after the transcript is deleted.
        sessions[path.stem] = {"sig": sig, "cwds": sorted(stats.cwds), "data": stats.to_json()}
        scanned += 1
    return scanned, reused, seen


def build(claude_dir: Path, out_dir: Path, opts) -> dict:
    # A plain list of excludes is accepted too (the tests use it).
    opts = opts if isinstance(opts, IndexOptions) else make_options(excludes=opts)
    cache_path = out_dir / "cache.json"
    sessions = carry_over(load_json(cache_path), opts)
    scanned, reused, seen = scan(claude_dir, sessions, opts)
    # Summaries outlive their transcripts only within the retention window (0 keeps them all).
    cutoff = datetime.now().astimezone() - timedelta(days=opts.retention_days) if opts.retention_days else None
    sessions = {
        sid: e for sid, e in sessions.items()
        # Excluded markers only matter while their transcript exists.
        if within_retention(e, cutoff, sid in seen) and (sid in seen or not e.get("excluded"))
    }
    write_atomic(cache_path, {"schema": SCHEMA_VERSION, "options": opts.cache_key(), "sessions": sessions})
    kept = [v["data"] for v in sessions.values() if "data" in v]
    digest = {
        "schema": SCHEMA_VERSION,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "stats": {"scanned": scanned, "reused": reused, "sessions": len(kept)},
        "history": summarize_history(claude_dir / "history.jsonl", opts),
        "sessions": sorted(kept, key=lambda s: s.get("end") or ""),
    }
    write_atomic(out_dir / "digest.json", digest)
    return digest


def purge(out_dir: Path) -> list[str]:
    """Delete everything the indexer wrote; return what was removed."""
    removed = []
    if out_dir.is_dir():
        for f in sorted(out_dir.iterdir()):
            if f.is_file() and (f.name in ("digest.json", "cache.json") or f.name.endswith(".tmp")):
                f.unlink()
                removed.append(f.name)
        if not any(out_dir.iterdir()):
            out_dir.rmdir()
    return removed


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--claude-dir", default=os.path.expanduser("~/.claude"))
    ap.add_argument("--out-dir", default=os.path.expanduser("~/.claude/chronicle"))
    ap.add_argument("--exclude", action="append", default=[], help="project path prefix to skip (repeatable)")
    ap.add_argument("--risky", action="append", default=[], help="extra command substring to flag (repeatable)")
    ap.add_argument("--memory-cue", action="append", default=[], help="word meaning 'needs earlier context' (repeatable)")
    ap.add_argument("--retention-days", type=int, default=0, help="drop summaries of sessions older than this (0 keeps all)")
    ap.add_argument("--purge", action="store_true", help="delete digest.json and cache.json from --out-dir and exit")
    args = ap.parse_args(argv)
    t0 = time.monotonic()
    if args.purge:
        try:
            print(json.dumps({"ok": True, "removed": purge(Path(args.out_dir))}))
            return 0
        except OSError as exc:
            print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
            return 1
    try:
        opts = make_options(args.exclude, args.risky, args.memory_cue, args.retention_days)
        digest = build(Path(args.claude_dir), Path(args.out_dir), opts)
    except Exception as exc:  # noqa: BLE001 - any failure is reported as JSON for the mod to show
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1
    print(json.dumps({"ok": True, "seconds": round(time.monotonic() - t0, 2), **digest["stats"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""File and path helpers for the indexer: JSONL reading, exclusion matching, safe writes."""
from __future__ import annotations

import json
import os
from pathlib import Path


def iter_records(path: Path):
    """Yield each JSON object line; skip blank, malformed and non-object lines."""
    with path.open(encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(rec, dict):
                yield rec


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def normalize_path(path: str) -> str:
    """Canonical, case-folded form: resolves ~, '..', trailing '/' and symlinks."""
    return os.path.realpath(os.path.expanduser(path.strip())).casefold()


def is_excluded(project: str, excludes: list[str]) -> bool:
    """Fail closed: with any exclude set, an unknown directory counts as excluded."""
    if not excludes:
        return False
    if not project:
        return True
    p = normalize_path(project)
    return any(p == e or p.startswith(e.rstrip(os.sep) + os.sep) for e in excludes)


def any_excluded(cwds, excludes: list[str]) -> bool:
    if not excludes:
        return False
    cwds = list(cwds)
    return not cwds or any(is_excluded(c, excludes) for c in cwds)


def write_atomic(path: Path, data: dict) -> None:
    """Owner-only (0700 dir, 0600 file), per-process temp name, no symlink following, fsync."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    # O_NOFOLLOW does not exist on Windows; there the 0600 mode is best-effort anyway.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()
    os.chmod(path, 0o600)

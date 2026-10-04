"""Text helpers for the indexer: API-error classification and prompt-text extraction."""
from __future__ import annotations

import re


def classify_api_error(text: str) -> str:
    t = text.lower()
    if "session limit" in t or "weekly limit" in t or "rate limit" in t:
        return "rateLimit"
    if "usage credits" in t or "spend limit" in t:
        return "credits"
    if "authenticate" in t or "login" in t or "oauth" in t:
        return "auth"
    return "other"


def first_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                return c.get("text", "")
    return ""


def first_plain_text(content) -> str:
    """First text block typed by the person, skipping injected <tag> blocks."""
    blocks = [content] if isinstance(content, str) else [
        c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text"
    ]
    for block in blocks:
        text = re.sub(r"<([a-z_-]+)[^>]*>.*?</\1>", "", block, flags=re.DOTALL).strip()
        if text and not text.startswith("<"):
            return text
    return ""

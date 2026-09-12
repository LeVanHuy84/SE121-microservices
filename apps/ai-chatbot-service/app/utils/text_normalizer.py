from __future__ import annotations

import re
import unicodedata


def normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFC", str(value or ""))
    return " ".join(text.split())


def normalize_query_text(value: object) -> str:
    text = normalize_text(value).lower()
    text = re.sub(r"\s+", " ", text)
    return text.strip()


TEENCODE_MAP = {
    "ko": "khong",
    "k": "khong",
    "dc": "duoc",
    "đc": "duoc",
    "ntn": "nhu the nao",
    "ib": "inbox",
    "rep": "reply",
    "ad": "admin",
    "mn": "moi nguoi",
    "mik": "minh",
    "tui": "toi",
}

def normalize_for_guard(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    normalized = "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    )
    normalized = normalized.replace("\u0111", "d").replace("\u0110", "d").lower()
    normalized = re.sub(r"[^a-z0-9\s]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    tokens = [TEENCODE_MAP.get(token, token) for token in normalized.split()]
    return " ".join(tokens)


"""MaxPlus core: config, API client, cache, burn-rate math, health.

Shared by dashboard/plugin_api.py (renderer REST) and maxplus_tools.py (the
`maxplus` agent tool). All network traffic goes to api.maxplus-ai.cc only.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

PLUGIN_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = PLUGIN_ROOT / "config.json"

API_BASE = "https://api.maxplus-ai.cc"
HTTP_TIMEOUT_S = 10.0
CACHE_TTL_S = 60
DEFAULT_ALERT_USD = 1.0

KEY_RE = re.compile(r"^ccsk-[a-f0-9]{64}$")
MGMT_RE = re.compile(r"^ccmk-\S{8,}$")
POOL_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# The site's own period names are 1d/7d/30d; 24h is accepted as an alias.
PERIODS = {"24h": "1d", "1d": "1d", "7d": "7d", "30d": "30d"}
PERIOD_HOURS = {"1d": 24, "7d": 168, "30d": 720}

_lock = threading.RLock()
_cache: dict[tuple, tuple[float, object]] = {}


class MaxPlusError(Exception):
    """Carries the same error keys the UI already maps: no-token, network, http-NNN."""


# ── config ────────────────────────────────────────────────────────────

def load_config() -> dict:
    cfg: dict = {}
    if CONFIG_PATH.exists():
        try:
            loaded = json.loads(CONFIG_PATH.read_text("utf-8"))
            if isinstance(loaded, dict):
                cfg = loaded
        except Exception:
            pass
    cfg["ccsk"] = str(cfg.get("ccsk") or "")
    cfg["ccmk"] = str(cfg.get("ccmk") or "")
    try:
        cfg["alertThresholdUsd"] = float(cfg.get("alertThresholdUsd", DEFAULT_ALERT_USD))
    except (TypeError, ValueError):
        cfg["alertThresholdUsd"] = DEFAULT_ALERT_USD
    return cfg


def save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, indent=2), "utf-8")
    os.replace(tmp, CONFIG_PATH)


def mutate_config(fn) -> dict:
    """Locked read-modify-write of config.json."""
    with _lock:
        cfg = load_config()
        fn(cfg)
        save_config(cfg)
        return cfg


def mask_token(token: str) -> str:
    if not token:
        return ""
    return f"{token[:5]}…{token[-4:]}" if len(token) > 12 else f"{token[:5]}…"


def public_config() -> dict:
    """Config safe to hand to the renderer or the agent: tokens masked."""
    cfg = load_config()
    return {
        "hasCcsk": bool(cfg["ccsk"]),
        "hasCcmk": bool(cfg["ccmk"]),
        "ccsk": mask_token(cfg["ccsk"]),
        "ccmk": mask_token(cfg["ccmk"]),
        "alertThresholdUsd": cfg["alertThresholdUsd"],
        "cacheTtlSeconds": CACHE_TTL_S,
    }


def set_tokens(ccsk: str | None = None, ccmk: str | None = None) -> dict:
    """None leaves a slot untouched, '' clears it. Raises ValueError on bad format."""
    if ccsk and not KEY_RE.match(ccsk):
        raise ValueError("ccsk must be 'ccsk-' followed by 64 hex characters")
    if ccmk and not MGMT_RE.match(ccmk):
        raise ValueError("ccmk must start with 'ccmk-' (at least 8 chars after)")

    def apply(cfg: dict) -> None:
        if ccsk is not None:
            cfg["ccsk"] = ccsk
        if ccmk is not None:
            cfg["ccmk"] = ccmk

    mutate_config(apply)
    invalidate_cache()
    return {"ok": True, **public_config()}


def set_threshold(usd: float) -> dict:
    value = max(0.0, float(usd))
    mutate_config(lambda c: c.update(alertThresholdUsd=value))
    return {"ok": True, "alertThresholdUsd": value}


# ── HTTP + cache ──────────────────────────────────────────────────────

def _request(token: str, url: str, *, method: str = "GET") -> object:
    if not token:
        raise MaxPlusError("no-token")
    req = urllib.request.Request(
        url, method=method, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as res:
            body = res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise MaxPlusError(f"http-{e.code}") from None
    except Exception:
        raise MaxPlusError("network") from None
    try:
        return json.loads(body) if body else {}
    except ValueError:
        raise MaxPlusError("network") from None


def _cached(kind: str, token: str, extra: str, fetch, *, fresh: bool = False):
    # Key on a token digest so raw tokens never sit in the cache dict.
    digest = hashlib.sha256(token.encode()).hexdigest()[:12]
    key = (kind, digest, extra)
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and not fresh and now - hit[0] < CACHE_TTL_S:
            return hit[1]
    value = fetch()
    with _lock:
        _cache[key] = (time.monotonic(), value)
    return value


def invalidate_cache() -> None:
    with _lock:
        _cache.clear()


# ── API client ────────────────────────────────────────────────────────

def get_me(token: str | None = None, *, fresh: bool = False) -> dict:
    token = token if token is not None else load_config()["ccsk"]
    return _cached("me", token, "", lambda: _request(token, f"{API_BASE}/v1/me"), fresh=fresh)


def get_usage(token: str | None = None, period: str = "1d", *, fresh: bool = False) -> dict:
    token = token if token is not None else load_config()["ccsk"]
    p = PERIODS.get(str(period).lower())
    if not p:
        raise ValueError(f"period must be one of {sorted(PERIODS)}")
    return _cached("usage", token, p, lambda: _request(token, f"{API_BASE}/v1/usage?period={p}"), fresh=fresh)


def get_api_keys(mgmt_token: str | None = None, *, fresh: bool = False) -> dict:
    token = mgmt_token if mgmt_token is not None else load_config()["ccmk"]
    return _cached("keys", token, "", lambda: _request(token, f"{API_BASE}/v1/api-keys"), fresh=fresh)


def get_key_usage(key_id: str, mgmt_token: str | None = None, *, fresh: bool = False) -> dict:
    token = mgmt_token if mgmt_token is not None else load_config()["ccmk"]
    path = f"{API_BASE}/v1/api-keys/{quote(str(key_id), safe='')}/usage"
    return _cached("keyusage", token, str(key_id), lambda: _request(token, path), fresh=fresh)


def pool_base(pool: str | None) -> str:
    p = str(pool or "auto").lower()
    if not POOL_RE.match(p):
        raise ValueError("invalid pool name")
    return f"{API_BASE}/v1" if p == "native" else f"{API_BASE}/{p}/v1"


def test_key(key: str | None = None, pool: str | None = None) -> dict:
    """Connectivity check: authenticated GET <pool>/models. Never uses tokens,
    so it costs nothing and cannot hit a billing cap."""
    key = key or load_config()["ccsk"]
    if pool is None:
        try:
            pool = pick_key(get_me(key)).get("pool")
        except MaxPlusError:
            pool = None
    t0 = time.monotonic()
    try:
        _request(key, f"{pool_base(pool)}/models")
    except MaxPlusError as e:
        return {"ok": False, "pool": pool or "auto", "error": str(e), "ms": round((time.monotonic() - t0) * 1000)}
    return {"ok": True, "pool": pool or "auto", "ms": round((time.monotonic() - t0) * 1000)}


# ── response shaping ──────────────────────────────────────────────────

def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def pick_key(me: dict) -> dict:
    k = (me or {}).get("key") or {}
    f = (me or {}).get("daily_free_credit") or {}
    return {
        "pool": k.get("pool") or k.get("key_pool") or f.get("key_pool") or "auto",
        "limit": _num(k.get("limit_usd")),
        "used": _num(k.get("limit_used_usd")),
        "period": k.get("limit_period"),
        "active": k.get("active"),
        "free": {
            "enabled": bool(f.get("enabled")),
            "amount": _num(f.get("amount_usd")),
            "used": _num(f.get("used_usd")),
            "remaining": _num(f.get("remaining_usd")),
            "pools": f.get("pools") if isinstance(f.get("pools"), list) else [],
            "resetAt": f.get("reset_at"),
            "eligible": bool(f.get("eligible_for_key_pool")),
            "remainingForKeyPool": _num(f.get("remaining_for_key_pool_usd")),
        },
    }


def pick_key_list(payload: dict) -> list[dict]:
    d = (payload or {}).get("data") or payload or {}
    arr = d.get("keys") if isinstance(d, dict) else d
    return [k for k in arr if isinstance(k, dict)] if isinstance(arr, list) else []


def usage_cost(payload: dict):
    t = (payload or {}).get("totals") or payload or {}
    for name in ("total_cost_usd", "total_cost", "cost_usd"):
        if _num(t.get(name)) is not None:
            return t[name]
    return None


def remaining_usd(key: dict):
    """Spendable credit for this key: its cap headroom, else today's free credit."""
    if key["limit"] is not None and key["used"] is not None:
        return max(0.0, key["limit"] - key["used"])
    free = key["free"]
    if free["eligible"]:
        left = free["remainingForKeyPool"]
        return left if left is not None else free["remaining"]
    return None


def burn_rate(spent_usd, period: str, remaining) -> dict:
    """Hourly burn from a usage window, plus hours until `remaining` runs out."""
    hours = PERIOD_HOURS.get(PERIODS.get(period, period), 24)
    if spent_usd is None:
        return {"period": period, "spentUsd": None, "perHourUsd": None, "hoursLeft": None}
    per_hour = spent_usd / hours
    hours_left = (remaining / per_hour) if (remaining is not None and per_hour > 0) else None
    return {
        "period": period,
        "spentUsd": round(spent_usd, 4),
        "perHourUsd": round(per_hour, 4),
        "hoursLeft": round(hours_left, 1) if hours_left is not None else None,
    }


# ── high-level views (used by REST + agent tool) ──────────────────────

def balance(*, fresh: bool = False) -> dict:
    cfg = load_config()
    key = pick_key(get_me(cfg["ccsk"], fresh=fresh))
    remaining = remaining_usd(key)
    try:
        spent = usage_cost(get_usage(cfg["ccsk"], "1d", fresh=fresh))
    except MaxPlusError:
        spent = None
    return {"ok": True, "key": key, "remainingUsd": remaining, "burn": burn_rate(spent, "1d", remaining)}


def usage(period: str = "24h", *, fresh: bool = False) -> dict:
    cfg = load_config()
    payload = get_usage(cfg["ccsk"], period, fresh=fresh)
    p = PERIODS[period.lower()]
    return {"ok": True, "period": p, "spentUsd": usage_cost(payload), "raw": payload}


def keys(*, fresh: bool = False) -> dict:
    lst = pick_key_list(get_api_keys(load_config()["ccmk"], fresh=fresh))
    return {"ok": True, "count": len(lst), "keys": lst}


def health(*, fresh: bool = False) -> dict:
    """ok | warning (low credit) | error (token missing/invalid/unreachable)."""
    cfg = load_config()
    if not cfg["ccsk"]:
        return {"health": "error", "reason": "no-token", "remainingUsd": None}
    try:
        key = pick_key(get_me(cfg["ccsk"], fresh=fresh))
    except MaxPlusError as e:
        return {"health": "error", "reason": str(e), "remainingUsd": None}
    remaining = remaining_usd(key)
    if key["active"] is False:
        return {"health": "error", "reason": "key-inactive", "remainingUsd": remaining, "pool": key["pool"]}
    if remaining is not None and remaining < cfg["alertThresholdUsd"]:
        return {"health": "warning", "reason": "low-balance", "remainingUsd": remaining, "pool": key["pool"]}
    return {"health": "ok", "reason": None, "remainingUsd": remaining, "pool": key["pool"]}

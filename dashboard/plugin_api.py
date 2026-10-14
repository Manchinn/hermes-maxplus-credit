"""MaxPlus Credit plugin backend — mounted at /api/plugins/maxplus-credit/.

The renderer (desktop/plugin.js) calls these routes via ctx.rest so tokens,
caching and burn-rate math live in one Python process instead of the browser.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Load the sibling maxplus_core by path: this file is imported via
# spec_from_file_location under a synthetic module name, so plain
# `import maxplus_core` would only work by sys.path luck.
import importlib.util as _ilu
import pathlib as _pl

_spec = _ilu.spec_from_file_location(
    "maxplus_credit_core", str(_pl.Path(__file__).resolve().parent.parent / "maxplus_core.py")
)
core = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(core)

log = logging.getLogger(__name__)
router = APIRouter()


class TokensBody(BaseModel):
    ccsk: str | None = None  # None = keep, "" = clear
    ccmk: str | None = None


class TestKeyBody(BaseModel):
    key: str | None = None  # default: configured ccsk
    pool: str | None = None


class ThresholdBody(BaseModel):
    usd: float


def _guard(fn):
    """Map core errors onto HTTP: bad input -> 400, upstream failure -> 502
    carrying the UI's error key (no-token, network, http-NNN)."""
    try:
        return fn()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    except core.MaxPlusError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


@router.get("/health")
def health():
    """Cheap cached snapshot for the status bar chip."""
    return core.health()


@router.get("/config")
def config():
    return core.public_config()


@router.get("/me")
def me(fresh: bool = False):
    """Raw /v1/me passthrough (cached) for the hero card and status chip."""
    return _guard(lambda: core.get_me(fresh=fresh))


@router.get("/balance")
def balance(fresh: bool = False):
    return _guard(lambda: core.balance(fresh=fresh))


@router.get("/usage")
def usage(period: str = "24h", fresh: bool = False):
    return _guard(lambda: core.usage(period, fresh=fresh))


@router.get("/keys")
def keys(fresh: bool = False):
    return _guard(lambda: core.keys(fresh=fresh))


@router.get("/keys/{key_id}/usage")
def key_usage(key_id: str, fresh: bool = False):
    return _guard(lambda: {"ok": True, "usage": core.get_key_usage(key_id, fresh=fresh)})


@router.post("/tokens")
def tokens(body: TokensBody):
    return _guard(lambda: core.set_tokens(body.ccsk, body.ccmk))


@router.post("/threshold")
def threshold(body: ThresholdBody):
    return core.set_threshold(body.usd)


@router.post("/test-key")
def test_key(body: TestKeyBody):
    return _guard(lambda: core.test_key(body.key, body.pool))

"""Handler for the `maxplus` agent tool. Thin wrapper over maxplus_core."""

from __future__ import annotations

import json

try:
    from . import maxplus_core as core
except (ImportError, ValueError):  # loaded outside the package (flat sys.path)
    import maxplus_core as core


def maxplus(args: dict, **kwargs) -> str:
    """Dispatch the maxplus tool. Every action returns a JSON dict."""
    action = (args.get("action") or "balance").strip().lower()
    fresh = bool(args.get("fresh"))

    try:
        if action == "balance":
            return json.dumps(core.balance(fresh=fresh))

        if action == "usage":
            return json.dumps(core.usage(args.get("period") or "24h", fresh=fresh))

        if action == "keys":
            return json.dumps(core.keys(fresh=fresh))

        if action == "test":
            return json.dumps(core.test_key(pool=args.get("pool")))

        if action == "status":
            return json.dumps({"ok": True, **core.health(fresh=fresh), **core.public_config()})

        return json.dumps({"ok": False, "error": f"unknown action {action!r}"})
    except (core.MaxPlusError, ValueError) as e:
        return json.dumps({"ok": False, "error": str(e), "action": action})
    except Exception as e:
        return json.dumps({"ok": False, "error": f"unexpected: {e}", "action": action})

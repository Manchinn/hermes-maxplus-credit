"""Tool schema for the maxplus-credit plugin's `maxplus` tool."""

MAXPLUS = {
    "name": "maxplus",
    "description": (
        "Check MaxPlus (api.maxplus-ai.cc) credit without bash or curl. "
        "Actions: balance (remaining credit, active pool, hourly burn pace "
        "and hours left, default), usage (spend for 24h, 7d or 30d), keys "
        "(every API key under the management token with its spend and "
        "state), test (connectivity check of a pool with the configured "
        "key), status (overall health: ok, warning on low balance, error on "
        "missing/invalid token). Tokens are read from the plugin config and "
        "never returned."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["balance", "usage", "keys", "test", "status"],
                "description": "What to do. Default balance.",
            },
            "period": {
                "type": "string",
                "enum": ["24h", "7d", "30d"],
                "description": "Window for usage (default 24h).",
            },
            "pool": {
                "type": "string",
                "description": (
                    "Pool to test (for example auto, native). Optional: "
                    "omitted means the pool the configured key is bound to."
                ),
            },
            "fresh": {
                "type": "boolean",
                "description": "Bypass the 60 second response cache.",
            },
        },
        "required": [],
    },
}

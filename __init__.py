"""MaxPlus Credit — Hermes hybrid plugin package.

register() wires the `maxplus` agent tool (schemas + maxplus_tools). The
desktop UI is desktop/plugin.js and the backend is dashboard/plugin_api.py
(FastAPI router) which the JS hits via ctx.rest.
"""

try:
    from . import schemas, maxplus_tools
except (ImportError, ValueError):  # loaded outside the package (flat sys.path)
    import schemas
    import maxplus_tools


def register(ctx):
    """Register the `maxplus` tool so the agent can check credit and keys."""
    ctx.register_tool(
        name="maxplus",
        toolset="maxplus-credit",
        schema=schemas.MAXPLUS,
        handler=maxplus_tools.maxplus,
        description=(
            "Check MaxPlus credit: balance (remaining credit, pool, burn "
            "pace), usage (24h/7d/30d spend), keys (managed API keys and "
            "spend), test (pool connectivity), status (ok/warning/error)."
        ),
        emoji="\U0001f4b3",
        is_async=False,
    )

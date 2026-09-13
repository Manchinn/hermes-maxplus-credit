# MaxPlus Credit — Hermes Desktop plugin

🌏 README in [ไทย](README.md)

View [MaxPlus](https://maxplus-ai.cc) credit, usage and per-pool keys
inside Hermes Desktop. Bilingual UI (Thai · English).

![status page](docs/status.png)

## Install

**Install from Git** (Settings → Capabilities → Plugins) with this repo,
or click:

```
hermes://plugin/install?repo=Manchinn/hermes-maxplus-credit&enable=1
```

Or CLI (pinned — recommended):

```bash
hermes plugins install Manchinn/hermes-maxplus-credit --ref <40-char-sha> --enable
```

Then enable **MaxPlus Credit** in-app (ships opt-in).

## Usage

1. Open the **MaxPlus** page from the sidebar.
2. Add your **inference token** (`ccsk-…`) for balance + account usage.
3. Add your **management token** (`ccmk-…`) for the all-keys table.
   - `keys:read` + `usage:read` scopes are enough for read-only viewing.
   - Add `keys:update` only if you want in-plugin pool moves.

Move pool: per-key **Move** button → pick a pool → confirm.
The secret stays valid — just point your client at the shown base URL
(click it to copy).

> Moved keys 403 until clients follow — don't move a key that is in use.

## Privacy

- Tokens stay in the app's local per-plugin storage, never in this repo.
- Calls `https://api.maxplus-ai.cc` directly from your machine.
  No backend, no telemetry.
- Read-only by default; writes happen only on confirmed pool moves.

## Files

| File | What |
| --- | --- |
| `plugin.js` | The plugin (single file, no build) |
| `README.md` | Thai version (default) |
| `README.en.md` | This file |
| `LICENSE` | MIT |

Edit + save `plugin.js` — the Desktop hot-reloads within seconds
(or ⌘K → Reload desktop plugins).

## SDK

Built on `@hermes/plugin-sdk` only (`react`, `react/jsx-runtime`).
Reference: https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

MIT.

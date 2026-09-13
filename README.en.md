# MaxPlus Credit — Hermes Desktop plugin

🌏 README in [ไทย](README.md)

View [MaxPlus](https://maxplus-ai.cc/invite/ZSPXWCJB) credit, usage and per-pool keys
inside Hermes Desktop. Thai UI.

![status page](docs/status.png)

📖 [Step-by-step install](docs/INSTALL.en.md) · [ติดตั้งทีละขั้น](docs/INSTALL.th.md)

## Install

**Install from Git** (Settings → Plugins) with this repo,
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
   - Add `keys:update` only for in-plugin pool moves, freeze and cap enforcing.

The status-bar chip shows the balance (`MaxPlus $xx.xx`, polls every 60s) —
click it for an instant **summary popup**, no need to open the full page.

Move pool: per-key **Move** button → pick a pool → confirm.
The secret stays valid — just point your client at the shown base URL
(click it to copy).

Smoke test: **รัน smoke test (Run)** — checks `me → models → chat` (16 tokens) in one tap,
using this key's pool. No cURL copy-paste.

Anomaly scan: set a threshold → **สแกน (Scan)** (first scan sets the baseline,
later scans diff against it) → over-spending keys get an **แช่แข็ง (Freeze)** button
(cap → 0, restore in Dashboard).

Enforce caps: when keys lack a daily cap, an **ใส่ cap (Enforce)** bar appears —
apply a daily cap to all of them at once (always confirmed first).

> Moved keys 403 until clients follow — don't move a key that is in use.

## What each part does

| Part | Contents |
| --- | --- |
| Chip + popup (right status bar) | Balance polled every 60s · click for popup: balance + pool/status + burn pace + cap bar + compact usage with period tabs (24h / 7d / 30d: cost · requests · tokens) + open-full-page/refresh buttons |
| MaxPlus page (`/maxplus`) | Credit hero + burn pace · account usage 1d/7d/30d (24h refreshes every 15s) · smoke test · anomaly scan + freeze · keys table (search/pool filter/sort by spend) + pool moves · token fields · morning checklist |
| ⌘K commands | `MaxPlus: เปิดหน้าสถานะ (Open)` · `MaxPlus: รีเฟรชเครดิต (Refresh)` · `MaxPlus: ลบ tokens (Clear)` |

## Privacy

- Tokens stay in the app's local per-plugin storage, never in this repo.
- Calls `https://api.maxplus-ai.cc` directly from your machine.
  No backend, no telemetry.
- Read-only by default; writes happen only on confirmed actions (pool move / freeze / cap enforce).

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

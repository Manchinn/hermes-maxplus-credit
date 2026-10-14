# MaxPlus Plugin Refactor Roadmap & Hybrid Architecture Spec

> **Target Standard:** Hermes Hybrid Plugin Pattern (Agent Tool + Python Backend + Desktop UI)  
> **Reference Reference:** `cdp-manager` plugin architecture  
> **Target Repository:** `Manchinn/hermes-maxplus-credit` (`C:/Users/chinn/AppData/Local/hermes/desktop-plugins/hermes-maxplus-credit`)

---

## 1. Executive Summary & Objective

Migrate `hermes-maxplus-credit` from a client-side monolith (`plugin.js` ~1,900 lines doing direct browser `fetch()`) into a standard **Hermes Hybrid Plugin**, identical to the architecture used by `cdp-manager`.

### Core Benefits
1. **Agent Tooling:** Hermes Agent can query credit, monitor pools, and inspect API keys directly inside chat turns via a native `maxplus` tool.
2. **Unified Data Layer:** API tokens, caching, rate-limiting, and burn-rate calculations are handled by a robust Python core, not scattered across browser client memory.
3. **Desktop UI Decoupling:** Desktop UI (`desktop/plugin.js`) interacts cleanly via `ctx.rest('/api/plugins/maxplus-credit/...')`.
4. **Standard Distribution:** Plugin can be installed seamlessly via CLI (`hermes plugins install`) or Desktop GUI, with `plugin.yaml` manifest compliance.

---

## 2. Target Directory & File Layout

```text
hermes-maxplus-credit/
├── plugin.yaml                  # Plugin manifest (manifest_version 2, api_version 1, tools & dashboard)
├── __init__.py                  # Plugin entry point: registers `maxplus` agent tool
├── schemas.py                   # Tool argument schemas (JSON Schema for `maxplus`)
├── maxplus_tools.py             # Agent tool dispatcher calling maxplus_core
├── maxplus_core.py              # Pure Python engine: /v1/me, /v1/usage, /v1/api-keys, cache, config
├── config.json                  # Local persistent state (tokens, cache, polling settings - gitignored)
├── LICENSE                      # MIT
├── README.md                    # Technical documentation
├── README.en.md                 # English documentation
├── dashboard/
│   ├── manifest.json            # Dashboard & API registration for FastAPI mount
│   └── plugin_api.py            # FastAPI router mounted at /api/plugins/maxplus-credit/
├── desktop/
│   └── plugin.js                # React UI: Status bar chip, popover, /maxplus page via ctx.rest
└── docs/
    ├── ROADMAP-HYBRID-SPEC.md   # This specification
    ├── INSTALL.th.md
    └── INSTALL.en.md
```

---

## 3. Phased Implementation Roadmap

### Phase 1: Python Core Engine (`maxplus_core.py`)
- **Objective:** Encapsulate all communication with `https://api.maxplus-ai.cc` in Python.
- **Key Responsibilities:**
  - **Config Management:** Atomic JSON read/write (`config.json`) with thread locks for safe updates (`ccsk-...`, `ccmk-...`, cache ttl, alert thresholds).
  - **API Client:**
    - `get_me(token)`: queries `https://api.maxplus-ai.cc/v1/me` (account balance, user info, pool).
    - `get_usage(token, period)`: queries `/v1/usage?period=24h|7d|30d`.
    - `get_api_keys(mgmt_token)`: queries `/v1/api-keys` (lists keys, quotas, spend).
    - `test_key(key, pool)`: ping test with minimal completion request.
  - **Caching & Math:** Cache balance responses (60s TTL) to prevent rate limits. Calculate hourly burn pace and projection in Python.
  - **Health & Alerting:** Status evaluation (`ok`, `warning` if balance < threshold, `error` if token invalid).

### Phase 2: FastAPI Backend (`dashboard/manifest.json` & `dashboard/plugin_api.py`)
- **Objective:** Provide a fast, local REST interface for the Desktop UI.
- **Manifest (`dashboard/manifest.json`):**
  ```json
  {
    "name": "maxplus-credit",
    "label": "MaxPlus Credit",
    "description": "MaxPlus credit balance, usage statistics & API keys dashboard",
    "version": "1.1.0",
    "api": "plugin_api.py",
    "tab": {
      "path": "/maxplus",
      "position": "end",
      "hidden": false
    }
  }
  ```
- **Endpoints in `dashboard/plugin_api.py`:**
  - `GET /health` -> cheap cached status snapshot for the status bar chip.
  - `GET /balance` -> account balance & burn rate.
  - `GET /usage?period=24h` -> usage telemetry.
  - `GET /keys` -> list of managed API keys and spend.
  - `POST /tokens` -> update `ccsk` / `ccmk` tokens.
  - `POST /test-key` -> test a specific API key against its pool.

### Phase 3: Agent Tool (`__init__.py`, `schemas.py`, `maxplus_tools.py`)
- **Objective:** Enable Hermes Agent in chat to check credit and troubleshoot keys.
- **Tool Name:** `maxplus`
- **Actions:**
  - `balance`: Return remaining credit, currency, active pool, and burn pace.
  - `usage`: Return aggregated spend for `24h`, `7d`, or `30d`.
  - `keys`: List keys under management token, spend, and active states.
  - `test`: Test connection to a specific pool.
  - `status`: Overall service and quota health.

### Phase 4: Desktop UI Refactor (`desktop/plugin.js`)
- **Objective:** Clean up `plugin.js`, stripping away raw network calls and heavy state logic.
- **Refactoring Steps:**
  - Replace direct external `fetch('https://api.maxplus-ai.cc/...')` with `ctx.rest('/api/plugins/maxplus-credit/...')`.
  - Retain existing UI designs:
    - Status bar chip (`STATUSBAR_AREAS.right`) with dynamic color thresholds.
    - Quick-summary Popover.
    - Full dashboard page at `/maxplus`.
    - i18n support (EN/TH).
  - Move token storage option to local backend config (or retain dual sync with `ctx.storage`).

---

## 4. Worksplit Contract for Orca CLI / Claude Code

When delegating implementation to Claude Code inside Orca CLI, enforce the following boundary:

| Agent / Role | Scope / Files |
| :--- | :--- |
| **Claude Code (Engine)** | `maxplus_core.py`, `dashboard/plugin_api.py`, `dashboard/manifest.json`, `schemas.py`, `maxplus_tools.py`, `__init__.py`, and refactoring `desktop/plugin.js` to use `ctx.rest`. |
| **Hermes (Orchestrator & QA)** | Reviewing diffs, verifying `cdp-manager` parity, testing local imports, linting, and user reporting. |

---

## 5. Kickoff Directive for Claude Code via Orca

Follow the file-backed prompt rule. Run this command to kickoff work in the Claude Code pane:

```text
Please read docs/ROADMAP-HYBRID-SPEC.md and execute Phase 1 and Phase 2: build maxplus_core.py, dashboard/manifest.json, and dashboard/plugin_api.py following the cdp-manager reference architecture. Keep working tree clean and report when unit tests pass.
```

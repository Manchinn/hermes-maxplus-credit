# MaxPlus Credit — Hermes Desktop Plugin

🌏 README in [ไทย](README.md)

View [MaxPlus](https://maxplus-ai.cc) credit balance, usage statistics, and manage per-pool API keys inside **Hermes Desktop**, plus an integrated chat-based **Hermes Agent Tool**. 100% Read-only with full bilingual support (English / Thai).

![MaxPlus Credit Unified Modal](docs/status.png)

📖 [Step-by-step install](docs/INSTALL.en.md) · [คู่มือติดตั้งทีละขั้น](docs/INSTALL.th.md)

---

## Key Features

### 1. Unified Modal Dialog (Single Source of Truth)
Consolidated into a single unified modal dialog with a **Minimal High-Density (Linear Dark)** aesthetic. Locked to a single fixed width (`44rem`) to prevent window jitter or resizing when switching tabs:
* **[Overview] Tab:** 2-column Bento Grid displaying account credit balance ($), daily free credit eligibility, key active status, and period usage analytics (Requests / Tokens / Cost) with instant `1d` / `7d` / `30d` range toggles.
* **[Keys] Tab:** High-density, single-line compact key rows with status dots (active/inactive), pool tags, spend amounts, cap progress bars (when a limit is defined), and **One-Click Copy Base URL**, backed by live search and horizontal pool filters.
* **[Settings] Tab:** Input fields for inference key (`ccsk-…`) and management key (`ccmk-…`), plus an instant language switcher `[ Auto | EN | TH ]`.

### 2. Status Bar Chip & Command Palette
* **Status Bar Chip (bottom right):** Displays live credit balance, refreshed automatically every 60 seconds. Clicking opens the modal instantly.
* **Command Palette (`⌘K`):**
  * `MaxPlus: Open Modal` — Open the control modal from any page without losing your active chat.
  * `MaxPlus: Refresh` — Force-fetch fresh telemetry from upstream (bypassing cache).
  * `MaxPlus: Clear Tokens` — Reset and purge stored tokens.

### 3. Hermes Agent Tool (`maxplus`)
Interact with MaxPlus directly from your conversation with Hermes Agent:
* `maxplus balance` — Retrieve current balance, burn pace, and daily free credit status.
* `maxplus usage [period]` — Get token consumption and cost breakdown (`1d`, `7d`, `30d`).
* `maxplus keys [pool]` — Inspect all active keys or filter by pool.
* `maxplus status` — Check API connectivity and system health.

---

## Installation

### Method 1: One-Click Deep Link
Click the link below to open the install confirmation dialog in Hermes Desktop:
```
hermes://plugin/install?repo=Manchinn/hermes-maxplus-credit&enable=1
```
*(The link triggers an explicit confirmation dialog — it never auto-installs without approval.)*

### Method 2: Install from Git (Settings)
1. Open Hermes Desktop → Navigate to **Settings** → **Plugins**
2. Click **Install from Git**
3. Enter repository: `Manchinn/hermes-maxplus-credit`
4. Once installed, toggle **MaxPlus Credit** to Active (ships opt-in: `defaultEnabled: false`).

---

## Token Configuration & Privacy

For maximum privacy and security, this plugin operates under a hardened **Hybrid Architecture**:
1. **Inference Token (`ccsk-…`):** Generated in the MaxPlus Dashboard to monitor primary balance and account-wide usage.
2. **Management Token (`ccmk-…`):** Created in Dashboard → API Access with minimal read-only permissions: **`keys:read` + `usage:read`**.

> 🔒 **Security Guarantees:**
> - All tokens are stored locally on your machine in the plugin's `config.json` file (managed by the Python backend).
> - The Electron renderer only receives masked strings (`ccsk-…cdef`).
> - No telemetry or credentials are ever sent to third parties; requests communicate exclusively with `https://api.maxplus-ai.cc`.

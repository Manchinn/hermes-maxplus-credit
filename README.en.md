# MaxPlus Credit — Hermes Desktop Plugin

🌏 README in [ไทย](README.md)

View [MaxPlus](https://maxplus-ai.cc/invite/ZSPXWCJB) credit balance, usage statistics and per-pool API keys inside Hermes Desktop. Read-only plugin with full bilingual support (English / Thai).

![status page](docs/status.png)

Chip + summary popup (amounts masked in the sample):

![chip popup](docs/popup.png)

📖 [Step-by-step install](docs/INSTALL.en.md) · [ติดตั้งทีละขั้น](docs/INSTALL.th.md)

## Install

**Install from Git** (Settings → Plugins) with repo: `Manchinn/hermes-maxplus-credit`,
or click:

```
hermes://plugin/install?repo=Manchinn/hermes-maxplus-credit&enable=1
```

(The link opens the confirm dialog — it never auto-installs.)

After install the file lands at `desktop-plugins/hermes-maxplus-credit/plugin.js`
— folder name is the repo name, while the plugin `id` inside is `maxplus-credit`.
Then enable **MaxPlus Credit** in Settings → Plugins (ships opt-in: `defaultEnabled: false`).

> Tokens are not in that folder — they live in the app's per-plugin storage keyed by `id`, so reinstall/delete keeps them safely.

## Usage

1. Open the **MaxPlus Credit** modal from the status-bar chip or via Command Palette (`maxplus.open`).
2. Consolidated into a single 3-tab modal dialog:
   - **Overview:** Credit balance ($), daily free credit, cap progress, and 1d/7d/30d account usage.
   - **Keys:** All-keys table with search, pool filters, copy base URL, and cap progress.
   - **Settings:** Token fields for inference (`ccsk-…`), management (`ccmk-…`), and language toggle `[ Auto | EN | TH ]`.

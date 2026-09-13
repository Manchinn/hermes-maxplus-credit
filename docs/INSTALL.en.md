# Step-by-step install · MaxPlus Credit

> Being illustrated — screenshots landing progressively.
> หน้านี้กำลังเติมภาพประกอบ

## 1. Open installer

Desktop → **Settings → Capabilities → Plugins** → **Install from Git**,
paste:

```
https://github.com/Manchinn/hermes-maxplus-credit
```

<!-- TODO shot: 01-install-from-git.png -->

## 2. Review + install

Review the dialog → **Install** → back on the Plugins page, flip
**MaxPlus Credit** on (ships opt-in).

<!-- TODO shot: 02-enable.png -->

## 3. Add tokens

Open **MaxPlus** from the sidebar:

1. **inference (ccsk)** slot — paste `ccsk-…` from the
   [MaxPlus Dashboard](https://maxplus-ai.cc/dashboard) → Save.
2. **management (ccmk)** slot — create under Dashboard → API Access with
   `keys:read` + `usage:read` (read-only).

![status page](status.png)

## 4. Done

The status-bar chip shows your balance. Click it or ⌘K → `MaxPlus: …`.

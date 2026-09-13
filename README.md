# MaxPlus Credit — Hermes Desktop plugin

ดูเครดิต + usage + key ทุก pool ของ [MaxPlus](https://maxplus-ai.cc) ใน
Hermes Desktop · View MaxPlus credit, usage and per-pool keys inside
Hermes Desktop. UI ภาษาไทย·English.

![status page](docs/status.png)

## ติดตั้ง · Install

**Install from Git** (Settings → Capabilities → Plugins) แล้วใส่ repo นี้
หรือกดลิงก์:

```
hermes://plugin/install?repo=Manchinn/hermes-maxplus-credit&enable=1
```

หรือ CLI (ปักหมุด commit — แนะนำ · pinned, recommended):

```bash
hermes plugins install Manchinn/hermes-maxplus-credit --ref <40-char-sha> --enable
```

จากนั้นเปิดในแอป: Capabilities → Plugins → เปิด **MaxPlus Credit**
(มาแบบ opt-in) · Then enable **MaxPlus Credit** in-app.

## ใช้งาน · Usage

1. เปิดหน้า **MaxPlus** จาก sidebar · Open the **MaxPlus** page.
2. ใส่ **inference token** (`ccsk-…`) — โชว์เครดิต + usage บัญชี ·
   Add your `ccsk-…` token for balance + account usage.
3. ใส่ **management token** (`ccmk-…`) — โชว์ key ทั้งบัญชีแยกตาม pool ·
   Add your `ccmk-…` token for the all-keys table.
   - scope `keys:read` + `usage:read` ก็พอสำหรับดูอย่างเดียว ·
     enough for read-only viewing.
   - ติ๊ก `keys:update` เพิ่มถ้าจะย้าย pool จากใน plugin ·
     add it only if you want in-plugin pool moves.

ย้าย pool: กด **ย้าย pool · Move** ในการ์ด key → เลือก pool → ยืนยัน.
secret เดิมยังใช้ได้ แค่เปลี่ยน base URL ที่ client ให้ตรง
(ปุ่ม base URL กดเพื่อ copy ได้เลย).
Move pool: per-key **Move** button. The secret stays valid — just point
your client at the shown base URL (click it to copy).

> ย้ายแล้ว client ที่ใช้ key นั้นจะ 403 จนกว่า base URL จะตรง —
> อย่าย้าย key ที่งานกำลังรัน · Moved keys 403 until clients follow.

## ความเป็นส่วนตัว · Privacy

- token เก็บใน storage ของแอปเครื่องคนใช้เท่านั้น ไม่ติดไปกับ repo ·
  Tokens stay in the app's local per-plugin storage, never in this repo.
- plugin ยิง `https://api.maxplus-ai.cc` ตรงจากเครื่องคนใช้ ·
  Calls the MaxPlus API directly from your machine. No backend, no telemetry.
- อ่านอย่างเดียวโดย default — เขียนเกิดแค่ตอนกดยืนยันย้าย pool ·
  Read-only by default; writes happen only on confirmed pool moves.

## ไฟล์ · Files

| File | คืออะไร · What |
| --- | --- |
| `plugin.js` | ตัว plugin (ไฟล์เดียว ไม่มี build) · The plugin (single file, no build) |
| `README.md` | ไฟล์นี้ · This file |
| `LICENSE` | MIT |

แก้ `plugin.js` แล้ว save — Desktop โหลดใหม่เองในไม่กี่วินาที
(หรือ ⌘K → Reload desktop plugins) · Edit + save, the app hot-reloads.

## SDK

Built on `@hermes/plugin-sdk` only (`react`, `react/jsx-runtime`).
Reference: https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

MIT.

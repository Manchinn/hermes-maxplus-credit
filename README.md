# MaxPlus Credit — ปลั๊กอิน Hermes Desktop

🌏 README in [English](README.en.md)

ดูเครดิต + usage + key ทุก pool ของ [MaxPlus](https://maxplus-ai.cc/invite/ZSPXWCJB) ใน
Hermes Desktop หน้า UI ภาษาไทย

![status page](docs/status.png)

chip + popup สรุป (ยอดเงินถูกปิดในภาพตัวอย่าง):

![chip popup](docs/popup.png)

📖 [ติดตั้งทีละขั้น](docs/INSTALL.th.md) · [Step-by-step install](docs/INSTALL.en.md)

## ติดตั้ง

**Install from Git** (Settings → Plugins) แล้วใส่ repo นี้
หรือกดลิงก์:

```
hermes://plugin/install?repo=Manchinn/hermes-maxplus-credit&enable=1
```

หรือ CLI (ปักหมุด commit — แนะนำ):

```bash
hermes plugins install Manchinn/hermes-maxplus-credit --ref <40-char-sha> --enable
```

จากนั้นเปิดในแอป: Settings → Plugins → เปิด **MaxPlus Credit**
(มาแบบ opt-in)

## ใช้งาน

1. เปิดหน้า **MaxPlus** จาก sidebar
2. ใส่ **inference token** (`ccsk-…`) — โชว์เครดิต + usage บัญชี
3. ใส่ **management token** (`ccmk-…`) — โชว์ key ทั้งบัญชีแยกตาม pool
   - scope `keys:read` + `usage:read` ก็พอสำหรับดูอย่างเดียว
   - ติ๊ก `keys:update` เพิ่มถ้าจะย้าย pool / freeze / ใส่ cap จากใน plugin

chip ที่ status bar ขวาโชว์ยอดคงเหลือ (`MaxPlus $xx.xx`, poll ทุก 60 วิ) —
กดแล้วเด้ง **popup สรุป** ทันที ไม่ต้องเข้าหน้าเต็ม

ย้าย pool: กด **ย้าย pool · Move** ในการ์ด key → เลือก pool → ยืนยัน
secret เดิมยังใช้ได้ แค่เปลี่ยน base URL ที่ client ให้ตรง
(ปุ่ม base URL กดเพื่อ copy ได้เลย)

smoke test: กด **รัน smoke test** — ตรวจ `me → models → chat` 16 tokens ทีเดียว
(ใช้ pool ของ key นี้, ไม่ต้องก๊อป cURL)

จับงบไหม้: ตั้ง threshold → กด **สแกน** (ครั้งแรก = ตั้ง baseline,
ครั้งถัดไปเทียบส่วนต่าง) → key ไหนเกินมีปุ่ม **แช่แข็ง** (cap → 0, ปลดใน Dashboard)

ใส่ cap: ถ้ามี key ไม่มี daily cap จะมีแถบ **ใส่ cap** —
ใส่ daily cap ให้ทุก key ที่ขาดทีเดียว (ยืนยันก่อนเสมอ)

> ย้ายแล้ว client ที่ใช้ key นั้นจะ 403 จนกว่า base URL จะตรง —
> อย่าย้าย key ที่งานกำลังรัน

## แต่ละส่วนทำอะไร

| ส่วน | มีอะไร |
| --- | --- |
| chip + popup (status bar ขวา) | ยอดคงเหลือ poll 60 วิ · กดดู popup: ยอด + pool/สถานะ + burn pace + แถบ cap + usage ย่อแบบเลือกช่วงได้ (24 ชม. / 7 วัน / 30 วัน: cost · requests · tokens) + ปุ่มเปิดหน้าเต็ม/รีเฟรช |
| หน้า MaxPlus (`/maxplus`) | hero เครดิต + burn pace · usage บัญชี 1d/7d/30d (24 ชม. รีเฟรชทุก 15 วิ) · smoke test · จับงบไหม้ + แช่แข็ง · ตาราง key (ค้นหา/กรอง pool/เรียงตามยอด) + ย้าย pool · ช่องใส่/ลบ token · เช็กลิสต์เช้า |
| คำสั่ง ⌘K | `MaxPlus: เปิดหน้าสถานะ` · `MaxPlus: รีเฟรชเครดิต` · `MaxPlus: ลบ tokens` |

## ความเป็นส่วนตัว

- token เก็บใน storage ของแอปเครื่องคนใช้เท่านั้น ไม่ติดไปกับ repo
- plugin ยิง `https://api.maxplus-ai.cc` ตรงจากเครื่องคนใช้
  ไม่มี backend ไม่เก็บข้อมูล
- อ่านอย่างเดียวโดย default — เขียนเกิดแค่ตอนกดยืนยัน (ย้าย pool / freeze / ใส่ cap)

## ไฟล์

| File | คืออะไร |
| --- | --- |
| `plugin.js` | ตัว plugin (ไฟล์เดียว ไม่มี build) |
| `README.md` | ไฟล์นี้ (ไทย) |
| `README.en.md` | เวอร์ชันอังกฤษ |
| `LICENSE` | MIT |

แก้ `plugin.js` แล้ว save — Desktop โหลดใหม่เองในไม่กี่วินาที
(หรือ ⌘K → Reload desktop plugins)

## SDK

ใช้ `@hermes/plugin-sdk` อย่างเดียว (`react`, `react/jsx-runtime`)
อ้างอิง: https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

MIT.

# MaxPlus Credit — ปลั๊กอิน Hermes Desktop

🌏 README in [English](README.en.md)

ดูเครดิต + usage + key ทุก pool ของ [MaxPlus](https://maxplus-ai.cc/invite/ZSPXWCJB) ใน Hermes Desktop รองรับสองภาษา (EN / TH) และเป็นแบบ Read-only

![status page](docs/status.png)

chip + popup สรุป (ยอดเงินถูกปิดในภาพตัวอย่าง):

![chip popup](docs/popup.png)

📖 [ติดตั้งทีละขั้น](docs/INSTALL.th.md) · [Step-by-step install](docs/INSTALL.en.md)

## ติดตั้ง

**Install from Git** (Settings → Plugins) แล้วใส่ repo นี้: `Manchinn/hermes-maxplus-credit`
หรือกดลิงก์:

```
hermes://plugin/install?repo=Manchinn/hermes-maxplus-credit&enable=1
```

(ลิงก์เปิด dialog ให้กดยืนยันเอง ไม่ติดตั้งอัตโนมัติ)

หลังติดตั้ง ไฟล์จะอยู่ที่ `desktop-plugins/hermes-maxplus-credit/plugin.js`
— ชื่อโฟลเดอร์ใช้ชื่อ repo ส่วน `id` ข้างในคือ `maxplus-credit`
จากนั้นเปิดในแอป: Settings → Plugins → เปิด **MaxPlus Credit** (มาแบบ opt-in: `defaultEnabled: false`)

> token ไม่ได้อยู่ในโฟลเดอร์นี้ — เก็บใน storage ของแอปตาม `id`
> ลบ/ลงใหม่แล้ว token เดิมยังอยู่

## ใช้งาน

1. เปิดหน้า **MaxPlus** จาก sidebar
2. สลับภาษาได้ทันทีผ่านปุ่ม `[ Auto | EN | TH ]` ด้านบนขวา
3. ใส่ **inference token** (`ccsk-…`) — โชว์เครดิต + usage บัญชี
4. ใส่ **management token** (`ccmk-…`) — โชว์ key ทั้งบัญชีแยกตาม pool (scope `keys:read` + `usage:read` ก็เพียงพอ)

chip ที่ status bar ขวาโชว์ยอดคงเหลือ (`MaxPlus $xx.xx`, poll ทุก 60 วิ) — กดแล้วเด้ง **popup สรุป** ทันที ไม่ต้องเข้าหน้าเต็ม

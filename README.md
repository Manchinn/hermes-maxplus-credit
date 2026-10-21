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

1. เปิดหน้าต่าง **MaxPlus Credit** จาก status bar chip หรือ Command Palette (`maxplus.open`)
2. รวมศูนย์ UI ไว้ใน Modal เดียว 3 แท็บ:
   - **ภาพรวม (Overview):** ยอดเครดิตคงเหลือ ($), เครดิตฟรี, cap progress และ usage 1d/7d/30d
   - **คีย์ทั้งหมด (Keys):** ตาราง key ทุก pool พร้อมค้นหา, กรอง pool, คัดลอก base URL และ cap progress
   - **ตั้งค่า (Settings):** จัดการ token (`ccsk-…`, `ccmk-…`) และสลับภาษา `[ Auto | EN | TH ]`

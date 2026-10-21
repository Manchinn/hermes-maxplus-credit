# MaxPlus Credit — ปลั๊กอิน Hermes Desktop

🌏 README in [English](README.en.md)

ปลั๊กอินดูยอดเครดิต สถิติการใช้งาน (Usage) และจัดการ API Keys ทุก Pool ของ [MaxPlus](https://maxplus-ai.cc) บน **Hermes Desktop** พร้อมเครื่องมือสั่งการผ่านแชท (**Hermes Agent Tool**) ในตัว รองรับสองภาษา (EN / TH) และทำงานแบบ **Read-only 100%** ปลอดภัย ไร้กังวล

![MaxPlus Credit Unified Modal](docs/status.png)

📖 [คู่มือติดตั้งทีละขั้น](docs/INSTALL.th.md) · [Step-by-step install](docs/INSTALL.en.md)

---

## ฟีเจอร์หลัก (Key Features)

### 1. Unified Modal Dialog (Single Source of Truth)
รวมศูนย์หน้าจอควบคุมทั้งหมดเข้าไว้ใน Modal เดียว ดีไซน์สไตล์ **Minimal High-Density (Linear Dark)** ล็อกความกว้างคงที่ (Single Fixed Width `44rem`) หน้าต่างไม่กระตุกหรือเปลี่ยนขนาดเมื่อสลับแท็บ:
* **แท็บ [ภาพรวม] (Overview):** 2-Column Bento Grid แสดงยอดเงินคงเหลือ ($) ตัวเลขคมชัด, เครดิตฟรีต่อวัน (Daily Free Credit), สถานะการเปิดใช้งาน และสรุปการใช้งาน (Requests / Tokens / Cost) สลับดูช่วงเวลา `1d` / `7d` / `30d` ได้ทันที
* **แท็บ [คีย์ทั้งหมด] (Keys):** ตารางคีย์แบบแถวเดียวกระทัดรัด (Compact 1-Line Row) แสดง Status Dot สีเขียว/เทา, Tag ประจำ Pool, หลอด Cap Progress (ถ้ามีกำหนดลิมิต), ยอดใช้จ่ายสะสม และปุ่ม **One-Click Copy Base URL** พร้อมแถบค้นหาและชิปกรองตาม Pool
* **แท็บ [ตั้งค่า] (Settings):** ช่องจัดการ Token สำหรับโมเดล (`ccsk-…`) และการจัดการคีย์ (`ccmk-…`) พร้อมตัวเลือกสลับภาษา `[ Auto | EN | TH ]`

### 2. Status Bar Chip & Command Palette
* **Status Bar Chip (ขวาล่าง):** แสดงยอดเครดิตสด อัปเดตทุก 60 วินาที คลิกแล้วเปิด Modal ทันที
* **Command Palette (`⌘K`):**
  * `MaxPlus: Open Modal` — เปิดหน้าต่างจัดการ MaxPlus ทันทีจากทุกหน้าจอ
  * `MaxPlus: Refresh` — ดึงข้อมูลล่าสุดจาก upstream ทันที (Bypass cache)
  * `MaxPlus: Clear Tokens` — ล้างค่า Token ออกจากระบบ

### 3. Hermes Agent Tool (`maxplus`)
รองรับการสั่งงานและสอบถามผ่านแชทของ Hermes Agent ได้โดยตรง:
* `maxplus balance` — สอบถามยอดเครดิตคงเหลือ, เครดิตฟรี และอัตราการเผาเหรียญ (Burn pace)
* `maxplus usage [period]` — ตรวจสอบสรุปการใช้งานตามช่วงเวลา (`1d`, `7d`, `30d`)
* `maxplus keys [pool]` — รายงานสถานะคีย์ทั้งหมด หรือกรองเฉพาะ Pool ที่ต้องการ
* `maxplus status` — ตรวจสอบสถานะการเชื่อมต่อ API และ Health ของระบบ

---

## วิธีติดตั้ง (Installation)

### ทางเลือกที่ 1: One-Click Deep Link
คลิกลิงก์ด้านล่างเพื่อเปิดหน้าต่างยืนยันการติดตั้งบน Hermes Desktop ทันที:
```
hermes://plugin/install?repo=Manchinn/hermes-maxplus-credit&enable=1
```
*(ลิงก์จะเปิดหน้าต่างยืนยันบนแอป โดยไม่มีการติดตั้งอัตโนมัติเบื้องหลัง)*

### ทางเลือกที่ 2: ติดตั้งผ่าน Settings (Install from Git)
1. เปิด Hermes Desktop → ไปที่ **Settings** → **Plugins**
2. กดปุ่ม **Install from Git**
3. ใส่ Repository: `Manchinn/hermes-maxplus-credit`
4. หลังติดตั้งเสร็จ เปิดสวิตช์ **MaxPlus Credit** ให้เป็น Active (ค่าเริ่มต้นคือ `defaultEnabled: false`)

---

## การตั้งค่า Token (Security & Privacy)

เพื่อความปลอดภัยสูงสุด ปลั๊กอินนี้ใช้สถาปัตยกรรม **Hybrid Architecture**:
1. **Inference Token (`ccsk-…`):** นำมาจาก MaxPlus Dashboard เพื่อใช้ดูยอดเครดิตหลักและสถิติ Usage
2. **Management Token (`ccmk-…`):** สร้างใน Dashboard → API Access โดยเลือกเฉพาะสิทธิ์ **`keys:read` + `usage:read`** (Read-only) เพื่อใช้แสดงตารางคีย์ทั้งหมด

> 🔒 **ความปลอดภัยของข้อมูล:**
> - Token ทั้งหมดถูกจัดเก็บในไฟล์ `config.json` ในเครื่องของคุณเอง (ฝั่ง Python Core)
> - ตัว UI (Renderer Process) จะได้รับเฉพาะค่าที่ Mask แล้ว (`ccsk-…cdef`) เท่านั้น
> - ไม่มีการส่งต่อ Token หรือข้อมูลใดๆ ออกไปยังเซิร์ฟเวอร์ภายนอก ยกเว้นการเรียกตรงไปยัง `https://api.maxplus-ai.cc`

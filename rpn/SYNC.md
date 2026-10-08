# rpn/ — RPN V0 (โปรแกรมวางแผนของบริษัท) ฉบับออนไลน์

โฟลเดอร์นี้คือ **RPN V0** ที่บริษัทพัฒนาต่อจากหน้า admin เดิมของเรา (ต้นฉบับรันในเครื่อง เก็บข้อมูลใน IndexedDB)
ยกมาทั้งชุดแล้วต่อเข้ากับ Firestore จริงของระบบ ใช้เป็นแท็บ **วางแผนคิวงาน** และ **ภาพรวมแผน** ใน `index.html`
(ฝังเป็น iframe `rpn/RoutePlannerV0.html?embed=1&center=…` — ดู `RpnHost` ใน `index.html`)

## อัปเดตเมื่อบริษัทออกเวอร์ชันใหม่

```bash
node tools/sync-rpn.mjs "C:\Users\...\Desktop\RPN V0 Pre-Launch"
```

สคริปต์จะลบไฟล์ใน `rpn/` (ยกเว้นไฟล์ของเรา 3 ไฟล์ด้านล่าง) คัดลอกชุดใหม่มา แล้วแก้ `RoutePlannerV0.html` ให้เป็นออนไลน์
ถ้าบริษัทเปลี่ยนโครง HTML จนหาจุดแก้ไม่เจอ สคริปต์จะหยุดและบอกว่าจุดไหน — ไปแก้ใน `tools/sync-rpn.mjs`

หลังซิงก์: เปิดแท็บวางแผนกับศูนย์ `TEST_…` ดูว่าโหลดได้ แก้ร้านแล้วแอปเซลเห็นวันตรง แล้วค่อย push

## ไฟล์ของเรา (ห้ามแก้ไฟล์อื่นใน rpn/ ด้วยมือ — ซิงก์รอบหน้าจะถูกทับ)

| ไฟล์ | หน้าที่ |
|---|---|
| `rpn-online-pre.js` | โหลดหลัง `../auth.js` ก่อน `app-config.js` — guard สิทธิ์ (admin/supervisor) + redirect ไปหน้าหลักของระบบ, บังคับต้องมี `?center=` (ไม่ให้ถอยไปศูนย์ `LOCAL`) |
| `rpn-online.js` | โหลดท้ายสุด — แทน `local-extras.js`/`center.js` (LocalExtras.distCode, เตือนนำเข้าไฟล์ผิดศูนย์), ซ่อนเมนูซ้ายตอนฝัง, จดว่าเขียน Firestore แล้ว (`RPNBridge.dirty`), และเขียน **`rpnCal`** |
| `SYNC.md` | ไฟล์นี้ |

## สิ่งที่ sync-rpn.mjs ตัดออก

`local-firebase.js` (→ Firebase SDK จริง) · `auth-local.js` (→ `../auth.js`) · `local-extras.js` · `center.js` ·
`road-matrix.js` (ใช้ `road-matrix.bin` แทน) · หน้า Preview/Reset/.bat

## rpnCal — วันที่จริงที่แอปเซลใช้

RPN คำนวณวันเข้าเยี่ยมซับซ้อน (F1/F2 รายตลาด, รอบ ≤14 วันวิ่งซ้ำ +14 วัน, ช่องที่แยก ✂️ ซึ่งเลข Day เกินความยาวรอบ, End date)
แอปเซลจึง**ไม่คำนวณเอง** — `rpn-online.js` ใช้ `Runs.datesOf` (ตัวเดียวกับที่ส่งออก DMS) แล้วเก็บไว้ที่

```
plans/{ym}/routes/{สาย}.rpnCal = { v:1, ym, sig, days: { 'Day 3': { d:['2026-10-03','2026-10-17'], m:'ชื่อตลาด' } }, at }
plans/{ym}.rpnCalIndex        = { สาย: hash }
```

- เขียนพร้อมกับทุกการบันทึกสาย (เดือนที่เปิดอยู่) + คำนวณใหม่ทั้งเดือนหลังแก้ปฏิทิน + เติมสายที่ยังไม่มี/ไม่ตรงทุก 4 วิ (เขียนเฉพาะสายที่เปลี่ยน)
- `sig` = hash ของ (รหัสร้าน + days) ของร้านที่ไม่ inactive — แอปเซล (`RpnCompat` ใน `sales-app.js`) ใช้ rpnCal เฉพาะเมื่อ sig ตรง
  ถ้าไม่ตรง (มีใครแก้วันร้านโดยไม่ผ่าน RPN) ถอยไปใช้ `CalendarCtrl` เดิม
- **`hash()`/`sig()` ใน `rpn-online.js` กับ `RpnCompat` ใน `sales-app.js` ต้องเหมือนกันทุกตัวอักษร**

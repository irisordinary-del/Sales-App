# 🔄 HANDOFF NOTES — Sales-App / Route Planner
> อัปเดตล่าสุด: 2026-07-11 (session ต่อจาก HANDOFF_SESSION_2026-07-10_v2.md — เน้นแก้บั๊กที่เจอจากการรีวิวโค้ดข้อ 10 "โหมดที่ 4 + Holiday Exception" และตรวจหน้า Sales ทั้งหมด)
> **วัตถุประสงค์ไฟล์นี้**: วางในแชทใหม่แทนการเล่าย้อนทั้งหมด — บอก Claude ว่า "อ่านไฟล์นี้แล้วทำงานต่อ"

---

## ⚠️ สิ่งสำคัญที่สุดที่ Claude (แชทใหม่) ต้องรู้ก่อนเริ่ม

1. **Sandbox เป็นของใหม่ทุกแชท** — `/home/claude/` ของแชทเก่าหายไปแล้ว ไม่สามารถอ้างอิงถึงได้
2. **ไฟล์ที่ user จะอัปโหลดมาในแชทใหม่ คือไฟล์ที่ "ผ่านการแก้ไขแล้ว" จาก session นี้** (ดาวน์โหลดไว้แล้ว) **ไม่ใช่ไฟล์ต้นฉบับเดิมจาก GitHub repo** — ห้ามสันนิษฐานว่ายังไม่มีการแก้ไข ให้ตรวจเนื้อหาก่อนเสมอ
3. **งานทุกข้อใน backlog เดิม (1-10 จาก session 07-10) เสร็จหมดแล้ว** และ session นี้ (07-11) แก้บั๊กเพิ่มอีกหลายจุดที่เจอจากการรีวิว — **ยังไม่ได้อัปขึ้น GitHub เลยสักไฟล์** ของจริงบนเว็บ (Vercel) ยังเป็นเวอร์ชันเก่ากว่านี้มากอยู่
4. **ยังไม่เคยรันจริงในเบราว์เซอร์กับข้อมูลจริงเลยสักครั้ง** ทุกอย่างผ่านแค่ `node --check` + ESLint (`no-undef`) เท่านั้น — งานหลักของแชทใหม่ควรเป็น **deploy + ทดสอบจริงในเบราว์เซอร์** เป็นอันดับแรก ก่อนรับฟีเจอร์ใหม่
5. **กฎเดิมของโปรเจกต์ยังใช้อยู่**: ทำงานใน `/home/claude/` เท่านั้น ไม่ใช้ `/mnt/user-data/uploads/` โดยตรง, ตรวจ `node --check` ทุกไฟล์ .js ก่อนส่งมอบเสมอ (index.html เช็คด้วยการแยก inline `<script>` ออกมา check ทีละบล็อก), **เพิ่มใหม่ใน session นี้: ควรรัน ESLint `no-undef` ด้วย** เพราะเจอบั๊ก runtime (ตัวแปรไม่เคยถูกประกาศ) ที่ `node --check` จับไม่ได้เลย (ดูข้อ 1 ในหัวข้อ "บั๊กที่แก้ไปแล้ว")

---

## 📁 โครงสร้างโปรเจกต์ (สรุปสั้น)
- Vanilla JS + Firebase Firestore + Leaflet + Tailwind + Vercel PWA
- 3 roles: Admin, Supervisor/ASM, Sales
- GitHub: `irisordinary-del/Sales-App` (branch: main) — Vercel auto-deploy
- Firestore หลัก: `appData/{centerId}_main/plans/{YYYY_MM}/routes/{routeId}` (แผนรายเดือน), `sellout/{centerId}_{YYYY_MM}/chunks/` (ยอดขาย รองรับ fallback format เก่า `{YYYY_MM}` ด้วย), `skuDistribution/{id}` (campaigns)
- **Legacy collection ที่ยังไม่แน่ใจสถานะ**: `v1_sales_chunks` — sales-app.js ยังโหลดทั้ง collection มาใช้กับโหมดเรียง "active" ใน `Processor.stores()` — สงสัยว่าอาจเป็นของเก่าที่เลิกเขียนแล้ว (ระบบใหม่ใช้ `sellout/{centerId}_{ym}/chunks` แทน) **ยังไม่ได้เช็คให้แน่ใจ** เพราะต้องดู `store-history.js` และ `sales-dashboard.js` เพิ่ม (ยังไม่มีไฟล์ให้ตรวจในมือตอนนี้)

---

## ✅ บั๊กที่แก้ไปแล้วใน session นี้ (07-11) เรียงตามลำดับที่ทำ

### 1. 🔴 ร้ายแรงสุด — `ReferenceError: _stM is not defined` ใน `sales-app.js`
`Processor.setupRoute()` อ้างถึงตัวแปร `_stM` ที่ไม่เคยถูกประกาศไว้ที่ไหนเลยในทั้งไฟล์ (ของค้างจากตอนแก้ "ข้อ 5" อัปเดต label display — ตัวแปรที่ตั้งใจใช้จริงคือ `_mktNow` แต่เหลือชื่อเก่าค้างอีกจุด) เป็น **runtime error ที่ `node --check` จับไม่ได้** เพราะเป็น syntax ที่ถูกต้อง แต่พอรันจริงจะ throw error ทุกครั้งที่เรียก `Processor.setupRoute()` (เรียกตั้งแต่เปิดแอปครั้งแรก) ทำให้ `Processor.routeList()` ท้ายฟังก์ชันไม่ถูกเรียกเลย **→ สายวิ่ง/รายชื่อร้านไม่ขึ้นทั้งหน้า Sales**
**แก้แล้ว**: ยก `_mktNow` ออกมาเป็นตัวแปรระดับฟังก์ชัน ใช้ร่วมกัน 2 จุด (`day-label-display` และ `stores-title`)
**เพิ่มเติม**: รัน ESLint `no-undef` ทั่วทั้ง `sales-app.js` + inline script ใน `sales.html` แล้ว — ไม่พบตัวแปรไม่ประกาศอื่นอีก (นอกจาก DateUtil ที่แก้ในข้อ 2)

### 2. 🟡 Activities tab แสดงวันที่ผิดรูปแบบเสมอ (`DateUtil` ไม่ถูกโหลดในหน้า Sales)
`DateUtil` ประกาศไว้ใน `dashboard.js` เท่านั้น ซึ่งไม่ถูกโหลดใน `sales.html` เลย (โหลดแค่ `sales-app.js`, `store-history.js`, `sales-dashboard.js`, `pwa-register.js`) — โค้ดมี `typeof DateUtil !== 'undefined'` กันไว้แล้วไม่พัง แต่ผลคือหน้า "🎉 กิจกรรม" โชว์วันที่ดิบ "2026_07" แทน "ก.ค. 69" ตลอดเวลา
**แก้แล้ว**: เพิ่มฟังก์ชัน `ymToThaiShortLocal()` เบาๆ ไว้ใน `sales-app.js` เอง ไม่ต้องพึ่ง `dashboard.js` ข้ามหน้าอีกต่อไป

### 3. 🔴 บั๊กสถาปัตยกรรม — "แอดมินดูเดือนไหน" = "Sales เห็นเดือนนั้น" ทันที (ผูกติดกันผิด)
Dropdown เลือกเดือนในหน้าแอดมิน (`PlanUI.onSelect` → `App.switchPlan`) เดิมเขียน `currentPlanYM` ลง Firestore centerDoc ทันทีทุกครั้งที่แอดมินคลิกดูเดือนไหนก็ตาม — field เดียวกับที่ Sales app อ่านเพื่อตัดสินใจว่าโหลดเดือนไหน ผลคือแค่แอดมินดูเดือนอื่นเฉยๆ (หรือสร้าง Plan เดือนใหม่ล่วงหน้า ซึ่ง `createPlan()` เรียก `switchPlan()` ต่ออัตโนมัติ) **Sales ทุกคนทั้งศูนย์เห็นเดือนเปลี่ยนทันที** ทั้งที่ยังไม่ควร live
**แก้แล้ว** (`admin-data.js` + `index.html`):
- แยก "ดู" (`App._currentPlanYM`, local เท่านั้น) ออกจาก "เผยแพร่จริง" (`App._livePlanYM` + Firestore `currentPlanYM`)
- เพิ่มปุ่ม **"📢 ตั้งเป็นเดือนที่ใช้งานจริง"** (`PlanUI.publishCurrent()`) ต้องกดยืนยันชัดเจนเท่านั้นถึง publish
- เพิ่ม badge สถานะ 🟢 LIVE / ⚪ กำลังดู ข้าง dropdown
- `deletePlan()` เช็คก่อนว่าเดือนที่ลบเป็นเดือน live จริงไหม ค่อยเปลี่ยน `currentPlanYM` — เดิมเขียนทับทุกครั้งที่ลบ plan ไม่ว่าจะเกี่ยวกับ Sales หรือไม่

### 4. 🔴 `getDayLabelForCfg()` — mapping เก่าจากโหมด "fixed" บังโหมดใหม่ทุกโหมด
Firestore `set({...}, {merge:true})` เดิม merge nested object แบบ recursive — พอสลับจากโหมด "fixed" (มี `cfg.mapping`) ไปโหมดอื่น (weekday/date/cycle) `mapping` เก่าไม่ถูกลบ ค้างใน Firestore แล้ว `getDayLabelForCfg()` เช็ค `cfg.mapping` เป็นอันดับแรกก่อนเช็ค `cfg.mode` เสมอ → ใช้ mapping เก่าทับทุกโหมดที่สลับมาทีหลัง (Live Preview ไม่เจอปัญหานี้เพราะ preview ใช้ cfg สดในหน่วยความจำ ไม่ได้อ่านจาก Firestore ที่มี field ค้าง)
**แก้แล้ว** (`sales-app.js` + `index.html` + `admin-data.js`):
- `getDayLabelForCfg()` เช็ค `cfg.mode` ก่อนเสมอ ใช้ `cfg.mapping` แบบ legacy เฉพาะตอนไม่มี `mode` เลย
- `CalendarAdmin.save()` และ `App.saveCalendarConfig()` เปลี่ยนจาก `{merge:true}` → `{mergeFields:['calendarConfig','updatedAt']}` (แทนที่ `calendarConfig` ทั้งก้อน ไม่ merge ลึกจนเหลือ field ค้าง)
- **ไม่ได้แตะ** `HolidayException.confirmAll()` เพราะจุดนั้นตั้งใจใช้ `merge:true` ถูกต้องแล้ว (merge เข้า `calendarConfig.exceptions.{วันที่}` โดยไม่ทับ mode/mapping เดิม)

### 5. 🔴 Holiday Exception พังถ้าวันหยุดอยู่ต้น/ปลายเดือน (ข้ามเดือน)
`HolidayException.check()` หาวันก่อนหน้า/ถัดไปแบบไม่สนขอบเขตเดือน (เดินได้ ±7 วัน) — ถ้าวันหยุดอยู่ใกล้ต้น/ปลายเดือน `prevDate`/`nextDate` อาจตกไปอยู่คนละเดือน แต่ exception ถูกเขียนไว้แค่ใน `plans/{เดือนวันหยุด}` เดือนเดียว → พอถึงวันจริงที่อยู่คนละเดือน Sales app อ่าน `calendarConfig` จากแผนเดือนนั้น ซึ่งไม่มี exception นี้เลย → ร้านที่ควรถูกเพิ่มเข้าคิวหายไปเงียบๆ
**แก้แล้ว** (`index.html` `HolidayException.confirmAll()`):
- เขียน exception entry ซ้ำลงทุกเดือนที่เกี่ยวข้อง (เดือนวันหยุด + เดือนของ prevDate/nextDate ถ้าต่างกัน)
- ก่อนเขียนเดือนข้างเคียง เช็ค 3 อย่าง: มีแผนเดือนนั้นจริงไหม / ตั้งโหมด weekday ไว้เหมือนกันไหม / ชื่อ Day ตรงกับที่ใช้อยู่ไหม — ถ้าไม่ผ่านจะข้ามแล้วแจ้งเตือนแอดมินชัดเจนว่าเดือนไหนข้ามเพราะอะไร (ไม่ใช่พังเงียบๆ เหมือนเดิม)
- **ข้อจำกัดที่เหลืออยู่ (ไม่ใช่บั๊กโค้ด แก้ในนี้ไม่ได้)**: Sales app ใช้ `currentPlanYM` (admin กำหนดเอง) เป็นตัวบอกเดือน ไม่ใช่เดือนปฏิทินจริงอัตโนมัติ — ถ้าแอดมินยังไม่กด publish เดือนใหม่ทันเวลาตอนถึงวัน exception ข้ามเดือน ระบบจะยังไม่ทำงานถูกจนกว่าจะ publish (เป็นเรื่อง process ไม่ใช่โค้ด)

### 6. 🟡 กันข้อมูลตั้งค่าซ้ำใน Calendar Admin (weekday mode)
`CalendarAdmin._weekdayRows` เดิมไม่มี validation เลย — ถ้าตั้งชื่อ Day ซ้ำกัน หรือ 2 Day ตั้งเป็น weekday เดียวกัน แถวหลังจะทับแถวแรกแบบเงียบๆ
**แก้แล้ว**: เพิ่ม validation ก่อน save ใน `index.html` — error toast บอกชัดเจนถ้าซ้ำ ไม่ให้บันทึกจนกว่าจะแก้

### 7. 🟡 `getDateFromDay()` ไม่รองรับโหมด weekday (ยืนยันเป็น dead code ปัจจุบัน)
ตามที่ handoff เดิมเตือนไว้ — ยังไม่มีจุดไหนในไฟล์ที่มีอยู่เรียกใช้ฟังก์ชันนี้เลย (เช็คแล้วด้วย grep) จึงยังไม่กระทบอะไรตอนนี้ แต่ถ้ามีจุดเรียกใน `admin-map.js` (ไฟล์ที่ยังไม่เคยอัปโหลดมาให้ตรวจ) จะได้ `null` เงียบๆ
**แก้แล้ว**: เปลี่ยนจากคืน `null` เงียบๆ เป็น `console.warn()` ชัดเจนถ้าถูกเรียกกับโหมด weekday พร้อมเพิ่มฟังก์ชันใหม่ `getDatesFromDayInMonth(dayLabel, year, month)` ที่คืนค่าถูกต้องจริง (array ของทุกวันที่ในเดือนที่ตรงกับ Day นั้น)

---

## 📦 ไฟล์ทั้งหมดที่แก้ไขใน session นี้ (07-11) — ต้องอัปทับ GitHub
1. `sales-app.js` (บั๊ก #1, #2, #4, #7)
2. `index.html` (บั๊ก #3, #4, #5, #6)
3. `admin-data.js` (บั๊ก #3, #4)

**ไม่ได้แตะใน session นี้** (ใช้เวอร์ชันจาก session 07-10 ได้เลย): `dashboard.js`, `admin-ui.js`, `sku-distribution.js`, `sales.html`, `sw.js`

---

## 🔴 งานค้าง — เรียงตามความสำคัญ

1. **Deploy ขึ้น GitHub จริง** — อัปทับ 3 ไฟล์ข้างบน + อีก 6 ไฟล์จาก session 07-10 (`sw.js`, `dashboard.js`, `sku-distribution.js`, `sales-app.js`(ทับซ้ำ), `sales.html`, `admin-ui.js`) — **รวมทั้งหมด 8 ไฟล์**
2. **ลบไฟล์ orphaned ออกจาก GitHub repo** (ยังไม่เคยลบจริงเลยตั้งแต่ session 07-10): `sales-app_2.js`, `center-select.js`, `FEATURES_IMPLEMENTATION.js`, `firebase-chunks.js`
3. **ทดสอบจริงในเบราว์เซอร์** — ยังไม่เคยรันเลยสักครั้ง โฟกัสตามลำดับนี้:
   - หน้า Sales เปิดแอปครั้งแรก → เช็คว่าสายวิ่ง/รายชื่อร้านขึ้นปกติ (เพิ่งแก้บั๊ก `_stM` ที่เคยทำให้พังทั้งหน้า)
   - โหมดที่ 4 "ตามวันในสัปดาห์" — ตั้งค่า, สลับจากโหมด fixed มาดูว่าไม่มี mapping เก่าค้าง
   - Holiday Exception — ทดสอบวันหยุดอยู่กลางเดือน (baseline) และวันหยุดต้น/ปลายเดือน (edge case ที่เพิ่งแก้)
   - ระบบ publish plan ใหม่ — สร้าง Plan เดือนใหม่ → เช็ค badge "⚪ กำลังดู" → เปิด Sales คู่ขนานว่ายังไม่เปลี่ยน → กด "📢 ตั้งเป็นเดือนที่ใช้งานจริง" → เช็ค Sales เปลี่ยนตาม (หลัง refresh)
   - หน้ากิจกรรม (Activities tab) — เช็ควันที่โชว์เป็นไทยแล้ว ("ก.ค. 69" ไม่ใช่ "2026_07")
4. **เช็คสถานะ `v1_sales_chunks`** — สงสัยว่าอาจเป็น legacy collection ที่เลิกเขียนแล้ว (โหมดเรียง "active" ใน `Processor.stores()` ของ `sales-app.js` ยังใช้อยู่) ต้องขอไฟล์ `store-history.js` และ `sales-dashboard.js` เพิ่มเพื่อตรวจให้แน่ใจ — ยังไม่ได้ทำใน session นี้
5. รอ feature request ใหม่จาก user

---

## 💬 วิธีเริ่มแชทใหม่
บอก Claude ว่า:
> "อ่านไฟล์ `HANDOFF_SESSION_2026-07-11.md` ที่แนบมา แล้วช่วย [ระบุสิ่งที่ต้องการ เช่น ทดสอบ / deploy / เช็ค v1_sales_chunks / ทำฟีเจอร์ใหม่]"

พร้อมแนบไฟล์ที่แก้ไขแล้วทั้งหมด (list ด้านบนหัวข้อ "ไฟล์ทั้งหมดที่แก้ไข") — **ไม่ใช่ไฟล์ต้นฉบับเดิมจาก repo** — ถ้าจะให้เช็คข้อ 4 (v1_sales_chunks) ต่อ ให้แนบ `store-history.js` และ `sales-dashboard.js` มาด้วย

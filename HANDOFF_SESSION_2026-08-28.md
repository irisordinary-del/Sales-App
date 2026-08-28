# 🔄 HANDOFF NOTES — Sales-App / Route Planner (Session 2026-08-28)
> อัปเดตล่าสุด: 2026-08-28
> **วัตถุประสงค์ไฟล์นี้**: วางในแชทใหม่แทนการเล่าย้อนทั้งหมด — บอก Claude ว่า "อ่านไฟล์นี้แล้วทำงานต่อ"

---

## ⚠️ สิ่งสำคัญที่สุดที่ Claude (แชทใหม่) ต้องรู้ก่อนเริ่ม

1. **Sandbox เป็นของใหม่ทุกแชท** — ต้องรอ user แนบไฟล์ปัจจุบันกลับมาใหม่ทั้งหมด (ดูรายชื่อไฟล์ท้ายเอกสาร)
2. **ไฟล์ที่ user จะแนบมาในแชทใหม่ คือไฟล์ที่ "ผ่านการแก้ไขแล้ว" จาก session นี้** ไม่ใช่ไฟล์ต้นฉบับเดิม — ต้องตรวจสอบเนื้อหาก่อนเสมอ (เช่น เช็คว่ามี `TaskCtrl`, `AdminNav`, `_computeRollingDayLabel` อยู่แล้วหรือยัง) ก่อนสันนิษฐานว่ายังไม่มี
3. **มีบั๊ก 1 ตัวที่ระบุสาเหตุแล้วแต่ยังไม่ได้แก้จริง** — ดูหัวข้อ "🔴 งานค้าง" ด้านล่าง เป็นเรื่องเร่งด่วนที่สุด
4. **ยังไม่เคยรันทดสอบจริงในเบราว์เซอร์กับข้อมูลจริงเลยสักครั้งสำหรับงานเซสชันนี้ทั้งหมด** — ผ่านแค่ `node --check` (syntax) และ standalone simulation ด้วย node เท่านั้น แนะนำให้ทดสอบจริงก่อนใช้งานจริง โดยเฉพาะเรื่องปฏิทิน/cycle mode ที่ซับซ้อนขึ้นมาก
5. **กฎเดิมของโปรเจกต์ยังใช้อยู่**: ทำงานใน `/home/claude/` เท่านั้น, ตรวจ `node --check` ทุกไฟล์ .js ก่อนส่งมอบเสมอ (index.html เช็คด้วยการแยก inline `<script>` ออกมา check ทีละบล็อก)

---

## 📁 โครงสร้างโปรเจกต์ (สรุปสั้น)
- Vanilla JS + Firebase Firestore + Leaflet + Tailwind + Vercel PWA
- 3 roles: Admin, Supervisor/ASM, Sales
- GitHub: `irisordinary-del/Sales-App` (branch: main) — Vercel auto-deploy
- Firestore หลัก: `appData/{centerId}_main/plans/{YYYY_MM}/routes/{routeId}` (แผนรายเดือน, มี field `calendarOverride` เฉพาะสายได้แล้ว), `appData/{centerId}_main/tasks/{taskId}` (งานที่ต้องส่ง — ใหม่ session นี้)

---

## ✅ งานที่ทำเสร็จแล้วทั้งหมด (เรียงตามลำดับที่ทำ)

### 1. ฟีเจอร์ใหม่: สรุปยอดขายรายเดือนในหน้าปฏิทิน Sales
- เพิ่ม section ใต้ "เลือกตลาด" ใน day-sheet โชว์ยอดขาย/VPO/ASO/SKU ของ "ชุดร้านค้าวันนั้น" ย้อนหลัง 3 เดือน
- แก้ scope ให้ถูกต้อง (เฉพาะร้านของวันนั้น ไม่ใช่ทั้งสาย/ทั้งเดือน) ตามที่ user ชี้แจงแก้ไข 2 รอบ
- ปรับ UI ให้สวยขึ้น: badge สี ASO% (เขียว/เหลือง/แดง), progress bar

### 2. ฟีเจอร์ใหม่: "งานที่ต้องส่ง" (Tasks) — ครบวงจร
- ไฟล์ใหม่: `tasks.html`, `tasks.js`, `admin-theme.js`, `admin-nav.js`
- Admin ตั้งงานได้ 2 มิติ: ขอบเขต (ทั้งศูนย์/เจาะจงสาย) × รูปแบบวันที่ (ครั้งเดียว/ซ้ำทุกเดือน)
- หน้า Admin เป็น**ปฏิทินเต็มเดือน** (ไม่ใช่ตาราง) คลิกวันเพื่อดู/เพิ่มงาน แสดงทุกงานเป็นรายบรรทัด (ไม่ยุบรวม)
- ฝั่ง Sales: ปฏิทินมีบรรทัด 📌 เตือนงาน + day-sheet มี section งานเต็ม
- แก้บั๊ก permission-denied (ส่ง field เป็น `null` แทนที่จะไม่ส่ง field เลย — Firestore rule เข้มงวด)
- เพิ่ม Firestore rule สำหรับ `tasks/{taskId}` — **ต้อง publish rules ใหม่ด้วย**

### 3. บั๊กเก่าที่แก้ไปในปฏิทิน Sales
- `getDayLabelForCfg()` เดิมคืน `null` ถ้าวันนั้นไม่มีร้าน ทำให้กด day-sheet ไม่ได้ — แก้ให้ "Day N" มีอยู่เสมอ ไม่ขึ้นกับว่ามีร้านหรือไม่
- Market label ตัดคำแบบ `break-all` ทำให้ดูแปลก — เปลี่ยนเป็น `break-word` ตัดตามคำ
- การ์ดปฏิทินสูงไม่เท่ากันข้ามแถว (เพราะ `min-height` ไม่ใช่ `height` ตายตัว) — แก้เป็น fixed height + overflow hidden
- **บั๊กสำคัญ**: `showDaySheet()` เดาวันที่จาก parse string `dayLabel` ทำให้ผิดในโหมด weekday — แก้ให้ส่ง (year,month,day) ที่คลิกจริงผ่าน click chain แทน + เติม branch โหมด `date` ที่ขาดหายใน `getDateFromDay()`

### 4. Admin UX/UI unification
- เพิ่ม `admin-theme.js` (light/dark toggle, persist localStorage) + `admin-nav.js` (shared top nav: วางแผนสาย/Users/งานที่ต้องส่ง)
- `users.html`, `tasks.html` รองรับ dark mode เต็มรูปแบบ, สี H1 unify เป็น indigo ทั้งคู่ (เดิม tasks.html ใช้ amber)
- `index.html`: quicklinks ย้ายจากท้าย sidebar ขึ้นมาไว้หัว sidebar — **ตั้งใจไม่ทำ dark mode เต็มรูปแบบใน index.html** เพราะเนื้อหาลึกๆ ถูก render จาก JS หลายไฟล์ที่ hardcode สีไว้เยอะมาก (เป็น follow-up แยกถ้าต้องการ)

### 5. Import Excel: คอลัมน์ "Cycle Name"
- เพิ่ม detection คอลัมน์ `Cycle Name` (ลำดับตลาด เช่น 1=D01) ใน `file-manager.js` และ `admin-data.js`
- แก้บั๊ก header-collision: "Cycle Name" ชนกับคำว่า "name" (คอลัมน์ชื่อร้าน) — ย้ายลำดับเช็คให้ cycle เช็คก่อน name เสมอ
- ถ้าไม่มีคอลัมน์นี้ในไฟล์เลย → หยุด popup ยืนยันก่อน import เสมอ (ไม่ import เงียบๆ แบบเดา)
- Fallback (ถ้ายืนยัน import ต่อ): เรียงเลข Day ที่มีจริงจากน้อยไปมาก compact เป็น D01,D02,... ต่อเนื่อง (ทดสอบแล้วอุดช่องว่างถูกต้อง)

### 6. Calendar Config: ปรับปรุงใหญ่
- Live preview เต็มเดือนจริง (ไม่ใช่แค่ 7 วันแรก) รองรับทุกโหมด
- **ตัดโหมด "เลือกเองทีละวัน" (fixed) และ "ตามวันในสัปดาห์" (weekday) ออกจาก UI การเลือกใหม่** ตามคำขอ — โค้ดเดิมยังอยู่ไม่ลบ (รองรับ config เก่าที่เคยตั้งไว้ ไม่พัง)
- เหลือ 2 โหมดหลัก: **"วันที่ = Day ตรงกัน"** (ไม่แตะ) และ **"หมุนนับต่อเนื่อง"** (ปรับใหญ่)
- โหมด "หมุนนับต่อเนื่อง" แบ่งเป็น 3 หมวดย่อย:
  - **วันที่ตายตัว** (เดิม ไม่แตะ)
  - **วันในสัปดาห์ (จบเมื่อครบรอบ)** — รีเซ็ต D1 ทุกต้นเดือน จบแล้วหยุด **← มีบั๊ก ดูหัวข้อถัดไป**
  - **วันในสัปดาห์ (วนซ้ำ)** — **Redesign ใหม่ทั้งหมด**: จากเดิมรีเซ็ต D1 ทุกเดือน → เปลี่ยนเป็นนับต่อเนื่องไหลข้ามเดือนไม่มีจุดรีเซ็ตเลย ยึดจาก "วันที่อ้างอิง" (`anchorDate` + `anchorDayNum`) คงที่ 1 จุด ทดสอบยืนยันแล้วว่าคำนวณถูกต้อง (Oct28=D03 → Nov2=D07)
- เพิ่ม "วันหยุดประจำสัปดาห์" (`weeklyHolidays`) แยกจากวันหยุดเฉพาะกิจ (`holidays`) — ตัวแรก copy ข้ามเดือนได้ (ไม่ขึ้นกับเดือน) ตัวหลัง reset ทุกเดือน (ถูกต้องแล้ว)
- เพิ่ม**ตั้งค่าเฉพาะสาย (`calendarOverride`)** — ตั้ง default ของศูนย์ก่อน แล้ว override เฉพาะสายที่ต่างจาก default ได้ ผ่าน dropdown เลือกสายในหน้าเดียวกัน
- `createPlan()` (copy plan ข้ามเดือน) อัปเดตให้ copy `calendarOverride` ต่อสายไปด้วย + strip เฉพาะ `holidays` (เฉพาะกิจ) ทิ้ง แต่คง `weeklyHolidays`/anchor ไว้

### 7. Export Excel
- คอลัมน์ Day ตอนนี้โชว์**วันที่ปฏิทินจริง** (เช่น "05/11/2026") แทน "Day N" เฉยๆ — ทั้ง export สายเดียวและทุกสาย รองรับ per-route override ด้วย
- Fallback กลับไปโชว์ label เดิมถ้าคำนวณวันที่ไม่ได้ (กัน column ว่างเปล่า)

### 8. "เพิ่ม Plan เดือนใหม่" — แก้เพดานเทียม
- เดิม hardcode "วันนี้จริง + 3 เดือน" ทำให้เพิ่มเดือนใหม่ได้แค่หน้าต่างสั้นๆ ที่ขยับตามวันจริง
- แก้เป็นอิงจาก **Plan ล่าสุดที่มีอยู่แล้ว (`planList[0]`) + 3 เดือนถัดไป** — ไม่มีเพดานตายตัวอีกต่อไป
- แก้ edge case ที่เจอระหว่างทาง: `createPlan()` เดิม copy จาก "เดือนที่กำลังเปิดดูอยู่บนจอ" ซึ่งอาจไม่ตรงกับ Plan ล่าสุดที่ dropdown ใช้คำนวณ — แก้ให้ `doCreatePlan()` ส่ง source เป็น Plan ล่าสุดชัดเจนเสมอ (เพิ่ม parameter `srcYMOverride` ให้ `createPlan()`)

---

## 🔴 งานค้าง — เร่งด่วนที่สุด (ระบุสาเหตุแล้ว ยังไม่ได้แก้จริง)

### บั๊ก: Off-by-one ในโหมด "วันในสัปดาห์ (จบเมื่อครบรอบ)" และ cycle แบบวันที่ตายตัว
**อาการ**: ถ้าตั้ง "Day เริ่มต้น" ไม่ใช่ 1 (เช่น = 4) แล้ว cycle ควรจะวนกลับมาใช้เลข D01-D03 ที่ "หายไป" ตอนต้นเดือน แต่ระบบดันจบที่ D24 แล้วหยุดเฉยๆ (26,27,28 ต.ค. ว่างเปล่า ทั้งที่ควรจะเป็น D01,D02,D03)

**สาเหตุที่ยืนยันแล้ว**: โค้ดปัจจุบันตีความ `cycleDays` เป็น **"เพดานเลข Day สูงสุด"** (`if (dayNum > cycleDays) return null`) แทนที่จะเป็น **"จำนวนครั้งทั้งหมดที่ต้องนับ"** — พอ startDayNum=4 จะนับได้แค่ D4→D24 (21 ครั้ง) ไม่ใช่ 24 ครั้งเต็ม ส่วนที่ขาด 3 ครั้ง (ตรงกับ D01-D03 ที่ควรวนกลับมาใช้ตอนท้าย) หายไปเฉยๆ

**Verified ตัวเลขที่ถูกต้องแล้ว** (ยืนยันกับ user แล้วว่าตรง):
- ครั้งที่ 21 (24 ต.ค.) = D24
- ครั้งที่ 22 (26 ต.ค., ข้ามอาทิตย์ 25) = **D01**
- ครั้งที่ 23 (27 ต.ค.) = **D02**
- ครั้งที่ 24 (28 ต.ค.) = **D03**
- ครั้งที่ 25 (29 ต.ค.) = เกิน 24 แล้ว → หยุดจริง (ว่าง) — ตรงกับสิ้นเดือนพอดี

**แนวทางแก้ที่ user เห็นด้วยแล้ว** (แค่ยังไม่ได้ลงมือ):
นับจำนวนครั้งสะสม (`workdays`) แทนการดูค่า `dayNum` ตรงๆ พอครบจำนวนครั้งที่ `cycleDays` กำหนด ให้ **วนเลข Day กลับไปเริ่มที่ 1** (ไม่ใช่กลับไปที่ `startDayNum`) เพื่อใช้เลขที่ "หายไปตอนต้น" ให้ครบ แล้วค่อยหยุดจริงตอนครบ `cycleDays` ครั้ง

**จุดที่ต้องแก้ (โค้ดเดิมยังไม่แตะ)**:
1. `sales-app.js` — `CalendarCtrl.getDayLabelForCfg()` ใน branch `cfg.mode === 'cycle'` ที่ไม่ใช่ `weekday-rolling` (บรรทัดมี comment `// ✅ "วันในสัปดาห์ (จบเมื่อครบรอบ)" และโหมดอิงวันที่แบบเดิม: จบรอบแล้วไม่มี Day ต่อ`)
2. `sales-app.js` — `CalendarCtrl.getDateFromDay()` cycle branch (reverse lookup) ต้องรองรับ wraparound เดียวกัน
3. `index.html` — `CalendarAdmin._computeDayLabel()` cycle branch (ที่ไม่ใช่ weekday-rolling) — ต้องแก้ให้ preview ตรงกับของจริง
4. `file-manager.js` — `FileManager._resolveCalendarDate()` cycle branch (ที่ไม่ใช่ weekday-rolling) — export ต้องคำนวณ wraparound ถูกด้วย

**⚠️ ระวัง**: อย่าไปแก้ผิดจุด — โหมด `weekday-rolling` (วนซ้ำ) ที่ redesign ไปแล้วใน session นี้ **ไม่มีบั๊กนี้** เพราะเป็นคนละ branch/algorithm กันอยู่แล้ว (นับต่อเนื่องข้ามเดือนแบบ perpetual) บั๊กนี้อยู่เฉพาะ branch เดิม (`else` ที่ไม่ใช่ weekday-rolling) เท่านั้น

---

## 🟡 Technical debt ที่เคยพบแล้วยังไม่แก้ (ความสำคัญรองลงมา)

1. Header-detection logic ยังก็อปโครงสร้างซ้ำ 2 ไฟล์ (`file-manager.js` / `admin-data.js`)
2. `SalesDashboard`/`SupervisorDashboard` มีฟังก์ชันคู่แฝดซ้ำเยอะ (`_fmt`, `_amt`, `_loadMonthList` ฯลฯ)
3. `Auth.saveAllUsers()` ยังใช้ `merge:false` เขียนทับทั้งก้อน — เสี่ยง race ถ้าแก้ user จาก 2 tab พร้อมกัน
4. ไม่มี validation ว่า `anchorDayNum` ต้องอยู่ในช่วง 1..cycleDays (โหมด weekday-rolling)
5. ไม่มีคำเตือนตอนสลับ `anchorType` ของสายที่มีร้านจัดไว้แล้ว — ความหมายของ Day N เปลี่ยนไปทันทีแบบเงียบๆ
6. Performance: `_computeRollingDayLabel` (weekday-rolling) วน loop ทีละวันจาก anchorDate — ถ้า anchor เก่าไปหลายปีจะช้าขึ้นเรื่อยๆ (ทดสอบแล้ว 2 ปี = ~22,000 รอบ/เดือนที่เปิดดู ยังเร็วพอ ไม่เร่งด่วน) เคยลองร่าง closed-form optimization แต่มีบั๊กเรื่องเครื่องหมายลบ ยังไม่แก้เสร็จ — ไม่ต้องรีบทำ
7. ไม่มีทาง "resync" ถ้าแก้ `anchorDate` ย้อนหลังหลังจากเดือนหน้าถูก copy ไปแล้ว (เดือนหน้าจะไม่ sync ตามอัตโนมัติ)

---

## 📦 ไฟล์ทั้งหมดที่แก้ไข/สร้างใหม่ใน session นี้ (ต้องแนบมาแชทใหม่ทั้งหมด)
1. `sales-app.js` (แก้เยอะสุด — ปฏิทิน, TaskCtrl, day-sheet, cycle logic)
2. `admin-data.js` (createPlan, saveRouteCalendarOverride, header detection, เพิ่ม Plan เดือนใหม่)
3. `file-manager.js` (header detection, export date resolution)
4. `index.html` (CalendarAdmin ทั้งหมด, sidebar quicklinks)
5. `tasks.html` **(ใหม่)**
6. `tasks.js` **(ใหม่)**
7. `admin-theme.js` **(ใหม่)**
8. `admin-nav.js` **(ใหม่)**
9. `users.html` (dark mode + nav)
10. `sw.js` (เพิ่ม precache: tasks.html, tasks.js, admin-theme.js, admin-nav.js)
11. `firestore.rules` (เพิ่ม rule สำหรับ `tasks/{taskId}`) — **ต้อง publish ใหม่ด้วย ไม่งั้น tasks.html save ไม่ได้**

ไฟล์ที่ไม่ได้แตะ session นี้ (ไม่ต้องแนบก็ได้ แต่แนบไว้ก็ไม่เสียหาย): `login.html`, `center-select.html`, `center-select.js`, `app-config.js`, `app-config-init.js`, `auth.js`, `admin-ui.js`, `admin-map.js`, `admin-ai.js`, `sku-distribution.js`, `store-history.js`, `sales-dashboard.js`, `dashboard.js`, `users.js`, `audit-log.js`, `pwa-register.js`, `manifest.json`, `vercel.json`, `admin-style.css`, `sales-style.css`, `migrate-to-plans.html`

---

## 💬 วิธีเริ่มแชทใหม่
บอก Claude ว่า:
> "อ่านไฟล์ `HANDOFF_SESSION_2026-08-28.md` ที่แนบมา แล้วช่วยแก้บั๊ก wraparound ที่ค้างไว้"

พร้อมแนบไฟล์ทั้งหมดในลิสต์ "ไฟล์ทั้งหมดที่แก้ไข/สร้างใหม่" ด้านบน — **ไม่ใช่ไฟล์ต้นฉบับเดิมจาก repo**

**อย่าลืม publish `firestore.rules` ใหม่ด้วย** ถ้ายังไม่ได้ทำตั้งแต่ตอนทำฟีเจอร์ tasks

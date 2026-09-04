# 📁 Working Files Registry — Route Planner
> อัพเดทล่าสุด: 2026-07-13
> ⚠️ ทุกครั้งที่แก้ไฟล์ ให้ดึงจาก /home/claude/ เท่านั้น ไม่ใช่จาก /mnt/user-data/uploads/

## 🆕 Session ใหญ่ (2026-07-12 → 2026-07-13) — Firestore connection fix + Cross-center bug + UX pass + Toggle feature

### 🔴 Root-cause fixes (กระทบ user จริง)
- **`experimentalForceLongPolling`** เพิ่มใน `sales-app.js` + `app-config.js` — แก้ error
  `WebChannelConnection RPC 'Listen' stream transport errored` ที่วนซ้ำมาตลอดหลาย session
  (เครือข่ายบางที่บล็อก Firestore streaming แต่ยอม long-polling) — นี่คือรากของปัญหา "ยอดขายไม่ขึ้น"
  ที่แท้จริง ไม่ใช่แค่ race condition ที่แก้ไปก่อนหน้า
- **targets/{ym} ไม่มี centerId prefix** — ศูนย์ไหนบันทึกทีหลังทับของศูนย์อื่นทั้งเดือน แก้ครบ 6 จุด
  ใน `dashboard.js` + `sales-dashboard.js` (ดูรายละเอียดใน `bugfix-log.md` [2026-07-13])
  **⚠️ ต้องให้ทุกศูนย์ตั้ง Target ใหม่หลัง deploy — ข้อมูลเก่าอาจถูกทับไปแล้ว**
- **Column "สายวิ่ง" ตรวจจับสายไม่ได้** — แก้ลำดับ if-else ใน `file-manager.js` (bulkImport) และ
  `admin-data.js` (handleMapUpload) ดูรายละเอียดใน `bugfix-log.md`
- **`_showDataWarning()` signature ไม่ตรงกับตอนเรียก** — banner โชว์ข้อความเพี้ยน ปุ่มลองใหม่ไม่ทำงาน
  แก้ใน `sales-dashboard.js`
- **`store-history.js` init() หาเดือนไม่เจอ** — regex เดิมจับได้แค่ `YYYY_MM` ไม่รองรับ centerId prefix
  พังหลังลบเอกสาร legacy ที่ไม่มี prefix ทิ้ง แก้ให้ตรวจจับทั้ง 2 รูปแบบเหมือน `SalesDashboard._loadMonthList`

### 🟡 UX improvement pass
- `ErrorMsg.translate(e)` — แปล Firebase error code → ข้อความไทย เพิ่มใน `app-config.js`,
  `app-config-init.js`, `sales-app.js` ใช้แล้วใน `admin-data.js`, `dashboard.js`, `sku-distribution.js`,
  `users.js` (⚠️ ยังเหลือ 15 จุดใน admin-data.js/admin-ai.js/file-manager.js ที่ยังโชว์ `err.message` ดิบ)
- แยก state "กำลังโหลด / ไม่มีข้อมูลจริง / โหลดพลาด" ใน `sales-dashboard.js` — เดิมโชว์ "—" เหมือนกันหมด
- Route Analysis (`dashboard.js`) แยกสี "—" (ไม่มีแผน) vs "⚠️ 0 ร้านในแผน" (มีแผนแต่ผิดปกติ)
- `center-select.js` เปลี่ยน `prompt()` ดิบ → modal ธีมแอป พร้อม validation
- เพิ่ม confirm summary ก่อนบันทึกปฏิทินโหมด "ตามวันในสัปดาห์" ใน `index.html`
- Supervisor Activity tab: empty-state + hint banner อธิบาย scope ให้ชัด (`sales-app.js`)

### 🟢 Feature ใหม่: Toggle รายเดือน / รวมทุกเดือน
เพิ่มปุ่มสลับมุมมองในการ์ด KPI เดิม (ไม่สร้างหน้าใหม่) ทั้ง 3 หน้า:
- `SalesDashboard.setViewMode()` + `_loadAllMonths()` — `sales-dashboard.js`
- `SupervisorDashboard.setViewMode()` + `_loadAllMonths()` — `sales-dashboard.js`
- `Dashboard.setViewMode()` + `_loadAllMonths()` — `dashboard.js` (มี guard กัน `_openTargetModal`/
  `_saveTargets` ทำงานตอนอยู่โหมด `__all__` เพราะ Target ผูกกับเดือนเดียวเสมอ)
- HTML toggle button เพิ่มใน `sales.html`

### 📊 ไฟล์นำเสนอที่สร้างเพิ่ม (ไม่ใช่โค้ดระบบ)
`RoutePlan_Workflow.pptx`, `RoutePlan_SetupGuide.pptx`, `RoutePlan_Purpose_WorkflowCompare.pptx`

---

## 🧹 Cleanup (2026-07-09) — ลบไฟล์ orphaned/ไม่ได้ใช้งานจริง
ตรวจสอบทั้ง repo (syntax check + onclick/namespace wiring check ทุกไฟล์) พบว่าไฟล์ต่อไปนี้**ไม่ได้ถูกโหลด**จาก index.html/sales.html/center-select.html เลย จึงลบออกจาก working directory:
- `sales-app_2.js` — เวอร์ชันเก่ากว่า sales-app.js (ขาด campaign icons, ขาด `_ok` flag, ขาด centerId fix)
- `center-select.js` — center-select.html มี Modal/App logic ของตัวเองแบบ inline `<script>` แทนแล้ว ไม่ได้เรียกไฟล์นี้
- `FEATURES_IMPLEMENTATION.js` — stub เริ่มต้นโปรเจกต์ ถูกแทนที่หมดแล้ว ไม่ได้ถูก include ที่ไหน
- `firebase-chunks.js` (ChunkDB) — ระบบเปลี่ยนไปใช้ chunk structure ใน `sellout/` แทนแล้ว ไม่ได้ถูก include ที่ไหน

**ต้องทำเพิ่มตอน deploy จริง**: ลบ 4 ไฟล์นี้ออกจาก GitHub repo ด้วย (ตอนนี้ลบแค่ใน working dir ของ Claude เท่านั้น)
ปรับ `sw.js` แล้ว — เอา `/firebase-chunks.js` และ `/center-select.js` ออกจาก `STATIC_ASSETS` precache list (ของเดิมอ้างถึงไฟล์ที่ไม่มีแล้ว)

## ✅ Bug Audit (2026-07-09)
ตรวจ syntax ทุกไฟล์ .js (node --check) + ตรวจ onclick/namespace wiring ทุกหน้า → **ไม่พบบั๊กใหม่ที่ทำให้ระบบพัง**
BUG-01 ถึง BUG-10 จาก PROJECT_ANALYSIS.md (2026-05-13) ยืนยันว่าแก้ครบทุกตัวแล้วในโค้ดปัจจุบัน

---

## 🔴 กฎสำคัญ
- **อย่าดึงไฟล์จาก `/mnt/user-data/uploads/` มาแก้** — เป็น version เดิมที่ user upload มา patch จะหาย
- ใช้ `/home/claude/<filename>` เป็น working copy เสมอ
- **ทุกครั้งที่ deploy ใหม่ ให้ bump `CACHE_VERSION` ใน `sw.js`** เพื่อให้ผู้ใช้ได้ไฟล์ใหม่อัตโนมัติ (ปัจจุบัน: `rp-v5`)

---

## 🗄️ Firestore Structure
```
appData/{centerId}_main/plans/{ym}/routes/{routeId}  ← plan รายเดือน
sellout/{YYYY_MM}/chunks/                             ← ยอดขาย format เก่า (มีข้อมูลจริง)
sellout/{CID}_{YYYY_MM}/chunks/                       ← ยอดขาย format ใหม่ (หลัง deploy dashboard.js ใหม่)
targets/{CID}_{YYYY_MM}                               ← targets รายสาย (✅ แก้ 2026-07-13 — เดิมไม่มี CID prefix
                                                          ทำให้ศูนย์ทับกัน ดู bugfix-log.md)
targets/{YYYY_MM}                                     ← format เก่า (legacy fallback อ่านอย่างเดียว ไม่เขียนแล้ว)
skuDistribution/{id}                                  ← campaigns
auditLogs/{centerId}/logs/{logId}
appData/app_users
appData/app_centers                                   ← รายชื่อศูนย์ทั้งหมด { centerId: {name, docId, routeCount} }
```

**หมายเหตุ sellout path:**
- ข้อมูลเก่า (ม.ค.-พ.ค. 2569) อยู่ที่ `sellout/2026_01` ถึง `2026_05`
- ข้อมูลใหม่ (หลัง deploy dashboard.js ล่าสุด) จะเขียนที่ `sellout/402_2026_06` เป็นต้นไป
- `sales-dashboard._loadChunks` มี fallback รองรับทั้ง 2 format

**หมายเหตุ targets path (สำคัญ):**
- ก่อน 2026-07-13 เขียนที่ `targets/{ym}` เฉยๆ ไม่มี centerId — เป็นบั๊กร้ายแรง ศูนย์ไหนบันทึกทีหลัง
  จะเขียนทับ (`.set()` ไม่มี merge) ลบ target ของศูนย์อื่นทั้งเดือนทิ้งหมด
- หลังแก้ เขียน/อ่านที่ `targets/{CID}_{ym}` เป็นหลัก มี fallback อ่าน `targets/{ym}` เก่าเผื่อไว้
- **Target ทุกเดือนที่เคยตั้งไว้ก่อนแก้บั๊กนี้ไม่น่าเชื่อถือ 100%** — แนะนำให้ทุกศูนย์ตั้งใหม่หลัง deploy

---

## 📂 ไฟล์หลักและ Patch ที่มี

### sales-app.js
**Path**: `/home/claude/sales-app.js`
**Patches จาก session ก่อนหน้า:**
- ✅ ชื่อร้านลอยบนหมุดแผนที่
- ✅ ปฏิทิน cell min-height:68px
- ✅ planCache `_ok` flag
- ✅ loadPlanData/loadPlanDataForSup `_ok` flag
**Patches session นี้ (2026-06-15):**
- ✅ `State.centerId` set สำหรับ sales role (แก้ bug ยอดขายไม่ขึ้น)
- ✅ `_loadCampaignIcons` โหลดข้อมูลทุกเดือนใน campaign range (ไม่ใช่แค่เดือนนี้)
- ✅ campaign icon แสดงข้าง KPI button เฉพาะร้านที่ซื้อสินค้าจริง
- ✅ `Processor.routeList()` guard เช็ค `State.currentDay` ก่อนเรียก
- ✅ `State.currentDay.replace()` null-safe fix

### sales-dashboard.js
**Path**: `/home/claude/sales-dashboard.js`
**Patches จาก session ก่อนหน้า:**
- ✅ `_loadChunks` in-flight deduplication
- ✅ skeleton loading, `_ok` flag, no error cache
- ✅ SupervisorDashboard `_loadData` + `_loadMonthList`
**Patches session นี้ (2026-06-15):**
- ✅ `_loadMonthList` รองรับ 2 format: prefer `{CID}_{YYYY_MM}` fallback `{YYYY_MM}`
- ✅ `_loadChunks` fallback เช็ค `rows.length === 0` แทน `snap.empty` (แก้ bug chunks ว่าง)
- ✅ SupervisorDashboard `_loadMonthList` รองรับ 2 format เช่นกัน
- ✅ campaign section `listSnap` filter `YYYY_MM` เท่านั้น

### dashboard.js
**Path**: `/home/claude/dashboard.js`
**Patches จาก session ก่อนหน้า:**
- ✅ `_loadMonthList` ymKeyMap รองรับ 2 format
- ✅ `_loadPlan` fallback ไปเดือนก่อนหน้าถ้า plan ว่าง
- ✅ upload speed: parallel 2 chunks + delay 300ms + retry 5 รอบ backoff
**Patches session นี้ (2026-06-15):**
- ✅ `_saveToFirestore` เขียนที่ `sellout/{CENTER_ID}_{YYYY_MM}` แยกตามศูนย์
- ✅ campaign detail modal: tab per group + Daily tab (group selector)
- ✅ `_openCampaignDetail` แสดงตาราง สาย × วัน รายวัน
- ✅ `groupData` hoist ออกมาก่อน tabContents (แก้ ReferenceError)

### admin-data.js
**Path**: `/home/claude/admin-data.js`
**Patches:**
- ✅ `_loadAllRoutes` non-blocking (route ที่เหลือ load background)
- ✅ Route load progress popup (มุมขวาล่าง)
- ✅ `_loadPlan` fallback plan ว่าง → ไปเดือนก่อนหน้า
- ✅ `_loadPlan` ตรวจ fake route `['สายที่ 1']` → fallback
- ✅ `StoreMgr.reactivateStore` + `permanentDelete`

### admin-ui.js
**Path**: `/home/claude/admin-ui.js`
**Patches:**
- ✅ section "💤 ร้านที่พัก" ใต้ list-assigned
- ✅ `showRouteLoadPopup` / `updateRouteLoadPopup` / `hideRouteLoadPopup`
- ✅ stats ไม่นับ inactive stores

### sku-distribution.js
**Path**: `/home/claude/sku-distribution.js`
**Patches session นี้ (2026-06-15):**
- ✅ ฟอร์ม campaign เพิ่มช่องรูปสินค้า (upload → resize 64×64px → Base64)
- ✅ `_processIcon` resize + crop center + แปลง JPEG base64
- ✅ `_previewIcon` แสดง preview real-time
- ✅ `saveCampaign` บันทึก `iconUrl` (base64) ลง Firestore
- ✅ populate iconUrl ตอน edit campaign

### store-history.js
**Path**: `/home/claude/store-history.js`
- ✅ `_loadYm` share `SalesDashboard._loadChunks` cache

### file-manager.js
**Path**: `/home/claude/file-manager.js`
- ✅ bulkImport detect ร้านหายไป → popup เลือก "พัก" หรือ "ลบ"
- ✅ inactive flag + reactivate อัตโนมัติ

### admin-map.js
**Path**: `/home/claude/admin-map.js`
- ✅ `renderMarkers` ซ่อน `store.inactive`

### firestore.rules
**Path**: `/home/claude/firestore.rules`
- ✅ **v3.0** — deny-by-default ย้ายล่างสุด (แก้ bug 400 Bad Request)
- ✅ specific rules ก่อน: appData, sellout, targets, skuDistribution, auditLogs
- ✅ auditLogs: create-only ลบ/แก้ไม่ได้
- ⚠️ **ต้อง Publish ใน Firebase Console ทุกครั้งที่แก้**

### sw.js
**Path**: `/home/claude/sw.js`
- ✅ `CACHE_VERSION = 'rp-v5'` (bump ทุกครั้งที่ deploy เพื่อล้าง cache อัตโนมัติ)
- ⚠️ **ต้อง bump version ทุกครั้งที่ deploy ไฟล์ใหม่**

### index.html / sales.html / app-config.js
**Path**: `/home/claude/`
- ✅ Firebase Storage SDK ถูกถอดออกแล้ว (ใช้ base64 แทน)
- ✅ `window.CENTER_ID` และ `window.CENTER_DOC` set จาก session

---

## 🚀 Deploy Checklist
- [ ] Push ไฟล์ที่แก้ขึ้น GitHub (branch: main)
- [ ] รอ Vercel auto-deploy เสร็จ
- [ ] Publish `firestore.rules` ใน Firebase Console → Firestore → Rules
- [ ] **Bump `CACHE_VERSION` ใน `sw.js`** ทุกครั้ง
- [ ] Admin อัปโหลดยอดขายใหม่หลัง deploy `dashboard.js` (เพื่อใช้ path ใหม่)
- [ ] **⚠️ (ใหม่ 2026-07-13) ทุกศูนย์ต้องตั้ง Target รายสายใหม่หลัง deploy** — เพราะบั๊ก cross-center
      ทำให้ target เดิมไม่น่าเชื่อถือ (ดู bugfix-log.md)

---

## 🔗 Links
- **GitHub**: https://github.com/irisordinary-del/Sales-App (branch: main)
- **Vercel (main)**: https://sales-assis-app.vercel.app/
- **Vercel (staging)**: https://sales-app-7ids.vercel.app/
- **Firebase Console**: https://console.firebase.google.com/project/route-plan-71e2e

---

## 🐛 Bug ที่ยังค้าง
- BUG-03: file-manager bulkImport route name อาจซ้ำ
- BUG-05: sales-app docMain ชี้ผิด doc ตอน drag reorder
- BUG-08: admin-data duplicate toast ใน clearAllAssignments
- BUG-09 (2026-07-13, low priority): `err.message` ดิบยังหลุดไป user 15 จุด ใน `admin-data.js`,
  `admin-ai.js`, `file-manager.js` — ยังไม่ได้เปลี่ยนเป็น `ErrorMsg.translate()` (ไม่ทำให้พัง แค่ user
  เห็นข้อความอังกฤษ/technical)
- BUG-10 (2026-07-13, low priority): `store-history.js` บรรทัด ~88 มี fallback path อ่าน sellout
  ด้วย ym ไม่มี centerId prefix — เป็น dead code ในทางปฏิบัติ (ทางหลักที่ผ่าน
  `SalesDashboard._loadChunks` ถูกต้องอยู่แล้ว) แต่ถ้า SalesDashboard โหลดไม่ทันจะพัง ควรแก้ให้ตรงด้วย
- BUG-11 (2026-07-13, low priority): `SalesDashboard._initOfflineListener()` ไม่มี guard กันผูก
  event listener ซ้ำถ้า `init()` ถูกเรียกมากกว่า 1 ครั้ง — ปัจจุบันไม่มีจุดที่เรียกซ้ำจริง ปลอดภัยอยู่
  แต่เสี่ยงถ้า refactor ในอนาคต

---

## ⚠️ Security Notes
- app_users read ยังเปิด → แก้สมบูรณ์ต้องเปลี่ยนเป็น Firebase Auth
- Salt ใน auth.js เป็น static string
- Role check ทำใน client-side JS
- Blaze plan: ผูกบัตรแล้ว ต้องตั้ง Budget Alert ป้องกันค่าใช้จ่าย

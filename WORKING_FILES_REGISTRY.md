# 📁 Working Files Registry — Route Planner
> อัพเดทล่าสุด: 2026-06-15
> ⚠️ ทุกครั้งที่แก้ไฟล์ ให้ดึงจาก /home/claude/ เท่านั้น ไม่ใช่จาก /mnt/user-data/uploads/

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
targets/{YYYY_MM}                                     ← targets รายสาย
skuDistribution/{id}                                  ← campaigns
auditLogs/{centerId}/logs/{logId}
appData/app_users
```

**หมายเหตุ sellout path:**
- ข้อมูลเก่า (ม.ค.-พ.ค. 2569) อยู่ที่ `sellout/2026_01` ถึง `2026_05`
- ข้อมูลใหม่ (หลัง deploy dashboard.js ล่าสุด) จะเขียนที่ `sellout/402_2026_06` เป็นต้นไป
- `sales-dashboard._loadChunks` มี fallback รองรับทั้ง 2 format

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

---

## ⚠️ Security Notes
- app_users read ยังเปิด → แก้สมบูรณ์ต้องเปลี่ยนเป็น Firebase Auth
- Salt ใน auth.js เป็น static string
- Role check ทำใน client-side JS
- Blaze plan: ผูกบัตรแล้ว ต้องตั้ง Budget Alert ป้องกันค่าใช้จ่าย

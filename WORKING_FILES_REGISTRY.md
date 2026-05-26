# 📁 Working Files Registry — Route Planner
> อัพเดทล่าสุด: 2026-05-26
> ⚠️ ทุกครั้งที่แก้ไฟล์ ให้ดึงจาก /home/claude/ เท่านั้น ไม่ใช่จาก /mnt/user-data/uploads/

---

## 🔴 กฎสำคัญ
**อย่าดึงไฟล์จาก `/mnt/user-data/uploads/` มาแก้**
เพราะเป็น version เดิมที่ user upload มาตั้งแต่ต้น patch ทั้งหมดจะหาย
ให้ใช้ `/home/claude/<filename>` เป็น working copy เสมอ

---

## 📂 ไฟล์หลักและ Patch ที่มี

### sales-app.js
**Path**: `/home/claude/sales-app.js`
- ✅ ชื่อร้านลอยบนหมุดแผนที่ (bottom:42px, text-shadow)
- ✅ ปฏิทิน cell min-height:68px, -webkit-line-clamp:3
- ✅ planCache _ok flag (กัน cache empty จาก error)
- ✅ loadPlanData hasOwnProperty check
- ✅ loadPlanDataForSup hasOwnProperty + no error cache
- ✅ _bgLoadMonth ใช้ _ok flag
- ✅ openPopup ใช้ _ok flag + ลบ stale null cache clear

### sales-dashboard.js
**Path**: `/home/claude/sales-dashboard.js`
- ✅ _loadChunks in-flight deduplication (_chunkInflight)
- ✅ _loadChunks ไม่ cache [] เมื่อ error
- ✅ _loadData (Sales) hasOwnProperty rowCache
- ✅ _loadData ไม่ cache เมื่อ allRows ว่างจาก error
- ✅ onMonthChange ลบ duplicate cache write
- ✅ onMonthChange skeleton loading
- ✅ SupervisorDashboard._loadData hasOwnProperty + no error cache
- ✅ SupervisorDashboard._loadMonthList skeleton + background preload
- ✅ _renderCampaigns prodOptions ใช้ _loadChunks cache

### store-history.js
**Path**: `/home/claude/store-history.js`
- ✅ _loadYm share SalesDashboard._loadChunks cache แทน fetch เอง

### file-manager.js
**Path**: `/home/claude/file-manager.js`
- ✅ bulkImport detect ร้านที่หายไป
- ✅ popup แสดงรายชื่อร้านที่หายไป พร้อมเลือก "พัก" หรือ "ลบ"
- ✅ inactive: true flag สำหรับร้านที่พัก
- ✅ reactivate อัตโนมัติเมื่อร้านกลับมาในไฟล์ใหม่
- ✅ State.rawData save + column mapping ถูกต้อง (BUG-02/09)

### admin-map.js
**Path**: `/home/claude/admin-map.js`
- ✅ renderMarkers ซ่อน store.inactive บนแผนที่

### admin-ui.js
**Path**: `/home/claude/admin-ui.js`
- ✅ render แยก htmlI สำหรับ inactive stores
- ✅ section "💤 ร้านที่พัก" ใต้ list-assigned
- ✅ stats (total/pending) ไม่นับ inactive stores
- ✅ sums loop ข้าม inactive stores

### admin-data.js
**Path**: `/home/claude/admin-data.js`
- ✅ StoreMgr.reactivateStore(id) — ดึงร้านกลับ
- ✅ StoreMgr.permanentDelete(id) — ลบถาวร + confirm dialog

### firestore.rules
**Path**: `/home/claude/firestore.rules`
- ✅ Security rules v2.0
- ✅ app_users write มี structure check
- ✅ sellout/targets/skuDist write ต้องมี format ถูกต้อง
- ✅ auditLogs ลบ/แก้ไม่ได้ + ต้องมี timestamp
- ✅ plans/{ym}/routes รองรับระบบใหม่
- ⚠️ read ยังเปิดอยู่ทุก collection (จำเป็นสำหรับ custom auth)

---

## 🚀 Deploy
- **GitHub**: https://github.com/irisordinary-del/Sales-App (branch: main)
- **Vercel**: https://sales-app-7ids.vercel.app/ (auto-deploy จาก main)
- **Firestore Rules**: Firebase Console → Firestore → Rules → Publish

---

## 📋 Bug ที่ยังค้าง (จาก PROJECT_ANALYSIS.md)
- BUG-03: file-manager bulkImport route name อาจซ้ำ
- BUG-05: sales-app docMain ชี้ผิด doc ตอน drag reorder
- BUG-08: admin-data duplicate toast ใน clearAllAssignments
- BUG-10: ✅ แก้แล้ว (TAB_STORAGE_KEY per-user)

---

## ⚠️ Security ที่ยังเหลือ
- app_users read ยังเปิด → แก้สมบูรณ์ต้องเปลี่ยนเป็น Firebase Auth
- Salt ใน auth.js เป็น static string ในโค้ด
- Role check ทำใน client-side JS

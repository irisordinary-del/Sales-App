# 📊 PROJECT ANALYSIS & FIX TRACKER
> Sales-App / Route Planner Admin
> วิเคราะห์โดย Claude — อัพเดทล่าสุด: 2026-05-13

---

## 🌐 URLs สำคัญ
- **Web App**: https://sales-assis-app.vercel.app/
- **GitHub Repo**: https://github.com/irisordinary-del/Sales-App (branch: `main`)

---

## 📁 โครงสร้างไฟล์ทั้งระบบ

| ไฟล์ | หน้าที่ | ขนาด |
|------|---------|------|
| `index.html` | Admin UI หลัก (26K) | HTML |
| `app-config.js` | Firebase init + DAY_COLORS + State | JS |
| `admin-ui.js` | Nav, UI render, Toast, Modal | JS |
| `admin-map.js` | MapCtrl (Leaflet), Lasso tool | JS |
| `admin-data.js` | StoreMgr, RawDataMgr, KPIMgr, ExcelIO, App | JS |
| `admin-ai.js` | AI Route Builder (K-Means++) | JS |
| `admin-style.css` | Global CSS styles | CSS |
| `file-manager.js` | FileManager (upload/export/bulkImport) | JS |
| `firebase-chunks.js` | ChunkDB (สำรองสำหรับ big data) | JS |
| `center-select.html` | หน้าเลือกศูนย์ | HTML |
| `center-select.js` | App logic สำหรับหน้าเลือกศูนย์ | JS |
| `app-config-init.js` | Firebase init สำหรับ center-select.html | JS |
| `sales.html` | Sales App (mobile) | HTML |
| `sales-app.js` | Sales App logic | JS |
| `sales-style.css` | Sales App CSS | CSS |
| `FEATURES_IMPLEMENTATION.js` | Feature stubs (Auth, Dashboard, etc.) | JS |

---

## 🔴 BUG LIST — ปัญหาที่พบ (เรียงตามความสำคัญ)

### BUG-01: `index.html` — HTML ไม่ถูกต้อง (Nested Button / Broken Layout)
**ระดับ**: 🔴 Critical  
**ไฟล์**: `index.html` บรรทัด ~147-154  
**สาเหตุ**: มีปุ่ม "เพิ่มสาย" (`+ เพิ่มสาย`) ที่ tag ไม่ปิดถูกต้อง และมีปุ่ม "📦 อัปโหลดทุกสาย" ซ้อนอยู่ข้างใน เกิด **nested `<button>` inside `<button>`** ซึ่ง HTML spec ไม่รองรับ
```html
<!-- ปัญหา: nested button -->
<button onclick="App.addRoute()" ...>
    <button onclick="document.getElementById('bulkUpload').click()" ...>
        📦 อัปโหลดทุกสาย
    </button>
    <input type="file" id="bulkUpload" ...>
    + เพิ่มสาย   ← ข้อความอยู่ผิดที่
</button>
```
**ผลกระทบ**: ปุ่ม "เพิ่มสาย" กับ "อัปโหลดทุกสาย" ทำงานผิดปกติ  
**วิธีแก้**: แยก `<button>` ออกมาเป็นสองปุ่มอิสระ

---

### BUG-02: `file-manager.js` — `uploadRouteFile()` ไม่ save `State.rawData`
**ระดับ**: 🔴 Critical (ตาม HANDOFF_NOTES)  
**ไฟล์**: `file-manager.js` บรรทัด ~6-95  
**สาเหตุ**: เมื่อ upload ไฟล์ผ่าน `FileManager.uploadRouteFile()` ข้อมูล raw rows ไม่ถูก save ไว้ใน `State.rawData` ทำให้ `ExcelIO.export()` หาข้อมูลต้นฉบับไม่เจอ  
**ผลกระทบ**: Export Excel มี 12 column ถูกต้อง แต่ column เหล่านี้ว่าง: CY, Sales, ประเภทร้านค้า1, Sold To City, Sold To State, Address 5, ชื่อตลาด  
**วิธีแก้**: เพิ่ม `State.rawData = rows;` หลัง parse rows เสร็จใน `uploadRouteFile()`

> ⚠️ อย่างไรก็ตาม `uploadRouteFile()` ใช้ `header: 'A'` (column letter) ขณะที่ `ExcelIO.export()` lookup ด้วย `r['รหัส']` (header name) → ต้องแปลง format ก่อน save หรือ lookup ด้วย `r['B']`

---

### BUG-03: `file-manager.js` — `uploadRouteFile()` สร้าง Route ชื่อผิด + ไม่ integrate กับ `App` controller จริง
**ระดับ**: 🟡 Medium  
**ไฟล์**: `file-manager.js` บรรทัด ~62-88  
**สาเหตุ**: 
1. Route name สร้างจาก `salesCode.substring(0, 3)` ซึ่งอาจซ้ำกัน
2. ไม่เรียก `App.saveDB()` แบบ proper — เรียกตรงๆ แต่ไม่ sync กับ routeList ใน Firestore
3. ปัญหา `Nav.go('planning')` — `Nav` อาจยังไม่ถูก define ตอนนั้น (script load order)  
**ผลกระทบ**: ข้อมูลอาจไม่ sync กับ Firebase ถูกต้อง

---

### BUG-04: `sales-app.js` — `Processor` undefined ใน `handleDrag()`
**ระดับ**: 🔴 Critical  
**ไฟล์**: `sales-app.js` บรรทัด ~320-327  
**สาเหตุ**: `Processor.handleDrag()` ถูกเรียกใน `UI.confirmEditOrder()` แต่ไม่มี `const Processor = {...}` อยู่ในโค้ดที่เห็น (อาจถูกเรียกจาก context ที่โหลดแยก) — ถ้า `Processor` ไม่ถูก define จะเกิด `ReferenceError`  
**วิธีแก้**: ตรวจสอบว่า `Processor` ถูก define ไว้ที่ไหน หรือ inline logic เข้าไป

---

### BUG-05: `sales-app.js` — `docMain` reference สำหรับ `handleDrag()` อาจผิด
**ระดับ**: 🟡 Medium  
**ไฟล์**: `sales-app.js` บรรทัด ~326  
**สาเหตุ**: `Processor.handleDrag()` ใช้ `docMain.collection('routes').doc(State.myRoute).set(...)` แต่ `docMain` ชี้ไปที่ `db.collection('appData').doc('v1_main')` ไม่ได้ชี้ไปที่ center doc ที่ถูก login เข้ามา  
**ผลกระทบ**: เมื่อ drag reorder แล้วบันทึก อาจบันทึกไปผิด document

---

### BUG-06: `admin-data.js` — `App.handleMapUpload` ถูก assign event listener สองครั้ง
**ระดับ**: 🟡 Medium  
**ไฟล์**: `admin-data.js` บรรทัด ~536-539 + `file-manager.js` บรรทัด ~505-512  
**สาเหตุ**: `App.init()` ใน admin-data.js ผูก event listener กับ `#fileUpload` → เรียก `App.handleMapUpload`. แต่ `file-manager.js` ก็ผูก event listener กับ `#fileUpload` → เรียก `FileManager.uploadRouteFile()` ด้วย  
**ผลกระทบ**: เมื่อ upload ไฟล์จะถูก process สองครั้งด้วย logic ที่ต่างกัน

---

### BUG-07: `file-manager.js` — `exportAllRoutes()` ถูกเรียกจาก `index.html` แต่ไม่ถูก define
**ระดับ**: 🔴 Critical  
**ไฟล์**: `index.html` บรรทัด ~493, `file-manager.js`  
**สาเหตุ**: ปุ่ม "💾 Export ทุกสาย" เรียก `FileManager.exportAllRoutes()` แต่ไม่มี method นี้ใน `FileManager` object  
**ผลกระทบ**: กดปุ่มแล้วได้ `TypeError: FileManager.exportAllRoutes is not a function`

---

### BUG-08: `admin-data.js` — `clearAllAssignments()` duplicate toast call
**ระดับ**: 🟢 Minor  
**ไฟล์**: `admin-data.js` บรรทัด ~806-810  
**สาเหตุ**: มี `if (UI && UI.showSaveToast) { ... } else { UI.showSaveToast(...) }` — branch ทั้งสองเรียก function เดิม แต่ else branch ไม่มี null check  
**วิธีแก้**: ลด code ให้เหลือ `UI.showSaveToast('✅ เคลียร์การจัดสายเสร็จ');`

---

### BUG-09: `file-manager.js` — `FileManager.uploadRouteFile()` ไม่เพิ่ม `cy` field
**ระดับ**: 🟡 Medium  
**ไฟล์**: `file-manager.js` บรรทัด ~35-52  
**สาเหตุ**: store object ที่สร้างจาก `uploadRouteFile()` ไม่มี `cy` field (column A ถูก skip) ทำให้ export Excel column CY ว่าง  
**วิธีแก้**: เพิ่ม `cy: row.A || ''` ใน store object

---

### BUG-10: `sales-app.js` — `localStorage` ใช้สำหรับ Tab state แต่อาจ conflict กับ หลาย sessions
**ระดับ**: 🟢 Minor  
**ไฟล์**: `sales-app.js` บรรทัด ~41-42  
**สาเหตุ**: `TAB_STORAGE_KEY = 'sales_last_tab'` ไม่ได้รวม route code เข้าไป ถ้ามีหลาย user ใช้ browser เดียวกัน tab state จะ cross  
**วิธีแก้**: ใช้ `sales_last_tab_${State.myRoute}` แทน

---

## ✅ สิ่งที่แก้ไขแล้ว (จาก HANDOFF_NOTES & bugfix-log)

| # | วันที่ | ไฟล์ | การแก้ไข |
|---|--------|------|---------|
| 1 | ก่อนหน้า | `admin-data.js` | แก้ `handleMapUpload`: ชื่อตลาด → `marketNameCol` ไม่ใช่ `nameCol` |
| 2 | ก่อนหน้า | `admin-data.js` | แก้ KPI `renderSetup`: ชื่อตลาด detect เป็น marketNameCol |
| 3 | ก่อนหน้า | `admin-data.js` | `ExcelIO.export()` → output 12 คอลัมน์ |
| 4 | ก่อนหน้า | `admin-data.js` | แก้ SyntaxError extra `}` ที่ line 458 |
| 5 | ก่อนหน้า | `admin-ui.js` | เพิ่ม `focusOnEditTab()` ที่ขาดหาย |
| 6 | ก่อนหน้า | `admin-map.js` | `clearAll()` ล้าง markers ก่อน render ใหม่ |

---

## 📋 FIX PLAN — แผนการแก้ไข (เรียงตามลำดับ)

| Priority | Bug ID | ไฟล์ | การแก้ไข | สถานะ |
|----------|--------|------|---------|-------|
| 1 | BUG-01 | `index.html` | แยก nested button | ✅ แก้แล้ว 2026-05-13 |
| 2 | BUG-07 | `file-manager.js` | เพิ่ม `exportAllRoutes()` | ✅ ปิด — มีอยู่แล้ว |
| 3 | BUG-06 | `file-manager.js` | ลบ duplicate event listener | ✅ แก้แล้ว 2026-05-13 |
| 4 | BUG-04 | `sales-app.js` | ตรวจสอบ/fix `Processor` | ✅ ปิด — มีอยู่แล้ว |
| 5 | BUG-02 | `file-manager.js` | save `State.rawData` ใน `uploadRouteFile()` | ⏳ รอดำเนินการ |
| 6 | BUG-09 | `file-manager.js` | เพิ่ม `cy` field | ⏳ รอดำเนินการ |
| 7 | BUG-05 | `sales-app.js` | แก้ `docMain` reference | ⏳ รอดำเนินการ |
| 8 | BUG-03 | `file-manager.js` | แก้ Route name + Firestore sync | ⏳ รอดำเนินการ |
| 9 | BUG-08 | `admin-data.js` | ลด duplicate toast | ⏳ รอดำเนินการ |
| 10 | BUG-10 | `sales-app.js` | แก้ TAB_STORAGE_KEY | ⏳ รอดำเนินการ |

---

## 🔧 FIX LOG — บันทึกการแก้ไข

| วันที่ | Bug ID | ไฟล์ | รายละเอียด | ผล |
|--------|--------|------|----------|-----|
| 2026-05-13 | BUG-01 | `index.html` | แยก nested `<button>` ออกเป็น 2 ปุ่มอิสระ (เพิ่มสาย / อัปโหลดทุกสาย) | ✅ |
| 2026-05-13 | BUG-06 | `file-manager.js` | ลบ duplicate `#fileUpload` event listener ออก — ใช้ `App.init()` เป็น master | ✅ |
| 2026-05-13 | BUG-07 | (ตรวจสอบ) | `exportAllRoutes()` มีอยู่ใน `file-manager.js` แล้ว — ปิด false alarm | ✅ |
| 2026-05-13 | BUG-04 | (ตรวจสอบ) | `Processor` object มีอยู่ใน `sales-app.js` แล้ว — ปิด false alarm | ✅ |

---

## 📝 หมายเหตุสำคัญ

### Script Load Order (index.html)
```
1. app-config.js     → Firebase + DAY_COLORS + State (global)
2. admin-ui.js       → Nav, UI
3. admin-map.js      → MapCtrl, Lasso
4. admin-data.js     → StoreMgr, RawDataMgr, KPIMgr, ExcelIO, App
5. admin-ai.js       → AI
6. file-manager.js   → FileManager
```

### Firebase Data Structure
```
appData/
  {CENTER_ID}_main/          ← CENTER_DOC (เช่น "402_main")
    routeList: [...]
    cycleDays: 24
    kpiSettings: {...}
    savedRawColumns: [...]
    routes/ (subcollection)
      {routeName}/
        stores: [...]
v1_raw_chunks/               ← raw data (global)
v1_sales_chunks/             ← KPI data (global)
appData/
  app_centers/               ← center list
    centers: { "402": {...}, "406": {...} }
```

### Store Object Structure
```js
{
  id, name, lat, lng, freq, days, seqs, selected,
  code, salesCode, shopType, subDistrict, district, province,
  marketName, cy, dayOriginal
}
```

---

*อัพเดทล่าสุด: 2026-05-13 | โดย Claude Sonnet 4.6*

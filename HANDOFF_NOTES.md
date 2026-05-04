# HANDOFF NOTES — Sales-App / Route Planner Admin
> อ่านไฟล์นี้ก่อนทำงานต่อทุกครั้ง

---

## 🌐 URLs สำคัญ
- **Web App**: https://sales-assis-app.vercel.app/
- **GitHub Repo**: https://github.com/irisordinary-del/Sales-App (branch: `main`)
- **Auto-deploy**: Vercel deploy อัตโนมัติเมื่อ push ไป main

---

## 🎯 เป้าหมายหลักของ Project
ให้ฟังก์ชัน Export (ปุ่ม "📥 โหลดไฟล์ออก") ออกไฟล์ Excel ที่มี **12 คอลัมน์** เหมือนกับไฟล์ขาเข้าที่ user upload พอดี

### รูปแบบ 12 คอลัมน์ที่ต้องการ (ตามลำดับ)
| Col | Header |
|-----|--------|
| A | CY |
| B | รหัส |
| C | ชื่อ |
| D | Sales |
| E | ประเภทร้านค้า1 |
| F | Sold To City |
| G | Sold To State |
| H | Address 5 |
| I | Latitude |
| J | Longtitude |
| K | ชื่อตลาด |
| L | Day |

---

## ✅ สิ่งที่ทำเสร็จแล้ว

### 1. แก้ `file-manager.js` — commit `5805e73`
- แก้ `FileManager.exportTemplate()` ให้ output 12 คอลัมน์
- **หมายเหตุ**: ฟังก์ชันนี้ **ไม่ได้ถูกเรียกจากปุ่ม Export** จริงๆ เป็นแค่ template function

### 2. แก้ `admin-data.js` — commit `626de51`
- แก้ `ExcelIO.export()` ให้ output 12 คอลัมน์ตามรูปแบบ
- **นี่คือฟังก์ชันที่ปุ่ม "📥 โหลดไฟล์ออก" เรียกจริงๆ**
- ปุ่มนั้น onclick=`ExcelIO.export()` อยู่ใน `admin-ui.js`

### 3. แก้ SyntaxError `admin-data.js` — commit `e4f1f19`
- commit 626de51 ทำให้มี `}` เกินมา 1 ตัวที่ line 458
- แก้แล้ว: ลบ extra `}` ออก — แมพกลับมาขึ้นปกติ

---

## ⚠️ ปัญหาที่ยังค้างอยู่ (งานครั้งหน้า)

### คอลัมน์ว่างใน Export
**อาการ**: ไฟล์ export มี 12 คอลัมน์ถูกต้องแล้ว แต่คอลัมน์เหล่านี้ว่างเปล่า:
- CY (col A)
- Sales (col D)
- ประเภทร้านค้า1 (col E)
- Sold To City (col F)
- Sold To State (col G)
- Address 5 (col H)
- ชื่อตลาด (col K)

**สาเหตุ**: `State.rawData` ว่างเปล่า เพราะ `uploadRouteFile()` ใน `file-manager.js` ไม่ได้ save raw rows ตอน parse Excel

**ข้อมูลที่ Store objects มีใน State/Firestore**:
```
{ id, name, lat, lng, freq, seqs, selected, days }
```
ขาด: CY, salesCode, shopType, subDistrict, district, province, marketName

---

## 🔧 วิธีแก้ครั้งหน้า (Next Fix)

### แก้ `file-manager.js` — function `uploadRouteFile()`

**เป้าหมาย**: ให้ save raw rows จาก Excel ขาเข้าไว้ใน `State.rawData` เพื่อให้ `ExcelIO.export()` lookup ได้

**ขั้นตอน**:
1. เปิด `file-manager.js` หา function `uploadRouteFile()`
2. ตรงที่ parse Excel ด้วย `XLSX.utils.sheet_to_json(ws)` หรือคล้ายกัน
3. เพิ่ม `State.rawData = rows;` หลัง parse rows เสร็จ (ก่อน process ต่อ)
4. ตรวจสอบว่า column header ใน rawData ตรงกับที่ `ExcelIO.export()` ใช้ lookup

**ExcelIO.export() lookup code (อยู่ใน admin-data.js ~line 403)**:
```javascript
const rawRow = (State.rawData || []).find(r =>
  String(r['รหัส'] || r['B'] || '').trim() === String(s.id)
  ) || {};
  ```
  แปลว่า rawData ต้องมี key `'รหัส'` หรือ `'B'` เพื่อ match กับ `s.id`

  **ค่าที่ดึงจาก rawRow**:
  ```javascript
  'CY': rawRow['CY'] || rawRow['A'] || '',
  'Sales': rawRow['Sales'] || rawRow['D'] || '',
  'ประเภทร้านค้า1': rawRow['ประเภทร้านค้า1'] || rawRow['E'] || '',
  'Sold To City': rawRow['Sold To City'] || rawRow['F'] || '',
  'Sold To State': rawRow['Sold To State'] || rawRow['G'] || '',
  'Address 5': rawRow['Address 5'] || rawRow['H'] || '',
  'ชื่อตลาด': rawRow['ชื่อตลาด'] || rawRow['K'] || '',
  ```

  ---

  ## 📁 โครงสร้างไฟล์สำคัญ

  | ไฟล์ | หน้าที่ |
  |------|--------|
  | `admin-data.js` | State, StoreMgr, ExcelIO, App controller |
  | `file-manager.js` | Upload Excel, FileManager |
  | `admin-ui.js` | UI render, ปุ่มต่างๆ |
  | `admin-map.js` | MapCtrl, Leaflet map |
  | `index.html` | Main HTML, load scripts |

  ### Objects สำคัญใน admin-data.js
  ```
  State         — global state (stores, db, rawData, sales, ...)
  StoreMgr      — จัดการ store selection, day assignment
  ExcelIO       — export Excel (ปุ่ม "โหลดไฟล์ออก")
  App           — init, dbRef, sync, fetchRawData, fetchSalesData
  ```

  ---

  ## 🐛 Bugs / Gotchas ที่เจอมาแล้ว

  1. **GitHub editor + Ctrl+H** → พิมพ์ "h" ลงใน editor แทน ให้ใช้ Ctrl+F แทน
  2. **Commit button grey** → พิมพ์ space แล้ว Backspace เพื่อ trigger dirty state
  3. **admin-data.js ใหญ่มาก** → get_page_text เกิน limit, ใช้ JS inspect live function แทน: `ExcelIO.export.toString()`
  4. **Virtual scrolling ใน GitHub editor** → JS query `.blob-code-inner` ไม่ได้ content จาก line ที่ไม่อยู่ใน viewport
  5. **ปุ่ม Export เรียก ExcelIO.export() ไม่ใช่ FileManager.exportTemplate()** → ตรวจสอบด้วย JS: `document.querySelector('[onclick*="export"]').outerHTML`

  ---

  ## 📝 Commit History (งานที่ทำ)

  | Commit | ไฟล์ | สิ่งที่ทำ |
  |--------|------|----------|
  | `5805e73` | file-manager.js | exportTemplate → 12 cols (ไม่ใช่ฟังก์ชันจริง) |
  | `626de51` | admin-data.js | ExcelIO.export → 12 cols (PRIMARY FIX) |
  | `e4f1f19` | admin-data.js | แก้ SyntaxError extra `}` ที่ line 458 |

  ---

  ## 💬 วิธีใช้ไฟล์นี้ครั้งหน้า

  บอก Claude ว่า:
  > "อ่าน HANDOFF_NOTES.md ใน repo irisordinary-del/Sales-App แล้วทำงานต่อ: แก้ uploadRouteFile() ใน file-manager.js ให้ save State.rawData"

  ---
  *Last updated: 2026-05-04*

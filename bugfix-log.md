# Bugfix Log — Sales-App

## [2026-07-13] Fix: targets/{ym} ไม่มี centerId prefix — ศูนย์ไหนบันทึกทีหลังทับของศูนย์อื่นทั้งเดือน

### สาเหตุของบัก
`Dashboard._saveTargets()` เขียนไปที่ `targets/{ym}` (เช่น `targets/2026_07`) โดยไม่มี centerId ต่อท้ายเลย
ต่างจาก `sellout` และ `plans` ที่แยกตาม centerId ชัดเจน (`sellout/{centerId}_{ym}`)
เพราะเรียก `.set({routes: targets, ...})` โดยไม่มี `{merge: true}` — Firestore `.set()` แบบนี้ **แทนที่ทั้งเอกสาร**
ผลคือ ศูนย์ไหนกด "บันทึก Target" ทีหลัง จะลบ `routes` ของศูนย์อื่นที่เคยตั้งไว้ในเดือนเดียวกันทิ้งทั้งหมด
แม้ชื่อสายจะไม่ซ้ำกันเลยก็ตาม เพราะทุกศูนย์เขียนคนละ field แต่ลงเอกสารเดียวกัน

### จุดที่แก้ไข (รวม 6 จุด ใน 2 ไฟล์)
```js
// ก่อนแก้
const key = ym;                                  // หรือ Dashboard._currentYM ตรงๆ
await cloudDB.collection('targets').doc(key).get()/.set(...)

// หลังแก้
const cid = (window.CENTER_ID || '').toUpperCase();
const key = cid ? `${cid}_${ym}` : ym;
let doc = await cloudDB.collection('targets').doc(key).get();
if (!doc.exists && cid) doc = await cloudDB.collection('targets').doc(ym).get(); // fallback ข้อมูลเก่า
```

- `dashboard.js` — `_loadTargets(ym)`, `_saveTargets()`, `_loadAllMonths()` (โหมดรวมทุกเดือน)
- `sales-dashboard.js` — `SalesDashboard._loadTarget(ym)`, `SalesDashboard._loadAllMonths()`,
  `SupervisorDashboard._loadTargets(ym)`, `SupervisorDashboard._loadTargets()` (all-months)

### ผลกระทบต่อข้อมูลเก่า
Target ที่เคยตั้งไว้ก่อนแก้บั๊กนี้ **ไม่รู้ว่าเป็นของศูนย์ไหนกันแน่** (อาจถูกทับไปแล้วในอดีต)
→ **ต้องให้ทุกศูนย์ตั้ง Target ใหม่อีกรอบหลัง deploy** ไม่มีทางกู้คืนข้อมูลเก่าได้ 100%

### หลักการสำหรับ collection ใหม่ในอนาคต
ทุก collection ที่เป็นข้อมูลเฉพาะศูนย์ **ต้องมี centerId prefix ใน document key เสมอ** (`{centerId}_{อะไรก็ตาม}`)
ห้ามใช้ key ที่เป็นแค่ ym/เดือนเปล่าๆ ถ้าเอกสารนั้นเก็บ field ที่ผูกกับศูนย์ และเวลาเขียนควรพิจารณา `{merge:true}` เสมอ
เว้นแต่ตั้งใจจะ replace ทั้งก้อนจริงๆ (เช่น plan meta ตอนสร้างใหม่)

---

## [2026-07-13] Fix: Column "สายวิ่ง" ตรวจจับรหัสสายไม่ได้ — โดน dayCol ดักไปก่อน

### สาเหตุของบัก
ทั้ง `file-manager.js` (`bulkImport`) และ `admin-data.js` (`handleMapUpload`) เรียงเงื่อนไข if-else แบบนี้:
```js
else if (h.includes('สายวิ่ง') || h.includes('day'))  dayCol = i;        // ← มาก่อน ดักไปเลย
...
else if (h === 'route' || h === 'สายวิ่ง')             salesCodeCol = i; // ← ไม่มีวันถึงบรรทัดนี้
```
เพราะเป็น `if...else if` ไล่ทีละบรรทัด คอลัมน์ชื่อ **"สายวิ่ง"** เป๊ะๆ จะโดนเงื่อนไข `dayCol`
(ใช้ `.includes()` แบบกว้าง) จับไปก่อนเสมอ โค้ดที่เขียนไว้เผื่อจับ "สายวิ่ง" เข้า `salesCodeCol`
(ตัวตัดสินว่าร้านอยู่สายไหน — ใช้เป็น `routeKey` ในการแบ่งกลุ่ม) เลยกลายเป็น dead code
ผลคือไฟล์ที่ตั้งชื่อ column ว่า "สายวิ่ง" ตรงๆ จะ**แบ่งสายไม่ได้เลย** (salesCodeCol = -1)

`admin-data.js` (`handleMapUpload`) แย่กว่านั้นคือไม่มี exact-match line เผื่อไว้เลยด้วยซ้ำ

### จุดที่แก้ไข
ย้าย exact-match check (`h === 'route' || h === 'สายวิ่ง'`) ขึ้นมา**ก่อน** เงื่อนไข `dayCol` แบบกว้าง ทั้ง 2 ไฟล์:
- `file-manager.js` — `bulkImport()` บรรทัด header-detection loop
- `admin-data.js` — `handleMapUpload()` บรรทัด header-detection loop (เพิ่ม exact-match ใหม่ เดิมไม่มี)

ทดสอบ 8 กรณี (เดี่ยว "สายวิ่ง", "Sales", "SalesCode", "รหัสเซลล์", "Route", มีทั้ง "สายวิ่ง"+"Day" คู่กัน,
"Day"+"Sales" คู่กัน, และ layout จริงจากไฟล์ตัวอย่าง) — ผ่านหมดหลังแก้

### หลักการสำหรับ header-detection ในอนาคต
เมื่อ column ใหม่มีคำที่ซ้อนกับ column อื่น (เช่น "สายวิ่ง" ซ้อนกับ "day" ที่ใช้ `.includes()`)
**ให้เรียง exact-match (`===`) ของคำที่เจาะจงกว่าไว้ก่อนเสมอ** แล้วค่อยตามด้วย `.includes()` แบบกว้าง
หลักการเดียวกับที่เคยแก้ไปแล้วสำหรับ "ชื่อตลาด" vs "ชื่อ" (ดู entry 2026-05-06 ด้านล่าง) — ควรไล่เช็ค
if-else chain ทุกครั้งที่เพิ่ม header ใหม่ ไม่ใช่แค่เพิ่มเงื่อนไขต่อท้ายเฉยๆ

---

## [2026-07-13] Fix: `_showDataWarning()` signature ไม่ตรงกับตอนเรียกจริง

### สาเหตุของบัก
`SalesDashboard._showDataWarning` นิยามรับ `(fail, total)` เป็นตัวเลข (สำหรับโชว์ "โหลดไม่ครบ X/Y chunks")
แต่ถูกเรียกจริง 2 จุด (ตอน `_loadMonthList` ของทั้ง SalesDashboard และ SupervisorDashboard timeout/error)
ด้วย `(ข้อความ, callback)` แทน — เป็นโค้ดที่เขียนไว้คนละช่วงเวลากันแล้วไม่ได้เช็ค signature ให้ตรงกัน

ผลคือ banner แจ้งเตือนจะโชว์ข้อความเพี้ยนแบบ `"...ไม่ครบ: [object Object]/() => {...} chunks"`
(เอา string มา parse เป็นตัวเศษ เอา function มา parse เป็นตัวส่วน) และปุ่ม "ลองใหม่" ที่ตั้งใจจะมี
ไม่เคยถูกสร้างขึ้นจริงเลย เพราะฟังก์ชันไม่รู้จัก parameter ตัวที่ 2 ที่เป็น callback

### จุดที่แก้ไข
เขียน `_showDataWarning` ใหม่ให้รับ `(message, onRetry)` ตรงกับที่เรียกจริง พร้อมสร้างปุ่ม "🔄 ลองใหม่"
ที่ทำงานจริง (เรียก `onRetry()` ตอนกด) และยังรองรับ backward-compat กรณีเรียกด้วยตัวเลข `(fail, total)`
แบบเดิมด้วย (เช็คจาก `typeof arg1 === 'number'`) เผื่อมีจุดอื่นเรียกแบบเก่าในอนาคต

### หลักการสำหรับอนาคต
เวลาเปลี่ยน signature ของ helper function ที่ใช้ร่วมกันหลายจุด (`_showXxx`, `_loadXxx` ฯลฯ)
ให้ `grep -n "functionName("` หาทุกจุดที่เรียกใช้ก่อนเสมอ แล้วเช็คว่า argument ที่ส่งเข้าไปตรงกับ
parameter ที่ฟังก์ชันรับจริงหรือไม่ — บั๊กประเภทนี้ไม่มี syntax error และ ESLint ก็ตรวจไม่เจอ
(เพราะ JS ไม่เช็ค type ของ argument) ต้องไล่อ่าน caller vs callee เทียบกันเองเท่านั้น

---

## [2026-05-06] Fix: ชื่อตลาด ถูก detect เป็น nameCol แทน marketNameCol

### สาเหตุของบัก
ใน `admin-data.js` ฟังก์ชัน header detection ใช้ `h.includes('ชื่อ')` เป็น condition แรก
ทำให้ header ชื่อ `ชื่อตลาด` ถูก match เป็น **nameCol** (ชื่อร้าน) แทนที่จะเป็น **marketNameCol** (ชื่อตลาด)
เพราะ `'ชื่อตลาด'.includes('ชื่อ') === true`

### จุดที่แก้ไขใน admin-data.js

#### 1. handleMapUpload (บรรทัด ~637)
```js
// ก่อนแก้
else if (h.includes('ชื่อ') || h.includes('name')) nameCol = i;

// หลังแก้
else if ((h.includes('ชื่อ') && !h.includes('ตลาด')) || h.includes('name')) nameCol = i;
```

#### 2. KPI renderSetup — auto-detect column (บรรทัด ~233)
```js
// ก่อนแก้
cols.find(h => h.toLowerCase().includes('name') || h.includes('ชื่อ'))

// หลังแก้
cols.find(h => h.toLowerCase().includes('name') || (h.includes('ชื่อ') && !h.includes('ตลาด')))
```

### ไฟล์ที่แก้ไข
- `admin-data.js` — 2 จุด (handleMapUpload + KPI renderSetup)

### ไฟล์ที่ตรวจสอบแล้วไม่มีปัญหา
- `file-manager.js` — ไม่มี header detection logic นี้

### Commits
- `71f8528` — Fix import: ชื่อตลาด ไปอยู่ใน marketName col แทน nameCol (handleMapUpload เท่านั้น)
- `cbc651a` — Fix: ชื่อตลาด detect เป็น nameCol แทน marketNameCol — แก้ไขทั้ง handleMapUpload และ KPI renderSetup

### หลักการสำหรับการแก้ไขในอนาคต
เมื่อมีการเพิ่ม header ใหม่ที่มีคำซ้อนกัน (เช่น "ชื่อ" ซ้อนใน "ชื่อตลาด") ให้ตรวจสอบ if-else chain
และเพิ่ม exclusion condition `&& !h.includes('...')` เสมอ หรือเรียงลำดับ if-else ให้ specific กว่าขึ้นก่อน

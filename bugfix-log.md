# Bugfix Log — Sales-App

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

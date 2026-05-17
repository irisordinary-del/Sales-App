# CLAUDE.md — Route Planner Project

## ภาพรวมระบบ

ระบบวางแผนสายวิ่ง (Route Planner) สำหรับฝ่ายขาย ประกอบด้วย 3 หน้าหลัก

- **Admin/Supervisor** (`index.html`) — วางแผนสายวิ่ง, จัดการ Draft/Active plan, ดู Dashboard
- **Sales** (`sales.html`) — ดูคิวงานประจำวัน, ดู KPI ยอดขาย, ปฏิทินวิ่งสาย
- **User Management** (`users.html`) — จัดการ user ทุก role

## Stack

- **Frontend**: Vanilla HTML/CSS/JS + Tailwind CDN
- **Database**: Firebase Firestore (compat SDK v10)
- **Auth**: Custom SHA-256 + localStorage session (ไม่ใช้ Firebase Auth)
- **Map**: Leaflet.js + OpenStreetMap
- **Deploy**: Vercel (static hosting)

## โครงสร้างไฟล์

```
index.html          — Admin: วางแผนคิวงาน + Dashboard + ภาพรวมทุกสาย
sales.html          — Sales: ยอดขาย, ร้านค้า, คิวงาน, ปฏิทิน
users.html          — User management
login.html          — หน้า Login
center-select.html  — Admin เลือกศูนย์

app-config.js       — Firebase init, DAY_COLORS, State object, Center selector
app-config-init.js  — Firebase init สำหรับ center-select.html (ไม่มี redirect)
auth.js             — Auth module: login, session, SHA-256, user CRUD
admin-data.js       — App object: saveDB, loadDB, switchRoute, Plan Mode (Draft/Active/History)
admin-ui.js         — UI object: render, tabs, modals, toast
admin-map.js        — MapCtrl, Lasso tool
admin-ai.js         — AI route builder (K-Means++)
admin-style.css     — Admin styles
dashboard.js        — Dashboard: Sellout upload, KPI render, drill-down
file-manager.js     — FileManager: bulkImport Excel, exportAllRoutes
firebase-chunks.js  — ChunkDB: save/load ข้อมูลแบบ chunked (แก้ 1MB limit)
store-history.js    — StoreHistory: ประวัติซื้อรายร้าน
users.js            — UsersApp: user management UI
center-select.js    — Center selector logic
sales-app.js        — Sales app: State, UI, MapCtrl, CalendarCtrl, Processor
sales-dashboard.js  — SalesDashboard: KPI ยอดขายฝั่ง Sales
sales-style.css     — Sales styles
firestore.rules     — Firestore security rules
```

## Firestore Structure

```
appData/
  {centerId}_main                     ← metadata ศูนย์ (routeList, cycleDays, draftList, historyList)
    routes/{routeId}                  ← Active plan: { stores: [...] }
    drafts/{YYYY_MM}                  ← Draft plan: { routeList, cycleDays, calendarConfig }
      routes/{routeId}                ← Draft routes: { stores: [...] }
    history/{YYYY_MM}                 ← Snapshot plan ที่ activate แล้ว
      routes/{routeId}                ← History routes: { stores: [...] }
  app_users                           ← { users: [...] }
  app_centers                         ← { centers: {...} }

sellout/{YYYY_MM}                     ← Sellout metadata
  chunks/{chunkId}                    ← Sellout rows (300/chunk)

targets/{YYYY_MM}                     ← Target รายสาย { routes: { "402V01": 500000 } }

v1_raw_chunks/{chunkId}               ← Raw sales data
v1_sales_chunks/{chunkId}             ← Processed KPI
```

## Store Object Structure

```javascript
{
  id: "4010000257",         // custCode (primary key)
  code: "4010000257",
  name: "ร้านสมบูรณ์",
  lat: 13.114803,
  lng: 99.730541,
  days: ["Day 4"],          // สายที่ assign ([] = ยังไม่ได้จัด)
  dayOriginal: "D4",        // วันต้นฉบับจาก Excel
  freq: 1,                  // 1 = F1, 2 = F2 (วิ่ง 2 รอบ/cycle)
  district: "อำเภอ...",
  seqs: { "Day 4": 3 }      // ลำดับวิ่งในแต่ละวัน
}
```

## Role System

```
admin       → เข้าได้ทุกหน้า, เลือกศูนย์ได้อิสระ
supervisor  → เข้า index.html ได้ แต่ล็อคกับ centerId จาก session
sales       → เข้าได้แค่ sales.html
```

## Plan Mode System (สำคัญมาก)

`App._planMode` ใน `admin-data.js` ควบคุมว่ากำลังทำงานกับ plan ไหน

```javascript
'active'           → routes/ (plan ปัจจุบัน Sales ใช้อยู่)
'draft:2026_06'    → drafts/2026_06/routes/
'history:2026_05'  → history/2026_05/routes/ (read-only)
```

**ทุก read/write ต้องผ่าน `App.currentRoutesCol()`** ไม่ใช่ `App.routesCol()` โดยตรง

```javascript
App.currentRoutesCol()  // ✅ ใช้อันนี้เสมอ
App.routesCol()         // ❌ เป็น active เท่านั้น
```

## Calendar Config

เก็บใน draft document หรือ active metadata

```javascript
// โหมด A: Cycle (Day X = วันที่ X ของเดือน)
calendarConfig: {
  mode: 'cycle',
  startDay: 1,        // Day 1 เริ่มวันที่ 1
  startDayNum: 1,     // Day ที่ startDate เริ่ม
  cycleDays: 24,
  holidays: [5, 12]   // วันที่หยุด (ข้าม cycle)
}

// โหมด B: Fixed (กำหนดเองว่าวันที่ = Day อะไร)
calendarConfig: {
  mode: 'fixed',
  mapping: { "1": "Day 5", "8": "Day 6" }
}
```

## Auto-Switch (ฝั่ง Sales)

ตอน Sales เปิดแอป `sales-app.js` จะเช็ค

```javascript
// ถ้ามี draft ของเดือนปัจจุบัน → ใช้ draft
// ถ้าไม่มี → ใช้ active ปกติ
```

## Session & Auth

```javascript
Auth.getSession()     // { username, role, centerId, expiresAt }
Auth.guard(['admin']) // redirect ถ้าไม่ใช่ role ที่อนุญาต
window.CENTER_DOC     // เช่น "402_main" — set ใน app-config.js
window.CENTER_ID      // เช่น "402"
```

## Key Global State (Admin)

```javascript
State.db.routes        // { "402V01": [store, ...], "402V02": [...] }
State.stores           // stores ของ route ที่เลือกอยู่
State.localActiveRoute // route ที่กำลังดูอยู่ เช่น "402V01"
State.db.cycleDays     // จำนวนวันใน cycle (default 24)
State.activeRoadDay    // Day ที่กำลังแสดง road
State.sales            // KPI data
```

## Key Global State (Sales)

```javascript
State.myRoute          // สายของ sales เช่น "402V01"
State.allStores        // ร้านทั้งหมดของสายนั้น
State.currentDay       // Day ที่เลือกอยู่ เช่น "Day 4"
State.calendarConfig   // config ปฏิทินของเดือนนั้น
State.activePlanMode   // 'active' | 'draft'
```

## สิ่งที่ยังค้างอยู่ (TODO)

- [ ] Plan dropdown แสดงชื่อเดือน เช่น `📅 Plan ปัจจุบัน · มิ.ย. 2569`
- [ ] Export เลือกเดือนได้ (ตอนนี้ export จาก State ปัจจุบันเท่านั้น)
- [ ] ปุ่ม "จัดการวันหยุด" — auto-กระจายร้านของ Day ที่หยุดไปวันใกล้เคียง
- [ ] favicon.ico (ตอนนี้ขึ้น 404 ใน console แต่ไม่กระทบการทำงาน)

## Convention สำคัญ

- Day format: `"Day 4"` (มี space, D ตัวใหญ่)
- centerId format: `"402"`, centerDoc: `"402_main"`
- YYYY_MM format: `"2026_06"` (underscore ไม่ใช่ dash)
- ร้านค้า freq=2 คือ F2 วิ่ง 2 รอบต่อ cycle
- `App.saveDB()` ต้อง check `App.isReadOnly()` ก่อนเสมอ

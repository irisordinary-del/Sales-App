# CLAUDE.md — Route Planner Project

## ภาพรวมระบบ

ระบบวางแผนสายวิ่ง (Route Planner) สำหรับฝ่ายขาย ประกอบด้วย 3 หน้าหลัก

- **Admin/Supervisor** (`index.html`) — วางแผนสายวิ่ง, จัดการ Draft/Active plan, ดู Dashboard, ย้ายร้านระหว่างสาย, ติดตามการกระจายสินค้า
- **Sales** (`sales.html`) — ดูคิวงานประจำวัน, ดู KPI ยอดขาย, ปฏิทินวิ่งสาย, ดู Campaign coverage ของสายตัวเอง
- **User Management** (`users.html`) — จัดการ user ทุก role

## Stack

- **Frontend**: Vanilla HTML/CSS/JS + Tailwind CDN
- **Database**: Firebase Firestore (compat SDK v10)
- **Auth**: Custom SHA-256 + localStorage session (ไม่ใช้ Firebase Auth)
- **Map**: Leaflet.js + OpenStreetMap
- **Deploy**: Vercel (static hosting)

## โครงสร้างไฟล์

```
index.html          — Admin: วางแผนคิวงาน + Dashboard + ภาพรวมทุกสาย + กระจายสินค้า
sales.html          — Sales: ยอดขาย, ร้านค้า, คิวงาน, ปฏิทิน, Campaign coverage
users.html          — User management
login.html          — หน้า Login
center-select.html  — Admin เลือกศูนย์

app-config.js       — Firebase init, DAY_COLORS, State object, Center selector
app-config-init.js  — Firebase init สำหรับ center-select.html (ไม่มี redirect)
auth.js             — Auth module: login, session, SHA-256, user CRUD
admin-data.js       — App object: saveDB, loadDB, switchRoute, Plan Mode (Draft/Active/History)
                      + StoreTrans: ย้ายร้านระหว่างสาย
                      + ExportCtrl: export เลือก plan/route ได้
                      + DateUtil: utility แปลง YYYY_MM → ชื่อเดือนไทย
admin-ui.js         — UI object: render, tabs, modals, toast (ไม่มี duplicate แล้ว)
admin-map.js        — MapCtrl, Lasso tool
admin-ai.js         — AI route builder (K-Means++)
admin-style.css     — Admin styles
dashboard.js        — Dashboard: Sellout upload, KPI render, drill-down
                      + _renderCampaignSection: Campaign widget รวมทุกสาย (ยอดรวมทั้งช่วง)
                      + _rowCache: cache rows รายเดือนไม่โหลดซ้ำ
file-manager.js     — FileManager: bulkImport Excel, exportAllRoutes
firebase-chunks.js  — ChunkDB: save/load ข้อมูลแบบ chunked (dead code — ไม่ได้ใช้ใน flow หลัก)
store-history.js    — StoreHistory: ประวัติซื้อรายร้าน
users.js            — UsersApp: user management UI
center-select.js    — Center selector logic
sales-app.js        — Sales app: State, UI, MapCtrl, CalendarCtrl, Processor
sales-dashboard.js  — SalesDashboard: KPI ยอดขายฝั่ง Sales
                      + _renderCampaigns: Campaign widget เฉพาะสายตัวเอง (ยอดรวมทั้งช่วง)
                      + _waitAndLoadCampaigns: รอ State.isLoaded ก่อนโหลด
                      + _rowCache: cache rows รายเดือน
sales-style.css     — Sales styles
sku-distribution.js — SkuDist: ระบบติดตามการกระจายสินค้า (SKU Distribution)
firestore.rules     — Firestore security rules (+ auditLogs rule Session 3)
audit-log.js        — Audit Log: บันทึก action ทุกอย่าง + หน้าแสดง log (Session 3)
pwa-register.js     — PWA: register SW, install prompt, update banner (Session 3)
manifest.json       — PWA manifest (Session 3)
sw.js               — Service Worker: offline cache strategies (Session 3)
icons/              — PWA icons 72/96/128/192/512px (Session 3)
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
  chunks/{chunkId}                    ← Sellout rows (rows: [...], index: N)
                                        fields: sCode, custCode, prodCode, prodName, net, gross, invNum

targets/{YYYY_MM}                     ← Target รายสาย { routes: { "402V01": 500000 } }

skuDistribution/{campaignId}          ← SKU Distribution Campaigns
                                        { name, startYM, endYM, centerId,
                                          defaultTarget, targetUnit, routeTargets: {},
                                          groups: [...], createdAt }

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
  startDay: 1,
  startDayNum: 1,
  cycleDays: 24,
  holidays: [5, 12]
}

// โหมด B: Fixed
calendarConfig: {
  mode: 'fixed',
  mapping: { "1": "Day 5", "8": "Day 6" }
}
```

## Auto-Switch (ฝั่ง Sales)

```javascript
// ถ้ามี draft ของเดือนปัจจุบัน → ใช้ draft
// ถ้าไม่มี → ใช้ active ปกติ
```

## Session & Auth

```javascript
Auth.getSession()     // { username, role, centerId, expiresAt }
Auth.guard(['admin']) // redirect ถ้าไม่ใช่ role ที่อนุญาต
window.CENTER_DOC     // เช่น "402_main"
window.CENTER_ID      // เช่น "402"
```

## Key Global State (Admin)

```javascript
State.db.routes        // { "402V01": [store, ...], "402V02": [...] }
State.stores           // stores ของ route ที่เลือกอยู่
State.localActiveRoute // route ที่กำลังดูอยู่
State.db.cycleDays     // จำนวนวันใน cycle (default 24)
State.activeRoadDay    // Day ที่กำลังแสดง road
State.sales            // KPI data
```

## Key Global State (Sales)

```javascript
State.myRoute          // สายของ sales เช่น "402V01"
State.allStores        // ร้านทั้งหมดของสายนั้น ← ใช้อันนี้ ไม่ใช่ State.db.routes
State.currentDay       // Day ที่เลือกอยู่
State.calendarConfig   // config ปฏิทินของเดือนนั้น
State.activePlanMode   // 'active' | 'draft'
State.isLoaded         // true เมื่อ routes โหลดเสร็จแล้ว
```

**สำคัญ**: ฝั่ง Sales ใช้ `State.allStores` เท่านั้น — `State.db` ไม่มีใน sales-app.js

## StoreTrans — ย้ายร้านระหว่างสาย

```javascript
StoreTrans.open()      // เปิด modal เลือก src/dst route + ร้านที่ต้องการย้าย
StoreTrans.confirm()   // ย้ายร้านที่เลือก reset days/seqs อัตโนมัติ
                       // บันทึกทั้ง src และ dst ใน currentRoutesCol()
```

**ข้อควรระวัง**: ร้านที่ย้ายจะถูก reset days/seqs — Admin ต้องจัดวันใหม่

## ExportCtrl — Export Excel เลือก Plan ได้

```javascript
ExportCtrl.openModal()     // เลือก plan (current/active) และ route (เดียว/ทุกสาย)
ExportCtrl.doExport()      // export — ถ้าเลือก active แต่อยู่ใน draft จะโหลดจาก Firestore
ExportCtrl.exportCurrent() // backward compat
```

- Export ทุกสาย → มี column "Route" เพิ่มในไฟล์
- Fix typo: `Longtitude` → `Longitude`

## DateUtil — แปลงวันที่

```javascript
DateUtil.ymToThai('2026_06')      // "มิถุนายน 2569"
DateUtil.ymToThaiShort('2026_06') // "มิ.ย. 2569"
DateUtil.currentYM()              // "2026_05"
```

## SkuDist — ระบบติดตามการกระจายสินค้า

### โครงสร้าง Campaign

```javascript
{
  id: "xxx",
  name: "Campaign กระจายน้ำดื่ม Q2/2568",
  startYM: "2026_01",
  endYM: "2026_06",
  centerId: "402_main",
  defaultTarget: 80,           // % default สำหรับทุกสาย
  targetUnit: "pct",           // "pct" | "count"
  routeTargets: {              // target รายสาย (optional)
    "402V01": 75,
    "402V12": 90
  },
  groups: [
    {
      id: "g_xxx",
      name: "น้ำดื่ม",
      keywords: ["WTR600ML", "WTR"]   // OR + contains
    }
  ]
}
```

### ตรรกะการคำนวณ — ยึดร้านเป็นหลัก ไม่ใช่ sCode

```javascript
// 1. build custCode → route index จาก State.db.routes (plan ปัจจุบัน)
// 2. tag ทุก row ด้วย _route จาก custCode (ไม่ใช้ sCode)
// 3. โหลด rows ทุกเดือนใน startYM → endYM (ยอดรวมทั้งช่วง)

// Store coverage = unique custCode ที่ซื้อ ÷ ร้านทั้งหมดในสาย (รวมร้านที่ไม่มียอด)
// SKU coverage   = unique prodCode ที่ขาย ÷ prodCode ที่ match keyword ใน allProdOptions

// target แปลงเป็น % เสมอ:
// targetUnit='count' → tgtPct = rawTarget / totalStores * 100
// targetUnit='pct'   → tgtPct = rawTarget
```

**ข้อควรระวัง**:
- keyword กว้างเกิน → match สินค้าไม่ตั้งใจ — กด Preview ก่อน save เสมอ
- allProdOptions โหลดจากเดือนล่าสุดเท่านั้น — สินค้าใหม่อาจไม่ติด SKU coverage
- ร้านที่ไม่มียอดเลยก็นับเป็นตัวหาร store coverage

### Campaign Widget บนหน้า Dashboard

**Admin/Supervisor** (`dashboard.js → _renderCampaignSection`):
- แสดงทุก campaign ที่ `endYM >= เดือนปัจจุบัน`
- โหลด rows ทุกเดือนใน range (**ไม่ขึ้นกับ dropdown เดือน**)
- คำนวณรวมทุกสาย — ยอดรวมทั้งช่วง campaign
- `_rowCache` cache rows ไม่โหลดซ้ำ
- render ครั้งแรก 1.5 วินาทีหลัง init

**Sales** (`sales-dashboard.js → _renderCampaigns`):
- แสดงเฉพาะสายตัวเอง — ใช้ `State.allStores` เป็น store set
- โหลด rows ทุกเดือนใน range เช่นกัน (**ไม่ขึ้นกับ dropdown**)
- รอ `State.isLoaded = true` ก่อนผ่าน `_waitAndLoadCampaigns()`
- `_rowCache` cache rows ไม่โหลดซ้ำ

```javascript
// ⚠️ ต้องรอ State พร้อมก่อนเสมอ
_waitAndLoadCampaigns: () => {
    const check = () => {
        if (State.isLoaded && State.myRoute && State.allStores?.length > 0) {
            SalesDashboard._loadCampaigns();
        } else {
            setTimeout(check, 500);
        }
    };
    setTimeout(check, 500);
}
```

## UI Tab System (แก้บัคแล้ว)

```javascript
UI.switchTab(id)       // เปลี่ยน tab — guard ไม่ reset tab ที่ user อยู่
UI.userSwitchTab(id)   // เรียกเมื่อ user กดเอง (force=true)
UI._currentTab         // track tab ปัจจุบัน
```

## Convention สำคัญ

- Day format: `"Day 4"` (มี space, D ตัวใหญ่)
- centerId: `"402"`, centerDoc: `"402_main"`
- YYYY_MM: `"2026_06"` (underscore ไม่ใช่ dash)
- freq=2 คือ F2 วิ่ง 2 รอบต่อ cycle
- `App.saveDB()` ต้อง check `App.isReadOnly()` ก่อนเสมอ
- **ห้ามใช้ `orderBy` ใน Firestore** — sort ใน JS แทน
- **ห้ามใช้ `App.routesCol()` โดยตรง** — ใช้ `App.currentRoutesCol()`
- **Sales ใช้ `State.allStores`** — ไม่ใช่ `State.db.routes[route]`
- **Campaign coverage ยึดร้านเป็นหลัก** — ร้านย้ายสาย ยอดตามร้าน ไม่ตามพนักงาน
- **Campaign widget แสดงยอดรวมทั้งช่วง** — ไม่ขึ้นกับ dropdown เดือน

## สิ่งที่ยังค้างอยู่ (TODO)

- [ ] favicon.ico (404 ใน console แต่ไม่กระทบ)
- [x] Audit Log — บันทึกว่าใครแก้อะไรเมื่อไร ✅ Session 3
- [x] PWA manifest + Service Worker ✅ Session 3
- [ ] SkuDist: allProdOptions ควร union prodCode จากทุกเดือนใน range
- [ ] KPIMgr: product focus field ควรเก็บใน config document ของ center แทน hardcode
- [ ] Campaign widget: refresh อัตโนมัติเมื่อ Admin สร้าง/ลบ campaign (ตอนนี้ต้อง reload)

## Session 3 — สิ่งที่เพิ่มใหม่

### Audit Log (`audit-log.js`)
- `AuditLog.write(actionKey, details)` — บันทึกลง `auditLogs/{centerId}/logs/` (fire-and-forget)
- `_patchAuditLog()` — monkey-patch ฟังก์ชันหลักทั้งหมด (App, StoreMgr, AI, KPIMgr, SkuDist ฯลฯ)
- `AuditLog.renderPage()` — หน้า admin แสดง log พร้อม filter user/action + export CSV
- Firestore rule: create only, ลบ/แก้ไขไม่ได้ — audit trail ปลอดภัย
- เพิ่ม nav `auditlog` ใน sidebar + `page-auditlog` div ใน index.html

### PWA (`manifest.json`, `sw.js`, `pwa-register.js`)
- **manifest.json**: name, icons 5 ขนาด, shortcuts (Sales / Admin), theme #6366f1
- **sw.js**: 4 strategies — Cache First (static), Cache First+update (CDN), Stale-While-Revalidate (tiles), Network Only (Firebase)
  - offline fallback page (ภาษาไทย) สำหรับ navigate request
  - message handler: SKIP_WAITING, CLEAR_CACHE, GET_CACHE_SIZE
- **pwa-register.js**: register SW, install prompt button, update banner, PWA.install()/update()/clearCache()
- **icons/**: PNG 72, 96, 128, 192, 512px

### การ integrate
ดู `INTEGRATION_GUIDE.md` สำหรับ snippet ที่ต้องเพิ่มใน HTML

# CLAUDE.md — Route Planner Project

## ภาพรวมระบบ

ระบบวางแผนสายวิ่ง (Route Planner) สำหรับฝ่ายขาย ประกอบด้วย 3 หน้าหลัก

- **Admin/Supervisor** (`index.html`) — วางแผนสายวิ่ง, จัดการ Draft/Active plan, ดู Dashboard, ย้ายร้านระหว่างสาย, ติดตามการกระจายสินค้า
- **Sales / Route Supervisor / ASM** (`sales.html`) — ดูคิวงานประจำวัน, ดู KPI ยอดขาย, ปฏิทินวิ่งสาย, ดู Campaign coverage — แสดงข้อมูลต่างกันตาม role
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
sales.html          — Sales/RouteSup/ASM: ยอดขาย, ร้านค้า, คิวงาน, ปฏิทิน, Campaign coverage
users.html          — User management
login.html          — หน้า Login
center-select.html  — Admin เลือกศูนย์

app-config.js       — Firebase init, DAY_COLORS, State object, Center selector
app-config-init.js  — Firebase init สำหรับ login.html, users.html, center-select.html (ไม่มี redirect)
                      ⚠️ ต้องมีไฟล์นี้ใน repo — login.html โหลดไฟล์นี้ ไม่ใช่ app-config.js
auth.js             — Auth module: login, session, SHA-256, user CRUD
                      roles: admin, supervisor, sales, route_supervisor, asm
admin-data.js       — App object: saveDB, loadDB, switchRoute, Plan Mode (Draft/Active/History)
                      + StoreTrans: ย้ายร้านระหว่างสาย
                      + ExportCtrl: export เลือก plan/route ได้
                      + DateUtil: utility แปลง YYYY_MM → ชื่อเดือนไทย
admin-ui.js         — UI object: render, tabs, modals, toast
admin-map.js        — MapCtrl, Lasso tool
admin-ai.js         — AI route builder (K-Means++)
admin-style.css     — Admin styles
dashboard.js        — Dashboard: Sellout upload, KPI render, drill-down
                      + _CHUNK_SIZE: 500 (rows/chunk)
                      + _renderCampaignSection: Campaign widget รวมทุกสาย
                      + ไม่ใช้ orderBy — sort ใน JS แทน
file-manager.js     — FileManager: bulkImport Excel, exportAllRoutes
firebase-chunks.js  — ChunkDB: dead code — ไม่ได้ใช้ใน flow หลัก
store-history.js    — StoreHistory: ประวัติซื้อรายร้าน
                      Supervisor/ASM โหลดทุกสาย (ไม่กรอง sCode)
users.js            — UsersApp: user management UI
center-select.js    — Center selector logic
sales-app.js        — Sales/Supervisor app: State, UI, MapCtrl, CalendarCtrl, Processor
                      + SupervisorUI: Tab2 ร้านค้าทุกสาย, Tab3 grid เลือกสาย → คิวงาน
sales-dashboard.js  — SalesDashboard: KPI ยอดขายฝั่ง Sales
                      + _chunkCache: shared chunk cache ใช้ร่วมกันทุกที่ (ไม่โหลดซ้ำ)
                      + _loadChunks(ym): โหลด chunks แล้ว cache — เรียกแทน fetch ตรง
                      + SupervisorDashboard: KPI ยอดขายทุกสาย แยก C/V, Credit section
                      + _renderCampaigns: Campaign widget เฉพาะสายตัวเอง
sales-style.css     — Sales styles
sku-distribution.js — SkuDist: ระบบติดตามการกระจายสินค้า (SKU Distribution)
firestore.rules     — Firestore security rules
                      ⚠️ chunks rows.size() <= 550 (รองรับ CHUNK_SIZE=500)
audit-log.js        — Audit Log: บันทึก action + หน้าแสดง log
pwa-register.js     — PWA: register SW, install prompt, update banner
manifest.json       — PWA manifest
sw.js               — Service Worker: offline cache strategies
icons/              — PWA icons 72/96/128/192/512px
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
                                        fields: sCode, sType, custCode, custName, shopType,
                                                invDate, invNum, soNum, soStatus, invStatus,
                                                catDesc, brandDesc, prodCode, prodName,
                                                gross, net, soNet, qtyEA
                                        ⚠️ CHUNK_SIZE=500 → ต้องตั้ง Firestore rule <= 550

targets/{YYYY_MM}                     ← Target รายสาย { routes: { "402V01": 500000 } }

skuDistribution/{campaignId}          ← SKU Distribution Campaigns
                                        { name, startYM, endYM, centerId,
                                          defaultTarget, targetUnit, routeTargets: {},
                                          groups: [...], createdAt }

v1_raw_chunks/{chunkId}               ← Raw sales data
v1_sales_chunks/{chunkId}             ← Processed KPI
```

## Sellout Row Fields (หลัง normalize ใน dashboard.js)

```javascript
{
  sCode:    "402V01",           // Salesman Code
  sType:    "VanSales",         // "VanSales" | "CreditSales"
  custCode: "4020000690",       // Customer Code
  custName: "ร้านสายสุนีย์",
  shopType: "Retails",
  invDate:  "2026-05-04",
  invNum:   "402V01123853",     // Invoice Number
  soNum:    "402V01123853",     // SO Number
  soStatus: "Processed - Invoice",  // "Processed - Invoice" | "Credit Note"
  invStatus:"Invoiced",         // "Invoiced" | "Credit Note"
  catDesc:  "ซุปไก่สกัด",
  brandDesc:"แบรนด์ซุปไก่สกัด",
  prodCode: "14009569",
  prodName: "แบรนด์ซุปไก่สกัดต้นตำรับ 65มล.",
  gross:    286.02,             // Invoice Gross Amount
  net:      248.66,             // Invoice Net Amount  ← ใช้เป็นยอดหลัก
  soNet:    248.66,             // SO NET Amount (ยอดก่อน Confirm)
  qtyEA:    6,
}
```

**Credit Logic:**
- `invStatus === 'Invoiced'` → ยอด Confirm (Invoice Net)
- `invStatus === 'Credit Note'` → CN ลดยอด (ติดลบ)
- `soNet` → ยอดเปิดบิล SO (ก่อน Confirm)

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
admin            → index.html (เลือกศูนย์ได้อิสระ)
supervisor       → index.html (ล็อคกับ centerId จาก session)
route_supervisor → sales.html (เห็นทุกสาย, SupervisorUI)
asm              → sales.html (เห็นทุกสาย, SupervisorUI)
sales            → sales.html (เห็นแค่สายตัวเอง)
```

**Login redirect:**
- `sales`, `route_supervisor`, `asm` → `sales.html`
- `admin` → `center-select.html`
- `supervisor` → `index.html?center={centerId}`

## SupervisorUI (sales-app.js) — Route Supervisor / ASM

```javascript
// Tab1: Dashboard — SupervisorDashboard (เห็นทุกสาย แยก C/V)
// Tab2: ร้านค้า — หน้าตาเหมือน Sales แต่รวมทุกสาย + badge บอกสาย
// Tab3: สายวิ่ง — Grid card เลือกสาย → หน้าคิวงาน + แผนที่ (เหมือน Sales)

SupervisorUI.selectRoute(routeId)  // เลือกสาย → switchTab('route')
SupervisorUI.clearRoute()          // ย้อนกลับ grid
SupervisorUI.handleDrag()          // save ลำดับลง Firestore ของสายนั้น
SupervisorUI.renderAllStores()     // Tab2: ร้านทุกสายรวม + badge
SupervisorUI.renderRouteGrid()     // Tab3: grid card แบ่ง C/V
```

**State เพิ่มเติมสำหรับ Supervisor:**
```javascript
State.viewMode    // 'sales' | 'route_supervisor' | 'asm'
State.centerId    // centerId ที่ผูกไว้
State.allRoutes   // { routeId: [store, ...] } ทุกสาย
State.routeList   // ['402C01','402C02','402V01',...] รายชื่อสายทั้งหมด
```

## SupervisorDashboard (sales-dashboard.js)

```javascript
SupervisorDashboard.init()               // เรียกหลัง startSupervisor()
SupervisorDashboard.onMonthChange(ym)    // เปลี่ยนเดือน
SupervisorDashboard._loadData(ym)        // โหลด chunks ผ่าน SalesDashboard._loadChunks (shared cache)
SupervisorDashboard._render()            // render KPI + C/V section + route table
```

**Credit Section:**
- ✅ ยอด Confirm = `invStatus === 'Invoiced'` net รวม
- 📋 ยอดเปิดบิล (SO) = `soNet` รวม
- 📝 Credit Note = `invStatus === 'Credit Note'` (ติดลบ)

## Shared Chunk Cache (ประสิทธิภาพ)

```javascript
// SalesDashboard._loadChunks(ym) — โหลด 1 ครั้ง cache ไว้ใช้ร่วมกัน
// ทุก function ที่ต้องการ rows ของเดือนนั้นให้เรียกผ่านนี้:
SalesDashboard._chunkCache          // { 'YYYY_MM': rows[] } ทั้งหมดไม่กรอง
SalesDashboard._loadChunks(ym)      // return rows[] (from cache or Firestore)

// ใช้ใน:
// - SalesDashboard._loadData (กรอง sCode หลัง load)
// - _renderCampaigns loadMonthRows (กรอง custCode)
// - SupervisorDashboard._loadData (กรอง centerId prefix)
// campaign months โหลด parallel ด้วย Promise.all
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

```javascript
// โหมด A: Cycle
calendarConfig: { mode:'cycle', startDay:1, startDayNum:1, cycleDays:24, holidays:[5,12] }

// โหมด B: Fixed
calendarConfig: { mode:'fixed', mapping: { "1": "Day 5", "8": "Day 6" } }
```

## Session & Auth

```javascript
Auth.getSession()     // { username, role, centerId, expiresAt }
Auth.guard(['admin']) // redirect ถ้าไม่ใช่ role ที่อนุญาต
App.isSupervisor()    // true ถ้า role = route_supervisor | asm
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

## Key Global State (Sales / Supervisor)

```javascript
State.myRoute          // สายของ sales หรือสายที่ Supervisor เลือกอยู่
State.allStores        // ร้านทั้งหมดของสายที่กำลังดู
State.currentDay       // Day ที่เลือกอยู่
State.calendarConfig   // config ปฏิทิน
State.activePlanMode   // 'active' | 'draft'
State.isLoaded         // true เมื่อโหลดเสร็จ
State.viewMode         // 'sales' | 'route_supervisor' | 'asm'
State.centerId         // centerId (Supervisor เท่านั้น)
State.allRoutes        // { routeId: stores[] } (Supervisor เท่านั้น)
State.routeList        // ['402V01',...] (Supervisor เท่านั้น)
```

## SkuDist — Target Bug Fix

```javascript
// Bug เดิม: _setRouteTarget ล็อค n <= 100 ทำให้ตั้งจำนวนร้าน > 100 ไม่ได้
// แก้แล้ว: maxVal = targetUnit === 'pct' ? 100 : 99999

// Bug เดิม: saveCampaign ใช้ merge:true ทำให้ routeTargets ข้าม Campaign
// แก้แล้ว: ใช้ .set(data) แบบ overwrite
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
- **Sellout chunks โหลดผ่าน `SalesDashboard._loadChunks(ym)`** — ห้าม fetch ตรง
- **CHUNK_SIZE = 500** — Firestore rule ต้องตั้ง `rows.size() <= 550`
- **Re-upload Excel ทุกเดือนหลังเปลี่ยน CHUNK_SIZE** — เพื่อ rebuild chunks

## สิ่งที่ยังค้างอยู่ (TODO)

- [ ] favicon.ico (404 ใน console แต่ไม่กระทบ)
- [x] Audit Log ✅
- [x] PWA manifest + Service Worker ✅
- [x] Role route_supervisor + asm ✅
- [x] SupervisorUI: Tab2 ร้านค้า + Tab3 grid เลือกสาย ✅
- [x] SupervisorDashboard: C/V แยก + Credit Confirm/SO/CN ✅
- [x] Shared chunk cache (ลด Firestore reads) ✅
- [x] CHUNK_SIZE 300 → 500 ✅
- [ ] SkuDist: allProdOptions ควร union prodCode จากทุกเดือนใน range
- [ ] KPIMgr: product focus field ควรเก็บใน config document ของ center
- [ ] Campaign widget: refresh อัตโนมัติเมื่อสร้าง/ลบ campaign (ตอนนี้ต้อง reload)
- [ ] Supervisor: ปฏิทินการทำงาน (calendar tab)

## Session 4 — สิ่งที่เพิ่ม/แก้

### Role ใหม่: route_supervisor, asm
- `auth.js`: เพิ่มใน VALID_ROLES, guard redirect → sales.html
- `login.html`: redirect role ใหม่ → sales.html
- `users.html`: dropdown เพิ่ม Route Supervisor, ASM

### SupervisorUI (sales-app.js)
- Tab2: ร้านค้าทุกสาย หน้าตาเหมือน Sales + badge สาย (C=ม่วง, V=น้ำเงิน)
- Tab3: Grid card เลือกสาย แบ่ง C/V → กดแล้วเข้าหน้าคิวงานทันที
  - ปุ่ม "← เลือกสายใหม่" ใน route tab
  - Drag reorder + save Firestore ได้
- `store-history.js`: Supervisor ไม่กรอง sCode → ยอดขายรายร้านขึ้นครบ

### SupervisorDashboard (sales-dashboard.js)
- เห็นยอดทุกสาย แยก Credit (C) vs Van (V)
- Credit: ✅ Confirm + 📋 เปิดบิล SO + 📝 CN
- ตารางรายสาย + % vs Target
- `db-kpi-pct` แสดง % vs Target รวม
- `db-month-sel onchange` รองรับทั้ง Sales และ Supervisor

### dashboard.js
- `_normalizeRows`: เพิ่ม soNum, soStatus, soNet, sType, include Credit Note
- `_CHUNK_SIZE`: 300 → 500
- ลบ `orderBy` ออก sort ใน JS

### sku-distribution.js
- `_setRouteTarget`: แก้ maxVal ตาม unit (pct=100, count=99999)
- `saveCampaign`: ลบ `merge:true` → overwrite แทน

### Firestore Rules
- `sellout/chunks`: `rows.size() <= 550` (รองรับ CHUNK_SIZE=500)

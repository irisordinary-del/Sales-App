# CLAUDE.md — Sales-App / Route Planner
> อ่านไฟล์นี้ก่อนทำงานทุกครั้ง

---

## 🌐 URLs สำคัญ
- **Sales App**: https://sales-app-7ids.vercel.app/sales.html
- **Admin**: https://sales-app-7ids.vercel.app/index.html
- **GitHub**: https://github.com/irisordinary-del/Sales-App (branch: `main`, auto-deploy)
- **Firebase**: route-plan-71e2e

---

## 📁 ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
|------|---------|
| `index.html` | Admin UI หลัก + CalendarAdmin + PlanUI |
| `admin-data.js` | StoreMgr, App controller, ExportCtrl, handleMapUpload |
| `admin-ui.js` | Nav, UI render, PlanUI.refresh, summary cards |
| `admin-map.js` | MapCtrl, Lasso |
| `admin-ai.js` | K-Means++ AI |
| `file-manager.js` | FileManager upload/export/bulkImport |
| `sales-app.js` | Sales logic, CalendarCtrl, App.start/startSupervisor |
| `sales-dashboard.js` | Dashboard ยอดขาย |
| `auth.js` | SHA-256 + Firestore, SESSION_TTL 16h, renewSession |
| `sw.js` | Service Worker rp-v3 |
| `sku-distribution.js` | SKU Distribution campaigns |
| `store-history.js` | ประวัติการซื้อรายร้าน |
| `users.html/js` | User Management |
| `firestore.rules` | Security rules |

---

## 🗄️ Firebase Structure

```
appData/
  {CENTER_ID}_main/              ← เช่น "402_main"
    routeList: [...]
    draftList: ['2026_05','2026_06','2026_07']
    historyList: [...]
    calendarConfig: {...}        ← active plan calendar
    routes/{routeName}/stores:[...]
    drafts/{YYYY_MM}/
      calendarConfig: {...}
      routes/{routeName}/stores:[...]

appData/app_users, app_centers
sellout/{YYYY_MM}/chunks/
skuDistribution/{campaignId}/
```

---

## 📅 ระบบ Plan (สำคัญมาก)

### แนวคิดหลัก
- **ไม่มีคำว่า Draft/Active** — เรียกว่า "Plan" เฉยๆ
- แต่ละเดือนมี Plan ของตัวเอง แยกข้อมูลกันสมบูรณ์
- Admin เลือกเดือนจาก dropdown แล้วจัดการได้เลย

### Calendar Mode (หัวใจความแตกต่างแต่ละศูนย์)

| Mode | Day ในไฟล์ | ความหมาย | ตั้งค่า |
|------|-----------|---------|--------|
| 🔄 **Cycle D1-24** | `1`-`24` | cycle day → map กับปฏิทิน | ตั้ง startDay + holidays |
| 📅 **วันที่จริง** | `2,3,4...` | Day = วันที่จริงของเดือน | ไม่ต้องตั้งอะไร |
| 📌 **กำหนดเอง** | custom | Admin map เองว่าวันที่ X = Day อะไร | ระบุ mapping |

### Store Object Fields
```js
{
  id, name, lat, lng, freq, days, seqs, selected,
  code, salesCode, shopType, subDistrict, district, province,
  marketName, cy, dayOriginal
}
```

---

## 👥 Roles

| Role | สิทธิ์ |
|------|--------|
| `admin` | เข้าได้ทุกศูนย์ |
| `supervisor` | เข้าได้ศูนย์ที่ผูกไว้ |
| `route_supervisor` | Sales app — ดูภาพรวมทุกสาย |
| `asm` | เหมือน route_supervisor |
| `sales` | Sales app — ดูสายตัวเอง |

---

## 🏗️ Sales App Architecture (sales-app.js)

### State Object
```js
let State = {
    myRoute, allStores, routeStores, sales,
    currentDay, isLoaded, mapNeedsFit,
    calendarConfig, activePlanYM, activePlanMode,
    viewMode, centerId, allRoutes, routeList,
    _filterMarket,          // filter ร้านตามตลาด
    planList,               // ['active:2026_05','2026_06','2026_07']
    planCache,              // { ym: { stores, calendarConfig } }
    planCenterDocId,
};
```

### App Functions สำคัญ
```js
App._getWithTimeout(ref, ms)  // Firestore get + timeout
App.loadPlanList(centerDocId) // โหลด planList ทั้งหมด
App.loadPlanData(ym)          // โหลดข้อมูลของ plan เดือนนั้น (lazy+cached)
App.switchToPlan(ym)          // switch ไปใช้ plan เดือนนั้น
App.start()                   // Sales login flow
App.startSupervisor()         // Supervisor login flow
```

### Calendar Render (สำคัญมาก)
- ปฏิทินแต่ละเดือนต้องใช้ `calendarConfig` และ `stores` ของเดือนนั้นเอง
- ใช้ `getDayLabelForCfg(dateNum, cfg, stores, year, month)` แทน `getDayLabel()`
- `_renderPlan = State.planCache[_renderYM]` — ดึง cache ของเดือนที่ render
- `hasRoute` เช็คจาก `_renderStores` ไม่ใช่ `State.allStores`

### trimMarketName
```js
// "402C01 D02 บ้านโป่ง 2" → "บ้านโป่ง 2"
function trimMarketName(raw) {
    return raw.replace(/^[A-Z0-9]+\s+D\d+\s+/i, '').trim();
}
```

---

## ⚙️ Admin Architecture (index.html)

### CalendarAdmin Object
```js
CalendarAdmin.open(planMode)  // เปิด modal, set _targetRef อัตโนมัติ
CalendarAdmin.setMode(mode)   // 'cycle' | 'date' | 'fixed'
CalendarAdmin.save()          // บันทึกลง Firestore ตาม _targetRef
```

**หมายเหตุ**: `open()` ใช้ `App._planMode` ปัจจุบันเสมอ → set `_targetRef` ถูกต้อง

### PlanUI
```js
PlanUI.refresh()  // โหลด planList แสดงใน dropdown ชื่อเดือน (ไม่มีคำว่า Draft)
```

---

## 🐛 Bugs ที่แก้ไปแล้ว (สำคัญ — อย่าทำซ้ำ)

| Bug | สาเหตุ | ไฟล์ |
|-----|--------|------|
| `routes is not defined` | ไม่ declare `const routes = State.routeList` | `sales-app.js` |
| `finalArray is not defined` | toast อยู่นอก `_processUpload` scope | `admin-data.js` |
| Calendar แสดงจุดทุกเดือนเหมือนกัน | `getDayLabel` ใช้ `State.allStores` ทุกเดือน | `sales-app.js` |
| CalendarAdmin save ไม่ถึง Firestore | `_targetRef` ชี้ผิด path | `index.html` |
| Bulk Import ไม่ update วันวิ่งเดิม | merge logic เพิ่มแค่ร้านใหม่ | `file-manager.js` |
| `cfg` naming conflict | ใช้ชื่อตัวแปรซ้ำใน loop | `sales-app.js` |
| goToDay ซ้ำ 2 อัน | แก้หลายรอบทำให้ duplicate | `sales-app.js` |
| ชื่อตลาดหายข้ามเดือน | `getDayMarketList` ไม่ได้เช็ค month | `sales-app.js` |

---

## 🔧 Performance Fixes

- **Firestore timeout**: ทุก `get()` ใช้ `App._getWithTimeout()` ป้องกัน hang
- **Promise.all**: โหลด routes ทุกสายพร้อมกัน ไม่ใช่ sequential
- **planCache**: lazy load + cache ข้อมูลแต่ละเดือน ไม่โหลดซ้ำ
- **Non-blocking calendar**: เปิดปฏิทินทันที โหลดเดือนอื่น background

---

## 📝 TODO (งานค้าง)

| งาน | ความสำคัญ |
|-----|---------|
| วันหยุดอาทิตย์ auto-detect (date mode) | 🟡 |
| Supervisor Calendar tab | 🟡 |
| รื้อ PlanUI dropdown ใน index.html ให้สะอาด | 🟡 |
| Export ตามเดือนที่เลือก | 🟢 |

---

## 💡 หมายเหตุสำคัญ

1. **SW version** = `rp-v3` — เพิ่มทุกครั้งที่ deploy
2. **Session TTL** = 16 ชั่วโมง + auto-renew ถ้าเหลือ < 4h
3. **date mode** = Day N = วันที่ N ของเดือน ไม่ต้องตั้งค่าเพิ่ม
4. **planList** โหลดจาก `draftList` + active plan ของเดือนปัจจุบัน
5. **ไม่มีคำว่า Draft/Active/History** ในหน้า UI — ใช้ชื่อเดือนแทน

---
*อัพเดทล่าสุด: 2026-05-20 | Claude Sonnet 4.6*

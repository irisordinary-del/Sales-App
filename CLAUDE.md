# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Sales-App / Route Planner (RoutePlan)

A vanilla JS/HTML PWA for planning and running sales delivery routes across multiple "centers" (ศูนย์), backed by Firebase/Firestore. No framework, no bundler, no build step beyond a service-worker cache-bust.

---

## 🌐 URLs / Deploy

- **Sales App**: https://sales-app-7ids.vercel.app/sales.html
- **Admin**: https://sales-app-7ids.vercel.app/index.html
- **GitHub**: https://github.com/irisordinary-del/Sales-App
- **Firebase project**: route-plan-71e2e (Firestore only)

**⚠️ Branch/deploy note**: the repo has `main`, `staging`, and `staging2`. As of 2026-09, Vercel's production deploy is wired to **`staging2`** — pushing to `staging2` is what actually ships to `sales-app-7ids.vercel.app`. Verify against the Vercel dashboard before assuming `main` is live; don't blindly follow old docs (including older revisions of this file) that say `main` auto-deploys.

## Commands

There is no build tool, package manager, linter, or test suite in this repo (no `package.json`). It's plain HTML/CSS/JS served as static files.

- **Run locally**: open the `.html` files directly, or serve the folder with any static file server. There's no dev server script.
- **Deploy**: `git push origin staging2` (see branch note above) → Vercel auto-deploys.
- **Service worker cache-busting is automatic**: `vercel.json`'s `buildCommand` runs `sed -i "s/__BUILD_TS__/$(date +%Y%m%d%H%M%S)/g" sw.js`, stamping `sw.js`'s `CACHE_VERSION = 'rp-__BUILD_TS__'` with a real timestamp at build time. You do **not** need to manually bump a version string before deploying (older docs/handoff notes that say "bump CACHE_VERSION" are describing an obsolete manual process).
- **Serverless functions** (`api/*.js`, Vercel Node functions) require `ORS_API_KEY` (an OpenRouteService key) set as a Vercel env var — used for route optimization/distance/elevation. Missing it makes those endpoints 500 with a Thai error message, not a silent failure.
- **Sanity-check a JS file after editing**: `node --check <file>.js` (no test runner exists; this just catches syntax errors).

---

## 📁 File Map

| File | Purpose |
|------|---------|
| `index.html` | Admin UI shell — route planning, map, CalendarAdmin modal, PlanUI, AI Route Builder panel |
| `admin-data.js` | `App` controller (plan load/switch, Firestore I/O), `StoreMgr`, `ExportCtrl`, `handleMapUpload` |
| `admin-ui.js` | Nav rendering, `PlanUI.refresh`, summary cards |
| `admin-map.js` | `MapCtrl` (Leaflet), Lasso select |
| `admin-ai.js` | K-Means++ clustering for AI Route Builder |
| `admin-cellsplit.js` | "แบ่งเซลล์" (split cell/territory) tool — step 1 shows a live color-coded overview map of every route in the center (grouped by route-code prefix, e.g. C/V), step 2 does the actual K-Means++ split |
| `admin-nav.js`, `admin-theme.js` | Small nav/theme helpers for admin pages |
| `file-manager.js` | `FileManager` — 5 different store-data import paths, `_autoFillMarketNames`, `_sortStoresForExport`, exports — see "Importing Store Data" section below |
| `app-config.js`, `app-config-init.js` | Firebase init, `ErrorMsg` (Firebase error → Thai message), long-polling config |
| `sales-app.js` | Sales-facing app: `State`, `App.start`/`App.startSupervisor`, `CalendarCtrl`, `SupervisorUI` |
| `sales.html` | Sales-facing shell (loads `sales-app.js`) |
| `sales-dashboard.js` | `SalesDashboard` / `SupervisorDashboard` — sales KPI views |
| `dashboard.js` | Admin-side `Dashboard` — org-wide sales analytics, targets, "อัปโหลด Sellout" (sellout Excel upload: auto-detects month from actual `kpiDate` rows rather than trusting the filename, warns if a re-upload has fewer rows than what's already stored) |
| `sku-distribution.js` | SKU Distribution campaign management |
| `store-history.js` | Per-store purchase history |
| `tasks.html` / `tasks.js` | "งานที่ต้องส่ง" task list feature |
| `users.html` / `users.js` | User management |
| `login.html` | Standalone login page |
| `center-select.html` | Center picker (inline script, no separate JS file) |
| `audit-log.js` | Audit log viewer/writer |
| `auth.js` | SHA-256 password hashing + Firestore auth, `SESSION_TTL` 16h, `renewSession` |
| `migrate-to-plans.html` | One-off migration tool (drafts/history → unified `plans/` structure) |
| `sw.js` | Service worker (`CACHE_VERSION`, precache list, network strategies) |
| `pwa-register.js` | SW registration |
| `manifest.json` | PWA manifest |
| `firestore.rules` | Security rules |
| `api/optimize-route.js` | Vercel function — proxies OpenRouteService Optimization (VROOM) for AI Route Builder |
| `api/route-distance.js` | Vercel function — proxies ORS Directions to get real distance/duration for a *fixed* store order |
| `api/elevation.js` | Vercel function — proxies ORS elevation lookup |

All `api/*.js` proxy to OpenRouteService **only** to keep `ORS_API_KEY` server-side — never call ORS directly from client code.

---

## 🗄️ Firestore Structure

```
appData/
  app_users                                    ← user accounts (role, centerId, password hash)
  app_centers                                  ← { centerId: {name, docId, routeCount} } for the center picker
  {CENTER_ID}_main/                            ← e.g. "402_main" (window.CENTER_DOC)
    routeList, calendarConfig, currentPlanYM   ← currentPlanYM = the month Sales sees "live" (see Plan system below)
    plans/{YYYY_MM}/
      calendarConfig: {...}                    ← THIS MONTH's default calendar (center-wide) — see Calendar Mode below
      routeOverrides is NOT stored here — it lives per-route, see below
      routes/{routeCode}/
        stores: [ {...Store Object} ]
        calendarOverride: {...} | (absent)      ← optional, THIS route + THIS month only; wins over plans/{ym}.calendarConfig
        confirmedBy, confirmedAt                ← sales rep's "รับทราบสายวิ่ง" ack; reset to unset whenever days/calendar change

targets/{CENTER_ID}_{YYYY_MM}                  ← per-route sales targets (current format, centerId-prefixed)
targets/{YYYY_MM}                              ← legacy format, read-only fallback — do not write to it
sellout/{CENTER_ID}_{YYYY_MM}/chunks/          ← sales data, current format
sellout/{YYYY_MM}/chunks/                      ← legacy format (pre centerId-prefix), still has real historical data
skuDistribution/{campaignId}/
auditLogs/{centerId}/logs/{logId}
```

**Important**: `calendarConfig` is set **independently per month** (`plans/{ym}.calendarConfig`) — a center is not "in cycle mode" or "in date mode" globally, each month's plan carries its own mode and can differ from the month before or after it. Never assume month N+1 uses the same mode as month N; always read that month's own `plans/{ym}.calendarConfig` (or a route's override) before interpreting its stores' `days` values or copying schedules between months.

### Store Object fields
```js
{
  id, name, lat, lng, freq, days, seqs, selected,
  code, salesCode, shopType, subDistrict, district, province,
  marketName,        // embeds a "D{N}" token + subdistrict/district/province, e.g. "402V11 D13 หนองโอ่ง อู่ทอง สุพรรณบุรี"
  dayOriginal,       // raw "Cycle Name"/"Day" value captured at file upload — exported as-is, NOT auto-kept in sync with `days` after re-planning
  cy,
}
```
- `days`: array of "Day N" label strings — the LIVE schedule actually used to render the sales calendar (a store can have multiple entries, e.g. visited twice a month).
- `seqs`: map of `"Day N"` → sequence number (visit order within that day).
- `dayOriginal`: display-only "Cycle Name" for export; a store's real position is `days`, not this field. These two can drift apart over time (see calendar mode history below) — don't assume they match.

---

## 📅 Plan System

- No "Draft/Active/History" naming anywhere in the UI or in new code — everything is just "a Plan" for a given month (`YYYY_MM`). `migrate-to-plans.html` was the one-time tool that collapsed the old drafts/active/history split into this unified `plans/{ym}` structure.
- Admin can browse/edit any month's plan without affecting what Sales sees. What Sales actually sees as "current month" is `{CENTER_ID}_main.currentPlanYM` — admin only updates this when explicitly switching the live plan (`App._currentPlanYM` is just the admin's local viewing state, separate from `App._livePlanYM`).
- `State.planCache[ym]` caches `{ stores, calendarConfig, routeOverrides, confirmedBy/At }` per month, lazy-loaded — always populate all of these fields when seeding the cache (a past bug: forgetting `routeOverrides` here made per-route calendar overrides silently ignored, see Bugs table).

### Calendar Mode
Set per `plans/{ym}.calendarConfig.mode`, optionally overridden per-route via `routes/{routeCode}.calendarOverride` (same shape, wins when present):

| Mode | Meaning | Key fields |
|------|---------|--------|
| `cycle` | Rotating N-day cycle (commonly 24) independent of calendar dates; holidays are skipped when counting | `cycleDays`, `anchorType` (`date` \| `weekday-once` \| `weekday-rolling`), `startDay`/`startDayNum`/`anchorWeekday`/`anchorDate`/`anchorDayNum` depending on anchorType, `holidays` (specific dates), `weeklyHolidays` (weekday numbers, e.g. `[0]` = every Sunday) |
| `date` | Day N = literal calendar date N of the month | `holidays`, `weeklyHolidays` (both usable here too, e.g. to gray out Sundays) |
| `fixed` | Admin manually maps specific calendar dates → arbitrary Day labels | `mapping: { "5": "Day 2", ... }` |
| `weekday` | Day N = a fixed weekday, repeats every week all month (e.g. "Day 1" = every Monday) | `weekdayMap: { "Day 1": 1, ... }` (0=Sun..6=Sat) |

All modes funnel through `CalendarCtrl.getDayLabelForCfg(dateNum, cfg, stores, year, month)` (sales-app.js) — this is the single source of truth for "what Day label does calendar date X show" and must stay in sync with `CalendarAdmin._computeDayLabel`/`_renderPreview` (index.html), which implement the same logic for the admin preview grid. If you change the mapping rules, update both.

**Resolving which config applies**: never read `State.calendarConfig` or `plans/{ym}.calendarConfig` directly in per-route display logic — always go through `CalendarCtrl._resolveActiveCfg(year, month)`, which checks the current route's override first, then falls back to that month's plan default. Several past bugs (see below) were caused by call sites bypassing this and reading the center/plan default directly, silently ignoring a route's override.

**Cross-month schedule copies**: because mode is independent per month, copying a `days`/`seqs` schedule from one month to another is only safe if both months use the *compatible* mode (e.g. cycle→cycle with the same `cycleDays`). Copying `date`-mode `days` (which can go up to 28-31) into a `cycle`-mode month (capped at `cycleDays`, commonly 24) silently makes any store whose Day number exceeds `cycleDays` invisible on the sales calendar forever — always check both months' `plans/{ym}.calendarConfig.mode` before bulk-copying, and if mode differs, the source month's day-groups need renumbering (compact distinct values to `1..N`, keep relative order) rather than a literal copy.

---

## 👥 Roles (`auth.js` / Firestore `app_users.role`)

| Role | Access |
|------|--------|
| `admin` | Every center |
| `supervisor` | Centers explicitly linked to the account |
| `route_supervisor`, `asm` | Sales app, all-routes overview (`SupervisorUI`) for their center |
| `sales` | Sales app, own route only |

---

## 🏗️ Sales App (`sales-app.js`)

### `State` (top-level mutable object)
```js
let State = {
    myRoute, allStores, routeStores, sales,
    currentDay, isLoaded, mapNeedsFit,
    calendarConfig, activePlanYM, activePlanMode,
    activeRouteOverrides,   // { routeCode: calendarOverride|null } for whatever route(s) are in view
    viewMode, centerId, allRoutes, routeList,
    _filterMarket,          // filter stores by market name
    planList,               // e.g. ['active:2026_09','2026_10','2026_11']
    planCache,              // { ym: { stores, calendarConfig, routeOverrides, confirmedBy/At } }
    planCenterDocId,
};
```

### Key `App` functions
```js
App._getWithTimeout(ref, ms)   // Firestore get() with a timeout guard, use for every get()
App.loadPlanList(centerDocId)  // load available plan months
App.loadPlanData(ym)           // lazy-load + cache one month's plan
App.switchToPlan(ym)           // switch the active view to another month
App.start()                    // sales login flow (single-route sales rep)
App.startSupervisor()          // supervisor/route_supervisor/asm login flow (multi-route)
App.isSupervisor()             // role in ['route_supervisor','asm']
```

### `CalendarCtrl` (calendar rendering + resolution)
```js
CalendarCtrl._resolveActiveCfg(year, month)   // ALWAYS use this instead of reading calendarConfig directly — see Calendar Mode above
CalendarCtrl.getDayLabelForCfg(dateNum, cfg, stores, year, month)
CalendarCtrl.getDateFromDay(dayLabel)         // inverse of getDayLabelForCfg — must mirror its branches exactly
CalendarCtrl.getDatesFromDayInMonth(...)
CalendarCtrl.render()
```

### `trimMarketName`
```js
// "402C01 D02 บ้านโป่ง 2" → "บ้านโป่ง 2"
function trimMarketName(raw) {
    return raw.replace(/^[A-Z0-9]+\s+D\d+\s+/i, '').trim();
}
```
Note: the "D{N}" token embedded in `marketName` is a display artifact set once and never recomputed — it's not guaranteed to match the current `days` value or `dayOriginal`, but has been observed to match the master source file's originally-intended Cycle Name.

---

## ⚙️ Admin Architecture (`index.html`)

### `CalendarAdmin`
```js
CalendarAdmin.open(planMode)   // opens the modal, auto-sets _targetRef based on App's current plan/route context
CalendarAdmin.setMode(mode)    // 'cycle' | 'date' | 'fixed' | 'weekday' — toggles which config section is visible
CalendarAdmin.save()           // writes calendarConfig (center/plan-wide) or calendarOverride (if _targetRoute is set) to Firestore
CalendarAdmin._loadConfig()    // loads existing config into the form when the modal opens
```
- Holidays (`holidays` + `weeklyHolidays`) apply to **both** `cycle` and `date` modes — the holiday UI section is a sibling of the mode-specific sections, not nested inside the cycle-only one.
- `save()` always writes a complete `cfg` object per mode (never a partial object) — Firestore writes here are shallow merges at the `calendarConfig`/`calendarOverride` field, so writing a partial object (e.g. `{mode:'date'}` alone) silently deletes any other fields (like holidays) that were previously set.
- The "ตั้งค่าสำหรับ" target-route dropdown marks routes that already have a `calendarOverride` for the month being viewed as `⚡ {route} (ตั้งค่าเฉพาะ)` instead of the plain `🚚 {route}` (`CalendarAdmin._markOverrideRoutes`, fetched once when the modal opens and again on `shiftMonth`) — lets an admin see which routes differ from the center default without opening each one. A `🗑️ ลบ override` button appears only when the selected route actually has one; clears it back to the center default.

### `PlanUI`
```js
PlanUI.refresh()  // loads planList, renders the month dropdown (shows month names only, no "Draft" language)
```

---

## 📤 Importing Store Data (`file-manager.js`)

There are **five** distinct ways to get store data into a route, each with a different scope and column-matching strategy — don't assume they're interchangeable:

| Function | UI entry point | Scope | Column matching | Notes |
|---|---|---|---|---|
| `bulkImport` | "อัปโหลด Excel" (bulk) | **All routes** in the file | Fixed positions (A=CY, B=Code, C=Name, D=SalesCode, E=Type, F=SubDistrict, G=District, H=Province, I=Lat, J=Lng, K=Market, L=Day) | The original template format |
| `handleMapUpload` | "📦 อัปโหลดพิกัด" | **Current active route only** | Flexible — matches header text by keyword (`lat`/`ละติจูด`, `รหัส`, `ตลาด`, etc.) | Good for a quick single-route refresh from an odd-shaped file; requires headers containing recognizable Thai/English keywords (plain "Province"/"Sales Code" with a space won't match — see gotcha below) |
| `importMasterDetail` | "📄 นำเข้า Master" → "ตั้งศูนย์ใหม่ / จัดใหม่ทั้งชุด" | **All routes**, replaces everything | Strict SAP header names: `Customer Code`, `Master Latitude/Longitude`, `Salesman Code`, `Outlet Category` (Master) + `Route Code`, `Cycle Code`, `Cycle Name` (Detail) | 2 files — Customer Master (coords/address) + RoutePlan Detail (days/market name from `Cycle Name`, which already has the market text embedded, e.g. "402C01 D01 บ่อพลอย ลาดหญ้า หนองปรือ") |
| `importMasterOnly` | "📄 นำเข้า Master" → "อัปเดตจาก Master เท่านั้น" | **All routes**, patches in place | Same Customer Master header names as above | Single file. **Never touches** `days`/`seqs`/`marketName`/`dayOriginal` on existing stores — only updates name/coords/address/shopType, moves a store to a new route if its Salesman Code changed, adds brand-new stores with no day (left for AI Route Builder) |
| `importSalesRouteFile` | "📄 นำเข้า Master" → "ไฟล์เดียว (Sales Route)" | **All routes**, replaces everything | Header names: `Sales Code`, `ชื่อตลาด`, `Customer Code`, `Customer Name`, `Cycle name`, `Province`, `Latitude`, `Longitude` | For company exports that combine everything (route + customer + geo) into one sheet instead of the Master+Detail split. Ignores the file's `Day` column (it's an Excel date serial for that specific month, not a cycle number) and derives the day purely from `Cycle name`'s `D{N}` token. Handles F2 (same Customer Code, second `Cycle name`) and drops exact-duplicate rows. No subDistrict/district columns in this format — only province, so `_autoFillMarketNames` on this data produces much shorter generated names (just `{salesCode} D{NN} {province}`) than centers whose files do carry tambon/district |

All five funnel new/changed routes through `_commitByRouteImport` (merge existing stores, flag missing ones for a "reactivate or remove?" popup, save).

### `FileManager._autoFillMarketNames(stores)`
Fills in `marketName` for any store missing one, grouped by day (F2 stores count toward every day they appear in):
1. **If a peer in the same route+day group already has a marketName** → copy it verbatim.
2. **Otherwise generate one**: `{salesCode} D{NN} {top-2 most-frequent tambons} {most-frequent district} {most-frequent province}`, stripping both `ต./อ./จ.` and full-word `ตำบล/อำเภอ/จังหวัด` prefixes first. If the district name happens to equal one of the two tambons, it's included twice on purpose (not deduped) — this was an explicit design choice.
Called after every import above, after AI Route Builder finishes, and again right before both export functions (`exportTemplate`/`exportAllRoutes`) as a final safety net for stores added by hand that never went through an import.

⚠️ **Gotcha**: grouping falls back to `dayOriginal` when a store has no `days` at all — this is correct for a fresh import (nothing assigned yet) but wrong for a store the AI Route Builder just deliberately left unassigned (dropped as a geographic outlier), because `dayOriginal` still holds a stale value from the original import file. `AI.calc()` clears `dayOriginal` on any store with `days.length === 0` right before calling `_autoFillMarketNames`, specifically to prevent a dropped store from getting a misleading market name that looks like a real day assignment (see bug table).

### `FileManager._sortStoresForExport(stores)`
Both `exportTemplate` (single route) and `exportAllRoutes` (all routes) sort through this before writing the sheet: **day number** (parsed from `days[0]`/`dayOriginal`, not the calendar-date string the Day *column* may show) → **market name** (so a day containing more than one market stays grouped) → **visit sequence** (`seqs[day]`). Stores with no day at all sort to the very end (`Infinity`). `exportAllRoutes`'s route order is also sorted (`localeCompare` with `numeric:true`) instead of whatever order Firestore/`Object.keys()` happened to return.

---

## 🐛 Notable bugs already fixed (don't reintroduce)

| Bug | Root cause | File(s) |
|-----|--------|------|
| Route calendar overrides silently ignored | 5+ call sites read `State.calendarConfig`/plan default directly instead of going through a resolver that checks the route's override first | `sales-app.js` (now centralized via `CalendarCtrl._resolveActiveCfg`) |
| `App.start()`/`startSupervisor()` race condition | `State.planCache`/`activeRouteOverrides` seeded *after* `checkReady()` had already run, so the first render used stale/missing override data | `sales-app.js` |
| Calendar admin save wiping holidays | `CalendarAdmin.save()`'s `date`-mode branch wrote `{mode:'date'}` alone; save() does a shallow merge, so any previously-set `holidays`/`weeklyHolidays` were deleted | `index.html` |
| `routes is not defined` | missing `const routes = State.routeList` | `sales-app.js` |
| `finalArray is not defined` | toast call outside `_processUpload` scope | `admin-data.js` |
| Calendar showed same dots every month | `getDayLabel` always used `State.allStores` instead of the rendered month's own stores | `sales-app.js` |
| Bulk Import didn't update existing schedules | merge logic only added new stores, ignored changes to existing ones | `file-manager.js` |
| Market name disappeared across months | `getDayMarketList` didn't check month | `sales-app.js` |
| ORS "Invalid profile: car." | optimize-route.js omitted `profile`, ORS defaulted to the bare string `car` instead of `driving-car` | `api/optimize-route.js` |
| `targets/{ym}` cross-center clobbering | targets doc key had no centerId prefix, so any center saving targets overwrote every other center's targets for that month | `dashboard.js`, `sales-dashboard.js` |
| "ไม่ได้เชื่อมต่ออินเตอร์เนต" (false "no internet") switching centers | `sw.js`'s cache-first strategy did `cache.match(request)` without `{ ignoreSearch: true }`, so `/index.html?center=X` variants never matched the single precached bare `/index.html` entry and fell through to a network fetch that could fail | `sw.js` |
| Bulk merge silently wiped real schedules | `days: inc.days \|\| s.days` — an empty array from the incoming file is truthy in JS, so a file with no day info for a store overwrote its real existing schedule with nothing | `file-manager.js` (`_commitByRouteImport`) |
| Exported files not sorted at all | `exportTemplate`/`exportAllRoutes` mapped `State.stores`/`routes[name]` straight into the sheet in raw array order — no sort by day, market, or sequence at all | `file-manager.js` (fixed via `_sortStoresForExport`) |
| AI Route Builder gave outlier stores a fake market name | see the `_autoFillMarketNames` gotcha above — a store AI dropped as a geographic outlier (`days: []`) still had a stale `dayOriginal`, so it got grouped and named as if it belonged to that old day (e.g. `"403V01 D02 นราธิวาส"` for a store with no day at all) | `admin-ai.js` |

---

## 🔧 Performance patterns already in place

- Every Firestore `get()` goes through `App._getWithTimeout()` to avoid indefinite hangs.
- Routes load in parallel (`Promise.all`), not sequentially.
- `State.planCache` / `App.planCache` lazy-load and cache per month — never refetch a month already cached.
- Calendar popup opens immediately with cached data; other months load in the background.

---

## 💡 Other notes

- **Session TTL** = 16h, auto-renews when < 4h remain (`auth.js`).
- `planList` is derived from the center doc's plan list plus whatever month is currently "live" — there's no separate draft/history concept to reconcile.
- Legacy Firestore shapes still exist and are read as fallbacks (`sellout/{YYYY_MM}` without centerId, `targets/{YYYY_MM}` without centerId) — real historical data lives there; don't delete these collections, and never write to them in the new centerId-prefixed code paths.
- The "RoutePlan" logo/title in every admin page header is a link back to `center-select.html` — the only way back to the center picker without using browser back.
- **New center defaults**: `center-select.html`'s "เพิ่มศูนย์ใหม่" only ever writes `{ routeList: [], cycleDays: 24 }` to the new center doc — no `currentPlanYM`. The very first time that center's admin page loads, `App.init()` falls back to `App.currentYM()` (today's real calendar month, `new Date()`-based) and creates/uses that plan — not a blank/unset state. Whatever "today" happens to be when a brand-new center is first opened becomes its first plan month.
- Sellout upload (`dashboard.js` "อัปโหลด Sellout") trusts the **data**, not the filename: it scans uploaded rows' `kpiDate` values and uses the most common `YYYY-MM` found, warning the admin if that disagrees with what the filename implies. It also compares the new row count against the existing stored row count for that month and warns (doesn't block) if the new file has fewer rows, since that usually means a partial re-upload about to overwrite a complete month.
- **Testing discipline**: this repo's Firestore rules (`firestore.rules`) have no real auth check on writes (`allow write` only validates document *shape*, not who's writing — a known, documented gap since the app uses custom SHA-256 auth, not Firebase Auth) — the admin login gate is UI-only. Always test destructive changes (new import formats, AI Route Builder changes, bulk merges) against a `TEST_`-prefixed center created via "เพิ่มศูนย์ใหม่", never against a real center's live data.

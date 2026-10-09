# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Sales-App / Route Planner (RoutePlan)

A vanilla JS/HTML PWA for planning and running sales delivery routes across multiple "centers" (ศูนย์), backed by Firebase/Firestore. No framework, no bundler, no build step beyond a service-worker cache-bust.

---

## 🌐 URLs / Deploy

- **Sales App**: https://sales-app-7ids.vercel.app/sales.html
- **Admin**: https://sales-app-7ids.vercel.app/index.html
- **Staging (test)**: https://sales-app-smooth.vercel.app/index.html
- **GitHub**: https://github.com/irisordinary-del/Sales-App
- **Firebase project**: route-plan-71e2e (Firestore only)

**⚠️ Branch/deploy map** (as of 2026-10-08 — verify in the Vercel dashboard before relying on it; older docs that say `main` auto-deploys are wrong). The repo is connected to **3 Vercel projects**, so every push builds in all three; only a project's *production branch* updates its domain, everything else becomes a login-protected preview:

| Branch | Role | Vercel project → domain |
|---|---|---|
| **`staging2`** | **Live** — what sales reps and admins actually use | `sales-app-7ids` → https://sales-app-7ids.vercel.app |
| `staging` | Test/pre-release — push here first, check it, then fast-forward `staging2` | `sales-app` → https://sales-app-smooth.vercel.app (production branch switched from `main` to `staging` by the user on 2026-10-08) |
| `main` | Archive/backup of `staging2`, not deployed anywhere user-facing (third project `sales-assis-app` also builds from the repo — check its production branch before assuming) | — |

**⚠️ Don't push the same commit to `staging` and `staging2` back-to-back.** Vercel dedupes by commit SHA per project: if `sales-app-7ids` first builds the SHA as a *Preview* (from the `staging` push), the `staging2` push of that same SHA is skipped and production stays on the old deployment (happened 2026-10-08 with `e3985e9`). Push `staging2` alone and wait for the "Production – sales-app-7ids" deployment before pushing the same SHA elsewhere — or make sure the SHA going to `staging2` is new. Verify with the GitHub deployments API / the served `sw.js` `CACHE_VERSION`, not just the green commit status (a Preview success also shows green).

Usual flow: work on a feature branch → `git push origin <branch>:staging` → verify on sales-app-smooth → `git push origin staging:staging2` (fast-forward; check `git merge-base --is-ancestor origin/staging2 origin/staging` first, never force-push `staging2`) → optionally sync `main` from `staging2` with a merge commit. **All three sites share the same production Firestore** (`route-plan-71e2e`) — "staging" only separates code, not data, so test destructive changes on a `TEST_` center even on staging. After deploying, the service worker serves cache-first until it picks up the new `sw.js`; reload once or twice (or call `navigator.serviceWorker.getRegistration().then(r => r.update())`) before concluding a fix "didn't deploy".

## Commands

There is no build tool, package manager, linter, or test suite in this repo (no `package.json`). It's plain HTML/CSS/JS served as static files.

- **Run locally**: open the `.html` files directly, or serve the folder with any static file server. There's no dev server script.
- **Deploy**: test with `git push origin <branch>:staging`, go live with `git push origin staging:staging2` (see the branch/deploy map above) → Vercel auto-deploys.
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
| `dashboard.js` | Admin-side `Dashboard` — org-wide sales analytics, targets, "อัปโหลด Sellout" (sellout Excel upload: auto-detects month from actual `kpiDate` rows rather than trusting the filename, warns if a re-upload has fewer rows than what's already stored). UI is the "Clean Operations" layout — see `Dashboard` under Admin Architecture below |
| `sku-distribution.js` | SKU Distribution campaign management |
| `store-history.js` | Per-store purchase history |
| `tasks.html` / `tasks.js` | "งานที่ต้องส่ง" task list feature |
| `users.html` / `users.js` | User management |
| `login.html` | Standalone login page |
| `center-select.html` | Center picker (inline script, no separate JS file) |
| `audit-log.js` | Audit log viewer/writer |
| `auth.js` | SHA-256 password hashing + Firestore auth, `SESSION_TTL` 16h, `renewSession` |
| `sw.js` | Service worker (`CACHE_VERSION`, precache list, network strategies) |
| `pwa-register.js` | SW registration |
| `manifest.json` | PWA manifest |
| `firestore.rules` | Security rules |
| `firestore.indexes.json` | Composite index definitions — deploy with `firebase deploy --only firestore:indexes` (see Firestore Structure below) |
| `api/optimize-route.js` | Vercel function — proxies OpenRouteService Optimization (VROOM) for AI Route Builder |
| `api/route-distance.js` | Vercel function — proxies ORS Directions to get real distance/duration for a *fixed* store order |
| `api/elevation.js` | Vercel function — proxies ORS elevation lookup |

All `api/*.js` proxy to OpenRouteService **only** to keep `ORS_API_KEY` server-side — never call ORS directly from client code.

### `rpn/` — RPN V0, the company's planner (added 2026-10-08)

The company forked our admin into **RPN V0** (a local/IndexedDB app, versioned `V0.x`, maintained by them) and uses it as **the** planning tool. `rpn/` holds it, made online, and `index.html` embeds it as the **วางแผนคิวงาน** and **ภาพรวมแผน** tabs (`#page-rpn` iframe, `RpnHost` in `index.html`). Our other tabs (Dashboard, Route Analysis, Cell Split, All Routes, SKU, Audit) are unchanged. The old `#page-planning` markup + `CalendarAdmin` etc. are still in `index.html` (our core `App` still loads them for the other tabs) but nothing navigates there anymore.

- **Never hand-edit files in `rpn/`** except `rpn-online-pre.js`, `rpn-online.js`, `SYNC.md` — refresh with `node tools/sync-rpn.mjs "<RPN V0 folder>"` (see `rpn/SYNC.md`). Same file names as ours (`admin-data.js`, `file-manager.js` …) are *their* diverged copies, not ours.
- RPN writes the same Firestore paths/shape we do, plus new store fields (`inactive`, `wasPlan`, `runOf`, `fqs`, `fqRun`, `cys`, `vd`), a pseudo-route **`รอจัดสาย`** in `routeList`, and center-doc fields (`cyPoints`, `routeBase`, `masterKm`, `maxCycleCode`, `routeDist`).
- **`rpnCal`**: `rpn-online.js` stores each route's real visit dates per Day (computed with RPN's own `Runs.datesOf`, same as its DMS export) at `plans/{ym}/routes/{rt}.rpnCal`; `sales-app.js`'s `RpnCompat` uses it (as calendar mode `'rpn'` from `_resolveActiveCfg`) when its `sig` matches the loaded stores **and** its `cfg` (fingerprint of the calendar it was computed with: the route's `calendarOverride`, else the month's `calendarConfig`) matches the route's current calendar (`RpnCompat.fresh`), else falls back to the old `CalendarCtrl` logic. `hash()`/`sig()`/`cfgSig()` must stay identical in both files. Why `cfg` exists (2026-10-09): RPN only recomputes rpnCal for the month it currently has open, so a calendar edited for another month (402C02 Nov) left the sales calendar on stale dates — stores hadn't changed, so `sig` still matched. rpnCal written before that has no `cfg` and is ignored; 402 Sep–Dec were recomputed the same day.
- `sales-app.js` hides `รอจัดสาย` and `inactive` stores via `RpnCompat.clean()`; every place that writes `stores` back must wrap with `RpnCompat.restore()` or parked stores get deleted.
- The `rpnCal` sig function exists in **three** places that must match exactly: `rpn/rpn-online.js`, `RpnCompat` (sales-app.js), `App._rpnSig` (admin-data.js — used by `approveMoveRequest` to keep rpnCal valid after moving a store between existing Days).
- "คำขอย้ายวัน" / "เช็คการยืนยัน" (MoveRequestAdmin / RouteConfirmAdmin) moved from the old planning toolbar to the admin sidebar. `approveMoveRequest` now replaces only `fromDay` in `days` (stores can have several Days) and moves RPN's per-Day fields (`cys`, `fqs`, `fqRun`, `vd`, `runOf`) to `toDay` from a peer store.
- **Move request for a multi-visit store** (F2/F4, added 2026-10-09): after the sales rep picks the target Day, `MoveRequest.choose` → `_askOther` asks once per *other* Day the store is on ("ย้ายรอบนี้ด้วยไหม?"), suggesting a target with the same shift. Each moved visit is its own `moveRequests` doc sharing `groupId`/`groupSize` (written in one batch); admin cards show "🔗 … N รอบพร้อมกัน" with "อนุมัติทั้งชุด" (`MoveRequestAdmin.approveGroup`). Target lists exclude Days the store is already on (and other chosen targets) — otherwise `approveMoveRequest`'s replace-`fromDay` logic would collapse two visits into one and approval order would matter.
- Anything that lists routes (users gen, tasks checklist, center-select count, cell split, route-confirm) must skip `รอจัดสาย`.

### Sales "ขอจัดลำดับตลาด" (market reorder requests, added 2026-10-08)

`ReorderReq` (sales-app.js) — button under the calendar header, next months only (current/past month disabled); sales for their own route, Sup/ASM for the selected route. Drag/▲▼ to move a whole market between Day slots (others shift, splice semantics), or "ล้างทั้งหมด" then tap markets into slots from D1. Mode per route: `half` (every multi-day store is an exact half-cycle pair → only D1–D(N/2) movable, second half mirrored), `free` (no multi-day stores — incl. 12-day cycles where F2 is market-level via +14 days), `irregular` (pairs not half-cycle, e.g. 402C01 cycle 23 → all slots movable, warns which pair gaps change). Malformed Day labels (e.g. `Day 12.5`) block the request.
Stored as a normal `moveRequests` doc with `type:'reorder'`, `map` {old→new, incl. mirrored half}, `summary`, `warnings`, `basisSig`; filler `storeId:'__reorder__'`/`storeName`/`fromDay`/`toDay` keep the existing firestore.rules happy. Resubmitting deletes the previous pending reorder for that route+month.
While a request is pending, the sales calendar for that route+month shows the *requested* order ("รออนุมัติ" mode: orange grid outline, moved cells marked "⇅ จาก D5", tapping a moved date shows the incoming market's stores with a pending note) with a bar offering "ดูแผนเดิม" (toggle back to the real plan), "แก้คำขอ" (reopens the editor starting from the requested order) and cancel — `ReorderReq.previewFor`/`_pending`, fed by `MoveRequest.startLiveListener` (own route, realtime) and `loadPending` (Sup/ASM, on calendar open). When a pending request turns `approved`, that month's `planCache` is dropped so the real (reordered) plan reloads.
Admin approves in "คำขอย้ายวัน" → `MoveRequestAdmin.approveReorder` → `RpnHost.ensure()` (loads the RPN iframe in the background) → `RPNBridge.applyReorder` (rpn/rpn-online.js), which switches RPN to that month and remaps `days`, `seqs`, `fqs`, `fqRun`, `vd`, `wasPlan`, `runOf.src`, `cyPoints` with the market, keeps `cys` on the slot (AS&D rule), rewrites the `D..` number inside `marketName`, and saves (rpnCal is re-injected). It deliberately does **not** call RPN's own `Reorder.apply` (that one derives the half-cycle from the *center's* cycleDays and doesn't move `fqs`). Locked months can't be approved. After approval the DMS export for that month must be redone.

### Legacy market naming in RPN

`rpn-online.js` adds our old formula (`{route} D{NN} {top-2 tambons} {district} {province}`, same as `FileManager._autoFillMarketNames`) to RPN's market-suggest UI without editing RPN files: an extra "สูตรเดิม" chip in the per-day panel, a "สูตรเดิม" option on every row of the "🗂 ทั้งสาย" table, and a "📛 สูตรเดิมทุกวัน" button there. The user picks per day or all at once.

### `plan-lock.js` — read-only plan months

Loaded right after the Firebase SDK in `index.html` and `rpn/RoutePlannerV0.html` (not `sales.html`). Rejects every `set`/`update`/`delete` (single doc or batch) under `appData/{center}/plans/{ym}` when that month is locked. Two lock sources:
- **Per center (normal):** `{CENTER}_main.lockedMonths: ['YYYY_MM']`, toggled by admins from the sidebar "🔒 ล็อกแผน" (`PlanLockUI` in index.html; supervisors see status only; logged as `PLAN_LOCK`/`PLAN_UNLOCK`). Every open admin page and RPN iframe listens to the center doc via `onSnapshot`, so it takes effect immediately without a deploy. Firestore rules already accept the field (center-doc whitelist is `hasAny` on the merged doc).
- **All centers:** the hard-coded `LOCKED` array in the file (edit + push). Was `['2026_11','2026_12']` during the RPN trial on 2026-10-08, unlocked the same day (currently `[]`).

RPN shows a red "ดูได้อย่างเดียว" banner on locked months; `rpn-online.js` skips rpnCal reconcile and the admin can't approve reorder requests for them. Client-side only (like the app's auth) and there's a short window after page load before the center doc arrives.

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

- No "Draft/Active/History" naming anywhere in the UI or in new code — everything is just "a Plan" for a given month (`YYYY_MM`). The old drafts/active/history split was collapsed into this unified `plans/{ym}` structure by a one-time migration tool (`migrate-to-plans.html`, removed 2026-09-15 — its job is done, the pre-migration `routes/`+`drafts/` shape no longer exists anywhere in the live system, and re-running it against an already-migrated center would silently overwrite `currentPlanYM`, so it was more of a footgun than a useful tool to keep around).
- Admin can browse/edit any month's plan without affecting what Sales sees. **Sales/Supervisor auto-select "current month" from today's real calendar date** (falling back to the latest existing plan in `planList` if today's month hasn't been created yet) — see the `2026-09-04` comment in `sales-app.js`'s `App.start()`/`startSupervisor()`. There is no separate "publish this month as live" step or button anymore (`App.publishPlan` was removed 2026-09-14 as dead code — sales-app.js no longer reads `currentPlanYM` from Firestore at all). `{CENTER_ID}_main.currentPlanYM` and `App._livePlanYM` (admin-data.js) are still written/tracked on the admin side on every load but nothing reads them back — harmless leftover state from before the 2026-09-04 change, not a bug, just don't rely on it meaning anything. `App._currentPlanYM` is just the admin's local viewing state and has no effect on what Sales sees.
- `State.planCache[ym]` caches `{ stores, calendarConfig, routeOverrides, confirmedBy/At }` per month, lazy-loaded — always populate all of these fields when seeding the cache (a past bug: forgetting `routeOverrides` here made per-route calendar overrides silently ignored, see Bugs table).

### Calendar Mode
Set per `plans/{ym}.calendarConfig.mode`, optionally overridden per-route via `routes/{routeCode}.calendarOverride` (same shape, wins when present):

| Mode | Meaning | Key fields |
|------|---------|--------|
| `cycle` | Rotating N-day cycle (commonly 24) independent of calendar dates; holidays are skipped when counting | `cycleDays`, `anchorType` (`date` \| `weekday-once` \| `weekday-rolling`), `startDay`/`startDayNum`/`anchorWeekday`/`anchorDate`/`anchorDayNum` depending on anchorType, `holidays` (specific dates), `weeklyHolidays` (weekday numbers, e.g. `[0]` = every Sunday), `holidayMode` (`'shift'` default \| `'skip'`) |
| `date` | Day N = literal calendar date N of the month | `holidays`, `weeklyHolidays` (both usable here too, e.g. to gray out Sundays) |
| `fixed` | Admin manually maps specific calendar dates → arbitrary Day labels | `mapping: { "5": "Day 2", ... }` |
| `weekday` | Day N = a fixed weekday, repeats every week all month (e.g. "Day 1" = every Monday) | `weekdayMap: { "Day 1": 1, ... }` (0=Sun..6=Sat) |

**`cycle` mode's `holidayMode`** (added 2026-09-14) controls what happens to an ad-hoc holiday (a specific date in `holidays`, not `weeklyHolidays`) when counting cycle days — weekly holidays are *always* excluded from the count regardless of this setting:
  - `'shift'` (default, matches pre-2026-09-14 behavior) — the holiday date doesn't consume a cycle slot at all, so every later date's Day number shifts earlier by one to fill the gap.
  - `'skip'` ("ตรึงตลาด"/"pin market") — the holiday date *does* consume a cycle slot (so every other date keeps the Day number it would have had anyway) but that slot's own Day label resolves to `null` — no store runs that day, and that one Day number is simply absent from the month.
  This logic is intentionally centralized in one place per file to avoid drift: `CalendarCtrl._isCycleHoliday`/`_isCyclePinnedHoliday` (sales-app.js, used by both `getDayLabelForCfg` and `getDateFromDay`), `FileManager._resolveCalendarDate` (file-manager.js, export date-column resolution), and `CalendarAdmin._computeDayLabel` (index.html, admin preview grid) — **all three must stay in sync**, same as the rest of this section.

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

### `Dashboard` (`dashboard.js` — "Clean Operations" UI, shipped 2026-09-09 in commit `ddfd1e1`)
```js
Dashboard._renderShell()   // single wrapping toolbar, 4-col KPI grid, ~70/30 route-table/insights layout, inline SVG icon set Dashboard._ICONS
Dashboard._renderKPIs()    // groups the old 7 KPI cards into 4: revenue+target progress, stores, productivity (SKU/store + invoice), V/C route comparison
```
- Dashboard-specific styling lives in the component classes appended to `admin-style.css`: `.db-pill-*`, `.db-upload-btn`/`.db-action-btn`, `.db-kpi-*`, `.db-progress-*`, `.db-panel-title`.
- **Compatibility requirement**: when touching the Dashboard, keep every existing `db-*` element ID and all `onclick`/`data-*` wiring exactly as-is — this redesign only changed markup/CSS/icons; calculations and Firestore read/write behavior were intentionally left untouched.
- Responsive KPI grid: 4 columns desktop → 2 tablet → 1 mobile; the route table stays horizontally scrollable at every width.
- Pushed to `staging2` and verified served live at sales-app-7ids.vercel.app (see the Branch/deploy note above — `main` is not what's live).
- Verified via: desktop render, 390×844 mobile render, Gross/Net toggle, mobile menu open/overlay-close, `node --check dashboard.js`, `git diff --check`.

### Main admin tabs — shared "Clean Operations" UI (2026-09-10)

The same restrained visual language now covers the six main sidebar tabs: Route Analysis, Cell Split, Planning, All Routes, SKU Distribution, and Audit Log. Shared primitives live in `admin-style.css`: `.page-header-bar` / `.page-hamburger-btn`, `.db-panel` / `.db-panel-head`, `.db-table` / `.db-table-wrap`, `.db-state`, and `.db-toolbar-btn*`. `admin-ui.js` exposes the shared `AdminIcons` inline-SVG helper used by these views.

- This was a cosmetic refactor only. Preserve existing IDs, handlers, Firestore reads/writes, calculations, map interactions, exports, and route-planning behavior when extending it.
- In particular, keep the incremental/batched rendering behavior in All Routes intact; do not replace it with a single synchronous render of all rows.
- Semantic success/warning/danger colors remain meaningful; indigo is the common page/action accent.
- Users and Tasks are intentionally outside this migration. They use the separate `AdminTheme` dark-mode design system and do not load `admin-style.css`; migrate them only as a separate, explicitly scoped change.

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
| Mobile sidebar overlay dimmed the whole screen on every load | `#sidebar-overlay { display:block; }` inside the `≤767px` media query is an **ID selector**, which beats Tailwind's `.hidden { display:none }` (a class selector) on specificity — so the overlay rendered regardless of whether the drawer was actually open. Fixed as `#sidebar-overlay:not(.hidden) { display:block; }`. **Don't revert to the bare ID rule** — it silently reintroduces this. Paired with an early inline `<script>` (runs right after the sidebar markup, before the rest of the page parses) that collapses `#sidebar` on load at `≤767px`, and a mobile-only check in the `Nav.go` wrapper that closes an open drawer after a menu item is picked | `index.html` |
| AI Route Builder's custom "ขั้นต่ำร้าน/วัน" silently ignored | `audit-log.js`'s monkey-patch of `AI.calc` only declared/forwarded 4 of its 5 params, dropping `minPerDay` every time — the real `calc()` always saw it as `undefined` and fell back to the auto-computed average regardless of what the admin typed | `audit-log.js` |
| "📦 อัปโหลดพิกัด" toolbar button did something very different from what it said | The button's label implied a small single-route coordinate refresh (like the real single-route dropzone in Tab 1, wired to `App.handleMapUpload`), but it actually triggered `FileManager.bulkImport` — an all-routes-in-the-file schedule merge. Relabeled to "♻️ นำเข้าไฟล์ที่แก้ใน Excel (ทุกสาย)" with a warning `title`; did not change what it does | `index.html` |
| Supervisor/ASM Gross↔Net toggle never appeared | `SupervisorDashboard`'s toggle-injection code anchored on `document.getElementById('db-kpi-row')`, which only exists in the *admin* `dashboard.js` shell — `sales.html`'s KPI grid uses `db-kpi-grid`. The toggle buttons were therefore never created, so the mode stayed locked on `'net'` for every Supervisor/ASM | `sales-dashboard.js` |
| Dashboard's Credit Delivery Status (Confirm/รอ Confirm) panel never rendered | `Dashboard._renderCategories()` has always injected into `document.getElementById('db-credit-delivery')`, but `_renderShell()` never created that container — confirmed via `git blame` that it was missing from the very commit that introduced the injection code, not a later redesign regression | `dashboard.js` |
| Calendar modes "fixed"/"กำหนดเอง" and "weekday"/"ตามวันในสัปดาห์" unreachable from a fresh setup | `CalendarAdmin.setMode`/`save`/`_computeDayLabel` and the dedicated `cal-fixed-section`/`cal-weekday-section` markup fully supported all 4 modes, but the mode-picker only rendered 2 buttons (`cal-mode-cycle`, `cal-mode-date`) — a new center/plan could only ever end up in `fixed`/`weekday` mode if its Firestore doc already had that value some other way (never via clicking through this UI) | `index.html` |
| Export modal's "✅ Active (Sales ใช้อยู่)" option silently did nothing | `ExportCtrl.doExport()` never read `export-plan-sel`'s value — picking either option always exported whatever plan the admin was currently viewing. The underlying "Active"-vs-"viewing" distinction is also obsolete since Sales stopped reading `currentPlanYM` (see Plan System above); removed the dropdown, replaced with a line stating which month it exports | `index.html`, `admin-ui.js` |
| Market-reorder approval applied to stale data (402V09 Nov, 2026-10-08) | Firestore `enablePersistence` + plain `get()` can return IndexedDB-cached docs for several seconds after page load/month switch; `RPNBridge.applyReorder` swapped D1↔D21 on RPN's stale in-memory copy and saved it over newer server data (the request's `basisSig` didn't match — the stale-confirm was clicked through). Also `renameDay` rewrote `D..` tokens of *unmoved* stores whose names were already offset. Fixed: approval re-reads the route with `get({source:'server'})` and works on that; renames only when the token equals the store's old slot; plain `get()` is server-first with cache fallback (8s admin/RPN in plan-lock.js, 4s sales-app.js); stale-confirm text now recommends rejecting | `rpn/rpn-online.js`, `plan-lock.js`, `sales-app.js`, `index.html` |
| SKU Distribution's "+ เพิ่ม" search-result button dead for any product code/name containing an apostrophe | `.replace(/'/g, "\'")` — the replacement `"\'"` is just the character `'` in a JS string literal, so this was a no-op, not an escape. An embedded `'` broke the generated `onclick="...('...')"` attribute's JS grammar for that row. Fixed to `.replace(/'/g, "\\'")` (an actual backslash) | `sku-distribution.js` |

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

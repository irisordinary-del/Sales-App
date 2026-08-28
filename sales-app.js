// === sales-app.js ===
// v2 — 2026-05-21 | fixes: BUG-10 TAB_STORAGE_KEY per-user, perf cleanup

// ✅ Inline toast
function _fmtB(n) {
    if (!n) return '0';
    return Math.round(n).toLocaleString('th-TH');
}

function showSalesToast(msg, isError) {
    let t = document.getElementById('sales-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'sales-toast';
        t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:#1f2937;color:#fff;padding:10px 20px;border-radius:10px;font-size:13px;z-index:9999;transition:transform 0.3s,opacity 0.3s;opacity:0;';
        document.body.appendChild(t);
    }
    t.style.background = isError ? '#dc2626' : '#1f2937';
    t.innerText = msg;
    t.style.transform = 'translateX(-50%) translateY(0)';
    t.style.opacity   = '1';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(80px)'; t.style.opacity = '0'; }, 3000);
}

const firebaseConfig = {
    apiKey:            "AIzaSyDCYxJf0eHryjVJ8_INoWw_uTN14UMaEWE",
    authDomain:        "route-plan-71e2e.firebaseapp.com",
    projectId:         "route-plan-71e2e",
    storageBucket:     "route-plan-71e2e.firebasestorage.app",
    messagingSenderId: "486778971661",
    appId:             "1:486778971661:web:2ef83fa1eeb09ec6665744",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ✅ FIX (2026-07-12): เจอ error ซ้ำๆ ตลอด "WebChannelConnection RPC 'Listen' stream
// transport errored" + 404 บน google.firestore.v1.Firestore/Listen ในทุกอุปกรณ์/เบราว์เซอร์
// ที่ทดสอบ (desktop, mobile, InPrivate, ปกติ) — นี่คือปัญหาที่รู้จักกันดีของ Firestore SDK:
// เครือข่าย/ไฟร์วอลล์/proxy บางที่บล็อกการเชื่อมต่อแบบ streaming (WebChannel/gRPC-over-HTTP2)
// แต่ยอมให้ long-polling ผ่านได้ปกติ ทำให้ query ที่พึ่งพา cache/realtime listener ได้ข้อมูลว่าง
// ทั้งที่เซิร์ฟเวอร์มีข้อมูลจริงครบ (แม้แต่ .get({source:'server'}) ก็ยัง throw 'unavailable')
// บังคับใช้ long-polling แก้ปัญหานี้ที่ต้นตอ — คนละสาเหตุกับ cache/race condition ที่แก้ไปก่อนหน้า
db.settings({ experimentalForceLongPolling: true });

// Enable persistence — รองรับ offline และหลาย tab
// ✅ FIX: InPrivate / browser ที่ block storage จะ throw error แต่ app ยังทำงานปกติ (online mode)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn('[DB] Multiple tabs open: offline persistence disabled');
    } else if (err.code === 'unimplemented') {
        console.warn('[DB] Browser does not support offline persistence');
    } else {
        // InPrivate / storage blocked → ทำงาน online ปกติ ไม่ต้องแจ้ง user
        console.warn('[DB] Persistence unavailable (private/restricted mode), running online only');
    }
});

// ─── ErrorMsg — แปล error code ของ Firebase เป็นข้อความไทยที่ user เข้าใจได้ ──
// (คัดลอกมาจาก app-config.js เพราะ sales.html ไม่ได้โหลดไฟล์นั้น)
const ErrorMsg = {
    _map: {
        'permission-denied':    'ไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อแอดมิน',
        'unavailable':          'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
        'deadline-exceeded':    'การเชื่อมต่อช้าเกินไป กรุณาลองใหม่อีกครั้ง',
        'not-found':            'ไม่พบข้อมูลที่ต้องการ อาจถูกลบไปแล้ว',
        'already-exists':       'มีข้อมูลนี้อยู่แล้วในระบบ',
        'resource-exhausted':   'ระบบมีผู้ใช้งานพร้อมกันมาก กรุณาลองใหม่อีกสักครู่',
        'cancelled':            'การทำรายการถูกยกเลิกกลางทาง กรุณาลองใหม่',
        'unauthenticated':      'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
        'failed-precondition':  'ไม่สามารถทำรายการได้ในขณะนี้ (อาจมีการแก้ไขซ้อนกัน) กรุณาลองใหม่',
        'invalid-argument':     'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    },
    translate: (e) => {
        if (!e) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
        if (e.code && ErrorMsg._map[e.code]) return ErrorMsg._map[e.code];
        console.warn('[ErrorMsg] ไม่รู้จัก error code:', e.code, '| message เดิม:', e.message);
        return 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่ หรือติดต่อผู้ดูแลระบบถ้ายังไม่หาย';
    },
};

let docMain  = db.collection('appData').doc('v1_main');
const colSales = db.collection('v1_sales_chunks');

let State = {
    myRoute: "", allStores: [], routeStores: [], sales: {},
    currentDay: "", isLoaded: false, mapNeedsFit: true,
    calendarConfig: null, activePlanYM: null, currentPlanYM: '',
    viewMode: 'sales', centerId: null, allRoutes: {}, routeList: [],
    _filterMarket: '',
    planList: [], planCache: {}, planCenterDocId: '',
    campaignIcons: {}, // { custCode: [{iconUrl, name}] } — icons ของ campaign ที่ active
};
let map = null, mapMarkers = [], sortableList = null, markerClusterGroup = null;

// ─── Tab config ───────────────────────────────────────────────────────────
const VALID_TABS     = ['dashboard', 'stores', 'route', 'activities'];
const DEFAULT_TAB    = 'dashboard';
const FORCE_DEFAULT_TAB = true;

// ✅ FIX BUG-10: TAB_STORAGE_KEY รวม username → ไม่ cross กัน ถ้าหลาย user ใช้ browser เดียวกัน
// ใช้ getter เพื่อรอให้ Auth.getSession() พร้อมก่อน
function _getTabKey() {
    try { return `sales_last_tab_${Auth.getSession()?.username || 'guest'}`; }
    catch(e) { return 'sales_last_tab_guest'; }
}

const UI = {
    // ✅ Hamburger menu
    toggleMenu: () => {
        const overlay = document.getElementById('menu-overlay');
        if (!overlay) return;
        overlay.style.display = overlay.style.display === 'flex' ? 'none' : 'flex';
    },
    closeMenu: () => {
        const overlay = document.getElementById('menu-overlay');
        if (overlay) overlay.style.display = 'none';
    },

    // ✅ Edit order mode
    _editMode: false,
    startEditOrder: () => {
        UI._editMode = true;
        document.getElementById('edit-order-btn').style.display    = 'none';
        document.getElementById('confirm-order-btn').style.display = 'block';
        // ✅ UX-FIX-6: visual indicator ว่ากำลัง edit อยู่
        const panel = document.getElementById('route-side-panel');
        if (panel) panel.classList.add('edit-mode');
        document.querySelectorAll('.drag-handle').forEach(h => {
            h.style.opacity       = '1';
            h.style.pointerEvents = 'auto';
            h.style.color         = '#2563eb';
            h.style.fontSize      = '20px';
        });
        document.querySelectorAll('.store-item').forEach(el => el.classList.add('edit-mode-on'));
        if (window._sortableInstance) window._sortableInstance.option('disabled', false);
        showSalesToast('✏️ ลากแถบ ≡ เพื่อสลับลำดับ แล้วกด ✓ ยืนยัน');
    },
    confirmEditOrder: () => {
        UI._editMode = false;
        document.getElementById('edit-order-btn').style.display    = 'block';
        document.getElementById('confirm-order-btn').style.display = 'none';
        // ✅ UX-FIX-6: ปิด visual indicator
        const panel = document.getElementById('route-side-panel');
        if (panel) panel.classList.remove('edit-mode');
        document.querySelectorAll('.drag-handle').forEach(h => {
            h.style.opacity       = '0';
            h.style.pointerEvents = 'none';
            h.style.color         = '';
            h.style.fontSize      = '';
        });
        document.querySelectorAll('.store-item').forEach(el => el.classList.remove('edit-mode-on'));
        if (window._sortableInstance) window._sortableInstance.option('disabled', true);
        Processor._updateSeqBadges();
        Processor.handleDrag();
        showSalesToast('✅ บันทึกลำดับเรียบร้อย');
    },

    switchTab: (id) => {
        if (!VALID_TABS.includes(id)) id = DEFAULT_TAB;

        // ✅ FIX: ปุ่ม bottom nav ใช้ class "bnav-item" ไม่ใช่ "nav-item"
        // ของเดิม query ผิด class ทำให้ active state ค้าง ไม่หลุดตอนสลับ tab (หลายปุ่มสว่างพร้อมกัน)
        document.querySelectorAll('.bnav-item').forEach(el => el.classList.remove('active'));
        const navEl = document.getElementById('nav-' + id);
        if (navEl) navEl.classList.add('active');

        document.querySelectorAll('.app-tab').forEach(el => el.classList.remove('active'));
        const tabEl = document.getElementById('tab-' + id);
        if (tabEl) tabEl.classList.add('active');

        // บันทึก tab ล่าสุด
        localStorage.setItem(_getTabKey(), id);
        localStorage.setItem('sales_tab_date', new Date().toDateString());

        if (id === 'route') {
            setTimeout(() => {
                if (App.isSupervisor()) {
                    if (!SupervisorUI._selectedRoute) {
                        SupervisorUI.renderRouteGrid();
                    } else {
                        if (!map) MapCtrl.initAndDraw();
                        else { map.invalidateSize(); if (State.mapNeedsFit) MapCtrl.fitBounds(); }
                    }
                } else {
                    if (!map) MapCtrl.initAndDraw();
                    else { map.invalidateSize(); if (State.mapNeedsFit) MapCtrl.fitBounds(); }
                }
            }, 200);
        }

        if (id === 'activities' && typeof ActivityCtrl !== 'undefined') {
            ActivityCtrl.init();
        }

        // ✅ UX-FIX: Supervisor/ASM เข้า tab ร้านค้าได้เลย — แสดงร้านทั้งหมดทุกสาย
        // ไม่ต้องเลือกสายก่อน (แยกออกจาก tab คิวงานที่ดูรายสาย)
        UI._redirectingToRoute = false;
    },

    restoreTab: () => {
        // ✅ ข้อ 4: ไม่จำ tab เดิม — เริ่มต้นใหม่ทุกครั้ง route tab เสมอ
        UI.switchTab('route');
    },

    searchStores: (val) => {
        const q = val.toLowerCase().trim();
        document.querySelectorAll('#all-store-list > div[data-search]').forEach(el => {
            el.style.display = (el.getAttribute('data-search')||'').toLowerCase().includes(q) ? 'flex' : 'none';
        });
    },

    openModal: (id) => {
        const s = State.allStores.find(x => x.id === id);
        if (!s) return;
        document.getElementById('m-name').textContent     = s.name;
        document.getElementById('m-id').textContent       = 'ID: ' + s.id;
        document.getElementById('m-nav-btn').onclick = () =>
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`);
        if (typeof StoreHistory !== 'undefined') StoreHistory.openFor(id);
        document.getElementById('store-modal').classList.remove('hidden');
    },

    closeModal: () => document.getElementById('store-modal').classList.add('hidden'),

    _sortMode: 'seq',
    toggleSort: () => {
        const p   = document.getElementById('sort-panel');
        const btn = document.getElementById('sort-btn');
        const open = p.style.display === 'flex';
        p.style.display     = open ? 'none'    : 'flex';
        btn.style.background  = open ? '#f3f4f6' : '#2563eb';
        btn.style.color       = open ? '#374151' : '#fff';
        btn.style.borderColor = open ? '#e5e7eb' : '#2563eb';
    },
    applySort: (mode) => {
        UI._sortMode = mode;
        document.querySelectorAll('.sort-opt-btn').forEach(b => b.classList.remove('active'));
        const active = document.querySelector(`.sort-opt-btn[onclick="UI.applySort('${mode}')"]`);
        if (active) active.classList.add('active');
        const p   = document.getElementById('sort-panel');
        const btn = document.getElementById('sort-btn');
        if (p)   p.style.display     = 'none';
        if (btn) { btn.style.background = '#f3f4f6'; btn.style.color = '#374151'; btn.style.borderColor = '#e5e7eb'; }
        if (typeof Processor !== 'undefined') Processor.stores();
    },
};

// LoadBar defined in sales.html inline script

// ✅ Guard: รอ Leaflet พร้อมก่อน init map (ป้องกัน defer โหลดไม่ทัน)
function waitForLeaflet(cb, tries = 0) {
    if (typeof L !== 'undefined' && typeof L.map === 'function') { cb(); return; }
    if (tries > 50) { console.warn('[Map] Leaflet timeout'); return; } // timeout 5 วิ
    setTimeout(() => waitForLeaflet(cb, tries + 1), 100);
}

const App = {
    checkAuth: () => {
        Auth.renewSession?.();
        const session        = Auth.getSession();
        const supervisorRoles = ['admin', 'supervisor', 'route_supervisor', 'asm'];
        if (session?.role === 'sales') {
            State.myRoute  = session.username;
            State.viewMode = 'sales';
            // ✅ FIX: set centerId สำหรับ sales ด้วย (ใช้ดึง sellout ถูก path)
            State.centerId = session.centerId || State.myRoute.match(/^(\d+)/)?.[1] || '';
            App.start();
        } else if (session && ['route_supervisor','asm'].includes(session.role)) {
            State.myRoute  = session.username;
            State.viewMode = session.role;
            State.centerId = session.centerId;
            App.startSupervisor();
        } else if (session && supervisorRoles.includes(session.role)) {
            window.location.replace('index.html');
        } else {
            window.location.replace('login.html');
        }
    },

    isSupervisor: () => ['route_supervisor','asm'].includes(State.viewMode),

    // ✅ โหลด active campaigns → build custCode → icons map
    _loadCampaignIcons: async () => {
        try {
            const session   = Auth.getSession();
            const centerId  = State.centerId || session?.centerId || '';
            const centerDoc = centerId ? (centerId + '_main') : (session?.centerDoc || '');
            if (!centerId && !centerDoc) return;

            const nowYM = (() => {
                const d = new Date();
                return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
            })();

            // helper: สร้าง list ของ YYYY_MM ระหว่าง startYM และ endYM
            const getMonthRange = (startYM, endYM) => {
                const months = [];
                let [y, m] = startYM.split('_').map(Number);
                const [ey, em] = endYM.split('_').map(Number);
                while (y < ey || (y === ey && m <= em)) {
                    months.push(`${y}_${String(m).padStart(2,'0')}`);
                    m++; if (m > 12) { m = 1; y++; }
                }
                return months;
            };

            // โหลด campaigns
            let snap = await db.collection('skuDistribution')
                .where('centerId', '==', centerDoc).get();
            if (snap.empty && centerId) {
                snap = await db.collection('skuDistribution')
                    .where('centerId', '==', centerId).get();
            }

            const icons = {};
            const isSup = App.isSupervisor();
            const username = session?.username?.toUpperCase() || '';

            for (const doc of snap.docs) {
                const c = doc.data();
                if (!c.iconUrl) continue;
                if ((c.endYM || '') < nowYM.slice(0,7).replace('-','_')) continue;
                // ✅ หน้าสายวิ่งโชว์เฉพาะ Campaign "สินค้ากระจาย" (ตามสาย) — โหมด "ระบุร้านเอง"
                // ย้ายไปโชว์ในหน้า "กิจกรรม" แทนแล้ว กันซ้ำซ้อน
                if (c.scopeMode === 'custom') continue;

                const groups = c.groups || [];
                const kws = groups.flatMap(g => (g.keywords || []).map(k => k.toLowerCase()));
                if (!kws.length) continue;

                // ✅ โหลดทุกเดือนใน campaign range ตั้งแต่เริ่ม campaign
                const startYM = c.startYM || nowYM;
                const endYM   = c.endYM   || nowYM;
                const months  = getMonthRange(startYM, endYM);

                // ✅ PERF: โหลดทุกเดือนพร้อมกัน (Promise.all) แทนทีละเดือน — เร็วขึ้นตามจำนวนเดือน
                // ปลอดภัยเพราะ SalesDashboard._loadChunks มี cache + in-flight dedup อยู่แล้ว
                const monthResults = await Promise.all(months.map(async ym => {
                    try {
                        if (typeof SalesDashboard !== 'undefined' && SalesDashboard._loadChunks) {
                            return await SalesDashboard._loadChunks(ym);
                        }
                        const cs = await db.collection('sellout').doc(ym).collection('chunks').get();
                        let rows = [];
                        cs.forEach(d => rows = rows.concat(d.data().rows || []));
                        return rows;
                    } catch (e) { return []; /* เดือนนี้ไม่มีข้อมูล ข้ามไป */ }
                }));
                const allRows = monthResults.flat();

                if (!allRows.length) continue;

                // ✅ FIX: Supervisor/ASM username (เช่น "RS402") ไม่ใช่รูปแบบ sCode ในข้อมูล
                // ถ้ากรองด้วย sCode === username จะได้ 0 แถวเสมอ — Supervisor ดูทั้งศูนย์แทน
                const myRows = (username && !isSup)
                    ? allRows.filter(r => String(r.sCode || '').toUpperCase() === username)
                    : allRows;

                // หา custCode ที่ซื้อสินค้าใน campaign นี้จริงๆ ตลอดช่วง
                const boughtStores = new Set(
                    myRows
                        .filter(r => kws.some(k =>
                            (r.prodCode || '').toLowerCase().includes(k) ||
                            (r.prodName || '').toLowerCase().includes(k)
                        ))
                        .map(r => String(r.custCode || '').trim())
                );

                console.log(`[CampaignIcons] ${c.name}: ${boughtStores.size} ร้านที่ซื้อตลอด campaign (${startYM}→${endYM})`);

                // ใส่ icon เฉพาะร้านที่ซื้อแล้ว
                boughtStores.forEach(custCode => {
                    if (!icons[custCode]) icons[custCode] = [];
                    if (!icons[custCode].find(x => x.iconUrl === c.iconUrl)) {
                        icons[custCode].push({ iconUrl: c.iconUrl, name: c.name, bought: true });
                    }
                });
            }

            State.campaignIcons = icons;
            console.log(`[CampaignIcons] รวม ${Object.keys(icons).length} ร้านที่มี icon`);
            if (State.isLoaded) {
                try { if (State.currentDay) Processor.routeList(); } catch(e) { console.warn('[App] re-render routeList หลังโหลด campaign icons ไม่สำเร็จ:', e); }
                try { Processor.stores(); } catch(e) { console.warn('[App] re-render stores หลังโหลด campaign icons ไม่สำเร็จ:', e); }
            }
        } catch(e) {
            console.warn('_loadCampaignIcons:', e);
        }
    },
    _getWithTimeout: (ref, ms = 8000) =>
        Promise.race([ref.get(), new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), ms))]),

    loadPlanList: async (centerDocId) => {
        try {
            State.planCenterDocId = centerDocId;
            const snap = await App._getWithTimeout(db.collection('appData').doc(centerDocId), 5000);
            const meta = snap.exists ? snap.data() : {};
            // ✅ ระบบใหม่: ใช้ planList และ currentPlanYM โดยตรง
            State.planList       = (meta.planList || []).sort().reverse();
            State.currentPlanYM  = meta.currentPlanYM || '';
            console.log('📅 planList:', State.planList, 'current:', State.currentPlanYM);
        } catch(e) { console.warn('loadPlanList:', e); State.planList = []; }
    },

    loadPlanData: async (ym) => {
        if (Object.prototype.hasOwnProperty.call(State.planCache, ym) &&
            State.planCache[ym]?._ok) return State.planCache[ym];
        const centerDocId = State.planCenterDocId;
        // ✅ ระบบใหม่: ดึงจาก plans/{ym}/routes/{myRoute}
        try {
            const planRef  = db.collection('appData').doc(centerDocId).collection('plans').doc(ym);
            const routeRef = planRef.collection('routes').doc(State.myRoute);
            const [cfgSnap, routeSnap] = await Promise.all([
                App._getWithTimeout(planRef,   15000),
                App._getWithTimeout(routeRef,  15000),
            ]);
            const planConfig     = cfgSnap.exists   ? (cfgSnap.data().calendarConfig || null) : null;
            const stores         = routeSnap.exists ? (routeSnap.data().stores        || [])  : [];
            // ✅ ตั้งค่าปฏิทินเฉพาะสาย (ถ้ามี) ใช้แทนค่า default ของศูนย์สำหรับสายนี้
            const routeOverride  = routeSnap.exists ? (routeSnap.data().calendarOverride || null) : null;
            const calendarConfig = routeOverride || planConfig;
            State.planCache[ym]  = {
                stores, calendarConfig, ym, _ok: true,
                routeOverrides: { [State.myRoute]: routeOverride },
            };
            return State.planCache[ym];
        } catch(e) {
            console.warn('loadPlanData:', ym, e);
            const fallback = ym === State.activePlanYM && State.allStores.length > 0
                ? { stores: State.allStores, calendarConfig: State.calendarConfig, ym, _ok: true }
                : null;
            if (fallback) State.planCache[ym] = fallback;
            return fallback || { stores: [], calendarConfig: null, ym };
        }
    },

    switchToPlan: async (ym) => {
        const data = await App.loadPlanData(ym);
        State.allStores      = data.stores;
        State.calendarConfig = data.calendarConfig;
        State.activePlanYM   = data.ym;
        State._filterMarket  = '';
        if (State.isLoaded) { Processor.run(); CalendarCtrl.render(); }
    },

    startSupervisor: async () => {
        // ── clone จาก start() ── ไม่แตะ Sales เลย ──────────────────────
        document.getElementById('main-header').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        const _bnav = document.getElementById('bottom-nav');
        if (_bnav) _bnav.style.display = 'grid';

        const session   = Auth.getSession();
        const roleLabel = State.viewMode === 'asm' ? '🏢 ASM' : '👁 Sup';
        const _dispName = session?.displayName || session?.username || '';
        document.getElementById('user-route-label').innerText =
            roleLabel + ' · ' + _dispName;

        // ซ่อน day bar + edit btn จนกว่าจะเลือกสาย
        const _dayRow = document.getElementById('day-select')?.closest('div[style*="border-bottom"]');
        if (_dayRow) _dayRow.style.display = 'none';
        const _editBtn = document.getElementById('edit-order-btn');
        if (_editBtn) _editBtn.style.display = 'none';

        document.getElementById('loader').style.display = 'flex';
        LoadBar.show();
        LoadBar.setProgress(10, 'กำลังเชื่อมต่อ...');

        // ── Step 1: ดึง centerDoc (เหมือน start()) ────────────────────
        const centerIdRaw  = session?.centerId || '';
        const _centerDocId = centerIdRaw ? (centerIdRaw + '_main') : 'v1_main';
        State.centerId        = centerIdRaw;
        State.planCenterDocId = _centerDocId;
        const _centerRef      = db.collection('appData').doc(_centerDocId);

        let _centerSnap;
        try { _centerSnap = await App._getWithTimeout(_centerRef, 6000); }
        catch(e) { _centerSnap = { exists: false, data: () => ({}) }; }

        const _centerData = _centerSnap?.exists ? _centerSnap.data() : {};
        State.planList       = (_centerData.planList || []).sort().reverse();

        const _nowYM = (() => { const d=new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`; })();
        const _useYM = _centerData.currentPlanYM || State.planList[0] || _nowYM;
        State.activePlanYM   = _useYM;
        State.currentPlanYM  = _useYM;

        LoadBar.setProgress(20, `📅 Plan ${_useYM}...`);

        // ── Step 2: ดึง plan metadata ─────────────────────────────────────
        const _planRef = _centerRef.collection('plans').doc(_useYM);
        let _planSnap;
        // ✅ FIX: เพิ่ม timeout เป็น 15 วิ + retry 1 ครั้งถ้า timeout
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                _planSnap = await App._getWithTimeout(_planRef, 15000);
                if (_planSnap) break;
            } catch(e) {
                console.warn(`startSupervisor plan fetch attempt ${attempt+1}:`, e.message);
                if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
            }
        }

        const _planData      = _planSnap?.exists ? _planSnap.data() : {};
        State.calendarConfig = _planData.calendarConfig || null;
        // ✅ FIX: fallback ไปใช้ routeList จาก centerDoc ถ้า plan doc ไม่มี
        State.routeList      = ((_planData.routeList?.length > 0
            ? _planData.routeList
            : _centerData.routeList) || [])
            .sort((a,b) => a.localeCompare(b,'th',{numeric:true}));

        LoadBar.setProgress(30, `โหลด ${State.routeList.length} สาย...`);

        // ── Step 3: โหลด stores ทุกสาย batch 5 (เหมือนเดิม) ─────────
        const _routesCol = _planRef.collection('routes');
        const BATCH = 5;
        let loaded = 0;
        State.allRoutes = {};
        State.allStores = [];

        for (let i = 0; i < State.routeList.length; i += BATCH) {
            const chunk = State.routeList.slice(i, i + BATCH);
            await Promise.all(chunk.map(async (routeId) => {
                try {
                    const rd = await App._getWithTimeout(_routesCol.doc(routeId), 8000);
                    State.allRoutes[routeId] = rd.exists ? (rd.data().stores || []) : [];
                } catch(e) { State.allRoutes[routeId] = []; }
            }));
            loaded += chunk.length;
            LoadBar.setProgress(30 + Math.round(loaded / Math.max(State.routeList.length,1) * 45),
                `โหลด ${loaded}/${State.routeList.length} สาย...`);
        }
        State.allStores = Object.values(State.allRoutes).flat();

        // seed planCache เดือน active — ปฏิทินใช้ได้ทันที
        State.planCache[_useYM] = {
            stores:         State.allStores,
            calendarConfig: State.calendarConfig,
            ym:             _useYM,
            _ok:            true,
        };

        LoadBar.setProgress(80, 'โหลดยอดขาย...');

        // ── Step 4: sales non-blocking (เหมือน start()) ───────────────
        colSales.get().then(snap => {
            let merged = {};
            snap.forEach(doc => Object.assign(merged, doc.data()));
            State.sales = merged;
        }).catch((e) => console.warn('[App] startSupervisor: โหลด colSales ไม่สำเร็จ (KPI badge บนแผนที่อาจไม่ขึ้น):', e));

        LoadBar.done();
        document.getElementById('loader').style.display = 'none';
        State.isLoaded = true;
        SupervisorUI.init();

        // ── Step 5: calendar init — โหลด config เดือนอื่น background ──
        // เหมือน openPopup ของ Sales
        if (State.planList.length > 0) {
            Promise.all(State.planList
                .filter(ym => ym !== _useYM)
                .map(ym => App.loadPlanDataForSup(ym).catch((e) => console.warn('[App] preload plan เดือน', ym, 'ไม่สำเร็จ:', e)))
            ).then(() => {
                if (typeof CalendarCtrl !== 'undefined') CalendarCtrl.render();
            });
        }
        if (typeof CalendarCtrl !== 'undefined') CalendarCtrl.init();

        // ✅ FIX: เดิม Supervisor/ASM ไม่เคยเห็น campaign icon (โหมด "ตามสายวิ่ง") เลย
        // เพราะ _loadCampaignIcons() ถูกเรียกแค่ใน start() (flow ของ Sales) เท่านั้น
        App._loadCampaignIcons().catch((e) => console.warn('[App] startSupervisor: โหลด campaign icons ไม่สำเร็จ:', e));

        const searchEl = document.getElementById('search-input');
        if (searchEl) searchEl.oninput = (e) => {
            const q = e.target.value.toLowerCase().trim();
            document.querySelectorAll('#all-store-list > div[data-search]').forEach(el => {
                el.style.display = (el.getAttribute('data-search')||'').toLowerCase().includes(q) ? 'flex' : 'none';
            });
        };
        UI.switchTab('dashboard');
    },

    // ── loadPlanDataForSup: ดึง calendarConfig + stores ต่อเดือน ──────
    // เรียกเฉพาะ Supervisor — Sales ใช้ loadPlanData ปกติ
    loadPlanDataForSup: async (ym) => {
        if (Object.prototype.hasOwnProperty.call(State.planCache, ym) &&
            State.planCache[ym]?._ok) return State.planCache[ym];
        const centerDocId = State.planCenterDocId;
        try {
            const planRef        = db.collection('appData').doc(centerDocId).collection('plans').doc(ym);
            const cfgSnap        = await App._getWithTimeout(planRef, 10000);
            const calendarConfig = cfgSnap.exists ? (cfgSnap.data().calendarConfig || null) : null;
            const routeList      = cfgSnap.exists ? (cfgSnap.data().routeList || []) : [];
            // โหลด stores ทุกสาย batch 5 — เก็บ calendarOverride ของแต่ละสายไว้ด้วย
            // (ใช้ตอน Supervisor เลือกดูสายที่มี override เฉพาะตัว)
            let stores = [];
            const routeOverrides = {};
            const BATCH = 5;
            for (let i = 0; i < routeList.length; i += BATCH) {
                const chunk = routeList.slice(i, i + BATCH);
                const docs  = await Promise.all(
                    chunk.map(r => planRef.collection('routes').doc(r).get().catch(() => null))
                );
                docs.forEach((d, idx) => {
                    if (d?.exists) {
                        stores = stores.concat(d.data().stores || []);
                        routeOverrides[chunk[idx]] = d.data().calendarOverride || null;
                    }
                });
            }
            State.planCache[ym] = { stores, calendarConfig, ym, _ok: true, routeOverrides };
        } catch(e) {
            console.warn('loadPlanDataForSup:', ym, e);
            return { stores: [], calendarConfig: null, ym };
        }
        return State.planCache[ym];
    },

    logout: () => { Auth.logout(); },

    loadCalendarConfig: async (centerDocId, ym) => {
        // ✅ ระบบใหม่: calendarConfig อยู่ใน plans/{ym}
        try {
            const snap = await db.collection('appData').doc(centerDocId).collection('plans').doc(ym).get();
            State.calendarConfig = snap.exists ? (snap.data().calendarConfig || null) : null;
            if (typeof CalendarCtrl !== 'undefined') CalendarCtrl.render();
        } catch(e) {
            console.warn('loadCalendarConfig:', e);
            State.calendarConfig = null;
        }
    },

    start: async () => {
        document.getElementById('main-header').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        const _bnav = document.getElementById('bottom-nav');
        if (_bnav) _bnav.style.display = 'grid';
        // ✅ UX-FIX-1: แสดงชื่อจริงแทน username รหัส
        const _sess = Auth.getSession();
        const _displayName = _sess?.displayName || _sess?.username || State.myRoute;
        document.getElementById('user-route-label').innerText = _displayName;
        document.getElementById('loader').style.display = 'flex';
        LoadBar.show();

        let isMainLoaded = false, isSalesLoaded = false;

        const checkReady = () => {
            if (!isMainLoaded && !isSalesLoaded) {
                LoadBar.setProgress(15, 'กำลังโหลดข้อมูลร้านค้า...');
            } else if (isMainLoaded && !isSalesLoaded) {
                LoadBar.setProgress(60, 'โหลดข้อมูลร้านเสร็จ... กำลังโหลดยอดขาย');
            } else if (!isMainLoaded && isSalesLoaded) {
                LoadBar.setProgress(40, 'โหลดยอดขายเสร็จ... กำลังโหลดร้านค้า');
            }
            if (isMainLoaded && isSalesLoaded) {
                LoadBar.done();
                document.getElementById('loader').style.display = 'none';
                Processor.run();
                if (!State.isLoaded) {
                    UI.restoreTab();
                    State.isLoaded = true;
                    if (typeof CalendarCtrl !== 'undefined') CalendarCtrl.init();
                    waitForLeaflet(() => MapCtrl.initAndDraw());
                    // ✅ โหลด campaign icons background
                    App._loadCampaignIcons().catch((e) => console.warn('[App] start: โหลด campaign icons ไม่สำเร็จ:', e));
                }
            }
        };

        const _centerMatch = State.myRoute.match(/^(\d+)/);
        const _centerDocId = _centerMatch ? (_centerMatch[1] + '_main') : 'v1_main';
        docMain = db.collection('appData').doc(_centerDocId);

        const _centerRef = db.collection('appData').doc(_centerDocId);
        LoadBar.setProgress(15, 'กำลังเชื่อมต่อ...');

        // ✅ ระบบใหม่: ดึง centerDoc เพื่อหา currentPlanYM + planList
        let _centerSnap;
        try { _centerSnap = await App._getWithTimeout(_centerRef, 6000); }
        catch(e) { _centerSnap = { exists: false, data: () => ({}) }; }

        const _centerData    = _centerSnap?.exists ? _centerSnap.data() : {};
        State.planCenterDocId = _centerDocId;
        State.planList        = (_centerData.planList || []).sort().reverse();

        const _nowYM = (() => { const d=new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`; })();
        const _useYM = _centerData.currentPlanYM || State.planList[0] || _nowYM;

        LoadBar.setProgress(20, `📅 Plan ${_useYM}...`);
        App.loadCalendarConfig(_centerDocId, _useYM);

        // ดึง plan metadata + route stores + sales พร้อมกัน
        const _planRef  = _centerRef.collection('plans').doc(_useYM);
        const _routeRef = _planRef.collection('routes').doc(State.myRoute);

        const [_planResult, _routeResult, _salesResult] = await Promise.allSettled([
            App._getWithTimeout(_planRef,  8000),
            App._getWithTimeout(_routeRef, 10000),
            colSales.get(),
        ]);

        // process plan config
        try {
            const pd = _planResult.status === 'fulfilled' ? _planResult.value : null;
            State.calendarConfig = pd?.exists ? (pd.data().calendarConfig || null) : null;
            State.activePlanYM   = _useYM;
        } catch(e) { console.warn('[App] เกิด error ระหว่าง init (ไม่กระทบการทำงานหลัก):', e); }

        // process stores
        try {
            const rd = _routeResult.status === 'fulfilled' ? _routeResult.value : null;
            State.allStores = rd?.exists ? (rd.data().stores || []) : [];
        } catch(e) { State.allStores = []; }
        isMainLoaded = true; checkReady();

        // process sales
        try {
            if (_salesResult.status === 'fulfilled') {
                let merged = {};
                _salesResult.value.forEach(doc => Object.assign(merged, doc.data()));
                State.sales = merged;
            }
        } catch(e) { State.sales = {}; }
        isSalesLoaded = true; checkReady();

        // ✅ onSnapshot เฉพาะ route ตัวเอง จาก plans/{ym}/routes/{myRoute}
        const _liveRouteRef = _centerRef.collection('plans').doc(_useYM).collection('routes').doc(State.myRoute);
        App._unsubRoute = _liveRouteRef.onSnapshot(rd => {
            if (!rd.exists) return;
            State.allStores = rd.data().stores || [];
            if (State.activePlanYM) {
                State.planCache[State.activePlanYM] = { stores: State.allStores, calendarConfig: State.calendarConfig, ym: State.activePlanYM, _ok: true };
            }
            if (State.isLoaded) {
                Processor.run();
                const popup = document.getElementById('calendar-popup');
                if (popup?.style.display !== 'none') CalendarCtrl.render();
            }
        });

        // sales โหลดแล้วใน Promise.allSettled ด้านบน
    },
};

// ─── Calendar/market helpers ──────────────────────────────────────────────

function trimMarketName(raw) {
    if (!raw) return '';
    return raw.replace(/^[A-Z0-9]+\s+D\d+\s+/i, '').trim();
}

// ✅ BUGFIX: DateUtil ถูกประกาศไว้ใน dashboard.js เท่านั้น ซึ่งไม่ถูกโหลดในหน้า Sales เลย
// (sales.html โหลดแค่ sales-app.js, store-history.js, sales-dashboard.js, pwa-register.js)
// ทำให้ typeof DateUtil !== 'undefined' เป็น false เสมอในหน้านี้ — เพิ่ม fallback formatter เบาๆ
// ไว้ในไฟล์นี้เลย แทนที่จะพึ่งพา dashboard.js ข้ามหน้า
function ymToThaiShortLocal(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('_');
    if (!y || !m) return ym;
    try {
        return new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
    } catch(e) { return ym; }
}

function getDayMarketList(day, forMonth, forYear) {
    if (forMonth !== undefined && forYear !== undefined) {
        const loadedYM = State.activePlanYM || (() => {
            const d = new Date();
            return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
        })();
        const [ly, lm] = loadedYM.split('_').map(Number);
        if (forYear !== ly || forMonth !== lm - 1) return [];
    }
    const names = new Set();
    State.allStores.forEach(s => {
        if (s.days?.includes(day) && s.marketName?.trim())
            names.add(trimMarketName(s.marketName));
    });
    return Array.from(names).filter(Boolean).sort();
}

function getDayMarkets(day) { return getDayMarketList(day).join(' · '); }

// ─── Processor ───────────────────────────────────────────────────────────
const Processor = {
    run: () => { Processor.stores(); Processor.setupRoute(); },

    stores: () => {
        const hist = (typeof StoreHistory !== 'undefined') ? StoreHistory._storeMap : {};
        const mode = UI._sortMode || 'seq';

        // ✅ Supervisor/ASM: ร้านค้า tab แสดงทุกสายในศูนย์เสมอ
        // ไม่เกี่ยวกับสายที่เลือกใน tab คิวงาน (แยกอิสระ)
        const isSupAllRoutes = App.isSupervisor();
        let list = isSupAllRoutes
            ? Object.values(State.allRoutes || {}).flat()
            : [...State.allStores];

        // กรองซ้ำ (ร้านที่อยู่หลายสาย)
        if (isSupAllRoutes) {
            const seen = new Set();
            list = list.filter(s => seen.has(s.id) ? false : seen.add(s.id));
        }

        if (mode === 'seq') {
            list.sort((a, b) => (a.seqs?.[State.currentDay] || 9999) - (b.seqs?.[State.currentDay] || 9999));
        } else if (mode === 'name') {
            list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        } else if (mode === 'sales') {
            list.sort((a, b) => ((hist[b.id]?.net || 0) - (hist[a.id]?.net || 0)));
        } else if (mode === 'active') {
            list.sort((a, b) => ((State.sales[a.id]?.vpo > 0) ? 0 : 1) - ((State.sales[b.id]?.vpo > 0) ? 0 : 1));
        }

        const html = list.map(s => {
            const h       = hist[s.id];
            const mktTag  = s.marketName
                ? `<span style="font-size:10px;color:#3b82f6;font-weight:600;">${s.marketName}</span> ` : '';
            const histTag = h
                ? `<div style="margin-top:3px;font-size:10px;color:#059669;font-weight:700;">💰 ${_fmtB(h.net)} · ${h.skuCount} SKU · ${h.invCount} บิล</div>` : '';
            // Supervisor ดูรวม → แสดง route badge
            const routeTag = isSupAllRoutes && s.salesCode
                ? `<span style="font-size:10px;background:#dbeafe;color:#1e40af;font-weight:700;padding:1px 7px;border-radius:6px;margin-left:4px;">${s.salesCode}</span>` : '';
            return `<div onclick="UI.openModal('${s.id}')"
                data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()} ${(s.marketName||'').toLowerCase()} ${(s.salesCode||'').toLowerCase()}"
                style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:11px 14px;cursor:pointer;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="font-weight:800;font-size:13px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                    ${routeTag}
                </div>
                <div style="font-size:10px;color:#9ca3af;font-family:monospace;margin-top:1px;">${mktTag}${s.id}</div>
                ${histTag}
            </div>`;
        }).join('');

        const emptyMsg = isSupAllRoutes
            ? 'ไม่พบข้อมูลร้านในศูนย์นี้'
            : 'ไม่พบข้อมูลร้านในสายนี้';
        document.getElementById('all-store-list').innerHTML = html
            || `<p style="text-align:center;color:#9ca3af;margin-top:24px;font-size:13px;">${emptyMsg}</p>`;
    },

    setupRoute: () => {
        const ds   = new Set();
        State.allStores.forEach(s => s.days.forEach(d => ds.add(d)));
        const sorted = Array.from(ds).sort((a, b) => parseInt(a.replace('Day ','')) - parseInt(b.replace('Day ','')));
        const el   = document.getElementById('day-select');
        el.innerHTML = sorted.map(d => `<option value="${d}">Day ${d.replace('Day ','')}</option>`).join('');

        // ✅ ข้อ 6: ถ้ายังไม่มี currentDay → หาวันที่ตรงกับวันนี้ก่อน
        if (!State.currentDay) {
            // CalendarCtrl คำนวณวันปัจจุบันอยู่แล้ว — ดึง dayLabel จากนั้น
            const todayLabel = (typeof CalendarCtrl !== 'undefined')
                ? CalendarCtrl.getTodayDayLabel?.()
                : null;
            // ถ้าหา dayLabel ได้และอยู่ใน sorted → ใช้ มิฉะนั้น Day แรกที่มี
            State.currentDay = (todayLabel && sorted.includes(todayLabel))
                ? todayLabel
                : sorted[0];
            State.mapNeedsFit = true;
        }
        el.value = State.currentDay;
        // ✅ ข้อ 5: อัปเดต label display แทน dropdown
        // ✅ BUGFIX: เดิม _mktNow ถูกประกาศเป็น const อยู่ข้างในบล็อก if (_labelEl...) ด้านล่าง
        // แล้วมีโค้ดอีกจุดอ้างถึงตัวแปร "_stM" ที่ไม่เคยถูกประกาศไว้เลยในทั้งไฟล์ (typo/ของค้างจาก refactor)
        // ผลคือ Processor.setupRoute() throw ReferenceError ทุกครั้งที่รัน (ตั้งแต่ตอนเปิดแอปครั้งแรก)
        // ทำให้ Processor.routeList() ท้ายฟังก์ชันไม่ถูกเรียกเลย — สายวิ่ง/วันที่ไม่ขึ้นเลย
        // node --check จับไม่ได้เพราะเป็น runtime error ไม่ใช่ syntax error — ต้องรันจริงในเบราว์เซอร์ถึงเจอ
        const _mktNow = State.currentDay ? getDayMarkets(State.currentDay) : '';
        const _labelEl = document.getElementById('day-label-display');
        if (_labelEl && State.currentDay) {
            const _dayNum = State.currentDay.replace('Day ','');
            _labelEl.textContent = _mktNow
                ? `Day ${_dayNum} · ${_mktNow.split(' · ')[0]}`
                : `Day ${_dayNum}`;
        }
        const _stEl = document.getElementById('stores-title');
        if (_stEl) _stEl.textContent = _mktNow
            ? 'Day ' + State.currentDay.replace('Day ','') + ' · ' + _mktNow
            : 'รายชื่อร้านค้าทั้งหมด';
        Processor.routeList();
    },

    routeList: () => {
        let list = State.allStores
            .filter(s => {
                if (!s.days.includes(State.currentDay)) return false;
                if (State._filterMarket) return trimMarketName(s.marketName) === State._filterMarket;
                return true;
            })
            .sort((a, b) => (a.seqs?.[State.currentDay] || 999) - (b.seqs?.[State.currentDay] || 999));

        // ✅ ข้อ 5 (โหมดที่ 4): ปรับ list ตาม exception วันหยุด ถ้าวันนี้ตรงกับวันที่มีการแบ่งร้านไว้
        list = CalendarCtrl.applyExceptions(list, State.currentDay);

        const html = list.map((s, i) => {
            const seq     = s.seqs?.[State.currentDay] || i + 1;
            const navLink = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;

            // ✅ Campaign icons — แสดงข้าง KPI button (เฉพาะ Campaign "สินค้ากระจาย" ตามสาย)
            const campIcons = (State.campaignIcons?.[s.id] || [])
                .map(c => `<img src="${c.iconUrl}" title="${c.name}"
                    style="width:22px;height:22px;border-radius:6px;object-fit:cover;border:1.5px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.1);"
                    onerror="this.style.display='none'">`).join('');

            return `
            <div data-id="${s.id}" class="store-item bg-white p-2.5 rounded-xl border shadow-sm flex items-center gap-1.5 relative mb-2.5">
                <div class="drag-handle text-gray-300 cursor-grab active:cursor-grabbing leading-none">≡</div>
                <div data-seq class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-sm">${seq}</div>
                <div class="flex-1 font-bold text-sm text-gray-800 leading-tight cursor-pointer truncate" onclick="UI.openModal('${s.id}')">${s.name}</div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${campIcons}
                    <button onclick="UI.openModal('${s.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-1.5 rounded-lg font-bold text-[10px] border border-blue-100 transition active:scale-95">📊 KPI</button>
                    <a href="${navLink}" target="_blank" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2 py-1.5 rounded-lg font-bold text-[10px] text-center border border-emerald-100 transition active:scale-95">🚗</a>
                </div>
            </div>`;
        }).join('');

        const c = document.getElementById('route-store-list');
        c.innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่มีคิวงาน</p>';

        const _markets = getDayMarkets(State.currentDay);
        const _dayNum  = State.currentDay ? State.currentDay.replace('Day ', '') : '';
        const _mkt     = _markets ? ' · ' + _markets.split(' · ')[0] : '';
        document.getElementById('route-title').innerText =
            `Day ${_dayNum}${_mkt} (${list.length} ร้าน)` + (CalendarCtrl._lastExceptionApplied ? ' ⚠️ ปรับเนื่องจากวันหยุด' : '');

        if (sortableList) sortableList.destroy();
        sortableList = Sortable.create(c, {
            handle:              '.drag-handle',
            animation:           150,
            forceFallback:       false,  // ✅ ข้อ 2: ปิด forceFallback — ใช้ native drag แทน ป้องกันวางผิดตำแหน่ง
            fallbackTolerance:   3,
            delay:               80,
            delayOnTouchOnly:    true,
            touchStartThreshold: 4,
            scroll:              true,
            scrollSensitivity:   80,
            scrollSpeed:         15,
            ghostClass:          'sortable-ghost',  // ✅ ข้อ 2: แสดง placeholder ตำแหน่งที่จะวาง
            chosenClass:         'sortable-chosen',
            dragClass:           'sortable-drag',
            onStart: () => { window._sortableDragging = true; },
            onMove: () => true,  // ✅ ข้อ 2: allow drop ทุกตำแหน่ง
            onEnd: () => {
                window._sortableDragging = false;
                // ✅ ข้อ 3: อัปเดตตัวเลขทันทีหลัง drop ทั้งใน list และ map
                Processor._updateSeqBadgesOnly();
                MapCtrl.drawMap();
            },
            disabled: true,
        });
        window._sortableInstance = sortableList;
        setTimeout(() => {
            document.querySelectorAll('.drag-handle').forEach(h => {
                h.style.opacity      = '0';
                h.style.pointerEvents = 'none';
            });
        }, 100);

        MapCtrl.drawMap();
    },

    _updateSeqBadgesOnly: () => {
        document.querySelectorAll('#route-store-list > .store-item').forEach((item, index) => {
            const badge = item.querySelector('[data-seq]');
            if (badge) badge.textContent = index + 1;
            const id     = item.getAttribute('data-id');
            const target = State.allStores.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
    },

    _updateSeqBadges: () => {
        Processor._updateSeqBadgesOnly();
        MapCtrl.drawMap();
    },

    handleDrag: () => {
        if (App.isSupervisor()) { SupervisorUI.handleDrag(); return; }

        // ✅ UX-FIX-4: ป้องกันเขียนไปที่ path ผิดถ้า plan ยังโหลดไม่เสร็จ
        if (!State.activePlanYM) {
            showSalesToast('⚠️ ระบบยังโหลดไม่เสร็จ กรุณารอสักครู่', true);
            return;
        }

        const items   = document.querySelectorAll('#route-store-list > .store-item');
        const updated = [...State.allStores];
        items.forEach((item, index) => {
            const id     = item.getAttribute('data-id');
            const target = updated.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });

        const _centerMatch = State.myRoute.match(/^(\d+)/);
        const _centerDocId = _centerMatch ? (_centerMatch[1] + '_main') : 'v1_main';

        // ✅ เขียนไปยัง path ที่ถูกต้องตาม planMode (draft หรือ active)
        // ✅ ระบบใหม่: บันทึกไปที่ plans/{ym}/routes/{myRoute}
        const _writeRef = db.collection('appData').doc(_centerDocId)
            .collection('plans').doc(State.activePlanYM)
            .collection('routes').doc(State.myRoute);
        _writeRef.set({ stores: updated })
            .catch(e => showSalesToast('❌ บันทึกลำดับไม่สำเร็จ: ' + e.message, true));
    },
};

// ─── GPS ─────────────────────────────────────────────────────────────────
const GPS = {
    watchId: null, marker: null, circle: null,
    autoFollow: false, _mapListenerAttached: false, _isSelfMoving: false,

    start: async () => {
        if (!navigator.geolocation) return showSalesToast('⚠️ Browser ไม่รองรับ GPS', true);
        GPS.watchId   = navigator.geolocation.watchPosition(GPS._onSuccess, GPS._onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
        GPS.autoFollow = true;
        GPS._updateBtn('on');
        showSalesToast('📍 เปิด GPS แล้ว');
        GPS._attachMapListener();
    },

    stop: () => {
        if (GPS.watchId !== null) { navigator.geolocation.clearWatch(GPS.watchId); GPS.watchId = null; }
        GPS.marker?.remove(); GPS.marker = null;
        GPS.circle?.remove(); GPS.circle = null;
        GPS.autoFollow = false;
        GPS._updateBtn('off');
        showSalesToast('GPS ปิดแล้ว');
    },

    toggle: () => {
        if (GPS.watchId === null) {
            GPS.start();
        } else if (!GPS.autoFollow) {
            GPS.autoFollow = true;
            GPS._updateBtn('on');
            if (GPS.marker) {
                GPS._isSelfMoving = true;
                map.setView(GPS.marker.getLatLng(), map.getZoom() < 14 ? 15 : map.getZoom());
                GPS._isSelfMoving = false;
            }
            showSalesToast('📍 กลับมาติดตามตำแหน่งแล้ว');
        } else {
            GPS.stop();
        }
    },

    locate: () => {
        if (GPS.watchId === null) GPS.start();
        GPS.autoFollow = true;
        GPS._updateBtn('on');
        if (GPS.marker) { GPS._isSelfMoving = true; map.setView(GPS.marker.getLatLng(), 16); GPS._isSelfMoving = false; }
    },

    _onSuccess: (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        if (!map) return;
        const latlng = L.latLng(lat, lng);
        const icon   = L.divIcon({
            html: `<div style="width:18px;height:18px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 3px rgba(59,130,246,0.4),0 2px 8px rgba(0,0,0,0.3);"></div>`,
            iconSize: [18,18], iconAnchor: [9,9], className: '',
        });
        if (!GPS.marker) {
            GPS.marker = L.marker(latlng, { icon, zIndexOffset: 9999 }).addTo(map)
                .bindPopup(`<b>📍 ตำแหน่งของฉัน</b><br><small>แม่นยำ ~${Math.round(accuracy)}m</small>`);
        } else {
            GPS.marker.setLatLng(latlng);
            GPS.marker.getPopup().setContent(`<b>📍 ตำแหน่งของฉัน</b><br><small>แม่นยำ ~${Math.round(accuracy)}m</small>`);
        }
        if (!GPS.circle) {
            GPS.circle = L.circle(latlng, { radius: accuracy, color: '#3b82f6', fillOpacity: 0.08, weight: 1 }).addTo(map);
        } else { GPS.circle.setLatLng(latlng); GPS.circle.setRadius(accuracy); }
        if (GPS.autoFollow) {
            GPS._isSelfMoving = true;
            map.setView(latlng, map.getZoom() < 14 ? 15 : map.getZoom());
            GPS._isSelfMoving = false;
        }
    },

    _onError: (err) => {
        const msgs = { 1: 'ไม่ได้รับอนุญาตใช้ GPS', 2: 'หาตำแหน่งไม่ได้', 3: 'GPS หมดเวลา' };
        showSalesToast('⚠️ ' + (msgs[err.code] || 'GPS error'), true);
        GPS._updateBtn('off');
    },

    _updateBtn: (state) => {
        const btn = document.getElementById('gps-btn');
        if (!btn) return;
        if (state === 'on')     { btn.innerHTML = '📍 GPS เปิดอยู่';    btn.style.background = '#2563eb'; }
        else if (state === 'paused') { btn.innerHTML = '📍 กลับมาติดตาม'; btn.style.background = '#d97706'; }
        else                         { btn.innerHTML = '📍 ดูตำแหน่งฉัน'; btn.style.background = '#374151'; }
    },

    _attachMapListener: () => {
        if (!map || GPS._mapListenerAttached) return;
        GPS._mapListenerAttached = true;
        map.on('dragstart', () => {
            if (!GPS._isSelfMoving && GPS.autoFollow) {
                GPS.autoFollow = false;
                GPS._updateBtn('paused');
                showSalesToast('📍 หยุดติดตาม — กดปุ่ม GPS เพื่อกลับมา');
            }
        });
    },
};

// ─── CalendarCtrl ─────────────────────────────────────────────────────────
// ==========================================
// 📌 TaskCtrl — "งานที่ต้องส่ง" ที่ Admin ตั้งไว้ (อ่านอย่างเดียวฝั่ง Sales)
// ==========================================
const TaskCtrl = {
    _tasks: null,   // cache: array ของ task ที่ active ทั้งหมดในศูนย์นี้
    _loading: null, // promise กันโหลดซ้ำซ้อนถ้าเรียกพร้อมกันหลายจุด

    // โหลดครั้งเดียวตอนเปิดปฏิทิน แล้ว cache ไว้ใช้ทั้ง grid + day sheet
    loadAll: async () => {
        if (TaskCtrl._tasks) return TaskCtrl._tasks;
        if (TaskCtrl._loading) return TaskCtrl._loading;

        TaskCtrl._loading = (async () => {
            try {
                if (!State.centerId) { TaskCtrl._tasks = []; return TaskCtrl._tasks; }
                const snap = await db.collection('appData').doc(State.centerId + '_main')
                    .collection('tasks').where('active', '==', true).get();
                TaskCtrl._tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
                console.warn('TaskCtrl.loadAll:', e.message);
                TaskCtrl._tasks = [];
            }
            return TaskCtrl._tasks;
        })();
        return TaskCtrl._loading;
    },

    // ─── หา route ที่ "กำลังดูอยู่" สำหรับเช็คว่างานแบบเจาะจงสายตรงไหม ─────
    // คืน null ถ้าเป็น supervisor มุมมองรวมทุกสาย (ยังไม่เลือกสาย) — งาน scope 'routes' จะไม่ match ในกรณีนี้
    _activeRouteCode: () => {
        if (App.isSupervisor() && SupervisorUI._selectedRoute) return SupervisorUI._selectedRoute;
        if (App.isSupervisor()) return null;
        return State.myRoute || null;
    },

    // คืน array ของงานที่ตรงกับวันที่ (Date object) + สายที่กำลังดูอยู่
    getForDate: (dateObj) => {
        if (!TaskCtrl._tasks || !TaskCtrl._tasks.length) return [];
        const routeCode = TaskCtrl._activeRouteCode();
        const dayOfMonth = dateObj.getDate();
        const isoDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;

        return TaskCtrl._tasks.filter(t => {
            const dateMatch = t.dateType === 'monthly' ? t.dayOfMonth === dayOfMonth : t.date === isoDate;
            if (!dateMatch) return false;
            if (t.scope === 'routes') {
                if (!routeCode) return false; // มุมมองรวมทุกสาย — งานเจาะจงสายไม่ชัดเจนว่านับสายไหน เลยไม่โชว์
                return (t.routes || []).map(r => r.toUpperCase()).includes(routeCode.toUpperCase());
            }
            return true; // scope 'center' — ทุกสายเห็นเหมือนกัน
        });
    },
};

const CalendarCtrl = {
    _year: null, _month: null,

    init: () => {
        const now = new Date();
        CalendarCtrl._year  = now.getFullYear();
        CalendarCtrl._month = now.getMonth();
        CalendarCtrl.render();
    },

    // ✅ ข้อ 6: คืน dayLabel ของวันนี้ตาม calendarConfig
    getTodayDayLabel: () => {
        const now   = new Date();
        const cfg   = State.calendarConfig;
        const day   = now.getDate();
        const y     = now.getFullYear();
        const m     = now.getMonth();
        return CalendarCtrl.getDayLabelForCfg(day, cfg, State.allStores, y, m) || null;
    },

    // ✅ หา "วันเริ่มนับ" ของโหมด cycle ในเดือนนั้นๆ — รองรับทั้งแบบเดิม (เลขวันที่ตายตัว)
    // และแบบใหม่ (อิงวันในสัปดาห์ เช่น "จันทร์แรกของเดือน") ที่ไม่เลื่อนตามวันที่แล้ว ไม่มีปัญหา
    // ตอน copy plan ข้ามเดือนอีกต่อไป เพราะคำนวณสดใหม่ทุกเดือนจากวันในสัปดาห์ ไม่ใช่เลขวันที่ค้าง
    _resolveCycleStartDate: (cfg, year, month) => {
        if (cfg.anchorType === 'weekday-once') {
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            for (let d = 1; d <= daysInMonth; d++) {
                if (new Date(year, month, d).getDay() === cfg.anchorWeekday) return d;
            }
            return null; // ไม่ควรเกิด — ทุกเดือนมีทุกวันในสัปดาห์อย่างน้อย 1 ครั้ง
        }
        return parseInt(cfg.startDay || 1);
    },

    // ✅ วันหยุดของโหมด cycle — รวมทั้ง "วันหยุดเฉพาะกิจ" (เลขวันที่ เช่น วันหยุดนักขัตฤกษ์)
    // และ "วันหยุดประจำสัปดาห์" (เช่น อาทิตย์หยุดทุกสัปดาห์ — ไม่ต้องมาร์คซ้ำทุกเดือน)
    _isCycleHoliday: (cfg, year, month, d) => {
        if ((cfg.holidays || []).includes(d)) return true;
        if ((cfg.weeklyHolidays || []).includes(new Date(year, month, d).getDay())) return true;
        return false;
    },

    // ✅ REDESIGN: "วันในสัปดาห์ (วนซ้ำ)" — เปลี่ยนจากรีเซ็ตกลับ Day 1 ทุกต้นเดือน (ของเดิม)
    // เป็นนับต่อเนื่องไหลข้ามเดือนไม่มีจุดรีเซ็ตเลย ยึดจาก "จุดอ้างอิง" คงที่ 1 จุด
    // (เช่น "1 ต.ค. 2569 = D04") แล้วนับวันทำงานสะสมจากจุดนั้น mod ด้วยจำนวนวัน Cycle
    // หมายเหตุสำคัญ: โหมดนี้ข้าม "วันหยุดประจำสัปดาห์" (weeklyHolidays) เท่านั้น — ไม่รองรับ
    // "วันหยุดเฉพาะกิจ" (holidays รายเดือน) เพราะการนับข้ามหลายเดือนจะต้องรู้วันหยุดเฉพาะกิจ
    // ของทุกเดือนระหว่างทางด้วย ซึ่งเกินขอบเขตของ config ปัจจุบันที่เก็บแยกรายเดือน
    _computeRollingDayLabel: (cfg, targetDate) => {
        if (!cfg.anchorDate) return null;
        const anchor = new Date(cfg.anchorDate + 'T00:00:00');
        const wk = cfg.weeklyHolidays || [];
        const isWkHol = (d) => wk.includes(d.getDay());
        if (isWkHol(targetDate)) return null;

        let offset = 0;
        const cur = new Date(anchor);
        if (targetDate.getTime() >= anchor.getTime()) {
            while (cur.getTime() < targetDate.getTime()) {
                cur.setDate(cur.getDate() + 1);
                if (!isWkHol(cur)) offset++;
            }
        } else {
            while (cur.getTime() > targetDate.getTime()) {
                cur.setDate(cur.getDate() - 1);
                if (!isWkHol(cur)) offset--;
            }
        }
        const cycleDays = parseInt(cfg.cycleDays || 24);
        const startNum  = parseInt(cfg.anchorDayNum || 1);
        const n = (((startNum - 1 + offset) % cycleDays) + cycleDays) % cycleDays + 1;
        return 'Day ' + n;
    },

    getDayLabelForCfg: (dateNum, cfg, stores, year, month) => {
        // ✅ BUGFIX: เดิมเช็ค cfg.mapping ก่อนเช็ค cfg.mode เสมอ — ทำให้ mapping เก่าที่ค้างอยู่
        // ใน Firestore (จากตอนเคยตั้งโหมด "fixed" มาก่อน) มาบังทุกโหมดที่สลับมาทีหลัง
        // (Firestore set({...}, {merge:true}) ไม่ลบ field ย่อยที่ไม่ได้ส่งไปใหม่)
        // แก้โดยเช็ค cfg.mode ก่อนเสมอ ใช้ cfg.mapping แบบ legacy เฉพาะตอนไม่มี mode ระบุมาเลย
        //
        // ✅ FIX: เดิม return label เฉพาะตอนที่มีร้านผูกกับวันนั้นจริง ("stores.some(...)")
        // ทำให้วันที่ไม่มีร้าน/ตลาดเลย (dayLabel = null) กดเข้าไปดู day sheet ไม่ได้เลย
        // ที่ถูกต้องคือ "Day N" ควรมีอยู่เสมอตามโครงสร้างปฏิทิน ไม่ขึ้นกับว่าวันนั้นมีร้านหรือไม่
        // (การมีร้านหรือไม่ ใช้ตัดสินแค่ "hasRoute" / จุดสีน้ำเงินเท่านั้น ไม่ควรใช้ตัดสินว่าคลิกได้ไหม)
        if (!cfg || (!cfg.mode && (!cfg.mapping || Object.keys(cfg.mapping).length === 0))) {
            return `Day ${dateNum}`;
        }
        if (!cfg.mode && cfg.mapping) {
            // legacy config เก่าสุดที่ไม่มี field mode เลย (ก่อนระบบ mode ถูกสร้าง)
            return cfg.mapping[String(dateNum)] || null;
        }
        if (cfg.mode === 'date') {
            return `Day ${dateNum}`;
        }
        if (cfg.mode === 'fixed') return cfg.mapping ? (cfg.mapping[String(dateNum)] || null) : null;
        // ✅ โหมดที่ 4: ตามวันในสัปดาห์ — Day N = วันในสัปดาห์ที่กำหนดไว้ ขยายทุกสัปดาห์อัตโนมัติ
        if (cfg.mode === 'weekday') {
            const wmap = cfg.weekdayMap || {};
            const wd   = new Date(year, month, dateNum).getDay(); // 0=อาทิตย์..6=เสาร์
            const entry = Object.entries(wmap).find(([, w]) => w === wd);
            return entry ? entry[0] : null;
        }
        if (cfg.mode === 'cycle') {
            // ✅ "วันในสัปดาห์ (วนซ้ำ)" ใช้การนับต่อเนื่องแบบใหม่ทั้งหมด แยกออกจาก logic เดิมข้างล่าง
            if (cfg.anchorType === 'weekday-rolling') {
                return CalendarCtrl._computeRollingDayLabel(cfg, new Date(year, month, dateNum));
            }
            const startDate = CalendarCtrl._resolveCycleStartDate(cfg, year, month);
            if (startDate === null || dateNum < startDate) return null;
            const cycleDays   = parseInt(cfg.cycleDays || 24);
            const startDayNum = parseInt(cfg.startDayNum || 1);
            let dayCounter = startDayNum, workdays = 0;
            for (let d2 = startDate; d2 <= dateNum; d2++) {
                if (CalendarCtrl._isCycleHoliday(cfg, year, month, d2)) continue;
                workdays++;
                if (d2 === dateNum) {
                    const dayNum = dayCounter + workdays - 1;
                    // ✅ "วันในสัปดาห์ (จบเมื่อครบรอบ)" และโหมดอิงวันที่แบบเดิม: จบรอบแล้วไม่มี Day ต่อ
                    if (dayNum > cycleDays) return null;
                    return 'Day ' + dayNum;
                }
            }
        }
        return null;
    },

    getDayLabel: (dateNum) => {
        const cfg = State.calendarConfig;
        if (!cfg || cfg.mode === 'date') {
            const label = `Day ${dateNum}`;
            return State.allStores.some(s => s.days?.includes(label)) ? label : null;
        }
        if (cfg.mode === 'fixed') return cfg.mapping ? (cfg.mapping[String(dateNum)] || null) : null;
        if (cfg.mode === 'weekday') {
            const wmap = cfg.weekdayMap || {};
            const wd   = new Date(CalendarCtrl._year, CalendarCtrl._month, dateNum).getDay();
            const entry = Object.entries(wmap).find(([, w]) => w === wd);
            return entry ? entry[0] : null;
        }
        if (cfg.mode === 'cycle') {
            const startDate  = parseInt(cfg.startDay  || 1);
            const holidays   = cfg.holidays  || [];
            if (dateNum < startDate) return null;
            let dayCounter = parseInt(cfg.startDayNum || 1), workdays = 0;
            for (let d = startDate; d <= dateNum; d++) {
                if (holidays.includes(d)) continue;
                workdays++;
                if (d === dateNum) {
                    const dayNum    = dayCounter + workdays - 1;
                    const cycleDays = cfg.cycleDays || 24;
                    if (dayNum > cycleDays) return null;
                    return 'Day ' + dayNum;
                }
            }
        }
        return null;
    },

    getDateFromDay: (dayLabel) => {
        const cfg = State.calendarConfig;
        const targetNum = parseInt(String(dayLabel || '').replace('Day ', ''));

        // ✅ FIX: เดิมฟังก์ชันนี้ไม่มี branch สำหรับโหมด date/default/legacy เลย (คืน null เสมอ
        // ทั้งที่เป็นกรณีที่ง่ายที่สุด — Day N ตรงกับวันที่ N ของเดือนตรงๆ) ทำให้ผู้เรียกต้อง
        // เขียน logic เดาเองแยกต่างหาก (แล้วดันไปใช้แบบเดาผิดกับโหมดอื่นด้วย) แก้ให้ mirror
        // การไล่เงื่อนไขแบบเดียวกับ getDayLabelForCfg() เป๊ะ เพื่อให้ไป-กลับ (label↔date) สอดคล้องกันเสมอ
        if (!cfg || (!cfg.mode && (!cfg.mapping || Object.keys(cfg.mapping).length === 0))) {
            return isNaN(targetNum) ? null : targetNum;
        }
        if (!cfg.mode && cfg.mapping) {
            // legacy config เก่าสุดที่ไม่มี field mode เลย (ก่อนระบบ mode ถูกสร้าง) — lookup แบบเดียวกับ fixed
            const entry = Object.entries(cfg.mapping).find(([, v]) => v === dayLabel);
            return entry ? parseInt(entry[0]) : null;
        }
        if (cfg.mode === 'date') {
            return isNaN(targetNum) ? null : targetNum;
        }
        if (cfg.mode === 'fixed') {
            if (!cfg.mapping) return null;
            const entry = Object.entries(cfg.mapping).find(([, v]) => v === dayLabel);
            return entry ? parseInt(entry[0]) : null;
        }
        if (cfg.mode === 'cycle') {
            // ✅ REDESIGN: "วันในสัปดาห์ (วนซ้ำ)" ใช้การนับต่อเนื่องแบบใหม่ — สแกนหาในเดือนที่ระบุ
            // คืนวันแรกที่ตรงกัน (1 Day อาจตรงกับหลายวันที่ในเดือนเดียวกันได้ถ้า cycleDays สั้นกว่า
            // จำนวนวันทำงานในเดือน — ใช้ getDatesFromDayInMonth() ถ้าต้องการทุกวันที่ตรง)
            if (cfg.anchorType === 'weekday-rolling') {
                const daysInMonth = new Date(CalendarCtrl._year, CalendarCtrl._month + 1, 0).getDate();
                for (let d = 1; d <= daysInMonth; d++) {
                    const lbl = CalendarCtrl._computeRollingDayLabel(cfg, new Date(CalendarCtrl._year, CalendarCtrl._month, d));
                    if (lbl === dayLabel) return d;
                }
                return null;
            }
            const startDate   = CalendarCtrl._resolveCycleStartDate(cfg, CalendarCtrl._year, CalendarCtrl._month);
            if (startDate === null) return null;
            const cycleDays   = parseInt(cfg.cycleDays || 24);
            const startDayNum = parseInt(cfg.startDayNum || 1);
            const daysInMonth = new Date(CalendarCtrl._year, CalendarCtrl._month + 1, 0).getDate();
            let workDay = startDayNum;
            for (let d = startDate; d <= daysInMonth; d++) {
                if (CalendarCtrl._isCycleHoliday(cfg, CalendarCtrl._year, CalendarCtrl._month, d)) continue;
                if (workDay > cycleDays) return null; // "จบเมื่อครบรอบ" — เกินรอบแล้วไม่มีวันไหนตรงอีก
                if (workDay === targetNum) return d;
                workDay++;
            }
            return null;
        }
        // ⚠️ โหมด weekday: 1 Day ตรงกับหลายวันที่ต่อเดือน (ทุกสัปดาห์) — ไม่มีคำตอบเดียวที่ถูกต้อง
        // เตือนแบบเห็นชัดใน console แทนที่จะคืน null แบบเงียบๆ ถ้ามีจุดไหนเรียกใช้ฟังก์ชันนี้กับโหมดนี้
        // ให้ใช้ CalendarCtrl.getDatesFromDayInMonth() แทน ซึ่งคืนค่าเป็น array ของทุกวันที่ตรงในเดือนนั้น
        if (cfg.mode === 'weekday') {
            console.warn('CalendarCtrl.getDateFromDay: โหมด weekday ไม่รองรับ (1 Day = หลายวันที่ต่อเดือน) — ใช้ getDatesFromDayInMonth() แทน');
            return null;
        }
        return null;
    },

    // ✅ คืน array ของ "วันที่" ทั้งหมดในเดือนที่ตรงกับ Day label — ใช้กับกรณีที่ 1 Day label
    // ตรงกับหลายวันที่ในเดือนเดียวกันได้: โหมด weekday (ขยายทุกสัปดาห์) และโหมด cycle แบบ
    // weekday-rolling (วนกลับ Day 1 เมื่อครบรอบ)
    getDatesFromDayInMonth: (dayLabel, year, month) => {
        const cfg = State.calendarConfig;
        if (!cfg) return [];

        if (cfg.mode === 'weekday') {
            const wmap = cfg.weekdayMap || {};
            const targetWd = wmap[dayLabel];
            if (targetWd === undefined) return [];
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dates = [];
            for (let d = 1; d <= daysInMonth; d++) {
                if (new Date(year, month, d).getDay() === targetWd) dates.push(d);
            }
            return dates;
        }

        if (cfg.mode === 'cycle' && cfg.anchorType === 'weekday-rolling') {
            const targetNum = parseInt(String(dayLabel || '').replace('Day ', ''));
            if (isNaN(targetNum)) return [];
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dates = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const lbl = CalendarCtrl._computeRollingDayLabel(cfg, new Date(year, month, d));
                if (lbl === dayLabel) dates.push(d);
            }
            return dates;
        }

        return [];
    },

    // ✅ ข้อ 5 (โหมดที่ 4): เช็ค exception วันหยุดของ "วันนี้" (calendar date จริง) แล้วปรับ list ร้านให้ตรง
    // — วันหยุดเอง: เอาร้านที่ถูกแบ่งออกไปทั้งหมดออกจาก queue
    // — วันที่รับร้านเพิ่ม (prevDate/nextDate): เพิ่มร้านกลุ่มที่ถูกโยกมาเข้า queue
    applyExceptions: (baseList, dayLabel) => {
        const cfg = State.calendarConfig;
        CalendarCtrl._lastExceptionApplied = false;
        if (!cfg || !cfg.exceptions) return baseList;

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const route = State.myRoute;
        let list = [...baseList];

        Object.entries(cfg.exceptions).forEach(([dateStr, ex]) => {
            const split = ex.splits?.[route];
            if (!split) return; // สายนี้ไม่ได้รับผลกระทบจาก exception นี้

            // วันนี้คือวันหยุดเอง → ตัดร้านที่ถูกแบ่งออกทั้งหมดออกจาก queue ของ Day เดิม
            if (dateStr === todayStr && dayLabel === ex.originalDay) {
                const removeIds = new Set([...(split.prevStores || []), ...(split.nextStores || [])]);
                list = list.filter(s => !removeIds.has(s.id));
                CalendarCtrl._lastExceptionApplied = true;
            }
            // วันนี้คือวันก่อนหน้าที่รับร้านเพิ่ม → เติมร้านกลุ่ม prevStores เข้า queue
            if (ex.prevDate === todayStr && dayLabel === ex.prevDay) {
                const addIds = new Set(split.prevStores || []);
                const toAdd  = State.allStores.filter(s => addIds.has(s.id) && !list.some(x => x.id === s.id));
                list = list.concat(toAdd);
                if (toAdd.length) CalendarCtrl._lastExceptionApplied = true;
            }
            // วันนี้คือวันถัดไปที่รับร้านเพิ่ม → เติมร้านกลุ่ม nextStores เข้า queue
            if (ex.nextDate === todayStr && dayLabel === ex.nextDay) {
                const addIds = new Set(split.nextStores || []);
                const toAdd  = State.allStores.filter(s => addIds.has(s.id) && !list.some(x => x.id === s.id));
                list = list.concat(toAdd);
                if (toAdd.length) CalendarCtrl._lastExceptionApplied = true;
            }
        });

        return list;
    },

    render: () => {
        const container = document.getElementById('calendar-grid');
        if (!container) return;

        const year  = CalendarCtrl._year;
        const month = CalendarCtrl._month;
        const now   = new Date();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDow    = new Date(year, month, 1).getDay();
        const cfg  = State.calendarConfig;

        const monthLabel = new Date(year, month, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
        const headerEl   = document.getElementById('calendar-month-label');
        if (headerEl) headerEl.textContent = monthLabel;

        const modeEl = document.getElementById('calendar-mode-badge');
        if (modeEl) {
            // ✅ UX-FIX-3: Sales ไม่ต้องเห็น warning ที่ทำอะไรไม่ได้
            const _isSalesRole = Auth.getSession()?.role === 'sales';
            if (!cfg) {
                if (_isSalesRole) {
                    // Sales เห็นข้อความที่ไม่ทำให้งง และไม่ให้ความรู้สึกว่ามี error
                    modeEl.textContent = '📅 ปฏิทินวิ่งงาน';
                    modeEl.style.background = '#f0f9ff'; modeEl.style.color = '#0369a1';
                } else {
                    modeEl.textContent = '⚠️ ยังไม่ได้ตั้งค่าปฏิทิน';
                    modeEl.style.background = '#fef3c7'; modeEl.style.color = '#92400e';
                }
            } else if (cfg.mode === 'cycle') {
                modeEl.textContent = '🔄 Cycle D1-' + (cfg.cycleDays || 24);
                modeEl.style.background = '#ede9fe'; modeEl.style.color = '#5b21b6';
            } else {
                modeEl.textContent = '📌 กำหนดวันที่เอง';
                modeEl.style.background = '#dbeafe'; modeEl.style.color = '#1e40af';
            }
        }

        const DOW  = ['อา','จ','อ','พ','พฤ','ศ','ส'];
        let html   = DOW.map(d => `<div style="text-align:center;font-size:10px;font-weight:800;color:#9ca3af;padding:4px 0;">${d}</div>`).join('');
        for (let i = 0; i < firstDow; i++) html += `<div></div>`;

        const _renderYM    = `${year}_${String(month+1).padStart(2,'0')}`;
        const _renderPlan  = State.planCache[_renderYM];
        // ✅ ใช้ค่า override เฉพาะสายที่กำลังดูอยู่ (ถ้ามี) แทนค่า default ของศูนย์
        const _routeForCfg = (App.isSupervisor() && SupervisorUI._selectedRoute) ? SupervisorUI._selectedRoute : State.myRoute;
        const _routeOverride = _renderPlan?.routeOverrides?.[_routeForCfg];
        const _renderCfg   = _routeOverride || (_renderPlan !== undefined ? _renderPlan?.calendarConfig : cfg);
        const _renderStores = _renderPlan?.stores || State.allStores;

        for (let d = 1; d <= daysInMonth; d++) {
            const dayLabel   = CalendarCtrl.getDayLabelForCfg(d, _renderCfg, _renderStores, year, month);
            const isToday    = (d === now.getDate() && month === now.getMonth() && year === now.getFullYear());
            const dow        = new Date(year, month, d).getDay();
            const isWeekend  = dow === 0 || dow === 6;
            const isHoliday  = _renderCfg?.holidays?.includes(d);

            let bgColor = '#fff', textColor = '#111827', borderColor = '#f3f4f6';
            if (isToday)         { bgColor = '#2563eb'; textColor = '#fff';    borderColor = '#2563eb'; }
            else if (isHoliday)  { bgColor = '#fef2f2'; textColor = '#dc2626'; borderColor = '#fecaca'; }
            else if (isWeekend)  { bgColor = '#f9fafb'; textColor = '#6b7280'; }

            const _cellYM       = _renderYM;
            const _hasPlan      = State.planList.some(p => p === _cellYM);
            let hasRoute = false, hasPlanNotLoaded = false;
            if (dayLabel) {
                if (_renderPlan) {
                    hasRoute = _renderStores.some(s => s.days?.includes(dayLabel));
                } else if (_hasPlan) {
                    hasPlanNotLoaded = true;
                }
            }

            const mktsInCell = (dayLabel && _renderPlan) ? (() => {
                const names = new Set();
                _renderStores.forEach(s => {
                    if (s.days?.includes(dayLabel) && s.marketName)
                        names.add(trimMarketName(s.marketName));
                });
                return Array.from(names).filter(Boolean).sort();
            })() : [];
            const mktLabel = mktsInCell[0] || '';
            const mktMore  = mktsInCell.length > 1 ? '+' + (mktsInCell.length - 1) : '';
            const dayNum      = dayLabel ? parseInt(dayLabel.replace('Day ','')) : null;
            const isSameAsDate = true; // ไม่แสดงเลข Day badge
            // ✅ FIX: ส่ง year/month/d ที่คลิกจริงไปด้วยเสมอ แทนการให้ showDaySheet เดาวันที่คืนจาก dayLabel เอง
            // (จำเป็นมากในโหมด weekday ที่ 1 dayLabel ตรงกับหลายวันที่ในเดือนเดียวกัน)
            const clickHandler = dayLabel ? `CalendarCtrl.goToDay('${dayLabel}', ${year}, ${month}, ${d})` : '';

            // 📌 งานที่ต้องส่ง — เช็คตามวันที่ปฏิทินจริง ไม่ขึ้นกับว่าสายวิ่งวันนั้นหรือไม่
            const tasksForDay = TaskCtrl.getForDate(new Date(year, month, d));
            const taskLabel   = tasksForDay.length > 1 ? `มีงาน ${tasksForDay.length} อย่าง` : (tasksForDay[0]?.title || '');
            const taskLine    = taskLabel ? `<div style="font-size:8.5px;font-weight:800;line-height:1.3;padding:1px 3px;width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-radius:4px;background:${isToday?'rgba(255,255,255,0.22)':'#fffbeb'};color:${isToday?'#fff':'#b45309'};flex-shrink:0;">📌 ${taskLabel}</div>` : '';

            html += `
            <div onclick="${clickHandler}" ${isToday ? 'id="cal-today-cell"' : ''}
                style="border-radius:10px;border:1px solid ${borderColor};background:${bgColor};
                       padding:4px 3px;text-align:center;cursor:${dayLabel ? 'pointer' : 'default'};
                       height:80px;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
                       gap:2px;transition:background 0.1s;-webkit-tap-highlight-color:rgba(0,0,0,0.08);">
                <div style="font-size:13px;font-weight:${isToday?'900':'700'};color:${textColor};line-height:1.3;flex-shrink:0;">${d}</div>
                ${dayLabel ? `
                ${!isSameAsDate ? `<div style="font-size:9px;font-weight:800;padding:1px 5px;border-radius:5px;background:${isToday?'rgba(255,255,255,0.25)':'#ede9fe'};color:${isToday?'#fff':'#5b21b6'};white-space:nowrap;flex-shrink:0;">${dayLabel.replace('Day ','')}</div>` : ''}
                ${hasRoute ? `<div style="width:5px;height:5px;border-radius:50%;background:${isToday?'#fff':'#2563eb'};flex-shrink:0;"></div>` : hasPlanNotLoaded ? `<div style="width:5px;height:5px;border-radius:50%;background:#d1d5db;flex-shrink:0;"></div>` : ''}
                ${mktLabel ? `<div style="font-size:9px;color:${isToday?'rgba(255,255,255,0.92)':'#1d4ed8'};font-weight:700;line-height:1.3;padding:0 2px;width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:normal;overflow-wrap:break-word;flex-shrink:0;">${mktLabel}${mktMore?`<span style="font-size:8px;color:${isToday?'rgba(255,255,255,0.65)':'#93c5fd'}"> ${mktMore}</span>`:''}</div>` : ''}
                ` : (isHoliday ? `<div style="font-size:9px;color:#dc2626;font-weight:700;flex-shrink:0;">หยุด</div>` : '')}
                ${taskLine}
            </div>`;
        }
        container.innerHTML = html;
    },

    goToDay: (dayLabel, year, month, day) => { CalendarCtrl.showDaySheet(dayLabel, year, month, day); },

    navigateToDay: async (dayLabel, market) => {
        CalendarCtrl.closePopup();
        CalendarCtrl.closeDaySheet();
        const _calYM = `${CalendarCtrl._year}_${String(CalendarCtrl._month+1).padStart(2,'0')}`;
        if (_calYM !== (State.activePlanYM || '')) {
            const _pk = State.planList.find(p => p === _calYM);
            if (_pk) {
                // ✅ UX-FIX-8: await ให้เสร็จก่อน render — ป้องกัน race condition แสดงร้านผิดเดือน
                showSalesToast('⏳ กำลังโหลดข้อมูลเดือนนี้...');
                await App.switchToPlan(_pk);
            }
        }
        State.currentDay       = dayLabel;
        State._filterMarket    = market || '';
        const el = document.getElementById('day-select');
        if (el) el.value = dayLabel;
        State.mapNeedsFit = true;
        Processor.routeList();
        UI.switchTab('route');
        const mkts = getDayMarketList(dayLabel, CalendarCtrl._month, CalendarCtrl._year);
        showSalesToast('📅 ' + (market || (mkts[0] || dayLabel)));
    },

    showDaySheet: async (dayLabel, clickYear, clickMonth, clickDay) => {
        const _calYM = `${CalendarCtrl._year}_${String(CalendarCtrl._month+1).padStart(2,'0')}`;
        if (_calYM !== (State.activePlanYM || '')) {
            const _pk = State.planList.find(p => p === _calYM);
            if (_pk) await App.switchToPlan(_pk);
        }
        await TaskCtrl.loadAll(); // เบามาก แคชไว้แล้วส่วนใหญ่ — เผื่อกรณีเปิด day sheet เร็วกว่าโหลดเสร็จ
        const _sy = CalendarCtrl._year, _sm = CalendarCtrl._month;

        // ✅ FIX-SUP: Supervisor ที่เลือกสายแล้ว → ใช้เฉพาะร้านในสายนั้น
        // ไม่ใช้ State.allStores ซึ่งรวมทุกสาย
        const _activeStores = (App.isSupervisor() && SupervisorUI._selectedRoute)
            ? (State.allRoutes[SupervisorUI._selectedRoute] || State.allStores)
            : State.allStores;

        const mkts       = (() => {
            const names = new Set();
            _activeStores.forEach(s => {
                if (s.days?.includes(dayLabel) && s.marketName)
                    names.add(trimMarketName(s.marketName));
            });
            return Array.from(names).filter(Boolean).sort();
        })();
        const storeCount = _activeStores.filter(s => s.days?.includes(dayLabel)).length;

        // ✅ FIX: ใช้วันที่ที่คลิกจริงถ้ามีส่งมา (แม่นยำทุกโหมดปฏิทิน รวมถึง weekday ที่ 1 dayLabel
        // ตรงกับหลายวันที่ในเดือนเดียวกัน) — ก่อนหน้านี้เดาวันที่จากตัวเลขใน dayLabel ตรงๆ ซึ่งผิด
        // ทันทีที่ไม่ใช่โหมด date/default (ดู CalendarCtrl.getDateFromDay)
        // เผื่อกรณีถูกเรียกโดยไม่มี context วันที่ (ไม่ควรเกิดจาก UI ปกติ) ให้ fallback ไปที่ getDateFromDay()
        let sheetDate;
        if (Number.isInteger(clickDay)) {
            sheetDate = new Date(clickYear, clickMonth, clickDay);
        } else {
            const _resolvedDay = CalendarCtrl.getDateFromDay(dayLabel);
            if (_resolvedDay) {
                sheetDate = new Date(_sy, _sm, _resolvedDay);
            } else {
                console.warn('CalendarCtrl.showDaySheet: ไม่ทราบวันที่แน่ชัดของ', dayLabel, '(โหมด weekday ต้องส่ง clickDay มาด้วยเสมอ) — ใช้วันที่ 1 ของเดือนแทนชั่วคราว');
                sheetDate = new Date(_sy, _sm, 1);
            }
        }
        const dateStr    = sheetDate.toLocaleDateString('th-TH', {weekday:'long',day:'numeric',month:'long'});
        const dayTasks   = TaskCtrl.getForDate(sheetDate);
        const taskSection = dayTasks.length ? `
        <div style="margin:0 20px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:12px 14px;">
            <div style="font-size:12px;font-weight:900;color:#92400e;margin-bottom:6px;">📌 งานที่ต้องส่งวันนี้</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${dayTasks.map(t => `
                <div>
                    <div style="font-size:13px;font-weight:800;color:#78350f;line-height:1.3;">• ${t.title}</div>
                    ${t.desc ? `<div style="font-size:11px;color:#92400e;margin-left:12px;margin-top:1px;line-height:1.3;">${t.desc}</div>` : ''}
                </div>`).join('')}
            </div>
        </div>` : '';

        let sheet = document.getElementById('cal-day-sheet');
        if (!sheet) {
            sheet = document.createElement('div');
            sheet.id = 'cal-day-sheet';
            sheet.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
            sheet.innerHTML = '<div id="cal-day-sheet-bg" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);" onclick="CalendarCtrl.closeDaySheet()"></div><div id="cal-day-sheet-body" style="position:relative;background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:70vh;overflow-y:auto;transform:translateY(100%);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);padding:0 0 32px;"></div>';
            document.body.appendChild(sheet);
        }
        const body = document.getElementById('cal-day-sheet-body');
        body.innerHTML = `<div style="display:flex;justify-content:center;padding:10px 0 6px;"><div style="width:40px;height:4px;border-radius:2px;background:#e5e7eb;"></div></div>
        <div style="padding:4px 20px 14px;"><div style="font-size:11px;color:#6b7280;font-weight:600;">${dateStr}</div><div style="font-size:18px;font-weight:900;color:#111827;margin-top:2px;">${storeCount} ร้านค้า</div></div>
        <div style="height:1px;background:#f3f4f6;margin:0 20px 12px;"></div>
        ${taskSection}
        <div style="padding:0 16px;">
            <button onclick="CalendarCtrl.navigateToDay('${dayLabel}','')" style="width:100%;padding:13px;border-radius:14px;border:none;background:#2563eb;color:#fff;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:12px;">📋 ดูคิวงานทั้งหมด ${storeCount} ร้าน</button>
            ${mkts.length > 0 ? `<div style="font-size:11px;font-weight:800;color:#6b7280;margin-bottom:8px;padding:0 4px;">เลือกตลาด</div><div style="display:flex;flex-direction:column;gap:8px;">${mkts.map(mkt => {
                const cnt = _activeStores.filter(s => s.days?.includes(dayLabel) && trimMarketName(s.marketName) === mkt).length;
                return `<button onclick="CalendarCtrl.navigateToDay('${dayLabel}','${mkt.replace(/'/g,"\\'")}')\" style="width:100%;padding:12px 16px;border-radius:14px;border:1.5px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-family:inherit;"><span style="font-size:14px;font-weight:700;color:#111827;">🏪 ${mkt}</span><span style="font-size:12px;font-weight:800;color:#6b7280;background:#e5e7eb;padding:3px 12px;border-radius:20px;">${cnt} ร้าน</span></button>`;
            }).join('')}</div>` : '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:16px 0;">ไม่มีข้อมูลตลาด</div>'}
            <div style="display:flex;align-items:baseline;justify-content:space-between;margin:18px 4px 10px;">
                <div style="font-size:13px;font-weight:900;color:#111827;">📈 ยอดขายรายเดือน</div>
                <div style="font-size:10px;color:#9ca3af;font-weight:700;">ร้านค้าชุดเดียวกับวันนี้ · ${storeCount} ร้าน</div>
            </div>
            <div id="cal-month-summary">
                <div style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0;">⏳ กำลังโหลด...</div>
            </div>
        </div>`;
        requestAnimationFrame(() => { body.style.transform = 'translateY(0)'; });

        // ✅ โหลดสรุปยอดขายรายเดือนแบบ async แยกจากส่วนอื่น — ไม่บล็อกการเปิด sheet
        // ขอบเขต: เฉพาะ "ชุดร้านค้าของวันนี้" เท่านั้น (ไม่ใช่ทั้งสาย/ทั้งเดือน)
        const dayStoreIds = new Set(
            _activeStores.filter(s => s.days?.includes(dayLabel)).map(s => String(s.id).trim())
        );
        CalendarCtrl._renderMonthSummary(dayStoreIds);
    },

    // ─── สี badge/แถบ ASO ตามเปอร์เซ็นต์ความครอบคลุม ──────────────────────
    _asoColors: (pct) => {
        if (pct >= 80) return { text: '#059669', bg: '#d1fae5', bar: '#10b981' };
        if (pct >= 50) return { text: '#d97706', bg: '#fef3c7', bar: '#f59e0b' };
        return { text: '#dc2626', bg: '#fee2e2', bar: '#ef4444' };
    },

    // ─── สรุปยอดขายรายเดือนของ "ชุดร้านค้าวันนี้" (ต่อจากส่วนเลือกตลาด) ────────
    _renderMonthSummary: async (dayStoreIds) => {
        const routeCode = (App.isSupervisor() && SupervisorUI._selectedRoute)
            ? SupervisorUI._selectedRoute
            : State.myRoute;

        const container = () => document.getElementById('cal-month-summary');
        const showMsg = (icon, text) => {
            if (container()) container().innerHTML = `<div style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0;">${icon} ${text}</div>`;
        };

        if (App.isSupervisor() && !SupervisorUI._selectedRoute) {
            showMsg('🚚', 'เลือกสายก่อนเพื่อดูสรุปยอดขาย');
            return;
        }
        if (!routeCode || !dayStoreIds.size || typeof SalesDashboard === 'undefined') {
            showMsg('—', 'ไม่พบข้อมูลสาย');
            return;
        }

        try {
            await SalesDashboard._waitForYmKeyMap();
            const months = Object.keys(SalesDashboard._ymKeyMap || {}).sort().reverse().slice(0, 3);
            if (!container()) return; // ผู้ใช้ปิด sheet ไปแล้วระหว่างรอ

            if (!months.length) { showMsg('📭', 'ไม่มีข้อมูลยอดขาย'); return; }

            const results = await Promise.all(
                months.map(ym => SalesDashboard.calcRouteMonthSummary(routeCode, ym, dayStoreIds))
            );
            if (!container()) return;

            const fmtB = n => Math.round(n).toLocaleString('th-TH');
            const cards = months.map((ym, i) => {
                const r = results[i];
                if (!r) return ''; // เดือนที่ไม่มียอด — ซ่อนการ์ดทิ้ง
                const [y, m] = ym.split('_');
                const label = new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
                const c = CalendarCtrl._asoColors(r.asoPct);
                return `
                <div style="background:#fff;border:1px solid #eef0f3;border-radius:16px;padding:14px 16px;margin-bottom:10px;box-shadow:0 1px 2px rgba(17,24,39,0.04);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <span style="font-size:13px;font-weight:900;color:#111827;">${label}</span>
                        <span style="font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;background:${c.bg};color:${c.text};">ASO ${r.asoPct}%</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div style="background:#f9fafb;border-radius:10px;padding:9px 11px;">
                            <div style="font-size:9px;color:#9ca3af;font-weight:800;margin-bottom:3px;">💰 ยอดขาย</div>
                            <div style="font-size:15px;font-weight:900;color:#111827;">${fmtB(r.vol)}</div>
                        </div>
                        <div style="background:#f9fafb;border-radius:10px;padding:9px 11px;">
                            <div style="font-size:9px;color:#9ca3af;font-weight:800;margin-bottom:3px;">📊 VPO</div>
                            <div style="font-size:15px;font-weight:900;color:#111827;">${fmtB(r.vpo)}</div>
                        </div>
                        <div style="background:#f9fafb;border-radius:10px;padding:9px 11px;">
                            <div style="font-size:9px;color:#9ca3af;font-weight:800;margin-bottom:3px;">🏪 ASO</div>
                            <div style="font-size:15px;font-weight:900;color:#111827;">${r.aso}<span style="font-size:11px;font-weight:700;color:#9ca3af;">/${r.totalStores}</span></div>
                            <div style="background:#e5e7eb;border-radius:99px;height:4px;margin-top:6px;overflow:hidden;"><div style="background:${c.bar};height:4px;width:${r.asoPct}%;border-radius:99px;"></div></div>
                        </div>
                        <div style="background:#f9fafb;border-radius:10px;padding:9px 11px;">
                            <div style="font-size:9px;color:#9ca3af;font-weight:800;margin-bottom:3px;">📦 SKU</div>
                            <div style="font-size:15px;font-weight:900;color:#111827;">${r.sku}</div>
                        </div>
                    </div>
                </div>`;
            }).join('');

            container().innerHTML = cards || '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0;">📭 ไม่มีข้อมูลยอดขาย</div>';
        } catch (e) {
            console.warn('CalendarCtrl._renderMonthSummary:', e);
            showMsg('⚠️', 'โหลดข้อมูลไม่สำเร็จ');
        }
    },

    closeDaySheet: () => {
        const body = document.getElementById('cal-day-sheet-body');
        if (body) body.style.transform = 'translateY(100%)';
        setTimeout(() => { document.getElementById('cal-day-sheet')?.remove(); }, 320);
    },

    prevMonth: () => {
        CalendarCtrl._month--;
        if (CalendarCtrl._month < 0) { CalendarCtrl._month = 11; CalendarCtrl._year--; }
        CalendarCtrl.render();
        CalendarCtrl._bgLoadMonth();
    },

    nextMonth: () => {
        CalendarCtrl._month++;
        if (CalendarCtrl._month > 11) { CalendarCtrl._month = 0; CalendarCtrl._year++; }
        CalendarCtrl.render();
        CalendarCtrl._bgLoadMonth();
    },

    // โหลด planCache เดือนปัจจุบัน background ถ้ายังไม่มี
    _bgLoadMonth: () => {
        const ym = `${CalendarCtrl._year}_${String(CalendarCtrl._month+1).padStart(2,'0')}`;
        if (State.planCache[ym]?._ok) return;
        if (!State.planList.includes(ym)) return;
        const _loader = App.isSupervisor() ? App.loadPlanDataForSup : App.loadPlanData;
        _loader(ym).then(() => CalendarCtrl.render()).catch((e) => console.warn('[App] โหลดปฏิทินเดือน', ym, 'ไม่สำเร็จ:', e));
    },

    openPopup: () => {
        const popup = document.getElementById('calendar-popup');
        const sheet = document.getElementById('calendar-popup-sheet');
        if (!popup || !sheet) return;
        const now = new Date();
        CalendarCtrl._year  = now.getFullYear();
        CalendarCtrl._month = now.getMonth();
        // seed cache ด้วยข้อมูลปัจจุบัน
        const _curYM = State.activePlanYM || '';
        if (_curYM && State.allStores.length > 0 && !State.planCache[_curYM]?._ok) {
            State.planCache[_curYM] = { stores: State.allStores, calendarConfig: State.calendarConfig, ym: _curYM, _ok: true };
        }
        CalendarCtrl.render();
        popup.style.display = 'block';
        requestAnimationFrame(() => {
            sheet.style.transform = 'translateY(0)';
            setTimeout(() => {
                document.getElementById('cal-today-cell')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 350);
        });
        // โหลดเดือนอื่น background (non-blocking)
        if (State.planList?.length > 0) {
            const _loader = App.isSupervisor() ? App.loadPlanDataForSup : App.loadPlanData;
            Promise.all(State.planList.map(ym => _loader(ym).catch((e) => console.warn('[App] preload เดือน', ym, 'ไม่สำเร็จ:', e))))
                .then(() => CalendarCtrl.render());
        }
        // โหลด "งานที่ต้องส่ง" background — โหลดครั้งเดียว cache ไว้ แล้ว re-render กริดให้ขึ้นบรรทัด 📌
        TaskCtrl.loadAll().then(() => CalendarCtrl.render());
    },

    closePopup: (e) => {
        const sheet = document.getElementById('calendar-popup-sheet');
        const popup = document.getElementById('calendar-popup');
        if (e && sheet?.contains(e.target)) return;
        if (sheet) sheet.style.transform = 'translateY(100%)';
        setTimeout(() => { if (popup) popup.style.display = 'none'; }, 300);
    },
};

// ─── MapCtrl ──────────────────────────────────────────────────────────────
const MapCtrl = {
    initAndDraw: () => {
        const mapEl = document.getElementById('map');
        const fitBtn = document.getElementById('btn-fit-map');
        if (fitBtn) fitBtn.classList.remove('hidden');
        if (!map && mapEl) {
            map = L.map('map', { zoomControl: false, rotate: true, rotateControl: false }).setView([14.4745, 100.1222], 10);
            MapCtrl._initRotateUI();
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        }
        setTimeout(() => { if (map) { map.invalidateSize(); MapCtrl.drawMap(); MapCtrl.addGpsButton(); } }, 300);
    },

    drawMap: () => {
        if (!map) return;
        if (markerClusterGroup) map.removeLayer(markerClusterGroup);
        mapMarkers = [];

        markerClusterGroup = L.layerGroup();
        const list = State.allStores
            .filter(s => s.days.includes(State.currentDay))
            .sort((a, b) => (a.seqs?.[State.currentDay] || 999) - (b.seqs?.[State.currentDay] || 999));

        list.forEach((s, i) => {
            const seq  = s.seqs?.[State.currentDay] || i + 1;
            const icon = L.divIcon({
                html: `<div style="position:relative;display:inline-block;">
                    <svg viewBox="0 0 24 24" width="30" height="40" style="filter:drop-shadow(0px 2px 3px rgba(0,0,0,0.3));overflow:visible;">
                        <path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z" fill="#2563eb" stroke="#fff" stroke-width="2"/>
                        <circle cx="12" cy="9" r="7" fill="#fff"/>
                        <text x="12" y="13" font-size="10" font-weight="900" fill="#000" text-anchor="middle">${seq}</text>
                    </svg>
                    <div style="position:absolute;bottom:42px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-weight:700;color:#111827;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 0 4px #fff;pointer-events:none;line-height:1.2;max-width:80px;text-align:center;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                </div>`,
                className: '', iconSize: [30,40], iconAnchor: [15,40], popupAnchor: [0,-40],
            });
            const m = L.marker([s.lat, s.lng], { icon })
                .bindPopup(
                    `<div class="text-center pb-1"><b class="text-xs">${s.name}</b><br><button onclick="UI.openModal('${s.id}')" class="bg-gray-100 text-gray-700 px-3 py-1 rounded border mt-1 text-[10px] font-bold shadow-sm">ดูข้อมูล</button></div>`,
                    { closeButton: false }
                );
            markerClusterGroup.addLayer(m);
            mapMarkers.push(m);
        });

        map.addLayer(markerClusterGroup);
        if (State.mapNeedsFit) { MapCtrl.fitBounds(); State.mapNeedsFit = false; }
    },

    fitBounds:      () => { if (mapMarkers.length && map) map.fitBounds(new L.featureGroup(mapMarkers).getBounds(), { padding: [30,30] }); },
    forceFitBounds: () => { State.mapNeedsFit = true; MapCtrl.drawMap(); },

    _currentBearing: 0,

    _initRotateUI: () => {
        if (document.getElementById('rotate-ui')) return;
        const mapEl = document.getElementById('map');
        if (!mapEl) return;
        mapEl.style.position = 'relative';
        const ui = document.createElement('div');
        ui.id = 'rotate-ui';
        ui.style.cssText = 'position:absolute;top:10px;right:10px;z-index:999;display:flex;flex-direction:column;align-items:center;gap:6px;';
        ui.innerHTML = `
            <div id="compass-ring" onclick="MapCtrl.resetBearing()"
                style="width:44px;height:44px;border-radius:50%;background:rgba(31,41,55,0.92);border:2px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.4);">
                <svg id="compass-svg" width="28" height="28" viewBox="0 0 28 28">
                    <polygon points="14,3 17,14 14,12 11,14" fill="#ef4444"/>
                    <polygon points="14,25 17,14 14,16 11,14" fill="#e5e7eb"/>
                    <circle cx="14" cy="14" r="2" fill="white"/>
                </svg>
            </div>
            <button onclick="MapCtrl.rotateDelta(-45)" style="width:36px;height:36px;border-radius:50%;background:rgba(31,41,55,0.92);border:2px solid rgba(255,255,255,0.1);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);">↺</button>
            <button onclick="MapCtrl.rotateDelta(45)"  style="width:36px;height:36px;border-radius:50%;background:rgba(31,41,55,0.92);border:2px solid rgba(255,255,255,0.1);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);">↻</button>`;
        mapEl.appendChild(ui);
        MapCtrl._initPinchRotate();
    },

    _initPinchRotate: () => {
        const mapEl = document.getElementById('map');
        if (!mapEl) return;
        let t1 = null, t2 = null, startAngle = 0, startBearing = 0;
        const getAngle = (a, b) => Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180 / Math.PI;
        mapEl.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                t1 = e.touches[0]; t2 = e.touches[1];
                startAngle   = getAngle(t1, t2);
                startBearing = MapCtrl._currentBearing;
                e.preventDefault();
            }
        }, { passive: false });
        mapEl.addEventListener('touchmove', e => {
            if (e.touches.length === 2 && t1 && t2) {
                const cur   = getAngle(e.touches[0], e.touches[1]);
                const delta = cur - startAngle;
                MapCtrl.setBearing(startBearing + delta);
            }
        }, { passive: false });
        mapEl.addEventListener('touchend', () => { t1 = null; t2 = null; });
    },

    setBearing: (deg) => {
        MapCtrl._currentBearing = ((deg % 360) + 360) % 360;
        if (map?.setBearing) map.setBearing(MapCtrl._currentBearing);
        const svg = document.getElementById('compass-svg');
        if (svg) svg.style.transform = `rotate(${MapCtrl._currentBearing}deg)`;
    },

    rotateDelta:  (deg) => MapCtrl.setBearing(MapCtrl._currentBearing + deg),
    resetBearing: ()    => MapCtrl.setBearing(0),

    addGpsButton: () => {
        const existing = document.getElementById('gps-btn');
        if (existing) return;
        const mapEl = document.getElementById('map');
        if (!mapEl) return;
        const btn = document.createElement('button');
        btn.id    = 'gps-btn';
        btn.style.cssText = 'position:absolute;bottom:80px;right:10px;z-index:999;background:#374151;color:#fff;border:none;border-radius:12px;padding:10px 14px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.3);font-family:inherit;';
        btn.innerHTML     = '📍 ดูตำแหน่งฉัน';
        btn.onclick       = GPS.toggle;
        mapEl.appendChild(btn);
    },
};

// ─── Resizer ──────────────────────────────────────────────────────────────
const Resizer = {
    init: () => {
        const handle = document.getElementById('resize-handle');
        if (!handle) return;
        let startY = 0, startH = 0;
        const listEl = document.getElementById('route-store-list')?.closest('.overflow-y-auto');
        if (!listEl) return;
        handle.addEventListener('touchstart', e => {
            startY = e.touches[0].clientY;
            startH = listEl.offsetHeight;
        }, { passive: true });
        handle.addEventListener('touchmove', e => {
            const dy = e.touches[0].clientY - startY;
            const newH = Math.max(120, Math.min(window.innerHeight * 0.8, startH + dy));
            listEl.style.height = newH + 'px';
            if (map) map.invalidateSize();
        }, { passive: true });
    },
};

// ─── SupervisorUI ─────────────────────────────────────────────────────────
const SupervisorUI = {
    _selectedRoute: null,

    init: () => {
        SupervisorUI.renderRouteGrid();
        SupervisorUI.renderStoreList();
        if (typeof SalesDashboard !== 'undefined') SalesDashboard.initSupervisor?.();
    },

    // render all-store-list ตามสายที่เลือก (ถ้าไม่เลือก = ทุกสาย)
    renderStoreList: () => {
        const el = document.getElementById('all-store-list');
        if (!el) return;

        const selected = SupervisorUI._selectedRoute;
        // ยังไม่เลือกสาย → ไม่แสดงร้าน (tab route จะแสดง grid แทน)
        if (!selected) {
            el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:32px 16px;font-size:13px;">กรุณาเลือกสายวิ่งก่อนครับ</p>';
            return;
        }
        const stores = State.allRoutes[selected] || [];

        // header บอกว่ากำลังดูสายไหน
        const header = selected ? `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:#f8fafc;border-radius:12px;margin-bottom:10px;cursor:pointer;"
                onclick="SupervisorUI.clearRoute()">
                <span style="color:#9ca3af;font-size:12px;font-weight:700;">← กลับ · เลือกสายใหม่</span>
                <span style="background:${/C\d/.test(selected)?'#ede9fe':'#dbeafe'};color:${/C\d/.test(selected)?'#7c3aed':'#2563eb'};font-size:11px;font-weight:900;padding:2px 10px;border-radius:8px;">${selected}</span>
                <span style="font-size:11px;color:#6b7280;font-weight:700;">${stores.length} ร้าน</span>
            </div>` : '';

        const html = stores.map(s => {
            const routeId = Object.keys(State.allRoutes).find(r =>
                (State.allRoutes[r] || []).some(x => x.id === s.id)
            ) || '';
            const routeBadge = !selected && routeId ? `
                <span style="font-size:9px;font-weight:900;padding:1px 6px;border-radius:6px;background:${/C\d/.test(routeId)?'#ede9fe':'#dbeafe'};color:${/C\d/.test(routeId)?'#7c3aed':'#2563eb'};">${routeId}</span>` : '';
            return `<div onclick="UI.openModal('${s.id}')"
                data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()} ${(s.marketName||'').toLowerCase()} ${routeId.toLowerCase()}"
                style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:6px;">
                <div style="flex:1;min-width:0;margin-right:8px;">
                    <div style="font-weight:800;font-size:13px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                    <div style="font-size:10px;color:#9ca3af;font-family:monospace;margin-top:2px;">${s.id} ${routeBadge}</div>
                </div>
            </div>`;
        }).join('');

        el.innerHTML = header + (html || '<p style="text-align:center;color:#9ca3af;padding:24px;font-size:13px;">ไม่พบร้านค้า</p>');
    },

    renderRouteGrid: () => {
        const container = document.getElementById('route-store-list');
        if (!container) return;
        SupervisorUI._showDayBar(false);

        const routes = [...State.routeList].sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
        if (!routes.length) {
            container.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px;font-size:13px;">ไม่พบสายวิ่ง</p>';
            return;
        }

        const cRoutes     = routes.filter(r => /C\d/.test(r));
        const vRoutes     = routes.filter(r => /V\d/.test(r));
        const otherRoutes = routes.filter(r => !/[CV]\d/.test(r));

        const renderGroup = (title, color, bg, list) => {
            if (!list.length) return '';
            const cards = list.map(r => {
                const stores = State.allRoutes[r] || [];
                const icon   = /C\d/.test(r) ? '💳' : /V\d/.test(r) ? '🚐' : '📦';
                const active = SupervisorUI._selectedRoute === r;
                return `
                <div onclick="SupervisorUI.selectRoute('${r}')"
                    style="background:${active ? color : '#fff'};border:2px solid ${active ? color : '#e5e7eb'};
                           border-radius:16px;padding:14px 12px;cursor:pointer;
                           box-shadow:${active ? '0 4px 12px '+color+'44' : '0 1px 4px rgba(0,0,0,0.06)'};
                           transition:all 0.15s;text-align:center;">
                    <div style="font-size:18px;margin-bottom:4px;">${icon}</div>
                    <div style="font-size:11px;font-weight:900;color:${active ? '#fff' : color};">${r}</div>
                    <div style="font-size:18px;font-weight:900;color:${active ? '#fff' : '#111827'};line-height:1.2;margin-top:2px;">${stores.length}</div>
                    <div style="font-size:9px;color:${active ? 'rgba(255,255,255,0.8)' : '#9ca3af'};margin-top:1px;">ร้าน</div>
                </div>`;
            }).join('');
            return `
            <div style="margin-bottom:16px;">
                <div style="font-size:11px;font-weight:800;color:${color};margin-bottom:8px;padding:0 2px;">${title}</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">${cards}</div>
            </div>`;
        };

        const backBtn = SupervisorUI._selectedRoute ? `
        <div onclick="SupervisorUI.clearRoute()"
            style="display:flex;align-items:center;gap:8px;padding:9px 14px;background:#f1f5f9;border-radius:12px;cursor:pointer;margin-bottom:12px;font-weight:700;font-size:12px;color:#374151;">
            ← กลับ · เลือกสายใหม่
        </div>` : '';

        container.innerHTML = backBtn
            + `<div style="font-size:11px;color:#9ca3af;font-weight:600;text-align:center;padding:6px 0 12px;">
                แตะสายวิ่งเพื่อดูรายละเอียดและแผนที่
               </div>`
            + renderGroup('💳 Credit (C)', '#7c3aed', '#ede9fe', cRoutes)
            + renderGroup('🚐 Van (V)',    '#2563eb', '#dbeafe', vRoutes)
            + renderGroup('📦 อื่นๆ',      '#374151', '#f3f4f6', otherRoutes);
    },

    selectRoute: (routeId) => {
        SupervisorUI._selectedRoute = routeId;
        State.allStores   = State.allRoutes[routeId] || [];
        State.myRoute     = routeId;
        State.currentDay  = '';
        State.mapNeedsFit = true;
        Processor.setupRoute();
        SupervisorUI._showDayBar(true);
        SupervisorUI._injectBackBtn(routeId);
        // ✅ แค่ switch ไป tab คิวงาน + render แผนที่
        // ร้านค้า tab แยกอิสระ ไม่เกี่ยวกันเลย
        UI.switchTab('route');
    },

    _injectBackBtn: (routeId) => {
        document.getElementById('sup-back-btn')?.remove();
        const splitContainer = document.getElementById('split-container');
        if (!splitContainer) return;
        const btn    = document.createElement('div');
        btn.id       = 'sup-back-btn';
        btn.onclick  = SupervisorUI.clearRoute;
        btn.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;cursor:pointer;font-weight:700;font-size:12px;color:#374151;flex-shrink:0;z-index:30;';
        const isC        = /C\d/.test(routeId);
        const badgeColor = isC ? '#7c3aed' : '#2563eb';
        const badgeBg    = isC ? '#ede9fe' : '#dbeafe';
        btn.innerHTML = `<span style="font-size:14px;">←</span><span style="color:#9ca3af;">กลับ · เลือกสายใหม่</span><span style="background:${badgeBg};color:${badgeColor};font-size:10px;font-weight:900;padding:2px 10px;border-radius:8px;">${routeId}</span>`;
        splitContainer.parentElement.insertBefore(btn, splitContainer);
    },

    clearRoute: () => {
        SupervisorUI._selectedRoute = null;
        State.allStores  = [];
        State.myRoute    = Auth.getSession()?.username || '';
        State.currentDay = '';
        SupervisorUI._showDayBar(false);
        SupervisorUI.renderStoreList(); // reset กลับเป็นทุกสาย
        document.getElementById('sup-back-btn')?.remove();
        const c = document.getElementById('route-store-list');
        if (c) c.innerHTML = '';
        mapMarkers.forEach(m => { try { m.remove(); } catch(e){} });
        mapMarkers = [];
        UI.switchTab('route');
    },

    _showDayBar: (show) => {
        const dayBar = document.getElementById('day-select')?.closest('div[style*="border-bottom"]');
        if (dayBar) dayBar.style.display = show ? 'flex' : 'none';
        const editBtn = document.getElementById('edit-order-btn');
        if (editBtn) editBtn.style.display = show ? 'block' : 'none';
        const confBtn = document.getElementById('confirm-order-btn');
        if (confBtn) confBtn.style.display = 'none';
    },

    handleDrag: () => {
        const routeId = SupervisorUI._selectedRoute;
        if (!routeId) return;

        // ✅ UX-FIX-4: ป้องกัน path plans/undefined/routes/...
        if (!State.activePlanYM) {
            showSalesToast('⚠️ ระบบยังโหลดไม่เสร็จ กรุณารอสักครู่', true);
            return;
        }
        const items   = document.querySelectorAll('#route-store-list > .store-item');
        const updated = [...State.allStores];
        items.forEach((item, index) => {
            const id     = item.getAttribute('data-id');
            const target = updated.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
        State.allRoutes[routeId] = updated;

        const centerMatch = routeId.match(/^(\d+)/);
        const centerDocId = centerMatch ? (centerMatch[1] + '_main') : 'v1_main';

        let _writeRef;
        // ✅ ระบบใหม่: บันทึกไปที่ plans/{ym}/routes/{routeId}
        _writeRef = db.collection('appData').doc(centerDocId)
            .collection('plans').doc(State.activePlanYM)
            .collection('routes').doc(routeId);
        _writeRef.set({ stores: updated })
            .then(() => showSalesToast('✅ บันทึกลำดับเรียบร้อย'))
            .catch(e  => showSalesToast('❌ บันทึกไม่สำเร็จ: ' + e.message, true));
    },
};

// ==========================================
// 🎉 ActivityCtrl — กิจกรรมส่งเสริมการขาย (Campaign โหมด "ระบุร้านเอง")
// แสดงเฉพาะ Campaign ที่ scopeMode === 'custom' — มีรายชื่อร้านเข้าร่วมเจาะจง
// ==========================================
const ActivityCtrl = {
    _campaigns: [],
    _loaded: false,
    _activeCampaign: null,

    init: async () => {
        if (ActivityCtrl._loaded) { ActivityCtrl._renderList(); return; }
        try {
            const session   = Auth.getSession();
            const centerId  = State.centerId || session?.centerId || '';
            const centerDoc = centerId ? (centerId + '_main') : (session?.centerDoc || '');
            if (!centerId && !centerDoc) return;

            let snap = await db.collection('skuDistribution')
                .where('centerId', '==', centerDoc).get();
            if (snap.empty && centerId) {
                snap = await db.collection('skuDistribution')
                    .where('centerId', '==', centerId).get();
            }

            // ✅ ล็อคตามร้านที่ sale/supervisor มองเห็น — State.allStores คือ:
            //   - Sales: เฉพาะร้านในสายตัวเอง
            //   - Supervisor/ASM: ร้านทุกสายทั้งศูนย์ (ดู startSupervisor())
            // กัน sale เห็นร้านของสายอื่นที่ตัวเองไม่ได้ดูแล
            const myStoreCodes = new Set((State.allStores || []).map(s => String(s.id)));

            // ✅ เอาเฉพาะกิจกรรมที่ระบุรายชื่อร้าน (scopeMode === 'custom')
            // และมีอย่างน้อย 1 ร้านที่อยู่ในสายของ sale คนนี้ — ไม่งั้นโชว์กิจกรรมที่ไม่เกี่ยวข้องเลย
            ActivityCtrl._campaigns = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(c => c.scopeMode === 'custom')
                .map(c => ({
                    ...c,
                    // เก็บเฉพาะร้านที่อยู่ในสายของ sale คนนี้ไว้ใช้แสดงผล
                    _myParticipants: (c.participantStores || []).filter(code => myStoreCodes.has(code)),
                }))
                .filter(c => c._myParticipants.length > 0)
                .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

            ActivityCtrl._loaded = true;
        } catch (e) {
            console.warn('ActivityCtrl.init:', e);
        }
        ActivityCtrl._renderList();
    },

    // ✅ FIX: label ต้องบอกความจริงตาม role — Sales เห็นแค่สายตัวเอง, Supervisor/ASM เห็นทั้งศูนย์
    _scopeLabel: () => App.isSupervisor() ? '(ทั้งศูนย์)' : '(เฉพาะสายคุณ)',

    _renderList: () => {
        const el = document.getElementById('activity-list');
        if (!el) return;
        const isSup = App.isSupervisor();

        if (!ActivityCtrl._campaigns.length) {
            // ✅ FIX: ข้อความเดิม "สายของคุณ" ใช้ไม่ได้กับ Supervisor (ดูแลหลายสาย ไม่ใช่สายเดียว)
            const emptyMsg = isSup
                ? 'ยังไม่มีกิจกรรมที่เกี่ยวข้องกับศูนย์นี้'
                : 'ยังไม่มีกิจกรรมที่เกี่ยวข้องกับสายของคุณ';
            el.innerHTML = `<div style="text-align:center;padding:40px 20px;">
                <div style="font-size:32px;margin-bottom:8px;">📭</div>
                <div style="font-size:12px;color:#9ca3af;font-weight:600;">${emptyMsg}</div>
            </div>`;
            return;
        }
        const scopeLabel = ActivityCtrl._scopeLabel();
        // ✅ FIX: เพิ่มคำอธิบายกันเข้าใจผิดว่าหน้านี้ = แคมเปญทุกแบบ — จริงๆ เห็นเฉพาะ
        // แคมเปญโหมด "ระบุร้านเอง" เท่านั้น (โหมด "ตามสายวิ่ง" ไปโชว์เป็น icon หน้าคิวงานแทน)
        const hintBanner = isSup
            ? `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#4338ca;">
                ℹ️ หน้านี้แสดงเฉพาะแคมเปญโหมด "ระบุร้านเอง" ทั้งศูนย์ — แคมเปญโหมด "ตามสายวิ่ง" ดูที่ icon หน้าคิวงานของแต่ละสายแทน
               </div>`
            : '';
        el.innerHTML = hintBanner + ActivityCtrl._campaigns.map(c => {
            const startLbl = ymToThaiShortLocal(c.startYM) || c.startYM;
            const endLbl   = ymToThaiShortLocal(c.endYM)   || c.endYM;
            const count = (c._myParticipants || []).length; // ✅ นับเฉพาะร้านที่มองเห็นได้ตาม role
            const iconHtml = c.iconUrl
                ? `<img src="${c.iconUrl}" style="width:36px;height:36px;border-radius:9px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
                : `<span style="font-size:26px;flex-shrink:0;">🎉</span>`;
            return `
            <div onclick="ActivityCtrl.openCampaign('${c.id}')"
                class="bg-white p-3 rounded-xl border shadow-sm mb-2.5 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition">
                ${iconHtml}
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm text-gray-800 truncate">${c.name}</div>
                    <div style="font-size:11px;color:#9ca3af;margin-top:1px;">📅 ${startLbl} → ${endLbl}</div>
                    <div style="font-size:11px;color:#4f46e5;font-weight:700;margin-top:2px;">📋 ${count} ร้าน ${scopeLabel}</div>
                </div>
                <span style="color:#d1d5db;font-size:18px;">›</span>
            </div>`;
        }).join('');
    },

    openCampaign: async (id) => {
        const c = ActivityCtrl._campaigns.find(x => x.id === id);
        if (!c) return;
        ActivityCtrl._activeCampaign = c;

        document.getElementById('activity-list-view').classList.add('hidden');
        document.getElementById('activity-detail-view').classList.remove('hidden');

        const startLbl = ymToThaiShortLocal(c.startYM) || c.startYM;
        const endLbl   = ymToThaiShortLocal(c.endYM)   || c.endYM;
        const stores   = c._myParticipants || []; // ✅ เฉพาะร้านที่มองเห็นได้ตาม role
        document.getElementById('activity-detail-header').innerHTML = `
            <div style="font-size:15px;font-weight:900;color:#111827;">${c.name}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">📅 ${startLbl} → ${endLbl} &nbsp;|&nbsp; 📋 ${stores.length} ร้าน ${ActivityCtrl._scopeLabel()}</div>`;

        const meta = c.participantMeta || {};
        const list = stores
            .map(code => ({ code, name: meta[code] || '' }))
            .sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code, 'th'));

        // เรนเดอร์ก่อนพร้อม "กำลังเช็คยอด" — แล้วค่อย fill เครื่องหมายทีหลัง
        ActivityCtrl._renderStoreList(list, null);

        // ✅ เช็คยอดขายภายในระยะเวลากิจกรรม — ร้านไหนมียอดสินค้าโฟกัสแล้วขึ้นเครื่องหมาย ✓
        try {
            const boughtSet = await ActivityCtrl._checkPurchases(c);
            ActivityCtrl._renderStoreList(list, boughtSet);
        } catch (e) {
            console.warn('ActivityCtrl._checkPurchases:', e);
            ActivityCtrl._renderStoreList(list, new Set()); // เช็คไม่สำเร็จ — เคลียร์ loading state
        }
    },

    // ─── เช็คว่าร้านไหนมียอดขายสินค้าโฟกัสภายในระยะเวลากิจกรรมบ้าง ──────────
    _checkPurchases: async (c) => {
        const getMonthRange = (startYM, endYM) => {
            const months = [];
            let [y, m] = startYM.split('_').map(Number);
            const [ey, em] = endYM.split('_').map(Number);
            while (y < ey || (y === ey && m <= em)) {
                months.push(`${y}_${String(m).padStart(2,'0')}`);
                m++; if (m > 12) { m = 1; y++; }
            }
            return months;
        };

        const kws = (c.groups || []).flatMap(g => (g.keywords || []).map(k => k.toLowerCase()));
        if (!kws.length) return new Set();

        const months = getMonthRange(c.startYM, c.endYM);

        // ✅ PERF: โหลดทุกเดือนพร้อมกัน แทนทีละเดือน
        const monthResults = await Promise.all(months.map(async ym => {
            try {
                if (typeof SalesDashboard !== 'undefined' && SalesDashboard._loadChunks) {
                    return await SalesDashboard._loadChunks(ym);
                }
                const cs = await db.collection('sellout').doc(ym).collection('chunks').get();
                let rows = [];
                cs.forEach(d => rows = rows.concat(d.data().rows || []));
                return rows;
            } catch (e) { return []; /* เดือนนี้ไม่มีข้อมูล ข้ามไป */ }
        }));
        const allRows = monthResults.flat();

        const participantSet = new Set(c._myParticipants || []);
        return new Set(
            allRows
                .filter(r => participantSet.has(String(r.custCode || '').trim()))
                .filter(r => kws.some(k =>
                    (r.prodCode || '').toLowerCase().includes(k) ||
                    (r.prodName || '').toLowerCase().includes(k)
                ))
                .map(r => String(r.custCode || '').trim())
        );
    },

    // ─── Render รายชื่อร้าน — boughtSet เป็น null = กำลังเช็คยอดอยู่ ───────
    _renderStoreList: (list, boughtSet) => {
        const listEl = document.getElementById('activity-store-list');
        if (!listEl) return;
        listEl.innerHTML = list.length
            ? list.map(s => {
                const badge = boughtSet === null
                    ? '<span style="font-size:10px;color:#9ca3af;">⏳ เช็คยอด...</span>'
                    : boughtSet.has(s.code)
                        ? '<span style="font-size:11px;font-weight:800;color:#10b981;display:flex;align-items:center;gap:3px;">✅ มียอดแล้ว</span>'
                        : '<span style="font-size:11px;font-weight:700;color:#d1d5db;">— ยังไม่มียอด</span>';
                return `
                <div class="bg-white p-2.5 rounded-xl border shadow-sm mb-2 flex items-center gap-2.5">
                    <span style="font-size:16px;flex-shrink:0;">🏪</span>
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-xs text-gray-800 truncate">${s.name || '(ไม่พบชื่อร้านในระบบ)'}</div>
                        <div style="font-size:10px;color:#9ca3af;font-family:monospace;">${s.code}</div>
                    </div>
                    <div class="flex-shrink-0">${badge}</div>
                </div>`;
            }).join('')
            : '<p style="text-align:center;color:#9ca3af;font-size:12px;padding:24px 0;">ไม่มีร้านเข้าร่วม</p>';
    },

    backToList: () => {
        document.getElementById('activity-detail-view').classList.add('hidden');
        document.getElementById('activity-list-view').classList.remove('hidden');
    },
};

// ─── Event listeners ──────────────────────────────────────────────────────
document.getElementById('day-select').addEventListener('change', (e) => {
    State.currentDay  = e.target.value;
    const _m  = getDayMarkets(State.currentDay);
    const _sEl = document.getElementById('stores-title');
    if (_sEl) _sEl.textContent = _m
        ? 'สายวิ่งวันที่ ' + State.currentDay.replace('Day ','') + ' · ' + _m
        : 'รายชื่อร้านค้าทั้งหมด';
    // ✅ ข้อ 5: sync label display
    const _lbl = document.getElementById('day-label-display');
    if (_lbl && State.currentDay) {
        const _dn = State.currentDay.replace('Day ','');
        _lbl.textContent = _m ? `Day ${_dn} · ${_m.split(' · ')[0]}` : `Day ${_dn}`;
    }
    State.mapNeedsFit = true;
    Processor.routeList();
});

window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
document.addEventListener('DOMContentLoaded', () => { App.checkAuth(); Resizer.init(); });

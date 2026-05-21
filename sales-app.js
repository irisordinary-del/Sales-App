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

// Enable persistence — รองรับ offline และหลาย tab
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') console.warn('[DB] Multiple tabs: persistence limited');
    else if (err.code === 'unimplemented')  console.warn('[DB] Browser does not support persistence');
});

let docMain  = db.collection('appData').doc('v1_main');
const colSales = db.collection('v1_sales_chunks');

let State = {
    myRoute: "", allStores: [], routeStores: [], sales: {},
    currentDay: "", isLoaded: false, mapNeedsFit: true,
    calendarConfig: null, activePlanYM: null, currentPlanYM: '',
    viewMode: 'sales', centerId: null, allRoutes: {}, routeList: [],
    _filterMarket: '',
    planList: [], planCache: {}, planCenterDocId: '',
};
let map = null, mapMarkers = [], sortableList = null, markerClusterGroup = null;

// ─── Tab config ───────────────────────────────────────────────────────────
const VALID_TABS     = ['dashboard', 'stores', 'route'];
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
        document.querySelectorAll('.drag-handle').forEach(h => { h.style.opacity = '1'; h.style.pointerEvents = 'auto'; });
        if (window._sortableInstance) window._sortableInstance.option('disabled', false);
        showSalesToast('ลากเพื่อสลับลำดับ แล้วกด ✓ ยืนยัน');
    },
    confirmEditOrder: () => {
        UI._editMode = false;
        document.getElementById('edit-order-btn').style.display    = 'block';
        document.getElementById('confirm-order-btn').style.display = 'none';
        document.querySelectorAll('.drag-handle').forEach(h => { h.style.opacity = '0'; h.style.pointerEvents = 'none'; });
        if (window._sortableInstance) window._sortableInstance.option('disabled', true);
        Processor._updateSeqBadges();
        Processor.handleDrag();
        showSalesToast('✅ บันทึกลำดับเรียบร้อย');
    },

    switchTab: (id) => {
        if (!VALID_TABS.includes(id)) id = DEFAULT_TAB;

        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
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
    },

    restoreTab: () => {
        const today    = new Date().toDateString();
        const lastDate = localStorage.getItem('sales_tab_date');
        const savedTab = localStorage.getItem(_getTabKey());

        if (lastDate !== today) {
            localStorage.setItem('sales_tab_date', today);
            UI.switchTab(DEFAULT_TAB);
        } else {
            UI.switchTab(VALID_TABS.includes(savedTab) ? savedTab : DEFAULT_TAB);
        }
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
        document.getElementById('m-shoptype').textContent = s.shopType || '';
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
        // ✅ ถ้า cache มีแล้วและ calendarConfig ไม่ใช่ null → ใช้ cache
        // แต่ถ้า calendarConfig เป็น null → fetch ใหม่ (อาจยังไม่โหลด config จริง)
        const cached = State.planCache[ym];
        if (cached && cached.calendarConfig !== null) return cached;
        const centerDocId = State.planCenterDocId;
        try {
            const planRef = db.collection('appData').doc(centerDocId).collection('plans').doc(ym);

            if (App.isSupervisor()) {
                // ✅ Supervisor/ASM: ดึงแค่ calendarConfig
                // ไม่ seed stores ใน cache — ปฏิทินจะดึง State.allStores ณ เวลา render
                // ซึ่ง State.allStores จะเปลี่ยนตามสายที่ selectRoute() เลือกไว้
                const cfgSnap        = await App._getWithTimeout(planRef, 10000);
                const calendarConfig = cfgSnap.exists ? (cfgSnap.data().calendarConfig || null) : null;
                // stores = null → ปฏิทิน CalendarCtrl.render() จะใช้ State.allStores แทน
                State.planCache[ym] = { stores: null, calendarConfig, ym };
                return State.planCache[ym];
            }

            // Sales: ดึงจาก plans/{ym}/routes/{myRoute}
            const routeRef = planRef.collection('routes').doc(State.myRoute);
            const [cfgSnap, routeSnap] = await Promise.all([
                App._getWithTimeout(planRef,   15000),
                App._getWithTimeout(routeRef,  15000),
            ]);
            const calendarConfig = cfgSnap.exists   ? (cfgSnap.data().calendarConfig || null) : null;
            const stores         = routeSnap.exists ? (routeSnap.data().stores        || [])  : [];
            State.planCache[ym]  = { stores, calendarConfig, ym };
            return State.planCache[ym];
        } catch(e) {
            console.warn('loadPlanData:', ym, e);
            State.planCache[ym] = ym === State.activePlanYM && State.allStores.length > 0
                ? { stores: State.allStores, calendarConfig: State.calendarConfig, ym }
                : { stores: [], calendarConfig: null, ym };
            return State.planCache[ym];
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
        document.getElementById('main-header').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        const _bnav = document.getElementById('bottom-nav');
        if (_bnav) _bnav.style.display = 'grid';

        const session    = Auth.getSession();
        const roleLabel  = State.viewMode === 'asm' ? '🏢 ASM' : '👁 Sup';
        document.getElementById('user-route-label').innerText = roleLabel + ' · ' + (session?.displayName || session?.username || '');

        const dayRow = document.getElementById('day-select')?.closest('div');
        if (dayRow) dayRow.style.display = 'none';
        const editBtn = document.getElementById('edit-order-btn');
        if (editBtn) editBtn.style.display = 'none';

        document.getElementById('loader').style.display = 'flex';
        LoadBar.show();
        LoadBar.setProgress(15, 'กำลังโหลดข้อมูลทุกสาย...');

        const centerIdRaw  = session?.centerId || '';
        const _centerDocId = centerIdRaw ? (centerIdRaw + '_main') : 'v1_main';
        State.centerId     = centerIdRaw;

        try {
            const metaSnap = await db.collection('appData').doc(_centerDocId).get();
            State.routeList = metaSnap.exists ? (metaSnap.data().routeList || []) : [];
        } catch(e) { State.routeList = []; }

        // ─── detect routeColRef (draft หรือ active) ───────────────────
        // ✅ ระบบใหม่: ดึง currentPlanYM จาก centerDoc แล้วใช้ plans/{ym}
        let routeColRef;
        try {
            const _metaSnap = await App._getWithTimeout(db.collection('appData').doc(_centerDocId), 5000);
            const _meta     = _metaSnap.exists ? _metaSnap.data() : {};
            const _nowYMSup = (() => { const d=new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`; })();
            const _useYM    = _meta.currentPlanYM || (_meta.planList?.[0]) || _nowYMSup;
            routeColRef      = db.collection('appData').doc(_centerDocId).collection('plans').doc(_useYM).collection('routes');
            State.activePlanYM = _useYM;
        } catch(e) {
            const _nowYMSup = (() => { const d=new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`; })();
            routeColRef = db.collection('appData').doc(_centerDocId).collection('plans').doc(_nowYMSup).collection('routes');
        }

        LoadBar.setProgress(30, 'โหลดข้อมูลร้านทุกสาย...');

        // โหลดแบบ batch ทีละ 5 สาย — ลด concurrent requests
        const routes = State.routeList;
        const BATCH  = 5;
        let loaded   = 0;
        State.allRoutes = {};
        State.allStores = [];

        for (let i = 0; i < routes.length; i += BATCH) {
            const chunk = routes.slice(i, i + BATCH);
            await Promise.all(chunk.map(async (routeId) => {
                try {
                    const rd = await routeColRef.doc(routeId).get();
                    State.allRoutes[routeId] = rd.exists ? (rd.data().stores || []) : [];
                } catch(e) { State.allRoutes[routeId] = []; }
            }));
            loaded += chunk.length;
            LoadBar.setProgress(30 + Math.round(loaded / Math.max(routes.length,1) * 40), `โหลด ${loaded}/${routes.length} สาย...`);
        }

        State.allStores = Object.values(State.allRoutes).flat();
        LoadBar.setProgress(75, 'โหลดยอดขาย...');

        // โหลด sellout แบบ non-blocking
        colSales.get().then(snap => {
            let merged = {};
            snap.forEach(doc => Object.assign(merged, doc.data()));
            State.sales = merged;
        }).catch(()=>{});

        LoadBar.done();
        document.getElementById('loader').style.display = 'none';
        State.isLoaded = true;
        SupervisorUI.init();

        // ── Calendar init: clone มาจาก App.start() ─────────────────────
        // ดึง planList + calendarConfig ทุกเดือนพร้อมกัน แล้ว init CalendarCtrl
        const _centerDocIdCal = State.centerId ? (State.centerId + '_main') : 'v1_main';
        State.planCenterDocId = _centerDocIdCal;
        const _centerRefCal   = db.collection('appData').doc(_centerDocIdCal);

        try {
            const _calMeta = await App._getWithTimeout(_centerRefCal, 5000);
            const _calData = _calMeta.exists ? _calMeta.data() : {};
            State.planList      = (_calData.planList || []).sort().reverse();
            State.currentPlanYM = _calData.currentPlanYM || State.activePlanYM || '';

            // โหลด calendarConfig ทุกเดือนพร้อมกัน (clone จาก openPopup ของ start())
            await Promise.all(State.planList.map(async (ym) => {
                try {
                    const snap = await _centerRefCal.collection('plans').doc(ym).get();
                    const cfg  = snap.exists ? (snap.data().calendarConfig || null) : null;
                    // stores=null → render() จะใช้ State.allStores ณ เวลา render
                    State.planCache[ym] = { stores: null, calendarConfig: cfg, ym };
                } catch(e) {
                    State.planCache[ym] = { stores: null, calendarConfig: null, ym };
                }
            }));

            // set calendarConfig ของเดือน active
            State.calendarConfig = State.planCache[State.activePlanYM]?.calendarConfig || null;
        } catch(e) {
            console.warn('[Sup] calendar init:', e);
        }

        // init CalendarCtrl (เหมือนกับที่ start() เรียก)
        if (typeof CalendarCtrl !== 'undefined') CalendarCtrl.init();

        const searchEl = document.getElementById('search-input');
        if (searchEl) searchEl.oninput = (e) => {
            const q = e.target.value.toLowerCase().trim();
            document.querySelectorAll('#all-store-list > div[data-search]').forEach(el => {
                el.style.display = (el.getAttribute('data-search')||'').toLowerCase().includes(q) ? 'flex' : 'none';
            });
        };
        UI.switchTab('dashboard');
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
        document.getElementById('user-route-label').innerText  = State.myRoute;
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
        } catch(e) {}

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
                State.planCache[State.activePlanYM] = { stores: State.allStores, calendarConfig: State.calendarConfig, ym: State.activePlanYM };
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
        let list   = [...State.allStores];

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
            const h      = hist[s.id];
            const mktTag  = s.marketName
                ? `<span style="font-size:10px;color:#3b82f6;font-weight:600;">${s.marketName}</span> ` : '';
            const histTag = h
                ? `<div style="margin-top:3px;font-size:10px;color:#059669;font-weight:700;">💰 ${_fmtB(h.net)} · ${h.skuCount} SKU · ${h.invCount} บิล</div>` : '';
            return `<div onclick="UI.openModal('${s.id}')"
                data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()} ${(s.marketName||'').toLowerCase()}"
                style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:11px 14px;cursor:pointer;">
                <div style="font-weight:800;font-size:13px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                <div style="font-size:10px;color:#9ca3af;font-family:monospace;margin-top:1px;">${mktTag}${s.id}</div>
                ${histTag}
            </div>`;
        }).join('');
        document.getElementById('all-store-list').innerHTML = html
            || '<p style="text-align:center;color:#9ca3af;margin-top:24px;font-size:13px;">ไม่พบข้อมูลร้านในสายนี้</p>';
    },

    setupRoute: () => {
        const ds   = new Set();
        State.allStores.forEach(s => s.days.forEach(d => ds.add(d)));
        const sorted = Array.from(ds).sort((a, b) => parseInt(a.replace('Day ','')) - parseInt(b.replace('Day ','')));
        const el   = document.getElementById('day-select');
        el.innerHTML = sorted.map(d => `<option value="${d}">Day ${d.replace('Day ','')}</option>`).join('');

        if (!State.currentDay) { State.currentDay = sorted[0]; State.mapNeedsFit = true; }
        el.value = State.currentDay;

        const _stM  = getDayMarkets(State.currentDay);
        const _stEl = document.getElementById('stores-title');
        if (_stEl) _stEl.textContent = _stM
            ? 'Day ' + State.currentDay.replace('Day ','') + ' · ' + _stM
            : 'รายชื่อร้านค้าทั้งหมด';
        Processor.routeList();
    },

    routeList: () => {
        const list = State.allStores
            .filter(s => {
                if (!s.days.includes(State.currentDay)) return false;
                if (State._filterMarket) return trimMarketName(s.marketName) === State._filterMarket;
                return true;
            })
            .sort((a, b) => (a.seqs?.[State.currentDay] || 999) - (b.seqs?.[State.currentDay] || 999));

        const html = list.map((s, i) => {
            const seq     = s.seqs?.[State.currentDay] || i + 1;
            const navLink = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;
            return `
            <div data-id="${s.id}" class="store-item bg-white p-2.5 rounded-xl border shadow-sm flex items-center gap-2 relative mb-2.5">
                <div class="drag-handle text-gray-300 px-1 cursor-grab active:cursor-grabbing">≡</div>
                <div data-seq class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-sm">${seq}</div>
                <div class="flex-1 font-bold text-sm text-gray-800 leading-tight cursor-pointer truncate" onclick="UI.openModal('${s.id}')">${s.name}</div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button onclick="UI.openModal('${s.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-1.5 rounded-lg font-bold text-[10px] border border-blue-100 transition active:scale-95">📊 KPI</button>
                    <a href="${navLink}" target="_blank" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2 py-1.5 rounded-lg font-bold text-[10px] text-center border border-emerald-100 transition active:scale-95">🚗 นำทาง</a>
                </div>
            </div>`;
        }).join('');

        const c = document.getElementById('route-store-list');
        c.innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่มีคิวงาน</p>';

        const _markets = getDayMarkets(State.currentDay);
        const _dayNum  = State.currentDay.replace('Day ', '');
        const _mkt     = _markets ? ' · ' + _markets.split(' · ')[0] : '';
        document.getElementById('route-title').innerText = `Day ${_dayNum}${_mkt} (${list.length} ร้าน)`;

        if (sortableList) sortableList.destroy();
        sortableList = Sortable.create(c, {
            handle:              '.drag-handle',
            animation:           150,
            // ✅ iPad fix: forceFallback ป้องกัน native drag API ทำงานผิดบน iOS
            forceFallback:       true,
            fallbackTolerance:   5,
            // delay กันกด popup โดยไม่ตั้งใจ
            delay:               80,
            delayOnTouchOnly:    true,
            touchStartThreshold: 4,
            // scroll อัตโนมัติตอนลากถึงขอบ list
            scroll:              true,
            scrollSensitivity:   60,
            scrollSpeed:         12,
            // ✅ แจ้ง Resizer ให้หยุดฟัง touch ระหว่าง drag
            onStart: () => { window._sortableDragging = true; },
            onEnd:   () => {
                window._sortableDragging = false;
                Processor._updateSeqBadgesOnly();
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
const CalendarCtrl = {
    _year: null, _month: null,

    init: () => {
        const now = new Date();
        CalendarCtrl._year  = now.getFullYear();
        CalendarCtrl._month = now.getMonth();
        CalendarCtrl.render();
    },

    getDayLabelForCfg: (dateNum, cfg, stores, year, month) => {
        if (!cfg || cfg.mode === 'date') {
            const label = `Day ${dateNum}`;
            return (stores || State.allStores).some(s => s.days?.includes(label)) ? label : null;
        }
        if (cfg.mode === 'fixed') return cfg.mapping ? (cfg.mapping[String(dateNum)] || null) : null;
        if (cfg.mode === 'cycle') {
            const startDate  = parseInt(cfg.startDay  || 1);
            const holidays   = cfg.holidays  || [];
            if (dateNum < startDate) return null;
            let dayCounter = parseInt(cfg.startDayNum || 1), workdays = 0;
            for (let d2 = startDate; d2 <= dateNum; d2++) {
                if (holidays.includes(d2)) continue;
                workdays++;
                if (d2 === dateNum) {
                    const dayNum    = dayCounter + workdays - 1;
                    const cycleDays = cfg.cycleDays || 24;
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
        if (!cfg) return null;
        if (cfg.mode === 'fixed') {
            if (!cfg.mapping) return null;
            const entry = Object.entries(cfg.mapping).find(([, v]) => v === dayLabel);
            return entry ? parseInt(entry[0]) : null;
        }
        if (cfg.mode === 'cycle') {
            const startDate   = parseInt(cfg.startDay   || 1);
            const holidays    = cfg.holidays || [];
            const startDayNum = parseInt(cfg.startDayNum || 1);
            const targetNum   = parseInt(dayLabel.replace('Day ', ''));
            const daysInMonth = new Date(CalendarCtrl._year, CalendarCtrl._month + 1, 0).getDate();
            let workDay = startDayNum;
            for (let d = startDate; d <= daysInMonth; d++) {
                if (holidays.includes(d)) continue;
                if (workDay === targetNum) return d;
                workDay++;
            }
        }
        return null;
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
            if (!cfg) {
                modeEl.textContent = '⚠️ ยังไม่ได้ตั้งค่าปฏิทิน';
                modeEl.style.background = '#fef3c7'; modeEl.style.color = '#92400e';
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
        // ✅ FIX: ถ้า _renderPlan มีใน cache → ใช้ calendarConfig ของเดือนนั้นเท่านั้น
        // ไม่ fallback ไป State.calendarConfig (เดือนอื่น) ซึ่งทำให้ pattern วันหยุดผิด
        // ถ้า _renderPlan ยังไม่มีใน cache เลย (ยังไม่โหลด) → ใช้ cfg เป็น fallback
        const _renderCfg   = _renderPlan !== undefined
            ? _renderPlan?.calendarConfig   // อาจเป็น null ถ้าเดือนนั้นไม่มี config → ไม่แสดง Day
            : cfg;                          // ยังไม่โหลดเลย → ใช้ active month config
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
            const _cellCfg    = State.calendarConfig;
            const isDateMode  = !_cellCfg || _cellCfg.mode === 'date';
            const dayNum      = dayLabel ? parseInt(dayLabel.replace('Day ','')) : null;
            // ✅ ซ่อน Day badge เมื่อตัวเลข Day ตรงกับวันที่ในทุก mode (ไม่ใช่แค่ date mode)
            const isSameAsDate = dayNum === d;
            const clickHandler = dayLabel ? `CalendarCtrl.goToDay('${dayLabel}')` : '';

            html += `
            <div onclick="${clickHandler}" ${isToday ? 'id="cal-today-cell"' : ''}
                style="border-radius:10px;border:1px solid ${borderColor};background:${bgColor};
                       padding:4px 2px;text-align:center;cursor:${dayLabel ? 'pointer' : 'default'};
                       min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
                       gap:1px;transition:background 0.1s;-webkit-tap-highlight-color:rgba(0,0,0,0.08);">
                <div style="font-size:13px;font-weight:${isToday?'900':'700'};color:${textColor};line-height:1.3;">${d}</div>
                ${dayLabel ? `
                ${!isSameAsDate ? `<div style="font-size:9px;font-weight:800;padding:1px 5px;border-radius:5px;background:${isToday?'rgba(255,255,255,0.25)':'#ede9fe'};color:${isToday?'#fff':'#5b21b6'};white-space:nowrap;">${dayLabel.replace('Day ','')}</div>` : ''}
                ${hasRoute ? `<div style="width:5px;height:5px;border-radius:50%;background:${isToday?'#fff':'#2563eb'};flex-shrink:0;"></div>` : hasPlanNotLoaded ? `<div style="width:5px;height:5px;border-radius:50%;background:#d1d5db;flex-shrink:0;"></div>` : ''}
                ${mktLabel ? `<div style="font-size:8px;color:${isToday?'rgba(255,255,255,0.85)':'#2563eb'};font-weight:700;line-height:1.1;padding:0 2px;max-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${mktLabel}${mktMore?'<span style=color:#9ca3af> '+mktMore+'</span>':''}</div>` : ''}
                ` : (isHoliday ? `<div style="font-size:9px;color:#dc2626;font-weight:700;">หยุด</div>` : '')}
            </div>`;
        }
        container.innerHTML = html;
    },

    goToDay: (dayLabel) => { CalendarCtrl.showDaySheet(dayLabel); },

    navigateToDay: async (dayLabel, market) => {
        CalendarCtrl.closePopup();
        CalendarCtrl.closeDaySheet();
        const _calYM = `${CalendarCtrl._year}_${String(CalendarCtrl._month+1).padStart(2,'0')}`;
        if (_calYM !== (State.activePlanYM || '')) {
            const _pk = State.planList.find(p => p === _calYM);
            if (_pk) { showSalesToast('⏳ กำลังโหลด...'); await App.switchToPlan(_pk); }
        }
        setTimeout(() => {
            State.currentDay       = dayLabel;
            State._filterMarket    = market || '';
            const el = document.getElementById('day-select');
            if (el) el.value = dayLabel;
            State.mapNeedsFit = true;
            Processor.routeList();
            UI.switchTab('route');
            const mkts = getDayMarketList(dayLabel, CalendarCtrl._month, CalendarCtrl._year);
            showSalesToast('📅 ' + (market || (mkts[0] || dayLabel)));
        }, 320);
    },

    showDaySheet: async (dayLabel) => {
        const _calYM = `${CalendarCtrl._year}_${String(CalendarCtrl._month+1).padStart(2,'0')}`;
        if (_calYM !== (State.activePlanYM || '')) {
            const _pk = State.planList.find(p => p === _calYM);
            if (_pk) await App.switchToPlan(_pk);
        }
        const _sy = CalendarCtrl._year, _sm = CalendarCtrl._month;
        const mkts       = getDayMarketList(dayLabel, _sm, _sy);
        const storeCount = State.allStores.filter(s => s.days?.includes(dayLabel)).length;
        const dayNum     = parseInt(dayLabel.replace('Day ',''));
        const dateStr    = new Date(_sy, _sm, dayNum).toLocaleDateString('th-TH', {weekday:'long',day:'numeric',month:'long'});

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
        <div style="padding:0 16px;">
            <button onclick="CalendarCtrl.navigateToDay('${dayLabel}','')" style="width:100%;padding:13px;border-radius:14px;border:none;background:#2563eb;color:#fff;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:12px;">📋 ดูคิวงานทั้งหมด ${storeCount} ร้าน</button>
            ${mkts.length > 0 ? `<div style="font-size:11px;font-weight:800;color:#6b7280;margin-bottom:8px;padding:0 4px;">เลือกตลาด</div><div style="display:flex;flex-direction:column;gap:8px;">${mkts.map(mkt => {
                const cnt = State.allStores.filter(s => s.days?.includes(dayLabel) && trimMarketName(s.marketName) === mkt).length;
                return `<button onclick="CalendarCtrl.navigateToDay('${dayLabel}','${mkt.replace(/'/g,"\'")}')" style="width:100%;padding:12px 16px;border-radius:14px;border:1.5px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-family:inherit;"><span style="font-size:14px;font-weight:700;color:#111827;">🏪 ${mkt}</span><span style="font-size:12px;font-weight:800;color:#6b7280;background:#e5e7eb;padding:3px 12px;border-radius:20px;">${cnt} ร้าน</span></button>`;
            }).join('')}</div>` : '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:16px 0;">ไม่มีข้อมูลตลาด</div>'}
        </div>`;
        requestAnimationFrame(() => { body.style.transform = 'translateY(0)'; });
    },

    closeDaySheet: () => {
        const body = document.getElementById('cal-day-sheet-body');
        if (body) body.style.transform = 'translateY(100%)';
        setTimeout(() => { document.getElementById('cal-day-sheet')?.remove(); }, 320);
    },

    prevMonth: () => {
        CalendarCtrl._month--;
        if (CalendarCtrl._month < 0) { CalendarCtrl._month = 11; CalendarCtrl._year--; }
        CalendarCtrl._loadAndRender();
    },

    nextMonth: () => {
        CalendarCtrl._month++;
        if (CalendarCtrl._month > 11) { CalendarCtrl._month = 0; CalendarCtrl._year++; }
        CalendarCtrl._loadAndRender();
    },

    // ✅ โหลด calendarConfig ของเดือนนั้นก่อน render — กัน config เดือนผิด
    _loadAndRender: () => {
        const ym = `${CalendarCtrl._year}_${String(CalendarCtrl._month+1).padStart(2,'0')}`;
        CalendarCtrl.render(); // render ทันที (อาจยังไม่มี config)
        // โหลดใหม่ถ้า: ยังไม่มีใน cache หรือ calendarConfig เป็น null
        const cached = State.planCache[ym];
        const needFetch = !cached || cached.calendarConfig === null;
        if (needFetch && State.planList?.includes(ym)) {
            // ลบ cache เก่าก่อน ให้ loadPlanData fetch ใหม่จริงๆ
            if (cached?.calendarConfig === null) delete State.planCache[ym];
            App.loadPlanData(ym)
                .then(() => CalendarCtrl.render())
                .catch(() => {});
        }
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
        if (_curYM && State.allStores.length > 0 && !State.planCache[_curYM]) {
            State.planCache[_curYM] = { stores: State.allStores, calendarConfig: State.calendarConfig, ym: _curYM };
        }
        popup.style.display = 'block';
        requestAnimationFrame(() => {
            sheet.style.transform = 'translateY(0)';
            setTimeout(() => {
                document.getElementById('cal-today-cell')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 350);
        });
        // ✅ โหลด calendarConfig ทุกเดือนก่อน แล้วค่อย render
        // กัน config เดือนผิด (เดือนที่ยังไม่โหลดจะแสดงว่างแทนที่จะใช้ config เดือนอื่น)
        if (State.planList?.length > 0) {
            // ลบ cache ที่ calendarConfig = null ออกก่อน ให้ fetch ใหม่
            State.planList.forEach(ym => {
                if (State.planCache[ym]?.calendarConfig === null) delete State.planCache[ym];
            });
            Promise.all(State.planList.map(ym => App.loadPlanData(ym).catch(() => {})))
                .then(() => CalendarCtrl.render());
        }
        CalendarCtrl.render(); // render เบื้องต้นก่อน (อาจยังไม่มี config บางเดือน)
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
                html: `<svg viewBox="0 0 24 24" width="30" height="40" style="filter:drop-shadow(0px 2px 3px rgba(0,0,0,0.3));overflow:visible;"><path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cx="12" cy="9" r="7" fill="#fff"/><text x="12" y="13" font-size="10" font-weight="900" fill="#000" text-anchor="middle">${seq}</text></svg>`,
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
        const stores = Object.values(State.allRoutes).flat();
        // Tab2: รายชื่อร้าน
        const html = stores.map(s => `
            <div onclick="UI.openModal('${s.id}')"
                data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()} ${(s.marketName||'').toLowerCase()}"
                style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
                <div style="flex:1;min-width:0;margin-right:10px;">
                    <div style="font-weight:800;font-size:13px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                    <div style="font-size:10px;color:#9ca3af;font-family:monospace;">${s.id}</div>
                </div>
            </div>`).join('');
        const el = document.getElementById('all-store-list');
        if (el) el.innerHTML = html || '<p style="text-align:center;color:#9ca3af;padding:24px;font-size:13px;">ไม่พบร้านค้า</p>';

        SupervisorUI.renderRouteGrid();
        if (typeof SalesDashboard !== 'undefined') SalesDashboard.initSupervisor?.();
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
            ← ยกเลิกเลือกสาย
        </div>` : '';

        container.innerHTML = backBtn
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
        // ✅ clear stores ใน planCache ทุกเดือน เพื่อให้ปฏิทินใช้ allStores ของสายใหม่
        // (stores=null → CalendarCtrl.render() fallback ไปใช้ State.allStores ซึ่งอัปเดตแล้ว)
        Object.keys(State.planCache).forEach(ym => {
            if (State.planCache[ym]) State.planCache[ym].stores = null;
        });
        SupervisorUI._showDayBar(true);
        SupervisorUI._injectBackBtn(routeId);
        Processor.setupRoute();
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
        btn.innerHTML = `<span style="font-size:14px;">←</span><span style="color:#9ca3af;">เลือกสายใหม่</span><span style="background:${badgeBg};color:${badgeColor};font-size:10px;font-weight:900;padding:2px 10px;border-radius:8px;">${routeId}</span>`;
        splitContainer.parentElement.insertBefore(btn, splitContainer);
    },

    clearRoute: () => {
        SupervisorUI._selectedRoute = null;
        State.allStores  = [];
        State.myRoute    = Auth.getSession()?.username || '';
        State.currentDay = '';
        SupervisorUI._showDayBar(false);
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

// ─── Event listeners ──────────────────────────────────────────────────────
document.getElementById('day-select').addEventListener('change', (e) => {
    State.currentDay  = e.target.value;
    const _m  = getDayMarkets(State.currentDay);
    const _sEl = document.getElementById('stores-title');
    if (_sEl) _sEl.textContent = _m
        ? 'สายวิ่งวันที่ ' + State.currentDay.replace('Day ','') + ' · ' + _m
        : 'รายชื่อร้านค้าทั้งหมด';
    State.mapNeedsFit = true;
    Processor.routeList();
});

window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
document.addEventListener('DOMContentLoaded', () => { App.checkAuth(); Resizer.init(); });

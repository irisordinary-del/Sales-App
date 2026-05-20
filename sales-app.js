// === sales-app.js ===

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
    t.style.opacity = '1';
    setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(80px)'; t.style.opacity = '0'; }, 3000);
}

const firebaseConfig = {
    apiKey: "AIzaSyDCYxJf0eHryjVJ8_INoWw_uTN14UMaEWE",
    authDomain: "route-plan-71e2e.firebaseapp.com",
    projectId: "route-plan-71e2e",
    storageBucket: "route-plan-71e2e.firebasestorage.app",
    messagingSenderId: "486778971661",
    appId: "1:486778971661:web:2ef83fa1eeb09ec6665744"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Enable persistence — รองรับ offline และหลาย tab
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn('[DB] Multiple tabs: persistence limited');
    } else if (err.code === 'unimplemented') {
        console.warn('[DB] Browser does not support persistence');
    }
});

let docMain = db.collection('appData').doc('v1_main');
const colSales = db.collection('v1_sales_chunks');

let State = { myRoute: "", allStores: [], routeStores: [], sales: {}, currentDay: "", isLoaded: false, mapNeedsFit: true, calendarConfig: null, activePlanYM: null, activePlanMode: 'active', viewMode: 'sales', centerId: null, allRoutes: {}, routeList: [] };
let map = null, mapMarkers = [], sortableList = null, markerClusterGroup = null;

// ─── Tab keys ที่ระบบรู้จัก ───────────────────────────────
const VALID_TABS = ['dashboard', 'stores', 'route'];
const DEFAULT_TAB = 'dashboard';
const FORCE_DEFAULT_TAB = true; // เริ่มที่ dashboard เสมอ
const TAB_STORAGE_KEY = `sales_last_tab_${Auth.getSession()?.username || 'guest'}`;

const UI = {
    // ✅ จำ tab ล่าสุดใน localStorage

    // ✅ Hamburger menu
    toggleMenu: () => {
        const overlay = document.getElementById('menu-overlay');
        if (!overlay) return;
        const isOpen = overlay.style.display === 'flex';
        overlay.style.display = isOpen ? 'none' : 'flex';
    },
    closeMenu: () => {
        const overlay = document.getElementById('menu-overlay');
        if (overlay) overlay.style.display = 'none';
    },

    // ✅ Edit order mode
    _editMode: false,
    startEditOrder: () => {
        UI._editMode = true;
        document.getElementById('edit-order-btn').style.display = 'none';
        document.getElementById('confirm-order-btn').style.display = 'block';
        // แสดง drag handles
        document.querySelectorAll('.drag-handle').forEach(h => {
            h.style.opacity = '1';
            h.style.pointerEvents = 'auto';
        });
        // Enable sortable
        if (typeof Sortable !== 'undefined') {
            const c = document.getElementById('route-store-list');
            if (c) {
                if (window._sortableInstance) window._sortableInstance.option('disabled', false);
            }
        }
        showSalesToast('ลากเพื่อสลับลำดับ แล้วกด ✓ ยืนยัน');
    },
    confirmEditOrder: () => {
        UI._editMode = false;
        document.getElementById('edit-order-btn').style.display = 'block';
        document.getElementById('confirm-order-btn').style.display = 'none';
        // ซ่อน drag handles
        document.querySelectorAll('.drag-handle').forEach(h => {
            h.style.opacity = '0';
            h.style.pointerEvents = 'none';
        });
        // Disable sortable
        if (window._sortableInstance) window._sortableInstance.option('disabled', true);
        // Save order + redraw map ครั้งเดียวหลัง confirm
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
        localStorage.setItem(TAB_STORAGE_KEY, id);
        localStorage.setItem('sales_tab_date', new Date().toDateString());

        if (id === 'route') {
            setTimeout(() => {
                if (App.isSupervisor()) {
                    // Supervisor: แสดง grid ถ้ายังไม่ได้เลือกสาย
                    if (!SupervisorUI._selectedRoute) {
                        SupervisorUI.renderRouteGrid();
                    } else {
                        // เลือกสายแล้ว → init map เหมือน Sales
                        if (!map) {
                            MapCtrl.initAndDraw();
                        } else {
                            map.invalidateSize();
                            if (State.mapNeedsFit) MapCtrl.fitBounds();
                        }
                    }
                } else {
                    if (!map) {
                        MapCtrl.initAndDraw();
                    } else {
                        map.invalidateSize();
                        if (State.mapNeedsFit) MapCtrl.fitBounds();
                    }
                }
            }, 200);
        }
    },

    // ✅ restore tab หลัง login / refresh
    restoreTab: () => {
        const today = new Date().toDateString(); // เช่น "Sat May 17 2026"
        const lastDate = localStorage.getItem('sales_tab_date');
        const savedTab = localStorage.getItem(TAB_STORAGE_KEY);

        if (lastDate !== today) {
            // วันใหม่ → เริ่ม dashboard + บันทึกวันนี้
            localStorage.setItem('sales_tab_date', today);
            UI.switchTab(DEFAULT_TAB);
        } else {
            // วันเดิม → เปิด tab ที่ค้างไว้
            UI.switchTab(VALID_TABS.includes(savedTab) ? savedTab : DEFAULT_TAB);
        }
    },

    searchStores: (val) => {
        let q = val.toLowerCase().trim();
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
        // เปิด StoreHistory modal
        if (typeof StoreHistory !== 'undefined') StoreHistory.openFor(id);
        document.getElementById('store-modal').classList.remove('hidden');
    },

    closeModal: () => document.getElementById('store-modal').classList.add('hidden'),

    // ── Sort panel ──
    _sortMode: 'seq',
    toggleSort: () => {
        const p = document.getElementById('sort-panel');
        const btn = document.getElementById('sort-btn');
        const open = p.style.display === 'flex';
        p.style.display = open ? 'none' : 'flex';
        btn.style.background = open ? '#f3f4f6' : '#2563eb';
        btn.style.color      = open ? '#374151' : '#fff';
        btn.style.borderColor = open ? '#e5e7eb' : '#2563eb';
    },
    applySort: (mode) => {
        UI._sortMode = mode;
        document.querySelectorAll('.sort-opt-btn').forEach(b => b.classList.remove('active'));
        const active = document.querySelector(`.sort-opt-btn[onclick="UI.applySort('${mode}')"]`);
        if (active) active.classList.add('active');
        // ปิด sort panel
        const p = document.getElementById('sort-panel');
        const btn = document.getElementById('sort-btn');
        if (p) p.style.display = 'none';
        if (btn) { btn.style.background = '#f3f4f6'; btn.style.color = '#374151'; btn.style.borderColor = '#e5e7eb'; }
        // re-render รายการร้าน
        if (typeof Processor !== 'undefined') Processor.stores();
    }
};

// LoadBar defined in sales.html inline script (loads before this file)

const App = {
    checkAuth: () => {
        Auth.renewSession?.(); // ต่ออายุ session ถ้าใกล้หมด
        const session = Auth.getSession();
        const supervisorRoles = ['admin', 'supervisor', 'route_supervisor', 'asm'];
        if (session && session.role === 'sales') {
            State.myRoute = session.username;
            State.viewMode = 'sales';
            App.start();
        } else if (session && ['route_supervisor','asm'].includes(session.role)) {
            // Supervisor/ASM → เข้า sales.html ได้ เห็นทุกสาย
            State.myRoute = session.username;
            State.viewMode = session.role; // 'route_supervisor' | 'asm'
            State.centerId = session.centerId;
            App.startSupervisor();
        } else if (session && supervisorRoles.includes(session.role)) {
            // admin/supervisor เข้า sales.html → redirect ไป admin
            window.location.replace('index.html');
        } else {
            window.location.replace('login.html');
        }
    },

    // ─── isSupervisor helper ──────────────────────────────────────────────
    isSupervisor: () => ['route_supervisor','asm'].includes(State.viewMode),

    // ─── Start สำหรับ route_supervisor / asm ─────────────────────────────
    startSupervisor: async () => {
        document.getElementById('main-header').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        const _bnav = document.getElementById('bottom-nav');
        if (_bnav) _bnav.style.display = 'grid';

        // แสดง role badge แทน route code
        const session = Auth.getSession();
        const roleLabel = State.viewMode === 'asm' ? '🏢 ASM' : '👁 Sup';
        document.getElementById('user-route-label').innerText = roleLabel + ' · ' + (session?.displayName || session?.username || '');

        // ซ่อน day-select และ edit-order-btn ที่ไม่จำเป็น
        const dayRow = document.getElementById('day-select')?.closest('div');
        if (dayRow) dayRow.style.display = 'none';
        const editBtn = document.getElementById('edit-order-btn');
        if (editBtn) editBtn.style.display = 'none';

        document.getElementById('loader').style.display = 'flex';
        LoadBar.show();
        LoadBar.setProgress(15, 'กำลังโหลดข้อมูลทุกสาย...');

        // หา centerId
        const centerIdRaw = session?.centerId || '';
        const _centerDocId = centerIdRaw ? (centerIdRaw + '_main') : 'v1_main';
        State.centerId = centerIdRaw;

        // โหลด routeList จาก metadata
        try {
            const metaSnap = await db.collection('appData').doc(_centerDocId).get();
            State.routeList = metaSnap.exists ? (metaSnap.data().routeList || []) : [];
        } catch(e) { State.routeList = []; }

        // เช็ค draft เดือนปัจจุบัน
        const _nowYM = (() => { const d = new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`; })();
        let routeColRef;
        try {
            const _draftDoc = await db.collection('appData').doc(_centerDocId).collection('drafts').doc(_nowYM).get();
            routeColRef = _draftDoc.exists
                ? db.collection('appData').doc(_centerDocId).collection('drafts').doc(_nowYM).collection('routes')
                : db.collection('appData').doc(_centerDocId).collection('routes');
            State.activePlanMode = _draftDoc.exists ? 'draft' : 'active';
        } catch(e) {
            routeColRef = db.collection('appData').doc(_centerDocId).collection('routes');
        }

        LoadBar.setProgress(30, 'โหลดข้อมูลร้านทุกสาย...');

        // โหลดทุกสายพร้อมกัน — ลด latency จาก sequential batching
        const routes = State.routeList; // fix: declare routes ก่อนใช้
        State.allRoutes = {};
        State.allStores = [];
        let _loaded = 0;
        await Promise.all(routes.map(async (routeId) => {
            try {
                const rd = await routeColRef.doc(routeId).get();
                State.allRoutes[routeId] = rd.exists ? (rd.data().stores || []) : [];
            } catch(e) { State.allRoutes[routeId] = []; }
            _loaded++;
            LoadBar.setProgress(30 + Math.round(_loaded / routes.length * 40), `โหลด ${_loaded}/${routes.length} สาย...`);
        }));
        // รวมทุกร้านสำหรับ Tab2
        State.allStores = Object.values(State.allRoutes).flat();

        LoadBar.setProgress(75, 'โหลดยอดขาย...');

        // โหลด sellout (ทุกสาย — ไม่กรอง sCode)
        colSales.get().then(snap => {
            let merged = {};
            snap.forEach(doc => { Object.assign(merged, doc.data()); });
            State.sales = merged;
        }).catch(()=>{});

        LoadBar.done();
        document.getElementById('loader').style.display = 'none';

        State.isLoaded = true;
        // init SupervisorUI (Tab2 ร้านค้า + Tab3 grid สาย)
        SupervisorUI.init();
        // search box ใน Tab2 → ใช้ renderAllStores
        const searchEl = document.getElementById('search-input');
        if (searchEl) searchEl.oninput = (e) => {
            const q = e.target.value.toLowerCase().trim();
            document.querySelectorAll('#all-store-list > div[data-search]').forEach(el => {
                el.style.display = (el.getAttribute('data-search')||'').toLowerCase().includes(q) ? 'flex' : 'none';
            });
        };
        UI.switchTab('dashboard');
    },

    logout: () => {
        Auth.logout();
    },

    // โหลด calendarConfig จาก Firestore
    loadCalendarConfig: async (centerDocId, ym, mode) => {
        try {
            let cfgRef;
            if (mode === 'drafts') {
                cfgRef = db.collection('appData').doc(centerDocId)
                    .collection('drafts').doc(ym);
            } else {
                cfgRef = db.collection('appData').doc(centerDocId);
            }
            const snap = await cfgRef.get();
            const data = snap.exists ? snap.data() : {};
            State.calendarConfig = data.calendarConfig || null;
            // re-render calendar ถ้าเปิดอยู่
            if (typeof CalendarCtrl !== 'undefined') CalendarCtrl.render();
        } catch(e) {
            console.warn('loadCalendarConfig:', e);
            State.calendarConfig = null;
        }
    },

    start: async () => {
        // login-screen ถูกซ่อนใน HTML แล้ว
        document.getElementById('main-header').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        // แสดง bottom-nav
        const _bnav = document.getElementById('bottom-nav');
        if (_bnav) _bnav.style.display = 'grid';
        document.getElementById('user-route-label').innerText = State.myRoute;
        document.getElementById('loader').style.display = 'flex';

        // ── Loading bar ──
        LoadBar.show();

        let isMainLoaded = false, isSalesLoaded = false;

        const checkReady = () => {
            // อัปเดต % ตามสิ่งที่โหลดแล้ว
            const pct = (isMainLoaded ? 50 : 0) + (isSalesLoaded ? 50 : 0);
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

                // ✅ restore tab ที่ค้างไว้ (ทั้งตอนโหลดครั้งแรกและหลัง refresh)
                if (!State.isLoaded) {
                    UI.restoreTab();
                    State.isLoaded = true;
                    if (typeof CalendarCtrl !== 'undefined') CalendarCtrl.init();
                    // บังคับเปิดแผนที่ทันที
                    setTimeout(() => MapCtrl.initAndDraw(), 400);
                }
            }
        };

        const _centerMatch = State.myRoute.match(/^(\d+)/);
        const _centerDocId = _centerMatch ? (_centerMatch[1] + '_main') : 'v1_main';
        docMain = db.collection('appData').doc(_centerDocId);

        // ── Auto-switch: เช็ค draft เดือนปัจจุบัน ──────────────────────
        const _nowYM = (() => {
            const d = new Date();
            return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
        })();

        // ตรวจว่ามี draft ของเดือนนี้ไหม → ถ้ามีให้ Sales ใช้ draft แทน active
        let routeColRef;
        try {
            const _draftDoc = await db.collection('appData').doc(_centerDocId)
                .collection('drafts').doc(_nowYM).get();
            if (_draftDoc.exists) {
                // มี draft เดือนนี้ → ใช้ draft
                routeColRef = db.collection('appData').doc(_centerDocId)
                    .collection('drafts').doc(_nowYM).collection('routes');
                State.activePlanYM = _nowYM;
                State.activePlanMode = 'draft';
                App.loadCalendarConfig(_centerDocId, _nowYM, 'drafts');
                LoadBar.setProgress(15, `📅 โหลด Plan ${_nowYM}...`);
            } else {
                // ไม่มี draft → ใช้ active
                routeColRef = db.collection('appData').doc(_centerDocId).collection('routes');
                State.activePlanYM = _nowYM;
                State.activePlanMode = 'active';
                App.loadCalendarConfig(_centerDocId, _nowYM, 'active');
            }
        } catch(e) {
            // fallback → active
            routeColRef = db.collection('appData').doc(_centerDocId).collection('routes');
            State.activePlanMode = 'active';
        }

        LoadBar.setProgress(20, 'กำลังดึงข้อมูลร้านค้า...');

        // ใช้ get() แทน onSnapshot — ไม่เปิด listener ค้างไว้ (ลด WebChannel)
        // onSnapshot เฉพาะ routeColRef เพื่อ real-time update ลำดับวิ่ง
        try {
            const doc = await docMain.get();
            if (!doc.exists) {
                State.allStores = [];
            } else {
                const data = doc.data();
                if (data.routes && data.routes[State.myRoute]) {
                    State.allStores = data.routes[State.myRoute] || [];
                } else {
                    LoadBar.setProgress(35, 'ดึงข้อมูลจาก subcollection...');
                    const rd = await routeColRef.doc(State.myRoute).get();
                    State.allStores = rd.exists ? (rd.data().stores || []) : [];
                }
            }
        } catch(e) { State.allStores = []; }
        isMainLoaded = true; checkReady();

        // onSnapshot เฉพาะ route ของตัวเอง — update real-time เมื่อ Admin แก้ลำดับ
        // เก็บ unsubscribe ไว้เรียกได้ถ้าจำเป็น
        App._unsubRoute = routeColRef.doc(State.myRoute).onSnapshot(rd => {
            if (!rd.exists) return;
            State.allStores = rd.data().stores || [];
            if (State.isLoaded) Processor.run();
        });

        LoadBar.setProgress(30, 'กำลังโหลดข้อมูลยอดขาย...');

        // colSales ใช้ get() แทน onSnapshot — ข้อมูล KPI ไม่ต้อง real-time
        try {
            const snap = await colSales.get();
            let merged = {};
            snap.forEach(doc => { Object.assign(merged, doc.data()); });
            State.sales = merged;
        } catch(e) { State.sales = {}; }
        isSalesLoaded = true; checkReady();
    }
};

// รวบรวมชื่อตลาด (marketName) ของร้านทั้งหมดในวันที่กำหนด
// คืน string เช่น "ตลาดสด · ตลาดนัด" หรือ "" ถ้าไม่มีข้อมูล
function getDayMarkets(day) {
    const names = new Set();
    State.allStores.forEach(s => {
        if (s.days && s.days.includes(day) && s.marketName && s.marketName.trim())
            names.add(s.marketName.trim());
    });
    return Array.from(names).join(' · ');
}

const Processor = {
    // ✅ ลบ dashboard() ออก — run แค่ stores กับ route
    run: () => { Processor.stores(); Processor.setupRoute(); },

    // mini-cal strip removed — ใช้ CalendarCtrl.openPopup() แทน

    stores: () => {
        const hist = (typeof StoreHistory !== 'undefined') ? StoreHistory._storeMap : {};
        const mode = (typeof UI !== 'undefined' && UI._sortMode) ? UI._sortMode : 'seq';

        // เรียงลำดับตาม mode
        let list = [...State.allStores];
        if (mode === 'seq') {
            // เรียงตามลำดับวิ่งของวันที่เลือก ถ้าไม่มีให้อยู่ท้าย
            list.sort((a, b) => (a.seqs?.[State.currentDay] || 9999) - (b.seqs?.[State.currentDay] || 9999));
        } else if (mode === 'name') {
            list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        } else if (mode === 'sales') {
            list.sort((a, b) => ((hist[b.id]?.net || 0) - (hist[a.id]?.net || 0)));
        } else if (mode === 'active') {
            list.sort((a, b) => {
                const aA = (State.sales[a.id]?.vpo > 0) ? 0 : 1;
                const bA = (State.sales[b.id]?.vpo > 0) ? 0 : 1;
                return aA - bA;
            });
        }

        let html = list.map(s => {
            const k      = State.sales[s.id];
            const active = k && k.vpo > 0;
            const h      = hist[s.id];
            const badge  = active
                ? `<span style="background:#d1fae5;color:#065f46;font-size:9px;font-weight:800;padding:2px 8px;border-radius:8px;">Active</span>`
                : `<span style="background:#f3f4f6;color:#9ca3af;font-size:9px;font-weight:800;padding:2px 8px;border-radius:8px;">Inactive</span>`;
            const mktTag = s.marketName
                ? `<span style="font-size:10px;color:#3b82f6;font-weight:600;">${s.marketName}</span> `
                : '';
            const histTag = h
                ? `<div style="margin-top:3px;font-size:10px;color:#059669;font-weight:700;">💰 ${_fmtB(h.net)} · ${h.skuCount} SKU · ${h.invCount} บิล</div>`
                : '';
            return `<div onclick="UI.openModal('${s.id}')"
                data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()} ${(s.marketName||'').toLowerCase()}"
                style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:11px 14px;display:flex;justify-content:space-between;align-items:flex-start;cursor:pointer;active:background:#f9fafb;">
                <div style="flex:1;min-width:0;margin-right:10px;">
                    <div style="font-weight:800;font-size:13px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                    <div style="font-size:10px;color:#9ca3af;font-family:monospace;margin-top:1px;">${mktTag}${s.id}</div>
                    ${histTag}
                </div>
                <div style="flex-shrink:0;">${badge}</div>
            </div>`;
        }).join('');
        document.getElementById('all-store-list').innerHTML = html
            || '<p style="text-align:center;color:#9ca3af;margin-top:24px;font-size:13px;">ไม่พบข้อมูลร้านในสายนี้</p>';
    },

    setupRoute: () => {
        let ds = new Set();
        State.allStores.forEach(s => s.days.forEach(d => ds.add(d)));
        let sorted = Array.from(ds).sort((a, b) => parseInt(a.replace('Day ', '')) - parseInt(b.replace('Day ', '')));
        let el = document.getElementById('day-select');
        el.innerHTML = sorted.map(d => {
            const markets = getDayMarkets(d);
            const label = 'Day ' + d.replace('Day ', '');
            return `<option value="${d}">${label}</option>`;
        }).join('');

        if (!State.currentDay) {
            State.currentDay = sorted[0];
            State.mapNeedsFit = true;
        }
        el.value = State.currentDay;


        // อัปเดตหัว tab-stores
        const _stM = getDayMarkets(State.currentDay);
        const _stEl = document.getElementById('stores-title');
        if (_stEl) _stEl.textContent = _stM ? 'Day ' + State.currentDay.replace('Day ','') + ' · ' + _stM : 'รายชื่อร้านค้าทั้งหมด';
        Processor.routeList();
    },

    routeList: () => {
        let list = State.allStores.filter(s => s.days.includes(State.currentDay));
        list.sort((a, b) => (a.seqs?.[State.currentDay] || 999) - (b.seqs?.[State.currentDay] || 999));

        let html = list.map((s, i) => {
            let seq = s.seqs?.[State.currentDay] || i + 1;
            let navLink = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;
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

        let c = document.getElementById('route-store-list');
        c.innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่มีคิวงาน</p>';
        const _markets = getDayMarkets(State.currentDay);
        const _dayNum  = State.currentDay.replace('Day ', '');
        const _mkt     = _markets ? ' · ' + _markets.split(' · ')[0] : '';
        document.getElementById('route-title').innerText = `Day ${_dayNum}${_mkt} (${list.length} ร้าน)`;

        if (sortableList) sortableList.destroy();
        sortableList = Sortable.create(c, {
            handle: '.drag-handle',
            animation: 150,
            forceFallback: false,   // ใช้ native drag บน desktop, touch event บน mobile
            touchStartThreshold: 3, // threshold เล็กๆ กันกด popup โดยไม่ตั้งใจ drag
            disabled: true,         // disabled ตอนแรก ต้องกด Edit ก่อน
            // onChange: ลบออก — ไม่ redraw map ทุก pixel ที่ลาก (ทำให้กระตุก)
            onEnd: () => {
                // อัปเดตเลขใน badge อย่างเดียว ไม่ redraw map ระหว่าง drag
                Processor._updateSeqBadgesOnly();
            }
        });
        window._sortableInstance = sortableList;
        // ซ่อน drag handles เริ่มต้น
        setTimeout(() => {
            document.querySelectorAll('.drag-handle').forEach(h => {
                h.style.opacity = '0';
                h.style.pointerEvents = 'none';
            });
        }, 100);

        MapCtrl.drawMap();
    },

    // อัปเดตเลข badge + sync State — ไม่ redraw map (เรียกตอน drag จบ)
    _updateSeqBadgesOnly: () => {
        document.querySelectorAll('#route-store-list > .store-item').forEach((item, index) => {
            const badge = item.querySelector('[data-seq]');
            if (badge) badge.textContent = index + 1;
            const id = item.getAttribute('data-id');
            const target = State.allStores.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
    },

    // อัปเดตเลข badge + sync State + redraw map (เรียกหลัง confirm order)
    _updateSeqBadges: () => {
        Processor._updateSeqBadgesOnly();
        MapCtrl.drawMap();
    },

    // เรียกตอนกด "ยืนยัน" เท่านั้น — บันทึกลำดับจริงลง Firestore
    handleDrag: () => {
        // Supervisor ใช้ SupervisorUI.handleDrag แทน
        if (App.isSupervisor()) { SupervisorUI.handleDrag(); return; }
        let items = document.querySelectorAll('#route-store-list > .store-item'), updated = [...State.allStores];
        items.forEach((item, index) => {
            let id = item.getAttribute('data-id'), target = updated.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
        const _centerMatch = State.myRoute.match(/^(\d+)/);
        const _centerDocId = _centerMatch ? (_centerMatch[1] + '_main') : 'v1_main';
        // ใช้ path ที่ถูกต้องตาม planMode ที่โหลดมา (draft หรือ active)
        let _writeRef;
        if (State.activePlanMode === 'draft' && State.activePlanYM) {
            _writeRef = db.collection('appData').doc(_centerDocId)
                .collection('drafts').doc(State.activePlanYM)
                .collection('routes').doc(State.myRoute);
        } else {
            _writeRef = db.collection('appData').doc(_centerDocId)
                .collection('routes').doc(State.myRoute);
        }
        _writeRef.set({ stores: updated });
    }
};

// ==========================================
// 📍 GPS Realtime Location Tracking
// ==========================================
const GPS = {
    watchId: null,
    marker: null,
    circle: null,
    autoFollow: false,
    _mapListenerAttached: false,
    _isSelfMoving: false,

    start: async () => {
        if (!navigator.geolocation) return showSalesToast('⚠️ Browser ไม่รองรับ GPS', true);
        GPS.watchId = navigator.geolocation.watchPosition(GPS._onSuccess, GPS._onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
        GPS.autoFollow = true;
        GPS._updateBtn('on');
        showSalesToast('📍 เปิด GPS แล้ว');
        GPS._attachMapListener();
    },

    stop: () => {
        if (GPS.watchId !== null) { navigator.geolocation.clearWatch(GPS.watchId); GPS.watchId = null; }
        if (GPS.marker) { GPS.marker.remove(); GPS.marker = null; }
        if (GPS.circle) { GPS.circle.remove(); GPS.circle = null; }
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
        if (GPS.marker) {
            GPS._isSelfMoving = true;
            map.setView(GPS.marker.getLatLng(), 16);
            GPS._isSelfMoving = false;
        }
    },

    _onSuccess: (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        if (!map) return;
        const latlng = L.latLng(lat, lng);
        const icon = L.divIcon({
            html: `<div style="width:18px;height:18px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 3px rgba(59,130,246,0.4),0 2px 8px rgba(0,0,0,0.3);"></div>`,
            iconSize: [18, 18], iconAnchor: [9, 9], className: ''
        });
        if (!GPS.marker) {
            GPS.marker = L.marker(latlng, { icon, zIndexOffset: 9999 }).addTo(map).bindPopup('<b>📍 ตำแหน่งของฉัน</b><br><small>แม่นยำ ~' + Math.round(accuracy) + 'm</small>');
        } else {
            GPS.marker.setLatLng(latlng);
            GPS.marker.getPopup().setContent('<b>📍 ตำแหน่งของฉัน</b><br><small>แม่นยำ ~' + Math.round(accuracy) + 'm</small>');
        }
        if (!GPS.circle) {
            GPS.circle = L.circle(latlng, { radius: accuracy, color: '#3b82f6', fillOpacity: 0.08, weight: 1 }).addTo(map);
        } else {
            GPS.circle.setLatLng(latlng); GPS.circle.setRadius(accuracy);
        }
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
        if (state === 'on') {
            btn.innerHTML = '📍 GPS เปิดอยู่';
            btn.style.background = '#2563eb';
        } else if (state === 'paused') {
            btn.innerHTML = '📍 กลับมาติดตาม';
            btn.style.background = '#d97706';
        } else {
            btn.innerHTML = '📍 ดูตำแหน่งฉัน';
            btn.style.background = '#374151';
        }
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
    }
};

// ==========================================
// 📅 Calendar Controller
// ==========================================
const CalendarCtrl = {
    _year: null,
    _month: null,

    init: () => {
        const now = new Date();
        CalendarCtrl._year  = now.getFullYear();
        CalendarCtrl._month = now.getMonth(); // 0-based
        CalendarCtrl.render();
    },

    // คำนวณว่าวันที่ date ตรงกับ Day อะไร
    getDayLabel: (dateNum) => {
        const cfg = State.calendarConfig;
        if (!cfg) return null;

        if (cfg.mode === 'fixed') {
            // โหมด B: admin กำหนดเองว่าวันที่เท่าไหร่ = Day อะไร
            return cfg.mapping ? (cfg.mapping[String(dateNum)] || null) : null;
        }

        if (cfg.mode === 'cycle') {
            // โหมด A: คำนวณจาก startDay + holidays
            const startDate  = parseInt(cfg.startDay || 1);
            const holidays   = cfg.holidays || [];
            const year  = CalendarCtrl._year;
            const month = CalendarCtrl._month;

            // หาจำนวนวันทำงาน (ไม่ใช่วันหยุด) ตั้งแต่ startDate ถึง dateNum
            if (dateNum < startDate) return null;
            let dayCounter = parseInt(cfg.startDayNum || 1); // Day ที่ startDate เริ่ม
            let workdays = 0;
            for (let d = startDate; d <= dateNum; d++) {
                if (holidays.includes(d)) continue; // ข้ามวันหยุด
                workdays++;
                if (d === dateNum) {
                    const dayNum = dayCounter + workdays - 1;
                    const cycleDays = cfg.cycleDays || 24;
                    if (dayNum > cycleDays) return null;
                    return 'Day ' + dayNum;
                }
            }
        }
        return null;
    },

    // หาวันที่จาก Day label → เพื่อกดปฏิทินแล้ว navigate ไปคิวงาน
    getDateFromDay: (dayLabel) => {
        const cfg = State.calendarConfig;
        if (!cfg) return null;

        if (cfg.mode === 'fixed') {
            if (!cfg.mapping) return null;
            const entry = Object.entries(cfg.mapping).find(([, v]) => v === dayLabel);
            return entry ? parseInt(entry[0]) : null;
        }

        if (cfg.mode === 'cycle') {
            const startDate   = parseInt(cfg.startDay || 1);
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
        const firstDow    = new Date(year, month, 1).getDay(); // 0=Sun
        const cfg = State.calendarConfig;

        // Header
        const monthLabel = new Date(year, month, 1)
            .toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
        const headerEl = document.getElementById('calendar-month-label');
        if (headerEl) headerEl.textContent = monthLabel;

        // Mode badge
        const modeEl = document.getElementById('calendar-mode-badge');
        if (modeEl) {
            if (!cfg) {
                modeEl.textContent = '⚠️ ยังไม่ได้ตั้งค่าปฏิทิน';
                modeEl.style.background = '#fef3c7';
                modeEl.style.color = '#92400e';
            } else if (cfg.mode === 'cycle') {
                modeEl.textContent = '🔄 Cycle D1-' + (cfg.cycleDays || 24);
                modeEl.style.background = '#ede9fe';
                modeEl.style.color = '#5b21b6';
            } else {
                modeEl.textContent = '📌 กำหนดวันที่เอง';
                modeEl.style.background = '#dbeafe';
                modeEl.style.color = '#1e40af';
            }
        }

        // Grid cells
        const DOW = ['อา','จ','อ','พ','พฤ','ศ','ส'];
        let html = DOW.map(d =>
            `<div style="text-align:center;font-size:10px;font-weight:800;color:#9ca3af;padding:4px 0;">${d}</div>`
        ).join('');

        // empty cells before first day (Sun=0)
        const startOffset = firstDow; // อาทิตย์ = 0
        for (let i = 0; i < startOffset; i++) {
            html += `<div></div>`;
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const dayLabel = cfg ? CalendarCtrl.getDayLabel(d) : null;
            const isToday  = (d === now.getDate() && month === now.getMonth() && year === now.getFullYear());
            const dow      = new Date(year, month, d).getDay();
            const isWeekend = dow === 0 || dow === 6;
            const isHoliday = cfg?.holidays?.includes(d);

            let bgColor = '#fff';
            let textColor = '#111827';
            let borderColor = '#f3f4f6';

            if (isToday) { bgColor = '#2563eb'; textColor = '#fff'; borderColor = '#2563eb'; }
            else if (isHoliday) { bgColor = '#fef2f2'; textColor = '#dc2626'; borderColor = '#fecaca'; }
            else if (isWeekend) { bgColor = '#f9fafb'; textColor = '#6b7280'; }

            const hasRoute = dayLabel && State.allStores.some(s => s.days && s.days.includes(dayLabel));
            const clickHandler = dayLabel ? `CalendarCtrl.goToDay('${dayLabel}')` : '';

            html += `
            <div onclick="${clickHandler}"
                style="border-radius:10px;border:1px solid ${borderColor};background:${bgColor};
                       padding:4px 2px;text-align:center;cursor:${dayLabel ? 'pointer' : 'default'};
                       min-height:52px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
                       gap:2px;transition:opacity 0.1s;${dayLabel ? 'active:opacity:0.7;' : ''}">
                <div style="font-size:12px;font-weight:${isToday ? '900' : '700'};color:${textColor};line-height:1.2;">${d}</div>
                ${dayLabel ? `
                <div style="font-size:9px;font-weight:800;padding:1px 5px;border-radius:5px;
                            background:${isToday ? 'rgba(255,255,255,0.25)' : '#ede9fe'};
                            color:${isToday ? '#fff' : '#5b21b6'};white-space:nowrap;">
                    ${dayLabel.replace('Day ','')}
                </div>
                ${hasRoute ? `<div style="width:5px;height:5px;border-radius:50%;background:${isToday ? '#fff' : '#2563eb'};margin-top:1px;"></div>` : ''}
                ` : (isHoliday ? `<div style="font-size:9px;color:#dc2626;">หยุด</div>` : '')}
            </div>`;
        }

        container.innerHTML = html;
    },

    // กดวันในปฏิทิน → navigate ไปหน้าคิวงาน
    goToDay: (dayLabel) => {
        // set currentDay แล้วไปหน้า route
        State.currentDay = dayLabel;
        // re-render route list
        const el = document.getElementById('day-select');
        if (el) el.value = dayLabel;
        Processor.routeList();
        UI.switchTab('route');
        showSalesToast('📅 ' + dayLabel);
    },

    prevMonth: () => {
        CalendarCtrl._month--;
        if (CalendarCtrl._month < 0) { CalendarCtrl._month = 11; CalendarCtrl._year--; }
        CalendarCtrl.render();
    },

    nextMonth: () => {
        CalendarCtrl._month++;
        if (CalendarCtrl._month > 11) { CalendarCtrl._month = 0; CalendarCtrl._year++; }
        CalendarCtrl.render();
    },

    openPopup: () => {
        const popup = document.getElementById('calendar-popup');
        const sheet = document.getElementById('calendar-popup-sheet');
        if (!popup || !sheet) return;
        // sync เดือนปัจจุบัน
        const now = new Date();
        CalendarCtrl._year  = now.getFullYear();
        CalendarCtrl._month = now.getMonth();
        CalendarCtrl.render();
        popup.style.display = 'block';
        requestAnimationFrame(() => {
            sheet.style.transform = 'translateY(0)';
        });
    },

    closePopup: (e) => {
        // ปิดเมื่อกด overlay หรือเรียกตรง
        const sheet = document.getElementById('calendar-popup-sheet');
        const popup = document.getElementById('calendar-popup');
        if (e && sheet && sheet.contains(e.target)) return; // กดใน sheet ไม่ปิด
        if (sheet) sheet.style.transform = 'translateY(100%)';
        setTimeout(() => { if (popup) popup.style.display = 'none'; }, 300);
    },

    // override goToDay ให้ปิด popup ก่อน navigate
    goToDay: (dayLabel) => {
        CalendarCtrl.closePopup();
        setTimeout(() => {
            State.currentDay = dayLabel;
            const el = document.getElementById('day-select');
            if (el) el.value = dayLabel;
            Processor.routeList();
            UI.switchTab('route');
            showSalesToast('📅 ' + dayLabel);
        }, 320);
    }
};

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
        if (markerClusterGroup) { map.removeLayer(markerClusterGroup); }
        mapMarkers = [];

        // สร้าง layer group ธรรมดา — แสดงหมุดทุกตัวแยกกัน ไม่รวมกลุ่ม
        markerClusterGroup = L.layerGroup();

        const list = State.allStores.filter(s => s.days.includes(State.currentDay));
        list.sort((a, b) => (a.seqs?.[State.currentDay] || 999) - (b.seqs?.[State.currentDay] || 999));

        list.forEach((s, i) => {
            const seq = s.seqs?.[State.currentDay] || i + 1;
            const icon = L.divIcon({
                html: `<svg viewBox="0 0 24 24" width="30" height="40" style="filter:drop-shadow(0px 2px 3px rgba(0,0,0,0.3));overflow:visible;"><path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cx="12" cy="9" r="7" fill="#fff"/><text x="12" y="13" font-size="10" font-weight="900" fill="#000" text-anchor="middle">${seq}</text></svg>`,
                className: '', iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -40]
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

    fitBounds: () => { if (mapMarkers.length && map) map.fitBounds(new L.featureGroup(mapMarkers).getBounds(), { padding: [30, 30] }); },
    forceFitBounds: () => { State.mapNeedsFit = true; MapCtrl.drawMap(); },

    _currentBearing: 0,

    _initRotateUI: () => {
        if (document.getElementById('rotate-ui')) return;
        const mapEl = document.getElementById('map');
        if (!mapEl) return;
        mapEl.style.position = 'relative';

        // Compass widget
        const ui = document.createElement('div');
        ui.id = 'rotate-ui';
        ui.style.cssText = 'position:absolute;top:10px;right:10px;z-index:999;display:flex;flex-direction:column;align-items:center;gap:6px;';
        ui.innerHTML = `
            <!-- Compass needle -->
            <div id="compass-ring" onclick="MapCtrl.resetBearing()"
                style="width:44px;height:44px;border-radius:50%;background:rgba(31,41,55,0.92);border:2px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.4);">
                <svg id="compass-svg" width="28" height="28" viewBox="0 0 28 28">
                    <polygon points="14,3 17,14 14,12 11,14" fill="#ef4444"/>
                    <polygon points="14,25 17,14 14,16 11,14" fill="#e5e7eb"/>
                    <circle cx="14" cy="14" r="2" fill="white"/>
                </svg>
            </div>
            <!-- หมุนซ้าย/ขวา -->
            <button onclick="MapCtrl.rotateDelta(-45)"
                style="width:36px;height:36px;border-radius:50%;background:rgba(31,41,55,0.92);border:2px solid rgba(255,255,255,0.1);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);">↺</button>
            <button onclick="MapCtrl.rotateDelta(45)"
                style="width:36px;height:36px;border-radius:50%;background:rgba(31,41,55,0.92);border:2px solid rgba(255,255,255,0.1);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);">↻</button>
        `;
        mapEl.appendChild(ui);

        // Pinch-rotate gesture (two-finger)
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
                startAngle  = getAngle(t1, t2);
                startBearing = MapCtrl._currentBearing;
                e.preventDefault();
            }
        }, { passive: false });
        mapEl.addEventListener('touchmove', e => {
            if (e.touches.length === 2 && t1 && t2) {
                const cur = getAngle(e.touches[0], e.touches[1]);
                const delta = cur - startAngle;
                MapCtrl.setBearing(startBearing + delta);
                e.preventDefault();
            }
        }, { passive: false });
        mapEl.addEventListener('touchend', () => { t1 = null; t2 = null; });
    },

    rotateDelta: (deg) => { MapCtrl.setBearing(MapCtrl._currentBearing + deg); },

    resetBearing: () => { MapCtrl.setBearing(0); },

    setBearing: (deg) => {
        if (!map) return;
        MapCtrl._currentBearing = ((deg % 360) + 360) % 360;
        map.setBearing(MapCtrl._currentBearing);
        // หมุน compass needle ย้อนทาง
        const svg = document.getElementById('compass-svg');
        if (svg) svg.style.transform = `rotate(${-MapCtrl._currentBearing}deg)`;
    },

    addGpsButton: () => {
        if (document.getElementById('gps-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'gps-btn';
        btn.innerHTML = '📍 ดูตำแหน่งฉัน';
        btn.style.cssText = 'position:absolute;bottom:80px;right:10px;z-index:999;background:#374151;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:background 0.2s;';
        btn.onclick = GPS.locate;
        const mapEl = document.getElementById('map');
        if (mapEl) { mapEl.style.position = 'relative'; mapEl.appendChild(btn); }
    }
};

// 🌟 Resizable split panel
const Resizer = {
    init: () => {
        const resizer = document.getElementById('resizer');
        const mapContainer = document.getElementById('map-container');
        let isResizing = false;

        resizer.addEventListener('pointerdown', (e) => {
            isResizing = true;
            document.body.style.cursor = window.innerWidth >= 1024 ? 'col-resize' : 'row-resize';
            mapContainer.style.pointerEvents = 'none';
            e.preventDefault();
        });

        window.addEventListener('pointermove', (e) => {
            if (!isResizing) return;
            const container = document.getElementById('split-container');
            const rect = container.getBoundingClientRect();
            if (window.innerWidth >= 1024) {
                let newWidth = ((e.clientX - rect.left) / rect.width) * 100;
                newWidth = Math.max(25, Math.min(newWidth, 75));
                mapContainer.style.flex = `0 0 ${newWidth}%`;
            } else {
                let newHeight = ((e.clientY - rect.top) / rect.height) * 100;
                newHeight = Math.max(25, Math.min(newHeight, 75));
                mapContainer.style.flex = `0 0 ${newHeight}%`;
            }
            if (map) map.invalidateSize();
        });

        window.addEventListener('pointerup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                mapContainer.style.pointerEvents = '';
            }
        });
    }
};

// ==========================================
// 👁 SupervisorUI — Route Supervisor / ASM
// Tab2: ร้านค้าทุกสายรวม (หน้าตาเหมือน Sales + badge)
// Tab3: Grid card เลือกสาย → คิวงาน + แผนที่ (เหมือน Sales ทุกอย่าง)
// ==========================================
const SupervisorUI = {

    _selectedRoute: null,  // สายที่เลือกใน Tab3

    init: () => {
        // Tab3 nav label → "สายวิ่ง"
        const navRoute = document.getElementById('nav-route');
        if (navRoute) {
            const icon = navRoute.querySelector('.bnav-icon');
            const lbl  = navRoute.querySelector('span:not(.bnav-icon)');
            if (icon) icon.textContent = '🗺️';
            if (lbl)  lbl.textContent  = 'สายวิ่ง';
        }

        // Tab2: render ร้านค้าทุกสายรวม
        SupervisorUI.renderAllStores();

        // Tab3: render grid เลือกสาย
        SupervisorUI.renderRouteGrid();
    },

    // ─── Tab2: ร้านค้าทุกสาย (หน้าตาเหมือน Sales) ────────────────────────
    renderAllStores: () => {
        const hist = (typeof StoreHistory !== 'undefined') ? StoreHistory._storeMap : {};
        const mode = UI._sortMode || 'seq';

        // รวมร้านทุกสาย พร้อม _route tag
        let list = [];
        State.routeList.forEach(routeId => {
            (State.allRoutes[routeId] || []).forEach(s => {
                list.push({ ...s, _route: routeId });
            });
        });

        // sort
        if (mode === 'name') {
            list.sort((a,b) => a.name.localeCompare(b.name,'th'));
        } else if (mode === 'sales') {
            list.sort((a,b) => ((hist[b.id]?.net||0) - (hist[a.id]?.net||0)));
        } else if (mode === 'active') {
            list.sort((a,b) => {
                const aA = (State.sales[a.id]?.vpo > 0) ? 0 : 1;
                const bA = (State.sales[b.id]?.vpo > 0) ? 0 : 1;
                return aA - bA || a._route.localeCompare(b._route,'th',{numeric:true});
            });
        } else {
            // default: เรียงตามสาย
            list.sort((a,b) => a._route.localeCompare(b._route,'th',{numeric:true}));
        }

        const html = list.map(s => {
            const k      = State.sales[s.id];
            const active = k && k.vpo > 0;
            const h      = hist[s.id];
            const badge  = active
                ? `<span style="background:#d1fae5;color:#065f46;font-size:9px;font-weight:800;padding:2px 8px;border-radius:8px;">Active</span>`
                : `<span style="background:#f3f4f6;color:#9ca3af;font-size:9px;font-weight:800;padding:2px 8px;border-radius:8px;">Inactive</span>`;
            // badge สาย (ซ่อนสำหรับ role=sales)
            const isC = /C\d/.test(s._route);
            const routeColor = isC ? '#7c3aed' : '#2563eb';
            const routeBg    = isC ? '#ede9fe'  : '#dbeafe';
            const routeBadge = `<span style="background:${routeBg};color:${routeColor};font-size:9px;font-weight:800;padding:2px 7px;border-radius:8px;margin-left:4px;">${s._route}</span>`;
            const mktTag = s.marketName
                ? `<span style="font-size:10px;color:#3b82f6;font-weight:600;">${s.marketName}</span> `
                : '';
            const histTag = h
                ? `<div style="margin-top:3px;font-size:10px;color:#059669;font-weight:700;">💰 ${_fmtB(h.net)} · ${h.skuCount} SKU · ${h.invCount} บิล</div>`
                : '';
            return `
            <div onclick="UI.openModal('${s.id}')"
                data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()} ${s._route.toLowerCase()} ${(s.marketName||'').toLowerCase()}"
                style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:11px 14px;
                       display:flex;justify-content:space-between;align-items:flex-start;cursor:pointer;">
                <div style="flex:1;min-width:0;margin-right:10px;">
                    <div style="font-weight:800;font-size:13px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                    <div style="font-size:10px;color:#9ca3af;font-family:monospace;margin-top:1px;">${mktTag}${s.id}${routeBadge}</div>
                    ${histTag}
                </div>
                <div style="flex-shrink:0;">${badge}</div>
            </div>`;
        }).join('');

        const container = document.getElementById('all-store-list');
        if (container) container.innerHTML = html || '<p style="text-align:center;color:#9ca3af;margin-top:24px;font-size:13px;">ไม่พบร้านค้า</p>';
    },

    // ─── Tab3: Grid card เลือกสาย ─────────────────────────────────────────
    renderRouteGrid: () => {
        const container = document.getElementById('route-store-list');
        if (!container) return;

        // ซ่อน day-select bar ตอนอยู่ที่ grid
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

        // wrapper กับปุ่ม back (ถ้าเลือกสายแล้ว)
        const backBtn = SupervisorUI._selectedRoute ? `
        <div onclick="SupervisorUI.clearRoute()"
            style="display:flex;align-items:center;gap:8px;padding:9px 14px;background:#f1f5f9;
                   border-radius:12px;cursor:pointer;margin-bottom:12px;font-weight:700;font-size:12px;color:#374151;">
            ← ยกเลิกเลือกสาย
        </div>` : '';

        container.innerHTML = backBtn +
            renderGroup('💳 Credit (C)', '#7c3aed', '#ede9fe', cRoutes) +
            renderGroup('🚐 Van (V)',    '#2563eb', '#dbeafe', vRoutes) +
            renderGroup('📦 อื่นๆ',      '#374151', '#f3f4f6', otherRoutes);
    },

    // ─── เลือกสาย → แสดงคิวงาน + แผนที่ ──────────────────────────────────
    selectRoute: (routeId) => {
        SupervisorUI._selectedRoute = routeId;
        State.allStores   = State.allRoutes[routeId] || [];
        State.myRoute     = routeId;
        State.currentDay  = '';
        State.mapNeedsFit = true;

        // แสดง day-select bar + edit btn
        SupervisorUI._showDayBar(true);

        // inject ปุ่ม "← เลือกสายใหม่" ถ้ายังไม่มี
        SupervisorUI._injectBackBtn(routeId);

        // setup day dropdown เหมือน Sales
        Processor.setupRoute();

        // switch ไปหน้าคิวงานทันที
        UI.switchTab('route');
    },

    _injectBackBtn: (routeId) => {
        // ลบปุ่มเก่าก่อน (กรณีเปลี่ยนสาย)
        const old = document.getElementById('sup-back-btn');
        if (old) old.remove();

        const splitContainer = document.getElementById('split-container');
        if (!splitContainer) return;
        const btn = document.createElement('div');
        btn.id = 'sup-back-btn';
        btn.onclick = SupervisorUI.clearRoute;
        btn.style.cssText = [
            'display:flex', 'align-items:center', 'gap:8px',
            'padding:8px 14px', 'background:#f8fafc',
            'border-bottom:1px solid #e5e7eb', 'cursor:pointer',
            'font-weight:700', 'font-size:12px', 'color:#374151',
            'flex-shrink:0', 'z-index:30',
        ].join(';');
        const isC = /C\d/.test(routeId);
        const badgeColor = isC ? '#7c3aed' : '#2563eb';
        const badgeBg    = isC ? '#ede9fe'  : '#dbeafe';
        btn.innerHTML = `
            <span style="font-size:14px;">←</span>
            <span style="color:#9ca3af;">เลือกสายใหม่</span>
            <span style="background:${badgeBg};color:${badgeColor};font-size:10px;font-weight:900;
                         padding:2px 10px;border-radius:8px;">${routeId}</span>`;
        // แทรกก่อน split-container
        splitContainer.parentElement.insertBefore(btn, splitContainer);
    },

    clearRoute: () => {
        SupervisorUI._selectedRoute = null;
        State.allStores   = [];
        State.myRoute     = Auth.getSession()?.username || '';
        State.currentDay  = '';

        // ซ่อน day-select bar + ลบปุ่ม back
        SupervisorUI._showDayBar(false);
        const backBtn = document.getElementById('sup-back-btn');
        if (backBtn) backBtn.remove();

        // clear route list + map markers
        const c = document.getElementById('route-store-list');
        if (c) c.innerHTML = '';
        if (typeof mapMarkers !== 'undefined') {
            mapMarkers.forEach(m => { try { m.remove(); } catch(e){} });
            mapMarkers = [];
        }

        // กลับมาหน้า Tab3 พร้อม grid
        UI.switchTab('route');
    },

    _showDayBar: (show) => {
        // แถบ day-select + ปุ่มปฏิทิน
        const dayBar = document.getElementById('day-select')?.closest('div[style*="border-bottom"]');
        if (dayBar) dayBar.style.display = show ? 'flex' : 'none';
        const editBtn = document.getElementById('edit-order-btn');
        if (editBtn) editBtn.style.display = show ? 'block' : 'none';
        const confBtn = document.getElementById('confirm-order-btn');
        if (confBtn) confBtn.style.display = 'none';
    },

    // handleDrag สำหรับ Supervisor — save ลง Firestore เหมือน Sales
    handleDrag: () => {
        const routeId = SupervisorUI._selectedRoute;
        if (!routeId) return;
        let items   = document.querySelectorAll('#route-store-list > .store-item');
        let updated = [...State.allStores];
        items.forEach((item, index) => {
            const id     = item.getAttribute('data-id');
            const target = updated.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
        State.allRoutes[routeId] = updated;
        const centerMatch  = routeId.match(/^(\d+)/);
        const centerDocId  = centerMatch ? (centerMatch[1] + '_main') : 'v1_main';
        // ใช้ path ตาม planMode (draft หรือ active)
        let _writeRef;
        if (State.activePlanMode === 'draft' && State.activePlanYM) {
            _writeRef = db.collection('appData').doc(centerDocId)
                .collection('drafts').doc(State.activePlanYM)
                .collection('routes').doc(routeId);
        } else {
            _writeRef = db.collection('appData').doc(centerDocId)
                .collection('routes').doc(routeId);
        }
        _writeRef.set({ stores: updated })
            .then(() => showSalesToast('✅ บันทึกลำดับเรียบร้อย'))
            .catch(e => showSalesToast('❌ บันทึกไม่สำเร็จ: ' + e.message, true));
    },
};

document.getElementById('day-select').addEventListener('change', (e) => {
    State.currentDay = e.target.value;
    const _m = getDayMarkets(State.currentDay);
    const _sEl = document.getElementById('stores-title');
    if (_sEl) _sEl.textContent = _m ? 'สายวิ่งวันที่ ' + State.currentDay.replace('Day ','') + ' · ' + _m : 'รายชื่อร้านค้าทั้งหมด';
    State.mapNeedsFit = true;
    Processor.routeList();
});

window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
document.addEventListener('DOMContentLoaded', () => { App.checkAuth(); Resizer.init(); });

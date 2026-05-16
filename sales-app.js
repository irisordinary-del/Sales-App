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

db.enablePersistence({ synchronizeTabs: true }).catch(function(err) { console.warn("Cache Warning: ", err); });

let docMain = db.collection('appData').doc('v1_main');
const colSales = db.collection('v1_sales_chunks');

let State = { myRoute: "", allStores: [], routeStores: [], sales: {}, currentDay: "", isLoaded: false, mapNeedsFit: true, calendarConfig: null, activePlanYM: null, activePlanMode: 'active' };
let map = null, mapMarkers = [], sortableList = null, markerClusterGroup = null;

// ─── Tab keys ที่ระบบรู้จัก ───────────────────────────────
const VALID_TABS = ['dashboard', 'stores', 'route', 'calendar'];
const DEFAULT_TAB = 'dashboard';
const FORCE_DEFAULT_TAB = true; // เริ่มที่ dashboard เสมอ
const TAB_STORAGE_KEY = 'sales_last_tab';

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
        // Save order (trigger handleDrag)
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
                if (!map) {
                    MapCtrl.initAndDraw(); // บังคับเปิดแผนที่ทันที
                } else {
                    map.invalidateSize();
                    if (State.mapNeedsFit) MapCtrl.fitBounds();
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
        document.querySelectorAll('#all-store-list > div').forEach(el => {
            el.style.display = el.getAttribute('data-search').toLowerCase().includes(q) ? 'flex' : 'none';
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
        // ถ้า session มีอยู่และเป็น sales → เข้าได้เลย
        const session = Auth.getSession();
        if (session && session.role === 'sales') {
            State.myRoute = session.username;
            App.start();
        } else if (session && (session.role === 'admin' || session.role === 'supervisor')) {
            // admin/supervisor เข้า sales.html → redirect ไป admin
            window.location.replace('index.html');
        } else {
            // ไม่มี session → ไป login
            window.location.replace('login.html');
        }
    },

    login: async () => {
        // login.html จัดการให้แล้ว — ฟังก์ชันนี้ไม่ถูกเรียกอีกต่อไป
        window.location.replace('login.html');
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
        docMain.onSnapshot(async doc => {
            if (!doc.exists) { State.allStores = []; isMainLoaded = true; checkReady(); return; }
            const data = doc.data();
            if (data.routes && data.routes[State.myRoute]) {
                State.allStores = data.routes[State.myRoute] || [];
                isMainLoaded = true; checkReady();
            } else {
                LoadBar.setProgress(35, 'ดึงข้อมูลจาก subcollection...');
                try {
                    const rd = await routeColRef.doc(State.myRoute).get();
                    State.allStores = rd.exists ? (rd.data().stores || []) : [];
                } catch (e) { State.allStores = []; }
                isMainLoaded = true; checkReady();
            }
        });

        routeColRef.doc(State.myRoute).onSnapshot(rd => {
            if (!rd.exists) return;
            State.allStores = rd.data().stores || [];
            if (isMainLoaded) Processor.run();
        });

        LoadBar.setProgress(30, 'กำลังโหลดข้อมูลยอดขาย...');
        colSales.onSnapshot(snap => {
            let merged = {};
            snap.forEach(doc => { Object.assign(merged, doc.data()); });
            State.sales = merged;
            isSalesLoaded = true; checkReady();
        });
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

    renderMiniCal: (daysSorted) => {
        const strip = document.getElementById('mini-cal-strip');
        if (!strip) return;
        const cfg = State.calendarConfig;

        // หาวันที่ของแต่ละ Day จาก calendarConfig
        const now = new Date();
        const todayDate = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
        const dayNames = ['อา','จ','อ','พ','พฤ','ศ','ส'];

        // สร้าง map date → dayLabel
        const dateToDay = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const lbl = CalendarCtrl.getDayLabel(d);
            if (lbl) dateToDay[d] = lbl;
        }

        // แสดง 7 วัน: 3 วันก่อนวันนี้ถึง 3 วันหลัง
        let html = '';
        for (let offset = -3; offset <= 3; offset++) {
            const dateNum = todayDate + offset;
            if (dateNum < 1 || dateNum > daysInMonth) {
                html += `<div style="flex-shrink:0;width:38px;"></div>`;
                continue;
            }
            const dow = new Date(now.getFullYear(), now.getMonth(), dateNum).getDay();
            const dayLabel = dateToDay[dateNum];
            const isToday = offset === 0;
            const isSelected = dayLabel && dayLabel === State.currentDay;
            const isCurrent = isToday || isSelected;

            html += `<div onclick="${dayLabel ? `Processor.selectDayFromCal('${dayLabel}')` : ''}"
                style="flex-shrink:0;width:40px;border-radius:10px;padding:4px 2px;text-align:center;
                       background:${isSelected ? '#2563eb' : isToday ? '#eff6ff' : '#f9fafb'};
                       border:1px solid ${isSelected ? '#2563eb' : isToday ? '#bfdbfe' : '#e5e7eb'};
                       cursor:${dayLabel ? 'pointer' : 'default'};transition:all 0.15s;">
                <div style="font-size:9px;font-weight:700;color:${isSelected ? '#bfdbfe' : '#9ca3af'};">${dayNames[dow]}</div>
                <div style="font-size:13px;font-weight:900;color:${isSelected ? '#fff' : isToday ? '#2563eb' : '#374151'};line-height:1.3;">${dateNum}</div>
                ${dayLabel ? `<div style="font-size:9px;font-weight:800;color:${isSelected ? '#fff' : '#6d28d9'};background:${isSelected ? 'rgba(255,255,255,0.2)' : '#ede9fe'};border-radius:4px;padding:1px 3px;margin-top:2px;">${dayLabel.replace('Day','')}</div>` : '<div style="height:16px;"></div>'}
            </div>`;
        }
        strip.innerHTML = html;
    },

    selectDayFromCal: (dayLabel) => {
        State.currentDay = dayLabel;
        const el = document.getElementById('day-select');
        if (el) el.value = dayLabel;
        Processor.routeList();
    },

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
            // แสดงแค่ตลาดอันแรก ป้องกันยาวเกิน
            const mktFirst = markets ? markets.split(' · ')[0] : '';
            const label = 'Day ' + d.replace('Day ', '') + (mktFirst ? '  · ' + mktFirst : '');
            return `<option value="${d}">${label}</option>`;
        }).join('');

        if (!State.currentDay) {
            State.currentDay = sorted[0];
            State.mapNeedsFit = true;
        }
        el.value = State.currentDay;

        // today badge
        const todayBadge = document.getElementById('today-badge');
        if (todayBadge) {
            const now = new Date();
            const dayNames = ['อา','จ','อ','พ','พฤ','ศ','ส'];
            const monthNames = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
            todayBadge.textContent = `${dayNames[now.getDay()]} ${now.getDate()} ${monthNames[now.getMonth()]}`;
        }

        // mini calendar strip — แสดง 7 วัน (3 ก่อน วันนี้ 3 หลัง)
        Processor.renderMiniCal(sorted);

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
        // แสดงแค่ตลาดอันแรก ไม่เอาซ้ำทั้งหมด
        const _mktFirst = _markets ? _markets.split(' · ')[0] : '';
        const _marketStr = _mktFirst ? ' · ' + _mktFirst : '';
        document.getElementById('route-title').innerText = `Day ${_dayNum}${_marketStr} (${list.length} ร้าน)`;

        if (sortableList) sortableList.destroy();
        window._sortableInstance = Sortable.create(c, {
            handle: '.drag-handle',
            animation: 150,
            disabled: true,    // disabled ตอนแรก ต้องกด Edit ก่อน
            onChange: Processor._updateSeqBadges,  // อัปเดตเลขทันทีทุกครั้งที่การ์ดเปลี่ยนตำแหน่ง
            onEnd: Processor._updateSeqBadges      // อัปเดตอีกครั้งตอนวางเสร็จ (safety net)
        });
        // ซ่อน drag handles เริ่มต้น
        setTimeout(() => {
            document.querySelectorAll('.drag-handle').forEach(h => {
                h.style.opacity = '0';
                h.style.pointerEvents = 'none';
            });
        }, 100);

        MapCtrl.drawMap();
    },

    // อัปเดตตัวเลขใน badge (รายการ) และ marker บนแผนที่ — ไม่ save Firestore
    _updateSeqBadges: () => {
        // 1) อัปเดตตัวเลขในรายการ
        document.querySelectorAll('#route-store-list > .store-item').forEach((item, index) => {
            const badge = item.querySelector('[data-seq]');
            if (badge) badge.textContent = index + 1;
        });
        // 2) sync seq ลง State แล้ว redraw marker บนแผนที่
        const items = document.querySelectorAll('#route-store-list > .store-item');
        items.forEach((item, index) => {
            const id = item.getAttribute('data-id');
            const target = State.allStores.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
        MapCtrl.drawMap();
    },

    // เรียกตอนกด "ยืนยัน" เท่านั้น — บันทึกลำดับจริงลง Firestore
    handleDrag: () => {
        let items = document.querySelectorAll('#route-store-list > .store-item'), updated = [...State.allStores];
        items.forEach((item, index) => {
            let id = item.getAttribute('data-id'), target = updated.find(s => s.id === id);
            if (target) { if (!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
        const _centerMatch = State.myRoute.match(/^(\d+)/);
        const _centerDocId = _centerMatch ? (_centerMatch[1] + '_main') : 'v1_main';
        db.collection('appData').doc(_centerDocId).collection('routes').doc(State.myRoute).set({ stores: updated });
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

        // ลบ layer เดิม
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

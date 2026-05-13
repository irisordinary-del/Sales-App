// === sales-app.js ===

// ✅ Inline toast
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

let State = { myRoute: "", allStores: [], routeStores: [], sales: {}, currentDay: "", isLoaded: false, mapNeedsFit: true };
let map = null, mapMarkers = [], sortableList = null;

// ─── Tab keys ที่ระบบรู้จัก ───────────────────────────────
const VALID_TABS = ['stores', 'route'];
const DEFAULT_TAB = 'route';
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

        if (id === 'route' && map) {
            setTimeout(() => { map.invalidateSize(); if (State.mapNeedsFit) MapCtrl.fitBounds(); }, 200);
        }
    },

    // ✅ restore tab หลัง login / refresh
    restoreTab: () => {
        const saved = localStorage.getItem(TAB_STORAGE_KEY);
        UI.switchTab(VALID_TABS.includes(saved) ? saved : DEFAULT_TAB);
    },

    searchStores: (val) => {
        let q = val.toLowerCase().trim();
        document.querySelectorAll('#all-store-list > div').forEach(el => {
            el.style.display = el.getAttribute('data-search').toLowerCase().includes(q) ? 'flex' : 'none';
        });
    },

    openModal: (id) => {
        let s = State.allStores.find(x => x.id === id);
        let k = State.sales[id] || { vpo: 0, billCount: 0, skuCount: 0, hasJelly: false, hasKlom: false };
        document.getElementById('m-name').innerText = s.name;
        document.getElementById('m-id').innerText = "ID: " + s.id;
        document.getElementById('m-sales').innerText = k.vpo;
        document.getElementById('m-bills').innerText = k.billCount;
        document.getElementById('m-vpo').innerText = k.billCount ? (k.vpo / k.billCount).toFixed(1) : 0;
        document.getElementById('m-sku').innerText = k.skuCount;

        const setBox = (boxId, statusId, active) => {
            let b = document.getElementById(boxId);
            let s = document.getElementById(statusId);
            if (active) { b.className = "flex justify-between items-center p-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold"; s.innerText = "✅ ซื้อแล้ว"; }
            else { b.className = "flex justify-between items-center p-2 rounded-lg border border-red-100 bg-red-50 text-red-400 text-xs font-bold"; s.innerText = "❌ ยังไม่ซื้อ"; }
        };
        setBox('m-j-box', 'm-j-status', k.hasJelly);
        setBox('m-k-box', 'm-k-status', k.hasKlom);
        document.getElementById('m-nav-btn').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`);
        document.getElementById('store-modal').classList.remove('hidden');
    },

    closeModal: () => document.getElementById('store-modal').classList.add('hidden')
};

const App = {
    checkAuth: () => {
        let saved = localStorage.getItem('route_code');
        if (saved) { State.myRoute = saved; App.start(); }
        else document.getElementById('login-screen').style.display = 'flex';
    },

    login: async () => {
        let u = document.getElementById('login-input').value.trim().toUpperCase();
        if (!u) return showSalesToast('กรุณาระบุรหัสสาย', true);

        // ✅ เช็ค DB ก่อน login
        const loginBtn = document.querySelector('#login-screen button');
        if (loginBtn) { loginBtn.disabled = true; loginBtn.innerText = 'กำลังตรวจสอบ...'; }
        try {
            const centerMatch = u.match(/^(\d+)/);
            const centerDocId = centerMatch ? (centerMatch[1] + '_main') : 'v1_main';
            const routeDoc = await db.collection('appData').doc(centerDocId).collection('routes').doc(u).get();
            if (!routeDoc.exists) {
                showSalesToast('⚠️ ไม่พบรหัสสาย "' + u + '" ในฐานข้อมูล', true);
                if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = 'เข้าสู่ระบบ 🚀'; }
                return;
            }
        } catch(e) {
            showSalesToast('⚠️ ตรวจสอบไม่ได้: ' + e.message, true);
            if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = 'เข้าสู่ระบบ 🚀'; }
            return;
        }

        State.myRoute = u;
        localStorage.setItem('route_code', u);
        localStorage.removeItem(TAB_STORAGE_KEY);
        App.start();
    },

    logout: () => { localStorage.clear(); window.location.reload(); },

    start: () => {
        document.getElementById('login-screen').style.display = 'none';
        // ✅ แสดง hamburger button
        const hBtn = document.getElementById('hamburger-btn');
        if (hBtn) hBtn.style.display = 'flex';
        document.getElementById('main-header').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        // bottom-nav ถูกแทนด้วย hamburger-btn แล้ว (ไม่ต้องแสดง nav เดิม)
        document.getElementById('user-route-label').innerText = State.myRoute;
        document.getElementById('loader').style.display = 'flex';

        let isMainLoaded = false, isSalesLoaded = false;

        const checkReady = () => {
            if (isMainLoaded && isSalesLoaded) {
                document.getElementById('loader').style.display = 'none';
                Processor.run();

                // ✅ restore tab ที่ค้างไว้ (ทั้งตอนโหลดครั้งแรกและหลัง refresh)
                if (!State.isLoaded) {
                    UI.restoreTab();
                    State.isLoaded = true;
                }
            }
        };

        const _centerMatch = State.myRoute.match(/^(\d+)/);
        const _centerDocId = _centerMatch ? (_centerMatch[1] + '_main') : 'v1_main';
        docMain = db.collection('appData').doc(_centerDocId);
        const routeColRef = db.collection('appData').doc(_centerDocId).collection('routes');

        docMain.onSnapshot(async doc => {
            if (!doc.exists) { State.allStores = []; isMainLoaded = true; checkReady(); return; }
            const data = doc.data();
            if (data.routes && data.routes[State.myRoute]) {
                State.allStores = data.routes[State.myRoute] || [];
                isMainLoaded = true; checkReady();
            } else {
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

    stores: () => {
        let html = State.allStores.map(s => {
            let k = State.sales[s.id];
            let badge = k && k.vpo > 0
                ? `<span class="bg-emerald-100 text-emerald-700 text-[9px] px-2 py-0.5 rounded-lg font-bold">Active</span>`
                : `<span class="bg-gray-100 text-gray-400 text-[9px] px-2 py-0.5 rounded-lg font-bold">Inactive</span>`;
            const marketTag = s.marketName ? `<p class="text-[10px] text-blue-500 font-medium truncate">${s.marketName}</p>` : '';
            return `<div onclick="UI.openModal('${s.id}')" data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()} ${(s.marketName||'').toLowerCase()}" class="bg-white p-3.5 rounded-2xl border shadow-sm flex justify-between items-center transition cursor-pointer active:bg-gray-50"><div class="overflow-hidden mr-2"><p class="font-bold text-sm text-gray-800 truncate">${s.name}</p><p class="text-[10px] text-gray-400 font-mono">ID: ${s.id}</p>${marketTag}</div>${badge}</div>`;
        }).join('');
        document.getElementById('all-store-list').innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่พบข้อมูลร้านในสายนี้</p>';
    },

    setupRoute: () => {
        let ds = new Set();
        State.allStores.forEach(s => s.days.forEach(d => ds.add(d)));
        let sorted = Array.from(ds).sort((a, b) => parseInt(a.replace('Day ', '')) - parseInt(b.replace('Day ', '')));
        let el = document.getElementById('day-select');
        el.innerHTML = sorted.map(d => {
            const markets = getDayMarkets(d);
            const label = 'สายวิ่งวันที่ ' + d.replace('Day ', '') + (markets ? '  ' + markets : '');
            return `<option value="${d}">${label}</option>`;
        }).join('');

        if (!State.currentDay) {
            State.currentDay = sorted[0];
            State.mapNeedsFit = true;
        }
        el.value = State.currentDay;
        // อัปเดตหัว tab-stores ให้แสดงชื่อตลาดของวันที่เลือก
        const _stM = getDayMarkets(State.currentDay);
        const _stEl = document.getElementById('stores-title');
        if (_stEl) _stEl.textContent = _stM ? 'สายวิ่งวันที่ ' + State.currentDay.replace('Day ','') + ' · ' + _stM : 'รายชื่อร้านค้าทั้งหมด';
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
        const _title   = 'สายวิ่งวันที่ ' + _dayNum + (_markets ? ' · ' + _markets : '');
        document.getElementById('route-title').innerText = `${_title} (${list.length} ร้าน)`;

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
        docMain.collection('routes').doc(State.myRoute).set({ stores: updated });
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

    start: () => {
        if (!navigator.geolocation) return showSalesToast('⚠️ Browser ไม่รองรับ GPS', true);
        GPS.watchId = navigator.geolocation.watchPosition(GPS._onSuccess, GPS._onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
        GPS.autoFollow = true;
        GPS._updateBtn(true);
        showSalesToast('📍 เปิด GPS แล้ว');
    },

    stop: () => {
        if (GPS.watchId !== null) { navigator.geolocation.clearWatch(GPS.watchId); GPS.watchId = null; }
        if (GPS.marker) { GPS.marker.remove(); GPS.marker = null; }
        if (GPS.circle) { GPS.circle.remove(); GPS.circle = null; }
        GPS.autoFollow = false;
        GPS._updateBtn(false);
        showSalesToast('GPS ปิดแล้ว');
    },

    toggle: () => { GPS.watchId !== null ? GPS.stop() : GPS.start(); },

    locate: () => {
        if (GPS.watchId === null) GPS.start();
        GPS.autoFollow = true;
        if (GPS.marker) map.setView(GPS.marker.getLatLng(), 16);
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
        if (GPS.autoFollow) { map.setView(latlng, map.getZoom() < 14 ? 15 : map.getZoom()); }
    },

    _onError: (err) => {
        const msgs = { 1: 'ไม่ได้รับอนุญาตใช้ GPS', 2: 'หาตำแหน่งไม่ได้', 3: 'GPS หมดเวลา' };
        showSalesToast('⚠️ ' + (msgs[err.code] || 'GPS error'), true);
        GPS._updateBtn(false);
    },

    _updateBtn: (active) => {
        const btn = document.getElementById('gps-btn');
        if (!btn) return;
        btn.innerHTML = active ? '📍 GPS เปิดอยู่' : '📍 ดูตำแหน่งฉัน';
        btn.style.background = active ? '#2563eb' : '#374151';
    }
};

const MapCtrl = {
    initAndDraw: () => {
        document.getElementById('btn-load-map').classList.add('hidden');
        document.getElementById('map').classList.remove('hidden');
        document.getElementById('btn-fit-map').classList.remove('hidden');
        if (!map) {
            map = L.map('map', { zoomControl: false }).setView([14.4745, 100.1222], 10);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        }
        setTimeout(() => { map.invalidateSize(); MapCtrl.drawMap(); MapCtrl.addGpsButton(); }, 200);
    },

    drawMap: () => {
        if (!map) return;
        mapMarkers.forEach(m => map.removeLayer(m)); mapMarkers = [];
        let list = State.allStores.filter(s => s.days.includes(State.currentDay));
        list.forEach((s, i) => {
            let seq = s.seqs?.[State.currentDay] || i + 1;
            let icon = L.divIcon({
                html: `<svg viewBox="0 0 24 24" width="30" height="40" style="filter:drop-shadow(0px 2px 3px rgba(0,0,0,0.3));overflow:visible;"><path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cx="12" cy="9" r="7" fill="#fff"/><text x="12" y="13" font-size="10" font-weight="900" fill="#000" text-anchor="middle">${seq}</text></svg>`,
                className: '', iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -40]
            });
            let m = L.marker([s.lat, s.lng], { icon }).addTo(map).bindPopup(
                `<div class="text-center pb-1"><b class="text-xs">${s.name}</b><br><button onclick="UI.openModal('${s.id}')" class="bg-gray-100 text-gray-700 px-3 py-1 rounded border mt-1 text-[10px] font-bold shadow-sm">ดูข้อมูล</button></div>`,
                { closeButton: false }
            );
            mapMarkers.push(m);
        });
        if (State.mapNeedsFit) { MapCtrl.fitBounds(); State.mapNeedsFit = false; }
    },

    fitBounds: () => { if (mapMarkers.length && map) map.fitBounds(new L.featureGroup(mapMarkers).getBounds(), { padding: [30, 30] }); },
    forceFitBounds: () => { State.mapNeedsFit = true; MapCtrl.drawMap(); },

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

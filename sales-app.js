const firebaseConfig = { apiKey: "AIzaSyDCYxJf0eHryjVJ8_INoWw_uTN14UMaEWE", authDomain: "route-plan-71e2e.firebaseapp.com", projectId: "route-plan-71e2e", storageBucket: "route-plan-71e2e.firebasestorage.app", messagingSenderId: "486778971661", appId: "1:486778971661:web:2ef83fa1eeb09ec6665744" };
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 🚀 เทคนิค 1: Cache โหลดไว ไม่รอเน็ต
db.enablePersistence({ synchronizeTabs: true }).catch(function(err) { console.warn("Cache Warning: ", err); });

const docMain = db.collection('appData').doc('v1_main');
const docSales = db.collection('appData').doc('v1_sales');

let State = { myRoute: "", allStores: [], routeStores: [], sales: {}, currentDay: "", isLoaded: false };
let map = null, mapMarkers = [], sortableList = null;

const UI = {
    switchTab: (id) => {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.getElementById('nav-' + id).classList.add('active');
        document.querySelectorAll('.app-tab').forEach(el => el.classList.remove('active'));
        document.getElementById('tab-' + id).classList.add('active');
        if(id === 'route' && map) { setTimeout(() => { map.invalidateSize(); MapCtrl.fitBounds(); }, 200); }
    },
    searchStores: (val) => {
        let q = val.toLowerCase().trim();
        document.querySelectorAll('#all-store-list > div').forEach(el => {
            el.style.display = el.getAttribute('data-search').toLowerCase().includes(q) ? 'flex' : 'none';
        });
    },
    openModal: (id) => {
        let s = State.allStores.find(x => x.id === id);
        let k = State.sales[id] || { vpo:0, billCount:0, skuCount:0, hasJelly:false, hasKlom:false };
        document.getElementById('m-name').innerText = s.name;
        document.getElementById('m-id').innerText = "ID: " + s.id;
        document.getElementById('m-sales').innerText = k.vpo;
        document.getElementById('m-bills').innerText = k.billCount;
        document.getElementById('m-vpo').innerText = k.billCount ? (k.vpo/k.billCount).toFixed(1) : 0;
        document.getElementById('m-sku').innerText = k.skuCount;

        const setBox = (boxId, statusId, active) => {
            let b = document.getElementById(boxId);
            let s = document.getElementById(statusId);
            if(active) { b.className = "flex justify-between items-center p-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold"; s.innerText = "✅ ซื้อแล้ว"; }
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
    checkAuth: () => { let saved = localStorage.getItem('route_code'); if(saved) { State.myRoute = saved; App.start(); } else document.getElementById('login-screen').style.display='flex'; },
    login: () => { let u = document.getElementById('login-input').value.trim().toUpperCase(); if(!u) return alert("กรุณาระบุรหัสสาย"); State.myRoute = u; localStorage.setItem('route_code', u); App.start(); },
    logout: () => { localStorage.clear(); window.location.reload(); },
    start: () => {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-header').classList.remove('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.remove('hidden');
        document.getElementById('user-route-label').innerText = State.myRoute;
        document.getElementById('loader').style.display = 'flex';

        // 🚀 เทคนิค 3: โหลดข้อมูลขนานกัน (Parallel Fetching)
        let isMainLoaded = false, isSalesLoaded = false;
        const checkReady = () => { if(isMainLoaded && isSalesLoaded) { document.getElementById('loader').style.display = 'none'; Processor.run(); } };

        docMain.onSnapshot(doc => { State.allStores = doc.exists && doc.data().routes ? doc.data().routes[State.myRoute] || [] : []; isMainLoaded = true; checkReady(); });
        docSales.onSnapshot(sDoc => { State.sales = sDoc.exists ? sDoc.data() : {}; isSalesLoaded = true; checkReady(); });
    }
};

const Processor = {
    run: () => { Processor.dashboard(); Processor.stores(); Processor.setupRoute(); },
    dashboard: () => {
        let totalS = 0, totalB = 0, totalSKU = 0, activeC = 0, jC = 0, kC = 0;
        State.allStores.forEach(s => { let k = State.sales[s.id]; if(k && k.vpo > 0) { activeC++; totalS += k.vpo; totalB += k.billCount || 0; totalSKU += k.skuCount || 0; if(k.hasJelly) jC++; if(k.hasKlom) kC++; } });
        document.getElementById('dash-sales').innerText = Math.round(totalS).toLocaleString(); document.getElementById('dash-vpo').innerText = totalB ? (totalS / totalB).toFixed(1) : 0; document.getElementById('dash-sku').innerText = activeC ? (totalSKU / activeC).toFixed(1) : 0; document.getElementById('dash-active').innerText = activeC; document.getElementById('dash-dist-jelly').innerText = activeC ? Math.round((jC/activeC)*100)+"%" : "0%"; document.getElementById('cnt-jelly').innerText = jC; document.getElementById('dash-dist-klom').innerText = activeC ? Math.round((kC/activeC)*100)+"%" : "0%"; document.getElementById('cnt-klom').innerText = kC;
    },
    stores: () => {
        let html = State.allStores.map(s => {
            let k = State.sales[s.id]; let badge = k && k.vpo > 0 ? `<span class="bg-emerald-100 text-emerald-700 text-[9px] px-2 py-0.5 rounded-lg font-bold">Active</span>` : `<span class="bg-gray-100 text-gray-400 text-[9px] px-2 py-0.5 rounded-lg font-bold">Inactive</span>`;
            return `<div onclick="UI.openModal('${s.id}')" data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()}" class="bg-white p-3.5 rounded-2xl border shadow-sm flex justify-between items-center transition cursor-pointer active:bg-gray-50"><div class="overflow-hidden mr-2"><p class="font-bold text-sm text-gray-800 truncate">${s.name}</p><p class="text-[10px] text-gray-400 font-mono">ID: ${s.id}</p></div>${badge}</div>`;
        }).join('');
        document.getElementById('all-store-list').innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่พบข้อมูลร้านในสายนี้</p>';
    },
    setupRoute: () => {
        let ds = new Set(); State.allStores.forEach(s => s.days.forEach(d => ds.add(d)));
        let sorted = Array.from(ds).sort((a,b) => parseInt(a.replace('Day ','')) - parseInt(b.replace('Day ','')));
        let el = document.getElementById('day-select'); el.innerHTML = sorted.map(d => `<option value="${d}">${d.replace('Day ','คิววันที่ ')}</option>`).join('');
        if(!State.currentDay) State.currentDay = sorted[0]; el.value = State.currentDay; Processor.routeList();
    },
    routeList: () => {
        let list = State.allStores.filter(s => s.days.includes(State.currentDay));
        list.sort((a,b) => (a.seqs?.[State.currentDay] || 999) - (b.seqs?.[State.currentDay] || 999));
        
        let html = list.map((s, i) => {
            let seq = s.seqs?.[State.currentDay] || i+1; let navLink = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;
            return `
            <div data-id="${s.id}" class="store-item bg-white p-2.5 rounded-xl border shadow-sm flex items-center gap-2 relative mb-2.5">
                <div class="drag-handle text-gray-300 px-1 cursor-grab active:cursor-grabbing">≡</div>
                <div class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-sm">${seq}</div>
                <div class="flex-1 font-bold text-sm text-gray-800 leading-tight cursor-pointer truncate" onclick="UI.openModal('${s.id}')">${s.name}</div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button onclick="UI.openModal('${s.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-1.5 rounded-lg font-bold text-[10px] border border-blue-100 transition active:scale-95">📊 KPI</button>
                    <a href="${navLink}" target="_blank" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2 py-1.5 rounded-lg font-bold text-[10px] text-center border border-emerald-100 transition active:scale-95">🚗 นำทาง</a>
                </div>
            </div>`;
        }).join('');
        
        let c = document.getElementById('route-store-list'); c.innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่มีคิวงาน</p>';
        document.getElementById('route-title').innerText = `คิวงาน (${list.length} ร้าน)`;
        if(sortableList) sortableList.destroy();
        sortableList = Sortable.create(c, { handle: '.drag-handle', animation: 250, onEnd: Processor.handleDrag });
        MapCtrl.drawMap();
    },
    handleDrag: () => {
        let items = document.querySelectorAll('#route-store-list > .store-item'), updated = [...State.allStores];
        items.forEach((item, index) => { let id = item.getAttribute('data-id'), target = updated.find(s => s.id === id); if(target) { if(!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; } });
        docMain.update({ [`routes.${State.myRoute}`]: updated });
    }
};

const MapCtrl = {
    initAndDraw: () => {
        document.getElementById('btn-load-map').classList.add('hidden'); document.getElementById('map').classList.remove('hidden'); document.getElementById('btn-fit-map').classList.remove('hidden');
        if(!map) { map = L.map('map', { zoomControl: false }).setView([14.4745, 100.1222], 10); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map); }
        setTimeout(() => { map.invalidateSize(); MapCtrl.drawMap(); }, 200);
    },
    drawMap: () => {
        if(!map) return;
        mapMarkers.forEach(m => map.removeLayer(m)); mapMarkers = [];
        let list = State.allStores.filter(s => s.days.includes(State.currentDay));
        list.forEach((s, i) => {
            let seq = s.seqs?.[State.currentDay] || i+1;
            let icon = L.divIcon({ html: `<svg viewBox="0 0 24 24" width="30" height="40" style="filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.3)); overflow:visible;"><path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cx="12" cy="9" r="7" fill="#fff"/><text x="12" y="13" font-size="10" font-weight="900" fill="#000" text-anchor="middle">${seq}</text></svg>`, className: '', iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -40] });
            let m = L.marker([s.lat, s.lng], { icon }).addTo(map).bindPopup(`<div class="text-center pb-1"><b class="text-xs">${s.name}</b><br><button onclick="UI.openModal('${s.id}')" class="bg-gray-100 text-gray-700 px-3 py-1 rounded border mt-1 text-[10px] font-bold shadow-sm">ดูข้อมูล</button></div>`, { closeButton: false });
            mapMarkers.push(m);
        });
        MapCtrl.fitBounds();
    },
    fitBounds: () => { if(mapMarkers.length && map) map.fitBounds(new L.featureGroup(mapMarkers).getBounds(), { padding: [30, 30] }); }
};

// 🌟 ระบบลากปรับขนาด (Drag to Resize)
const Resizer = {
    init: () => {
        const resizer = document.getElementById('resizer');
        const mapContainer = document.getElementById('map-container');
        let isResizing = false;

        resizer.addEventListener('pointerdown', (e) => {
            isResizing = true;
            document.body.style.cursor = window.innerWidth >= 1024 ? 'col-resize' : 'row-resize';
            mapContainer.style.pointerEvents = 'none'; // ปิดการกดโดนแผนที่ตอนลาก
        });

        document.addEventListener('pointermove', (e) => {
            if (!isResizing) return;
            const container = document.getElementById('split-container');
            const rect = container.getBoundingClientRect();
            
            if (window.innerWidth >= 1024) {
                // จอคอม: ลากซ้าย-ขวา
                let newWidth = ((e.clientX - rect.left) / rect.width) * 100;
                newWidth = Math.max(20, Math.min(newWidth, 75)); // แผนที่หดได้สุด 20% ขยายสุด 75%
                mapContainer.style.flex = `0 0 ${newWidth}%`;
            } else {
                // มือถือ: ลากขึ้น-ลง
                let newHeight = ((e.clientY - rect.top) / rect.height) * 100;
                newHeight = Math.max(15, Math.min(newHeight, 85)); // แผนที่หดได้สุด 15% ขยายสุด 85%
                mapContainer.style.flex = `0 0 ${newHeight}%`;
            }
            if(map) map.invalidateSize();
        });

        document.addEventListener('pointerup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                mapContainer.style.pointerEvents = '';
            }
        });
    }
};

document.getElementById('day-select').addEventListener('change', (e) => { State.currentDay = e.target.value; Processor.routeList(); });
window.addEventListener('resize', () => { if(map) map.invalidateSize(); });
document.addEventListener('DOMContentLoaded', () => { App.checkAuth(); Resizer.init(); });

// sales-app.js

// 1. ตั้งค่า Firebase
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

// 🚀 เทคนิคที่ 1: เปิดระบบ Cache (Offline Persistence)
// ช่วยให้แอปโหลดข้อมูลจากหน่วยความจำเครื่องมือถือทันทีที่เปิดแอปครั้งที่สอง ไม่ต้องรอเน็ต!
db.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
    console.warn("ไม่สามารถเปิดใช้งานโหมด Cache ได้ (อาจจะใช้หน้าต่างไม่ระบุตัวตนอยู่): ", err);
});

const docMain = db.collection('appData').doc('v1_main');
const docSales = db.collection('appData').doc('v1_sales');

// 2. ตัวแปรเก็บข้อมูล (State)
let State = { myRoute: "", allStores: [], routeStores: [], sales: {}, currentDay: "", isLoaded: false };
let map = null, mapMarkers = [], sortableList = null;

// 3. ระบบควบคุมหน้าจอ (UI)
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
        document.getElementById('store-modal').classList.remove('hidden');
    },
    closeModal: () => document.getElementById('store-modal').classList.add('hidden')
};

// 4. ระบบจัดการบัญชี (App)
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

        docMain.onSnapshot(doc => {
            State.allStores = doc.exists && doc.data().routes ? doc.data().routes[State.myRoute] || [] : [];
            docSales.onSnapshot(sDoc => {
                State.sales = sDoc.exists ? sDoc.data() : {};
                document.getElementById('loader').style.display = 'none';
                Processor.run();
            });
        });
    }
};

// 5. ระบบคำนวณและสร้างเนื้อหา (Processor)
const Processor = {
    run: () => {
        Processor.dashboard();
        Processor.stores();
        Processor.setupRoute();
    },
    dashboard: () => {
        let totalS = 0, totalB = 0, totalSKU = 0, activeC = 0, jC = 0, kC = 0;
        State.allStores.forEach(s => {
            let k = State.sales[s.id];
            if(k && k.vpo > 0) {
                activeC++; totalS += k.vpo; totalB += k.billCount || 0; totalSKU += k.skuCount || 0;
                if(k.hasJelly) jC++; if(k.hasKlom) kC++;
            }
        });
        document.getElementById('dash-sales').innerText = Math.round(totalS).toLocaleString();
        document.getElementById('dash-vpo').innerText = totalB ? (totalS / totalB).toFixed(1) : 0;
        document.getElementById('dash-sku').innerText = activeC ? (totalSKU / activeC).toFixed(1) : 0;
        document.getElementById('dash-active').innerText = activeC;
        document.getElementById('dash-dist-jelly').innerText = activeC ? Math.round((jC/activeC)*100)+"%" : "0%";
        document.getElementById('cnt-jelly').innerText = jC;
        document.getElementById('dash-dist-klom').innerText = activeC ? Math.round((kC/activeC)*100)+"%" : "0%";
        document.getElementById('cnt-klom').innerText = kC;
    },
    stores: () => {
        let html = State.allStores.map(s => {
            let k = State.sales[s.id];
            let badge = k && k.vpo > 0 ? `<span class="bg-emerald-100 text-emerald-700 text-[9px] px-2 py-0.5 rounded-full font-bold">Active</span>` : `<span class="bg-gray-100 text-gray-400 text-[9px] px-2 py-0.5 rounded-full font-bold">Inactive</span>`;
            return `<div onclick="UI.openModal('${s.id}')" data-search="${s.id.toLowerCase()} ${s.name.toLowerCase()}" class="bg-white p-3.5 rounded-2xl border shadow-sm flex justify-between items-center transition cursor-pointer active:bg-gray-50">
                <div class="overflow-hidden mr-2"><p class="font-bold text-[13px] text-gray-800 truncate">${s.name}</p><p class="text-[10px] text-gray-400 font-mono">ID: ${s.id}</p></div>
                ${badge}
            </div>`;
        }).join('');
        document.getElementById('all-store-list').innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่พบข้อมูลร้านในสายนี้</p>';
    },
    setupRoute: () => {
        let ds = new Set(); State.allStores.forEach(s => s.days.forEach(d => ds.add(d)));
        let sorted = Array.from(ds).sort((a,b) => parseInt(a.replace('Day ','')) - parseInt(b.replace('Day ','')));
        let el = document.getElementById('day-select');
        el.innerHTML = sorted.map(d => `<option value="${d}">${d.replace('Day ','คิววันที่ ')}</option>`).join('');
        if(!State.currentDay) State.currentDay = sorted[0];
        el.value = State.currentDay;
        Processor.routeList();
    },
    routeList: () => {
        let list = State.allStores.filter(s => s.days.includes(State.currentDay));
        list.sort((a,b) => (a.seqs?.[State.currentDay] || 999) - (b.seqs?.[State.currentDay] || 999));
        
        let html = list.map((s, i) => {
            let seq = s.seqs?.[State.currentDay] || i+1;
            let navLink = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;
            return `
            <div data-id="${s.id}" class="store-item bg-white p-2 rounded-xl border shadow-sm flex items-center justify-between gap-2 relative mb-2">
                <div class="flex items-center gap-2 overflow-hidden w-full">
                    <div class="drag-handle text-gray-300 px-1 cursor-grab active:cursor-grabbing">≡</div>
                    <div class="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-[11px] shrink-0">${seq}</div>
                    <div class="font-bold text-sm text-gray-800 leading-tight cursor-pointer truncate" onclick="UI.openModal('${s.id}')">${s.name}</div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button onclick="UI.openModal('${s.id}')" class="bg-blue-50 text-blue-600 px-2 py-1.5 rounded-lg text-[10px] font-bold border border-blue-100 active:scale-95 transition">📊 KPI</button>
                    <a href="${navLink}" target="_blank" class="bg-emerald-50 text-emerald-600 px-2 py-1.5 rounded-lg text-[10px] font-bold border border-emerald-100 active:scale-95 transition">🚗 นำทาง</a>
                </div>
            </div>`;
        }).join('');
        
        let c = document.getElementById('route-store-list'); 
        c.innerHTML = html || '<p class="text-center text-gray-400 mt-5">ไม่มีคิวงาน</p>';
        document.getElementById('route-title').innerText = `คิวงาน (${list.length} ร้าน)`;
        
        if(sortableList) sortableList.destroy();
        sortableList = Sortable.create(c, { handle: '.drag-handle', animation: 250, onEnd: Processor.handleDrag });
        MapCtrl.drawMap();
    },
    handleDrag: () => {
        let items = document.querySelectorAll('#route-store-list > .store-item');
        let updated = [...State.allStores];
        items.forEach((item, index) => {
            let id = item.getAttribute('data-id');
            let target = updated.find(s => s.id === id);
            if(target) { if(!target.seqs) target.seqs = {}; target.seqs[State.currentDay] = index + 1; }
        });
        docMain.update({ [`routes.${State.myRoute}`]: updated });
    }
};

// 6. ระบบแผนที่ (Map)
const MapCtrl = {
    initAndDraw: () => {
        document.getElementById('btn-load-map').classList.add('hidden');
        document.getElementById('map').classList.remove('hidden');
        document.getElementById('btn-fit-map').classList.remove('hidden');
        if(!map) { 
            map = L.map('map', { zoomControl: false }).setView([14.4745, 100.1222], 10); 
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map); 
        }
        setTimeout(() => { map.invalidateSize(); MapCtrl.drawMap(); }, 200);
    },
    drawMap: () => {
        if(!map) return;

        // 🚀 เทคนิคที่ 3: ลดภาระแผนที่ซ้ำซ้อน 
        // เราจะไม่ทำลาย Object map เดิมทิ้ง แต่จะแค่ "ลบหมุดเก่าออก" และ "ปักหมุดใหม่" แทน 
        // ช่วยให้แอปไม่ต้องเรนเดอร์กระเบื้อง (Tiles) แผนที่ใหม่ทั้งหมด ประหยัดแบตเตอรี่และเน็ตมือถือ
        mapMarkers.forEach(m => map.removeLayer(m)); 
        mapMarkers = [];

        let list = State.allStores.filter(s => s.days.includes(State.currentDay));
        list.forEach((s, i) => {
            let seq = s.seqs?.[State.currentDay] || i+1;
            let icon = L.divIcon({ html: `<svg viewBox="0 0 24 24" width="28" height="38" style="filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.3)); overflow:visible;"><path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cx="12" cy="9" r="6" fill="#fff"/><text x="12" y="12.5" font-size="9" font-weight="900" fill="#000" text-anchor="middle">${seq}</text></svg>`, className: '', iconSize: [28, 38], iconAnchor: [14, 38], popupAnchor: [0, -38] });
            let m = L.marker([s.lat, s.lng], { icon }).addTo(map).bindPopup(`<div class="text-center pb-1"><b class="text-[10px]">${s.name}</b></div>`, { closeButton: false });
            mapMarkers.push(m);
        });
        MapCtrl.fitBounds();
    },
    fitBounds: () => { 
        if(mapMarkers.length && map) map.fitBounds(new L.featureGroup(mapMarkers).getBounds(), { padding: [30, 30] }); 
    }
};

// 7. กำหนดค่า Event Listeners
document.getElementById('day-select').addEventListener('change', (e) => { State.currentDay = e.target.value; Processor.routeList(); });
window.addEventListener('resize', () => { if(map) map.invalidateSize(); });
document.addEventListener('DOMContentLoaded', App.checkAuth);
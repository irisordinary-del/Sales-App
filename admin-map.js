// 🎨 จานสีสำหรับแยกสายวิ่ง (Vans)
const VAN_COLORS = [
    "#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", 
    "#EC4899", "#06B6D4", "#F97316", "#84CC16", "#6366F1", 
    "#14B8A6", "#F43F5E", "#0369A1"
];

const MapCtrl = {
    map: null, 
    markers: {}, 
    roadLayer: null, 
    polylines: [],

    init: () => { 
        MapCtrl.map = L.map('map').setView([13.7563, 100.5018], 10); // ตั้งค่าเริ่มต้นที่ กทม. หรือพิกัดกลางของพี่
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 18 
        }).addTo(MapCtrl.map); 
    },

    clearAll: () => { 
        for (let id in MapCtrl.markers) MapCtrl.map.removeLayer(MapCtrl.markers[id]); 
        MapCtrl.markers = {}; 
        MapCtrl.clearRoad(true); 
    },

    closePopups: () => { 
        for(let id in MapCtrl.markers) if(MapCtrl.markers[id].getPopup()) MapCtrl.markers[id].closePopup(); 
    },

    clearRoad: (skipRender = false) => { 
        if(MapCtrl.roadLayer) MapCtrl.map.removeLayer(MapCtrl.roadLayer); 
        MapCtrl.roadLayer = null; 
        State.activeRoadDay = null; 
        let btn = document.getElementById('clearRoadBtn');
        if(btn) btn.classList.add('hidden'); 
        if(!skipRender) UI.render(); 
    },

    // แสดงผลหมุดแบบปกติ (หน้าวางแผน)
    renderMarkers: () => {
        // ซ่อนป้ายบอกสี Legend เวลาอยู่หน้าปกติ
        let leg = document.getElementById('all-routes-legend'); 
        if(leg) leg.classList.add('hidden');

        MapCtrl.clearAll();
        State.stores.forEach(s => {
            let color = s.selected ? '#2563eb' : (s.days.length > 0 ? '#10b981' : '#94a3b8');
            let iconHtml = `<div style="background-color:${color}; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`;
            let icon = L.divIcon({ html: iconHtml, className: '', iconSize: [12, 12], iconAnchor: [6, 6] });
            
            let m = L.marker([s.lat, s.lng], { icon: icon }).addTo(MapCtrl.map);
            
            // Popup ข้อมูลร้าน
            let popHtml = `
                <div class="p-1">
                    <p class="font-bold text-sm">${s.name}</p>
                    <p class="text-xs text-gray-500">ID: ${s.id}</p>
                    <p class="text-xs mt-1">${s.days.length > 0 ? '✅ '+s.days.join(', ') : '❌ ยังไม่จัดสาย'}</p>
                    <button onclick="StoreMgr.toggleSelect('${s.id}')" class="mt-2 w-full text-[10px] bg-slate-100 py-1 rounded hover:bg-blue-100 transition">
                        ${s.selected ? 'ยกเลิกการเลือก' : 'เลือกร้านนี้'}
                    </button>
                </div>
            `;
            m.bindPopup(popHtml);
            MapCtrl.markers[s.id] = m;
        });
        if (State.stores.length > 0) MapCtrl.fit();
    },

    // 🌟 ฟังก์ชันใหม่: แสดงผลรวมทุกสายวิ่งแยกสี
    renderAllRoutes: () => {
        if(!MapCtrl.map) return;
        MapCtrl.clearAll();
        
        let routes = Object.keys(State.db.routes).sort();
        let legendHtml = '';
        
        routes.forEach((routeName, index) => {
            let color = VAN_COLORS[index % VAN_COLORS.length];
            let stores = State.db.routes[routeName] || [];
            
            if(stores.length === 0) return;

            // สร้างลิสต์ป้ายบอกสีด้านซ้ายล่าง
            legendHtml += `
                <div class="flex items-center gap-3 text-xs mb-2">
                    <span class="w-3 h-3 rounded-full shadow-sm border border-white" style="background-color:${color}"></span>
                    <span class="font-bold text-gray-700">${routeName}</span> 
                    <span class="text-gray-400">(${stores.length})</span>
                </div>`;
            
            // วาดหมุดทีละร้านในสายนั้นๆ
            stores.forEach(s => {
                let iconHtml = `<div style="width:14px; height:14px; background-color:${color}; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.4);"></div>`;
                let icon = L.divIcon({ html: iconHtml, className: '', iconSize: [14,14], iconAnchor: [7,7] });
                
                let m = L.marker([s.lat, s.lng], {icon:icon}).addTo(MapCtrl.map);
                m.bindPopup(`<b>${s.name}</b><br><small>สาย: <b style="color:${color}">${routeName}</b></small>`);
                MapCtrl.markers[s.id + routeName] = m; // ใช้ Key พิเศษกันซ้ำ
            });
        });
        
        // อัปเดต UI ป้ายบอกสี
        let legContent = document.getElementById('legend-content');
        if(legContent) legContent.innerHTML = legendHtml || '<div class="text-xs text-gray-400">ไม่มีข้อมูล</div>';
        
        let leg = document.getElementById('all-routes-legend');
        if(leg) leg.classList.remove('hidden');

        MapCtrl.fit();
    },

    fit: () => {
        let group = [];
        for (let id in MapCtrl.markers) group.push(MapCtrl.markers[id].getLatLng());
        if (group.length > 0) MapCtrl.map.fitBounds(L.latLngBounds(group), { padding: [30, 30] });
    }
};

const Lasso = {
    active: false, pts: [], mkrs: [], poly: null,
    isInside: (pt, poly) => {
        let x = pt[0], y = pt[1], inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            let xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },
    start: () => {
        Lasso.active = true; Lasso.pts = []; Lasso.mkrs = [];
        document.getElementById('lassoPanel').classList.remove('hidden');
        document.getElementById('map').classList.add('draw-cursor');
        MapCtrl.map.on('click', Lasso.addPt);
    },
    addPt: (e) => {
        Lasso.pts.push([e.latlng.lat, e.latlng.lng]);
        Lasso.mkrs.push(L.circleMarker(e.latlng, {radius: 4, color: '#ef4444'}).addTo(MapCtrl.map));
        if(Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly);
        Lasso.poly = L.polyline(Lasso.pts, {color: '#4f46e5', weight:4, dashArray:'5, 8'}).addTo(MapCtrl.map);
    },
    cancel: () => {
        Lasso.active = false; Lasso.pts = [];
        if(Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly); Lasso.poly = null;
        Lasso.mkrs.forEach(m => MapCtrl.map.removeLayer(m)); Lasso.mkrs = [];
        document.getElementById('lassoPanel').classList.add('hidden');
        document.getElementById('map').classList.remove('draw-cursor');
        MapCtrl.map.off('click', Lasso.addPt);
    },
    finish: () => {
        if(Lasso.pts.length < 3) return alert("วาดอย่างน้อย 3 จุด");
        let count = 0;
        State.stores.forEach(s => {
            if(Lasso.isInside([s.lat, s.lng], Lasso.pts)) {
                s.selected = true;
                count++;
            }
        });
        Lasso.cancel();
        UI.render();
        UI.showSaveToast(`เลือกเพิ่ม ${count} ร้านค้า`);
    }
};

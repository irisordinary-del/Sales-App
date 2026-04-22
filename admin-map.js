// ==========================================
// 🗺️ admin-map.js: จัดการแผนที่และ OSRM
// ==========================================

var MapCtrl = {
    map: null, markers: [], lines: [], roadLines: [], failedStores: [],
    
    init: () => {
        if (MapCtrl.map) return;
        MapCtrl.map = L.map('map').setView([13.7563, 100.5018], 10);
        L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { 
            maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] 
        }).addTo(MapCtrl.map);
    },
    clearRoad: (hideBtn = false) => {
        MapCtrl.roadLines.forEach(l => MapCtrl.map.removeLayer(l)); MapCtrl.roadLines = [];
        if(hideBtn) { let btn = document.getElementById('clearRoadBtn'); if(btn) btn.classList.add('hidden'); }
    },
    fitToStores: () => {
        if(!State.stores.length || !MapCtrl.map) return;
        let bounds = L.latLngBounds(State.stores.map(s => {
            let lat = parseFloat(s.lat), lng = parseFloat(s.lng);
            if(isNaN(lat) || isNaN(lng) || lat===0) return null;
            if (Math.abs(lat) > 90) return [lng, lat];
            return [lat, lng];
        }).filter(b => b !== null));
        if(Object.keys(bounds).length > 0) MapCtrl.map.fitBounds(bounds, { padding: [30, 30] });
    },
    renderMarkers: () => {
        if (!MapCtrl.map) return;
        MapCtrl.markers.forEach(m => MapCtrl.map.removeLayer(m)); MapCtrl.markers = [];
        MapCtrl.lines.forEach(l => MapCtrl.map.removeLayer(l)); MapCtrl.lines = [];
        MapCtrl.failedStores = []; 
        
        let opts = "";
        if(typeof DAY_COLORS !== 'undefined') {
            opts = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`).join('');
        }

        State.stores.forEach(s => {
            let lat = parseFloat(s.lat), lng = parseFloat(s.lng);
            if (isNaN(lat) || isNaN(lng) || lat === 0) { MapCtrl.failedStores.push(`❌ ${s.name}`); return; }
            if (Math.abs(lat) > 90) { let t = lat; lat = lng; lng = t; }

            let dKey = (s.days && s.days.length) ? s.days[0] : null;
            let color = (dKey && typeof DAY_COLORS !== 'undefined' && DAY_COLORS[dKey]) ? DAY_COLORS[dKey].hex : '#9CA3AF';
            let dayNum = dKey ? dKey.replace('Day ', '') : '';
            
            let iconHtml = `
                <div style="position: relative; width: 28px; height: 38px; z-index: ${s.selected ? 1000 : 1};">
                    <div style="position: absolute; top: 0; left: 0; width: 28px; height: 28px; background-color: ${color}; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid ${s.selected?'#000':'#fff'}; box-shadow: 2px 2px 5px rgba(0,0,0,0.4);"></div>
                    <div style="position: absolute; top: 0; left: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 900; z-index: 2;">${dayNum}</div>
                </div>`;
            
            let icon = L.divIcon({ className: 'custom-icon', html: iconHtml, iconSize: [28, 38], iconAnchor: [14, 38] });
            let marker = L.marker([lat, lng], { icon: icon }).addTo(MapCtrl.map);
            
            marker.bindPopup(`
                <div style="min-width: 180px; font-family: sans-serif;">
                    <b style="font-size:15px;">${s.name}</b><br><span style="font-size:10px; color:gray;">ID: ${s.id}</span>
                    <div style="background:${color}; color:white; padding:6px; border-radius:8px; font-size:13px; font-weight:bold; text-align:center; margin:10px 0;">📅 ${dKey?DAY_COLORS[dKey].name:'รอจัดสาย'}</div>
                    <select onchange="StoreMgr.changeDay('${s.id}', this.value)" style="width:100%; padding:6px; border-radius:6px; font-size:12px;">
                        <option value="remove">-- ❌ ถอดออกจากสาย --</option>
                        ${opts.replace(`value="${dKey}"`, `value="${dKey}" selected`)}
                    </select>
                    <button onclick="StoreMgr.toggleSelect('${s.id}')" style="margin-top:10px; width:100%; padding:8px; color:white; background:${s.selected?'#EF4444':'#4F46E5'}; border-radius:6px; border:none; font-weight:bold;">
                        ${s.selected ? '❌ ยกเลิกเลือก' : '✅ เลือกร้านนี้'}
                    </button>
                </div>`);
            MapCtrl.markers.push(marker);
        });

        let statusBtn = document.getElementById('map-status-btn');
        if (!statusBtn) { statusBtn = document.createElement('button'); statusBtn.id = 'map-status-btn'; document.getElementById('map').parentElement.appendChild(statusBtn); }
        
        if (MapCtrl.failedStores.length > 0) {
            statusBtn.className = 'absolute bottom-20 right-6 z-[400] bg-red-50 text-red-600 font-bold px-4 py-2.5 rounded-xl shadow-lg border border-red-200 animate-pulse text-sm';
            statusBtn.innerHTML = `⚠️ หมุดหาย ${MapCtrl.failedStores.length} ร้าน (คลิกดู)`;
            statusBtn.onclick = () => alert("ร้านที่พิกัดมีปัญหา:\n" + MapCtrl.failedStores.join("\n"));
            statusBtn.style.display = 'block';
        } else if(State.stores.length > 0) {
            statusBtn.className = 'absolute bottom-20 right-6 z-[400] bg-emerald-50 text-emerald-600 font-bold px-4 py-2 rounded-xl shadow-md border border-emerald-200 text-xs';
            statusBtn.innerHTML = `✅ แสดงหมุดครบ ${MapCtrl.markers.length}/${State.stores.length} ร้าน`;
            statusBtn.onclick = null;
            statusBtn.style.display = 'block';
        } else {
            statusBtn.style.display = 'none';
        }
    }
};

var OSRM = {
    generate: async () => {
        let day = State.openDayModal; if(!day) return alert("กรุณาเลือกวันก่อน");
        let validStores = State.stores.filter(s => s.days && s.days.includes(day)).filter(s => {
            let lat = parseFloat(s.lat), lng = parseFloat(s.lng); return !isNaN(lat) && !isNaN(lng) && lat !== 0;
        });

        if(validStores.length < 2) return alert("ต้องมีอย่างน้อย 2 ร้านที่มีพิกัดถูกต้อง");
        if(validStores.length > 90) return alert("⚠️ ร้านค้ากระจุกตัวเกิน 90 ร้าน ระบบวาดถนนไม่สามารถประมวลผลได้");

        if(typeof UI !== 'undefined') { UI.showLoader("กำลังคำนวณเส้นทางถนน...", "เชื่อมต่อ OSRM API"); UI.closeDayModal(); }

        try {
            let coords = validStores.map(s => {
                let lat = parseFloat(s.lat), lng = parseFloat(s.lng);
                return Math.abs(lat) > 90 ? `${lat},${lng}` : `${lng},${lat}`;
            }).join(';');
            
            let url1 = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson`;
            let url2 = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

            let data;
            try { let res = await fetch(url1); data = await res.json(); } 
            catch(e1) { let res2 = await fetch(url2); data = await res2.json(); }

            if(!data || data.code !== 'Ok') throw new Error("OSRM API Error");

            MapCtrl.clearRoad(false);
            let color = (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[day]) ? DAY_COLORS[day].hex : '#4F46E5';
            let routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            let pl = L.polyline(routeCoords, { color: color, weight: 6, opacity: 0.8 }).addTo(MapCtrl.map);
            MapCtrl.roadLines.push(pl);
            MapCtrl.map.fitBounds(pl.getBounds(), { padding: [50, 50] });

            document.getElementById('clearRoadBtn').classList.remove('hidden');
            if(typeof UI !== 'undefined') UI.hideLoader();

        } catch(err) {
            if(typeof UI !== 'undefined') UI.hideLoader();
            alert("❌ เซิร์ฟเวอร์วาดเส้นทางทำงานหนัก โปรดลองใหม่ในอีกสักครู่");
        }
    }
};

var Lasso = {
    active: false, polygon: null, points: [],
    toggle: () => {
        Lasso.active = !Lasso.active;
        let mapDiv = document.getElementById('map');
        if (Lasso.active) {
            document.getElementById('lassoPanel').classList.remove('hidden');
            MapCtrl.map.dragging.disable(); mapDiv.style.cursor = 'crosshair';
            MapCtrl.map.on('mousedown', Lasso.onDown);
        } else Lasso.cancel();
    },
    onDown: (e) => {
        Lasso.points = [e.latlng];
        if (Lasso.polygon) MapCtrl.map.removeLayer(Lasso.polygon);
        Lasso.polygon = L.polygon(Lasso.points, { color: '#000', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }).addTo(MapCtrl.map);
        MapCtrl.map.on('mousemove', Lasso.onMove); MapCtrl.map.on('mouseup', Lasso.onUp);
    },
    onMove: (e) => { Lasso.points.push(e.latlng); Lasso.polygon.setLatLngs(Lasso.points); },
    onUp: () => { MapCtrl.map.off('mousemove', Lasso.onMove); MapCtrl.map.off('mouseup', Lasso.onUp); },
    finish: () => {
        if (!Lasso.polygon || Lasso.points.length < 3) return alert('กรุณาวาดพื้นที่ให้สมบูรณ์');
        let selCount = 0;
        State.stores.forEach(s => {
            let lat = parseFloat(s.lat), lng = parseFloat(s.lng);
            if (isNaN(lat) || isNaN(lng) || lat === 0) return;
            if (Math.abs(lat) > 90) { let t = lat; lat = lng; lng = t; }
            if (Lasso.isPointInPoly(L.latLng(lat, lng), Lasso.points)) { s.selected = true; selCount++; }
        });
        Lasso.cancel();
        if(typeof UI !== 'undefined') { UI.switchTab('tab2'); UI.render(); UI.showSaveToast(`เลือกสำเร็จ ${selCount} ร้าน`); }
    },
    cancel: () => {
        Lasso.active = false; document.getElementById('lassoPanel').classList.add('hidden');
        MapCtrl.map.dragging.enable(); document.getElementById('map').style.cursor = '';
        MapCtrl.map.off('mousedown', Lasso.onDown); MapCtrl.map.off('mousemove', Lasso.onMove); MapCtrl.map.off('mouseup', Lasso.onUp);
        if (Lasso.polygon) { MapCtrl.map.removeLayer(Lasso.polygon); Lasso.polygon = null; }
        Lasso.points = [];
    },
    isPointInPoly: (pt, poly) => {
        let inside = false, x = pt.lng, y = pt.lat;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            let xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
            let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
};

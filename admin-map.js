// ระบบจัดการแผนที่และหมุด
const MapCtrl = {
    map: null, markers: [], lines: [], roadLines: [],
    
    init: () => {
        // ตั้งค่าพิกัดเริ่มต้น (กรุงเทพฯ)
        MapCtrl.map = L.map('map').setView([13.7563, 100.5018], 10);
        L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { 
            maxZoom: 20, 
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] 
        }).addTo(MapCtrl.map);
    },
    
    clearAll: () => { 
        MapCtrl.markers.forEach(m => MapCtrl.map.removeLayer(m)); MapCtrl.markers = []; 
        MapCtrl.clearLines(); 
        MapCtrl.clearRoad(true); 
    },
    
    clearLines: () => { 
        MapCtrl.lines.forEach(l => MapCtrl.map.removeLayer(l)); MapCtrl.lines = []; 
    },
    
    clearRoad: (hideBtn = false) => {
        MapCtrl.roadLines.forEach(l => MapCtrl.map.removeLayer(l)); MapCtrl.roadLines = [];
        if(hideBtn) { 
            let btn = document.getElementById('clearRoadBtn'); 
            if(btn) btn.classList.add('hidden'); 
        }
    },
    
    fitToStores: () => {
        if(!State.stores.length) return;
        let bounds = L.latLngBounds(State.stores.map(s => [s.lat, s.lng]));
        MapCtrl.map.fitBounds(bounds, { padding: [30, 30] });
    },
    
    closePopups: () => { MapCtrl.map.closePopup(); },
    
    renderMarkers: () => {
        MapCtrl.markers.forEach(m => MapCtrl.map.removeLayer(m)); MapCtrl.markers = [];
        State.stores.forEach(s => {
            let color = s.days.length ? DAY_COLORS[s.days[0]].hex : '#9CA3AF';
            
            // สไตล์หมุดปกติ และ หมุดที่ถูกเลือก (กระโดดได้)
            let iconHtml = `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>`;
            if(s.selected) iconHtml = `<div class="animate-bounce" style="background-color: #4F46E5; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 8px rgba(79,70,229,0.8);"></div>`;
            
            let icon = L.divIcon({ className: 'custom-icon', html: iconHtml, iconSize: [14, 14], iconAnchor: [7, 7] });
            let marker = L.marker([s.lat, s.lng], { icon: icon }).addTo(MapCtrl.map);
            marker.bindPopup(`<b>${s.name}</b><br><span style="font-size:10px;color:gray">ID: ${s.id}</span>`);
            MapCtrl.markers.push(marker);
        });
    },
    
    drawLines: () => {
        MapCtrl.clearLines();
        let toggle = document.getElementById('toggleLines');
        if(!toggle || !toggle.checked) return;
        
        let dayGroups = {};
        State.stores.forEach(s => {
            if(s.days.length) { 
                s.days.forEach(d => { 
                    if(!dayGroups[d]) dayGroups[d] = []; 
                    dayGroups[d].push(s); 
                }); 
            }
        });

        Object.keys(dayGroups).forEach(d => {
            let pts = dayGroups[d].sort((a,b) => (a.seqs[d]||999)-(b.seqs[d]||999)).map(x => [x.lat, x.lng]);
            if(pts.length > 1) {
                let pl = L.polyline(pts, { color: DAY_COLORS[d].hex, weight: 2, opacity: 0.6, dashArray: '5, 5' }).addTo(MapCtrl.map);
                MapCtrl.lines.push(pl);
            }
        });
    }
};

// 🌟 พระเอกที่หายไป: ระบบวาดถนนจริง (OSRM API)
const OSRM = {
    generate: async () => {
        let day = State.openDayModal;
        if(!day) return alert("กรุณาเลือกวันก่อน");
        
        let stores = State.stores.filter(s => s.days.includes(day)).sort((a,b) => (a.seqs[day]||999)-(b.seqs[day]||999));
        if(stores.length < 2) return alert("ต้องมีอย่างน้อย 2 ร้านในวันนี้ เพื่อวาดเส้นทางครับ");

        // ป้องกัน Error จากข้อจำกัดของ OSRM (ห้ามเกิน 90 พิกัด)
        if(stores.length > 90) {
            return alert("⚠️ ไม่สามารถวาดเส้นถนนได้ครับ เนื่องจากวันนี้มีร้านค้ากระจุกตัวเกิน 90 ร้าน (ระบบวาดถนนจำกัดไว้เพื่อป้องกันคอมพิวเตอร์ค้างครับ)");
        }

        UI.showLoader("กำลังคำนวณเส้นทางถนนจริง...", "เชื่อมต่อดาวเทียม OSRM API");
        UI.closeDayModal();

        try {
            // ดึงพิกัดมาร้อยเรียงกัน
            let coords = stores.map(s => `${s.lng},${s.lat}`).join(';');
            let url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

            let res = await fetch(url);
            let data = await res.json();

            if(data.code !== 'Ok') throw new Error(data.message || "OSRM API Error");

            // ลบเส้นเดิมออกก่อนวาดใหม่
            MapCtrl.clearRoad(false);

            let color = DAY_COLORS[day].hex;
            // สลับพิกัดจาก [Lng, Lat] เป็น [Lat, Lng] ให้ตรงกับที่แผนที่ต้องการ
            let routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            
            let pl = L.polyline(routeCoords, { color: color, weight: 5, opacity: 0.8 }).addTo(MapCtrl.map);
            MapCtrl.roadLines.push(pl);
            
            // ซูมแผนที่ไปดูเส้นทางที่วาดเสร็จ
            MapCtrl.map.fitBounds(pl.getBounds(), { padding: [50, 50] });

            // โชว์ปุ่มกากบาท "ซ่อนเส้นทาง"
            document.getElementById('clearRoadBtn').classList.remove('hidden');
            UI.hideLoader();

        } catch(err) {
            UI.hideLoader();
            alert("❌ เกิดข้อผิดพลาดในการวาดเส้นถนน: " + err.message);
            console.error(err);
        }
    }
};

// ระบบวาดบ่วง Lasso เพื่อเลือกร้านหลายๆ ร้าน
const Lasso = {
    active: false, polygon: null, points: [],
    
    toggle: () => {
        Lasso.active = !Lasso.active;
        let mapDiv = document.getElementById('map');
        if (Lasso.active) {
            document.getElementById('lassoPanel').classList.remove('hidden');
            MapCtrl.map.dragging.disable();
            mapDiv.style.cursor = 'crosshair';
            MapCtrl.map.on('mousedown', Lasso.onDown);
        } else {
            Lasso.cancel();
        }
    },
    
    onDown: (e) => {
        Lasso.points = [e.latlng];
        if (Lasso.polygon) MapCtrl.map.removeLayer(Lasso.polygon);
        Lasso.polygon = L.polygon(Lasso.points, { color: '#000', weight: 2, fillOpacity: 0.2 }).addTo(MapCtrl.map);
        MapCtrl.map.on('mousemove', Lasso.onMove);
        MapCtrl.map.on('mouseup', Lasso.onUp);
    },
    
    onMove: (e) => {
        Lasso.points.push(e.latlng);
        Lasso.polygon.setLatLngs(Lasso.points);
    },
    
    onUp: () => {
        MapCtrl.map.off('mousemove', Lasso.onMove);
        MapCtrl.map.off('mouseup', Lasso.onUp);
    },
    
    finish: () => {
        if (!Lasso.polygon || Lasso.points.length < 3) return alert('กรุณาวาดพื้นที่ให้สมบูรณ์');
        let selCount = 0;
        State.stores.forEach(s => {
            if (Lasso.isPointInPoly(L.latLng(s.lat, s.lng), Lasso.points)) {
                s.selected = true;
                selCount++;
            }
        });
        Lasso.cancel();
        UI.switchTab('tab2');
        UI.render();
        if (selCount > 0) UI.showSaveToast(`เลือกพื้นที่สำเร็จ ${selCount} ร้าน`);
    },
    
    cancel: () => {
        Lasso.active = false;
        document.getElementById('lassoPanel').classList.add('hidden');
        MapCtrl.map.dragging.enable();
        document.getElementById('map').style.cursor = '';
        MapCtrl.map.off('mousedown', Lasso.onDown);
        MapCtrl.map.off('mousemove', Lasso.onMove);
        MapCtrl.map.off('mouseup', Lasso.onUp);
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

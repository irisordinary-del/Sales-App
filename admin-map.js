// ==========================================
// 1. ระบบจัดการแผนที่และหมุด (Map Controller)
// ==========================================
const MapCtrl = {
    map: null, markers: [], lines: [], roadLines: [],
    
    init: () => {
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
    
    // 🌟 พระเอกกลับมาแล้ว: หมุดรูปหยดน้ำ มีตัวเลขด้านใน + กล่อง Popup แบบเดิม
    renderMarkers: () => {
        MapCtrl.markers.forEach(m => MapCtrl.map.removeLayer(m)); MapCtrl.markers = [];
        
        const opts = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`).join('');

        State.stores.forEach(s => {
            let color = s.days.length ? DAY_COLORS[s.days[0]].hex : '#9CA3AF';
            let dayNum = s.days.length ? s.days[0].replace('Day ', '') : '';
            
            let scale = s.selected ? 'scale(1.2)' : 'scale(1)';
            let zIndex = s.selected ? 1000 : 1;
            let borderColor = s.selected ? '#000' : 'white';

            // ดีไซน์หมุดหยดน้ำแบบในรูปของคุณเป๊ะๆ
            let iconHtml = `
                <div style="position: relative; width: 28px; height: 38px; transform: ${scale}; z-index: ${zIndex};">
                    <div style="position: absolute; top: 0; left: 0; width: 28px; height: 28px; background-color: ${color}; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid ${borderColor}; box-shadow: 2px 2px 5px rgba(0,0,0,0.4);"></div>
                    <div style="position: absolute; top: 0; left: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 900; text-shadow: 1px 1px 2px rgba(0,0,0,0.8); z-index: 2;">
                        ${dayNum}
                    </div>
                </div>
            `;
            
            let icon = L.divIcon({ className: 'custom-icon', html: iconHtml, iconSize: [28, 38], iconAnchor: [14, 38] });
            let marker = L.marker([s.lat, s.lng], { icon: icon }).addTo(MapCtrl.map);
            
            let currentDay = s.days.length ? s.days[0] : '';
            
            // ป้ายบอกวันสีเขียว (หรือสีตามวัน) ตรงกลางกล่อง
            let dayBadge = currentDay ? `<div style="background:${color}; color:white; padding:6px; border-radius:8px; font-size:13px; font-weight:bold; text-align:center; margin:10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">📅 ${DAY_COLORS[currentDay].name}</div>` : `<div style="background:#9CA3AF; color:white; padding:6px; border-radius:8px; font-size:13px; font-weight:bold; text-align:center; margin:10px 0;">❌ ยังไม่จัดสาย</div>`;

            // ดีไซน์ Popup แบบเดียวกับในรูปเป๊ะๆ
            let popupContent = `
                <div style="min-width: 180px; font-family: 'Prompt', sans-serif;">
                    <b style="font-size:15px; color:#1F2937;">${s.name}</b><br>
                    <span style="font-size:10px; color:#6B7280;">ID: ${s.id}</span>
                    
                    ${dayBadge}

                    <div style="margin-top: 8px;">
                        <label style="font-size:11px; font-weight:bold; color:#4B5563; display:block; margin-bottom:4px;">แก้ไขสายวิ่ง:</label>
                        <select onchange="StoreMgr.changeDay('${s.id}', this.value)" style="width: 100%; padding: 6px; border: 1px solid #D1D5DB; border-radius: 6px; font-size: 12px; outline: none; cursor:pointer; background-color:#F9FAFB;">
                            <option value="remove" ${!currentDay ? 'selected' : ''}>-- ❌ รอจัด (ถอดออก) --</option>
                            ${opts.replace(`value="${currentDay}"`, `value="${currentDay}" selected`)}
                        </select>
                    </div>

                    <button onclick="StoreMgr.toggleSelect('${s.id}')" style="margin-top: 12px; width: 100%; padding: 8px; font-size: 12px; font-weight: bold; color: white; background: ${s.selected ? '#EF4444' : '#4F46E5'}; border-radius: 6px; border: none; cursor: pointer; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        ${s.selected ? '❌ ยกเลิกเลือก' : '✅ เลือกร้านนี้'}
                    </button>
                </div>
            `;

            marker.bindPopup(popupContent);
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

// ==========================================
// 🚗 2. ระบบวาดเส้นถนนจริง (OSRM API - มีเซิร์ฟเวอร์สำรอง)
// ==========================================
const OSRM = {
    generate: async () => {
        let day = State.openDayModal;
        if(!day) return alert("กรุณาเลือกวันก่อน");
        
        let stores = State.stores.filter(s => s.days.includes(day)).sort((a,b) => (a.seqs[day]||999)-(b.seqs[day]||999));
        if(stores.length < 2) return alert("ต้องมีอย่างน้อย 2 ร้านในวันนี้ เพื่อวาดเส้นทางครับ");

        if(stores.length > 90) {
            return alert("⚠️ ไม่สามารถวาดเส้นถนนได้ครับ เนื่องจากวันนี้มีร้านค้ากระจุกตัวเกิน 90 ร้าน");
        }

        UI.showLoader("กำลังคำนวณเส้นทางถนนจริง...", "กำลังเชื่อมต่อดาวเทียมนำทาง...");
        UI.closeDayModal();

        try {
            let coords = stores.map(s => `${s.lng},${s.lat}`).join(';');
            
            // 🌟 URL 1: เซิร์ฟเวอร์ของเยอรมัน (เสถียรกว่า)
            let url1 = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson`;
            // 🌟 URL 2: เซิร์ฟเวอร์สาธารณะหลัก (เผื่อตัวแรกพัง)
            let url2 = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

            let data;
            try {
                // ลองเซิร์ฟเวอร์แรกก่อน
                let res = await fetch(url1);
                data = await res.json();
            } catch (e1) {
                console.warn("เซิร์ฟเวอร์ 1 ล่ม, กำลังสลับไปเซิร์ฟเวอร์ 2...");
                // ถ้าพัง สลับมาเซิร์ฟเวอร์สอง
                let res2 = await fetch(url2);
                data = await res2.json();
            }

            if(!data || data.code !== 'Ok') throw new Error(data ? data.message : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");

            MapCtrl.clearRoad(false);

            let color = DAY_COLORS[day].hex;
            let routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            
            let pl = L.polyline(routeCoords, { color: color, weight: 6, opacity: 0.8 }).addTo(MapCtrl.map);
            MapCtrl.roadLines.push(pl);
            
            MapCtrl.map.fitBounds(pl.getBounds(), { padding: [50, 50] });

            document.getElementById('clearRoadBtn').classList.remove('hidden');
            UI.hideLoader();

        } catch(err) {
            UI.hideLoader();
            alert("❌ เซิร์ฟเวอร์วาดเส้นทางฟรีทำงานหนักเกินไป (Failed to fetch)\n\nระบบบล็อกการดึงข้อมูลชั่วคราว โปรดลองกดวาดเส้นทางใหม่อีกครั้งในอีกสักครู่ครับ");
            console.error(err);
        }
    }
};

// ==========================================
// ✏️ 3. ระบบวาดบ่วงเลือกพื้นที่ (Lasso Tool)
// ==========================================
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
        Lasso.polygon = L.polygon(Lasso.points, { color: '#000', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }).addTo(MapCtrl.map);
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
        if (selCount > 0) UI.showSaveToast(`เลือกสำเร็จ ${selCount} ร้าน (ไปที่แท็บ 2 เพื่อจัดวัน)`);
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

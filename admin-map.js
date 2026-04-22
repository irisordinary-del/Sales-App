// ==========================================
// 🗺️ admin-map.js: จัดการแผนที่และหมุดหยadน้ำ
// ==========================================

var MapCtrl = {
    map: null, markers: [], roadLines: [], failedStores: [],
    
    init: () => {
        if (MapCtrl.map) return;
        MapCtrl.map = L.map('map').setView([13.756, 100.501], 10);
        L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { 
            maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3'] 
        }).addTo(MapCtrl.map);
    },
    
    renderMarkers: () => {
        if (!MapCtrl.map) return;
        MapCtrl.markers.forEach(m => MapCtrl.map.removeLayer(m));
        MapCtrl.markers = []; MapCtrl.failedStores = [];
        
        const opts = Object.keys(DAY_COLORS).map(d=>`<option value="${d}">${DAY_COLORS[d].name}</option>`).join('');

        State.stores.forEach(s => {
            let lat = parseFloat(s.lat), lng = parseFloat(s.lng);
            if(isNaN(lat) || isNaN(lng) || lat===0) {
                MapCtrl.failedStores.push(`❌ ${s.name}`); return;
            }
            if(Math.abs(lat) > 90) { let t=lat; lat=lng; lng=t; }

            let dKey = s.days[0], color = (dKey && DAY_COLORS[dKey]) ? DAY_COLORS[dKey].hex : '#9CA3AF';
            let dayNum = dKey ? dKey.replace('Day ', '') : '';

            let iconHtml = `
                <div style="position:relative; width:28px; height:38px; z-index:${s.selected?1000:1};">
                    <div style="position:absolute; top:0; left:0; width:28px; height:28px; background:${color}; border-radius:50% 50% 50% 0; transform:rotate(-45deg); border:2px solid ${s.selected?'#000':'#fff'}; box-shadow:2px 2px 5px rgba(0,0,0,0.3);"></div>
                    <div style="position:absolute; top:0; left:0; width:28px; height:28px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:12px; font-weight:900; z-index:2;">${dayNum}</div>
                </div>`;
            
            let icon = L.divIcon({ html: iconHtml, iconSize: [28,38], iconAnchor: [14,38] });
            let marker = L.marker([lat, lng], {icon: icon}).addTo(MapCtrl.map);
            
            marker.bindPopup(`
                <div style="min-width:160px; font-family:sans-serif;">
                    <b>${s.name}</b><br><small>ID: ${s.id}</small>
                    <div style="background:${color}; color:#fff; padding:5px; border-radius:5px; text-align:center; margin:8px 0;">📅 ${dKey?DAY_COLORS[dKey].name:'รอจัดสาย'}</div>
                    <select onchange="StoreMgr.changeDay('${s.id}', this.value)" style="width:100%; padding:5px; border-radius:4px;">
                        <option value="remove">-- ❌ ถอดออก --</option>
                        ${opts.replace(`value="${dKey}"`, `value="${dKey}" selected`)}
                    </select>
                    <button onclick="StoreMgr.toggleSelect('${s.id}')" style="margin-top:8px; width:100%; padding:6px; background:${s.selected?'#EF4444':'#4F46E5'}; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                        ${s.selected ? '❌ ยกเลิกเลือก' : '✅ เลือกร้านนี้'}
                    </button>
                </div>`);
            MapCtrl.markers.push(marker);
        });
        MapCtrl.updateStatusBadge();
    },

    updateStatusBadge: () => {
        let btn = document.getElementById('map-status-btn');
        if(!btn) { btn = document.createElement('button'); btn.id='map-status-btn'; document.getElementById('map').appendChild(btn); }
        let total = State.stores.length, fail = MapCtrl.failedStores.length;
        if(fail > 0) {
            btn.className = 'absolute bottom-4 right-4 z-[1000] bg-red-50 text-red-600 p-2 rounded shadow border border-red-200 text-xs animate-pulse';
            btn.innerHTML = `⚠️ หมุดหาย ${fail} ร้าน`;
            btn.onclick = () => alert("ร้านที่พิกัดพัง:\n" + MapCtrl.failedStores.join("\n"));
        } else {
            btn.className = 'absolute bottom-4 right-4 z-[1000] bg-emerald-50 text-emerald-600 p-2 rounded shadow border border-emerald-200 text-xs';
            btn.innerHTML = `✅ หมุดครบ ${MapCtrl.markers.length}/${total}`;
        }
    },

    fitToStores: () => {
        if(!MapCtrl.markers.length) return;
        let group = new L.featureGroup(MapCtrl.markers);
        MapCtrl.map.fitBounds(group.getBounds(), {padding:[30,30]});
    }
};

// 🚗 ระบบวาดถนนจริง OSRM
var OSRM = {
    generate: async () => {
        let day = State.openDayModal; if(!day) return alert("เลือกวันก่อนครับ");
        let stores = State.stores.filter(s=>s.days.includes(day));
        if(stores.length < 2) return alert("ต้องมี 2 ร้านขึ้นไป");
        
        UI.showLoader("วาดเส้นถนนจริง...", "OSRM API");
        try {
            let coords = stores.map(s=>`${s.lng},${s.lat}`).join(';');
            let res = await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson`);
            let data = await res.json();
            if(data.code !== 'Ok') throw new Error("OSRM Error");
            
            MapCtrl.roadLines.forEach(l=>MapCtrl.map.removeLayer(l));
            let route = data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
            let pl = L.polyline(route, {color: DAY_COLORS[day].hex, weight:5, opacity:0.7}).addTo(MapCtrl.map);
            MapCtrl.roadLines.push(pl);
            MapCtrl.map.fitBounds(pl.getBounds());
        } catch(e) { alert("วาดถนนไม่สำเร็จครับ"); }
        UI.hideLoader(); UI.closeDayModal();
    }
};

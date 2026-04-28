const MapCtrl = {
    map: null, markers: {}, roadLayer: null, polylines: [],
    init: () => { MapCtrl.map = L.map('map').setView([14.4745, 100.1222], 10); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(MapCtrl.map); },
    clearAll: () => { for (let id in MapCtrl.markers) MapCtrl.map.removeLayer(MapCtrl.markers[id]); MapCtrl.markers = {}; MapCtrl.clearRoad(true); },
    closePopups: () => { for(let id in MapCtrl.markers) if(MapCtrl.markers[id].getPopup()) MapCtrl.markers[id].closePopup(); },
    clearRoad: (skipRender = false) => { if(MapCtrl.roadLayer) MapCtrl.map.removeLayer(MapCtrl.roadLayer); MapCtrl.roadLayer = null; State.activeRoadDay = null; document.getElementById('clearRoadBtn').classList.add('hidden'); if(!skipRender) UI.render(); },
    drawLines: () => { MapCtrl.polylines.forEach(l => MapCtrl.map.removeLayer(l)); MapCtrl.polylines = []; if(!document.getElementById('toggleLines').checked) return; let byDay = {}; State.stores.forEach(s => { if(s.days.length && !s.days.includes(State.activeRoadDay)) { let d = s.days[0]; if(!byDay[d]) byDay[d]=[]; byDay[d].push([s.lat, s.lng]); } }); Object.keys(byDay).forEach(d => { let c = DAY_COLORS[d] ? DAY_COLORS[d].hex : '#999'; if(byDay[d].length > 1) MapCtrl.polylines.push(L.polyline(byDay[d], {color: c, weight: 3, opacity: 0.5, dashArray: '5, 10'}).addTo(MapCtrl.map)); }); },
    fitToStores: () => { if(State.stores.length > 0) { try { MapCtrl.map.fitBounds(L.latLngBounds(State.stores.map(s => [s.lat, s.lng])), {padding: [30, 30]}); } catch(e){} } },
    renderMarkers: () => {
        const dayOpts = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`).join('');
        State.stores.forEach(store => {
            let isAssigned = store.days.length > 0; let pDay = isAssigned ? store.days[0] : null; let fill = '#cbd5e1', border = '#fff', stroke = '2', zIdx = 1000;
            if (store.selected) { fill = '#facc15'; border = '#ca8a04'; stroke = '3'; zIdx = 2000; } else if (isAssigned && DAY_COLORS[pDay]) { fill = DAY_COLORS[pDay].hex; zIdx = 500; }
            let isR = isAssigned && store.days.includes(State.activeRoadDay); let seq = isR && store.seqs ? store.seqs[State.activeRoadDay] : null;
            let svgW = isR ? 30 : (isAssigned ? 26 : 30); let svgH = isR ? 44 : (isAssigned ? 36 : 44); if (isR) zIdx = 1500;
            let kpi = State.sales[store.id]; let kpiStar = (kpi && kpi.active) ? `<circle cx="20" cy="5" r="5" fill="#10b981" stroke="#fff" stroke-width="1.5"/>` : '';
            let iconTxt = isR && seq ? `<circle cx="12" cy="10" r="8" fill="#fff" /><text x="12" y="14" font-size="11" font-weight="900" fill="#000" text-anchor="middle">${seq}</text>` : (isAssigned ? `<text x="12" y="12" font-size="10" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">${String(pDay).replace('Day ','')}</text>` : `<circle cx="12" cy="9" r="3.5" fill="#fff" />`);
            let icon = L.divIcon({ html: `<svg viewBox="0 0 24 24" width="${svgW}" height="${svgH}" style="filter: drop-shadow(0px 3px 4px rgba(0,0,0,0.3)); overflow:visible;"><path d="M12 0C7.5 0 4 3.5 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z" fill="${fill}" stroke="${border}" stroke-width="${stroke}"/>${iconTxt}${kpiStar}</svg>`, className: 'custom-svg-icon', iconSize: [svgW, svgH], iconAnchor: [svgW/2, svgH], popupAnchor: [0, -svgH] });
            if (!MapCtrl.markers[store.id]) { MapCtrl.markers[store.id] = L.marker([store.lat, store.lng]).addTo(MapCtrl.map); MapCtrl.markers[store.id].on('popupopen', function() { if (this.customAssigned) UI.focusOnEditTab(this.customId); }); MapCtrl.markers[store.id].on('click', function() { if (!this.customAssigned && !Lasso.active) StoreMgr.toggleSelect(this.customId); }); }
            let m = MapCtrl.markers[store.id]; m.customId = store.id; m.customAssigned = isAssigned; m.setIcon(icon); m.setZIndexOffset(zIdx);
            let badge = store.freq === 2 ? `<span class="f2-badge">F2</span>` : '';
            let kpiHtml = kpi ? (kpi.active ? `<div class="bg-emerald-50 text-emerald-700 px-2 py-1.5 rounded-lg text-[10px] font-bold mt-2 border border-emerald-100 flex justify-between"><span>📦 ${kpi.vpo} ลัง</span><span>🏷️ ${kpi.skuCount} SKU</span></div>` : `<div class="bg-gray-100 text-gray-500 px-2 py-1 rounded-lg text-[10px] font-bold mt-2 text-center border border-gray-200">❌ Inactive</div>`) : '';
            if (isAssigned) {
                let dTxt = store.days.join(' & '); let drop = dayOpts.replace(`value="${pDay}"`, `value="${pDay}" selected`);
                let html = `<div class="text-sm min-w-[170px]"><b class="text-[14px] text-gray-800 block leading-tight mb-0.5">${store.name} ${badge}</b><span class="text-gray-400 text-[10px] font-mono block mb-2">ID: ${store.id}</span><div class="inline-block px-2 py-1 rounded text-white text-[11px] font-bold w-full text-center" style="background:${fill};">📅 ${dTxt}</div>${kpiHtml}<div class="mt-2 pt-2 border-t border-gray-100"><span class="text-[10px] text-gray-500 font-bold mb-1 block">แก้ไขสายวิ่ง:</span><select onchange="StoreMgr.changeDay('${store.id}', this.value)" class="w-full text-xs p-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none">${drop}<option disabled>---</option><option value="remove" class="text-red-500 font-bold">❌ ยกเลิกจัดสาย</option></select></div></div>`;
                if (!m.getPopup()) m.bindPopup(html, {autoPan: false, className: 'custom-popup'}); else m.setPopupContent(html);
            } else {
                if (m.getPopup()) m.unbindPopup();
                if (!m.getTooltip()) m.bindTooltip(`<b>${store.name}</b> ${badge}<br><span class="text-[10px] font-mono text-gray-400">${store.id}</span>${kpiHtml}`, {direction: 'top', offset: [0, -svgH]}); 
                else m.setTooltipContent(`<b>${store.name}</b> ${badge}<br><span class="text-[10px] font-mono text-gray-400">${store.id}</span>${kpiHtml}`);
            }
        });
    }
};

const Lasso = {
    active: false, pts: [], poly: null, mkrs: [],
    toggle: () => { Lasso.active = !Lasso.active; Lasso.active ? Lasso.start() : Lasso.cancel(); },
    start: () => { document.getElementById('lassoPanel').classList.remove('hidden'); document.getElementById('mapTools').classList.add('hidden'); document.getElementById('map').classList.add('draw-cursor'); MapCtrl.map.on('click', Lasso.addPt); },
    addPt: (e) => { Lasso.pts.push([e.latlng.lat, e.latlng.lng]); Lasso.mkrs.push(L.circleMarker(e.latlng, {radius: 4, color: '#ef4444'}).addTo(MapCtrl.map)); if(Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly); Lasso.poly = L.polyline(Lasso.pts, {color: '#4f46e5', weight:4, dashArray:'5, 8'}).addTo(MapCtrl.map); },
    cancel: () => { Lasso.active = false; Lasso.pts = []; if(Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly); Lasso.poly = null; Lasso.mkrs.forEach(m => MapCtrl.map.removeLayer(m)); Lasso.mkrs = []; document.getElementById('lassoPanel').classList.add('hidden'); document.getElementById('mapTools').classList.remove('hidden'); document.getElementById('map').classList.remove('draw-cursor'); MapCtrl.map.off('click', Lasso.addPt); },
    finish: () => { if(Lasso.pts.length < 3) return alert("วาดอย่างน้อย 3 จุด"); let c = 0; State.stores.forEach(s => { if(Lasso.isInside([s.lat, s.lng], Lasso.pts)) { s.selected = true; c++; } }); c > 0 ? UI.switchTab('tab2') : alert(`⚠️ ไม่พบร้านในพื้นที่`); Lasso.cancel(); UI.render(); App.saveDB(); },
    isInside: (pt, vs) => { let x=pt[0], y=pt[1], ins=false; for(let i=0, j=vs.length-1; i<vs.length; j=i++) { let xi=vs[i][0], yi=vs[i][1], xj=vs[j][0], yj=vs[j][1]; if(((yi>y)!=(yj>y)) && (x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins; } return ins; }
};

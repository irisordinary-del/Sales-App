var MapCtrl = {
    map: null, markers: [], roadLines: [],
    init: () => {
        if(MapCtrl.map) return;
        MapCtrl.map = L.map('map').setView([13.75, 100.5], 10);
        L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3'] }).addTo(MapCtrl.map);
    },
    renderMarkers: () => {
        if(!MapCtrl.map) return;
        MapCtrl.markers.forEach(m => MapCtrl.map.removeLayer(m));
        MapCtrl.markers = [];
        let opts = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`).join('');

        State.stores.forEach(s => {
            let lat = s.lat, lng = s.lng;
            if(Math.abs(lat) > 90) { let t=lat; lat=lng; lng=t; }
            let dKey = s.days[0];
            let color = (dKey && DAY_COLORS[dKey]) ? DAY_COLORS[dKey].hex : '#9CA3AF';
            
            let iconHtml = `
                <div style="position: relative; width: 28px; height: 38px; z-index: ${s.selected ? 1000 : 1};">
                    <div style="position: absolute; top: 0; left: 0; width: 28px; height: 28px; background-color: ${color}; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid ${s.selected?'#000':'#fff'}; box-shadow: 2px 2px 5px rgba(0,0,0,0.4);"></div>
                    <div style="position: absolute; top: 0; left: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 900; z-index: 2;">${dKey?dKey.replace('Day ',''):''}</div>
                </div>`;
                
            let icon = L.divIcon({ html: iconHtml, className: '', iconSize: [28,38], iconAnchor: [14,38] });
            let m = L.marker([lat, lng], {icon:icon}).addTo(MapCtrl.map);
            m.bindPopup(`
                <div style="min-width: 150px; font-family: sans-serif;">
                    <b>${s.name}</b><br><small>ID: ${s.id}</small>
                    <select onchange="StoreMgr.changeDay('${s.id}', this.value)" style="width:100%; margin-top:8px; padding:4px;">
                        <option value="remove">-- ถอดออก --</option>
                        ${opts.replace(`value="${dKey}"`, `value="${dKey}" selected`)}
                    </select>
                </div>`);
            MapCtrl.markers.push(m);
        });
    },
    fit: () => {
        if(!MapCtrl.markers.length) return;
        let bounds = L.featureGroup(MapCtrl.markers).getBounds();
        if(bounds.isValid()) MapCtrl.map.fitBounds(bounds, {padding:[40,40]});
    }
};

var Lasso = {
    active: false, poly: null, pts: [],
    toggle: () => {
        Lasso.active = !Lasso.active;
        if(Lasso.active) { MapCtrl.map.dragging.disable(); document.getElementById('lassoPanel').classList.remove('hidden'); MapCtrl.map.on('mousedown', Lasso.down); } 
        else Lasso.cancel();
    },
    down: (e) => {
        Lasso.pts = [e.latlng];
        if(Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly);
        Lasso.poly = L.polyline(Lasso.pts, {color:'#3b82f6', dashArray:'5,5', weight:3}).addTo(MapCtrl.map);
        MapCtrl.map.on('mousemove', Lasso.move); MapCtrl.map.on('mouseup', Lasso.up);
    },
    move: (e) => { Lasso.pts.push(e.latlng); Lasso.poly.setLatLngs(Lasso.pts); },
    up: () => { MapCtrl.map.off('mousemove', Lasso.move); MapCtrl.map.off('mouseup', Lasso.up); Lasso.poly.addLatLng(Lasso.pts[0]); },
    finish: () => {
        State.stores.forEach(s => { 
            let lat = s.lat, lng = s.lng;
            if(Math.abs(lat) > 90) { let t=lat; lat=lng; lng=t; }
            if(Lasso.isPtInPoly(L.latLng(lat, lng), Lasso.pts)) s.selected = true; 
        });
        Lasso.cancel(); UI.render(); UI.switchTab('tab2');
    },
    cancel: () => {
        Lasso.active = false; MapCtrl.map.dragging.enable(); document.getElementById('lassoPanel').classList.add('hidden');
        if(Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly); MapCtrl.map.off('mousedown', Lasso.down);
    },
    isPtInPoly: (pt, poly) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            if (((poly[i].lat > pt.lat) != (poly[j].lat > pt.lat)) && (pt.lng < (poly[j].lng - poly[i].lng) * (pt.lat - poly[i].lat) / (poly[j].lat - poly[i].lat) + poly[i].lng)) inside = !inside;
        }
        return inside;
    }
};

var OSRM = {
    generate: async () => {
        let ss = State.stores.filter(x => x.days.includes(State.openModalDay));
        if(ss.length < 2) return alert("ต้องมีอย่างน้อย 2 ร้าน");
        UI.showLoader("กำลังวาดเส้นถนน...");
        try {
            let res = await fetch(`https://router.project-osrm.org/route/v1/driving/${ss.map(x=>`${x.lng},${x.lat}`).join(';')}?overview=full&geometries=geojson`);
            let data = await res.json();
            if(data.code === 'Ok') {
                MapCtrl.roadLines.forEach(l => MapCtrl.map.removeLayer(l));
                let line = L.polyline(data.routes[0].geometry.coordinates.map(x=>[x[1],x[0]]), {color: DAY_COLORS[State.openModalDay].hex, weight:5, opacity:0.8}).addTo(MapCtrl.map);
                MapCtrl.roadLines.push(line); MapCtrl.map.fitBounds(line.getBounds());
            }
        } catch(e) { alert("เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ถนน"); }
        UI.hideLoader(); UI.closeDayModal();
    }
};

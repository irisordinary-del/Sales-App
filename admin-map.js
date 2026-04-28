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
        GlobalState.stores.forEach(s => {
            if(!s.lat || !s.lng) return;
            let lat = s.lat, lng = s.lng;
            if(Math.abs(lat) > 90) { let t=lat; lat=lng; lng=t; }
            let color = (s.days[0] && typeof DAY_COLORS !== 'undefined') ? DAY_COLORS[s.days[0]].hex : '#94a3b8';
            let icon = L.divIcon({
                html: `<div style="background:${color}; width:22px; height:22px; border-radius:50%; border:2px solid ${s.selected?'#000':'#fff'}; display:flex; align-items:center; justify-content:center; color:white; font-size:9px; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.3)">${s.days[0]?s.days[0].replace('Day ',''):''}</div>`,
                className: '', iconSize:[22,22], iconAnchor:[11,11]
            });
            let m = L.marker([lat, lng], {icon:icon}).addTo(MapCtrl.map);
            m.bindPopup(`<b>${s.name}</b><br>ID: ${s.id}`);
            MapCtrl.markers.push(m);
        });
    },
    fit: () => { if(MapCtrl.markers.length) L.featureGroup(MapCtrl.markers).getBounds().isValid() && MapCtrl.map.fitBounds(L.featureGroup(MapCtrl.markers).getBounds(), {padding:[40,40]}); }
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
        GlobalState.stores.forEach(s => { 
            let lat = s.lat, lng = s.lng;
            if(Math.abs(lat) > 90) { let t=lat; lat=lng; lng=t; }
            if(Lasso.isPtInPoly(L.latLng(lat, lng), Lasso.pts)) s.selected = true; 
        });
        Lasso.cancel(); if (typeof UI !== 'undefined') { UI.render(); UI.switchTab('tab2'); }
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
        let ss = GlobalState.stores.filter(x => x.days.includes(GlobalState.openModalDay));
        if(ss.length < 2) return alert("ต้องการ 2 ร้านขึ้นไป");
        if (typeof UI !== 'undefined') UI.showLoader("กำลังวาดเส้นถนน...");
        try {
            let res = await fetch(`https://router.project-osrm.org/route/v1/driving/${ss.map(x=>`${x.lng},${x.lat}`).join(';')}?overview=full&geometries=geojson`);
            let data = await res.json();
            if(data.code === 'Ok') {
                MapCtrl.roadLines.forEach(l => MapCtrl.map.removeLayer(l));
                let line = L.polyline(data.routes[0].geometry.coordinates.map(x=>[x[1],x[0]]), {color: DAY_COLORS[GlobalState.openModalDay].hex, weight:5, opacity:0.7}).addTo(MapCtrl.map);
                MapCtrl.roadLines.push(line); MapCtrl.map.fitBounds(line.getBounds());
            }
        } catch(e) {}
        if (typeof UI !== 'undefined') { UI.hideLoader(); UI.closeDayModal(); }
    }
};

// ==========================================
// ✏️ Lasso Tool (วาดเลือกพื้นที่)
// ==========================================
const Lasso = {
    active: false,
    pts: [],
    poly: null,
    mkrs: [],

    toggle: () => {
        Lasso.active = !Lasso.active;
        Lasso.active ? Lasso.start() : Lasso.cancel();
    },

    start: () => {
        const lassoPanel = document.getElementById('lassoPanel');
        const mapTools = document.getElementById('mapTools');
        if (lassoPanel) lassoPanel.classList.remove('hidden');
        if (mapTools) mapTools.classList.add('hidden');
        document.getElementById('map').classList.add('draw-cursor');
        MapCtrl.map.on('click', Lasso.addPt);
    },

    addPt: (e) => {
        Lasso.pts.push([e.latlng.lat, e.latlng.lng]);
        Lasso.mkrs.push(
            L.circleMarker(e.latlng, { radius: 4, color: '#ef4444' }).addTo(MapCtrl.map)
        );
        if (Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly);
        Lasso.poly = L.polyline(Lasso.pts, { color: '#4f46e5', weight: 4, dashArray: '5, 8' })
            .addTo(MapCtrl.map);
    },

    cancel: () => {
        Lasso.active = false;
        Lasso.pts = [];
        if (Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly);
        Lasso.poly = null;
        Lasso.mkrs.forEach(m => MapCtrl.map.removeLayer(m));
        Lasso.mkrs = [];

        const lassoPanel = document.getElementById('lassoPanel');
        const mapTools = document.getElementById('mapTools');
        if (lassoPanel) lassoPanel.classList.add('hidden');
        if (mapTools) mapTools.classList.remove('hidden');
        document.getElementById('map').classList.remove('draw-cursor');
        MapCtrl.map.off('click', Lasso.addPt);
    },

    finish: () => {
        if (Lasso.pts.length < 3) return alert('วาดอย่างน้อย 3 จุดครับ');
        let c = 0;
        State.stores.forEach(s => {
            if (Lasso.isInside([s.lat, s.lng], Lasso.pts)) {
                s.selected = true;
                c++;
            }
        });
        Lasso.cancel();
        if (c > 0) {
            UI.switchTab('tab2');
        } else {
            alert('⚠️ ไม่พบร้านในพื้นที่ที่วาดครับ');
        }
        UI.render();
        App.saveDB();
    },

    isInside: (pt, vs) => {
        let x = pt[0], y = pt[1], ins = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i][0], yi = vs[i][1], xj = vs[j][0], yj = vs[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
                ins = !ins;
            }
        }
        return ins;
    }
};

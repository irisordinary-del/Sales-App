window.MapCtrl = {
    map: null,
    markers: {},
    roadLayer: null,
    polylines: [],
    
    init: function() {
        console.log('🗺️ Initializing map...');
        try {
            this.map = L.map('map').setView([14.4745, 100.1222], 10);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: '© OpenStreetMap'
            }).addTo(this.map);
            console.log('✅ Map initialized');
        } catch(err) {
            console.error('❌ Map init error:', err);
        }
    },
    
    renderMarkers: function() {
        const self = this;
        State.stores.forEach(store => {
            const lat = parseFloat(store.lat);
            const lng = parseFloat(store.lng);
            
            if (isNaN(lat) || isNaN(lng)) return;
            
            const isAssigned = store.days.length > 0;
            const color = isAssigned ? DAY_COLORS[store.days[0]]?.hex : '#cbd5e1';
            
            const icon = L.divIcon({
                html: `<div style="background:${color}; color:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px; box-shadow:0 2px 4px rgba(0,0,0,0.3);">${store.name.substring(0,1)}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
            
            if (!this.markers[store.id]) {
                this.markers[store.id] = L.marker([lat, lng], {icon: icon}).addTo(this.map);
                this.markers[store.id].bindPopup(`<b>${store.name}</b><br>Code: ${store.code}`);
            }
        });
    },
    
    fitToStores: function() {
        if (State.stores.length === 0) return;
        try {
            const bounds = L.latLngBounds(State.stores.map(s => [s.lat, s.lng]));
            this.map.fitBounds(bounds, {padding: [50, 50]});
        } catch(e) {}
    },
    
    clearAll: function() {
        for (let id in this.markers) {
            this.map.removeLayer(this.markers[id]);
        }
        this.markers = {};
    }
};

window.Lasso = {
    active: false,
    pts: [],
    poly: null,
    
    toggle: function() {
        this.active ? this.cancel() : this.start();
        this.active = !this.active;
    },
    
    start: function() {
        document.getElementById('lassoPanel')?.classList.remove('hidden');
    },
    
    cancel: function() {
        this.active = false;
        this.pts = [];
        document.getElementById('lassoPanel')?.classList.add('hidden');
    },
    
    finish: function() {
        console.log('Lasso finished');
        this.cancel();
    }
};

console.log('✅ MapCtrl loaded');

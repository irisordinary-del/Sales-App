/**
 * App Object - Route Management Functions
 * Must load BEFORE FEATURES_IMPLEMENTATION.js
 */

// Ensure App object exists and has core methods
if (!window.App) {
    window.App = {};
}

// Add upload method if doesn't exist
if (!window.App.uploadAndParseFile) {
    window.App.uploadAndParseFile = async function(file) {
        if (!file) return;
        
        try {
            UI.showLoader('กำลังอ่านไฟล์...', file.name);
            
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { header: 'A' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
            
            let stores = [];
            rows.forEach((row, idx) => {
                if (!row.B || idx === 0) return;
                
                stores.push({
                    id: row.B,
                    code: row.B,
                    name: row.C || '',
                    salesCode: row.D || '',
                    shopType: row.E || '',
                    subDistrict: row.F || '',
                    district: row.G || '',
                    province: row.H || '',
                    lat: parseFloat(row.I) || 0,
                    lng: parseFloat(row.J) || 0,
                    marketName: row.K || '',
                    dayOriginal: row.L || '',
                    days: [],
                    seqs: {},
                    freq: 1,
                    selected: false
                });
            });
            
            if (stores.length === 0) {
                UI.hideLoader();
                UI.showSaveToast('⚠️ ไม่พบข้อมูลร้านค้า');
                return;
            }
            
            const routeName = `Route_${stores[0].salesCode?.substring(0, 3) || 'NEW'}`;
            
            State.db.routes[routeName] = stores;
            State.localActiveRoute = routeName;
            State.stores = stores;
            
            App.refreshRouteSelector();
            await App.saveDB();
            
            UI.hideLoader();
            UI.showSaveToast(`✅ อัพโหลด: ${stores.length} แถว`);
            UI.render();
            
            setTimeout(() => {
                if (MapCtrl && MapCtrl.map) {
                    MapCtrl.fitToStores();
                }
            }, 500);
            
        } catch(err) {
            UI.hideLoader();
            console.error('❌ Upload error:', err);
            UI.showSaveToast('❌ อ่านไฟล์ไม่สำเร็จ: ' + err.message);
        }
    };
}

// Add other App methods
if (!window.App.saveDB) {
    window.App.saveDB = async function() {
        try {
            const docRef = firebase.firestore().collection('appData').doc('v1_main');
            
            for (let routeName in State.db.routes) {
                const routeRef = docRef.collection('routes').doc(routeName);
                await routeRef.set({
                    routeName: routeName,
                    stores: State.db.routes[routeName],
                    updatedAt: new Date(),
                    storeCount: State.db.routes[routeName].length
                }, { merge: true });
            }
            
            console.log('✅ DB Saved');
        } catch(err) {
            console.error('❌ Save DB error:', err);
        }
    };
}

if (!window.App.refreshRouteSelector) {
    window.App.refreshRouteSelector = function() {
        const selector = document.getElementById('routeSelector');
        if (!selector) return;
        
        selector.innerHTML = Object.keys(State.db.routes)
            .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }))
            .map(r => `<option value="${r}" ${r === State.localActiveRoute ? 'selected' : ''}>${r}</option>`)
            .join('');
    };
}

if (!window.App.switchRoute) {
    window.App.switchRoute = function(routeName) {
        if (!routeName || !State.db.routes[routeName]) return;
        State.localActiveRoute = routeName;
        State.stores = State.db.routes[routeName];
        UI.render();
        if (MapCtrl && MapCtrl.map) {
            setTimeout(() => MapCtrl.fitToStores(), 100);
        }
    };
}

if (!window.App.addRoute) {
    window.App.addRoute = function() {
        const name = prompt('ชื่อสาย (เช่น Route_402):');
        if (!name) return;
        if (State.db.routes[name]) { alert('สายนี้มีอยู่แล้ว'); return; }
        State.db.routes[name] = [];
        State.localActiveRoute = name;
        State.stores = [];
        App.refreshRouteSelector();
        App.saveDB();
        UI.render();
    };
}

if (!window.App.renameRoute) {
    window.App.renameRoute = function() {
        if (!State.localActiveRoute) return;
        const newName = prompt('ชื่อสายใหม่:', State.localActiveRoute);
        if (!newName || newName === State.localActiveRoute) return;
        if (State.db.routes[newName]) { alert('ชื่อนี้มีอยู่แล้ว'); return; }
        State.db.routes[newName] = State.db.routes[State.localActiveRoute];
        delete State.db.routes[State.localActiveRoute];
        State.localActiveRoute = newName;
        App.refreshRouteSelector();
        App.saveDB();
    };
}

if (!window.App.deleteRoute) {
    window.App.deleteRoute = function() {
        if (!State.localActiveRoute) return;
        if (!confirm(`ลบ ${State.localActiveRoute} ใช่ไหม?`)) return;
        delete State.db.routes[State.localActiveRoute];
        const routes = Object.keys(State.db.routes);
        State.localActiveRoute = routes.length > 0 ? routes[0] : null;
        State.stores = State.localActiveRoute ? State.db.routes[routes[0]] : [];
        App.refreshRouteSelector();
        App.saveDB();
        UI.render();
    };
}

if (!window.App.clearStores) {
    window.App.clearStores = function() {
        if (!confirm(`ล้างร้านค้าทั้งหมดใน ${State.localActiveRoute} ใช่ไหม?`)) return;
        State.db.routes[State.localActiveRoute] = [];
        State.stores = [];
        App.saveDB();
        UI.render();
    };
}

console.log('✅ App object loaded with uploadAndParseFile');

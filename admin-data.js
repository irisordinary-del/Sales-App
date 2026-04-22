// ==========================================
// 🗄️ admin-data.js: จัดการฐานข้อมูล (Firebase/Excel)
// ==========================================

var State = { stores: [], sales: {}, db: { routes: {}, cycleDays: 24 }, localActiveRoute: "402V02", activeRoadDay: null, openDayModal: null };

var App = {
    dbRef: null,
    init: () => {
        if (typeof MapCtrl !== 'undefined' && MapCtrl.init && !MapCtrl.map) MapCtrl.init();
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            console.warn("เข้าสู่โหมดออฟไลน์ (ไม่พบ Firebase)");
            State.db = { routes: { "Offline Route": [] }, cycleDays: 24 };
            App.updateRouteSelector(); App.switchRoute("Offline Route");
            if(typeof ExcelIO !== 'undefined') ExcelIO.init();
            return;
        }
        App.dbRef = firebase.firestore().collection('sales_app').doc('main_data');
        if(typeof UI !== 'undefined' && UI.showLoader) UI.showLoader("กำลังโหลดข้อมูล...", "เชื่อมต่อคลาวด์");
        App.loadDB();
        if(typeof ExcelIO !== 'undefined') ExcelIO.init();
    },
    loadDB: () => {
        App.dbRef.get().then(doc => {
            if (doc.exists) {
                State.db = doc.data();
                if (!State.db.routes) State.db.routes = {};
                let routes = Object.keys(State.db.routes);
                if (routes.length === 0) { State.db.routes["Default"] = []; routes = ["Default"]; }
                if (!routes.includes(State.localActiveRoute)) State.localActiveRoute = routes[0];
                App.updateRouteSelector(); App.switchRoute(State.localActiveRoute);
            } else {
                State.db = { routes: { "Default": [] }, cycleDays: 24 };
                App.updateRouteSelector(); App.switchRoute("Default");
            }
            if(typeof UI !== 'undefined' && UI.hideLoader) UI.hideLoader();
        }).catch(err => {
            if(typeof UI !== 'undefined' && UI.hideLoader) UI.hideLoader();
            State.db = { routes: { "Error Route": [] }, cycleDays: 24 };
            App.updateRouteSelector(); App.switchRoute("Error Route");
        });
    },
    saveDB: () => {
        if (!State.localActiveRoute || !App.dbRef) return;
        State.db.routes[State.localActiveRoute] = State.stores;
        App.updateStatusUI("⏳ กำลังบันทึก...", "yellow");
        App.dbRef.set(State.db).then(() => {
            App.updateStatusUI("✅ บันทึกสำเร็จ", "emerald");
            if(typeof UI !== 'undefined' && UI.showSaveToast) UI.showSaveToast("บันทึกเรียบร้อย");
        }).catch(err => App.updateStatusUI("❌ บันทึกล้มเหลว", "red"));
    },
    updateRouteSelector: () => {
        let sel = document.getElementById('routeSelector'); if(!sel) return;
        let routes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true}));
        sel.innerHTML = routes.map(r => `<option value="${r}">${r}</option>`).join('');
        sel.value = State.localActiveRoute;
    },
    switchRoute: (routeName) => {
        State.localActiveRoute = routeName;
        State.stores = State.db.routes[routeName] || [];
        State.stores.forEach(s => s.selected = false);
        if (typeof UI !== 'undefined' && UI.render) UI.render();
        if (typeof MapCtrl !== 'undefined' && MapCtrl.fitToStores) MapCtrl.fitToStores();
        let sel = document.getElementById('routeSelector'); if(sel) sel.value = routeName;
    },
    addRoute: () => {
        let name = prompt("ตั้งชื่อสายวิ่งใหม่:"); if (!name || name.trim() === "") return; name = name.trim();
        if (State.db.routes[name]) return alert("มีชื่อสายนี้แล้ว");
        State.db.routes[name] = []; App.updateRouteSelector(); App.switchRoute(name); App.saveDB();
    },
    renameRoute: () => {
        let oldName = State.localActiveRoute, newName = prompt("เปลี่ยนชื่อ:", oldName);
        if (!newName || newName.trim() === "" || newName === oldName) return; newName = newName.trim();
        if (State.db.routes[newName]) return alert("มีชื่อสายนี้แล้ว");
        State.db.routes[newName] = State.db.routes[oldName]; delete State.db.routes[oldName];
        App.updateRouteSelector(); App.switchRoute(newName); App.saveDB();
    },
    deleteRoute: () => {
        if (!confirm(`ยืนยันลบสาย "${State.localActiveRoute}" ใช่หรือไม่?`)) return;
        delete State.db.routes[State.localActiveRoute];
        let remain = Object.keys(State.db.routes);
        if (remain.length === 0) { State.db.routes["Default"] = []; remain = ["Default"]; }
        App.updateRouteSelector(); App.switchRoute(remain[0]); App.saveDB();
    },
    clearStores: () => {
        if (!confirm(`ล้างข้อมูลในสาย "${State.localActiveRoute}" ทั้งหมด?`)) return;
        State.stores = []; App.saveDB(); if(typeof UI !== 'undefined' && UI.render) UI.render();
    },
    updateStatusUI: (text, color) => {
        let el = document.getElementById('db-save-status'); if (!el) return;
        el.className = `flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border bg-${color}-50 text-${color}-600 border-${color}-200`;
        el.innerHTML = text;
        if(color === 'emerald') setTimeout(() => { el.classList.remove('flex'); el.classList.add('hidden'); }, 3000);
    }
};

var StoreMgr = {
    toggleSelect: (id) => { let s = State.stores.find(x => x.id === id); if(s) s.selected = !s.selected; if(typeof UI !== 'undefined') UI.render(); },
    clearSelection: () => { State.stores.forEach(s => s.selected = false); if(typeof UI !== 'undefined') UI.render(); },
    assignSelected: () => {
        let day = document.getElementById('assign-day').value, count = 0;
        State.stores.forEach(s => {
            if(s.selected) { s.days = [day]; s.selected = false; count++; }
        });
        if(count > 0) { App.saveDB(); if(typeof UI !== 'undefined') UI.render(); } else alert("เลือกร้านค้าก่อนจัดวัน");
    },
    changeDay: (id, day) => {
        let s = State.stores.find(x => x.id === id); if(!s) return;
        s.days = day === 'remove' ? [] : [day];
        App.saveDB(); if(typeof UI !== 'undefined') UI.render();
    }
};

var ExcelIO = {
    init: () => { let el = document.getElementById('fileUpload'); if(el) el.addEventListener('change', ExcelIO.importMap); },
    importMap: (e) => {
        let file = e.target.files[0]; if(!file) return;
        if(typeof UI !== 'undefined') UI.showLoader("อ่านไฟล์...", "ตรวจสอบข้อมูล");
        let reader = new FileReader();
        reader.onload = (evt) => {
            try {
                let data = new Uint8Array(evt.target.result), wb = XLSX.read(data, {type: 'array'});
                let rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]), newStores = [];
                rows.forEach(r => {
                    let id = r['รหัสร้านค้า'] || r['ID'] || r['id'];
                    let name = r['ชื่อร้านค้า'] || r['Name'] || r['name'];
                    let lat = r['Lat'] || r['lat'], lng = r['Lng'] || r['lng'], dayRaw = r['Day'] || r['วันวิ่งคิว'] || r['วัน'] || r['day'];
                    if(!id || !name || lat === undefined || lng === undefined) return;
                    let latF = parseFloat(lat), lngF = parseFloat(lng); if(isNaN(latF) || isNaN(lngF)) return;
                    let days = [];
                    if(dayRaw) { let m = String(dayRaw).match(/\d+/); if(m && parseInt(m[0])<=30) days = [`Day ${parseInt(m[0])}`]; }
                    newStores.push({ id: String(id), name: String(name), lat: latF, lng: lngF, days: days, selected: false });
                });
                State.stores = newStores; App.saveDB();
                if(typeof UI !== 'undefined') { UI.render(); UI.hideLoader(); UI.showSaveToast(`นำเข้า ${newStores.length} ร้าน`); }
                if(typeof MapCtrl !== 'undefined') MapCtrl.fitToStores();
            } catch(err) { if(typeof UI !== 'undefined') UI.hideLoader(); alert("Error: " + err.message); }
        };
        reader.readAsArrayBuffer(file); e.target.value = '';
    },
    export: () => {
        if(!State.stores.length) return alert("ไม่มีข้อมูล");
        let exp = State.stores.map(s => ({ 'รหัสร้านค้า': s.id, 'ชื่อร้านค้า': s.name, 'Lat': s.lat, 'Lng': s.lng, 'วันวิ่งคิว': s.days.length ? parseInt(s.days[0].replace('Day ','')) : '' }));
        let ws = XLSX.utils.json_to_sheet(exp), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Routes"); XLSX.writeFile(wb, `Route_${State.localActiveRoute}.xlsx`);
    }
};

if (typeof RawDataMgr === 'undefined') { window.RawDataMgr = { clearAll: () => {}, applyImport: () => {} }; }
if (typeof KPIMgr === 'undefined') { window.KPIMgr = { renderSetup: () => {}, calculatePreview: () => {}, deployToSales: () => {} }; }

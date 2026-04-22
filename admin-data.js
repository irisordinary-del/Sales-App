// ==========================================
// 🗄️ admin-data.js: จัดการข้อมูลและ Excel
// ==========================================

// 🛡️ ป้องกัน Error 'State' has already been declared
if (typeof State === 'undefined') {
    var State = {
        stores: [], sales: {}, db: { routes: {}, cycleDays: 24 },
        localActiveRoute: "402V02", activeRoadDay: null, openDayModal: null
    };
}

var App = {
    dbRef: null,
    init: () => {
        // ปลุกแผนที่และเมนู
        if (typeof MapCtrl !== 'undefined' && MapCtrl.init) MapCtrl.init();
        
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            console.warn("Offline Mode: Firebase not found");
            App.switchRoute("Offline Route");
            if (typeof ExcelIO !== 'undefined') ExcelIO.init();
            return;
        }
        
        App.dbRef = firebase.firestore().collection('sales_app').doc('main_data');
        if (typeof UI !== 'undefined' && UI.showLoader) UI.showLoader("กำลังโหลดข้อมูล...", "Cloud Sync");
        App.loadDB();
        if (typeof ExcelIO !== 'undefined') ExcelIO.init();
    },
    loadDB: () => {
        App.dbRef.get().then(doc => {
            if (doc.exists) {
                State.db = doc.data();
                let routes = Object.keys(State.db.routes || {});
                if (!routes.length) { State.db.routes = {"Default":[]}; routes=["Default"]; }
                if (!routes.includes(State.localActiveRoute)) State.localActiveRoute = routes[0];
                App.updateRouteSelector();
                App.switchRoute(State.localActiveRoute);
            }
            if (typeof UI !== 'undefined' && UI.hideLoader) UI.hideLoader();
        }).catch(e => { if (typeof UI !== 'undefined') UI.hideLoader(); App.switchRoute("Error Route"); });
    },
    saveDB: () => {
        if (!App.dbRef) return;
        State.db.routes[State.localActiveRoute] = State.stores;
        App.updateStatusUI("⏳ บันทึก...", "yellow");
        App.dbRef.set(State.db).then(() => {
            App.updateStatusUI("✅ สำเร็จ", "emerald");
            if (typeof UI !== 'undefined' && UI.showSaveToast) UI.showSaveToast("บันทึกสำเร็จ");
        });
    },
    updateRouteSelector: () => {
        let sel = document.getElementById('routeSelector');
        if(!sel) return;
        let r = Object.keys(State.db.routes).sort((a,b)=>a.localeCompare(b,'th',{numeric:true}));
        sel.innerHTML = r.map(x=>`<option value="${x}">${x}</option>`).join('');
        sel.value = State.localActiveRoute;
    },
    switchRoute: (n) => {
        State.localActiveRoute = n;
        State.stores = State.db.routes[n] || [];
        State.stores.forEach(s => s.selected = false);
        if (typeof UI !== 'undefined' && UI.render) UI.render();
        if (typeof MapCtrl !== 'undefined' && MapCtrl.fitToStores) MapCtrl.fitToStores();
    },
    updateStatusUI: (t, c) => {
        let el = document.getElementById('db-save-status');
        if(!el) return;
        el.className = `flex items-center gap-1 text-xs font-bold px-2 py-1 rounded bg-${c}-50 text-${c}-600`;
        el.innerHTML = t;
    }
};

var StoreMgr = {
    toggleSelect: (id) => {
        let s = State.stores.find(x => x.id === id);
        if(s) s.selected = !s.selected;
        if (typeof UI !== 'undefined') UI.render();
    },
    changeDay: (id, d) => {
        let s = State.stores.find(x => x.id === id);
        if(!s) return;
        s.days = (d === 'remove') ? [] : [d];
        App.saveDB();
        if (typeof UI !== 'undefined') UI.render();
    }
};

var ExcelIO = {
    init: () => {
        let el = document.getElementById('fileUpload');
        if (el) el.addEventListener('change', ExcelIO.importMap);
    },
    importMap: (e) => {
        let file = e.target.files[0]; if(!file) return;
        let reader = new FileReader();
        reader.onload = (evt) => {
            let data = new Uint8Array(evt.target.result);
            let wb = XLSX.read(data, {type:'array'});
            let rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            let newStores = [];
            rows.forEach(r => {
                let id = r['รหัสร้านค้า'] || r['ID'] || r['id'];
                let name = r['ชื่อร้านค้า'] || r['Name'] || r['name'];
                let lat = r['Lat'] || r['lat'];
                let lng = r['Lng'] || r['lng'];
                let dayRaw = r['Day'] || r['วัน'] || r['day'];
                if(!id || !name || !lat || !lng) return;
                let days = [];
                if(dayRaw) {
                    let m = String(dayRaw).match(/\d+/);
                    if(m) days = [`Day ${m[0]}`];
                }
                newStores.push({ id:String(id), name:String(name), lat:parseFloat(lat), lng:parseFloat(lng), days:days, selected:false });
            });
            State.stores = newStores;
            App.saveDB();
            UI.render();
            MapCtrl.fitToStores();
        };
        reader.readAsArrayBuffer(file);
    }
};

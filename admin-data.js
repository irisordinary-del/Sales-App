if (typeof GlobalState === 'undefined') {
    var GlobalState = { stores: [], db: { routes: {} }, currentRoute: "402V02", openModalDay: null };
}

var App = {
    dbRef: null,
    init: () => {
        if (typeof MapCtrl !== 'undefined') MapCtrl.init();
        if (typeof firebase === 'undefined' || !firebase.apps.length) return;
        App.dbRef = firebase.firestore().collection('sales_app').doc('main_data');
        App.loadDB();
        if (typeof ExcelIO !== 'undefined') ExcelIO.init();
    },
    loadDB: () => {
        if (typeof UI !== 'undefined') UI.showLoader("กำลังเชื่อมคลาวด์...");
        App.dbRef.get().then(doc => {
            if (doc.exists) {
                GlobalState.db = doc.data();
                let keys = Object.keys(GlobalState.db.routes || {});
                if (!keys.length) { GlobalState.db.routes = {"Default":[]}; keys=["Default"]; }
                if (!keys.includes(GlobalState.currentRoute)) GlobalState.currentRoute = keys[0];
                App.updateSelector();
                App.switchRoute(GlobalState.currentRoute);
            }
            if (typeof UI !== 'undefined') UI.hideLoader();
        });
    },
    saveDB: () => {
        GlobalState.db.routes[GlobalState.currentRoute] = GlobalState.stores;
        App.dbRef.set(GlobalState.db).then(() => { if (typeof UI !== 'undefined') UI.showStatus("✅ บันทึกแล้ว", "emerald"); });
    },
    switchRoute: (name) => {
        GlobalState.currentRoute = name;
        GlobalState.stores = GlobalState.db.routes[name] || [];
        GlobalState.stores.forEach(s => s.selected = false);
        if (typeof UI !== 'undefined') UI.render();
        if (typeof MapCtrl !== 'undefined') MapCtrl.fit();
    },
    updateSelector: () => {
        let el = document.getElementById('routeSelector');
        if(!el) return;
        let r = Object.keys(GlobalState.db.routes).sort();
        el.innerHTML = r.map(x => `<option value="${x}">${x}</option>`).join('');
        el.value = GlobalState.currentRoute;
    },
    addRoute: () => {
        let n = prompt("ชื่อสายใหม่:");
        if (n) { GlobalState.db.routes[n] = []; App.updateSelector(); App.switchRoute(n); App.saveDB(); }
    }
};

var ExcelIO = {
    init: () => {
        let el = document.getElementById('fileUpload');
        if (el) el.onchange = (e) => {
            let reader = new FileReader();
            reader.onload = (evt) => {
                let wb = XLSX.read(new Uint8Array(evt.target.result), {type:'array'});
                let rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                GlobalState.stores = rows.map(r => {
                    let dRaw = r['Day'] || r['day'] || r['วัน'] || '';
                    let days = [];
                    let m = String(dRaw).match(/\d+/);
                    if(m) days = [`Day ${m[0]}`];
                    return {
                        id: String(r['ID'] || r['id'] || ''),
                        name: String(r['Name'] || r['name'] || 'ไม่มีชื่อ'),
                        lat: parseFloat(r['Lat'] || r['lat']),
                        lng: parseFloat(r['Lng'] || r['lng']),
                        days: days, selected: false
                    };
                });
                App.saveDB(); if (typeof UI !== 'undefined') UI.render();
            };
            reader.readAsArrayBuffer(e.target.files[0]);
        };
    },
    export: () => {
        let data = GlobalState.stores.map(s => ({ "ID": s.id, "Name": s.name, "Lat": s.lat, "Lng": s.lng, "Day": s.days[0] }));
        let ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        XLSX.writeFile(wb, `Export_${GlobalState.currentRoute}.xlsx`);
    }
};

var StoreMgr = {
    toggleSelect: (id) => {
        let s = GlobalState.stores.find(x => x.id === id);
        if(s) s.selected = !s.selected;
        if (typeof UI !== 'undefined') UI.render();
    },
    assignSelected: () => {
        let d = document.getElementById('assign-day').value;
        GlobalState.stores.forEach(s => { if(s.selected) { s.days = [d]; s.selected = false; } });
        App.saveDB(); if (typeof UI !== 'undefined') UI.render();
    },
    changeDay: (id, day) => {
        let s = GlobalState.stores.find(x => x.id === id);
        if(!s) return;
        s.days = (day === 'remove') ? [] : [day];
        App.saveDB(); if (typeof UI !== 'undefined') UI.render();
    }
};

// 🛡️ ป้องกันการประกาศตัวแปรซ้ำ (Fresh State)
if (typeof GlobalState === 'undefined') {
    var GlobalState = {
        stores: [], db: { routes: {} }, currentRoute: "402V02", openModalDay: null
    };
}

var App = {
    dbRef: null,
    init: () => {
        if (typeof MapCtrl !== 'undefined') MapCtrl.init();
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            console.error("Firebase Config Missing");
            App.switchRoute("Default");
            return;
        }
        App.dbRef = firebase.firestore().collection('sales_app').doc('main_data');
        App.loadDB();
        ExcelIO.init();
    },
    loadDB: () => {
        UI.showLoader("กำลังเชื่อมต่อคลาวด์...");
        App.dbRef.get().then(doc => {
            if (doc.exists) {
                GlobalState.db = doc.data();
                let r = Object.keys(GlobalState.db.routes || {});
                if (!r.length) { GlobalState.db.routes = {"Default":[]}; r=["Default"]; }
                if (!r.includes(GlobalState.currentRoute)) GlobalState.currentRoute = r[0];
                App.updateSelector();
                App.switchRoute(GlobalState.currentRoute);
            }
            UI.hideLoader();
        }).catch(e => { UI.hideLoader(); alert("โหลดข้อมูลไม่สำเร็จ"); });
    },
    saveDB: () => {
        GlobalState.db.routes[GlobalState.currentRoute] = GlobalState.stores;
        App.dbRef.set(GlobalState.db).then(() => UI.showStatus("✅ บันทึกแล้ว", "emerald"));
    },
    switchRoute: (name) => {
        GlobalState.currentRoute = name;
        GlobalState.stores = GlobalState.db.routes[name] || [];
        GlobalState.stores.forEach(s => s.selected = false);
        UI.render();
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
        document.getElementById('fileUpload').onchange = (e) => {
            let reader = new FileReader();
            reader.onload = (evt) => {
                let data = new Uint8Array(evt.target.result);
                let wb = XLSX.read(data, {type:'array'});
                let rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                let news = [];
                rows.forEach(r => {
                    let lat = parseFloat(r['Lat'] || r['lat']), lng = parseFloat(r['Lng'] || r['lng']);
                    let d = r['Day'] || r['day'] || r['วัน'];
                    let days = [];
                    if(d) { let m = String(d).match(/\d+/); if(m) days = [`Day ${m[0]}`]; }
                    news.push({
                        id: String(r['ID'] || r['id']),
                        name: String(r['Name'] || r['name']),
                        lat: lat, lng: lng, days: days, selected: false
                    });
                });
                GlobalState.stores = news; App.saveDB(); UI.render();
            };
            reader.readAsArrayBuffer(e.target.files[0]);
        };
    },
    export: () => {
        let data = GlobalState.stores.map(s => ({ "ID": s.id, "Name": s.name, "Lat": s.lat, "Lng": s.lng, "Day": s.days[0] }));
        let ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        XLSX.writeFile(wb, `Route_${GlobalState.currentRoute}.xlsx`);
    }
};

var StoreMgr = {
    toggleSelect: (id) => {
        let s = GlobalState.stores.find(x => x.id === id);
        if(s) s.selected = !s.selected;
        UI.render();
    },
    assignSelected: () => {
        let d = document.getElementById('assign-day').value;
        GlobalState.stores.forEach(s => { if(s.selected) { s.days = [d]; s.selected = false; } });
        App.saveDB(); UI.render();
    }
};

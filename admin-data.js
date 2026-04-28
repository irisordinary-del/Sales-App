var State = { stores: [], db: { routes: {} }, currentRoute: "402V02", openModalDay: null };

var App = {
    dbRef: null,
    init: () => {
        if (typeof MapCtrl !== 'undefined') MapCtrl.init();
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            UI.showStatus("❌ ไม่พบ Firebase Config", "red");
            return;
        }
        App.dbRef = firebase.firestore().collection('sales_app').doc('main_data');
        App.loadDB();
        ExcelIO.init();
    },
    loadDB: () => {
        UI.showLoader("กำลังเชื่อมต่อข้อมูล...");
        App.dbRef.get().then(doc => {
            if (doc.exists) {
                State.db = doc.data();
                let keys = Object.keys(State.db.routes || {});
                if (!keys.length) { State.db.routes = {"Default":[]}; keys=["Default"]; }
                if (!keys.includes(State.currentRoute)) State.currentRoute = keys[0];
                App.updateSelector();
                App.switchRoute(State.currentRoute);
            } else {
                State.db = { routes: {"Default":[]} };
                App.updateSelector(); App.switchRoute("Default");
            }
            UI.hideLoader();
        }).catch(() => { UI.hideLoader(); UI.showStatus("❌ โหลดข้อมูลล้มเหลว", "red"); });
    },
    saveDB: () => {
        State.db.routes[State.currentRoute] = State.stores;
        App.dbRef.set(State.db).then(() => UI.showStatus("✅ บันทึกแล้ว", "emerald")).catch(() => UI.showStatus("❌ บันทึกพลาด", "red"));
    },
    switchRoute: (name) => {
        State.currentRoute = name;
        State.stores = State.db.routes[name] || [];
        State.stores.forEach(s => s.selected = false);
        UI.render();
        if (typeof MapCtrl !== 'undefined') MapCtrl.fit();
    },
    updateSelector: () => {
        let el = document.getElementById('routeSelector');
        if(!el) return;
        let r = Object.keys(State.db.routes).sort();
        el.innerHTML = r.map(x => `<option value="${x}">${x}</option>`).join('');
        el.value = State.currentRoute;
    },
    addRoute: () => {
        let n = prompt("ตั้งชื่อสายวิ่งใหม่:");
        if (n && n.trim() !== "") { 
            if(State.db.routes[n]) return alert("ชื่อซ้ำครับ");
            State.db.routes[n] = []; App.updateSelector(); App.switchRoute(n); App.saveDB(); 
        }
    }
};

var StoreMgr = {
    toggleSelect: (id) => {
        let s = State.stores.find(x => x.id === id);
        if(s) s.selected = !s.selected;
        UI.render();
    },
    assignSelected: () => {
        let d = document.getElementById('assign-day').value;
        let count = 0;
        State.stores.forEach(s => { if(s.selected) { s.days = [d]; s.selected = false; count++; } });
        if(count > 0) { App.saveDB(); UI.render(); } else alert("กรุณาเลือกร้านค้าก่อนจัดวัน");
    },
    changeDay: (id, day) => {
        let s = State.stores.find(x => x.id === id);
        if(!s) return;
        s.days = day === 'remove' ? [] : [day];
        App.saveDB(); UI.render();
    }
};

var ExcelIO = {
    init: () => {
        let el = document.getElementById('fileUpload');
        if(el) el.onchange = (e) => {
            let reader = new FileReader();
            reader.onload = (evt) => {
                let wb = XLSX.read(new Uint8Array(evt.target.result), {type:'array'});
                let rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                State.stores = rows.map(r => {
                    let dRaw = r['Day'] || r['day'] || r['วันวิ่งคิว'] || '';
                    let days = []; let m = String(dRaw).match(/\d+/); if(m) days = [`Day ${m[0]}`];
                    return {
                        id: String(r['ID'] || r['id'] || r['รหัสร้านค้า'] || ''),
                        name: String(r['Name'] || r['name'] || r['ชื่อร้านค้า'] || 'ไม่ระบุชื่อ'),
                        lat: parseFloat(r['Lat'] || r['lat']),
                        lng: parseFloat(r['Lng'] || r['lng']),
                        days: days, selected: false
                    };
                }).filter(s => s.id && s.name && !isNaN(s.lat) && !isNaN(s.lng));
                App.saveDB(); UI.render(); MapCtrl.fit();
            };
            reader.readAsArrayBuffer(e.target.files[0]);
            e.target.value = '';
        };
    },
    export: () => {
        if(!State.stores.length) return alert("ไม่มีข้อมูล");
        let data = State.stores.map(s => ({ "ID": s.id, "Name": s.name, "Lat": s.lat, "Lng": s.lng, "Day": s.days.length ? s.days[0].replace('Day ','') : '' }));
        let ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Route"); XLSX.writeFile(wb, `Export_${State.currentRoute}.xlsx`);
    }
};

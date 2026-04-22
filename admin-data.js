// ==========================================
// 🗄️ ไฟล์จัดการฐานข้อมูลทั้งหมด (State, Firebase, Excel)
// ==========================================

// 1. ศูนย์กลางจัดเก็บข้อมูล (State Management)
const State = {
    stores: [],                 // ข้อมูลร้านค้าในสายปัจจุบัน
    sales: {},                  // ข้อมูลยอดขาย/KPI ที่ผูกกับร้านค้า
    db: { routes: {}, cycleDays: 24 }, // โครงสร้างข้อมูลที่จะเซฟขึ้นคลาวด์
    localActiveRoute: "402V02", // ชื่อสายวิ่งที่กำลังเปิดดูอยู่
    activeRoadDay: null,
    openDayModal: null
};

// 2. ระบบจัดการแอปและคลาวด์ (App & Firebase)
const App = {
    dbRef: null,
    
    init: () => {
        // 🗺️ 1. สั่งเปิดแผนที่ให้โชว์ขึ้นมาก่อนเป็นอันดับแรก! (แก้ปัญหาจอขาว)
        if (typeof MapCtrl !== 'undefined' && MapCtrl.init) {
            MapCtrl.init();
        }
        
        // 🔥 2. ตรวจสอบว่ามีไฟล์ app-config.js (รหัสฐานข้อมูล) หรือไม่
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            console.error("Firebase is not initialized.");
            alert("⚠️ ไม่สามารถเชื่อมต่อฐานข้อมูลได้!\n\nระบบไม่พบการตั้งค่า Firebase โปรดตรวจสอบว่ามีไฟล์ 'app-config.js' อยู่ในโฟลเดอร์เดียวกับโปรเจกต์ และใส่รหัสถูกต้องหรือไม่ครับ");
            return; // หยุดการทำงานตรงนี้ เพื่อไม่ให้แอปพัง
        }
        
        App.dbRef = firebase.firestore().collection('sales_app').doc('main_data');
        
        UI.showLoader("กำลังโหลดข้อมูล...", "เชื่อมต่อฐานข้อมูลคลาวด์");
        App.loadDB();
        ExcelIO.init();
    },
    
    loadDB: () => {
        App.dbRef.get().then(doc => {
            if (doc.exists) {
                State.db = doc.data();
                if (!State.db.routes) State.db.routes = {};
                
                let routes = Object.keys(State.db.routes);
                if (routes.length === 0) {
                    State.db.routes["Default Route"] = [];
                    routes = ["Default Route"];
                }
                
                if (!routes.includes(State.localActiveRoute)) {
                    State.localActiveRoute = routes[0];
                }
                
                App.updateRouteSelector();
                App.switchRoute(State.localActiveRoute);
                
            } else {
                State.db = { routes: { "Default Route": [] }, cycleDays: 24 };
                App.updateRouteSelector();
                App.switchRoute("Default Route");
            }
            UI.hideLoader();
        }).catch(err => {
            UI.hideLoader();
            console.error("Load DB Error:", err);
            alert("❌ โหลดข้อมูลล้มเหลว: " + err.message);
        });
    },
    
    saveDB: () => {
        if (!State.localActiveRoute) return;
        State.db.routes[State.localActiveRoute] = State.stores;
        
        App.updateStatusUI("⏳ กำลังบันทึก...", "yellow");
        App.dbRef.set(State.db).then(() => {
            App.updateStatusUI("✅ บันทึกสำเร็จ", "emerald");
            UI.showSaveToast("บันทึกข้อมูลคิวงานเรียบร้อย");
        }).catch(err => {
            App.updateStatusUI("❌ บันทึกล้มเหลว", "red");
            console.error("Save DB Error:", err);
        });
    },

    updateRouteSelector: () => {
        let sel = document.getElementById('routeSelector');
        if(!sel) return;
        let routes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true}));
        sel.innerHTML = routes.map(r => `<option value="${r}">${r}</option>`).join('');
        sel.value = State.localActiveRoute;
    },

    switchRoute: (routeName) => {
        State.localActiveRoute = routeName;
        State.stores = State.db.routes[routeName] || [];
        
        // รีเซ็ตสถานะการเลือกร้าน
        State.stores.forEach(s => s.selected = false);
        
        UI.render();
        MapCtrl.fitToStores();
        document.getElementById('routeSelector').value = routeName;
    },

    addRoute: () => {
        let name = prompt("ตั้งชื่อสายวิ่งใหม่ (เช่น 402V13):");
        if (!name || name.trim() === "") return;
        name = name.trim();
        if (State.db.routes[name]) return alert("ชื่อสายนี้มีอยู่แล้วครับ");
        
        State.db.routes[name] = [];
        App.updateRouteSelector();
        App.switchRoute(name);
        App.saveDB();
    },

    renameRoute: () => {
        let oldName = State.localActiveRoute;
        let newName = prompt("เปลี่ยนชื่อสายวิ่ง:", oldName);
        if (!newName || newName.trim() === "" || newName === oldName) return;
        newName = newName.trim();
        if (State.db.routes[newName]) return alert("ชื่อสายนี้มีอยู่แล้วครับ");

        State.db.routes[newName] = State.db.routes[oldName];
        delete State.db.routes[oldName];
        
        App.updateRouteSelector();
        App.switchRoute(newName);
        App.saveDB();
    },

    deleteRoute: () => {
        let name = State.localActiveRoute;
        if (!confirm(`⚠️ ยืนยันที่จะลบสาย "${name}" ใช่หรือไม่?\nข้อมูลร้านค้าในสายนี้จะหายทั้งหมด!`)) return;
        
        delete State.db.routes[name];
        let remaining = Object.keys(State.db.routes);
        if (remaining.length === 0) {
            State.db.routes["Default Route"] = [];
            remaining = ["Default Route"];
        }
        
        App.updateRouteSelector();
        App.switchRoute(remaining[0]);
        App.saveDB();
    },
    
    clearStores: () => {
        if (!confirm(`⚠️ ยืนยันล้างข้อมูลร้านค้าทั้งหมดในสาย "${State.localActiveRoute}" ใช่หรือไม่?`)) return;
        State.stores = [];
        App.saveDB();
        UI.render();
    },

    updateStatusUI: (text, color) => {
        let el = document.getElementById('db-save-status');
        if (!el) return;
        el.className = `hidden items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all duration-300 bg-${color}-50 text-${color}-600 border-${color}-200`;
        el.innerHTML = text;
        el.classList.remove('hidden');
        el.classList.add('flex');
        if(color === 'emerald') setTimeout(() => { el.classList.remove('flex'); el.classList.add('hidden'); }, 3000);
    }
};

// 3. ระบบจัดการข้อมูลร้านค้าบนหน้าจอ
const StoreMgr = {
    toggleSelect: (id) => {
        let s = State.stores.find(x => x.id === id);
        if(s) s.selected = !s.selected;
        UI.render();
    },
    clearSelection: () => {
        State.stores.forEach(s => s.selected = false);
        UI.render();
    },
    assignSelected: () => {
        let day = document.getElementById('assign-day').value;
        let count = 0;
        State.stores.forEach(s => {
            if(s.selected) {
                s.days = [day];
                if(s.freq === 2) {
                    let dNum = parseInt(day.replace('Day ',''));
                    let nextD = dNum + (State.db.cycleDays/2);
                    if(nextD <= State.db.cycleDays) s.days.push(`Day ${nextD}`);
                }
                s.selected = false;
                count++;
            }
        });
        if(count > 0) {
            App.saveDB();
            UI.render();
            UI.showSaveToast(`จัดลง ${DAY_COLORS[day].name} สำเร็จ ${count} ร้าน`);
        } else {
            alert("กรุณาเลือกร้านค้าก่อนจัดวัน (ติ๊กถูกหน้าร้าน หรือใช้ Lasso เลือกบนแผนที่)");
        }
    },
    changeDay: (id, day) => {
        let s = State.stores.find(x => x.id === id);
        if(!s) return;
        if(day === 'remove') {
            s.days = [];
        } else {
            s.days = [day];
            if(s.freq === 2) {
                let dNum = parseInt(day.replace('Day ',''));
                let nextD = dNum + (State.db.cycleDays/2);
                if(nextD <= State.db.cycleDays) s.days.push(`Day ${nextD}`);
            }
        }
        App.saveDB();
        UI.render();
    },
    getDistSq: (p1, p2) => {
        let dx = p1.lng - p2.lng, dy = p1.lat - p2.lat;
        return dx*dx + dy*dy;
    }
};

// 4. ระบบนำเข้าและส่งออก Excel (Smart Excel Manager)
const ExcelIO = {
    init: () => {
        let el = document.getElementById('fileUpload');
        if (el) el.addEventListener('change', ExcelIO.importMap);
    },
    importMap: (e) => {
        let file = e.target.files[0];
        if (!file) return;
        UI.showLoader("กำลังอ่านไฟล์ Excel...", "กำลังตรวจสอบและซ่อมแซมข้อมูล...");
        
        let reader = new FileReader();
        reader.onload = (evt) => {
            try {
                let data = new Uint8Array(evt.target.result);
                let wb = XLSX.read(data, {type: 'array'});
                let ws = wb.Sheets[wb.SheetNames[0]];
                let rows = XLSX.utils.sheet_to_json(ws);
                
                let newStores = [];
                rows.forEach(r => {
                    // ดึงหัวคอลัมน์หลายๆ แบบเผื่อพิมพ์ผิด
                    let id = r['รหัสร้านค้า'] || r['ID'] || r['Store ID'] || r['รหัส'] || r['id'];
                    let name = r['ชื่อร้านค้า'] || r['Name'] || r['Store Name'] || r['ชื่อร้าน'] || r['name'];
                    let lat = r['Lat'] || r['Latitude'] || r['ละติจูด'] || r['lat'];
                    let lng = r['Lng'] || r['Longitude'] || r['ลองจิจูด'] || r['lng'];
                    let dayRaw = r['Day'] || r['วันวิ่งคิว'] || r['วันที่เข้า'] || r['Route'] || r['วัน'] || r['day'];
                    let freqRaw = r['Freq'] || r['ความถี่'] || r['Frequency'];
                    
                    if (!id || !name || lat === undefined || lng === undefined) return;
                    
                    let latF = parseFloat(lat);
                    let lngF = parseFloat(lng);
                    if(isNaN(latF) || isNaN(lngF)) return;
                    
                    // 🌟 ระบบดึงตัวเลขวันสุดฉลาด (Smart Day Parser)
                    let days = [];
                    if (dayRaw !== undefined && dayRaw !== null && dayRaw !== '') {
                        let str = String(dayRaw).trim();
                        // ค้นหาเฉพาะตัวเลขที่ซ่อนอยู่ในข้อความ
                        let match = str.match(/\d+/); 
                        if (match) {
                            let num = parseInt(match[0]);
                            // ถ้าเลขอยู่ในช่วง 1 ถึง 30 ให้แปลงเป็นฟอร์แมตมาตรฐาน
                            if (num >= 1 && num <= 30) {
                                days = [`Day ${num}`];
                            }
                        }
                    }
                    
                    newStores.push({
                        id: String(id).trim(),
                        name: String(name).trim(),
                        lat: latF,
                        lng: lngF,
                        days: days,
                        freq: (parseInt(freqRaw) === 2) ? 2 : 1,
                        seqs: {},
                        selected: false
                    });
                });
                
                if (!newStores.length) throw new Error("ไม่พบข้อมูลร้านค้า (กรุณาเช็คชื่อหัวคอลัมน์ ID, Name, Lat, Lng ให้ตรงกัน)");
                
                State.stores = newStores;
                App.saveDB();
                UI.render();
                MapCtrl.fitToStores();
                UI.hideLoader();
                UI.showSaveToast(`นำเข้าสำเร็จ ${newStores.length} ร้าน`);
                
            } catch(err) {
                UI.hideLoader();
                alert("❌ เกิดข้อผิดพลาดในการอ่านไฟล์: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = ''; // เคลียร์ไฟล์เดิมออกเผื่ออัปโหลดไฟล์เดิมซ้ำ
    },
    
    export: () => {
        if (!State.stores.length) return alert("ไม่มีข้อมูลให้ดาวน์โหลด");
        
        let exp = State.stores.map(s => ({
            'รหัสร้านค้า': s.id,
            'ชื่อร้านค้า': s.name,
            'Lat': s.lat,
            'Lng': s.lng,
            // 🌟 ตอน Export ออกไป จะส่งไปแค่ "ตัวเลข" เพียวๆ ครับ
            'วันวิ่งคิว': s.days.length ? parseInt(s.days[0].replace('Day ', '')) : '', 
            'ความถี่': s.freq
        }));
        
        let ws = XLSX.utils.json_to_sheet(exp);
        let wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Routes");
        XLSX.writeFile(wb, `Route_${State.localActiveRoute || 'Export'}.xlsx`);
    }
};

// ==========================================
// ส่วนเพิ่มเติม (ป้องกัน Error ถ้าโมดูลอื่นยังไม่โหลด)
// ==========================================
if (typeof RawDataMgr === 'undefined') {
    window.RawDataMgr = { clearAll: () => {}, applyImport: () => {} };
}
if (typeof KPIMgr === 'undefined') {
    window.KPIMgr = { renderSetup: () => {}, calculatePreview: () => {}, deployToSales: () => {} };
}

const StoreMgr = {
    // ฟังก์ชันเดิมที่พี่มีอยู่แล้ว
    toggleSelect: (id) => { let s = State.stores.find(x=>x.id===String(id)); if(s){ s.selected = !s.selected; UI.switchTab('tab2'); UI.render(); App.saveDB(); } },
    clearSelection: () => { State.stores.forEach(s=>s.selected=false); UI.render(); App.saveDB(); },
    
    // 🌟 ฟังก์ชันใหม่: เอาไว้ล้างการจัดสายทั้งหมด 🌟
    clearAllAssignments: () => {
        let count = State.stores.filter(s => s.days && s.days.length > 0).length;
        if(count === 0) return alert("ยังไม่มีร้านไหนถูกจัดสายเลยครับ");
        
        if(!confirm(`⚠️ ยืนยันที่จะล้างการจัดวันวิ่งของร้านทั้ง ${count} ร้านใช่หรือไม่?\n(หมุดทั้งหมดจะถูกถอดสี และกลับไปอยู่โหมด 'รอจัด')`)) return;
        
        // ล้างข้อมูลวันที่ออกให้เกลี้ยง
        State.stores.forEach(s => {
            s.days = [];
            s.seqs = {};
        });
        
        MapCtrl.closePopups(); // ปิดป๊อปอัปบนแผนที่ถ้าเปิดอยู่
        App.saveDB();          // เซฟขึ้นคลาวด์
        UI.render();           // วาดหน้าจอและแผนที่ใหม่
    },

    // ฟังก์ชันเดิมที่พี่มีอยู่แล้ว
    changeDay: (id, d) => { let s = State.stores.find(x=>x.id===String(id)); if(s) { if(d === 'remove') s.days = []; else if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.seqs = {}; MapCtrl.closePopups(); UI.render(); App.saveDB(); } },
    assignSelected: () => { let d = document.getElementById('assign-day').value; let h = false; State.stores.forEach(s => { if(s.selected) { if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.selected = false; h = true; } }); if(!h) alert("กรุณาเลือกร้านค้าก่อนจัดวัน"); else { App.saveDB(); UI.render(); } }
    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2)
};

// ==========================================
// 📂 ระบบหน้าข้อมูลดิบ (Raw Data)
// ==========================================
const RawDataMgr = {
    tempJson: [],
    
    processExcel: (file) => {
        UI.showLoader("กำลังอ่านไฟล์...", "รอสักครู่");
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result); const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval: ""}); 
                if (json.length < 1) throw new Error("ไฟล์ว่างเปล่า");
                
                RawDataMgr.tempJson = json;
                let headers = Object.keys(json[0]);
                let savedCols = State.db.savedRawColumns || []; // ดึงค่าที่เคยติ๊กไว้

                // สร้าง Checkbox ให้ติ๊กเลือกคอลัมน์
                let html = headers.map(h => {
                    let isChecked = savedCols.length === 0 || savedCols.includes(h) ? 'checked' : '';
                    return `
                    <label class="flex items-center gap-2 p-2 border rounded-lg bg-gray-50 cursor-pointer hover:bg-indigo-50">
                        <input type="checkbox" value="${h}" class="raw-col-cb w-4 h-4 text-indigo-600 rounded" ${isChecked}>
                        <span class="text-xs font-bold text-gray-700 truncate">${h}</span>
                    </label>`;
                }).join('');

                document.getElementById('column-checkboxes').innerHTML = html;
                UI.hideLoader();
                document.getElementById('columnSelectModal').classList.remove('hidden');

            } catch(error) { UI.hideLoader(); alert("Error: " + error.message); }
            document.getElementById('rawUpload').value = ''; 
        };
        reader.readAsArrayBuffer(file);
    },

    applyImport: () => {
        // กวาดคอลัมน์ที่ติ๊ก
        let selectedCols = [];
        document.querySelectorAll('.raw-col-cb:checked').forEach(cb => selectedCols.push(cb.value));
        if(selectedCols.length === 0) return alert("กรุณาเลือกอย่างน้อย 1 คอลัมน์");

        document.getElementById('columnSelectModal').classList.add('hidden');
        UI.showLoader("กำลังกรองข้อมูล...", "สร้างฐานข้อมูลดิบ");

        setTimeout(() => {
            // สร้าง Array ใหม่ที่เก็บเฉพาะคอลัมน์ที่เลือก
            let rawData = RawDataMgr.tempJson.map(row => {
                let cleanRow = {};
                selectedCols.forEach(col => { cleanRow[col] = row[col]; });
                return cleanRow;
            });

            // บันทึกค่าที่เลือกไว้ใช้ครั้งต่อไป
            State.db.savedRawColumns = selectedCols;
            App.dbRef.update({ savedRawColumns: selectedCols }); // เซฟลง Firebase

            // เซฟ Data เป็น Chunks ลง Firebase 
            cloudDB.collection('v1_raw_chunks').get().then(snap => {
                let delBatch = cloudDB.batch(); snap.forEach(doc => delBatch.delete(doc.ref));
                return delBatch.commit();
            }).then(() => {
                let chunkSize = 500; let promises = [];
                for(let i=0; i<rawData.length; i+=chunkSize) {
                    let chunk = { rows: rawData.slice(i, i+chunkSize) };
                    promises.push(cloudDB.collection('v1_raw_chunks').doc('chunk_'+(i/chunkSize)).set(chunk));
                }
                return Promise.all(promises);
            }).then(() => {
                State.rawData = rawData; 
                RawDataMgr.renderTable(); 
                UI.hideLoader(); 
                RawDataMgr.tempJson = [];
                alert("✅ อัปโหลดข้อมูลดิบสำเร็จ!");
            }).catch(err => { UI.hideLoader(); alert("อัปโหลดไม่สำเร็จ: " + err.message); });
            
        }, 100);
    },

    renderTable: () => {
        let raw = State.rawData || [];
        document.getElementById('raw-total-rows').innerText = raw.length.toLocaleString();
        
        if(raw.length === 0) {
            document.getElementById('raw-table-head').innerHTML = '';
            document.getElementById('raw-table-body').innerHTML = '<tr><td class="text-center p-8 text-gray-400">ไม่มีข้อมูลดิบ</td></tr>';
            return;
        }

        let cols = Object.keys(raw[0]);
        let th = '<tr>' + cols.map(c => `<th class="p-3 border-b bg-gray-100 sticky top-0">${c}</th>`).join('') + '</tr>';
        document.getElementById('raw-table-head').innerHTML = th;

        // โชว์แค่ 500 บรรทัดแรกกันค้าง
        let html = raw.slice(0, 500).map(row => {
            return '<tr class="hover:bg-blue-50/50">' + cols.map(c => `<td class="p-3 text-sm border-b border-gray-100">${row[c] !== undefined ? row[c] : ''}</td>`).join('') + '</tr>';
        }).join('');
        
        if(raw.length > 500) html += `<tr><td colspan="${cols.length}" class="text-center p-4 text-xs text-gray-400">... ซ่อนข้อมูลแถวที่ 501 ถึง ${raw.length} ไว้เพื่อความรวดเร็ว ...</td></tr>`;
        document.getElementById('raw-table-body').innerHTML = html;
    },

    clearAll: () => {
        if(confirm("ล้างข้อมูลดิบทั้งหมด?")) {
            UI.showLoader("กำลังลบ...");
            cloudDB.collection('v1_raw_chunks').get().then(snap => {
                let delBatch = cloudDB.batch(); snap.forEach(doc => delBatch.delete(doc.ref));
                return delBatch.commit();
            }).then(() => { State.rawData = []; RawDataMgr.renderTable(); UI.hideLoader(); });
        }
    }
};

// ==========================================
// 🎯 ระบบหน้าจัดการ KPI (เชื่อมต่อไปหา Sales)
// ==========================================
const KPIMgr = {
    renderSetup: () => {
        if(!State.rawData || State.rawData.length === 0) {
            document.getElementById('kpi-selectors').innerHTML = '<p class="col-span-3 text-red-500 font-bold text-sm">⚠️ ยังไม่มีข้อมูลดิบ กรุณาไปที่แท็บ "ข้อมูลการขาย" เพื่ออัปโหลดก่อนครับ</p>';
            return;
        }

        let cols = Object.keys(State.rawData[0]);
        let saved = State.db.kpiSettings || {}; // ดึงค่าเดิมถ้าเคยตั้งไว้

        let fields = [
            { id: 'kpi-id', label: 'คอลัมน์ "รหัสร้าน" (อ้างอิง)', val: saved.idCol || cols.find(h=>h.toLowerCase().includes('id')||h.includes('รหัส')) },
            { id: 'kpi-name', label: 'คอลัมน์ "ชื่อร้าน" (ไว้โชว์)', val: saved.nameCol || cols.find(h=>h.toLowerCase().includes('name')||h.includes('ชื่อ')) },
            { id: 'kpi-vpo', label: 'คอลัมน์ "ยอดขาย" (บวกเลข)', val: saved.vpoCol || cols.find(h=>h.toLowerCase().includes('qty')||h.includes('จำนวน')) },
            { id: 'kpi-bill', label: 'คอลัมน์ "เลขที่บิล" (นับจำนวน)', val: saved.billCol || cols.find(h=>h.toLowerCase().includes('invoice')||h.includes('บิล')) },
            { id: 'kpi-sku', label: 'คอลัมน์ "รหัสสินค้า" (นับจำนวน)', val: saved.skuCol || cols.find(h=>h.toLowerCase().includes('sku')||h.includes('product')) }
        ];

        let html = fields.map(f => {
            let opts = `<option value="">-- ไม่ใช้ --</option>` + cols.map(c => `<option value="${c}" ${c===f.val?'selected':''}>${c}</option>`).join('');
            return `<div class="bg-gray-50 p-3 rounded-xl border border-gray-200"><label class="text-xs font-bold text-gray-700 block mb-1">${f.label}</label><select id="${f.id}" class="w-full p-2 border rounded-lg text-sm bg-white">${opts}</select></div>`;
        }).join('');

        document.getElementById('kpi-selectors').innerHTML = html;
        document.getElementById('kpi-focus-1').value = saved.f1 || "เจลลี่";
        document.getElementById('kpi-focus-2').value = saved.f2 || "กลมกล่อม";
    },

    calculatePreview: () => {
        if(!State.rawData || State.rawData.length === 0) return alert("ไม่มีข้อมูลดิบ");
        
        let idCol = document.getElementById('kpi-id').value;
        if(!idCol) return alert("จำเป็นต้องระบุคอลัมน์ รหัสร้าน ครับ");

        let conf = {
            idCol: idCol, nameCol: document.getElementById('kpi-name').value,
            vpoCol: document.getElementById('kpi-vpo').value, billCol: document.getElementById('kpi-bill').value, skuCol: document.getElementById('kpi-sku').value,
            f1: document.getElementById('kpi-focus-1').value.trim(), f2: document.getElementById('kpi-focus-2').value.trim()
        };

        // เซฟการตั้งค่านี้ไว้
        State.db.kpiSettings = conf;
        App.dbRef.update({ kpiSettings: conf });

        UI.showLoader("กำลังประมวลผล KPI...");
        setTimeout(() => {
            let temp = {};
            State.rawData.forEach(row => {
                let sId = String(row[conf.idCol]).trim(); if(!sId) return;
                if(!temp[sId]) { temp[sId] = { id: sId, name: conf.nameCol?row[conf.nameCol]:'ไม่ระบุ', vpo:0, bills:new Set(), skus:new Set(), h1:false, h2:false }; }
                
                let qty = conf.vpoCol ? parseFloat(String(row[conf.vpoCol]).replace(/[^0-9.-]/g, '')) : 0;
                if(!isNaN(qty)) temp[sId].vpo += qty;
                
                if(conf.billCol && row[conf.billCol]) temp[sId].bills.add(row[conf.billCol]);
                
                if(conf.skuCol && row[conf.skuCol]) {
                    let sku = String(row[conf.skuCol]); temp[sId].skus.add(sku);
                    if(conf.f1 && sku.includes(conf.f1)) temp[sId].h1 = true;
                    if(conf.f2 && sku.includes(conf.f2)) temp[sId].h2 = true;
                }
            });

            let newSalesKPI = {};
            Object.keys(temp).forEach(id => {
                newSalesKPI[id] = { id: id, name: temp[id].name, vpo: Math.round(temp[id].vpo*100)/100, billCount: temp[id].bills.size, skuCount: temp[id].skus.size, hasJelly: temp[id].h1, hasKlom: temp[id].h2, active: temp[id].vpo > 0 };
            });

            State.previewSales = newSalesKPI; // เก็บไว้ชั่วคราวก่อนส่งให้ Sales
            KPIMgr.renderPreview(newSalesKPI, conf);
            UI.hideLoader();
        }, 100);
    },

    renderPreview: (kpiData, conf) => {
        let keys = Object.keys(kpiData);
        document.getElementById('kpi-preview-count').innerText = keys.length.toLocaleString();
        
        let th = `<tr><th class="p-3 bg-gray-100 sticky top-0">รหัสร้าน</th><th class="p-3 bg-gray-100 sticky top-0">ชื่อร้าน</th><th class="p-3 bg-emerald-50 text-emerald-700 sticky top-0">VPO (รวม)</th><th class="p-3 bg-gray-100 sticky top-0">บิล</th><th class="p-3 bg-gray-100 sticky top-0">SKU</th><th class="p-3 bg-gray-100 sticky top-0">สินค้าโฟกัส</th></tr>`;
        document.getElementById('kpi-preview-head').innerHTML = th;

        let html = keys.slice(0, 300).map(id => {
            let k = kpiData[id];
            let fHtml = '';
            if(k.hasJelly) fHtml += `<span class="bg-pink-100 text-pink-700 px-2 rounded text-[10px] font-bold mr-1">${conf.f1}</span>`;
            if(k.hasKlom) fHtml += `<span class="bg-amber-100 text-amber-700 px-2 rounded text-[10px] font-bold">${conf.f2}</span>`;
            return `<tr><td class="p-3 text-sm border-b">${k.id}</td><td class="p-3 text-sm border-b font-bold">${k.name}</td><td class="p-3 text-sm border-b font-black text-blue-600 bg-emerald-50/30">${k.vpo}</td><td class="p-3 text-sm border-b">${k.billCount}</td><td class="p-3 text-sm border-b">${k.skuCount}</td><td class="p-3 text-sm border-b">${fHtml}</td></tr>`;
        }).join('');

        if(keys.length > 300) html += `<tr><td colspan="6" class="text-center p-3 text-xs text-gray-400">... แสดงตัวอย่าง 300 ร้านแรก ...</td></tr>`;
        document.getElementById('kpi-preview-body').innerHTML = html;
    },

    deployToSales: () => {
        if(!State.previewSales) return alert("กรุณากด 'ทดสอบคำนวณ KPI' ให้เห็นตารางตัวอย่างก่อนส่งครับ");
        UI.showLoader("กำลังอัปโหลดส่งให้ Sales...", "กำลังแบ่งกล่องข้อมูล...");
        
        cloudDB.collection('v1_sales_chunks').get().then(snap => {
            let delBatch = cloudDB.batch(); snap.forEach(doc => delBatch.delete(doc.ref));
            return delBatch.commit();
        }).then(() => {
            let keys = Object.keys(State.previewSales);
            let chunkSize = 500; let promises = [];
            for(let i=0; i<keys.length; i+=chunkSize) {
                let chunkData = {}; keys.slice(i, i+chunkSize).forEach(k => chunkData[k] = State.previewSales[k]);
                promises.push(cloudDB.collection('v1_sales_chunks').doc('chunk_'+(i/chunkSize)).set(chunkData));
            }
            return Promise.all(promises);
        }).then(() => {
            State.sales = State.previewSales; // อัปเดตฝั่งตัวเองให้ตรงกับ Sales
            App.sync(); UI.hideLoader(); alert("🚀 ส่งข้อมูลให้ Sales App สำเร็จเรียบร้อย!");
        }).catch(err => { UI.hideLoader(); alert("อัปโหลดไม่สำเร็จ: " + err.message); });
    }
};

const ExcelIO = {
    export: () => {
        if(!State.stores.length) return; let ed = [];
        State.stores.forEach(s => {
            let kpi = State.sales[s.id]; let baseData = { "รหัส": s.id, "ชื่อ": s.name, "Lat": s.lat, "Lng": s.lng, "ความถี่": s.freq, "สถานะ": (kpi && kpi.active) ? "Active" : "Inactive", "VPO": kpi ? kpi.vpo : 0, "SKU": kpi ? kpi.skuCount : 0 };
            if(!s.days.length) ed.push({...baseData, "สายวิ่ง":"ยังไม่จัด", "คิว":"-", "Map":`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`});
            else s.days.forEach(d => ed.push({...baseData, "สายวิ่ง":d, "คิว":s.seqs[d]||"-", "Map":`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}));
        });
        ed.sort((a,b) => { let da=a["สายวิ่ง"]!=="ยังไม่จัด"?parseInt(a["สายวิ่ง"].replace('Day ','')):999, db=b["สายวิ่ง"]!=="ยังไม่จัด"?parseInt(b["สายวิ่ง"].replace('Day ','')):999; if(da!==db) return da-db; let sa=a["คิว"]!=="-"?parseInt(a["คิว"]):999, sb=b["คิว"]!=="-"?parseInt(b["คิว"]):999; return sa-sb; });
        let ws = XLSX.utils.json_to_sheet(ed), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "RoutePlan"); XLSX.writeFile(wb, `Route_${State.localActiveRoute}.xlsx`);
    }
};

const App = {
    dbRef: cloudDB.collection('appData').doc('v1_main'),

    init: () => {
        MapCtrl.init();
        UI.showLoader("กำลังเชื่อมต่อ...", "");
        
        App.dbRef.onSnapshot((doc) => {
            let d = doc.exists ? doc.data() : {};
            State.db = { ...State.db, ...d }; // รวมข้อมูล Route และ Settings
            State.db.routes = State.db.routes || {"สายที่ 1": []};
            State.db.cycleDays = State.db.cycleDays || 24;

            let sortedKeys = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true}));
            if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                State.localActiveRoute = localStorage.getItem('last_viewed_route') || sortedKeys[0];
            }
            State.stores = State.db.routes[State.localActiveRoute] || [];
            
            App.fetchRawData(); // ดึงก้อนข้อมูลดิบ
            App.fetchSalesData(); // ดึงก้อน KPI
        }, (err) => { UI.hideLoader(); alert("ออฟไลน์"); });

        document.getElementById('rawUpload').addEventListener('change', function(e) { const f = e.target.files[0]; if(f) RawDataMgr.processExcel(f); });
        document.getElementById('fileUpload').addEventListener('change', App.handleMapUpload);
    },

    fetchRawData: () => {
        cloudDB.collection('v1_raw_chunks').get().then(snap => {
            let raw = []; snap.forEach(doc => { raw = raw.concat(doc.data().rows || []); });
            State.rawData = raw; RawDataMgr.renderTable();
        });
    },

    fetchSalesData: () => {
        cloudDB.collection('v1_sales_chunks').get().then(snap => {
            let merged = {}; snap.forEach(doc => { Object.assign(merged, doc.data()); });
            State.sales = merged; App.sync(); UI.hideLoader();
        });
    },

    saveDB: () => { State.db.routes[State.localActiveRoute] = State.stores; App.dbRef.update({ routes: State.db.routes }); },
    sync: () => { let rs = document.getElementById('routeSelector'); if(rs) { let sortedRoutes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true})); let newHTML = sortedRoutes.map(r => `<option value="${r}">${r}</option>`).join(''); if (rs.innerHTML !== newHTML) rs.innerHTML = newHTML; rs.value = State.localActiveRoute; } MapCtrl.clearAll(); UI.initDaySelector(); UI.render(); },
    switchRoute: (name) => { if(State.localActiveRoute === name) return; State.localActiveRoute = name; localStorage.setItem('last_viewed_route', name); State.stores = State.db.routes[name] || []; App.sync(); MapCtrl.fitToStores(); },
    addRoute: () => { let n = prompt("ชื่อสายใหม่:"); if(n && n.trim()) { State.db.routes[n.trim()] = []; State.localActiveRoute = n.trim(); State.stores = []; App.sync(); App.saveDB(); MapCtrl.fitToStores(); } },
    renameRoute: () => { let n = prompt("ชื่อใหม่:", State.localActiveRoute); if(n && n.trim()) { State.db.routes[n.trim()] = State.db.routes[State.localActiveRoute]; delete State.db.routes[State.localActiveRoute]; State.localActiveRoute = n.trim(); App.sync(); App.saveDB(); } },
    deleteRoute: () => { if(Object.keys(State.db.routes).length > 1 && confirm("ยืนยันลบสายนี้?")) { delete State.db.routes[State.localActiveRoute]; let sortedKeys = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true})); State.localActiveRoute = sortedKeys[0]; State.stores = State.db.routes[State.localActiveRoute]; App.sync(); App.saveDB(); MapCtrl.fitToStores(); } else if(Object.keys(State.db.routes).length === 1) alert("ห้ามลบสายสุดท้ายครับ"); },
    clearStores: () => { if(confirm("ล้างข้อมูลร้านค้าทั้งหมดในสายนี้?")) { State.stores = []; App.sync(); App.saveDB(); } },
    
    handleMapUpload: function(e) {
        const file = e.target.files[0]; if (!file) return;
        if (State.stores.length > 0 && !confirm(`ข้อมูลเดิมของ "${State.localActiveRoute}" จะถูกแทนที่\nยืนยันการอัปโหลด?`)) { this.value = ''; return; }
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result); const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header: 1, defval: ""}); 
                if (json.length < 2) return alert("ไฟล์ว่างเปล่า");
                let headers = json[0], idCol=-1, nameCol=-1, latCol=-1, lngCol=-1, freqCol=-1, dayCol=-1, seqCol=-1;
                for(let i=0; i<headers.length; i++) {
                    let h = String(headers[i]).toLowerCase();
                    if(h.includes('รหัส') || h.includes('customer code') || h.includes('id')) idCol = i; else if(h.includes('ชื่อ') || h.includes('name')) nameCol = i; else if(h.includes('lat') || h.includes('ละติจูด')) latCol = i; else if(h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด')) lngCol = i; else if(h.includes('freq') || h.includes('ความถี่') || h.includes('รอบ') || h.includes('f2')) freqCol = i; else if(h.includes('สายวิ่ง') || h.includes('day')) dayCol = i; else if(h.includes('คิว') || h.includes('seq')) seqCol = i;
                }
                let storeMap = {}; 
                for (let i = 1; i < json.length; i++) {
                    let row = json[i]; if (!row || row.length === 0) continue; 
                    let idStr = row[idCol] ? String(row[idCol]).trim() : `S_${i}`; if(!idStr) continue; 
                    let lat = parseFloat(String(row[latCol]).replace(/[^0-9.-]/g, '')); let lng = parseFloat(String(row[lngCol]).replace(/[^0-9.-]/g, ''));
                    if(isNaN(lat) || isNaN(lng)) continue;
                    let freq = (freqCol !== -1 && String(row[freqCol]).trim().toUpperCase().includes('2')) ? 2 : 1;
                    let assignedDay = (dayCol !== -1 && row[dayCol]) ? String(row[dayCol]).trim() : "";
                    let assignedSeq = (seqCol !== -1 && row[seqCol]) ? parseInt(String(row[seqCol]).replace(/[^0-9]/g, '')) : NaN;
                    let isValidDay = assignedDay.toLowerCase().includes('day');
                    if (storeMap[idStr]) { if (isValidDay && !storeMap[idStr].days.includes(assignedDay)) { storeMap[idStr].days.push(assignedDay); if (!isNaN(assignedSeq)) storeMap[idStr].seqs[assignedDay] = assignedSeq; } storeMap[idStr].freq = 2; } else { let newStore = { id: idStr, name: row[nameCol] ? String(row[nameCol]).trim() : `Store_${idStr}`, lat: lat, lng: lng, freq: freq, days: [], seqs: {}, selected: false }; if (isValidDay) { newStore.days.push(assignedDay); if (!isNaN(assignedSeq)) newStore.seqs[assignedDay] = assignedSeq; } storeMap[idStr] = newStore; }
                }
                let finalArray = Object.values(storeMap); if(finalArray.length === 0) return alert("ไม่พบพิกัด (Lat, Lng)");
                State.stores = finalArray; App.sync(); App.saveDB(); MapCtrl.fitToStores(); 
            } catch(err) { alert("ขัดข้อง: " + err.message); }
            document.getElementById('fileUpload').value = ''; 
        };
        reader.readAsArrayBuffer(file);
    }
};

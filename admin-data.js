// ==========================================
// 1. ระบบจัดการร้านค้าบนแผนที่และคิวงาน (Store Manager)
// ==========================================
const StoreMgr = {
    toggleSelect: (id) => { let s = State.stores.find(x=>x.id===String(id)); if(s){ s.selected = !s.selected; UI.switchTab('tab2'); UI.render(); App.saveDB(); } },
    clearSelection: () => { State.stores.forEach(s=>s.selected=false); UI.render(); App.saveDB(); },
    changeDay: (id, d) => { let s = State.stores.find(x=>x.id===String(id)); if(s) { if(d === 'remove') s.days = []; else if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.seqs = {}; MapCtrl.closePopups(); UI.render(); App.saveDB(); } },
    assignSelected: () => { let d = document.getElementById('assign-day').value; let h = false; State.stores.forEach(s => { if(s.selected) { if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.selected = false; h = true; } }); if(!h) alert("กรุณาเลือกร้านค้าก่อนครับ"); else { UI.render(); App.saveDB(); } },
    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2)
};

// ==========================================
// 2. ระบบตารางแสดงผล KPI (Data Manager)
// ==========================================
const DataMgr = {
    render: () => {
        let html = []; 
        let salesKeys = Object.keys(State.sales);
        document.getElementById('data-total-stores').innerText = salesKeys.length.toLocaleString();

        if(salesKeys.length === 0) {
            document.getElementById('data-table-head').innerHTML = '';
            document.getElementById('data-table-body').innerHTML = '<tr><td colspan="10" class="text-center p-8 text-gray-400 font-bold">ยังไม่มีข้อมูลยอดขายในระบบ</td></tr>';
            return;
        }

        let firstRecord = State.sales[salesKeys[0]];
        let standardKeys = ['id', 'name', 'vpo', 'billCount', 'skuCount', 'hasJelly', 'hasKlom', 'active'];
        let customKeys = Object.keys(firstRecord).filter(k => !standardKeys.includes(k));
        let customTh = customKeys.map(k => `<th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap bg-indigo-50/50 sticky top-0 text-indigo-800">${k}</th>`).join('');

        let thHtml = `
            <tr>
                <th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap bg-gray-100 sticky top-0 text-gray-700">รหัสลูกค้า</th>
                <th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap bg-gray-100 sticky top-0 text-gray-700">ชื่อร้านค้า</th>
                ${customTh}
                <th class="p-3 px-4 font-black border-b border-gray-200 whitespace-nowrap text-emerald-700 bg-emerald-50 border-l border-emerald-100 sticky top-0">VPO (ลัง)</th>
                <th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap text-emerald-700 bg-emerald-50 sticky top-0">จำนวนบิล</th>
                <th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap text-emerald-700 bg-emerald-50 sticky top-0">จำนวน SKU</th>
                <th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap text-indigo-700 bg-indigo-50 border-l border-indigo-100 sticky top-0">สินค้าโฟกัส</th>
            </tr>
        `;
        document.getElementById('data-table-head').innerHTML = thHtml;

        salesKeys.forEach(id => {
            let k = State.sales[id];
            let focusHtml = '';
            if(k.hasJelly) focusHtml += `<span class="bg-pink-100 text-pink-600 px-2 py-0.5 rounded text-[10px] font-bold mr-1 border border-pink-200">เจลลี่</span>`;
            if(k.hasKlom) focusHtml += `<span class="bg-amber-100 text-amber-600 px-2 py-0.5 rounded text-[10px] font-bold border border-amber-200">กลมกล่อม</span>`;
            if(!k.hasJelly && !k.hasKlom) focusHtml = `<span class="text-gray-300 text-xs font-bold">-</span>`;

            let customTd = customKeys.map(key => `<td class="p-3 px-4 text-sm font-medium text-gray-600 border-b border-gray-100 whitespace-nowrap bg-indigo-50/10">${k[key] !== undefined && k[key] !== "" ? k[key] : '-'}</td>`).join('');

            let tds = `
                <td class="p-3 px-4 text-sm font-mono text-gray-500 border-b border-gray-100 whitespace-nowrap">${k.id}</td>
                <td class="p-3 px-4 text-sm font-bold text-gray-800 border-b border-gray-100 whitespace-nowrap">${k.name}</td>
                ${customTd}
                <td class="p-3 px-4 text-sm font-black text-blue-600 border-b border-gray-100 whitespace-nowrap bg-emerald-50/30 border-l border-emerald-100">${k.vpo || 0}</td>
                <td class="p-3 px-4 text-sm font-bold text-gray-600 border-b border-gray-100 whitespace-nowrap bg-emerald-50/30">${k.billCount || 0}</td>
                <td class="p-3 px-4 text-sm font-bold text-gray-600 border-b border-gray-100 whitespace-nowrap bg-emerald-50/30">${k.skuCount || 0}</td>
                <td class="p-3 px-4 border-b border-gray-100 whitespace-nowrap bg-indigo-50/30 border-l border-indigo-100">${focusHtml}</td>
            `;

            html.push(`<tr class="hover:bg-indigo-50/60 transition">${tds}</tr>`);
        });
        
        document.getElementById('data-table-body').innerHTML = html.join('');
    },
    clearAll: () => {
        if(confirm("⚠️ ยืนยันการลบข้อมูลยอดขาย (KPI) ทั้งหมดออกจากระบบ? (แผนที่จะไม่โดนลบ)")) {
            UI.showLoader("กำลังลบข้อมูล...");
            cloudDB.collection('v1_sales_chunks').get().then(snap => {
                let delBatch = cloudDB.batch();
                snap.forEach(doc => delBatch.delete(doc.ref));
                return delBatch.commit();
            }).then(() => { State.sales = {}; App.sync(); DataMgr.render(); UI.hideLoader(); UI.showSaveToast("ล้าง KPI เรียบร้อย"); });
        }
    }
};

// ==========================================
// 3. ระบบประมวลผล Excel (Auto-Chunking)
// ==========================================
const SalesData = {
    tempJson: [], tempHeaders: [], customFieldCount: 0, 
    
    processExcel: (file) => {
        UI.showLoader("กำลังอ่านหัวคอลัมน์...", "รอสักครู่");
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result); const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval: ""}); 
                if (json.length < 1) throw new Error("ไฟล์ว่างเปล่า");
                
                SalesData.tempJson = json; 
                let headers = Object.keys(json[0]); SalesData.tempHeaders = headers; SalesData.customFieldCount = 0;
                
                let fields = [
                    { id: 'map-id', label: '1. รหัสลูกค้า <span class="text-red-500">*จำเป็น</span>', guess: ['customer code', 'รหัส', 'id'] },
                    { id: 'map-name', label: '2. ชื่อร้านค้า', guess: ['customer name', 'ชื่อ', 'name'] },
                    { id: 'map-vpo', label: '3. ยอดขาย (Qty/VPO)', guess: ['so total', 'qty', 'จำนวน', 'vpo'] },
                    { id: 'map-bill', label: '4. เลขที่บิล (Invoice)', guess: ['invoice', 'เลขที่บิล', 'bill', 'เอกสาร'] },
                    { id: 'map-sku', label: '5. รหัสสินค้า (SKU)', guess: ['so product code', 'รหัสสินค้า', 'product', 'sku'] }
                ];

                let formHtml = fields.map(f => {
                    let bestMatch = headers.find(h => f.guess.some(g => h.toLowerCase().includes(g))) || "";
                    let options = `<option value="" class="text-gray-400">-- ❌ ไม่ใช้ข้อมูลส่วนนี้ --</option>` + headers.map(h => `<option value="${h}" ${h === bestMatch ? 'selected' : ''}>${h}</option>`).join('');
                    return `<div class="bg-gray-50/50 p-2 rounded-lg border border-gray-200"><label class="block text-xs font-bold text-gray-700 mb-1">${f.label}</label><select id="${f.id}" class="w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium shadow-inner">${options}</select></div>`;
                }).join('');

                formHtml += `<div class="mt-4 pt-4 border-t border-gray-200"><div class="flex justify-between items-center mb-2"><label class="block text-sm font-black text-indigo-700">➕ คอลัมน์เพิ่มเติม (Custom)</label><button onclick="SalesData.addCustomField()" class="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1 rounded-lg text-xs font-bold transition shadow-sm">+ เพิ่มคอลัมน์</button></div><div id="custom-fields-container" class="space-y-2"></div></div>`;
                document.getElementById('mapping-form').innerHTML = formHtml; UI.hideLoader(); document.getElementById('mappingModal').classList.remove('hidden');
            } catch(error) { UI.hideLoader(); alert("เกิดข้อผิดพลาด: " + error.message); }
            document.getElementById('salesUpload').value = ''; 
        };
        reader.readAsArrayBuffer(file);
    },

    addCustomField: () => {
        let container = document.getElementById('custom-fields-container');
        let fieldId = `custom-map-${SalesData.customFieldCount++}`;
        let options = `<option value="" disabled selected>-- เลือกคอลัมน์จาก Excel --</option>` + SalesData.tempHeaders.map(h => `<option value="${h}">${h}</option>`).join('');
        let div = document.createElement('div'); div.className = "flex gap-2 items-center bg-indigo-50/50 p-2 rounded-lg border border-indigo-100 animate-fade-in"; div.id = `box-${fieldId}`;
        div.innerHTML = `<select id="${fieldId}" class="custom-map-select flex-1 p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white font-medium shadow-inner">${options}</select><button onclick="document.getElementById('box-${fieldId}').remove()" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 font-bold transition flex-shrink-0">✕</button>`;
        container.appendChild(div);
    },

    applyMapping: () => {
        let idCol = document.getElementById('map-id').value; let nameCol = document.getElementById('map-name').value; let vpoCol = document.getElementById('map-vpo').value; let billCol = document.getElementById('map-bill').value; let skuCol = document.getElementById('map-sku').value;
        let customCols = []; document.querySelectorAll('.custom-map-select').forEach(sel => { if(sel.value) customCols.push(sel.value); });

        if(!idCol) return alert("❌ กรุณาเลือกคอลัมน์สำหรับ 'รหัสลูกค้า'");
        document.getElementById('mappingModal').classList.add('hidden');
        UI.showLoader("กำลังประมวลผลข้อมูล...", "กำลังแบ่งไฟล์เป็นกล่องย่อยเพื่อหลบลิมิต 1MB ของ Firebase...");

        setTimeout(() => {
            let temp = {}; 
            SalesData.tempJson.forEach(row => {
                let storeId = String(row[idCol]).trim(); if(!storeId) return;
                if(!temp[storeId]) { 
                    temp[storeId] = { id: storeId, name: nameCol && row[nameCol] ? String(row[nameCol]).trim() : 'ไม่ระบุชื่อ', vpo: 0, bills: new Set(), skus: new Set(), hasJelly: false, hasKlom: false }; 
                    customCols.forEach(col => { temp[storeId][col] = row[col] !== undefined ? row[col] : ""; });
                }
                let qty = vpoCol && row[vpoCol] ? parseFloat(String(row[vpoCol]).replace(/[^0-9.-]/g, '')) : 0;
                if(!isNaN(qty)) temp[storeId].vpo += qty;
                if(billCol && row[billCol]) temp[storeId].bills.add(row[billCol]);
                if(skuCol && row[skuCol]) { let sku = String(row[skuCol]).trim(); temp[storeId].skus.add(sku); if(sku.includes("เจลลี่")) temp[storeId].hasJelly = true; if(sku.includes("กลมกล่อม")) temp[storeId].hasKlom = true; }
            });

            let newSalesKPI = {};
            Object.keys(temp).forEach(id => {
                newSalesKPI[id] = { id: temp[id].id, name: temp[id].name, vpo: Math.round(temp[id].vpo * 100) / 100, billCount: temp[id].bills.size, skuCount: temp[id].skus.size, hasJelly: temp[id].hasJelly, hasKlom: temp[id].hasKlom, active: temp[id].vpo > 0 };
                customCols.forEach(col => { newSalesKPI[id][col] = temp[id][col]; });
            });

            // 🚀 หัวใจสำคัญ: ระบบหั่นข้อมูล (Chunking) เป็นชิ้นละ 400 ร้านค้า เพื่อหลบข้อจำกัด 1MB
            cloudDB.collection('v1_sales_chunks').get().then(snap => {
                // ขั้นที่ 1: ลบกล่องเก่าทิ้งก่อน
                let delBatch = cloudDB.batch(); snap.forEach(doc => delBatch.delete(doc.ref));
                return delBatch.commit();
            }).then(() => {
                // ขั้นที่ 2: แบ่งกล่องละ 400 ข้อมูล แล้วอัปโหลด
                let keys = Object.keys(newSalesKPI);
                let chunkSize = 400; 
                let promises = [];
                for(let i=0; i<keys.length; i+=chunkSize) {
                    let chunkData = {};
                    keys.slice(i, i+chunkSize).forEach(k => chunkData[k] = newSalesKPI[k]);
                    promises.push(cloudDB.collection('v1_sales_chunks').doc('chunk_'+(i/chunkSize)).set(chunkData));
                }
                return Promise.all(promises);
            }).then(() => {
                State.sales = newSalesKPI; App.sync(); DataMgr.render(); UI.hideLoader(); SalesData.tempJson = []; 
                alert(`✅ นำเข้าข้อมูลสำเร็จ!\nจัดระเบียบข้อมูล ${Object.keys(newSalesKPI).length} ร้านค้าเรียบร้อยแล้ว`);
            }).catch(err => { UI.hideLoader(); alert("อัปโหลดไม่สำเร็จ: " + err.message); });
            
        }, 100); 
    }
};

// ==========================================
// 4. ระบบ Export ไฟล์ (Excel IO)
// ==========================================
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

// ==========================================
// 5. ระบบประสานงานหลัก (App Core)
// ==========================================
const App = {
    dbRef: cloudDB.collection('appData').doc('v1_main'),

    init: () => {
        MapCtrl.init();
        UI.showLoader("กำลังเชื่อมต่อฐานข้อมูล...", "");
        
        App.dbRef.onSnapshot((doc) => {
            let dataFromServer = doc.exists ? doc.data() : {};
            State.db.routes = dataFromServer.routes || {"สายที่ 1": []};
            State.db.backups = dataFromServer.backups || {};
            State.db.cycleDays = dataFromServer.cycleDays || 24;

            let sortedKeys = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true}));
            if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                let savedLocal = localStorage.getItem('last_viewed_route');
                State.localActiveRoute = (savedLocal && State.db.routes[savedLocal]) ? savedLocal : sortedKeys[0];
            }
            State.stores = State.db.routes[State.localActiveRoute] || [];
            App.updateStatusUI("✅ ข้อมูลตรงกับคลาวด์", "emerald");
            App.fetchSalesData();
        }, (error) => { App.updateStatusUI("🔴 ออฟไลน์", "red"); UI.hideLoader(); });

        document.getElementById('salesUpload').addEventListener('change', function(e) { const file = e.target.files[0]; if (file) SalesData.processExcel(file); });
        document.getElementById('fileUpload').addEventListener('change', App.handleMapUpload);
    },

    // 🚀 ระบบดาวน์โหลดข้อมูล: ดึงกล่องย่อยทุกกล่องมารวมร่างกัน
    fetchSalesData: () => {
        cloudDB.collection('v1_sales_chunks').get().then(snap => {
            let mergedSales = {};
            snap.forEach(doc => { Object.assign(mergedSales, doc.data()); });
            State.sales = mergedSales;
            App.sync(); UI.hideLoader(); DataMgr.render(); 
            setTimeout(() => MapCtrl.fitToStores(), 300);
        }).catch(err => { App.sync(); UI.hideLoader(); });
    },

    updateStatusUI: (msg, color) => { let badge = document.getElementById('db-save-status'); badge.className = `flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all duration-300 bg-${color}-100 text-${color}-700 border-${color}-200`; badge.innerHTML = msg; },
    saveDB: () => { State.db.routes[State.localActiveRoute] = State.stores; App.updateStatusUI("⏳ กำลังบันทึก...", "yellow"); App.dbRef.set(State.db).then(() => { App.updateStatusUI("✅ บันทึกสำเร็จ", "emerald"); UI.showSaveToast("บันทึกคิวงานและเส้นทางเรียบร้อย"); }).catch(err => { App.updateStatusUI("❌ บันทึกล้มเหลว", "red"); }); },
    sync: () => { let rs = document.getElementById('routeSelector'); if(rs) { let sortedRoutes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true})); let newHTML = sortedRoutes.map(r => `<option value="${r}">${r}</option>`).join(''); if (rs.innerHTML !== newHTML) { rs.innerHTML = newHTML; } rs.value = State.localActiveRoute; } MapCtrl.clearAll(); UI.initDaySelector(); UI.render(); },
    
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

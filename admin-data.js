const StoreMgr = {
    toggleSelect: (id) => { let s = State.stores.find(x=>x.id===String(id)); if(s){ s.selected = !s.selected; UI.switchTab('tab2'); UI.render(); App.saveDB(); } },
    clearSelection: () => { State.stores.forEach(s=>s.selected=false); UI.render(); App.saveDB(); },
    changeDay: (id, d) => { let s = State.stores.find(x=>x.id===String(id)); if(s) { if(d === 'remove') s.days = []; else if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.seqs = {}; MapCtrl.closePopups(); UI.render(); App.saveDB(); } },
    assignSelected: () => { let d = document.getElementById('assign-day').value; let h = false; State.stores.forEach(s => { if(s.selected) { if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.selected = false; h = true; } }); if(!h) alert("กรุณาเลือกร้านค้าก่อนครับ"); else { UI.render(); App.saveDB(); } },
    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2)
};

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
        let internalKeys = ['vpo', 'billCount', 'skuCount', 'hasJelly', 'hasKlom', 'active', '_originalRow'];
        let headers = firstRecord._originalRow ? Object.keys(firstRecord._originalRow) : Object.keys(firstRecord).filter(k => !internalKeys.includes(k));

        let thHtml = '<tr>' + headers.map(h => `<th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap">${h}</th>`).join('') + 
                     `<th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap text-emerald-700 bg-emerald-50 border-l border-emerald-100 shadow-[inset_2px_0_4px_rgba(0,0,0,0.02)]">VPO (แอปคำนวณ)</th>` +
                     `<th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap text-emerald-700 bg-emerald-50">บิล / SKU</th>` +
                     '</tr>';
        document.getElementById('data-table-head').innerHTML = thHtml;

        salesKeys.forEach(id => {
            let k = State.sales[id];
            let rowData = k._originalRow || k;
            let tds = headers.map(h => `<td class="p-3 px-4 text-sm border-b border-gray-100 whitespace-nowrap">${rowData[h] !== undefined && rowData[h] !== "" ? rowData[h] : '-'}</td>`).join('');
            
            tds += `<td class="p-3 px-4 text-sm font-black text-blue-600 border-b border-gray-100 whitespace-nowrap bg-emerald-50/30 border-l border-emerald-100 shadow-[inset_2px_0_4px_rgba(0,0,0,0.02)]">${k.vpo || 0}</td>`;
            tds += `<td class="p-3 px-4 text-[11px] font-bold text-gray-500 border-b border-gray-100 whitespace-nowrap bg-emerald-50/30">${k.billCount || 0} บิล / ${k.skuCount || 0} SKU</td>`;

            html.push(`<tr class="hover:bg-indigo-50/60 transition">${tds}</tr>`);
        });
        
        document.getElementById('data-table-body').innerHTML = html.join('');
    },
    clearAll: () => {
        if(confirm("⚠️ ยืนยันการลบข้อมูลยอดขาย (KPI) ทั้งหมดออกจากระบบ? (แผนที่จะไม่โดนลบ)")) {
            UI.showLoader("กำลังลบข้อมูล...");
            App.salesRef.set({}).then(() => { State.sales = {}; App.sync(); DataMgr.render(); UI.hideLoader(); UI.showSaveToast("ล้าง KPI เรียบร้อย"); });
        }
    }
};

const SalesData = {
    processExcel: (file) => {
        UI.showLoader("กำลังอ่านไฟล์และสร้างตาราง...", "ใช้เวลาประมาณ 2-5 วินาที");
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result); const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval: ""}); 
                if (json.length < 1) throw new Error("ไฟล์ว่างเปล่า");
                
                let headers = Object.keys(json[0]);
                let idCol = headers.find(h => h.toLowerCase().includes('customer code') || h.includes('รหัสลูกค้า') || h.includes('id')) || headers[0];
                let skuCol = headers.find(h => h.toLowerCase().includes('so product code') || h.includes('รหัสสินค้า') || h.includes('product'));
                let qtyCol = headers.find(h => h.toLowerCase().includes('so total') || h.includes('qty') || h.includes('จำนวน') || h.includes('vpo'));
                let invCol = headers.find(h => h.toLowerCase().includes('invoice') || h.includes('เลขที่บิล') || h.includes('bill'));

                let temp = {}; let rowCount = 0;
                json.forEach(row => {
                    let storeId = String(row[idCol]).trim(); if(!storeId) return;
                    rowCount++;
                    if(!temp[storeId]) { temp[storeId] = { _originalRow: { ...row }, vpo: 0, bills: new Set(), skus: new Set(), hasJelly: false, hasKlom: false }; }
                    
                    let qty = qtyCol ? parseFloat(String(row[qtyCol]).replace(/[^0-9.-]/g, '')) : 0;
                    if(!isNaN(qty)) temp[storeId].vpo += qty;
                    if(invCol && row[invCol]) temp[storeId].bills.add(row[invCol]);
                    if(skuCol && row[skuCol]) { let sku = String(row[skuCol]).trim(); temp[storeId].skus.add(sku); if(sku.includes("เจลลี่")) temp[storeId].hasJelly = true; if(sku.includes("กลมกล่อม")) temp[storeId].hasKlom = true; }
                });

                let newSalesKPI = {};
                Object.keys(temp).forEach(id => {
                    newSalesKPI[id] = {
                        ...temp[id]._originalRow,
                        _originalRow: temp[id]._originalRow,
                        vpo: Math.round(temp[id].vpo * 100) / 100,
                        billCount: temp[id].bills.size, skuCount: temp[id].skus.size, hasJelly: temp[id].hasJelly, hasKlom: temp[id].hasKlom, active: temp[id].vpo > 0
                    };
                });

                UI.showLoader("กำลังอัปเดตตารางและแผนที่...", `พบข้อมูล ${Object.keys(newSalesKPI).length} ร้าน`);
                App.salesRef.set(newSalesKPI).then(() => {
                    State.sales = newSalesKPI; App.sync(); DataMgr.render(); UI.hideLoader();
                    alert(`✅ นำเข้าข้อมูลสำเร็จ!\nระบบสร้างตารางตรงตามไฟล์ของคุณเรียบร้อย`);
                }).catch(err => { UI.hideLoader(); alert("อัปโหลดไม่สำเร็จ: " + err.message); });

            } catch(error) { UI.hideLoader(); alert("เกิดข้อผิดพลาด: " + error.message); }
            document.getElementById('salesUpload').value = ''; 
        };
        reader.readAsArrayBuffer(file);
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
    salesRef: cloudDB.collection('appData').doc('v1_sales'),

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

        }, (error) => {
            App.updateStatusUI("🔴 ออฟไลน์", "red");
            UI.hideLoader();
        });

        // 🌟 แนบ Event Listeners การอัปโหลดไฟล์
        document.getElementById('salesUpload').addEventListener('change', function(e) { const file = e.target.files[0]; if (file) SalesData.processExcel(file); });
        document.getElementById('fileUpload').addEventListener('change', App.handleMapUpload);
    },

    fetchSalesData: () => {
        App.salesRef.get().then(doc => {
            if(doc.exists) { State.sales = doc.data(); } else { State.sales = {}; }
            App.sync();
            UI.hideLoader();
            DataMgr.render(); 
            setTimeout(() => MapCtrl.fitToStores(), 300);
        }).catch(err => {
            App.sync(); UI.hideLoader();
        });
    },

    updateStatusUI: (msg, color) => {
        let badge = document.getElementById('db-save-status');
        badge.className = `flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all duration-300 bg-${color}-100 text-${color}-700 border-${color}-200`;
        badge.innerHTML = msg;
    },

    saveDB: () => {
        State.db.routes[State.localActiveRoute] = State.stores;
        App.updateStatusUI("⏳ กำลังบันทึก...", "yellow");
        App.dbRef.set(State.db).then(() => {
            App.updateStatusUI("✅ บันทึกสำเร็จ", "emerald");
            UI.showSaveToast("บันทึกคิวงานและเส้นทางเรียบร้อย"); 
        }).catch(err => { App.updateStatusUI("❌ บันทึกล้มเหลว", "red"); });
    },

    sync: () => {
        let rs = document.getElementById('routeSelector');
        if(rs) { 
            let sortedRoutes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true}));
            let newHTML = sortedRoutes.map(r => `<option value="${r}">${r}</option>`).join('');
            if (rs.innerHTML !== newHTML) { rs.innerHTML = newHTML; }
            rs.value = State.localActiveRoute; 
        }
        MapCtrl.clearAll(); UI.initDaySelector(); UI.render();
    },
    
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
                    if(h.includes('รหัส') || h.includes('customer code') || h.includes('id')) idCol = i;
                    else if(h.includes('ชื่อ') || h.includes('name')) nameCol = i;
                    else if(h.includes('lat') || h.includes('ละติจูด')) latCol = i;
                    else if(h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด')) lngCol = i;
                    else if(h.includes('freq') || h.includes('ความถี่') || h.includes('รอบ') || h.includes('f2')) freqCol = i;
                    else if(h.includes('สายวิ่ง') || h.includes('day')) dayCol = i;
                    else if(h.includes('คิว') || h.includes('seq')) seqCol = i;
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

                    if (storeMap[idStr]) {
                        if (isValidDay && !storeMap[idStr].days.includes(assignedDay)) { storeMap[idStr].days.push(assignedDay); if (!isNaN(assignedSeq)) storeMap[idStr].seqs[assignedDay] = assignedSeq; }
                        storeMap[idStr].freq = 2; 
                    } else {
                        let newStore = { id: idStr, name: row[nameCol] ? String(row[nameCol]).trim() : `Store_${idStr}`, lat: lat, lng: lng, freq: freq, days: [], seqs: {}, selected: false };
                        if (isValidDay) { newStore.days.push(assignedDay); if (!isNaN(assignedSeq)) newStore.seqs[assignedDay] = assignedSeq; }
                        storeMap[idStr] = newStore;
                    }
                }
                let finalArray = Object.values(storeMap); if(finalArray.length === 0) return alert("ไม่พบพิกัด (Lat, Lng)");
                State.stores = finalArray; App.sync(); App.saveDB(); MapCtrl.fitToStores(); 

            } catch(err) { alert("ขัดข้อง: " + err.message); }
            document.getElementById('fileUpload').value = ''; 
        };
        reader.readAsArrayBuffer(file);
    }
};

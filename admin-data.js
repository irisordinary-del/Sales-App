const StoreMgr = {
    toggleSelect: (id) => { let s = State.stores.find(x=>x.id===String(id)); if(s){ s.selected = !s.selected; UI.switchTab('tab2'); UI.render(); App.saveDB(); } },
    clearSelection: () => { State.stores.forEach(s=>s.selected=false); UI.render(); App.saveDB(); },
    changeDay: (id, d) => { let s = State.stores.find(x=>x.id===String(id)); if(s) { if(d === 'remove') s.days = []; else if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.seqs = {}; MapCtrl.closePopups(); UI.render(); App.saveDB(); } },
    assignSelected: () => { let d = document.getElementById('assign-day').value; let h = false; State.stores.forEach(s => { if(s.selected) { if(s.freq === 2) { let mK = State.db.cycleDays/2; let num = parseInt(d.replace('Day ','')); let pair = num<=mK ? num+mK : num-mK; s.days=[d, `Day ${pair}`]; } else s.days = [d]; s.selected = false; h = true; } }); if(!h) alert("กรุณาเลือกร้านค้าก่อนครับ"); else { UI.render(); App.saveDB(); } },
    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2)
};

// 🌟 อัปเกรด 1: ตารางแสดงผลที่รองรับ "คอลัมน์แบบไดนามิก (งอกเองได้)"
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
        
        // คีย์พื้นฐานของระบบ
        let standardKeys = ['id', 'name', 'vpo', 'billCount', 'skuCount', 'hasJelly', 'hasKlom', 'active'];
        
        // กรองหา "คีย์พิเศษ (Custom Columns)" ที่คุณเพิ่มเข้ามาตอน Mapping
        let customKeys = Object.keys(firstRecord).filter(k => !standardKeys.includes(k));

        // สร้างหัวตาราง (Th) สำหรับคอลัมน์เสริม
        let customTh = customKeys.map(k => `<th class="p-3 px-4 font-bold border-b border-gray-200 whitespace-nowrap bg-indigo-50/50 sticky top-0 text-indigo-800">${k}</th>`).join('');

        // จัดหัวตารางใหม่ให้เป็นระเบียบ
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
            
            // เช็คป้าย Tag สำหรับสินค้าโฟกัส
            let focusHtml = '';
            if(k.hasJelly) focusHtml += `<span class="bg-pink-100 text-pink-600 px-2 py-0.5 rounded text-[10px] font-bold mr-1 border border-pink-200">เจลลี่</span>`;
            if(k.hasKlom) focusHtml += `<span class="bg-amber-100 text-amber-600 px-2 py-0.5 rounded text-[10px] font-bold border border-amber-200">กลมกล่อม</span>`;
            if(!k.hasJelly && !k.hasKlom) focusHtml = `<span class="text-gray-300 text-xs font-bold">-</span>`;

            // ดึงข้อมูลสำหรับคอลัมน์เสริม
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
            App.salesRef.set({}).then(() => { State.sales = {}; App.sync(); DataMgr.render(); UI.hideLoader(); UI.showSaveToast("ล้าง KPI เรียบร้อย"); });
        }
    }
};

// 🌟 อัปเกรด 2: ระบบ Data Mapping แบบเพิ่มคอลัมน์ได้ไม่จำกัด!
const SalesData = {
    tempJson: [], 
    tempHeaders: [], 
    customFieldCount: 0, // ตัวนับจำนวนคอลัมน์พิเศษที่ถูกเพิ่ม
    
    processExcel: (file) => {
        UI.showLoader("กำลังอ่านหัวคอลัมน์...", "รอสักครู่");
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result); 
                const workbook = XLSX.read(data, {type: 'array'});
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval: ""}); 
                if (json.length < 1) throw new Error("ไฟล์ว่างเปล่า");
                
                SalesData.tempJson = json; 
                let headers = Object.keys(json[0]);
                SalesData.tempHeaders = headers; // เก็บหัวตารางไว้ใช้กับ Dropdown
                SalesData.customFieldCount = 0;
                
                // โครงสร้างที่ระบบต้องการ พร้อมคำใบ้สำหรับการเดาอัตโนมัติ
                let fields = [
                    { id: 'map-id', label: '1. รหัสลูกค้า <span class="text-red-500">*จำเป็น</span>', guess: ['customer code', 'รหัส', 'id'] },
                    { id: 'map-name', label: '2. ชื่อร้านค้า', guess: ['customer name', 'ชื่อ', 'name'] },
                    { id: 'map-vpo', label: '3. ยอดขาย (Qty/VPO)', guess: ['so total', 'qty', 'จำนวน', 'vpo'] },
                    { id: 'map-bill', label: '4. เลขที่บิล (Invoice)', guess: ['invoice', 'เลขที่บิล', 'bill', 'เอกสาร'] },
                    { id: 'map-sku', label: '5. รหัสสินค้า (SKU)', guess: ['so product code', 'รหัสสินค้า', 'product', 'sku'] }
                ];

                // สร้าง Dropdown จับคู่พื้นฐาน
                let formHtml = fields.map(f => {
                    let bestMatch = headers.find(h => f.guess.some(g => h.toLowerCase().includes(g))) || "";
                    let options = `<option value="" class="text-gray-400">-- ❌ ไม่ใช้ข้อมูลส่วนนี้ --</option>` + 
                                  headers.map(h => `<option value="${h}" ${h === bestMatch ? 'selected' : ''}>${h}</option>`).join('');
                    
                    return `
                    <div class="bg-gray-50/50 p-2 rounded-lg border border-gray-200">
                        <label class="block text-xs font-bold text-gray-700 mb-1">${f.label}</label>
                        <select id="${f.id}" class="w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium shadow-inner">
                            ${options}
                        </select>
                    </div>`;
                }).join('');

                // 🌟 เพิ่มโซนสำหรับ "คอลัมน์พิเศษ (Custom)"
                formHtml += `
                    <div class="mt-4 pt-4 border-t border-gray-200">
                        <div class="flex justify-between items-center mb-2">
                            <label class="block text-sm font-black text-indigo-700">➕ คอลัมน์เพิ่มเติม (Custom)</label>
                            <button onclick="SalesData.addCustomField()" class="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1 rounded-lg text-xs font-bold transition shadow-sm">+ เพิ่มคอลัมน์</button>
                        </div>
                        <div id="custom-fields-container" class="space-y-2"></div>
                    </div>
                `;

                document.getElementById('mapping-form').innerHTML = formHtml;
                UI.hideLoader();
                document.getElementById('mappingModal').classList.remove('hidden');

            } catch(error) { UI.hideLoader(); alert("เกิดข้อผิดพลาด: " + error.message); }
            document.getElementById('salesUpload').value = ''; 
        };
        reader.readAsArrayBuffer(file);
    },

    // 🌟 ฟังก์ชันสำหรับเสก Dropdown ใหม่
    addCustomField: () => {
        let container = document.getElementById('custom-fields-container');
        let fieldId = `custom-map-${SalesData.customFieldCount++}`;
        
        let options = `<option value="" disabled selected>-- เลือกคอลัมน์จาก Excel --</option>` + 
                      SalesData.tempHeaders.map(h => `<option value="${h}">${h}</option>`).join('');
        
        let div = document.createElement('div');
        div.className = "flex gap-2 items-center bg-indigo-50/50 p-2 rounded-lg border border-indigo-100 animate-fade-in";
        div.id = `box-${fieldId}`;
        div.innerHTML = `
            <select id="${fieldId}" class="custom-map-select flex-1 p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white font-medium shadow-inner">
                ${options}
            </select>
            <button onclick="document.getElementById('box-${fieldId}').remove()" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 font-bold transition flex-shrink-0">✕</button>
        `;
        container.appendChild(div);
    },

    applyMapping: () => {
        let idCol = document.getElementById('map-id').value;
        let nameCol = document.getElementById('map-name').value;
        let vpoCol = document.getElementById('map-vpo').value;
        let billCol = document.getElementById('map-bill').value;
        let skuCol = document.getElementById('map-sku').value;

        // 🌟 กวาดหาคอลัมน์พิเศษทั้งหมดที่ผู้ใช้กดเพิ่ม
        let customCols = [];
        document.querySelectorAll('.custom-map-select').forEach(sel => {
            if(sel.value) customCols.push(sel.value);
        });

        if(!idCol) {
            return alert("❌ กรุณาเลือกคอลัมน์สำหรับ 'รหัสลูกค้า'\nถ้าระบุไม่ได้ ระบบจะไม่สามารถผูกข้อมูลกับแผนที่ได้ครับ");
        }

        document.getElementById('mappingModal').classList.add('hidden');
        UI.showLoader("กำลังประมวลผลข้อมูล...", "ระบบกำลังจัดกลุ่มและรวมคอลัมน์");

        setTimeout(() => {
            let temp = {}; 
            SalesData.tempJson.forEach(row => {
                let storeId = String(row[idCol]).trim(); 
                if(!storeId) return;
                
                if(!temp[storeId]) { 
                    temp[storeId] = { 
                        id: storeId,
                        name: nameCol && row[nameCol] ? String(row[nameCol]).trim() : 'ไม่ระบุชื่อ',
                        vpo: 0, bills: new Set(), skus: new Set(), hasJelly: false, hasKlom: false 
                    }; 
                    
                    // 🌟 สร้างพื้นที่เก็บคอลัมน์พิเศษล่วงหน้า
                    customCols.forEach(col => {
                        temp[storeId][col] = row[col] !== undefined ? row[col] : "";
                    });
                }
                
                let qty = vpoCol && row[vpoCol] ? parseFloat(String(row[vpoCol]).replace(/[^0-9.-]/g, '')) : 0;
                if(!isNaN(qty)) temp[storeId].vpo += qty;
                
                if(billCol && row[billCol]) temp[storeId].bills.add(row[billCol]);
                
                if(skuCol && row[skuCol]) { 
                    let sku = String(row[skuCol]).trim(); 
                    temp[storeId].skus.add(sku); 
                    if(sku.includes("เจลลี่")) temp[storeId].hasJelly = true; 
                    if(sku.includes("กลมกล่อม")) temp[storeId].hasKlom = true; 
                }
            });

            let newSalesKPI = {};
            Object.keys(temp).forEach(id => {
                newSalesKPI[id] = {
                    id: temp[id].id,
                    name: temp[id].name,
                    vpo: Math.round(temp[id].vpo * 100) / 100,
                    billCount: temp[id].bills.size, 
                    skuCount: temp[id].skus.size, 
                    hasJelly: temp[id].hasJelly, 
                    hasKlom: temp[id].hasKlom, 
                    active: temp[id].vpo > 0
                };
                
                // 🌟 ยัดคอลัมน์พิเศษใส่กล่องข้อมูล ก่อนส่งขึ้น Firebase
                customCols.forEach(col => {
                    newSalesKPI[id][col] = temp[id][col];
                });
            });

            App.salesRef.set(newSalesKPI).then(() => {
                State.sales = newSalesKPI; App.sync(); DataMgr.render(); UI.hideLoader();
                SalesData.tempJson = []; // คืนพื้นที่หน่วยความจำ
                alert(`✅ นำเข้าข้อมูลสำเร็จ!\nเพิ่มคอลัมน์พิเศษ ${customCols.length} คอลัมน์ เรียบร้อยแล้ว`);
            }).catch(err => { UI.hideLoader(); alert("อัปโหลดไม่สำเร็จ: " + err.message); });
            
        }, 100); 
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

// ==========================================
// 🏪 Store Manager
// ==========================================
const StoreMgr = {
    toggleSelect: (id) => {
        const s = State.stores.find(x => x.id === String(id));
        if (s) {
            s.selected = !s.selected;
            UI.switchTab('tab2');
            UI.render();
            App.saveDB();
        }
    },

    clearSelection: () => {
        State.stores.forEach(s => s.selected = false);
        UI.render();
        App.saveDB();
    },

    changeDay: (id, d) => {
        const s = State.stores.find(x => x.id === String(id));
        if (!s) return;
        if (d === 'remove') {
            s.days = [];
        } else if (s.freq === 2) {
            const mK = State.db.cycleDays / 2;
            const num = parseInt(d.replace('Day ', ''));
            const pair = num <= mK ? num + mK : num - mK;
            s.days = [d, `Day ${pair}`];
        } else {
            s.days = [d];
        }
        s.seqs = {};
        MapCtrl.closePopups();
        UI.render();
        App.saveDB();
    },

    assignSelected: () => {
        const ds = document.getElementById('assign-day');
        if (!ds) return;
        const d = ds.value;
        const mK = State.db.cycleDays / 2;
        let changed = false;

        State.stores.forEach(s => {
            if (!s.selected) return;
            if (s.freq === 2) {
                const num = parseInt(d.replace('Day ', ''));
                const pair = num <= mK ? num + mK : num - mK;
                s.days = [d, `Day ${pair}`];
            } else {
                s.days = [d];
            }
            s.selected = false;
            s.seqs = {};
            changed = true;
        });

        if (!changed) {
            alert('กรุณาเลือกร้านค้าก่อนครับ');
        } else {
            UI.render();
            App.saveDB();
        }
    },

    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2)
};

// ==========================================
// 📂 Raw Data Manager
// ==========================================
const RawDataMgr = {
    tempJson: [],

    processExcel: (file) => {
        UI.showLoader('กำลังอ่านไฟล์...', 'รอสักครู่');
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(
                    workbook.Sheets[workbook.SheetNames[0]], { defval: '' }
                );
                if (json.length < 1) throw new Error('ไฟล์ว่างเปล่า');

                RawDataMgr.tempJson = json;
                const headers = Object.keys(json[0]);
                const savedCols = State.db.savedRawColumns || [];

                const html = headers.map(h => {
                    const isChecked = savedCols.length === 0 || savedCols.includes(h) ? 'checked' : '';
                    return `
                    <label class="flex items-center gap-2 p-2 border rounded-lg bg-gray-50 cursor-pointer hover:bg-indigo-50">
                        <input type="checkbox" value="${h}" class="raw-col-cb w-4 h-4 text-indigo-600 rounded" ${isChecked}>
                        <span class="text-xs font-bold text-gray-700 truncate">${h}</span>
                    </label>`;
                }).join('');

                const cbEl = document.getElementById('column-checkboxes');
                if (cbEl) cbEl.innerHTML = html;
                UI.hideLoader();
                const modal = document.getElementById('columnSelectModal');
                if (modal) modal.classList.remove('hidden');
            } catch (error) {
                UI.hideLoader();
                alert('อ่านไฟล์ไม่ได้: ' + error.message);
            }
            const inp = document.getElementById('rawUpload');
            if (inp) inp.value = '';
        };
        reader.readAsArrayBuffer(file);
    },

    applyImport: () => {
        const selectedCols = [];
        document.querySelectorAll('.raw-col-cb:checked').forEach(cb => selectedCols.push(cb.value));
        if (selectedCols.length === 0) return alert('กรุณาเลือกอย่างน้อย 1 คอลัมน์');

        const modal = document.getElementById('columnSelectModal');
        if (modal) modal.classList.add('hidden');
        UI.showLoader('กำลังกรองข้อมูล...', 'สร้างฐานข้อมูลดิบ');

        setTimeout(() => {
            const rawData = RawDataMgr.tempJson.map(row => {
                const cleanRow = {};
                selectedCols.forEach(col => { cleanRow[col] = row[col]; });
                return cleanRow;
            });

            State.db.savedRawColumns = selectedCols;
            App.dbRef.update({ savedRawColumns: selectedCols })
                .catch(err => console.warn('บันทึก savedRawColumns ไม่สำเร็จ:', err));

            cloudDB.collection('v1_raw_chunks').get().then(snap => {
                const delBatch = cloudDB.batch();
                snap.forEach(doc => delBatch.delete(doc.ref));
                return delBatch.commit();
            }).then(() => {
                const chunkSize = 500;
                const promises = [];
                for (let i = 0; i < rawData.length; i += chunkSize) {
                    const chunk = { rows: rawData.slice(i, i + chunkSize) };
                    promises.push(
                        cloudDB.collection('v1_raw_chunks').doc('chunk_' + (i / chunkSize)).set(chunk)
                    );
                }
                return Promise.all(promises);
            }).then(() => {
                State.rawData = rawData;
                RawDataMgr.renderTable();
                UI.hideLoader();
                RawDataMgr.tempJson = [];
                UI.showSaveToast('✅ อัปโหลดข้อมูลดิบสำเร็จ!');
            }).catch(err => {
                UI.hideLoader();
                alert('อัปโหลดไม่สำเร็จ: ' + err.message);
            });
        }, 100);
    },

    renderTable: () => {
        const raw = State.rawData || [];
        const totalEl = document.getElementById('raw-total-rows');
        if (totalEl) totalEl.innerText = raw.length.toLocaleString();

        if (raw.length === 0) {
            const head = document.getElementById('raw-table-head');
            const body = document.getElementById('raw-table-body');
            if (head) head.innerHTML = '';
            if (body) body.innerHTML = '<tr><td class="text-center p-8 text-gray-400">ไม่มีข้อมูลดิบ</td></tr>';
            return;
        }

        const cols = Object.keys(raw[0]);
        const th = '<tr>' + cols.map(c => `<th class="p-3 border-b bg-gray-100 sticky top-0">${c}</th>`).join('') + '</tr>';
        const headEl = document.getElementById('raw-table-head');
        if (headEl) headEl.innerHTML = th;

        let html = raw.slice(0, 500).map(row =>
            '<tr class="hover:bg-blue-50/50">' +
            cols.map(c => `<td class="p-3 text-sm border-b border-gray-100">${row[c] !== undefined ? row[c] : ''}</td>`).join('') +
            '</tr>'
        ).join('');

        if (raw.length > 500) {
            html += `<tr><td colspan="${cols.length}" class="text-center p-4 text-xs text-gray-400">... ซ่อนข้อมูลแถวที่ 501 ถึง ${raw.length} ไว้เพื่อความรวดเร็ว ...</td></tr>`;
        }
        const bodyEl = document.getElementById('raw-table-body');
        if (bodyEl) bodyEl.innerHTML = html;
    },

    clearAll: () => {
        if (!confirm('ล้างข้อมูลดิบทั้งหมด?')) return;
        UI.showLoader('กำลังลบ...');
        cloudDB.collection('v1_raw_chunks').get().then(snap => {
            const delBatch = cloudDB.batch();
            snap.forEach(doc => delBatch.delete(doc.ref));
            return delBatch.commit();
        }).then(() => {
            State.rawData = [];
            RawDataMgr.renderTable();
            UI.hideLoader();
            UI.showSaveToast('🗑️ ล้างข้อมูลดิบเรียบร้อย');
        }).catch(err => {
            UI.hideLoader();
            alert('ลบไม่สำเร็จ: ' + err.message);
        });
    }
};

// ==========================================
// 🎯 KPI Manager
// ==========================================
const KPIMgr = {
    renderSetup: () => {
        const selectorEl = document.getElementById('kpi-selectors');
        if (!selectorEl) return;

        if (!State.rawData || State.rawData.length === 0) {
            selectorEl.innerHTML = '<p class="col-span-3 text-red-500 font-bold text-sm">⚠️ ยังไม่มีข้อมูลดิบ กรุณาไปที่แท็บ "ข้อมูลการขาย" เพื่ออัปโหลดก่อนครับ</p>';
            return;
        }

        const cols = Object.keys(State.rawData[0]);
        const saved = State.db.kpiSettings || {};

        const fields = [
            { id: 'kpi-id', label: 'คอลัมน์ "รหัสร้าน" (อ้างอิง)', val: saved.idCol || cols.find(h => h.toLowerCase().includes('id') || h.includes('รหัส')) },
            { id: 'kpi-name', label: 'คอลัมน์ "ชื่อร้าน" (ไว้โชว์)', val: saved.nameCol || cols.find(h => h.toLowerCase().includes('name') || h.includes('ชื่อ')) },
            { id: 'kpi-vpo', label: 'คอลัมน์ "ยอดขาย" (บวกเลข)', val: saved.vpoCol || cols.find(h => h.toLowerCase().includes('qty') || h.includes('จำนวน')) },
            { id: 'kpi-bill', label: 'คอลัมน์ "เลขที่บิล" (นับจำนวน)', val: saved.billCol || cols.find(h => h.toLowerCase().includes('invoice') || h.includes('บิล')) },
            { id: 'kpi-sku', label: 'คอลัมน์ "รหัสสินค้า" (นับจำนวน)', val: saved.skuCol || cols.find(h => h.toLowerCase().includes('sku') || h.includes('product')) }
        ];

        const html = fields.map(f => {
            const opts = `<option value="">-- ไม่ใช้ --</option>` +
                cols.map(c => `<option value="${c}" ${c === f.val ? 'selected' : ''}>${c}</option>`).join('');
            return `
                <div class="bg-gray-50 p-3 rounded-xl border border-gray-200">
                    <label class="text-xs font-bold text-gray-700 block mb-1">${f.label}</label>
                    <select id="${f.id}" class="w-full p-2 border rounded-lg text-sm bg-white">${opts}</select>
                </div>`;
        }).join('');

        selectorEl.innerHTML = html;

        const f1El = document.getElementById('kpi-focus-1');
        const f2El = document.getElementById('kpi-focus-2');
        if (f1El) f1El.value = saved.f1 || 'เจลลี่';
        if (f2El) f2El.value = saved.f2 || 'กลมกล่อม';
    },

    calculatePreview: () => {
        if (!State.rawData || State.rawData.length === 0) return alert('ไม่มีข้อมูลดิบ');

        const idColEl = document.getElementById('kpi-id');
        if (!idColEl || !idColEl.value) return alert('จำเป็นต้องระบุคอลัมน์ รหัสร้าน ครับ');

        const conf = {
            idCol: idColEl.value,
            nameCol: document.getElementById('kpi-name') ? document.getElementById('kpi-name').value : '',
            vpoCol: document.getElementById('kpi-vpo') ? document.getElementById('kpi-vpo').value : '',
            billCol: document.getElementById('kpi-bill') ? document.getElementById('kpi-bill').value : '',
            skuCol: document.getElementById('kpi-sku') ? document.getElementById('kpi-sku').value : '',
            f1: document.getElementById('kpi-focus-1') ? document.getElementById('kpi-focus-1').value.trim() : '',
            f2: document.getElementById('kpi-focus-2') ? document.getElementById('kpi-focus-2').value.trim() : ''
        };

        State.db.kpiSettings = conf;
        App.dbRef.update({ kpiSettings: conf })
            .catch(err => console.warn('บันทึก kpiSettings ไม่สำเร็จ:', err));

        UI.showLoader('กำลังประมวลผล KPI...');
        setTimeout(() => {
            const temp = {};
            State.rawData.forEach(row => {
                const sId = String(row[conf.idCol] || '').trim();
                if (!sId) return;
                if (!temp[sId]) {
                    temp[sId] = {
                        id: sId,
                        name: conf.nameCol ? (row[conf.nameCol] || 'ไม่ระบุ') : 'ไม่ระบุ',
                        vpo: 0, bills: new Set(), skus: new Set(), h1: false, h2: false
                    };
                }
                if (conf.vpoCol) {
                    const qty = parseFloat(String(row[conf.vpoCol] || '').replace(/[^0-9.-]/g, ''));
                    if (!isNaN(qty)) temp[sId].vpo += qty;
                }
                if (conf.billCol && row[conf.billCol]) temp[sId].bills.add(row[conf.billCol]);
                if (conf.skuCol && row[conf.skuCol]) {
                    const sku = String(row[conf.skuCol]);
                    temp[sId].skus.add(sku);
                    if (conf.f1 && sku.includes(conf.f1)) temp[sId].h1 = true;
                    if (conf.f2 && sku.includes(conf.f2)) temp[sId].h2 = true;
                }
            });

            const newSalesKPI = {};
            Object.keys(temp).forEach(id => {
                newSalesKPI[id] = {
                    id, name: temp[id].name,
                    vpo: Math.round(temp[id].vpo * 100) / 100,
                    billCount: temp[id].bills.size,
                    skuCount: temp[id].skus.size,
                    hasJelly: temp[id].h1,
                    hasKlom: temp[id].h2,
                    active: temp[id].vpo > 0
                };
            });

            State.previewSales = newSalesKPI;
            KPIMgr.renderPreview(newSalesKPI, conf);
            UI.hideLoader();
        }, 100);
    },

    renderPreview: (kpiData, conf) => {
        const keys = Object.keys(kpiData);
        const countEl = document.getElementById('kpi-preview-count');
        if (countEl) countEl.innerText = keys.length.toLocaleString();

        const th = `<tr>
            <th class="p-3 bg-gray-100 sticky top-0">รหัสร้าน</th>
            <th class="p-3 bg-gray-100 sticky top-0">ชื่อร้าน</th>
            <th class="p-3 bg-emerald-50 text-emerald-700 sticky top-0">VPO (รวม)</th>
            <th class="p-3 bg-gray-100 sticky top-0">บิล</th>
            <th class="p-3 bg-gray-100 sticky top-0">SKU</th>
            <th class="p-3 bg-gray-100 sticky top-0">สินค้าโฟกัส</th>
        </tr>`;

        const headEl = document.getElementById('kpi-preview-head');
        if (headEl) headEl.innerHTML = th;

        let html = keys.slice(0, 300).map(id => {
            const k = kpiData[id];
            let fHtml = '';
            if (k.hasJelly) fHtml += `<span class="bg-pink-100 text-pink-700 px-2 rounded text-[10px] font-bold mr-1">${conf.f1}</span>`;
            if (k.hasKlom) fHtml += `<span class="bg-amber-100 text-amber-700 px-2 rounded text-[10px] font-bold">${conf.f2}</span>`;
            return `<tr>
                <td class="p-3 text-sm border-b">${k.id}</td>
                <td class="p-3 text-sm border-b font-bold">${k.name}</td>
                <td class="p-3 text-sm border-b font-black text-blue-600 bg-emerald-50/30">${k.vpo}</td>
                <td class="p-3 text-sm border-b">${k.billCount}</td>
                <td class="p-3 text-sm border-b">${k.skuCount}</td>
                <td class="p-3 text-sm border-b">${fHtml}</td>
            </tr>`;
        }).join('');

        if (keys.length > 300) {
            html += `<tr><td colspan="6" class="text-center p-3 text-xs text-gray-400">... แสดงตัวอย่าง 300 ร้านแรก ...</td></tr>`;
        }
        const bodyEl = document.getElementById('kpi-preview-body');
        if (bodyEl) bodyEl.innerHTML = html;
    },

    deployToSales: () => {
        if (!State.previewSales) return alert('กรุณากด "ทดสอบคำนวณ KPI" ให้เห็นตารางตัวอย่างก่อนส่งครับ');
        UI.showLoader('กำลังอัปโหลดส่งให้ Sales...', 'กำลังแบ่งกล่องข้อมูล...');

        cloudDB.collection('v1_sales_chunks').get().then(snap => {
            const delBatch = cloudDB.batch();
            snap.forEach(doc => delBatch.delete(doc.ref));
            return delBatch.commit();
        }).then(() => {
            const keys = Object.keys(State.previewSales);
            const chunkSize = 500;
            const promises = [];
            for (let i = 0; i < keys.length; i += chunkSize) {
                const chunkData = {};
                keys.slice(i, i + chunkSize).forEach(k => chunkData[k] = State.previewSales[k]);
                promises.push(
                    cloudDB.collection('v1_sales_chunks').doc('chunk_' + (i / chunkSize)).set(chunkData)
                );
            }
            return Promise.all(promises);
        }).then(() => {
            State.sales = State.previewSales;
            App.sync();
            UI.hideLoader();
            UI.showSaveToast('🚀 ส่งข้อมูลให้ Sales App สำเร็จ!');
        }).catch(err => {
            UI.hideLoader();
            alert('อัปโหลดไม่สำเร็จ: ' + err.message);
        });
    }
};

// ==========================================
// 📊 Excel Export
// ==========================================
const ExcelIO = {
    export: () => {
        if (!State.stores.length) return alert('ไม่มีข้อมูลให้โหลดครับ');
        const ed = [];

        State.stores.forEach(s => {
            const kpi = State.sales[s.id];
            const baseData = {
                'รหัส': s.id,
                'ชื่อ': s.name,
                'Lat': s.lat,
                'Lng': s.lng,
                'ความถี่': s.freq,
                'สถานะ': (kpi && kpi.active) ? 'Active' : 'Inactive',
                'VPO': kpi ? kpi.vpo : 0,
                'SKU': kpi ? kpi.skuCount : 0
            };
            if (!s.days || !s.days.length) {
                ed.push({ ...baseData, 'สายวิ่ง': 'ยังไม่จัด', 'คิว': '-', 'Map': `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}` });
            } else {
                s.days.forEach(d => {
                    ed.push({ ...baseData, 'สายวิ่ง': d, 'คิว': (s.seqs && s.seqs[d]) || '-', 'Map': `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}` });
                });
            }
        });

        ed.sort((a, b) => {
            const da = a['สายวิ่ง'] !== 'ยังไม่จัด' ? parseInt(a['สายวิ่ง'].replace('Day ', '')) : 999;
            const db = b['สายวิ่ง'] !== 'ยังไม่จัด' ? parseInt(b['สายวิ่ง'].replace('Day ', '')) : 999;
            if (da !== db) return da - db;
            const sa = a['คิว'] !== '-' ? parseInt(a['คิว']) : 999;
            const sb = b['คิว'] !== '-' ? parseInt(b['คิว']) : 999;
            return sa - sb;
        });

        const ws = XLSX.utils.json_to_sheet(ed);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'RoutePlan');
        XLSX.writeFile(wb, `Route_${State.localActiveRoute}.xlsx`);
    }
};

// ==========================================
// 🚀 App Controller
// ==========================================
const App = {
    dbRef: cloudDB.collection('appData').doc('v1_main'),

    init: () => {
        MapCtrl.init();
        UI.showLoader('กำลังเชื่อมต่อ...', '');

        App.dbRef.onSnapshot((doc) => {
            const d = doc.exists ? doc.data() : {};
            State.db = { ...State.db, ...d };
            State.db.routes = State.db.routes || { 'สายที่ 1': [] };
            State.db.cycleDays = State.db.cycleDays || 24;

            const sortedKeys = Object.keys(State.db.routes)
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));

            if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                State.localActiveRoute = localStorage.getItem('last_viewed_route') || sortedKeys[0];
            }
            State.stores = State.db.routes[State.localActiveRoute] || [];

            App.fetchRawData();
            App.fetchSalesData();
        }, (err) => {
            console.error('Firestore error:', err);
            UI.hideLoader();
            alert('⚠️ ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาตรวจสอบอินเทอร์เน็ตครับ');
        });

        const rawUpload = document.getElementById('rawUpload');
        if (rawUpload) {
            rawUpload.addEventListener('change', (e) => {
                const f = e.target.files[0];
                if (f) RawDataMgr.processExcel(f);
            });
        }

        const fileUpload = document.getElementById('fileUpload');
        if (fileUpload) {
            fileUpload.addEventListener('change', App.handleMapUpload);
        }
    },

    fetchRawData: () => {
        cloudDB.collection('v1_raw_chunks').get().then(snap => {
            let raw = [];
            snap.forEach(doc => { raw = raw.concat(doc.data().rows || []); });
            State.rawData = raw;
            RawDataMgr.renderTable();
        }).catch(err => console.warn('โหลด rawData ไม่สำเร็จ:', err));
    },

    fetchSalesData: () => {
        cloudDB.collection('v1_sales_chunks').get().then(snap => {
            const merged = {};
            snap.forEach(doc => { Object.assign(merged, doc.data()); });
            State.sales = merged;
            App.sync();
            UI.hideLoader();
        }).catch(err => {
            console.warn('โหลด salesData ไม่สำเร็จ:', err);
            App.sync();
            UI.hideLoader();
        });
    },

    // แก้บัค: เพิ่ม error handling และ toast แจ้งผล
    saveDB: () => {
        State.db.routes[State.localActiveRoute] = State.stores;
        App.dbRef.update({ routes: State.db.routes })
            .then(() => {
                UI.showSaveToast('💾 บันทึกเรียบร้อย');
            })
            .catch(err => {
                console.error('saveDB error:', err);
                UI.showErrorToast('❌ บันทึกไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต');
            });
    },

    // แก้บัค: reset tab กลับ tab1 ทุกครั้งที่ sync
    sync: () => {
        const rs = document.getElementById('routeSelector');
        if (rs) {
            const sortedRoutes = Object.keys(State.db.routes)
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            const newHTML = sortedRoutes.map(r => `<option value="${r}">${r}</option>`).join('');
            if (rs.innerHTML !== newHTML) rs.innerHTML = newHTML;
            rs.value = State.localActiveRoute;
        }
        MapCtrl.clearAll();
        UI.initDaySelector();
        UI.switchTab('tab1');  // แก้บัค: reset tab กลับต้นเสมอ
        UI.render();
    },

    switchRoute: (name) => {
        if (State.localActiveRoute === name) return;
        State.localActiveRoute = name;
        localStorage.setItem('last_viewed_route', name);
        State.stores = State.db.routes[name] || [];
        App.sync();
        MapCtrl.fitToStores();
    },

    addRoute: () => {
        const n = prompt('ชื่อสายใหม่:');
        if (n && n.trim()) {
            State.db.routes[n.trim()] = [];
            State.localActiveRoute = n.trim();
            State.stores = [];
            App.sync();
            App.saveDB();
        }
    },

    renameRoute: () => {
        const n = prompt('ชื่อใหม่:', State.localActiveRoute);
        if (n && n.trim()) {
            State.db.routes[n.trim()] = State.db.routes[State.localActiveRoute];
            delete State.db.routes[State.localActiveRoute];
            State.localActiveRoute = n.trim();
            App.sync();
            App.saveDB();
        }
    },

    deleteRoute: () => {
        if (Object.keys(State.db.routes).length <= 1) {
            return alert('ห้ามลบสายสุดท้ายครับ');
        }
        if (!confirm('ยืนยันลบสายนี้?')) return;
        delete State.db.routes[State.localActiveRoute];
        const sortedKeys = Object.keys(State.db.routes)
            .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
        State.localActiveRoute = sortedKeys[0];
        State.stores = State.db.routes[State.localActiveRoute];
        App.sync();
        App.saveDB();
        MapCtrl.fitToStores();
    },

    clearStores: () => {
        if (!confirm('ล้างข้อมูลร้านค้าทั้งหมดในสายนี้?')) return;
        State.stores = [];
        MapCtrl.clearAll();
        App.sync();
        App.saveDB();
    },

    handleMapUpload: function (e) {
        const file = e.target.files[0];
        if (!file) return;

        if (State.stores.length > 0 && !confirm(`ข้อมูลเดิมของ "${State.localActiveRoute}" จะถูกแทนที่\nยืนยันการอัปโหลด?`)) {
            this.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(
                    workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' }
                );
                if (json.length < 2) return alert('ไฟล์ว่างเปล่า');

                const headers = json[0];
                let idCol = -1, nameCol = -1, latCol = -1, lngCol = -1, freqCol = -1, dayCol = -1, seqCol = -1;

                for (let i = 0; i < headers.length; i++) {
                    const h = String(headers[i]).toLowerCase();
                    if (h.includes('รหัส') || h.includes('customer code') || h.includes('id')) idCol = i;
                    else if (h.includes('ชื่อ') || h.includes('name')) nameCol = i;
                    else if (h.includes('lat') || h.includes('ละติจูด')) latCol = i;
                    else if (h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด')) lngCol = i;
                    else if (h.includes('freq') || h.includes('ความถี่') || h.includes('รอบ') || h.includes('f2')) freqCol = i;
                    else if (h.includes('สายวิ่ง') || h.includes('day')) dayCol = i;
                    else if (h.includes('คิว') || h.includes('seq')) seqCol = i;
                }

                const storeMap = {};
                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length === 0) continue;
                    const idStr = row[idCol] ? String(row[idCol]).trim() : `S_${i}`;
                    if (!idStr) continue;
                    const lat = parseFloat(String(row[latCol] || '').replace(/[^0-9.-]/g, ''));
                    const lng = parseFloat(String(row[lngCol] || '').replace(/[^0-9.-]/g, ''));
                    if (isNaN(lat) || isNaN(lng)) continue;

                    const freq = (freqCol !== -1 && String(row[freqCol] || '').trim().toUpperCase().includes('2')) ? 2 : 1;
                    const assignedDay = (dayCol !== -1 && row[dayCol]) ? String(row[dayCol]).trim() : '';
                    const assignedSeq = (seqCol !== -1 && row[seqCol]) ? parseInt(String(row[seqCol]).replace(/[^0-9]/g, '')) : NaN;
                    const isValidDay = assignedDay.toLowerCase().includes('day');

                    if (storeMap[idStr]) {
                        if (isValidDay && !storeMap[idStr].days.includes(assignedDay)) {
                            storeMap[idStr].days.push(assignedDay);
                            if (!isNaN(assignedSeq)) storeMap[idStr].seqs[assignedDay] = assignedSeq;
                        }
                        storeMap[idStr].freq = 2;
                    } else {
                        const newStore = {
                            id: idStr,
                            name: row[nameCol] ? String(row[nameCol]).trim() : `Store_${idStr}`,
                            lat, lng, freq, days: [], seqs: {}, selected: false
                        };
                        if (isValidDay) {
                            newStore.days.push(assignedDay);
                            if (!isNaN(assignedSeq)) newStore.seqs[assignedDay] = assignedSeq;
                        }
                        storeMap[idStr] = newStore;
                    }
                }

                const finalArray = Object.values(storeMap);
                if (finalArray.length === 0) return alert('ไม่พบพิกัด (Lat, Lng) ในไฟล์ครับ');

                // แก้บัค: clearAll markers เก่าก่อน load ใหม่
                MapCtrl.clearAll();
                State.stores = finalArray;
                App.sync();
                App.saveDB();
                MapCtrl.fitToStores();
                UI.showSaveToast(`✅ โหลด ${finalArray.length} ร้านสำเร็จ`);

            } catch (err) {
                alert('ขัดข้อง: ' + err.message);
            }
            const inp = document.getElementById('fileUpload');
            if (inp) inp.value = '';
        };
        reader.readAsArrayBuffer(file);
    },
    
    // เคลียร์การจัดสายทั้งหมด
    clearAllAssignments: () => {
        try {
            if (!confirm('🗑️ ยืนยันการเคลียร์การจัดสายทั้งหมด?\n(ร้านทั้งหมดจะกลับไปอยู่ในสถานะ "รอจัดสาย")')) {
                return;
            }
            
            if (!State.stores || State.stores.length === 0) {
                alert('⚠️ ไม่มีข้อมูลร้านค้า');
                return;
            }
            
            State.stores.forEach(s => {
                s.days = [];
                s.seqs = {};
                s.selected = false;
            });
            
            if (MapCtrl && MapCtrl.clearRoad) MapCtrl.clearRoad(true);
            if (MapCtrl && MapCtrl.clearAll) MapCtrl.clearAll();
            if (UI && UI.render) UI.render();
            if (App && App.saveDB) App.saveDB();
            
            if (UI && UI.showSaveToast) {
                UI.showSaveToast('✅ เคลียร์การจัดสายเสร็จ');
            } else {
                alert('✅ เคลียร์การจัดสายเสร็จ');
            }
        } catch(err) {
            console.error('❌ Clear error:', err);
            alert('❌ เกิดข้อผิดพลาด: ' + err.message);
        }
    }
};

// ==========================================
// 🎯 Main App Controller
// ==========================================
const App = {
    init: async () => {
        console.log('✅ App initializing...');
        Auth.init();
        MapCtrl.init();
        UI.initDaySelector();
        if (typeof Dashboard !== 'undefined') Dashboard.init();
    },

    loadRoutes: async () => {
        try {
            const snap = await cloudDB.collection('appData/v1_main/routes').get();
            State.db.routes = {};
            snap.forEach(doc => {
                const data = doc.data();
                if (data && data.stores && Array.isArray(data.stores)) {
                    State.db.routes[doc.id] = data.stores;
                }
            });
            
            const selector = document.getElementById('routeSelector');
            if (selector) {
                selector.innerHTML = Object.keys(State.db.routes)
                    .map(r => `<option value="${r}">${r}</option>`)
                    .join('');
            }
            
            if (Object.keys(State.db.routes).length > 0) {
                App.switchRoute(Object.keys(State.db.routes)[0]);
            }
        } catch(err) {
            console.warn('⚠️ Load routes error (offline?):', err);
            // Work offline - State.db.routes stays in memory
        }
    },

    switchRoute: (routeName) => {
        State.localActiveRoute = routeName;
        State.stores = State.db.routes[routeName] || [];
        UI.render();
        if (MapCtrl && MapCtrl.map) {
            setTimeout(() => MapCtrl.fitToStores(), 200);
        }
    },

    saveDB: async () => {
        try {
            if (!State.localActiveRoute) return;
            
            const stores = State.stores.filter(s => s && s.id);
            if (stores.length === 0) return;
            
            State.db.routes[State.localActiveRoute] = stores;
            
            await cloudDB.doc(`appData/v1_main/routes/${State.localActiveRoute}`).set(
                { routeName: State.localActiveRoute, storeCount: stores.length, stores, updatedAt: new Date() },
                { merge: true }
            );
            
            console.log('✅ Saved:', State.localActiveRoute);
        } catch(err) {
            console.warn('⚠️ Save error (offline - data in memory):', err);
            // Data saved in State even if Firestore fails
        }
    },

    addRoute: () => {
        const name = prompt('ชื่อสาย (เช่น Route_402):');
        if (!name) return;
        if (State.db.routes[name]) {
            alert('⚠️ สายนี้มีอยู่แล้ว');
            return;
        }
        State.db.routes[name] = [];
        App.saveDB();
        const selector = document.getElementById('routeSelector');
        if (selector) {
            selector.innerHTML = Object.keys(State.db.routes)
                .map(r => `<option value="${r}" ${r === name ? 'selected' : ''}>${r}</option>`)
                .join('');
        }
    },

    deleteRoute: () => {
        if (!State.localActiveRoute) {
            alert('⚠️ กรุณาเลือกสายวิ่ง');
            return;
        }
        if (!confirm(`ลบ ${State.localActiveRoute}?`)) return;
        
        delete State.db.routes[State.localActiveRoute];
        const keys = Object.keys(State.db.routes);
        State.localActiveRoute = keys[0] || null;
        State.stores = keys[0] ? State.db.routes[keys[0]] : [];
        
        const selector = document.getElementById('routeSelector');
        if (selector) {
            selector.innerHTML = keys.map(r => `<option value="${r}">${r}</option>`).join('');
            if (keys[0]) selector.value = keys[0];
        }
        
        UI.render();
        App.saveDB();
    },

    renameRoute: () => {
        if (!State.localActiveRoute) return;
        const newName = prompt(`ชื่อใหม่ (เดิม: ${State.localActiveRoute}):`);
        if (!newName || newName === State.localActiveRoute) return;
        
        State.db.routes[newName] = State.db.routes[State.localActiveRoute];
        delete State.db.routes[State.localActiveRoute];
        State.localActiveRoute = newName;
        
        const selector = document.getElementById('routeSelector');
        if (selector) {
            selector.innerHTML = Object.keys(State.db.routes)
                .map(r => `<option value="${r}" ${r === newName ? 'selected' : ''}>${r}</option>`)
                .join('');
        }
        App.saveDB();
    },

    clearStores: () => {
        if (!confirm('ล้างร้านค้าทั้งหมดในสายนี้?')) return;
        State.stores = [];
        State.db.routes[State.localActiveRoute] = [];
        UI.render();
        MapCtrl.clearAll();
        App.saveDB();
    },

    sync: () => {
        UI.render();
    }
};

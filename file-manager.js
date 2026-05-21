// ==========================================
// 📂 Upload & Parse Route Plan File
// v2 — 2026-05-21 | fixes: BUG-02 rawData, BUG-09 cy field, indentation
// ==========================================
const FileManager = {

    // ─── uploadRouteFile: Single-route upload ────────────────────────────
    uploadRouteFile: async (file) => {
        try {
            if (!file) return;
            if (file.size > 15 * 1024 * 1024)
                return UI.showErrorToast('⚠️ ไฟล์ใหญ่เกิน 15MB กรุณาแยกไฟล์ก่อนอัปโหลด');

            UI.showLoader('📂 กำลังอ่านไฟล์...', file.name);

            const arrayBuffer = await file.arrayBuffer();
            const workbook    = XLSX.read(arrayBuffer, { header: 'A' });
            const worksheet   = workbook.Sheets[workbook.SheetNames[0]];
            const rows        = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });

            // Parse Excel columns: A-L
            // A=CY, B=Code, C=Name, D=SalesCode, E=Type, F=SubDistrict,
            // G=District, H=Province, I=Lat, J=Lng, K=Market, L=DayHistory
            const stores = [];

            rows.forEach((row, idx) => {
                if (!row.B || idx === 0) return; // skip header + empty
                const lat = parseFloat(row.I);
                const lng = parseFloat(row.J);
                if (isNaN(lat) || isNaN(lng)) {
                    console.warn(`Row ${idx}: Missing lat/lng for ${row.C}`);
                    return;
                }
                stores.push({
                    id:          row.B,
                    code:        row.B || '',
                    name:        row.C || '',
                    salesCode:   row.D || '',
                    shopType:    row.E || '',
                    subDistrict: row.F || '',
                    district:    row.G || '',
                    province:    row.H || '',
                    lat,
                    lng,
                    marketName:  row.K || '',
                    dayOriginal: row.L || '',
                    // ✅ FIX BUG-09: เพิ่ม cy field จาก column A
                    cy:          row.A || '',
                    days:        [],
                    seqs:        {},
                    freq:        1,
                    selected:    false,
                });
            });

            if (stores.length === 0) {
                UI.hideLoader();
                return UI.showErrorToast('⚠️ ไม่พบข้อมูลร้านค้า');
            }

            // ✅ FIX BUG-02: save rawData เพื่อให้ ExcelIO.export() ใช้ได้
            // แปลง header: 'A' format → header name format
            const rawWithHeaders = rows.slice(1).map(row => ({
                'CY':           row.A || '',
                'รหัส':         row.B || '',
                'ชื่อ':         row.C || '',
                'Sales':        row.D || '',
                'ประเภทร้านค้า1': row.E || '',
                'Sold To City': row.F || '',
                'Sold To State': row.G || '',
                'Address 5':    row.H || '',
                'Latitude':     row.I || '',
                'Longtitude':   row.J || '',
                'ชื่อตลาด':    row.K || '',
                'Day':          row.L || '',
            }));
            State.rawData = rawWithHeaders;

            // Create route name from sales code
            const routeName = stores[0].salesCode?.trim() || `Route_NEW`;

            // Store to State
            State.db.routes[routeName] = stores;
            State.localActiveRoute     = routeName;
            State.stores               = stores;

            // Update route selector
            const selector = document.getElementById('routeSelector');
            if (selector) {
                selector.innerHTML = Object.keys(State.db.routes)
                    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }))
                    .map(r => `<option value="${r}" ${r === routeName ? 'selected' : ''}>${r}</option>`)
                    .join('');
            }

            UI.hideLoader();
            UI.showSaveToast(`✅ อัพโหลด: ${stores.length} ร้าน → สาย ${routeName}`);

            UI.render();
            if (MapCtrl?.map) setTimeout(() => MapCtrl.fitToStores(), 300);

            App.saveDB();
            if (typeof Nav !== 'undefined') Nav.go('planning');

        } catch (err) {
            UI.hideLoader();
            console.error('❌ Upload error:', err);
            UI.showErrorToast('❌ อ่านไฟล์ไม่สำเร็จ: ' + err.message);
        }
    },

    // ─── exportTemplate: Export สายปัจจุบัน ─────────────────────────────
    exportTemplate: async () => {
        try {
            if (!State.localActiveRoute)
                return UI.showErrorToast('⚠️ กรุณาเลือกสายวิ่งก่อนครับ');
            if (State.stores.length === 0)
                return UI.showErrorToast('⚠️ ไม่มีข้อมูลร้านค้าในสายนี้');

            UI.showLoader('💾 กำลังสร้างไฟล์ Excel...', 'กำลังเตรียมข้อมูล');

            const exportData = State.stores.map(store => ({
                'A': store.cy || '',
                'B': store.code || store.id,
                'C': store.name,
                'D': store.salesCode || '',
                'E': store.shopType || '',
                'F': store.subDistrict || '',
                'G': store.district || '',
                'H': store.province || '',
                'I': store.lat,
                'J': store.lng,
                'K': store.marketName || '',
                'L': store.days?.length > 0 ? store.days[0] : (store.dayOriginal || ''),
                'M': (store.seqs && store.days?.length > 0) ? (store.seqs[store.days[0]] || '') : '',
            }));

            const ws = XLSX.utils.json_to_sheet(exportData, {
                header: ['A','B','C','D','E','F','G','H','I','J','K','L','M'],
            });

            ws['A1'] = { v: 'CY', t: 's' };
            ws['B1'] = { v: 'รหัส', t: 's' };
            ws['C1'] = { v: 'ชื่อ', t: 's' };
            ws['D1'] = { v: 'Sales', t: 's' };
            ws['E1'] = { v: 'ประเภทร้านค้า1', t: 's' };
            ws['F1'] = { v: 'Sold To City', t: 's' };
            ws['G1'] = { v: 'Sold To State', t: 's' };
            ws['H1'] = { v: 'Address 5', t: 's' };
            ws['I1'] = { v: 'Latitude', t: 's' };
            ws['J1'] = { v: 'Longtitude', t: 's' };
            ws['K1'] = { v: 'ชื่อตลาด', t: 's' };
            ws['L1'] = { v: 'Day', t: 's' };
            ws['M1'] = { v: 'ลำดับ', t: 's' };

            ws['!cols'] = [
                { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 10 },
                { wch: 8  }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 6  }, { wch: 6 },
            ];

            const wb  = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Route Plan');

            const now      = new Date();
            const dateStr  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            const filename = `Route_Plan_${State.localActiveRoute}_${dateStr}.xlsx`;

            XLSX.writeFile(wb, filename);
            UI.hideLoader();
            UI.showSaveToast(`✅ Export: ${filename}`);

        } catch (err) {
            UI.hideLoader();
            console.error('❌ Export error:', err);
            UI.showErrorToast('❌ Export ไม่สำเร็จ: ' + err.message);
        }
    },

    // ─── exportAllRoutes: Export ทุกสาย ─────────────────────────────────
    exportAllRoutes: async () => {
        try {
            const routes    = State.db.routes;
            const routeKeys = Object.keys(routes);

            if (routeKeys.length === 0)
                return UI.showErrorToast('⚠️ ไม่มีข้อมูลสายวิ่งในระบบ กรุณาอัพโหลดไฟล์ก่อน');

            UI.showLoader('💾 กำลังรวมข้อมูลทุกสาย...', `รวม ${routeKeys.length} สาย`);

            const wb       = XLSX.utils.book_new();
            const allStores = [];

            routeKeys.forEach(routeName => {
                (routes[routeName] || []).forEach(store => {
                    allStores.push({
                        'A': routeName,
                        'B': store.code || store.id,
                        'C': store.name,
                        'D': store.salesCode || '',
                        'E': store.shopType || '',
                        'F': store.subDistrict || '',
                        'G': store.district || '',
                        'H': store.province || '',
                        'I': store.lat,
                        'J': store.lng,
                        'K': store.marketName || '',
                        'L': store.days?.length > 0 ? store.days[0] : (store.dayOriginal || ''),
                        'M': (store.seqs && store.days?.length > 0) ? (store.seqs[store.days[0]] || '') : '',
                    });
                });
            });

            const wsAll = XLSX.utils.json_to_sheet(allStores, {
                header: ['A','B','C','D','E','F','G','H','I','J','K','L','M'],
            });
            wsAll['A1'] = { v: 'สายวิ่ง', t: 's' };
            wsAll['B1'] = { v: 'รหัส', t: 's' };
            wsAll['C1'] = { v: 'ชื่อ', t: 's' };
            wsAll['D1'] = { v: 'Sales', t: 's' };
            wsAll['E1'] = { v: 'ประเภทร้านค้า1', t: 's' };
            wsAll['F1'] = { v: 'Sold To City', t: 's' };
            wsAll['G1'] = { v: 'Sold To State', t: 's' };
            wsAll['H1'] = { v: 'Address 5', t: 's' };
            wsAll['I1'] = { v: 'Latitude', t: 's' };
            wsAll['J1'] = { v: 'Longtitude', t: 's' };
            wsAll['K1'] = { v: 'ชื่อตลาด', t: 's' };
            wsAll['L1'] = { v: 'Day', t: 's' };
            wsAll['M1'] = { v: 'ลำดับ', t: 's' };
            wsAll['!cols'] = [
                { wch: 18 }, { wch: 12 }, { wch: 40 }, { wch: 10 },
                { wch: 8  }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 6  },
            ];
            XLSX.utils.book_append_sheet(wb, wsAll, 'ทุกสาย');

            // Sheet ต่อสาย
            routeKeys.forEach(routeName => {
                const stores = routes[routeName] || [];
                if (!stores.length) return;

                const exportData = stores.map(store => ({
                    'A': store.cy || '',
                    'B': store.code || store.id,
                    'C': store.name,
                    'D': store.salesCode || '',
                    'E': store.shopType || '',
                    'F': store.subDistrict || '',
                    'G': store.district || '',
                    'H': store.province || '',
                    'I': store.lat,
                    'J': store.lng,
                    'K': store.marketName || '',
                    'L': store.days?.length > 0 ? store.days[0] : (store.dayOriginal || ''),
                    'M': (store.seqs && store.days?.length > 0) ? (store.seqs[store.days[0]] || '') : '',
                }));

                const ws = XLSX.utils.json_to_sheet(exportData, {
                    header: ['A','B','C','D','E','F','G','H','I','J','K','L','M'],
                });
                ws['A1'] = { v: 'CY', t: 's' };
                ws['B1'] = { v: 'รหัส', t: 's' };
                ws['C1'] = { v: 'ชื่อ', t: 's' };
                ws['D1'] = { v: 'Sales', t: 's' };
                ws['E1'] = { v: 'ประเภทร้านค้า1', t: 's' };
                ws['F1'] = { v: 'Sold To City', t: 's' };
                ws['G1'] = { v: 'Sold To State', t: 's' };
                ws['H1'] = { v: 'Address 5', t: 's' };
                ws['I1'] = { v: 'Latitude', t: 's' };
                ws['J1'] = { v: 'Longtitude', t: 's' };
                ws['K1'] = { v: 'ชื่อตลาด', t: 's' };
                ws['L1'] = { v: 'Day', t: 's' };
                ws['M1'] = { v: 'ลำดับ', t: 's' };
                ws['!cols'] = [
                    { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 10 },
                    { wch: 8  }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                    { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 6  }, { wch: 6 },
                ];
                XLSX.utils.book_append_sheet(wb, ws, routeName.substring(0, 31));
            });

            const now      = new Date();
            const dateStr  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            const filename = `Route_Plan_ALL_${routeKeys.length}สาย_${dateStr}.xlsx`;
            XLSX.writeFile(wb, filename);

            UI.hideLoader();
            UI.showSaveToast(`✅ Export ทุกสาย: ${allStores.length} ร้าน จาก ${routeKeys.length} สาย`);

        } catch (err) {
            UI.hideLoader();
            console.error('❌ Export All error:', err);
            UI.showErrorToast('❌ Export ไม่สำเร็จ: ' + err.message);
        }
    },

    // ─── bulkImport: อัปโหลดทุกสายพร้อมกัน ─────────────────────────────
    bulkImport: (event) => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 20 * 1024 * 1024)
            return UI.showErrorToast('⚠️ ไฟล์ใหญ่เกิน 20MB');

        UI.showLoader('📦 กำลังอ่านไฟล์...', 'รอสักครู่');

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data     = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const json     = XLSX.utils.sheet_to_json(
                    workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' }
                );
                if (json.length < 2) return UI.showErrorToast('⚠️ ไฟล์ว่างเปล่า');

                const headers = json[0];
                let idCol=-1, nameCol=-1, latCol=-1, lngCol=-1, freqCol=-1,
                    dayCol=-1, seqCol=-1, salesCodeCol=-1, shopTypeCol=-1,
                    subDistrictCol=-1, districtCol=-1, provinceCol=-1,
                    marketNameCol=-1, cyCol=-1;

                for (let i = 0; i < headers.length; i++) {
                    const h = String(headers[i]).toLowerCase();
                    if      (h.includes('รหัส') || h.includes('customer code') || h.includes('id'))  idCol = i;
                    else if ((h.includes('ชื่อ') && !h.includes('ตลาด')) || h.includes('name'))      nameCol = i;
                    else if (h.includes('lat') || h.includes('ละติจูด'))                             latCol = i;
                    else if (h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด'))       lngCol = i;
                    else if (h.includes('freq') || h.includes('ความถี่') || h.includes('f2'))        freqCol = i;
                    else if (h.includes('สายวิ่ง') || h.includes('day'))                             dayCol = i;
                    else if (h.includes('คิว') || h.includes('seq') || h.includes('ลำดับ') || h.includes('order')) seqCol = i;
                    else if (h === 'route' || h === 'สายวิ่ง')                                           salesCodeCol = i;
                    else if ((h.includes('salescode') || h.includes('รหัสเซลล์') || h === 'sales') && salesCodeCol === -1) salesCodeCol = i;
                    else if (h.includes('sales'))                                                     salesCodeCol = i;
                    else if (h.includes('ประเภท') || h.includes('type') || h.includes('shoptype'))  shopTypeCol = i;
                    else if (h.includes('sold to city') || h.includes('subdistrict') || h.includes('ตำบล'))     subDistrictCol = i;
                    else if (h.includes('sold to state') || h.includes('district') || h.includes('อำเภอ'))      districtCol = i;
                    else if (h.includes('address 5') || h.includes('province') || h.includes('จังหวัด'))        provinceCol = i;
                    else if (h.includes('ตลาด') || h.includes('market'))                             marketNameCol = i;
                    else if (h === 'cy' || h.includes('cy'))                                         cyCol = i;
                }

                if (salesCodeCol === -1) {
                    UI.hideLoader();
                    return UI.showErrorToast('⚠️ ไม่พบ column "Sales Code" ในไฟล์ กรุณาตรวจสอบ header');
                }

                // ─── Parse + จัดกลุ่มตาม salesCode ──────────────────────
                const byRoute = {};

                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length === 0) continue;

                    const lat = parseFloat(String(row[latCol] || '').replace(/[^0-9.-]/g, ''));
                    const lng = parseFloat(String(row[lngCol] || '').replace(/[^0-9.-]/g, ''));
                    if (isNaN(lat) || isNaN(lng)) continue;

                    const idStr  = row[idCol]       ? String(row[idCol]).trim()       : '';
                    const scRaw  = salesCodeCol !== -1 ? String(row[salesCodeCol] || '').trim() : '';
                    if (!idStr || !scRaw) continue;

                    const routeKey = scRaw;
                    if (!byRoute[routeKey]) byRoute[routeKey] = {};

                    const freq   = (freqCol !== -1 && String(row[freqCol]||'').toUpperCase().includes('2')) ? 2 : 1;
                    const rawDay = (dayCol !== -1 && row[dayCol]) ? String(row[dayCol]).trim() : '';
                    const dayNum = rawDay ? parseInt(rawDay.replace(/[^0-9]/g, '')) : NaN;
                    const aDay   = !isNaN(dayNum) ? 'Day ' + dayNum : '';
                    const aSeq   = (seqCol !== -1 && row[seqCol]) ? parseInt(String(row[seqCol]).replace(/[^0-9]/g,'')) : NaN;

                    if (byRoute[routeKey][idStr]) {
                        if (aDay && !byRoute[routeKey][idStr].days.includes(aDay)) {
                            byRoute[routeKey][idStr].days.push(aDay);
                            if (!isNaN(aSeq)) byRoute[routeKey][idStr].seqs[aDay] = aSeq;
                        }
                        byRoute[routeKey][idStr].freq = 2;
                    } else {
                        const store = {
                            id:          idStr,
                            code:        idStr,
                            name:        row[nameCol] ? String(row[nameCol]).trim() : ('Store_' + idStr),
                            lat, lng, freq, days: [], seqs: {}, selected: false,
                            salesCode:   scRaw,
                            shopType:    shopTypeCol !== -1   ? String(row[shopTypeCol]||'').trim()   : '',
                            subDistrict: subDistrictCol !== -1 ? String(row[subDistrictCol]||'').trim() : '',
                            district:    districtCol !== -1   ? String(row[districtCol]||'').trim()   : '',
                            province:    provinceCol !== -1   ? String(row[provinceCol]||'').trim()   : '',
                            marketName:  marketNameCol !== -1  ? String(row[marketNameCol]||'').trim()  : '',
                            cy:          cyCol !== -1          ? String(row[cyCol]||'').trim()          : '',
                            dayOriginal: rawDay,
                        };
                        if (aDay) { store.days.push(aDay); if (!isNaN(aSeq)) store.seqs[aDay] = aSeq; }
                        byRoute[routeKey][idStr] = store;
                    }
                }

                const routeKeys = Object.keys(byRoute);
                if (routeKeys.length === 0) {
                    UI.hideLoader();
                    return UI.showErrorToast('⚠️ ไม่พบข้อมูลในไฟล์');
                }

                // ─── Merge เข้า State.db.routes ──────────────────────────
                let totalNew = 0;
                const savedRoutes = [];

                for (const routeKey of routeKeys) {
                    const incoming    = Object.values(byRoute[routeKey]);
                    const existing    = State.db.routes[routeKey] || [];
                    const existingIds = new Set(existing.map(s => s.id));
                    const incomingMap = {};
                    incoming.forEach(s => { incomingMap[s.id] = s; });

                    // อัปเดตร้านเดิมที่มี ID ตรงกัน
                    const updatedExisting = existing.map(s => {
                        if (!incomingMap[s.id]) return s;
                        const inc = incomingMap[s.id];
                        return {
                            ...s,
                            days:        inc.days       || s.days,
                            marketName:  inc.marketName || s.marketName,
                            lat:         inc.lat        || s.lat,
                            lng:         inc.lng        || s.lng,
                            cy:          inc.cy         || s.cy || '',
                        };
                    });

                    const newStores = incoming.filter(s => !existingIds.has(s.id));
                    State.db.routes[routeKey] = [...updatedExisting, ...newStores];
                    totalNew += newStores.length;
                    savedRoutes.push(routeKey);
                }

                // ─── บันทึกลง Firebase ───────────────────────────────────
                const routeList = Object.keys(State.db.routes)
                    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));

                for (let _si = 0; _si < savedRoutes.length; _si++) {
                    const _n = savedRoutes[_si];
                    UI.showLoader(
                        `💾 กำลังบันทึก... (${_si+1}/${savedRoutes.length} สาย)`,
                        `สาย ${_n} — ${(State.db.routes[_n]||[]).length} ร้าน`
                    );
                    // ✅ ระบบใหม่: บันทึกไปที่ plans/{ym}/routes/{name}
                    await App.planRoutesCol(App._currentPlanYM).doc(_n).set({ stores: State.db.routes[_n] || [] });
                }

                // อัปเดต plan metadata
                const ym = App._currentPlanYM;
                await App.planRef(ym).set(
                    { routeList, cycleDays: State.db.cycleDays || 24, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
                    { merge: true }
                );

                if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                    State.localActiveRoute = routeList[0];
                }
                State.stores = State.db.routes[State.localActiveRoute] || [];

                UI.hideLoader();
                App.sync();
                MapCtrl.fitToStores();
                UI.showSaveToast(`✅ Bulk Import เสร็จ! ${routeKeys.length} สาย | เพิ่มใหม่ ${totalNew} ร้าน`);

            } catch (err) {
                UI.hideLoader();
                console.error('bulkImport error:', err);
                UI.showErrorToast('❌ Import ไม่สำเร็จ: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    },
};

// ─── File Input Listeners ─────────────────────────────────────────────────
// #fileUpload listener ถูก register ใน App.init() แล้ว (ป้องกัน BUG-06)
// #bulkUpload ใช้ onchange attribute ใน HTML โดยตรง
document.addEventListener('DOMContentLoaded', () => {});
console.log('✅ FileManager v2 loaded');

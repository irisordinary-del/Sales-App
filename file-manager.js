// ==========================================
// 📂 Upload & Parse Route Plan File
// ==========================================
const FileManager = {
            // Parse uploaded Excel file
            uploadRouteFile: async (file) => {
                            try {
                                                if (!file) return;
                                if (file.size > 15 * 1024 * 1024) return UI.showErrorToast('⚠️ ไฟล์ใหญ่เกิน 15MB กรุณาแยกไฟล์ก่อนอัปโหลด');

                                UI.showLoader('📂 กำลังอ่านไฟล์...', file.name);

                                const arrayBuffer = await file.arrayBuffer();
                                                const workbook = XLSX.read(arrayBuffer, { header: 'A' });
                                                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                                                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });

                                // Parse Excel columns: A-L
                                // A=CY(skip), B=Code, C=Name, D=SalesCode, E=Type, F=SubDistrict, G=District, H=Province, I=Lat, J=Lng, K=Market, L=DayHistory
                                const stores = [];

                                rows.forEach((row, idx) => {
                                                        // Skip header row and empty rows
                                                             if (!row.B || idx === 0) return;

                                                             const lat = parseFloat(row.I);
                                                        const lng = parseFloat(row.J);

                                                             // Validate lat/lng
                                                             if (isNaN(lat) || isNaN(lng)) {
                                                                                         console.warn(`Row ${idx}: Missing lat/lng for ${row.C}`);
                                                                                         return;
                                                             }

                                                             stores.push({
                                                                                         id: row.B,
                                                                                         code: row.B || '',
                                                                                         name: row.C || '',
                                                                                         cy: row.A || '',           // BUG-09 fix: เก็บ CY field
                                                                                         salesCode: row.D || '',
                                                                                         shopType: row.E || '',
                                                                                         subDistrict: row.F || '',
                                                                                         district: row.G || '',
                                                                                         province: row.H || '',
                                                                                         lat: lat,
                                                                                         lng: lng,
                                                                                         marketName: row.K || '',
                                                                                         dayOriginal: row.L || '',
                                                                                         days: [],
                                                                                         seqs: {},
                                                                                         freq: 1,
                                                                                         selected: false
                                                             });
                                });

                                // BUG-02 fix: save raw rows ไว้ให้ ExportCtrl._writeExcel lookup
                                State.rawData = rows;

                                if (stores.length === 0) {
                                                        UI.hideLoader();
                                                        UI.showErrorToast('⚠️ ไม่พบข้อมูลร้านค้า');
                                                        return;
                                }

                                // Create route name from sales code
                                const routeName = `Route_${stores[0].salesCode?.substring(0, 3) || 'NEW'}`;

                                // Store to State
                                State.db.routes[routeName] = stores;
                                                State.localActiveRoute = routeName;
                                                State.stores = stores;

                                // Update UI
                                const selector = document.getElementById('routeSelector');
                                                if (selector) {
                                                                        selector.innerHTML = Object.keys(State.db.routes)
                                                                            .map(r => `<option value="${r}" ${r === routeName ? 'selected' : ''}>${r}</option>`)
                                                                            .join('');
                                                }

                                UI.hideLoader();
                                                UI.showSaveToast(`✅ อัพโหลด: ${stores.length} แถว`);

                                // Render map
                                UI.render();
                                                if (MapCtrl && MapCtrl.map) {
                                                                        setTimeout(() => MapCtrl.fitToStores(), 300);
                                                }

                                // Switch to planning tab
                                App.saveDB(); // Save full store data to Firestore
                                Nav.go('planning');

                            } catch(err) {
                                                UI.hideLoader();
                                                console.error('❌ Upload error:', err);
                                                UI.showErrorToast('❌ อ่านไฟล์ไม่สำเร็จ: ' + err.message);
                            }
            },

            // Export route data back to template format (same as uploaded file: A-L, 12 columns)
            exportTemplate: async () => {
                            try {
                                                if (!State.localActiveRoute) {
                                                                        UI.showErrorToast('⚠️ กรุณาเลือกสายวิ่งก่อนครับ');
                                                                        return;
                                                }

                                if (State.stores.length === 0) {
                                                        UI.showErrorToast('⚠️ ไม่มีข้อมูลร้านค้าในสายนี้');
                                                        return;
                                }

                                UI.showLoader('💾 กำลังสร้างไฟล์ Excel...', 'กำลังเตรียมข้อมูล');

                                // Create export data array - MATCH UPLOADED STRUCTURE EXACTLY (A-L, 12 columns)
                                const exportData = State.stores.map(store => ({
                                                        'A': '', // CY (skip)
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
                                                        'L': store.days && store.days.length > 0 ? store.days[0] : (store.dayOriginal || ''),
                                                                                                                                    'M': (store.seqs && store.days && store.days.length > 0) ? (store.seqs[store.days[0]] || '') : '' // New planned day (fallback to original)
                                }));

                                // Create worksheet with exactly 12 columns (A-L) matching upload format
                                const ws = XLSX.utils.json_to_sheet(exportData, {
                                                        header: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']
                                });

                                // Add header row matching upload file column names exactly
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

                                // Set column widths
                                ws['!cols'] = [
                                        { wch: 14 }, // A - CY
                                        { wch: 12 }, // B - รหัส
                                        { wch: 40 }, // C - ชื่อ
                                        { wch: 10 }, // D - Sales
                                        { wch: 8 },  // E - ประเภทร้านค้า1
                                        { wch: 18 }, // F - Sold To City
                                        { wch: 18 }, // G - Sold To State
                                        { wch: 14 }, // H - Address 5
                                        { wch: 14 }, // I - Latitude
                                        { wch: 14 }, // J - Longtitude
                                        { wch: 30 }, // K - ชื่อตลาด
                                        { wch: 6 }   // L - Day
                                                    ];

                                // Create workbook
                                const wb = XLSX.utils.book_new();
                                                XLSX.utils.book_append_sheet(wb, ws, 'Route Plan');

                                // Generate filename with date
                                const now = new Date();
                                                const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                                                const filename = `Route_Plan_${State.localActiveRoute}_${dateStr}.xlsx`;

                                // Save file
                                XLSX.writeFile(wb, filename);

                                UI.hideLoader();
                                                UI.showSaveToast(`✅ Export: ${filename}`);

                            } catch(err) {
                                                UI.hideLoader();
                                                console.error('❌ Export error:', err);
                                                UI.showErrorToast('❌ Export ไม่สำเร็จ: ' + err.message);
                            }
            },

            // ==========================================
            // 📦 Export ALL Routes (ทุกสายรวมกัน)
            // ==========================================
            exportAllRoutes: async () => {
                            try {
                                                const routes = State.db.routes;
                                                const routeKeys = Object.keys(routes);

                                if (routeKeys.length === 0) {
                                                        UI.showErrorToast('⚠️ ไม่มีข้อมูลสายวิ่งในระบบ กรุณาอัพโหลดไฟล์ก่อน');
                                                        return;
                                }

                                UI.showLoader('💾 กำลังรวมข้อมูลทุกสาย...', `รวม ${routeKeys.length} สาย`);

                                // Create workbook
                                const wb = XLSX.utils.book_new();

                                // Sheet 1: รวมทุกสาย (All Routes Combined)
                                const allStores = [];
                                                routeKeys.forEach(routeName => {
                                                                        const stores = routes[routeName] || [];
                                                                        stores.forEach(store => {
                                                                                                    allStores.push({
                                                                                                                                    'A': routeName,          // ชื่อสาย
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
                                                                                                                                    'L': store.days && store.days.length > 0 ? store.days[0] : (store.dayOriginal || ''),
                                                                                                                                    'M': (store.seqs && store.days && store.days.length > 0) ? (store.seqs[store.days[0]] || '') : ''
                                                                                                            });
                                                                        });
                                                });

                                const wsAll = XLSX.utils.json_to_sheet(allStores, {
                                                        header: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']
                                });

                                // Header row for combined sheet
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
                                        { wch: 18 }, // A - สายวิ่ง
                                        { wch: 12 }, // B - รหัส
                                        { wch: 40 }, // C - ชื่อ
                                        { wch: 10 }, // D - Sales
                                        { wch: 8 },  // E - ประเภทร้านค้า1
                                        { wch: 18 }, // F - Sold To City
                                        { wch: 18 }, // G - Sold To State
                                        { wch: 14 }, // H - Address 5
                                        { wch: 14 }, // I - Latitude
                                        { wch: 14 }, // J - Longtitude
                                        { wch: 30 }, // K - ชื่อตลาด
                                        { wch: 6 }   // L - Day
                                                    ];

                                XLSX.utils.book_append_sheet(wb, wsAll, 'ทุกสาย');

                                // Sheet per route (แยก sheet ต่อสาย)
                                routeKeys.forEach(routeName => {
                                                        const stores = routes[routeName] || [];
                                                        if (stores.length === 0) return;

                                                                  const exportData = stores.map(store => ({
                                                                                              'A': '', // CY (skip)
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
                                                                                              'L': store.days && store.days.length > 0 ? store.days[0] : (store.dayOriginal || ''),
                                                                                                                                    'M': (store.seqs && store.days && store.days.length > 0) ? (store.seqs[store.days[0]] || '') : ''
                                                                  }));

                                                                  const ws = XLSX.utils.json_to_sheet(exportData, {
                                                                                              header: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']
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
                                                                          { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                                                                          { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 6 }, { wch: 6 }
                                                                                          ];

                                                                  // Truncate sheet name to 31 chars (Excel limit)
                                                                  const sheetName = routeName.substring(0, 31);
                                                        XLSX.utils.book_append_sheet(wb, ws, sheetName);
                                });

                                // Generate filename with date
                                const now = new Date();
                                                const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                                                const filename = `Route_Plan_ALL_${routeKeys.length}สาย_${dateStr}.xlsx`;

                                // Save file
                                XLSX.writeFile(wb, filename);

                                UI.hideLoader();
                                                UI.showSaveToast(`✅ Export ทุกสาย: ${allStores.length} ร้าน จาก ${routeKeys.length} สาย`);

                            } catch(err) {
                                                UI.hideLoader();
                                                console.error('❌ Export All error:', err);
                                                UI.showErrorToast('❌ Export ไม่สำเร็จ: ' + err.message);
                            }
            },
    // ==========================================
    // 📦 Bulk Import — อัปโหลดทุกสายพร้อมกัน
    // แยกสาย/Route ตาม salesCode อัตโนมัติ
    // ==========================================
    bulkImport: (event) => {
        const file = event.target.files[0];
        event.target.value = ''; // reset input
        if (!file) return;

        if (file.size > 20 * 1024 * 1024) {
            return UI.showErrorToast('⚠️ ไฟล์ใหญ่เกิน 20MB');
        }

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
                    if (h.includes('รหัส') || h.includes('customer code') || h.includes('id')) idCol = i;
                    else if ((h.includes('ชื่อ') && !h.includes('ตลาด')) || h.includes('name')) nameCol = i;
                    else if (h.includes('lat') || h.includes('ละติจูด')) latCol = i;
                    else if (h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด')) lngCol = i;
                    else if (h.includes('freq') || h.includes('ความถี่') || h.includes('f2')) freqCol = i;
                    else if (h.includes('สายวิ่ง') || h.includes('day')) dayCol = i;
                    else if (h.includes('คิว') || h.includes('seq')) seqCol = i;
                    else if (h.includes('salescode') || h.includes('รหัสเซลล์')) salesCodeCol = i;
                    else if (h.includes('sales')) salesCodeCol = i;
                    else if (h.includes('ประเภท') || h.includes('type') || h.includes('shoptype')) shopTypeCol = i;
                    else if (h.includes('sold to city') || h.includes('subdistrict') || h.includes('ตำบล')) subDistrictCol = i;
                    else if (h.includes('sold to state') || h.includes('district') || h.includes('อำเภอ')) districtCol = i;
                    else if (h.includes('address 5') || h.includes('province') || h.includes('จังหวัด')) provinceCol = i;
                    else if (h.includes('ตลาด') || h.includes('market')) marketNameCol = i;
                    else if (h === 'cy' || h.includes('cy')) cyCol = i;
                }

                if (salesCodeCol === -1) {
                    UI.hideLoader();
                    return UI.showErrorToast('⚠️ ไม่พบ column "Sales Code" ในไฟล์ กรุณาตรวจสอบ header');
                }

                // ─── Parse ทุก row แล้วจัดกลุ่มตาม salesCode ───────────────
                const byRoute = {}; // { "402V01": { id1: storeObj, ... }, ... }

                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length === 0) continue;

                    const lat = parseFloat(String(row[latCol] || '').replace(/[^0-9.-]/g, ''));
                    const lng = parseFloat(String(row[lngCol] || '').replace(/[^0-9.-]/g, ''));
                    if (isNaN(lat) || isNaN(lng)) continue;

                    const idStr   = row[idCol] ? String(row[idCol]).trim() : '';
                    const scRaw   = salesCodeCol !== -1 ? String(row[salesCodeCol] || '').trim() : '';
                    if (!idStr || !scRaw) continue;

                    const routeKey = scRaw; // ใช้ salesCode เป็นชื่อ Route ตรงๆ
                    if (!byRoute[routeKey]) byRoute[routeKey] = {};

                    const freq      = (freqCol !== -1 && String(row[freqCol]||'').toUpperCase().includes('2')) ? 2 : 1;
                    const rawDay    = (dayCol !== -1 && row[dayCol]) ? String(row[dayCol]).trim() : '';
                    const dayNum    = rawDay ? parseInt(rawDay.replace(/[^0-9]/g, '')) : NaN;
                    const aDay      = !isNaN(dayNum) ? 'Day ' + dayNum : '';
                    const aSeq      = (seqCol !== -1 && row[seqCol]) ? parseInt(String(row[seqCol]).replace(/[^0-9]/g,'')) : NaN;

                    if (byRoute[routeKey][idStr]) {
                        // F2: ร้านซ้ำ → เพิ่ม day ที่สอง
                        if (aDay && !byRoute[routeKey][idStr].days.includes(aDay)) {
                            byRoute[routeKey][idStr].days.push(aDay);
                            if (!isNaN(aSeq)) byRoute[routeKey][idStr].seqs[aDay] = aSeq;
                        }
                        byRoute[routeKey][idStr].freq = 2;
                    } else {
                        const store = {
                            id: idStr, code: idStr,
                            name: row[nameCol] ? String(row[nameCol]).trim() : ('Store_' + idStr),
                            lat, lng, freq, days: [], seqs: {}, selected: false,
                            salesCode:   scRaw,
                            shopType:    shopTypeCol !== -1 ? String(row[shopTypeCol]||'').trim() : '',
                            subDistrict: subDistrictCol !== -1 ? String(row[subDistrictCol]||'').trim() : '',
                            district:    districtCol !== -1 ? String(row[districtCol]||'').trim() : '',
                            province:    provinceCol !== -1 ? String(row[provinceCol]||'').trim() : '',
                            marketName:  marketNameCol !== -1 ? String(row[marketNameCol]||'').trim() : '',
                            cy:          cyCol !== -1 ? String(row[cyCol]||'').trim() : '',
                            dayOriginal: rawDay
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

                // ─── Merge เข้า State.db.routes ──────────────────────────────
                let totalNew = 0, totalRoutes = routeKeys.length;
                const savedRoutes = [];

                for (const routeKey of routeKeys) {
                    const incoming    = Object.values(byRoute[routeKey]);
                    const existing    = State.db.routes[routeKey] || [];
                    const existingIds = new Set(existing.map(s => s.id));

                    // เพิ่มเฉพาะร้านที่ยังไม่มี ID ในระบบ
                    const newStores  = incoming.filter(s => !existingIds.has(s.id));
                    const merged     = [...existing, ...newStores];
                    State.db.routes[routeKey] = merged;
                    totalNew += newStores.length;
                    savedRoutes.push(routeKey);
                }

                // ─── บันทึกทุก Route ลง Firebase ────────────────────────────
                UI.showLoader('💾 กำลังบันทึก...', `บันทึก ${totalRoutes} สายวิ่ง`);
                const routeList = Object.keys(State.db.routes)
                    .sort((a,b) => a.localeCompare(b, 'th', { numeric: true }));

                // บันทึก routes ที่เพิ่ง import ทีละอัน
                // save ทีละสาย พร้อม progress
                for (let _si = 0; _si < savedRoutes.length; _si++) {
                    const _n = savedRoutes[_si];
                    UI.showLoader(
                        '💾 กำลังบันทึก... (' + (_si + 1) + '/' + savedRoutes.length + ' สาย)',
                        'สาย ' + _n + ' — ' + (State.db.routes[_n] ? State.db.routes[_n].length : 0) + ' ร้าน'
                    );
                    await App.currentRoutesCol().doc(_n).set({ stores: State.db.routes[_n] || [] });
                }
                // update metadata ถูก path ตาม mode
                const isDraft = App._planMode && App._planMode.startsWith('draft:');
                if (isDraft) {
                    const ym = App._planMode.replace('draft:', '');
                    await App.draftsCol().doc(ym).set(
                        { routeList, cycleDays: State.db.cycleDays || 24, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
                        { merge: true }
                    );
                } else {
                    await App.dbRef.update({ routeList, cycleDays: State.db.cycleDays || 24 });
                }

                // อัปเดต State และ UI
                if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                    State.localActiveRoute = routeList[0];
                }
                State.stores = State.db.routes[State.localActiveRoute] || [];

                UI.hideLoader();
                App.sync();
                MapCtrl.fitToStores();
                UI.showSaveToast(
                    `✅ Bulk Import เสร็จ! ${totalRoutes} สาย | เพิ่มร้านใหม่ ${totalNew} ร้าน`
                );

            } catch (err) {
                UI.hideLoader();
                console.error('bulkImport error:', err);
                UI.showErrorToast('❌ Import ไม่สำเร็จ: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    },

};

// ==========================================
// 🔗 File Input Event Listeners
// ==========================================
// หมายเหตุ: #fileUpload listener ถูก register ใน App.init() (admin-data.js) แล้ว
// ไม่ต้อง register ซ้ำที่นี่ เพื่อป้องกัน process ไฟล์สองรอบ (แก้ไข BUG-06)
// #bulkUpload ใช้ onchange attribute ใน HTML โดยตรง → ไม่ต้อง register ที่นี่
document.addEventListener('DOMContentLoaded', () => {});

console.log('✅ FileManager loaded');

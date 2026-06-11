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

    // ─── exportAllRoutes: Export ทุกสาย หรือสายที่เลือก ─────────────────
    exportAllRoutes: async (routeFilter = 'ALL') => {
        try {
            // ✅ ดึงเดือนที่เลือกจาก dropdown
            const sel = document.getElementById('export-month-sel');
            const selectedYM = sel?.value || App._currentPlanYM || '';

            // โหลด plan ของเดือนที่เลือก (ถ้าต่างจากเดือนปัจจุบัน)
            let routes = State.db.routes;
            let planLabel = selectedYM || 'ปัจจุบัน';

            if (selectedYM && selectedYM !== App._currentPlanYM) {
                UI.showLoader('⏳ โหลดข้อมูลเดือน ' + planLabel + '...', 'กำลังดึงข้อมูลจาก Firestore');
                try {
                    const planRef = db.collection('appData').doc(window.CENTER_DOC)
                        .collection('plans').doc(selectedYM);
                    const routeList = State.db.routeList || [];
                    routes = {};
                    const BATCH = 5;
                    for (let i = 0; i < routeList.length; i += BATCH) {
                        const chunk = routeList.slice(i, i + BATCH);
                        const docs = await Promise.all(
                            chunk.map(r => planRef.collection('routes').doc(r).get().catch(() => null))
                        );
                        docs.forEach((d, j) => {
                            if (d?.exists) routes[chunk[j]] = d.data().stores || [];
                        });
                    }
                } catch(e) {
                    UI.hideLoader();
                    return UI.showErrorToast('❌ โหลดข้อมูลเดือน ' + planLabel + ' ไม่สำเร็จ');
                }
            }

            // ✅ กรองสายที่เลือก
            let routeKeys = Object.keys(routes);
            if (routeFilter && routeFilter !== 'ALL') {
                routeKeys = routeKeys.filter(r => r === routeFilter);
            }
            if (routeKeys.length === 0)
                return UI.showErrorToast('⚠️ ไม่มีข้อมูลสายวิ่งในระบบ');

            UI.showLoader('💾 กำลังรวมข้อมูลทุกสาย...', `รวม ${routeKeys.length} สาย เดือน ${planLabel}`);

            const wb = XLSX.utils.book_new();
            const allStores = [];

            routeKeys.forEach(routeName => {
                (routes[routeName] || []).forEach(store => {
                    if (store.inactive) return; // ✅ ข้าม inactive
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
                const stores = (routes[routeName] || []).filter(s => !s.inactive);
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

            const now     = new Date();
            const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            const ymStr   = selectedYM ? `_${selectedYM}` : '';
            const filename = `Route_Plan_ALL${ymStr}_${routeKeys.length}สาย_${dateStr}.xlsx`;
            XLSX.writeFile(wb, filename);

            UI.hideLoader();
            UI.showSaveToast(`✅ Export ทุกสาย เดือน ${planLabel}: ${allStores.length} ร้าน จาก ${routeKeys.length} สาย`);

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
                let totalNew = 0, totalReactivated = 0;
                const savedRoutes = [];

                // สะสม missing stores ทุกสายก่อน แล้วค่อย popup ครั้งเดียว
                const missingByRoute = {}; // { routeKey: [store, ...] }

                for (const routeKey of routeKeys) {
                    const incoming    = Object.values(byRoute[routeKey]);
                    const existing    = State.db.routes[routeKey] || [];
                    const incomingMap = {};
                    incoming.forEach(s => { incomingMap[s.id] = s; });

                    // อัปเดตร้านเดิมที่มี ID ตรงกัน + reactivate ร้านที่กลับมา
                    const updatedExisting = existing.map(s => {
                        const inc = incomingMap[s.id];
                        if (!inc) return s; // จัดการในขั้นถัดไป
                        const wasInactive = s.inactive === true;
                        const updated = {
                            ...s,
                            days:       inc.days       || s.days,
                            seqs:       (inc.seqs && Object.keys(inc.seqs).length > 0) ? inc.seqs : s.seqs,
                            marketName: inc.marketName || s.marketName,
                            lat:        inc.lat        || s.lat,
                            lng:        inc.lng        || s.lng,
                            cy:         inc.cy         || s.cy || '',
                            inactive:   false, // ✅ reactivate ถ้ากลับมาในไฟล์ใหม่
                        };
                        if (wasInactive) totalReactivated++;
                        return updated;
                    });

                    // หาร้านที่หายไปจากไฟล์ใหม่ (ไม่นับร้านที่ inactive อยู่แล้ว)
                    const missing = existing.filter(s => !incomingMap[s.id] && !s.inactive);
                    if (missing.length > 0) missingByRoute[routeKey] = missing;

                    const newStores = incoming.filter(s => !existing.some(e => e.id === s.id));
                    State.db.routes[routeKey] = [...updatedExisting, ...newStores];
                    totalNew += newStores.length;
                    savedRoutes.push(routeKey);
                }

                UI.hideLoader();

                // ─── Popup แจ้งร้านที่หายไป ──────────────────────────────
                const allMissing = Object.entries(missingByRoute)
                    .flatMap(([route, stores]) => stores.map(s => ({ ...s, _route: route })));

                const doSaveAll = async () => {
                    const routeList = Object.keys(State.db.routes)
                        .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
                    for (let _si = 0; _si < savedRoutes.length; _si++) {
                        const _n = savedRoutes[_si];
                        UI.showLoader(
                            `💾 กำลังบันทึก... (${_si+1}/${savedRoutes.length} สาย)`,
                            `สาย ${_n} — ${(State.db.routes[_n]||[]).length} ร้าน`
                        );
                        await App.planRoutesCol(App._currentPlanYM).doc(_n).set({ stores: State.db.routes[_n] || [] });
                    }
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
                    let msg = `✅ Bulk Import เสร็จ! ${routeKeys.length} สาย | เพิ่มใหม่ ${totalNew} ร้าน`;
                    if (totalReactivated > 0) msg += ` | กลับมา ${totalReactivated} ร้าน`;
                    UI.showSaveToast(msg);
                };

                if (allMissing.length === 0) {
                    // ไม่มีร้านหายไป → บันทึกทันที
                    await doSaveAll();
                    return;
                }

                // ─── สร้าง popup รายชื่อร้านที่หายไป ────────────────────
                // decisions: { storeId: 'inactive' | 'delete' }
                const decisions = {};
                allMissing.forEach(s => { decisions[s.id] = 'inactive'; }); // default = พักไว้

                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Prompt,sans-serif;';

                const renderRows = () => allMissing.map(s => `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:#f9fafb;border:1px solid #f3f4f6;margin-bottom:6px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:12px;font-weight:800;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
                            <div style="font-size:10px;color:#9ca3af;font-family:monospace;">${s.id} · สาย ${s._route}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-shrink:0;">
                            <button id="btn-inactive-${s.id}"
                                onclick="window._bulkDecide('${s.id}','inactive')"
                                style="padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700;border:none;cursor:pointer;transition:all 0.12s;background:${decisions[s.id]==='inactive'?'#6366f1':'#e5e7eb'};color:${decisions[s.id]==='inactive'?'#fff':'#6b7280'};">
                                💤 พัก
                            </button>
                            <button id="btn-delete-${s.id}"
                                onclick="window._bulkDecide('${s.id}','delete')"
                                style="padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700;border:none;cursor:pointer;transition:all 0.12s;background:${decisions[s.id]==='delete'?'#ef4444':'#e5e7eb'};color:${decisions[s.id]==='delete'?'#fff':'#6b7280'};">
                                🗑️ ลบ
                            </button>
                        </div>
                    </div>`).join('');

                const renderPopup = () => {
                    overlay.innerHTML = `
                    <div style="background:#fff;border-radius:20px;padding:24px;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                        <div style="font-size:16px;font-weight:900;color:#111827;margin-bottom:4px;">⚠️ ร้านที่ไม่อยู่ในไฟล์ใหม่</div>
                        <div style="font-size:12px;color:#6b7280;margin-bottom:14px;">พบ <b>${allMissing.length} ร้าน</b> ที่ไม่มีในไฟล์ที่อัปโหลด — เลือกว่าจะทำอะไรกับแต่ละร้าน</div>
                        <div style="display:flex;gap:6px;margin-bottom:10px;">
                            <button onclick="window._bulkDecideAll('inactive')" style="flex:1;padding:6px;border-radius:8px;font-size:11px;font-weight:800;border:1.5px solid #6366f1;background:#ede9fe;color:#5b21b6;cursor:pointer;">💤 พักทั้งหมด</button>
                            <button onclick="window._bulkDecideAll('delete')" style="flex:1;padding:6px;border-radius:8px;font-size:11px;font-weight:800;border:1.5px solid #ef4444;background:#fee2e2;color:#991b1b;cursor:pointer;">🗑️ ลบทั้งหมด</button>
                        </div>
                        <div id="_bulk-list" style="overflow-y:auto;flex:1;padding-right:4px;">${renderRows()}</div>
                        <div style="display:flex;gap:8px;margin-top:14px;">
                            <button onclick="window._bulkConfirm()" style="flex:1;padding:12px;border-radius:12px;background:#2563eb;color:#fff;font-size:14px;font-weight:800;border:none;cursor:pointer;">✅ ยืนยัน</button>
                            <button onclick="window._bulkCancel()" style="padding:12px 18px;border-radius:12px;background:#f3f4f6;color:#374151;font-size:14px;font-weight:700;border:none;cursor:pointer;">ยกเลิก</button>
                        </div>
                    </div>`;
                };

                window._bulkDecide = (id, action) => {
                    decisions[id] = action;
                    const li = document.getElementById('_bulk-list');
                    if (li) li.innerHTML = renderRows();
                };
                window._bulkDecideAll = (action) => {
                    allMissing.forEach(s => { decisions[s.id] = action; });
                    const li = document.getElementById('_bulk-list');
                    if (li) li.innerHTML = renderRows();
                };
                window._bulkCancel = () => {
                    document.body.removeChild(overlay);
                    delete window._bulkDecide;
                    delete window._bulkDecideAll;
                    delete window._bulkConfirm;
                    delete window._bulkCancel;
                };
                window._bulkConfirm = async () => {
                    document.body.removeChild(overlay);
                    delete window._bulkDecide;
                    delete window._bulkDecideAll;
                    delete window._bulkConfirm;
                    delete window._bulkCancel;

                    // apply decisions
                    for (const s of allMissing) {
                        const route = State.db.routes[s._route];
                        if (!route) continue;
                        const idx = route.findIndex(r => r.id === s.id);
                        if (idx === -1) continue;
                        if (decisions[s.id] === 'inactive') {
                            // ✅ พักไว้ใน history — ซ่อนจาก Sales แต่ยังอยู่ใน Firestore
                            route[idx] = { ...route[idx], inactive: true, days: [], seqs: {} };
                        } else {
                            // ลบออกจาก array
                            route.splice(idx, 1);
                        }
                    }

                    await doSaveAll();
                };

                renderPopup();
                document.body.appendChild(overlay);

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

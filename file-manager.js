// ==========================================
// 📂 Upload & Parse Route Plan File
// v2 — 2026-05-21 | fixes: BUG-02 rawData, BUG-09 cy field, indentation
// ==========================================
const FileManager = {

    // ✅ NEW: หาวันที่ปฏิทินจริงที่ "Day N" ตรงกับ ในเดือน/ปีที่ระบุ ตาม calendarConfig ที่มีผล
    // (รองรับทุกโหมด รวมถึง cycle แบบ weekday-rolling ที่นับต่อเนื่องไม่รีเซ็ตรายเดือน)
    // คืนค่าเป็น Date object หรือ null ถ้าหาไม่ได้ (เช่น label ไม่ตรงกับเดือนนี้เลย)
    _resolveCalendarDate: (cfg, dayLabel, year, month) => {
        if (!dayLabel || !cfg) return null;
        const targetNum = parseInt(String(dayLabel).replace('Day ', ''));

        if (!cfg.mode && (!cfg.mapping || Object.keys(cfg.mapping).length === 0)) {
            return isNaN(targetNum) ? null : new Date(year, month, targetNum);
        }
        if (!cfg.mode && cfg.mapping) {
            const entry = Object.entries(cfg.mapping).find(([, v]) => v === dayLabel);
            return entry ? new Date(year, month, parseInt(entry[0])) : null;
        }
        if (cfg.mode === 'date') {
            return isNaN(targetNum) ? null : new Date(year, month, targetNum);
        }
        if (cfg.mode === 'fixed') {
            if (!cfg.mapping) return null;
            const entry = Object.entries(cfg.mapping).find(([, v]) => v === dayLabel);
            return entry ? new Date(year, month, parseInt(entry[0])) : null;
        }
        if (cfg.mode === 'weekday') {
            const wmap = cfg.weekdayMap || {};
            const targetWd = wmap[dayLabel];
            if (targetWd === undefined) return null;
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            for (let d = 1; d <= daysInMonth; d++) {
                if (new Date(year, month, d).getDay() === targetWd) return new Date(year, month, d); // วันแรกที่เจอในเดือนนี้
            }
            return null;
        }
        if (cfg.mode === 'cycle') {
            const isWkHol = (d) => (cfg.weeklyHolidays || []).includes(d.getDay());
            if (cfg.anchorType === 'weekday-rolling') {
                if (!cfg.anchorDate) return null;
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                for (let d = 1; d <= daysInMonth; d++) {
                    const target = new Date(year, month, d);
                    if (isWkHol(target)) continue;
                    const anchor = new Date(cfg.anchorDate + 'T00:00:00');
                    let offset = 0;
                    const cur = new Date(anchor);
                    if (target.getTime() >= anchor.getTime()) {
                        while (cur.getTime() < target.getTime()) { cur.setDate(cur.getDate()+1); if (!isWkHol(cur)) offset++; }
                    } else {
                        while (cur.getTime() > target.getTime()) { cur.setDate(cur.getDate()-1); if (!isWkHol(cur)) offset--; }
                    }
                    const cycleDays = parseInt(cfg.cycleDays || 24);
                    const startNum  = parseInt(cfg.anchorDayNum || 1);
                    const n = (((startNum - 1 + offset) % cycleDays) + cycleDays) % cycleDays + 1;
                    if (('Day ' + n) === dayLabel) return target; // คืนวันแรกที่ตรงในเดือนนี้
                }
                return null;
            }
            // date-anchor / weekday-once — รีเซ็ตรายเดือน ไม่วนซ้ำ
            const isHol = (d) => (cfg.holidays || []).includes(d) || isWkHol(new Date(year, month, d));
            let startDate;
            if (cfg.anchorType === 'weekday-once') {
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                startDate = null;
                for (let d = 1; d <= daysInMonth; d++) {
                    if (new Date(year, month, d).getDay() === cfg.anchorWeekday) { startDate = d; break; }
                }
                if (startDate === null) return null;
            } else {
                startDate = parseInt(cfg.startDay || 1);
            }
            const cycleDays   = parseInt(cfg.cycleDays || 24);
            const startDayNum = parseInt(cfg.startDayNum || 1);
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            // ✅ BUGFIX (2026-08-29): เดิมนับ workDay ไล่ขึ้นจาก startDayNum แล้วตัดจบทันทีที่เกิน
            // cycleDays — ทำให้ถ้า startDayNum ไม่ใช่ 1 (เช่นเริ่ม Day 4) ช่วงท้ายเดือนที่ควร "วน"
            // กลับไปใช้ D01, D02, D03 ที่ถูกข้ามไปตอนต้น กลับหายไปเฉยๆ (ไม่มี Day ให้เลย)
            // ที่ถูกต้อง cycleDays คือ "จำนวนรอบทั้งหมดใน 1 cycle" ไม่ใช่เพดานตายตัวของเลข Day
            // นับ count (ลำดับวันทำงานที่ 1,2,3,...) แล้ว wrap กลับด้วย modulo แทน
            let count = 0;
            for (let d = startDate; d <= daysInMonth; d++) {
                if (isHol(d)) continue;
                count++;
                if (count > cycleDays) return null;
                const dayNum = ((startDayNum - 1 + (count - 1)) % cycleDays) + 1;
                if (dayNum === targetNum) return new Date(year, month, d);
            }
            return null;
        }
        return null;
    },

    _fmtDateForExport: (date) => {
        if (!date) return '';
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${date.getFullYear()}`;
    },

    // ✅ คืนค่าคอลัมน์ Day สำหรับ export — พยายามคำนวณเป็นวันที่จริงก่อน (ตาม calendarConfig
    // ที่มีผล) ถ้าคำนวณไม่ได้ (เช่นยังไม่เคยตั้งค่าปฏิทินเลย) fallback กลับไปโชว์ label/ค่าดิบเดิม
    _dayColumnValue: (store, cfg, year, month) => {
        const label = store.days?.length > 0 ? store.days[0] : '';
        if (label && cfg) {
            const d = FileManager._resolveCalendarDate(cfg, label, year, month);
            if (d) return FileManager._fmtDateForExport(d);
        }
        return label || (store.dayOriginal || '');
    },

    // ✅ NEW: เรียงร้านสำหรับ export ตามลำดับ Day (จากเลขใน "Day N" ไม่ใช่วันที่ปฏิทินที่โชว์
    // ในคอลัมน์ Day เพราะบางโหมดปฏิทินแปลงเป็นวันที่จริงไปแล้ว ต้องอิงเลข cycle เดิมเสมอ)
    // แล้วตามด้วยลำดับที่จัดไว้ในวันนั้น (seqs) — คืน array ใหม่ ไม่แก้ของเดิม
    _sortStoresForExport: (stores) => {
        const dayNumOf = (s) => {
            const label = (s.days && s.days[0]) ? s.days[0] : (s.dayOriginal || '');
            const m = String(label).match(/(\d+)/);
            return m ? parseInt(m[1]) : Infinity;
        };
        const seqNumOf = (s) => {
            const day = (s.days && s.days[0]) ? s.days[0] : null;
            const v = day && s.seqs ? s.seqs[day] : undefined;
            return (typeof v === 'number' && !isNaN(v)) ? v : Infinity;
        };
        return stores.slice().sort((a, b) => dayNumOf(a) - dayNumOf(b) || seqNumOf(a) - seqNumOf(b));
    },

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

            // ✅ NEW: เติมชื่อตลาดที่ขาด (ไฟล์นี้ไม่มี days กำหนดแล้ว ใช้ dayOriginal จัดกลุ่มแทน)
            FileManager._autoFillMarketNames(stores);

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

            // ✅ NEW: เช็ค override เฉพาะสายก่อน ถ้าไม่มีใช้ default ของศูนย์ — ใช้คำนวณวันที่จริง
            // ของคอลัมน์ Day แทนที่จะโชว์แค่ "Day N" เฉยๆ
            const ym = App._currentPlanYM;
            let effectiveCfg = State.db.calendarConfig || null;
            if (ym && State.localActiveRoute) {
                try {
                    const rd = await App.planRoutesCol(ym).doc(State.localActiveRoute).get();
                    if (rd.exists && rd.data().calendarOverride) effectiveCfg = rd.data().calendarOverride;
                } catch (e) { console.warn('exportTemplate: โหลด override ไม่สำเร็จ', e); }
            }
            const [expYear, expMonth] = ym ? ym.split('_').map(Number) : [null, null];

            // ✅ NEW: กันชื่อตลาดว่างหลุดออกไปในไฟล์ export (เช่น ร้านที่เพิ่มเองในแอดมิน ไม่เคยผ่าน import)
            FileManager._autoFillMarketNames(State.stores);

            // ✅ NEW: เรียงตามวัน (Day) แล้วตามด้วยลำดับที่จัดไว้ในวันนั้น — เดิม export ตามลำดับ
            // ในอาเรย์ดิบ (เช่น ลำดับ import) ทำให้ไฟล์ที่ได้ไม่เรียงตามคิวจริงที่เซลจะวิ่ง
            const sortedStores = FileManager._sortStoresForExport(State.stores);

            const exportData = sortedStores.map(store => ({
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
                'L': (expYear !== null) ? FileManager._dayColumnValue(store, effectiveCfg, expYear, expMonth - 1) : (store.days?.length > 0 ? store.days[0] : (store.dayOriginal || '')),
                'M': (store.seqs && store.days?.length > 0) ? (store.seqs[store.days[0]] || '') : '',
                // ✅ NEW (2026-08-29): เพิ่มคอลัมน์ "Cycle Name" กลับเข้าไปตอน export — เดิมค่าดิบที่
                // อ่านมาจากไฟล์ upload (เก็บไว้ใน store.dayOriginal) ไม่เคยถูกเขียนกลับออกไปเลย
                'N': store.dayOriginal || '',
            }));

            const ws = XLSX.utils.json_to_sheet(exportData, {
                header: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'],
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
            ws['N1'] = { v: 'Cycle Name', t: 's' };

            ws['!cols'] = [
                { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 10 },
                { wch: 8  }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 6  }, { wch: 6 },
                { wch: 16 },
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
                    // ✅ BUGFIX (2026-08-29): เดิมใช้ตัวแปร `db` เฉยๆ ซึ่งไม่มีอยู่จริงในหน้า Admin
                    // (index.html โหลด app-config.js ที่ประกาศ `cloudDB` ไม่ใช่ `db` — `db` มีแค่ใน
                    // sales-app.js ซึ่งหน้า Admin ไม่ได้โหลด) ทำให้กด Export ทุกสายแล้วขึ้น
                    // "db is not defined" เสมอตอนเลือกเดือนอื่นที่ไม่ใช่เดือนปัจจุบัน
                    const planRef = cloudDB.collection('appData').doc(window.CENTER_DOC)
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

            // ✅ NEW: เรียงสายตามชื่อ (เช่น 402C01, 402C02, 402V01, ... ) — เดิมเรียงตามลำดับที่
            // Object.keys() คืนมา (ไม่รับประกันลำดับ) ทำให้ชีท "ทุกสาย" สลับสายมั่วไม่เป็นระเบียบ
            routeKeys.sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));

            UI.showLoader('💾 กำลังรวมข้อมูลทุกสาย...', `รวม ${routeKeys.length} สาย เดือน ${planLabel}`);

            // ✅ NEW: โหลด override เฉพาะสาย (ถ้ามี) ของทุกสายที่จะ export — ใช้คำนวณวันที่จริง
            // ของคอลัมน์ Day แทนที่จะโชว์แค่ "Day N" เฉยๆ (แต่ละสายอาจมี override ต่างกัน)
            const exportYM = selectedYM || App._currentPlanYM || '';
            const [expYear, expMonthRaw] = exportYM ? exportYM.split('_').map(Number) : [null, null];
            const expMonth = expMonthRaw !== undefined ? expMonthRaw - 1 : null;
            const routeCfgs = {};
            if (expYear !== null) {
                // ✅ BUGFIX (2026-08-29): เหมือนจุดข้างบน — ต้องใช้ cloudDB ไม่ใช่ db (ไม่มีอยู่จริงในหน้า Admin)
                const planRefForCfg = cloudDB.collection('appData').doc(window.CENTER_DOC).collection('plans').doc(exportYM);
                const BATCH2 = 5;
                for (let i = 0; i < routeKeys.length; i += BATCH2) {
                    const chunk = routeKeys.slice(i, i + BATCH2);
                    const docs = await Promise.all(
                        chunk.map(r => planRefForCfg.collection('routes').doc(r).get().catch(() => null))
                    );
                    docs.forEach((d, j) => {
                        routeCfgs[chunk[j]] = (d?.exists && d.data().calendarOverride) ? d.data().calendarOverride : State.db.calendarConfig;
                    });
                }
            }
            const dayColFor = (routeName, store) => (expYear !== null)
                ? FileManager._dayColumnValue(store, routeCfgs[routeName], expYear, expMonth)
                : (store.days?.length > 0 ? store.days[0] : (store.dayOriginal || ''));

            // ✅ NEW: กันชื่อตลาดว่างหลุดออกไปในไฟล์ export ทุกสาย
            routeKeys.forEach(routeName => FileManager._autoFillMarketNames(routes[routeName] || []));

            const wb = XLSX.utils.book_new();
            const allStores = [];

            routeKeys.forEach(routeName => {
                // ✅ NEW: เรียงตามวัน+ลำดับก่อน push — เดิม push ตามลำดับในอาเรย์ดิบ (เช่น ลำดับ
                // import) ทำให้ชีท "ทุกสาย" ไม่ได้เรียงตามคิววิ่งจริงของแต่ละสาย
                FileManager._sortStoresForExport((routes[routeName] || []).filter(s => !s.inactive)).forEach(store => {
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
                        'L': dayColFor(routeName, store),
                        'M': (store.seqs && store.days?.length > 0) ? (store.seqs[store.days[0]] || '') : '',
                        // ✅ NEW (2026-08-29): ดู comment เดียวกันใน exportTemplate ข้างบน
                        'N': store.dayOriginal || '',
                    });
                });
            });

            const wsAll = XLSX.utils.json_to_sheet(allStores, {
                header: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'],
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
            wsAll['N1'] = { v: 'Cycle Name', t: 's' };
            wsAll['!cols'] = [
                { wch: 18 }, { wch: 12 }, { wch: 40 }, { wch: 10 },
                { wch: 8  }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 6  },
                { wch: 16 },
            ];
            XLSX.utils.book_append_sheet(wb, wsAll, 'ทุกสาย');

            // Sheet ต่อสาย
            routeKeys.forEach(routeName => {
                const stores = FileManager._sortStoresForExport((routes[routeName] || []).filter(s => !s.inactive));
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
                    'L': dayColFor(routeName, store),
                    'M': (store.seqs && store.days?.length > 0) ? (store.seqs[store.days[0]] || '') : '',
                    // ✅ NEW (2026-08-29): ดู comment เดียวกันใน exportTemplate ข้างบน
                    'N': store.dayOriginal || '',
                }));

                const ws = XLSX.utils.json_to_sheet(exportData, {
                    header: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'],
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
                ws['N1'] = { v: 'Cycle Name', t: 's' };
                ws['!cols'] = [
                    { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 10 },
                    { wch: 8  }, { wch: 18 }, { wch: 18 }, { wch: 14 },
                    { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 6  }, { wch: 6 },
                    { wch: 16 },
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

    // ✅ NEW: เติม marketName อัตโนมัติให้ร้านที่ไม่มีชื่อตลาด (ช่องว่างในไฟล์ หรือไฟล์ไม่มีคอลัมน์นี้เลย)
    // กรณี 1: มีร้านอื่นในสาย+วันเดียวกัน (route+day) ที่มีชื่อตลาดอยู่แล้ว → copy มาใช้เลย
    // กรณี 2: ไม่มีใครในกลุ่มวันนั้นมีชื่อตลาดเลย → generate จาก
    //   {salesCode} D{เลขวัน 2 หลัก} + ตำบล 2 อันดับที่มีร้านเยอะสุดในกลุ่ม + อำเภอ/จังหวัดที่มีร้านเยอะสุด
    // (ตัด "ต./อ./จ." ออกก่อนเสมอ ให้ตรงกับ pattern ชื่อตลาดจริงที่ใช้อยู่)
    _autoFillMarketNames: (stores) => {
        // ข้อมูลจริงในระบบใช้ทั้งแบบย่อมีจุด ("ต.", "อ.", "จ.") และแบบเต็มคำ ("ตำบล", "อำเภอ",
        // "จังหวัด") ปนกันไปตามไฟล์ต้นทาง — ต้องตัดทั้ง 2 แบบ ไม่งั้นชื่อตลาดจะโผล่คำนำหน้าไม่ตรงกัน
        const stripPrefix = (v) => String(v || '').replace(/^(ตำบล|ต\.|อำเภอ|อ\.|จังหวัด|จ\.)\s*/, '').trim();
        // ปกติจัดกลุ่มตาม s.days (เช่นจาก bulkImport/handleMapUpload ที่ผ่านการกำหนดวันแล้ว)
        // แต่บาง import path (เช่น uploadRouteFile) ยังไม่กำหนด days เลย — fallback ไปใช้
        // dayOriginal (ค่า Day/Cycle Name ดิบจากไฟล์) เป็น key จัดกลุ่มแทน
        const dayKeysOf = (s) => (s.days && s.days.length > 0)
            ? s.days
            : (s.dayOriginal ? [String(s.dayOriginal).trim()] : []);

        // จัดกลุ่มร้านตามวัน — ร้าน F2 อยู่ได้หลายกลุ่ม (นับทุกวันที่มันอยู่)
        const byDay = {};
        stores.forEach(s => {
            dayKeysOf(s).forEach(d => {
                if (!d) return;
                if (!byDay[d]) byDay[d] = [];
                byDay[d].push(s);
            });
        });

        Object.entries(byDay).forEach(([day, group]) => {
            const needFill = group.filter(s => !s.marketName || !s.marketName.trim());
            if (needFill.length === 0) return;

            // กรณี 1: มีร้านอื่นในกลุ่มวันนี้ที่มีชื่อตลาดอยู่แล้ว → copy
            const existingName = group.find(s => s.marketName && s.marketName.trim());
            if (existingName) {
                needFill.forEach(s => { s.marketName = existingName.marketName; });
                return;
            }

            // กรณี 2: ไม่มีใครในกลุ่มมีชื่อตลาดเลย → generate จากตำบล/อำเภอ/จังหวัดของสมาชิกกลุ่ม
            // (นับความถี่ของแต่ละค่า เรียงมากไปน้อย — เท่ากันแล้วใช้ลำดับที่เจอก่อน)
            const rankByFreq = (field) => {
                const counts = {}, order = [];
                group.forEach(s => {
                    const v = stripPrefix(s[field]);
                    if (!v) return;
                    if (!(v in counts)) { counts[v] = 0; order.push(v); }
                    counts[v]++;
                });
                return order.sort((a, b) => counts[b] - counts[a]);
            };

            const tambons  = rankByFreq('subDistrict').slice(0, 2);
            const amphoe   = rankByFreq('district')[0]  || '';
            const province = rankByFreq('province')[0]  || '';
            const dayDigits = String(day).replace(/[^0-9]/g, '');
            const dToken    = dayDigits ? 'D' + dayDigits.padStart(2, '0') : '';
            const generated = [group[0].salesCode || '', dToken, ...tambons, amphoe, province]
                .filter(Boolean).join(' ');

            needFill.forEach(s => { s.marketName = generated; });
        });
    },

    // ══════════════════════════════════════════════════════════════════
    // ✅ NEW: นำเข้าจากไฟล์ SAP มาตรฐานของบริษัท (Customer Master + RoutePlan
    // Detail) — สำหรับศูนย์ใหม่ที่ยังไม่เคยมีข้อมูลในระบบ หรืออัปเดตร้านใหม่/
    // แก้ไขข้อมูลร้านจากไฟล์ Master เพียงไฟล์เดียว โดยไม่แตะวัน/ชื่อตลาดเดิม
    // ══════════════════════════════════════════════════════════════════

    // หา index แถวที่เป็น header จริง — ไฟล์ SAP export มักมีแถวหัวเรื่อง/แถวว่าง
    // นำหน้า header จริงอยู่ 1-2 แถวเสมอ ต้องหาแถวที่มีคอลัมน์ mustHave ก่อนเชื่อถือ
    _findHeaderRowIndex: (rows, mustHave) => {
        for (let i = 0; i < Math.min(5, rows.length); i++) {
            if (rows[i] && rows[i].some(c => String(c).trim() === mustHave)) return i;
        }
        return -1;
    },

    // Parse ไฟล์ "MST - Customer Master" → { customerCode: {name, status, subDistrict, ...} }
    _parseSapCustomerMaster: (rows) => {
        const hIdx = FileManager._findHeaderRowIndex(rows, 'Customer Code');
        if (hIdx === -1) return null;
        const h = rows[hIdx];
        const idx = (name) => h.indexOf(name);
        const byCode = {};
        for (let r = hIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row) continue;
            const code = row[idx('Customer Code')] ? String(row[idx('Customer Code')]).trim() : '';
            if (!code) continue;
            byCode[code] = {
                name:        row[idx('Customer Name')]     ? String(row[idx('Customer Name')]).trim()     : '',
                status:      row[idx('Customer Status')]   ? String(row[idx('Customer Status')]).trim()   : '',
                subDistrict: row[idx('City')]              ? String(row[idx('City')]).trim()              : '',
                district:    row[idx('District')]          ? String(row[idx('District')]).trim()          : '',
                province:    row[idx('State')]             ? String(row[idx('State')]).trim()             : '',
                lat:         parseFloat(String(row[idx('Master Latitude')]  || '').replace(/[^0-9.-]/g, '')),
                lng:         parseFloat(String(row[idx('Master Longitude')] || '').replace(/[^0-9.-]/g, '')),
                shopType:    row[idx('Outlet Category')]   ? String(row[idx('Outlet Category')]).trim()   : '',
                salesCode:   row[idx('Salesman Code')]     ? String(row[idx('Salesman Code')]).trim()     : '',
            };
        }
        return byCode;
    },

    // Parse ไฟล์ "MST - RoutePlan Detail" → [{code, routeCode, cy, marketName, dayNum}, ...]
    // หมายเหตุ: "Cycle Name" ในไฟล์นี้คือชื่อตลาดที่คิวรีตี้ทำไว้แล้ว (เช่น "402C01 D01 บ่อพลอย
    // ลาดหญ้า หนองปรือ") ใช้ตรงๆ เป็น marketName ได้เลย ไม่ต้อง generate ใหม่ — ส่วนเลขวันต้อง
    // แกะจากคำว่า "D01" ที่ฝังอยู่ในข้อความนั้น (ห้ามเอาทั้งสตริงไป parseInt/replace ตัวอักษรทิ้ง
    // ตรงๆ เพราะจะได้ตัวเลขมั่วจากการเอาหลายตัวเลขในข้อความมาต่อกัน)
    _parseSapRoutePlanDetail: (rows) => {
        const hIdx = FileManager._findHeaderRowIndex(rows, 'Customer Code');
        if (hIdx === -1) return null;
        const h = rows[hIdx];
        const idx = (name) => h.indexOf(name);
        const list = [];
        for (let r = hIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row) continue;
            const code = row[idx('Customer Code')] ? String(row[idx('Customer Code')]).trim() : '';
            if (!code) continue;
            const cycleName = row[idx('Cycle Name')] ? String(row[idx('Cycle Name')]).trim() : '';
            const dMatch = cycleName.match(/D(\d+)/);
            list.push({
                code,
                routeCode:  row[idx('Route Code')]  ? String(row[idx('Route Code')]).trim()  : '',
                cy:         row[idx('Cycle Code')]  ? String(row[idx('Cycle Code')]).trim()  : '',
                marketName: cycleName,
                dayNum:     dMatch ? parseInt(dMatch[1]) : NaN,
                name:       row[idx('Customer Name')]    ? String(row[idx('Customer Name')]).trim()    : '',
                shopType:   row[idx('Outlet Category')]  ? String(row[idx('Outlet Category')]).trim()  : '',
            });
        }
        return list;
    },

    // รวม Master + RoutePlan Detail เข้าด้วยกันเป็น byRoute { routeKey: { customerCode: store } }
    // รูปแบบเดียวกับที่ bulkImport ใช้ — ร้านที่มีอยู่ใน Detail ได้วัน/ชื่อตลาดจาก Detail +
    // พิกัด/ที่อยู่จาก Master ส่วนร้านที่มีแค่ใน Master (ยังไม่เคยจัดสาย) ใส่เข้าไปแบบไม่มีวัน
    // รอ AI Route Builder หรือจัดมือทีหลัง
    _buildByRouteFromMasterDetail: (masterByCode, detailList) => {
        const byRoute = {};
        const detailCodes = new Set();

        detailList.forEach(row => {
            const m = masterByCode[row.code] || {};
            const routeKey = row.routeCode || m.salesCode;
            if (!routeKey) return;
            detailCodes.add(row.code);
            if (!byRoute[routeKey]) byRoute[routeKey] = {};
            const aDay = !isNaN(row.dayNum) ? 'Day ' + row.dayNum : '';

            if (byRoute[routeKey][row.code]) {
                if (aDay && !byRoute[routeKey][row.code].days.includes(aDay)) {
                    byRoute[routeKey][row.code].days.push(aDay);
                }
                byRoute[routeKey][row.code].freq = 2;
            } else {
                const lat = m.lat, lng = m.lng;
                if (m.lat === undefined || isNaN(lat) || isNaN(lng)) return; // ไม่มีพิกัดใน Master ข้ามร้านนี้
                byRoute[routeKey][row.code] = {
                    id: row.code, code: row.code,
                    name: row.name || m.name || ('Store_' + row.code),
                    lat, lng, freq: 1, days: aDay ? [aDay] : [], seqs: {}, selected: false,
                    salesCode: routeKey,
                    shopType: row.shopType || m.shopType || '',
                    subDistrict: m.subDistrict || '', district: m.district || '', province: m.province || '',
                    marketName: row.marketName || '', cy: row.cy || '',
                    dayOriginal: !isNaN(row.dayNum) ? String(row.dayNum) : '',
                };
            }
        });

        // ร้านที่มีแค่ใน Master (Active + มีรหัสเซลล์ + มีพิกัด) แต่ไม่เคยอยู่ใน Detail เลย
        Object.entries(masterByCode).forEach(([code, m]) => {
            if (detailCodes.has(code)) return;
            if (m.status !== 'Active') return;
            if (!m.salesCode) return;
            if (isNaN(m.lat) || isNaN(m.lng)) return;
            const routeKey = m.salesCode;
            if (!byRoute[routeKey]) byRoute[routeKey] = {};
            byRoute[routeKey][code] = {
                id: code, code, name: m.name || ('Store_' + code),
                lat: m.lat, lng: m.lng, freq: 1, days: [], seqs: {}, selected: false,
                salesCode: routeKey, shopType: m.shopType || '',
                subDistrict: m.subDistrict || '', district: m.district || '', province: m.province || '',
                marketName: '', cy: '', dayOriginal: '',
            };
        });

        return byRoute;
    },

    // ✅ ขั้นตอนสุดท้ายที่ bulkImport และ importMasterDetail ใช้ร่วมกัน: เอา byRoute
    // { routeKey: { customerCode: store } } ที่ parse เสร็จแล้วมา merge เข้า State.db.routes
    // (ร้านเดิมอัปเดต/reactivate, ร้านใหม่เพิ่ม, ร้านที่หายไปเปิด popup ให้เลือกพัก/ลบ) แล้วบันทึก
    // ทุกสายที่เปลี่ยนแปลงลง Firestore — toastLabel ใช้แค่ปรับข้อความ toast ตอนจบให้ตรงกับ
    // ฟีเจอร์ที่เรียกมา (เช่น "Bulk Import" หรือ "นำเข้า Master + RoutePlan")
    _commitByRouteImport: async (byRoute, toastLabel) => {
        const routeKeys = Object.keys(byRoute);
        if (routeKeys.length === 0) {
            UI.hideLoader();
            UI.showErrorToast('⚠️ ไม่พบข้อมูลที่นำเข้าได้ — เช็คว่าร้านมีพิกัด/รหัสเซลล์ครบไหม');
            return;
        }

        let totalNew = 0, totalReactivated = 0;
        const savedRoutes = [];
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
                    // ✅ FIX: เดิมใช้ inc.days || s.days — แต่ [] (array ว่าง) เป็น truthy ใน JS
                    // ทำให้ไฟล์ที่ไม่มีข้อมูลวัน/Cycle Name ของร้านนั้น (aDay ว่าง) เขียนทับ
                    // ตารางวันจริงเดิมด้วยค่าว่างไปเลยโดยไม่ตั้งใจ — ต้องเช็ค length ก่อน
                    days:       (inc.days && inc.days.length > 0) ? inc.days : s.days,
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
            FileManager._autoFillMarketNames(State.db.routes[routeKey]);
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
                // ✅ BUGFIX (2026-08-29): merge:true — ไม่งั้น calendarOverride ของสายนั้น
                // จะหายไปเงียบๆ ทุกครั้งที่ bulk import ทับ (ดู comment เดียวกันใน admin-data.js)
                // ✅ NEW: bulk import ทับร้านในสาย = รีเซ็ตสถานะ "ยืนยันรับสายวิ่ง" ด้วย
                await App.planRoutesCol(App._currentPlanYM).doc(_n).set({
                    stores: State.db.routes[_n] || [],
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                }, { merge: true });
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
            let msg = `✅ ${toastLabel} เสร็จ! ${routeKeys.length} สาย | เพิ่มใหม่ ${totalNew} ร้าน`;
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
    },

    // ✅ นำเข้า Master + RoutePlan Detail พร้อมกัน — ใช้ตอนตั้งศูนย์ใหม่ หรือจัดสายทั้งชุดใหม่
    importMasterDetail: (masterFile, detailFile) => {
        if (!masterFile || !detailFile) return UI.showErrorToast('⚠️ กรุณาเลือกไฟล์ให้ครบทั้ง 2 ไฟล์ (Customer Master และ RoutePlan Detail)');
        if (masterFile.size > 20 * 1024 * 1024 || detailFile.size > 20 * 1024 * 1024)
            return UI.showErrorToast('⚠️ มีไฟล์ใหญ่เกิน 20MB');

        UI.showLoader('📄 กำลังอ่านไฟล์ทั้ง 2 ไฟล์...', 'รอสักครู่');

        const readAsRows = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }));
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
            reader.readAsArrayBuffer(file);
        });

        Promise.all([readAsRows(masterFile), readAsRows(detailFile)])
            .then(async ([masterRows, detailRows]) => {
                try {
                    const masterByCode = FileManager._parseSapCustomerMaster(masterRows);
                    const detailList   = FileManager._parseSapRoutePlanDetail(detailRows);
                    if (!masterByCode) { UI.hideLoader(); return UI.showErrorToast('⚠️ ไม่พบคอลัมน์ "Customer Code" ในไฟล์ Master — เลือกไฟล์ถูกไหมครับ?'); }
                    if (!detailList)   { UI.hideLoader(); return UI.showErrorToast('⚠️ ไม่พบคอลัมน์ "Customer Code" ในไฟล์ RoutePlan Detail — เลือกไฟล์ถูกไหมครับ?'); }

                    const byRoute = FileManager._buildByRouteFromMasterDetail(masterByCode, detailList);
                    await FileManager._commitByRouteImport(byRoute, 'นำเข้า Master + RoutePlan');
                } catch (err) {
                    UI.hideLoader();
                    console.error('importMasterDetail error:', err);
                    UI.showErrorToast('❌ นำเข้าไม่สำเร็จ: ' + err.message);
                }
            })
            .catch(err => { UI.hideLoader(); UI.showErrorToast('❌ ' + err.message); });
    },

    // ✅ อัปเดตจากไฟล์ Customer Master เพียงไฟล์เดียว — ใช้ตอนมีร้านใหม่เพิ่มเข้ามา หรือแก้ไข
    // ข้อมูลร้านเดิม (เช่น เปลี่ยนชื่อร้าน/ย้ายเซลล์) โดย "ไม่แตะ" วัน/ชื่อตลาด/ลำดับที่จัดไว้แล้ว
    // เพราะไฟล์ Master ไม่มีข้อมูลพวกนี้อยู่แล้ว — ต่างจาก bulkImport/importMasterDetail ที่เป็น
    // การ "แทนที่ทั้งชุด" ตัวนี้เป็นการ "แก้เฉพาะจุด" ร้านเดิมยังคงตารางวันเดิมไว้ครบ
    importMasterOnly: (file) => {
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) return UI.showErrorToast('⚠️ ไฟล์ใหญ่เกิน 20MB');

        UI.showLoader('📄 กำลังอ่านไฟล์ Master...', 'รอสักครู่');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
                const masterByCode = FileManager._parseSapCustomerMaster(rows);
                if (!masterByCode) { UI.hideLoader(); return UI.showErrorToast('⚠️ ไม่พบคอลัมน์ "Customer Code" ในไฟล์ — ตรวจสอบว่าเป็นไฟล์ Customer Master จริงไหมครับ'); }

                // ทำ index ร้านที่มีอยู่แล้วทุกสายในแผนปัจจุบัน: id → {routeKey, i}
                const existingIndex = {};
                Object.entries(State.db.routes).forEach(([routeKey, stores]) => {
                    (stores || []).forEach((s, i) => { existingIndex[s.id] = { routeKey, i }; });
                });

                let updated = 0, moved = 0, added = 0;
                const touchedRoutes = new Set();

                Object.entries(masterByCode).forEach(([code, m]) => {
                    if (m.status !== 'Active') return;
                    if (!m.salesCode) return;
                    if (isNaN(m.lat) || isNaN(m.lng)) return;

                    const found = existingIndex[code];
                    if (found) {
                        const store = State.db.routes[found.routeKey][found.i];
                        // อัปเดตเฉพาะข้อมูลจาก Master — ห้ามแตะ days/seqs/marketName/cy/dayOriginal เดิม
                        store.name        = m.name || store.name;
                        store.lat         = m.lat;
                        store.lng         = m.lng;
                        store.subDistrict = m.subDistrict || store.subDistrict;
                        store.district    = m.district    || store.district;
                        store.province    = m.province    || store.province;
                        store.shopType    = m.shopType    || store.shopType;
                        store.inactive    = false;
                        touchedRoutes.add(found.routeKey);

                        if (m.salesCode !== found.routeKey) {
                            // ✅ ร้านย้ายเซลล์ — ย้ายไปสายใหม่ แต่วัน/ชื่อตลาด/ลำดับเดิมติดไปด้วยทั้งหมด
                            State.db.routes[found.routeKey].splice(found.i, 1);
                            if (!State.db.routes[m.salesCode]) State.db.routes[m.salesCode] = [];
                            store.salesCode = m.salesCode;
                            State.db.routes[m.salesCode].push(store);
                            touchedRoutes.add(m.salesCode);
                            moved++;
                        }
                        updated++;
                    } else {
                        // ร้านใหม่ที่ไม่เคยมีในระบบ — เพิ่มเข้าไปแบบยังไม่มีวัน รอ AI Route Builder/จัดมือ
                        if (!State.db.routes[m.salesCode]) State.db.routes[m.salesCode] = [];
                        State.db.routes[m.salesCode].push({
                            id: code, code, name: m.name || ('Store_' + code),
                            lat: m.lat, lng: m.lng, freq: 1, days: [], seqs: {}, selected: false,
                            salesCode: m.salesCode, shopType: m.shopType || '',
                            subDistrict: m.subDistrict || '', district: m.district || '', province: m.province || '',
                            marketName: '', cy: '', dayOriginal: '',
                        });
                        touchedRoutes.add(m.salesCode);
                        added++;
                    }
                });

                if (touchedRoutes.size === 0) {
                    UI.hideLoader();
                    return UI.showErrorToast('⚠️ ไม่พบร้านที่อัปเดตได้ (เช็คคอลัมน์ Salesman Code/พิกัด/สถานะ Active ในไฟล์)');
                }

                const routeArr = [...touchedRoutes];
                for (let i = 0; i < routeArr.length; i++) {
                    const rk = routeArr[i];
                    UI.showLoader(`💾 กำลังบันทึก... (${i + 1}/${routeArr.length} สาย)`, `สาย ${rk}`);
                    await App.planRoutesCol(App._currentPlanYM).doc(rk).set({ stores: State.db.routes[rk] || [] }, { merge: true });
                }
                const routeList = Object.keys(State.db.routes).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
                await App.planRef(App._currentPlanYM).set({ routeList }, { merge: true });

                State.stores = State.db.routes[State.localActiveRoute] || [];
                UI.hideLoader();
                App.sync();
                UI.showSaveToast(`✅ อัปเดตจาก Master เสร็จ! แก้ไขข้อมูล ${updated} ร้าน (ย้ายสาย ${moved} ร้าน) | เพิ่มร้านใหม่ ${added} ร้าน`);
            } catch (err) {
                UI.hideLoader();
                console.error('importMasterOnly error:', err);
                UI.showErrorToast('❌ อัปเดตไม่สำเร็จ: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    },

    // ══════════════════════════════════════════════════════════════════
    // ✅ NEW: นำเข้าจากไฟล์ "Sales Route" ไฟล์เดียว — คนละ schema กับ Customer
    // Master + RoutePlan Detail (บาง Sub-center ส่งออกมาเป็นไฟล์เดียวรวมทุกอย่าง
    // แทนที่จะแยก 2 ไฟล์) หัวคอลัมน์: "Sales Code","ชื่อตลาด","CYCodeNew",
    // "Customer Code","Customer Name","Day","Cycle name","Province","Latitude","Longitude"
    // หมายเหตุ: คอลัมน์ "Day" ในไฟล์นี้คือวันที่ปฏิทินจริงของรอบนั้น (Excel serial) ไม่ใช่เลขรอบ
    // — ไม่ใช้เลย ใช้ "Cycle name" (เช่น "D01") แกะเลขรอบแทนเหมือน _parseSapRoutePlanDetail
    // ไม่มีคอลัมน์ตำบล/อำเภอในไฟล์นี้ เก็บได้แค่ province ส่วน "ชื่อตลาด" มีมาให้ครบทุกแถวอยู่แล้ว
    // ใช้ตรงๆ ไม่ต้อง generate ใหม่
    // ══════════════════════════════════════════════════════════════════
    _parseSalesRouteFile: (rows) => {
        const hIdx = FileManager._findHeaderRowIndex(rows, 'Customer Code');
        if (hIdx === -1) return null;
        const h = rows[hIdx];
        const idx = (name) => h.indexOf(name);
        const byRoute = {};
        for (let r = hIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row) continue;
            const code = row[idx('Customer Code')] ? String(row[idx('Customer Code')]).trim() : '';
            if (!code) continue;
            const routeKey = row[idx('Sales Code')] ? String(row[idx('Sales Code')]).trim() : '';
            if (!routeKey) continue;
            const lat = parseFloat(String(row[idx('Latitude')]  || '').replace(/[^0-9.-]/g, ''));
            const lng = parseFloat(String(row[idx('Longitude')] || '').replace(/[^0-9.-]/g, ''));
            if (isNaN(lat) || isNaN(lng)) continue;
            const cycleName = row[idx('Cycle name')] ? String(row[idx('Cycle name')]).trim() : '';
            const dMatch = cycleName.match(/D(\d+)/i);
            if (!dMatch) continue; // ไม่รู้ว่าเป็นวันไหน ข้ามแถวนี้ไปเลย
            const aDay = 'Day ' + parseInt(dMatch[1]);

            if (!byRoute[routeKey]) byRoute[routeKey] = {};
            if (byRoute[routeKey][code]) {
                // ร้านเดิมในกลุ่มนี้แล้ว — ถ้าเป็นวันใหม่ (ยังไม่มีในลิสต์) คือร้าน F2 (เยี่ยม 2 รอบ)
                // ถ้าเป็นวันเดิมซ้ำ คือแถวซ้ำเป๊ะในไฟล์ต้นทาง ข้ามไปเฉยๆ ไม่ต้องทำอะไรเพิ่ม
                const existing = byRoute[routeKey][code];
                if (!existing.days.includes(aDay)) {
                    existing.days.push(aDay);
                    existing.freq = 2;
                }
            } else {
                byRoute[routeKey][code] = {
                    id: code, code,
                    name: row[idx('Customer Name')] ? String(row[idx('Customer Name')]).trim() : ('Store_' + code),
                    lat, lng, freq: 1, days: [aDay], seqs: {}, selected: false,
                    salesCode: routeKey, shopType: '',
                    subDistrict: '', district: '',
                    province: row[idx('Province')] ? String(row[idx('Province')]).trim() : '',
                    marketName: row[idx('ชื่อตลาด')] ? String(row[idx('ชื่อตลาด')]).trim() : '',
                    cy: row[idx('CYCodeNew')] ? String(row[idx('CYCodeNew')]).trim() : '',
                    dayOriginal: cycleName,
                };
            }
        }
        return byRoute;
    },

    importSalesRouteFile: (file) => {
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) return UI.showErrorToast('⚠️ ไฟล์ใหญ่เกิน 20MB');

        UI.showLoader('📄 กำลังอ่านไฟล์...', file.name);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
                const byRoute = FileManager._parseSalesRouteFile(rows);
                if (!byRoute) { UI.hideLoader(); return UI.showErrorToast('⚠️ ไม่พบคอลัมน์ "Customer Code" ในไฟล์ — เลือกไฟล์ถูกไหมครับ?'); }
                await FileManager._commitByRouteImport(byRoute, 'นำเข้าไฟล์ Sales Route');
            } catch (err) {
                UI.hideLoader();
                console.error('importSalesRouteFile error:', err);
                UI.showErrorToast('❌ นำเข้าไม่สำเร็จ: ' + err.message);
            }
        };
        reader.onerror = () => { UI.hideLoader(); UI.showErrorToast('❌ อ่านไฟล์ไม่สำเร็จ'); };
        reader.readAsArrayBuffer(file);
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
                    marketNameCol=-1, cyCol=-1, cycleNameCol=-1;

                for (let i = 0; i < headers.length; i++) {
                    const h = String(headers[i]).toLowerCase();
                    if      (h.includes('รหัส') || h.includes('customer code') || h.includes('id'))  idCol = i;
                    // ✅ FIX: ต้องเช็คก่อน nameCol เสมอ เพราะ "Cycle Name" มีคำว่า "name" ซ้อนอยู่
                    // ถ้าเช็ค nameCol ก่อน จะโดนตีความเป็นคอลัมน์ชื่อร้านไปเลย ไม่มีทางถึง cycleNameCol
                    // (บั๊กแบบเดียวกับที่เคยเจอ "ชื่อ" ซ้อนใน "ชื่อตลาด" มาก่อน — ดู bugfix-log.md 2026-05-06)
                    else if (h.includes('cycle'))                                                    cycleNameCol = i;
                    else if ((h.includes('ชื่อ') && !h.includes('ตลาด')) || h.includes('name'))      nameCol = i;
                    else if (h.includes('lat') || h.includes('ละติจูด'))                             latCol = i;
                    else if (h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด'))       lngCol = i;
                    else if (h.includes('freq') || h.includes('ความถี่') || h.includes('f2'))        freqCol = i;
                    // ✅ FIX (bug scan): ย้ายการเช็ค exact 'สายวิ่ง'/'route' มาก่อน dayCol
                    // เดิม dayCol เช็ค h.includes('สายวิ่ง') ดักไปก่อน ทำให้ column ชื่อ "สายวิ่ง"
                    // ไม่เคยเข้า salesCodeCol เลย (จับสายผิด) — ตอนนี้ exact match ชนะ substring
                    else if (h === 'route' || h === 'สายวิ่ง')                                       salesCodeCol = i;
                    else if (h.includes('สายวิ่ง') || h.includes('day'))                             dayCol = i;
                    else if (h.includes('คิว') || h.includes('seq') || h.includes('ลำดับ') || h.includes('order')) seqCol = i;
                    else if ((h.includes('salescode') || h.includes('รหัสเซลล์') || h === 'sales') && salesCodeCol === -1) salesCodeCol = i;
                    else if (h.includes('sales') && salesCodeCol === -1)                             salesCodeCol = i;
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

                // ✅ NEW: ไม่มีคอลัมน์ "Cycle Name" — ต้องหยุดถามยืนยันก่อน เพราะการเรียงจาก
                // คอลัมน์ Day แทนเป็นแค่การเดา (Day อาจไม่ใช่ลำดับตลาดที่ตั้งใจจริงเสมอไป)
                if (cycleNameCol === -1) {
                    UI.hideLoader();
                    const proceed = await new Promise(resolve => {
                        UI.showConfirm(
                            '⚠️ ไม่พบคอลัมน์ "Cycle Name" ในไฟล์นี้\n\n' +
                            'ระบบจะเรียงลำดับ D01, D02, ... จากคอลัมน์ Day ที่มีอยู่แทน (เรียงจากน้อยไปมาก) ' +
                            'ซึ่งอาจไม่ตรงกับลำดับตลาดที่ตั้งใจจริงเสมอไป\n\n' +
                            'ต้องการนำเข้าต่อโดยใช้วิธีนี้หรือไม่?',
                            () => resolve(true),
                            () => resolve(false)
                        );
                    });
                    if (!proceed) return;
                    UI.showLoader('📦 กำลังนำเข้าข้อมูล...', 'รอสักครู่');
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
                    // ✅ NEW: ถ้าไฟล์มีคอลัมน์ "Cycle Name" ให้ใช้ค่านี้เป็นตัวกำหนดลำดับ D0N แทน
                    // (เช่น 1 = D01) แม่นยำกว่าคอลัมน์ Day เพราะตั้งใจให้เป็นลำดับตลาดโดยตรง
                    // ถ้าไฟล์ไม่มีคอลัมน์นี้เลย ใช้ dayNum เดิมไปก่อน แล้วจะ normalize เรียงลำดับ
                    // ใหม่เป็น D01, D02, ... ทีหลัง (ดูบล็อกหลัง loop นี้)
                    const rawCycle = (cycleNameCol !== -1 && row[cycleNameCol]) ? String(row[cycleNameCol]).trim() : '';
                    const cycleNum = rawCycle ? parseInt(rawCycle.replace(/[^0-9]/g, '')) : NaN;
                    const seqNum   = (cycleNameCol !== -1 && !isNaN(cycleNum)) ? cycleNum : dayNum;
                    const aDay   = !isNaN(seqNum) ? 'Day ' + seqNum : '';
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
                            dayOriginal: cycleNameCol !== -1 ? rawCycle : rawDay,
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

                // ✅ NEW: ไฟล์ไม่มีคอลัมน์ "Cycle Name" เลย — เรียงเลข Day ที่มีจริงในแต่ละสาย
                // จากน้อยไปมาก แล้วแทนที่เป็นลำดับต่อเนื่อง D01, D02, D03... (อุดช่องว่าง เช่น
                // มีแค่ Day 1, 5, 10 ในไฟล์ → กลายเป็น D01, D02, D03 ตามลำดับ) ทำแยกต่อสาย เพราะ
                // แต่ละสายมี cycle ของตัวเอง ไม่เกี่ยวกัน
                if (cycleNameCol === -1) {
                    routeKeys.forEach(routeKey => {
                        const stores = Object.values(byRoute[routeKey]);
                        const usedNums = new Set();
                        stores.forEach(s => s.days.forEach(d => {
                            const n = parseInt(String(d).replace('Day ', ''));
                            if (!isNaN(n)) usedNums.add(n);
                        }));
                        const sorted  = Array.from(usedNums).sort((a, b) => a - b);
                        const rankMap = {};
                        sorted.forEach((n, idx) => { rankMap[n] = idx + 1; });

                        stores.forEach(s => {
                            const newDays = [];
                            const newSeqs = {};
                            s.days.forEach(d => {
                                const n = parseInt(String(d).replace('Day ', ''));
                                const newLabel = (!isNaN(n) && rankMap[n]) ? ('Day ' + rankMap[n]) : d;
                                if (!newDays.includes(newLabel)) newDays.push(newLabel);
                                if (s.seqs[d] !== undefined) newSeqs[newLabel] = s.seqs[d];
                            });
                            s.days = newDays;
                            s.seqs = newSeqs;
                        });
                    });
                }

                // ─── Merge เข้า State.db.routes + บันทึก (ใช้ร่วมกับ importMasterDetail) ──
                await FileManager._commitByRouteImport(byRoute, 'Bulk Import');

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

// ==========================================
// 📈 Route Analysis + Sellout Upload (โหมด Local)
// ==========================================
// ไฟล์นี้สกัดมาจาก dashboard.js ของระบบเดิม:
//   • RouteAnalysis — ยกมาทั้งก้อน ไม่แก้
//   • SelloutUpload — ส่วนอัปโหลดไฟล์ยอดขายที่เคยฝังอยู่ใน Dashboard
// ส่วน Dashboard ที่เหลือ (~1,800 บรรทัด) ถูกตัดออกเพราะเวอร์ชันนี้ไม่มีหน้า Dashboard แล้ว
// ==========================================

const SelloutUpload = {
    _CHUNK_SIZE: 500,

    /** เปิดหน้าต่างเลือกไฟล์ (ปุ่มบนหน้าวิเคราะห์สายวิ่งเรียกใช้) */
    pick: () => {
        let inp = document.getElementById('sellout-file-input');
        if (!inp) {
            inp = document.createElement('input');
            inp.type = 'file'; inp.id = 'sellout-file-input'; inp.accept = '.xlsx,.xls';
            inp.className = 'hidden';
            inp.addEventListener('change', SelloutUpload._onFileUpload);
            document.body.appendChild(inp);
        }
        inp.click();
    },

    _toast: (msg, isError = false) => {
        if (typeof UI !== 'undefined' && UI.showSaveToast) {
            isError ? UI.showErrorToast(msg) : UI.showSaveToast(msg);
        } else { alert(msg); }
    },
    _showUploadBar: (label, pct) => {
        if (typeof UI !== 'undefined' && UI.showLoader) UI.showLoader('⬆️ อัปโหลดยอดขาย', `${label} (${pct}%)`);
    },
    _hideUploadBar: () => { if (typeof UI !== 'undefined' && UI.hideLoader) UI.hideLoader(); },

    _detectYM: (filename) => {
        // Try patterns: April2026, 2026-04, 2026_04, Apr2026, etc.
        const thMonths = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
        const engPattern = filename.match(/([A-Za-z]+)(\d{4})/);
        if (engPattern) {
            const mon = thMonths[engPattern[1].toLowerCase().slice(0,3)];
            if (mon) return `${engPattern[2]}_${mon}`;
        }
        const numPattern = filename.match(/(\d{4})[-_](\d{2})/);
        if (numPattern) return `${numPattern[1]}_${numPattern[2]}`;
        return null;
    },

    _normalizeRows: (raw) => {
        return raw
            .filter(r => r['Invoice  Status'] === 'Invoiced' || r['Invoice  Status'] === 'Credit Note')
            .map(r => ({
                // ─ Salesman ─
                sCode:          String(r['Salesman Code'] || '').trim().toUpperCase(),
                // ─ Customer ─
                custCode:       String(r['Customer Code'] || '').trim(),
                custName:       String(r['Customer Name'] || '').trim(),
                shopType:       String(r['Shop Type Desc'] || '').trim(),
                // ─ SO ─
                soStatus:       String(r['SO Status'] || '').trim(),
                soNet:          parseFloat(r['SO NET Amount']) || 0,
                soNum:          String(r['SO Number'] || '').trim(),
                // ─ Product ─
                prodCode:       String(r['SO Product Code'] || '').trim(),
                prodName:       String(r['SO Product Name'] || '').trim(),
                brandDesc:      String(r['Brand Description'] || '').trim(),
                carToEA:        parseFloat(r['CAR to EA']) || 0,
                // ─ Invoice ─
                invNum:         String(r['Invoice Number'] || '').trim(),
                invStatus:      String(r['Invoice  Status'] || '').trim(),
                gross:          parseFloat(r['Invoice  Gross Amount']) || 0,
                net:            parseFloat(r['Invoice Net Amount']) || 0,
                // ─ Delivery ─
                deliveryStatus: String(r['Delivery Status'] || '').trim(),
                qtyEA:          parseFloat(r['Delivery Total  QTY EA']) || 0,
                // ─ KPI / Bonus ─
                kpiDate:        r['KPI Date'] ? String(r['KPI Date']).slice(0, 10) : '',
                brandBonus:     parseFloat(r['Brand Bonus']) || 0,
                bbPoint:        parseFloat(r['BB Point']) || 0,
            }));
    },

    _saveToFirestore: async (ym, rows) => {
        // ✅ ใช้ centerId prefix เพื่อแยกข้อมูลต่างศูนย์ เช่น "402_2026_06"
        const cid     = (window.CENTER_ID || '').toUpperCase();
        const key     = cid ? `${cid}_${ym}` : ym;
        const metaRef = cloudDB.collection('sellout').doc(key);

        // ── Step 1: ลบ chunks เก่า + เขียน metadata ─────────────────────
        SelloutUpload._showUploadBar('เตรียมลบข้อมูลเดิม...', 5);
        const old = await metaRef.collection('chunks').get();
        if (old.size > 0) {
            // ลบ batch 400 ต่อครั้ง (Firestore limit 500)
            const DEL_BATCH = 400;
            for (let i = 0; i < old.docs.length; i += DEL_BATCH) {
                const b = cloudDB.batch();
                old.docs.slice(i, i + DEL_BATCH).forEach(d => b.delete(d.ref));
                await b.commit();
            }
        }
        await metaRef.set({
            totalRows: rows.length,
            centerId:  window.CENTER_ID || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            version: 1
        });

        // ── Step 2: เขียน chunks parallel 3 พร้อมกัน ───────────────────
        const CS    = SelloutUpload._CHUNK_SIZE;
        const total = Math.ceil(rows.length / CS);
        const PARA  = 3; // parallel writes ต่อรอบ

        // helper: เขียน 1 chunk พร้อม retry ถ้า resource-exhausted
        const writeChunk = async (i, retries = 3) => {
            const ref = metaRef.collection('chunks').doc(`chunk_${String(i).padStart(4,'0')}`);
            for (let attempt = 0; attempt < retries; attempt++) {
                try {
                    await ref.set({ index: i, rows: rows.slice(i * CS, (i+1) * CS) });
                    return;
                } catch(e) {
                    if (attempt < retries - 1 && (e.code === 'resource-exhausted' || e.message?.includes('exhausted'))) {
                        // หน่วง exponential backoff
                        await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
                    } else {
                        throw e;
                    }
                }
            }
        };

        for (let i = 0; i < total; i += PARA) {
            const batch = [];
            for (let j = i; j < Math.min(i + PARA, total); j++) batch.push(writeChunk(j));
            await Promise.all(batch);
            const pct = 15 + Math.round(((i + PARA) / total) * 80);
            SelloutUpload._showUploadBar(`บันทึก ${Math.min(i + PARA, total)}/${total} chunks`, Math.min(pct, 95));
        }
    },

        // ─── Targets ──────────────────────────────────────────────────────────

    _onFileUpload: async (evt) => {
        const file = evt.target.files[0];
        if (!file) return;
        evt.target.value = '';

        // Detect year_month from filename or ask
        let ym = SelloutUpload._detectYM(file.name);
        if (!ym) {
            // ใช้ UI input แทน prompt/alert
            const input = await new Promise(resolve => {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
                const box = document.createElement('div');
                box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;max-width:320px;width:90%;font-family:Prompt,sans-serif;';
                box.innerHTML = '<p style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">ระบุเดือน (เช่น 2026_04)</p>' +
                    '<input id="_ym-inp" type="text" placeholder="YYYY_MM" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;font-family:inherit;outline:none;margin-bottom:14px;">' +
                    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
                    '<button id="_ym-cancel" style="padding:7px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-size:13px;font-weight:600;">ยกเลิก</button>' +
                    '<button id="_ym-ok" style="padding:7px 16px;border-radius:8px;border:none;background:#4f46e5;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">ตกลง</button></div>';
                overlay.appendChild(box);
                document.body.appendChild(overlay);
                const inp = box.querySelector('#_ym-inp');
                inp.focus();
                const close = (val) => { document.body.removeChild(overlay); resolve(val); };
                box.querySelector('#_ym-cancel').onclick = () => close(null);
                box.querySelector('#_ym-ok').onclick = () => close(inp.value.trim());
                inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(inp.value.trim()); if (e.key === 'Escape') close(null); });
            });
            if (!input || !/^\d{4}_\d{2}$/.test(input)) {
                if (input) SelloutUpload._toast('⚠️ รูปแบบไม่ถูกต้อง ใช้ YYYY_MM', true);
                return;
            }
            ym = input;
        }

        const confirm = await new Promise(r => { if (window.confirm(`อัปโหลดข้อมูล Sellout เดือน ${ym} ?\n(ไฟล์เก่าจะถูกแทนที่)`)) r(true); else r(false); });
        if (!confirm) return;

        SelloutUpload._showUploadBar('กำลังอ่านไฟล์...', 5);

        try {
            const buf = await file.arrayBuffer();
            const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
            const ws  = wb.Sheets[wb.SheetNames[0]];
            const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

            SelloutUpload._showUploadBar('กำลังแปลงข้อมูล...', 20);

            const rows = SelloutUpload._normalizeRows(raw);
            if (rows.length === 0) { SelloutUpload._toast('⚠️ ไม่พบข้อมูลในไฟล์', true); return; }

            SelloutUpload._showUploadBar(`บันทึก ${rows.length} แถว...`, 40);

            await SelloutUpload._saveToFirestore(ym, rows);



            // โหมด local: ให้หน้าวิเคราะห์สายวิ่งโหลดใหม่ทันที
            if (typeof RouteAnalysis !== 'undefined') {
                RouteAnalysis._monthCache = {};
                RouteAnalysis.loadOverview(true);
            }
            SelloutUpload._toast(`✅ อัปโหลดยอดขาย ${ym} แล้ว ${rows.length.toLocaleString()} แถว`);
            SelloutUpload._hideUploadBar();

        } catch (e) {
            SelloutUpload._hideUploadBar();
            SelloutUpload._toast('❌ อัปโหลดไม่สำเร็จ: ' + e.message, true);
            console.error(e);
        }
    },
};

// ==========================================
// 📈 RouteAnalysis — ยกมาจาก dashboard.js ทั้งก้อน
// ==========================================
const RouteAnalysis = {
    _monthsBack:  6,
    _monthCache:  {},   // { ym: {ym, routeList, routeStores, salesByRoute, rowsByRoute, cycleDays} | null }
    _view:        'overview', // 'overview' | 'daymatrix'
    _activeYM:    '',

    init: () => {
        RouteAnalysis._renderShell();
        RouteAnalysis.loadOverview();
    },

    _renderShell: () => {
        const el = document.getElementById('page-routeanalysis');
        if (!el) return;
        el.innerHTML = `
        <div class="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-5 shrink-0 shadow-sm">
            <div>
                <h1 class="text-base font-black text-gray-900">📈 วิเคราะห์สายวิ่ง</h1>
                <p class="text-[11px] text-gray-400">ยอดขาย + จำนวนร้านต่อสาย ย้อนหลังหลายเดือน</p>
            </div>
            <div id="ra-controls" class="flex items-center gap-2"></div>
        </div>
        <div class="flex-1 overflow-y-auto p-5" id="ra-body">
            <div style="text-align:center;padding:60px;color:#9ca3af;font-size:13px;">⏳ กำลังโหลดข้อมูล...</div>
        </div>`;
        RouteAnalysis._renderControls();
    },

    _renderControls: () => {
        const el = document.getElementById('ra-controls');
        if (!el) return;
        if (RouteAnalysis._view === 'overview') {
            el.innerHTML = `
                <label class="text-xs font-bold text-gray-500">ย้อนหลัง</label>
                <select id="ra-months-back" onchange="RouteAnalysis._onMonthsBackChange(this.value)"
                    class="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none">
                    <option value="3">3 เดือน</option>
                    <option value="6">6 เดือน</option>
                    <option value="12">12 เดือน</option>
                </select>
                <button onclick="RouteAnalysis.loadOverview(true)"
                    class="bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-100 transition">🔄 รีเฟรช</button>`;
            const sel = document.getElementById('ra-months-back');
            if (sel) sel.value = String(RouteAnalysis._monthsBack);
        } else {
            el.innerHTML = `
                <button onclick="RouteAnalysis.backToOverview()"
                    class="bg-gray-100 text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-200 transition">← กลับภาพรวม</button>`;
        }
    },

    _onMonthsBackChange: (v) => {
        RouteAnalysis._monthsBack = parseInt(v) || 6;
        RouteAnalysis.loadOverview();
    },

    // ─── สร้าง list เดือนย้อนหลัง n เดือน (รวมเดือนปัจจุบัน) ────────────────
    _getRecentMonths: (n) => {
        const months = [];
        const d = new Date();
        for (let i = 0; i < n; i++) {
            const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
            months.push(`${dt.getFullYear()}_${String(dt.getMonth()+1).padStart(2,'0')}`);
        }
        return months.reverse(); // เก่า → ใหม่
    },

    // ─── โหลด sellout เดือนหนึ่ง รองรับ 2 format ─────────────────────────
    _loadSelloutMonth: async (ym) => {
        const cid = (window.CENTER_ID || '').toUpperCase();
        const candidates = cid ? [`${cid}_${ym}`, ym] : [ym];
        for (const docId of candidates) {
            try {
                const chunks = await cloudDB.collection('sellout').doc(docId).collection('chunks').get();
                if (!chunks.empty) {
                    let rows = [];
                    chunks.docs.sort((a,b) => (a.data().index||0) - (b.data().index||0))
                        .forEach(d => { rows = rows.concat(d.data().rows || []); });
                    return rows;
                }
            } catch(e) { /* ลอง candidate ถัดไป */ }
        }
        return [];
    },

    // ─── โหลดข้อมูลของเดือนหนึ่ง (แผน + ยอดขาย) — cache ไว้ ─────────────────
    _loadMonthData: async (ym) => {
        if (Object.prototype.hasOwnProperty.call(RouteAnalysis._monthCache, ym))
            return RouteAnalysis._monthCache[ym];
        try {
            const planSnap = await App.planRef(ym).get();
            if (!planSnap.exists) { RouteAnalysis._monthCache[ym] = null; return null; }
            const meta      = planSnap.data();
            const routeList = meta.routeList || [];
            const cycleDays = meta.cycleDays || 24;

            // โหลด stores ของทุกสาย (ตามแผนจริงของเดือนนี้) พร้อมกัน
            const routeStores = {};
            await Promise.all(routeList.map(async name => {
                try {
                    const rd = await App.planRoutesCol(ym).doc(name).get();
                    routeStores[name] = rd.exists ? (rd.data().stores || []) : [];
                } catch(e) { routeStores[name] = []; }
            }));

            // custCode → route ของเดือนนี้ (ยึดแผนจริงของเดือนนั้น ไม่ใช่ปัจจุบัน)
            const custToRoute = {};
            Object.entries(routeStores).forEach(([route, stores]) => {
                stores.forEach(s => { custToRoute[String(s.id)] = route; });
            });

            // โหลดยอดขายเดือนนี้ + จัดกลุ่มตามสาย
            const rows = await RouteAnalysis._loadSelloutMonth(ym);
            const salesByRoute = {};
            const rowsByRoute  = {};
            routeList.forEach(r => { salesByRoute[r] = 0; rowsByRoute[r] = []; });
            rows.forEach(r => {
                const route = custToRoute[String(r.custCode || '').trim()];
                if (!route || !(route in salesByRoute)) return;
                salesByRoute[route] += (r.net || r.gross || 0);
                rowsByRoute[route].push(r);
            });

            const data = { ym, routeList, routeStores, salesByRoute, rowsByRoute, cycleDays };
            RouteAnalysis._monthCache[ym] = data;
            return data;
        } catch (e) {
            console.warn('RouteAnalysis._loadMonthData:', ym, e);
            RouteAnalysis._monthCache[ym] = null;
            return null;
        }
    },

    // ─── หน้า 1: ภาพรวม สาย × เดือน ─────────────────────────────────────
    loadOverview: async (force = false) => {
        RouteAnalysis._view = 'overview';
        RouteAnalysis._renderControls();
        const body = document.getElementById('ra-body');
        if (body) body.innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af;font-size:13px;">⏳ กำลังโหลดข้อมูล...</div>';

        if (force) RouteAnalysis._monthCache = {}; // ✅ รีเฟรช = ล้าง cache ทั้งหมด

        const months = RouteAnalysis._getRecentMonths(RouteAnalysis._monthsBack);
        // ✅ PERF: โหลดทุกเดือนพร้อมกัน
        const results = await Promise.all(months.map(ym => RouteAnalysis._loadMonthData(ym)));

        const allRoutes = new Set();
        results.forEach(d => { if (d) Object.keys(d.salesByRoute).forEach(r => allRoutes.add(r)); });
        const routes = [...allRoutes].sort((a,b) => a.localeCompare(b,'th',{numeric:true}));

        RouteAnalysis._renderOverviewTable(months, results, routes);
    },

    _renderOverviewTable: (months, results, routes) => {
        const body = document.getElementById('ra-body');
        if (!body) return;

        if (!routes.length) {
            body.innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af;font-size:13px;">📭 ไม่พบข้อมูลแผน/ยอดขายในช่วงที่เลือก</div>';
            return;
        }

        const monthLabels = months.map(ym => {
            const [y, m] = ym.split('_');
            return new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { year: '2-digit', month: 'short' });
        });

        const thead = `
            <tr class="bg-gray-50 border-b border-gray-200">
                <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 sticky left-0 bg-gray-50 z-10">สาย</th>
                ${months.map((ym,i) => `<th class="px-3 py-2.5 text-center text-xs font-bold text-gray-600">${monthLabels[i]}</th>`).join('')}
            </tr>`;

        const tbody = routes.map(route => {
            const cells = months.map((ym, i) => {
                const d = results[i];
                if (!d || !(route in d.salesByRoute)) {
                    // ✅ ไม่มีแผนสายของเดือนนี้เลย — กู้คืนไม่ได้ (ไม่ใช่บั๊ก แค่ไม่มีข้อมูลย้อนหลัง)
                    return `<td class="px-3 py-3 text-center text-xs text-gray-300" title="ไม่มีแผนจัดสายของเดือนนี้ในระบบ">—</td>`;
                }
                const sales = d.salesByRoute[route] || 0;
                const storeCount = (d.routeStores[route] || []).length;
                // ✅ FIX: แยกกรณี "มีแผนแต่ 0 ร้าน" (ผิดปกติ ควรเช็ค) ออกจาก "—" (ไม่มีแผนเลย)
                // ด้วยสีเตือน + tooltip ให้แอดมินสังเกตเห็นง่ายว่าจุดนี้น่าจะมีปัญหา ไม่ใช่แค่ไม่มีข้อมูล
                const isEmptyPlan = storeCount === 0;
                return `
                <td onclick="RouteAnalysis.openMonth('${ym}')"
                    class="px-3 py-3 text-center cursor-pointer hover:bg-indigo-50 transition group"
                    ${isEmptyPlan ? 'title="⚠️ มีแผนเดือนนี้ แต่ไม่มีร้านในสาย — น่าจะผิดปกติ ลองเช็คแผนสายเดือนนี้"' : ''}>
                    <div class="text-xs font-black ${isEmptyPlan ? 'text-amber-600' : 'text-gray-800 group-hover:text-indigo-700'}">฿${Math.round(sales).toLocaleString()}</div>
                    <div class="text-[10px] mt-0.5 ${isEmptyPlan ? 'text-amber-500 font-bold' : 'text-gray-400'}">${isEmptyPlan ? '⚠️ 0 ร้านในแผน' : '🏪 ' + storeCount + ' ร้าน'}</div>
                </td>`;
            }).join('');
            return `
            <tr class="border-b border-gray-100 hover:bg-gray-50/50">
                <td class="px-3 py-3 text-xs font-bold text-gray-800 sticky left-0 bg-white">${route}</td>
                ${cells}
            </tr>`;
        }).join('');

        // แถวรวม
        const totalCells = months.map((ym, i) => {
            const d = results[i];
            if (!d) return `<td class="px-3 py-3 text-center text-xs text-gray-300">—</td>`;
            const total = routes.reduce((s, r) => s + (d.salesByRoute[r] || 0), 0);
            const totalStores = routes.reduce((s, r) => s + ((d.routeStores[r] || []).length), 0);
            return `
            <td class="px-3 py-3 text-center bg-gray-50">
                <div class="text-xs font-black text-emerald-700">฿${Math.round(total).toLocaleString()}</div>
                <div class="text-[10px] text-gray-400 mt-0.5">🏪 ${totalStores} ร้าน</div>
            </td>`;
        }).join('');

        body.innerHTML = `
            <p class="text-[11px] text-gray-400 mb-3">💡 คลิกที่ cell เดือนไหนก็ได้ เพื่อดูรายละเอียดแยกตาม Day ของเดือนนั้น</p>
            <div class="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
                <table class="w-full text-sm">
                    <thead>${thead}</thead>
                    <tbody>${tbody}</tbody>
                    <tfoot>
                        <tr class="border-t-2 border-gray-200">
                            <td class="px-3 py-3 text-xs font-black text-gray-700 sticky left-0 bg-gray-50">รวมทุกสาย</td>
                            ${totalCells}
                        </tr>
                    </tfoot>
                </table>
            </div>`;
    },

    // ─── หน้า 2: Drill-down Day × ทุกสาย ของเดือนที่เลือก ───────────────
    openMonth: async (ym) => {
        RouteAnalysis._view = 'daymatrix';
        RouteAnalysis._activeYM = ym;
        RouteAnalysis._renderControls();
        const body = document.getElementById('ra-body');
        if (body) body.innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af;font-size:13px;">⏳ กำลังคำนวณ...</div>';

        const data = await RouteAnalysis._loadMonthData(ym);
        if (!data) {
            if (body) body.innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af;font-size:13px;">📭 ไม่พบข้อมูลเดือนนี้</div>';
            return;
        }
        RouteAnalysis._renderDayMatrix(data);
    },

    backToOverview: () => RouteAnalysis.loadOverview(),

    _renderDayMatrix: (data) => {
        const body = document.getElementById('ra-body');
        if (!body) return;

        const { ym, routeList, routeStores, rowsByRoute, cycleDays } = data;
        const routes = [...routeList].sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
        const [y, m] = ym.split('_');
        const monthLabel = new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });

        // ── สร้าง matrix: route -> day -> { totalStores, soldStores, sales } ──
        const matrix = {};
        routes.forEach(route => {
            matrix[route] = {};
            const stores = routeStores[route] || [];
            const rows   = rowsByRoute[route] || [];
            // เตรียม sales ต่อ custCode ของสายนี้
            const salesByCust = {};
            rows.forEach(r => {
                const cc = String(r.custCode || '').trim();
                salesByCust[cc] = (salesByCust[cc] || 0) + (r.net || r.gross || 0);
            });
            for (let d = 1; d <= cycleDays; d++) {
                const label = `Day ${d}`;
                const storesInDay = stores.filter(s => s.days?.includes(label));
                const totalStores = storesInDay.length;
                let sales = 0, soldStores = 0;
                storesInDay.forEach(s => {
                    const v = salesByCust[String(s.id)] || 0;
                    if (v > 0) soldStores++;
                    sales += v;
                });
                matrix[route][label] = { totalStores, soldStores, sales };
            }
        });

        const thead = `
            <tr class="bg-gray-50 border-b border-gray-200">
                <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 sticky left-0 bg-gray-50 z-10">Day</th>
                ${routes.map(r => `<th class="px-3 py-2.5 text-center text-xs font-bold text-gray-600">${r}</th>`).join('')}
            </tr>`;

        const rowsHtml = [];
        for (let d = 1; d <= cycleDays; d++) {
            const label = `Day ${d}`;
            const cells = routes.map(route => {
                const c = matrix[route][label];
                if (!c || c.totalStores === 0) return `<td class="px-3 py-2.5 text-center text-xs text-gray-300">—</td>`;
                const pct = c.totalStores > 0 ? Math.round(c.soldStores / c.totalStores * 100) : 0;
                const color = pct >= 70 ? '#059669' : pct >= 40 ? '#d97706' : '#dc2626';
                return `
                <td class="px-3 py-2.5 text-center">
                    <div class="text-xs font-black text-gray-800">฿${Math.round(c.sales).toLocaleString()}</div>
                    <div class="text-[10px] font-bold mt-0.5" style="color:${color};">${c.soldStores}/${c.totalStores} ร้าน</div>
                </td>`;
            }).join('');
            rowsHtml.push(`
            <tr class="border-b border-gray-100 hover:bg-gray-50/50">
                <td class="px-3 py-2.5 text-xs font-bold text-gray-800 sticky left-0 bg-white">${label}</td>
                ${cells}
            </tr>`);
        }

        body.innerHTML = `
            <p class="text-sm font-black text-gray-800 mb-1">📅 ${monthLabel}</p>
            <p class="text-[11px] text-gray-400 mb-3">💰 ยอดขาย = ยอดรวมทั้งเดือนของร้านกลุ่มนั้น &nbsp;|&nbsp; 🏪 ตัวเลข = ร้านที่มียอด / ร้านทั้งหมดใน Day นั้น</p>
            <div class="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm max-h-[70vh] overflow-y-auto">
                <table class="w-full text-sm">
                    <thead class="sticky top-0 z-20">${thead}</thead>
                    <tbody>${rowsHtml.join('')}</tbody>
                </table>
            </div>`;
    },
};



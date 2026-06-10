// ==========================================
// 📊 Dashboard — Sellout Analytics
// v1.0 | Firebase Firestore | Role-Aware
// ==========================================

// ✅ DateUtil fallback — ถ้า app-config.js โหลดช้า
if (typeof DateUtil === 'undefined') {
    window.DateUtil = {
        ymToThai: (ym) => {
            if (!ym) return '';
            const [y, m] = ym.split('_');
            return new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { year:'numeric', month:'long' });
        },
        ymToThaiShort: (ym) => {
            if (!ym) return '';
            const [y, m] = ym.split('_');
            return new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { year:'numeric', month:'short' });
        },
        currentYM: () => {
            const d = new Date();
            return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
        },
    };
}

const Dashboard = {

    // ─── State ───────────────────────────────────────────────────────────
    _session: null,
    _currentYM: '',          // 'YYYY_MM'
    _rowCache: {},            // { 'CID_YYYY_MM': rows[] } cache สำหรับ campaign
    _amountMode: 'gross',     // 'gross' | 'net'
    _drillRoute: null,        // null = ศูนย์ทั้งหมด
    _drillShopType: null,     // null = ทุกประเภทร้าน
    _drillCategory: null,
    _drillBrand: null,
    _rows: [],                // flat filtered rows (current month)
    _allMonths: [],           // list of loaded YM keys
    _targets: {},             // { routeCode: amount }
    _CHUNK_SIZE: 500,


    // ─── SKU Whitelist — prodCode ที่นับใน SKU เฉลี่ย/ร้าน ────────────────
    _skuWhitelist: null,   // null = ใช้ทุก SKU, Set = กรองเฉพาะที่เลือก

    // โหลด whitelist จาก Firestore
    _loadSkuWhitelist: async () => {
        try {
            const centerId = window.CENTER_DOC || 'v1_main';
            const doc = await cloudDB.collection('appData').doc(centerId).get();
            const list = doc.exists ? (doc.data().skuWhitelist || null) : null;
            Dashboard._skuWhitelist = list ? new Set(list) : null;
        } catch(e) {
            Dashboard._skuWhitelist = null;
        }
    },

    // save whitelist ลง Firestore
    _saveSkuWhitelist: async (codes) => {
        const centerId = window.CENTER_DOC || 'v1_main';
        await cloudDB.collection('appData').doc(centerId).set(
            { skuWhitelist: codes },
            { merge: true }
        );
        Dashboard._skuWhitelist = codes.length ? new Set(codes) : null;
    },

    // Categories ที่ต้องแยกออก ไม่รวมยอดหลัก
    // ── ยกเว้น brand ที่ไม่นับในยอดหลัก ──────────────────────────────────
    EXCLUDED_BRANDS: new Set(['อื่นๆ', 'กระเช้าของขวัญ']),

    // ยอดขาย / SKU เฉลี่ยต่อร้าน แยก V-route และ C-route
    // outlet = custCode ที่มียอดในเดือน
    _calcOutletMetrics: (rows, useMainOnly = true) => {
        const filtered = useMainOnly
            ? rows.filter(r => !Dashboard.EXCLUDED_BRANDS.has(r.brandDesc))
            : rows;
        const wl = Dashboard._skuWhitelist; // null = ไม่กรอง
        const byOutlet = {}, byOutletV = {}, byOutletC = {};
        filtered.forEach(r => {
            const key = String(r.custCode || '').trim() || String(r.custName || '').trim();
            if (!key) return;
            const sku   = String(r.prodCode || '').trim();
            const amt   = Dashboard._amt(r);
            const sCode = String(r.sCode || '').toUpperCase();
            const rType = /C\d/.test(sCode) ? 'C' : /V\d/.test(sCode) ? 'V' : null;
            // กรอง SKU ตาม whitelist (ถ้ามี)
            const skuValid = sku && (!wl || wl.has(sku));
            [
                [byOutlet, true],
                [byOutletV, rType === 'V'],
                [byOutletC, rType === 'C'],
            ].forEach(([map, use]) => {
                if (!use) return;
                if (!map[key]) map[key] = { skus: new Set(), vol: 0 };
                if (skuValid) map[key].skus.add(sku);
                map[key].vol += amt;
            });
        });
        const calc = (map) => {
            const list = Object.values(map);
            const n = list.length;
            if (!n) return { outletCount: 0, avgSku: 0, avgVol: 0 };
            // สูตรใหม่: SKU ที่ขายได้ทั้งหมด ÷ ร้านที่มียอด (ตรงกับ report บ.)
            const totalSkus = list.reduce((s, o) => s + o.skus.size, 0);
            return {
                outletCount: n,
                avgSku: totalSkus / n,
                avgVol: list.reduce((s, o) => s + o.vol, 0) / n,
            };
        };
        return { ...calc(byOutlet), v: calc(byOutletV), c: calc(byOutletC) };
    },

    _fmtSku: (n) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    _fmtVol: (n) => Math.round(n || 0).toLocaleString('th-TH'),

    // ─── Init ─────────────────────────────────────────────────────────────
    init: () => {
        Dashboard._session = Auth.getSession();
        if (!Dashboard._session) return;

        const now = new Date();
        Dashboard._currentYM = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

        Dashboard._renderShell();
        // โหลด whitelist + campaign async
        Dashboard._loadSkuWhitelist();
        setTimeout(() => Dashboard._renderCampaignSection(), 1500);
        Dashboard._loadMonthList();
    },

    // ─── UI Shell ─────────────────────────────────────────────────────────
    _renderShell: () => {
        const container = document.getElementById('page-dashboard');
        if (!container) return;

        const isAdmin = Dashboard._session.role === 'admin' || Dashboard._session.role === 'supervisor';

        container.innerHTML = `
        <!-- Header: ชื่อระบบ + ศูนย์ -->
        <div class="h-12 bg-gray-900 text-white flex items-center justify-between px-3 md:px-4 shadow-md shrink-0 border-b-2 border-emerald-600 z-10">
            <div class="flex items-center gap-3">
                <button type="button" onclick="SidebarCtrl.toggle()" class="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white flex items-center justify-center transition shrink-0" title="เมนู">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>
                <span class="text-base font-black text-indigo-400 tracking-wide">Route<span class="text-white">Plan</span></span>
                <span id="header-center-label-db" class="text-xs text-gray-400 font-bold hidden sm:block"></span>
            </div>
            <span class="text-xs text-gray-500 font-bold">📊 Dashboard</span>
        </div>

        <!-- Filter bar -->
        <div class="bg-white border-b border-gray-200 px-3 py-2 flex flex-wrap items-center gap-2 shrink-0 shadow-sm z-[9]">
            <!-- Month selector -->
            <select id="db-month-select" onchange="Dashboard._onMonthChange(this.value)"
                class="bg-gray-50 border border-gray-200 text-gray-800 text-sm font-bold rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-emerald-400">
                <option value="">-- เลือกเดือน --</option>
            </select>

            <!-- Amount mode toggle -->
            <div class="flex bg-gray-100 rounded-lg border border-gray-200 overflow-hidden">
                <button id="db-btn-gross" onclick="Dashboard._setAmountMode('gross')"
                    class="px-3 py-1.5 text-xs font-bold transition bg-emerald-600 text-white">Gross</button>
                <button id="db-btn-net" onclick="Dashboard._setAmountMode('net')"
                    class="px-3 py-1.5 text-xs font-bold transition text-gray-500 hover:text-gray-800">Net</button>
            </div>

            <!-- Upload button (admin/supervisor only) -->
            ${isAdmin ? `
            <label class="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-sm">
                📂 อัปโหลด Sellout
                <input type="file" id="db-file-input" accept=".xlsx,.xls" class="hidden" onchange="Dashboard._onFileUpload(event)">
            </label>
            ` : ''}

            <div class="flex-1"></div>

            <!-- Breadcrumb / Reset -->
            <div id="db-breadcrumb" class="text-xs text-gray-400 font-medium hidden sm:flex items-center gap-1"></div>
            <button id="db-reset-btn" onclick="Dashboard._resetDrill()" class="hidden text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg font-bold transition">
                ↩ รีเซ็ต
            </button>
        </div>

        <!-- Upload progress bar -->
        <div id="db-upload-bar" class="hidden bg-indigo-900 text-white text-xs font-bold px-5 py-2 flex items-center gap-3 shrink-0">
            <div class="flex-1 bg-indigo-950 rounded-full h-2 overflow-hidden">
                <div id="db-upload-progress" class="bg-emerald-400 h-2 rounded-full transition-all" style="width:0%"></div>
            </div>
            <span id="db-upload-label">กำลังอัปโหลด...</span>
        </div>

        <!-- Main content area -->
        <div class="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-4" id="db-content">

            <!-- KPI Cards row -->
            <div id="db-kpi-row" class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3"></div>

            <!-- Active Campaign Coverage (โหลดจาก SkuDist) -->
            <div id="db-campaign-section" class="hidden"></div>

            <!-- Middle row: By-Route table + ShopType -->
            <div class="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <!-- Route table -->
                <div class="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden" id="db-route-panel">
                    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <span class="text-sm font-black text-gray-700">📋 รายสาย</span>
                        ${isAdmin ? `<button onclick="Dashboard._openTargetModal()" class="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-1 rounded-lg font-bold transition">🎯 ตั้ง Target</button>` : ''}
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm" id="db-route-table">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-3 py-2 text-left text-xs font-bold text-gray-500">สาย</th>
                                    <th class="px-3 py-2 text-right text-xs font-bold text-gray-500">ยอด</th>
                                    <th class="px-3 py-2 text-right text-xs font-bold text-gray-500">Target</th>
                                    <th class="px-3 py-2 text-right text-xs font-bold text-gray-500">%</th>
                                    <th class="px-3 py-2 text-right text-xs font-bold text-gray-500">SKU/ร้าน</th>
                                    <th class="px-3 py-2 text-right text-xs font-bold text-gray-500">ยอด/ร้าน V</th>
                                    <th class="px-3 py-2 text-right text-xs font-bold text-gray-500">ยอด/ร้าน C</th>
                                    <th class="px-3 py-2 text-center text-xs font-bold text-gray-500">ดู</th>
                                </tr>
                            </thead>
                            <tbody id="db-route-tbody">
                                <tr><td colspan="8" class="text-center py-8 text-gray-400 text-sm">เลือกเดือนก่อนครับ</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- ShopType bars -->
                <div class="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100" id="db-shoptype-panel">
                    <div class="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <span class="text-sm font-black text-gray-700">🏪 ประเภทร้าน</span>
                        <span class="text-xs text-gray-400" id="db-shoptype-hint">กดเพื่อกรอง</span>
                    </div>
                    <div class="p-4 space-y-2.5" id="db-shoptype-body">
                        <p class="text-center text-gray-400 text-xs py-4">ยังไม่มีข้อมูล</p>
                    </div>
                </div>
            </div>
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <span class="text-sm font-black text-gray-700">🏷️ Brand Breakdown</span>
                    <span class="text-xs text-gray-400">แยกตาม Brand</span>
                </div>
                <div class="p-4" id="db-category-body">
                    <p class="text-center text-gray-400 text-xs py-4">ยังไม่มีข้อมูล</p>
                </div>
            </div>



            <!-- Brand drill-down (shows when drillCategory is set) -->
            <div id="db-brand-panel" class="hidden bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
                <div class="px-4 py-3 border-b border-indigo-100 bg-indigo-50 flex items-center justify-between">
                    <span class="text-sm font-black text-indigo-700" id="db-brand-title">Brand</span>
                    <button onclick="Dashboard._drillCategory=null;Dashboard._drillBrand=null;Dashboard._render();" class="text-xs text-indigo-500 hover:text-indigo-800 font-bold">✕ ปิด</button>
                </div>
                <div class="p-4" id="db-brand-body"></div>
            </div>

            <!-- Product drill-down (shows when drillBrand is set) -->
            <div id="db-product-panel" class="hidden bg-white rounded-2xl shadow-sm border border-purple-100 overflow-hidden">
                <div class="px-4 py-3 border-b border-purple-100 bg-purple-50 flex items-center justify-between">
                    <span class="text-sm font-black text-purple-700" id="db-product-title">Product</span>
                    <button onclick="Dashboard._drillBrand=null;Dashboard._render();" class="text-xs text-purple-500 hover:text-purple-800 font-bold">✕ ปิด</button>
                </div>
                <div class="p-4 overflow-x-auto" id="db-product-body"></div>
            </div>

        </div>

        <!-- Target Modal -->
        <div id="db-target-modal" class="hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
                <div class="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-3xl">
                    <h2 class="font-black text-gray-800">🎯 ตั้ง Target รายสาย</h2>
                    <button onclick="Dashboard._closeTargetModal()" class="w-8 h-8 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-100 font-bold">✕</button>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-2" id="db-target-list"></div>
                <div class="p-4 border-t flex gap-3">
                    <button onclick="Dashboard._closeTargetModal()" class="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">ยกเลิก</button>
                    <button onclick="Dashboard._saveTargets()" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 text-sm font-bold">บันทึก Target</button>
                </div>
            </div>
        </div>
        `;
    },

    // ─── Load month list from Firestore ──────────────────────────────────
    _loadMonthList: async () => {
        try {
            const snap = await cloudDB.collection('sellout').get();
            const months = snap.docs
                .map(d => d.id)
                .filter(ym => /^20\d{2}_(0[1-9]|1[0-2])$/.test(ym))
                .sort().reverse();
            Dashboard._allMonths = months;

            const sel = document.getElementById('db-month-select');
            if (!sel) return;
            sel.innerHTML = `<option value="">-- เลือกเดือน --</option>` +
                months.map(ym => {
                    const [y, m] = ym.split('_');
                    const label = new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
                    return `<option value="${ym}">${label}</option>`;
                }).join('');

            // Auto-select latest month
            if (months.length > 0) {
                sel.value = months[0];
                Dashboard._onMonthChange(months[0]);
            }
        } catch (e) {
            console.error('Dashboard._loadMonthList:', e);
        }
    },

    _onMonthChange: async (ym) => {
        if (!ym) return;
        Dashboard._currentYM = ym;
        Dashboard._drillRoute = Dashboard._session.role === 'sales' ? Dashboard._session.username : null;
        Dashboard._drillCategory = null;
        Dashboard._drillBrand = null;
        await Dashboard._loadMonth(ym);
        await Dashboard._loadTargets(ym);
        Dashboard._render();
    },

    // ─── Load month data from chunked Firestore ───────────────────────────
    _loadMonth: async (ym) => {
        try {
            Dashboard._showUploadBar('กำลังโหลดข้อมูล...', 10);
            const key = ym;
            const metaDoc = await cloudDB.collection('sellout').doc(key).get();
            if (!metaDoc.exists) { Dashboard._rows = []; Dashboard._hideUploadBar(); return; }

            const chunks = await cloudDB.collection('sellout').doc(key).collection('chunks').get();
            const sortedDocs = chunks.docs.sort((a,b) => (a.data().index||0) - (b.data().index||0));
            let rows = [];
            sortedDocs.forEach(doc => { if (doc.data().rows) rows = rows.concat(doc.data().rows); });
            Dashboard._rows = rows;
            Dashboard._hideUploadBar();
        } catch (e) {
            Dashboard._hideUploadBar();
            console.error('Dashboard._loadMonth:', e);
        }
    },

    // ─── File Upload ──────────────────────────────────────────────────────
    _onFileUpload: async (evt) => {
        const file = evt.target.files[0];
        if (!file) return;
        evt.target.value = '';

        // Detect year_month from filename or ask
        let ym = Dashboard._detectYM(file.name);
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
                if (input) Dashboard._toast('⚠️ รูปแบบไม่ถูกต้อง ใช้ YYYY_MM', true);
                return;
            }
            ym = input;
        }

        const confirm = await new Promise(r => { if (window.confirm(`อัปโหลดข้อมูล Sellout เดือน ${ym} ?\n(ไฟล์เก่าจะถูกแทนที่)`)) r(true); else r(false); });
        if (!confirm) return;

        Dashboard._showUploadBar('กำลังอ่านไฟล์...', 5);

        try {
            const buf = await file.arrayBuffer();
            const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
            const ws  = wb.Sheets[wb.SheetNames[0]];
            const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

            Dashboard._showUploadBar('กำลังแปลงข้อมูล...', 20);

            const rows = Dashboard._normalizeRows(raw);
            if (rows.length === 0) { Dashboard._toast('⚠️ ไม่พบข้อมูลในไฟล์', true); return; }

            Dashboard._showUploadBar(`บันทึก ${rows.length} แถว...`, 40);

            await Dashboard._saveToFirestore(ym, rows);



            Dashboard._rows = rows;
            Dashboard._currentYM = ym;
            await Dashboard._loadMonthList();
            document.getElementById('db-month-select').value = ym;
            await Dashboard._loadTargets(ym);
            Dashboard._render();
            Dashboard._hideUploadBar();

        } catch (e) {
            Dashboard._hideUploadBar();
            Dashboard._toast('❌ อัปโหลดไม่สำเร็จ: ' + e.message, true);
            console.error(e);
        }
    },

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
        const batch = cloudDB.batch();
        const key = ym;
        const metaRef = cloudDB.collection('sellout').doc(key);
        batch.set(metaRef, {
            totalRows: rows.length,
            centerId:  window.CENTER_ID || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            version: 1
        });
        // Delete old chunks
        const old = await metaRef.collection('chunks').get();
        old.forEach(d => batch.delete(d.ref));
        await batch.commit();

        // Save new chunks sequentially
        const CS = Dashboard._CHUNK_SIZE;
        const total = Math.ceil(rows.length / CS);
        for (let i = 0; i < total; i++) {
            const pct = 20 + Math.round((i / total) * 75);
            Dashboard._showUploadBar(`บันทึก chunk ${i+1}/${total}`, pct);
            await metaRef.collection('chunks').doc(`chunk_${String(i).padStart(4,'0')}`).set({
                index: i,
                rows: rows.slice(i * CS, (i+1) * CS)
            });
        }
    },

        // ─── Targets ──────────────────────────────────────────────────────────
    _loadTargets: async (ym) => {
        try {
            const key = ym;
            const doc = await cloudDB.collection('targets').doc(key).get();
            Dashboard._targets = doc.exists ? (doc.data().routes || {}) : {};
        } catch (e) { Dashboard._targets = {}; }
    },

    _openTargetModal: () => {
        const routes = Dashboard._getRoutes();
        const list = document.getElementById('db-target-list');
        if (!list) return;
        list.innerHTML = routes.map(r => `
            <div class="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                <span class="text-sm font-bold text-gray-700 w-24 shrink-0">${r}</span>
                <input type="number" id="target-${r}" value="${Dashboard._targets[r] || ''}" placeholder="0"
                    class="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-300 font-bold text-right">
                <span class="text-xs text-gray-400">บาท</span>
            </div>
        `).join('');
        document.getElementById('db-target-modal').classList.remove('hidden');
    },

    _closeTargetModal: () => document.getElementById('db-target-modal').classList.add('hidden'),

    _saveTargets: async () => {
        const routes = Dashboard._getRoutes();
        const targets = {};
        routes.forEach(r => {
            const val = parseFloat(document.getElementById(`target-${r}`)?.value || 0);
            if (val > 0) targets[r] = val;
        });
        try {
            const key = Dashboard._currentYM;
            await cloudDB.collection('targets').doc(key).set({ routes: targets, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            Dashboard._targets = targets;
            Dashboard._closeTargetModal();
            Dashboard._render();
        } catch (e) { Dashboard._toast('❌ บันทึกไม่สำเร็จ: ' + e.message, true); }
    },

    // ─── Drill & Filter ───────────────────────────────────────────────────
    _getFilteredRows: () => {
        let rows = Dashboard._rows;
        const role = Dashboard._session.role;

        // กรองเฉพาะ sCode ที่อยู่ในศูนย์ปัจจุบัน (admin/supervisor)
        // State.db.routeList คือ list ของ sCode ในศูนย์นี้ เช่น ['406V01','406V02',...]
        if (role !== 'sales' && typeof State !== 'undefined' && State.db && State.db.routeList && State.db.routeList.length > 0) {
            const centerRoutes = new Set(State.db.routeList.map(r => r.toUpperCase()));
            rows = rows.filter(r => centerRoutes.has((r.sCode || '').toUpperCase()));
        }

        // Sales user sees only own rows
        if (role === 'sales') {
            rows = rows.filter(r => r.sCode === Dashboard._session.username.toUpperCase());
        } else if (Dashboard._drillRoute) {
            rows = rows.filter(r => r.sCode === Dashboard._drillRoute);
        }
        // กรองตาม shopType (ถ้าเลือก)
        if (Dashboard._drillShopType) {
            rows = rows.filter(r => r.shopType === Dashboard._drillShopType);
        }
        return rows;
    },

    _getRoutes: () => {
        const role = Dashboard._session.role;
        if (role === 'sales') return [Dashboard._session.username.toUpperCase()];
        // เอาเฉพาะ sCode ที่อยู่ใน routeList ของศูนย์นี้
        if (typeof State !== 'undefined' && State.db && State.db.routeList && State.db.routeList.length > 0) {
            const centerRoutes = new Set(State.db.routeList.map(r => r.toUpperCase()));
            const codes = [...new Set(Dashboard._rows.map(r => r.sCode))]
                .filter(c => centerRoutes.has((c || '').toUpperCase()))
                .sort();
            return codes;
        }
        const codes = [...new Set(Dashboard._rows.map(r => r.sCode))].sort();
        return codes;
    },

    _resetDrill: () => {
        Dashboard._drillRoute    = null;
        Dashboard._drillShopType = null;
        Dashboard._drillCategory = null;
        Dashboard._drillBrand    = null;
        Dashboard._render();
    },

    _amt: (r) => Dashboard._amountMode === 'gross' ? r.gross : r.net,

    _setAmountMode: (mode) => {
        Dashboard._amountMode = mode;
        document.getElementById('db-btn-gross').className = `px-3 py-1.5 text-xs font-bold transition ${mode==='gross' ? 'bg-emerald-700 text-white' : 'text-gray-400'}`;
        document.getElementById('db-btn-net').className   = `px-3 py-1.5 text-xs font-bold transition ${mode==='net'   ? 'bg-emerald-700 text-white' : 'text-gray-400'}`;
        Dashboard._render();
    },

    // ─── Main render ──────────────────────────────────────────────────────
    _render: () => {
        Dashboard._renderBreadcrumb();
        Dashboard._renderKPIs();
        Dashboard._renderRouteTable();
        Dashboard._renderShopTypes();
        Dashboard._renderCategories();
        Dashboard._renderBrands();
        Dashboard._renderProducts();
    },

    _renderBreadcrumb: () => {
        const bc = document.getElementById('db-breadcrumb');
        const rb = document.getElementById('db-reset-btn');
        if (!bc || !rb) return;

        const parts = [];
        if (Dashboard._drillRoute)    parts.push(`🚚 ${Dashboard._drillRoute}`);
        if (Dashboard._drillShopType) parts.push(`🏪 ${Dashboard._drillShopType}`);
        if (Dashboard._drillCategory) parts.push(`🏷️ ${Dashboard._drillCategory}`);
        if (Dashboard._drillBrand)    parts.push(`📦 ${Dashboard._drillBrand}`);

        if (parts.length > 0 && Dashboard._session.role !== 'sales') {
            bc.innerHTML = parts.join('<span class="mx-1 text-gray-600">›</span>');
            rb.classList.remove('hidden');
        } else {
            bc.innerHTML = '';
            rb.classList.add('hidden');
        }
    },

    _renderKPIs: () => {
        const el = document.getElementById('db-kpi-row');
        if (!el) return;

        // KPI หัว = ยอดรวมทั้งหมด ไม่เปลี่ยนตาม filter
        const savedRoute    = Dashboard._drillRoute;
        const savedShopType = Dashboard._drillShopType;
        const savedCat      = Dashboard._drillCategory;
        const savedBrand    = Dashboard._drillBrand;
        Dashboard._drillRoute    = null;
        Dashboard._drillShopType = null;
        Dashboard._drillCategory = null;
        Dashboard._drillBrand    = null;
        const rows = Dashboard._getFilteredRows();
        Dashboard._drillRoute    = savedRoute;
        Dashboard._drillShopType = savedShopType;
        Dashboard._drillCategory = savedCat;
        Dashboard._drillBrand    = savedBrand;

        const mainRows = rows.filter(r => !Dashboard.EXCLUDED_BRANDS.has(r.brandDesc));
        const total = mainRows.reduce((s, r) => s + Dashboard._amt(r), 0);
        const totalAll = rows.reduce((s, r) => s + Dashboard._amt(r), 0);

        const routes = Dashboard._getRoutes();
        const totalTarget = routes.reduce((s, r) => s + (Dashboard._targets[r] || 0), 0);

        // Compute filtered route target
        let targetAmt = totalTarget;
        if (Dashboard._drillRoute) targetAmt = Dashboard._targets[Dashboard._drillRoute] || 0;

        const pct = targetAmt > 0 ? (total / targetAmt * 100) : null;
        const outletM = Dashboard._calcOutletMetrics(rows);
        const invCount  = new Set(mainRows.map(r => r.invNum)).size;

        const modeLabel = Dashboard._amountMode === 'gross' ? 'Gross' : 'Net';

        const fmtFull = (n) => Math.round(n || 0).toLocaleString('th-TH');
        const volVsub = outletM.v.outletCount > 0
            ? `V: ${fmtFull(outletM.v.avgVol)} (${outletM.v.outletCount} ร้าน)`
            : 'ไม่มีสาย V';
        const volCsub = outletM.c.outletCount > 0
            ? `C: ${fmtFull(outletM.c.avgVol)} (${outletM.c.outletCount} ร้าน)`
            : 'ไม่มีสาย C';

        el.innerHTML = [
            { icon:'💰', label: `ยอด ${modeLabel} (หลัก)`, val: Dashboard._fmt(total), sub: '', color:'emerald' },
            { icon:'🎯', label: 'MTD vs Target', val: pct !== null ? Dashboard._pctBadge(pct) : '—', sub: targetAmt > 0 ? `Target: ${Dashboard._fmt(targetAmt)}` : 'ยังไม่ตั้ง Target', color:'amber', raw:true },
            { icon:'🏪', label: 'ร้านค้าทั้งหมด', val: outletM.outletCount.toLocaleString(), sub:'ร้านที่มียอด', color:'blue' },
            { icon:'📦', label: 'SKU เฉลี่ย/ร้าน', val: Dashboard._fmtSku(outletM.avgSku),
              sub: Dashboard._skuWhitelist ? `กรอง ${Dashboard._skuWhitelist.size} SKU · <span style="color:#6366f1;cursor:pointer;font-weight:800;" onclick="Dashboard.openSkuWhitelistModal()">⚙️ แก้ไข</span>` : `ทุก SKU · <span style="color:#6366f1;cursor:pointer;font-weight:800;" onclick="Dashboard.openSkuWhitelistModal()">⚙️ ตั้งค่า</span>`,
              color:'cyan', rawSub: true },
            { icon:'🚐', label: 'ยอด/ร้าน สาย V', val: fmtFull(outletM.v.avgVol), sub: volVsub, color:'pink' },
            { icon:'🏪', label: 'ยอด/ร้าน สาย C', val: fmtFull(outletM.c.avgVol), sub: volCsub, color:'orange' },
            { icon:'📄', label: 'Invoice', val: invCount.toLocaleString(), sub:'ใบ', color:'violet' },
        ].map(k => `
            <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div class="flex items-center gap-2 mb-1.5">
                    <span class="text-xl">${k.icon}</span>
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wide">${k.label}</span>
                </div>
                <div class="text-2xl font-black text-gray-800">${k.raw ? k.val : k.val}</div>
                ${k.sub ? `<div class="text-xs text-gray-400 mt-0.5">${k.rawSub ? k.sub : k.sub}</div>` : ''}
            </div>
        `).join('');
    },

    _pctBadge: (pct) => {
        const color = pct >= 100 ? 'text-emerald-600' : pct >= 80 ? 'text-amber-600' : 'text-red-500';
        return `<span class="${color}">${pct.toFixed(1)}%</span>`;
    },

    _renderRouteTable: () => {
        const tbody = document.getElementById('db-route-tbody');
        if (!tbody) return;
        const isAdmin = Dashboard._session.role !== 'sales';
        const routes = Dashboard._getRoutes();
        if (!routes.length || !Dashboard._rows.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400 text-sm">ยังไม่มีข้อมูล</td></tr>`;
            return;
        }

        const rowData = routes.map(r => {
            const rows = Dashboard._rows.filter(rx => rx.sCode === r && !Dashboard.EXCLUDED_BRANDS.has(rx.brandDesc));
            const amt  = rows.reduce((s,rx) => s + Dashboard._amt(rx), 0);
            const tgt  = Dashboard._targets[r] || 0;
            const pct  = tgt > 0 ? (amt / tgt * 100) : null;
            const om   = Dashboard._calcOutletMetrics(rows);
            return { r, amt, tgt, pct, avgSku: om.avgSku, avgVolV: om.v.avgVol, avgVolC: om.c.avgVol };
        }).sort((a,b) => b.amt - a.amt);

        const maxAmt = Math.max(...rowData.map(d => d.amt), 1);

        const fmtFull = (n) => Math.round(n || 0).toLocaleString('th-TH');
        tbody.innerHTML = rowData.map(({ r, amt, tgt, pct, avgSku, avgVolV, avgVolC }) => {
            const barW = Math.round((amt / maxAmt) * 100);
            const pctStr = pct !== null ? Dashboard._pctBadgeInline(pct) : '<span class="text-gray-300 text-xs">—</span>';
            const isActive = Dashboard._drillRoute === r;
            const rowCls = isAdmin ? 'cursor-pointer hover:bg-indigo-50 transition' : '';
            const activeCls = isActive ? 'bg-indigo-50 font-black' : '';
            return `
            <tr class="${rowCls} ${activeCls}" ${isAdmin ? `onclick="Dashboard._drillToRoute('${r}')"` : ''}>
                <td class="px-3 py-2.5">
                    <div class="font-bold text-gray-800 text-xs">${r}</div>
                    <div class="h-1.5 bg-gray-100 rounded-full mt-1 w-full">
                        <div class="h-1.5 bg-emerald-400 rounded-full" style="width:${barW}%"></div>
                    </div>
                </td>
                <td class="px-3 py-2.5 text-right font-bold text-gray-800 text-xs tabular-nums">${Dashboard._fmt(amt)}</td>
                <td class="px-3 py-2.5 text-right text-xs text-gray-400 tabular-nums">${tgt > 0 ? Dashboard._fmt(tgt) : '—'}</td>
                <td class="px-3 py-2.5 text-right">${pctStr}</td>
                <td class="px-3 py-2.5 text-right text-xs font-bold text-cyan-700 tabular-nums">${Dashboard._fmtSku(avgSku)}</td>
                <td class="px-3 py-2.5 text-right text-xs font-bold text-pink-700 tabular-nums">${avgVolV > 0 ? fmtFull(avgVolV) : '—'}</td>
                <td class="px-3 py-2.5 text-right text-xs font-bold text-orange-600 tabular-nums">${avgVolC > 0 ? fmtFull(avgVolC) : '—'}</td>
                <td class="px-3 py-2.5 text-center">
                    ${isAdmin ? `<button onclick="event.stopPropagation();Dashboard._drillToRoute('${r}')" class="text-[10px] text-indigo-400 hover:text-indigo-700 font-bold">▶</button>` : ''}
                </td>
            </tr>`;
        }).join('');

        // Total row
        const totalAmt = rowData.reduce((s,d) => s + d.amt, 0);
        const totalTgt = rowData.reduce((s,d) => s + d.tgt, 0);
        const totalPct = totalTgt > 0 ? totalAmt/totalTgt*100 : null;
        const filteredRows = Dashboard._getFilteredRows().filter(r => !Dashboard.EXCLUDED_BRANDS.has(r.brandDesc));
        const totalOm = Dashboard._calcOutletMetrics(filteredRows);
        tbody.innerHTML += `
        <tr class="border-t-2 border-gray-200 bg-gray-50 font-black">
            <td class="px-3 py-2.5 text-xs text-gray-600">รวมทั้งหมด</td>
            <td class="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-700">${Dashboard._fmt(totalAmt)}</td>
            <td class="px-3 py-2.5 text-right text-xs tabular-nums text-gray-500">${totalTgt > 0 ? Dashboard._fmt(totalTgt) : '—'}</td>
            <td class="px-3 py-2.5 text-right text-xs">${totalPct !== null ? Dashboard._pctBadgeInline(totalPct) : '—'}</td>
            <td class="px-3 py-2.5 text-right text-xs tabular-nums text-cyan-700">${Dashboard._fmtSku(totalOm.avgSku)}</td>
            <td class="px-3 py-2.5 text-right text-xs tabular-nums text-pink-700">${Math.round(totalOm.v.avgVol||0).toLocaleString('th-TH')}</td>
            <td class="px-3 py-2.5 text-right text-xs tabular-nums text-orange-600">${Math.round(totalOm.c.avgVol||0).toLocaleString('th-TH')}</td>
            <td></td>
        </tr>`;
    },

    _pctBadgeInline: (pct) => {
        const cls = pct >= 100 ? 'text-emerald-600' : pct >= 80 ? 'text-amber-500' : 'text-red-500';
        return `<span class="text-xs font-black ${cls}">${pct.toFixed(1)}%</span>`;
    },

    _drillToRoute: (r) => {
        Dashboard._drillRoute    = Dashboard._drillRoute === r ? null : r;
        Dashboard._drillShopType = null;
        Dashboard._drillCategory = null;
        Dashboard._drillBrand    = null;
        Dashboard._render();
    },

    _renderShopTypes: () => {
        const el = document.getElementById('db-shoptype-body');
        if (!el) return;
        // ใช้ rows ก่อนกรอง shopType (เพื่อแสดง % ของทุกประเภท)
        const baseRows = Dashboard._getFilteredRows();
        // คำนวณโดยไม่กรอง shopType
        const allRows = Dashboard._drillShopType
            ? (() => {
                const saved = Dashboard._drillShopType;
                Dashboard._drillShopType = null;
                const r = Dashboard._getFilteredRows();
                Dashboard._drillShopType = saved;
                return r;
            })()
            : baseRows;

        if (!allRows.length) { el.innerHTML = '<p class="text-center text-gray-400 text-xs py-4">ยังไม่มีข้อมูล</p>'; return; }

        const byType = {};
        allRows.forEach(r => {
            const t = r.shopType || 'Other';
            byType[t] = (byType[t] || 0) + Dashboard._amt(r);
        });
        const sorted = Object.entries(byType).sort((a,b) => b[1]-a[1]);
        const total  = sorted.reduce((s,[,v]) => s + v, 0);
        const max    = sorted[0]?.[1] || 1;

        // อัปเดต hint
        const hint = document.getElementById('db-shoptype-hint');
        if (hint) {
            if (Dashboard._drillShopType) {
                hint.innerHTML = `<button onclick="Dashboard._drillToShopType('${Dashboard._drillShopType.replace(/'/g,"\\'")}');" class="text-xs text-blue-500 hover:text-blue-800 font-bold">✕ ยกเลิก</button>`;
            } else {
                hint.textContent = 'กดเพื่อกรอง';
                hint.className = 'text-xs text-gray-400';
            }
        }

        el.innerHTML = sorted.map(([type, amt]) => {
            const pct     = (amt / total * 100).toFixed(1);
            const barW    = Math.round((amt / max) * 100);
            const isActive = Dashboard._drillShopType === type;
            return `
            <div class="cursor-pointer group transition rounded-lg p-1.5 -mx-1.5 ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}"
                 onclick="Dashboard._drillToShopType('${type.replace(/'/g,"\\'")}')">
                <div class="flex items-center justify-between mb-0.5">
                    <span class="text-xs font-bold ${isActive ? 'text-blue-700' : 'text-gray-700'} group-hover:text-blue-700 transition">${type}</span>
                    <span class="text-xs tabular-nums text-gray-500">${pct}%</span>
                </div>
                <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-2 rounded-full transition-all ${isActive ? 'bg-blue-500' : 'bg-blue-400'}" style="width:${barW}%"></div>
                </div>
                <div class="text-[10px] ${isActive ? 'text-blue-600 font-bold' : 'text-gray-400'} mt-0.5 tabular-nums">${Dashboard._fmt(amt)}</div>
            </div>`;
        }).join('');
    },

    _drillToShopType: (type) => {
        // toggle — กดซ้ำเพื่อยกเลิก
        Dashboard._drillShopType = Dashboard._drillShopType === type ? null : type;
        Dashboard._drillCategory = null;
        Dashboard._drillBrand    = null;
        Dashboard._render();
    },

    _renderCategories: () => {
        const mainEl    = document.getElementById('db-category-body');
        if (!mainEl) return;

        const rows = Dashboard._getFilteredRows();
        if (!rows.length) {
            if(mainEl) mainEl.innerHTML = '<p class="text-center text-gray-400 text-xs py-4">ยังไม่มีข้อมูล</p>';
            return;
        }

        // ใช้ brandDesc แทน catDesc สำหรับ breakdown หลัก
        const mainRows   = rows.filter(r => !Dashboard.EXCLUDED_BRANDS.has(r.brandDesc));

        // แยก Confirm vs Pending ใน Credit rows
        const creditRows   = mainRows.filter(r => /C\d/.test(String(r.sCode||'')));
        const confirmRows  = creditRows.filter(r => String(r.deliveryStatus||'').toLowerCase() === 'confirm');
        const pendingRows  = creditRows.filter(r => String(r.deliveryStatus||'').toLowerCase() === 'pending');
        const totalConfirm = confirmRows.reduce((s,r) => s + Dashboard._amt(r), 0);
        const totalPending = pendingRows.reduce((s,r) => s + Dashboard._amt(r), 0);
        const pendInvCount = new Set(pendingRows.map(r => r.invNum).filter(Boolean)).size;

        // inject Credit Delivery Status section ถ้ามี credit rows
        const creditStatusEl = document.getElementById('db-credit-delivery');
        if (creditStatusEl && creditRows.length > 0) {
            creditStatusEl.style.display = 'block';
            creditStatusEl.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
                <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                    <div class="text-xs font-bold text-emerald-700 mb-1">✅ Confirm</div>
                    <div class="text-lg font-black text-emerald-800">${Dashboard._fmt(totalConfirm)}</div>
                    <div class="text-xs text-gray-400">${confirmRows.length} รายการ</div>
                </div>
                <div class="bg-amber-50 border border-amber-100 rounded-xl p-3 cursor-pointer hover:bg-amber-100 transition"
                     onclick="Dashboard._showPendingInvoices()">
                    <div class="text-xs font-bold text-amber-700 mb-1">⏳ รอ Confirm</div>
                    <div class="text-lg font-black text-amber-800">${Dashboard._fmt(totalPending)}</div>
                    <div class="text-xs text-gray-400">${pendInvCount} invoice · <span class="text-indigo-500 font-bold">ดูรายละเอียด →</span></div>
                </div>
            </div>`;
        } else if (creditStatusEl) {
            creditStatusEl.style.display = 'none';
        }

        const renderBrandBars = (brandRows, el) => {
            if (!brandRows.length) { el.innerHTML = '<p class="text-center text-gray-400 text-xs py-4">ไม่มียอด</p>'; return; }
            const byBrand = {};
            brandRows.forEach(r => { byBrand[r.brandDesc] = (byBrand[r.brandDesc] || 0) + Dashboard._amt(r); });
            const sorted = Object.entries(byBrand).sort((a,b) => b[1]-a[1]);
            const total  = sorted.reduce((s,[,v]) => s + v, 0);
            const max    = sorted[0]?.[1] || 1;

            el.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">` +
                sorted.map(([brand, amt]) => {
                    const pct  = (amt / total * 100).toFixed(1);
                    const barW = Math.round((amt / max) * 100);
                    const isActive = Dashboard._drillCategory === brand;
                    return `
                    <div class="cursor-pointer bg-gray-50 hover:bg-indigo-50 rounded-xl p-3 transition border border-transparent ${isActive ? 'border-indigo-300 bg-indigo-50' : ''}"
                         onclick="Dashboard._drillToCategory('${brand.replace(/'/g,"\\'")}')">
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-xs font-black text-gray-700">${brand}</span>
                            <span class="text-xs text-gray-500">${pct}%</span>
                        </div>
                        <div class="h-2 bg-gray-200 rounded-full mb-1.5">
                            <div class="h-2 rounded-full bg-emerald-400" style="width:${barW}%"></div>
                        </div>
                        <div class="font-black text-sm text-emerald-700 tabular-nums">${Dashboard._fmt(amt)}</div>
                    </div>`;
                }).join('') + `</div>`;
        };

        renderBrandBars(mainRows, mainEl);

    },

    // ─── Pending Invoice Modal ──────────────────────────────────────────────
    _showPendingInvoices: () => {
        const rows = Dashboard._getFilteredRows()
            .filter(r => /C\d/.test(String(r.sCode||'')) && String(r.deliveryStatus||'').toLowerCase() === 'pending');

        // group by invNum
        const byInv = {};
        rows.forEach(r => {
            const inv = r.invNum || r.soNum || '—';
            if (!byInv[inv]) byInv[inv] = { sCode: r.sCode, custName: r.custName, net: 0, items: 0, kpiDate: r.kpiDate };
            byInv[inv].net   += r.net || 0;
            byInv[inv].items++;
        });
        const sorted = Object.entries(byInv).sort((a,b) => b[1].net - a[1].net);

        let modal = document.getElementById('db-pending-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'db-pending-modal';
            modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px;';
            document.body.appendChild(modal);
        }

        const totalPending = sorted.reduce((s,[,d]) => s + d.net, 0);
        modal.innerHTML = `
        <div style="background:#fff;border-radius:24px;width:100%;max-width:560px;max-height:88dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.3);">
            <div style="padding:18px 20px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div>
                    <div style="font-size:15px;font-weight:900;color:#111827;">⏳ Invoice รอ Confirm</div>
                    <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${sorted.length} invoice · รวม ${Dashboard._fmt(totalPending)}</div>
                </div>
                <button onclick="document.getElementById('db-pending-modal').style.display='none'"
                    style="width:30px;height:30px;border-radius:50%;border:1px solid #e5e7eb;background:#fff;color:#9ca3af;font-size:14px;cursor:pointer;font-weight:700;">✕</button>
            </div>
            <div style="flex:1;overflow-y:auto;padding:12px 20px;">
                ${sorted.length === 0
                    ? '<div style="text-align:center;padding:24px;color:#9ca3af;">ไม่มี invoice รอ Confirm</div>'
                    : sorted.map(([inv, d]) => `
                    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:10px 14px;margin-bottom:8px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-size:12px;font-weight:900;color:#111827;font-family:monospace;">${inv}</div>
                                <div style="font-size:11px;color:#6b7280;margin-top:2px;">${d.sCode} · ${d.custName || '—'}</div>
                                ${d.kpiDate ? `<div style="font-size:10px;color:#9ca3af;">${d.kpiDate}</div>` : ''}
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:14px;font-weight:900;color:#b45309;">${Dashboard._fmt(d.net)}</div>
                                <div style="font-size:10px;color:#9ca3af;">${d.items} รายการ</div>
                            </div>
                        </div>
                    </div>`).join('')}
            </div>
        </div>`;
        modal.style.display = 'flex';
    },

    _drillToCategory: (cat) => {
        Dashboard._drillCategory = Dashboard._drillCategory === cat ? null : cat;
        Dashboard._drillBrand = null;
        Dashboard._render();
    },

    _renderBrands: () => {
        const panel = document.getElementById('db-brand-panel');
        const body  = document.getElementById('db-brand-body');
        const title = document.getElementById('db-brand-title');
        if (!panel || !body) return;

        if (!Dashboard._drillCategory) { panel.classList.add('hidden'); return; }
        panel.classList.remove('hidden');
        if (title) title.textContent = `🏷️ SKU — ${Dashboard._drillCategory}`;

        // drill จาก brandDesc → แสดง prodName ย่อย
        const rows = Dashboard._getFilteredRows().filter(r => r.brandDesc === Dashboard._drillCategory);
        const byProd = {};
        rows.forEach(r => {
            const key = r.prodName || r.prodCode || '—';
            byProd[key] = (byProd[key] || 0) + Dashboard._amt(r);
        });
        const sorted = Object.entries(byProd).sort((a,b) => b[1]-a[1]);
        const max = sorted[0]?.[1] || 1;

        body.innerHTML = `<div class="flex flex-wrap gap-2">` + sorted.map(([prod, amt]) => {
            const barW = Math.round((amt / max) * 100);
            const isActive = Dashboard._drillBrand === prod;
            return `
            <div class="cursor-pointer flex-1 min-w-[160px] bg-gray-50 hover:bg-indigo-50 border border-transparent ${isActive ? 'border-indigo-300 bg-indigo-50' : ''} rounded-xl p-3 transition"
                 onclick="Dashboard._drillToBrand('${prod.replace(/'/g,"\\'")}')">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-black text-gray-700 leading-tight">${prod}</span>
                </div>
                <div class="h-1.5 bg-gray-200 rounded-full mb-1.5">
                    <div class="h-1.5 rounded-full bg-indigo-400" style="width:${barW}%"></div>
                </div>
                <div class="font-black text-sm text-indigo-700 tabular-nums">${Dashboard._fmt(amt)}</div>
            </div>`;
        }).join('') + `</div>`;
    },

    _drillToBrand: (brand) => {
        Dashboard._drillBrand = Dashboard._drillBrand === brand ? null : brand;
        Dashboard._render();
    },

    _renderProducts: () => {
        const panel = document.getElementById('db-product-panel');
        const body  = document.getElementById('db-product-body');
        const title = document.getElementById('db-product-title');
        if (!panel || !body) return;

        if (!Dashboard._drillBrand) { panel.classList.add('hidden'); return; }
        panel.classList.remove('hidden');
        if (title) title.textContent = `📦 ${Dashboard._drillBrand}`;

        const rows = Dashboard._getFilteredRows()
            .filter(r => r.brandDesc === Dashboard._drillCategory && r.prodName === Dashboard._drillBrand);

        const byProd = {};
        rows.forEach(r => {
            if (!byProd[r.prodCode]) byProd[r.prodCode] = { name: r.prodName, amt: 0, qty: 0, inv: new Set() };
            byProd[r.prodCode].amt += Dashboard._amt(r);
            byProd[r.prodCode].qty += r.qtyEA;
            byProd[r.prodCode].inv.add(r.invNum);
        });

        const sorted = Object.entries(byProd).sort((a,b) => b[1].amt - a[1].amt);

        body.innerHTML = `
        <table class="w-full text-xs min-w-[400px]">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-3 py-2 text-left font-bold text-gray-500">Product</th>
                    <th class="px-3 py-2 text-right font-bold text-gray-500">ยอด</th>
                    <th class="px-3 py-2 text-right font-bold text-gray-500">จำนวน (EA)</th>
                    <th class="px-3 py-2 text-right font-bold text-gray-500">Invoice</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map(([code, d], i) => `
                <tr class="${i % 2 === 0 ? '' : 'bg-gray-50'}">
                    <td class="px-3 py-2">
                        <div class="font-bold text-gray-800 leading-tight">${d.name}</div>
                        <div class="text-[10px] text-gray-400 font-mono">${code}</div>
                    </td>
                    <td class="px-3 py-2 text-right font-black text-purple-700 tabular-nums">${Dashboard._fmt(d.amt)}</td>
                    <td class="px-3 py-2 text-right text-gray-600 tabular-nums">${d.qty.toLocaleString()}</td>
                    <td class="px-3 py-2 text-right text-gray-500 tabular-nums">${d.inv.size}</td>
                </tr>`).join('')}
                <tr class="border-t-2 border-gray-200 bg-gray-50 font-black">
                    <td class="px-3 py-2 text-gray-600">รวม</td>
                    <td class="px-3 py-2 text-right text-purple-700 tabular-nums">${Dashboard._fmt(sorted.reduce((s,[,d])=>s+d.amt,0))}</td>
                    <td class="px-3 py-2 text-right text-gray-600 tabular-nums">${sorted.reduce((s,[,d])=>s+d.qty,0).toLocaleString()}</td>
                    <td class="px-3 py-2 text-right text-gray-500">${new Set(rows.map(r=>r.invNum)).size}</td>
                </tr>
            </tbody>
        </table>`;
    },

    // ─── Helpers ─────────────────────────────────────────────────────────
    _fmt: (n) => {
        if (n >= 1_000_000) return (n/1_000_000).toFixed(2) + 'M';
        if (n >= 1_000)     return (n/1_000).toFixed(1) + 'K';
        return n.toLocaleString('th-TH', { maximumFractionDigits: 0 });
    },

    _showUploadBar: (label, pct) => {
        const bar = document.getElementById('db-upload-bar');
        const prog = document.getElementById('db-upload-progress');
        const lbl  = document.getElementById('db-upload-label');
        if (bar) bar.classList.remove('hidden');
        if (prog) prog.style.width = pct + '%';
        if (lbl) lbl.textContent = label;
    },

    _hideUploadBar: () => {
        const bar = document.getElementById('db-upload-bar');
        if (bar) bar.classList.add('hidden');
    },

    // ✅ Toast แทน alert() — ไม่ block UI
    _toast: (msg, isError = false) => {
        if (typeof UI !== 'undefined' && UI.showSaveToast) {
            isError ? UI.showErrorToast(msg) : UI.showSaveToast(msg);
            return;
        }
        // fallback: สร้าง toast เองถ้า UI ไม่พร้อม
        let t = document.getElementById('_db-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = '_db-toast';
            t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;color:#fff;z-index:99999;transition:transform 0.3s,opacity 0.3s;opacity:0;font-family:Prompt,sans-serif;';
            document.body.appendChild(t);
        }
        t.style.background = isError ? '#dc2626' : '#111827';
        t.textContent = msg;
        t.style.transform = 'translateX(-50%) translateY(0)';
        t.style.opacity = '1';
        clearTimeout(t._tid);
        t._tid = setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(80px)'; t.style.opacity = '0'; }, 3000);
    },

    // ─── Active Campaign Coverage on Dashboard ──────────────────────────
    _renderCampaignSection: async () => {
        const el = document.getElementById('db-campaign-section');
        if (!el) return;

        if (typeof SkuDist === 'undefined' || typeof cloudDB === 'undefined') {
            el.classList.add('hidden'); return;
        }

        try {
            const nowYM = DateUtil ? DateUtil.currentYM() : '';
            const snap  = await cloudDB.collection('skuDistribution')
                .where('centerId', '==', window.CENTER_DOC || '')
                .get();

            // แสดงทุก campaign ที่ยังไม่หมดอายุ (endYM >= ปัจจุบัน)
            const active = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(c => c.endYM >= nowYM && (c.groups || []).length > 0);

            if (!active.length) { el.classList.add('hidden'); return; }

            if (SkuDist._allProdOptions.length === 0) await SkuDist._loadProdOptions();

            // build custCode → route index (คงที่ไม่ขึ้นกับเดือน)
            const custToRoute = {};
            const routes = State?.db?.routeList || [];
            routes.forEach(route => {
                (State.db.routes?.[route] || []).forEach(s => {
                    custToRoute[String(s.id)] = route;
                });
            });

            // helper: range เดือน
            const getRange = (startYM, endYM) => {
                const months = []; let [y, m] = startYM.split('_').map(Number);
                const [ey, em] = endYM.split('_').map(Number);
                while (y < ey || (y === ey && m <= em)) {
                    months.push(`${y}_${String(m).padStart(2,'0')}`);
                    m++; if (m > 12) { m = 1; y++; }
                }
                return months;
            };

            // helper: โหลด rows ของเดือน (cached + tag _route)
            const loadMonthRows = async (ym) => {
                const cacheKey = ym;
                if (Dashboard._rowCache[cacheKey]) return Dashboard._rowCache[cacheKey];
                try {
                    const chunks = await cloudDB.collection('sellout').doc(cacheKey).collection('chunks').get();
                    let rows = [];
                    chunks.forEach(doc => rows = rows.concat(doc.data().rows || []));
                    rows.forEach(r => { r._route = custToRoute[String(r.custCode||'')] || null; });
                    Dashboard._rowCache[cacheKey] = rows;
                    return rows;
                } catch(e) {
                    Dashboard._rowCache[cacheKey] = [];
                    return [];
                }
            };

            el.innerHTML = '<p class="text-xs text-gray-400 text-center py-3">⏳ กำลังโหลดข้อมูล campaign...</p>';
            el.classList.remove('hidden');

            const cards = await Promise.all(active.map(async campaign => {
                try {
                    // โหลด rows ทุกเดือนใน campaign range
                    const months = getRange(campaign.startYM, campaign.endYM);
                    let allRows = [];
                    for (const ym of months) {
                        allRows = allRows.concat(await loadMonthRows(ym));
                    }

                    const targetUnit    = campaign.targetUnit || 'pct';
                    const defaultTarget = campaign.defaultTarget ?? 80;
                    const rawTargets    = campaign.routeTargets || {};
                    const groups        = campaign.groups || [];

                    const groupSummaries = groups.map(g => {
                        const kws = (g.keywords || []).map(k => k.toLowerCase());
                        let totalStoreAll = 0, totalBought = 0, totalTarget = 0;

                        routes.forEach(route => {
                            const allStores = (State.db.routes?.[route] || []).map(s => String(s.id));
                            const storeSet  = new Set(allStores);
                            totalStoreAll  += allStores.length;

                            const rawTgt = rawTargets[route] ?? null;
                            const tgtPct = rawTgt !== null
                                ? (targetUnit === 'count'
                                    ? (allStores.length > 0 ? rawTgt/allStores.length*100 : 0)
                                    : rawTgt)
                                : defaultTarget;
                            totalTarget += Math.round(tgtPct/100 * allStores.length);

                            const matched = allRows.filter(r =>
                                r._route === route &&
                                storeSet.has(String(r.custCode||'')) &&
                                kws.some(k =>
                                    (r.prodCode||'').toLowerCase().includes(k) ||
                                    (r.prodName||'').toLowerCase().includes(k))
                            );
                            totalBought += new Set(matched.map(r => String(r.custCode))).size;
                        });

                        const pct   = totalStoreAll > 0 ? Math.round(totalBought/totalStoreAll*100) : 0;
                        const tgtPct2 = totalStoreAll > 0 ? Math.round(totalTarget/totalStoreAll*100) : 0;
                        const vs    = pct - tgtPct2;
                        const color = pct >= tgtPct2 ? '#10b981' : pct >= tgtPct2*0.8 ? '#f59e0b' : '#ef4444';
                        return { name: g.name, pct, tgtPct: tgtPct2, vs, color,
                            barW: Math.min(pct,100), tgtW: Math.min(tgtPct2,100),
                            totalBought, totalTarget, totalStoreAll };
                    });

                    const startLbl = DateUtil ? DateUtil.ymToThaiShort(campaign.startYM) : campaign.startYM;
                    const endLbl   = DateUtil ? DateUtil.ymToThaiShort(campaign.endYM)   : campaign.endYM;

                    return `
                    <div class="bg-white rounded-2xl shadow-sm border border-pink-100 overflow-hidden">
                        <div class="flex items-center justify-between px-4 py-3 border-b border-pink-100 bg-pink-50/50">
                            <div class="flex items-center gap-2">
                                <span class="text-base">🎯</span>
                                <span class="text-sm font-black text-gray-800">${campaign.name}</span>
                                <span class="text-xs text-gray-400 font-medium">${startLbl} → ${endLbl} · ยอดรวมทั้งช่วง</span>
                            </div>
                            <button onclick="Nav.go('skudist')" class="text-xs text-pink-600 font-bold hover:underline">ดูรายละเอียด →</button>
                        </div>
                        <div class="p-4 grid grid-cols-1 sm:grid-cols-${Math.min(groupSummaries.length, 4)} gap-4">
                            ${groupSummaries.map(gs => `
                            <div>
                                <div class="flex items-center justify-between mb-1.5">
                                    <span class="text-xs font-bold text-gray-600">${gs.name}</span>
                                    <span class="text-xs font-black" style="color:${gs.color}">${gs.pct}%</span>
                                </div>
                                <div style="position:relative;height:8px;background:#e5e7eb;border-radius:99px;overflow:visible;margin-bottom:6px;">
                                    <div style="width:${gs.barW}%;height:8px;background:${gs.color};border-radius:99px;"></div>
                                    <div style="position:absolute;left:${gs.tgtW}%;top:-3px;width:2px;height:14px;background:#6366f1;border-radius:1px;" title="target ${gs.tgtPct}%"></div>
                                </div>
                                <div class="flex justify-between text-[10px] text-gray-500">
                                    <span class="font-bold text-gray-800">${gs.totalBought.toLocaleString()}<span class="font-normal text-gray-400">/${gs.totalTarget.toLocaleString()} ร้าน (target)</span></span>
                                    <span class="${gs.vs >= 0 ? 'text-emerald-600' : 'text-red-500'} font-bold">${gs.vs >= 0 ? '+' : ''}${gs.vs}% vs target</span>
                                </div>
                            </div>`).join('')}
                        </div>
                    </div>`;
                } catch(e) {
                    console.warn('Dashboard campaign card error:', e);
                    return '';
                }
            }));

            const html = cards.filter(Boolean).join('');
            if (html) { el.innerHTML = html; el.classList.remove('hidden'); }
            else       { el.classList.add('hidden'); }

        } catch(e) {
            console.warn('Dashboard._renderCampaignSection:', e);
            el.classList.add('hidden');
        }
    },


    // ─── SKU Whitelist Modal ──────────────────────────────────────────────
    openSkuWhitelistModal: async () => {
        let modal = document.getElementById('sku-whitelist-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sku-whitelist-modal';
            modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px;';
            modal.innerHTML = `
            <div style="background:#fff;border-radius:24px;width:100%;max-width:560px;max-height:88dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.3);">
                <div style="padding:18px 20px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                    <div>
                        <div style="font-size:15px;font-weight:900;color:#111827;">📦 SKU สำหรับคำนวณเฉลี่ย/ร้าน</div>
                        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">ติ๊กเลือก SKU ที่ต้องการนับ — ไม่ติ๊กทั้งหมด = ใช้ทุก SKU</div>
                    </div>
                    <button onclick="Dashboard.closeSkuWhitelistModal()" style="width:30px;height:30px;border-radius:50%;border:1px solid #e5e7eb;background:#fff;color:#9ca3af;font-size:14px;cursor:pointer;font-weight:700;">✕</button>
                </div>
                <div style="padding:12px 20px;border-bottom:1px solid #f1f5f9;flex-shrink:0;display:flex;gap:8px;align-items:center;">
                    <input id="sku-wl-search" type="text" placeholder="🔍 ค้นหา prodCode หรือชื่อสินค้า..."
                        oninput="Dashboard._filterSkuList(this.value)"
                        style="flex:1;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:8px 12px;font-size:12px;outline:none;font-family:inherit;">
                    <button onclick="Dashboard._selectAllSku(true)" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">ทั้งหมด</button>
                    <button onclick="Dashboard._selectAllSku(false)" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">ล้าง</button>
                </div>
                <div style="padding:8px 20px;background:#f8fafc;flex-shrink:0;border-bottom:1px solid #f1f5f9;">
                    <span id="sku-wl-count" style="font-size:11px;font-weight:700;color:#6366f1;"></span>
                </div>
                <div id="sku-wl-list" style="flex:1;overflow-y:auto;padding:12px 20px;"></div>
                <div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;gap:10px;flex-shrink:0;">
                    <button onclick="Dashboard.closeSkuWhitelistModal()" style="flex:1;border:1px solid #e5e7eb;border-radius:12px;padding:11px;font-size:13px;font-weight:700;color:#6b7280;background:#fff;cursor:pointer;font-family:inherit;">ยกเลิก</button>
                    <button onclick="Dashboard.saveSkuWhitelist()" style="flex:1;border:none;border-radius:12px;padding:11px;font-size:13px;font-weight:700;color:#fff;background:#6366f1;cursor:pointer;font-family:inherit;">💾 บันทึก</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
        const listEl = document.getElementById('sku-wl-list');
        listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#9ca3af;font-size:13px;">⏳ กำลังโหลด...</div>';
        await Dashboard._ensureSkuOptions();
        Dashboard._renderSkuList('');
    },

    _skuOptions: [],

    _ensureSkuOptions: async () => {
        if (Dashboard._skuOptions.length > 0) return;
        try {
            const snap = await cloudDB.collection('sellout').get();
            const months = snap.docs.map(d => d.id)
                .filter(ym => /^20\d{2}_(0[1-9]|1[0-2])$/.test(ym)).sort().reverse();
            if (!months.length) return;
            const chunks = await cloudDB.collection('sellout').doc(months[0]).collection('chunks').get();
            const seen = new Map();
            chunks.docs.sort((a,b) => (a.data().index||0)-(b.data().index||0))
                .forEach(doc => (doc.data().rows||[]).forEach(r => {
                    const code = String(r.prodCode||'').trim();
                    const name = String(r.prodName||'').trim();
                    if (code && !seen.has(code)) seen.set(code, name);
                }));
            Dashboard._skuOptions = [...seen.entries()]
                .map(([code, name]) => ({ code, name }))
                .sort((a,b) => a.code.localeCompare(b.code));
        } catch(e) { console.warn('_ensureSkuOptions:', e); }
    },

    _renderSkuList: (q) => {
        const listEl  = document.getElementById('sku-wl-list');
        const countEl = document.getElementById('sku-wl-count');
        if (!listEl) return;
        const wl   = Dashboard._skuWhitelist;
        const opts = Dashboard._skuOptions;
        const filtered = q ? opts.filter(p => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : opts;
        if (countEl) countEl.textContent = wl
            ? 'เลือกไว้ ' + wl.size + ' / ' + opts.length + ' SKU'
            : 'ใช้ทุก SKU (' + opts.length + ' รายการ)';
        listEl.innerHTML = filtered.map(p => {
            const checked = !wl || wl.has(p.code);
            return '<label style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #f9fafb;cursor:pointer;">' +
                '<input type="checkbox" value="' + p.code + '" ' + (checked ? 'checked' : '') + ' onchange="Dashboard._onSkuCheck()" style="width:16px;height:16px;accent-color:#6366f1;flex-shrink:0;">' +
                '<span style="font-family:monospace;font-size:11px;color:#6366f1;background:#ede9fe;padding:1px 6px;border-radius:5px;flex-shrink:0;">' + p.code + '</span>' +
                '<span style="font-size:12px;color:#374151;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + p.name + '">' + p.name + '</span>' +
                '</label>';
        }).join('') || '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px;">ไม่พบสินค้า</div>';
    },

    _filterSkuList: (q) => Dashboard._renderSkuList(q.trim().toLowerCase()),

    _selectAllSku: (checked) => {
        document.querySelectorAll('#sku-wl-list input[type=checkbox]').forEach(cb => cb.checked = checked);
        Dashboard._onSkuCheck();
    },

    _onSkuCheck: () => {
        const countEl = document.getElementById('sku-wl-count');
        const checked = document.querySelectorAll('#sku-wl-list input[type=checkbox]:checked').length;
        const total   = Dashboard._skuOptions.length;
        if (countEl) countEl.textContent = checked === total
            ? 'ใช้ทุก SKU (' + total + ' รายการ)'
            : 'เลือกไว้ ' + checked + ' / ' + total + ' SKU';
    },

    closeSkuWhitelistModal: () => {
        const modal = document.getElementById('sku-whitelist-modal');
        if (modal) modal.style.display = 'none';
    },

    saveSkuWhitelist: async () => {
        const all     = Dashboard._skuOptions.map(p => p.code);
        const checked = [...document.querySelectorAll('#sku-wl-list input[type=checkbox]:checked')].map(cb => cb.value);
        const codes   = checked.length === all.length ? [] : checked;
        try {
            await Dashboard._saveSkuWhitelist(codes);
            Dashboard.closeSkuWhitelistModal();
            Dashboard._render();
            UI.showSaveToast('✅ บันทึกแล้ว — ' + (codes.length ? codes.length + ' SKU' : 'ใช้ทุก SKU'));
        } catch(e) {
            UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + e.message);
        }
    },

};


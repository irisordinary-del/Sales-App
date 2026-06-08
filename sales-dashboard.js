// ==========================================
// 📊 SalesDashboard — ยอดขายสำหรับ Sales
// โหลดข้อมูลจาก Firestore collection:
//   sellout/{YYYY_MM}/chunks/  ← กรองเฉพาะ sCode = username
//   targets/{YYYY_MM}          ← target ของสายตัวเอง
// ==========================================

const SalesDashboard = {

    _mode: 'net',      // 'gross' | 'net'
    _ym: '',             // 'YYYY_MM' ที่เลือกอยู่
    _rows: [],           // rows ของ sales คนนี้
    _target: 0,          // target เดือนนี้
    _username: '',       // Salesman Code (uppercase)
    _myRoute: '',        // route ของ sales เช่น "402V01"

    // ✅ FIX: แยก sellout/targets ตาม centerId ป้องกัน data ทับกันข้ามศูนย์
    _ymKey: (ym) => {
        const cid = window.CENTER_ID || Auth.getSession()?.centerId || '';
        return cid ? `${cid}_${ym}` : ym;
    },
    _campaigns: [],      // active campaigns ของศูนย์นี้
    _rowCache: {},       // { 'YYYY_MM': rows[] } cache ไม่ต้องโหลดซ้ำ
    _ready: false,

    EXCLUDED_BRANDS: new Set(['อื่นๆ', 'กระเช้าของขวัญ']),

    _calcOutletMetrics: (rows) => {
        const filtered = rows.filter(r => !SalesDashboard.EXCLUDED_BRANDS.has(r.brandDesc));
        const byOutlet = {}, byOutletV = {}, byOutletC = {};
        filtered.forEach(r => {
            const key = String(r.custCode || '').trim() || String(r.custName || '').trim();
            if (!key) return;
            const sku   = String(r.prodCode || '').trim();
            const amt   = SalesDashboard._amt(r);
            const sCode = String(r.sCode || '').toUpperCase();
            const rType = /C\d/.test(sCode) ? 'C' : /V\d/.test(sCode) ? 'V' : null;
            [
                [byOutlet, true],
                [byOutletV, rType === 'V'],
                [byOutletC, rType === 'C'],
            ].forEach(([map, use]) => {
                if (!use) return;
                if (!map[key]) map[key] = { skus: new Set(), vol: 0 };
                if (sku) map[key].skus.add(sku);
                map[key].vol += amt;
            });
        });
        const calc = (map) => {
            const list = Object.values(map);
            const n = list.length;
            if (!n) return { outletCount: 0, avgSku: 0, avgVol: 0 };
            return {
                outletCount: n,
                avgSku: list.reduce((s, o) => s + o.skus.size, 0) / n,
                avgVol: list.reduce((s, o) => s + o.vol, 0) / n,
            };
        };
        return { ...calc(byOutlet), v: calc(byOutletV), c: calc(byOutletC) };
    },

    _fmtSku: (n) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    _fmtVol: (n) => Math.round(n || 0).toLocaleString('th-TH'),

    // ─── Init: เรียกหลัง App.start() โหลดเสร็จ ──────────────────────────
    init: () => {
        const session = Auth.getSession();
        if (!session || session.role !== 'sales') return;
        SalesDashboard._username = session.username.toUpperCase();

        // ✅ UX-FIX-1: แสดงชื่อจริง + รหัสสาย แทน username อย่างเดียว
        const lbl = document.getElementById('db-route-label');
        if (lbl) {
            const _name = session.displayName || session.username;
            const _code = session.username.toUpperCase();
            lbl.textContent = _name !== _code ? `${_name} · ${_code}` : _code;
        }

        // ดึง route จาก session หรือ State
        const myRoute = Auth.getSession()?.username?.toUpperCase() || '';
        SalesDashboard._myRoute = myRoute;

        SalesDashboard._ready = true;
        SalesDashboard._initOfflineListener();
        SalesDashboard._ensureKpiCards();
        // ✅ โหลดพร้อมกัน ไม่รอกัน
        Promise.all([
            SalesDashboard._loadMonthList(),
            SalesDashboard._waitAndLoadCampaigns(),
        ]).catch(() => {});
    },

    _ensureKpiCards: () => {
        if (document.getElementById('db-kpi-avgsku')) return;
        const invCard = document.getElementById('db-kpi-inv')?.closest('.db-card');
        if (!invCard || !invCard.parentElement) return;
        const parent = invCard.parentElement;
        const mk = (border, label, id, sub, color) => {
            const el = document.createElement('div');
            el.className = 'db-card';
            el.style.borderLeft = '4px solid ' + border;
            el.innerHTML =
                '<div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:4px;">' + label + '</div>' +
                '<div class="db-kpi-num" id="' + id + '" style="color:' + color + ';">—</div>' +
                '<div style="font-size:10px;color:#9ca3af;margin-top:2px;">' + sub + '</div>';
            return el;
        };
        const u = SalesDashboard._username;
        const isV = /V\d/i.test(u);
        const isC = /C\d/i.test(u);
        // SKU avg — always show
        parent.insertBefore(mk('#0ea5e9', '📦 SKU เฉลี่ย/ร้าน', 'db-kpi-avgsku', 'SKU รวมเฉลี่ยต่อร้าน', '#0284c7'), invCard);
        // V card only for V routes
        if (isV || (!isV && !isC)) {
            parent.insertBefore(mk('#ec4899', '🚐 ยอด/ร้าน', 'db-kpi-avgvol-v', 'บาท เฉลี่ยต่อร้าน', '#db2777'), invCard);
        }
        // C card only for C routes
        if (isC || (!isV && !isC)) {
            parent.insertBefore(mk('#f97316', '🏪 ยอด/ร้าน', 'db-kpi-avgvol-c', 'บาท เฉลี่ยต่อร้าน', '#ea580c'), invCard);
        }
    },

    // ─── โหลดรายการเดือนที่มีข้อมูล ──────────────────────────────────────
    _loadMonthList: async () => {
        try {
            // ✅ FIX-PERF-4: แสดง skeleton ทันที ไม่ต้องรอ Firestore
            const sel = document.getElementById('db-month-sel');
            const container = sel?.closest('[id]') || document.getElementById('db-dashboard-wrap');
            SalesDashboard._showSkeleton(container);

            const snap = await db.collection('sellout').get();
            // ✅ FIX: กรองเฉพาะ doc ของศูนย์นี้ แล้วแปลง key กลับเป็น YYYY_MM
            const cid = window.CENTER_ID || Auth.getSession()?.centerId || '';
            const prefix = cid ? `${cid}_` : '';
            const months = snap.docs
                .map(d => d.id)
                .filter(id => prefix ? id.startsWith(prefix) : /^\d{4}_\d{2}$/.test(id))
                .map(id => prefix ? id.slice(prefix.length) : id)
                .filter(ym => /^\d{4}_\d{2}$/.test(ym))
                .sort().reverse();

            if (!sel) return;

            sel.innerHTML = '<option value="">-- เดือน --</option>' +
                months.map(ym => {
                    const [y, m] = ym.split('_');
                    const label = new Date(+y, +m - 1, 1)
                        .toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
                    return `<option value="${ym}">${label}</option>`;
                }).join('');

            // ✅ FIX-PERF-5: โหลดเดือนล่าสุดก่อน แล้ว preload ทุกเดือนที่เหลือเบื้องหลัง
            if (months.length > 0) {
                // ✅ FIX: รอ browser render <option> เสร็จก่อน set value
                // sel.value = months[0] ทันทีหลัง innerHTML อาจไม่ติดใน browser บางตัว
                await new Promise(r => requestAnimationFrame(r));
                sel.value = months[0];
                // ตรวจสอบว่า set สำเร็จ ถ้าไม่ติดให้ force select option แรก
                if (sel.value !== months[0]) {
                    sel.selectedIndex = 1; // index 0 = "-- เดือน --", index 1 = เดือนล่าสุด
                }
                await SalesDashboard.onMonthChange(months[0]);
                // preload ทุกเดือนที่เหลือ — staggered ทุก 2 วิ ไม่บล็อก render
                months.slice(1).forEach((ym, i) => {
                    setTimeout(() => {
                        SalesDashboard._loadData(ym).catch(() => {});
                        SalesDashboard._loadTarget(ym).catch(() => {});
                    }, (i + 1) * 2000);
                });
            }
        } catch (e) {
            console.warn('SalesDashboard._loadMonthList:', e);
            SalesDashboard._showEmpty();
        }
    },

    // ✅ NEW: skeleton loading cards
    _showSkeleton: (container) => {
        if (!container) return;
        const skeletonStyle = 'background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);background-size:200% 100%;animation:_sk 1.2s infinite;border-radius:8px;';
        if (!document.getElementById('_sk-style')) {
            const s = document.createElement('style');
            s.id = '_sk-style';
            s.textContent = '@keyframes _sk{0%{background-position:200% 0}100%{background-position:-200% 0}}';
            document.head.appendChild(s);
        }
        const wrap = document.getElementById('db-kpi-wrap') || document.getElementById('dashboard-tab');
        if (!wrap || wrap.dataset.skeletonDone) return;
        wrap.dataset.skeletonDone = '1';
        // เพิ่ม skeleton bars ชั่วคราวถ้ายังไม่มีข้อมูล
        const kpiIds = ['db-kpi-net','db-kpi-target','db-kpi-inv','db-kpi-avgsku'];
        kpiIds.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.textContent === '—') {
                el.innerHTML = `<span style="${skeletonStyle}display:inline-block;width:70px;height:18px;"></span>`;
            }
        });
    },

    // ─── เปลี่ยนเดือน ─────────────────────────────────────────────────────
    onMonthChange: async (ym) => {
        if (!ym) return;
        SalesDashboard._ym = ym;
        SalesDashboard._rows = [];
        SalesDashboard._target = 0;

        // ✅ FIX: แสดง skeleton ระหว่างโหลด ไม่ให้ user เห็นหน้าว่างเปล่า
        SalesDashboard._showSkeleton(document.getElementById('db-dashboard-wrap'));

        await Promise.all([
            SalesDashboard._loadData(ym),
            SalesDashboard._loadTarget(ym)
        ]);
        SalesDashboard._render();
        // ✅ FIX: ลบบรรทัดนี้ออก — _loadData เขียน _rowCache แล้ว การเขียนซ้ำที่นี่
        // จะ overwrite ด้วยค่าที่อาจผิด (ถ้า _rows ถูกแก้โดย concurrent call อื่น)
    },

    // ─── Shared chunk cache + in-flight dedup ────────────────────────────
    // key = YYYY_MM, value = rows[] ทั้งหมด (ไม่กรอง sCode)
    // ใช้ร่วมกัน: SalesDashboard, SupervisorDashboard, StoreHistory, _renderCampaigns
    _chunkCache: {},
    _chunkInflight: {},   // ✅ PERF: กัน concurrent call fetch chunk ซ้ำ (Promise reuse)

    _loadChunks: async (ym) => {
        // 1. มีใน cache แล้ว และไม่ใช่ผลจาก error → คืนทันที
        if (SalesDashboard._chunkCache[ym] !== undefined) return SalesDashboard._chunkCache[ym];

        // 2. มี request กำลัง in-flight อยู่ → รอ Promise เดิม ไม่ fetch ซ้ำ
        if (SalesDashboard._chunkInflight[ym]) return SalesDashboard._chunkInflight[ym];

        // 3. สร้าง Promise และเก็บไว้ใน _chunkInflight
        SalesDashboard._chunkInflight[ym] = (async () => {
            try {
                // ✅ FIX: ใช้ _ymKey เพื่อแยก key ตาม centerId
                const key = SalesDashboard._ymKey(ym);
                const chunkListSnap = await db.collection('sellout').doc(key)
                    .collection('chunks').get();

                if (chunkListSnap.empty) {
                    SalesDashboard._chunkCache[ym] = [];
                    return [];
                }

                const chunkDocs = chunkListSnap.docs
                    .sort((a, b) => (a.data().index || 0) - (b.data().index || 0));

                // ✅ PERF: concat rows ตรงใน loop (chunkDocs อยู่ใน memory แล้วหลัง .get())
                let rows = [];
                let failCount = 0;
                for (const doc of chunkDocs) {
                    try {
                        const chunkRows = doc.data().rows;
                        if (Array.isArray(chunkRows)) rows = rows.concat(chunkRows);
                    } catch (e) {
                        failCount++;
                        console.warn(`[Dashboard] chunk parse failed:`, e);
                    }
                }

                if (failCount > 0) {
                    console.warn(`[Dashboard] ${failCount}/${chunkDocs.length} chunks parse ไม่สำเร็จ`);
                    SalesDashboard._showDataWarning(failCount, chunkDocs.length);
                }

                // ✅ FIX: cache เฉพาะเมื่อสำเร็จและมี rows จริง
                // ถ้า rows ว่างเพราะ error (404 ฯลฯ) ให้ retry ได้ครั้งหน้า
                if (rows.length > 0 || failCount === 0) {
                    SalesDashboard._chunkCache[ym] = rows;
                }
                return rows;
            } catch (e) {
                console.warn('SalesDashboard._loadChunks:', ym, e);
                // ✅ FIX: ไม่ cache [] เมื่อ error → ให้ retry ได้ครั้งหน้า
                return [];
            } finally {
                // ✅ ลบ in-flight ออกหลัง resolve/reject เสมอ
                delete SalesDashboard._chunkInflight[ym];
            }
        })();

        return SalesDashboard._chunkInflight[ym];
    },

    // ✅ NEW: แสดง banner เมื่อ offline จริง (ตรวจ navigator.onLine)
    _showOfflineBanner: () => {
        if (document.getElementById('_offline-banner')) return;
        const banner = document.createElement('div');
        banner.id = '_offline-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#78350f;font-size:12px;font-weight:700;text-align:center;padding:6px 16px;font-family:Prompt,sans-serif;';
        banner.textContent = '📡 ไม่มีอินเทอร์เน็ต — ข้อมูลอาจไม่ใช่ล่าสุด';
        document.body.prepend(banner);
        window.addEventListener('online', () => banner.remove(), { once: true });
    },

    // เริ่ม listen online/offline event ครั้งเดียวตอน init
    _initOfflineListener: () => {
        window.addEventListener('offline', () => SalesDashboard._showOfflineBanner());
        window.addEventListener('online',  () => document.getElementById('_offline-banner')?.remove());
    },

    // ✅ NEW: แจ้งเตือนเมื่อมี chunk โหลดไม่สำเร็จ
    _showDataWarning: (failCount, total) => {
        const existing = document.getElementById('_chunk-warn');
        if (existing) existing.remove();
        const warn = document.createElement('div');
        warn.id = '_chunk-warn';
        warn.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:9998;background:#dc2626;color:#fff;font-size:12px;font-weight:700;border-radius:10px;padding:8px 16px;font-family:Prompt,sans-serif;text-align:center;';
        warn.textContent = `⚠️ โหลดข้อมูลได้ ${total - failCount}/${total} ส่วน — ข้อมูลอาจไม่ครบ`;
        document.body.appendChild(warn);
        setTimeout(() => warn.remove(), 5000);
    },

    _loadData: async (ym) => {
        try {
            // ✅ FIX: ตรวจ _ok flag — retry ได้เฉพาะเมื่อ error จริง
            if (SalesDashboard._rowCache[ym]?._ok !== undefined) {
                SalesDashboard._rows = SalesDashboard._rowCache[ym].rows;
                return;
            }
            const u = SalesDashboard._username;
            const allRows = await SalesDashboard._loadChunks(ym);

            // ✅ FIX: กรอง sCode ของตัวเอง
            const filtered = u
                ? allRows.filter(r => String(r.sCode || '').toUpperCase() === u)
                : [];

            SalesDashboard._rows = filtered;

            // ✅ FIX: cache ถ้า allRows โหลดสำเร็จ (แม้ filtered จะว่าง)
            // "ว่างเพราะไม่มียอดเดือนนั้น" ≠ "ว่างเพราะ error"
            // ตรวจ allRows มีข้อมูล = โหลด chunk สำเร็จแล้ว
            if (allRows.length > 0 || SalesDashboard._chunkCache[ym] !== undefined) {
                SalesDashboard._rowCache[ym] = { rows: filtered, _ok: true };
            }
        } catch (e) {
            console.warn('SalesDashboard._loadData:', e);
            // ไม่ cache เมื่อ error จริง → retry ได้ครั้งหน้า
        }
    },

    // ─── โหลด Target ──────────────────────────────────────────────────────
    _loadTarget: async (ym) => {
        try {
            const key = SalesDashboard._ymKey(ym);
            const doc = await db.collection('targets').doc(key).get();
            if (!doc.exists) return;
            const routes = doc.data().routes || {};
            SalesDashboard._target = routes[SalesDashboard._username] || 0;
        } catch (e) {
            SalesDashboard._target = 0;
        }
    },

    // ─── Toggle Gross / Net ───────────────────────────────────────────────
    setMode: (_) => { /* ล็อคเป็น net เสมอ */ },

    _amt: (r) => SalesDashboard._mode === 'gross' ? (r.gross || 0) : (r.net || 0),

    // ─── Render ───────────────────────────────────────────────────────────
    _render: () => {
        const rows = SalesDashboard._rows;
        const empty = document.getElementById('db-empty');

        if (!rows.length) {
            SalesDashboard._showEmpty();
            return;
        }
        if (empty) empty.style.display = 'none';

        // แยก Invoiced vs Credit Note
        const invoicedRows = rows.filter(r => r.invStatus === 'Invoiced');
        const cnRows       = rows.filter(r => r.invStatus === 'Credit Note');

        const mainRows    = invoicedRows.filter(r => !SalesDashboard.EXCLUDED_BRANDS.has(r.brandDesc));

        const total    = mainRows.reduce((s, r) => s + SalesDashboard._amt(r), 0);
        const outletM  = SalesDashboard._calcOutletMetrics(invoicedRows);
        const invCount = new Set(mainRows.map(r => r.invNum)).size;
        const target   = SalesDashboard._target;
        const pct      = target > 0 ? (total / target * 100) : null;

        // ─ Credit breakdown (สำหรับ C-route) ─
        const isCredit = /C\d/i.test(SalesDashboard._myRoute);
        if (isCredit) {
            // ใช้ deliveryStatus แยก Confirm vs Pending
            const cConfirm  = invoicedRows.filter(r => String(r.deliveryStatus||'').toLowerCase() === 'confirm');
            const cPending  = invoicedRows.filter(r => String(r.deliveryStatus||'').toLowerCase() === 'pending');
            const cCN       = cnRows;
            const totalConfirm = cConfirm.reduce((s,r) => s + r.net, 0);
            const totalSO      = invoicedRows.reduce((s,r) => s + r.soNet, 0);
            const totalCN      = cCN.reduce((s,r) => s + r.net, 0);
            const pendBills    = new Set(cPending.map(r => r.invNum || r.soNum).filter(Boolean)).size;
            const confBills    = new Set(cConfirm.map(r => r.invNum).filter(Boolean)).size;
            const pendRows     = cPending; // ส่งให้ modal ดูรายละเอียด

            SalesDashboard._renderCreditSection({
                totalConfirm, totalSO, totalCN, pendBills, confBills, pendRows
            });
        }

        // ─ KPI Cards ─
        SalesDashboard._setText('db-kpi-total', SalesDashboard._fmt(total));
        SalesDashboard._setText('db-kpi-total-sub', 'ยอดขาย');
        SalesDashboard._setText('db-kpi-shops', outletM.outletCount.toLocaleString());
        SalesDashboard._setText('db-kpi-avgsku', SalesDashboard._fmtSku(outletM.avgSku));
        SalesDashboard._setText('db-kpi-avgvol-v', outletM.v.outletCount > 0 ? Math.round(outletM.v.avgVol).toLocaleString('th-TH') : '—');
        SalesDashboard._setText('db-kpi-avgvol-c', outletM.c.outletCount > 0 ? Math.round(outletM.c.avgVol).toLocaleString('th-TH') : '—');
        SalesDashboard._setText('db-kpi-inv', invCount.toLocaleString());

        if (pct !== null) {
            const cls = pct >= 100 ? 'pct-good' : pct >= 80 ? 'pct-ok' : 'pct-bad';
            const el = document.getElementById('db-kpi-pct');
            if (el) { el.textContent = pct.toFixed(1) + '%'; el.className = 'db-kpi-num ' + cls; }
        } else {
            SalesDashboard._setText('db-kpi-pct', 'ไม่มี Target');
            const el = document.getElementById('db-kpi-pct');
            if (el) el.style.fontSize = '13px';
        }

        // ─ Target Progress Bar ─
        const barEl = document.getElementById('db-target-bar');
        const pctLbl = document.getElementById('db-target-pct-label');
        if (barEl) {
            const w = pct !== null ? Math.min(pct, 100) : 0;
            barEl.style.width = w + '%';
            barEl.style.background = pct === null ? '#e5e7eb' : pct >= 100 ? '#059669' : pct >= 80 ? '#d97706' : '#dc2626';
        }
        if (pctLbl) {
            pctLbl.textContent = pct !== null ? pct.toFixed(1) + '%' : '—';
            pctLbl.className = pct === null ? '' : pct >= 100 ? 'pct-good' : pct >= 80 ? 'pct-ok' : 'pct-bad';
        }
        SalesDashboard._setText('db-target-sold', 'ยอดขาย: ' + SalesDashboard._fmt(total));
        SalesDashboard._setText('db-target-goal', target > 0 ? 'Target: ' + SalesDashboard._fmt(target) : 'Target: ยังไม่ตั้ง');

        // ─ Category หลัก ─
        SalesDashboard._renderBars('db-cat-body', mainRows, '#2563eb');



    },

    // ─── Credit Section (เฉพาะ C-route) ────────────────────────────────────
    _renderCreditSection: ({ totalConfirm, totalSO, totalCN, pendBills, confBills, pendRows = [] }) => {
        let el = document.getElementById('db-credit-section');
        if (!el) {
            const ref = document.getElementById('db-cat-body')?.closest('.db-card');
            if (!ref) return;
            el = document.createElement('div');
            el.id = 'db-credit-section';
            el.className = 'db-card';
            el.style.borderLeft = '4px solid #7c3aed';
            ref.parentElement.insertBefore(el, ref);
        }
        const totalPending = pendRows.reduce((s,r) => s + (r.net||0), 0);
        el.innerHTML = `
            <div style="font-size:10px;font-weight:700;color:#7c3aed;margin-bottom:8px;">💳 Credit — รายละเอียด</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div style="background:#f5f3ff;border-radius:10px;padding:10px;border:1px solid #ddd6fe;">
                    <div style="font-size:9px;font-weight:700;color:#7c3aed;margin-bottom:2px;">✅ ยอด Confirm</div>
                    <div style="font-size:18px;font-weight:900;color:#5b21b6;">${SalesDashboard._fmt(totalConfirm)}</div>
                    <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${confBills} บิล</div>
                </div>
                <div style="background:#fffbeb;border-radius:10px;padding:10px;border:1px solid #fde68a;cursor:pointer;"
                     onclick="SalesDashboard._showPendingModal()">
                    <div style="font-size:9px;font-weight:700;color:#b45309;margin-bottom:2px;">⏳ รอ Confirm</div>
                    <div style="font-size:18px;font-weight:900;color:#92400e;">${SalesDashboard._fmt(totalPending)}</div>
                    <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${pendBills} บิล · <span style="color:#6366f1;font-weight:800;">ดูรายการ →</span></div>
                </div>
            </div>
            <div style="background:#f8fafc;border-radius:10px;padding:8px 10px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;${totalCN !== 0 ? ';margin-bottom:8px' : ''};">
                <div style="font-size:9px;font-weight:700;color:#374151;">📋 ยอดเปิดบิล (SO)</div>
                <div style="font-size:14px;font-weight:900;color:#374151;">${SalesDashboard._fmt(totalSO)}</div>
            </div>
            ${totalCN !== 0 ? `
            <div style="background:#fef2f2;border-radius:10px;padding:8px 10px;border:1px solid #fecaca;display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:9px;font-weight:700;color:#dc2626;">📝 Credit Note (CN)</div>
                <div style="font-size:16px;font-weight:900;color:#dc2626;">${SalesDashboard._fmt(totalCN)}</div>
            </div>` : ''}`;
        SalesDashboard._pendingRows = pendRows;
    },

    _pendingRows: [],

    _showPendingModal: () => {
        const rows = SalesDashboard._pendingRows || [];
        const byInv = {};
        rows.forEach(r => {
            const inv = r.invNum || r.soNum || '—';
            if (!byInv[inv]) byInv[inv] = { custName: r.custName, net: 0, items: 0, kpiDate: r.kpiDate };
            byInv[inv].net += r.net || 0;
            byInv[inv].items++;
        });
        const sorted = Object.entries(byInv).sort((a,b) => b[1].net - a[1].net);
        const totalPend = sorted.reduce((s,[,d]) => s + d.net, 0);
        let modal = document.getElementById('sales-pending-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sales-pending-modal';
            modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px;';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
        <div style="background:#fff;border-radius:24px;width:100%;max-width:480px;max-height:88dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.3);">
            <div style="padding:16px 18px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div>
                    <div style="font-size:14px;font-weight:900;color:#111827;">⏳ Invoice รอ Confirm</div>
                    <div style="font-size:11px;color:#9ca3af;">${sorted.length} invoice · ${SalesDashboard._fmt(totalPend)}</div>
                </div>
                <button onclick="document.getElementById('sales-pending-modal').style.display='none'"
                    style="width:28px;height:28px;border-radius:50%;border:1px solid #e5e7eb;background:#fff;color:#9ca3af;font-size:13px;cursor:pointer;font-weight:700;">✕</button>
            </div>
            <div style="flex:1;overflow-y:auto;padding:10px 16px;">
                ${sorted.length === 0
                    ? '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px;">ไม่มี invoice รอ Confirm</div>'
                    : sorted.map(([inv, d]) => `
                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:9px 12px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:11px;font-weight:900;color:#111827;font-family:monospace;">${inv}</div>
                            <div style="font-size:10px;color:#6b7280;">${d.custName || '—'}</div>
                            ${d.kpiDate ? `<div style="font-size:10px;color:#9ca3af;">${d.kpiDate}</div>` : ''}
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:13px;font-weight:900;color:#b45309;">${SalesDashboard._fmt(d.net)}</div>
                            <div style="font-size:10px;color:#9ca3af;">${d.items} รายการ</div>
                        </div>
                    </div>`).join('')}
            </div>
        </div>`;
        modal.style.display = 'flex';
    },

    // ─── Render horizontal bars ──────────────────────────────────────────
    _renderBars: (elId, rows, color, keyFn) => {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!rows.length) { el.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:12px;">ไม่มียอด</div>'; return; }

        // Group by category or custom key
        const getKey = keyFn || (r => r.brandDesc);
        const byKey = {};
        rows.forEach(r => { byKey[getKey(r)] = (byKey[getKey(r)] || 0) + SalesDashboard._amt(r); });
        const sorted = Object.entries(byKey).sort((a, b) => b[1] - a[1]);
        const total  = sorted.reduce((s, [, v]) => s + v, 0);
        const max    = sorted[0]?.[1] || 1;

        el.innerHTML = sorted.map(([key, amt]) => {
            const pct  = total > 0 ? (amt / total * 100).toFixed(1) : '0.0';
            const barW = Math.round((amt / max) * 100);
            return `
            <div class="db-row">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                        <span style="font-weight:700;font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;">${key}</span>
                        <span style="font-size:11px;font-weight:800;color:#6b7280;">${pct}%</span>
                    </div>
                    <div class="db-bar-track">
                        <div class="db-bar-fill" style="width:${barW}%;background:${color};"></div>
                    </div>
                    <div style="font-size:11px;font-weight:800;color:#111827;margin-top:2px;">${SalesDashboard._fmt(amt)}</div>
                </div>
            </div>`;
        }).join('');
    },

    _showEmpty: () => {
        const empty = document.getElementById('db-empty');
        if (empty) empty.style.display = 'block';
        // Clear all KPIs
        ['db-kpi-total','db-kpi-pct','db-kpi-shops','db-kpi-avgsku','db-kpi-avgvol-v','db-kpi-avgvol-c','db-kpi-inv'].forEach(id => SalesDashboard._setText(id, '—'));
        ['db-cat-body','db-shop-body'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:12px;">ยังไม่มีข้อมูล</div>';
        });
        const bar = document.getElementById('db-target-bar');
        if (bar) bar.style.width = '0%';
    },

    _setText: (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    },

    _fmt: (n) => {
        if (!n || isNaN(n)) return '0';
        return Math.round(n).toLocaleString('th-TH');
    },

    // ─── โหลด Active Campaigns ────────────────────────────────────────────
    _waitAndLoadCampaigns: () => {
        // ✅ FIX: เพิ่ม maxTries กันวนซ้ำไม่หยุด + เช็ค role ก่อน (route_sup/asm ไม่มี allStores จน selectRoute)
        let tries = 0;
        const MAX_TRIES = 20; // 10 วินาที
        const check = () => {
            tries++;
            if (tries > MAX_TRIES) {
                console.warn('[SalesDashboard] _waitAndLoadCampaigns: timeout หลัง', MAX_TRIES, 'tries');
                return;
            }
            const stateReady = typeof State !== 'undefined' && State.isLoaded && State.myRoute;
            // route_supervisor/asm: allStores ว่างจน selectRoute → ใช้แค่ stateReady
            const isSup = typeof App !== 'undefined' && App.isSupervisor();
            const ok = isSup ? stateReady : (stateReady && State.allStores?.length > 0);
            if (ok) {
                SalesDashboard._loadCampaigns();
            } else {
                setTimeout(check, 500);
            }
        };
        setTimeout(check, 500);
    },

    _loadCampaigns: async () => {
        try {
            const centerDoc = window.CENTER_DOC || Auth.getSession()?.centerDoc || '';
            if (!centerDoc) return;
            const snap = await db.collection('skuDistribution')
                .where('centerId', '==', centerDoc)
                .get();
            SalesDashboard._campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // render campaigns หลังโหลดเสร็จ (ไม่ขึ้นกับเดือนที่เลือก)
            await SalesDashboard._renderCampaigns();
        } catch (e) {
            console.warn('SalesDashboard._loadCampaigns:', e);
            SalesDashboard._campaigns = [];
        }
    },

    // ─── Render Campaign Coverage สำหรับสายตัวเอง ────────────────────────
    _renderCampaigns: async () => {
        const el = document.getElementById('db-campaign-section');
        if (!el) return;

        const route = SalesDashboard._myRoute;
        if (!route) { el.innerHTML = ''; return; }

        // กรองเฉพาะ campaign ที่ยังไม่หมดอายุ (endYM >= เดือนปัจจุบัน)
        const nowYM = (typeof DateUtil !== 'undefined')
            ? DateUtil.currentYM()
            : (() => { const d = new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`; })();

        const active = SalesDashboard._campaigns.filter(c =>
            c.endYM >= nowYM && (c.groups || []).length > 0
        );
        if (!active.length) { el.innerHTML = ''; return; }

        // แสดง loading
        el.innerHTML = `<div class="db-card" style="flex-shrink:0;margin-bottom:12px;border-left:4px solid #ec4899;text-align:center;padding:16px;color:#9ca3af;font-size:12px;">⏳ กำลังโหลดข้อมูล campaign...</div>`;

        // โหลด prodOptions ถ้ายังไม่มี
        let prodOptions = [];
        if (typeof SkuDist !== 'undefined' && SkuDist._allProdOptions.length > 0) {
            prodOptions = SkuDist._allProdOptions;
        } else {
            try {
                // ✅ PERF: ใช้ _loadChunks → share cache กับ dashboard ไม่ fetch Firestore ซ้ำ
                const listSnap = await db.collection('sellout').get();
                const _cid2 = window.CENTER_ID || Auth.getSession()?.centerId || '';
                const _pfx2 = _cid2 ? `${_cid2}_` : '';
                const months = listSnap.docs
                    .map(d => d.id)
                    .filter(id => _pfx2 ? id.startsWith(_pfx2) : /^\d{4}_\d{2}$/.test(id))
                    .map(id => _pfx2 ? id.slice(_pfx2.length) : id)
                    .filter(ym => /^\d{4}_\d{2}$/.test(ym))
                    .sort().reverse();
                if (months.length) {
                    const firstMonthRows = await SalesDashboard._loadChunks(months[0]);
                    const seen = new Map();
                    firstMonthRows.forEach(r => {
                        const code = String(r.prodCode || '').trim();
                        const name = String(r.prodName || '').trim();
                        if (code && !seen.has(code)) seen.set(code, name);
                    });
                    prodOptions = [...seen.entries()].map(([code, name]) => ({ code, name }));
                }
            } catch(e) { /* ไม่กระทบ */ }
        }

        // ร้านในสายตัวเอง
        // Sales app ใช้ State.allStores (ไม่ใช่ State.db.routes)
        const myStores = (typeof State !== 'undefined' && State.allStores?.length > 0)
            ? (typeof State !== 'undefined' ? State.allStores.map(s => String(s.id)) : [])
            : [];
        const myStoreSet  = new Set(myStores);
        const totalStores = myStores.length;

        // helper: สร้าง range เดือน
        const getRange = (startYM, endYM) => {
            const months = [];
            let [y, m] = startYM.split('_').map(Number);
            const [ey, em] = endYM.split('_').map(Number);
            while (y < ey || (y === ey && m <= em)) {
                months.push(`${y}_${String(m).padStart(2,'0')}`);
                m++; if (m > 12) { m = 1; y++; }
            }
            return months;
        };

        // helper: โหลด rows ของเดือนนั้น (ใช้ shared cache)
        const loadMonthRows = async (ym) => {
            // ใช้ _chunkCache แล้วกรองเฉพาะร้านตัวเอง
            const allRows = await SalesDashboard._loadChunks(ym);
            const filtered = myStoreSet.size > 0
                ? allRows.filter(r => myStoreSet.has(String(r.custCode || '')))
                : allRows;
            return filtered;
        };

        // render แต่ละ campaign — โหลด months parallel ด้วย Promise.all
        const cardsHtml = await Promise.all(active.map(async campaign => {
            const groups        = campaign.groups || [];
            const targetUnit    = campaign.targetUnit || 'pct';
            const defaultTarget = campaign.defaultTarget ?? 80;
            const rawTargets    = campaign.routeTargets || {};

            // target สำหรับสายนี้
            const rawTgt  = rawTargets[route] ?? null;
            const tgtPct  = rawTgt !== null
                ? (targetUnit === 'count'
                    ? (totalStores > 0 ? Math.round(rawTgt / totalStores * 100) : 0)
                    : rawTgt)
                : defaultTarget;
            const tgtCount = Math.round(tgtPct / 100 * totalStores);

            // โหลด rows ทุกเดือนใน campaign range — parallel
            const months = getRange(campaign.startYM, campaign.endYM);
            const monthResults = await Promise.all(months.map(ym => loadMonthRows(ym)));
            let allRows = monthResults.flat();

            const groupBars = groups.map(g => {
                const kws = (g.keywords || []).map(k => k.toLowerCase());
                const matched = allRows.filter(r => {
                    const code = (r.prodCode || '').toLowerCase();
                    const name = (r.prodName || '').toLowerCase();
                    return kws.some(k => code.includes(k) || name.includes(k));
                });
                const bought      = new Set(matched.map(r => String(r.custCode)));
                const boughtCount = bought.size;
                const pct         = totalStores > 0 ? Math.round(boughtCount / totalStores * 100) : 0;
                const vs          = pct - tgtPct;
                const color       = pct >= tgtPct ? '#10b981' : pct >= tgtPct * 0.8 ? '#f59e0b' : '#ef4444';

                // SKU coverage
                const targetSkus = new Set(prodOptions
                    .filter(p => kws.some(k =>
                        p.code.toLowerCase().includes(k) || p.name.toLowerCase().includes(k)))
                    .map(p => p.code));
                const soldSkus  = new Set(matched.map(r => r.prodCode).filter(Boolean));
                const skuPct    = targetSkus.size > 0
                    ? Math.round(soldSkus.size / targetSkus.size * 100)
                    : (soldSkus.size > 0 ? 100 : 0);

                return `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                        <span style="font-size:12px;font-weight:700;color:#374151;">${g.name}</span>
                        <span style="font-size:14px;font-weight:900;color:${color};">${pct}%</span>
                    </div>
                    <div style="position:relative;height:10px;background:#e5e7eb;border-radius:99px;overflow:visible;margin-bottom:5px;">
                        <div style="width:${Math.min(pct,100)}%;height:10px;background:${color};border-radius:99px;"></div>
                        <div style="position:absolute;left:${Math.min(tgtPct,100)}%;top:-3px;width:2px;height:16px;background:#6366f1;border-radius:1px;" title="target ${tgtPct}%"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:10px;">
                        <span style="color:#111827;font-weight:700;">${boughtCount}<span style="color:#9ca3af;font-weight:400;">/${tgtCount} ร้าน (target)</span></span>
                        <span style="color:${vs >= 0 ? '#10b981' : '#ef4444'};font-weight:700;">${vs >= 0 ? '+' : ''}${vs}% vs target</span>
                    </div>
                    <div style="font-size:10px;color:#9ca3af;margin-top:3px;">
                        ร้านทั้งหมดในสาย ${totalStores} ร้าน &nbsp;|&nbsp;
                        SKU coverage: <span style="font-weight:700;color:#6366f1;">${skuPct}% (${soldSkus.size}/${targetSkus.size} SKU)</span>
                    </div>
                </div>`;
            }).join('');

            const startLbl = typeof DateUtil !== 'undefined' ? DateUtil.ymToThaiShort(campaign.startYM) : campaign.startYM;
            const endLbl   = typeof DateUtil !== 'undefined' ? DateUtil.ymToThaiShort(campaign.endYM)   : campaign.endYM;

            return `
            <div class="db-card" style="flex-shrink:0;margin-bottom:12px;border-left:4px solid #ec4899;">
                <div style="margin-bottom:12px;">
                    <div style="font-size:12px;font-weight:900;color:#111827;">🎯 ${campaign.name}</div>
                    <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${startLbl} → ${endLbl} &nbsp;·&nbsp; ยอดรวมทั้งช่วง</div>
                </div>
                ${groupBars}
            </div>`;
        }));

        el.innerHTML = cardsHtml.join('');
    },


};

// ─── Hook เข้า App.start() ── เรียก init หลัง login สำเร็จ ─────────────
// ✅ FIX: เช็ค viewMode และ isLoaded พร้อมกัน — isSupervisor() ใช้ State.viewMode
// ซึ่ง set ใน App.checkAuth() → startSupervisor() ก่อน State.isLoaded = true
document.addEventListener('DOMContentLoaded', () => {
    let _initTries = 0;
    const MAX_INIT = 40; // 20 วินาที
    const _tryInit = () => {
        _initTries++;
        if (_initTries > MAX_INIT) {
            console.warn('[Dashboard] init timeout');
            return;
        }
        if (typeof State === 'undefined' || !State.isLoaded) {
            return setTimeout(_tryInit, 500);
        }
        // ✅ เช็ค viewMode โดยตรง ไม่ใช้ App.isSupervisor() ซึ่งอาจ race กัน
        const role = Auth.getSession()?.role || '';
        const isSup = role === 'route_supervisor' || role === 'asm';
        if (isSup) {
            SupervisorDashboard.init();
        } else if (role === 'sales') {
            SalesDashboard.init();
        }
        // supervisor role → ไม่ init dashboard ใน sales-dashboard.js
    };
    setTimeout(_tryInit, 1000);
});

// ==========================================
// 📊 SupervisorDashboard — Route Supervisor / ASM
// เห็นทุกสาย แยก C (Credit) / V (Van)
// Credit: ยอด Confirm + เปิดบิล + บิลรอ Confirm
// ==========================================
const SupervisorDashboard = {

    _ym: '',
    _allRows: [],       // rows ทุกสายของเดือนที่เลือก
    _targets: {},       // { routeId: target }
    _rowCache: {},      // { ym: rows[] }

    EXCLUDED_BRANDS: new Set(['อื่นๆ', 'กระเช้าของขวัญ']),

    init: () => {
        const _session = Auth.getSession();
        const lbl = document.getElementById('db-route-label');
        if (lbl) {
            const _roleLabel = _session?.role === 'asm' ? 'ASM' : 'Supervisor';
            const _name = _session?.displayName || _session?.username || '';
            lbl.textContent = `${_roleLabel} · ${_name} · ศูนย์ ${_session?.centerId || ''}`;
        }
        SupervisorDashboard._loadMonthList();
    },

    // ✅ เพิ่ม alias ให้ sales-app.js เรียกได้โดยตรงโดยไม่ต้องรอ DOMContentLoaded poll
    initSupervisor: () => SupervisorDashboard.init(),

    _loadMonthList: async () => {
        try {
            // ✅ PERF: แสดง skeleton ทันทีก่อน fetch
            const sel = document.getElementById('db-month-sel');
            if (typeof SalesDashboard._showSkeleton === 'function') {
                const container = document.getElementById('db-dashboard-wrap') ||
                                  document.getElementById('dashboard-tab');
                SalesDashboard._showSkeleton(container);
            }

            const snap = await db.collection('sellout').get();
            // ✅ FIX: กรองเฉพาะ doc ของศูนย์นี้ แล้วแปลง key กลับเป็น YYYY_MM
            const _cid = window.CENTER_ID || Auth.getSession()?.centerId || '';
            const _prefix = _cid ? `${_cid}_` : '';
            const months = snap.docs
                .map(d => d.id)
                .filter(id => _prefix ? id.startsWith(_prefix) : /^\d{4}_\d{2}$/.test(id))
                .map(id => _prefix ? id.slice(_prefix.length) : id)
                .filter(ym => /^\d{4}_\d{2}$/.test(ym))
                .sort().reverse();

            if (!sel) return;
            sel.innerHTML = '<option value="">-- เดือน --</option>' +
                months.map(ym => {
                    const [y, m] = ym.split('_');
                    const label = new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { year:'numeric', month:'short' });
                    return `<option value="${ym}">${label}</option>`;
                }).join('');

            if (months.length > 0) {
                await new Promise(r => requestAnimationFrame(r));
                sel.value = months[0];
                if (sel.value !== months[0]) sel.selectedIndex = 1;
                await SupervisorDashboard.onMonthChange(months[0]);

                // ✅ PERF: preload เดือนอื่น background — staggered ทุก 2.5 วิ ไม่บล็อก render
                months.slice(1).forEach((ym, i) => {
                    setTimeout(() => {
                        // preload chunk cache ไว้ล่วงหน้า (Supervisor ใช้ shared cache)
                        SalesDashboard._loadChunks(ym).catch(() => {});
                        SupervisorDashboard._loadTargets(ym).catch(() => {});
                    }, (i + 1) * 2500);
                });
            }
        } catch(e) { console.warn('SupervisorDashboard._loadMonthList:', e); }
    },

    onMonthChange: async (ym) => {
        if (!ym) return;
        SupervisorDashboard._ym = ym;
        SupervisorDashboard._allRows = [];
        await Promise.all([
            SupervisorDashboard._loadData(ym),
            SupervisorDashboard._loadTargets(ym),
        ]);
        SupervisorDashboard._render();
    },

    _loadData: async (ym) => {
        const centerId = (typeof State !== 'undefined' ? State.centerId : null) || Auth.getSession()?.centerId || '';
        const cacheKey = ym + '_sup_' + centerId;
        // ✅ FIX: ตรวจ _ok flag — retry ได้ถ้า cache มาจาก error
        if (SupervisorDashboard._rowCache[cacheKey]?._ok !== undefined) {
            SupervisorDashboard._allRows = SupervisorDashboard._rowCache[cacheKey].rows;
            return;
        }
        try {
            const allRows = await SalesDashboard._loadChunks(ym);
            const rows = centerId
                ? allRows.filter(r => String(r.sCode || '').startsWith(centerId))
                : allRows;
            if (allRows.length > 0 || SalesDashboard._chunkCache[ym] !== undefined) {
                SupervisorDashboard._rowCache[cacheKey] = { rows, _ok: true };
            }
            SupervisorDashboard._allRows = rows;
        } catch(e) {
            console.warn('SupervisorDashboard._loadData:', e);
            SupervisorDashboard._allRows = [];
        }
    },

    _loadTargets: async (ym) => {
        try {
            const key = SalesDashboard._ymKey(ym);
            const doc = await db.collection('targets').doc(key).get();
            SupervisorDashboard._targets = doc.exists ? (doc.data().routes || {}) : {};
        } catch(e) { SupervisorDashboard._targets = {}; }
    },

    _fmt: (n) => !n ? '0' : Math.round(n).toLocaleString('th-TH'),
    _amtMode: 'net',  // 'gross' | 'net'
    _amt: (r) => SupervisorDashboard._amtMode === 'gross' ? (r.gross||0) : (r.net||0),
    setAmtMode: (mode) => {
        SupervisorDashboard._amtMode = mode;
        // อัป toggle button
        ['gross','net'].forEach(m => {
            const btn = document.getElementById('sup-db-btn-' + m);
            if (btn) btn.style.background = m === mode ? '#6366f1' : '#f3f4f6';
            if (btn) btn.style.color = m === mode ? '#fff' : '#374151';
        });
        SupervisorDashboard._render();
    },

    // ─── Render หลัก ─────────────────────────────────────────────────────
    _render: () => {
        const rows = SupervisorDashboard._allRows;
        const amt  = r => SupervisorDashboard._amt(r);

        // แยก Invoiced vs Credit Note
        const invoicedRows = rows.filter(r => r.invStatus === 'Invoiced');
        const cnRows       = rows.filter(r => r.invStatus === 'Credit Note');
        const mainRows     = invoicedRows.filter(r => !SupervisorDashboard.EXCLUDED_BRANDS.has(r.brandDesc));

        // แยก C / V / L จาก sCode
        const cInvoiced = invoicedRows.filter(r => /C\d/.test(r.sCode));
        const vInvoiced = invoicedRows.filter(r => /V\d/.test(r.sCode));
        const lInvoiced = invoicedRows.filter(r => /L\d/.test(r.sCode));
        const cCN       = cnRows.filter(r => /C\d/.test(r.sCode));

        const totalAll = mainRows.reduce((s,r) => s + amt(r), 0);
        const totalC   = cInvoiced.reduce((s,r) => s + amt(r), 0);
        const totalV   = vInvoiced.reduce((s,r) => s + amt(r), 0);
        const totalL   = lInvoiced.reduce((s,r) => s + amt(r), 0);

        // ─ Credit breakdown ─
        const cConfirm  = cInvoiced.filter(r => String(r.deliveryStatus||'').toLowerCase() === 'confirm');
        const cPending  = cInvoiced.filter(r => String(r.deliveryStatus||'').toLowerCase() === 'pending');
        const totalCConfirm = cConfirm.reduce((s,r) => s + amt(r), 0);
        const totalCPending = cPending.reduce((s,r) => s + amt(r), 0);
        const totalCSO      = cInvoiced.reduce((s,r) => s + (r.soNet||0), 0);
        const totalCCN      = cCN.reduce((s,r) => s + amt(r), 0);
        const confBills     = new Set(cConfirm.map(r => r.invNum).filter(Boolean)).size;
        const pendBills     = new Set(cPending.map(r => r.invNum||r.soNum).filter(Boolean)).size;
        const cnCount       = new Set(cCN.map(r => r.soNum||r.invNum).filter(Boolean)).size;
        const invCountV     = new Set(vInvoiced.map(r => r.invNum).filter(Boolean)).size;
        const invCountAll   = new Set(mainRows.map(r => r.invNum).filter(Boolean)).size;

        // Target รวม
        const targets = SupervisorDashboard._targets;
        const totalTarget = Object.values(targets).reduce((s,v) => s + (v||0), 0);
        const pctAll = totalTarget > 0 ? (totalAll / totalTarget * 100) : null;

        // ─── Render KPI Summary ─────────────────────────────────────────
        const dbEmpty = document.getElementById('db-empty');
        if (dbEmpty) dbEmpty.style.display = 'none';

        const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

        // ─ Gross/Net toggle inject ─
        let toggleEl = document.getElementById('sup-gross-net-toggle');
        if (!toggleEl) {
            const kpiRow = document.getElementById('db-kpi-row');
            if (kpiRow) {
                toggleEl = document.createElement('div');
                toggleEl.id = 'sup-gross-net-toggle';
                toggleEl.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
                toggleEl.innerHTML = `
                    <button id="sup-db-btn-gross" onclick="SupervisorDashboard.setAmtMode('gross')"
                        style="padding:5px 14px;border-radius:8px;font-size:12px;font-weight:800;border:none;cursor:pointer;font-family:inherit;transition:all 0.15s;background:#f3f4f6;color:#374151;">Gross</button>
                    <button id="sup-db-btn-net" onclick="SupervisorDashboard.setAmtMode('net')"
                        style="padding:5px 14px;border-radius:8px;font-size:12px;font-weight:800;border:none;cursor:pointer;font-family:inherit;transition:all 0.15s;background:#6366f1;color:#fff;">Net</button>`;
                kpiRow.parentElement.insertBefore(toggleEl, kpiRow);
            }
        }
        // sync toggle state
        ['gross','net'].forEach(m => {
            const btn = document.getElementById('sup-db-btn-' + m);
            if (btn) {
                btn.style.background = m === SupervisorDashboard._amtMode ? '#6366f1' : '#f3f4f6';
                btn.style.color      = m === SupervisorDashboard._amtMode ? '#fff' : '#374151';
            }
        });

        setText('db-kpi-total', SupervisorDashboard._fmt(totalAll));
        setText('db-kpi-total-sub', SupervisorDashboard._amtMode === 'gross' ? 'ยอด Gross รวมทุกสาย' : 'ยอด Net รวมทุกสาย');
        setText('db-kpi-inv', invCountAll.toLocaleString());
        setText('db-kpi-shops', new Set(mainRows.map(r => r.custCode).filter(Boolean)).size.toLocaleString());

        const pctEl = document.getElementById('db-kpi-pct');
        if (pctEl) {
            if (pctAll !== null) {
                pctEl.textContent = pctAll.toFixed(1) + '%';
                pctEl.className = 'db-kpi-num ' + (pctAll >= 100 ? 'pct-good' : pctAll >= 80 ? 'pct-ok' : 'pct-bad');
            } else {
                pctEl.textContent = 'ไม่มี Target';
                pctEl.className = 'db-kpi-num';
                pctEl.style.fontSize = '13px';
            }
        }

        const barEl = document.getElementById('db-target-bar');
        if (barEl) {
            barEl.style.width = (pctAll !== null ? Math.min(pctAll,100) : 0) + '%';
            barEl.style.background = pctAll === null ? '#e5e7eb' : pctAll >= 100 ? '#059669' : pctAll >= 80 ? '#d97706' : '#dc2626';
        }
        setText('db-target-sold', 'รวม: ' + SupervisorDashboard._fmt(totalAll));
        setText('db-target-goal', totalTarget > 0 ? 'Target: ' + SupervisorDashboard._fmt(totalTarget) : 'Target: ยังไม่ตั้ง');
        const pctLbl = document.getElementById('db-target-pct-label');
        if (pctLbl) pctLbl.textContent = pctAll !== null ? pctAll.toFixed(1) + '%' : '—';

        // ─── Section L / C / V ───────────────────────────────────────────
        const dbCatBody = document.getElementById('db-cat-body');
        if (dbCatBody) {
            const fmt = SupervisorDashboard._fmt;
            dbCatBody.innerHTML = `
            <!-- ═══ L-routes (สีส้ม แยกต่างหาก) ═══ -->
            ${lInvoiced.length > 0 ? `
            <div style="margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:900;color:#ea580c;">📦 L-routes</span>
                    <span style="font-size:14px;font-weight:900;color:#ea580c;">${fmt(totalL)}</span>
                </div>
                ${SupervisorDashboard._renderRouteBreakdown(lInvoiced, '#ea580c')}
            </div>
            <div style="height:1px;background:#f3f4f6;margin:12px 0;"></div>` : ''}

            <!-- ═══ CREDIT (C) ═══ -->
            <div style="margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:900;color:#7c3aed;">💳 Credit (C-routes)</span>
                    <span style="font-size:14px;font-weight:900;color:#7c3aed;">${fmt(totalC)}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <div style="background:#f5f3ff;border-radius:12px;padding:10px 12px;border:1px solid #ddd6fe;">
                        <div style="font-size:9px;font-weight:700;color:#7c3aed;margin-bottom:2px;">✅ ยอด Confirm</div>
                        <div style="font-size:16px;font-weight:900;color:#5b21b6;">${fmt(totalCConfirm)}</div>
                        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${confBills} บิล</div>
                    </div>
                    <div style="background:#fffbeb;border-radius:12px;padding:10px 12px;border:1px solid #fde68a;cursor:pointer;"
                         onclick="SupervisorDashboard._showPendingModal()">
                        <div style="font-size:9px;font-weight:700;color:#b45309;margin-bottom:2px;">⏳ รอ Confirm</div>
                        <div style="font-size:16px;font-weight:900;color:#92400e;">${fmt(totalCPending)}</div>
                        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${pendBills} บิล · <span style="color:#6366f1;font-weight:800;">ดูรายการ →</span></div>
                    </div>
                </div>
                <div style="background:#f8fafc;border-radius:10px;padding:7px 10px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="font-size:9px;font-weight:700;color:#374151;">📋 ยอดเปิดบิล (SO)</span>
                    <span style="font-size:13px;font-weight:900;color:#374151;">${fmt(totalCSO)}</span>
                </div>
                ${totalCCN !== 0 ? `
                <div style="background:#fef2f2;border-radius:10px;padding:8px 12px;border:1px solid #fecaca;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div>
                        <div style="font-size:9px;font-weight:700;color:#dc2626;">📝 Credit Note (CN)</div>
                        <div style="font-size:10px;color:#9ca3af;">${cnCount} CN</div>
                    </div>
                    <div style="font-size:15px;font-weight:900;color:#dc2626;">${fmt(totalCCN)}</div>
                </div>` : ''}
                ${SupervisorDashboard._renderRouteBreakdown(cInvoiced, '#7c3aed')}
            </div>

            <div style="height:1px;background:#f3f4f6;margin:12px 0;"></div>

            <!-- ═══ VAN (V) ═══ -->
            <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:900;color:#2563eb;">🚐 Van (V-routes)</span>
                    <span style="font-size:14px;font-weight:900;color:#2563eb;">${fmt(totalV)}</span>
                </div>
                <div style="background:#eff6ff;border-radius:12px;padding:10px 12px;border:1px solid #bfdbfe;margin-bottom:8px;">
                    <div style="font-size:9px;font-weight:700;color:#1d4ed8;margin-bottom:2px;">📋 บิลขาย</div>
                    <div style="font-size:16px;font-weight:900;color:#1e40af;">${invCountV.toLocaleString()} บิล</div>
                </div>
                ${SupervisorDashboard._renderRouteBreakdown(vInvoiced, '#2563eb')}
            </div>`;
        }

        // ─── Route table ─────────────────────────────────────────────────
        SupervisorDashboard._renderRouteTable(mainRows);
        // เก็บ pendingRows ไว้ให้ modal
        SupervisorDashboard._pendingRows = cPending;
    },

    _pendingRows: [],

    _showPendingModal: () => {
        const rows = SupervisorDashboard._pendingRows || [];
        const byInv = {};
        rows.forEach(r => {
            const inv = r.invNum || r.soNum || '—';
            if (!byInv[inv]) byInv[inv] = { sCode: r.sCode, custName: r.custName, net: 0, items: 0, kpiDate: r.kpiDate };
            byInv[inv].net += r.net || 0;
            byInv[inv].items++;
        });
        const sorted = Object.entries(byInv).sort((a,b) => b[1].net - a[1].net);
        const totalPend = sorted.reduce((s,[,d]) => s + d.net, 0);
        let modal = document.getElementById('sup-pending-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sup-pending-modal';
            modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:16px;';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
        <div style="background:#fff;border-radius:24px;width:100%;max-width:520px;max-height:88dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.3);">
            <div style="padding:16px 18px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div>
                    <div style="font-size:14px;font-weight:900;color:#111827;">⏳ Invoice รอ Confirm</div>
                    <div style="font-size:11px;color:#9ca3af;">${sorted.length} invoice · ${SupervisorDashboard._fmt(totalPend)}</div>
                </div>
                <button onclick="document.getElementById('sup-pending-modal').style.display='none'"
                    style="width:28px;height:28px;border-radius:50%;border:1px solid #e5e7eb;background:#fff;color:#9ca3af;font-size:13px;cursor:pointer;font-weight:700;">✕</button>
            </div>
            <div style="flex:1;overflow-y:auto;padding:10px 16px;">
                ${sorted.length === 0
                    ? '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px;">ไม่มี invoice รอ Confirm</div>'
                    : sorted.map(([inv, d]) => `
                    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:9px 12px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:11px;font-weight:900;color:#111827;font-family:monospace;">${inv}</div>
                            <div style="font-size:10px;color:#6b7280;">${d.sCode} · ${d.custName||'—'}</div>
                            ${d.kpiDate ? `<div style="font-size:10px;color:#9ca3af;">${d.kpiDate}</div>` : ''}
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:13px;font-weight:900;color:#b45309;">${SupervisorDashboard._fmt(d.net)}</div>
                            <div style="font-size:10px;color:#9ca3af;">${d.items} รายการ</div>
                        </div>
                    </div>`).join('')}
            </div>
        </div>`;
        modal.style.display = 'flex';
    },

    _renderRouteBreakdown: (rows, color) => {
        const byRoute = {};
        rows.forEach(r => {
            const s = String(r.sCode||'').toUpperCase();
            if (!s) return;
            if (!byRoute[s]) byRoute[s] = { amt: 0, invs: new Set() };
            byRoute[s].amt += SupervisorDashboard._amt(r);
            if (r.invNum) byRoute[s].invs.add(r.invNum);
        });
        const sorted = Object.entries(byRoute).sort((a,b) => b[1].amt - a[1].amt);
        if (!sorted.length) return '<div style="font-size:11px;color:#9ca3af;padding:6px 0;">ไม่มีข้อมูล</div>';
        const maxAmt = sorted[0][1].amt || 1;
        return sorted.map(([route, d]) => {
            const barW  = Math.round((d.amt / maxAmt) * 100);
            const tgt   = SupervisorDashboard._targets[route] || 0;
            const pct   = tgt > 0 ? (d.amt / tgt * 100) : null;
            const pctTxt = pct !== null ? (pct.toFixed(0) + '%') : '';
            return `
            <div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:11px;font-weight:800;color:#374151;">${route}</span>
                    <span style="font-size:11px;font-weight:700;color:${color};">${SupervisorDashboard._fmt(d.amt)} ${pctTxt ? '<span style="color:#9ca3af;font-weight:400;font-size:10px;">'+pctTxt+'</span>' : ''}</span>
                </div>
                <div style="height:6px;background:#f3f4f6;border-radius:99px;overflow:hidden;">
                    <div style="height:6px;background:${color};border-radius:99px;width:${barW}%;opacity:0.7;"></div>
                </div>
            </div>`;
        }).join('');
    },

    // ─── ตารางรายสายด้านล่าง ─────────────────────────────────────────────
    _renderRouteTable: (mainRows) => {
        const shopEl = document.getElementById('db-shop-body');
        if (!shopEl) return;
        const byRoute = {};
        mainRows.forEach(r => {
            const s = String(r.sCode||'').toUpperCase();
            if (!s) return;
            if (!byRoute[s]) byRoute[s] = { amt: 0, outlets: new Set(), invs: new Set() };
            byRoute[s].amt += SupervisorDashboard._amt(r);
            if (r.custCode) byRoute[s].outlets.add(String(r.custCode));
            if (r.invNum)   byRoute[s].invs.add(r.invNum);
        });
        const sorted = Object.entries(byRoute).sort((a,b) => a[0].localeCompare(b[0],'th',{numeric:true}));
        const targets = SupervisorDashboard._targets;
        const maxAmt  = sorted.reduce((m,[,d]) => Math.max(m, d.amt), 0) || 1;

        shopEl.innerHTML = sorted.map(([route, d]) => {
            const tgt   = targets[route] || 0;
            const pct   = tgt > 0 ? (d.amt / tgt * 100) : null;
            const barW  = Math.round((d.amt / maxAmt) * 100);
            const isL   = /L\d/.test(route);
            const isC   = /C\d/.test(route);
            const color = isL ? '#ea580c' : isC ? '#7c3aed' : pct === null ? '#6366f1' : pct >= 100 ? '#059669' : pct >= 80 ? '#d97706' : '#dc2626';
            const pctBadge = pct !== null
                ? `<span style="font-size:9px;font-weight:800;color:${color};background:${color}18;padding:1px 5px;border-radius:6px;">${pct.toFixed(0)}%</span>`
                : '';
            return `
            <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span style="font-size:12px;font-weight:800;color:#374151;">${route} ${pctBadge}</span>
                    <span style="font-size:11px;font-weight:800;color:#111827;">${SupervisorDashboard._fmt(d.amt)}</span>
                </div>
                <div style="height:5px;background:#f3f4f6;border-radius:99px;overflow:hidden;margin-bottom:3px;">
                    <div style="height:5px;background:${color};border-radius:99px;width:${barW}%;"></div>
                </div>
                <div style="font-size:10px;color:#9ca3af;">
                    ${d.outlets.size} ร้าน · ${d.invs.size} บิล
                    ${tgt > 0 ? '· tgt ' + SupervisorDashboard._fmt(tgt) : ''}
                </div>
            </div>`;
        }).join('') || '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:12px;">ไม่มีข้อมูล</div>';

    },
};

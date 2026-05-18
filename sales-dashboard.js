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
    _campaigns: [],      // active campaigns ของศูนย์นี้
    _rowCache: {},       // { 'YYYY_MM': rows[] } cache ไม่ต้องโหลดซ้ำ
    _ready: false,

    EXCLUDED_CATS: new Set(['อื่นๆ', 'กระเช้าของขวัญ']),

    _calcOutletMetrics: (rows) => {
        const filtered = rows.filter(r => !SalesDashboard.EXCLUDED_CATS.has(r.catDesc));
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

        // แสดงชื่อสายใน header
        const lbl = document.getElementById('db-route-label');
        if (lbl) lbl.textContent = SalesDashboard._username;

        // ดึง route จาก session หรือ State
        const myRoute = Auth.getSession()?.username?.toUpperCase() || '';
        SalesDashboard._myRoute = myRoute;

        SalesDashboard._ready = true;
        SalesDashboard._ensureKpiCards();
        SalesDashboard._loadMonthList();
        // รอ State.isLoaded (routes พร้อม) ก่อนโหลด campaigns
        SalesDashboard._waitAndLoadCampaigns();
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
            const snap = await db.collection('sellout').get();
            const months = snap.docs.map(d => d.id).sort().reverse();

            const sel = document.getElementById('db-month-sel');
            if (!sel) return;

            sel.innerHTML = '<option value="">-- เดือน --</option>' +
                months.map(ym => {
                    const [y, m] = ym.split('_');
                    const label = new Date(+y, +m - 1, 1)
                        .toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
                    return `<option value="${ym}">${label}</option>`;
                }).join('');

            // auto-select เดือนล่าสุด
            if (months.length > 0) {
                sel.value = months[0];
                SalesDashboard.onMonthChange(months[0]);
            }
        } catch (e) {
            console.warn('SalesDashboard._loadMonthList:', e);
            SalesDashboard._showEmpty();
        }
    },

    // ─── เปลี่ยนเดือน ─────────────────────────────────────────────────────
    onMonthChange: async (ym) => {
        if (!ym) return;
        SalesDashboard._ym = ym;
        SalesDashboard._rows = [];
        SalesDashboard._target = 0;

        await Promise.all([
            SalesDashboard._loadData(ym),
            SalesDashboard._loadTarget(ym)
        ]);
        SalesDashboard._render();
        // cache rows ของเดือนนี้ไว้ให้ campaign ใช้ด้วย
        SalesDashboard._rowCache[ym] = SalesDashboard._rows;
    },

    // ─── โหลดข้อมูล Sellout เฉพาะ sCode ตัวเอง ───────────────────────────
    _loadData: async (ym) => {
        try {
            const metaDoc = await db.collection('sellout').doc(ym).get();
            if (!metaDoc.exists) return;

            const chunks = await db.collection('sellout').doc(ym)
                .collection('chunks').orderBy('index').get();

            let rows = [];
            chunks.forEach(doc => {
                if (doc.data().rows) {
                    // กรองเฉพาะสายตัวเอง
                    const mine = doc.data().rows.filter(r =>
                        String(r.sCode || '').toUpperCase() === SalesDashboard._username
                    );
                    rows = rows.concat(mine);
                }
            });
            SalesDashboard._rows = rows;
        } catch (e) {
            console.warn('SalesDashboard._loadData:', e);
        }
    },

    // ─── โหลด Target ──────────────────────────────────────────────────────
    _loadTarget: async (ym) => {
        try {
            const doc = await db.collection('targets').doc(ym).get();
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

        const mainRows    = invoicedRows.filter(r => !SalesDashboard.EXCLUDED_CATS.has(r.catDesc));
        const basketRows  = invoicedRows.filter(r => r.catDesc === 'กระเช้าของขวัญ');
        const othersRows  = invoicedRows.filter(r => r.catDesc === 'อื่นๆ');

        const total    = mainRows.reduce((s, r) => s + SalesDashboard._amt(r), 0);
        const outletM  = SalesDashboard._calcOutletMetrics(invoicedRows);
        const invCount = new Set(mainRows.map(r => r.invNum)).size;
        const target   = SalesDashboard._target;
        const pct      = target > 0 ? (total / target * 100) : null;

        // ─ Credit breakdown (สำหรับ C-route) ─
        const myRoute = SalesDashboard._myRoute || SalesDashboard._username || '';
        const isCredit = /C\d/i.test(myRoute);
        if (isCredit) {
            const cInv   = invoicedRows; // ยอด Confirm (Invoiced)
            const cCN    = cnRows;       // Credit Note
            const totalConfirm = cInv.reduce((s,r) => s + r.net, 0);
            const totalSO      = cInv.reduce((s,r) => s + r.soNet, 0); // ยอดเปิดบิล (SO)
            const totalCN      = cCN.reduce((s,r) => s + r.net, 0);   // CN ยอดติดลบ
            const pendBills    = new Set(cCN.map(r => r.soNum).filter(Boolean)).size;
            const confBills    = new Set(cInv.map(r => r.invNum).filter(Boolean)).size;

            SalesDashboard._renderCreditSection({
                totalConfirm, totalSO, totalCN, pendBills, confBills
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

        // ─ ShopType ─
        SalesDashboard._renderBars('db-shop-body', invoicedRows, '#10b981', r => r.shopType);

        // ─ กระเช้า / อื่นๆ ─
        const basketAmt = basketRows.reduce((s, r) => s + SalesDashboard._amt(r), 0);
        const othersAmt = othersRows.reduce((s, r) => s + SalesDashboard._amt(r), 0);
        SalesDashboard._setText('db-basket-body', basketAmt > 0 ? SalesDashboard._fmt(basketAmt) : '—');
        SalesDashboard._setText('db-others-body', othersAmt > 0 ? SalesDashboard._fmt(othersAmt) : '—');
    },

    // ─── Credit Section (เฉพาะ C-route) ────────────────────────────────────
    _renderCreditSection: ({ totalConfirm, totalSO, totalCN, pendBills, confBills }) => {
        // inject หลัง db-target card ถ้ายังไม่มี
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
        el.innerHTML = `
            <div style="font-size:10px;font-weight:700;color:#7c3aed;margin-bottom:8px;">💳 Credit — รายละเอียด</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div style="background:#f5f3ff;border-radius:10px;padding:10px;border:1px solid #ddd6fe;">
                    <div style="font-size:9px;font-weight:700;color:#7c3aed;margin-bottom:2px;">✅ ยอด Confirm</div>
                    <div style="font-size:18px;font-weight:900;color:#5b21b6;">${SalesDashboard._fmt(totalConfirm)}</div>
                    <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${confBills} บิล</div>
                </div>
                <div style="background:#fffbeb;border-radius:10px;padding:10px;border:1px solid #fde68a;">
                    <div style="font-size:9px;font-weight:700;color:#b45309;margin-bottom:2px;">📋 ยอดเปิดบิล (SO)</div>
                    <div style="font-size:18px;font-weight:900;color:#92400e;">${SalesDashboard._fmt(totalSO)}</div>
                    <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${confBills} SO</div>
                </div>
            </div>
            ${totalCN !== 0 ? `
            <div style="background:#fef2f2;border-radius:10px;padding:8px 10px;border:1px solid #fecaca;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:9px;font-weight:700;color:#dc2626;">📝 Credit Note (CN)</div>
                    <div style="font-size:10px;color:#9ca3af;margin-top:1px;">${pendBills} CN</div>
                </div>
                <div style="font-size:16px;font-weight:900;color:#dc2626;">${SalesDashboard._fmt(totalCN)}</div>
            </div>` : ''}`;
    },

    // ─── Render horizontal bars ──────────────────────────────────────────
    _renderBars: (elId, rows, color, keyFn) => {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!rows.length) { el.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;font-size:12px;">ไม่มียอด</div>'; return; }

        // Group by category or custom key
        const getKey = keyFn || (r => r.catDesc);
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
        SalesDashboard._setText('db-basket-body', '—');
        SalesDashboard._setText('db-others-body', '—');
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
        // poll จนกว่า State.isLoaded = true (routes พร้อมแล้ว) แล้วค่อยโหลด
        const check = () => {
            if (typeof State !== 'undefined' && State.isLoaded &&
                State.myRoute && State.allStores?.length > 0) {
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
                const listSnap = await db.collection('sellout').get();
                const months = listSnap.docs.map(d => d.id)
                    .filter(id => /^\d{4}_\d{2}$/.test(id)).sort().reverse();
                if (months.length) {
                    const chunks = await db.collection('sellout').doc(months[0]).collection('chunks').get();
                    const seen = new Map();
                    chunks.forEach(doc => {
                        (doc.data().rows || []).forEach(r => {
                            const code = String(r.prodCode || '').trim();
                            const name = String(r.prodName || '').trim();
                            if (code && !seen.has(code)) seen.set(code, name);
                        });
                    });
                    prodOptions = [...seen.entries()].map(([code, name]) => ({ code, name }));
                }
            } catch(e) { /* ไม่กระทบ */ }
        }

        // ร้านในสายตัวเอง
        // Sales app ใช้ State.allStores (ไม่ใช่ State.db.routes)
        const myStores = (typeof State !== 'undefined' && State.allStores?.length > 0)
            ? State.allStores.map(s => String(s.id))
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

        // helper: โหลด rows ของเดือนนั้น (cached)
        const loadMonthRows = async (ym) => {
            if (SalesDashboard._rowCache[ym]) return SalesDashboard._rowCache[ym];
            try {
                const chunks = await db.collection('sellout').doc(ym).collection('chunks').get();
                let rows = [];
                chunks.forEach(doc => rows = rows.concat(doc.data().rows || []));
                // กรองเฉพาะร้านในสายตัวเอง (ยึดร้านเป็นหลัก)
                const filtered = myStoreSet.size > 0
                    ? rows.filter(r => myStoreSet.has(String(r.custCode || '')))
                    : rows;
                SalesDashboard._rowCache[ym] = filtered;
                return filtered;
            } catch(e) {
                SalesDashboard._rowCache[ym] = [];
                return [];
            }
        };

        // render แต่ละ campaign
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

            // โหลด rows ทุกเดือนใน campaign range
            const months = getRange(campaign.startYM, campaign.endYM);
            let allRows = [];
            for (const ym of months) {
                const r = await loadMonthRows(ym);
                allRows = allRows.concat(r);
            }

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
document.addEventListener('DOMContentLoaded', () => {
    const _tryInit = () => {
        if (typeof State !== 'undefined' && State.isLoaded) {
            if (typeof App !== 'undefined' && App.isSupervisor()) {
                SupervisorDashboard.init();
            } else {
                SalesDashboard.init();
            }
        } else {
            setTimeout(_tryInit, 500);
        }
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

    EXCLUDED_CATS: new Set(['อื่นๆ', 'กระเช้าของขวัญ']),

    init: () => {
        const session = Auth.getSession();
        const lbl = document.getElementById('db-route-label');
        if (lbl) lbl.textContent = (State.viewMode === 'asm' ? 'ASM' : 'Supervisor') + ' · ศูนย์ ' + (State.centerId || '');
        SupervisorDashboard._loadMonthList();
    },

    _loadMonthList: async () => {
        try {
            const snap = await db.collection('sellout').get();
            const months = snap.docs.map(d => d.id).sort().reverse();
            const sel = document.getElementById('db-month-sel');
            if (!sel) return;
            sel.innerHTML = '<option value="">-- เดือน --</option>' +
                months.map(ym => {
                    const [y, m] = ym.split('_');
                    const label = new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { year:'numeric', month:'short' });
                    return `<option value="${ym}">${label}</option>`;
                }).join('');
            if (months.length > 0) {
                sel.value = months[0];
                SupervisorDashboard.onMonthChange(months[0]);
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
        // ใช้ cache ถ้ามีแล้ว
        if (SupervisorDashboard._rowCache[ym]) {
            SupervisorDashboard._allRows = SupervisorDashboard._rowCache[ym];
            return;
        }
        try {
            const metaDoc = await db.collection('sellout').doc(ym).get();
            if (!metaDoc.exists) {
                SupervisorDashboard._rowCache[ym] = [];
                SupervisorDashboard._allRows = [];
                return;
            }
            const chunks = await db.collection('sellout').doc(ym)
                .collection('chunks').get();
            let rows = [];
            chunks.docs
                .sort((a,b) => (a.data().index||0) - (b.data().index||0))
                .forEach(doc => rows = rows.concat(doc.data().rows || []));

            // กรองเฉพาะศูนย์นี้ — ใช้ centerId จาก session ถ้า State.centerId ว่าง
            const centerId = State.centerId || Auth.getSession()?.centerId || '';
            if (centerId) {
                rows = rows.filter(r => String(r.sCode||'').startsWith(centerId));
            }
            SupervisorDashboard._rowCache[ym] = rows;
            SupervisorDashboard._allRows = rows;
        } catch(e) {
            console.warn('SupervisorDashboard._loadData:', e);
            // ไม่ cache error — ให้ลองใหม่ได้
            SupervisorDashboard._allRows = [];
        }
    },

    _loadTargets: async (ym) => {
        try {
            const doc = await db.collection('targets').doc(ym).get();
            SupervisorDashboard._targets = doc.exists ? (doc.data().routes || {}) : {};
        } catch(e) { SupervisorDashboard._targets = {}; }
    },

    _fmt: (n) => !n ? '0' : Math.round(n).toLocaleString('th-TH'),

    // ─── แยก C / V จาก sCode ─────────────────────────────────────────────
    _routeType: (sCode) => {
        const s = String(sCode||'').toUpperCase();
        if (/C\d/.test(s)) return 'C';
        if (/V\d/.test(s)) return 'V';
        return 'other';
    },

    // ─── Render หลัก ─────────────────────────────────────────────────────
    _render: () => {
        const rows    = SupervisorDashboard._allRows;

        // แยก Invoiced vs Credit Note
        const invoicedRows = rows.filter(r => r.invStatus === 'Invoiced');
        const cnRows       = rows.filter(r => r.invStatus === 'Credit Note');
        const mainRows     = invoicedRows.filter(r => !SupervisorDashboard.EXCLUDED_CATS.has(r.catDesc));

        // แยก C / V จาก sType หรือ sCode
        const cInvoiced = invoicedRows.filter(r => r.sType === 'CreditSales' || /C\d/.test(r.sCode));
        const vInvoiced = invoicedRows.filter(r => r.sType === 'VanSales'    || /V\d/.test(r.sCode));
        const cCN       = cnRows.filter(r => r.sType === 'CreditSales' || /C\d/.test(r.sCode));

        const totalAll = mainRows.reduce((s,r) => s + (r.net||0), 0);
        const totalC   = cInvoiced.reduce((s,r) => s + (r.net||0), 0);
        const totalV   = vInvoiced.reduce((s,r) => s + (r.net||0), 0);

        // ─ Credit breakdown ─
        const totalCConfirm = cInvoiced.reduce((s,r) => s + (r.net||0), 0);
        const totalCSO      = cInvoiced.reduce((s,r) => s + (r.soNet||0), 0);
        const totalCCN      = cCN.reduce((s,r) => s + (r.net||0), 0);
        const confBills     = new Set(cInvoiced.map(r => r.invNum).filter(Boolean)).size;
        const cnCount       = new Set(cCN.map(r => r.soNum || r.invNum).filter(Boolean)).size;
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
        setText('db-kpi-total', SupervisorDashboard._fmt(totalAll));
        setText('db-kpi-total-sub', 'ยอดรวมทุกสาย');
        setText('db-kpi-inv', invCountAll.toLocaleString());
        setText('db-kpi-shops', new Set(mainRows.map(r => r.custCode).filter(Boolean)).size.toLocaleString());

        // ─ vs Target KPI card ─
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

        // Target bar
        const barEl = document.getElementById('db-target-bar');
        if (barEl) {
            barEl.style.width = (pctAll !== null ? Math.min(pctAll,100) : 0) + '%';
            barEl.style.background = pctAll === null ? '#e5e7eb' : pctAll >= 100 ? '#059669' : pctAll >= 80 ? '#d97706' : '#dc2626';
        }
        setText('db-target-sold', 'รวม: ' + SupervisorDashboard._fmt(totalAll));
        setText('db-target-goal', totalTarget > 0 ? 'Target: ' + SupervisorDashboard._fmt(totalTarget) : 'Target: ยังไม่ตั้ง');
        const pctLbl = document.getElementById('db-target-pct-label');
        if (pctLbl) pctLbl.textContent = pctAll !== null ? pctAll.toFixed(1) + '%' : '—';

        // ─── Section C/V แบบ expandable ─────────────────────────────────
        const dbCatBody = document.getElementById('db-cat-body');
        if (dbCatBody) {
            dbCatBody.innerHTML = `
            <!-- ═══ CREDIT (C) ═══ -->
            <div style="margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:900;color:#7c3aed;">💳 Credit (C-routes)</span>
                    <span style="font-size:14px;font-weight:900;color:#7c3aed;">${SupervisorDashboard._fmt(totalC)}</span>
                </div>
                <!-- Credit sub-cards -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <div style="background:#f5f3ff;border-radius:12px;padding:10px 12px;border:1px solid #ddd6fe;">
                        <div style="font-size:9px;font-weight:700;color:#7c3aed;margin-bottom:2px;">✅ ยอด Confirm</div>
                        <div style="font-size:16px;font-weight:900;color:#5b21b6;">${SupervisorDashboard._fmt(totalCConfirm)}</div>
                        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${confBills} บิล</div>
                    </div>
                    <div style="background:#fffbeb;border-radius:12px;padding:10px 12px;border:1px solid #fde68a;">
                        <div style="font-size:9px;font-weight:700;color:#b45309;margin-bottom:2px;">📋 ยอดเปิดบิล (SO)</div>
                        <div style="font-size:16px;font-weight:900;color:#92400e;">${SupervisorDashboard._fmt(totalCSO)}</div>
                        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${confBills} SO</div>
                    </div>
                </div>
                ${totalCCN !== 0 ? `
                <div style="background:#fef2f2;border-radius:10px;padding:8px 12px;border:1px solid #fecaca;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div>
                        <div style="font-size:9px;font-weight:700;color:#dc2626;">📝 Credit Note (CN)</div>
                        <div style="font-size:10px;color:#9ca3af;">${cnCount} CN</div>
                    </div>
                    <div style="font-size:15px;font-weight:900;color:#dc2626;">${SupervisorDashboard._fmt(totalCCN)}</div>
                </div>` : ''}
                <!-- C route breakdown -->
                ${SupervisorDashboard._renderRouteBreakdown(cInvoiced, '#7c3aed')}
            </div>

            <div style="height:1px;background:#f3f4f6;margin:12px 0;"></div>

            <!-- ═══ VAN (V) ═══ -->
            <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;font-weight:900;color:#2563eb;">🚐 Van (V-routes)</span>
                    <span style="font-size:14px;font-weight:900;color:#2563eb;">${SupervisorDashboard._fmt(totalV)}</span>
                </div>
                <div style="background:#eff6ff;border-radius:12px;padding:10px 12px;border:1px solid #bfdbfe;margin-bottom:8px;">
                    <div style="font-size:9px;font-weight:700;color:#1d4ed8;margin-bottom:2px;">📋 บิลขาย</div>
                    <div style="font-size:16px;font-weight:900;color:#1e40af;">${invCountV.toLocaleString()} บิล</div>
                </div>
                <!-- V route breakdown -->
                ${SupervisorDashboard._renderRouteBreakdown(vInvoiced, '#2563eb')}
            </div>`;
        }

        // ─── Route table ─────────────────────────────────────────────────
        SupervisorDashboard._renderRouteTable(mainRows);
    },
    _renderRouteBreakdown: (rows, color) => {
        // group by sCode
        const byRoute = {};
        rows.forEach(r => {
            const s = String(r.sCode||'').toUpperCase();
            if (!s) return;
            if (!byRoute[s]) byRoute[s] = { net: 0, invs: new Set() };
            byRoute[s].net += r.net || 0;
            if (r.invNum) byRoute[s].invs.add(r.invNum);
        });
        const sorted = Object.entries(byRoute).sort((a,b) => b[1].net - a[1].net);
        if (!sorted.length) return '<div style="font-size:11px;color:#9ca3af;padding:6px 0;">ไม่มีข้อมูล</div>';
        const maxNet = sorted[0][1].net || 1;
        return sorted.map(([route, d]) => {
            const barW = Math.round((d.net / maxNet) * 100);
            const tgt  = SupervisorDashboard._targets[route] || 0;
            const pct  = tgt > 0 ? (d.net / tgt * 100) : null;
            const pctTxt = pct !== null ? (pct.toFixed(0) + '%') : '';
            return `
            <div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:11px;font-weight:800;color:#374151;">${route}</span>
                    <span style="font-size:11px;font-weight:700;color:${color};">${SupervisorDashboard._fmt(d.net)} ${pctTxt ? '<span style="color:#9ca3af;font-weight:400;font-size:10px;">'+pctTxt+'</span>' : ''}</span>
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
            if (!byRoute[s]) byRoute[s] = { net: 0, outlets: new Set(), invs: new Set() };
            byRoute[s].net += r.net || 0;
            if (r.custCode) byRoute[s].outlets.add(String(r.custCode));
            if (r.invNum)   byRoute[s].invs.add(r.invNum);
        });
        const sorted = Object.entries(byRoute).sort((a,b) => a[0].localeCompare(b[0],'th',{numeric:true}));
        const targets = SupervisorDashboard._targets;
        const maxNet = sorted.reduce((m,[,d]) => Math.max(m, d.net), 0) || 1;

        shopEl.innerHTML = sorted.map(([route, d]) => {
            const tgt   = targets[route] || 0;
            const pct   = tgt > 0 ? (d.net / tgt * 100) : null;
            const barW  = Math.round((d.net / maxNet) * 100);
            const color = pct === null ? '#6366f1' : pct >= 100 ? '#059669' : pct >= 80 ? '#d97706' : '#dc2626';
            const pctBadge = pct !== null
                ? `<span style="font-size:9px;font-weight:800;color:${color};background:${color}18;padding:1px 5px;border-radius:6px;">${pct.toFixed(0)}%</span>`
                : '';
            return `
            <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span style="font-size:12px;font-weight:800;color:#374151;">${route} ${pctBadge}</span>
                    <span style="font-size:11px;font-weight:800;color:#111827;">${SupervisorDashboard._fmt(d.net)}</span>
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

        // ซ่อน basket/others สำหรับ supervisor
        const basketEl = document.getElementById('db-basket-body');
        const othersEl = document.getElementById('db-others-body');
        if (basketEl) basketEl.closest?.('.db-card')?.style && (basketEl.closest('.db-card').style.display = 'none');
        if (othersEl) othersEl.closest?.('.db-card')?.style && (othersEl.closest('.db-card').style.display = 'none');
    },
};

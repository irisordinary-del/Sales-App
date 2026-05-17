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
        SalesDashboard._loadCampaigns();
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
        SalesDashboard._renderCampaigns(ym);
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

        const mainRows    = rows.filter(r => !SalesDashboard.EXCLUDED_CATS.has(r.catDesc));
        const basketRows  = rows.filter(r => r.catDesc === 'กระเช้าของขวัญ');
        const othersRows  = rows.filter(r => r.catDesc === 'อื่นๆ');

        const total    = mainRows.reduce((s, r) => s + SalesDashboard._amt(r), 0);
        const outletM  = SalesDashboard._calcOutletMetrics(rows);
        const invCount = new Set(mainRows.map(r => r.invNum)).size;
        const target   = SalesDashboard._target;
        const pct      = target > 0 ? (total / target * 100) : null;

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
        SalesDashboard._renderBars('db-shop-body', rows, '#10b981', r => r.shopType);

        // ─ กระเช้า / อื่นๆ ─
        const basketAmt = basketRows.reduce((s, r) => s + SalesDashboard._amt(r), 0);
        const othersAmt = othersRows.reduce((s, r) => s + SalesDashboard._amt(r), 0);
        SalesDashboard._setText('db-basket-body', basketAmt > 0 ? SalesDashboard._fmt(basketAmt) : '—');
        SalesDashboard._setText('db-others-body', othersAmt > 0 ? SalesDashboard._fmt(othersAmt) : '—');
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
    _loadCampaigns: async () => {
        try {
            const centerDoc = window.CENTER_DOC || Auth.getSession()?.centerDoc || '';
            if (!centerDoc) return;
            const snap = await db.collection('skuDistribution')
                .where('centerId', '==', centerDoc)
                .get();
            SalesDashboard._campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.warn('SalesDashboard._loadCampaigns:', e);
            SalesDashboard._campaigns = [];
        }
    },

    // ─── Render Campaign Coverage สำหรับสายตัวเอง ────────────────────────
    _renderCampaigns: async (ym) => {
        const el = document.getElementById('db-campaign-section');
        if (!el) return;

        const now = ym || SalesDashboard._ym || '';
        const route = SalesDashboard._myRoute;
        if (!route || !now) { el.innerHTML = ''; return; }

        // กรองเฉพาะ campaign ที่อยู่ในช่วงเวลา
        const active = SalesDashboard._campaigns.filter(c =>
            c.startYM <= now && c.endYM >= now &&
            (c.groups || []).length > 0
        );

        if (!active.length) { el.innerHTML = ''; return; }

        // โหลด prodOptions ถ้ายังไม่มี (ใช้ร่วมกับ SkuDist ถ้ามี)
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

        // ร้านในสายตัวเอง (จาก State ถ้ามี)
        const myStores = (typeof State !== 'undefined' && State.db?.routes?.[route])
            ? State.db.routes[route].map(s => String(s.id))
            : [];
        const myStoreSet = new Set(myStores);
        const totalStores = myStores.length;

        // rows ของเดือนนี้ (ใช้ SalesDashboard._rows แต่กรองเฉพาะร้านในสาย)
        const rows = SalesDashboard._rows.filter(r =>
            myStoreSet.size > 0 ? myStoreSet.has(String(r.custCode || '')) : true
        );

        // render แต่ละ campaign
        const cardsHtml = active.map(campaign => {
            const groups   = campaign.groups || [];
            const targetUnit    = campaign.targetUnit || 'pct';
            const defaultTarget = campaign.defaultTarget ?? 80;
            const rawTargets    = campaign.routeTargets || {};

            // target สำหรับสายนี้
            const rawTgt = rawTargets[route] ?? null;
            const tgtPct = rawTgt !== null
                ? (targetUnit === 'count'
                    ? (totalStores > 0 ? Math.round(rawTgt / totalStores * 100) : 0)
                    : rawTgt)
                : defaultTarget;
            const tgtCount = Math.round(tgtPct / 100 * totalStores);

            const groupBars = groups.map(g => {
                const kws = (g.keywords || []).map(k => k.toLowerCase());

                // rows ที่ match
                const matched = rows.filter(r => {
                    const code = (r.prodCode || '').toLowerCase();
                    const name = (r.prodName || '').toLowerCase();
                    return kws.some(k => code.includes(k) || name.includes(k));
                });
                const bought = new Set(matched.map(r => String(r.custCode)));
                const boughtCount = bought.size;
                const pct   = totalStores > 0 ? Math.round(boughtCount / totalStores * 100) : 0;
                const vs    = pct - tgtPct;
                const color = pct >= tgtPct ? '#10b981' : pct >= tgtPct * 0.8 ? '#f59e0b' : '#ef4444';

                // SKU coverage
                const targetSkus = new Set(prodOptions
                    .filter(p => kws.some(k => p.code.toLowerCase().includes(k) || p.name.toLowerCase().includes(k)))
                    .map(p => p.code));
                const soldSkus  = new Set(matched.map(r => r.prodCode).filter(Boolean));
                const skuPct    = targetSkus.size > 0 ? Math.round(soldSkus.size / targetSkus.size * 100) : (soldSkus.size > 0 ? 100 : 0);

                return `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                        <span style="font-size:12px;font-weight:700;color:#374151;">${g.name}</span>
                        <span style="font-size:14px;font-weight:900;color:${color};">${pct}%</span>
                    </div>
                    <!-- Bar -->
                    <div style="position:relative;height:10px;background:#e5e7eb;border-radius:99px;overflow:visible;margin-bottom:5px;">
                        <div style="width:${Math.min(pct,100)}%;height:10px;background:${color};border-radius:99px;"></div>
                        <div style="position:absolute;left:${Math.min(tgtPct,100)}%;top:-3px;width:2px;height:16px;background:#6366f1;border-radius:1px;" title="target ${tgtPct}%"></div>
                    </div>
                    <!-- Stats -->
                    <div style="display:flex;justify-content:space-between;font-size:10px;">
                        <span style="color:#111827;font-weight:700;">${boughtCount}<span style="color:#9ca3af;font-weight:400;">/${tgtCount} ร้าน</span></span>
                        <span style="color:${vs >= 0 ? '#10b981' : '#ef4444'};font-weight:700;">${vs >= 0 ? '+' : ''}${vs}% vs target</span>
                    </div>
                    <!-- SKU -->
                    <div style="margin-top:4px;font-size:10px;color:#9ca3af;">
                        SKU coverage: <span style="font-weight:700;color:#6366f1;">${skuPct}%</span>
                        <span style="margin-left:4px;">(${soldSkus.size}/${targetSkus.size} SKU)</span>
                    </div>
                </div>`;
            }).join('');

            const startLbl = typeof DateUtil !== 'undefined' ? DateUtil.ymToThaiShort(campaign.startYM) : campaign.startYM;
            const endLbl   = typeof DateUtil !== 'undefined' ? DateUtil.ymToThaiShort(campaign.endYM)   : campaign.endYM;

            return `
            <div class="db-card" style="flex-shrink:0;margin-bottom:12px;border-left:4px solid #ec4899;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div>
                        <div style="font-size:12px;font-weight:900;color:#111827;">🎯 ${campaign.name}</div>
                        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${startLbl} → ${endLbl} &nbsp;|&nbsp; target ${tgtPct}% (${tgtCount} ร้าน)</div>
                    </div>
                </div>
                ${groupBars}
            </div>`;
        }).join('');

        el.innerHTML = cardsHtml;
    },


};

// ─── Hook เข้า App.start() ── เรียก init หลัง login สำเร็จ ─────────────
// รอ DOMContentLoaded แล้วค่อย patch
document.addEventListener('DOMContentLoaded', () => {
    // Poll จนกว่า App จะ init เสร็จ (State.isLoaded)
    const _tryInit = () => {
        if (typeof State !== 'undefined' && State.isLoaded) {
            SalesDashboard.init();
        } else {
            setTimeout(_tryInit, 500);
        }
    };
    setTimeout(_tryInit, 1000);
});

// ==========================================
// 🏪 StoreHistory — ประวัติการซื้อรายร้าน
// ดึงจาก sellout/{YYYY_MM}/chunks/
// กรองเฉพาะ custCode ของร้านนั้น
// ==========================================

const StoreHistory = {

    _months: [],          // ['2026_04', '2026_03', ...]
    _ym: '',              // เดือนที่เลือกใน store list
    _storeMap: {},        // { custCode: { gross, net, skuCount, invCount } } สำหรับ list view
    _allRows: [],         // rows ทั้งหมดของเดือนที่โหลด (ของสายนี้)
    _loadedYm: '',        // ym ที่โหลดแล้ว cache ไว้
    _currentStoreId: '',  // store ที่กำลังเปิด modal
    _monthCache: {},      // { ym: rows[] } cache ต่อเดือน

    // ─── Init: เรียกหลัง SalesDashboard.init() ──────────────────────────
    init: async () => {
        try {
            const snap = await db.collection('sellout').get();
            const months = snap.docs.map(d => d.id).sort().reverse();
            StoreHistory._months = months;

            // populate month selector ใน store tab
            const sel = document.getElementById('store-month-sel');
            if (sel) {
                sel.innerHTML = '<option value="">-- ข้อมูลย้อนหลัง --</option>' +
                    months.map(ym => {
                        const [y, m] = ym.split('_');
                        const label  = new Date(+y, +m - 1, 1)
                            .toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
                        return `<option value="${ym}">${label}</option>`;
                    }).join('');

                // auto-select เดือนล่าสุด
                if (months.length > 0) {
                    sel.value = months[0];
                    await StoreHistory.onMonthChange(months[0]);
                }
            }
        } catch (e) {
            console.warn('StoreHistory.init:', e);
        }
    },

    // ─── เปลี่ยนเดือนใน store list ───────────────────────────────────────
    onMonthChange: async (ym) => {
        StoreHistory._ym = ym;
        if (!ym) { StoreHistory._storeMap = {}; Processor.stores(); return; }
        await StoreHistory._loadYm(ym);
        StoreHistory._buildStoreMap(ym);
        Processor.stores(); // re-render store list พร้อม histTag
    },

    // ─── Load rows ของเดือนนั้น (cached) ─────────────────────────────────
    _loadYm: async (ym) => {
        if (StoreHistory._monthCache[ym]) return; // ใช้ cache

        try {
            const username = Auth.getSession()?.username?.toUpperCase() || '';
            const chunks = await db.collection('sellout').doc(ym)
                .collection('chunks').orderBy('index').get();

            let rows = [];
            chunks.forEach(doc => {
                if (doc.data().rows) {
                    rows = rows.concat(
                        doc.data().rows.filter(r =>
                            String(r.sCode || '').toUpperCase() === username
                        )
                    );
                }
            });
            StoreHistory._monthCache[ym] = rows;
        } catch (e) {
            console.warn('StoreHistory._loadYm:', e);
            StoreHistory._monthCache[ym] = [];
        }
    },

    // ─── สร้าง storeMap สำหรับ list view ─────────────────────────────────
    _buildStoreMap: (ym) => {
        const rows = StoreHistory._monthCache[ym] || [];
        const map  = {};
        rows.forEach(r => {
            const id = String(r.custCode || '').trim();
            if (!id) return;
            if (!map[id]) map[id] = { gross: 0, net: 0, skuCount: 0, invCount: 0, skus: new Set(), invs: new Set() };
            map[id].gross += r.gross || 0;
            map[id].net   += r.net   || 0;
            if (r.prodCode) map[id].skus.add(r.prodCode);
            if (r.invNum)   map[id].invs.add(r.invNum);
        });
        // finalize
        Object.values(map).forEach(v => {
            v.skuCount  = v.skus.size;
            v.invCount  = v.invs.size;
        });
        StoreHistory._storeMap = map;
    },

    // ─── เปิด Modal สำหรับร้านนั้น ────────────────────────────────────────
    openFor: async (storeId) => {
        StoreHistory._currentStoreId = storeId;

        // สร้าง month tabs
        const tabsEl = document.getElementById('m-month-tabs');
        if (tabsEl) {
            if (!StoreHistory._months.length) {
                tabsEl.innerHTML = '<span style="font-size:11px;color:#9ca3af;">ไม่มีข้อมูลย้อนหลัง</span>';
            } else {
                tabsEl.innerHTML = StoreHistory._months.map((ym, i) => {
                    const [y, m] = ym.split('_');
                    const label  = new Date(+y, +m - 1, 1)
                        .toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
                    const active = i === 0;
                    return `<button id="mtab-${ym}"
                        onclick="StoreHistory.switchMonth('${ym}')"
                        style="flex-shrink:0;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:800;border:none;cursor:pointer;transition:all 0.15s;
                               background:${active ? '#2563eb' : '#f3f4f6'};
                               color:${active ? '#fff' : '#6b7280'};">
                        ${label}
                    </button>`;
                }).join('');
            }
        }

        // โหลดและแสดงเดือนล่าสุดก่อน
        const firstYm = StoreHistory._months[0];
        if (firstYm) {
            await StoreHistory._renderModalMonth(storeId, firstYm);
        } else {
            StoreHistory._renderNoData();
        }
    },

    // ─── Switch month ใน modal ───────────────────────────────────────────
    switchMonth: async (ym) => {
        // อัปเดต active tab
        StoreHistory._months.forEach(m => {
            const btn = document.getElementById('mtab-' + m);
            if (!btn) return;
            const active = m === ym;
            btn.style.background = active ? '#2563eb' : '#f3f4f6';
            btn.style.color      = active ? '#fff'    : '#6b7280';
        });
        await StoreHistory._renderModalMonth(StoreHistory._currentStoreId, ym);
    },

    // ─── Render modal content สำหรับเดือนนั้น ────────────────────────────
    _renderModalMonth: async (storeId, ym) => {
        // แสดง loading state
        document.getElementById('m-gross').textContent = '...';
        document.getElementById('m-bills').textContent = '...';
        document.getElementById('m-sku').textContent   = '...';
        document.getElementById('m-sku-list').innerHTML =
            '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:12px;">⏳ กำลังโหลด...</div>';
        document.getElementById('m-no-data').classList.add('hidden');

        // โหลด (cached)
        await StoreHistory._loadYm(ym);
        const rows = (StoreHistory._monthCache[ym] || [])
            .filter(r => String(r.custCode || '').trim() === storeId);

        if (!rows.length) {
            StoreHistory._renderNoData();
            return;
        }

        // ─ KPI summary ─
        const gross    = rows.reduce((s, r) => s + (r.gross || 0), 0);
        const net      = rows.reduce((s, r) => s + (r.net   || 0), 0);
        const invCount = new Set(rows.map(r => r.invNum).filter(Boolean)).size;

        // SKU breakdown
        const byProd = {};
        rows.forEach(r => {
            const key = r.prodCode || r.prodName || '?';
            if (!byProd[key]) byProd[key] = {
                name:  r.prodName || key,
                code:  r.prodCode || '',
                gross: 0, net: 0, qty: 0, invs: new Set()
            };
            byProd[key].gross += r.gross || 0;
            byProd[key].net   += r.net   || 0;
            byProd[key].qty   += r.qtyEA || 0;
            if (r.invNum) byProd[key].invs.add(r.invNum);
        });
        const skuCount = Object.keys(byProd).length;
        const sorted   = Object.values(byProd).sort((a, b) => b.net - a.net);
        const maxNet = sorted[0]?.net || 1;

        // ─ Fill KPI ─
        document.getElementById('m-gross').textContent = _fmtB(net);
        document.getElementById('m-bills').textContent = invCount;
        document.getElementById('m-sku').textContent   = skuCount;

        // ─ SKU list ─
        const listEl = document.getElementById('m-sku-list');
        listEl.innerHTML = sorted.map(p => {
            const barW = Math.round((p.net / maxNet) * 100);
            const pct  = net > 0 ? (p.net / net * 100).toFixed(1) : '0.0';
            return `
            <div style="background:#f9fafb;border-radius:12px;padding:10px 12px;border:1px solid #f3f4f6;">
                <!-- Product name + pct -->
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px;">
                    <div style="flex:1;min-width:0;margin-right:8px;">
                        <div style="font-size:12px;font-weight:800;color:#111827;line-height:1.3;">${p.name}</div>
                        ${p.code ? `<div style="font-size:10px;color:#9ca3af;font-family:monospace;">${p.code}</div>` : ''}
                    </div>
                    <span style="font-size:10px;font-weight:800;color:#6b7280;white-space:nowrap;">${pct}%</span>
                </div>
                <!-- Bar -->
                <div style="background:#e5e7eb;border-radius:99px;height:5px;overflow:hidden;margin-bottom:5px;">
                    <div style="background:#2563eb;height:5px;border-radius:99px;width:${barW}%;transition:width 0.4s;"></div>
                </div>
                <!-- Stats row -->
                <div style="display:flex;gap:12px;font-size:10px;font-weight:700;">
                    <span style="color:#059669;">฿ ${_fmtB(p.net)}</span>
                    <span style="color:#6b7280;">${p.qty.toLocaleString()} EA</span>
                    <span style="color:#8b5cf6;">${p.invs.size} บิล</span>
                </div>
            </div>`;
        }).join('');
    },

    _renderNoData: () => {
        document.getElementById('m-gross').textContent = '—';
        document.getElementById('m-bills').textContent = '—';
        document.getElementById('m-sku').textContent   = '—';
        document.getElementById('m-sku-list').innerHTML = '';
        document.getElementById('m-no-data').classList.remove('hidden');
    }
};

// ─── Hook: เรียก StoreHistory.init() หลัง State.isLoaded ───────────────
document.addEventListener('DOMContentLoaded', () => {
    const _try = () => {
        if (typeof State !== 'undefined' && State.isLoaded) {
            StoreHistory.init();
        } else {
            setTimeout(_try, 600);
        }
    };
    setTimeout(_try, 1200);
});

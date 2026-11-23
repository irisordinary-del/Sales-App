// ==========================================
// 🍶 BottleDist — ติดตาม "ร้านกระจาย" แบบนับขวด (เช่น ซุปไก่ 39 มล. P.3x4 + P.12)
// ------------------------------------------
// สูตรเดียวกับชีต "กระจาย 39 มล. แยกสินค้า" / "เช็คกระจาย 39 มล." ในไฟล์
// Sellout - SO_TO_DEL Listing with kpi date (52).xlsx (ตรวจแล้วตรงทุกสาย V01–V12):
//   - นับตาม Salesman Code (sCode) ไม่ใช่สายของร้านในแผน
//   - ขวด = qtyEA × "ขวดต่อ 1 EA" ของ SKU นั้น (P.3x4 = 3, P.12 = 1) รวมทุกแถว (Credit Note ติดลบหักออก)
//   - ร้าน "กระจาย" = ร้านไม่ซ้ำที่ SKU ใด SKU หนึ่งรวมได้ ≥ ขวดขั้นต่ำ ในช่วง (ไม่เอาขวดต่าง SKU มารวมกัน)
//   - "ก่อนช่วงนับ" = วันที่ 1 ของเดือนที่เริ่ม → วันก่อนเริ่ม (ในไฟล์คือ "วันที่ 1-9 (ไม่นับ)")
//   - ต่อวันที่ทำมา = ร้านกระจาย ÷ จำนวนวันที่มียอดขายจริง (KPI Date ไม่ซ้ำ) ตั้งแต่วันเริ่มถึงวันล่าสุดในข้อมูล
//   - ต่อวันที่ต้องทำ = ส่วนที่ยังขาด ÷ วันทำงานที่เหลือ (วันถัดจากข้อมูลล่าสุด → วันสิ้นสุด, ไม่นับวันอาทิตย์ + วันหยุดที่ตั้งไว้)
//     (ไฟล์ใช้ ÷10 และ ÷17 ตายตัว = ข้อมูลถึง 20 พ.ย. และสิ้นสุด 10 ธ.ค.)
// ข้อมูลมาจาก sellout/{CENTER}_{YYYY_MM}/chunks ที่อัปโหลดผ่าน Dashboard (ฟิลด์ sCode, custCode,
// custName, prodCode, qtyEA, kpiDate "DD/MM/YYYY")
//
// ค่าแคมเปญเก็บใน skuDistribution/{id} (กฎ Firestore เดิมรองรับ: name/centerId/groups) โดยตั้ง
// centerId = "{CENTER}_main::bottleDist" — query เดิมของ SkuDist / แอปเซล (where centerId == "402_main")
// จึงไม่เห็นเอกสารนี้ และไม่มี startYM/endYM ทำให้ตัวโหลดแบบไม่กรองใน SupervisorDashboard ข้ามไปเอง
//   { kind:'bottleDist', name, centerId, center, startDate:'YYYY-MM-DD', endDate, minBottles,
//     groups:[{code, name, bottlesPerEA}], targets:{ sCode: n }, holidays:['YYYY-MM-DD'], showInSales }
// ==========================================

const BottleDist = {

    KEY_SUFFIX: '::bottleDist',

    _fs: () => (typeof cloudDB !== 'undefined' ? cloudDB : db),

    _centerId: () => {
        const s = (typeof Auth !== 'undefined' && Auth.getSession) ? Auth.getSession() : null;
        return String(window.CENTER_ID
            || (typeof State !== 'undefined' && State.centerId)
            || s?.centerId || '').toUpperCase();
    },
    _centerKey: () => {
        const cid = BottleDist._centerId();
        return cid ? `${cid}_main${BottleDist.KEY_SUFFIX}` : '';
    },

    _esc: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),

    // ─── วันที่ ─────────────────────────────────────────────────────────────
    // kpiDate ที่เก็บจริงเป็น "DD/MM/YYYY" (เซลล์ข้อความในไฟล์บริษัท) — รองรับ "YYYY-MM-DD" ด้วยเผื่อไฟล์รูปแบบอื่น
    parseKpi: (s) => {
        const t = String(s || '').trim();
        let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        return null;
    },
    _d: (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); },
    _iso: (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    _addDays: (iso, n) => { const dt = BottleDist._d(iso); dt.setDate(dt.getDate() + n); return BottleDist._iso(dt); },
    _todayIso: () => BottleDist._iso(new Date()),
    fmtDate: (iso) => {
        if (!iso) return '—';
        return BottleDist._d(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    },
    monthsOf: (c) => {
        const out = [];
        if (!c.startDate || !c.endDate) return out;
        let [y, m] = c.startDate.split('-').map(Number);
        const [ey, em] = c.endDate.split('-').map(Number);
        while (y < ey || (y === ey && m <= em)) {
            out.push(`${y}_${String(m).padStart(2, '0')}`);
            if (++m > 12) { m = 1; y++; }
            if (out.length > 24) break;
        }
        return out;
    },
    // วันทำงานในช่วง [from, to] — ไม่นับวันอาทิตย์และวันหยุดที่ตั้งไว้
    _workDays: (from, to, holidays) => {
        if (!from || !to || from > to) return 0;
        const hol = new Set(holidays || []);
        let n = 0, cur = from;
        for (let i = 0; i < 400 && cur <= to; i++) {
            if (BottleDist._d(cur).getDay() !== 0 && !hol.has(cur)) n++;
            cur = BottleDist._addDays(cur, 1);
        }
        return n;
    },

    // ─── คำนวณ ──────────────────────────────────────────────────────────────
    // rows = แถว sellout ของทุกเดือนในช่วงแคมเปญ (ทั้งศูนย์) → ผลรายเซล + รวม
    compute: (c, rows) => {
        const groups   = (c.groups || []).filter(g => g && g.code);
        const w        = {};
        groups.forEach(g => { w[String(g.code).trim()] = Number(g.bottlesPerEA) || 1; });
        const minB     = Number(c.minBottles) || 1;
        const start    = c.startDate, end = c.endDate;
        const preStart = start ? start.slice(0, 8) + '01' : null;
        const hasPre   = !!start && preStart < start;

        const agg = {};        // sCode → cust → per → code → bottles
        const names = {};      // cust → name
        const salesDates = new Set();
        let dataThrough = null;

        rows.forEach(r => {
            const d = BottleDist.parseKpi(r.kpiDate);
            if (!d || d < preStart || d > end) return;
            if (d >= start) {
                salesDates.add(d);
                if (!dataThrough || d > dataThrough) dataThrough = d;
            }
            const code = String(r.prodCode || '').trim();
            if (!w[code]) return;
            const sm   = String(r.sCode || '').trim().toUpperCase();
            const cust = String(r.custCode || '').trim();
            if (!sm || !cust) return;
            const per = d < start ? 'pre' : 'count';
            const a = ((agg[sm] = agg[sm] || {})[cust] = agg[sm][cust] || {});
            const p = (a[per] = a[per] || {});
            p[code] = (p[code] || 0) + (Number(r.qtyEA) || 0) * w[code];
            if (r.custName) names[cust] = r.custName;
        });

        const today     = BottleDist._todayIso();
        const daysDone  = salesDates.size;
        // วันที่เหลือเริ่มนับจากวันถัดจากข้อมูลล่าสุด (ข้อมูลมาช้ากว่าวันจริง 1 วันเสมอ) — ถ้ายังไม่มีข้อมูลในช่วงเลย
        // นับจากวันเริ่ม หรือวันนี้ (แล้วแต่อันไหนมาทีหลัง)
        const leftFrom  = dataThrough ? BottleDist._addDays(dataThrough, 1) : (today > start ? today : start);
        const daysLeft  = BottleDist._workDays(leftFrom, end, c.holidays);

        const targets = c.targets || {};
        let sCodes = Object.keys(targets).filter(k => Number(targets[k]) > 0);
        if (!sCodes.length) sCodes = Object.keys(agg);
        sCodes = [...new Set(sCodes.map(s => s.toUpperCase()))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        const ok = (p, code) => (p?.[code] || 0) >= minB;
        const mkRow = (sm) => {
            const custs  = agg[sm] || {};
            const target = Number(targets[sm]) || 0;
            const row = { sCode: sm, target, pre: 0, count: 0, perSku: {}, near: [] };
            groups.forEach(g => { row.perSku[g.code] = { pre: 0, count: 0 }; });
            Object.entries(custs).forEach(([cust, a]) => {
                if (a.pre && groups.some(g => ok(a.pre, g.code))) row.pre++;
                if (a.count) {
                    const hit = groups.some(g => ok(a.count, g.code));
                    if (hit) row.count++;
                    else {
                        // ซื้อแล้วในช่วงนับแต่ยังไม่ถึงขั้นต่ำ — บอกเซลว่าขาดอีกกี่ขวด (SKU ที่ใกล้ที่สุด)
                        const best = groups.reduce((mx, g) => Math.max(mx, a.count[g.code] || 0), 0);
                        if (best > 0) row.near.push({ cust, name: names[cust] || cust, bottles: best, need: minB - best });
                    }
                }
                groups.forEach(g => {
                    if (ok(a.pre, g.code))   row.perSku[g.code].pre++;
                    if (ok(a.count, g.code)) row.perSku[g.code].count++;
                });
            });
            row.near.sort((x, y) => x.need - y.need || String(x.name).localeCompare(String(y.name)));
            return row;
        };
        const derive = (o) => {
            o.gap        = o.count - o.target;                       // ติดลบ = ยังขาด (เหมือนไฟล์)
            o.needPerDay = daysLeft > 0 ? Math.max(0, -o.gap) / daysLeft : null;
            o.donePerDay = daysDone > 0 ? o.count / daysDone : null;
            o.pct        = o.target > 0 ? o.count / o.target * 100 : null;
            return o;
        };

        const list = sCodes.map(sm => {
            const row = derive(mkRow(sm));
            row.skus = {};
            groups.forEach(g => {
                const s = row.perSku[g.code];
                row.skus[g.code] = derive({ target: row.target, pre: s.pre, count: s.count });
            });
            return row;
        });
        const sum = (sel) => {
            const t = { sCode: 'รวม', target: 0, pre: 0, count: 0 };
            list.forEach(r => { const s = sel(r); t.target += s.target; t.pre += s.pre; t.count += s.count; });
            return derive(t);
        };
        const total = sum(r => r);
        total.skus = {};
        groups.forEach(g => { total.skus[g.code] = sum(r => r.skus[g.code]); });

        return { rows: list, total, groups, hasPre, preStart, dataThrough, daysDone, daysLeft, leftFrom, minB };
    },

    // ─── Firestore I/O ──────────────────────────────────────────────────────
    _campaigns: [],
    loadCampaigns: async () => {
        const key = BottleDist._centerKey();
        if (!key) return [];
        const snap = await BottleDist._fs().collection('skuDistribution').where('centerId', '==', key).get();
        BottleDist._campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
        return BottleDist._campaigns;
    },

    _rowCache: {},
    _loadMonthRows: async (ym) => {
        if (BottleDist._rowCache[ym]) return BottleDist._rowCache[ym];
        // แอปเซล: ใช้ cache กลางของ SalesDashboard (โหลดเดือนนี้ไปแล้วไม่ต้องโหลดซ้ำ)
        if (typeof SalesDashboard !== 'undefined' && SalesDashboard._loadChunks && typeof Dashboard === 'undefined') {
            const rows = await SalesDashboard._loadChunks(ym);
            if (rows.length) BottleDist._rowCache[ym] = rows;
            return rows;
        }
        const cid = BottleDist._centerId();
        const mapped = (typeof Dashboard !== 'undefined' && Dashboard._ymKeyMap && Dashboard._ymKeyMap[ym]) || null;
        const candidates = [...new Set([mapped, cid ? `${cid}_${ym}` : null, ym].filter(Boolean))];
        for (const key of candidates) {
            try {
                const snap = await BottleDist._fs().collection('sellout').doc(key).collection('chunks').get();
                if (snap.empty) continue;
                let rows = [];
                snap.docs.sort((a, b) => (a.data().index || 0) - (b.data().index || 0))
                    .forEach(doc => { if (Array.isArray(doc.data().rows)) rows = rows.concat(doc.data().rows); });
                BottleDist._rowCache[ym] = rows;
                return rows;
            } catch (e) { console.warn('[BottleDist] load', key, e.message); }
        }
        return [];
    },
    _rowsFor: async (c) => (await Promise.all(BottleDist.monthsOf(c).map(BottleDist._loadMonthRows))).flat(),
    invalidate: (ym) => { if (ym) delete BottleDist._rowCache[ym]; else BottleDist._rowCache = {}; },

    // ─── ตัวช่วยแสดงผล ─────────────────────────────────────────────────────
    _n:   (v) => (v == null ? '—' : Math.round(v).toLocaleString('th-TH')),
    _d1:  (v) => (v == null ? '—' : v.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })),
    _gap: (v) => (v >= 0 ? `+${v.toLocaleString('th-TH')}` : v.toLocaleString('th-TH')),
    _pctColor: (p) => (p == null ? '#94a3b8' : p >= 100 ? '#059669' : p >= 70 ? '#4f46e5' : p >= 40 ? '#d97706' : '#dc2626'),
    _paceColor: (o) => (o.needPerDay == null || o.donePerDay == null) ? '#475569'
        : (o.donePerDay >= o.needPerDay ? '#059669' : '#dc2626'),
    _skuLabel: (g) => {
        // "แบรนด์ซุปไก่ ต้นตำรับ 39 มล. P.3x4(Carnosine Plus)" → "P.3x4"
        const m = String(g.name || '').match(/P\.\s*[\dx×]+/i);
        return m ? m[0].replace(/\s+/g, '') : String(g.code);
    },
    _periodLine: (c, res) => {
        const parts = [`นับ ${BottleDist.fmtDate(c.startDate)} – ${BottleDist.fmtDate(c.endDate)}`,
            `ขั้นต่ำ ${res.minB} ขวด/ร้าน`];
        parts.push(res.dataThrough ? `ข้อมูลถึง ${BottleDist.fmtDate(res.dataThrough)}` : 'ยังไม่มีข้อมูลในช่วงนับ');
        parts.push(`ทำมา ${res.daysDone} วัน · เหลือ ${res.daysLeft} วันทำงาน`);
        return parts.join(' · ');
    },
    // view: 'all' = รวม 2 SKU, หรือรหัส SKU
    _view: {},
    _pick: (o, view) => (view && view !== 'all' && o.skus ? o.skus[view] : o),

    // ════════════════════════════════════════════════════════════════════════
    // 🖥️ Admin Dashboard (index.html → dashboard.js)
    // ════════════════════════════════════════════════════════════════════════
    _adminResults: {},
    mountAdmin: async () => {
        const host = document.getElementById('db-bottledist-section');
        if (!host) return;
        try {
            await BottleDist.loadCampaigns();
        } catch (e) {
            console.warn('[BottleDist] loadCampaigns', e);
            host.innerHTML = '';
            return;
        }
        const camps = BottleDist._campaigns;
        const role = (typeof Auth !== 'undefined' && Auth.getSession()?.role) || '';
        const canEdit = role === 'admin' || role === 'supervisor';
        if (!camps.length) {
            host.innerHTML = canEdit ? `
                <div class="db-panel">
                    <div class="db-panel-head">
                        <span class="db-panel-title"><span class="db-kpi-icon">${BottleDist._icon()}</span>ร้านกระจาย (นับขวด)</span>
                        <button class="db-action-btn" onclick="BottleDist.openSettings()">+ ตั้งค่าแคมเปญ</button>
                    </div>
                    <p class="text-xs text-gray-400 px-4 py-3">ยังไม่มีแคมเปญ — ตั้งช่วงวันที่, SKU, ขวดขั้นต่ำ และ Target รายสาย แล้วตัวเลขจะคำนวณจาก Sellout ที่อัปโหลดอัตโนมัติ</p>
                </div>` : '';
            return;
        }
        host.innerHTML = camps.map(c => `<div id="bd-camp-${c.id}" class="db-panel overflow-hidden">
            <div class="db-panel-head"><span class="db-panel-title"><span class="db-kpi-icon">${BottleDist._icon()}</span>${BottleDist._esc(c.name)}</span></div>
            <p class="text-xs text-gray-400 px-4 py-6 text-center">กำลังคำนวณ...</p></div>`).join('')
            + (canEdit ? `<div class="flex justify-end"><button class="db-action-btn" onclick="BottleDist.openSettings()">+ แคมเปญใหม่</button></div>` : '');
        for (const c of camps) {
            try {
                const res = BottleDist.compute(c, await BottleDist._rowsFor(c));
                BottleDist._adminResults[c.id] = { c, res };
                BottleDist._renderAdminCamp(c.id);
            } catch (e) {
                console.error('[BottleDist] compute', e);
                const el = document.getElementById(`bd-camp-${c.id}`);
                if (el) el.querySelector('p').textContent = '❌ คำนวณไม่สำเร็จ: ' + e.message;
            }
        }
    },
    refreshAdmin: () => { BottleDist.invalidate(); return BottleDist.mountAdmin(); },

    _icon: () => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v4l2 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3z"/><line x1="8" y1="13" x2="16" y2="13"/></svg>',

    _renderAdminCamp: (id) => {
        const el = document.getElementById(`bd-camp-${id}`);
        const st = BottleDist._adminResults[id];
        if (!el || !st) return;
        const { c, res } = st;
        const view = BottleDist._view[id] || 'all';
        const role = (typeof Auth !== 'undefined' && Auth.getSession()?.role) || '';
        const canEdit = role === 'admin' || role === 'supervisor';
        const tabs = [{ k: 'all', l: `รวม ${res.groups.length} SKU` }, ...res.groups.map(g => ({ k: g.code, l: BottleDist._skuLabel(g) }))];
        const preLbl = res.hasPre ? `${BottleDist._d(res.preStart).getDate()}–${BottleDist._d(BottleDist._addDays(c.startDate, -1)).getDate()} (ไม่นับ)` : '';
        const tr = (o, isTotal) => {
            const v = BottleDist._pick(o, view);
            const pct = v.pct;
            const bar = pct == null ? '' : `<div class="db-progress-track" style="height:6px;background:#eef2ff;border-radius:99px;overflow:hidden;min-width:70px;"><div style="height:6px;width:${Math.min(100, pct)}%;background:${BottleDist._pctColor(pct)};border-radius:99px;"></div></div>`;
            return `<tr class="${isTotal ? 'bg-gray-50 font-black' : ''}">
                <td class="font-bold text-gray-800 whitespace-nowrap">${BottleDist._esc(o.sCode)}</td>
                ${res.hasPre ? `<td class="text-right text-gray-400">${BottleDist._n(v.pre)}</td>` : ''}
                <td class="text-right font-black text-gray-900">${BottleDist._n(v.count)}</td>
                <td class="text-right text-gray-600">${v.target ? BottleDist._n(v.target) : '—'}</td>
                <td class="text-right font-bold" style="color:${v.gap >= 0 ? '#059669' : '#dc2626'}">${v.target ? BottleDist._gap(v.gap) : '—'}</td>
                <td class="text-right">${v.target ? BottleDist._d1(v.needPerDay) : '—'}</td>
                <td class="text-right font-bold" style="color:${BottleDist._paceColor(v)}">${BottleDist._d1(v.donePerDay)}</td>
                <td><div class="flex items-center gap-2">${bar}<span class="text-xs font-bold" style="color:${BottleDist._pctColor(pct)}">${pct == null ? '' : Math.round(pct) + '%'}</span></div></td>
            </tr>`;
        };
        el.innerHTML = `
            <div class="db-panel-head flex-wrap gap-2">
                <div>
                    <span class="db-panel-title"><span class="db-kpi-icon">${BottleDist._icon()}</span>${BottleDist._esc(c.name)}</span>
                    <div class="text-xs text-gray-400 mt-1">${BottleDist._periodLine(c, res)}${c.showInSales === false ? ' · <span class="text-amber-600 font-bold">ซ่อนจากแอปเซล</span>' : ''}</div>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <div class="db-pill-group">${tabs.map(t => `<button class="db-pill-btn ${t.k === view ? 'active' : ''}" onclick="BottleDist._setView('${c.id}','${BottleDist._esc(t.k)}')">${BottleDist._esc(t.l)}</button>`).join('')}</div>
                    ${canEdit ? `<button class="db-action-btn" onclick="BottleDist.openSettings('${c.id}')">ตั้งค่า</button>` : ''}
                </div>
            </div>
            <div class="db-table-wrap overflow-x-auto">
                <table class="db-table">
                    <thead><tr>
                        <th>สาย</th>
                        ${res.hasPre ? `<th class="text-right">วันที่ ${preLbl}</th>` : ''}
                        <th class="text-right">ร้านกระจาย</th>
                        <th class="text-right">Target</th>
                        <th class="text-right">ส่วนต่าง</th>
                        <th class="text-right">ต้องทำ/วัน</th>
                        <th class="text-right">ทำมา/วัน</th>
                        <th>ความคืบหน้า</th>
                    </tr></thead>
                    <tbody>${res.rows.map(r => tr(r, false)).join('')}${tr(res.total, true)}</tbody>
                </table>
            </div>
            <p class="text-[11px] text-gray-400 px-4 py-2 border-t border-gray-100">ร้านกระจาย = ร้านไม่ซ้ำที่ซื้อ ${res.groups.map(g => `${BottleDist._skuLabel(g)} (1 EA = ${g.bottlesPerEA} ขวด)`).join(' หรือ ')} ถึง ${res.minB} ขวดใน SKU เดียวกัน${view === 'all' ? ' — ร้านที่ถึงทั้ง 2 SKU นับ 1' : ''} · ทำมา/วัน สีเขียว = เร็วกว่าที่ต้องทำ</p>`;
    },
    _setView: (id, k) => { BottleDist._view[id] = k; BottleDist._renderAdminCamp(id); },

    // ─── ตั้งค่าแคมเปญ (admin) ──────────────────────────────────────────────
    _editing: null,
    _routesForTargets: () => {
        let list = [];
        if (typeof State !== 'undefined') list = (State.db?.routeList?.length ? State.db.routeList : State.routeList) || [];
        list = list.filter(r => r && r !== 'รอจัดสาย');
        return [...new Set(list.map(r => String(r).toUpperCase()))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    },
    _prodName: (code) => {
        code = String(code || '').trim();
        for (const rows of Object.values(BottleDist._rowCache)) {
            const r = rows.find(x => String(x.prodCode || '').trim() === code);
            if (r) return r.prodName || '';
        }
        if (typeof Dashboard !== 'undefined') {
            const r = (Dashboard._rows || []).find(x => String(x.prodCode || '').trim() === code);
            if (r) return r.prodName || '';
        }
        return '';
    },
    openSettings: (id) => {
        const ex = id ? BottleDist._campaigns.find(c => c.id === id) : null;
        const t = BottleDist._todayIso();
        const c = ex ? JSON.parse(JSON.stringify(ex)) : {
            name: 'กระจาย ซุปไก่ 39 มล.', startDate: t, endDate: BottleDist._addDays(t, 30), minBottles: 3,
            groups: [
                { code: '14010086', name: 'แบรนด์ซุปไก่ ต้นตำรับ 39 มล. P.3x4(Carnosine Plus)', bottlesPerEA: 3 },
                { code: '14010031', name: 'แบรนด์ซุปไก่ ต้นตำรับ 39 มล. P.12 (Carnosine Plus)', bottlesPerEA: 1 },
            ],
            targets: {}, holidays: [], showInSales: true,
        };
        BottleDist._editing = { id: ex ? ex.id : null, c };
        let ov = document.getElementById('bd-modal');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'bd-modal';
            ov.className = 'fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4';
            document.body.appendChild(ov);
        }
        const routes = [...new Set([...BottleDist._routesForTargets(), ...Object.keys(c.targets || {})])]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const inp = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300';
        ov.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div class="db-panel-head"><span class="db-panel-title">${ex ? 'ตั้งค่าแคมเปญ' : 'แคมเปญใหม่'} — ร้านกระจาย (นับขวด)</span>
                <button onclick="BottleDist.closeSettings()" class="text-gray-400 hover:text-gray-700 text-lg font-bold">✕</button></div>
            <div class="p-4 space-y-4 overflow-y-auto">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="sm:col-span-2 text-xs font-bold text-gray-500">ชื่อแคมเปญ<input id="bd-f-name" class="${inp} mt-1" value="${BottleDist._esc(c.name)}"></label>
                    <label class="text-xs font-bold text-gray-500">เริ่มนับ (KPI Date)<input id="bd-f-start" type="date" class="${inp} mt-1" value="${c.startDate || ''}"></label>
                    <label class="text-xs font-bold text-gray-500">สิ้นสุด<input id="bd-f-end" type="date" class="${inp} mt-1" value="${c.endDate || ''}"></label>
                    <label class="text-xs font-bold text-gray-500">ขวดขั้นต่ำต่อร้าน (ต่อ SKU)<input id="bd-f-min" type="number" min="1" class="${inp} mt-1" value="${c.minBottles || 1}"></label>
                    <label class="text-xs font-bold text-gray-500">วันหยุดเพิ่ม (นอกจากวันอาทิตย์)<input id="bd-f-hol" class="${inp} mt-1" placeholder="เช่น 2026-12-05, 2026-12-07" value="${BottleDist._esc((c.holidays || []).join(', '))}"></label>
                </div>
                <div>
                    <div class="text-xs font-bold text-gray-500 mb-2">SKU ที่นับ</div>
                    <div id="bd-f-groups" class="space-y-2"></div>
                    <button onclick="BottleDist._addSkuRow()" class="db-action-btn mt-2">+ เพิ่ม SKU</button>
                </div>
                <div>
                    <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
                        <span class="text-xs font-bold text-gray-500">Target ร้านกระจายรายสาย (เว้นว่าง = ไม่แสดงสายนั้น)</span>
                        <span class="flex items-center gap-1"><input id="bd-f-deft" type="number" min="0" placeholder="ทุกสาย" class="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right">
                        <button onclick="BottleDist._fillTargets()" class="db-action-btn">ใส่ทุกสาย</button></span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${routes.map(r => `
                        <label class="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1.5"><span class="text-xs font-bold text-gray-700 w-16 shrink-0">${BottleDist._esc(r)}</span>
                        <input data-bd-target="${BottleDist._esc(r)}" type="number" min="0" class="w-full bg-white border border-gray-200 rounded px-2 py-1 text-sm text-right font-bold" value="${c.targets?.[r] || ''}"></label>`).join('')}
                    </div>
                </div>
                <label class="flex items-center gap-2 text-sm text-gray-700"><input id="bd-f-show" type="checkbox" ${c.showInSales !== false ? 'checked' : ''}> แสดงในแอปเซล / Sup / ASM</label>
            </div>
            <div class="px-4 py-3 border-t border-gray-100 flex items-center gap-2">
                ${ex ? `<button onclick="BottleDist._delete()" class="text-xs font-bold text-red-600 hover:underline">ลบแคมเปญ</button>` : ''}
                <div class="flex-1"></div>
                <button onclick="BottleDist.closeSettings()" class="px-4 py-1.5 rounded-lg border border-gray-200 text-sm font-bold text-gray-500">ยกเลิก</button>
                <button id="bd-f-save" onclick="BottleDist._save()" class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold">บันทึก</button>
            </div>
        </div>`;
        ov.classList.remove('hidden');
        BottleDist._renderSkuRows();
    },
    closeSettings: () => { document.getElementById('bd-modal')?.classList.add('hidden'); BottleDist._editing = null; },
    _readSkuRows: () => [...document.querySelectorAll('#bd-f-groups [data-bd-sku]')].map(row => ({
        code: row.querySelector('[data-k=code]').value.trim(),
        name: row.querySelector('[data-k=name]').value.trim(),
        bottlesPerEA: Number(row.querySelector('[data-k=w]').value) || 1,
    })),
    _renderSkuRows: (groups) => {
        const box = document.getElementById('bd-f-groups');
        if (!box || !BottleDist._editing) return;
        const gs = groups || BottleDist._editing.c.groups || [];
        box.innerHTML = gs.map((g, i) => `
            <div data-bd-sku="${i}" class="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                <input data-k="code" placeholder="รหัสสินค้า" value="${BottleDist._esc(g.code)}" class="w-28 bg-white border border-gray-200 rounded px-2 py-1 text-sm font-mono"
                    onchange="const n=BottleDist._prodName(this.value); if(n) this.parentElement.querySelector('[data-k=name]').value=n;">
                <input data-k="name" placeholder="ชื่อสินค้า" value="${BottleDist._esc(g.name)}" class="flex-1 min-w-0 bg-white border border-gray-200 rounded px-2 py-1 text-sm">
                <input data-k="w" type="number" min="1" value="${g.bottlesPerEA || 1}" class="w-14 bg-white border border-gray-200 rounded px-2 py-1 text-sm text-right" title="ขวดต่อ 1 EA">
                <span class="text-[11px] text-gray-400 whitespace-nowrap">ขวด/EA</span>
                <button onclick="BottleDist._removeSkuRow(${i})" class="text-gray-400 hover:text-red-600 font-bold px-1">✕</button>
            </div>`).join('') || '<p class="text-xs text-gray-400">ยังไม่มี SKU</p>';
    },
    _addSkuRow: () => { const gs = BottleDist._readSkuRows(); gs.push({ code: '', name: '', bottlesPerEA: 1 }); BottleDist._renderSkuRows(gs); },
    _removeSkuRow: (i) => { const gs = BottleDist._readSkuRows(); gs.splice(i, 1); BottleDist._renderSkuRows(gs); },
    _fillTargets: () => {
        const v = document.getElementById('bd-f-deft')?.value;
        if (v === '' || v == null) return;
        document.querySelectorAll('[data-bd-target]').forEach(i => { i.value = v; });
    },
    _toast: (msg, err) => {
        if (typeof Dashboard !== 'undefined' && Dashboard._toast) Dashboard._toast(msg, err);
        else alert(msg);
    },
    _save: async () => {
        const ed = BottleDist._editing;
        if (!ed) return;
        const val = (id) => document.getElementById(id)?.value?.trim() || '';
        const targets = {};
        document.querySelectorAll('[data-bd-target]').forEach(i => {
            const n = Number(i.value);
            if (i.value !== '' && n > 0) targets[i.dataset.bdTarget] = n;
        });
        const holidays = val('bd-f-hol').split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
        const groups = BottleDist._readSkuRows().filter(g => g.code);
        const doc = {
            kind: 'bottleDist',
            name: val('bd-f-name') || 'ร้านกระจาย',
            centerId: BottleDist._centerKey(),
            center: BottleDist._centerId(),
            startDate: val('bd-f-start'),
            endDate: val('bd-f-end'),
            minBottles: Number(val('bd-f-min')) || 1,
            groups, targets, holidays,
            showInSales: !!document.getElementById('bd-f-show')?.checked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: (typeof Auth !== 'undefined' && Auth.getSession()?.username) || '',
        };
        if (!doc.centerId) return BottleDist._toast('⚠️ ไม่พบรหัสศูนย์', true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(doc.endDate) || doc.startDate > doc.endDate)
            return BottleDist._toast('⚠️ ตั้งวันเริ่ม/สิ้นสุดให้ถูกต้อง (เริ่มต้องไม่เกินสิ้นสุด)', true);
        if (!groups.length) return BottleDist._toast('⚠️ ใส่อย่างน้อย 1 SKU', true);
        if (BottleDist.monthsOf(doc).length > 12) return BottleDist._toast('⚠️ ช่วงแคมเปญยาวเกิน 12 เดือน', true);
        const btn = document.getElementById('bd-f-save');
        if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
        try {
            const col = BottleDist._fs().collection('skuDistribution');
            if (ed.id) await col.doc(ed.id).set(doc);
            else await col.add({ ...doc, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            BottleDist.closeSettings();
            BottleDist._toast('✅ บันทึกแคมเปญแล้ว');
            await BottleDist.mountAdmin();
        } catch (e) {
            console.error('[BottleDist] save', e);
            BottleDist._toast('❌ บันทึกไม่สำเร็จ: ' + (typeof ErrorMsg !== 'undefined' ? ErrorMsg.translate(e) : e.message), true);
            if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
        }
    },
    _delete: async () => {
        const ed = BottleDist._editing;
        if (!ed?.id) return;
        if (!confirm(`ลบแคมเปญ "${ed.c.name}" ? (ข้อมูล Sellout ไม่ถูกลบ)`)) return;
        try {
            await BottleDist._fs().collection('skuDistribution').doc(ed.id).delete();
            BottleDist.closeSettings();
            BottleDist._toast('🗑️ ลบแคมเปญแล้ว');
            await BottleDist.mountAdmin();
        } catch (e) { BottleDist._toast('❌ ลบไม่สำเร็จ: ' + e.message, true); }
    },

    // ════════════════════════════════════════════════════════════════════════
    // 📱 แอปเซล / Sup / ASM (sales.html → sales-dashboard.js)
    // ════════════════════════════════════════════════════════════════════════
    _salesState: {},
    _mounting: false,
    mountSales: async () => {
        const host = document.getElementById('db-bottledist-section');
        if (!host || BottleDist._mounting) return;
        BottleDist._mounting = true;
        try {
            // รอ _ymKeyMap ของ SalesDashboard (สูงสุด 30 วิ) — ถ้าเรียก _loadChunks ก่อน map พร้อม มันจะแคช 0 แถว
            // ของ path ผิดไว้ทั้ง session (ดูคอมเมนต์ _waitForYmKeyMap) ทำให้ Dashboard หลักว่างไปด้วย
            if (typeof SalesDashboard !== 'undefined') {
                for (let i = 0; i < 300 && !SalesDashboard._ymKeyMapLoaded; i++) await new Promise(r => setTimeout(r, 100));
                if (!SalesDashboard._ymKeyMapLoaded) return;
            }
            const camps = (await BottleDist.loadCampaigns()).filter(c => {
                if (c.showInSales === false || !c.startDate || !c.endDate) return false;
                const today = BottleDist._todayIso();
                // โชว์ตั้งแต่ต้นเดือนที่เริ่ม (เห็นช่วง "ก่อนนับ") ถึง 7 วันหลังสิ้นสุด (ข้อมูลวันท้ายๆ ยังเข้ามาอยู่)
                return today >= c.startDate.slice(0, 8) + '01' && today <= BottleDist._addDays(c.endDate, 7);
            });
            if (!camps.length) { host.innerHTML = ''; return; }
            const isSup = typeof App !== 'undefined' && App.isSupervisor && App.isSupervisor();
            const me = (Auth.getSession()?.username || '').toUpperCase();
            const parts = [];
            for (const c of camps) {
                const res = BottleDist.compute(c, await BottleDist._rowsFor(c));
                BottleDist._salesState[c.id] = { c, res, isSup, me };
                parts.push(`<div id="bd-s-${c.id}"></div>`);
            }
            host.innerHTML = parts.join('');
            camps.forEach(c => BottleDist._renderSalesCamp(c.id));
        } catch (e) {
            console.warn('[BottleDist] mountSales', e);
        } finally {
            BottleDist._mounting = false;
        }
    },

    _tabsHTML: (id, res, view, fn) => {
        const tabs = [{ k: 'all', l: `รวม ${res.groups.length} SKU` }, ...res.groups.map(g => ({ k: g.code, l: BottleDist._skuLabel(g) }))];
        if (tabs.length <= 2) return '';
        return `<div style="display:flex;gap:4px;background:#f3f4f6;border-radius:10px;padding:3px;margin:8px 0;width:fit-content;">${tabs.map(t =>
            `<button onclick="BottleDist.${fn}('${id}','${BottleDist._esc(t.k)}')" style="padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;border:none;cursor:pointer;font-family:inherit;${t.k === view ? 'background:#4f46e5;color:#fff;' : 'background:transparent;color:#6b7280;'}">${BottleDist._esc(t.l)}</button>`).join('')}</div>`;
    },
    _setSalesView: (id, k) => { BottleDist._view[id] = k; BottleDist._renderSalesCamp(id); },

    _renderSalesCamp: (id) => {
        const el = document.getElementById(`bd-s-${id}`);
        const st = BottleDist._salesState[id];
        if (!el || !st) return;
        const { c, res, isSup, me } = st;
        const view = BottleDist._view[id] || 'all';
        const head = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="font-size:13px;font-weight:900;color:#111827;">🍶 ${BottleDist._esc(c.name)}</div>
                <div style="font-size:10px;color:#6b7280;font-weight:700;text-align:right;white-space:nowrap;">${BottleDist.fmtDate(c.startDate)} – ${BottleDist.fmtDate(c.endDate)}</div>
            </div>
            <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${res.dataThrough ? `ข้อมูลถึง ${BottleDist.fmtDate(res.dataThrough)}` : 'ยังไม่มีข้อมูลในช่วงนับ'} · ทำมา ${res.daysDone} วัน · เหลือ ${res.daysLeft} วันทำงาน · ขั้นต่ำ ${res.minB} ขวด/ร้าน</div>
            ${BottleDist._tabsHTML(id, res, view, '_setSalesView')}`;

        if (isSup) {
            const sel = (typeof SupervisorUI !== 'undefined' && SupervisorUI._selectedRoute) ? String(SupervisorUI._selectedRoute).toUpperCase() : '';
            const row = (o, isTotal) => {
                const v = BottleDist._pick(o, view);
                const hl = !isTotal && o.sCode === sel;
                return `<tr style="border-top:1px solid #f1f5f9;${isTotal ? 'background:#f8fafc;font-weight:900;' : ''}${hl ? 'background:#eef2ff;' : ''}">
                    <td style="padding:6px 4px;font-weight:800;color:#111827;white-space:nowrap;">${BottleDist._esc(o.sCode.replace(/^\d{3}/, ''))}</td>
                    <td style="padding:6px 4px;text-align:right;"><b>${BottleDist._n(v.count)}</b><span style="color:#9ca3af;">/${v.target ? BottleDist._n(v.target) : '—'}</span></td>
                    <td style="padding:6px 4px;text-align:right;font-weight:800;color:${v.gap >= 0 ? '#059669' : '#dc2626'};">${v.target ? BottleDist._gap(v.gap) : '—'}</td>
                    <td style="padding:6px 4px;text-align:right;">${v.target ? BottleDist._d1(v.needPerDay) : '—'}</td>
                    <td style="padding:6px 4px;text-align:right;font-weight:800;color:${BottleDist._paceColor(v)};">${BottleDist._d1(v.donePerDay)}</td>
                </tr>`;
            };
            el.innerHTML = `<div class="db-card" style="flex-shrink:0;border-left:4px solid #4f46e5;">${head}
                <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">
                    <thead><tr style="color:#6b7280;font-size:10px;">
                        <th style="text-align:left;padding:4px;">สาย</th><th style="text-align:right;padding:4px;">กระจาย/Target</th>
                        <th style="text-align:right;padding:4px;">ส่วนต่าง</th><th style="text-align:right;padding:4px;">ต้องทำ/วัน</th><th style="text-align:right;padding:4px;">ทำมา/วัน</th>
                    </tr></thead>
                    <tbody>${res.rows.map(r => row(r, false)).join('')}${row(res.total, true)}</tbody>
                </table></div>
                ${res.hasPre ? `<div style="font-size:10px;color:#9ca3af;margin-top:6px;">ก่อนช่วงนับ (${BottleDist.fmtDate(res.preStart)} – ${BottleDist.fmtDate(BottleDist._addDays(c.startDate, -1))}) ทั้งศูนย์ ${BottleDist._n(BottleDist._pick(res.total, view).pre)} ร้าน — ไม่นับรวม</div>` : ''}
            </div>`;
            return;
        }

        const mine = res.rows.find(r => r.sCode === me);
        if (!mine) { el.innerHTML = ''; return; }
        const v = BottleDist._pick(mine, view);
        const pct = v.pct;
        const color = BottleDist._pctColor(pct);
        const box = (label, value, sub, col) => `<div style="background:#f8fafc;border-radius:10px;padding:8px;">
            <div style="font-size:10px;color:#6b7280;font-weight:700;">${label}</div>
            <div style="font-size:18px;font-weight:900;color:${col || '#111827'};line-height:1.2;">${value}</div>
            ${sub ? `<div style="font-size:10px;color:#9ca3af;">${sub}</div>` : ''}</div>`;
        const near = view === 'all' ? mine.near : [];
        el.innerHTML = `<div class="db-card" style="flex-shrink:0;border-left:4px solid ${color};">${head}
            <div style="display:flex;align-items:baseline;gap:6px;margin-top:4px;">
                <span style="font-size:28px;font-weight:900;color:${color};">${BottleDist._n(v.count)}</span>
                <span style="font-size:13px;font-weight:700;color:#6b7280;">/ ${v.target ? BottleDist._n(v.target) : '—'} ร้าน</span>
                <span style="margin-left:auto;font-size:14px;font-weight:900;color:${color};">${pct == null ? '' : Math.round(pct) + '%'}</span>
            </div>
            <div class="db-bar-track" style="height:10px;"><div class="db-bar-fill" style="height:10px;width:${Math.min(100, pct || 0)}%;background:${color};"></div></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:10px;">
                ${box('ยังขาด', v.target ? BottleDist._n(Math.max(0, -v.gap)) : '—', 'ร้าน', v.gap >= 0 ? '#059669' : '#dc2626')}
                ${box('ต้องทำ/วัน', v.target ? BottleDist._d1(v.needPerDay) : '—', `เหลือ ${res.daysLeft} วัน`)}
                ${box('ทำมา/วัน', BottleDist._d1(v.donePerDay), `${res.daysDone} วัน`, BottleDist._paceColor(v))}
            </div>
            ${res.hasPre ? `<div style="font-size:10px;color:#9ca3af;margin-top:8px;">ก่อนช่วงนับ (${BottleDist.fmtDate(res.preStart)} – ${BottleDist.fmtDate(BottleDist._addDays(c.startDate, -1))}): ${BottleDist._n(v.pre)} ร้าน — ไม่นับรวม</div>` : ''}
            ${near.length ? `<details style="margin-top:8px;"><summary style="font-size:11px;font-weight:800;color:#d97706;cursor:pointer;">ซื้อแล้วแต่ยังไม่ถึง ${res.minB} ขวด: ${near.length} ร้าน</summary>
                <div style="max-height:220px;overflow-y:auto;margin-top:6px;">${near.map(n => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:4px 0;border-top:1px solid #f1f5f9;">
                    <span style="color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${BottleDist._esc(n.name)}</span>
                    <span style="color:#d97706;font-weight:800;white-space:nowrap;">มี ${BottleDist._n(n.bottles)} · ขาด ${BottleDist._n(n.need)} ขวด</span></div>`).join('')}</div></details>` : ''}
        </div>`;
    },
};

window.BottleDist = BottleDist;

// ==========================================
// 📏 CampaignRule — กติกาเพิ่มของ Campaign "กระจายสินค้า" (SkuDist / skuDistribution) ที่ใช้ร่วมทุกหน้า
// (sku-distribution.js, dashboard.js, sales-dashboard.js, sales-app.js — ไฟล์นี้โหลดทั้ง index.html และ sales.html)
//   campaign.startDate / endDate ('YYYY-MM-DD', ไม่บังคับ) — นับเฉพาะแถวที่ KPI Date อยู่ในช่วง
//     (startYM/endYM ยังเก็บคู่กันเสมอ เพื่อให้ตัวโหลดเดือนเดิมทุกจุดทำงานเหมือนเดิม)
//   group.minQty (ไม่บังคับ) — ร้านต้องซื้อ "SKU ใด SKU หนึ่งในกลุ่ม" รวมถึง minQty ขวด จึงนับว่ากระจาย
//   group.unitMap { prodCode: ขวดต่อ 1 EA } — ไม่ใส่ = 1  (ขวด = qtyEA × ค่านี้, Credit Note ติดลบหักออก)
// Campaign เก่าที่ไม่มีฟิลด์เหล่านี้ → ผลเหมือนเดิมทุกอย่าง (ซื้อชิ้นเดียวก็นับ, ทั้งเดือน)
// ==========================================
const CampaignRule = {
    matchGroup: (g, r) => {
        const kws = (g.keywords || []).map(k => String(k).toLowerCase());
        const code = String(r.prodCode || '').toLowerCase();
        const name = String(r.prodName || '').toLowerCase();
        return kws.some(k => code.includes(k) || name.includes(k));
    },
    inDates: (c, r) => {
        if (!c || (!c.startDate && !c.endDate)) return true;
        const d = BottleDist.parseKpi(r.kpiDate);
        if (!d) return false;
        return (!c.startDate || d >= c.startDate) && (!c.endDate || d <= c.endDate);
    },
    // แถวของกลุ่ม g ที่ "นับ" ได้: อยู่ในช่วงวัน + (ถ้าตั้งขวดขั้นต่ำ) เป็นของร้านที่ถึงเกณฑ์เท่านั้น
    // ผู้เรียกนับร้าน/ยอดจากแถวที่ได้แบบเดิม — ร้านที่ไม่ถึงเกณฑ์จึงเท่ากับ "ยังไม่ซื้อ"
    filter: (c, g, rows) => {
        const m = (rows || []).filter(r => CampaignRule.matchGroup(g, r) && CampaignRule.inDates(c, r));
        const min = Number(g.minQty) || 0;
        if (min <= 0) return m;
        const unit = g.unitMap || {};
        const sum = {};   // cust → prodCode → ขวด
        m.forEach(r => {
            const cust = String(r.custCode || '').trim();
            const code = String(r.prodCode || '').trim();
            const s = (sum[cust] = sum[cust] || {});
            s[code] = (s[code] || 0) + (Number(r.qtyEA) || 0) * (Number(unit[code]) || 1);
        });
        const ok = new Set(Object.keys(sum).filter(cust => Object.values(sum[cust]).some(b => b >= min)));
        return m.filter(r => ok.has(String(r.custCode || '').trim()));
    },
    // ทุกกลุ่มรวมกัน (ร้านถึงเกณฑ์กลุ่มใดกลุ่มหนึ่ง) — สำหรับจุดที่เดิมรวม keyword ทุกกลุ่มเป็นก้อนเดียว
    filterAny: (c, rows) => {
        const out = new Set();
        (c.groups || []).forEach(g => CampaignRule.filter(c, g, rows).forEach(r => out.add(r)));
        return (rows || []).filter(r => out.has(r));
    },
    hasMin: (c) => (c.groups || []).some(g => Number(g.minQty) > 0),
    // เดือนทั้งหมดของ campaign (startYM..endYM)
    months: (c) => {
        const out = [];
        if (!c?.startYM || !c?.endYM) return out;
        let [y, m] = c.startYM.split('_').map(Number);
        const [ey, em] = c.endYM.split('_').map(Number);
        while ((y < ey || (y === ey && m <= em)) && out.length < 36) {
            out.push(`${y}_${String(m).padStart(2, '0')}`);
            m++; if (m > 12) { m = 1; y++; }
        }
        return out;
    },
    // โหลดแถวทุกเดือนของ campaign ด้วย loadFn(ym) — แอปเซลและ Sup/ASM ใช้ตัวเดียวกันให้ตัวเลขตรงกัน
    // กันนับซ้ำ: แถวในเอกสารเดือน X ที่ KPI Date เป็นเดือน Y (Y อยู่ในช่วงด้วย) จะถูกตัด — เอกสารเดือน Y มีแถวนั้นอยู่แล้ว
    // (เช่น 406_2026_12 ที่เคยอัปไฟล์ พ.ย. ผิดเดือนไว้)
    rangeRows: async (c, loadFn) => {
        const months = CampaignRule.months(c);
        const set = new Set(months);
        const per = await Promise.all(months.map(ym => Promise.resolve(loadFn(ym)).catch(() => [])));
        const out = [];
        per.forEach((rows, i) => {
            const ym = months[i];
            (rows || []).forEach(r => {
                const d = BottleDist.parseKpi(r.kpiDate);
                const rym = d ? d.slice(0, 7).replace('-', '_') : ym;
                if (rym !== ym && set.has(rym)) return;
                out.push(r);
            });
        });
        return out;
    },
    // ป้ายช่วงเวลา: ใช้วันที่ถ้ามี ไม่งั้นเดือนแบบเดิม
    periodLabel: (c) => {
        if (c.startDate && c.endDate) return `${BottleDist.fmtDate(c.startDate)} – ${BottleDist.fmtDate(c.endDate)}`;
        const f = (ym) => (typeof DateUtil !== 'undefined' && ym) ? DateUtil.ymToThaiShort(ym) : (ym || '');
        return `${f(c.startYM)} → ${f(c.endYM)}`;
    },
};
window.CampaignRule = CampaignRule;

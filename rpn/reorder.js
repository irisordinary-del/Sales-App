/* =============================================================================
 *  reorder.js — สลับลำดับตลาดในสาย (D1-2-3 → D1-3-2)
 * =============================================================================
 *  ไม่ได้ย้ายร้านทีละร้าน แต่สลับ "ป้ายวัน" ของทั้งกลุ่ม — ร้าน ลำดับคิว และชื่อตลาด
 *  เดินทางไปด้วยกันทั้งก้อน จึงไม่มีทางปนกัน (เป็นการสับตำแหน่ง ทุกช่องมีเจ้าของเดียว)
 *
 *  CY ไม่ขยับตามกลุ่ม — CY ผูกกับช่องวันของสาย (D1=CY..49, D2=CY..50) ตามกติกา AS&D
 *  ที่เลข CY ต้องไล่ตามลำดับวัน กลุ่มไหนมานั่งช่องไหนก็ใช้ CY ของช่องนั้น
 *
 *  สายแบบ F2 คู่ครึ่งรอบ (ครึ่งหลังเป็นตลาดเดียวกับครึ่งแรก) จะสลับได้เฉพาะครึ่งแรก
 *  แล้วครึ่งหลังสลับตามอัตโนมัติ (D2↔D3 ⇒ D14↔D15) ไม่งั้นคู่จะเหลื่อมกัน
 *
 *  V0.9.6: - จำนวนตลาดใช้รอบของสายนั้น (ปฏิทินรายสาย) ไม่ใช่ค่าของศูนย์
 *          - ตัดสินโหมดครึ่งรอบจาก "ตลาดครึ่งหลังเป็นคู่ของครึ่งแรกจริง" (ร้านซ้ำ ≥ 80%)
 *            เดิมแค่มีร้านอยู่ 2 วันร้านเดียวก็ถือว่าทั้งสายเป็น F2 → 403V01 มี 23 ตลาดโชว์ 12
 *          - F1/F2 ของตลาด · ครั้งที่เลือกวิ่ง · การแยกครั้ง · จุดเริ่ม/จบ ย้ายไปกับกลุ่ม
 *            วันที่วิ่งจริงจากไฟล์นำเข้า (vd) อยู่กับช่องวันเหมือน CY
 * ========================================================================== */
(function () {
    'use strict';

    const UNASSIGNED = 'รอจัดสาย';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;

    const S = { route: '', order: [], base: [], half: false, mK: 12, drag: -1, dragR: 0, view: 'both', rrows: null, rorder: null };

    const routesOpen = () => {
        const o = (typeof MultiRoute !== 'undefined' && MultiRoute.open) || [];
        const list = o.filter(r => r !== UNASSIGNED);
        return list.length ? list : Object.keys(State.db.routes || {}).filter(r => r !== UNASSIGNED);
    };

    const cycleOf = (route) => {
        try { if (typeof Runs !== 'undefined' && Runs.cycleOf) return Runs.cycleOf(route); } catch (e) {}
        return State.db.cycleDays || 24;
    };
    const detached = (route, d) => {
        try { return typeof Runs !== 'undefined' && Runs.isDetached && Runs.isDetached(route, d); } catch (e) { return false; }
    };

    const info = (route) => {
        const arr = ((State.db.routes || {})[route] || []).filter(s => !s.inactive);
        const k = cycleOf(route);
        const mK = Math.ceil(k / 2);
        const byDay = new Map();
        arr.forEach(s => (s.days || []).forEach(d => { let a = byDay.get(d); if (!a) byDay.set(d, a = []); a.push(s); }));
        // ช่องวันปกติของสาย (ไม่รวมช่องที่ "แยกครั้ง" ออกมา) — ปกติ = รอบของสาย, มีร้านอยู่เกินรอบก็โชว์ด้วย
        let upto = k;
        byDay.forEach((_, d) => { const n = num(d); if (n > upto && n <= 31 && !detached(route, d)) upto = n; });
        // ครึ่งหลังเป็นคู่ของครึ่งแรกจริงไหม: ร้านในช่อง i+mK อยู่ในช่อง i ด้วยกี่ %
        const ov = [], unpaired = [];
        for (let i = 1; i <= mK && i + mK <= k; i++) {
            const A = new Set((byDay.get('Day ' + i) || []).map(s => s.id));
            const B = byDay.get('Day ' + (i + mK)) || [];
            if (!B.length) continue;
            const r = B.filter(s => A.has(s.id)).length / B.length;
            ov.push(r);
            if (r < 0.8) unpaired.push('Day ' + (i + mK));
        }
        const half = ov.length > 0 && ov.reduce((a, b) => a + b, 0) / ov.length >= 0.8;
        const slots = [];
        for (let i = 1; i <= (half ? mK : upto); i++) {
            const d = 'Day ' + i;
            if (detached(route, d)) continue;
            const mem = byDay.get(d) || [];
            const mk = {};
            mem.forEach(s => { if (s.marketName) mk[s.marketName] = (mk[s.marketName] || 0) + 1; });
            const top = Object.entries(mk).sort((a, b) => b[1] - a[1])[0];
            slots.push({ day: d, n: mem.length, market: top ? top[0] : '' });
        }
        return { slots, half, hasF2: half, mK, k, unpaired: half ? unpaired : [], arr };
    };

    const open = (route) => {
        // V0.9.7: สายที่กำลังแก้อาจไม่ได้อยู่ในชุดที่เปิด (เช่น แถบบนเป็น 302C01 แต่เปิดดู 302P01)
        //   เดิมใช้สายที่กำลังแก้ แต่ช่องเลือกสายโชว์สายแรกของชุดที่เปิด → เห็นชื่อ 302P01 แต่ตลาดเป็นของ 302C01
        const ro = routesOpen();
        S.route = route || (ro.includes(State.localActiveRoute) ? State.localActiveRoute : ro[0]) || State.localActiveRoute;
        const f = info(S.route);
        S.half = f.half; S.mK = f.mK; S.k = f.k;
        S.base = f.slots.map(x => x.day);
        S.order = f.slots.map(x => x.day);
        S.rrows = null; S.rorder = null; S.drag = -1;
        render();
        const el = $('reorder-modal');
        el.classList.remove('hidden'); el.classList.add('flex');
    };
    const close = () => {
        const el = $('reorder-modal');
        if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
    };

    /** map วันเดิม -> วันใหม่ (รวมครึ่งหลังถ้าสายมีร้าน F2) */
    const perm = () => {
        const m = new Map();
        S.order.forEach((oldDay, i) => {
            const newDay = S.base[i];
            if (oldDay !== newDay) m.set(oldDay, newDay);
        });
        if (S.half) {
            const add = [];
            m.forEach((nd, od) => {
                const o2 = 'Day ' + (num(od) + S.mK), n2 = 'Day ' + (num(nd) + S.mK);
                if (num(od) + S.mK <= (S.k || cycleOf(S.route))) add.push([o2, n2]);
            });
            add.forEach(([a, b]) => m.set(a, b));
        }
        return m;
    };

    // ── V0.9.15: แสดงเป็นวันที่ (1 แถว = 1 วันที่) แบ่งรอบ · เลข D ติดกับตลาด ──────────────
    const WDs = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const THM = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const dlab = (d) => d ? WDs[d.getDay()] + ' ' + d.getDate() + ' ' + THM[d.getMonth()] : '—';
    const isoOf = (d) => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    const potOf = (route, slot) => { try { return Runs.potential(route, slot); } catch (e) { return []; } };
    const colorOf = (slot) => (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[slot]) ? DAY_COLORS[slot].hex : '#64748b';
    const slotInfo = (route, slot, arr) => {
        const mem = (arr || []).filter(s => !s.inactive && (s.days || []).includes(slot));
        const mk = {};
        mem.forEach(s => { if (s.marketName) mk[s.marketName] = (mk[s.marketName] || 0) + 1; });
        const top = Object.entries(mk).sort((a, b) => b[1] - a[1])[0];
        return { n: mem.length, market: top ? top[0] : '' };
    };
    /** จำนวนรอบในเดือนของสาย (รอบสั้น = จำนวนครั้งที่ช่องหนึ่งวิ่ง · รอบยาวคู่ครึ่งรอบ = 2 · อื่น ๆ = 1) */
    const roundsOf = () => {
        if (S.half) return 2;
        let mx = 1;
        try { if (Runs.isShort(S.route)) S.base.forEach(d => { mx = Math.max(mx, potOf(S.route, d).length); }); } catch (e) {}
        return mx;
    };

    /** แถวของโหมด "เฉพาะรอบที่ลาก" — จาก Runs.visitRows แยกตามรอบ */
    const buildRoundRows = () => {
        S.rrows = {}; S.rorder = {};
        if (typeof Runs === 'undefined' || !Runs.visitRows) return;
        const arr = ((State.db.routes || {})[S.route] || []).filter(s => !s.inactive);
        Runs.visitRows(S.route).forEach(r => {
            if (!r.date) return;
            const si = slotInfo(S.route, r.slot, arr);
            (S.rrows[r.k] || (S.rrows[r.k] = [])).push({ ...r, n: si.n, market: si.market, det: detached(S.route, r.slot) });
        });
        Object.keys(S.rrows).forEach(k => { S.rrows[k].sort((a, b) => a.date - b.date); S.rorder[k] = S.rrows[k].map((_, i) => i); });
    };
    /** รายการที่เปลี่ยนในโหมดเฉพาะรอบ: [{row, date}] */
    const roundChanges = () => {
        const out = [];
        Object.keys(S.rrows || {}).forEach(k => {
            const rows = S.rrows[k], ord = S.rorder[k];
            ord.forEach((idx, j) => { const row = rows[idx], d = rows[j].date; if (isoOf(row.date) !== isoOf(d)) out.push({ row, date: d, from: row.date }); });
        });
        return out;
    };

    const rowHTML = (o) => `
            <div draggable="true" data-i="${o.i}"
                ondragstart="Reorder.dragStart(${o.i},${o.r})" ondragover="event.preventDefault()" ondrop="Reorder.drop(${o.i},${o.r})"
                class="flex items-center gap-2 px-2.5 py-1.5 mb-1 rounded-xl border cursor-grab select-none
                       ${o.moved ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}">
                <span class="text-gray-300">⣿</span>
                <span class="text-[11px] font-bold text-gray-700 w-[72px] shrink-0 ${o.date ? '' : 'text-red-500'}">${esc(o.date ? dlab(o.date) : 'ไม่วิ่ง')}</span>
                <span class="text-[11px] font-black text-white rounded px-1.5 py-0.5 shrink-0" style="background:${o.color}">${esc(o.label)}</span>
                <span class="flex-1 min-w-0 truncate text-xs font-bold text-gray-800">${esc(o.market || '—')}</span>
                ${o.warn ? `<span title="${esc(o.warn)}" class="shrink-0 text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 cursor-help">⚠️</span>` : ''}
                ${o.moved ? `<span class="text-[9px] font-bold text-amber-700 shrink-0">มาจาก ${esc(o.from)}</span>` : ''}
                <span class="text-[11px] font-bold text-gray-500 tabular-nums shrink-0">${o.n}</span>
                <span class="flex flex-col leading-none shrink-0">
                    <button onclick="Reorder.move(${o.i},-1,${o.r})" class="text-[9px] text-gray-400 hover:text-gray-700">▲</button>
                    <button onclick="Reorder.move(${o.i},1,${o.r})" class="text-[9px] text-gray-400 hover:text-gray-700">▼</button>
                </span>
            </div>`;
    const roundHead = (r, rows) => {
        const ds = rows.map(x => x.date).filter(Boolean);
        const span = ds.length ? `${ds[0].getDate()}–${ds[ds.length - 1].getDate()} ${THM[ds[ds.length - 1].getMonth()]}` : '';
        return `<div class="text-[10px] font-black text-gray-500 tracking-wide mt-2 mb-1">รอบ ${r}${span ? ' · ' + span : ''}</div>`;
    };

    const render = () => {
        const el = $('reorder-modal');
        if (!el) return;
        const f = info(S.route);
        const byDay = new Map(f.slots.map(x => [x.day, x]));
        const changed = [...perm().entries()].filter(([a, b]) => a !== b);
        const dd = (d) => (typeof DayDate !== 'undefined' && (DayDate.dateOf(S.route, d) || {}).txt) || '';
        const nR = roundsOf();
        const canRound = nR >= 2 && !S.half;                 // รอบสั้นเท่านั้น (รอบยาวคู่ครึ่งรอบ = คนละช่องอยู่แล้ว สลับได้ตรง ๆ)
        if (S.view === 'round' && !canRound) S.view = 'both';
        const arrAll = f.arr;

        let rows = '', table = '', notes = '', btn = '', hint = '';
        if (S.view === 'round') {
            if (!S.rrows) buildRoundRows();
            const chg = roundChanges();
            const lastK = Math.max(...Object.keys(S.rrows).map(Number), 1);
            rows = Object.keys(S.rrows).sort((a, b) => a - b).map(k => {
                const list = S.rrows[k], ord = S.rorder[k];
                return roundHead(k, list) + ord.map((idx, j) => {
                    const row = list[idx], moved = idx !== j;
                    return rowHTML({ i: j, r: +k, date: list[j].date, label: row.label, color: colorOf(row.base), market: row.market, n: row.n,
                        moved, from: dlab(row.date), warn: moved ? 'ย้ายเฉพาะครั้งนี้ — ตลาดนี้จะแตกเป็น 2 CY (ไม่ห่าง 14 วัน) · เดือนหน้ากลับเป็นตามรอบ' : (row.det ? 'ครั้งนี้ถูกแยกไว้แล้ว (ร้าน/ลำดับเป็นของครั้งนี้เอง)' : '') });
                }).join('');
            }).join('');
            table = chg.length ? `
            <table class="w-full text-[11px] bg-white border border-gray-200 rounded-lg overflow-hidden mt-2">
                <tr class="bg-gray-50 text-gray-500"><th class="text-left px-2 py-1 font-bold">ตลาด</th>
                    <th class="px-1 py-1 font-bold">เดิม</th><th class="px-1"></th><th class="px-1 py-1 font-bold">ใหม่</th></tr>
                ${chg.map(({ row, date, from }) => `<tr class="border-t border-gray-100 bg-amber-50/40">
                    <td class="px-2 py-1">${esc(row.label)} ${esc(row.market || '')}</td>
                    <td class="px-1 py-1 text-center">${esc(dlab(from))}</td><td class="text-gray-300">→</td>
                    <td class="px-1 py-1 text-center font-black text-emerald-700">${esc(dlab(date))}</td></tr>`).join('')}
            </table>` : `<p class="text-[11px] text-gray-400 text-center py-3">ยังไม่ได้สลับอะไร — ลากแถวในรอบเดียวกัน หรือกดลูกศรขึ้น/ลง</p>`;
            notes = chg.length ? `<p class="text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2 leading-snug">
                ⚠️ ตลาดที่ย้าย ${chg.length} ครั้ง จะแตกเป็น CY แยก (ครั้งแรกกับครั้งนี้ห่างไม่ใช่ 14 วัน) · มีผลเฉพาะเดือนนี้ เดือนหน้ากลับเป็นตามรอบ · ย้อนได้ด้วย Ctrl+Z</p>` : '';
            hint = 'เลื่อนเฉพาะวันที่ลาก รอบอื่นไม่แตะ · มีผลเฉพาะเดือนนี้ เดือนหน้ากลับเป็นตามรอบ · ตลาดที่ย้ายจะแตกเป็น 2 CY';
            btn = `<button onclick="Reorder.applyRound()" ${chg.length ? '' : 'disabled'}
                    class="flex-[2] ${chg.length ? 'bg-gray-900 hover:bg-black text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'} py-2 rounded-xl text-sm font-bold">
                    ยืนยันสลับ ${chg.length ? chg.length + ' ครั้ง (เฉพาะเดือนนี้)' : ''}</button>`;
            void lastK;
        } else {
            // โหมดทั้ง 2 รอบ: ลำดับช่อง S.order (ตำแหน่ง i = ช่อง S.base[i]) · แสดงซ้ำทุกรอบตามวันที่ของช่องเป้าหมาย
            const roundRows = (r) => S.order.map((srcSlot, i) => {
                const tgt = S.base[i];
                let src = srcSlot, tgtS = tgt, label = 'D' + num(srcSlot), date = null, si, warn = '';
                if (S.half && r === 2) {
                    src = 'Day ' + (num(srcSlot) + S.mK); tgtS = 'Day ' + (num(tgt) + S.mK); label = 'D' + num(src);
                    date = (potOf(S.route, tgtS)[0] || {}).date || null;
                    si = slotInfo(S.route, src, arrAll);
                } else {
                    const p = potOf(S.route, tgtS)[r - 1];
                    date = p ? p.date : null;
                    let child = null;
                    try { child = (Runs.detachedOf(S.route, src) || {})[r]; } catch (e) {}
                    if (child) {
                        si = slotInfo(S.route, child, arrAll);
                        try { const df = Runs.diffOf(S.route, src, child); if (!df.same) warn = 'ครั้งนี้ร้าน/ลำดับไม่เหมือนครั้งแรก — ' + df.text; } catch (e) {}
                        if (child !== src) try { const m = Runs.metaOf(S.route, child); if (m && m.date) date = Runs.metaDate(S.route, child); } catch (e) {}
                    } else si = byDay.get(src) || slotInfo(S.route, src, arrAll);
                }
                return rowHTML({ i, r, date, label, color: colorOf(src), market: si.market, n: si.n, moved: tgt !== srcSlot, warn,
                                 from: (() => { const p0 = S.half && r === 2 ? (potOf(S.route, src)[0] || {}).date : (potOf(S.route, srcSlot)[r - 1] || {}).date; return dlab(p0); })() });
            }).join('');
            rows = (nR >= 2 ? [1, 2, 3, 4, 5].slice(0, nR).map(r => roundHead(r, S.base.map(t => ({ date: (S.half && r === 2) ? ((potOf(S.route, 'Day ' + (num(t) + S.mK))[0] || {}).date || null) : ((potOf(S.route, t)[r - 1] || {}).date || null) }))) + roundRows(r)).join('')
                             : roundRows(1));
            // ร้านที่อยู่มากกว่า 1 ตลาด และมีตลาดที่ถูกสลับ — วันของร้านเปลี่ยนตามทุกตลาด
            const pm = perm();
            const isPair = (ds) => S.half && ds.length === 2 && num(ds[1]) - num(ds[0]) === S.mK;     // คู่ F2 ปกติ ไม่ต้องเตือน
            const multi = changed.length ? f.arr.filter(s => {
                const ds = (s.days || []).filter(d => !detached(S.route, d)).sort((a, b) => num(a) - num(b));
                return ds.length > 1 && !isPair(ds) && ds.some(d => pm.has(d));
            }) : [];
            const detSrc = changed.map(([o]) => o).filter(o => { try { return Object.keys(Runs.detachedOf(S.route, o) || {}).length; } catch (e) { return false; } });
            notes = (multi.length ? `<p class="text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2 leading-snug">
                    ℹ️ <b>${multi.length} ร้าน</b>อยู่มากกว่า 1 ตลาด — วันของร้านจะเปลี่ยนตามทุกตลาดที่ร้านอยู่:<br>
                    ${multi.slice(0, 8).map(s => esc(s.name || s.id) + ' (' + s.days.map(d => 'D' + num(d) + (pm.has(d) ? '→D' + num(pm.get(d)) : '')).join(' · ') + ')').join('<br>')}${multi.length > 8 ? '<br>…' : ''}</p>` : '')
                + (detSrc.length ? `<p class="text-[10.5px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 mt-2 leading-snug">
                    ↪ ตลาด ${detSrc.map(d => 'D' + num(d)).join(' ')} มีครั้งที่แยกไว้ — ย้ายตามกลุ่มไปด้วย (วันที่ที่แยกไว้คงเดิม)</p>` : '');
            table = changed.length ? `
                <table class="w-full text-[11px] bg-white border border-gray-200 rounded-lg overflow-hidden mt-2">
                    <tr class="bg-gray-50 text-gray-500"><th class="text-left px-2 py-1 font-bold">ตลาด</th>
                        <th class="px-1 py-1 font-bold">เดิม</th><th class="px-1"></th><th class="px-1 py-1 font-bold">ใหม่</th></tr>
                    ${changed.map(([o, n]) => `<tr class="border-t border-gray-100 bg-amber-50/40">
                        <td class="px-2 py-1">D${num(o)} ${esc((byDay.get(o) || slotInfo(S.route, o, arrAll)).market || '')}</td>
                        <td class="px-1 py-1 text-center text-gray-500">${esc(dd(o))}</td><td class="text-gray-300">→</td>
                        <td class="px-1 py-1 text-center font-black text-emerald-700">${esc(dd(n))}</td></tr>`).join('')}
                </table>` : `<p class="text-[11px] text-gray-400 text-center py-3">ยังไม่ได้สลับอะไร — ลากแถวหรือกดลูกศรขึ้น/ลง</p>`;
            hint = nR >= 2 ? 'ลากในรอบไหนก็ได้ อีกรอบเลื่อนตามให้เอง · ลำดับใหม่ใช้ต่อเดือนหน้า · ยังเป็น 1 CY ต่อตลาด' : 'สลับทั้งกลุ่ม (ร้าน + ลำดับคิว + ชื่อตลาด) ย้ายไปด้วยกัน · CY ไม่ขยับ เพราะผูกกับช่องวัน';
            btn = `<button onclick="Reorder.apply()" ${changed.length ? '' : 'disabled'}
                    class="flex-[2] ${changed.length ? 'bg-gray-900 hover:bg-black text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'} py-2 rounded-xl text-sm font-bold">
                    ยืนยันสลับ ${changed.length ? changed.length + ' ตลาด' + (nR >= 2 ? ' (ทั้ง ' + nR + ' รอบ)' : '') : ''}</button>`;
        }
        const nDates = (() => { let c = 0; try { c = Runs.visitRows(S.route).filter(r => r.date).length; } catch (e) {} return c; })();
        const sw = (on, t, v) => `<button onclick="Reorder.setView('${v}')" class="flex-1 py-1 rounded-lg text-[11px] font-black ${on ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-200'}">${t}</button>`;

        el.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-4 max-h-[92vh] overflow-y-auto">
            <div class="flex items-center gap-2 mb-1">
                <h3 class="font-black text-gray-800 text-sm">⇅ จัดลำดับตลาด</h3>
                <select onchange="Reorder.open(this.value)" class="ml-auto border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold">
                    ${(routesOpen().includes(S.route) ? routesOpen() : [S.route].concat(routesOpen())).map(r => `<option value="${esc(r)}" ${r === S.route ? 'selected' : ''}>${esc(r)}</option>`).join('')}
                </select>
            </div>
            <p class="text-[10.5px] text-gray-500 leading-snug mb-2">
                สลับทั้งกลุ่ม (ร้าน + ลำดับคิว + ชื่อตลาด) ย้ายไปด้วยกัน · รอบสาย ${f.k} วัน · ${f.slots.length} ตลาด${nDates ? ' · ' + nDates + ' วันที่' : ''}
                ${S.half ? '<br><b class="text-amber-700">สายนี้เป็นแบบ F2 คู่ครึ่งรอบ</b> (D1 คู่ D' + (S.mK + 1) + ' …) — ครึ่งหลังสลับตามครึ่งแรกอัตโนมัติ' : ''}
                ${f.unpaired.length ? '<br><span class="text-red-600">⚠️ ช่องครึ่งหลังที่ไม่ใช่คู่ของครึ่งแรก: ' + f.unpaired.map(d => 'D' + num(d)).join(' ') + ' — ถ้าสลับคู่ของมัน ตลาดนี้จะถูกสลับตามด้วย</span>' : ''}
            </p>
            ${canRound ? `<div class="flex bg-gray-100 rounded-xl p-0.5 mb-1">${sw(S.view !== 'round', 'ทั้ง ' + nR + ' รอบ (เปลี่ยนลำดับถาวร)', 'both')}${sw(S.view === 'round', 'เฉพาะรอบที่ลาก (เดือนนี้)', 'round')}</div>` : ''}
            <p class="text-[10px] text-gray-500 leading-snug mb-2">${hint}</p>
            <div class="max-h-[46vh] overflow-y-auto pr-1">${rows}</div>
            ${table}${notes}
            <div class="flex gap-2 mt-3">
                <button onclick="Reorder.close()" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ยกเลิก</button>
                ${btn}
            </div>
        </div>`;
    };

    /** โหมดเฉพาะรอบ: ตั้งวันที่ของครั้งนั้น (แยกครั้งออกเป็นช่องของตัวเองถ้ายังไม่แยก) */
    const applyRound = async () => {
        const chg = roundChanges();
        if (!chg.length) return;
        const route = S.route;
        if (typeof EditHistory !== 'undefined') EditHistory.mark('สลับวันเฉพาะรอบ ' + route);
        UI.showLoader('⇅ กำลังย้ายวันของครั้งที่เลือก...', route);
        try {
            const arr = (State.db.routes || {})[route] || [];
            let needSave = false;
            for (const { row, date } of chg) {
                const iso = isoOf(date);
                if (row.det) {
                    arr.forEach(s => { if (s.runOf && s.runOf[row.slot]) s.runOf[row.slot].date = iso; });
                    needSave = true;
                } else {
                    const slot = await Runs.detach(route, row.slot, row.k, { date: iso });
                    if (!slot) throw new Error('แยกครั้งที่ ' + row.k + ' ของ ' + row.label + ' ไม่สำเร็จ');
                }
            }
            if (needSave) {
                try { Runs.bump(); } catch (e) {}
                await App.planRoutesCol(App._currentPlanYM).doc(route).set({ stores: arr,
                    confirmedBy: firebase.firestore.FieldValue.delete(), confirmedAt: firebase.firestore.FieldValue.delete() }, { merge: true });
            }
            UI.hideLoader();
            close();
            if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild();
            UI.render();
            UI.showSaveToast(`⇅ ย้ายวันแล้ว ${chg.length} ครั้ง ในสาย ${route} (เฉพาะเดือนนี้) — ตลาดที่ย้ายส่งออกเป็น CY แยก`);
        } catch (e) {
            UI.hideLoader();
            console.error('[Reorder.round]', e);
            UI.showErrorToast('❌ ย้ายวันไม่สำเร็จ: ' + (e && e.message));
        }
    };

    const apply = async () => {
        const m = perm();
        if (!m.size) return;
        const route = S.route;
        const R = State.db.routes || {};
        const arr = R[route] || [];
        if (typeof EditHistory !== 'undefined') EditHistory.mark('สลับลำดับตลาด ' + route);
        UI.showLoader('⇅ กำลังสลับลำดับตลาด...', route);
        try {
            // CY ของแต่ละช่องวัน (อ่านก่อนสลับ) — CY อยู่กับช่อง ไม่ได้ไปกับกลุ่ม
            const cyBySlot = {};
            arr.forEach(s => (s.days || []).forEach(d => {
                const c = (s.cys && s.cys[d]) || ((s.days || []).length === 1 ? s.cy : '');
                if (c && !cyBySlot[d]) cyBySlot[d] = c;
            }));
            // วันที่วิ่งจริงจากไฟล์นำเข้า (vd) ก็เป็นของช่องวัน — ใช้ค่าที่พบมากสุดของช่องนั้น
            const vdCnt = {};
            arr.forEach(s => (s.days || []).forEach(d => { const v = s.vd && s.vd[d]; if (v) { const o = vdCnt[d] || (vdCnt[d] = {}); o[v] = (o[v] || 0) + 1; } }));
            const vdBySlot = {};
            Object.keys(vdCnt).forEach(d => { vdBySlot[d] = Object.entries(vdCnt[d]).sort((a, b) => b[1] - a[1])[0][0]; });
            const mapKeys = (obj) => {                    // ค่าที่เป็นของตลาด (ย้ายไปกับกลุ่ม)
                if (!obj) return obj;
                const o = {};
                Object.keys(obj).forEach(d => { o[m.get(d) || d] = obj[d]; });
                return o;
            };
            arr.forEach(s => {
                const old = s.days || [];
                if (!old.length) return;
                const nd = old.map(d => m.get(d) || d);
                const nc = {};
                nd.forEach(t => { if (cyBySlot[t]) nc[t] = cyBySlot[t]; });
                s.days = nd.sort((a, b) => num(a) - num(b));
                s.seqs = mapKeys(s.seqs || {});
                if (s.fqs) s.fqs = mapKeys(s.fqs);
                if (s.fqRun) s.fqRun = mapKeys(s.fqRun);
                if (s.runOf) Object.keys(s.runOf).forEach(k => { const r = s.runOf[k]; if (r && r.src && m.has(r.src)) r.src = m.get(r.src); });
                if (s.vd) { const nv = {}; s.days.forEach(t => { if (vdBySlot[t]) nv[t] = vdBySlot[t]; }); s.vd = nv; }
                s.cys = nc;
                s.cy = nc[s.days[0]] || '';
            });
            // จุดเริ่ม/จบของตลาด ย้ายตามกลุ่ม
            let cpChanged = false;
            const CP = State.db.cyPoints && State.db.cyPoints[route];
            if (CP && Object.keys(CP).some(d => m.has(d))) { State.db.cyPoints[route] = mapKeys(CP); cpChanged = true; }
            try { if (typeof Runs !== 'undefined' && Runs.bump) Runs.bump(); } catch (e) {}

            const ym = App._currentPlanYM;
            const routeList = Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            await Promise.all([
                App.planRoutesCol(ym).doc(route).set({
                    stores: arr,
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                }, { merge: true }),
                App.planRef(ym).set({ routeList, cycleDays: State.db.cycleDays || 24,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
                cpChanged ? App.dbRef.set({ cyPoints: State.db.cyPoints }, { mergeFields: ['cyPoints'] }) : null,
            ]);
            UI.hideLoader();
            close();
            if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild();
            UI.render();
            UI.showSaveToast(`⇅ สลับแล้ว ${m.size} ตลาด ในสาย ${route} — CY ยังเรียงตามวันเหมือนเดิม`);
        } catch (e) {
            UI.hideLoader();
            console.error('[Reorder]', e);
            UI.showErrorToast('❌ สลับไม่สำเร็จ: ' + (e && e.message));
        }
    };

    window.Reorder = {
        open(r) { open(r); },
        close,
        apply,
        applyRound,
        setView(v) { S.view = v === 'round' ? 'round' : 'both'; if (S.view === 'round') buildRoundRows(); S.drag = -1; render(); },
        dragStart(i, r) { S.drag = i; S.dragR = r || 0; },
        drop(i, r) {
            const from = S.drag;
            if (from < 0) return;
            if (S.view === 'round') {
                // ลากได้เฉพาะในรอบเดียวกัน
                if ((r || 0) !== S.dragR || from === i) { S.drag = -1; return; }
                const ord = S.rorder[r];
                const it = ord.splice(from, 1)[0]; ord.splice(i, 0, it);
            } else {
                if (from === i) return;
                const it = S.order.splice(from, 1)[0];
                S.order.splice(i, 0, it);
            }
            S.drag = -1;
            render();
        },
        move(i, dir, r) {
            const j = i + dir;
            const list = S.view === 'round' ? S.rorder[r] : S.order;
            if (!list || j < 0 || j >= list.length) return;
            const t = list[i]; list[i] = list[j]; list[j] = t;
            render();
        },
        _state: S,
    };

    // ── ปุ่มเปิดในแท็บ 1 ────────────────────────────────────────────────
    const mount = () => {
        if (!$('reorder-modal')) {
            const m = document.createElement('div');
            m.id = 'reorder-modal';
            m.className = 'fixed inset-0 bg-black/50 z-[9000] hidden items-center justify-center p-4';
            m.addEventListener('click', (e) => { if (e.target === m) close(); });
            document.body.appendChild(m);
        }
        if ($('reorder-btn')) return;
        const host = $('tabs-search');
        if (!host || !host.parentNode) return;
        const bar = document.createElement('div');
        bar.className = 'flex justify-end pt-1.5';
        bar.innerHTML = `<button id="reorder-btn" onclick="Reorder.open()"
            title="สลับลำดับตลาดในสาย เช่น 1-2-3 เป็น 1-3-2"
            class="text-[11px] font-bold text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg px-3 py-1 transition">
            ⇅ จัดลำดับตลาด</button>`;
        host.parentNode.appendChild(bar);
    };

    document.addEventListener('DOMContentLoaded', () => {
        [900, 2500, 5000, 9000].forEach(t => setTimeout(() => { try { mount(); } catch (e) {} }, t));
    });
})();

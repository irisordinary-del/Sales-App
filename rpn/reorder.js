/* =============================================================================
 *  reorder.js — สลับลำดับตลาดในสาย (D1-2-3 → D1-3-2)
 * =============================================================================
 *  ไม่ได้ย้ายร้านทีละร้าน แต่สลับ "ป้ายวัน" ของทั้งกลุ่ม — ร้าน ลำดับคิว และชื่อตลาด
 *  เดินทางไปด้วยกันทั้งก้อน จึงไม่มีทางปนกัน (เป็นการสับตำแหน่ง ทุกช่องมีเจ้าของเดียว)
 *
 *  CY ไม่ขยับตามกลุ่ม — CY ผูกกับช่องวันของสาย (D1=CY..49, D2=CY..50) ตามกติกา AS&D
 *  ที่เลข CY ต้องไล่ตามลำดับวัน กลุ่มไหนมานั่งช่องไหนก็ใช้ CY ของช่องนั้น
 *
 *  ร้าน F2 อยู่ 2 วันคู่ครึ่งรอบเสมอ ถ้าสายมีร้าน F2 จะสลับได้เฉพาะครึ่งแรก
 *  แล้วครึ่งหลังสลับตามอัตโนมัติ (D2↔D3 ⇒ D14↔D15) ไม่งั้นคู่จะเหลื่อมกัน
 * ========================================================================== */
(function () {
    'use strict';

    const UNASSIGNED = 'รอจัดสาย';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;

    const S = { route: '', order: [], base: [], half: false, mK: 12, drag: -1 };

    const routesOpen = () => {
        const o = (typeof MultiRoute !== 'undefined' && MultiRoute.open) || [];
        const list = o.filter(r => r !== UNASSIGNED);
        return list.length ? list : Object.keys(State.db.routes || {}).filter(r => r !== UNASSIGNED);
    };

    const info = (route) => {
        const arr = (State.db.routes || {})[route] || [];
        const k = State.db.cycleDays || 24;
        const mK = Math.ceil(k / 2);
        const hasF2 = arr.some(s => s.freq === 2 && !s.inactive);
        const slots = [];
        const upto = hasF2 ? mK : k;
        for (let i = 1; i <= upto; i++) {
            const d = 'Day ' + i;
            const mem = arr.filter(s => !s.inactive && (s.days || []).includes(d));
            const mk = {};
            mem.forEach(s => { if (s.marketName) mk[s.marketName] = (mk[s.marketName] || 0) + 1; });
            const top = Object.entries(mk).sort((a, b) => b[1] - a[1])[0];
            slots.push({ day: d, n: mem.length, market: top ? top[0] : '' });
        }
        return { slots, hasF2, mK, k };
    };

    const open = (route) => {
        S.route = route || State.localActiveRoute || routesOpen()[0];
        const f = info(S.route);
        S.half = f.hasF2; S.mK = f.mK;
        S.base = f.slots.map(x => x.day);
        S.order = f.slots.map(x => x.day);
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
                if (num(od) + S.mK <= (State.db.cycleDays || 24)) add.push([o2, n2]);
            });
            add.forEach(([a, b]) => m.set(a, b));
        }
        return m;
    };

    const render = () => {
        const el = $('reorder-modal');
        if (!el) return;
        const f = info(S.route);
        const byDay = new Map(f.slots.map(x => [x.day, x]));
        const changed = [...perm().entries()].filter(([a, b]) => a !== b);
        const dd = (d) => (typeof DayDate !== 'undefined' && (DayDate.dateOf(S.route, d) || {}).txt) || '';

        const rows = S.order.map((day, i) => {
            const slot = byDay.get(day) || { n: 0, market: '' };
            const target = S.base[i];
            const moved = target !== day;
            return `
            <div draggable="true" data-i="${i}"
                ondragstart="Reorder.dragStart(${i})" ondragover="event.preventDefault()" ondrop="Reorder.drop(${i})"
                class="flex items-center gap-2 px-2.5 py-2 mb-1 rounded-xl border cursor-grab select-none
                       ${moved ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}">
                <span class="text-gray-300">⣿</span>
                <span class="text-[11px] font-black text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">D${num(target)}</span>
                <span class="flex-1 min-w-0 truncate text-xs font-bold text-gray-800">${esc(slot.market || '—')}</span>
                <span class="text-[10px] text-gray-400">${dd(target)}</span>
                <span class="text-[11px] font-bold text-gray-500 tabular-nums">${slot.n}</span>
                ${moved ? `<span class="text-[9px] font-bold text-amber-700">มาจาก D${num(day)}</span>` : ''}
                <span class="flex flex-col leading-none">
                    <button onclick="Reorder.move(${i},-1)" class="text-[9px] text-gray-400 hover:text-gray-700">▲</button>
                    <button onclick="Reorder.move(${i},1)" class="text-[9px] text-gray-400 hover:text-gray-700">▼</button>
                </span>
            </div>`;
        }).join('');

        const table = changed.length ? `
            <table class="w-full text-[11px] bg-white border border-gray-200 rounded-lg overflow-hidden mt-2">
                <tr class="bg-gray-50 text-gray-500"><th class="text-left px-2 py-1 font-bold">ตลาด</th>
                    <th class="px-1 py-1 font-bold">เดิม</th><th class="px-1"></th><th class="px-1 py-1 font-bold">ใหม่</th>
                    <th class="text-left px-2 py-1 font-bold">วันที่จริง</th></tr>
                ${changed.map(([o, n]) => `<tr class="border-t border-gray-100 bg-amber-50/40">
                    <td class="px-2 py-1">${esc((byDay.get(o) || {}).market || '—')}</td>
                    <td class="px-1 py-1 text-center">D${num(o)}</td><td class="text-gray-300">→</td>
                    <td class="px-1 py-1 text-center font-black text-emerald-700">D${num(n)}</td>
                    <td class="px-2 py-1 text-gray-500">${dd(n)}</td></tr>`).join('')}
            </table>` : `<p class="text-[11px] text-gray-400 text-center py-3">ยังไม่ได้สลับอะไร — ลากแถวหรือกดลูกศรขึ้น/ลง</p>`;

        el.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-4 max-h-[90vh] overflow-y-auto">
            <div class="flex items-center gap-2 mb-1">
                <h3 class="font-black text-gray-800 text-sm">⇅ จัดลำดับตลาด</h3>
                <select onchange="Reorder.open(this.value)" class="ml-auto border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold">
                    ${routesOpen().map(r => `<option value="${esc(r)}" ${r === S.route ? 'selected' : ''}>${esc(r)}</option>`).join('')}
                </select>
            </div>
            <p class="text-[10.5px] text-gray-500 leading-snug mb-2">
                สลับทั้งกลุ่ม (ร้าน + ลำดับคิว + ชื่อตลาด) ย้ายไปด้วยกัน · <b>CY ไม่ขยับ</b> เพราะผูกกับช่องวัน
                ${S.half ? '<br><b class="text-amber-700">สายนี้มีร้าน F2</b> — สลับได้เฉพาะ D1-D' + S.mK + ' ครึ่งหลังสลับตามให้อัตโนมัติ' : ''}
            </p>
            <div class="max-h-64 overflow-y-auto pr-1">${rows}</div>
            ${table}
            <div class="flex gap-2 mt-3">
                <button onclick="Reorder.close()" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ยกเลิก</button>
                <button onclick="Reorder.apply()" ${changed.length ? '' : 'disabled'}
                    class="flex-[2] ${changed.length ? 'bg-gray-900 hover:bg-black text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'} py-2 rounded-xl text-sm font-bold">
                    ยืนยันสลับ ${changed.length ? changed.length + ' ตลาด' : ''}
                </button>
            </div>
        </div>`;
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
            arr.forEach(s => {
                const old = s.days || [];
                if (!old.length) return;
                const nd = old.map(d => m.get(d) || d);
                const ns = {}, nc = {};
                old.forEach(d => {
                    const t = m.get(d) || d;
                    if (s.seqs && s.seqs[d] != null) ns[t] = s.seqs[d];
                });
                nd.forEach(t => { if (cyBySlot[t]) nc[t] = cyBySlot[t]; });
                s.days = nd.sort((a, b) => num(a) - num(b));
                s.seqs = ns; s.cys = nc;
                s.cy = nc[s.days[0]] || '';
            });

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
        dragStart(i) { S.drag = i; },
        drop(i) {
            const from = S.drag;
            if (from < 0 || from === i) return;
            const it = S.order.splice(from, 1)[0];
            S.order.splice(i, 0, it);
            S.drag = -1;
            render();
        },
        move(i, dir) {
            const j = i + dir;
            if (j < 0 || j >= S.order.length) return;
            const t = S.order[i]; S.order[i] = S.order[j]; S.order[j] = t;
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

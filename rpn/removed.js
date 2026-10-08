/* =============================================================================
 *  removed.js — กอง "ออกจากแผน" (V0.7.5)
 * =============================================================================
 *  แยกออกจากกอง "รอจัดสาย" ให้ชัด
 *    รอจัดสาย   = ร้านใหม่ที่ยังไม่มีสาย/วัน + ร้านที่ถอดออกจากสายเพื่อรอย้ายไปสายอื่น
 *    ออกจากแผน = ร้านที่ตั้งใจเอาออกจากแผนเดือนนี้ (เหมือน Inactive) → นับเป็น "Remove" ในหน้าภาพรวม
 *
 *  ใช้ธง inactive ตัวเดิมที่ทั้งระบบรู้จักอยู่แล้ว (แผนที่ / ตัวนับ / ส่งออก DMS / Geo Tree ข้ามร้าน inactive หมด)
 *  ร้านยังอยู่ในสายเดิม แค่ถอดวัน-คิวออก และจำของเดิมไว้ใน wasPlan → ดึงกลับแล้วกลับวันเดิมได้
 *  ร้านที่ระบบพักให้เอง (หายจากไฟล์นำเข้า / Customer Master เป็น Inactive) ก็มาอยู่กองนี้เหมือนกัน
 * ========================================================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const UNASSIGNED = 'รอจัดสาย';
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const dLabel = (d) => String(d || '').replace('Day ', 'D');
    const R = () => (State.db && State.db.routes) || {};
    const byName = (a, b) => a.localeCompare(b, 'th', { numeric: true });

    /** ร้านทุกร้านในกองออกจากแผน → [{ rt, s }] */
    const list = () => {
        const out = [];
        Object.keys(R()).sort(byName).forEach(rt => (R()[rt] || []).forEach(s => { if (s && s.inactive) out.push({ rt, s }); }));
        return out;
    };
    const count = () => list().length;
    const parkedCount = () => (R()[UNASSIGNED] || []).filter(s => s && !s.inactive).length;

    const find = (id) => {
        const k = String(id);
        for (const rt of Object.keys(R())) {
            const s = (R()[rt] || []).find(x => x && String(x.id) === k);
            if (s) return { rt, s };
        }
        return null;
    };

    /** วันเดิมของร้าน (ก่อนเอาออก) — ร้านที่ระบบพักเองไม่มี wasPlan ใช้ days ที่ค้างอยู่ */
    const oldDays = (s) => ((s.wasPlan && s.wasPlan.days) || s.days || []).slice().sort((a, b) => dayNum(a) - dayNum(b));

    const save = async (touched) => {
        const ym = App._currentPlanYM;
        await Promise.all([...touched].filter(r => Array.isArray(R()[r])).map(r => App.planRoutesCol(ym).doc(r).set({
            stores: R()[r],
            confirmedBy: firebase.firestore.FieldValue.delete(),
            confirmedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true })));
    };
    const refresh = () => {
        try {
            if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen) MultiRoute.setOpen(MultiRoute.open);
            else UI.render();
        } catch (e) { try { UI.render(); } catch (e2) {} }
        try { const pg = $('page-overview'); if (pg && !pg.classList.contains('hidden') && window.PlanOverview) PlanOverview.render(); } catch (e) {}
        paintBasket();
        if (isOpen()) paint();
    };

    /** เอาร้านออกจากแผน (หลายร้านได้) */
    const remove = async (ids) => {
        const want = [...new Set((ids || []).map(String))];
        const touched = new Set(), reflow = new Map();
        let n = 0;
        const now = new Date().toISOString();
        want.forEach(id => {
            const f = find(id);
            if (!f || f.s.inactive) return;
            const { rt, s } = f;
            const days = [...(s.days || [])];
            s.wasPlan = {
                days, seqs: { ...(s.seqs || {}) },
                fqs: s.fqs ? { ...s.fqs } : undefined,
                runOf: s.runOf ? JSON.parse(JSON.stringify(s.runOf)) : undefined,
                freq: s.freq, at: now,
            };
            if (days.length) { if (!reflow.has(rt)) reflow.set(rt, new Set()); days.forEach(d => reflow.get(rt).add(d)); }
            s.days = []; s.seqs = {}; s.cys = {}; s.cy = '';
            delete s.fqs; delete s.runOf;
            s.inactive = true; s.removedAt = now; s.selected = false;
            touched.add(rt); n++;
        });
        if (!n) return UI.showErrorToast('ℹ️ ไม่มีร้านที่เอาออกได้ (อาจอยู่ในกองออกจากแผนแล้ว)');
        try { if (window.EditHistory && EditHistory.mark) EditHistory.mark('เอาร้านออกจากแผน'); } catch (e) {}
        // ไล่เลขคิวใหม่ในวันที่ร้านหลุดออกไป (เลขขาดช่วงจะติดไปในไฟล์ DMS)
        if (typeof SeqTool !== 'undefined' && SeqTool.compact) {
            reflow.forEach((days, rt) => days.forEach(d => { try { SeqTool.compact(d, rt); } catch (e) {} }));
        }
        UI.showLoader('🗑️ กำลังเอาออกจากแผน...', `${n} ร้าน`);
        try { await save(touched); } catch (e) { UI.hideLoader(); return UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message)); }
        UI.hideLoader();
        refresh();
        UI.showSaveToast(`🗑️ เอา ${n.toLocaleString()} ร้านออกจากแผนแล้ว → กอง "ออกจากแผน" · นับเป็น Remove · ย้อนกลับได้ (Ctrl+Z)`);
        return n;
    };

    /** ดึงกลับเข้าแผน — กลับสายเดิม วันเดิม (ถ้าวันนั้นยังมีในสาย) ต่อท้ายคิว */
    const restore = async (ids) => {
        const want = new Set((ids || []).map(String));
        const touched = new Set();
        let back = 0, noDay = 0;
        list().filter(x => want.has(String(x.s.id))).forEach(({ rt, s }) => {
            const w = s.wasPlan || { days: s.days || [], seqs: s.seqs || {} };
            const live = new Set((R()[rt] || []).filter(x => !x.inactive).flatMap(x => x.days || []));
            const k = (typeof Freq !== 'undefined' && Freq._cycleOf) ? (Freq._cycleOf(rt) || 24) : 24;
            // วันเดิมยังมีร้านอื่นอยู่ หรือเป็นช่องวันปกติในรอบ (ตลาดที่เหลือร้านเดียวแล้วโดนเอาออก) → กลับวันเดิมได้
            const days = rt === UNASSIGNED ? [] : (w.days || []).filter(d => live.has(d) || (dayNum(d) >= 1 && dayNum(d) <= k && !(w.runOf || {})[d]));
            const seqs = {};
            days.forEach(d => {
                const mx = (R()[rt] || []).filter(x => !x.inactive && (x.days || []).includes(d))
                    .reduce((m, x) => Math.max(m, (x.seqs || {})[d] || 0), 0);
                seqs[d] = mx + 1;
            });
            s.days = days; s.seqs = seqs; s.cys = {}; s.cy = '';
            if (w.fqs) { const f = {}; days.forEach(d => { if (w.fqs[d] != null) f[d] = w.fqs[d]; }); if (Object.keys(f).length) s.fqs = f; }
            if (w.runOf) { const r = {}; days.forEach(d => { if (w.runOf[d]) r[d] = w.runOf[d]; }); if (Object.keys(r).length) s.runOf = r; }
            s.freq = days.length > 1 ? 2 : 1;
            s.inactive = false;
            delete s.wasPlan; delete s.removedAt;
            touched.add(rt);
            if (days.length) back++; else noDay++;
        });
        const n = back + noDay;
        if (!n) return UI.showErrorToast('⚠️ ติ๊กร้านที่จะดึงกลับก่อน');
        try { if (window.EditHistory && EditHistory.mark) EditHistory.mark('ดึงร้านกลับเข้าแผน'); } catch (e) {}
        UI.showLoader('↩️ กำลังดึงกลับ...', `${n} ร้าน`);
        try { await save(touched); } catch (e) { UI.hideLoader(); return UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message)); }
        UI.hideLoader();
        refresh();
        UI.showSaveToast(`↩️ ดึงกลับ ${n} ร้าน`
            + (back ? ` · กลับวันเดิม ${back}` : '') + (noDay ? ` · ${noDay} ร้านไม่มีวันเดิมในสายแล้ว → "รอจัดวัน"` : ''));
        return n;
    };

    // ── หน้าต่างกองออกจากแผน ─────────────────────────────────────────────
    let hi = new Set(), q = '';
    const isOpen = () => { const el = $('removed-modal'); return el && !el.classList.contains('hidden'); };
    const open = (ids) => {
        hi = new Set((ids || []).map(String));
        q = '';
        let el = $('removed-modal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'removed-modal';
            el.className = 'hidden fixed inset-0 bg-black/50 z-[9998] items-center justify-center p-4';
            el.onclick = (e) => { if (e.target === el) close(); };
            document.body.appendChild(el);
        }
        el.classList.remove('hidden'); el.classList.add('flex');
        paint();
    };
    const close = () => { const el = $('removed-modal'); if (el) { el.classList.add('hidden'); el.classList.remove('flex'); } };

    const paint = () => {
        const el = $('removed-modal');
        if (!el) return;
        const all = list();
        const ql = q.trim().toLowerCase();
        const shown = all.filter(({ rt, s }) => !ql || [s.name, s.code, s.id, rt].some(v => String(v || '').toLowerCase().includes(ql)))
            .sort((a, b) => (hi.has(String(b.s.id)) - hi.has(String(a.s.id))) || byName(a.rt, b.rt));
        const groups = new Map();
        shown.forEach(x => { if (!groups.has(x.rt)) groups.set(x.rt, []); groups.get(x.rt).push(x.s); });
        const when = (s) => {
            const t = s.removedAt || (s.wasPlan && s.wasPlan.at);
            if (!t) return 'ระบบพักให้ (หายจากไฟล์ / Inactive)';
            const d = new Date(t);
            return isNaN(d) ? '' : 'เอาออกเมื่อ ' + d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        };
        el.innerHTML = `
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-4 flex flex-col max-h-[88vh]">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-base font-black text-gray-900 flex-1">🗑️ ออกจากแผน</h3>
              <span class="text-xs font-black text-white bg-red-600 rounded-lg px-2 py-1">${all.length.toLocaleString()} ร้าน</span>
              <button onclick="Removed.close()" class="text-gray-400 hover:text-gray-700 text-lg leading-none px-1">✕</button>
            </div>
            <p class="text-[10.5px] text-gray-500 leading-snug mb-2">ร้านที่เอาออกจากแผนเดือนนี้ — <b>ไม่ถูกส่งออก DMS</b> · นับเป็น <b>Remove</b> ในหน้าภาพรวม ·
              ร้านไม่หาย ติ๊กแล้วกด "ดึงกลับ" จะกลับเข้าสายเดิม วันเดิม (ต่อท้ายคิว)<br>
              ร้านใหม่ / ร้านที่ถอดเพื่อรอย้ายสาย อยู่ในกอง <b>"รอจัดสาย"</b> ไม่ใช่กองนี้</p>
            <input id="removed-q" value="${esc(q)}" oninput="Removed._q(this.value)" placeholder="🔍 ค้นหาชื่อ / รหัส / สาย"
                   class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs mb-2">
            <div class="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
              ${all.length ? '' : '<p class="text-center text-xs text-gray-400 py-8">ยังไม่มีร้านที่เอาออกจากแผน</p>'}
              ${[...groups.entries()].map(([rt, arr]) => `
                <div class="border border-gray-200 rounded-xl">
                  <div class="flex items-center gap-2 px-2 py-1 bg-gray-50 rounded-t-xl">
                    <span class="font-mono font-black text-xs text-gray-700 flex-1">${esc(rt)}</span>
                    <button onclick="Removed._tickRoute('${esc(rt)}')" class="text-[10px] font-bold text-indigo-600 hover:underline">ติ๊กทั้งสาย</button>
                    <span class="text-[10px] text-gray-400">${arr.length} ร้าน</span>
                  </div>
                  ${arr.map(s => `<label class="flex items-center gap-2 px-2 py-1 text-[11px] border-t border-gray-100 cursor-pointer ${hi.has(String(s.id)) ? 'bg-amber-50' : ''}">
                      <input type="checkbox" data-rv="${esc(s.id)}" data-rt="${esc(rt)}" ${hi.has(String(s.id)) ? 'checked' : ''} class="w-3.5 h-3.5">
                      <span class="flex-1 min-w-0"><span class="block truncate font-bold text-gray-800">${esc(s.name || '')}</span>
                        <span class="block text-[10px] text-gray-400">${esc(s.code || s.id)} · ${esc(when(s))}</span></span>
                      <span class="text-[10px] text-gray-500 whitespace-nowrap">${oldDays(s).length ? 'เดิม ' + oldDays(s).map(dLabel).join('·') : 'ไม่มีวัน'}</span>
                    </label>`).join('')}
                </div>`).join('')}
            </div>
            <div class="flex gap-2 pt-3">
              <button onclick="Removed.close()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-xl text-sm font-bold">ปิด</button>
              <button onclick="Removed._restoreChecked()" ${all.length ? '' : 'disabled'}
                class="flex-[2] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white py-2 rounded-xl text-sm font-bold">↩️ ดึงกลับเข้าแผน (ที่ติ๊ก)</button>
            </div>
          </div>`;
        if (ql) { const i = $('removed-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    };
    const checked = () => [...document.querySelectorAll('#removed-modal input[data-rv]')].filter(i => i.checked).map(i => i.dataset.rv);

    // ── ปุ่มกองในแท็บ 1 (ใต้ชิปตัวกรอง) ─────────────────────────────────
    const paintBasket = () => {
        const chip = $('chip-all');
        if (!chip) return;
        let row = $('basket-row');
        if (!row) {
            row = document.createElement('div');
            row.id = 'basket-row';
            row.className = 'flex gap-1.5';
            const chipRow = chip.parentElement;
            chipRow.parentElement.insertBefore(row, chipRow.nextSibling);
        }
        const p = parkedCount(), r = count();
        row.innerHTML = `
            <button onclick="Removed.openParked()" ${p ? '' : 'disabled'} title="ร้านใหม่ที่ยังไม่มีสาย/วัน + ร้านที่ถอดออกจากสายเพื่อรอย้าย"
                class="flex-1 px-2 py-1 rounded-xl text-[11px] font-bold border transition ${p ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100' : 'bg-white text-gray-300 border-gray-200'}">
                📥 รอจัดสาย <span class="tabular-nums">${p.toLocaleString()}</span></button>
            <button onclick="Removed.open()" title="ร้านที่เอาออกจากแผนเดือนนี้ — นับเป็น Remove ไม่ถูกส่งออก DMS"
                class="flex-1 px-2 py-1 rounded-xl text-[11px] font-bold border transition ${r ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}">
                🗑️ ออกจากแผน <span class="tabular-nums">${r.toLocaleString()}</span></button>`;
    };

    const openParked = () => {
        try { if (typeof Nav !== 'undefined') Nav.go('planning'); } catch (e) {}
        if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen) {
            const cur = MultiRoute.open || [];
            MultiRoute.setOpen(cur.includes(UNASSIGNED) ? cur : cur.concat([UNASSIGNED]));
        }
    };

    window.Removed = {
        list, count, remove, restore, open, close, openParked, oldDays,
        _paintBasket: paintBasket,
        _q(v) { q = v || ''; paint(); },
        _tickRoute(rt) {
            const boxes = [...document.querySelectorAll('#removed-modal input[data-rv]')].filter(i => i.dataset.rt === rt);
            const on = boxes.some(i => !i.checked);
            boxes.forEach(i => { i.checked = on; });
        },
        async _restoreChecked() { const ids = checked(); hi = new Set(); await restore(ids); },
    };

    // ── คลาสที่ไฟล์ tailwind.css ในเครื่องไม่มี (ไฟล์สร้างไว้ล่วงหน้า ไม่ได้คอมไพล์ใหม่) ─────
    const shim = () => {
        if ($('v075-css')) return;
        const st = document.createElement('style');
        st.id = 'v075-css';
        st.textContent = `
            .underline{text-decoration-line:underline}.no-underline{text-decoration-line:none}
            .decoration-dotted{text-decoration-style:dotted}.hover\:decoration-solid:hover{text-decoration-style:solid}
            .underline-offset-2{text-underline-offset:2px}.border-gray-400{border-color:#9ca3af}
            .disabled\:opacity-40:disabled{opacity:.4}.hover\:text-gray-800:hover{color:#1f2937}
            .max-h-\[88vh\]{max-height:88vh}.max-w-\[260px\]{max-width:260px}
            .px-0\.5{padding-left:.125rem;padding-right:.125rem}
            .rounded-t-xl{border-top-left-radius:.75rem;border-top-right-radius:.75rem}
            .bg-indigo-50\/50{background-color:rgb(238 242 255 / .5)}.bg-indigo-50\/60{background-color:rgb(238 242 255 / .6)}`;
        document.head.appendChild(st);
    };
    shim();

    // ── ต่อเข้ากับของเดิม ──────────────────────────────────────────────────
    const boot = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof State === 'undefined') return setTimeout(boot, 400);
        if (UI._removedWired) return;
        UI._removedWired = true;
        const orig = UI.render;
        UI.render = function () { const r = orig.apply(this, arguments); try { paintBasket(); } catch (e) {} return r; };
        // ปุ่ม "ดึงกลับ" ในรายการร้านที่พักแบบเดิม → ใช้ตัวใหม่ (กลับวันเดิมด้วย)
        if (typeof StoreMgr !== 'undefined') StoreMgr.reactivateStore = (id) => restore([id]);
        paintBasket();
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
})();

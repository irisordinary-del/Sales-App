/* =============================================================================
 *  unassign.js — ปุ่ม "Unassign" ในแถบจัดลงวัน: ทำกับร้านที่เลือกเท่านั้น
 * =============================================================================
 *  แทนปุ่ม "🗑️ เคลียร์" เดิม (ซึ่งล้างวันของ "ทั้งสาย" ทั้งที่หน้าตาเหมือนทำกับร้านที่เลือก)
 *  เลือกได้ 2 ระดับ
 *    day   = ถอดวัน      — ล้าง Day + คิว + CY   ร้านยังอยู่สายเดิม → กลับไป "รอจัดวัน"
 *    route = ถอดออกจากสาย — ทั้งหมดข้างบน + ย้ายไปกอง "รอจัดสาย"
 *  บอกสรุปก่อนยืนยัน (กี่ร้าน มาจากสาย/วันไหน) และย้อนกลับได้ผ่าน EditHistory
 *  ส่วน "ล้างวันทั้งสาย" ตัวเดิม (App.clearAllAssignments) ย้ายไปอยู่แท็บสร้างสายใหม่ ในชื่อตรงความจริง
 * ========================================================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const UNASSIGNED = 'รอจัดสาย';
    const dayName = (d) => (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[d]) ? DAY_COLORS[d].name : String(d || '').replace('Day ', 'D');

    const routeOf = (s) => s.route || State.localActiveRoute;
    const picked = () => (State.stores || []).filter(s => s.selected && !s.inactive);

    /** สรุปว่าร้านที่เลือกมาจากไหนบ้าง */
    const breakdown = (list) => {
        const byR = new Map(), byD = new Map();
        let noDay = 0, f2 = 0, parked = 0;
        list.forEach(s => {
            const r = routeOf(s);
            byR.set(r, (byR.get(r) || 0) + 1);
            if (r === UNASSIGNED) parked++;
            const d = s.days || [];
            if (!d.length) noDay++;
            if (d.length > 1) f2++;
            d.forEach(x => byD.set(x, (byD.get(x) || 0) + 1));
        });
        const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
        return { byR: top(byR), byD: top(byD), noDay, f2, parked };
    };

    const U = {
        open() {
            const list = picked();
            if (!list.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกร้าน — แตะหมุด / Shift-คลิก / วาดพื้นที่ก่อน');
            const b = breakdown(list);
            const withDay = list.length - b.noDay;
            const inRoute = list.length - b.parked;
            const li = (rows, unit, fmt) => rows.slice(0, 5).map(([k, v]) =>
                `<li class="flex justify-between"><span>${esc(fmt ? fmt(k) : k)}</span><b>${v}</b></li>`).join('')
                + (rows.length > 5 ? `<li class="text-gray-400">…อีก ${rows.length - 5} ${unit}</li>` : '');

            let el = $('unassign-modal');
            if (!el) {
                el = document.createElement('div');
                el.id = 'unassign-modal';
                el.className = 'hidden fixed inset-0 bg-black/50 z-[9998] items-center justify-center p-4';
                el.onclick = (e) => { if (e.target === el) U.close(); };
                document.body.appendChild(el);
            }
            el.innerHTML = `
              <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
                <div class="flex items-center gap-2">
                  <h3 class="text-base font-black text-gray-900 flex-1">⛔ Unassign ร้านที่เลือก</h3>
                  <span class="text-xs font-black text-white bg-gray-900 rounded-lg px-2 py-1">${list.length.toLocaleString()} ร้าน</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                  <div class="bg-gray-50 border border-gray-200 rounded-xl p-2">
                    <p class="font-bold text-gray-500 mb-1">มาจากสาย</p>
                    <ul class="space-y-0.5">${li(b.byR, 'สาย')}</ul>
                  </div>
                  <div class="bg-gray-50 border border-gray-200 rounded-xl p-2">
                    <p class="font-bold text-gray-500 mb-1">อยู่วัน</p>
                    <ul class="space-y-0.5">${li(b.byD, 'วัน', dayName)}
                      ${b.noDay ? `<li class="flex justify-between text-amber-700"><span>ยังไม่มีวัน</span><b>${b.noDay}</b></li>` : ''}</ul>
                  </div>
                </div>
                ${b.f2 ? `<p class="text-[10.5px] text-red-600">ในชุดนี้มีร้าน F2 ${b.f2} ร้าน — ถอดแล้วหายทั้ง 2 วัน</p>` : ''}

                <p class="text-[11px] font-bold text-gray-500 pt-1">เลือกระดับ</p>
                <button onclick="Unassign.run('day')" ${withDay ? '' : 'disabled'}
                    class="w-full text-left rounded-xl border-2 p-3 transition ${withDay ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'}">
                  <p class="text-sm font-black text-gray-800">📅 ถอดวัน <span class="text-[10px] font-bold text-gray-500">— ${withDay.toLocaleString()} ร้านที่มีวัน</span></p>
                  <p class="text-[10.5px] text-gray-600 leading-snug">ล้าง Day + ลำดับคิว + CY · ร้าน<b>ยังอยู่สายเดิม</b> กลับไปสถานะ "รอจัดวัน" · Route Code ไม่เปลี่ยน</p>
                </button>
                <button onclick="Unassign.run('route')" ${inRoute ? '' : 'disabled'}
                    class="w-full text-left rounded-xl border-2 p-3 transition ${inRoute ? 'border-red-300 bg-red-50 hover:bg-red-100' : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'}">
                  <p class="text-sm font-black text-gray-800">🚫 ถอดออกจากสาย <span class="text-[10px] font-bold text-gray-500">— ${inRoute.toLocaleString()} ร้านที่อยู่ในสาย</span></p>
                  <p class="text-[10.5px] text-gray-600 leading-snug">ทั้งหมดข้างบน + ย้ายไปกอง <b>"${UNASSIGNED}"</b> เพื่อ<b>รอย้ายไปสายอื่น</b> · ร้านไม่หาย ดึงกลับเข้าสายได้ทุกเมื่อ · หลุดจาก Coverage จนกว่าจะจัดสายใหม่</p>
                </button>
                <button onclick="Unassign.run('remove')"
                    class="w-full text-left rounded-xl border-2 p-3 transition border-gray-400 bg-gray-50 hover:bg-gray-100">
                  <p class="text-sm font-black text-gray-800">🗑️ Remove — เอาออกจากแผน <span class="text-[10px] font-bold text-gray-500">— ${list.length.toLocaleString()} ร้าน</span></p>
                  <p class="text-[10.5px] text-gray-600 leading-snug">เหมือนร้าน Inactive: ไปกอง <b>"ออกจากแผน"</b> · <b>นับเป็น Remove</b> ในหน้าภาพรวม · ไม่ถูกส่งออก DMS · ร้านไม่หาย ดึงกลับเข้าวันเดิมได้</p>
                </button>

                <p class="text-[10px] text-gray-400 leading-snug">บันทึกทันทีเมื่อกด · ลำดับคิวของวันที่โดนแตะจะถูกไล่เลขใหม่ · สถานะ "เซลยืนยันแผน" ของสายนั้นถูกล้าง · ย้อนกลับได้ด้วย Ctrl+Z หรือปุ่ม ↶</p>
                <button onclick="Unassign.close()" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-xl text-sm font-bold">ยกเลิก</button>
              </div>`;
            el.classList.remove('hidden'); el.classList.add('flex');
        },
        close() {
            const el = $('unassign-modal');
            if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
        },

        async run(mode, listOverride) {
            const list = listOverride || picked();
            U.close();
            if (!list.length) return;
            if (mode === 'remove') return window.Removed && Removed.remove(list.map(s => s.id));
            const ym = App._currentPlanYM;
            const R = State.db.routes || {};
            try { if (window.EditHistory && EditHistory.mark) EditHistory.mark(mode === 'route' ? 'Unassign ออกจากสาย' : 'Unassign ถอดวัน'); } catch (e) {}
            UI.showLoader('⛔ กำลัง Unassign...', `${list.length} ร้าน`);
            try {
                if (mode === 'route' && !Array.isArray(R[UNASSIGNED])) {
                    const d = await App.planRoutesCol(ym).doc(UNASSIGNED).get().catch(() => null);
                    R[UNASSIGNED] = (d && d.exists) ? (d.data().stores || []) : [];
                }
                const touched = new Set(), reflow = new Map();      // route -> Set(day)
                let nDay = 0, nRoute = 0;
                list.forEach(s => {
                    const from = routeOf(s);
                    const oldDays = [...(s.days || [])];
                    if (oldDays.length) {
                        if (!reflow.has(from)) reflow.set(from, new Set());
                        oldDays.forEach(d => reflow.get(from).add(d));
                        nDay++;
                    }
                    s.days = []; s.seqs = {}; s.cys = {}; s.cy = '';
                    s.selected = false;
                    touched.add(from);
                    if (mode === 'route' && from !== UNASSIGNED) {
                        R[from] = (R[from] || []).filter(x => String(x.id) !== String(s.id));
                        s.route = UNASSIGNED;
                        R[UNASSIGNED].push(s);
                        touched.add(UNASSIGNED);
                        nRoute++;
                    }
                });

                // ไล่เลขคิวใหม่ในวันที่ร้านหลุดออกไป (เลขขาดช่วงจะติดไปในไฟล์ DMS)
                if (typeof SeqTool !== 'undefined' && SeqTool.compact) {
                    reflow.forEach((days, rt) => days.forEach(d => { try { SeqTool.compact(d, rt); } catch (e) {} }));
                }

                const routeList = Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
                await Promise.all([
                    ...[...touched].filter(r => Array.isArray(R[r])).map(r => App.planRoutesCol(ym).doc(r).set({
                        stores: R[r],
                        confirmedBy: firebase.firestore.FieldValue.delete(),
                        confirmedAt: firebase.firestore.FieldValue.delete(),
                    }, { merge: true })),
                    App.planRef(ym).set({ routeList, cycleDays: State.db.cycleDays || 24,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
                ]);
                if (!State.db.routeList) State.db.routeList = routeList;
                else if (mode === 'route' && !State.db.routeList.includes(UNASSIGNED)) State.db.routeList.push(UNASSIGNED);
                UI.hideLoader();
                if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen) MultiRoute.setOpen(MultiRoute.open);
                else UI.render();
                UI.showSaveToast(mode === 'route'
                    ? `🚫 ถอดออกจากสาย ${nRoute.toLocaleString()} ร้าน → "${UNASSIGNED}" · ย้อนกลับได้ (Ctrl+Z)`
                    : `📅 ถอดวัน ${nDay.toLocaleString()} ร้าน (ยังอยู่สายเดิม) · ย้อนกลับได้ (Ctrl+Z)`);
            } catch (e) {
                UI.hideLoader();
                console.error('[Unassign]', e);
                UI.showErrorToast('❌ Unassign ไม่สำเร็จ: ' + (e && e.message));
            }
        },
        _picked: picked, _breakdown: breakdown,
    };
    window.Unassign = U;

    // ── ปุ่ม "ล้างวันทั้งสาย" ตัวเดิม → แท็บสร้างสายใหม่ (ชื่อตรงความจริง) ──
    const mountClearAll = () => {
        const host = $('tab5');
        if (!host || $('clear-all-box')) return;
        host.insertAdjacentHTML('beforeend', `
          <div id="clear-all-box" class="bg-white border border-red-200 rounded-2xl p-3 shadow-sm">
            <p class="text-xs font-black text-red-700">🗑️ ล้างวันทั้งสาย</p>
            <p class="text-[10.5px] text-gray-500 leading-snug mb-2">ถอดวัน + คิว ของ<b>ทุกร้านในสายที่กำลังแก้</b> ร้านยังอยู่สาย กลับไป "รอจัดวัน" ทั้งหมด —
              ใช้ตอนจะให้ AI จัดใหม่ทั้งสาย · ถ้าต้องการถอดเฉพาะบางร้าน ใช้ปุ่ม <b>Unassign</b> ในแท็บ 2</p>
            <button onclick="Unassign.clearAll()" class="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2 rounded-xl text-xs font-bold">
              🗑️ ล้างวันทั้งสาย <span id="clear-all-rt" class="font-mono"></span></button>
          </div>`);
    };
    /** ล้างวันทั้งสาย — เฉพาะสายที่กำลังแก้ (App.clearAllAssignments เดิมล้าง State.stores ทั้งชุด
     *  ซึ่งในโหมดเปิดหลายสายคือ "ทุกสายที่เปิด" — อันตราย จึงไม่เรียกตัวเดิม) */
    U.clearAll = () => {
        const rt = State.localActiveRoute;
        const R = State.db.routes || {};
        const list = (R[rt] || []).filter(s => !s.inactive && (s.days || []).length);
        if (!list.length) return UI.showErrorToast('ℹ️ สายนี้ไม่มีร้านที่จัดวันไว้');
        UI.showConfirm(`ล้างวันของทุกร้านในสาย ${rt} — ${list.length.toLocaleString()} ร้านจะกลับไป "รอจัดวัน"\n\nร้านยังอยู่ในสาย ไม่ได้ลบ · สายอื่นที่เปิดอยู่ไม่ถูกแตะ · ย้อนกลับได้ด้วย Ctrl+Z`,
            () => {
                list.forEach(s => { s.route = rt; });
                try { if (window.EditHistory && EditHistory.mark) EditHistory.mark('ล้างวันทั้งสาย ' + rt); } catch (e) {}
                U.run('day', list);
            });
    };

    const boot = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof State === 'undefined') return setTimeout(boot, 400);
        if (UI._unassignWired) return;
        UI._unassignWired = true;
        const orig = UI.render;
        UI.render = function () {
            const r = orig.apply(this, arguments);
            try {
                mountClearAll();
                const lb = $('clear-all-rt'); if (lb) lb.textContent = State.localActiveRoute || '';
            } catch (e) {}
            return r;
        };
        [800, 2000, 5000].forEach(t => setTimeout(() => { try { mountClearAll(); } catch (e) {} }, t));
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 900));
})();

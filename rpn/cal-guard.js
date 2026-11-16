/* =============================================================================
 *  cal-guard.js — ด่านตรวจตอนบันทึกปฏิทิน + ตารางสถานะปฏิทินรายสาย (V1.0.3)
 * =============================================================================
 *  1) ตั้งรอบยาว (เช่น 24) ให้สายที่ "รวมเป็น 12 ตลาดไปแล้ว" → ตลาดจะวิ่งแค่ครึ่งเดือน (เคส 503 C01–C03)
 *     ก่อนบันทึก ถามว่าจะ "แยกตลาดกลับเป็น D1–D24" ให้ก่อนไหม · ยกเลิก = ไม่บันทึก
 *  2) บันทึกปฏิทินเสร็จ → ตารางสถานะรายสาย: รอบ · ตลาดที่มีร้าน · วันเข้าเยี่ยม · ✅ / ⚠️ + สิ่งที่ต้องทำต่อ
 * ========================================================================== */
const CalGuard = (() => {
    'use strict';
    const UN = 'รอจัดสาย';
    const dn = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const R = () => (State.db && State.db.routes) || {};
    const routesAll = () => (State.db.routeList || Object.keys(R())).filter(r => r && r !== UN && Array.isArray(R()[r]));

    /** สายนี้ถูกรวมเป็น 12 ตลาดแล้วหรือยัง — ร้านอยู่แค่ D1–D12 (+ ช่องรอบ 2 ที่รวมตามปฏิทิน) */
    const isFolded = (rt) => {
        const st = (R()[rt] || []).filter(s => !s.inactive && (s.days || []).length);
        if (!st.length) return false;
        let fold = false, maxN = 0;
        st.forEach(s => {
            (s.days || []).forEach(d => {
                const m = s.runOf && s.runOf[d];
                if (m && m.fold) { fold = true; return; }
                if (m && m.src) return;                       // ครั้งที่แยกเอง (✂️) ไม่นับ
                maxN = Math.max(maxN, dn(d));
            });
        });
        if (!maxN || maxN > 12) return false;
        if (fold) return true;
        let cyc = 24;
        try { cyc = Runs.cycleOf(rt); } catch (e) {}
        if (cyc <= 14) return true;
        // รอบยาวแต่ใช้แค่ D1–D12 และมีตลาดที่ตั้งให้วิ่ง 2 ครั้ง = รูปแบบที่รวมมาแล้ว (เคส 503C03)
        try { for (let n = 1; n <= 12; n++) if (Runs.fqOf(rt, 'Day ' + n) === 'F2' && Runs.datesOf(rt, 'Day ' + n).length < 2) return true; } catch (e) {}
        return false;
    };

    /** แยกตลาดกลับ: ตลาดที่วิ่ง 2 รอบ (F2) → ครั้งที่ 2 กลับเป็น D(n+12) · ช่องรอบ 2 ที่รวมไว้ → เป็นตลาดของตัวเอง */
    const unfold = (rt) => {
        const list = R()[rt] || [];
        // V1.0.4: ครั้งที่เพิ่มเอง (➕ ครั้งที่ 2) เป็นทางแก้ของรอบ 12 — แยกตลาดกลับแล้วครั้งที่ 2 กลับเป็น D(n+12) เอง ไม่ต้องใช้แล้ว
        //   (ตลาดของวันว่างที่สร้างจากแท็บ 2 เก็บไว้ — เป็นตลาดที่ตั้งใจสร้าง)
        let dropAdd = 0;
        list.forEach(s => {
            if (!s.runOf) return;
            Object.keys(s.runOf).forEach(d => {
                const m = s.runOf[d];
                if (!m || !m.add || m.src === d) return;
                s.days = (s.days || []).filter(x => x !== d);
                ['seqs', 'cys', 'fqs', 'fqRun'].forEach(k => { if (s[k]) delete s[k][d]; });
                delete s.runOf[d]; dropAdd++;
            });
            if (!Object.keys(s.runOf).length) delete s.runOf;
            s.freq = (s.days || []).length > 1 ? 2 : 1;
        });
        if (dropAdd) { try { Runs.bump(); } catch (e) {} }
        const f2 = {};
        for (let n = 1; n <= 12; n++) {
            const d = 'Day ' + n;
            let fq = 'F2', det = {};
            try { fq = Runs.fqOf(rt, d); det = Runs.detachedOf(rt, d) || {}; } catch (e) {}
            f2[d] = fq !== 'F1' && !det[2];
        }
        let n = 0;
        list.forEach(s => {
            if (s.inactive) return;
            const add = [];
            (s.days || []).forEach(d => {
                const m = s.runOf && s.runOf[d];
                if (m && m.fold) { delete s.runOf[d]; if (!Object.keys(s.runOf).length) delete s.runOf; if (s.fqs) delete s.fqs[d]; return; }
                if (m && m.src) return;
                if (dn(d) <= 12 && f2[d]) add.push(d);
            });
            add.forEach(d => {
                const d2 = 'Day ' + (dn(d) + 12);
                if ((s.days || []).includes(d2)) return;
                s.days.push(d2);
                if (!s.seqs) s.seqs = {};
                s.seqs[d2] = (s.seqs && s.seqs[d]) || 0;
                if (s.cys) delete s.cys[d2];
                n++;
            });
            s.days.sort((a, b) => dn(a) - dn(b));
            s.freq = s.days.length > 1 ? 2 : 1;
        });
        try { Runs.bump(); } catch (e) {}
        return n;
    };

    /** ปฏิทินที่จะบันทึก (อ่านจากฟอร์ม) — รอบกี่วัน */
    const formCycle = () => {
        if (CalendarAdmin._mode !== 'cycle') return 0;
        return parseInt((document.getElementById('cal-cycle-days') || {}).value, 10) || 24;
    };
    /** สายที่ปฏิทินนี้จะมีผล */
    const targetRoutes = () => {
        if (CalendarAdmin._targetRoute) {
            const t = (typeof CalUI !== 'undefined' && CalUI.targets) ? CalUI.targets() : [];
            return t.length ? t : [CalendarAdmin._targetRoute];
        }
        const ov = (State.db && State.db.routeCal) || {};
        return routesAll().filter(r => !ov[r]);              // ปฏิทินศูนย์มีผลกับสายที่ไม่ได้ตั้งเฉพาะ
    };

    // ── ตารางสถานะรายสาย ──────────────────────────────────────────────
    const statusOf = (rt) => {
        let cyc = 24, rows = [], dated = 0, idle = [];
        try {
            cyc = Runs.cycleOf(rt);
            rows = Runs.visitRows(rt);
            dated = new Set(rows.filter(r => r.date).map(r => r.date.toDateString())).size;
            idle = [...new Set(rows.filter(r => !r.date).map(r => r.slot))];
        } catch (e) {}
        const st = (R()[rt] || []).filter(s => !s.inactive && (s.days || []).length);
        const base = new Set();
        st.forEach(s => (s.days || []).forEach(d => { const m = s.runOf && s.runOf[d]; base.add(m && m.src ? m.src : d); }));
        const over = [...base].filter(d => dn(d) > cyc && !(Runs.isStandalone && Runs.isStandalone(rt, d))).length;   // V1.0.4: ตลาดของวันว่างไม่นับ
        const warn = [];
        if (cyc > 14 && isFolded(rt)) warn.push(`รวมเป็น 12 ตลาดแล้วแต่ใช้รอบ ${cyc} → ตลาดวิ่งแค่ครึ่งเดือน · ตั้งปฏิทินสายนี้เป็น 12 หรือบันทึกใหม่แล้วเลือก "แยกตลาดกลับ"`);
        if (cyc <= 14 && over) warn.push(`มี ${over} ตลาดเกินรอบ ${cyc} → กด "รวมตลาดตามปฏิทิน" (ขึ้นให้เอง) หรือติ๊ก "ใช้รอบยาวแทน"`);
        if (idle.length) warn.push(`${idle.length} ตลาดมีร้านแต่ไม่มีวันวิ่งเดือนนี้ (${idle.slice(0, 4).map(d => 'D' + dn(d)).join(', ')}${idle.length > 4 ? '…' : ''}) → ย้ายร้านไปตลาดที่มีวัน หรือลดวันหยุด`);
        // V1.0.4: วันทำงานตามปฏิทินที่ยังไม่มีตลาด
        try {
            const e = Runs.emptyDates(rt);
            if (e.length) {
                const one = Runs.singleRuns(rt);
                warn.push(`วันทำงาน ${e.length} วันยังไม่มีตลาด (${e.slice(0, 6).map(d => d.getDate()).join(', ')}${e.length > 6 ? '…' : ''}) → `
                    + (one.length ? `กด ➕ ครั้งที่ 2 ที่หัวตลาดที่วิ่งครั้งเดียว (${one.slice(0, 4).map(d => 'D' + dn(d)).join(', ')}) หรือ` : '')
                    + (Runs.isShort(rt) ? ' เลือกวันว่างในช่อง Visit (แท็บ 2) เป็นตลาดใหม่' : ' ตั้งตลาดที่ตก 2 วันที่ให้ "วิ่งทุกครั้ง" (ปุ่มวันที่บนหัวตลาด)'));
            }
        } catch (e) {}
        // V1.0.4: ครั้งที่ตั้งวันที่เองไว้ — ชนะปฏิทิน ไม่ขยับตามปฏิทินใหม่
        let pinned = [];
        try { pinned = Runs.pinnedOf(rt); } catch (e) {}
        if (pinned.length) {
            const sh = (x) => { const m = String(x).match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? (+m[2]) + '/' + (+m[1]) : x; };
            warn.push(`มี ${pinned.length} ครั้งที่ตั้งวันที่เองไว้ ไม่ขยับตามปฏิทิน (${pinned.slice(0, 4).map(p => 'D' + dn(p.src) + ' ครั้งที่ ' + p.run + ' = ' + sh(p.date)).join(', ')}${pinned.length > 4 ? '…' : ''}) → ถ้าจะให้วิ่งตามปฏิทิน กด "รวมกลับทั้งหมด"`);
        }
        return { rt, cyc, markets: base.size, dated, warn, pinned };
    };
    const showStatus = () => {
        if (CalendarAdmin._ym && CalendarAdmin._ym !== App._currentPlanYM) return;      // ตั้งเดือนอื่น — ข้อมูลร้านไม่ได้อยู่ในหน่วยความจำ
        const fm = document.getElementById('calfold-modal');
        if (fm && !fm.classList.contains('hidden')) return;                              // หน้ารวมตลาดขึ้นอยู่ — ให้ทำอันนั้นก่อน
        const list = routesAll().map(statusOf);
        const bad = list.filter(x => x.warn.length);
        let el = document.getElementById('calstat-modal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'calstat-modal';
            el.className = 'fixed inset-0 bg-black/50 hidden items-center justify-center p-4';
            el.style.zIndex = '9997';
            document.body.appendChild(el);
        }
        const ym = App._currentPlanYM;
        el.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden" style="max-width:820px;max-height:85vh">
            <div class="px-5 py-3 border-b flex items-center gap-2 ${bad.length ? 'bg-amber-50' : 'bg-emerald-50'}">
              <b class="text-sm">${bad.length ? '⚠️' : '✅'} สถานะปฏิทินรายสาย · ${esc(App.ymToLabel ? App.ymToLabel(ym) : ym)}</b>
              <span class="text-xs text-gray-500">${bad.length ? `${bad.length} สายต้องทำต่อ` : 'ทุกสายพร้อม — ทำแผนต่อได้เลย'}</span>
              <button onclick="CalGuard.close()" class="ml-auto w-8 h-8 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 font-bold">✕</button>
            </div>
            <div class="overflow-auto px-4 py-3">
              <table class="w-full text-xs">
                <tr class="text-gray-500 text-left border-b"><th class="py-1 pr-2">สาย</th><th class="pr-2 text-right">รอบ</th><th class="pr-2 text-right">ตลาดที่มีร้าน</th><th class="pr-2 text-right">วันเข้าเยี่ยม/เดือน</th><th>สถานะ / ทำอะไรต่อ</th></tr>
                ${list.map(x => `<tr class="border-b border-gray-100 ${x.warn.length ? 'bg-amber-50' : ''}" style="vertical-align:top">
                    <td class="py-1 pr-2 font-mono font-bold">${esc(x.rt)}</td>
                    <td class="pr-2 text-right">${x.cyc}</td>
                    <td class="pr-2 text-right">${x.markets}</td>
                    <td class="pr-2 text-right">${x.dated}</td>
                    <td class="py-1">${x.warn.length ? x.warn.map(w => `<div class="text-amber-800">⚠️ ${esc(w)}</div>`).join('') : '<span class="text-emerald-700">✅ ตรงกัน</span>'}
                      ${x.pinned && x.pinned.length ? `<button onclick="CalGuard.rejoinAll('${esc(x.rt)}')" class="mt-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-white border border-amber-400 text-amber-800 hover:bg-amber-100">🔗 รวมกลับทั้งหมด (${x.pinned.length} ครั้ง) — วิ่งตามปฏิทิน</button>` : ''}</td></tr>`).join('')}
              </table>
              <p class="text-[11px] text-gray-500 mt-2">รอบ = จำนวนตลาดในปฏิทินของสาย (ปฏิทินเฉพาะสายก่อน ไม่มีใช้ของเดือน) · วันเข้าเยี่ยม = จำนวนวันที่สายนี้มีตลาดวิ่งในเดือน</p>
            </div>
            <div class="px-5 py-3 border-t text-right"><button onclick="CalGuard.close()" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">รับทราบ</button></div>
          </div>`;
        el.classList.remove('hidden'); el.classList.add('flex');
    };
    const close = () => { const el = document.getElementById('calstat-modal'); if (el) { el.classList.add('hidden'); el.classList.remove('flex'); } };
    /** V1.0.4: รวมครั้งที่ตั้งวันที่เองไว้ทั้งสายกลับเข้าตลาดหลัก → วิ่งตามปฏิทิน */
    const rejoinAll = async (rt) => {
        let list = [];
        try { list = Runs.pinnedOf(rt); } catch (e) {}
        if (!list.length) return;
        if (!confirm(`รวม ${list.length} ครั้งที่ตั้งวันที่เองไว้ของสาย ${rt} กลับเข้าตลาดหลัก?\n\nตลาดเหล่านี้จะวิ่งตามวันที่ในปฏิทิน · ย้อนกลับได้ (Ctrl+Z)`)) return;
        for (const p of list) { try { await Runs.rejoin(rt, p.slot); } catch (e) { console.warn('[CalGuard.rejoinAll]', e); } }
        try { Runs.bump(); } catch (e) {}
        UI.showSaveToast(`🔗 รวมกลับ ${list.length} ครั้ง — สาย ${rt} วิ่งตามปฏิทินแล้ว`);
        try { showStatus(); } catch (e) {}
    };

    const wire = () => {
        if (typeof CalendarAdmin === 'undefined' || !CalendarAdmin.save || typeof App === 'undefined') return setTimeout(wire, 500);
        if (CalendarAdmin.save._cg) return;
        const save0 = CalendarAdmin.save;
        const fn = async function () {
            const sameMonth = !CalendarAdmin._ym || CalendarAdmin._ym === App._currentPlanYM;
            const cyc = formCycle();
            if (sameMonth && cyc > 14) {
                const hit = targetRoutes().filter(isFolded);
                if (hit.length) {
                    const ok = confirm(`⚠️ ${hit.length} สายรวมเป็น 12 ตลาดไปแล้ว: ${hit.join(', ')}\n\n`
                        + `ตั้งรอบ ${cyc} ให้สายเหล่านี้ ตลาดจะวิ่งแค่ครึ่งเดือน (D13–D${cyc} ไม่มีร้าน)\n\n`
                        + `ตกลง = แยกตลาดกลับเป็น D1–D${Math.max(cyc, 24)} ให้ก่อน แล้วบันทึกปฏิทิน (แนะนำ)\n`
                        + `ยกเลิก = ไม่บันทึก (กลับไปแก้ เช่น ไม่ติ๊กสายเหล่านี้)`);
                    if (!ok) return;
                    let n = 0;
                    hit.forEach(rt => { n += unfold(rt); });
                    try {
                        await Promise.all(hit.map(rt => App.planRoutesCol(App._currentPlanYM).doc(rt).set({ stores: R()[rt] }, { merge: true })));
                        if (typeof EditHistory !== 'undefined' && EditHistory.mark) EditHistory.mark('แยกตลาดกลับ ' + hit.join(','));
                    } catch (e) { UI.showErrorToast('❌ แยกตลาดกลับไม่สำเร็จ: ' + (e && e.message)); return; }
                    UI.showSaveToast(`↔️ แยกตลาดกลับแล้ว ${hit.length} สาย (${n.toLocaleString()} ครั้งเข้าเยี่ยมกลับเป็นตลาด D13+)`);
                }
            }
            const r = await save0.apply(this, arguments);
            if (sameMonth) setTimeout(() => { try { showStatus(); } catch (e) { console.warn('[CalGuard]', e); } }, 1200);
            return r;
        };
        fn._cg = true;
        CalendarAdmin.save = fn;
    };
    wire();
    return { isFolded, unfold, statusOf, showStatus, close, rejoinAll };
})();
window.CalGuard = CalGuard;
;(window.__RPV=window.__RPV||{})['cal-guard.js']='1.0.4';

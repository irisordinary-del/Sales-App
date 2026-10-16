/* =============================================================================
 *  cal-fold.js — รวมตลาดตามปฏิทิน   (V0.9.9)
 * =============================================================================
 *  ปัญหา: ไฟล์ที่นำเข้าบางศูนย์ (เช่น 302) แยกรอบสองของเดือนเป็นอีกชื่อรอบ (R01 F2)
 *         ระบบจึงได้ตลาด 24 ช่อง (D1–D24) ทั้งที่จริงเป็น 12 ตลาดวิ่ง 2 รอบ
 *         ถ้าตั้งปฏิทินเป็นรอบ 12 วัน ช่อง D13–D24 ไม่มีวันวิ่ง และตลาด D1–D12 ที่มาแบบ ×1 ก็วิ่งแค่ครั้งเดียว
 *         → ครึ่งเดือนหลังว่าง ครั้งเข้าเยี่ยมหายครึ่งหนึ่ง
 *
 *  ตกลงกันแล้ว (15 ต.ค. 2569)
 *    • ทำงานเองทันทีที่บันทึกปฏิทินแล้วรอบสั้นกว่าช่องที่มีร้าน (ขึ้นหน้าสรุปให้ยืนยันก่อน)
 *    • จับคู่ตามรอบที่ตั้ง: รอบ 12 → D13 คู่ D1, D14 คู่ D2 … (ไม่ดูเลข CY เดิมในไฟล์)
 *    • ร้าน + ลำดับคิวเหมือนกันทุกร้าน → ยุบเข้าช่องหลัก ตลาดหลักวิ่งทุกรอบ (🔁) = CY เดียว
 *    • ร้านต่าง หรือร้านครบแต่ลำดับต่าง → ไม่ยุบ ยังเรียกตามตลาดหลัก "D1·รอบ2" (ช่องเดิมเก็บร้าน/ลำดับไว้)
 *      ส่งออกแยก CY และขึ้น ⚠️ บอกว่าต่างกันตรงไหน · แก้จนเหมือนกันแล้วระบบรวมเป็น CY เดียวให้เอง
 *    • ช่องหลักว่าง (ไม่มีร้าน) → ย้ายร้านเข้าช่องหลัก วิ่งครั้งเดียวที่รอบเดิม (วันเดิม)
 * ========================================================================== */
const CalFold = (() => {
    'use strict';

    const UNASSIGNED = 'รอจัดสาย';
    const $ = (id) => document.getElementById(id);
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const D = (d) => 'D' + dayNum(d);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const listOf = (rt) => ((State.db && State.db.routes) || {})[rt] || [];
    const inSlot = (rt, d) => listOf(rt).filter(s => !s.inactive && (s.days || []).includes(d));
    const dropKeys = (s, d) => {
        ['seqs', 'cys', 'fqs', 'fqRun', 'vd'].forEach(k => { if (s[k]) delete s[k][d]; });
        if (s.runOf) { delete s.runOf[d]; if (!Object.keys(s.runOf).length) delete s.runOf; }
    };

    /** คู่ที่ต้องรวมของทุกสาย — [{ rt, k, pairs:[{slot, base, run, kind, n, nb, text}] }] */
    const check = (routes) => {
        if (typeof Runs === 'undefined') return [];
        const out = [];
        (routes || Object.keys((State.db && State.db.routes) || {})).forEach(rt => {
            if (rt === UNASSIGNED || !Runs.hasCal(rt)) return;
            const k = Runs.cycleOf(rt);
            const pairs = [];
            Runs.daysOf(rt).forEach(slot => {
                const m = dayNum(slot);
                if (m <= k || Runs.isDetached(rt, slot)) return;
                const n = inSlot(rt, slot).length;
                if (!n) return;
                const base = 'Day ' + (((m - 1) % k) + 1);
                const run = Math.floor((m - 1) / k) + 1;
                const nb = inSlot(rt, base).length;
                if (!nb) { pairs.push({ slot, base, run, kind: 'move', n, nb, text: `${D(base)} ไม่มีร้าน — ย้ายร้านเข้า ${D(base)} วิ่งครั้งเดียว (รอบ ${run})` }); return; }
                const df = Runs.diffOf(rt, base, slot);
                pairs.push({ slot, base, run, kind: df.same ? 'same' : (df.order ? 'order' : 'diff'), n, nb, text: df.text });
            });
            if (pairs.length) {
                // V0.9.16: สายที่ทุกคู่ไม่เหมือนกัน (เช่น Credit / Spare/Gainer ครึ่งหลังเป็นคนละตลาด) → แนะนำ "ใช้รอบยาวสำหรับสายนี้" แทนการรวม
                const mx = Math.max(...pairs.map(p => dayNum(p.slot)), k);
                const allDiff = pairs.every(p => p.kind === 'diff' || p.kind === 'order');
                out.push({ rt, k, pairs, full: mx, allDiff });
            }
        });
        return out;
    };

    const apply = async (res) => {
        const touched = [];
        let nSame = 0, nKeep = 0, nMove = 0;
        res.forEach(({ rt, pairs }) => {
            const baseF2 = new Set();
            pairs.forEach(p => {
                const ss = inSlot(rt, p.slot);
                if (p.kind === 'same') {
                    ss.forEach(s => { s.days = s.days.filter(d => d !== p.slot); dropKeys(s, p.slot); s.freq = s.days.length > 1 ? 2 : 1; });
                    baseF2.add(p.base); nSame++;
                } else if (p.kind === 'move') {
                    ss.forEach(s => {
                        const q = (s.seqs || {})[p.slot];
                        s.days = [...new Set(s.days.map(d => d === p.slot ? p.base : d))].sort((a, b) => dayNum(a) - dayNum(b));
                        dropKeys(s, p.slot);
                        if (!s.seqs) s.seqs = {}; s.seqs[p.base] = q || 0;
                        if (!s.fqs) s.fqs = {}; s.fqs[p.base] = 'F1';
                        if (!s.fqRun) s.fqRun = {}; s.fqRun[p.base] = p.run;
                        s.freq = s.days.length > 1 ? 2 : 1;
                    });
                    nMove++;
                } else {
                    // ไม่เหมือนกัน → ช่องนี้เป็น "รอบ run ของตลาดหลัก" (ร้าน/ลำดับของช่องนี้เก็บไว้ครบ)
                    ss.forEach(s => {
                        if (!s.runOf) s.runOf = {};
                        s.runOf[p.slot] = { src: p.base, run: p.run, fold: true };
                        if (!s.fqs) s.fqs = {}; s.fqs[p.slot] = 'F1';
                        if (s.fqRun) delete s.fqRun[p.slot];
                        if (s.cys) delete s.cys[p.slot];
                    });
                    baseF2.add(p.base); nKeep++;
                }
            });
            // ตลาดหลักวิ่งทุกรอบ (🔁) — เดิมมาจากไฟล์เป็น ×1 เพราะรอบสองแยกเป็นอีกชื่อรอบ
            baseF2.forEach(b => inSlot(rt, b).forEach(s => {
                if (!s.fqs) s.fqs = {}; s.fqs[b] = 'F2';
                if (s.fqRun) { delete s.fqRun[b]; if (!Object.keys(s.fqRun).length) delete s.fqRun; }
            }));
            touched.push(rt);
        });
        // ลำดับคิวให้ต่อเนื่อง (ไม่ล้างลำดับเดิม)
        try { if (typeof SeqTool !== 'undefined' && SeqTool.compactAll) { const sub = {}; touched.forEach(rt => { sub[rt] = State.db.routes[rt]; }); SeqTool.compactAll(sub); } } catch (e) {}
        // ความยาวรอบของแผน = รอบของปฏิทินระดับเดือน (ส่วนอื่นของโปรแกรมที่ยังอ่านค่านี้จะได้ตรงกัน)
        const cc = State.db.calendarConfig;
        const k0 = cc && parseInt(cc.cycleDays, 10);
        const ym = App._currentPlanYM;
        const saves = touched.map(rt => App.planRoutesCol(ym).doc(rt).set({
            stores: State.db.routes[rt],
            confirmedBy: firebase.firestore.FieldValue.delete(),
            confirmedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true }));
        if (k0 && k0 !== State.db.cycleDays) { State.db.cycleDays = k0; saves.push(App.planRef(ym).set({ cycleDays: k0 }, { merge: true })); }
        await Promise.all(saves);
        try { Runs.bump(); } catch (e) {}
        try { if (typeof EditHistory !== 'undefined' && EditHistory.mark) EditHistory.mark('รวมตลาดตามปฏิทิน'); } catch (e) {}
        try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
        try { UI.render(); } catch (e) {}
        try { const pg = $('page-overview'); if (window.PlanOverview && pg && !pg.classList.contains('hidden')) PlanOverview.render(); } catch (e) {}
        return { nSame, nKeep, nMove, routes: touched.length };
    };

    // ── หน้าสรุปก่อนยืนยัน ────────────────────────────────────────────────
    const close = () => {
        const el = $('calfold-modal'); if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
        if (pending) dismissed.add(sigOf(pending));      // กด "ยังไม่รวม" — ไม่ถามซ้ำชุดเดิมในรอบนี้ (ยังกดจากคำเตือนหน้าภาพรวมได้)
        pending = null;
    };
    let pending = null;
    let keepLong = new Set();          // V0.9.16: สายที่เลือก "ใช้รอบยาวสำหรับสายนี้" แทนการรวม
    let suppress = false;              // กันหน้าสรุปเด้งซ้ำระหว่างที่เราบันทึกปฏิทินรายสายเอง
    const dismissed = new Set();
    const sigOf = (res) => (App._currentPlanYM || '') + '|' + res.map(r => r.rt + ':' + r.pairs.map(p => p.slot + p.kind).join(',')).join(';');

    const open = (routes, opt) => {
        const res = check(routes);
        if (opt && opt.auto && res.length && dismissed.has(sigOf(res))) return false;
        if (!res.length) {
            if (!(opt && opt.silent)) UI.showSaveToast('ℹ️ ไม่มีตลาดที่ต้องรวม — ทุกช่องที่มีร้านอยู่ในรอบของปฏิทินแล้ว');
            return false;
        }
        pending = res;
        keepLong = new Set(res.filter(r => r.allDiff).map(r => r.rt));
        show(res);
        return true;
    };
    const show = (res) => {
        const all = res.filter(r => !keepLong.has(r.rt)).flatMap(r => r.pairs.map(p => ({ ...p, rt: r.rt })));
        const nSame = all.filter(p => p.kind === 'same').length;
        const nMove = all.filter(p => p.kind === 'move').length;
        const keep = all.filter(p => p.kind === 'order' || p.kind === 'diff');
        const ks = [...new Set(res.map(r => r.k))];
        const nLong = keepLong.size;
        const rows = res.map(r => {
            const s = r.pairs.filter(p => p.kind === 'same').length;
            const kp = r.pairs.filter(p => p.kind === 'order' || p.kind === 'diff');
            const mv = r.pairs.filter(p => p.kind === 'move').length;
            const lk = keepLong.has(r.rt);
            return `<tr class="border-t border-gray-100 align-top ${lk ? 'bg-indigo-50/40' : ''}">
                <td class="py-1 pr-2 font-bold whitespace-nowrap">${esc(r.rt)}${r.allDiff ? '<div class="text-[10px] font-normal text-indigo-700">ทุกคู่ไม่เหมือน</div>' : ''}</td>
                <td class="py-1 pr-2 whitespace-nowrap"><label class="flex items-center gap-1 cursor-pointer ${lk ? 'text-indigo-800 font-bold' : 'text-gray-500'}" title="ตั้งปฏิทินเฉพาะสายนี้เป็นรอบ ${r.full} วัน — D${r.k + 1}–D${r.full} เป็นตลาดของตัวเอง ไม่รวม">
                    <input type="checkbox" ${lk ? 'checked' : ''} onchange="CalFold.toggleLong('${esc(r.rt)}')" class="w-3.5 h-3.5"> รอบ ${r.full}</label></td>
                <td class="py-1 pr-2 text-emerald-700 font-bold text-center ${lk ? 'opacity-30' : ''}">${s || '—'}</td>
                <td class="py-1 pr-2 ${lk ? 'opacity-30' : ''}">${kp.length ? kp.map(p => `<div class="text-amber-800"><b>${D(p.slot)} → ${D(p.base)}·รอบ${p.run} ${esc(dOf(r.rt, p.base, p.run))}</b> <span class="text-[10.5px]">${esc(p.text)}</span></div>`).join('') : '<span class="text-gray-300">—</span>'}
                    ${mv ? `<div class="text-[10.5px] text-indigo-700">${mv} ช่องย้ายเข้าตลาดหลักที่ว่าง</div>` : ''}</td>
            </tr>`;
        }).join('');
        let el = $('calfold-modal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'calfold-modal';
            el.className = 'fixed inset-0 bg-black/50 z-[9998] hidden items-center justify-center p-4';
            document.body.appendChild(el);
        }
        el.innerHTML = `
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-5 max-h-[90vh] flex flex-col">
            <h3 class="font-black text-gray-800 text-lg mb-1">🔗 รวมตลาดตามปฏิทิน (รอบ ${ks.join(' / ')} วัน)</h3>
            <p class="text-[12px] text-gray-600 leading-snug mb-3">
              แผนมีตลาดเกินรอบของปฏิทิน (เช่นไฟล์เดิมแยกรอบสองเป็น D13–D24) ช่องเกินรอบจะไม่มีวันวิ่ง
              ระบบจับคู่ตามรอบที่ตั้ง — ${ks.map(k => `D${k + 1} คู่ D1, D${k + 2} คู่ D2 …`).join(' / ')}</p>
            <div class="grid grid-cols-3 gap-2 mb-3 text-center">
              <div class="rounded-xl bg-emerald-50 border border-emerald-200 p-2"><div class="text-xl font-black text-emerald-700">${nSame}</div><div class="text-[11px] text-emerald-800">คู่เหมือนกัน → รวมเป็นตลาดเดียว<br>วิ่งทุกรอบ · CY เดียว</div></div>
              <div class="rounded-xl bg-amber-50 border border-amber-200 p-2"><div class="text-xl font-black text-amber-700">${keep.length}</div><div class="text-[11px] text-amber-800">คู่ไม่เหมือน → เรียก "Dx·รอบ2"<br>ร้านไม่หาย · แยก CY · ขึ้น ⚠️</div></div>
              <div class="rounded-xl bg-indigo-50 border border-indigo-200 p-2"><div class="text-xl font-black text-indigo-700">${nLong}</div><div class="text-[11px] text-indigo-800">สายที่ใช้รอบยาวแทน (ไม่รวม)<br>D13–D24 เป็นตลาดของตัวเอง${nMove ? `<br>${nMove} ช่องย้ายเข้าตลาดหลักที่ว่าง` : ''}</div></div>
            </div>
            <div class="overflow-y-auto border border-gray-200 rounded-xl px-3 py-1 text-[12px] flex-1 min-h-0">
              <table class="w-full"><thead><tr class="text-[11px] text-gray-500"><th class="text-left py-1">สาย</th><th class="text-left py-1">ใช้รอบยาวแทน</th><th class="py-1">รวมได้</th><th class="text-left py-1">ไม่เหมือน (ยังเรียกตามตลาดหลัก แต่แยก CY)</th></tr></thead>
              <tbody>${rows}</tbody></table>
            </div>
            <p class="text-[11px] text-gray-500 mt-2">ติ๊ก "ใช้รอบยาวแทน" = ตั้งปฏิทินเฉพาะสายนั้นเป็นรอบยาว (ครึ่งหลังเป็นตลาดของตัวเอง ไม่รวม) — แนะนำให้สาย Credit / Spare/Gainer ที่ทุกคู่ไม่เหมือนกัน · ลำดับคิวไม่ถูกแตะ · ย้อนกลับได้ด้วย Ctrl+Z · ถ้ายังไม่รวม ช่องเกินรอบจะขึ้น "ไม่วิ่งเดือนนี้" และมีคำเตือนในหน้าภาพรวม</p>
            <div class="flex gap-2 mt-3">
              <button onclick="CalFold.close()" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ยังไม่รวม</button>
              <button onclick="CalFold.confirm()" class="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl text-sm font-bold">${all.length ? '🔗 รวมตลาด ' + all.length + ' ช่อง' : 'ตกลง'}${nLong ? ' · ใช้รอบยาว ' + nLong + ' สาย' : ''}</button>
            </div>
          </div>`;
        el.classList.remove('hidden'); el.classList.add('flex');
        return true;
    };
    const dOf = (rt, base, run) => { try { const d = Runs.potential(rt, base).find(x => x.k === run); return d ? '(' + Runs._short(d.date) + ')' : ''; } catch (e) { return ''; } };
    const toggleLong = (rt) => { if (keepLong.has(rt)) keepLong.delete(rt); else keepLong.add(rt); if (pending) show(pending); };

    const confirm = async () => {
        if (!pending) return close();
        const res = pending; pending = null;
        close();
        UI.showLoader && UI.showLoader('🔗 กำลังรวมตลาดตามปฏิทิน...', '');
        try {
            // V0.9.16: สายที่เลือก "ใช้รอบยาวแทน" → ตั้งปฏิทินเฉพาะสายเป็นรอบยาว (D13–D24 กลับเป็นตลาดปกติทันที)
            const longs = res.filter(r => keepLong.has(r.rt));
            if (longs.length) {
                suppress = true;
                try {
                    const ym = App._currentPlanYM;
                    for (const r of longs) {
                        const base = (State.db.routeCal || {})[r.rt] || State.db.calendarConfig || {};
                        const cfg = { ...base, cycleDays: r.full };
                        await App.saveRouteCalendarOverride(r.rt, cfg, ym);
                        State.db.routeCal = { ...(State.db.routeCal || {}), [r.rt]: cfg };
                    }
                    try { if (typeof DayDate !== 'undefined' && DayDate.reloadOverrides) await DayDate.reloadOverrides(); } catch (e) {}
                } finally { suppress = false; }
            }
            const rest = res.filter(r => !keepLong.has(r.rt));
            const r = rest.length ? await apply(rest) : { nSame: 0, nKeep: 0, nMove: 0, routes: 0 };
            if (!rest.length) { try { Runs.bump(); UI.render(); } catch (e) {} }
            UI.hideLoader && UI.hideLoader();
            UI.showSaveToast((rest.length ? `✅ รวมตลาดแล้ว ${r.nSame} คู่` + (r.nKeep ? ` · ${r.nKeep} คู่ไม่เหมือน เรียกตามตลาดหลัก (แยก CY)` : '') + (r.nMove ? ` · ย้าย ${r.nMove} ช่อง` : '') + ` · ${r.routes} สาย` : '✅ ตั้งค่าแล้ว')
                + (longs.length ? ` · ใช้รอบยาว ${longs.length} สาย (${longs.map(x => x.rt).join(', ')})` : ''));
        } catch (e) {
            UI.hideLoader && UI.hideLoader();
            console.error('[CalFold]', e);
            UI.showErrorToast('❌ รวมตลาดไม่สำเร็จ: ' + (e && e.message));
        }
    };

    // ── ทำงานเองหลังบันทึกปฏิทิน ─────────────────────────────────────────
    let tm = null;
    const later = () => {
        clearTimeout(tm);
        tm = setTimeout(() => { if (suppress) return; try { Runs.bump(); open(null, { silent: true }); } catch (e) { console.warn('[CalFold]', e); } }, 400);
    };
    const hook = () => {
        if (typeof App === 'undefined' || !App.saveCalendarConfig) return setTimeout(hook, 500);
        if (!App.saveCalendarConfig._fold) {
            const f0 = App.saveCalendarConfig;
            const fn = async function () { const r = await f0.apply(this, arguments); later(); return r; };
            fn._fold = true; App.saveCalendarConfig = fn;
        }
        if (App.saveRouteCalendarOverride && !App.saveRouteCalendarOverride._fold) {
            const f1 = App.saveRouteCalendarOverride;
            const fn = async function () {
                const r = await f1.apply(this, arguments);
                try { if (typeof DayDate !== 'undefined' && DayDate.reloadOverrides) await DayDate.reloadOverrides(); } catch (e) {}
                later(); return r;
            };
            fn._fold = true;
            Object.keys(f1).forEach(k => { if (k !== '_fold') fn[k] = f1[k]; });
            App.saveRouteCalendarOverride = fn;
        }
    };
    // หลัง cal-ui.js ห่อบันทึกหลายสายแล้ว (900 ms) — ตัวนี้อยู่นอกสุด ทำงานครั้งเดียวหลังบันทึกครบทุกสาย
    document.addEventListener('DOMContentLoaded', () => setTimeout(hook, 3000));

    // V0.9.10: เปิดหน้าวางแผนคิวงาน (หรือโหลดเดือน) แล้วมีตลาดเกินรอบ → ขึ้นหน้าสรุปเอง ไม่ต้องรอบันทึกปฏิทิน
    //   (แผนที่ตั้งปฏิทินไว้ก่อน V0.9.9 จะไม่มีการบันทึกใหม่ให้หน้าสรุปขึ้น)
    const onPlanning = () => { const pg = $('page-planning'); return !!(pg && !pg.classList.contains('hidden')); };
    let at = null;
    const autoCheck = (delay) => {
        clearTimeout(at);
        at = setTimeout(() => {
            try {
                if (!onPlanning() || !State.db || !State.db.routes || !Object.keys(State.db.routes).length) return;
                const m = $('calfold-modal'); if (m && !m.classList.contains('hidden')) return;
                Runs.bump(); open(null, { silent: true, auto: true });
            } catch (e) { console.warn('[CalFold.auto]', e); }
        }, delay || 1200);
    };
    const hookAuto = () => {
        if (typeof Nav === 'undefined' || !Nav.go || typeof App === 'undefined' || !App._loadPlan) return setTimeout(hookAuto, 500);
        if (!Nav.go._fold) {
            const g0 = Nav.go;
            const fn = function (page) { const r = g0.apply(this, arguments); if (page === 'planning') autoCheck(900); return r; };
            fn._fold = true; Nav.go = fn;
        }
        if (!App._loadPlan._fold) {
            const l0 = App._loadPlan;
            const fn = async function () { const r = await l0.apply(this, arguments); autoCheck(2500); return r; };
            fn._fold = true; App._loadPlan = fn;
        }
        autoCheck(4000);        // เปิดโปรแกรมครั้งแรก (หน้าวางแผนคิวงานเป็นหน้าแรก)
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(hookAuto, 3500));

    return { check, apply, open, close, confirm, toggleLong };
})();
window.CalFold = CalFold;

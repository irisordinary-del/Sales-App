/* =============================================================================
 *  freq.js — ความถี่การเข้าเยี่ยมรายร้าน (F1 / F2)
 * =============================================================================
 *  กติกา (สรุปจากข้อมูลจริงทุกศูนย์ + ที่ตกลงกันไว้)
 *    • ความถี่เป็นสมบัติของ "ร้าน" ไม่ใช่ของ beat — beat เป็นผลลัพธ์
 *    • F2 = ร้านอยู่ 2 ช่องวัน คือวันหลัก กับวันคู่ที่ห่างไปครึ่งรอบ
 *        รอบ 24 วัน → D1 คู่กับ D13   ·   รอบ 12 วัน → D1 คู่กับ D7
 *    • ค่าเริ่มต้นให้ระบบจับคู่ให้เอง แต่ RS ย้ายวันที่สองเองได้
 *      พอย้ายเองแล้วจะติดธง "กำหนดเอง" (s.f2custom) — สั่งเป็นชุดจะไม่ไปรีเซ็ตทับ
 *    • ตั้ง F2 ได้เฉพาะร้านที่มีวันแล้ว — ร้านที่ยังไม่จัดวันต้องจัดวันก่อน
 * ========================================================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** จำนวนวันในรอบของสายนี้ — ปฏิทินรายสายมาก่อน ไม่มีค่อยใช้ของศูนย์ */
    const cycleOf = (route) => {
        const ov = (State.db && State.db.routeCal && State.db.routeCal[route]) || null;
        const n = parseInt((ov && ov.cycleDays) || (State.db && State.db.cycleDays) || 24, 10);
        return (n >= 2 && n <= 31) ? n : 24;
    };

    /** วันคู่ของ F2 = ห่างไปครึ่งรอบ */
    const pairOf = (day, route) => {
        const k = cycleOf(route), mK = Math.ceil(k / 2), n = dayNum(day);
        if (!n) return null;
        const p = n <= mK ? n + mK : n - mK;
        return (p >= 1 && p <= k && p !== n) ? ('Day ' + p) : null;
    };

    const sortDays = (arr) => [...new Set(arr)].sort((a, b) => dayNum(a) - dayNum(b));
    const routeOf = (s) => (typeof MultiRoute !== 'undefined' && MultiRoute.routeOf)
        ? MultiRoute.routeOf(s) : (s.route || State.localActiveRoute);

    /** CY ของช่องวันนั้นในสายนั้น (เอาจากร้านอื่นที่อยู่วันเดียวกันอยู่แล้ว) */
    const cyOfSlot = (route, day) => {
        const list = (State.db.routes || {})[route] || [];
        for (const s of list) {
            if (s.inactive || !(s.days || []).includes(day)) continue;
            const cy = (s.cys && s.cys[day]) || (((s.days || []).length === 1) ? s.cy : '');
            if (cy) return cy;
        }
        return '';
    };

    /**
     * ช่องวันหนึ่งวิ่งกี่ครั้งในเดือนนี้ — สำคัญมาก เพราะสองสถาปัตยกรรมต่างกัน
     *   รอบ 24 วัน (= 1 เดือน)      → ช่องวันหนึ่งวิ่ง 1 ครั้ง  ⇒ F2 = ต้องเพิ่มวันคู่
     *   รอบ 12 วัน (= ครึ่งเดือน)   → ช่องวันหนึ่งวิ่ง 2 ครั้งอยู่แล้ว ⇒ เพิ่มวันคู่จะกลายเป็น 4 ครั้ง
     */
    const storesOfDay = (route, day) =>
        ((State.db.routes || {})[route] || []).filter(s => !s.inactive && (s.days || []).includes(day));

    const runsOf = (route, day) => {
        // V0.5: จำนวนครั้งที่ตลาดนี้วิ่งจริงในเดือน มาจาก runs.js ที่เดียว
        //   (ความถี่ของตลาด · รอบสั้นนับ +14 วัน · ครั้งที่แยกออกไปเป็นช่องอื่นไม่นับที่นี่)
        try {
            if (typeof Runs !== 'undefined') {
                if (!Runs.potential(route, day).length) return 1;      // ยังไม่มีปฏิทิน
                return Runs.datesOf(route, day).length;
            }
        } catch (e) {}
        return 1;
    };

    /**
     * สายนี้ใช้ "รอบสั้น" หรือไม่ — รอบสั้น = 1 เดือนหมุนมากกว่า 1 รอบ (เช่น 501/301 รอบ 12 วัน)
     * ในสถาปัตยกรรมนั้น ความถี่ถูกกำหนดที่ beat (W = วิ่งรอบเดียว, F2 = วิ่งทุกรอบ)
     * ไม่ใช่ที่ร้าน — การเพิ่มวันคู่ให้ร้านจะทำให้จำนวนครั้งเพี้ยน จึงต้องกันไว้
     */
    const shortCycle = (route) => {
        // V0.5: ดูจากความยาวรอบของสายตรง ๆ (≤ 14 วัน) — เดิมดูว่ามีช่องไหนตก 2 วันที่
        // ซึ่งทำให้สายรอบ 24 วันในเดือนที่วันทำงานเกินรอบ ถูกนับเป็นรอบสั้นไปด้วย
        try { if (typeof Runs !== 'undefined') return Runs.isShort(route); } catch (e) {}
        return cycleOf(route) <= 14;
    };
    /** ช่องวันจริงของร้าน (ไม่นับช่องที่เป็น "ครั้งที่แยกออกมา") */
    const realDays = (s) => {
        const rt = routeOf(s);
        return (s.days || []).filter(d => !(typeof Runs !== 'undefined' && Runs.isDetached(rt, d)));
    };

    const F = {
        /** ร้านนี้เป็น F2 อยู่หรือไม่ (ดูจากจำนวนวันจริง ไม่ใช่ธง freq) */
        isF2: (s) => realDays(s).length > 1,

        runsOf,
        shortCycle,

        /** จำนวนครั้งที่ร้านนี้ถูกเข้าเยี่ยมจริงในเดือน = ผลรวมของทุกช่องวัน × จำนวนครั้งที่ช่องวันนั้นวิ่ง */
        visitsOf(s) {
            const rt = routeOf(s);
            return (s.days || []).reduce((t, d) => t + runsOf(rt, d), 0);
        },

        /** คู่วันของร้านนี้เป็นครึ่งรอบมาตรฐานไหม */
        canonical(s) {
            const d = sortDays(realDays(s));
            if (d.length !== 2) return true;
            return pairOf(d[0], routeOf(s)) === d[1];
        },

        /** ระยะห่างจริงของคู่วัน (วันในรอบ) */
        gapOf(s) {
            const d = sortDays(realDays(s));
            return d.length === 2 ? (dayNum(d[1]) - dayNum(d[0])) : 0;
        },

        /** หาร้านจาก id ในชุดที่เปิดอยู่ */
        find(id) {
            return (State.stores || []).find(s => String(s.id) === String(id))
                || Object.values(State.db.routes || {}).flat().find(s => String(s.id) === String(id));
        },

        /** ร้านที่ถูกเลือกไว้ตอนนี้ */
        picked: () => (State.stores || []).filter(s => s.selected && !s.inactive),

        /**
         * คำนวณว่าถ้าสั่ง mode กับร้านชุดนี้ จะเกิดอะไรขึ้น
         * @returns {{apply:Array, add:Object, rm:Object, skipNoDay:number, skipCustom:number, skipFull:number, same:number}}
         */
        plan(list, mode) {
            const out = { apply: [], add: {}, rm: {}, skipNoDay: 0, skipCustom: 0, skipFull: 0, skipAlready: 0, skipShort: 0, same: 0 };
            const shortOf = {};
            (list || []).forEach(s => {
                const days = sortDays(s.days || []);
                const rt = routeOf(s);
                if (!(rt in shortOf)) shortOf[rt] = shortCycle(rt);
                if (shortOf[rt]) { out.skipShort++; return; }   // สายรอบสั้น — ความถี่อยู่ที่ beat ไม่ใช่ที่ร้าน
                if (mode === 'F2') {
                    if (!days.length) { out.skipNoDay++; return; }
                    if (days.length > 1) { out.same++; return; }
                    if (runsOf(rt, days[0]) >= 2) { out.skipAlready++; return; }
                    const pd = pairOf(days[0], rt);
                    if (!pd) { out.skipFull++; return; }
                    out.add[pd] = (out.add[pd] || 0) + 1;
                    out.apply.push({ s, rt, days: [days[0], pd], drop: null });
                } else {
                    if (days.length < 2) { out.same++; return; }
                    if (s.f2custom) { out.skipCustom++; return; }
                    const keep = days[0], drop = days.slice(1);
                    drop.forEach(d => { out.rm[d] = (out.rm[d] || 0) + 1; });
                    out.apply.push({ s, rt, days: [keep], drop });
                }
            });
            return out;
        },

        /** ลงมือเปลี่ยนจริง */
        async run(list, mode) {
            const p = F.plan(list, mode);
            if (!p.apply.length) {
                UI.showErrorToast(mode === 'F2'
                    ? '⚠️ ไม่มีร้านที่ตั้ง F2 ได้ (ร้านต้องมีวันเข้าเยี่ยมก่อน)'
                    : '⚠️ ไม่มีร้าน F2 ในชุดที่เลือก');
                return 0;
            }
            const R = State.db.routes || {};
            const ym = App._currentPlanYM;
            const touched = new Set(), reflow = new Map();

            UI.showLoader(mode === 'F2' ? '🔁 กำลังตั้งเป็น F2...' : '🔂 กำลังตั้งเป็น F1...',
                `${p.apply.length.toLocaleString()} ร้าน`);
            try {
                p.apply.forEach(({ s, rt, days, drop }) => {
                    const before = sortDays(s.days || []);
                    s.days = days.slice();
                    s.freq = days.length > 1 ? 2 : 1;
                    if (!s.seqs) s.seqs = {};
                    if (!s.cys) s.cys = {};
                    // วันที่หลุดออก → ล้างลำดับคิวกับ CY ของวันนั้นทิ้ง
                    (drop || []).forEach(d => { delete s.seqs[d]; delete s.cys[d]; });
                    // วันใหม่ → ยืม CY ของช่องวันนั้น ถ้ายังไม่มีเดี๋ยวระบบออกเลขให้ตอนส่งออก
                    days.forEach(d => {
                        if (!s.cys[d]) { const cy = cyOfSlot(rt, d); if (cy) s.cys[d] = cy; }
                    });
                    s.cy = s.cys[days[0]] || s.cy || '';
                    if (mode === 'F1') delete s.f2custom;
                    touched.add(rt);
                    if (!reflow.has(rt)) reflow.set(rt, new Set());
                    [...before, ...days].forEach(d => reflow.get(rt).add(d));
                });

                // ไล่ลำดับคิวใหม่เฉพาะวันที่โดนแตะ (SeqTool อ่านจาก State.stores จึงต้องยืมชุดให้ครบก่อน)
                if (typeof SeqTool !== 'undefined' && SeqTool.orderDay) {
                    const keep = State.stores;
                    const seen = new Set(), pool = [];
                    [...touched].forEach(rt => (R[rt] || []).forEach(s => {
                        s.route = rt;
                        const k = rt + '|' + s.id;
                        if (!seen.has(k)) { seen.add(k); pool.push(s); }
                    }));
                    State.stores = pool;
                    try {
                        reflow.forEach((days, rt) => days.forEach(d => {
                            try { SeqTool.orderDay(d, true, rt); } catch (e) {}
                        }));
                    } finally { State.stores = keep; }
                    if (SeqTool.compactAll) {
                        const sub = {};
                        touched.forEach(rt => { if (Array.isArray(R[rt])) sub[rt] = R[rt]; });
                        try { SeqTool.compactAll(sub); } catch (e) {}
                    }
                }

                await Promise.all([...touched].filter(r => Array.isArray(R[r])).map(r =>
                    App.planRoutesCol(ym).doc(r).set({
                        stores: R[r],
                        confirmedBy: firebase.firestore.FieldValue.delete(),
                        confirmedAt: firebase.firestore.FieldValue.delete(),
                    }, { merge: true })));

                UI.hideLoader();
                if (typeof EditHistory !== 'undefined') EditHistory.mark(mode === 'F2' ? 'ตั้ง F2' : 'ตั้ง F1');
                UI.render();
                const extra = [];
                if (p.skipNoDay) extra.push(`ข้าม ${p.skipNoDay} ร้านที่ยังไม่จัดวัน`);
                if (p.skipCustom) extra.push(`ข้าม ${p.skipCustom} ร้านที่กำหนดวันเอง`);
                if (p.skipFull) extra.push(`ข้าม ${p.skipFull} ร้านที่หาวันคู่ไม่ได้`);
                if (p.skipAlready) extra.push(`ข้าม ${p.skipAlready} ร้านที่วันของมันวิ่ง 2 ครั้ง/เดือนอยู่แล้ว`);
                if (p.skipShort) extra.push(`ข้าม ${p.skipShort} ร้านในสายรอบสั้น (ความถี่กำหนดที่ตลาด)`);
                UI.showSaveToast(`✅ ตั้งเป็น ${mode} แล้ว ${p.apply.length.toLocaleString()} ร้าน`
                    + (extra.length ? ' · ' + extra.join(' · ') : ''));
                return p.apply.length;
            } catch (e) {
                UI.hideLoader();
                console.error('[Freq]', e);
                UI.showErrorToast('❌ ตั้งความถี่ไม่สำเร็จ: ' + (e && e.message));
                return 0;
            }
        },

        /** ตั้งทีละร้าน (จาก popup หมุด) */
        async one(id, mode) {
            const s = F.find(id);
            if (!s) return;
            const dd = sortDays(s.days || []);
            const rt0 = routeOf(s);
            if (shortCycle(rt0))
                return UI.showErrorToast('ℹ️ สาย ' + rt0 + ' ใช้รอบสั้น (1 เดือนหมุนมากกว่า 1 รอบ) '
                    + 'ศูนย์แบบนี้กำหนดความถี่ที่ตลาด ไม่ใช่ที่ร้าน — เปลี่ยนความถี่ให้ทั้งตลาดแทน');
            if (mode === 'F2' && !dd.length)
                return UI.showErrorToast('⚠️ ร้านนี้ยังไม่มีวันเข้าเยี่ยม — จัดวันก่อนแล้วค่อยตั้ง F2');
            if (mode === 'F2' && dd.length === 1 && runsOf(rt0, dd[0]) >= 2)
                return UI.showErrorToast('ℹ️ ร้านนี้เข้าเดือนละ 2 ครั้งอยู่แล้ว เพราะวัน '
                    + dd[0].replace('Day ', 'D') + ' วิ่ง 2 รอบในเดือนนี้ — ถ้าเพิ่มวันคู่จะกลายเป็น 4 ครั้ง');
            try { MapCtrl.map.closePopup(); } catch (e) {}
            await F.run([s], mode);
        },

        // ── กล่องยืนยันสำหรับสั่งเป็นชุด ────────────────────────────────
        ask(mode) {
            const list = F.picked();
            if (!list.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกร้าน');
            const p = F.plan(list, mode);
            let el = $('freq-modal');
            if (!el) {
                el = document.createElement('div');
                el.id = 'freq-modal';
                el.className = 'fixed inset-0 bg-black/50 z-[9998] hidden items-center justify-center p-4';
                document.body.appendChild(el);
            }
            const tbl = (obj, head, cls) => {
                const rows = Object.keys(obj).sort((a, b) => dayNum(a) - dayNum(b));
                if (!rows.length) return '';
                return `<div class="mb-2">
                    <div class="text-[11px] font-bold ${cls} mb-1">${head}</div>
                    <div class="flex flex-wrap gap-1">
                        ${rows.map(d => `<span class="text-[11px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                            D${dayNum(d)} <span class="${cls}">${obj[d] > 0 ? '+' : ''}${obj[d]}</span></span>`).join('')}
                    </div></div>`;
            };
            const skip = [];
            if (p.skipNoDay) skip.push(`${p.skipNoDay} ร้านยังไม่จัดวัน — ต้องจัดวันก่อน`);
            if (p.skipCustom) skip.push(`${p.skipCustom} ร้านกำหนดวันที่สองเอง — ไม่แตะ`);
            if (p.skipFull) skip.push(`${p.skipFull} ร้านหาวันคู่ไม่ได้ (รอบสั้นเกิน)`);
            if (p.skipAlready) skip.push(`${p.skipAlready} ร้านอยู่ในวันที่วิ่ง 2 ครั้ง/เดือนอยู่แล้ว — เข้า 2 ครั้งอยู่แล้ว ไม่ต้องเพิ่มวัน`);
            if (p.skipShort) skip.push(`${p.skipShort} ร้านอยู่ในสายที่ใช้รอบสั้น (1 เดือนหมุนมากกว่า 1 รอบ) — ศูนย์แบบนี้กำหนดความถี่ที่ตลาด ไม่ใช่ที่ร้าน`);
            if (p.same) skip.push(`${p.same} ร้านเป็น ${mode} อยู่แล้ว`);

            el.innerHTML = `
              <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-4">
                <h3 class="font-black text-gray-800 mb-1">
                    ${mode === 'F2' ? '🔁 ตั้งเป็น F2 — เข้าเดือนละ 2 ครั้ง' : '🔂 ตั้งเป็น F1 — เข้าเดือนละครั้ง'}</h3>
                <p class="text-xs text-gray-500 mb-3">เลือกไว้ ${list.length.toLocaleString()} ร้าน ·
                    จะเปลี่ยนจริง <b class="text-gray-800">${p.apply.length.toLocaleString()} ร้าน</b></p>
                ${tbl(p.add, '➕ วันที่จะมีร้านเพิ่ม', 'text-emerald-600')}
                ${tbl(p.rm, '➖ วันที่จะมีร้านลด', 'text-red-500')}
                ${skip.length ? `<div class="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2">
                    ${skip.map(t => `<div class="text-[10.5px] text-amber-700 leading-snug">• ${esc(t)}</div>`).join('')}
                </div>` : ''}
                <p class="text-[10.5px] text-gray-400 mb-3 leading-snug">
                    ${mode === 'F2'
                        ? 'ครั้งที่สองจะไปอยู่วันที่ห่างไปครึ่งรอบให้เอง ย้ายเองทีหลังได้จาก popup หมุด'
                        : 'ครั้งที่สองจะถูกเอาออก เหลือเฉพาะวันแรก'}</p>
                <div class="flex gap-2">
                    <button onclick="Freq.close()" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ยกเลิก</button>
                    <button onclick="Freq.confirm('${mode}')" ${p.apply.length ? '' : 'disabled'}
                        class="flex-1 ${p.apply.length ? 'bg-gray-900 hover:bg-black' : 'bg-gray-300 cursor-not-allowed'} text-white py-2 rounded-xl text-sm font-bold">
                        ยืนยัน</button>
                </div>
              </div>`;
            el.classList.remove('hidden'); el.classList.add('flex');
        },
        close() {
            const el = $('freq-modal');
            if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
        },
        async confirm(mode) {
            const list = F.picked();
            F.close();
            await F.run(list, mode);
        },

        /**
         * ── ความถี่ระดับตลาด (สำหรับศูนย์รอบสั้น) ────────────────────────
         * ศูนย์ที่ 1 เดือนหมุนหลายรอบ (501/301) ความถี่อยู่ที่ตลาด ไม่ใช่ที่ร้าน
         * สลับได้ 2 ค่า:  'F2' = ตลาดนี้วิ่งทุกรอบ (เดือนละ 2 ครั้ง)
         *                'F1' = ตลาดนี้วิ่งรอบเดียว (เดือนละครั้ง)
         * เก็บลงร้านทุกร้านในตลาดนั้น (s.fqs[day]) ซึ่งเป็นช่องเดียวกับที่อ่านมาจากไฟล์
         */
        beatFreqOf(route, day) {
            try { if (typeof Runs !== 'undefined') return Runs.fqOf(route, day); } catch (e) {}
            return runsOf(route, day) >= 2 ? 'F2' : 'F1';
        },

        /** ตลาดนี้สลับความถี่ได้ไหม — ได้เมื่อเดือนนี้ตลาดนี้วิ่งได้มากกว่า 1 ครั้ง */
        beatCanToggle(route, day) {
            try {
                if (typeof Runs === 'undefined' || Runs.isDetached(route, day)) return false;
                return Runs.potential(route, day).length >= 2;
            } catch (e) { return false; }
        },

        async setBeatFreq(route, day, mode) {
            const arr = storesOfDay(route, day);
            if (!arr.length) return UI.showErrorToast('⚠️ ตลาดนี้ยังไม่มีร้าน');
            if (!F.beatCanToggle(route, day))
                return UI.showErrorToast('ℹ️ ตลาดนี้วิ่งรอบเดียวในเดือนนี้อยู่แล้ว — เปลี่ยนความถี่ที่นี่ไม่ได้');
            if (F.beatFreqOf(route, day) === mode) return;
            const dates = Runs.potential(route, day).filter(p => !p.to).map(p => p.date.getDate());
            const n = arr.length;
            const msg = mode === 'F2'
                ? `ตลาด ${day.replace('Day ', 'D')} (${n.toLocaleString()} ร้าน) จะวิ่ง "ทุกรอบ"\n\n`
                  + `เดือนนี้ = วันที่ ${dates.join(' และ ')}  →  ร้านในตลาดนี้ถูกเข้าเยี่ยมเดือนละ ${dates.length} ครั้ง\n`
                  + `ครั้งเข้าเยี่ยมของสายจะเพิ่มขึ้น ${(n * (dates.length - 1)).toLocaleString()} ครั้ง`
                : `ตลาด ${day.replace('Day ', 'D')} (${n.toLocaleString()} ร้าน) จะวิ่ง "รอบเดียว"\n\n`
                  + `เดือนนี้ = วันที่ ${dates[0]} เท่านั้น  →  ร้านในตลาดนี้ถูกเข้าเยี่ยมเดือนละ 1 ครั้ง\n`
                  + `ครั้งเข้าเยี่ยมของสายจะลดลง ${(n * (dates.length - 1)).toLocaleString()} ครั้ง`;
            const ok = await new Promise(r => UI.showConfirm(msg, () => r(true), () => r(false)));
            if (!ok) return;

            arr.forEach(s => { if (!s.fqs) s.fqs = {}; s.fqs[day] = mode; });
            try { Runs.bump(); } catch (e) {}
            const R = State.db.routes || {};
            try {
                await App.planRoutesCol(App._currentPlanYM).doc(route).set({
                    stores: R[route],
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                }, { merge: true });
            } catch (e) {
                console.error('[Freq.beat]', e);
                return UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message));
            }
            if (typeof EditHistory !== 'undefined') EditHistory.mark('ความถี่ตลาด ' + day);
            try { MapCtrl.map.closePopup(); } catch (e) {}
            UI.render();
            UI.showSaveToast(mode === 'F2'
                ? `✅ ตลาด ${day.replace('Day ', 'D')} วิ่งทุกรอบแล้ว (เดือนละ ${dates.length} ครั้ง)`
                : `✅ ตลาด ${day.replace('Day ', 'D')} วิ่งรอบเดียวแล้ว (เดือนละ 1 ครั้ง)`);
        },

        toggleBeat(route, day) {
            return F.setBeatFreq(route, day, F.beatFreqOf(route, day) === 'F2' ? 'F1' : 'F2');
        },

        /** ย้ายวันของครั้งที่สองเอง (จาก popup) */
        async setPair(id, day) {
            const s = F.find(id);
            if (!s) return;
            const days = sortDays(s.days || []);
            if (days.length < 2) return;
            const keep = days[0];
            if (!day || day === keep) return UI.showErrorToast('⚠️ วันที่สองต้องไม่ใช่วันเดียวกับวันแรก');
            const rt = routeOf(s);
            try { MapCtrl.map.closePopup(); } catch (e) {}
            const R = State.db.routes || {};
            const old = days[1];
            if (!s.seqs) s.seqs = {};
            if (!s.cys) s.cys = {};
            delete s.seqs[old]; delete s.cys[old];
            s.days = sortDays([keep, day]);
            s.f2custom = (pairOf(keep, rt) !== day) || undefined;
            const cy = cyOfSlot(rt, day); if (cy) s.cys[day] = cy;
            if (typeof SeqTool !== 'undefined' && SeqTool.orderDay) {
                [old, day].forEach(d => { try { SeqTool.orderDay(d, true, rt); } catch (e) {} });
                if (SeqTool.compactAll) { try { SeqTool.compactAll({ [rt]: R[rt] }); } catch (e) {} }
            }
            await App.planRoutesCol(App._currentPlanYM).doc(rt).set({
                stores: R[rt],
                confirmedBy: firebase.firestore.FieldValue.delete(),
                confirmedAt: firebase.firestore.FieldValue.delete(),
            }, { merge: true });
            if (typeof EditHistory !== 'undefined') EditHistory.mark('ย้ายวันครั้งที่ 2');
            UI.render();
            UI.showSaveToast(`✅ ย้ายครั้งที่ 2 ไป ${day.replace('Day ', 'D')} แล้ว`
                + (s.f2custom ? ' (กำหนดเอง)' : ''));
        },

        _pairOf: pairOf,
        _cycleOf: cycleOf,
    };

    window.Freq = F;

    // ══ ป้ายความถี่ที่หัวกลุ่มวันในแท็บ 1 (เฉพาะตลาดที่วิ่งได้หลายรอบ) ═══════
    const paintBeatBadge = () => {
        const host = document.getElementById('list-assigned');
        if (!host) return;
        host.querySelectorAll('details > summary').forEach(sm => {
            if (sm.dataset.fqDone === '1') return;
            const btn = sm.querySelector('button[onclick*="pointFor"]');
            if (!btn) return;                                   // ไม่ใช่หัวกลุ่มวัน
            const m = /pointFor\('([^']+)','([^']+)'/.exec(btn.getAttribute('onclick') || '');
            if (!m) return;
            const rt = m[1], dk = m[2];
            // ป้ายเงา F2 — บอกว่าในวันนี้มีกี่ร้านที่เป็นร้าน F2 (สายรอบยาว: ร้านอยู่ 2 ช่องวัน)
            const arr = storesOfDay(rt, dk);
            const nF2 = shortCycle(rt) ? 0 : arr.filter(s2 => realDays(s2).length > 1).length;
            if (nF2) sm.insertAdjacentHTML('beforeend',
                `<span title="${nF2} ร้านในวันนี้เป็นร้าน F2 (เข้าเดือนละ 2 ครั้ง)"
                    class="shrink-0 text-[9px] font-bold rounded px-1 text-red-600 bg-red-50 border border-red-200">F2 ${nF2}</span>`);
            sm.dataset.fqDone = '1';
            if (typeof Runs === 'undefined') return;
            // ครั้งที่แยกออกมา — บอกว่ามาจากตลาดไหน ครั้งที่เท่าไหร่
            const meta = Runs.metaOf(rt, dk);
            const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
            if (meta) {
                const d = Runs._parse(meta.date);
                sm.insertAdjacentHTML('beforeend',
                    `<button onclick="event.preventDefault();event.stopPropagation();Runs.open('${rt}','${dk}')"
                        title="ครั้งที่ ${meta.run} ของ ${meta.src.replace('Day ', 'D')} ที่แยกออกมาแก้เอง · ส่งออกเป็น CY แบบ 9&#10;กดเพื่อเปลี่ยนวันที่ หรือรวมกลับ"
                        class="beat-fq shrink-0 text-[9px] font-black rounded-md px-1.5 py-[1px] border-2 shadow-sm cursor-pointer text-amber-800 bg-amber-50 border-amber-300 hover:bg-amber-100">
                        ✂️ ${meta.src.replace('Day ', 'D')}·ครั้ง${meta.run}${d ? ' · ' + d.getDate() + ' ' + TH[d.getMonth()] : ''}</button>`
                    // V0.7.3: เอาร้านที่เลือกออกจากครั้งนี้เท่านั้น (ครั้งแรกไม่ถูกแตะ)
                    + `<button onclick="event.preventDefault();event.stopPropagation();Runs.removeSel('${rt}','${dk}')"
                        title="เอาร้านที่เลือกไว้ออกจากครั้งนี้เท่านั้น — ครั้งแรกและลำดับคิวเดิมไม่ถูกแตะ&#10;เลือกร้านในรายการหรือบนแผนที่ก่อน"
                        class="beat-fq shrink-0 text-[9px] font-black rounded-md px-1.5 py-[1px] border-2 shadow-sm cursor-pointer text-red-700 bg-white border-red-300 hover:bg-red-50">➖ เอาที่เลือกออก</button>`);
                return;
            }
            if (!F.beatCanToggle(rt, dk)) return;
            const pot = Runs.potential(rt, dk);
            const once = Runs.fqOf(rt, dk) === 'F1';
            const runs = Runs.datesOf(rt, dk);
            const split = pot.some(p => p.to);
            const hol = runs.some(d => Runs.isHoliday(rt, d));
            const n = runs.length;
            const txt = once ? '×1 ' + (runs[0] ? runs[0].getDate() : '') : '🔁 ' + Runs._dlist(runs);
            const tip = `เดือนนี้ตลาดนี้วิ่งได้ ${pot.length} ครั้ง (${Runs._dlist(pot.map(p => p.date))})&#10;`
                + `ตอนนี้: ${once ? 'วิ่งครั้งเดียว' : 'วิ่งทุกครั้ง'}${split ? ' · มีครั้งที่แยกออกไปแก้เอง' : ''}${hol ? ' · ⚠️ มีครั้งที่ตรงวันหยุด' : ''}&#10;`
                + `กดเพื่อดูครั้งเข้าเยี่ยม / แก้ครั้งใดครั้งหนึ่ง`;
            sm.insertAdjacentHTML('beforeend',
                `<button onclick="event.preventDefault();event.stopPropagation();Runs.open('${rt}','${dk}')"
                    title="${tip}"
                    class="beat-fq shrink-0 text-[9px] font-black rounded-md px-1.5 py-[1px] border-2 shadow-sm cursor-pointer transition ${hol
                        ? 'text-white bg-red-600 border-red-700' : (!once && n >= 2
                        ? 'text-white bg-red-500 border-red-600 hover:bg-red-600' : 'text-indigo-700 bg-white border-indigo-300 hover:bg-indigo-50')}">
                    ${txt}${split ? ' ✂️' : ''}${hol ? ' ⚠️' : ''}</button>`);
        });
    };

    // ══ ปุ่มบนแถบแผนที่ — โผล่เมื่อมีร้านถูกเลือก ═══════════════════════════
    const paintBar = () => {
        const tools = $('mapTools');
        if (!tools) return;
        const n = F.picked().length;
        let btn = $('map-freq');
        if (!btn) {
            btn = document.createElement('div');
            btn.id = 'map-freq';
            btn.className = 'hidden flex gap-1';
            btn.innerHTML =
                '<button onclick="Freq.ask(\'F2\')" title="ตั้งร้านที่เลือกให้เข้าเดือนละ 2 ครั้ง"'
                + ' class="bg-white hover:bg-gray-50 text-gray-800 px-3 py-2.5 rounded-xl shadow-lg text-sm font-bold border border-gray-200">🔁 ตั้ง F2</button>'
                + '<button onclick="Freq.ask(\'F1\')" title="ตั้งร้านที่เลือกให้เข้าเดือนละครั้ง"'
                + ' class="bg-white hover:bg-gray-50 text-gray-800 px-3 py-2.5 rounded-xl shadow-lg text-sm font-bold border border-gray-200">🔂 ตั้ง F1</button>';
            const un = $('map-unselect');
            if (un && un.nextSibling) tools.insertBefore(btn, un.nextSibling);
            else tools.appendChild(btn);
        }
        btn.classList.toggle('hidden', n === 0);
        btn.classList.toggle('flex', n > 0);
    };

    // ══ แทรกส่วนความถี่เข้าไปใน popup หมุด ═════════════════════════════════
    const wrapPopup = () => {
        if (typeof MultiRoute === 'undefined' || !MultiRoute.popup || MultiRoute.popup._freqWrapped) return false;
        const orig = MultiRoute.popup;
        const fn = function (s, latlng) {
            const r = orig.call(this, s, latlng);
            setTimeout(() => {
                try {
                    const box = document.querySelector('.leaflet-popup-content');
                    if (!box || box.dataset.freqDone) return;
                    box.dataset.freqDone = '1';
                    const days = sortDays(s.days || []);
                    const rt = routeOf(s);
                    const f2 = days.length > 1;
                    const visits = F.visitsOf(s);
                    const short = shortCycle(rt);
                    const twice = days.length === 1 && runsOf(rt, days[0]) >= 2;
                    const anchor = box.querySelector('[data-visits]') || box.querySelector('label');      // V0.8.0: ช่อง Visit 1–5 (เดิม ป้าย "วันที่เข้าเยี่ยม")
                    const custom = f2 && !F.canonical(s);
                    const dayOpts = (typeof MultiRoute.dayList === 'function' ? MultiRoute.dayList() : [])
                        .filter(d => d !== days[0]);
                    const d0 = days[0] || '';
                    const canBeat = d0 && F.beatCanToggle(rt, d0);
                    const beatF2 = d0 && F.beatFreqOf(rt, d0) === 'F2';
                    const nBeat = d0 ? storesOfDay(rt, d0).length : 0;
                    const html = short ? `
                        <div class="mb-1.5" data-freq-box>
                            <label class="block text-[10px] text-gray-400 font-bold">ความถี่เข้าเยี่ยม${
                                visits ? ` <span class="text-gray-500">· เดือนนี้ ${visits} ครั้ง</span>` : ''}</label>
                            <div class="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-1.5 py-1 leading-snug mb-1">
                                สายนี้ใช้รอบสั้น ความถี่กำหนดที่<b>ทั้งตลาด</b> ไม่ใช่รายร้าน
                            </div>
                            ${canBeat ? `
                            <div class="text-[10px] text-gray-400 font-bold">ตลาด ${esc(d0.replace('Day ', 'D'))} · ${nBeat} ร้าน</div>
                            <div class="flex gap-1">
                                <button onclick="Freq.setBeatFreq('${esc(rt)}','${esc(d0)}','F1')"
                                    class="flex-1 py-1 rounded-md text-[11px] font-bold border ${!beatF2
                                        ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}">
                                    วิ่งรอบเดียว</button>
                                <button onclick="Freq.setBeatFreq('${esc(rt)}','${esc(d0)}','F2')"
                                    class="flex-1 py-1 rounded-md text-[11px] font-bold border ${beatF2
                                        ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}">
                                    วิ่งทุกรอบ</button>
                            </div>
                            <div class="text-[9.5px] text-gray-400 mt-0.5 leading-snug">เปลี่ยนแล้วมีผลกับทุกร้านในตลาดนี้</div>
                            <button onclick="Runs.open('${esc(rt)}','${esc(d0)}')" class="mt-1 w-full py-1 rounded-md text-[11px] font-bold border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">🗓️ ครั้งเข้าเยี่ยม / แก้ครั้งใดครั้งหนึ่ง</button>` : ''}
                        </div>` : `
                        <div class="mb-1.5" data-freq-box>
                            <label class="block text-[10px] text-gray-400 font-bold">ความถี่เข้าเยี่ยม${
                                visits ? ` <span class="text-gray-500">· เดือนนี้ ${visits} ครั้ง</span>` : ''}</label>
                            <div class="flex gap-1">
                                <button onclick="Freq.one('${esc(s.id)}','F1')"
                                    class="flex-1 py-1 rounded-md text-[11px] font-bold border ${!f2
                                        ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}">
                                    F1 · เดือนละครั้ง</button>
                                <button onclick="Freq.one('${esc(s.id)}','F2')"
                                    ${twice ? 'title="วันนี้วิ่ง 2 รอบในเดือนนี้อยู่แล้ว — ร้านนี้ได้ 2 ครั้งโดยไม่ต้องเพิ่มวัน"' : ''}
                                    class="flex-1 py-1 rounded-md text-[11px] font-bold border ${f2
                                        ? 'bg-red-500 text-white border-red-500'
                                        : (twice ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
                                                 : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}">
                                    F2 · 2 ครั้ง</button>
                            </div>
                            ${f2 ? `<div class="mt-1">
                                <div class="text-[10px] text-gray-400 font-bold">ครั้งที่ 2 ${custom
                                    ? '<span class="text-amber-600">· กำหนดเอง ห่าง ' + F.gapOf(s) + ' วัน</span>'
                                    : '<span class="text-gray-400">· ครึ่งรอบ</span>'}</div>
                                <select onchange="Freq.setPair('${esc(s.id)}', this.value)"
                                        class="w-full border border-gray-200 rounded-md px-1 py-1 text-xs">
                                    ${dayOpts.map(d => `<option value="${d}" ${d === days[1] ? 'selected' : ''}>
                                        ${d.replace('Day ', 'D')}</option>`).join('')}
                                </select></div>` : ''}
                        </div>`;
                    // V0.8.0: รอบยาวใช้ช่อง Visit 1–5 (visits.js) แทน F1/F2 + ครั้งที่ 2 · รอบสั้นยังมีกล่องความถี่ระดับตลาด
                    if (!short && typeof Visits !== 'undefined' && Visits.popupHTML) return;
                    if (anchor) anchor.insertAdjacentHTML('beforebegin', html);
                    else box.insertAdjacentHTML('beforeend', html);
                } catch (e) {}
            }, 0);
            return r;
        };
        fn._freqWrapped = true;
        MultiRoute.popup = fn;
        return true;
    };

    const boot = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof State === 'undefined') return setTimeout(boot, 400);
        if (UI._freqWired) return;
        UI._freqWired = true;
        const orig = UI.render;
        UI.render = function () {
            const r = orig.apply(this, arguments);
            const go = () => { try { paintBar(); paintBeatBadge(); } catch (e) {} };
            go(); setTimeout(go, 0); setTimeout(go, 250);
            return r;
        };
        document.addEventListener('click', () => setTimeout(() => {
            try { paintBar(); paintBeatBadge(); } catch (e) {}
        }, 120), true);
        [500, 1500, 4000, 9000].forEach(t => setTimeout(wrapPopup, t));
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800));
})();

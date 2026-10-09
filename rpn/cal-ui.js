/* =============================================================================
 *  cal-ui.js — ปรับหน้าตั้งค่าปฏิทินให้ตรงกับวิธีทำงานจริง
 * =============================================================================
 *  1) เหลือโหมดเดียว "หมุนนับต่อเนื่อง" — โหมด "วันที่ = Day" เลิกใช้ (ซ่อนออก)
 *  2) ตัดแถวเลือกจุดเริ่มนับ (วันที่ตายตัว / วันในสัปดาห์ / วนซ้ำ) — ใช้แบบวันที่ตายตัวเสมอ
 *  3) เพิ่ม Total Working Day — วันทำงานจริงทั้งเดือนหลังหักวันหยุด เทียบกับจำนวนวัน Cycle
 *  4) ตั้งค่ารายสาย: เลือกได้ทีละหลายสายด้วยช่องติ๊ก สายที่ตั้งค่าแล้วมีเครื่องหมาย ✓ + ปุ่มแก้ไข
 *  5) (V0.6) รอบยาว: บอกวันท้ายเดือนที่ครบรอบแล้ววนกลับเป็น D1 D2 … (ตลาดวิ่งซ้ำ) + ปุ่มตั้งเป็นวันหยุด
 *  6) (V0.6) สร้างเดือนใหม่แล้วเปิดหน้านี้ให้ทันที พร้อมแถบเตือนให้ใส่วันหยุดของเดือนนั้น
 * ========================================================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const S = { perRoute: false, ticked: new Set(), overrides: {}, newMonth: '' };

    // ── 1+2) ตัดตัวเลือกที่เลิกใช้ ───────────────────────────────────────
    const trimOptions = () => {
        const dateBtn = $('cal-mode-date');
        if (dateBtn && !dateBtn.dataset.calHidden) {
            dateBtn.dataset.calHidden = '1';
            dateBtn.style.display = 'none';
            const grid = dateBtn.parentElement;
            if (grid) { grid.classList.remove('grid-cols-2'); grid.classList.add('grid-cols-1'); }
        }
        const a1 = $('cal-anchor-date');
        const row = a1 && a1.parentElement;
        if (row && !row.dataset.calHidden) { row.dataset.calHidden = '1'; row.style.display = 'none'; }
        // โหมดและจุดเริ่มนับถูกล็อกไว้แบบเดียว
        try {
            if (typeof CalendarAdmin !== 'undefined') {
                if (CalendarAdmin._mode !== 'cycle') CalendarAdmin.setMode('cycle');
                if (CalendarAdmin._anchorType !== 'date') CalendarAdmin.setAnchorType('date');
            }
        } catch (e) {}
    };

    // ── 2b) พฤติกรรมเมื่อเจอวันหยุด ─────────────────────────────────────
    const paintHolidayMode = () => {
        const host = $('cal-cycle-days');
        if (!host || !host.parentElement) return;
        let box = $('cal-holmode');
        if (!box) {
            box = document.createElement('div');
            box.id = 'cal-holmode';
            box.className = 'mt-2';
            host.parentElement.parentElement.appendChild(box);
        }
        const cur = (typeof CalendarAdmin !== 'undefined' && CalendarAdmin._holidayMode) || 'shift';
        const btn = (val, title, desc) => `<button onclick="CalUI.setHolMode('${val}')"
            class="flex-1 text-left rounded-xl border px-2.5 py-2 transition ${cur === val
                ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}">
            <div class="text-[11px] font-black ${cur === val ? 'text-indigo-800' : 'text-gray-700'}">${title}</div>
            <div class="text-[10px] text-gray-500 leading-snug mt-0.5">${desc}</div></button>`;
        box.innerHTML = `
            <label class="block text-xs font-bold text-gray-700 mb-1.5">เมื่อเจอ<u>วันหยุดเฉพาะกิจ</u> (นักขัตฤกษ์ / วันลา):</label>
            <div class="flex gap-2">
                ${btn('shift', '⟳ เลื่อนตลาดไปวันถัดไป', 'ไม่มีตลาดไหนหาย ตลาดหลังวันหยุดเลื่อนตามกันทั้งแถว')}
                ${btn('skip', '⤳ ตรึงตลาดไว้กับวันที่', 'ตลาดอื่นไม่ขยับ ตลาดที่ตรงวันหยุด = เดือนนี้ไม่ได้วิ่ง')}
            </div>
            <p class="text-[10px] text-gray-400 mt-1 leading-snug">
                วันหยุดประจำสัปดาห์ (เสาร์/อาทิตย์ ฯลฯ) ระบบข้ามให้อยู่แล้วทุกกรณี ไม่กินตลาดของใคร — ตัวเลือกนี้ใช้กับวันหยุดเฉพาะกิจเท่านั้น
            </p>`;
    };

    // ── 5) วันท้ายเดือนที่วนกลับ (รอบยาว) ───────────────────────────────────
    /** วันทำงานที่ครบรอบแล้ววนกลับไปใช้ป้ายวันเดิม {d, lb} และวันสุดท้ายก่อนวน — เฉพาะรอบยาว (> 14 วัน)
     *  รอบสั้นตั้งใจหมุน 2 รอบอยู่แล้ว (ครั้งที่ 3 ในเดือน 5 สัปดาห์มาจาก +14 วัน ไม่ได้มาจากป้ายนี้) */
    const wrapInfo = () => {
        const CA = (typeof CalendarAdmin !== 'undefined') ? CalendarAdmin : null;
        if (!CA || CA._mode !== 'cycle' || !CA._ym) return null;
        const cyc = parseInt(($('cal-cycle-days') || {}).value, 10) || 24;
        if (cyc <= 14) return null;
        const [y, m] = CA._ym.split('_').map(Number);
        const dim = new Date(y, m, 0).getDate();
        const seen = new Set(), out = [];
        let last = null, wrap = false;
        for (let d = 1; d <= dim; d++) {
            const hol = (CA._holidays || []).includes(d) || (CA._weeklyHolidays || []).includes(new Date(y, m - 1, d).getDay());
            if (hol) continue;
            let lb = null; try { lb = CA._computeDayLabel(d); } catch (e) {}
            if (!lb) continue;
            if (!wrap && seen.has(lb)) wrap = true;
            seen.add(lb);
            if (wrap) out.push({ d, lb: lb.replace('Day ', 'D') }); else last = { d, lb: lb.replace('Day ', 'D') };
        }
        return out.length ? { days: out, last } : null;
    };
    /** 29,30,31 → "29–31" · 5,29 → "5, 29" */
    const span = (xs) => {
        const parts = []; let a = null, b = null;
        xs.forEach(x => { if (a !== null && x === b + 1) b = x; else { if (a !== null) parts.push(a === b ? a : a + '–' + b); a = b = x; } });
        if (a !== null) parts.push(a === b ? a : a + '–' + b);
        return parts.join(', ');
    };

    // ── 3) Total Working Day ────────────────────────────────────────────
    const paintTotals = () => {
        const host = $('cal-cycle-days');
        if (!host || !host.parentElement) return;
        let box = $('cal-total-work');
        if (!box) {
            box = document.createElement('div');
            box.id = 'cal-total-work';
            box.className = 'mt-1 rounded-lg px-3 py-2 text-[11px] leading-snug';
            host.parentElement.parentElement.appendChild(box);
        }
        // นับจากตัวอย่างปฏิทินที่วาดไว้แล้ว จะได้ตรงกับที่ตาเห็นเสมอ
        const cells = [...document.querySelectorAll('#cal-preview-list > *')];
        let hol = 0, used = 0, spare = 0;
        cells.forEach(c => {
            const t = c.textContent.replace(/\s+/g, ' ');
            if (/หยุด/.test(t)) hol++;
            else if (/D\d+/.test(t)) used++;
            else if (/—|-/.test(t)) spare++;
        });
        const work = used + spare;
        // ช่องว่างหัวสัปดาห์ก่อนวันที่ 1 ก็นับอยู่ใน cells ด้วย ต้องไม่เอามารวมเป็นจำนวนวันของเดือน
        const inMonth = used + spare + hol;
        const cyc = parseInt(($('cal-cycle-days') || {}).value, 10) || 0;
        if (!inMonth) { box.innerHTML = ''; return; }
        const short = cyc > work;
        box.className = 'mt-1 rounded-lg px-3 py-2 text-[11px] leading-snug border '
            + (short ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600');
        const extra = Math.max(0, used - cyc);
        const wi = wrapInfo();
        box.innerHTML = `<b>Total Working Day: ${work} วัน</b> (ทั้งเดือน ${inMonth} วัน − หยุด ${hol} วัน)`
            + (wi ? `<div class="mt-1.5 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1.5 text-amber-900">
                    ⚠️ ครบรอบ ${esc(wi.last ? wi.last.lb : 'D' + cyc)} ${wi.last ? 'วันที่ ' + wi.last.d : ''} → วันที่ <b>${span(wi.days.map(x => x.d))}</b>
                    วนกลับเป็น <b>${esc(wi.days.map(x => x.lb).join(' '))}</b> — ตลาดพวกนี้จะ<b>วิ่ง 2 ครั้ง</b>ในเดือนนี้
                    <div class="mt-1 flex items-center gap-2 flex-wrap">
                        <button onclick="CalUI.holTail()" class="text-[10.5px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-2 py-0.5">ตั้งวันที่ ${span(wi.days.map(x => x.d))} เป็นวันหยุด (ไม่มีแผน)</button>
                        <span class="text-[10px] text-amber-700">ถ้าตั้งใจให้วิ่งซ้ำ ไม่ต้องกด</span>
                    </div></div>`
                : (extra
                    ? `<br>ครบรอบ ${cyc} วันแล้ววนต่ออีก <b>${extra} วัน</b> (D1 D2 …)`
                    : `<br>ใช้ในรอบนี้ ${used} วัน`))
            + (spare ? ` · เหลือว่างท้ายเดือน <b>${spare} วัน</b>` : '')
            + (short ? `<br><b>⚠️ จำนวนวัน Cycle (${cyc}) มากกว่าวันทำงานที่มีจริง</b> — บางตลาดจะไม่มีวันลง` : '');
    };

    // ── 6) แถบ "เดือนใหม่" ─────────────────────────────────────────────
    const paintNewMonth = () => {
        const modal = $('calendar-config-modal');
        const body = modal && modal.querySelector('.overflow-y-auto');
        if (!body) return;
        let box = $('cal-newmonth');
        const on = S.newMonth && typeof CalendarAdmin !== 'undefined' && CalendarAdmin._ym === S.newMonth && !S.perRoute;
        if (!on) { if (box) box.remove(); return; }
        if (!box) {
            box = document.createElement('div');
            box.id = 'cal-newmonth';
            body.insertBefore(box, body.firstChild);
        }
        const lbl = (App.ymToLabel ? App.ymToLabel(S.newMonth) : S.newMonth);
        box.className = 'bg-indigo-50 border border-indigo-300 rounded-xl px-3 py-2.5 text-[11.5px] text-indigo-900 leading-snug';
        box.innerHTML = `<b>📅 เดือนใหม่ ${esc(lbl)}</b> — ตั้ง D1 เริ่มวันที่ 1 ไว้ให้แล้ว (ตรงวันหยุดประจำสัปดาห์จะเลื่อนไปวันทำงานแรกเอง)<br>
            เช็ควันเริ่ม ใส่<b>วันหยุดเฉพาะกิจ</b>ของเดือนนี้ (นักขัตฤกษ์ / วันที่ไม่ต้องการให้มีแผน) แล้วกด <b>บันทึก</b>`;
    };

    // ── 4) ตั้งค่าสำหรับ: ทั้งศูนย์ / เลือกหลายสายด้วยช่องติ๊ก ─────────────
    const loadOverrides = async () => {
        S.overrides = {};
        const ym = (typeof CalendarAdmin !== 'undefined' && CalendarAdmin._ym) || App._currentPlanYM;
        const names = (State.db.routeList || Object.keys(State.db.routes || {}))
            .filter(r => r && r !== 'รอจัดสาย');
        await Promise.all(names.map(async (n) => {
            try {
                const d = await App.planRoutesCol(ym).doc(n).get();
                if (d && d.exists && d.data().calendarOverride) S.overrides[n] = true;
            } catch (e) {}
        }));
        paintTarget();
    };

    const paintTarget = () => {
        const sel = $('cal-target-select');
        if (!sel) return;
        sel.style.display = 'none';
        let box = $('cal-target-box');
        if (!box) {
            box = document.createElement('div');
            box.id = 'cal-target-box';
            sel.parentElement.insertBefore(box, sel);
        }
        const names = (State.db.routeList || Object.keys(State.db.routes || {}))
            .filter(r => r && r !== 'รอจัดสาย')
            .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
        const nOv = names.filter(n => S.overrides[n]).length;
        const tab = (on, val, label) => `<button onclick="CalUI.setScope(${val})"
            class="flex-1 text-xs font-bold rounded-xl py-2 border transition ${on
                ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}">${label}</button>`;

        const ovNames = names.filter(n => S.overrides[n]);
        box.innerHTML = `
            <div class="flex gap-2">
                ${tab(!S.perRoute, 'false', '🏢 ทั้งศูนย์ (default)')}
                ${tab(S.perRoute, 'true', '🚚 เลือกเฉพาะสาย' + (nOv ? ` (${nOv})` : ''))}
            </div>
            ${(!S.perRoute && nOv) ? `
            <div class="mt-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 text-[11px] text-amber-900 leading-snug">
                ⚠️ <b>${nOv} สายมีปฏิทินเฉพาะสายอยู่</b> — ค่าที่ตั้งตรงนี้จะ<b>ไม่มีผล</b>กับสายเหล่านั้น
                <span class="text-amber-700">(${ovNames.slice(0, 6).map(esc).join(', ')}${nOv > 6 ? ' …' : ''})</span><br>
                ถ้าต้องการให้ทุกสายใช้ปฏิทินเดียวกัน กด
                <button onclick="CalUI.clearAllOverrides()" class="ml-1 text-[10.5px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-2 py-0.5">ล้างปฏิทินเฉพาะสายทั้ง ${nOv} สาย</button>
            </div>` : ''}
            ${S.perRoute ? `
            <div class="mt-2 border border-gray-200 rounded-xl overflow-hidden">
                <div class="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border-b border-gray-200">
                    <button onclick="CalUI.tickAll(true)" class="text-[10px] font-bold text-indigo-600 hover:underline">เลือกทั้งหมด</button>
                    <button onclick="CalUI.tickAll(false)" class="text-[10px] font-bold text-gray-500 hover:underline">ล้าง</button>
                    <span class="ml-auto text-[10px] text-gray-400">ติ๊กไว้ ${S.ticked.size} สาย</span>
                </div>
                <div class="max-h-44 overflow-y-auto divide-y divide-gray-100">
                    ${names.map(n => `
                    <label class="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" ${S.ticked.has(n) ? 'checked' : ''} onchange="CalUI.tick('${esc(n)}', this.checked)" class="w-3.5 h-3.5">
                        <span class="font-bold text-gray-700">${esc(n)}</span>
                        ${S.overrides[n]
                            ? `<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5">✓ ตั้งค่าแล้ว</span>
                               <button onclick="event.preventDefault();CalUI.edit('${esc(n)}')" class="text-[10px] font-bold text-indigo-600 hover:underline">แก้ไข</button>`
                            : `<span class="text-[10px] text-gray-400">ใช้ค่าของศูนย์</span>`}
                    </label>`).join('')}
                </div>
            </div>` : ''}`;

        const hint = $('cal-target-hint');
        if (hint) {
            hint.textContent = !S.perRoute
                ? 'ค่านี้จะใช้กับทุกสายในศูนย์ ยกเว้นสายที่ตั้งค่าเฉพาะไว้'
                : (S.ticked.size
                    ? `บันทึกครั้งนี้จะเขียนทับปฏิทินของ ${S.ticked.size} สายที่ติ๊กไว้`
                    : 'ติ๊กสายที่ต้องการก่อน แล้วตั้งค่าด้านล่างให้เรียบร้อยจึงกดบันทึก');
        }
    };

    /** สายที่จะโดนบันทึกครั้งนี้ */
    const targets = () => (S.perRoute ? [...S.ticked] : []);

    /** ล้าง override ของทุกสายในเดือนที่กำลังตั้งค่า → กลับไปใช้ปฏิทินระดับเดือน */
    const clearAllOverrides = () => {
        const ym = (typeof CalendarAdmin !== 'undefined' && CalendarAdmin._ym) || App._currentPlanYM;
        const list = Object.keys(S.overrides).filter(n => S.overrides[n]);
        if (!list.length) return;
        UI.showConfirm(`ล้างปฏิทินเฉพาะสายของ ${list.length} สาย (เดือน ${App.ymToLabel ? App.ymToLabel(ym) : ym})\n\n${list.join(', ')}\n\nทุกสายจะกลับไปใช้ปฏิทินระดับเดือนที่ตั้งในหน้านี้ · วันที่ของตลาดในสายเหล่านั้นจะเปลี่ยนตาม`,
            async () => {
                UI.showLoader('↩️ กำลังล้างปฏิทินเฉพาะสาย...', `${list.length} สาย`);
                try {
                    for (const r of list) {
                        await App.planRoutesCol(ym).doc(r).set({
                            calendarOverride: firebase.firestore.FieldValue.delete(),
                            confirmedBy: firebase.firestore.FieldValue.delete(),
                            confirmedAt: firebase.firestore.FieldValue.delete(),
                        }, { merge: true });
                    }
                    S.overrides = {};
                    if (window.DayDate && DayDate.reloadOverrides) await DayDate.reloadOverrides();
                    UI.hideLoader();
                    paintTarget();
                    if (typeof CalendarAdmin !== 'undefined' && CalendarAdmin._renderPreview) { try { CalendarAdmin._renderPreview(); } catch (e) {} }
                    UI.showSaveToast(`↩️ ${list.length} สายกลับไปใช้ปฏิทินระดับเดือนแล้ว`);
                } catch (e) { UI.hideLoader(); UI.showErrorToast('❌ ล้างไม่สำเร็จ: ' + (e && e.message)); }
            });
    };

    window.CalUI = {
        clearAllOverrides,
        targets,
        setScope(per) {
            S.perRoute = !!per;
            paintNewMonth();
            if (!S.perRoute) { S.ticked.clear(); CalendarAdmin._targetRoute = ''; CalendarAdmin._loadConfig(); }
            paintTarget();
        },
        tick(name, on) {
            if (on) S.ticked.add(name); else S.ticked.delete(name);
            // ตัวโหลด/ตัวบันทึกเดิมใช้สายเดียว — ให้ตัวแรกที่ติ๊กเป็นตัวแทน
            CalendarAdmin._targetRoute = [...S.ticked][0] || '';
            paintTarget();
        },
        tickAll(on) {
            const names = (State.db.routeList || Object.keys(State.db.routes || {}))
                .filter(r => r && r !== 'รอจัดสาย');
            S.ticked = on ? new Set(names) : new Set();
            CalendarAdmin._targetRoute = [...S.ticked][0] || '';
            paintTarget();
        },
        async edit(name) {
            S.perRoute = true;
            S.ticked = new Set([name]);
            CalendarAdmin._targetRoute = name;
            await CalendarAdmin._loadConfig();
            paintTarget();
        },
        setHolMode(v) {
            if (typeof CalendarAdmin === 'undefined') return;
            CalendarAdmin._holidayMode = v;
            try { CalendarAdmin._renderPreview(); } catch (e) {}
            paintHolidayMode();
        },
        /** ตั้งวันที่ท้ายเดือนที่วนกลับ เป็นวันหยุดเฉพาะกิจ (ยังไม่บันทึก — ผู้ใช้กดบันทึกเอง) */
        holTail() {
            const wi = wrapInfo();
            if (!wi || typeof CalendarAdmin === 'undefined') return;
            const set = new Set(CalendarAdmin._holidays || []);
            wi.days.forEach(x => set.add(x.d));
            CalendarAdmin._holidays = [...set].sort((a, b) => a - b);
            try { CalendarAdmin._renderHolidayGrid(); } catch (e) {}
            try { CalendarAdmin._renderPreview(); } catch (e) {}
            UI.showSaveToast(`📅 ตั้งวันที่ ${span(wi.days.map(x => x.d))} เป็นวันหยุดแล้ว — กดบันทึกเพื่อใช้งาน`);
        },
        /** เปิดหน้าตั้งปฏิทินของเดือนที่เพิ่งสร้าง พร้อมแถบเตือน */
        async openNewMonth(ym) {
            if (typeof CalendarAdmin === 'undefined') return;
            S.newMonth = ym;
            await CalendarAdmin.open(ym);
        },
        refresh: paintTarget,
        _state: S, _wrapInfo: wrapInfo,
    };

    // ── ต่อเข้ากับของเดิม ───────────────────────────────────────────────
    const boot = () => {
        if (typeof CalendarAdmin === 'undefined' || typeof App === 'undefined') return setTimeout(boot, 500);
        if (CalendarAdmin._calUiWired) return;
        CalendarAdmin._calUiWired = true;

        const wrap = (name, after) => {
            const o = CalendarAdmin[name];
            if (typeof o !== 'function') return;
            CalendarAdmin[name] = async function () {
                const r = await o.apply(this, arguments);
                try { after(); } catch (e) { console.warn('[CalUI]', e); }
                return r;
            };
        };
        wrap('open', () => { S.perRoute = false; S.ticked.clear(); trimOptions(); paintTarget(); loadOverrides(); paintHolidayMode(); paintTotals(); paintNewMonth(); });
        wrap('close', () => { S.newMonth = ''; paintNewMonth(); });
        wrap('shiftMonth', paintNewMonth);
        wrap('_loadConfig', () => { trimOptions(); paintTarget(); paintHolidayMode(); paintTotals(); });
        wrap('_renderPreview', () => { paintHolidayMode(); paintTotals(); });
        wrap('setMode', trimOptions);

        // บันทึกทีเดียวหลายสาย — ยืมทางเดิมที่สร้าง cfg ไว้แล้ว
        if (App.saveRouteCalendarOverride && !App.saveRouteCalendarOverride._calUi) {
            const orig = App.saveRouteCalendarOverride;
            const fn = async function (route, cfg, ym) {
                const list = targets();
                if (cfg && list.length > 1) {
                    for (const r of list) await orig.call(App, r, cfg, ym);
                    S.ticked.forEach(r => { S.overrides[r] = true; });
                    UI.showSaveToast(`📅 บันทึกปฏิทิน ${list.length} สายเรียบร้อย`);
                    paintTarget();
                    return;
                }
                const r = await orig.apply(this, arguments);
                if (cfg && route) { S.overrides[route] = true; paintTarget(); }
                return r;
            };
            fn._calUi = true;
            App.saveRouteCalendarOverride = fn;
        }
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 900));
})();

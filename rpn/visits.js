/* =============================================================================
 *  visits.js — เลือกครั้งเข้าเยี่ยม Visit 1–5 (V0.8.0)
 * =============================================================================
 *  แทนปุ่ม F1 / F2 + ช่อง "วันที่เข้าเยี่ยม" + ช่อง "ครั้งที่ 2" แบบเดิม (ซึ่งสับสน: ช่องแรกย้ายทั้งคู่
 *  ช่องที่สองย้ายตัวเดียว และช่องแรกโชว์ Day ผิดเมื่อข้อมูลไม่ได้เรียง)
 *
 *  ป้าย [F1] [F2] [+]  →  ช่อง Visit 1 … Visit 5 แต่ละช่องคือ 1 ตลาด (Day) เปลี่ยนแยกกันอิสระ
 *    F1 = เหลือ Visit 1 · F2 = Visit 1 + Visit 2 (ตั้งต้นห่างครึ่งรอบ) · + = เพิ่มอีกช่อง (สูงสุด 5)
 *
 *  ใช้ 2 ที่
 *    1) popup หมุด — แก้ร้านเดียว มีผลทันที
 *    2) แถบจัดลงวัน (แท็บ 2 และหัวรายการรอจัดวัน) — ใช้กับร้านที่เลือกไว้ทุกร้าน
 *       แทนที่วันเดิม = ร้านอยู่ตาม Visit ที่เลือกพอดี · เพิ่มจากวันเดิม = Day เดิมยังอยู่ + เพิ่ม Day ใหม่
 *
 *  ช่องที่แยกด้วย ✂️ (ครั้งที่ 2 ของตลาดรอบสั้น ฯลฯ) ไม่อยู่ในช่อง Visit — จัดการที่หน้าต่างครั้งเข้าเยี่ยม
 *  ร้านใหม่ที่ Day ไปเพิ่ม แทรกลำดับคิวจุดที่อ้อมน้อยที่สุดให้เอง (SeqTool.reflow)
 * ========================================================================== */
(function () {
    'use strict';

    const MAX = 5;
    const UNASSIGNED = 'รอจัดสาย';
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nDay = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const sortD = (a) => [...new Set(a || [])].sort((x, y) => nDay(x) - nDay(y));
    const D = (d) => 'D' + nDay(d);
    const R = () => (State.db && State.db.routes) || {};

    const cycleOf = (rt) => {
        try { if (typeof Freq !== 'undefined' && Freq._cycleOf) return Freq._cycleOf(rt) || 24; } catch (e) {}
        return parseInt(State.db.cycleDays, 10) || 24;
    };
    const pairOf = (day, rt) => {
        try { if (typeof Freq !== 'undefined' && Freq._pairOf) { const p = Freq._pairOf(day, rt); if (p) return p; } } catch (e) {}
        const k = cycleOf(rt), h = Math.ceil(k / 2), n = nDay(day);
        const p = n <= h ? n + h : n - h;
        return (p >= 1 && p <= k && p !== n) ? 'Day ' + p : null;
    };
    const detached = (rt, d) => { try { return typeof Runs !== 'undefined' && Runs.isDetached && Runs.isDetached(rt, d); } catch (e) { return false; } };
    const baseDays = (s, rt) => sortD((s.days || []).filter(d => !detached(rt, d)));
    const find = (id) => {
        for (const rt of Object.keys(R())) {
            const s = (R()[rt] || []).find(x => x && String(x.id) === String(id));
            if (s) return { rt, s };
        }
        return null;
    };
    const dayOpts = (k) => Array.from({ length: k }, (_, i) => 'Day ' + (i + 1));

    // ── แก้ Day ของร้าน (ยังไม่บันทึก) ─────────────────────────────────────
    /** newBase = Day ปกติที่ต้องการ (ไม่รวมช่อง ✂️) · ช่อง ✂️ ที่ที่มายังอยู่ใน newBase ถูกเก็บไว้ */
    const setDays = (s, rt, newBase) => {
        const base = sortD(newBase);
        const keepDet = (s.days || []).filter(d => {
            if (!detached(rt, d)) return false;
            const m = (s.runOf || {})[d];
            return !m || !m.src || base.includes(m.src);
        });
        const next = sortD(base.concat(keepDet));
        const old = s.days || [];
        const gone = old.filter(d => !next.includes(d));
        const added = next.filter(d => !old.includes(d));
        if (!gone.length && !added.length) return null;
        gone.forEach(d => {
            ['seqs', 'cys', 'fqs'].forEach(k => { if (s[k]) delete s[k][d]; });
            if (s.runOf) { delete s.runOf[d]; if (!Object.keys(s.runOf).length) delete s.runOf; }
        });
        if (!s.seqs) s.seqs = {};
        if (!s.cys) s.cys = {};
        added.forEach(d => {
            delete s.seqs[d];
            // CY ของช่องนั้น = CY ที่ร้านอื่นในตลาดเดียวกันใช้อยู่
            const o = (R()[rt] || []).find(x => x !== s && !x.inactive && (x.days || []).includes(d) && x.cys && x.cys[d]);
            if (o) s.cys[d] = o.cys[d];
        });
        s.days = next; s.cy = '';
        s.freq = base.length > 1 ? 2 : 1;
        if (base.length === 2 && pairOf(base[0], rt) !== base[1]) s.f2custom = true; else delete s.f2custom;
        return { gone, added };
    };
    /** ไล่เลขคิว: ตลาดที่ร้านออกไป = เรียงเลขใหม่ · ตลาดที่ร้านเพิ่มเข้า = แทรกจุดที่อ้อมน้อยสุด */
    const reseq = (rt, gone, added) => {
        try {
            if (typeof SeqTool === 'undefined') return;
            [...new Set(gone)].forEach(d => { try { SeqTool.compact(d, rt); } catch (e) {} });
            if (added.length) SeqTool.reflow([...new Set(added)], rt);
        } catch (e) { console.warn('[Visits.reseq]', e); }
    };
    const save = async (routes, label) => {
        const ym = App._currentPlanYM;
        try { if (typeof Runs !== 'undefined' && Runs.bump) Runs.bump(); } catch (e) {}
        await Promise.all([...routes].filter(r => Array.isArray(R()[r])).map(r => App.planRoutesCol(ym).doc(r).set({
            stores: R()[r],
            confirmedBy: firebase.firestore.FieldValue.delete(),
            confirmedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true })));
        try { if (window.EditHistory && EditHistory.mark) EditHistory.mark(label); } catch (e) {}
        try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
        UI.render();
    };

    // ══ 1) popup หมุด ══════════════════════════════════════════════════════
    const chip = (on, txt, js, tip, dis) => `<button ${dis ? 'disabled' : ''} onclick="${js}" title="${esc(tip || '')}"
        style="flex:1;padding:4px 0;border-radius:6px;font-size:11px;font-weight:800;border:1px solid ${on ? '#ef4444' : '#e5e7eb'};
               background:${on ? '#ef4444' : '#fff'};color:${on ? '#fff' : (dis ? '#d1d5db' : '#4b5563')};cursor:${dis ? 'not-allowed' : 'pointer'}">${txt}</button>`;
    const rowSel = (label, cur, opts, onchange, del) => `
        <div style="display:flex;align-items:center;gap:4px;margin-top:4px">
          <span style="width:46px;font-size:10px;font-weight:800;color:#6b7280">${label}</span>
          <select onchange="${onchange}" style="flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:3px 4px;font-size:12px">
            ${cur ? '' : '<option value="">— เลือก Day —</option>'}
            ${opts.map(d => `<option value="${d}" ${d === cur ? 'selected' : ''}>${D(d)}</option>`).join('')}
          </select>
          ${del ? `<button onclick="${del}" title="เอาครั้งนี้ออก" style="width:22px;height:22px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-weight:900;font-size:11px">✕</button>` : '<span style="width:22px"></span>'}
        </div>`;

    const popupHTML = (s) => {
        const f = find(s.id);
        if (!f) return '';
        const { rt } = f;
        if (rt === UNASSIGNED || s.inactive) return `<div data-visits class="text-[10px] text-gray-400 mb-1.5">ร้านยังไม่มีสาย — ย้ายเข้าสายก่อน แล้วค่อยเลือก Day</div>`;
        const k = cycleOf(rt);
        const days = baseDays(s, rt);
        const opts = dayOpts(k);
        const n = days.length;
        const det = (s.days || []).filter(d => detached(rt, d));
        const id = esc(s.id);
        const gap = n === 2 ? (pairOf(days[0], rt) === days[1] ? 'ห่างครึ่งรอบ' : `กำหนดเอง ห่าง ${nDay(days[1]) - nDay(days[0])} ตลาด`) : '';
        const rows = (n ? days : ['']).map((d, i) => rowSel('Visit ' + (i + 1), d, opts.filter(o => o === d || !days.includes(o)),
            `Visits.pSet('${id}',${i},this.value)`, i > 0 ? `Visits.pDel('${id}',${i})` : ''));
        return `
          <div data-visits style="margin-bottom:6px">
            <div style="display:flex;align-items:baseline;gap:4px">
              <span style="font-size:10px;font-weight:800;color:#9ca3af">ครั้งเข้าเยี่ยม</span>
              <span style="font-size:10px;color:#6b7280">${n ? `· ${n} ครั้ง/รอบ${gap ? ' · ' + gap : ''}` : '· ยังไม่จัดวัน'}</span>
            </div>
            <div style="display:flex;gap:4px;margin-top:2px">
              ${chip(n === 1, 'F1', `Visits.pF(\'${id}\',1)`, 'เข้าเดือนละครั้ง — เหลือ Visit 1', !n)}
              ${chip(n === 2, 'F2', `Visits.pF(\'${id}\',2)`, 'เข้า 2 ครั้ง — Visit 2 ตั้งต้นห่างครึ่งรอบ', !n)}
              ${chip(n > 2, n > 2 ? '+' + (n - 2) : '+', `Visits.pPlus(\'${id}\')`, 'เพิ่มครั้งเข้าเยี่ยม (สูงสุด 5)', !n || n >= MAX)}
            </div>
            <div data-vrows="${id}">${rows.join('')}</div>
            ${det.length ? `<div style="font-size:9.5px;color:#b45309;margin-top:3px">+ ครั้งที่แยกด้วย ✂️: ${det.map(d => esc((typeof Runs !== 'undefined' && Runs.tagOf && Runs.tagOf(rt, d)) || D(d))).join(' · ')}</div>` : ''}
          </div>`;
    };

    const reopen = (s) => {
        try {
            if (typeof MultiRoute !== 'undefined' && MultiRoute.popup && isFinite(+s.lat) && isFinite(+s.lng))
                MultiRoute.popup(s, [+s.lat, +s.lng]);
        } catch (e) {}
    };
    const applyOne = async (id, next, label) => {
        const f = find(id);
        if (!f) return;
        const { rt, s } = f;
        const r = setDays(s, rt, next);
        if (!r) return reopen(s);
        reseq(rt, r.gone, r.added);
        await save(new Set([rt]), label);
        UI.showSaveToast(`📅 ${s.name} → ${baseDays(s, rt).map(D).join(' · ') || 'ยังไม่จัดวัน'}`);
        reopen(s);
    };

    const P = {
        pF(id, want) {
            const f = find(id); if (!f) return;
            const days = baseDays(f.s, f.rt);
            if (!days.length) return;
            if (want === 1) {
                if (days.length === 1) return;
                const go = () => applyOne(id, [days[0]], 'ครั้งเข้าเยี่ยม → F1');
                if (days.length > 2) return UI.showConfirm(`เหลือ Visit 1 (${D(days[0])}) อย่างเดียว\n${days.slice(1).map(D).join(' · ')} จะถูกเอาออก`, go);
                return go();
            }
            if (days.length === 2) return;
            if (days.length > 2) return UI.showConfirm(`เหลือ 2 ครั้ง (${D(days[0])} · ${D(days[1])})\n${days.slice(2).map(D).join(' · ')} จะถูกเอาออก`,
                () => applyOne(id, days.slice(0, 2), 'ครั้งเข้าเยี่ยม → F2'));
            const p = pairOf(days[0], f.rt);
            if (!p) return UI.showErrorToast('⚠️ หา Day คู่ไม่ได้ — กด + แล้วเลือกเอง');
            return applyOne(id, [days[0], p], 'ครั้งเข้าเยี่ยม → F2');
        },
        /** + = เพิ่มช่องว่างให้เลือก Day (ยังไม่บันทึกจนกว่าจะเลือก) */
        pPlus(id) {
            const f = find(id); if (!f) return;
            const days = baseDays(f.s, f.rt);
            if (!days.length || days.length >= MAX) return;
            const host = document.querySelector(`[data-vrows="${CSS.escape(String(id))}"]`);
            if (!host || host.querySelector('[data-vnew]')) return;
            const opts = dayOpts(cycleOf(f.rt)).filter(o => !days.includes(o));
            host.insertAdjacentHTML('beforeend', `<div data-vnew>${rowSel('Visit ' + (days.length + 1), '', opts,
                `Visits.pAdd('${esc(id)}',this.value)`, `this.closest('[data-vnew]').remove()`)}</div>`);
        },
        pAdd(id, v) {
            const f = find(id); if (!f || !v) return;
            const days = baseDays(f.s, f.rt);
            if (days.includes(v)) return UI.showErrorToast(`⚠️ ร้านนี้อยู่ ${D(v)} อยู่แล้ว`);
            applyOne(id, days.concat([v]), 'เพิ่มครั้งเข้าเยี่ยม ' + D(v));
        },
        pSet(id, i, v) {
            const f = find(id); if (!f || !v) return;
            const days = baseDays(f.s, f.rt);
            if (!days.length) return applyOne(id, [v], 'จัดลงวัน ' + D(v));
            if (days.includes(v) && days[i] !== v) return UI.showErrorToast(`⚠️ ร้านนี้อยู่ ${D(v)} อยู่แล้ว`);
            const next = days.slice(); next[i] = v;
            applyOne(id, next, `Visit ${i + 1} → ${D(v)}`);
        },
        pDel(id, i) {
            const f = find(id); if (!f) return;
            const days = baseDays(f.s, f.rt);
            if (days.length < 2 || i < 1) return;
            applyOne(id, days.filter((_, j) => j !== i), 'เอาครั้งเข้าเยี่ยมออก ' + D(days[i]));
        },
    };

    // ══ 2) แถบจัดลงวัน (ร้านที่เลือกไว้) ═══════════════════════════════════
    const bars = {};          // key -> { v:[Day..], mode }
    const stateOf = (key) => bars[key] || (bars[key] = { v: ['Day 1'], mode: 'replace' });
    const maxCycle = () => {
        const rts = (typeof MultiRoute !== 'undefined' && MultiRoute.open && MultiRoute.open.length) ? MultiRoute.open : [State.localActiveRoute];
        return Math.max(...rts.filter(r => r && r !== UNASSIGNED).map(cycleOf), 0) || cycleOf(State.localActiveRoute);
    };
    const picked = () => (State.stores || []).filter(s => s.selected && !s.inactive);

    const barHTML = (key) => {
        const st = stateOf(key);
        const k = maxCycle();
        const opts = dayOpts(k);
        st.v = st.v.filter(d => nDay(d) <= k);
        if (!st.v.length) st.v = ['Day 1'];
        const n = st.v.length;
        const sel = picked().length;
        const kk = esc(key);
        const rows = st.v.map((d, i) => rowSel('Visit ' + (i + 1), d, opts.filter(o => o === d || !st.v.includes(o)),
            `Visits.bSet('${kk}',${i},this.value)`, i > 0 ? `Visits.bDel('${kk}',${i})` : ''));
        const radio = (m, txt, tip) => `<label title="${esc(tip)}" style="display:flex;align-items:center;gap:3px;font-size:10.5px;font-weight:700;color:${st.mode === m ? '#3730a3' : '#6b7280'};cursor:pointer">
            <input type="radio" name="vmode-${kk}" ${st.mode === m ? 'checked' : ''} onchange="Visits.bMode('${kk}','${m}')"> ${txt}</label>`;
        return `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="font-size:11px;font-weight:900;color:#312e81">📅 จัดลงวัน</span>
            <span style="font-size:10.5px;color:${sel ? '#4338ca' : '#9ca3af'};font-weight:700">${sel ? `ร้านที่เลือก ${sel.toLocaleString()} ร้าน` : 'ยังไม่ได้เลือกร้าน'}</span>
            <span style="margin-left:auto;font-size:10px;color:#6b7280">${n} ครั้ง/รอบ</span>
          </div>
          <div style="display:flex;gap:4px">
            ${chip(n === 1, 'F1', `Visits.bF('${kk}',1)`, 'Visit 1 อย่างเดียว')}
            ${chip(n === 2, 'F2', `Visits.bF('${kk}',2)`, 'Visit 2 ตั้งต้นห่างครึ่งรอบ')}
            ${chip(n > 2, n > 2 ? '+' + (n - 2) : '+', `Visits.bPlus('${kk}')`, 'เพิ่มครั้งเข้าเยี่ยม (สูงสุด 5)', n >= MAX)}
          </div>
          ${rows.join('')}
          <div style="display:flex;gap:10px;margin-top:6px">
            ${radio('replace', 'แทนที่วันเดิม', 'ร้านที่เลือกจะอยู่ตาม Visit ด้านบนพอดี — Day เดิมหาย')}
            ${radio('add', 'เพิ่มจากวันเดิม', 'Day เดิมยังอยู่ + เพิ่ม Day ด้านบนเข้าไป')}
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button onclick="Visits.bApply('${kk}')" ${sel ? '' : 'disabled'}
              style="flex:1;padding:7px 0;border-radius:10px;font-size:12.5px;font-weight:800;color:#fff;background:${sel ? '#4f46e5' : '#c7d2fe'};border:none;cursor:${sel ? 'pointer' : 'not-allowed'}">
              จัดลงวัน${sel ? ` (${sel.toLocaleString()})` : ''}</button>
            <button onclick="Unassign.open()" title="ถอดวัน / ถอดออกจากสาย / Remove — เฉพาะร้านที่เลือก"
              style="padding:7px 10px;border-radius:10px;font-size:12px;font-weight:800;color:#dc2626;background:#fef2f2;border:1px solid #fecaca">⛔ Unassign</button>
          </div>`;
    };
    const paintBars = () => {
        // แท็บ 2: แทนแถว "ช่องเลือกวัน + จัดลงวัน" เดิม (ซ่อนไว้ ไม่ลบ — โค้ดอื่นยังอ่านค่าอยู่)
        const ad = $('assign-day');
        if (ad) {
            const row = ad.parentElement;
            if (row && !row.dataset.vHidden) { row.dataset.vHidden = '1'; row.style.display = 'none'; }
            let b = $('vbar-tab2');
            if (!b && row) {
                b = document.createElement('div');
                b.id = 'vbar-tab2';
                b.className = 'sticky top-0 z-10 bg-white border border-indigo-200 rounded-xl p-2 shadow-sm mt-2';
                row.insertAdjacentElement('afterend', b);
            }
            // แถบนี้ต้องอยู่บนสุดของแท็บ 2 เสมอ (กล่องแบ่งกลุ่มแทรกตัวเองต่อจากแถวเดิมทีหลัง)
            if (b && row && row.nextElementSibling !== b) row.insertAdjacentElement('afterend', b);
            if (b && !b.contains(document.activeElement)) b.innerHTML = barHTML('tab2');
        }
        // หัวรายการรอจัดวัน (แท็บ 1)
        const pw = $('pane-wait'), lu = $('list-unassigned');
        if (pw && lu) {
            let b = $('vbar-wait');
            const has = [...lu.querySelectorAll('label')].some(l => /ID:/.test(l.textContent));
            if (!b) {
                b = document.createElement('div');
                b.id = 'vbar-wait';
                b.className = 'bg-white border border-amber-200 rounded-xl p-2 shadow-sm mb-2';
                pw.insertBefore(b, lu);
            }
            b.style.display = has ? '' : 'none';
            if (has && !b.contains(document.activeElement)) b.innerHTML = barHTML('wait');
        }
    };
    const rebar = () => { const keep = document.activeElement; if (keep && keep.blur) keep.blur(); paintBars(); };

    const B = {
        bF(key, want) {
            const st = stateOf(key);
            if (want === 1) st.v = st.v.slice(0, 1);
            else {
                const first = st.v[0] || 'Day 1';
                const second = st.v[1] || pairOf(first, State.localActiveRoute) || ('Day ' + Math.min(maxCycle(), nDay(first) + Math.ceil(maxCycle() / 2)));
                st.v = [first, second];
            }
            rebar();
        },
        bPlus(key) {
            const st = stateOf(key);
            if (st.v.length >= MAX) return;
            const free = dayOpts(maxCycle()).filter(d => !st.v.includes(d));
            if (free.length) st.v.push(free[0]);
            rebar();
        },
        bSet(key, i, v) {
            const st = stateOf(key);
            if (st.v.includes(v) && st.v[i] !== v) { UI.showErrorToast(`⚠️ ${D(v)} อยู่ใน Visit อื่นแล้ว`); return rebar(); }
            st.v[i] = v; rebar();
        },
        bDel(key, i) { const st = stateOf(key); if (i > 0) st.v.splice(i, 1); rebar(); },
        bMode(key, m) { stateOf(key).mode = m; rebar(); },
        async bApply(key) {
            const st = stateOf(key);
            const want = sortD(st.v);
            const list = picked();
            if (!list.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกร้าน — ติ๊กร้าน / แตะหมุด / วาดพื้นที่ก่อน');
            const skip = list.filter(s => (find(s.id) || {}).rt === UNASSIGNED);
            const work = list.filter(s => !skip.includes(s));
            if (!work.length) return UI.showErrorToast('⚠️ ร้านที่เลือกอยู่ในกองรอจัดสาย — ย้ายเข้าสายก่อน');
            const lose = st.mode === 'replace'
                ? work.filter(s => { const f = find(s.id); return f && baseDays(s, f.rt).filter(d => !want.includes(d)).length && baseDays(s, f.rt).length >= 3; })
                : [];
            const run = async () => {
                const touched = new Set(), gone = {}, added = {};
                let n = 0;
                work.forEach(s => {
                    const f = find(s.id); if (!f) return;
                    const cur = baseDays(s, f.rt);
                    const k = cycleOf(f.rt);
                    const ok = want.filter(d => nDay(d) <= k);
                    const next = st.mode === 'replace' ? ok : sortD(cur.concat(ok));
                    if (!next.length) return;
                    const r = setDays(s, f.rt, next);
                    s.selected = false;
                    if (!r) return;
                    n++; touched.add(f.rt);
                    (gone[f.rt] = gone[f.rt] || []).push(...r.gone);
                    (added[f.rt] = added[f.rt] || []).push(...r.added);
                });
                touched.forEach(rt => reseq(rt, gone[rt] || [], added[rt] || []));
                UI.showLoader('📅 กำลังจัดลงวัน...', `${n} ร้าน`);
                try { await save(touched, (st.mode === 'replace' ? 'จัดลงวัน ' : 'เพิ่มวัน ') + want.map(D).join('·')); }
                catch (e) { UI.hideLoader(); return UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message)); }
                UI.hideLoader();
                UI.showSaveToast(`📅 ${st.mode === 'replace' ? 'จัดลงวัน' : 'เพิ่มวัน'} ${want.map(D).join(' · ')} — ${n.toLocaleString()} ร้าน`
                    + (skip.length ? ` · ข้าม ${skip.length} ร้านในกองรอจัดสาย` : '') + ' · ย้อนกลับได้ (Ctrl+Z)');
            };
            if (lose.length) return UI.showConfirm(
                `มี ${lose.length} ร้านที่อยู่ 3 ตลาดขึ้นไป — "แทนที่วันเดิม" จะเหลือแค่ ${want.map(D).join(' · ')}\n`
                + lose.slice(0, 5).map(s => '• ' + esc(s.name)).join('\n') + (lose.length > 5 ? '\n…' : '')
                + '\n\nถ้าจะเก็บตลาดเดิมไว้ ให้เลือก "เพิ่มจากวันเดิม" แทน', run);
            return run();
        },
    };

    window.Visits = Object.assign({ popupHTML, setDays, barHTML, paintBars, _find: find, _baseDays: baseDays }, P, B);

    // ── ต่อเข้ากับของเดิม ──────────────────────────────────────────────────
    const boot = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof State === 'undefined') return setTimeout(boot, 400);
        if (UI._visitsWired) return;
        UI._visitsWired = true;
        const orig = UI.render;
        UI.render = function () { const r = orig.apply(this, arguments); try { paintBars(); } catch (e) { console.warn('[Visits.bar]', e); } return r; };
        // ติ๊กร้านในรายการรอจัดวัน = เลือกอยู่ที่เดิม ไม่เด้งไปแท็บ 2 (แถบจัดลงวันอยู่บนหัวรายการแล้ว)
        if (typeof StoreMgr !== 'undefined') StoreMgr.toggleStay = (id) => {
            const s = (State.stores || []).find(x => String(x.id) === String(id));
            if (s) { s.selected = !s.selected; UI.render(); }
        };
        paintBars();
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1300));
})();

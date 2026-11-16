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
    /** V1.0.3: ตลาดที่ "วิ่งได้" ในเดือนนี้ตามปฏิทินของสาย (ไม่มีวันวิ่ง = ไม่ให้เลือก) — keep = ค่าที่ร้านใช้อยู่ ให้ยังเห็น */
    const availOpts = (rt, k, keep) => dayOpts(k).filter(d => {
        if ((keep || []).includes(d)) return true;
        try { return !rt || typeof Runs === 'undefined' || !Runs.potential || Runs.potential(rt, d).length > 0; } catch (e) { return true; }
    });

    // ══ V1.0.1 (K1): สายรอบสั้น (เช่น 12 ตลาด — 1 ตลาดวิ่ง 2 รอบต่อเดือน) เลือก "ครั้งเข้าเยี่ยม" ตามวันที่ ══
    //   F1 = เข้า 1 ครั้ง/เดือน · F2 = 2 ครั้ง · + = เพิ่ม — ตัวเลือก 1 รายการ = 1 วันที่ (เช่น "อ. 17 พ.ย. · D2")
    //   หน้าจอมีแค่ D1–D12 · ครั้งที่ร้านไม่เหมือนรอบอื่นของตลาด เก็บเป็นช่องแยกภายใน (ส่งออก DMS เป็น CY แยก)
    const RX_OCC = /^Day (\d+)@(\d+)$/;
    const occId = (m, k) => 'Day ' + m + '@' + k;
    const isShort = (rt) => { try { return !!(rt && rt !== UNASSIGNED && typeof Runs !== 'undefined' && Runs.isShort && Runs.isShort(rt)); } catch (e) { return false; } };
    const memo0 = () => { try { if (Runs._memoClear) Runs._memoClear(); } catch (e) {} };
    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const WDS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const dTxt = (d) => d ? WDS[d.getDay()] + ' ' + d.getDate() + ' ' + TH[d.getMonth()] : 'ไม่วิ่งเดือนนี้';
    /** ทุกครั้งเข้าเยี่ยมของสายในเดือนนี้ เรียงตามวันที่ — {id:'Day 2@2', day:'Day 2', m, k, slot, det, date} */
    const occList = (rt) => {
        const out = [];
        let c = 0;
        try { c = Runs.cycleOf(rt); } catch (e) { c = cycleOf(rt); }
        for (let m = 1; m <= c; m++) {
            const day = 'Day ' + m;
            let pot = [];
            try { pot = Runs.potential(rt, day); } catch (e) {}
            let use = pot;
            try { if (Runs.fqOf(rt, day) === 'F1' && pot.length) { const o = Runs.onceRun(rt, day, pot); use = o ? [o] : []; } } catch (e) {}
            use.forEach(p => {
                let date = p.date;
                if (p.to) { try { date = Runs.metaDate(rt, p.to); } catch (e) { date = null; } }
                if (!date) return;                          // V1.0.3: ครั้งที่ตรงวันหยุด (ตรึง) ไม่มีให้เลือก
                out.push({ id: occId(m, p.k), day, m, k: p.k, slot: p.to || day, det: !!p.to, date });
            });
        }
        // V1.0.4: ตลาดของวันว่าง (สร้างจากช่อง Visit) — ช่องที่ชี้กลับมาที่ตัวเอง
        try {
            Runs.daysOf(rt).forEach(slot => {
                if (!Runs.isStandalone || !Runs.isStandalone(rt, slot)) return;
                const date = Runs.metaDate(rt, slot);
                if (date) out.push({ id: occId(nDay(slot), 1), day: slot, m: nDay(slot), k: 1, slot, det: true, date });
            });
        } catch (e) {}
        out.sort((a, b) => ((a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity)) || (a.m - b.m) || (a.k - b.k));
        return out;
    };
    const occLabel = (o) => o.empty ? `${dTxt(o.date)} · ว่าง — ยังไม่มีตลาด` : `${dTxt(o.date)} · D${o.m}`;
    /** V1.0.4: วันทำงานที่ว่าง (ยังไม่มีตลาด) เป็นตัวเลือกในช่อง Visit — id "new@yyyy-mm-dd" */
    const RX_NEW = /^new@(\d{4}-\d{2}-\d{2})$/;
    const emptyOpts = (rt) => {
        try { return Runs.emptyDates(rt).map(d => ({ id: 'new@' + Runs._iso(d), date: d, empty: true, m: 0, k: 0 })); } catch (e) { return []; }
    };
    const withEmpty = (L, rt) => L.concat(emptyOpts(rt)).sort((a, b) => ((a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity)) || ((a.empty ? 1 : 0) - (b.empty ? 1 : 0)));
    /** ครั้งเข้าเยี่ยมของร้านตอนนี้ (id เรียงตามวันที่) */
    const occOf = (s, rt, L) => {
        L = L || occList(rt);
        const ids = new Set();
        (s.days || []).forEach(d => {
            let mt = null;
            try { mt = Runs.metaOf(rt, d); } catch (e) {}
            if (mt && mt.src) { ids.add(occId(nDay(mt.src), mt.run)); return; }
            L.filter(o => o.slot === d && !o.det).forEach(o => ids.add(o.id));
        });
        return L.filter(o => ids.has(o.id)).map(o => o.id);
    };
    /** ตั้งช่องวันของร้านตรง ๆ (รวมช่องแยก) — คืน {gone, added} หรือ null */
    const setSlots = (s, rt, nextArr) => {
        const next = sortD(nextArr);
        const old = s.days || [];
        const gone = old.filter(d => !next.includes(d));
        const added = next.filter(d => !old.includes(d));
        if (!gone.length && !added.length) return null;
        gone.forEach(d => {
            ['seqs', 'cys', 'fqs', 'fqRun', 'vd'].forEach(k => { if (s[k]) delete s[k][d]; });
            if (s.runOf) { delete s.runOf[d]; if (!Object.keys(s.runOf).length) delete s.runOf; }
        });
        if (!s.seqs) s.seqs = {};
        if (!s.cys) s.cys = {};
        added.forEach(d => {
            delete s.seqs[d];
            const o = (R()[rt] || []).find(x => x !== s && !x.inactive && (x.days || []).includes(d));
            if (o && o.cys && o.cys[d]) s.cys[d] = o.cys[d];
            // ช่องแยก (รอบอื่นของตลาดหลัก) — ร้านที่เข้ามาใหม่ต้องรู้ที่มาเหมือนร้านอื่นในช่องนั้น
            if (o && o.runOf && o.runOf[d]) {
                if (!s.runOf) s.runOf = {};
                s.runOf[d] = Object.assign({}, o.runOf[d]);
                if (!s.fqs) s.fqs = {};
                s.fqs[d] = 'F1';
            }
            // ตลาดที่วิ่งครั้งเดียว — ร้านใหม่ใช้ความถี่/ครั้งเดียวกับร้านอื่นในตลาด
            if (o && o.fqs && o.fqs[d] && !(o.runOf && o.runOf[d])) { if (!s.fqs) s.fqs = {}; s.fqs[d] = o.fqs[d]; }
            if (o && o.fqRun && o.fqRun[d]) { if (!s.fqRun) s.fqRun = {}; s.fqRun[d] = o.fqRun[d]; }
        });
        s.days = next; s.cy = '';
        s.freq = next.length > 1 ? 2 : 1;
        delete s.f2custom;
        memo0();
        return { gone, added };
    };
    /**
     * ให้ร้านเข้าเยี่ยมตาม "ครั้ง" ที่เลือกพอดี (W = รายการ id)
     *   ตลาดที่ร้านเลือกบางรอบ (เช่น D2 แค่รอบ 1) → แยกรอบที่ไม่เลือกเป็นช่องของตัวเอง ร้านอื่นในตลาดยังวิ่งครบทุกรอบ
     *   ร้านอยู่ตลาดนั้นคนเดียว → ตั้งตลาดเป็น "วิ่งครั้งเดียว" ที่รอบที่เลือก (ไม่ต้องแยกช่อง)
     * คืน {gone:[], added:[]}
     */
    const applyOcc = (s, rt, W) => {
        const want = new Set(W);
        let L = occList(rt);
        const occSlots = new Set(L.map(o => o.slot));
        const keep = (s.days || []).filter(d => { let mt = null; try { mt = Runs.metaOf(rt, d); } catch (e) {} return !mt && !occSlots.has(d); });
        const next = new Set(keep);
        const plans = [];
        const byM = new Map();
        L.forEach(o => { if (!byM.has(o.m)) byM.set(o.m, []); byM.get(o.m).push(o); });
        byM.forEach((occs, m) => {
            const day = 'Day ' + m;
            occs.filter(o => o.det && want.has(o.id)).forEach(o => next.add(o.slot));
            const A = occs.filter(o => !o.det);
            const C = A.filter(o => want.has(o.id));
            if (!C.length) return;
            next.add(day);
            if (C.length < A.length) plans.push({ day, keepK: C.map(o => o.k), drop: A.filter(o => !want.has(o.id)).map(o => o.k) });
        });
        const gone = [], added = [];
        const r = setSlots(s, rt, [...next]);
        if (r) { gone.push(...r.gone); added.push(...r.added); }
        plans.forEach(pl => {
            const others = (R()[rt] || []).filter(x => x !== s && !x.inactive && (x.days || []).includes(pl.day));
            if (!others.length) {
                // อยู่คนเดียวในตลาด → ตลาดวิ่งครั้งเดียว (รอบที่เลือก)
                if (!s.fqs) s.fqs = {};
                if (!s.fqRun) s.fqRun = {};
                s.fqs[pl.day] = 'F1'; s.fqRun[pl.day] = pl.keepK[0];
                memo0();
                return;
            }
            pl.drop.forEach(k => {
                const sp = Runs.splitRun(rt, pl.day, k);
                memo0();
                if (sp && sp.slot && (s.days || []).includes(sp.slot)) {
                    const r2 = setSlots(s, rt, s.days.filter(d => d !== sp.slot));
                    if (r2) gone.push(...r2.gone);
                }
            });
        });
        // ร้านเลือกครบทุกรอบของตลาดที่เคยตั้ง "วิ่งครั้งเดียว" ไว้คนเดียว → กลับเป็นวิ่งทุกรอบ
        byM.forEach((occs, m) => {
            const day = 'Day ' + m;
            if (!(s.days || []).includes(day) || !(s.fqRun && s.fqRun[day])) return;
            const others = (R()[rt] || []).filter(x => x !== s && !x.inactive && (x.days || []).includes(day));
            let pot = [];
            try { pot = Runs.potential(rt, day).filter(p => !p.to); } catch (e) {}
            const wantAll = pot.length > 1 && pot.every(p => want.has(occId(m, p.k)));
            if (!others.length && wantAll) { delete s.fqRun[day]; if (s.fqs) delete s.fqs[day]; memo0(); }
        });
        try { Runs.bump(); } catch (e) {}
        return { gone, added };
    };
    const occTxt = (s, rt) => { const L = occList(rt); const ids = occOf(s, rt, L); return ids.map(id => occLabel(L.find(o => o.id === id))).join(' · '); };
    const rowSelO = (label, cur, opts, onchange, del) => `
        <div style="display:flex;align-items:center;gap:4px;margin-top:4px">
          <span style="width:46px;font-size:10px;font-weight:800;color:#6b7280">${label}</span>
          <select onchange="${onchange}" style="flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:3px 4px;font-size:12px">
            ${cur ? '' : '<option value="">— เลือกวันที่ —</option>'}
            ${opts.map(o => `<option value="${o.id}" ${o.id === cur ? 'selected' : ''}>${esc(occLabel(o))}</option>`).join('')}
          </select>
          ${del ? `<button onclick="${del}" title="เอาครั้งนี้ออก" style="width:22px;height:22px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-weight:900;font-size:11px">✕</button>` : '<span style="width:22px"></span>'}
        </div>`;
    /** ครั้งที่ 2 ที่ควรเป็นคู่ของครั้งแรก: รอบถัดไปของตลาดเดียวกัน › วันที่ห่าง ~ครึ่งเดือน */
    const pairOcc = (L, first, taken) => {
        const o1 = L.find(o => o.id === first);
        if (!o1) return null;
        const same = L.filter(o => o.m === o1.m && o.id !== first && !taken.includes(o.id));
        if (same.length) return same[0].id;
        const t = o1.date ? o1.date.getTime() + 14 * 864e5 : 0;
        const rest = L.filter(o => o.id !== first && !taken.includes(o.id) && o.date);
        rest.sort((a, b) => Math.abs(a.date.getTime() - t) - Math.abs(b.date.getTime() - t));
        return rest.length ? rest[0].id : null;
    };

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
    // V0.9.8: ตัวเลือกวัน = วันที่ในเดือนเป็นหลัก "พ. 1 ต.ค. · D1" (rt = สายที่ใช้ดูปฏิทิน)
    const DL = (rt, d) => (rt && typeof DayDate !== 'undefined' && DayDate.opt) ? DayDate.opt(rt, d) : D(d);
    const rowSel = (label, cur, opts, onchange, del, rt) => `
        <div style="display:flex;align-items:center;gap:4px;margin-top:4px">
          <span style="width:46px;font-size:10px;font-weight:800;color:#6b7280">${label}</span>
          <select onchange="${onchange}" style="flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:3px 4px;font-size:12px">
            ${cur ? '' : '<option value="">— เลือก Day —</option>'}
            ${opts.map(d => `<option value="${d}" ${d === cur ? 'selected' : ''}>${esc(DL(rt, d))}</option>`).join('')}
          </select>
          ${del ? `<button onclick="${del}" title="เอาครั้งนี้ออก" style="width:22px;height:22px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-weight:900;font-size:11px">✕</button>` : '<span style="width:22px"></span>'}
        </div>`;

    const popupHTML = (s) => {
        const f = find(s.id);
        if (!f) return '';
        const { rt } = f;
        if (rt === UNASSIGNED || s.inactive) return `<div data-visits class="text-[10px] text-gray-400 mb-1.5">ร้านยังไม่มีสาย — ย้ายเข้าสายก่อน แล้วค่อยเลือก Day</div>`;
        if (isShort(rt)) return popupShort(s, rt);
        const k = cycleOf(rt);
        const days = baseDays(s, rt);
        const opts = availOpts(rt, k, days);
        const n = days.length;
        const det = (s.days || []).filter(d => detached(rt, d));
        const id = esc(s.id);
        const gap = n === 2 ? (pairOf(days[0], rt) === days[1] ? 'ห่างครึ่งรอบ' : `กำหนดเอง ห่าง ${nDay(days[1]) - nDay(days[0])} ตลาด`) : '';
        const rows = (n ? days : ['']).map((d, i) => rowSel('Visit ' + (i + 1), d, opts.filter(o => o === d || !days.includes(o)),
            `Visits.pSet('${id}',${i},this.value)`, i > 0 ? `Visits.pDel('${id}',${i})` : '', rt));
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

    /** V1.0.1: popup หมุด — สายรอบสั้น เลือกเป็นวันที่ */
    const popupShort = (s, rt) => {
        const L = occList(rt);
        const cur = occOf(s, rt, L);
        const n = cur.length;
        const id = esc(s.id);
        const rows = (n ? cur : ['']).map((v, i) => rowSelO('Visit ' + (i + 1), v, L.filter(o => o.id === v || !cur.includes(o.id)),
            `Visits.oSet('${id}',${i},this.value)`, i > 0 ? `Visits.oDel('${id}',${i})` : ''));
        return `
          <div data-visits style="margin-bottom:6px">
            <div style="display:flex;align-items:baseline;gap:4px">
              <span style="font-size:10px;font-weight:800;color:#9ca3af">ครั้งเข้าเยี่ยม</span>
              <span style="font-size:10px;color:#6b7280">${n ? `· ${n} ครั้ง/เดือน` : '· ยังไม่จัดวัน'}</span>
            </div>
            <div style="display:flex;gap:4px;margin-top:2px">
              ${chip(n === 1, 'F1', `Visits.oF(\'${id}\',1)`, 'เข้า 1 ครั้ง/เดือน', !n)}
              ${chip(n === 2, 'F2', `Visits.oF(\'${id}\',2)`, 'เข้า 2 ครั้ง/เดือน — ครั้งที่ 2 ตั้งต้นเป็นรอบถัดไปของตลาดเดียวกัน', !n)}
              ${chip(n > 2, n > 2 ? '+' + (n - 2) : '+', `Visits.oPlus(\'${id}\')`, 'เพิ่มครั้งเข้าเยี่ยม (สูงสุด 5)', !n || n >= MAX)}
            </div>
            <div data-vrows="${id}">${rows.join('')}</div>
          </div>`;
    };
    const applyOccOne = async (id, W, label) => {
        const f = find(id);
        if (!f) return;
        const { rt, s } = f;
        const before = occOf(s, rt).join('|');
        if (before === [...W].join('|')) return reopen(s);
        const r = applyOcc(s, rt, W);
        reseq(rt, r.gone, r.added);
        await save(new Set([rt]), label);
        UI.showSaveToast(`📅 ${s.name} → ${occTxt(s, rt) || 'ยังไม่จัดวัน'}`);
        reopen(s);
    };
    const O = {
        oF(id, want) {
            const f = find(id); if (!f) return;
            const L = occList(f.rt);
            const cur = occOf(f.s, f.rt, L);
            if (!cur.length) return;
            const lab = (v) => occLabel(L.find(o => o.id === v));
            if (want === 1) {
                if (cur.length === 1) return;
                const go = () => applyOccOne(id, [cur[0]], 'ครั้งเข้าเยี่ยม → F1');
                if (cur.length === 2) return go();
                return UI.showConfirm(`เหลือเข้า 1 ครั้ง: ${lab(cur[0])}\nเอาออก: ${cur.slice(1).map(lab).join(' · ')}`, go);
            }
            if (cur.length === 2) return;
            if (cur.length > 2) return UI.showConfirm(`เหลือเข้า 2 ครั้ง: ${cur.slice(0, 2).map(lab).join(' · ')}\nเอาออก: ${cur.slice(2).map(lab).join(' · ')}`,
                () => applyOccOne(id, cur.slice(0, 2), 'ครั้งเข้าเยี่ยม → F2'));
            const p = pairOcc(L, cur[0], cur);
            if (!p) return UI.showErrorToast('⚠️ หาครั้งที่ 2 ไม่ได้ — กด + แล้วเลือกวันที่เอง');
            return applyOccOne(id, [cur[0], p], 'ครั้งเข้าเยี่ยม → F2');
        },
        oPlus(id) {
            const f = find(id); if (!f) return;
            const L = occList(f.rt);
            const cur = occOf(f.s, f.rt, L);
            if (!cur.length || cur.length >= MAX) return;
            const host = document.querySelector(`[data-vrows="${CSS.escape(String(id))}"]`);
            if (!host || host.querySelector('[data-vnew]')) return;
            host.insertAdjacentHTML('beforeend', `<div data-vnew>${rowSelO('Visit ' + (cur.length + 1), '', L.filter(o => !cur.includes(o.id)),
                `Visits.oAdd('${esc(id)}',this.value)`, `this.closest('[data-vnew]').remove()`)}</div>`);
        },
        oAdd(id, v) {
            const f = find(id); if (!f || !v) return;
            const cur = occOf(f.s, f.rt);
            if (cur.includes(v)) return UI.showErrorToast('⚠️ ร้านนี้เข้าวันนั้นอยู่แล้ว');
            applyOccOne(id, cur.concat([v]), 'เพิ่มครั้งเข้าเยี่ยม');
        },
        oSet(id, i, v) {
            const f = find(id); if (!f || !v) return;
            const cur = occOf(f.s, f.rt);
            if (!cur.length) return applyOccOne(id, [v], 'จัดลงวัน');
            if (cur.includes(v) && cur[i] !== v) return UI.showErrorToast('⚠️ ร้านนี้เข้าวันนั้นอยู่แล้ว');
            const next = cur.slice(); next[i] = v;
            applyOccOne(id, next, `Visit ${i + 1} → เปลี่ยนวันที่`);
        },
        oDel(id, i) {
            const f = find(id); if (!f) return;
            const cur = occOf(f.s, f.rt);
            if (cur.length < 2 || i < 1) return;
            applyOccOne(id, cur.filter((_, j) => j !== i), 'เอาครั้งเข้าเยี่ยมออก');
        },
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
            const opts = availOpts(f.rt, cycleOf(f.rt)).filter(o => !days.includes(o));
            host.insertAdjacentHTML('beforeend', `<div data-vnew>${rowSel('Visit ' + (days.length + 1), '', opts,
                `Visits.pAdd('${esc(id)}',this.value)`, `this.closest('[data-vnew]').remove()`, f.rt)}</div>`);
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

    /** สายที่ใช้ดูวันที่ในแถบจัดลงวัน: ร้านที่เลือกอยู่สายเดียว → สายนั้น · ไม่งั้นสายที่กำลังแก้ */
    const barRoute = () => {
        const rs = [...new Set(picked().map(s => (typeof MultiRoute !== 'undefined' && MultiRoute.routeOf) ? MultiRoute.routeOf(s) : s.route).filter(r => r && r !== UNASSIGNED))];
        return rs.length === 1 ? rs[0] : State.localActiveRoute;
    };
    /** V1.0.1: แถบจัดลงวัน — สายรอบสั้น เลือกเป็นวันที่ (ครั้งเข้าเยี่ยม) */
    const barShort = (key) => {
        const st = stateOf(key);
        const brt = barRoute();
        const L = withEmpty(occList(brt), brt);
        st.o = (st.o || []).filter(v => L.some(o => o.id === v));
        if (!st.o.length && L.length) st.o = [(L.find(o => !o.empty) || L[0]).id];
        const n = st.o.length;
        const sel = picked().length;
        const kk = esc(key);
        const nNew = st.o.filter(v => RX_NEW.test(v)).length;
        const rows = st.o.map((v, i) => rowSelO('Visit ' + (i + 1), v, L.filter(o => o.id === v || !st.o.includes(o.id)),
            `Visits.bSet('${kk}',${i},this.value)`, i > 0 ? `Visits.bDel('${kk}',${i})` : ''));
        const radio = (m, txt, tip) => `<label title="${esc(tip)}" style="display:flex;align-items:center;gap:3px;font-size:10.5px;font-weight:700;color:${st.mode === m ? '#3730a3' : '#6b7280'};cursor:pointer">
            <input type="radio" name="vmode-${kk}" ${st.mode === m ? 'checked' : ''} onchange="Visits.bMode('${kk}','${m}')"> ${txt}</label>`;
        return `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="font-size:11px;font-weight:900;color:#312e81">📅 จัดลงวัน</span>
            <span style="font-size:10.5px;color:${sel ? '#4338ca' : '#9ca3af'};font-weight:700">${sel ? `ร้านที่เลือก ${sel.toLocaleString()} ร้าน` : 'ยังไม่ได้เลือกร้าน'}</span>
            <span style="margin-left:auto;font-size:10px;color:#6b7280">${n} ครั้ง/เดือน</span>
          </div>
          <div style="display:flex;gap:4px">
            ${chip(n === 1, 'F1', `Visits.bF('${kk}',1)`, 'เข้า 1 ครั้ง/เดือน')}
            ${chip(n === 2, 'F2', `Visits.bF('${kk}',2)`, 'เข้า 2 ครั้ง/เดือน — ครั้งที่ 2 ตั้งต้นเป็นรอบถัดไปของตลาดเดียวกัน')}
            ${chip(n > 2, n > 2 ? '+' + (n - 2) : '+', `Visits.bPlus('${kk}')`, 'เพิ่มครั้งเข้าเยี่ยม (สูงสุด 5)', n >= MAX)}
          </div>
          ${rows.join('')}
          ${nNew ? `<div style="margin-top:4px;font-size:10.5px;line-height:1.35;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:4px 6px">
            เลือกวันว่าง = ร้านที่เลือกเป็น<b>ตลาดใหม่ของวันนั้น</b> ระบบจะให้ตั้งชื่อตลาด · ส่งออกเป็น CY แบบ 9 ของวันนั้น
            · ถ้าจะให้ตลาดเดิมวิ่งวันนั้น ตั้งที่ปฏิทิน หรือปุ่มวันที่ที่หัวตลาด (แก้ครั้งนี้)</div>` : ''}
          <div style="display:flex;gap:10px;margin-top:6px">
            ${radio('replace', 'แทนที่วันเดิม', 'ร้านที่เลือกจะเข้าตามวันที่ด้านบนพอดี — วันเดิมหาย')}
            ${radio('add', 'เพิ่มจากวันเดิม', 'วันเดิมยังอยู่ + เพิ่มวันที่ด้านบนเข้าไป')}
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button onclick="Visits.bApply('${kk}')" ${sel ? '' : 'disabled'}
              style="flex:1;padding:7px 0;border-radius:10px;font-size:12.5px;font-weight:800;color:#fff;background:${sel ? '#4f46e5' : '#c7d2fe'};border:none;cursor:${sel ? 'pointer' : 'not-allowed'}">
              จัดลงวัน${sel ? ` (${sel.toLocaleString()})` : ''}</button>
            <button onclick="Unassign.open()" title="ถอดวัน / ถอดออกจากสาย / Remove — เฉพาะร้านที่เลือก"
              style="padding:7px 10px;border-radius:10px;font-size:12px;font-weight:800;color:#dc2626;background:#fef2f2;border:1px solid #fecaca">⛔ Unassign</button>
          </div>`;
    };
    const barHTML = (key) => {
        if (isShort(barRoute())) return barShort(key);
        const st = stateOf(key);
        const k = maxCycle();
        const opts = availOpts(barRoute(), k, st.v);
        st.v = st.v.filter(d => nDay(d) <= k);
        if (!st.v.length) st.v = ['Day 1'];
        const n = st.v.length;
        const sel = picked().length;
        const kk = esc(key);
        const rows = st.v.map((d, i) => rowSel('Visit ' + (i + 1), d, opts.filter(o => o === d || !st.v.includes(o)),
            `Visits.bSet('${kk}',${i},this.value)`, i > 0 ? `Visits.bDel('${kk}',${i})` : '', barRoute()));
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
            // V0.9.6: กล่องแบ่งกลุ่มร้านที่เลือก อยู่ใต้แถบนี้เสมอ (ไม่ให้แถบจัดลงวันเด้งขึ้นลงตามความสูงกล่อง)
            const sp = $('split-card');
            if (b && sp && b.nextElementSibling !== sp) b.insertAdjacentElement('afterend', sp);
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
            if (isShort(barRoute())) {
                const L = occList(barRoute());
                st.o = (st.o || []).slice();
                if (want === 1) st.o = st.o.slice(0, 1);
                else if (st.o.length) { const p = st.o[1] || pairOcc(L, st.o[0], st.o); st.o = p ? [st.o[0], p] : st.o.slice(0, 1); }
                return rebar();
            }
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
            if (isShort(barRoute())) {
                st.o = st.o || [];
                if (st.o.length >= MAX) return;
                const free = occList(barRoute()).filter(o => !st.o.includes(o.id));
                if (free.length) st.o.push(free[0].id);
                return rebar();
            }
            if (st.v.length >= MAX) return;
            const free = dayOpts(maxCycle()).filter(d => !st.v.includes(d));
            if (free.length) st.v.push(free[0]);
            rebar();
        },
        bSet(key, i, v) {
            const st = stateOf(key);
            if (RX_OCC.test(v) || RX_NEW.test(v)) {
                st.o = st.o || [];
                if (st.o.includes(v) && st.o[i] !== v) { UI.showErrorToast('⚠️ วันที่นี้อยู่ใน Visit อื่นแล้ว'); return rebar(); }
                st.o[i] = v; return rebar();
            }
            if (st.v.includes(v) && st.v[i] !== v) { UI.showErrorToast(`⚠️ ${D(v)} อยู่ใน Visit อื่นแล้ว`); return rebar(); }
            st.v[i] = v; rebar();
        },
        bDel(key, i) { const st = stateOf(key); if (i > 0) { if (isShort(barRoute())) (st.o || []).splice(i, 1); else st.v.splice(i, 1); } rebar(); },
        bMode(key, m) { stateOf(key).mode = m; rebar(); },
        async bApply(key) {
            const st = stateOf(key);
            const want = sortD(st.v);
            const list = picked();
            if (!list.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกร้าน — ติ๊กร้าน / แตะหมุด / วาดพื้นที่ก่อน');
            const skip = list.filter(s => (find(s.id) || {}).rt === UNASSIGNED);
            const work = list.filter(s => !skip.includes(s));
            if (!work.length) return UI.showErrorToast('⚠️ ร้านที่เลือกอยู่ในกองรอจัดสาย — ย้ายเข้าสายก่อน');
            if (isShort(barRoute())) return B._applyShort(st, work, skip);
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

    /** V1.0.1: จัดลงวันแบบเลือกวันที่ (สายรอบสั้น) */
    B._applyShort = async (st, work, skip) => {
        const brt = barRoute();
        const NW = [...new Set((st.o || []).filter(v => RX_NEW.test(v)))];
        const W0 = (st.o || []).filter(v => !RX_NEW.test(v));
        if (!W0.length && !NW.length) return UI.showErrorToast('⚠️ เลือกวันที่ก่อน');
        const L0 = withEmpty(occList(brt), brt);
        const lab = (st.o || []).map(v => { const o = L0.find(x => x.id === v); return o ? occLabel(o) : v; }).join(' · ');
        const lose = st.mode === 'replace' ? work.filter(s => { const f = find(s.id); if (!f || !isShort(f.rt)) return false; const c = occOf(s, f.rt); return c.length >= 3 && c.some(v => !W0.includes(v)); }) : [];
        const run = async () => {
            const touched = new Set(), gone = {}, added = {};
            let n = 0;
            const push = (rt, r) => { n++; touched.add(rt); (gone[rt] = gone[rt] || []).push(...r.gone); (added[rt] = added[rt] || []).push(...r.added); };
            // V1.0.4: วันว่างที่เลือก → จองช่องตลาดใหม่ของวันนั้น (เฉพาะร้านของสายนี้)
            const NEW = [];
            NW.forEach(v => {
                const slot = Runs.newMarketSlot(brt, NEW.map(x => x.slot));
                if (slot) NEW.push({ slot, date: RX_NEW.exec(v)[1] });
                else UI.showErrorToast('⚠️ ช่องวันของสายนี้เต็มแล้ว — สร้างตลาดใหม่ไม่ได้');
            });
            const newUsed = new Set();
            work.forEach(s => {
                const f = find(s.id); if (!f) return;
                s.selected = false;
                if (NEW.length && f.rt === brt && isShort(f.rt)) {
                    const L = occList(f.rt);
                    const ok = W0.filter(v => L.some(o => o.id === v));
                    const cur = occOf(s, f.rt, L);
                    const W = st.mode === 'replace' ? ok : [...new Set(cur.concat(ok))];
                    const Wsorted = L.filter(o => W.includes(o.id)).map(o => o.id);
                    const r = (cur.join('|') !== Wsorted.join('|')) ? applyOcc(s, f.rt, Wsorted) : { gone: [], added: [] };
                    NEW.forEach(x => { if (!(s.days || []).includes(x.slot)) { Runs.joinStandalone(s, x.slot, x.date); r.added.push(x.slot); newUsed.add(x.slot); } });
                    memo0();
                    if (r.gone.length || r.added.length) push(f.rt, r);
                    return;
                }
                if (!isShort(f.rt)) {
                    // สายรอบยาว (ปนมาในชุดที่เลือก) — ใช้ตลาดของวันที่ที่เลือก
                    const days = [...new Set(W0.map(v => 'Day ' + RX_OCC.exec(v)[1]))].filter(d => nDay(d) <= cycleOf(f.rt));
                    const next = st.mode === 'replace' ? days : sortD(baseDays(s, f.rt).concat(days));
                    if (!next.length) return;
                    const r = setDays(s, f.rt, next);
                    if (r) push(f.rt, r);
                    return;
                }
                const L = occList(f.rt);
                const ok = W0.filter(v => L.some(o => o.id === v));
                const cur = occOf(s, f.rt, L);
                const W = st.mode === 'replace' ? ok : [...new Set(cur.concat(ok))];
                if (!W.length) return;
                const Wsorted = L.filter(o => W.includes(o.id)).map(o => o.id);
                if (cur.join('|') === Wsorted.join('|')) return;
                push(f.rt, applyOcc(s, f.rt, Wsorted));
            });
            touched.forEach(rt => reseq(rt, gone[rt] || [], added[rt] || []));
            UI.showLoader('📅 กำลังจัดลงวัน...', `${n} ร้าน`);
            try { await save(touched, (st.mode === 'replace' ? 'จัดลงวัน ' : 'เพิ่มวัน ') + lab); }
            catch (e) { UI.hideLoader(); return UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message)); }
            UI.hideLoader();
            UI.showSaveToast(`📅 ${st.mode === 'replace' ? 'จัดลงวัน' : 'เพิ่มวัน'} ${lab} — ${n.toLocaleString()} ร้าน`
                + (skip.length ? ` · ข้าม ${skip.length} ร้านในกองรอจัดสาย` : '') + ' · ย้อนกลับได้ (Ctrl+Z)');
            // V1.0.4: ตลาดใหม่ของวันว่าง → ให้ตั้งชื่อตลาดเลย (ทีละตลาด)
            st.o = (st.o || []).filter(v => !RX_NEW.test(v));
            const ask = NEW.filter(x => newUsed.has(x.slot));
            const next = (i) => {
                if (i >= ask.length) return;
                Runs.askName(brt, ask[i].slot, Runs._parse(ask[i].date));
                if (i + 1 < ask.length) {
                    const t = setInterval(() => { const el = document.getElementById('mkname-modal'); if (el && el.classList.contains('hidden')) { clearInterval(t); next(i + 1); } }, 400);
                }
            };
            next(0);
        };
        if (lose.length) return UI.showConfirm(
            `มี ${lose.length} ร้านที่เข้า 3 ครั้งขึ้นไป — "แทนที่วันเดิม" จะเหลือแค่ ${lab}\n`
            + lose.slice(0, 5).map(s => '• ' + esc(s.name)).join('\n') + (lose.length > 5 ? '\n…' : '')
            + '\n\nถ้าจะเก็บวันเดิมไว้ ให้เลือก "เพิ่มจากวันเดิม" แทน', run);
        return run();
    };

    window.Visits = Object.assign({ popupHTML, setDays, barHTML, paintBars, _find: find, _baseDays: baseDays,
        _occList: occList, _occOf: occOf, _applyOcc: applyOcc, _occTxt: occTxt, _isShort: isShort }, P, O, B);

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
            if (s) { s.selected = !s.selected; UI.render(); if (s.selected && typeof MapCtrl !== 'undefined' && MapCtrl.reveal) MapCtrl.reveal(s); }
        };
        paintBars();
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1300));
})();
;(window.__RPV=window.__RPV||{})['visits.js']='1.0.4';

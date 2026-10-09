/* =============================================================================
 *  runs.js — ครั้งเข้าเยี่ยมของตลาด และการรวม/แยก CY ตามหลักของ DMS   (V0.6.0)
 * =============================================================================
 *  หลักการ (ตกลงกันแล้ว 2 ต.ค. 2569)
 *    • 1 CY = ร้าน + ลำดับคิว + วันเข้าเยี่ยม — ทุกครั้งใน CY ต้องเหมือนกันหมด
 *    • ความถี่เป็นของ "ตลาด" (สาย × ช่องวัน) ไม่ใช่ของร้าน
 *        F2 = วิ่งทุกครั้งที่ปฏิทินให้   ·   F1 = วิ่งครั้งเดียว
 *    • สายรอบสั้น (รอบ ≤ 14 วัน เช่น 12 วัน) ครั้งถัดไป = ครั้งก่อน + 14 วัน จนถึง End date
 *      (DMS ยิงซ้ำทุก 14 วันจาก Start date เอง ไม่ได้นับวันทำงาน) → เดือน 5 สัปดาห์ได้ 3 ครั้ง
 *    • สายรอบยาว (24 วัน) ใช้วันที่ตามปฏิทินตรง ๆ
 *    • ตอนส่งออก: ครั้งที่ติดกันห่าง 14 วันพอดี เหมือนกันหมด และวิ่งไปจนถึง End date
 *      → 1 CY แบบ 5 (Fortnightly)  ·  ที่เหลือ → CY แบบ 9 (Monthly) ครั้งละ 1 CY
 *      End date ทุกแถวของสายเดียวกันเท่ากัน จึง "ครั้ง 1 = 2 แต่ครั้ง 3 ต่าง" ต้องแตกเป็นแบบ 9 ทั้งหมด
 *    • End date แยกรายสาย = วันสุดท้ายที่สายนั้นมีแผน (วันทำงานสุดท้ายตามปฏิทินของสาย)  (V0.6)
 *
 *  "แยกครั้งนี้" = ย้ายครั้งนั้นออกไปเป็นช่องวันใหม่ของสาย (เช่น รอบ 12 วัน D3 ครั้งที่ 2 → วันที่ 15)
 *  ร้านและลำดับคัดลอกมา แล้วแก้ได้อิสระเหมือนช่องวันปกติ (ย้ายร้าน/ลำดับ/วันที่)
 *  ข้อมูลเก็บในร้านเอง (s.runOf[ช่องใหม่] = {src, run, date}) จึงย้อนกลับ/บันทึกไปพร้อมแผนได้
 * ========================================================================== */
const Runs = (() => {
    'use strict';

    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const UNASSIGNED = 'รอจัดสาย';
    const MAX_SLOT = 30;                    // DAY_COLORS มีถึง Day 30
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const pad2 = (n) => String(n).padStart(2, '0');
    const iso = (d) => d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : '';
    const parse = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return (y && m && d) ? new Date(y, m - 1, d) : null; };
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const diffDays = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const short = (d) => d ? d.getDate() + ' ' + TH[d.getMonth()] : '';
    const shortW = (d) => d ? WD[d.getDay()] + ' ' + d.getDate() + ' ' + TH[d.getMonth()] : '';
    const dlist = (ds) => {
        if (!ds.length) return '';
        const last = ds[ds.length - 1];
        return ds.map(d => d.getDate()).join(' · ') + ' ' + TH[last.getMonth()];
    };

    let ver = 0;                              // เพิ่มทุกครั้งที่ข้อมูลครั้ง/แยก เปลี่ยน (ให้แคชวันที่รู้)
    const bump = () => { ver++; memoClear(); try { if (window.DayDate && DayDate._clear) DayDate._clear(); } catch (e) {} };

    // V0.9.1: แคชภายในรอบการทำงานเดียว — เดิม datesOf/fqOf/onceRun กรองร้านทั้งสายทุกครั้งที่ถูกเรียก
    //   (ถูกเรียกต่อร้านต่อวันตอนวาดจอ = ช้าแบบกำลังสอง · สาย 400 ร้านกดเลือกร้านทีละ ~1 วินาที)
    //   แคชล้างเองเมื่อจบงานชุดนั้น (microtask) และทุกครั้งที่เริ่มวาดจอ / บันทึก / bump จึงไม่ค้างข้อมูลเก่า
    let memo = null;
    const memoClear = () => { memo = null; };
    const M_ = () => {
        if (!memo) { memo = { idx: new Map(), cal: new Map(), dates: new Map(), pot: new Map(), fq: new Map() }; Promise.resolve().then(memoClear); }
        return memo;
    };
    /** ดัชนีของสาย: Day → ร้าน · Day → ข้อมูลการแยก · ตลาดต้นทาง → {ครั้ง: ช่องใหม่} */
    const idxOf = (route) => {
        const m = M_();
        let x = m.idx.get(route);
        if (x) return x;
        const byDay = new Map(), meta = new Map(), det = new Map();
        for (const s of listOf(route)) {
            if (s.runOf) for (const k in s.runOf) {
                const r = s.runOf[k];
                if (r && r.src) {
                    if (!meta.has(k)) meta.set(k, r);
                    if ((s.days || []).includes(k)) { const o = det.get(r.src) || {}; o[r.run] = k; det.set(r.src, o); }
                }
            }
            if (s.inactive) continue;
            for (const d of (s.days || [])) { let a = byDay.get(d); if (!a) byDay.set(d, a = []); a.push(s); }
        }
        x = { byDay, meta, det };
        m.idx.set(route, x);
        return x;
    };

    // ── ปฏิทิน ───────────────────────────────────────────────────────────
    const ym = () => {
        const s = (typeof App !== 'undefined' && App._currentPlanYM) || '';
        const [y, m] = s.split('_').map(Number);
        return (y && m) ? { y, m0: m - 1 } : null;
    };
    const cfgOf = (route) => {
        const ov = (State.db && State.db.routeCal && route && State.db.routeCal[route]) || null;
        return ov || (State.db && State.db.calendarConfig) || {};
    };
    const cycleOf = (route) => {
        const ov = (State.db && State.db.routeCal && route && State.db.routeCal[route]) || null;
        const n = parseInt((ov && ov.cycleDays) || (State.db && State.db.cycleDays) || 24, 10);
        return (n >= 2 && n <= 31) ? n : 24;
    };
    /** สายรอบสั้น = 1 เดือนหมุนมากกว่า 1 รอบ (รอบ ≤ 14 วันทำงาน) — ความถี่กำหนดที่ตลาด */
    const isShort = (route) => cycleOf(route) <= 14;

    const isHoliday = (route, d) => {
        if (!d) return false;
        const c = cfgOf(route);
        if ((c.weeklyHolidays || []).includes(d.getDay())) return true;
        const p = ym();
        return !!(p && d.getFullYear() === p.y && d.getMonth() === p.m0 && (c.holidays || []).includes(d.getDate()));
    };

    /** วันทำงานสุดท้ายของเดือนตามปฏิทินของสายนี้ (override รายสายมาก่อน) = วันสุดท้ายที่สายนี้มีแผน
     *  ไม่ระบุสาย = ตามปฏิทินระดับเดือน · วันหยุดเฉพาะกิจท้ายเดือนจึงดึง End date ของสายนั้นเข้ามาเอง (V0.6) */
    const workEnd = (route) => {
        const p = ym();
        if (!p) return null;
        const c = route ? cfgOf(route) : ((State.db && State.db.calendarConfig) || {});
        const wk = c.weeklyHolidays || [], ad = c.holidays || [];
        // ปฏิทินที่มาจากไฟล์นำเข้ารู้วันที่วิ่งวันสุดท้ายจริงของเดือนนั้น (lastDay) — ใช้เป็นเพดาน
        const cap = Math.min(new Date(p.y, p.m0 + 1, 0).getDate(), (c.source === 'import' && c.lastDay) || 99);
        for (let d = cap; d >= 1; d--) {
            const dt = new Date(p.y, p.m0, d);
            if (!wk.includes(dt.getDay()) && !ad.includes(d)) return dt;
        }
        return new Date(p.y, p.m0 + 1, 0);
    };
    /** End date ที่มีผลกับสายนี้ — ถ้าผู้ใช้ตั้งวันเดียวทั้งศูนย์ไว้ในหน้าต่างส่งออก (ของเดือนนี้) ใช้ค่านั้น
     *  ไม่งั้น = วันสุดท้ายที่สายนั้นมีแผน (แยกรายสาย) */
    const endDate = (route) => {
        try {
            if (typeof DmsExport !== 'undefined' && DmsExport._endDate && DmsExport._endYM === App._currentPlanYM) {
                const d = parse(DmsExport._endDate); if (d) return d;
            }
        } catch (e) {}
        return workEnd(route);
    };

    const calDates = (route, day) => {
        const mm = M_(), key = route + '|' + day;
        if (mm.cal.has(key)) return mm.cal.get(key).slice();
        const r = calDates0(route, day);
        mm.cal.set(key, r);
        return r.slice();
    };
    const calDates0 = (route, day) => {
        const p = ym();
        if (!p || typeof FileManager === 'undefined') return [];
        try {
            const c = cfgOf(route);
            if (FileManager._resolveCalendarDates) return FileManager._resolveCalendarDates(c, day, p.y, p.m0) || [];
            const d = FileManager._resolveCalendarDate(c, day, p.y, p.m0);
            return d ? [d] : [];
        } catch (e) { return []; }
    };

    // ── ร้าน / ตลาด ────────────────────────────────────────────────────────
    const listOf = (route) => ((State.db && State.db.routes) || {})[route] || [];
    const storesOf = (route, day) => (idxOf(route).byDay.get(day) || []).slice();

    /** ข้อมูลการแยกของช่องวันนี้ ถ้าช่องนี้เป็น "ครั้งที่แยกออกมา" — {src, run, date} */
    const metaOf = (route, day) => idxOf(route).meta.get(day) || null;
    const isDetached = (route, day) => !!metaOf(route, day);

    /** ช่องวันที่ถูกแยกออกมาจากตลาดนี้ { run(1-based): ช่องใหม่ } */
    const detachedOf = (route, src) => Object.assign({}, idxOf(route).det.get(src) || {});

    /** ทุกช่องวันที่ใช้อยู่ในสาย (รวมช่องที่แยกออกมา) */
    const daysOf = (route) => {
        const set = new Set();
        listOf(route).forEach(s => { if (!s.inactive) (s.days || []).forEach(d => set.add(d)); });
        return [...set].sort((a, b) => dayNum(a) - dayNum(b));
    };

    /** ความถี่ของตลาด: 'F2' = วิ่งทุกครั้ง · 'F1' = วิ่งครั้งเดียว (ค่าเดียวทั้งตลาด) */
    const fqOf = (route, day) => {
        const mm = M_(), key = route + '|' + day;
        if (mm.fq.has(key)) return mm.fq.get(key);
        const v = fqOf0(route, day);
        mm.fq.set(key, v);
        return v;
    };
    const fqOf0 = (route, day) => {
        if (isDetached(route, day)) return 'F1';
        const cnt = {};
        storesOf(route, day).forEach(s => {
            const v = String((s.fqs && s.fqs[day]) || '').trim().toUpperCase();
            if (!v) return;
            const k = v === 'F2' ? 'F2' : 'F1';
            cnt[k] = (cnt[k] || 0) + 1;
        });
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
        return top ? top[0] : 'F2';          // ไม่มีค่า = วิ่งทุกครั้งที่ปฏิทินให้ (รอบ 12 วัน = F2 ตามหลัก)
    };

    /**
     * ทุกครั้งที่ตลาดนี้ "วิ่งได้" ในเดือนนี้ (ยังไม่สนว่าเป็น F1/F2)
     * @returns [{k, date, to}] — to = ช่องวันที่ครั้งนี้ถูกแยกไป (ถ้ามี)
     */
    const potential = (route, day) => {
        const mm = M_(), key = route + '|' + day;
        if (!mm.pot.has(key)) mm.pot.set(key, potential0(route, day));
        return mm.pot.get(key).map(p => ({ ...p }));
    };
    const potential0 = (route, day) => {
        const m = metaOf(route, day);
        if (m) { const d = parse(m.date); return d ? [{ k: m.run, date: d, to: null }] : []; }
        const cal = calDates(route, day);
        const end = endDate(route);
        let dates = end ? cal.filter(d => d <= end) : cal;          // DMS ไม่วิ่งเกิน End date
        if (isShort(route) && cal.length) {
            dates = [];
            for (let d = cal[0]; !end || d <= end; d = addDays(d, 14)) { dates.push(d); if (dates.length >= 5) break; }
        }
        const det = detachedOf(route, day);
        return dates.map((d, i) => ({ k: i + 1, date: d, to: det[i + 1] || null }));
    };

    /**
     * ครั้งที่ตลาด "แบบ F1" เลือกวิ่ง — ที่ผู้ใช้เลือกไว้ › วันที่ที่ศูนย์วิ่งจริงในไฟล์ที่นำเข้า › ครั้งแรก
     * คืนรายการจาก potential (อาจเป็นครั้งที่ถูกแยกออกไปแล้ว — ดู .to)
     */
    const onceRun = (route, day, pot) => {
        if (!pot.length) return null;
        const chosen = storesOf(route, day).map(s => s.fqRun && s.fqRun[day]).find(Boolean);
        if (chosen) { const c = pot.find(p => p.k === chosen); if (c) return c; }
        const cnt = {};
        storesOf(route, day).forEach(s => { const v = s.vd && s.vd[day]; if (v) cnt[v] = (cnt[v] || 0) + 1; });
        const src = (Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || [])[0];
        return (src && pot.find(p => iso(p.date) === src)) || pot[0];
    };

    /** วันที่ที่ช่องวันนี้วิ่งจริงในเดือนนี้ (ไม่รวมครั้งที่ถูกแยกออกไปเป็นช่องอื่น) */
    const datesOf = (route, day) => {
        const mm = M_(), key = route + '|' + day;
        if (!mm.dates.has(key)) mm.dates.set(key, datesOf0(route, day));
        return mm.dates.get(key).slice();
    };
    const datesOf0 = (route, day) => {
        const pot = potential(route, day);
        if (isDetached(route, day)) return pot.map(p => p.date);
        if (fqOf(route, day) === 'F1') { const o = onceRun(route, day, pot); return (o && !o.to) ? [o.date] : []; }
        return pot.filter(p => !p.to).map(p => p.date);
    };

    /** ลายนิ้วมือของตลาด = ร้าน + ลำดับคิว (เทียบว่าสองครั้ง "เหมือนกันหมด" ไหม) */
    const sigOf = (route, day) => storesOf(route, day)
        .map(s => ({ id: String(s.id), q: (s.seqs && s.seqs[day]) || 9999 }))
        .sort((a, b) => a.q - b.q || a.id.localeCompare(b.id))
        .map(x => x.id).join('|');

    // ── จัดกลุ่มเป็น CY ตามหลัก ───────────────────────────────────────────
    /**
     * แผน CY ของสายนี้ — 1 รายการ = 1 แถวในไฟล์ DMS (ยังไม่มีเลข CY)
     * { route, day(ช่องวันที่ใช้ร้าน/ลำดับ), base(ช่องหลัก), date, vf:'5'|'9', dates:[...], merged:[ช่องที่รวมอัตโนมัติ] }
     */
    const planRoute = (route) => {
        const out = [];
        const end = endDate(route);
        const used = new Set();
        const all = daysOf(route);
        all.filter(d => !isDetached(route, d)).forEach(day => {
            if (!storesOf(route, day).length) return;
            const pot = potential(route, day);
            const sig0 = sigOf(route, day);
            let runs = [];
            const once = fqOf(route, day) === 'F1';
            const pick = once ? [onceRun(route, day, pot)].filter(Boolean) : pot;
            pick.forEach(p => {
                if (p.to) {
                    used.add(p.to);
                    const m = metaOf(route, p.to);
                    const dd = parse(m && m.date) || p.date;
                    // แยกไปแล้วแต่ "กลับมาเหมือนกันหมด" (ร้าน ลำดับ และวันตรงกับที่ควรเป็น) → นับรวมเป็นครั้งของตลาดเดิม
                    if (sigOf(route, p.to) === sig0 && iso(dd) === iso(p.date)) runs.push({ date: p.date, day, k: p.k, auto: p.to });
                    else if (storesOf(route, p.to).length) runs.push({ date: dd, day: p.to, k: p.k });
                } else runs.push({ date: p.date, day, k: p.k });
            });
            if (!pot.length) { const c = calDates(route, day)[0]; if (c) runs.push({ date: c, day, k: 1 }); }
            runs.sort((a, b) => a.date - b.date);
            // หา "หาง" ที่เข้าเงื่อนไขแบบ 5: ช่องเดียวกัน ห่าง 14 วันพอดีทุกครั้ง ≥ 2 ครั้ง และครั้งสุดท้าย + 14 เลย End date
            let cut = runs.length;
            for (let i = 0; i < runs.length - 1; i++) {
                const tail = runs.slice(i);
                const okSame = tail.every(r => r.day === day);
                const okGap = tail.every((r, j) => j === 0 || diffDays(tail[j - 1].date, r.date) === 14);
                const okEnd = !end || addDays(tail[tail.length - 1].date, 14) > end;
                if (okSame && okGap && okEnd) { cut = i; break; }
            }
            runs.slice(0, cut).forEach(r => out.push({ route, day: r.day, base: day, k: r.k, date: r.date, vf: '9', dates: [r.date] }));
            if (cut < runs.length) {
                const tail = runs.slice(cut);
                out.push({ route, day, base: day, k: tail[0].k, date: tail[0].date, vf: '5', dates: tail.map(r => r.date),
                           merged: tail.filter(r => r.auto).map(r => r.auto) });
            }
        });
        // ครั้งที่แยกออกมาแต่ตลาดต้นทางไม่มีครั้งนั้นแล้ว (เช่น เปลี่ยนปฏิทิน) → ส่งออกเป็นแบบ 9 ตามวันที่ของมันเอง
        all.filter(d => isDetached(route, d) && !used.has(d)).forEach(day => {
            if (!storesOf(route, day).length) return;
            const m = metaOf(route, day);
            const d = parse(m && m.date);
            if (d) out.push({ route, day, base: m.src, k: m.run, date: d, vf: '9', dates: [d], orphan: true });
        });
        return out;
    };

    /** ครั้งที่ตกวันหยุด (ต้องแก้ก่อนส่งออก) — [{route, day, k, date}] */
    const holidayHits = (routes) => {
        const out = [];
        (routes || Object.keys(State.db.routes || {})).forEach(rt => {
            if (rt === UNASSIGNED) return;
            daysOf(rt).forEach(day => {
                if (!storesOf(rt, day).length) return;
                datesOf(rt, day).forEach(d => {
                    if (isHoliday(rt, d)) {
                        const pot = potential(rt, day).find(p => iso(p.date) === iso(d));
                        out.push({ route: rt, day, k: pot ? pot.k : 1, date: d });
                    }
                });
            });
        });
        return out;
    };

    /** วันเดียวกันมีมากกว่า 1 ตลาดของสายเดียวกัน (เช่น ครั้งที่ 2 = +14 ไปชนตลาดอื่นเพราะวันหยุดทำให้รอบแรกเลื่อน) */
    const clashes = (routes) => {
        const out = [];
        (routes || Object.keys(State.db.routes || {})).forEach(rt => {
            if (rt === UNASSIGNED) return;
            const byDate = {};
            daysOf(rt).forEach(day => {
                if (!storesOf(rt, day).length) return;
                datesOf(rt, day).forEach(d => { (byDate[iso(d)] || (byDate[iso(d)] = [])).push(day); });
            });
            Object.entries(byDate).forEach(([k, days]) => {
                if (days.length > 1) out.push({ route: rt, date: parse(k), days: days.sort((a, b) => dayNum(a) - dayNum(b)) });
            });
        });
        return out.sort((a, b) => a.date - b.date || a.route.localeCompare(b.route, 'th', { numeric: true }));
    };

    // ── แยก / รวม ────────────────────────────────────────────────────────
    const saveRoute = (rt) => App.planRoutesCol(App._currentPlanYM).doc(rt).set({
        stores: State.db.routes[rt],
        confirmedBy: firebase.firestore.FieldValue.delete(),
        confirmedAt: firebase.firestore.FieldValue.delete(),
    }, { merge: true });

    /** ช่องวันว่างสำหรับครั้งที่แยก — ใช้ (รอบ × (ครั้ง-1) + วัน) ก่อน เช่น รอบ 12: D3 ครั้งที่ 2 → วันที่ 15 */
    const freeSlot = (route, day, k) => {
        const used = new Set();
        listOf(route).forEach(s => (s.days || []).forEach(d => used.add(d)));
        const c = cycleOf(route);
        const pref = c * (k - 1) + dayNum(day);
        if (pref > c && pref <= MAX_SLOT && !used.has('Day ' + pref)) return 'Day ' + pref;
        for (let i = c + 1; i <= MAX_SLOT; i++) if (!used.has('Day ' + i)) return 'Day ' + i;
        return null;
    };

    const finish = async (rt, label) => {
        bump();
        try { await saveRoute(rt); } catch (e) { console.error('[Runs] save', e); UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message)); }
        if (typeof EditHistory !== 'undefined' && EditHistory.mark) EditHistory.mark(label);
        try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
        UI.render();
    };

    /** แยกครั้งที่ k ของตลาดนี้ออกเป็นช่องวันใหม่ (ร้าน + ลำดับ คัดลอกมา) */
    const detach = async (route, day, k, opt) => {
        const p = potential(route, day).find(x => x.k === k);
        if (!p) return UI.showErrorToast('⚠️ ไม่พบครั้งที่ ' + k + ' ของตลาดนี้ในเดือนนี้');
        if (p.to) return UI.showErrorToast('ℹ️ ครั้งนี้แยกออกไปแล้ว (' + (tagOf(route, p.to) || p.to) + ')');
        const slot = freeSlot(route, day, k);
        if (!slot) return UI.showErrorToast('⚠️ ช่องวันของสายนี้เต็มแล้ว (ใช้ได้ถึงวันที่ ' + MAX_SLOT + ')');
        const date = (opt && opt.date) || iso(p.date);
        const arr = storesOf(route, day);
        // ตลาดแบบวิ่งครั้งเดียว: จำว่าครั้งที่วิ่งคือครั้งนี้ — ตลาดเดิมจะไม่วิ่งซ้ำอีก (ครั้งเดียวย้ายไปอยู่ช่องใหม่)
        if (fqOf(route, day) === 'F1') arr.forEach(s => { if (!s.fqRun) s.fqRun = {}; s.fqRun[day] = k; });
        arr.forEach(s => {
            if (!s.days.includes(slot)) s.days.push(slot);
            s.days.sort((a, b) => dayNum(a) - dayNum(b));
            if (!s.seqs) s.seqs = {};
            s.seqs[slot] = (s.seqs && s.seqs[day]) || 0;
            if (!s.runOf) s.runOf = {};
            s.runOf[slot] = { src: day, run: k, date };
            if (!s.fqs) s.fqs = {};
            s.fqs[slot] = 'F1';
            if (s.cys) delete s.cys[slot];
            s.freq = s.days.length > 1 ? 2 : 1;
        });
        await finish(route, 'แยกครั้งที่ ' + k + ' ' + day.replace('Day ', 'D'));
        UI.showSaveToast(`✂️ แยก ${day.replace('Day ', 'D')} ครั้งที่ ${k} (${short(parse(date))}) ออกเป็น ${tagOf(route, slot) || slot} แล้ว · ${arr.length} ร้าน — แก้ร้าน/ลำดับ/วันที่ของครั้งนี้ได้อิสระ`);
        return slot;
    };

    /** รวมครั้งที่แยกไว้กลับเข้าตลาดเดิม — ร้านที่อยู่เฉพาะครั้งนี้กลับไปเป็น "ยังไม่จัดวัน" */
    const rejoin = async (route, slot, silent) => {
        const m = metaOf(route, slot);
        if (!m) return;
        let orphan = 0;
        listOf(route).forEach(s => {
            const had = (s.days || []).includes(slot) || (s.runOf && s.runOf[slot]);
            if (!had) return;
            s.days = (s.days || []).filter(d => d !== slot);
            if (s.seqs) delete s.seqs[slot];
            if (s.cys) delete s.cys[slot];
            if (s.fqs) delete s.fqs[slot];
            if (s.runOf) { delete s.runOf[slot]; if (!Object.keys(s.runOf).length) delete s.runOf; }
            if (!s.days.length) orphan++;
            s.freq = s.days.length > 1 ? 2 : 1;
        });
        if (silent) return orphan;
        await finish(route, 'รวมกลับ ' + m.src.replace('Day ', 'D'));
        UI.showSaveToast(`🔗 รวม ${m.src.replace('Day ', 'D')}·ครั้ง${m.run} กลับเข้า ${m.src.replace('Day ', 'D')} ครั้งที่ ${m.run} แล้ว`
            + (orphan ? ` · ${orphan} ร้านที่อยู่เฉพาะครั้งนั้นกลับไปเป็น "ยังไม่จัดวัน"` : ''));
        return orphan;
    };

    /** V0.7.3: เอาร้านที่เลือกออกจาก "ครั้งที่แยกไว้" เท่านั้น — ช่องวันอื่น (ครั้งแรก) และลำดับคิวเดิมไม่ถูกแตะ */
    let rmOpen = '';
    const removeSel = (route, slot) => removeIds(route, slot, storesOf(route, slot).filter(s => s.selected).map(s => String(s.id)));
    /** V0.7.4: ติ๊กร้านในหน้าต่างครั้งเข้าเยี่ยมแล้วเอาออก — ไม่ต้องออกไปเลือกบนแผนที่ */
    const removeChecked = (route, slot) => {
        const ids = [...document.querySelectorAll('#runs-modal input[data-rm]')]
            .filter(i => i.checked && i.dataset.rm === slot).map(i => i.value);
        return removeIds(route, slot, ids);
    };
    const removeIds = async (route, slot, ids) => {
        const m = metaOf(route, slot);
        if (!m) return;
        const inSlot = storesOf(route, slot);
        const want = new Set((ids || []).map(String));
        const sel = inSlot.filter(s => want.has(String(s.id)));
        const tag = tagOf(route, slot);
        if (!sel.length) return UI.showErrorToast(`⚠️ ติ๊กร้านที่จะเอาออกจาก ${tag} ก่อน`);
        if (sel.length >= inSlot.length) return UI.showErrorToast(`⚠️ เอาออกทุกร้านไม่ได้ — ถ้าครั้งนี้ไม่ต้องวิ่งทั้งตลาด ให้ตั้ง "วิ่งครั้งเดียว" ที่ตลาด ${m.src.replace('Day ', 'D')} แทน`);
        let orphan = 0;
        sel.forEach(s => {
            s.days = (s.days || []).filter(d => d !== slot);
            if (s.seqs) delete s.seqs[slot];
            if (s.cys) delete s.cys[slot];
            if (s.fqs) delete s.fqs[slot];
            if (s.runOf) { delete s.runOf[slot]; if (!Object.keys(s.runOf).length) delete s.runOf; }
            s.freq = s.days.length > 1 ? 2 : 1;
            s.selected = false;
            if (!s.days.length) orphan++;
        });
        // ไล่เลขคิวของครั้งนี้ใหม่ให้ต่อเนื่อง (เรียงตามลำดับเดิม)
        inSlot.filter(s => !sel.includes(s))
            .sort((a, b) => ((a.seqs || {})[slot] || 9999) - ((b.seqs || {})[slot] || 9999))
            .forEach((s, i) => { if (!s.seqs) s.seqs = {}; s.seqs[slot] = i + 1; });
        await finish(route, 'เอาร้านออกจาก ' + tag);
        UI.showSaveToast(`➖ เอา ${sel.length} ร้านออกจาก ${tag} แล้ว — ครั้งแรกยังมีร้านครบ`
            + (orphan ? ` · ${orphan} ร้านที่อยู่เฉพาะครั้งนี้กลับไปเป็น "ยังไม่จัดวัน"` : ''));
        if (document.getElementById('runs-modal') && !document.getElementById('runs-modal').classList.contains('hidden')) open(route, m.src);
    };
    /** V0.7.5: ปุ่ม ➖ ท้ายแถวในหน้าต่างลำดับคิว — เอาทีละร้านออกจากครั้งที่แยกไว้ */
    const removeOne = async (route, slot, id) => {
        await removeIds(route, slot, [id]);
        const dm = document.getElementById('dayModal');
        if (dm && !dm.classList.contains('hidden')) { try { UI.showDayModal(slot); } catch (e) {} }
    };
    /** V0.7.6: เอาร้านออกจาก "ตลาดนี้ตลาดเดียว" — ใช้กับร้านที่อยู่หลายตลาด (F2 / เข้ารายสัปดาห์) ตลาดอื่นไม่ถูกแตะ */
    const removeDayOnly = async (route, day, id) => {
        const s = listOf(route).find(x => String(x.id) === String(id));
        if (!s || !(s.days || []).includes(day)) return;
        if (s.days.length < 2) return UI.showErrorToast('⚠️ ร้านนี้อยู่ตลาดเดียว — ถ้าจะเอาออกใช้ Unassign หรือ 🗑️ เอาออกจากแผน');
        s.days = s.days.filter(x => x !== day);
        ['seqs', 'cys', 'fqs'].forEach(k => { if (s[k]) delete s[k][day]; });
        if (s.runOf) { delete s.runOf[day]; if (!Object.keys(s.runOf).length) delete s.runOf; }
        s.freq = s.days.length > 1 ? 2 : 1;
        listOf(route).filter(x => !x.inactive && (x.days || []).includes(day))
            .sort((a, b) => ((a.seqs || {})[day] || 9999) - ((b.seqs || {})[day] || 9999))
            .forEach((x, i) => { if (!x.seqs) x.seqs = {}; x.seqs[day] = i + 1; });
        await finish(route, 'เอาร้านออกจาก ' + day.replace('Day ', 'D'));
        UI.showSaveToast(`➖ เอา "${s.name}" ออกจาก ${day.replace('Day ', 'D')} แล้ว — ยังอยู่ ${s.days.map(x => x.replace('Day ', 'D')).join('·')}`);
        const dm = document.getElementById('dayModal');
        if (dm && !dm.classList.contains('hidden')) { try { UI.showDayModal(day); } catch (e) {} }
    };
    /** แต่งหน้าต่างลำดับคิว: ใส่ปุ่ม ➖ ท้ายแถว
     *  ครั้งที่แยกมา (✂️) = ทุกร้าน · ตลาดปกติ = เฉพาะร้านที่อยู่หลายตลาด (เอาออกจากตลาดนี้ ตลาดอื่นยังอยู่) */
    const decorateDay = (d) => {
        const route = State.localActiveRoute;
        const m = route && metaOf(route, d);
        const box = document.getElementById('modalContent');
        if (!route || !box) return;
        const rows = [...box.querySelectorAll('div[draggable="true"]')];
        if (!rows.length) return;
        const byId = new Map(listOf(route).map(s => [String(s.id), s]));
        let added = 0;
        rows.forEach(row => {
            const mm = /dragStart\('([^']+)'\)/.exec(row.getAttribute('ondragstart') || '');
            if (!mm || row.querySelector('[data-rm1]')) return;
            if (!m) {
                const s = byId.get(String(mm[1]));
                if (!s || (s.days || []).length < 2) return;
                const rest = s.days.filter(x => x !== d).map(x => x.replace('Day ', 'D')).join('·');
                row.insertAdjacentHTML('beforeend',
                    `<button data-rm1="1" onclick="event.stopPropagation();Runs.removeDayOnly('${esc(route)}','${esc(d)}','${esc(mm[1])}')"
                        title="เอาร้านนี้ออกจาก ${esc(d.replace('Day ', 'D'))} ตลาดเดียว — ยังอยู่ ${esc(rest)}"
                        class="shrink-0 w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-black text-sm leading-none">➖</button>`);
                added++;
                return;
            }
            row.insertAdjacentHTML('beforeend',
                `<button data-rm1="1" onclick="event.stopPropagation();Runs.removeOne('${esc(route)}','${esc(d)}','${esc(mm[1])}')"
                    title="เอาร้านนี้ออกจาก${esc(tagOf(route, d))} — ครั้งอื่นของตลาดนี้ไม่โดน"
                    class="shrink-0 w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-black text-sm leading-none">➖</button>`);
        });
        if (!m) {
            if (added && !box.querySelector('[data-rm1note]'))
                rows[0].insertAdjacentHTML('beforebegin',
                    `<p data-rm1note="1" class="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 mb-2">
                        ร้านที่อยู่หลายตลาดมีปุ่ม <b>➖</b> ท้ายแถว — เอาออกจากตลาดนี้ตลาดเดียว ตลาดอื่นยังอยู่</p>`);
            return;
        }
        if (!box.querySelector('[data-rm1note]'))
            rows[0].insertAdjacentHTML('beforebegin',
                `<p data-rm1note="1" class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">
                    ${esc(tagOf(route, d))} — กด <b>➖</b> ท้ายแถวเพื่อเอาร้านออกจากครั้งนี้ (ครั้งอื่นไม่โดน)</p>`);
    };
    /** จำนวนร้านที่เลือกไว้ในครั้งที่แยกนี้ */
    const selIn = (route, slot) => storesOf(route, slot).filter(s => s.selected).length;

    const setDate = async (route, slot, value) => {
        const d = parse(value);
        const p = ym();
        if (!d || !p || d.getFullYear() !== p.y || d.getMonth() !== p.m0) return UI.showErrorToast('⚠️ วันที่ต้องอยู่ในเดือนของแผนนี้');
        listOf(route).forEach(s => { if (s.runOf && s.runOf[slot]) s.runOf[slot].date = iso(d); });
        await finish(route, 'เปลี่ยนวัน ' + slot.replace('Day ', 'D'));
        if (isHoliday(route, d)) UI.showErrorToast('⚠️ ' + shortW(d) + ' เป็นวันหยุดตามปฏิทินของสายนี้');
        open(route, slot);
    };

    /** ตลาดแบบวิ่งครั้งเดียว — เลือกว่าจะวิ่งครั้งไหน */
    const setOnce = async (route, day, k) => {
        storesOf(route, day).forEach(s => { if (!s.fqRun) s.fqRun = {}; s.fqRun[day] = k; });
        await finish(route, 'เลือกครั้งที่วิ่ง ' + day.replace('Day ', 'D'));
        open(route, day);
    };

    /** ตั้งความถี่ทั้งตลาด */
    const setFq = async (route, day, mode) => {
        storesOf(route, day).forEach(s => { if (!s.fqs) s.fqs = {}; s.fqs[day] = mode; });
        await finish(route, 'ความถี่ตลาด ' + day.replace('Day ', 'D'));
        open(route, day);
    };

    /** ก่อนยกยอดเดือนใหม่: ครั้งที่แยกไว้เป็นของเดือนเก่า — รวมกลับทั้งหมด */
    const resetAll = () => {
        let n = 0, orphan = 0;
        const touched = [];
        Object.keys(State.db.routes || {}).forEach(rt => {
            const slots = new Set();
            listOf(rt).forEach(s => { if (s.runOf) Object.keys(s.runOf).forEach(k => slots.add(k)); });
            listOf(rt).forEach(s => { if (s.fqRun) delete s.fqRun; });
            if (!slots.size) return;
            slots.forEach(k => { orphan += rejoin(rt, k, true) || 0; n++; });
            touched.push(rt);
        });
        if (n) bump();
        return { n, orphan, touched };
    };

    // ── หน้าต่างครั้งเข้าเยี่ยมของตลาด ─────────────────────────────────────
    const close = () => {
        const el = document.getElementById('runs-modal');
        if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
    };

    const describe = (rows) => rows.map(r => r.vf === '5'
        ? `<b class="text-indigo-700">1 CY แบบ 5</b> (${esc(dlist(r.dates))})`
        : `<b class="text-gray-700">1 CY แบบ 9</b> (${esc(short(r.date))}${r.day !== r.base ? ' · ' + esc((tagOf(route, r.day) || r.day)) : ''})`).join(' + ');

    const open = (route, day) => {
        const m = metaOf(route, day);
        const base = m ? m.src : day;
        const pot = potential(route, base);
        const rows = planRoute(route).filter(r => r.base === base);
        const once = fqOf(route, base) === 'F1';
        const n = storesOf(route, base).length;
        const mk = (typeof RoadMaster !== 'undefined' && RoadMaster.marketName) ? (RoadMaster.marketName(route, base, listOf(route)) || '') : '';
        const sig0 = sigOf(route, base);
        const p = ym();
        const minD = p ? `${p.y}-${pad2(p.m0 + 1)}-01` : '';
        const maxD = p ? iso(new Date(p.y, p.m0 + 1, 0)) : '';
        const onceK = once ? (onceRun(route, base, pot) || {}).k : 0;

        const runRow = (x) => {
            const hol = isHoliday(route, x.to ? parse((metaOf(route, x.to) || {}).date) : x.date);
            if (x.to) {
                const mm = metaOf(route, x.to) || {};
                const dd = parse(mm.date);
                const same = sigOf(route, x.to) === sig0;
                const nn = storesOf(route, x.to).length;
                return `<div class="border border-amber-200 bg-amber-50 rounded-xl px-2.5 py-2">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-black text-amber-800">ครั้งที่ ${x.k}</span>
                        <span class="text-[11px] text-amber-800">แยกเป็นช่อง ${esc(tagOf(route, x.to) || x.to)} · ${nn} ร้าน</span>
                        ${same ? '<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1">ร้าน+ลำดับเหมือนเดิม</span>'
                               : '<span class="text-[10px] font-bold text-amber-700 bg-white border border-amber-300 rounded px-1">ร้าน/ลำดับต่างจากเดิม</span>'}
                    </div>
                    <div class="flex items-center gap-1.5 mt-1.5">
                        <input type="date" value="${iso(dd)}" min="${minD}" max="${maxD}" onchange="Runs.setDate('${esc(route)}','${esc(x.to)}',this.value)"
                               class="border border-amber-300 rounded-md px-1.5 py-0.5 text-xs bg-white">
                        <span class="text-[11px] text-amber-800">${esc(shortW(dd))}${hol ? ' · <b class="text-red-600">วันหยุด</b>' : ''}</span>
                        <div class="flex-1"></div>
                        <button onclick="Runs.go('${esc(route)}','${esc(x.to)}')" title="เปิดร้านของครั้งนี้ — ตั้งชื่อตลาด / จัดลำดับคิว" class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white border border-amber-300 text-amber-800 hover:bg-amber-100">ลำดับคิว</button>
                        <button onclick="Runs.askRejoin('${esc(route)}','${esc(x.to)}')" class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-100">🔗 รวมกลับ</button>
                    </div>
                    ${(() => {
                        const lst = storesOf(route, x.to).slice()
                            .sort((a, b) => ((a.seqs || {})[x.to] || 9999) - ((b.seqs || {})[x.to] || 9999));
                        return `<details class="mt-1.5 bg-white border border-amber-200 rounded-lg" ${rmOpen === x.to ? 'open' : ''} ontoggle="Runs._rmToggle('${esc(x.to)}', this.open)">
                        <summary class="cursor-pointer select-none px-2 py-1 text-[11px] font-bold text-red-700">➖ เอาร้านออกจากครั้งนี้ (ติ๊กเลือก ${lst.length} ร้าน)</summary>
                        <div class="max-h-44 overflow-y-auto px-2 pb-1 divide-y divide-gray-100">
                          ${lst.map(s => `<label class="flex items-center gap-2 py-1 text-[11px] cursor-pointer">
                              <input type="checkbox" data-rm="${esc(x.to)}" value="${esc(s.id)}" ${s.selected ? 'checked' : ''} class="w-3.5 h-3.5">
                              <span class="w-5 text-right font-bold text-gray-500">${(s.seqs || {})[x.to] || ''}</span>
                              <span class="flex-1 truncate">${esc(s.name || '')}</span>
                              <span class="font-mono text-[10px] text-gray-400">${esc(s.code || s.id)}</span></label>`).join('')}
                        </div>
                        <div class="flex items-center gap-2 px-2 pb-2 pt-1">
                          <button onclick="Runs.removeChecked('${esc(route)}','${esc(x.to)}')"
                              class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white border border-red-300 text-red-700 hover:bg-red-50">➖ เอาร้านที่ติ๊กออก</button>
                          <span class="text-[10px] text-amber-700">ครั้งอื่นของตลาดนี้ไม่ถูกแตะ</span>
                        </div></details>`; })()}
                    </div>`;
            }
            const off = once && x.k !== onceK;
            return `<div class="border ${hol && !off ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'} rounded-xl px-2.5 py-2 flex items-center gap-2 ${off ? 'opacity-50' : ''}">
                <span class="text-xs font-black text-gray-700">ครั้งที่ ${x.k}</span>
                <span class="text-[11px] text-gray-600">${esc(shortW(x.date))}</span>
                ${hol && !off ? '<span class="text-[10px] font-bold text-red-600">⚠️ ตรงวันหยุด — ควรแยกแล้วเลื่อนวัน</span>' : ''}
                ${off ? '<span class="text-[10px] text-gray-400">ไม่วิ่ง (ตลาดนี้วิ่งครั้งเดียว)</span>' : ''}
                <div class="flex-1"></div>
                ${once && !off ? '<span class="text-[10px] font-bold text-gray-500">ครั้งที่วิ่ง</span>' : ''}
                ${once && off ? `<button onclick="Runs.setOnce('${esc(route)}','${esc(base)}',${x.k})" class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-100">วิ่งครั้งนี้แทน</button>` : ''}
                ${!off ? `<button onclick="Runs.detach('${esc(route)}','${esc(base)}',${x.k}).then(()=>Runs.open('${esc(route)}','${esc(base)}'))"
                    class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50">✂️ แก้ครั้งนี้</button>` : ''}
            </div>`;
        };

        let el = document.getElementById('runs-modal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'runs-modal';
            el.className = 'fixed inset-0 bg-black/50 z-[9998] hidden items-center justify-center p-4';
            el.addEventListener('click', (e) => { if (e.target === el) close(); });
            document.body.appendChild(el);
        }
        const canMode = pot.length >= 2;
        el.innerHTML = `
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-4 max-h-[90vh] overflow-y-auto">
            <h3 class="font-black text-gray-800 mb-0.5">🗓️ ครั้งเข้าเยี่ยม · ${esc(route)} ${esc(base.replace('Day ', 'D'))}${mk ? ' · ' + esc(mk) : ''}</h3>
            <p class="text-[11px] text-gray-500 mb-2">${n.toLocaleString()} ร้าน · ${isShort(route) ? 'รอบสั้น: ครั้งถัดไป = +14 วัน จนถึง End date' : 'ตามปฏิทินของสาย'}</p>
            ${canMode ? `<div class="flex gap-1 mb-2">
                <button onclick="Runs.setFq('${esc(route)}','${esc(base)}','F2')" class="flex-1 py-1 rounded-lg text-[11px] font-bold border ${!once ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}">วิ่งทุกครั้ง (F2)</button>
                <button onclick="Runs.setFq('${esc(route)}','${esc(base)}','F1')" class="flex-1 py-1 rounded-lg text-[11px] font-bold border ${once ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}">วิ่งครั้งเดียว (F1)</button>
            </div>` : ''}
            <div class="flex flex-col gap-1.5 mb-3">${pot.map(runRow).join('') || '<p class="text-xs text-gray-400">ปฏิทินไม่มีวันที่ของตลาดนี้ในเดือนนี้</p>'}</div>
            <div class="bg-indigo-50 border border-indigo-200 rounded-xl px-2.5 py-2 text-[11px] text-indigo-900 leading-snug mb-3">
                <b>ตอนส่งออก:</b> ${rows.length ? describe(rows) : '—'}
                <div class="text-[10px] text-indigo-700/80 mt-1">CY เดียวแบบ 5 ได้เมื่อทุกครั้งเหมือนกันหมด (ร้าน ลำดับ) ห่าง 14 วันพอดี และวิ่งไปจนถึง End date · ไม่อย่างนั้นแตกเป็นแบบ 9 ครั้งละ 1 CY</div>
            </div>
            <div class="flex gap-2"><button onclick="Runs.close()" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ปิด</button></div>
          </div>`;
        el.classList.remove('hidden'); el.classList.add('flex');
    };

    const askRejoin = (route, slot) => {
        const m = metaOf(route, slot);
        if (!m) return;
        const only = listOf(route).filter(s => !s.inactive && (s.days || []).length === 1 && s.days[0] === slot).length;
        const same = sigOf(route, slot) === sigOf(route, m.src);
        const msg = `รวม ${tagOf(route, slot) || slot} กลับเข้า ${m.src.replace('Day ', 'D')} ครั้งที่ ${m.run}?\n\n`
            + (same ? 'ร้านและลำดับเหมือนตลาดเดิมอยู่แล้ว' : 'ร้าน/ลำดับที่แก้ไว้ในครั้งนี้จะหายไป ครั้งนี้กลับไปใช้ร้านและลำดับของตลาดเดิม')
            + (only ? `\n${only} ร้านที่อยู่เฉพาะครั้งนี้จะกลับไปเป็น "ยังไม่จัดวัน"` : '');
        UI.showConfirm(msg, async () => { await rejoin(route, slot); open(route, m.src); }, () => {});
    };

    /** เปิดสายและเลือกร้านของช่องวันนั้นไว้ให้ */
    const go = (route, slot) => {
        close();
        try { if (typeof Nav !== 'undefined' && Nav.go) Nav.go('planning'); } catch (e) {}
        try {
            if (typeof MultiRoute !== 'undefined' && MultiRoute.openDay) { MultiRoute.allDays && MultiRoute.allDays(); MultiRoute.openDay(route, slot); }
            else if (UI.showDayModal) UI.showDayModal(slot);
        } catch (e) {}
    };

    /** ป้ายสั้นของช่องวันที่แยกมา เช่น "D3·ครั้ง2" */
    const tagOf = (route, day) => {
        const m = metaOf(route, day);
        return m ? m.src.replace('Day ', 'D') + '·ครั้ง' + m.run : '';
    };

    // ── ต่อเข้ากับส่วนอื่น ──────────────────────────────────────────────
    const boot = () => {
        if (typeof MultiRoute === 'undefined' || !MultiRoute.dayList) return setTimeout(boot, 400);
        if (MultiRoute.dayList._runsWrapped) return;
        // ช่องวันที่แยกมาอยู่เกินความยาวรอบ — ให้โผล่ในตัวกรองวัน/ดรอปดาวน์ด้วย
        const dl = MultiRoute.dayList;
        const fn = function () {
            const base = dl.apply(this, arguments);
            const extra = new Set();
            Object.keys(State.db.routes || {}).forEach(rt => listOf(rt).forEach(s => {
                if (s.runOf) Object.keys(s.runOf).forEach(k => { if (!base.includes(k) && (s.days || []).includes(k)) extra.add(k); });
            }));
            return extra.size ? base.concat([...extra].sort((a, b) => dayNum(a) - dayNum(b))) : base;
        };
        fn._runsWrapped = true;
        MultiRoute.dayList = fn;
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 900));
    // ห่อหน้าต่างลำดับคิวทีหลังสุด (ไฟล์อื่นห่อ UI.showDayModal ไว้ก่อนแล้ว)
    const wrapDay = () => {
        if (typeof UI === 'undefined' || !UI.showDayModal) return setTimeout(wrapDay, 500);
        if (UI.showDayModal._runsRm) return;
        const prev = UI.showDayModal;
        const fn = function (d) { const r = prev.apply(this, arguments); try { decorateDay(d); } catch (e) { console.warn('[Runs.rm1]', e); } return r; };
        fn._runsRm = true;
        UI.showDayModal = fn;
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(wrapDay, 2500));

    return {
        _memoClear: memoClear,
        // คำนวณ
        removeSel, selIn, removeChecked, removeOne, removeDayOnly, _rmToggle(slot, o) { rmOpen = o ? slot : (rmOpen === slot ? '' : rmOpen); },
        cycleOf, isShort, isHoliday, workEnd, endDate, calDates, potential, datesOf, fqOf, sigOf,
        metaOf, isDetached, detachedOf, daysOf, planRoute, holidayHits, clashes, tagOf, onceRun,
        version: () => ver, bump,
        // แก้ไข
        detach, rejoin, setDate, setOnce, setFq, resetAll,
        // หน้าจอ
        open, close, askRejoin, go,
        _iso: iso, _parse: parse, _short: short, _dlist: dlist,
    };
})();
window.Runs = Runs;

// V0.9.1: ล้างแคชของ Runs ทุกครั้งที่เริ่มวาดจอ / บันทึก — ข้อมูลที่เพิ่งแก้ในงานเดียวกันจะไม่ค้าง
(function hookRunsMemo() {
    const go = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof App === 'undefined' || !App.saveDB) return setTimeout(go, 300);
        if (UI._runsMemoHook) return;
        UI._runsMemoHook = true;
        const r0 = UI.render;
        UI.render = function () { try { Runs._memoClear(); } catch (e) {} return r0.apply(this, arguments); };
        const s0 = App.saveDB;
        App.saveDB = function () { try { Runs._memoClear(); } catch (e) {} return s0.apply(this, arguments); };
        // ห่อซ้ำเป็นชั้นนอกสุดหลังโมดูลอื่นห่อครบ — ตัวห่อที่ทำงานก่อนวาดจอก็ได้ข้อมูลล่าสุด
        setTimeout(() => {
            const r1 = UI.render;
            UI.render = function () { try { Runs._memoClear(); } catch (e) {} return r1.apply(this, arguments); };
        }, 9000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(go, 0)); else setTimeout(go, 0);
})();

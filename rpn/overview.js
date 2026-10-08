/* =============================================================================
 *  overview.js — หน้า "ภาพรวมแผน" (เมนูซ้าย)
 * =============================================================================
 *  ใช้ 2 จังหวะ: เปิดมาหลังนำเข้าเพื่อดูว่าแผนเดิมหน้าตายังไง · และก่อนกดส่งออกเพื่อตรวจ
 *  มี 4 ส่วน
 *    1) ตัวเลขสรุป — ร้านค้าทั้งหมด / ร้านในแผน / รอจัดสาย / ครั้งเข้าเยี่ยม / F2 / วันทำงาน   (V0.7.2)
 *    2) ปฏิทินเดือนจริง — ช่องวันที่ 1-31 บอกป้ายวัน ชื่อตลาด จำนวนร้าน สีเข้มตามภาระงาน
 *    3) ตารางรายสาย — Working Day · Coverage · Visit · Re-Visit · Visit/Day (V0.8.2: Visit ÷ Working Day)
 *       + เทียบกับเดือนที่นำเข้าจากระบบล่าสุด: Diff · ย้ายเข้า · ย้ายออก · Remove · ร้านใหม่
 *    ดูได้ทีละหลายสาย (ติ๊กเลือก) — ไม่เลือก = ทุกสาย
 *    4) รายการที่ต้องแก้ — กดแล้วเด้งไปหน้าจัดสายตรงจุดนั้น
 * ========================================================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const UNASSIGNED = 'รอจัดสาย';
    const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const WD = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];        // จันทร์เป็นต้นสัปดาห์

    let scope = '__all';        // '__all' | ชื่อสาย (เลือกสายเดียว) | '__multi' — คำนวณจาก picked
    let picked = new Set();     // V0.7.2: สายที่ติ๊กเลือก (ว่าง = ทุกสาย)
    let pickOpen = false;
    let none = false;           // V0.7.5: กด "ล้างค่า" = ไม่เลือกสายไหนเลย (ต่างจาก picked ว่าง = ทุกสาย)

    const ymParts = () => {
        const ym = (typeof App !== 'undefined' && App._currentPlanYM) || '';
        const [y, m] = String(ym).split('_').map(Number);
        return (y && m) ? { y, m0: m - 1, ym } : null;
    };

    const routes = () => Object.keys((State.db && State.db.routes) || {})
        .filter(r => r !== UNASSIGNED)
        .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));

    /** สายที่ติ๊กไว้ → scope (ไม่ติ๊กเลย หรือติ๊กครบ = ทุกสาย) */
    const syncScope = () => {
        const all = routes();
        const p = [...picked].filter(r => all.includes(r));
        picked = new Set(p);
        if (none && !p.length) { scope = '__none'; return; }
        none = false;
        scope = (!p.length || p.length === all.length) ? '__all' : (p.length === 1 ? p[0] : '__multi');
    };
    const scopeRoutes = () => { syncScope(); return scope === '__all' ? routes() : scope === '__none' ? [] : routes().filter(r => picked.has(r)); };

    /** รายการเดือนที่มีแผน — อ่านจาก dropdown หลักตัวเดียวกัน จะได้ไม่มีสองความจริง */
    const monthOptions = () => {
        const sel = $('plan-selector');
        const out = sel ? [...sel.options].map(o => o.value).filter(Boolean) : [];
        const cur = (typeof App !== 'undefined' && App._currentPlanYM) || '';
        if (cur && !out.includes(cur)) out.unshift(cur);
        return out;
    };
    const ymLabel = (ym) => {
        const [y, m] = String(ym).split('_').map(Number);
        return (y && m) ? TH_MON[m - 1] + ' ' + (y + 543) : ym;
    };

    /**
     * พาไปหน้าจัดสายแบบ "ยิงตรง": เปิดเฉพาะสายที่เกี่ยว ล้างตัวกรองวัน เลือกร้านชุดนั้นไว้ให้ ซูมแผนที่ไปหา
     * ids ว่าง = แค่เปิดสาย
     */
    const focus = (rts, ids, opts) => {
        opts = opts || {};
        Nav.go('planning');
        const want = [...new Set(rts || [])];
        try {
            if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen && want.length) {
                MultiRoute.allDays && MultiRoute.allDays();
                MultiRoute.setOpen(want);
            }
        } catch (e) {}
        setTimeout(() => {
            try {
                const set = new Set((ids || []).map(String));
                if (set.size) {
                    (State.stores || []).forEach(s => { s.selected = set.has(String(s.id)); });
                    const pts = (State.stores || []).filter(s => s.selected && isFinite(+s.lat) && isFinite(+s.lng) && +s.lat !== 0)
                        .map(s => [+s.lat, +s.lng]);
                    if (pts.length && typeof MapCtrl !== 'undefined' && MapCtrl.map && typeof L !== 'undefined')
                        MapCtrl.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
                    UI.switchTab && UI.switchTab('tab2');
                }
                if (opts.chip) { const c = $('chip-' + opts.chip); if (c) c.click(); }
                UI.render();
                if (set.size) UI.showSaveToast(`📌 เลือกไว้ ${set.size.toLocaleString()} ร้าน${opts.note ? ' — ' + opts.note : ''}`);
            } catch (e) { console.warn('[Overview.focus]', e); }
        }, 450);
    };

    /** ปฏิทินของทั้งเดือน: วันที่ -> [{route, day, market, n}] */
    const monthMap = () => {
        const p = ymParts();
        if (!p) return { cells: {}, last: 30 };
        const last = new Date(p.y, p.m0 + 1, 0).getDate();
        const cells = {};
        scopeRoutes().forEach(rt => {
            const list = (State.db.routes[rt] || []).filter(s => !s.inactive);
            const byDay = {};
            list.forEach(s => (s.days || []).forEach(d => {
                (byDay[d] || (byDay[d] = { n: 0, mk: {} })).n++;
                if (s.marketName) byDay[d].mk[s.marketName] = (byDay[d].mk[s.marketName] || 0) + 1;
            }));
            Object.keys(byDay).forEach(d => {
                let dates = [];
                try {
                    if (typeof DmsExport !== 'undefined' && DmsExport.datesOf) dates = DmsExport.datesOf(rt, d) || [];
                } catch (e) {}
                // ตลาดที่วิ่งรอบเดียวแต่ปฏิทินให้หลายช่อง — เอาเฉพาะช่องแรก
                let runs = dates.length;
                try { if (typeof Freq !== 'undefined' && Freq.runsOf) runs = Freq.runsOf(rt, d); } catch (e) {}
                dates.slice(0, Math.max(1, runs)).forEach(dt => {
                    if (!dt || dt.getMonth() !== p.m0) return;
                    const k = dt.getDate();
                    const top = Object.entries(byDay[d].mk).sort((a, b) => b[1] - a[1])[0];
                    (cells[k] || (cells[k] = [])).push({ route: rt, day: d, n: byDay[d].n, market: top ? top[0] : '' });
                });
            });
        });
        return { cells, last, y: p.y, m0: p.m0 };
    };

    /**
     * วันหยุดที่จะโชว์บนปฏิทิน — ต้องเป็นวันหยุด "ของทุกสายในขอบเขตที่ดูอยู่" เท่านั้น
     * (ถ้าดูทุกสายรวม แล้วมีแค่สายเดียวที่หยุดวันนั้น สายอื่นยังวิ่ง ไม่ใช่วันหยุดของศูนย์)
     */
    const holidayInfo = () => {
        const rs = scopeRoutes();
        const cfgs = rs.map(rt => (State.db.routeCal || {})[rt]).filter(Boolean);
        if (!cfgs.length) {
            const c = State.db.calendarConfig || {};
            return { weekly: c.weeklyHolidays || [], adhoc: c.holidays || [] };
        }
        const inter = (arrs) => arrs.reduce((a, b) => a.filter(x => b.includes(x)));
        return {
            weekly: inter(cfgs.map(c => c.weeklyHolidays || [])),
            adhoc: inter(cfgs.map(c => c.holidays || [])),
        };
    };

    const stats = () => {
        const rs = scopeRoutes();
        const rows = rs.map(rt => (typeof Coverage !== 'undefined' ? Coverage.statOf(rt) : null)).filter(Boolean);
        const t = rows.reduce((a, r) => ({
            cover: a.cover + r.cover, visits: a.visits + r.visits, f2: a.f2 + r.f2,
            beats: a.beats + r.beats, noDay: a.noDay + r.noDay, workDays: a.workDays + (r.workDays || 0),
        }), { cover: 0, visits: 0, f2: 0, beats: 0, noDay: 0, workDays: 0 });
        // วันทำงานของศูนย์ = จำนวนวันที่ในเดือนที่มีสายไหนวิ่งอย่างน้อยหนึ่งสาย (ใช้หารเฉลี่ยต่อวันตอนดูรวม)
        let calDays = 0;
        const wdOf = {};                 // V0.7.2: วันทำงานรายสาย = วันที่สายนั้นมีการเข้าเยี่ยม (นับตรง ๆ)
        try {
            const cells = monthMap().cells;
            calDays = Object.keys(cells).length;
            Object.values(cells).forEach(list => new Set(list.map(x => x.route)).forEach(rt => { wdOf[rt] = (wdOf[rt] || 0) + 1; }));
        } catch (e) {}
        const park = (State.db.routes[UNASSIGNED] || []).filter(s => !s.inactive).length;
        return { rows, ...t, calDays, wdOf, park, base: t.cover + t.noDay + (scope === '__all' ? park : 0) };
    };

    /** รายการที่ต้องแก้ (block = ต้องแก้ก่อนส่งออก) และข้อสังเกต (info) */
    const issues = () => {
        const out = [];
        const rs = scopeRoutes();
        const park = (State.db.routes[UNASSIGNED] || []).filter(s => !s.inactive);
        if (scope === '__all' && park.length)
            out.push({ t: `${park.length.toLocaleString()} ร้านยังไม่มีสาย`, s: 'อยู่ในกอง "รอจัดสาย" — ยังไม่ถูกนับเป็น Coverage · กดแล้วเปิดกองนั้นและเลือกไว้ให้ทั้งชุด',
                       go: () => focus([UNASSIGNED], park.map(s => s.id), { note: 'ย้ายเข้าสายด้วยปุ่มย้ายสาย หรือแบ่งกลุ่มแล้ว Assign ใหม่' }) });
        const noDay = [], noDayRt = new Set(), noGeo = [], noGeoRt = new Set();
        rs.forEach(rt => (State.db.routes[rt] || []).forEach(s => {
            if (s.inactive) return;
            if (!(s.days || []).length) { noDay.push(s.id); noDayRt.add(rt); }
            if (!isFinite(+s.lat) || !isFinite(+s.lng) || (+s.lat === 0 && +s.lng === 0)) { noGeo.push(s.id); noGeoRt.add(rt); }
        }));
        if (noDay.length) out.push({
            t: `${noDay.length.toLocaleString()} ร้านมีสายแล้วแต่ยังไม่มีวัน`,
            s: `ใน ${noDayRt.size} สาย — ต้องจัดวันก่อน ไม่งั้นจะไม่อยู่ในไฟล์ส่งออก · กดแล้วเปิดสายเหล่านั้นและเลือกร้านไว้ให้`,
            go: () => focus([...noDayRt], noDay, { chip: 'wait', note: 'เลือกวันด้านบนแล้วกด "จัดลงวัน" หรือใช้แบ่งกลุ่ม' }),
        });
        if (noGeo.length) out.push({
            t: `${noGeo.length.toLocaleString()} ร้านไม่มีพิกัด`, s: 'ขึ้นแผนที่ไม่ได้ ต้องแก้ที่ Customer Master · กดเพื่อดูว่าร้านไหน (แก้ที่นี่ไม่ได้)',
            view: true, go: () => focus([...noGeoRt], noGeo, { note: 'ร้านพวกนี้ไม่มีหมุด ดูได้จากรายการด้านขวา' }),
        });
        // วันที่ไม่มีร้าน
        rs.forEach(rt => {
            const st = typeof Coverage !== 'undefined' ? Coverage.statOf(rt) : null;
            if (!st || !st.beats) return;
            const k = (typeof Freq !== 'undefined' && Freq._cycleOf) ? Freq._cycleOf(rt) : 24;
            const miss = [];
            for (let i = 1; i <= k; i++) if (!st.byDay['Day ' + i]) miss.push('D' + i);
            // V0.9.5: นับเป็นวันตามปฏิทิน — D9 ในรอบ 12 วันตกเดือนละ 2 ครั้ง = ว่าง 2 วัน (เดิมนับ 1 ช่อง)
            let nDate = 0;
            const det = miss.map(d => {
                let ds = [];
                try { ds = (typeof Runs !== 'undefined' && Runs.calDates) ? (Runs.calDates(rt, 'Day ' + d.slice(1)) || []).filter(Boolean) : []; } catch (e) {}
                nDate += ds.length || 1;
                const sh = (x) => (Runs._short ? Runs._short(x) : x.getDate() + '/' + (x.getMonth() + 1));
                return ds.length ? `${d} (${ds.map(sh).join(', ')})` : d;
            });
            if (miss.length) out.push({
                t: `${esc(rt)} มีวันว่าง ${nDate} วัน`
                    + (nDate !== miss.length ? ` <span class="text-[11px] font-bold text-gray-400">· ${miss.length} ตลาด (${miss.join(' ')})</span>` : ''),
                s: det.join(' · ') + ' — ไม่มีร้านในวันนั้น · กดแล้วเปิดสายนี้',
                go: () => focus([rt], []),
            });
        });
        // ปฏิทินยังไม่ตั้ง
        const noCal = rs.filter(rt => !(State.db.routeCal || {})[rt]
            && !(State.db.calendarConfig && (State.db.calendarConfig.mode || State.db.calendarConfig.mapping)));
        if (noCal.length) out.push({ t: `${noCal.length} สายยังไม่ได้ตั้งปฏิทิน`, s: noCal.slice(0, 6).join(' ') + (noCal.length > 6 ? ' …' : ''),
            go: () => { Nav.go('planning'); setTimeout(() => { try { CalendarAdmin.open(App._currentPlanYM); } catch (e) {} }, 400); } });
        // F2 ระยะห่างผิดปกติ
        const odd = [], oddRt = new Set();
        rs.forEach(rt => (State.db.routes[rt] || []).forEach(s => {
            if (s.inactive || (s.days || []).length !== 2) return;
            if (typeof Freq !== 'undefined' && Freq.canonical && !Freq.canonical(s) && !s.f2custom) { odd.push(s.id); oddRt.add(rt); }
        }));
        if (odd.length) out.push({
            t: `${odd.length} ร้าน F2 ระยะห่างไม่ใช่ครึ่งรอบ`, s: 'อาจเกิดจากย้ายวันแล้วเงาไม่ตาม · กดเพื่อดู แล้วแก้ที่ popup หมุด (แถวความถี่)',
            view: true, go: () => focus([...oddRt], odd),
        });
        // ร้านค้างจากรอบที่สั้นลง (ยกยอดเดือนแล้วเปลี่ยนความยาวรอบ)
        try {
            if (typeof Month !== 'undefined' && Month.cycleCheck) {
                const c = Month.cycleCheck();
                const st = c.stranded.filter(x => rs.includes(x.rt)).length;
                if (st) out.push({
                    t: `${st.toLocaleString()} ร้านอยู่วันที่เกินรอบของสาย`,
                    s: 'เกิดตอนรอบสั้นลงหลังยกยอดเดือน — กดเพื่อวนกลับมาต้นรอบให้อัตโนมัติ',
                    go: () => Month.fixCycle(),
                });
            }
        } catch (e) {}

        // ครั้งเข้าเยี่ยมที่ตรงวันหยุด (รอบสั้น +14 วันไปตกวันหยุด หรือครั้งที่แยกมาตั้งวันเป็นวันหยุด)
        try {
            if (typeof Runs !== 'undefined' && Runs.holidayHits) {
                const hol = Runs.holidayHits(rs);
                if (hol.length) {
                    const h0 = hol[0];
                    out.push({
                        t: `${hol.length} ครั้งเข้าเยี่ยมตรงวันหยุด`,
                        s: hol.slice(0, 5).map(h => `${h.route} ${h.day.replace('Day ', 'D')} ครั้งที่ ${h.k} (${Runs._short(h.date)})`).join(' · ')
                            + (hol.length > 5 ? ' …' : '') + ' — กดแล้วเปิดตลาดแรก กด "แก้ครั้งนี้" แล้วเลื่อนวัน',
                        go: () => Runs.open(h0.route, h0.day),
                    });
                }
            }
        } catch (e) {}

        // V0.7.1: ร้านย้ายเซลล์แต่ยังไม่นำเข้า Geo Tree — ส่งออก zip ไม่ได้จนกว่าจะนำเข้า
        try {
            if (window.GeoTree) {
                if (GeoTree._center !== (window.CENTER_DOC || '') && !GeoTree._ensuring) {
                    GeoTree._ensuring = true;
                    GeoTree.ensure().then(() => { GeoTree._ensuring = false; try { if (window.PlanOverview) PlanOverview.render(); } catch (e) {} });
                } else if (GeoTree.blocked()) {
                    const mv = GeoTree.pre();
                    out.push({
                        t: `${mv.length} ร้านย้ายเซลล์ — ต้องนำเข้า CUSTOMER_GEO_TREE`, lock: true,
                        s: mv.slice(0, 4).map(x => `${x.c} ${x.from || 'ใหม่'}→${x.route}`).join(' · ') + (mv.length > 4 ? ' …' : '')
                            + ' — Salesman Code เดิม ≠ สายหลังจัด · กดแล้วเปิดหน้าต่างส่งออก DMS เพื่อนำเข้า Geo Tree',
                        go: () => DmsExport.open(),
                    });
                }
            }
        } catch (e) {}

        // ตลาดชนกัน: สายเดียววันเดียวมีมากกว่า 1 ตลาด
        try {
            if (typeof Runs !== 'undefined' && Runs.clashes) {
                const cl = Runs.clashes(rs);
                if (cl.length) {
                    const c0 = cl[0];
                    const rts = [...new Set(cl.map(c => c.route))];
                    out.push({
                        t: `${cl.length} วันที่สายเดียวมี 2 ตลาด (${rts.length} สาย)`,
                        s: cl.slice(0, 4).map(c => `${c.route} ${Runs._short(c.date)}: ${c.days.map(d => d.replace('Day ', 'D')).join('+')}`).join(' · ')
                            + (cl.length > 4 ? ' …' : '') + ' — มักเกิดจากวันหยุดทำให้รอบแรกเลื่อน แต่ครั้งที่ 2 ยังเป็น +14 · กดแล้วเปิดตลาดแรก',
                        go: () => Runs.open(c0.route, c0.days[c0.days.length - 1]),
                    });
                }
            }
        } catch (e) {}

        // V0.7.11: ภาระงานต่อวันของสาย Pre (P) / Van (V) — ร้านที่ต้องเข้าในวันนั้น < 15 หรือ > 45
        //   นับตามวันที่จริงในปฏิทิน (สายเดียววันเดียวมี 2 ตลาด = รวมกัน) · สาย C / E / อื่น ๆ ไม่ตรวจ
        try {
            const MIN = 15, MAX = 45;
            const p = ymParts();
            const isPV = (rt) => /^\d{3}[PV]\d/i.test(String(rt || ''));
            const per = {};
            Object.entries(monthMap().cells).forEach(([k, list]) => list.forEach(x => {
                if (!isPV(x.route)) return;
                const o = per[x.route + '|' + k] || (per[x.route + '|' + k] = { rt: x.route, d: +k, n: 0, days: [] });
                o.n += x.n; o.days.push(x.day);
            }));
            const all = Object.values(per);
            const lbl = (o) => `${o.rt} ${o.d} ${p ? TH_MON[p.m0] : ''} (${o.days.map(d => d.replace('Day ', 'D')).join('+')}) ${o.n} ร้าน`;
            const openDay = (o) => () => {
                Nav.go('planning');
                try { if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen) { MultiRoute.allDays && MultiRoute.allDays(); MultiRoute.setOpen([o.rt]); } } catch (e) {}
                setTimeout(() => { try { MultiRoute.openDay(o.rt, o.days[0]); } catch (e) {} }, 500);
            };
            const push = (arr, word, tip) => {
                if (!arr.length) return;
                const rts = new Set(arr.map(o => o.rt));
                out.push({
                    t: `${arr.length} วัน${rts.size > 1 ? ` (${rts.size} สาย)` : ''} ร้าน${word} — สาย Pre / Van`,
                    s: arr.slice(0, 5).map(lbl).join(' · ') + (arr.length > 5 ? ' …' : '') + ' — ' + tip,
                    go: openDay(arr[0]),
                });
            };
            push(all.filter(o => o.n > MAX).sort((a, b) => b.n - a.n), `เกิน ${MAX} ร้าน/วัน`, 'เกลี่ยไปวันที่เบา หรือแบ่งกลุ่ม · กดแล้วเปิดวันที่หนักสุด');
            push(all.filter(o => o.n < MIN).sort((a, b) => a.n - b.n), `ต่ำกว่า ${MIN} ร้าน/วัน`, 'รวมกับวันอื่น หรือเพิ่มร้านเข้าวันนั้น · กดแล้วเปิดวันที่เบาสุด');
        } catch (e) { console.warn('[Overview.load]', e); }

        // ── ข้อสังเกต (ไม่บล็อกการส่งออก) ──
        // วันทำงานเดือนนี้มากกว่าความยาวรอบ → ช่องวันต้นรอบตก 2 วันที่ → เลือกได้ว่าวิ่ง 1 หรือ 2 ครั้ง
        try {
            if (typeof DmsExport !== 'undefined' && DmsExport.datesOf) {
                const groups = {};
                rs.forEach(rt => {
                    if (typeof Runs !== 'undefined' && Runs.isShort(rt)) return;   // รอบสั้นวิ่งหลายครั้งต่อเดือนเป็นปกติ
                    const k = (typeof Freq !== 'undefined' && Freq._cycleOf) ? Freq._cycleOf(rt) : (State.db.cycleDays || 24);
                    const dbl = [];
                    let work = 0;
                    for (let i = 1; i <= k; i++) {
                        const d = (typeof Runs !== 'undefined') ? Runs.potential(rt, 'Day ' + i).map(p => p.date)
                                                                 : (DmsExport.datesOf(rt, 'Day ' + i) || []);
                        work += d.length;
                        if (d.length >= 2) dbl.push('D' + i);
                    }
                    if (!dbl.length || work <= k) return;
                    const key = k + '|' + work + '|' + dbl.join(' ');
                    (groups[key] || (groups[key] = { k, work, dbl, rts: [] })).rts.push(rt);
                });
                Object.values(groups).forEach(g => {
                    const on = g.rts.filter(rt => g.dbl.some(d => {
                        try { return Freq.beatFreqOf(rt, 'Day ' + d.slice(1)) === 'F2'; } catch (e) { return false; }
                    })).length;
                    out.push({
                        info: true,
                        t: `${g.rts.length} สาย มีวันทำงาน ${g.work} วัน เกินรอบ ${g.k} วัน`,
                        s: `ตลาด ${g.dbl.join(' ')} ตก 2 วันที่ในเดือนนี้ — ตั้งไว้ "วิ่งทุกครั้ง" ${on} สาย (ส่งออกเป็น CY แบบ 9 ครั้งละ 1 CY) · ที่เหลือวิ่งครั้งเดียว — เปลี่ยนได้ที่ปุ่มวันที่บนหัวตลาด`,
                        go: () => focus(g.rts, []),
                    });
                });
            }
        } catch (e) {}
        return out;
    };

    // ── วาดหน้า ─────────────────────────────────────────────────────────
    const kpi = (label, val, sub, color) => `
        <div class="bg-white border border-gray-200 rounded-2xl px-3 py-2.5 shadow-sm">
            <p class="text-[10.5px] font-bold text-gray-400 leading-tight">${label}</p>
            <p class="text-[22px] font-black leading-tight ${color || 'text-gray-800'}">${val}</p>
            <p class="text-[9.5px] text-gray-400 leading-tight">${sub || ''}</p>
        </div>`;

    /** อธิบายปฏิทินที่มีผลจริงกับสายในขอบเขต — ตอบคำถาม "ตั้งหยุดอาทิตย์ ทำไมออกมาเป็นเสาร์" ได้ทันที */
    const calInfoHTML = () => {
        const WDN = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
        const describe = (c) => {
            if (!c || !(c.mode || c.mapping)) return 'ยังไม่ได้ตั้งปฏิทิน (Day N = วันที่ N)';
            const wk = (c.weeklyHolidays || []).map(i => WDN[i]).join(' ') || 'ไม่มี';
            const ad = (c.holidays || []).length ? c.holidays.join(', ') : '—';
            const st = c.startDay ? `วันที่ ${c.startDay} = D${c.startDayNum || 1}` : (c.anchorType || '');
            return `${st} · รอบ ${c.cycleDays || State.db.cycleDays || 24} วัน · หยุดประจำ: <b>${esc(wk)}</b> · หยุดเฉพาะกิจ: ${esc(ad)}`;
        };
        const rc = State.db.routeCal || {};
        const month = State.db.calendarConfig;
        if (scope !== '__all' && scope !== '__multi') {
            const ov = rc[scope];
            return ov
                ? `<span class="text-amber-700">🚚 ใช้ปฏิทิน<b>เฉพาะสาย ${esc(scope)}</b> (ค่าของเดือนไม่มีผล)</span> — ${describe(ov)}
                   <button onclick="PlanOverview.openCal('${esc(scope)}')" class="ml-1 text-indigo-600 font-bold hover:underline">ตั้งค่า →</button>`
                : `🏢 ใช้ปฏิทินระดับเดือน — ${describe(month)}
                   <button onclick="PlanOverview.openCal()" class="ml-1 text-indigo-600 font-bold hover:underline">ตั้งค่า →</button>`;
        }
        const ovs = scopeRoutes().filter(r => rc[r]);
        return `🏢 ปฏิทินระดับเดือน — ${describe(month)}`
            + (ovs.length ? ` <span class="text-amber-700">· <b>${ovs.length} สาย</b>ใช้ปฏิทินเฉพาะสายแทน (${ovs.slice(0, 5).map(esc).join(', ')}${ovs.length > 5 ? ' …' : ''}) — เลือกดูรายสายเพื่อเห็นของสายนั้น</span>` : '')
            + ` <button onclick="PlanOverview.openCal()" class="ml-1 text-indigo-600 font-bold hover:underline">ตั้งค่า →</button>`;
    };

    const calendarHTML = () => {
        const p = ymParts();
        if (!p) return '<p class="text-xs text-gray-400">ยังไม่ได้เลือกเดือน</p>';
        const { cells, last } = monthMap();
        const hol = holidayInfo();
        const nums = Object.values(cells).map(a => a.reduce((t, x) => t + x.n, 0));
        const mx = nums.length ? Math.max(...nums) : 0;
        const first = new Date(p.y, p.m0, 1);
        const lead = (first.getDay() + 6) % 7;          // จันทร์ = 0
        let html = '<div class="grid grid-cols-7 gap-1">';
        WD.forEach(w => { html += `<div class="text-center text-[11px] font-bold text-gray-400 py-0.5">${w}</div>`; });
        for (let i = 0; i < lead; i++) html += '<div></div>';
        for (let d = 1; d <= last; d++) {
            const dt = new Date(p.y, p.m0, d);
            const isWk = hol.weekly.includes(dt.getDay());
            const isAd = hol.adhoc.includes(d);
            const list = cells[d] || [];
            const n = list.reduce((t, x) => t + x.n, 0);
            const heat = mx ? Math.min(1, n / mx) : 0;
            const bg = n ? `background:rgba(99,102,241,${(0.08 + heat * 0.45).toFixed(3)})` : '';
            const off = (isWk || isAd) && !n;
            const showHol = isAd && !n;            // มีร้านอยู่ = วันนั้นยังวิ่ง ไม่ต้องติดป้ายหยุด
            const tags = [...new Set(list.map(x => 'D' + dayNum(x.day)))].slice(0, 3).join(' ');
            const mk = list.length === 1 ? list[0].market : (list.length > 1 ? list.length + ' สาย' : '');
            html += `<div class="rounded-lg border ${off ? 'border-gray-100 bg-gray-50' : 'border-gray-200'} px-1.5 py-1 min-h-[72px] flex flex-col"
                          style="${bg}" title="${esc(tags)} ${esc(mk)}${n ? ' · ' + n + ' ร้าน' : ''}">
                <div class="flex items-center gap-1">
                  <span class="text-[16px] font-black leading-none ${off ? 'text-gray-300' : 'text-gray-900'}">${d}</span>
                  ${showHol ? '<span class="text-[10px] font-bold text-red-500">หยุด</span>' : ''}
                </div>
                <div class="flex items-baseline gap-1 mt-0.5">
                  <span class="text-[12px] font-black text-gray-700 leading-tight truncate">${esc(tags)}</span>
                  ${n ? `<span class="ml-auto text-[14px] font-black leading-tight tabular-nums text-indigo-800">${n}</span>` : ''}
                </div>
                <div class="text-[10.5px] text-gray-500 leading-tight truncate">${esc(mk)}</div>
            </div>`;
        }
        html += '</div>';
        return html;
    };

    // V0.9.0: ตารางรายวัน สาย × วันที่ (แบบ Pivot) — เตือนร้านต่อวันเฉพาะสาย P/V · สาย C / E ไม่เตือน
    const LOAD_MIN = 15, LOAD_MAX = 45;
    const isPVRoute = (rt) => /^\d{3}[PV]\d/i.test(String(rt || ''));
    const holOf = (rt) => {
        const c = (State.db.routeCal || {})[rt] || State.db.calendarConfig || {};
        return { weekly: c.weeklyHolidays || [], adhoc: (c.holidays || []).map(Number) };
    };
    const dailyData = () => {
        const p = ymParts();
        if (!p) return null;
        const { cells, last } = monthMap();
        const rows = {};
        Object.entries(cells).forEach(([k, list]) => list.forEach(x => {
            const r = rows[x.route] || (rows[x.route] = {});
            const o = r[k] || (r[k] = { n: 0, days: [] });
            o.n += x.n; o.days.push(x.day);
        }));
        const rts = scopeRoutes().filter(rt => rt !== UNASSIGNED).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
        return { p, last, rows, rts };
    };
    const dailyGridHTML = () => {
        const D = dailyData();
        if (!D || !D.rts.length) return '<p class="text-[11px] text-gray-400">ยังไม่มีข้อมูล</p>';
        const { p, last, rows, rts } = D;
        const EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const td = 'padding:2px 3px;text-align:center;border:1px solid #e5e7eb;min-width:28px;font-variant-numeric:tabular-nums';
        const stick = 'position:sticky;left:0;z-index:1;';
        let h1 = `<th style="${stick}background:#1f3864;color:#fff;${td}" rowspan="2">สาย</th>`, h2 = '';
        for (let d = 1; d <= last; d++) {
            const wd = new Date(p.y, p.m0, d).getDay();
            const bg = wd === 0 ? '#c00000' : '#1f3864';
            h1 += `<th style="${td};background:${bg};color:#fff;font-size:10px">${EN[wd]}</th>`;
            h2 += `<th style="${td};background:${bg};color:#fff">${d}</th>`;
        }
        h1 += `<th style="${td};background:#1f3864;color:#fff" rowspan="2">Total</th>`;
        const colT = {}; let grand = 0;
        window.__ovGrid = {};
        const body = rts.map(rt => {
            const hol = holOf(rt), pv = isPVRoute(rt), r = rows[rt] || {};
            let tot = 0, cellsH = '';
            for (let d = 1; d <= last; d++) {
                const o = r[d], n = o ? o.n : 0;
                const isHol = hol.weekly.includes(new Date(p.y, p.m0, d).getDay()) || hol.adhoc.includes(d);
                let st = '', txt = '';
                if (n) {
                    tot += n; colT[d] = (colT[d] || 0) + n;
                    window.__ovGrid[rt + '|' + d] = o.days;
                    const low = pv && n < LOAD_MIN, high = pv && n > LOAD_MAX;
                    st = isHol ? 'background:#9ca3af;color:#fff;font-weight:700'
                       : high ? 'background:#fecaca;color:#991b1b;font-weight:800'
                       : low ? 'background:#fed7aa;color:#9a3412;font-weight:800' : '';
                    const tip = `${rt} ${d} ${TH_MON[p.m0]} · ${o.days.map(x => x.replace('Day ', 'D')).join('+')} · ${n} ร้าน`
                        + (isHol ? ' · ⚠️ ตรงวันหยุด' : high ? ` · เกิน ${LOAD_MAX}` : low ? ` · ต่ำกว่า ${LOAD_MIN}` : '');
                    txt = `<button onclick="PlanOverview.goDay('${esc(rt)}',${d})" title="${esc(tip)}"
                              style="all:unset;cursor:pointer;display:block;width:100%">${n}${isHol ? '⚠️' : ''}</button>`;
                } else {
                    st = isHol ? 'background:#9ca3af' : 'background:#f3f4f6';
                }
                cellsH += `<td style="${td};${st}">${txt}</td>`;
            }
            grand += tot;
            return `<tr><td style="${stick}background:#fff;${td};text-align:left;font-weight:800;font-family:monospace">${esc(rt)}</td>${cellsH}
                    <td style="${td};font-weight:800">${tot.toLocaleString()}</td></tr>`;
        }).join('');
        let foot = `<td style="${stick}background:#eef2ff;${td};text-align:left;font-weight:900">Total</td>`;
        for (let d = 1; d <= last; d++) foot += `<td style="${td};background:#eef2ff;font-weight:800">${colT[d] ? colT[d].toLocaleString() : ''}</td>`;
        foot += `<td style="${td};background:#eef2ff;font-weight:900">${grand.toLocaleString()}</td>`;
        return `<div class="overflow-x-auto"><table style="border-collapse:collapse;font-size:12px;width:100%">
              <thead><tr>${h1}</tr><tr>${h2}</tr></thead><tbody>${body}<tr>${foot}</tr></tbody></table></div>
            <p class="text-[10.5px] text-gray-500 mt-1 leading-snug">
              <span style="display:inline-block;width:10px;height:10px;background:#f3f4f6;border:1px solid #d1d5db;vertical-align:middle"></span> ไม่เข้าเยี่ยม ·
              <span style="display:inline-block;width:10px;height:10px;background:#9ca3af;vertical-align:middle"></span> วันหยุด (ตัวเลข + ⚠️ = มีเข้าเยี่ยมตรงวันหยุด) ·
              <span style="display:inline-block;width:10px;height:10px;background:#fed7aa;vertical-align:middle"></span> ต่ำกว่า ${LOAD_MIN} ร้าน ·
              <span style="display:inline-block;width:10px;height:10px;background:#fecaca;vertical-align:middle"></span> เกิน ${LOAD_MAX} ร้าน
              — เตือนเฉพาะสาย Pre (P) / Van (V) · สาย C / E ไม่เตือน</p>`;
    };

    const issueRow = (x, i) => `
        <div class="flex items-center gap-2 py-1.5 border-t border-gray-100 first:border-0">
          <div class="flex-1 min-w-0">
            <p class="text-[12px] font-bold text-gray-700 truncate">${x.t}${x.lock ? ' <span class="text-[9.5px] font-black text-white bg-red-600 rounded px-1 align-middle" title="ปุ่มส่งออก zip กดไม่ได้จนกว่าจะแก้ข้อนี้">🔒 ส่งออกไม่ได้จนกว่าจะแก้</span>' : ''}</p>
            <p class="text-[10px] text-gray-400 leading-snug">${esc(x.s)}</p>
          </div>
          ${x.go ? `<button onclick="PlanOverview.jump(${i})"
              class="shrink-0 text-[11px] font-bold px-2 py-1 rounded-lg ${x.view || x.info
                  ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 border border-gray-200'
                  : 'text-white bg-indigo-600 hover:bg-indigo-700'}">${x.view ? 'ไปดู →' : x.info ? 'เปิดสาย →' : 'ไปแก้ →'}</button>` : ''}
        </div>`;

    const render = () => {
        const host = $('page-overview');
        if (!host) return;
        const p = ymParts();
        const s = stats();
        const iss = issues();
        const block = iss.filter(x => !x.info), info = iss.filter(x => x.info);
        const rs = routes();
        // เฉลี่ยต่อวันทำงาน: ดูรายสาย = ครั้ง ÷ วันที่สายนั้นวิ่ง · ดูรวม = ครั้ง ÷ วันที่ศูนย์มีคนวิ่ง
        const freq = s.cover ? (s.visits / s.cover).toFixed(2) : '—';

        host.innerHTML = `
        <div class="h-full overflow-y-auto bg-gray-50 p-4 md:p-5">
          <div class="max-w-5xl mx-auto space-y-4">

            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-black text-gray-800">📋 ภาพรวมแผน</h2>
              <select id="ov-month" onchange="PlanOverview.setMonth(this.value)" title="เลือกเดือนที่ต้องการดู — เปลี่ยนแล้วหน้าจัดสายจะเป็นเดือนเดียวกัน"
                      class="border border-indigo-200 bg-indigo-50 text-indigo-800 rounded-lg px-2 py-1 text-xs font-black">
                ${monthOptions().map(ym => `<option value="${esc(ym)}" ${p && ym === p.ym ? 'selected' : ''}>📅 ${esc(ymLabel(ym))}</option>`).join('')
                  || `<option>${p ? esc(ymLabel(p.ym)) : '—'}</option>`}
              </select>
              <span class="text-xs font-bold text-gray-400">ศูนย์ ${esc((window.CENTER_ID) || '')}</span>
              <div class="ml-auto flex items-center gap-1.5">
                <label class="text-[11px] font-bold text-gray-500">ดู</label>
                ${pickerHTML(rs)}
                <button onclick="PlanOverview.render()" title="คำนวณใหม่"
                        class="border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100">↻</button>
              </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-6 gap-2">
              ${kpi('ร้านค้าทั้งหมด', s.base.toLocaleString(), 'ทั้งหมดที่นำเข้ามา')}
              ${kpi('ร้านในแผน', s.cover.toLocaleString(), 'มีทั้งสายและวันแล้ว', 'text-indigo-700')}
              ${kpi('รอจัดสาย', (s.noDay + (scope === '__all' ? s.park : 0)).toLocaleString(), 'ขาดสายหรือขาดวัน',
                    (s.noDay + s.park) ? 'text-amber-600' : 'text-gray-300')}
              ${kpi('ครั้งเข้าเยี่ยม', s.visits.toLocaleString(), 'ทั้งเดือน (F2 นับ 2)', 'text-emerald-600')}
              ${kpi('Re-Visit', s.f2.toLocaleString(), 'ร้านที่ถูกเข้า ≥ 2 ครั้ง/เดือน', s.f2 ? 'text-red-600' : 'text-gray-300')}
              ${kpi('วันทำงาน', s.calDays || '—', `วันที่มีการเข้าเยี่ยม · ${s.beats} ตลาด · ${freq} ครั้ง/ร้าน`)}
            </div>

            <div class="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
              <div class="flex items-center gap-2 mb-2">
                <h3 class="text-sm font-black text-gray-700">ปฏิทินเดือนนี้</h3>
                <span class="text-[10px] text-gray-400">ตัวเลขข้างป้าย DX = จำนวนร้านที่ต้องเข้าในวันนั้น · สีเข้ม = วันที่หนัก</span>
              </div>
              <p id="ov-calinfo" class="text-[10.5px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 mb-2 leading-snug">${calInfoHTML()}</p>
              ${calendarHTML()}
            </div>

            <div class="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
              <h3 class="text-sm font-black text-gray-700 mb-2">Details by Route <span class="text-[10px] font-normal text-gray-400">· กดที่ตัวเลขเพื่อดูรายชื่อร้าน</span></h3>
              ${routeTable(s)}
            </div>

            <div class="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
              <h3 class="text-sm font-black text-gray-700 mb-1">📅 ตารางรายวัน <span class="text-[10px] font-normal text-gray-400">· จำนวนร้านที่เข้าเยี่ยมแต่ละวัน · กดตัวเลขเพื่อเปิดวันนั้นในหน้าวางแผนคิวงาน</span></h3>
              ${dailyGridHTML()}
            </div>

            <div class="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
              <h3 class="text-sm font-black text-gray-700 mb-2">
                ${block.length ? '⚠️ คำเตือน' : '✅ ไม่มีคำเตือน'}
                <span class="text-[10px] font-bold text-gray-400">${block.length ? block.length + ' เรื่อง' : ''}</span></h3>
              ${block.length ? block.map(x => issueRow(x, iss.indexOf(x))).join('')
                : '<p class="text-[11px] text-gray-400">แผนครบถ้วน พร้อมกดส่งออกได้</p>'}
              ${block.length ? `<p class="text-[10px] text-gray-400 mt-1">ควรตรวจทุกข้อก่อนส่งออก · ข้อที่มีป้าย 🔒 ต้องแก้ก่อน ปุ่มส่งออกถึงจะกดได้ · ข้ออื่นส่งออกได้แต่แผนอาจไม่ตรงที่ตั้งใจ</p>` : ''}
            </div>

            ${info.length ? `<div class="bg-sky-50 border border-sky-200 rounded-2xl p-3 shadow-sm">
              <h3 class="text-sm font-black text-sky-800 mb-2">ℹ️ ข้อสังเกต
                <span class="text-[10px] font-bold text-sky-500">${info.length} เรื่อง · ไม่บล็อกการส่งออก</span></h3>
              ${info.map(x => issueRow(x, iss.indexOf(x))).join('')}
            </div>` : ''}

            <div class="flex flex-wrap gap-2 pb-4">
              <button onclick="Nav.go('planning')"
                class="flex-1 min-w-[140px] bg-gray-900 hover:bg-black text-white py-2.5 rounded-xl text-sm font-bold">📍 ไปหน้าจัดสาย</button>
              <button onclick="DmsExport.open()" title="ไฟล์สำหรับอัปโหลดเข้า DMS (3 ชีท) — V0.9.4 ย้ายมาจากแถบล่างหน้าวางแผนคิวงาน"
                class="flex-1 min-w-[140px] bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm font-bold">📤 Export To DMS</button>
              <button onclick="ExecReport.run()" title="รายงาน Excel พร้อมนำเสนอ (Executive Summary + รายละเอียด + Raw Data) ตามสายที่เลือกดูอยู่"
                class="flex-1 min-w-[140px] bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl text-sm font-bold">📊 Export รายงาน Executive</button>
            </div>
          </div>
        </div>`;
        window.__ovIssues = iss;
    };

    // ── เทียบกับเดือนที่นำเข้าจากระบบล่าสุด (แผนที่ DMS ใช้อยู่) ───────────────────
    let baseCache = { key: '', ym: '', data: null, loading: false };
    const ckey = (s) => String(s.code || s.id || '');
    const loadBase = async () => {
        const cur = (typeof App !== 'undefined' && App._currentPlanYM) || '';
        const key = (window.CENTER_DOC || '') + '|' + cur;
        if (!cur || baseCache.key === key) return;
        baseCache = { key, ym: '', data: null, loading: true };
        let ym = '';
        try {
            const c = (await App.dbRef.get()).data() || {};
            if (c.lastImportYM && c.lastImportYM < cur) ym = c.lastImportYM;
        } catch (e) {}
        const list = (State.db.planList || []).filter(p => p < cur).sort().reverse();
        if (!ym) {
            for (const p of list) {
                try {
                    const d = (await App.planRef(p).get()).data() || {};
                    if (d.importedAt || (d.calendarConfig && d.calendarConfig.source === 'import')) { ym = p; break; }
                } catch (e) {}
            }
            if (!ym && list.length) ym = list[0];
        }
        const data = { route: {}, seen: new Set(), routes: new Set(), info: {} };
        if (ym) {
            try {
                const rs = await App.planRoutesCol(ym).get();
                (rs.docs || []).forEach(doc => {
                    const name = doc.id;
                    ((doc.data() || {}).stores || []).forEach(s => {
                        const c = ckey(s); if (!c) return;
                        data.seen.add(c);
                        if (name !== UNASSIGNED && !s.inactive && (s.days || []).length && !data.route[c]) {
                            data.route[c] = name; data.routes.add(name);
                            data.info[c] = { id: s.id, code: s.code, name: s.name, days: s.days || [], marketName: s.marketName || '', shopType: s.shopType || '' };
                        }
                    });
                });
            } catch (e) { console.warn('[Overview.base]', e); }
        }
        if (baseCache.key !== key) return;
        baseCache = { key, ym, data: ym ? data : null, loading: false };
        const pg = $('page-overview');
        if (pg && !pg.classList.contains('hidden')) { try { render(); } catch (e) {} }
    };
    /** ย้ายเข้า/ย้ายออก/Remove/ร้านใหม่ รายสาย เทียบกับเดือนฐาน — V0.7.5: เก็บรายชื่อร้านด้วย (กดตัวเลขแล้วดูได้)
     *  ร้านในเดือนฐาน (มีสาย+วัน) ตอนนี้อยู่ที่ไหน
     *    สายเดิม มีวัน              → เท่าเดิม
     *    สายอื่น มีวัน              → ย้ายออก (สายเดิม) / ย้ายเข้า (สายใหม่)
     *    กองรอจัดสาย หรือยังไม่มีวัน → ย้ายออก (ยังไม่ได้ลงสาย/วันไหน)
     *    กองออกจากแผน / ไม่มีในข้อมูลแล้ว → Remove */
    const compare = () => {
        const b = baseCache.data;
        if (!b) return null;
        const cur = {}, where = {};
        const all = (State.db.routes || {});
        Object.keys(all).forEach(rt => (all[rt] || []).forEach(s => {
            const c = s && ckey(s); if (!c) return;
            if (rt !== UNASSIGNED && !s.inactive && (s.days || []).length) { if (!cur[c]) { cur[c] = rt; where[c] = { rt, s, st: 'plan' }; } return; }
            if (where[c] && where[c].st === 'plan') return;
            where[c] = { rt, s, st: s.inactive ? 'removed' : rt === UNASSIGNED ? 'parked' : 'noday' };
        }));
        const z = () => ({ base: 0, inn: [], out: [], rem: [], nw: [] });
        const by = {};
        const g = (rt) => by[rt] || (by[rt] = z());
        Object.entries(cur).forEach(([c, rt]) => {
            const was = b.route[c];
            if (was === rt) return;
            const s = where[c].s;
            if (!b.seen.has(c)) g(rt).nw.push({ c, s, to: rt });
            else g(rt).inn.push({ c, s, from: was || 'รอจัดสาย/ไม่มีวัน', to: rt });
        });
        Object.entries(b.route).forEach(([c, was]) => {
            g(was).base++;
            const now = cur[c];
            if (now === was) return;
            const w = where[c];
            const s = (w && w.s) || b.info[c] || { id: c, code: c, name: '' };
            if (now) g(was).out.push({ c, s, from: was, to: now });
            else if (w && w.st === 'parked') g(was).out.push({ c, s, from: was, to: 'กองรอจัดสาย', toRt: UNASSIGNED });
            else if (w && w.st === 'noday') g(was).out.push({ c, s, from: was, to: w.rt === was ? 'รอจัดวัน (สายเดิม)' : w.rt + ' (ยังไม่มีวัน)', toRt: w.rt });
            else g(was).rem.push({ c, s, from: was, to: w ? 'ออกจากแผน' : 'ไม่มีในข้อมูลแล้ว', gone: !w, was: b.info[c] });
        });
        return by;
    };

    // ── V0.7.5: กดตัวเลขในตาราง → รายชื่อร้านโผล่ใต้ตาราง + ปุ่มพาไปแก้ ──────────
    let det = null;                 // { kind, rt } · rt = '__total' คือแถว Grand Total
    const KIND = { cover: 'Coverage', revisit: 'Re-Visit', inn: 'ย้ายเข้า', out: 'ย้ายออก', rem: 'Remove', nw: 'ร้านใหม่' };
    const visitsOf = (s) => { try { return (typeof Freq !== 'undefined' && Freq.visitsOf) ? Freq.visitsOf(s) : (s.days || []).length; } catch (e) { return (s.days || []).length; } };
    const planOf = (rt) => ((State.db.routes || {})[rt] || []).filter(s => s && !s.inactive && (s.days || []).length);
    const daysTxt = (days) => (days || []).slice().sort((a, b) => dayNum(a) - dayNum(b)).map(d => String(d).replace('Day ', 'D')).join('·');

    const detailItems = (cmp, rts) => {
        const k = det.kind;
        if (k === 'cover' || k === 'revisit')
            return rts.flatMap(rt => planOf(rt).filter(s => k === 'cover' || visitsOf(s) >= 2).map(s => ({ c: ckey(s), s, to: rt })));
        return rts.flatMap(rt => ((cmp && cmp[rt]) || {})[k] || []);
    };

    const detailHTML = (cmp, rts) => {
        if (!det) return '';
        const k = det.kind;
        const items = detailItems(cmp, rts)
            .sort((a, b) => String(a.from || a.to || '').localeCompare(String(b.from || b.to || ''), 'th', { numeric: true })
                         || dayNum((a.s.days || [])[0]) - dayNum((b.s.days || [])[0]));
        window.__ovDet = { kind: k, items };
        const scopeTxt = det.rt === '__total' ? 'ทุกสายในตาราง' : 'สาย ' + det.rt;
        const move = k === 'inn' || k === 'out' || k === 'rem' || k === 'nw';
        const canEdit = items.some(x => !x.gone);
        const btn = k === 'rem' ? `🗑️ เปิดกองออกจากแผน (เลือกไว้ ${items.filter(x => !x.gone).length} ร้าน)`
                                : `✏️ ไปแก้ในหน้าวางแผนคิวงาน (เลือกไว้ ${items.length} ร้าน)`;
        const MAX = 400;
        const rows = items.slice(0, MAX).map((x, i) => {
            const s = x.s || {};
            const days = (k === 'rem' && x.was) ? 'เดิม ' + daysTxt(x.was.days) : daysTxt(s.days);
            const vis = k === 'revisit' ? ` <span class="text-red-600 font-bold">×${visitsOf(s)}</span>` : '';
            const path = move ? `${esc(x.from || '—')} <span class="text-gray-400">→</span> <b>${esc(x.to || '—')}</b>` : esc(x.to);
            return `<tr class="border-t border-gray-100">
                <td class="px-2 py-0.5 text-right text-gray-400 tabular-nums">${i + 1}</td>
                <td class="px-2 py-0.5 font-mono text-gray-600">${esc(s.code || s.id || x.c)}</td>
                <td class="px-2 py-0.5 text-gray-800 max-w-[260px] truncate">${esc(s.name || '')}${x.gone ? ' <span class="text-[9px] text-gray-400">(ไม่มีในข้อมูลเดือนนี้)</span>' : ''}</td>
                <td class="px-2 py-0.5 text-gray-600 whitespace-nowrap">${esc(days || '—')}${vis}${s.marketName ? ' <span class="text-gray-400">' + esc(s.marketName) + '</span>' : ''}</td>
                <td class="px-2 py-0.5 whitespace-nowrap font-mono">${path}</td>
              </tr>`;
        }).join('');
        return `
          <div id="ov-detail" class="mt-3 border-2 border-indigo-200 rounded-xl overflow-hidden">
            <div class="flex flex-wrap items-center gap-2 px-3 py-2 bg-indigo-50">
              <span class="text-sm font-black text-indigo-900">${esc(KIND[k])} · ${esc(scopeTxt)}</span>
              <span class="text-xs font-bold text-white bg-indigo-600 rounded px-1.5">${items.length.toLocaleString()} ร้าน</span>
              <div class="flex-1"></div>
              ${canEdit ? `<button onclick="PlanOverview.detailGo()" class="text-xs font-bold px-3 py-1 rounded-lg ${k === 'rem' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white">${btn}</button>` : ''}
              <button onclick="PlanOverview.detail()" title="ปิด" class="text-gray-500 hover:text-gray-800 px-1">✕</button>
            </div>
            ${items.length ? `<div class="max-h-80 overflow-y-auto"><table class="w-full text-[11px]">
              <thead class="sticky top-0 bg-white"><tr class="text-gray-500">
                <th class="px-2 py-1 text-right font-bold">#</th><th class="px-2 py-1 text-left font-bold">รหัส</th>
                <th class="px-2 py-1 text-left font-bold">ชื่อร้าน</th><th class="px-2 py-1 text-left font-bold">วัน / ตลาด</th>
                <th class="px-2 py-1 text-left font-bold">${move ? 'จาก → ไป' : 'สาย'}</th></tr></thead>
              <tbody>${rows}</tbody></table>
              ${items.length > MAX ? `<p class="text-[10px] text-gray-400 px-3 py-1">แสดง ${MAX} ร้านแรก จาก ${items.length.toLocaleString()} ร้าน</p>` : ''}</div>`
              : '<p class="text-[11px] text-gray-400 px-3 py-3">ไม่มีร้าน</p>'}
          </div>`;
    };

    const routeTable = (s) => {
        const rows = s.rows;
        if (!rows.length) return scope === '__none'
            ? '<p class="text-[11px] text-gray-400">ยังไม่ได้เลือกสาย — ติ๊กเลือกสายที่ช่อง "ดู" มุมขวาบน หรือกด ☑ ทุกสาย</p>'
            : '<p class="text-[11px] text-gray-400">ยังไม่มีข้อมูล</p>';
        if (baseCache.key !== ((window.CENTER_DOC || '') + '|' + ((typeof App !== 'undefined' && App._currentPlanYM) || ''))) setTimeout(loadBase, 0);
        const cmp = compare();
        const bym = baseCache.ym;
        // ดูทุกสาย: ใส่สายที่มีในเดือนฐานแต่ไม่มีแล้วด้วย (ร้านย้ายออก/หลุดจะได้ไม่หาย)
        let list = rows.slice();
        if (cmp && scope === '__all') {
            const have = new Set(list.map(r => r.rt));
            Object.keys(cmp).filter(rt => !have.has(rt)).forEach(rt => list.push({ rt, cover: 0, visits: 0, f2: 0, beats: 0, ghost: true }));
        }
        list.sort((a, b) => a.rt.localeCompare(b.rt, 'th', { numeric: true }));
        const allRts = list.map(r => r.rt);
        if (det && det.rt !== '__total' && !allRts.includes(det.rt)) det = null;
        const n = (v) => (v || 0).toLocaleString();
        const per = (c, d) => d ? Math.ceil(c / d).toLocaleString() : '—';      // V0.9.0: ปัดขึ้นเป็นจำนวนเต็ม
        const match = (d) => d > 0 ? '<span class="text-emerald-700 font-bold">▲ Increase</span>'
            : d < 0 ? '<span class="text-red-600 font-bold">▼ Decrease</span>' : '<span class="text-gray-400">Equal</span>';
        const signed = (d) => d > 0 ? '+' + d.toLocaleString() : d.toLocaleString();
        const cell = (v, cls) => `<td class="px-2 py-1 text-right tabular-nums ${cls || ''}">${v}</td>`;
        // ตัวเลขที่กดได้ → เปิดรายชื่อร้านใต้ตาราง
        const num = (v, txt, kind, rt, cls) => {
            if (!v) return cell('—', 'text-gray-300');
            const on = det && det.kind === kind && det.rt === rt;
            return `<td class="px-2 py-1 text-right tabular-nums ${cls || ''}">
                <button onclick="PlanOverview.detail('${kind}','${esc(rt)}')" title="ดูรายชื่อร้าน"
                  class="tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid rounded px-0.5 ${on ? 'bg-indigo-600 text-white no-underline' : ''}">${txt}</button></td>`;
        };
        const ln = (x, k) => (x && x[k] ? x[k].length : 0);
        const cmpCells = (c, cover, rt, first) => {
            if (!cmp) return `<td colspan="7" class="px-2 py-1 text-center text-[10px] text-gray-300">${baseCache.loading ? 'กำลังโหลด…' : '—'}</td>`;
            const x = c || { base: 0, inn: [], out: [], rem: [], nw: [] };
            const d = cover - x.base;
            const ni = ln(x, 'inn'), no = ln(x, 'out'), nr = ln(x, 'rem'), nn = ln(x, 'nw');
            return cell(n(x.base), 'text-gray-500 border-l border-gray-200')
                + cell(signed(d), d > 0 ? 'text-emerald-700 font-bold' : d < 0 ? 'text-red-600 font-bold' : 'text-gray-400')
                + `<td class="px-2 py-1 text-left whitespace-nowrap">${match(d)}</td>`
                + num(ni, '+' + n(ni), 'inn', rt, 'text-emerald-700')
                + num(no, '−' + n(no), 'out', rt, 'text-amber-700')
                + num(nr, '−' + n(nr), 'rem', rt, 'text-red-600')
                + num(nn, '+' + n(nn), 'nw', rt, 'text-indigo-700 font-bold');
        };
        const T = list.reduce((a, r) => {
            a.cover += r.cover; a.visits += r.visits; a.f2 += r.f2;
            const c = cmp && cmp[r.rt];
            if (c) { a.base += c.base; a.inn += ln(c, 'inn'); a.out += ln(c, 'out'); a.rem += ln(c, 'rem'); a.nw += ln(c, 'nw'); }
            return a;
        }, { cover: 0, visits: 0, f2: 0, base: 0, inn: 0, out: 0, rem: 0, nw: 0 });
        const wdT = s.calDays || 0;
        // V0.8.2: Grand Total ของ Visit/Day = Visit รวม ÷ Working Day รวมทุกสาย (= เฉลี่ยต่อเซลล์ต่อวัน)
        const wdSum = list.reduce((a, r) => a + (r.ghost ? 0 : (s.wdOf[r.rt] || 0)), 0);
        const th = (h, i, extra) => `<th class="px-2 py-1 font-bold ${i ? 'text-right' : 'text-left'} ${extra || ''}">${h}</th>`;
        const lbl = bym ? ymLabel(bym) : '';
        const TT = '__total';
        return `
          ${cmp ? `<p class="text-[10.5px] text-gray-500 mb-1">เทียบกับแผน <b>${esc(lbl)}</b> (เดือนที่นำเข้าจากระบบล่าสุด) · Diff = ย้ายเข้า − ย้ายออก − Remove + ร้านใหม่</p>`
                : (!baseCache.loading && baseCache.key ? `<p class="text-[10.5px] text-gray-400 mb-1">ไม่มีแผนเดือนก่อนในโปรแกรมให้เทียบ — นำเข้า RoutePlan Detail ของเดือนปัจจุบันก่อน</p>` : '')}
          <div class="overflow-x-auto"><table class="w-full text-[13px]">
          <thead><tr class="bg-gray-50 text-gray-500">
            ${th('สาย', 0)}${th('Working Day', 1)}${th('Coverage', 1)}${th('Visit', 1)}${th('Re-Visit', 1)}${th('Visit/Day', 1)}
            ${th('Coverage ' + esc(lbl || 'เดือนก่อน'), 1, 'border-l border-gray-200')}${th('Diff', 1)}<th class="px-2 py-1 font-bold text-left">Match</th>
            ${th('ย้ายเข้า', 1)}${th('ย้ายออก', 1)}${th('Remove', 1)}${th('ร้านใหม่', 1)}
          </tr></thead><tbody>
          ${list.map(r => {
            const wd = r.ghost ? 0 : (s.wdOf[r.rt] || 0);
            return `<tr class="border-t border-gray-100 ${r.ghost ? 'text-gray-400' : ''} ${det && det.rt === r.rt ? 'bg-indigo-50/50' : ''}">
              <td class="px-2 py-1 font-mono font-bold text-gray-700">
                ${r.ghost ? esc(r.rt) + ' <span class="text-[9px] font-normal">(ไม่มีในแผนนี้)</span>'
                          : `<button onclick="PlanOverview.open('${esc(r.rt)}')" class="hover:text-indigo-600">${esc(r.rt)}</button>`}</td>
              ${cell(wd || '—', 'text-gray-600')}
              ${num(r.cover, n(r.cover), 'cover', r.rt, 'font-bold')}
              ${cell(n(r.visits), 'font-bold ' + (r.visits > r.cover ? 'text-emerald-600' : ''))}
              ${num(r.f2, n(r.f2), 'revisit', r.rt, 'text-red-600 font-bold')}
              ${cell(per(r.visits, wd), 'text-gray-600')}
              ${cmpCells(cmp && cmp[r.rt], r.cover, r.rt)}
            </tr>`;
          }).join('')}
          <tr class="border-t-2 border-gray-300 bg-indigo-50/60 font-black text-gray-800">
            <td class="px-2 py-1">Grand Total</td>
            ${cell(wdT || '—')}${num(T.cover, n(T.cover), 'cover', TT)}${cell(n(T.visits))}${num(T.f2, n(T.f2), 'revisit', TT, 'text-red-600')}${cell(per(T.visits, wdSum))}
            ${cmp ? cell(n(T.base), 'border-l border-gray-200') + cell(signed(T.cover - T.base), (T.cover - T.base) > 0 ? 'text-emerald-700' : (T.cover - T.base) < 0 ? 'text-red-600' : 'text-gray-400')
                    + `<td class="px-2 py-1 text-left whitespace-nowrap">${match(T.cover - T.base)}</td>`
                    + num(T.inn, '+' + n(T.inn), 'inn', TT) + num(T.out, '−' + n(T.out), 'out', TT)
                    + num(T.rem, '−' + n(T.rem), 'rem', TT) + num(T.nw, '+' + n(T.nw), 'nw', TT)
                  : '<td colspan="7"></td>'}
          </tr>
          </tbody></table></div>
          <p class="text-[11px] text-gray-400 mt-1 leading-snug">Working Day = วันที่สายนั้นมีการเข้าเยี่ยม (Grand Total = วันในปฏิทินที่มีอย่างน้อย 1 สายวิ่ง) · Re-Visit = ร้านที่ถูกเข้า ≥ 2 ครั้ง · Visit/Day = Visit ÷ Working Day ปัดขึ้น (Grand Total = Visit รวม ÷ Working Day รวมทุกสาย)
            · ย้ายเข้า = เดือนฐานอยู่สายอื่น/กองรอจัดสาย · ย้ายออก = ไปอยู่สายอื่น หรือกองรอจัดสาย/ยังไม่มีวัน · Remove = อยู่ในกอง "ออกจากแผน" หรือไม่มีในข้อมูลแล้ว · ร้านใหม่ = ไม่มีในเดือนฐานเลย
            · <b>ตัวเลขขีดเส้นใต้กดดูรายชื่อร้านได้</b></p>
          ${detailHTML(cmp, det && det.rt === TT ? allRts : det ? [det.rt] : [])}`;
    };

    /** ตัวเลือกสายแบบติ๊กได้หลายสาย */
    const pickerHTML = (rs) => {
        const all = scope === '__all';
        const label = all ? `ทุกสายรวม (${rs.length})` : scope === '__none' ? 'ยังไม่เลือกสาย' : (scope === '__multi' ? `เลือก ${picked.size} สาย` : scope);
        return `<details id="ov-pick" class="relative" ${pickOpen ? 'open' : ''} ontoggle="PlanOverview._pickToggle(this.open)">
            <summary class="list-none cursor-pointer select-none border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold bg-white hover:bg-gray-50">${esc(label)} ▾</summary>
            <div class="absolute right-0 z-40 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-1.5" style="width:260px">
              <div class="flex items-center gap-4 px-1.5 pb-1 mb-1 border-b border-gray-100">
                <button onclick="PlanOverview.pickAll()" class="whitespace-nowrap text-[11.5px] font-bold ${all ? 'text-gray-400' : 'text-indigo-600 hover:underline'}">☑ ทุกสาย</button>
                <button onclick="PlanOverview.pickNone()" class="whitespace-nowrap text-[11.5px] font-bold ${scope === '__none' ? 'text-gray-400' : 'text-red-600 hover:underline'}">☐ ล้างค่า</button>
              </div>
              <div class="max-h-72 overflow-y-auto">
                ${rs.map(r => `<label class="flex items-center gap-2 px-1.5 py-1 rounded-lg text-xs cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" class="w-3.5 h-3.5" ${(all || picked.has(r)) ? 'checked' : ''} onchange="PlanOverview.pick('${esc(r)}', this.checked)">
                    <span class="font-mono font-bold text-gray-700">${esc(r)}</span></label>`).join('')}
              </div>
            </div></details>`;
    };

    window.PlanOverview = {
        render,
        setScope(v) { picked = (v && v !== '__all') ? new Set([v]) : new Set(); none = false; render(); },
        pick(rt, on) {
            if (scope === '__all') picked = new Set(routes());
            if (scope === '__none') picked = new Set();
            if (on) picked.add(rt); else picked.delete(rt);
            none = !picked.size;          // เอาติ๊กออกจนหมด = ไม่เลือกสาย ไม่ใช่เด้งกลับไปทุกสาย
            pickOpen = true; render();
        },
        pickAll() { picked = new Set(); none = false; pickOpen = true; render(); },
        pickNone() { picked = new Set(); none = true; pickOpen = true; render(); },
        _pickToggle(o) { pickOpen = !!o; },
        async setMonth(ym) {
            if (!ym || ym === App._currentPlanYM) return;
            try { await App.switchPlan(ym); } catch (e) { console.warn('[Overview.setMonth]', e); }
            render();
        },
        focus,
        openCal(route) {
            Nav.go('planning');
            setTimeout(() => {
                try {
                    if (route && window.CalUI && CalUI.edit) return CalUI.edit(route);
                    CalendarAdmin.open(App._currentPlanYM);
                } catch (e) {}
            }, 400);
        },
        open(rt) { Nav.go('planning'); if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen) MultiRoute.setOpen([rt]); },
        /** V0.7.5: กดตัวเลขในตาราง → เปิด/ปิดรายชื่อร้าน */
        detail(kind, rt) {
            det = (!kind || (det && det.kind === kind && det.rt === rt)) ? null : { kind, rt };
            render();
            if (det) setTimeout(() => { const e = $('ov-detail'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 30);
        },
        /** ปุ่มพาไปแก้ของรายชื่อที่เปิดอยู่ */
        detailGo() {
            const d = window.__ovDet;
            if (!d || !d.items.length) return;
            const live = d.items.filter(x => !x.gone);
            if (d.kind === 'rem') { if (window.Removed) Removed.open(live.map(x => x.s.id)); return; }
            const rts = d.kind === 'out' ? live.map(x => x.toRt || x.to) : live.map(x => x.to);
            const valid = Object.keys(State.db.routes || {});
            focus(rts.filter(r => valid.includes(r)), live.map(x => x.s.id),
                  { note: KIND[d.kind] + ' — แก้ได้ที่แผนที่ / แถบ จัดสาย' });
        },
        jump(i) { const x = (window.__ovIssues || [])[i]; if (x && x.go) x.go(); },
        /** V0.9.0: กดตัวเลขในตารางรายวัน → หน้าวางแผนคิวงาน เปิดสายนั้น + หน้าต่างของวันนั้น */
        goDay(rt, d) {
            const days = (window.__ovGrid || {})[rt + '|' + d] || [];
            Nav.go('planning');
            try { if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen) { MultiRoute.allDays && MultiRoute.allDays(); MultiRoute.setOpen([rt]); } } catch (e) {}
            if (days.length) setTimeout(() => { try { MultiRoute.openDay(rt, days[0]); } catch (e) {} }, 500);
        },
        _stats: stats, _issues: issues, _monthMap: monthMap, _daily: () => dailyData(),
        _holOf: holOf, _isPV: isPVRoute, _scopeRoutes: () => scopeRoutes(), _holidayInfo: () => holidayInfo(), _ymParts: () => ymParts(), _ymLabel: (ym) => ymLabel(ym), loadBase: () => loadBase(), LOAD_MIN, LOAD_MAX, _compare: () => compare(), _base: () => baseCache,
    };

    // ── ติดตั้งเมนู + หน้า ──────────────────────────────────────────────
    const mount = () => {
        if ($('page-overview')) return true;
        const nav = document.querySelector('aside nav');
        const plan = $('page-planning');
        if (!nav || !plan || typeof Nav === 'undefined') return false;

        const btn = document.createElement('button');
        btn.id = 'nav-overview';
        btn.className = 'sidebar-menu w-full flex items-center justify-center md:justify-start px-0 md:px-5 py-3 md:py-3.5 text-sm font-bold';
        btn.onclick = () => Nav.go('overview');
        btn.innerHTML = '<span class="text-xl md:text-lg md:mr-3">📋</span>'
                      + '<span class="hidden md:inline">ภาพรวมแผน</span>';
        nav.appendChild(btn);        // ล่างสุด ต่อจาก "วางแผนคิวงาน"

        const page = document.createElement('div');
        page.id = 'page-overview';
        page.className = 'app-page hidden';
        page.style.height = '100%';
        plan.parentNode.insertBefore(page, plan);

        // เดือนเปลี่ยน (สลับจาก dropdown ไหนก็ตาม / นำเข้า / เพิ่มเดือน) → ถ้าหน้านี้เปิดอยู่ วาดใหม่เอง
        if (typeof App !== 'undefined' && App._loadPlan && !App._ovWired) {
            App._ovWired = true;
            const origLoad = App._loadPlan;
            App._loadPlan = async function () {
                const r = await origLoad.apply(this, arguments);
                baseCache = { key: '', ym: '', data: null, loading: false };      // เดือน/ข้อมูลเปลี่ยน → โหลดเดือนฐานใหม่
                const pg = $('page-overview');
                if (pg && !pg.classList.contains('hidden')) setTimeout(() => { try { render(); } catch (e) {} }, 150);
                return r;
            };
        }

        // ให้ Nav.go รู้จักหน้านี้
        const orig = Nav.go;
        Nav.go = function (pg) {
            const r = orig.apply(this, arguments);
            if (pg === 'overview') { try { render(); } catch (e) {} }
            return r;
        };
        return true;
    };

    const boot = () => {
        if (typeof Nav === 'undefined' || typeof State === 'undefined') return setTimeout(boot, 400);
        if (!mount()) return setTimeout(boot, 400);
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1000));
})();

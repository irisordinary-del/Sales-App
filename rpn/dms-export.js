/* =============================================================================
 *  dms-export.js — ส่งออกไฟล์สำหรับอัปเข้า DMS
 * =============================================================================
 *  สร้างไฟล์ .xlsx ไฟล์เดียว 3 ชีท หัวคอลัมน์ตรงกับไฟล์ต้นฉบับ
 *  เปิดมาแล้ว copy ทั้งบล็อกไปวางในไฟล์ตรวจ หรืออัปเข้า DMS ได้เลย
 *
 *    ROUTE_PLAN_CYCLEROUTE  1 แถว = 1 CY (สาย × วัน)
 *    ROUTE_PLAN_CUSTLIST    1 แถว = 1 ร้านใน CY พร้อมลำดับคิว
 *    Start Point            พิกัดจุดเริ่ม/จุดจบของแต่ละ CY (เว้นว่างได้)
 *
 *  หมายเหตุ: CUSTOMER_GEO_TREE ไม่ได้อยู่ในนี้ เพราะเป็นข้อมูลที่ดึงลงมา
 *  จาก DMS (System & Admin Setup > Import/export Job) ไม่ใช่ของที่เราสร้าง
 * ========================================================================== */
const DmsExport = (() => {
    'use strict';

    const H_CYCLE = [
        'Distributor Code (nv20)',
        'CycleCode(nv12)ตามจำนวนRoute',
        'Cycle route description (nv50) ใส่ชื่อตลาด',
        'Salesman Code (nv20)',
        'Frequency Type (tinyint 2)',
        'Visit Frequency (tinyint) 0 - not applicable 1 - Daily 2 - 3 x weekly 3 - 2x weekly 4 - Weekly 5 - Fortnightly 6 - 3 weeks once 7 - Monthly (4 weeks once) 8 - 6 Week once 9 - Monthly10 - Monthly(Week) CR 5 =5 ,PS 9 =9',
        'Visit Week (tinyint)',
        'Start date (Date) format = YYYY/MM/DD',
        'End date (Date) format = YYYY/MM/DD',
        'Monday (char1)', 'Tuesday (char1)', 'Wednesday (char1)', 'Thurday (char1)',
        'Friday (char1)', 'Saturday (char1)', 'Sunday (char1)',
        'Visit Week of Month (varchar20)', 'Visit Day of Month (varchar20)',
    ];
    const H_CUST = ['Distributor Code (nv20)', 'CycleCode(nv12)', 'Cust Code (nv20)', 'Sequence'];

    const dayNum = d => parseInt(String(d || '').replace(/[^0-9]/g, ''), 10) || 0;
    const pad2 = n => String(n).padStart(2, '0');
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

    // ── ไฟล์อัป DMS (V0.7.1): .csv แบบ Excel "Unicode Text" = UTF-16LE มี BOM · คั่นด้วย Tab · CRLF ─────
    const tsvCell = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[\t\r\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const utf16 = (text) => {
        const out = new Uint8Array(2 + text.length * 2);
        out[0] = 0xFF; out[1] = 0xFE;
        for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[2 + i * 2] = c & 0xFF; out[3 + i * 2] = c >> 8; }
        return out;
    };
    const tsvBytes = (aoa) => utf16(aoa.map(r => r.map(tsvCell).join('\t')).join('\r\n') + '\r\n');
    /** รวมหลายไฟล์เป็น zip (ใช้ตัวอ่าน/เขียน zip ใน SheetJS) + ใส่วันเวลาไฟล์ให้ถูกทั้งสองที่ */
    const makeZip = (files) => {
        const C = XLSX.CFB;
        const z = C.utils.cfb_new();
        files.forEach(f => C.utils.cfb_add(z, f.name, f.data));
        const now = new Date();
        z.FileIndex.forEach(f => { if (f.type === 2) f.mt = now; });
        let u8 = C.write(z, { fileType: 'zip', type: 'array', compression: true });
        if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
        // ตัวเขียนของ SheetJS ไม่ใส่วันเวลาใน central directory (Explorer เห็นเป็นปี 1980) → เติมให้
        try {
            const tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >>> 1);
            const dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
            const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
            const eocd = u8.length - 22;
            if (dv.getUint32(eocd, true) === 0x06054b50) {
                let p = dv.getUint32(eocd + 16, true);
                const n = dv.getUint16(eocd + 10, true);
                for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
                    dv.setUint16(p + 12, tm, true); dv.setUint16(p + 14, dt, true);
                    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
                }
            }
        } catch (e) {}
        return u8;
    };
    const download = (bytes, name, type) => {
        const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    };
    const ymdS = (d) => d ? d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') : '';

    const D = {
        _endDate: '',       // '' = แยกรายสาย (วันสุดท้ายที่สายนั้นมีแผน) · มีค่า = ผู้ใช้ตั้งวันเดียวทั้งศูนย์ (ของเดือน _endYM เท่านั้น)
        _endYM: '',
        _cyStart: null,     // เลข CY ตัวแรกที่ผู้ใช้แก้เอง (ของเดือน _cyYM เท่านั้น)
        _cyYM: '',
        _cyBase: null,      // { mx, from } — CY ล่าสุดของเดือนก่อน

        /** เลขศูนย์ — อ่านจากไฟล์ RoutePlan ที่นำเข้า ไม่ใช่จาก URL (URL อาจไม่ตรงกับข้อมูล) */
        distCode(route) {
            if (typeof LocalExtras !== 'undefined' && LocalExtras.distCode) return LocalExtras.distCode(route);
            const rd = (State.db && State.db.routeDist) || {};
            if (route) return rd[route] || String(route).slice(0, 3);
            const vals = [...new Set(Object.values(rd).filter(Boolean))];
            return vals.length === 1 ? vals[0] : '';
        },

        /** ปฏิทินที่มีผลกับสายนี้ — override รายสายมาก่อน ไม่มีค่อยใช้ของศูนย์ */
        _cal(route) {
            const ym = App._currentPlanYM || '';
            const [y, m] = ym.split('_').map(Number);
            const ov = (route && State.db.routeCal && State.db.routeCal[route]) || null;
            return { cfg: ov || State.db.calendarConfig, year: y, month: (m || 1) - 1, ok: !!(y && m) };
        },
        /** วันแรกที่ตลาดนี้วิ่งในเดือนนี้ */
        dateOf(route, day) {
            const ds = D.datesOf(route, day);
            if (ds.length) return ds[0];
            const c = D._cal(route);
            if (!c.ok || typeof FileManager === 'undefined') return null;
            try { return FileManager._resolveCalendarDate(c.cfg || {}, day, c.year, c.month); }
            catch (e) { return null; }
        },
        calSet() { return !!(State.db.calendarConfig && (State.db.calendarConfig.mode || State.db.calendarConfig.mapping)); },
        fmt(d) {
            if (!d) return '';
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        },

        /** วันสุดท้ายของแผน = วันที่มากที่สุดที่ปฏิทินคำนวณได้ */
        autoEndDate() {
            let best = null;
            Object.keys(State.db.routes || {}).forEach(rt => {
                if (rt === 'รอจัดสาย') return;
                RoadMaster.daysOf(rt, State.db.routes[rt]).forEach(d => {
                    D.datesOf(rt, d).forEach(dt => { if (dt && (!best || dt > best)) best = dt; });
                });
            });
            return D.fmt(best);
        },
        /** วันทำงานสุดท้ายของเดือน (ปฏิทินระดับเดือน) */
        workEnd() { return D.fmt(Runs.workEnd()); },
        /** End date ของสายนี้ที่จะลงไฟล์ — วันเดียวทั้งศูนย์ถ้าผู้ใช้ตั้งไว้ ไม่งั้นวันสุดท้ายที่สายนั้นมีแผน */
        endOf(route) { return D.fmt(Runs.endDate(route)); },

        /** ทุกวันที่ในเดือนที่ตลาดนี้วิ่งจริง (ตามความถี่ของตลาด · รอบสั้น = +14 วัน · ไม่รวมครั้งที่แยกออกไป) */
        datesOf(route, day) {
            try { return Runs.datesOf(route, day); } catch (e) { return []; }
        },

        /** ความถี่ของตลาด 'F2' / 'F1' — เก็บที่ตลาด (ทุกร้านในตลาดค่าเดียวกัน) */
        beatFreq(day, stores, route) {
            if (route) { try { return Runs.fqOf(route, day); } catch (e) {} }
            const cnt = {};
            (stores || []).forEach(s => {
                const v = String((s.fqs && s.fqs[day]) || '').trim().toUpperCase();
                if (!v) return;
                const k = (v === 'F2') ? 'F2' : 'F1';
                cnt[k] = (cnt[k] || 0) + 1;
            });
            const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
            return top ? top[0] : '';
        },

        /**
         * Visit Week (ช่อง G) ของ CY แบบ 5 — สัปดาห์คี่/คู่นับจากต้นปี
         * สูตรเดียวกับ Excel WEEKNUM(วันที่, 2): จันทร์เป็นต้นสัปดาห์ สัปดาห์ที่มี 1 ม.ค. = สัปดาห์ 1
         * คี่ = 1 · คู่ = 2   (DMS ยึด Visit date เป็นหลัก ช่องนี้เป็นข้อมูลประกอบ)
         */
        weekNum(d) {
            if (!d) return 0;
            const j1 = new Date(d.getFullYear(), 0, 1);
            const dow1 = (j1.getDay() + 6) % 7;             // จันทร์ = 0
            const doy = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000);
            return Math.floor((doy + dow1) / 7) + 1;
        },
        weekParity(d) {
            if (!d) return 0;
            return ((D.weekNum(d) - 1) % 2) + 1;
        },

        /**
         * 1 แถว = 1 CY ตามหลัก (ดู runs.js)
         *   ตลาดที่ทุกครั้งเหมือนกัน ห่าง 14 วันพอดี วิ่งจนถึง End date → 1 แถว Visit Frequency 5
         *   ที่เหลือ → แถวละ 1 ครั้ง Visit Frequency 9
         * เรียง Salesman → Visit date → ช่องวัน (ลำดับเดียวกับที่ออกเลข CY)
         */
        rows() {
            if (typeof MultiRoute !== 'undefined' && MultiRoute.stamp) MultiRoute.stamp();
            const routes = State.db.routes || {};
            const out = [];
            Object.keys(routes).forEach(rt => {
                if (rt === 'รอจัดสาย') return;
                const list = routes[rt] || [];
                const plan = Runs.planRoute(rt);
                const nOf = {};
                plan.forEach(p => { nOf[p.base] = (nOf[p.base] || 0) + 1; });
                plan.forEach(p => {
                    const arr = RoadMaster.storesOfDay(p.day, list);
                    if (!arr.length) return;
                    const baseN = dayNum(p.base);
                    const market = RoadMaster.marketName(rt, p.day, list) || RoadMaster.marketName(rt, p.base, list);
                    const split = nOf[p.base] > 1;
                    out.push({
                        dist: D.distCode(rt), route: rt, day: p.day, base: p.base, n: baseN, k: p.k,
                        market,
                        // ติดกันไม่เว้นวรรค ตามไฟล์ DMS ต้นแบบ · ตลาดที่แตกหลาย CY ต่อท้ายด้วยครั้งที่
                        desc: `${rt}D${pad2(baseN)}${market || ''}` + (split ? `(ครั้ง${p.k})` : ''),
                        date: p.date, dates: p.dates, vf: p.vf,
                        visits: p.dates.length, split, orphan: !!p.orphan, merged: p.merged || [],
                        stores: arr, cy: '',
                        start: RoadMaster.startOf(rt, p.day, list),
                        end: RoadMaster.endOf(rt, p.day),
                    });
                });
            });
            out.sort((a, b) => a.route.localeCompare(b.route, 'th', { numeric: true })
                || (a.date - b.date) || (a.n - b.n) || (a.k - b.k));
            return out;
        },

        // ── เลข CY ───────────────────────────────────────────────────────
        _num(cy) { const n = parseInt(String(cy || '').replace(/\D/g, ''), 10); return isFinite(n) ? n : 0; },
        _fmtCY(n) { return 'CY' + String(n).padStart(10, '0'); },
        /**
         * CY ล่าสุดของ "เดือนก่อนหน้า" ที่มีเลข CY (เดือนที่นำเข้าจาก Route Plan หรือที่ส่งออกไปแล้ว)
         * เดือนใหม่ออกเลขต่อจากนี้ทั้งเดือน เช่น ก.ย. จบที่ CY0000015922 → ต.ค. เริ่ม CY0000015923
         */
        async cyBase() {
            const cur = App._currentPlanYM || '';
            let mx = 0, from = '';
            try {
                const snap = await App.plansCol().get();
                const ids = (snap.docs || []).map(d => d.id).filter(id => id && id < cur).sort().reverse();
                for (const id of ids) {
                    const rs = await App.planRoutesCol(id).get();
                    let m = 0;
                    (rs.docs || []).forEach(d => ((d.data() || {}).stores || []).forEach(s => {
                        m = Math.max(m, D._num(s.cy));
                        Object.values(s.cys || {}).forEach(v => { m = Math.max(m, D._num(v)); });
                    }));
                    if (m > 0) { mx = m; from = id; break; }
                }
            } catch (e) { console.warn('[DmsExport] cyBase', e); }
            if (!mx) {
                // ไม่มีเดือนก่อนในเครื่อง — ใช้เลขต่ำสุดของเดือนนี้ (ส่งออกซ้ำได้เลขเดิม) หรือเลขสูงสุดที่ระบบเคยเห็น
                let mn = Infinity;
                Object.values(State.db.routes || {}).forEach(list => (list || []).forEach(s => {
                    Object.values(s.cys || {}).forEach(v => { const k = D._num(v); if (k > 0 && k < mn) mn = k; });
                }));
                if (isFinite(mn)) { mx = mn - 1; from = 'เดือนนี้'; }
                else { mx = D._num(State.db.maxCycleCode); from = mx ? 'เลขสูงสุดที่ระบบเคยเห็น' : ''; }
            }
            return { mx, from };
        },
        cyStart() {
            if (D._cyStart && D._cyYM === App._currentPlanYM) return D._cyStart;
            return ((D._cyBase && D._cyBase.mx) || 0) + 1;
        },
        number(rows) {
            const st = D.cyStart();
            rows.forEach((r, i) => { r.cy = D._fmtCY(st + i); });
            return rows;
        },

        /** ปัญหาที่ต้องเตือนก่อนส่งออก */
        issues(rows) {
            const out = [];
            const noMk = rows.filter(r => !r.market).length;
            const noDt = rows.filter(r => !r.date).length;
            const noSeq = rows.reduce((t, r) => t + r.stores.filter(s => !(s.seqs && s.seqs[r.day])).length, 0);
            if (noMk) out.push(`${noMk} CY ยังไม่มีชื่อตลาด — คอลัมน์ Cycle route description จะไม่ครบ`);
            if (noDt) out.push(`${noDt} CY คำนวณวันที่ไม่ได้ — ตรวจปฏิทินของแผนนี้`);
            else if (!D.calSet()) out.push('ยังไม่ได้ตั้งปฏิทินของแผนนี้ — ระบบใช้กติกา Day N = วันที่ N ของเดือนไปก่อน (ไม่ข้ามวันหยุด) ตั้งได้ที่ปุ่มปฏิทินในหน้าจัดสาย');
            if (noSeq) out.push(`${noSeq} ร้านยังไม่มีลำดับคิว — เปิดการ์ดวันในแท็บสรุปแล้วกด "🔢 จัดลำดับจากพิกัด"`);
            const gaps = rows.filter(r => {
                const q = r.stores.map(s => (s.seqs && s.seqs[r.day]) || 0).sort((a, b) => a - b);
                return !q.every((v, i) => v === i + 1);
            }).length;
            if (gaps) out.push(`${gaps} ตลาดมีเลขลำดับขาดเป็นช่วง (เกิดจากย้ายร้านออกจากวันนั้น) — ระบบจะไล่เลขให้ต่อเนื่องอัตโนมัติตอนกดส่งออก`);
            try {
                const hol = Runs.holidayHits();
                if (hol.length) out.push(`${hol.length} ครั้งเข้าเยี่ยมตรงวันหยุด (${hol.slice(0, 4).map(h => h.route + ' ' + h.day.replace('Day ', 'D') + ' ' + Runs._short(h.date)).join(', ')}${hol.length > 4 ? ' …' : ''}) — เปิดตลาดนั้นแล้วกด "แก้ครั้งนี้" เพื่อเลื่อนวัน`);
            } catch (e) {}
            try {
                const cl = Runs.clashes();
                if (cl.length) out.push(`${cl.length} วันที่สายเดียวมี 2 ตลาด (${cl.slice(0, 3).map(c => c.route + ' ' + Runs._short(c.date) + ' ' + c.days.map(d => d.replace('Day ', 'D')).join('+')).join(', ')}${cl.length > 3 ? ' …' : ''}) — ดูที่หน้าภาพรวมแผน`);
            } catch (e) {}
            const orphan = rows.filter(r => r.orphan).length;
            if (orphan) out.push(`${orphan} ครั้งที่แยกไว้ ไม่ตรงกับครั้งของตลาดเดิมแล้ว (ปฏิทินเปลี่ยน) — ส่งออกเป็น CY แบบ 9 ตามวันที่ของมันเอง`);
            return out;
        },

        // ── หน้าต่างก่อนส่งออก ───────────────────────────────────────────
        async open() {
            const ym = App._currentPlanYM || '';
            if (D._endYM !== ym) { D._endDate = ''; D._endYM = ym; }      // เดือนใหม่ = กลับไปแยกรายสาย
            if (D._cyYM !== ym) { D._cyStart = null; D._cyYM = ym; D._cyBase = null; }
            if (!D._cyBase) D._cyBase = await D.cyBase();
            if (window.GeoTree) { try { await GeoTree.ensure(); } catch (e) {} }     // V0.7: ร้านย้ายเซลล์
            const rows = D.number(D.rows());
            if (!rows.length) return UI.showErrorToast('⚠️ ยังไม่มีแผนในระบบ');
            const issues = D.issues(rows);
            const routes = [...new Set(rows.map(r => r.route))];
            const nStore = rows.reduce((t, r) => t + r.stores.length, 0);
            const nFort = rows.filter(r => String(r.vf) === '5').length;
            const nVisit = rows.reduce((t, r) => t + r.stores.length * (r.visits || 1), 0);
            const nSplit = new Set(rows.filter(r => r.split).map(r => r.route + '|' + r.base)).size;
            const per = {};
            rows.forEach(r => { const p = per[r.route] || (per[r.route] = { f5: 0, f9: 0, end: D.endOf(r.route) }); if (String(r.vf) === '5') p.f5++; else p.f9++; });
            const ends = [...new Set(routes.map(rt => per[rt].end))].sort();
            const _thd = (s) => { const d = Runs._parse ? Runs._parse(s) : null; return d ? Runs._short(d) : s; };
            const base = D._cyBase || {};
            const geoBlocked = !!(window.GeoTree && GeoTree.blocked());
            let geoFiles = [];
            try { geoFiles = window.GeoTree ? GeoTree.files() : []; } catch (e) {}

            let el = document.getElementById('dms-modal');
            if (!el) {
                el = document.createElement('div');
                el.id = 'dms-modal';
                el.className = 'fixed inset-0 bg-black/50 z-[9998] hidden items-center justify-center p-4';
                document.body.appendChild(el);
            }
            el.innerHTML = `
              <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto">
                <h3 class="font-black text-gray-800 mb-1">📤 ส่งออกไฟล์สำหรับ DMS</h3>
                <p class="text-xs text-gray-500 mb-1">
                    ${routes.length} สาย · ${rows.length} CY · ${nStore.toLocaleString()} ร้าน
                    · เดือน ${App._currentPlanYM || '—'}
                </p>
                <p class="text-[11px] mb-1 ${nFort ? 'text-indigo-700 font-bold' : 'text-gray-500'}">
                    CY แบบ 5 (Fortnightly) ${nFort} · แบบ 9 (Monthly) ${rows.length - nFort}
                    · ครั้งเข้าเยี่ยมรวม ${nVisit.toLocaleString()} ครั้ง
                    ${nSplit ? `<br><span class="text-amber-700">${nSplit} ตลาดแตกเป็นหลาย CY เพราะแต่ละครั้งไม่เหมือนกัน</span>` : ''}
                </p>
                <p class="text-[10.5px] text-gray-400 mb-3 leading-snug">
                    ส่งออก <b>ทุกสายในศูนย์</b> เสมอ — ไม่ขึ้นกับสายที่ติ๊กไว้ในตัวกรอง
                </p>
                ${issues.length ? `<div class="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mb-3 text-[11px] text-amber-800 leading-snug">
                    <b>ตรวจก่อนส่ง</b><ul class="list-disc pl-4 mt-1 space-y-0.5">
                    ${issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}

                <label class="text-[11px] font-bold text-gray-500">End date</label>
                <div class="flex gap-2 items-center mb-1 flex-wrap">
                    <button onclick="DmsExport._setEnd('route')"
                        class="text-[11px] font-bold px-2 py-1.5 rounded-lg border ${!D._endDate
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-200 text-gray-500'}">ตามแผนแต่ละสาย</button>
                    <button onclick="DmsExport._setEnd('month')"
                        class="text-[11px] font-bold px-2 py-1.5 rounded-lg border ${D._endDate && D._endDate === D.monthEnd()
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-200 text-gray-500'}">สิ้นเดือนทุกสาย</button>
                    <span class="text-[10px] text-gray-400">หรือวันเดียวทุกสาย</span>
                    <input type="date" id="dms-end" value="${esc(D._endDate)}" onchange="DmsExport._typeEnd(this.value)"
                           class="border border-gray-200 rounded-lg px-2 py-1 text-sm">
                </div>
                <p class="text-[10px] text-gray-400 mb-3 leading-snug">
                    ${!D._endDate
                        ? `ค่าเริ่มต้น = <b>วันสุดท้ายที่แต่ละสายมีแผน</b> (วันทำงานสุดท้ายตามปฏิทินของสาย — วันหยุดท้ายเดือนดึงเข้ามาเอง)
                           · ตอนนี้ ${ends.length === 1 ? `ทุกสาย <b>${esc(_thd(ends[0]))}</b>` : ends.map(x => `<b>${esc(_thd(x))}</b> ${routes.filter(rt => per[rt].end === x).length} สาย`).join(' · ')}`
                        : `ทุกสายใช้ <b>${esc(_thd(D._endDate))}</b>`}
                    · CY แบบ 5 วิ่งทุก 14 วันจาก Start date จนถึง End date ของสาย</p>

                <label class="text-[11px] font-bold text-gray-500">เลข CY</label>
                <div class="flex gap-2 items-center mb-1">
                    <span class="text-xs text-gray-500">เริ่มที่</span>
                    <input type="number" id="dms-cy" value="${D.cyStart()}" min="1" onchange="DmsExport._typeCY(this.value)"
                           class="border border-gray-200 rounded-lg px-2 py-1 text-sm w-36 font-mono">
                    <span class="text-xs font-mono text-gray-700">${esc(rows[0].cy)} – ${esc(rows[rows.length - 1].cy)}</span>
                </div>
                <p class="text-[10px] text-gray-400 mb-3 leading-snug">
                    ${base.mx ? `ต่อจาก ${esc(D._fmtCY(base.mx))} (CY ล่าสุดของ${base.from === 'เดือนนี้' || base.from === 'เลขสูงสุดที่ระบบเคยเห็น' ? esc(base.from) : 'แผนเดือน ' + esc(base.from)})`
                              : 'ไม่พบเลข CY ของเดือนก่อนในเครื่อง — ใส่เลขตัวแรกเองให้ตรงกับ DMS'}
                    · ออกเลขใหม่ทั้งเดือน เรียงสาย → วันเข้าเยี่ยม · กดส่งออกซ้ำได้เลขเดิม</p>

                <details class="mb-3">
                    <summary class="text-[11px] font-bold text-gray-500 cursor-pointer">CY แบบ 5 / แบบ 9 และ End date รายสาย</summary>
                    <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5 max-h-44 overflow-y-auto pr-1">
                        ${routes.map(rt => `<div class="flex items-center gap-2 text-[11px]">
                            <span class="flex-1 truncate font-mono">${esc(rt)}</span>
                            <span class="text-indigo-700 font-bold">5 × ${per[rt].f5}</span>
                            <span class="text-gray-600">9 × ${per[rt].f9}</span>
                            <span class="text-gray-400 w-12 text-right">${esc(_thd(per[rt].end))}</span></div>`).join('')}
                    </div>
                </details>

                ${window.GeoTree ? GeoTree.panel() : ''}

                <div class="flex gap-2">
                    <button onclick="DmsExport.close()" class="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl text-sm font-bold">ปิด</button>
                    <button onclick="DmsExport.runStartPoint()" title="ชีต Start Point (พิกัดเริ่ม/สิ้นสุดของแต่ละตลาด) เป็นไฟล์ Excel แยก — ไม่ได้อัปเข้า DMS"
                        class="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-2 rounded-xl text-[12px] font-bold">📍 Start Point (Excel)</button>
                    <button onclick="DmsExport.run()" ${geoBlocked ? 'disabled title="มีร้านย้ายเซลล์ — นำเข้า CUSTOMER_GEO_TREE ก่อน"' : ''}
                        class="flex-1 ${geoBlocked ? 'bg-gray-300 cursor-not-allowed' : 'bg-gray-900 hover:bg-black'} text-white py-2 rounded-xl text-sm font-bold">📦 ส่งออกไฟล์ DMS (.zip)</button>
                </div>
                <p class="text-[10px] text-gray-400 mt-1.5 leading-snug">zip มี ROUTE_PLAN_CYCLEROUTE.csv + ROUTE_PLAN_CUSTLIST.csv${geoFiles.length ? ' + ' + geoFiles.map(f => esc(f.name)).join(' + ') : ''} · .csv แบบ Unicode Text (UTF-16 คั่นด้วย Tab) เหมือนที่มาโคร RS บันทึก</p>
              </div>`;
            el.classList.remove('hidden'); el.classList.add('flex');
        },
        /** ชีต Start Point เป็นไฟล์ Excel แยก (ไม่อยู่ใน zip — ไม่ได้อัปเข้า DMS) */
        runStartPoint() {
            try {
                const rows = D.number(D.rows());
                if (!rows.length) return UI.showErrorToast('⚠️ ยังไม่มีแผนในระบบ');
                const num = (v) => { const n = Number(String(v == null ? '' : v).trim()); return (v !== '' && isFinite(n)) ? n : v; };
                const a3 = [
                    ['Dist Code', 'Cycle code', 'Cycle name', 'Salesman', 'พิกัดเริ่มต้น', '', 'พิกัดสิ้นสุด', ''],
                    ['', '', '', '', 'Latitude', 'Longitude', 'Latitude', 'Longitude'],
                ];
                rows.forEach(r => {
                    a3.push([
                        num(r.dist), `${r.route} D${pad2(r.n)}` + (r.split ? `-${r.k}` : ''), r.desc, r.route,
                        r.start ? r.start.lat : '', r.start ? r.start.lng : '',
                        r.end ? r.end.lat : '', r.end ? r.end.lng : '',
                    ]);
                });
                const wb = XLSX.utils.book_new();
                const ws3 = XLSX.utils.aoa_to_sheet(a3);
                ws3['!merges'] = [{ s: { r: 0, c: 4 }, e: { r: 0, c: 5 } }, { s: { r: 0, c: 6 }, e: { r: 0, c: 7 } }];
                ws3['!cols'] = [{wch:12},{wch:16},{wch:34},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14}];
                XLSX.utils.book_append_sheet(wb, ws3, 'Start Point');
                const ym = (App._currentPlanYM || '').replace('_', '-');
                XLSX.writeFile(wb, `StartPoint_${D.distCode()}_${ym}.xlsx`);
                UI.showSaveToast(`📍 ส่งออก Start Point ${rows.length} ตลาด`);
            } catch (e) { UI.showErrorToast('❌ ส่งออก Start Point ไม่สำเร็จ: ' + e.message); console.error(e); }
        },
        close() {
            const el = document.getElementById('dms-modal');
            if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
        },
        _resetEnd() { D._endDate = ''; D._endYM = App._currentPlanYM; try { Runs.bump(); } catch (e) {} D.open(); },
        /** สิ้นเดือนของแผนที่กำลังทำ */
        monthEnd() {
            const c = D._cal();
            if (!c.ok) return '';
            const d = new Date(c.year, c.month + 1, 0);
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        },
        _setEnd(kind) {
            D._endDate = (kind === 'month') ? D.monthEnd() : '';      // 'route' = แยกรายสาย
            D._endYM = App._currentPlanYM;
            try { Runs.bump(); } catch (e) {}
            D.open();
        },
        _typeEnd(v) {
            if (!v) return;
            D._endDate = v; D._endYM = App._currentPlanYM;
            try { Runs.bump(); } catch (e) {}
            D.open();
        },
        _typeCY(v) {
            const n = parseInt(v, 10);
            if (!(n > 0)) return;
            D._cyStart = n; D._cyYM = App._currentPlanYM;
            D.open();
        },

        /** เก็บเลข CY ที่ออกให้กลับลงร้าน (ไว้โชว์บนจอ และให้เดือนถัดไปนับต่อ) */
        async _writeBackCY(rows) {
            const R = State.db.routes || {};
            const first = {};                         // สาย|ช่องวัน → CY แถวแรกของช่องนั้น
            rows.forEach(r => { const k = r.route + '|' + r.day; if (!first[k]) first[k] = r.cy; });
            const touched = new Set();
            Object.keys(R).forEach(rt => (R[rt] || []).forEach(s => {
                (s.days || []).forEach(d => {
                    const cy = first[rt + '|' + d];
                    if (!cy) return;
                    if (!s.cys) s.cys = {};
                    if (s.cys[d] !== cy) { s.cys[d] = cy; touched.add(rt); }
                });
                const c0 = s.cys && s.days && s.days.length ? s.cys[s.days[0]] : '';
                if (c0 && s.cy !== c0) { s.cy = c0; touched.add(rt); }
            }));
            const last = rows.length ? D._num(rows[rows.length - 1].cy) : 0;
            try {
                await Promise.all([...touched].filter(rt => Array.isArray(R[rt])).map(rt =>
                    App.planRoutesCol(App._currentPlanYM).doc(rt).set({ stores: R[rt] }, { merge: true })));
                if (last > D._num(State.db.maxCycleCode)) {
                    State.db.maxCycleCode = last;
                    await App.dbRef.set({ maxCycleCode: last }, { merge: true });
                }
            } catch (e) { console.warn('[DmsExport] เก็บเลข CY ไม่สำเร็จ', e); }
        },

        // ── สร้างไฟล์ ────────────────────────────────────────────────────
        run() {
            if (window.GeoTree && GeoTree.blocked()) {
                return UI.showErrorToast(`⚠️ มี ${GeoTree.pre().length} ร้านย้ายเซลล์ — นำเข้า CUSTOMER_GEO_TREE ก่อนส่งออก`);
            }
            const endInput = document.getElementById('dms-end');
            if (endInput && endInput.value && endInput.value !== D._endDate) { D._endDate = endInput.value; D._endYM = App._currentPlanYM; try { Runs.bump(); } catch (e) {} }
            const cyInput = document.getElementById('dms-cy');
            if (cyInput && parseInt(cyInput.value, 10) > 0 && parseInt(cyInput.value, 10) !== D.cyStart()) { D._cyStart = parseInt(cyInput.value, 10); D._cyYM = App._currentPlanYM; }
            D.close();
            UI.showLoader('กำลังสร้างไฟล์ DMS...', '');
            setTimeout(async () => {
                try {
                    if (!D._cyBase) D._cyBase = await D.cyBase();
                    // กันไฟล์เสีย: ไล่เลขลำดับให้ต่อเนื่อง 1..n ทุกตลาดก่อนออกไฟล์
                    let fixed = 0;
                    if (typeof SeqTool !== 'undefined' && SeqTool.compactAll) {
                        fixed = SeqTool.compactAll();
                        if (fixed) { try { App.saveDB(); } catch (e) {} }
                    }
                    // เลข CY ออกใหม่ทั้งเดือนทุกครั้ง: ต่อจาก CY ล่าสุดของเดือนก่อน เรียงสาย → วันเข้าเยี่ยม
                    const rows = D.number(D.rows());
                    // End date รายสาย — เก็บไว้ก่อนเขียนเลข CY กลับ (การเขียนทำให้ระบบโหลดเดือนซ้ำเบื้องหลัง)
                    const endOfRoute = {};
                    rows.forEach(r => { if (!(r.route in endOfRoute)) endOfRoute[r.route] = Runs.endDate(r.route); });
                    await D._writeBackCY(rows);
                    const numOr = (v) => (v === null || v === undefined) ? '' : String(v).trim();
                    const endOf = (rt) => endOfRoute[rt] || Runs.endDate(rt);

                    // 1) ROUTE_PLAN_CYCLEROUTE — 1 แถว = 1 CY (จัดกลุ่มตามหลักใน runs.js)
                    //   แบบ 5 (Fortnightly) → Visit Week = สัปดาห์คี่/คู่นับจากต้นปี (1/2), ติด Y ที่วันในสัปดาห์ของ Start date
                    //   แบบ 9 (Monthly)     → Visit Week 0, ไม่ติดธงวัน · ทุกแถว Visit Day of Month = วันที่ของ Start date
                    const a1 = [H_CYCLE];
                    rows.forEach(r => {
                        const fort = String(r.vf) === '5';
                        const wd = ['N', 'N', 'N', 'N', 'N', 'N', 'N'];
                        if (fort && r.date) wd[(r.date.getDay() + 6) % 7] = 'Y';   // จันทร์ = ช่องแรก
                        a1.push([
                            numOr(r.dist), r.cy, r.desc, r.route,
                            1, numOr(r.vf), fort ? D.weekParity(r.date) : 0,
                            ymdS(r.date), ymdS(endOf(r.route)),
                            ...wd,
                            '', r.date ? r.date.getDate() : '',
                        ]);
                    });
                    // 2) ROUTE_PLAN_CUSTLIST
                    const a2 = [H_CUST];
                    rows.forEach(r => r.stores.forEach(s => {
                        a2.push([numOr(r.dist), r.cy, numOr(s.code || s.id), (s.seqs && s.seqs[r.day]) || '']);
                    }));
                    // 3–4) GEO_TREE_END / START — เฉพาะร้านที่ย้ายเซลล์ (ถ้านำเข้า Geo Tree ไว้)
                    const geo = window.GeoTree ? GeoTree.files() : [];
                    const files = [
                        { name: 'ROUTE_PLAN_CYCLEROUTE.csv', data: tsvBytes(a1) },
                        { name: 'ROUTE_PLAN_CUSTLIST.csv', data: tsvBytes(a2) },
                        ...geo.map(g => ({ name: g.name, data: tsvBytes(g.rows) })),
                    ];
                    const ym = (App._currentPlanYM || '').replace('_', '-');
                    download(makeZip(files), `DMS_RoutePlan_${D.distCode()}_${ym}.zip`, 'application/zip');
                    let sent = 0;
                    if (geo.length && window.GeoTree) { try { sent = await GeoTree.markSent(); } catch (e) {} }
                    UI.hideLoader();
                    UI.showSaveToast(`📦 ส่งออกแล้ว ${rows.length} CY · ${a2.length - 1} ร้าน · ${files.length} ไฟล์ใน zip`
                        + (geo.length ? ` (รวม Geo Tree ${geo.map(g => g.rows.length - 1).join('/')} แถว)` : '')
                        + (fixed ? ` · ไล่เลขลำดับใหม่ ${fixed} ตลาด` : ''));
                } catch (e) {
                    UI.hideLoader();
                    UI.showErrorToast('❌ ส่งออกไม่สำเร็จ: ' + e.message);
                    console.error(e);
                }
            }, 60);
        },
    };

    // ── ปุ่มในแท็บสรุป ──────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // V0.7.5: เอาปุ่มส่งออกในแท็บสรุปออก — ใช้ปุ่ม Export To DMS ที่แถบล่าง / หน้าภาพรวมแทน
    });

    return D;
})();

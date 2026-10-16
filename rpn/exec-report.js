/* =============================================================================
 *  exec-report.js — Export รายงาน Executive (V0.9.0 · ปรับ V0.9.10)
 * =============================================================================
 *  ปุ่ม 📊 ที่หน้าภาพรวมแผน → ไฟล์ Excel 11 ชีท ตามสายที่เลือกดูอยู่
 *    Executive Summary · Route Summary · Daily Calendar · ตลาด · Movement · รอจัดสาย
 *    Issues · Raw Data · Prev Plan · Parameters · Definitions
 *  ตัวเลขทุกช่องในหน้าสรุปเป็นสูตรที่ดึงจากชีทข้อมูล (Raw Data / Prev Plan / ...) — Excel คำนวณตอนเปิดไฟล์
 *  เทียบกับ "แผนเดือนก่อนที่อยู่ในโปรแกรม" (ตัวเดียวกับตาราง Details by Route) — ไม่มีเดือนก่อน = ส่วนเทียบว่าง
 *  ใช้ ExcelJS (vendor/exceljs.min.js) โหลดเมื่อกดครั้งแรก — SheetJS รุ่นฟรีใส่สี/แถบสี/ตั้งหน้ากระดาษไม่ได้
 * ========================================================================== */
(function () {
    'use strict';

    const UNASSIGNED = 'รอจัดสาย';
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const WDN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // V0.9.10: ชื่อประเภทสาย · ยอดรวมในรายงาน = P/V/C (สาย E = Spare/Gainer แยกนับ ไม่รวมในยอด)
    const TYPN = { P: 'Presales', V: 'Vansales', C: 'Credit', E: 'Spare/Gainer' };
    const CATS = ['RTL', 'WAP', 'WHC', 'LMT', 'MNT', 'OTR'];
    const SEGS = ['Resident S', 'Resident M', 'Resident L', 'Market', 'Factory', 'Gas Station', 'Education', 'Transportation', 'Hospital', 'None'];
    const BUCK = ['ต่ำกว่า 15', '15–19', '20–24', '25–29', '30–34', '35–39', '40 ขึ้นไป'];
    const GRP = { PV: ['???P*', '???V*'], C: ['???C*'], E: ['???E*'] };
    const GRPN = { PV: 'P/V (Presales / Vansales)', C: 'C (Credit)', E: 'E (Spare/Gainer)' };
    const NOTIN = '(ไม่อยู่แผนเดือนนี้)';
    const CL = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
    const ymd = (d) => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    const asDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
    const xDate = (d) => d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
    const typeOf = (rt) => { const m = /^\d{3}([A-Za-z])/.exec(String(rt || '')); return m ? m[1].toUpperCase() : ''; };

    // ── ไลบรารี ─────────────────────────────────────────────────────────
    let libP = null;
    const lib = () => {
        if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
        if (libP) return libP;
        libP = new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = 'vendor/exceljs.min.js';
            el.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('โหลด ExcelJS ไม่สำเร็จ'));
            el.onerror = () => { libP = null; reject(new Error('ไม่พบไฟล์ vendor/exceljs.min.js')); };
            document.head.appendChild(el);
        });
        return libP;
    };

    // ── ประกอบข้อมูลจากโปรแกรม ───────────────────────────────────────────
    const collect = async () => {
        const OV = window.PlanOverview;
        const p = OV._ymParts();
        if (!p) throw new Error('ยังไม่ได้เลือกเดือน');
        try { await OV.loadBase(); } catch (e) {}
        const base = (OV._base() || {}).data || null;
        const baseYM = (OV._base() || {}).ym || '';
        const R = State.db.routes || {};
        // V0.9.10: สาย E (Spare/Gainer) อยู่ท้ายสุดเสมอ — ไม่นับรวมในยอด P/V/C
        const rts = OV._scopeRoutes().filter(rt => rt !== UNASSIGNED && Array.isArray(R[rt]))
            .sort((a, b) => ((typeOf(a) === 'E') - (typeOf(b) === 'E')) || a.localeCompare(b, 'th', { numeric: true }));
        if (!rts.length) throw new Error('ยังไม่ได้เลือกสาย — ติ๊กเลือกสายที่ช่อง "ดู" ก่อน');
        const last = new Date(p.y, p.m0 + 1, 0).getDate();

        // ร้านในแผนเดือนนี้ (ทุกสาย ไม่เฉพาะที่เลือก — ใช้หาว่าร้านในเดือนฐานไปอยู่ไหน)
        const curRoute = {}, curStore = {};
        Object.keys(R).forEach(rt => (R[rt] || []).forEach(s => {
            const c = String(s.code || s.id || '');
            if (!c) return;
            if (!curStore[c]) curStore[c] = s;
            if (rt !== UNASSIGNED && !s.inactive && (s.days || []).length && !curRoute[c]) { curRoute[c] = rt; curStore[c] = s; }
        }));

        // Raw rows: ร้าน × ครั้งเข้าเยี่ยม (เหมือนปฏิทินหน้าภาพรวม)
        const rows = [];
        rts.forEach(rt => {
            const list = (R[rt] || []).filter(s => !s.inactive && (s.days || []).length);
            const dayKeys = [...new Set(list.flatMap(s => s.days))].sort((a, b) => dayNum(a) - dayNum(b));
            const mk = {};
            dayKeys.forEach(d => { try { mk[d] = RoadMaster.marketName(rt, d, list) || ''; } catch (e) { mk[d] = ''; } });
            const datesOf = {};
            dayKeys.forEach(d => {
                let dates = [];
                try { dates = (DmsExport.datesOf(rt, d) || []).filter(Boolean); } catch (e) {}
                let runs = dates.length || 1;
                try { if (typeof Freq !== 'undefined' && Freq.runsOf) runs = Freq.runsOf(rt, d) || 1; } catch (e) {}
                const inMonth = dates.slice(0, Math.max(1, runs)).filter(dt => dt.getMonth() === p.m0 && dt.getFullYear() === p.y);
                datesOf[d] = inMonth;
            });
            list.forEach(s => {
                const c = String(s.code || s.id);
                s.days.slice().sort((a, b) => dayNum(a) - dayNum(b)).forEach(d => {
                    // V0.9.12: ช่องที่เป็นครั้งอื่นของตลาดหลัก (เช่น D13 ที่ร้านไม่เหมือน D1) นับเป็นตลาดหลัก D1
                    const bd = ((typeof Runs !== 'undefined' && Runs.metaOf && Runs.metaOf(rt, d)) || {}).src || d;
                    (datesOf[d] || []).forEach(dt => rows.push({
                        date: dt, rt, d: bd, slot: d, day: dayNum(bd), market: s.marketName || mk[d] || '',
                        seq: (s.seqs && s.seqs[d]) || '', cy: (s.cys && s.cys[d]) || s.cy || '', times: s.days.length,
                        c, s, base: base ? (base.route[c] ? (base.route[c] === rt ? 'สายเดิม' : 'ย้ายจาก ' + base.route[c]) : 'ร้านใหม่ (ไม่อยู่แผนเดือนก่อน)') : 'ไม่มีแผนเดือนก่อนให้เทียบ',
                    }));
                });
            });
        });
        rows.sort((a, b) => a.rt.localeCompare(b.rt, 'th', { numeric: true }) || (a.date - b.date) || ((+a.seq || 9999) - (+b.seq || 9999)));
        const seenS = new Set(), seenRD = new Set(), seenMK = new Set(), seenMD = new Set(), cnt = {};
        rows.forEach(r => {
            r.fs = seenS.has(r.c) ? 0 : 1; seenS.add(r.c);
            const kd = r.rt + '|' + ymd(r.date); r.frd = seenRD.has(kd) ? 0 : 1; seenRD.add(kd);
            const km = r.c + '|' + r.rt + '|' + r.d; r.fmk = seenMK.has(km) ? 0 : 1; seenMK.add(km);
            const kmd = r.rt + '|' + r.d + '|' + ymd(r.date); r.fmd = seenMD.has(kmd) ? 0 : 1; seenMD.add(kmd);
            cnt[r.c] = (cnt[r.c] || 0) + 1; r.vno = cnt[r.c];
        });

        // ตลาด (สาย × Day)
        const mkMap = new Map();
        rows.forEach(r => { const k = r.rt + '|' + r.d; if (!mkMap.has(k)) mkMap.set(k, { rt: r.rt, d: r.d, day: r.day, name: r.market }); });
        const markets = [...mkMap.values()].sort((a, b) => a.rt.localeCompare(b.rt, 'th', { numeric: true }) || a.day - b.day);

        // แผนเดือนก่อน
        const prev = [];
        if (base) Object.entries(base.route).forEach(([c, rt]) => {
            const cs = curStore[c];
            prev.push({ c, rt, now: curRoute[c] || NOTIN, st0: (base.info[c] || {}).shopType || '', st1: cs ? (cs.shopType || '') : '',
                        name: (base.info[c] || {}).name || (cs && cs.name) || '' });
        });
        prev.sort((a, b) => a.c.localeCompare(b.c));

        // รอจัดสาย
        const waiting = (R[UNASSIGNED] || []).filter(s => !s.inactive)
            .slice().sort((a, b) => String(b.openDate || '').localeCompare(String(a.openDate || '')));

        // ศูนย์ / Master / ร้านที่ไม่ได้นำเข้า
        let center = {}, planDoc = {}, baseDoc = {};
        try { center = (await App.dbRef.get()).data() || {}; } catch (e) {}
        try { planDoc = (await App.planRef(App._currentPlanYM).get()).data() || {}; } catch (e) {}
        if (baseYM) { try { baseDoc = (await App.planRef(baseYM).get()).data() || {}; } catch (e) {} }
        const info = planDoc.importInfo || baseDoc.importInfo || null;
        const mActive = (center.masterInfo && center.masterInfo.mActive) || (info && info.mActive) || '';

        // Issues
        const iss = [];
        const scopeSet = new Set(rts);
        Object.keys(R).filter(rt => scopeSet.has(rt)).forEach(rt => (R[rt] || []).forEach(s => {
            if (!s.inactive && (s.days || []).length && /inactive/i.test(s.status || ''))
                iss.push(['ℹ️ ข้อสังเกต', 'ร้านอยู่ในแผนแต่ InActive ใน Master', rt, '', s.code || s.id, s.name, 'ถามศูนย์ว่ายังเข้าเยี่ยมอยู่หรือไม่ ถ้าใช่ต้องเปิด Active', 'Customer Master × แผนเดือนนี้']);
        }));
        ((info && info.skipped) || []).filter(x => !x.route || scopeSet.has(x.route)).forEach(x => {
            const topic = x.why === 'ไม่มีพิกัด' ? 'ร้านในแผนไม่มีพิกัดใน Master' : x.why === 'ไม่มีใน Customer Master' ? 'ร้านในแผนไม่มีใน Customer Master' : 'ร้านในแผนแต่ InActive ใน Master (ไม่ได้นำเข้า)';
            iss.push(['ℹ️ ข้อสังเกต', topic, x.route || '', '', x.id, x.name || '', 'ร้านนี้ไม่ได้อยู่ในโปรแกรม — แก้ที่ Master แล้วนำเข้าใหม่', 'ไฟล์ RoutePlan × Customer Master ตอนนำเข้า']);
        });
        try {
            (OV._issues() || []).forEach(x => iss.push([x.info ? 'ℹ️ ข้อสังเกต' : (x.lock ? '🔒 ส่งออกไม่ได้' : '⚠️ คำเตือน'),
                'หน้าภาพรวมแผน: ' + String(x.t || '').replace(/<[^>]+>/g, ''), '', '', '', '', String(x.s || ''), 'กฎคำเตือนของโปรแกรม']));
        } catch (e) {}

        // V0.9.10: ร้าน Active ใน Master เฉพาะประเภทสายที่นำเข้า (P/V/C — ตาม Salesman Code) ถ้ามีข้อมูลแยกประเภท
        const mBy = (info && info.mActiveBy) || (center.masterInfo && center.masterInfo.mActiveBy) || null;
        const mTypes = (info && info.types) || (center.masterInfo && center.masterInfo.types) || ['P', 'V', 'C'];
        const mActivePVC = mBy ? ['P', 'V', 'C'].filter(t => mTypes.includes(t)).reduce((t, k) => t + (mBy[k] || 0), 0) : mActive;
        // ระยะทางรายวัน (สาย × วันที่) — ตัวเดียวกับตารางรายวันในหน้าภาพรวมแผน
        const dist = {};
        try {
            const DD = OV._daily();
            if (OV._distClear) OV._distClear();
            rts.forEach(rt => { const r = (DD && DD.rows[rt]) || {}; dist[rt] = {}; Object.keys(r).forEach(d => { dist[rt][d] = OV._distOf(rt, r[d].days); }); });
        } catch (e) { console.warn('[ExecReport] dist', e); }

        return { p, last, rts, rows, markets, prev, waiting, iss, base, baseYM, mActive: mActivePVC, mActiveAll: mActive, mBy, dist, center,
                 hol: OV._holidayInfo(), ymLabel: OV._ymLabel(App._currentPlanYM), baseLabel: baseYM ? OV._ymLabel(baseYM) : '',
                 centerId: String(window.CENTER_ID || ''), lo: OV.LOAD_MIN || 15, hi: OV.LOAD_MAX || 45 };
    };

    // ── เขียนไฟล์ ────────────────────────────────────────────────────────
    const build = async (D) => {
        const ExcelJS = await lib();
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Route Planner';
        wb.calcProperties = { fullCalcOnLoad: true };
        const FN = 'Tahoma', NAVY = 'FF1F3864', BLUE = 'FF2F5597', LIGHT = 'FFD9E1F2', GREY = 'FF808080';
        const F = (sz, b, c, i) => ({ name: FN, size: sz || 10, bold: !!b, italic: !!i, color: { argb: c || 'FF000000' } });
        const FILL = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
        const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
        const BOX = { top: thin, left: thin, bottom: thin, right: thin };
        const CEN = { horizontal: 'center', vertical: 'middle', wrapText: true };
        const LEFT = { horizontal: 'left', vertical: 'middle', wrapText: true };
        const fx = (f) => ({ formula: f.replace(/^=/, '') });

        const add = (name, opt) => wb.addWorksheet(name, { views: [{ showGridLines: false, ...(opt || {}) }] });
        const E = add('Executive Summary');
        const RS = add('Route Summary', { state: 'frozen', xSplit: 1, ySplit: 4 });
        const DC = add('Daily Calendar', { state: 'frozen', xSplit: 1, ySplit: 5 });
        const MK = add('ตลาด', { state: 'frozen', ySplit: 2 });
        const MV = add('Movement', { state: 'frozen', ySplit: 3 });
        const WT = add('รอจัดสาย', { state: 'frozen', ySplit: 2 });
        const IS = add('Issues', { state: 'frozen', ySplit: 3 });
        const RW = add('Raw Data', { state: 'frozen', ySplit: 2 });
        const PV = add('Prev Plan', { state: 'frozen', ySplit: 2 });
        const PR = add('Parameters');
        const DF = add('Definitions');

        const put = (ws, r, c, v, o) => {
            const cell = ws.getCell(r, c);
            cell.value = (typeof v === 'string' && v.startsWith('=')) ? fx(v) : (v === undefined ? null : v);
            o = o || {};
            cell.font = o.font || F(10);
            if (o.fmt) cell.numFmt = o.fmt;
            if (o.al) cell.alignment = o.al;
            if (o.bd !== false) cell.border = BOX;
            if (o.fill) cell.fill = FILL(o.fill);
            return cell;
        };
        const hdr = (ws, r, heads, c0, h) => {
            heads.forEach((t, j) => put(ws, r, (c0 || 1) + j, t, { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN }));
            ws.getRow(r).height = h || 30;
        };
        const title = (ws, text, sub) => {
            ws.getCell('A1').value = text; ws.getCell('A1').font = F(14, true, NAVY);
            if (sub) { ws.getCell('A2').value = sub; ws.getCell('A2').font = F(9, false, GREY); }
        };
        const widths = (ws, arr) => arr.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
        const curL = D.ymLabel, baseL = D.baseLabel || 'เดือนก่อน';

        // ── Parameters
        title(PR, 'Parameters — ค่าตั้งต้นที่ใช้คำนวณ (ช่องเหลือง = โปรแกรมใส่ให้ตอน Export · แก้ได้)');
        hdr(PR, 3, ['รายการ', 'ค่า', 'ที่มา']);
        const p1 = new Date(D.p.y, D.p.m0, 1); const cut = new Date(p1.getTime() - 90 * 86400000);
        const params = [
            ['ร้าน Active ใน Master (สาย P/V/C)', D.mActive === '' ? null : D.mActive, '#,##0', D.mActive === '' ? 'ยังไม่มีข้อมูล — นำเข้า Customer Master อีกครั้งด้วยโปรแกรมเวอร์ชันนี้'
                : (D.mBy ? `จาก Customer Master ล่าสุด · นับตาม Salesman Code สาย P/V/C (ทั้งหมด ${Number(D.mActiveAll || 0).toLocaleString()} · สาย E ${Number(D.mBy.E || 0).toLocaleString()})` : 'จาก Customer Master ที่นำเข้า/ซิงก์ล่าสุด (ยังไม่แยกประเภทสาย — นำเข้า Master ใหม่ด้วย V0.9.10 เพื่อแยก)')],
            ['เกณฑ์ร้านต่อวัน ต่ำสุด (สาย P/V)', D.lo, '0', 'กฎคำเตือนในโปรแกรม'],
            ['เกณฑ์ร้านต่อวัน สูงสุด (สาย P/V)', D.hi, '0', 'กฎคำเตือนในโปรแกรม'],
            ['วันตัด "ร้านใหม่" (เปิดบัญชีตั้งแต่วันนี้)', xDate(cut), 'yyyy-mm-dd', '90 วันก่อนวันที่ 1 ของเดือนแผน'],
        ];
        const P = {};
        params.forEach((x, i) => {
            const r = 4 + i;
            put(PR, r, 1, x[0]); put(PR, r, 2, x[1], { fmt: x[2], font: F(10, false, 'FF0000FF'), fill: 'FFFFFF00' }); put(PR, r, 3, x[3], { font: F(9, false, GREY) });
            P[i] = `Parameters!$B$${r}`;
        });
        const [P_ACT, P_LO, P_HI, P_CUT] = [P[0], P[1], P[2], P[3]];
        const hr = 4 + params.length + 1;
        PR.getCell(hr, 1).value = 'วันหยุดในเดือน (วันหยุดของทุกสายที่เลือก)'; PR.getCell(hr, 1).font = F(10, true);
        const holDates = [];
        for (let d = 1; d <= D.last; d++) {
            const wd = new Date(D.p.y, D.p.m0, d).getDay();
            if (D.hol.weekly.includes(wd) || (D.hol.adhoc || []).map(Number).includes(d)) holDates.push(new Date(D.p.y, D.p.m0, d));
        }
        holDates.forEach((d, k) => { put(PR, hr + 1 + k, 1, WDN[d.getDay()]); put(PR, hr + 1 + k, 2, xDate(d), { fmt: 'yyyy-mm-dd', font: F(10, false, 'FF0000FF'), fill: 'FFFFFF00' }); });
        const HOLR = `Parameters!$B$${hr + 1}:$B$${hr + Math.max(1, holDates.length)}`;
        widths(PR, [40, 14, 60]);

        // ── Raw Data
        title(RW, 'Raw Data — 1 แถว = ร้าน 1 ร้าน × การเข้าเยี่ยม 1 ครั้ง · ทุกตัวเลขในรายงานคำนวณจากชีทนี้');
        const RH = ['Visit Date', 'วัน', 'Route', 'ประเภทสาย', 'Day', 'ครั้ง/รอบ', 'ลำดับในวัน', 'Cycle Code', 'ชื่อตลาด', 'Customer Code',
            'Customer Name', 'Outlet Category', 'Segmentation', 'Brand Bonus', 'ครั้งที่เข้า', 'นับร้าน (ครั้งแรก=1)', 'นับวันทำงาน (สาย-วัน แรก=1)',
            'นับร้านในตลาด (แรก=1)', 'นับวันของตลาด (แรก=1)', 'Status (Master)', 'Salesman', 'ตำบล', 'อำเภอ', 'จังหวัด', 'Latitude', 'Longitude', 'Movement vs ' + baseL];
        hdr(RW, 2, RH, 1, 32);
        D.rows.forEach((r, i) => {
            const s = r.s;
            RW.getRow(3 + i).values = [xDate(r.date), WDN[r.date.getDay()], r.rt, TYPN[typeOf(r.rt)] || typeOf(r.rt), r.day, r.times, r.seq || null,
                r.cy, r.market, r.c, s.name || '', s.shopType || '', s.segment || '', s.brandBonus || '', r.vno, r.fs, r.frd, r.fmk, r.fmd,
                s.status || '', s.salesCode || '', s.subDistrict || '', s.district || '', s.province || '', +s.lat || null, +s.lng || null, r.base];
        });
        RW.getColumn(1).numFmt = 'yyyy-mm-dd';
        widths(RW, [11, 5, 9, 10, 5, 7, 7, 14, 26, 12, 34, 8, 10, 7, 7, 9, 10, 10, 10, 10, 10, 16, 18, 14, 10, 10, 26]);
        const N = 2 + Math.max(1, D.rows.length);
        RW.autoFilter = `A2:${CL(RH.length)}${N}`;
        const col = {}; RH.forEach((h, j) => { col[h] = CL(j + 1); });
        const rg = (h) => `'Raw Data'!$${col[h]}$3:$${col[h]}$${N}`;
        const R_DATE = rg('Visit Date'), R_RT = rg('Route'), R_DAY = rg('Day'), R_VNO = rg('ครั้งที่เข้า'), R_FS = rg('นับร้าน (ครั้งแรก=1)'),
              R_FRD = rg('นับวันทำงาน (สาย-วัน แรก=1)'), R_FMK = rg('นับร้านในตลาด (แรก=1)'), R_FMD = rg('นับวันของตลาด (แรก=1)'),
              R_CAT = rg('Outlet Category'), R_SEG = rg('Segmentation'), R_MOVE = rg('Movement vs ' + baseL);

        // ── ตลาด
        title(MK, 'ตลาด — 1 แถว = 1 ตลาด (สาย × Day) · จำนวนร้านคำนวณจาก Raw Data');
        hdr(MK, 2, ['สาย', 'ประเภท', 'ประเมิน (P/V)', 'Day', 'ชื่อตลาด', 'ร้านในตลาด', 'วันที่วิ่งในเดือน', 'ช่วงจำนวนร้าน']);
        D.markets.forEach((m, k) => {
            const i = 3 + k;
            const vals = [m.rt, TYPN[typeOf(m.rt)] || typeOf(m.rt), `=IF(OR(MID(A${i},4,1)="P",MID(A${i},4,1)="V"),"Y","N")`, m.day, m.name,
                `=SUMIFS(${R_FMK},${R_RT},A${i},${R_DAY},D${i})`, `=SUMIFS(${R_FMD},${R_RT},A${i},${R_DAY},D${i})`,
                `=IF(F${i}<15,"${BUCK[0]}",IF(F${i}<20,"${BUCK[1]}",IF(F${i}<25,"${BUCK[2]}",IF(F${i}<30,"${BUCK[3]}",IF(F${i}<35,"${BUCK[4]}",IF(F${i}<40,"${BUCK[5]}","${BUCK[6]}"))))))`];
            vals.forEach((v, j) => put(MK, i, j + 1, v, { font: F(9), bd: false }));
        });
        const NMK = 2 + Math.max(1, D.markets.length);
        widths(MK, [9, 11, 10, 6, 34, 10, 14, 14]);
        MK.autoFilter = `A2:H${NMK}`;
        const MK_RT = `'ตลาด'!$A$3:$A$${NMK}`, MK_EV = `'ตลาด'!$C$3:$C$${NMK}`, MK_B = `'ตลาด'!$H$3:$H$${NMK}`;

        // ── Prev Plan
        title(PV, `Prev Plan — ร้านในแผน ${baseL} และสายในแผน ${curL}`);
        hdr(PV, 2, ['Customer Code', 'สาย ' + baseL, 'สาย ' + curL, 'Shop type ' + baseL, 'Shop type ' + curL, 'เปลี่ยน Shop type']);
        D.prev.forEach((x, k) => {
            const i = 3 + k;
            PV.getRow(i).values = [x.c, x.rt, x.now, x.st0, x.st1, fx(`IF(AND(E${i}<>"",D${i}<>"",D${i}<>E${i}),1,0)`)];
        });
        const NP = 2 + Math.max(1, D.prev.length);
        widths(PV, [14, 12, 20, 14, 14, 14]);
        PV.autoFilter = `A2:F${NP}`;
        const PV_RT = `'Prev Plan'!$B$3:$B$${NP}`, PV_NOW = `'Prev Plan'!$C$3:$C$${NP}`, PV_CS = `'Prev Plan'!$D$3:$D$${NP}`,
              PV_CO = `'Prev Plan'!$E$3:$E$${NP}`, PV_CH = `'Prev Plan'!$F$3:$F$${NP}`;

        // ── รอจัดสาย
        title(WT, 'รอจัดสาย — ร้าน Active ใน Master ที่มีพิกัด แต่ยังไม่อยู่ในแผน (กองรอจัดสายในโปรแกรม)');
        hdr(WT, 2, ['Customer Code', 'Customer Name', 'Outlet Category', 'Salesman', 'เปิดบัญชี', 'ร้านใหม่?', 'Latitude', 'Longitude']);
        D.waiting.forEach((s, k) => {
            const i = 3 + k;
            WT.getRow(i).values = [String(s.code || s.id), s.name || '', s.shopType || '', s.salesCode || '', asDate(s.openDate),
                fx(`IF(E${i}="","ไม่ทราบ",IF(E${i}>=${P_CUT},"ร้านใหม่","ร้านเก่า"))`), +s.lat || null, +s.lng || null];
        });
        WT.getColumn(5).numFmt = 'yyyy-mm-dd';
        const NW = 2 + Math.max(1, D.waiting.length);
        widths(WT, [13, 36, 9, 10, 11, 10, 10, 10]);
        WT.autoFilter = `A2:H${NW}`;

        // ── Issues
        title(IS, `Issues — รายการที่ระบบตรวจเจอ · ศูนย์ ${D.centerId} · ${curL}`, 'แต่ละแถวมาจากการตรวจข้อมูลตอน Export — คอลัมน์ "ที่มา" บอกว่าตรวจจากอะไร');
        hdr(IS, 3, ['ระดับ', 'หัวข้อ', 'สาย', 'วันที่', 'รหัสร้าน', 'ชื่อร้าน', 'รายละเอียด / สิ่งที่ต้องทำ', 'ที่มา']);
        D.iss.forEach((x, k) => x.forEach((v, j) => put(IS, 4 + k, j + 1, v === '' ? null : v, { font: F(9), al: j >= 6 ? LEFT : undefined })));
        const NI = 3 + Math.max(1, D.iss.length);
        widths(IS, [13, 40, 9, 11, 13, 32, 60, 30]);
        IS.autoFilter = `A3:H${NI}`;
        const IS_TOP = `Issues!$B$4:$B$${NI}`;

        // ── Daily Calendar — V0.9.10: ใต้จำนวนร้านมีแถวระยะทาง (กม.) · สาย E อยู่ท้ายแยกยอด
        title(DC, `Daily Calendar — จำนวนร้านและระยะทางรายวัน · ศูนย์ ${D.centerId} · ${curL}`,
              'จำนวนร้านคำนวณจาก Raw Data · แถว "กม." = ระยะตามลำดับคิว (ฟ้า = ยังไม่ใส่จุดเริ่ม/จุดจบ เป็นระยะระหว่างร้าน) · เทาอ่อน = ไม่เข้าเยี่ยม · เทาเข้ม = วันหยุด · ส้ม/แดง = ต่ำ/เกินเกณฑ์ (เฉพาะสาย P/V)');
        put(DC, 4, 1, '', { fill: NAVY }); put(DC, 5, 1, 'สาย', { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN });
        for (let d = 1; d <= D.last; d++) {
            const c = 1 + d, L = CL(c), dt = new Date(D.p.y, D.p.m0, d), bg = dt.getDay() === 0 ? 'FFC00000' : NAVY;
            put(DC, 4, c, `=TEXT(${L}5,"ddd")`, { font: F(8, true, 'FFFFFFFF'), fill: bg, al: CEN });
            put(DC, 5, c, xDate(dt), { fmt: 'd', font: F(9, true, 'FFFFFFFF'), fill: bg, al: CEN });
        }
        const cT = 2 + D.last, LL = CL(cT - 1);
        put(DC, 4, cT, '', { fill: NAVY }); put(DC, 5, cT, 'Total', { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN });
        const KM = 'กม.', BLUEF = 'FFDBEAFE';
        const rtsMain = D.rts.filter(rt => typeOf(rt) !== 'E'), rtsE = D.rts.filter(rt => typeOf(rt) === 'E');
        const dcRow = {};
        let rr0 = 6;
        const dcRoute = (rt) => {
            const rr = rr0; dcRow[rt] = rr; rr0 += 2;
            put(DC, rr, 1, rt, { font: F(10, true) });
            put(DC, rr + 1, 1, KM, { font: F(8, false, GREY), al: { horizontal: 'right' } });
            const ds = D.dist[rt] || {};
            for (let d = 1; d <= D.last; d++) {
                put(DC, rr, 1 + d, `=COUNTIFS(${R_RT},$A${rr},${R_DATE},${CL(1 + d)}$5)`, { fmt: '0;-0;""', font: F(9), al: CEN });
                const x = ds[d];
                put(DC, rr + 1, 1 + d, x ? x.km : null, { fmt: '0.0', font: F(7, false, x && x.missing ? 'FF1D4ED8' : 'FF595959'), al: CEN, fill: x && x.missing ? BLUEF : undefined });
            }
            put(DC, rr, cT, `=SUM(B${rr}:${LL}${rr})`, { fmt: '#,##0', font: F(10, true), al: CEN });
            put(DC, rr + 1, cT, `=SUM(B${rr + 1}:${LL}${rr + 1})`, { fmt: '#,##0', font: F(8, false, GREY), al: CEN });
        };
        const dcTotal = (label, a, b) => {
            const rr = rr0; rr0 += 2;
            put(DC, rr, 1, label, { font: F(10, true), fill: LIGHT });
            put(DC, rr + 1, 1, KM, { font: F(8, true, GREY), fill: LIGHT, al: { horizontal: 'right' } });
            for (let c = 2; c <= cT; c++) {
                const L = CL(c);
                put(DC, rr, c, b < a ? 0 : `=SUMIF($A$${a}:$A$${b},"<>${KM}",${L}${a}:${L}${b})`, { fmt: '#,##0;-#,##0;""', font: F(9, true), al: CEN, fill: LIGHT });
                put(DC, rr + 1, c, b < a ? 0 : `=SUMIF($A$${a}:$A$${b},"${KM}",${L}${a}:${L}${b})`, { fmt: '#,##0;-#,##0;""', font: F(7, true, GREY), al: CEN, fill: LIGHT });
            }
            return rr;
        };
        const a0 = rr0; rtsMain.forEach(dcRoute);
        const rD = dcTotal('Total P/V/C', a0, rr0 - 1);
        let rDE = 0;
        if (rtsE.length) { const a1 = rr0; rtsE.forEach(dcRoute); rDE = dcTotal('Total E (Spare/Gainer)', a1, rr0 - 1); }
        const dcLast = rr0 - 1;
        const dx = (bg, fc, b) => ({ fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: bg }, fgColor: { argb: bg } }, font: { color: { argb: fc || 'FF000000' }, bold: !!b } });
        DC.addConditionalFormatting({ ref: `B6:${LL}${dcLast}`, rules: [
            { type: 'expression', priority: 1, stopIfTrue: true, formulae: [`AND(LEFT($A6,5)<>"Total",COUNTIF(${HOLR},B$5)>0)`], style: dx('FF808080', 'FFFFFFFF') },
            { type: 'expression', priority: 2, stopIfTrue: true, formulae: [`AND(LEFT($A6,5)<>"Total",B6=0)`], style: dx('FFEDEDED') },
            { type: 'expression', priority: 3, stopIfTrue: true, formulae: [`AND(OR(MID($A6,4,1)="P",MID($A6,4,1)="V"),B6>${P_HI})`], style: dx('FFFFC7CE', 'FF9C0006', true) },
            { type: 'expression', priority: 4, stopIfTrue: true, formulae: [`AND(OR(MID($A6,4,1)="P",MID($A6,4,1)="V"),B6<${P_LO})`], style: dx('FFFCE4D6', 'FF9C0006', true) },
        ] });
        DC.getColumn(1).width = 12;
        for (let c = 2; c < cT; c++) DC.getColumn(c).width = 4.8;
        DC.getColumn(cT).width = 8;

        // ── Route Summary — V0.9.10: ตัดคอลัมน์สถานะ · มาตรฐาน Coverage F1/F2 · Segmentation · ขนาดตลาดช่วงละ 5 · สาย E ท้ายสุดแยกยอด
        title(RS, `Route Summary — ศูนย์ ${D.centerId} · ${curL}`, `ทุกตัวเลขคำนวณจาก Raw Data / Daily Calendar / Prev Plan · เทียบกับแผน ${baseL} · ยอด "รวม P/V/C" ไม่รวมสาย E (Spare/Gainer) · มาตรฐาน Coverage (สาย P/V): Re-Visit > 15% = F2 (420 ร้าน) · ไม่ถึง = F1 (600 ร้าน)`);
        const H = ['สาย', 'ประเภท', 'ประเมินเกณฑ์', 'Working Day', 'Coverage', 'Visit', 'Re-Visit', 'Re-Visit %', 'มาตรฐาน Coverage', 'Visit/Day',
            'ร้าน/วัน ต่ำสุด', 'ร้าน/วัน สูงสุด', 'วันนอกเกณฑ์', 'Coverage ' + baseL, 'Diff', 'Match', 'ร้านใหม่', 'ย้ายเข้า', 'ย้ายออก', 'Remove',
            ...SEGS.map(x => 'Seg ' + x), 'Seg อื่น ๆ', 'จำนวนตลาด', ...BUCK.map(b => 'ตลาด ' + b), 'ระยะทาง (กม.)'];
        const C = {}; H.forEach((h, j) => { C[h] = CL(j + 1); });
        hdr(RS, 4, H, 1, 40);
        const r0 = 5, rsRow = {};
        const rsRoute = (rt, rr) => {
            rsRow[rt] = rr;
            const dr = dcRow[rt], drow = `'Daily Calendar'!$B$${dr}:$${LL}$${dr}`;
            const c = (h) => C[h] + rr;
            const v = {
                'สาย': rt, 'ประเภท': TYPN[typeOf(rt)] || typeOf(rt), 'ประเมินเกณฑ์': `=IF(OR(MID(A${rr},4,1)="P",MID(A${rr},4,1)="V"),"Y","N")`,
                'Working Day': `=SUMIFS(${R_FRD},${R_RT},A${rr})`, 'Coverage': `=SUMIFS(${R_FS},${R_RT},A${rr})`, 'Visit': `=COUNTIF(${R_RT},A${rr})`,
                'Re-Visit': `=COUNTIFS(${R_RT},A${rr},${R_VNO},2)`, 'Re-Visit %': `=IF(${c('Coverage')}=0,0,${c('Re-Visit')}/${c('Coverage')})`,
                'มาตรฐาน Coverage': `=IF(${c('ประเมินเกณฑ์')}<>"Y","—",IF(${c('Coverage')}=0,"—",IF(${c('Re-Visit %')}>0.15,"F2 · 420","F1 · 600")))`,
                'Visit/Day': `=IF(${c('Working Day')}=0,0,ROUNDUP(${c('Visit')}/${c('Working Day')},0))`,
                'ร้าน/วัน ต่ำสุด': `=_xlfn.MINIFS(${drow},${drow},">0")`, 'ร้าน/วัน สูงสุด': `=MAX(${drow})`,
                'วันนอกเกณฑ์': `=IF(${c('ประเมินเกณฑ์')}="Y",COUNTIFS(${drow},">0",${drow},"<"&${P_LO})+COUNTIF(${drow},">"&${P_HI}),"—")`,
                ['Coverage ' + baseL]: `=COUNTIF(${PV_RT},A${rr})`,
                'Diff': `=IF(${c('Coverage ' + baseL)}=0,"",${c('Coverage')}-${c('Coverage ' + baseL)})`,
                'Match': `=IF(${c('Coverage ' + baseL)}=0,"",IF(${c('Diff')}>0,"▲ Increase",IF(${c('Diff')}<0,"▼ Decrease","Equal")))`,
                'ร้านใหม่': `=COUNTIFS(${R_RT},A${rr},${R_FS},1,${R_MOVE},"ร้านใหม่*")`, 'ย้ายเข้า': `=COUNTIFS(${R_RT},A${rr},${R_FS},1,${R_MOVE},"ย้ายจาก*")`,
                'ย้ายออก': `=COUNTIFS(${PV_RT},A${rr},${PV_NOW},"<>"&A${rr},${PV_NOW},"<>${NOTIN}")`, 'Remove': `=COUNTIFS(${PV_RT},A${rr},${PV_NOW},"${NOTIN}")`,
                'Seg อื่น ๆ': `=${c('Coverage')}-SUM(${C['Seg ' + SEGS[0]]}${rr}:${C['Seg ' + SEGS[SEGS.length - 1]]}${rr})`,
                'จำนวนตลาด': `=COUNTIF(${MK_RT},$A${rr})`,
                'ระยะทาง (กม.)': `='Daily Calendar'!${CL(cT)}${dr + 1}`,
            };
            SEGS.forEach(x => { v['Seg ' + x] = `=COUNTIFS(${R_RT},$A${rr},${R_FS},1,${R_SEG},"${x}")`; });
            BUCK.forEach(b => { v['ตลาด ' + b] = `=COUNTIFS(${MK_RT},$A${rr},${MK_B},"${b}")`; });
            H.forEach((h, j) => put(RS, rr, j + 1, v[h], {
                fmt: h === 'Diff' ? '+#,##0;-#,##0;0' : h === 'Re-Visit %' ? '0%' : h === 'ระยะทาง (กม.)' ? '#,##0' : (j + 1 >= 17 ? '#,##0;-#,##0;"-"' : '#,##0'),
                font: F(10, j === 0 || h === 'Coverage'), al: ['ประเภท', 'ประเมินเกณฑ์', 'มาตรฐาน Coverage', 'วันนอกเกณฑ์', 'Match', 'Re-Visit %'].includes(h) ? CEN : undefined }));
        };
        const rsTotal = (rr, label, a, b, dcTot) => {
            put(RS, rr, 1, label, { font: F(10, true), fill: LIGHT }); put(RS, rr, 2, '', { fill: LIGHT }); put(RS, rr, 3, '', { fill: LIGHT });
            for (let j = 4; j <= H.length; j++) {
                const h = H[j - 1], L = CL(j), rng = `${L}${a}:${L}${b}`, c = (x) => C[x] + rr;
                const cr = `${C['ประเมินเกณฑ์']}${a}:${C['ประเมินเกณฑ์']}${b}`;
                const v = b < a ? 0 : ({
                    'Working Day': `=COUNTIF('Daily Calendar'!B${dcTot}:${LL}${dcTot},">0")`,
                    'Re-Visit %': `=IF(${c('Coverage')}=0,0,${c('Re-Visit')}/${c('Coverage')})`, 'มาตรฐาน Coverage': '',
                    'Visit/Day': `=IF(SUM(${C['Working Day']}${a}:${C['Working Day']}${b})=0,0,ROUNDUP(${c('Visit')}/SUM(${C['Working Day']}${a}:${C['Working Day']}${b}),0))`,
                    'ร้าน/วัน ต่ำสุด': `=IFERROR(_xlfn.MINIFS(${rng},${cr},"Y"),"")`, 'ร้าน/วัน สูงสุด': `=IFERROR(_xlfn.MAXIFS(${rng},${cr},"Y"),"")`,
                    'Diff': `=IF(${c('Coverage ' + baseL)}=0,"",${c('Coverage')}-${c('Coverage ' + baseL)})`,
                    'Match': `=IF(${c('Coverage ' + baseL)}=0,"",IF(${c('Diff')}>0,"▲ Increase",IF(${c('Diff')}<0,"▼ Decrease","Equal")))`,
                })[h];
                put(RS, rr, j, v === undefined ? `=SUM(${rng})` : v, { fmt: h === 'Diff' ? '+#,##0;-#,##0;0' : h === 'Re-Visit %' ? '0%' : '#,##0',
                    font: F(10, true), fill: LIGHT, al: ['Match', 'Re-Visit %'].includes(h) ? CEN : undefined });
            }
        };
        rtsMain.forEach((rt, i) => rsRoute(rt, r0 + i));
        const rT = r0 + rtsMain.length;
        rsTotal(rT, 'รวม P/V/C', r0, rT - 1, rD);
        let rTE = 0;
        if (rtsE.length) {
            rtsE.forEach((rt, i) => rsRoute(rt, rT + 1 + i));
            rTE = rT + 1 + rtsE.length;
            rsTotal(rTE, 'รวม E (Spare/Gainer)', rT + 1, rTE - 1, rDE);
        }
        const rsLast = rTE || rT;
        RS.getCell(rsLast + 1, 1).value = 'รวม P/V/C = ยอดที่ใช้ในหน้า Executive Summary (ไม่รวมสาย E) · Working Day ของยอดรวม = วันในปฏิทินที่มีอย่างน้อย 1 สายในกลุ่มวิ่ง · ต่ำสุด/สูงสุดของยอดรวม = เฉพาะสาย P/V · มาตรฐาน Coverage: Route Credit ไม่ประเมิน';
        RS.getCell(rsLast + 1, 1).font = F(8, false, GREY, true);
        widths(RS, H.map((h, j) => j === 0 ? 10 : h.startsWith('Seg ') ? 8 : h.startsWith('ตลาด ') ? 8 : h === 'มาตรฐาน Coverage' ? 10 : 9));
        // มาตรฐาน Coverage ของสาย P/V: F1 600 (แดง < 570 · ส้ม < 585 · เขียวอ่อน < 600 · เขียวเข้ม ≥ 600) · F2 420 (< 390 · < 400 · < 410 · ≥ 410)
        const covRules = (col, std, first) => {
            const f2 = `LEFT(${std},2)="F2"`, f1 = `LEFT(${std},2)="F1"`;
            return [
                { type: 'expression', priority: first, stopIfTrue: true, formulae: [`OR(AND(${f2},${col}<390),AND(${f1},${col}<570))`], style: dx('FFFFC7CE', 'FF9C0006', true) },
                { type: 'expression', priority: first + 1, stopIfTrue: true, formulae: [`OR(AND(${f2},${col}<400),AND(${f1},${col}<585))`], style: dx('FFFCE4D6', 'FF833C0B', true) },
                { type: 'expression', priority: first + 2, stopIfTrue: true, formulae: [`OR(AND(${f2},${col}<410),AND(${f1},${col}<600))`], style: dx('FFE2EFDA', 'FF375623', true) },
                { type: 'expression', priority: first + 3, stopIfTrue: true, formulae: [`OR(${f2},${f1})`], style: dx('FFA9D08E', 'FF1E4620', true) },
            ];
        };
        RS.addConditionalFormatting({ ref: `${C['Coverage']}${r0}:${C['Coverage']}${rsLast}`, rules: covRules(`$${C['Coverage']}${r0}`, `$${C['มาตรฐาน Coverage']}${r0}`, 1) });
        const T = (c) => `'Route Summary'!$${C[c] || c}$${rT}`;
        const TE = (c) => rTE ? `'Route Summary'!$${C[c] || c}$${rTE}` : '0';

        // ── Movement (รายชื่อ)
        title(MV, `Movement — เทียบแผน ${baseL} → ${curL} · ศูนย์ ${D.centerId}`);
        hdr(MV, 3, ['ประเภท', 'รหัสร้าน', 'ชื่อร้าน', 'ประเภทร้าน', 'สาย ' + baseL, 'สาย ' + curL, 'Status ใน Master', 'เปิดบัญชี', 'Shop type ' + baseL, 'Shop type ' + curL]);
        const mvRows = [];
        if (D.base) {
            const scope = new Set(D.rts);
            const seen = new Set();
            D.rows.forEach(r => {
                if (seen.has(r.c)) return; seen.add(r.c);
                if (r.base.startsWith('ร้านใหม่')) mvRows.push(['ร้านใหม่เข้าแผน', r.c, r.s.name, r.s.shopType, '', r.rt, r.s.status, r.s.openDate, '', r.s.shopType]);
                else if (r.base.startsWith('ย้ายจาก')) mvRows.push(['ย้าย Route', r.c, r.s.name, r.s.shopType, D.base.route[r.c], r.rt, r.s.status, r.s.openDate, (D.base.info[r.c] || {}).shopType, r.s.shopType]);
            });
            D.prev.forEach(x => {
                if (!scope.has(x.rt)) return;
                if (x.now === NOTIN) mvRows.push(['หลุดจากแผน (Remove)', x.c, x.name, x.st0, x.rt, '', '', '', x.st0, x.st1]);
                else if (x.st0 && x.st1 && x.st0 !== x.st1) mvRows.push(['เปลี่ยน Shop type', x.c, x.name, x.st1, x.rt, x.now, '', '', x.st0, x.st1]);
            });
        }
        mvRows.forEach((rw, k) => rw.forEach((v, j) => put(MV, 4 + k, j + 1, j === 7 ? asDate(v) : (v || null), { font: F(9), fmt: j === 7 ? 'yyyy-mm-dd' : undefined })));
        if (!mvRows.length) MV.getCell(4, 1).value = D.base ? 'ไม่มีการเปลี่ยนแปลง' : 'ไม่มีแผนเดือนก่อนในโปรแกรมให้เทียบ';
        widths(MV, [20, 13, 36, 10, 11, 11, 13, 12, 13, 13]);
        MV.autoFilter = `A3:J${3 + Math.max(1, mvRows.length)}`;

        // ── Executive Summary — V0.9.11: ผังใหม่ (โครงเดิม ซ้ายสาย/ขวาขนาดตลาด · ส่วนที่เพิ่มอยู่แถวของตัวเองเต็มความกว้าง)
        //   คอลัมน์: A ขอบ · B–G ฝั่งซ้าย (6) · H ช่องว่าง · I–L ฝั่งขวา (4)
        E.getColumn(1).width = 2;
        for (let c = 2; c <= 7; c++) E.getColumn(c).width = 11.5;
        E.getColumn(8).width = 2;
        for (let c = 9; c <= 12; c++) E.getColumn(c).width = 12;
        const LC = 2, LE = 7, RC = 9, RE = 12;
        E.getCell('B2').value = `Route Plan Executive Summary — ศูนย์ ${D.centerId} · ${curL}`; E.getCell('B2').font = F(18, true, NAVY);
        E.getRow(2).height = 28;
        const now = new Date();
        E.getCell('B3').value = `แผน ${curL}${D.base ? ' เทียบแผน ' + baseL : ' (ไม่มีแผนเดือนก่อนให้เทียบ)'} · ${rtsMain.length} สาย P/V/C${rtsE.length ? ` + ${rtsE.length} สาย E (Spare/Gainer · ไม่รวมในยอด)` : ''} · ออกรายงาน ${now.toLocaleDateString('th-TH')} ${now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ทุกตัวเลขคำนวณจากชีทข้อมูลในไฟล์นี้`;
        E.getCell('B3').font = F(9, false, GREY);
        const section = (r, text, c1, c2) => {
            c1 = c1 || LC; c2 = c2 || RE;
            E.mergeCells(r, c1, r, c2);
            const x = E.getCell(r, c1); x.value = text; x.font = F(10.5, true, 'FFFFFFFF'); x.fill = FILL(BLUE); x.alignment = { vertical: 'middle', indent: 1 };
            E.getRow(r).height = 21;
        };
        const mput = (r, c1, c2, v, o) => { if (c2 > c1) E.mergeCells(r, c1, r, c2); const x = put(E, r, c1, v, o); if (!o || o.bd !== false) for (let c = c1 + 1; c <= c2; c++) E.getCell(r, c).border = BOX; return x; };
        const hd = (r, c1, c2, t) => mput(r, c1, c2, t, { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN });
        const note = (r, c1, c2, t, h) => { E.mergeCells(r, c1, r, c2); const x = E.getCell(r, c1); x.value = (typeof t === 'string' && t.startsWith('=')) ? fx(t) : t; x.font = F(8, false, GREY, true); x.alignment = { vertical: 'top', wrapText: true }; if (h) E.getRow(r).height = h; };
        const bar = (ref, pr) => E.addConditionalFormatting({ ref, rules: [{ type: 'dataBar', priority: pr, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FF9DC3E6' } }] });
        const tile = (r, c1, c2, label, value, sub, o) => {
            o = o || {};
            for (let k = 0; k < 3; k++) {
                E.mergeCells(r + k, c1, r + k, c2);
                const x = E.getCell(r + k, c1);
                x.fill = FILL('FFF2F5FB'); x.alignment = CEN;
                x.border = { left: thin, right: thin, top: k === 0 ? thin : undefined, bottom: k === 2 ? thin : undefined };
                for (let c = c1 + 1; c <= c2; c++) E.getCell(r + k, c).border = { right: c === c2 ? thin : undefined, top: k === 0 ? thin : undefined, bottom: k === 2 ? thin : undefined };
            }
            E.getCell(r, c1).value = label; E.getCell(r, c1).font = F(9, true, GREY);
            const b = E.getCell(r + 1, c1); b.value = (typeof value === 'string' && value.startsWith('=')) ? fx(value) : value; b.font = F(o.sz || 20, true, o.color || NAVY); b.numFmt = o.fmt || '#,##0';
            const s = E.getCell(r + 2, c1); s.value = (typeof sub === 'string' && sub.startsWith('=')) ? fx(sub) : sub; s.font = F(8, false, GREY);
            E.getRow(r + 1).height = 32;
        };
        const TL = [[2, 3], [4, 5], [6, 8], [9, 10], [11, 12]];     // 5 การ์ดต่อแถว (การ์ดกลางกินช่องว่าง H)
        const sumP = (g, f) => '(' + GRP[g].map(f).join('+') + ')';

        section(5, 'ภาพรวมแผน — สาย P/V/C (ไม่รวมสาย E Spare/Gainer)');
        const N_PREV = `COUNTA(${PV_RT})`;
        const WT_NEW = `COUNTIF('รอจัดสาย'!$F$3:$F$${NW},"ร้านใหม่")`, WT_OLD = `COUNTIF('รอจัดสาย'!$F$3:$F$${NW},"ร้านเก่า")`;
        tile(6, ...TL[0], 'ร้าน Active ใน Master (P/V/C)', `=IF(${P_ACT}="","—",${P_ACT})`, D.mBy ? 'ตาม Salesman Code สาย P/V/C' : 'Customer Master ล่าสุด');
        tile(6, ...TL[1], 'Coverage (ร้านในแผน)', `=${T('Coverage')}`, `=IF(${P_ACT}="","",TEXT(${T('Coverage')}/${P_ACT},"0.0%")&" ของ Active")` + (rtsE.length ? `&" · ไม่รวม E "&TEXT(${TE('Coverage')},"#,##0")` : ''));
        tile(6, ...TL[2], 'Visit ทั้งเดือน', `=${T('Visit')}`, 'ร้านที่เข้า 2 ครั้ง นับ 2');
        tile(6, ...TL[3], 'Re-Visit (ร้านเข้า ≥2 ครั้ง)', `=${T('Re-Visit')}`, `=IF(${T('Coverage')}=0,"",TEXT(${T('Re-Visit')}/${T('Coverage')},"0%")&" ของ Coverage")`, { color: 'FFC00000' });
        tile(6, ...TL[4], 'Working Day', `=${T('Working Day')}`, `="วันหยุด "&COUNT(${HOLR})&" วัน"`);
        tile(10, ...TL[0], 'Visit/Day เฉลี่ยต่อสาย', `=${T('Visit/Day')}`, 'ROUNDUP(Visit ÷ Working Day รวมทุกสาย)');
        tile(10, ...TL[1], 'รอจัดสาย', `=COUNTA('รอจัดสาย'!$A$3:$A$${NW})`, `="ร้านใหม่ "&${WT_NEW}&" · ร้านเก่า "&${WT_OLD}`, { color: 'FFC55A11' });
        tile(10, ...TL[2], `หลุดจากแผน (เทียบ ${baseL})`, `=COUNTIF(${PV_NOW},"${NOTIN}")`, `อยู่แผน ${baseL} แต่ไม่อยู่ ${curL}`, { color: 'FFC00000' });
        tile(10, ...TL[3], 'ร้านใหม่เข้าแผน', `=COUNTIFS(${R_FS},1,${R_MOVE},"ร้านใหม่*")`, `ไม่อยู่แผน ${baseL}`, { color: 'FF548235' });
        tile(10, ...TL[4], 'ย้าย Route', `=COUNTIFS(${R_FS},1,${R_MOVE},"ย้ายจาก*")`, `Route ${baseL} ≠ Route ${curL}`);
        const REMOVED = 'F11', NEWIN = 'I11';

        // เทียบเดือนก่อน — แยกกลุ่ม P/V · C · E · รวม P/V/C
        section(14, `เทียบเดือนก่อน: Coverage ${baseL} → ${curL} แยกกลุ่มสาย`);
        const CMP = { lab: [2, 3], base: [4, 4], nw: [5, 5], rm: [6, 6], mv: [7, 8], cur: [9, 9], diff: [10, 10], pct: [11, 12] };
        [['lab', 'กลุ่มสาย'], ['base', 'Coverage ' + baseL], ['nw', '+ ร้านใหม่'], ['rm', '− หลุดจากแผน'], ['mv', '± ย้ายข้ามกลุ่ม'], ['cur', 'Coverage ' + curL], ['diff', 'Diff'], ['pct', '% เปลี่ยน']]
            .forEach(([k, t]) => hd(15, CMP[k][0], CMP[k][1], t));
        E.getRow(15).height = 28;
        const cmpRow = {}, CL1 = (k) => CL(CMP[k][0]);
        ['PV', 'C', 'E', 'ALL'].forEach((g, k) => {
            const rr = 16 + k; cmpRow[g] = rr;
            const tot = g === 'ALL', fl = tot ? LIGHT : undefined, fc = g === 'E' ? GREY : undefined;
            const v = (key) => tot ? `=${CL1(key)}${cmpRow.PV}+${CL1(key)}${cmpRow.C}` : null;
            mput(rr, ...CMP.lab, tot ? 'รวม P/V/C' : ({ PV: 'สาย P/V', C: 'สาย C (Credit)', E: 'สาย E (Spare/Gainer)' })[g], { font: F(9.5, true, fc), fill: fl });
            mput(rr, ...CMP.base, v('base') || `=${sumP(g, x => `COUNTIF(${PV_RT},"${x}")`)}`, { fmt: '#,##0', font: F(10, false, fc), al: CEN, fill: fl });
            mput(rr, ...CMP.nw, v('nw') || `=${sumP(g, x => `COUNTIFS(${R_FS},1,${R_MOVE},"ร้านใหม่*",${R_RT},"${x}")`)}`, { fmt: '+#,##0;-#,##0;0', font: F(10, false, fc || 'FF548235'), al: CEN, fill: fl });
            mput(rr, ...CMP.rm, v('rm') || `=${sumP(g, x => `COUNTIFS(${PV_RT},"${x}",${PV_NOW},"${NOTIN}")`)}`, { fmt: '#,##0', font: F(10, false, fc || 'FFC00000'), al: CEN, fill: fl });
            mput(rr, ...CMP.cur, v('cur') || `=${sumP(g, x => `COUNTIFS(${R_FS},1,${R_RT},"${x}")`)}`, { fmt: '#,##0', font: F(10, true, fc || NAVY), al: CEN, fill: fl });
            const b = `${CL1('base')}${rr}`, n2 = `${CL1('nw')}${rr}`, m = `${CL1('rm')}${rr}`, c = `${CL1('cur')}${rr}`;
            mput(rr, ...CMP.mv, `=${c}-${b}-${n2}+${m}`, { fmt: '+#,##0;-#,##0;0', font: F(10, false, fc), al: CEN, fill: fl });
            mput(rr, ...CMP.diff, `=${c}-${b}`, { fmt: '+#,##0;-#,##0;0', font: F(10, true, fc), al: CEN, fill: fl });
            mput(rr, ...CMP.pct, `=IF(${b}=0,"",(${c}-${b})/${b})`, { fmt: '+0.0%;-0.0%;0.0%', font: F(10, false, fc), al: CEN, fill: fl });
        });
        note(20, LC, RE, `Coverage ${curL} = Coverage ${baseL} + ร้านใหม่ − หลุดจากแผน ± ย้ายข้ามกลุ่ม (เช่น P → C) · สาย E (Spare/Gainer) แสดงแยก ไม่รวมในยอด P/V/C`, 14);
        const COVCUR = (g) => `$${CL1('cur')}$${cmpRow[g]}`;

        // ซ้าย: สรุปรายสาย — สาย | Coverage | Visit | Re-Visit | Visit/Day | หมายเหตุ · สาย E ท้ายสุด
        const tR = 22;
        section(tR, 'สรุปรายสาย — รายละเอียดเต็มดูชีท Route Summary', LC, LE);
        ['สาย', 'Coverage', 'Visit', 'Re-Visit', 'Visit/Day', 'หมายเหตุ'].forEach((h, j) => hd(tR + 1, LC + j, LC + j, h));
        let er = tR + 2;
        const RSC = ['สาย', 'Coverage', 'Visit', 'Re-Visit', 'Visit/Day'];
        const rsLine = (rt) => {
            const s = rsRow[rt], rr = er++, isE = typeOf(rt) === 'E';
            RSC.forEach((h, j) => put(E, rr, LC + j, `='Route Summary'!${C[h]}${s}`,
                { fmt: '#,##0', font: F(9.5, j === 0 || j === 1, isE ? GREY : undefined), al: j === 4 ? CEN : undefined }));
            put(E, rr, LE, null, { font: F(9) });
        };
        const totLine = (label, rowRS, fl, fc) => {
            const rr = er++;
            put(E, rr, LC, label, { font: F(9.5, true, fc), fill: fl });
            RSC.slice(1).forEach((h, j) => put(E, rr, LC + 1 + j, `='Route Summary'!${C[h]}${rowRS}`, { fmt: '#,##0', font: F(9.5, true, fc), fill: fl, al: h === 'Visit/Day' ? CEN : undefined }));
            put(E, rr, LE, '', { fill: fl });
        };
        const e0 = er;
        rtsMain.forEach(rsLine);
        totLine('รวม P/V/C', rT, LIGHT);
        if (rtsE.length) { rtsE.forEach(rsLine); totLine('รวม E', rTE, LIGHT, GREY); }
        const rE = er;
        // Coverage สาย P/V เทียบมาตรฐาน: Re-Visit > 15% = F2 420 · ไม่ถึง = F1 600 (Credit / E ไม่ประเมิน)
        {
            const cov = `$C${e0}`, pv = `OR(MID($B${e0},4,1)="P",MID($B${e0},4,1)="V")`, f2 = `AND(${pv},${cov}>0,$E${e0}/${cov}>0.15)`, f1 = `AND(${pv},${cov}>0,$E${e0}/${cov}<=0.15)`;
            E.addConditionalFormatting({ ref: `C${e0}:C${rE - 1}`, rules: [
                { type: 'expression', priority: 1, stopIfTrue: true, formulae: [`OR(AND(${f2},${cov}<390),AND(${f1},${cov}<570))`], style: dx('FFFFC7CE', 'FF9C0006', true) },
                { type: 'expression', priority: 2, stopIfTrue: true, formulae: [`OR(AND(${f2},${cov}<400),AND(${f1},${cov}<585))`], style: dx('FFFCE4D6', 'FF833C0B', true) },
                { type: 'expression', priority: 3, stopIfTrue: true, formulae: [`OR(AND(${f2},${cov}<410),AND(${f1},${cov}<600))`], style: dx('FFE2EFDA', 'FF375623', true) },
                { type: 'expression', priority: 4, stopIfTrue: true, formulae: [`OR(${f2},${f1})`], style: dx('FFA9D08E', 'FF1E4620', true) },
            ] });
        }
        // แถบเกณฑ์สี
        put(E, rE, LC, 'เกณฑ์สี', { font: F(8, true, GREY), bd: false, al: { horizontal: 'right', vertical: 'middle' } });
        [['ต่ำมาก', 'FFFFC7CE', 'FF9C0006'], ['ต่ำ', 'FFFCE4D6', 'FF833C0B'], ['ใกล้', 'FFE2EFDA', 'FF375623'], ['ถึงมาตรฐาน', 'FFA9D08E', 'FF1E4620']]
            .forEach(([t, bg, fc], j) => put(E, rE, LC + 1 + j, t, { font: F(8, true, fc), fill: bg, al: CEN }));
        note(rE + 1, LC, LE, 'สาย P/V · Re-Visit > 15% = F2 มาตรฐาน 420 (< 390 · 390–399 · 400–409 · ≥ 410) · ไม่ถึง 15% = F1 มาตรฐาน 600 (< 570 · 570–584 · 585–599 · ≥ 600) · Credit ไม่ประเมิน', 24);

        // ขวา: ขนาดตลาด (ช่วงละ 5 ร้าน)
        section(tR, 'ขนาดตลาด — ร้านต่อตลาด (สาย P/V)', RC, RE);
        hd(tR + 1, RC, RC + 1, 'ร้านต่อตลาด'); hd(tR + 1, RC + 2, RC + 2, 'ตลาด'); hd(tR + 1, RE, RE, '%');
        const bk0 = tR + 2, rB = bk0 + BUCK.length;
        BUCK.forEach((b, k) => {
            const rr = bk0 + k, fl = k === 0 ? 'FFFCE4D6' : (k === BUCK.length - 1 ? 'FFFFF2CC' : undefined);
            mput(rr, RC, RC + 1, b + ' ร้าน', { font: F(9.5), al: CEN, fill: fl });
            put(E, rr, RC + 2, `=COUNTIFS(${MK_B},"${b}",${MK_EV},"Y")`, { fmt: '#,##0', font: F(9.5, true), al: CEN, fill: fl });
            put(E, rr, RE, `=IF(${CL(RC + 2)}${rB}=0,0,${CL(RC + 2)}${rr}/${CL(RC + 2)}${rB})`, { fmt: '0%', font: F(9.5), fill: fl });
        });
        mput(rB, RC, RC + 1, 'รวม (P/V)', { font: F(9.5, true), al: CEN, fill: LIGHT });
        put(E, rB, RC + 2, `=SUM(${CL(RC + 2)}${bk0}:${CL(RC + 2)}${rB - 1})`, { fmt: '#,##0', font: F(9.5, true), al: CEN, fill: LIGHT });
        put(E, rB, RE, `=SUM(${CL(RE)}${bk0}:${CL(RE)}${rB - 1})`, { fmt: '0%', font: F(9.5, true), fill: LIGHT });
        bar(`${CL(RE)}${bk0}:${CL(RE)}${rB - 1}`, 10);
        note(rB + 1, RC, RE, 'ตลาด = สาย × Day (การ์ด Day ในหน้าวางแผนคิวงาน) · รายการเต็มดูชีท ตลาด');

        // ประเภทร้าน (Shop type) + การเปลี่ยน — ตาราง P/V (ซ้าย) กับ C (ขวา) วางคู่กัน
        const catL = CATS.concat(['อื่น ๆ']);
        const sR = Math.max(rE + 2, rB + 2) + 1;
        section(sR, `ประเภทร้านใน Coverage (Shop type) + การเปลี่ยน Shop type เทียบ ${baseL}`);
        try { E.getRow(sR - 1).addPageBreak(); } catch (e) {}          // พิมพ์: หน้า 1 = ภาพรวม/สาย · หน้า 2 = ประเภทร้าน/Segmentation/Action
        const shopTable = (g, r1, cols, title2, pr) => {
            const [cT0, cT1, cN, cP, cX0, cX1] = cols;
            mput(r1, cT0, cX1, title2, { font: F(10, true, NAVY), bd: false });
            hd(r1 + 1, cT0, cT1, 'ประเภท'); hd(r1 + 1, cN, cN, 'ร้าน'); hd(r1 + 1, cP, cP, '%'); hd(r1 + 1, cX0, cX1, '+เข้า / −ออก');
            catL.forEach((c, k) => {
                const rr = r1 + 2 + k;
                mput(rr, cT0, cT1, c, { font: F(9.5), al: CEN });
                put(E, rr, cN, c === 'อื่น ๆ' ? `=${COVCUR(g)}-SUM(${CL(cN)}${r1 + 2}:${CL(cN)}${rr - 1})` : `=${sumP(g, x => `COUNTIFS(${R_FS},1,${R_CAT},"${c}",${R_RT},"${x}")`)}`, { fmt: '#,##0', font: F(9.5) });
                put(E, rr, cP, `=IF(${COVCUR(g)}=0,0,${CL(cN)}${rr}/${COVCUR(g)})`, { fmt: '0.0%', font: F(9.5) });
                const pin = sumP(g, x => `COUNTIFS(${PV_CH},1,${PV_CO},"${c}",${PV_NOW},"${x}")`), pout = sumP(g, x => `COUNTIFS(${PV_CH},1,${PV_CS},"${c}",${PV_NOW},"${x}")`);
                mput(rr, cX0, cX1, c === 'อื่น ๆ' ? '-' : `=IF(${pin}+${pout}=0,"-","+"&${pin}&" / −"&${pout})`, { font: F(9.5), al: CEN });
            });
            const rr = r1 + 2 + catL.length;
            mput(rr, cT0, cT1, 'รวม', { font: F(9.5, true), fill: LIGHT, al: CEN });
            put(E, rr, cN, `=SUM(${CL(cN)}${r1 + 2}:${CL(cN)}${rr - 1})`, { fmt: '#,##0', font: F(9.5, true), fill: LIGHT });
            put(E, rr, cP, `=SUM(${CL(cP)}${r1 + 2}:${CL(cP)}${rr - 1})`, { fmt: '0.0%', font: F(9.5, true), fill: LIGHT });
            mput(rr, cX0, cX1, `=SUM(${sumP(g, x => `COUNTIFS(${PV_CH},1,${PV_NOW},"${x}")`)})&" ร้านเปลี่ยน"`, { font: F(9, true, 'FFC55A11'), fill: LIGHT, al: CEN });
            bar(`${CL(cP)}${r1 + 2}:${CL(cP)}${rr - 1}`, pr);
            return rr;
        };
        const s1 = shopTable('PV', sR + 1, [2, 3, 4, 5, 6, 7], 'สาย P/V (Presales / Vansales)', 11);
        shopTable('C', sR + 1, [9, 9, 10, 11, 12, 12], 'สาย C (Credit)', 12);
        note(s1 + 1, LC, RE, `="ร้านที่เปลี่ยน Shop type เทียบ ${baseL}: "&SUM(${PV_CH})&" ร้าน → รายชื่อดูชีท Movement"`, 14);

        // Segmentation — ตาราง P/V (ซ้าย) กับ C (ขวา)
        const gR = s1 + 3;
        section(gR, 'Segmentation ใน Coverage');
        const segTable = (g, r1, cols, title2, pr) => {
            const [cS0, cS1, cN, cP0, cP1] = cols;
            mput(r1, cS0, cP1, title2, { font: F(10, true, NAVY), bd: false });
            hd(r1 + 1, cS0, cS1, 'Segmentation'); hd(r1 + 1, cN, cN, 'ร้าน'); hd(r1 + 1, cP0, cP1, '%');
            const rows2 = SEGS.concat(['อื่น ๆ']);
            rows2.forEach((sg, k) => {
                const rr = r1 + 2 + k;
                mput(rr, cS0, cS1, sg, { font: F(9.5) });
                put(E, rr, cN, sg === 'อื่น ๆ' ? `=${COVCUR(g)}-SUM(${CL(cN)}${r1 + 2}:${CL(cN)}${rr - 1})`
                    : `=${sumP(g, x => `COUNTIFS(${R_FS},1,${R_SEG},"${sg}",${R_RT},"${x}")`)}`, { fmt: '#,##0', font: F(9.5) });
                mput(rr, cP0, cP1, `=IF(${COVCUR(g)}=0,0,${CL(cN)}${rr}/${COVCUR(g)})`, { fmt: '0.0%', font: F(9.5) });
            });
            const rr = r1 + 2 + rows2.length;
            mput(rr, cS0, cS1, 'รวม', { font: F(9.5, true), fill: LIGHT });
            put(E, rr, cN, `=SUM(${CL(cN)}${r1 + 2}:${CL(cN)}${rr - 1})`, { fmt: '#,##0', font: F(9.5, true), fill: LIGHT });
            mput(rr, cP0, cP1, `=SUM(${CL(cP0)}${r1 + 2}:${CL(cP0)}${rr - 1})`, { fmt: '0.0%', font: F(9.5, true), fill: LIGHT });
            bar(`${CL(cP0)}${r1 + 2}:${CL(cP0)}${rr - 1}`, pr);
            return rr;
        };
        const g1 = segTable('PV', gR + 1, [2, 3, 4, 5, 7], 'สาย P/V (Presales / Vansales)', 13);
        segTable('C', gR + 1, [9, 10, 11, 12, 12], 'สาย C (Credit)', 14);

        // Action
        const aR = g1 + 2;
        section(aR, 'สิ่งที่ต้องตัดสินใจ / Action — แต่ละข้อบอกที่มาของข้อมูล');
        const acts = [
            [`="ตลาดที่มีร้านต่ำกว่า 15 (สาย P/V): "&${CL(RC + 2)}${bk0}&" ตลาด"&IF(${CL(RC + 2)}${bk0}=0," ✓","")`, 'ที่มา: Raw Data → ชีท ตลาด'],
            [`="วันที่ร้าน/วัน นอกเกณฑ์ (สาย P/V): "&${T('วันนอกเกณฑ์')}&" วัน"&IF(${T('วันนอกเกณฑ์')}=0," ✓","")`, 'ที่มา: แผนเดือนนี้ × เกณฑ์ใน Parameters → Daily Calendar'],
            [`="ร้านใหม่ยังไม่จัดเข้าสาย: "&${WT_NEW}&" ร้าน"`, 'ที่มา: กองรอจัดสาย × วันเปิดบัญชี → ชีท รอจัดสาย'],
            [`="ร้านเก่า Active แต่ไม่อยู่ในแผน: "&${WT_OLD}&" ร้าน → พิจารณา Inactive"`, 'ที่มา: กองรอจัดสาย × วันเปิดบัญชี → ชีท รอจัดสาย'],
            [`="ร้านในแผนแต่ InActive ใน Master: "&COUNTIF(${IS_TOP},"*InActive ใน Master*")&" ร้าน"`, 'ที่มา: ไฟล์ RoutePlan × Customer Master → ชีท Issues'],
            [`="หลุดจากแผนเทียบ ${baseL}: "&${REMOVED}&" ร้าน → ยืนยันว่าตั้งใจตัด"`, `ที่มา: แผน ${baseL} × แผน ${curL} → ชีท Movement`],
            [`="ร้านเปลี่ยน Shop type: "&SUM(${PV_CH})&" ร้าน → ตรวจว่าถูกต้อง"`, `ที่มา: แผน ${baseL} × แผน ${curL} → ชีท Movement`],
            [`="ร้านในแผนไม่มีพิกัด: "&COUNTIF(${IS_TOP},"ร้านในแผนไม่มีพิกัดใน Master")&" ร้าน"`, 'ที่มา: Customer Master (Lat/Long) ตอนนำเข้า → ชีท Issues'],
        ];
        acts.forEach(([t, src], k) => {
            const rr = aR + 1 + Math.floor(k / 2) * 2;
            const [c1, c2] = k % 2 === 0 ? [LC, LE] : [RC, RE];
            [[rr, t, F(9.5, true)], [rr + 1, src, F(8, false, GREY, true)]].forEach(([r2, val, fn]) => {
                E.mergeCells(r2, c1, r2, c2);
                const c = E.getCell(r2, c1);
                c.value = val.startsWith('=') ? fx(val) : val; c.font = fn; c.alignment = { vertical: 'middle', indent: 1 };
                c.fill = FILL('FFFFF8E5');
                E.getRow(r2).height = r2 === rr ? 18 : 14;
            });
        });
        const lastRow = aR + Math.ceil(acts.length / 2) * 2 + 2;
        const tall = new Set([tR + 1, sR + 2, gR + 2]);
        for (let r = tR + 2; r < aR; r++) if (!E.getRow(r).height) E.getRow(r).height = 17;
        tall.forEach(r => { E.getRow(r).height = 22; });
        E.getRow(tR + 1).height = 24;
        E.getCell(lastRow, 2).value = 'ตัวเลขทุกช่องเป็นสูตรที่ดึงจากชีทข้อมูล (Raw Data / ตลาด / Prev Plan / รอจัดสาย / Issues / Parameters) · นิยามดูชีท Definitions';
        E.getCell(lastRow, 2).font = F(8, false, GREY, true);
        E.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                        printArea: `A1:L${lastRow}`, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
        [RS, DC].forEach(ws => { ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; });
        void NEWIN; void N_PREV;

        // ── Definitions
        title(DF, 'Definitions — นิยามและที่มาของตัวเลข');
        hdr(DF, 3, ['คำ', 'ความหมาย']);
        [
            ['ประเภทสาย', 'ตัวอักษรที่ 4 ของรหัสสาย: P = Presales · V = Vansales · C = Credit · E = Spare/Gainer · ยอดรวมในรายงาน (รวม P/V/C) ไม่รวมสาย E — สาย E แสดงแยกท้ายตาราง'],
            ['Coverage', 'จำนวนร้าน (ไม่ซ้ำ) ที่มีสายและวันเข้าเยี่ยมในแผนเดือนนี้'],
            ['มาตรฐาน Coverage', 'สาย P/V: ร้าน Re-Visit > 15% ของ Coverage = F2 มาตรฐาน 420 ร้าน (แดง < 390 · ส้ม 390–399 · เขียวอ่อน 400–409 · เขียวเข้ม ≥ 410) · ไม่ถึง 15% = F1 มาตรฐาน 600 ร้าน (แดง < 570 · ส้ม 570–584 · เขียวอ่อน 585–599 · เขียวเข้ม ≥ 600) · Route Credit ไม่ประเมิน'],
            ['ร้าน Active ใน Master', 'ร้าน Active ใน Customer Master ที่ Salesman Code เป็นสาย P/V/C (ประเภทที่เลือกนำเข้า)'],
            ['Segmentation', 'คอลัมน์ Segmentation ใน Customer Master (Resident S/M/L · Market · Factory ฯลฯ) · อื่น ๆ = ว่าง/ค่าอื่น'],
            ['ระยะทาง (กม.)', 'ระยะตามลำดับคิวของวันนั้น — ตัวเดียวกับหน้าต่างรายวัน · ช่องฟ้า = ยังไม่ใส่จุดเริ่ม/จุดจบ (เป็นระยะระหว่างร้านอย่างเดียว)'],
            ['Visit', 'จำนวนครั้งเข้าเยี่ยมทั้งเดือน = จำนวนแถวใน Raw Data (ร้านที่เข้า 2 ครั้งนับ 2)'],
            ['Re-Visit', 'ร้านที่ถูกเข้าเยี่ยม ≥ 2 ครั้งในเดือน'],
            ['Working Day', 'จำนวนวันที่สายนั้นมีการเข้าเยี่ยม · Grand Total = วันในปฏิทินที่มีอย่างน้อย 1 สายวิ่ง'],
            ['Visit/Day', 'ROUNDUP(Visit ÷ Working Day) · Grand Total = Visit รวม ÷ Working Day รวมทุกสาย'],
            ['เกณฑ์ร้านต่อวัน', 'สาย Presales (P) / Vansales (V) ตามค่าใน Parameters · สาย C และ E ไม่ประเมิน'],
            ['ตลาด', 'สาย × Day ตามการ์ด Day ในหน้าวางแผนคิวงาน (รอบที่ 2 ของเดือนเป็น Day แยก) · ร้านในตลาด = ร้านที่อยู่ใน Day นั้น · ช่วงร้าน (ช่วงละ 5): ต่ำกว่า 15 / 15–19 / 20–24 / 25–29 / 30–34 / 35–39 / 40 ขึ้นไป · นับเฉพาะสาย P/V'],
            ['เดือนก่อน', `แผน ${baseL} ที่อยู่ในโปรแกรม (เดือนที่นำเข้าจากระบบล่าสุด) — ไม่ได้ดึงข้อมูลในอดีตจากที่อื่น`],
            ['ร้านใหม่ / หลุดจากแผน', 'อยู่แผนเดือนนี้แต่ไม่อยู่แผนเดือนก่อน / อยู่แผนเดือนก่อนแต่ไม่อยู่แผนเดือนนี้ (รวมร้านที่ไปอยู่กองรอจัดสายหรือออกจากแผน)'],
            ['ย้ายเข้า / ย้ายออก / ย้าย Route', 'เดือนก่อนอยู่ Route อื่น / เดือนนี้ไปอยู่ Route อื่น (ภายในศูนย์)'],
            ['เปลี่ยน Shop type', 'ร้านที่อยู่ทั้งแผนเดือนก่อนและเดือนนี้ แต่ Outlet Category ไม่เหมือนกัน · +เข้า = เปลี่ยนมาเป็นประเภทนี้ · −ออก = เปลี่ยนออกจากประเภทนี้'],
            ['รอจัดสาย', 'ร้านในกองรอจัดสายของโปรแกรม · ร้านใหม่ = เปิดบัญชีตั้งแต่วันตัดใน Parameters · ไม่ทราบ = ไม่มีวันเปิดบัญชี (นำเข้าก่อน V0.9.0)'],
            ['วันหยุด', 'วันหยุดที่ตั้งในปฏิทินของโปรแกรม (วันที่หยุดทุกสายที่เลือก)'],
            ['Issues', 'รายการที่ระบบตรวจเจอตอน Export + คำเตือนจากหน้าภาพรวมแผน — แต่ละแถวระบุที่มา'],
        ].forEach(([a, b], i) => { put(DF, 4 + i, 1, a, { font: F(10, true), al: LEFT }); put(DF, 4 + i, 2, b, { al: LEFT }); });
        widths(DF, [30, 110]);

        return wb;
    };

    const run = async () => {
        try {
            UI.showLoader('📊 กำลังสร้างรายงาน Executive…', 'ประกอบข้อมูลจากแผน');
            const D = await collect();
            UI.showLoader('📊 กำลังสร้างรายงาน Executive…', `เขียนไฟล์ ${D.rows.length.toLocaleString()} แถว`);
            const wb = await build(D);
            const buf = await wb.xlsx.writeBuffer();
            const name = `RPN_Executive_${D.centerId || 'center'}_${App._currentPlanYM || ''}.xlsx`;
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            UI.hideLoader();
            UI.showSaveToast(`📊 ส่งออกรายงานแล้ว — ${name}`);
            return { name, rows: D.rows.length, routes: D.rts.length };
        } catch (e) {
            UI.hideLoader();
            console.error('[ExecReport]', e);
            UI.showErrorToast('❌ สร้างรายงานไม่สำเร็จ: ' + (e && e.message || e));
        }
    };

    window.ExecReport = { run, _collect: collect, _build: build };
})();

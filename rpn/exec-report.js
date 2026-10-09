/* =============================================================================
 *  exec-report.js — Export รายงาน Executive (V0.9.0)
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
    const TYPN = { P: 'Pre-sell', V: 'Van', C: 'Cash/Key', E: 'Sales Spare' };
    const CATS = ['RTL', 'WAP', 'WHC', 'LMT', 'MNT', 'OTR'];
    const BUCK = ['ต่ำกว่า 15', '15–20', '21–30', '31–40', '41 ขึ้นไป'];
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
        const rts = OV._scopeRoutes().filter(rt => rt !== UNASSIGNED && Array.isArray(R[rt]))
            .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
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
                    (datesOf[d] || []).forEach(dt => rows.push({
                        date: dt, rt, d, day: dayNum(d), market: s.marketName || mk[d] || '',
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

        return { p, last, rts, rows, markets, prev, waiting, iss, base, baseYM, mActive, center,
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
            ['ร้าน Active ใน Customer Master', D.mActive === '' ? null : D.mActive, '#,##0', D.mActive === '' ? 'ยังไม่มีข้อมูล — นำเข้า Customer Master อีกครั้งด้วยโปรแกรมเวอร์ชันนี้' : 'จาก Customer Master ที่นำเข้า/ซิงก์ล่าสุด'],
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
              R_CAT = rg('Outlet Category'), R_MOVE = rg('Movement vs ' + baseL);

        // ── ตลาด
        title(MK, 'ตลาด — 1 แถว = 1 ตลาด (สาย × Day) · จำนวนร้านคำนวณจาก Raw Data');
        hdr(MK, 2, ['สาย', 'ประเภท', 'ประเมิน (P/V)', 'Day', 'ชื่อตลาด', 'ร้านในตลาด', 'วันที่วิ่งในเดือน', 'ช่วงจำนวนร้าน']);
        D.markets.forEach((m, k) => {
            const i = 3 + k;
            const vals = [m.rt, TYPN[typeOf(m.rt)] || typeOf(m.rt), `=IF(OR(MID(A${i},4,1)="P",MID(A${i},4,1)="V"),"Y","N")`, m.day, m.name,
                `=SUMIFS(${R_FMK},${R_RT},A${i},${R_DAY},D${i})`, `=SUMIFS(${R_FMD},${R_RT},A${i},${R_DAY},D${i})`,
                `=IF(F${i}<15,"${BUCK[0]}",IF(F${i}<=20,"${BUCK[1]}",IF(F${i}<=30,"${BUCK[2]}",IF(F${i}<=40,"${BUCK[3]}","${BUCK[4]}"))))`];
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

        // ── Daily Calendar
        title(DC, `Daily Calendar — จำนวนร้านที่เข้าเยี่ยมรายวัน · ศูนย์ ${D.centerId} · ${curL}`,
              'คำนวณจาก Raw Data · เทาอ่อน = ไม่เข้าเยี่ยม · เทาเข้ม = วันหยุด (Parameters) · ส้ม = ต่ำกว่าเกณฑ์ · แดง = เกินเกณฑ์ (เฉพาะสาย P/V · สาย C/E ไม่ประเมิน)');
        put(DC, 4, 1, '', { fill: NAVY }); put(DC, 5, 1, 'สาย', { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN });
        for (let d = 1; d <= D.last; d++) {
            const c = 1 + d, L = CL(c), dt = new Date(D.p.y, D.p.m0, d), bg = dt.getDay() === 0 ? 'FFC00000' : NAVY;
            put(DC, 4, c, `=TEXT(${L}5,"ddd")`, { font: F(8, true, 'FFFFFFFF'), fill: bg, al: CEN });
            put(DC, 5, c, xDate(dt), { fmt: 'd', font: F(9, true, 'FFFFFFFF'), fill: bg, al: CEN });
        }
        const cT = 2 + D.last, LL = CL(cT - 1);
        put(DC, 4, cT, '', { fill: NAVY }); put(DC, 5, cT, 'Total', { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN });
        D.rts.forEach((rt, i) => {
            const rr = 6 + i;
            put(DC, rr, 1, rt, { font: F(10, true) });
            for (let d = 1; d <= D.last; d++) put(DC, rr, 1 + d, `=COUNTIFS(${R_RT},$A${rr},${R_DATE},${CL(1 + d)}$5)`, { fmt: '0;-0;""', font: F(9), al: CEN });
            put(DC, rr, cT, `=SUM(B${rr}:${LL}${rr})`, { fmt: '#,##0', font: F(10, true), al: CEN });
        });
        const rD = 6 + D.rts.length;
        put(DC, rD, 1, 'Total', { font: F(10, true), fill: LIGHT });
        for (let c = 2; c <= cT; c++) put(DC, rD, c, `=SUM(${CL(c)}6:${CL(c)}${rD - 1})`, { fmt: '#,##0;-#,##0;""', font: F(9, true), al: CEN, fill: LIGHT });
        const dx = (bg, fc, b) => ({ fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: bg }, fgColor: { argb: bg } }, font: { color: { argb: fc || 'FF000000' }, bold: !!b } });
        DC.addConditionalFormatting({ ref: `B6:${LL}${rD - 1}`, rules: [
            { type: 'expression', priority: 1, stopIfTrue: true, formulae: [`COUNTIF(${HOLR},B$5)>0`], style: dx('FF808080', 'FFFFFFFF') },
            { type: 'expression', priority: 2, stopIfTrue: true, formulae: ['B6=0'], style: dx('FFEDEDED') },
            { type: 'expression', priority: 3, stopIfTrue: true, formulae: [`AND(OR(MID($A6,4,1)="P",MID($A6,4,1)="V"),B6>${P_HI})`], style: dx('FFFFC7CE', 'FF9C0006', true) },
            { type: 'expression', priority: 4, stopIfTrue: true, formulae: [`AND(OR(MID($A6,4,1)="P",MID($A6,4,1)="V"),B6<${P_LO})`], style: dx('FFFCE4D6', 'FF9C0006', true) },
        ] });
        DC.getColumn(1).width = 10;
        for (let c = 2; c < cT; c++) DC.getColumn(c).width = 4.6;
        DC.getColumn(cT).width = 8;

        // ── Route Summary
        title(RS, `Route Summary — ศูนย์ ${D.centerId} · ${curL}`, `ทุกตัวเลขคำนวณจาก Raw Data / Daily Calendar / Prev Plan · เทียบกับแผน ${baseL} · สถานะ: 🟢 ทุกวันอยู่ในเกณฑ์ · 🟡 นอกเกณฑ์ 1–2 วัน · 🔴 ≥3 วัน (เฉพาะสาย P/V)`);
        const H = ['สาย', 'ประเภท', 'ประเมินเกณฑ์', 'Working Day', 'Coverage', 'Visit', 'Re-Visit', 'Visit/Day', 'ร้าน/วัน ต่ำสุด', 'ร้าน/วัน สูงสุด',
            'วันนอกเกณฑ์', 'สถานะ', 'Coverage ' + baseL, 'Diff', 'Match', 'ร้านใหม่', 'ย้ายเข้า', 'ย้ายออก', 'Remove', ...CATS, 'อื่น ๆ', 'จำนวนตลาด', ...BUCK.map(b => 'ตลาด ' + b)];
        hdr(RS, 4, H, 1, 36);
        const r0 = 5;
        D.rts.forEach((rt, i) => {
            const rr = r0 + i, dr = 6 + i, drow = `'Daily Calendar'!$B$${dr}:$${LL}$${dr}`;
            const v = [rt, TYPN[typeOf(rt)] || typeOf(rt), `=IF(OR(MID(A${rr},4,1)="P",MID(A${rr},4,1)="V"),"Y","N")`,
                `=SUMIFS(${R_FRD},${R_RT},A${rr})`, `=SUMIFS(${R_FS},${R_RT},A${rr})`, `=COUNTIF(${R_RT},A${rr})`,
                `=COUNTIFS(${R_RT},A${rr},${R_VNO},2)`, `=IF(D${rr}=0,0,ROUNDUP(F${rr}/D${rr},0))`,
                `=_xlfn.MINIFS(${drow},${drow},">0")`, `=MAX(${drow})`,
                `=IF(C${rr}="Y",COUNTIFS(${drow},">0",${drow},"<"&${P_LO})+COUNTIF(${drow},">"&${P_HI}),"—")`,
                `=IF(C${rr}<>"Y","—",IF(K${rr}=0,"🟢",IF(K${rr}<=2,"🟡","🔴")))`,
                `=COUNTIF(${PV_RT},A${rr})`, `=IF(M${rr}=0,"",E${rr}-M${rr})`, `=IF(M${rr}=0,"",IF(N${rr}>0,"▲ Increase",IF(N${rr}<0,"▼ Decrease","Equal")))`,
                `=COUNTIFS(${R_RT},A${rr},${R_FS},1,${R_MOVE},"ร้านใหม่*")`, `=COUNTIFS(${R_RT},A${rr},${R_FS},1,${R_MOVE},"ย้ายจาก*")`,
                `=COUNTIFS(${PV_RT},A${rr},${PV_NOW},"<>"&A${rr},${PV_NOW},"<>${NOTIN}")`, `=COUNTIFS(${PV_RT},A${rr},${PV_NOW},"${NOTIN}")`,
                ...CATS.map(c => `=COUNTIFS(${R_RT},$A${rr},${R_FS},1,${R_CAT},"${c}")`), `=E${rr}-SUM(T${rr}:Y${rr})`,
                `=COUNTIF(${MK_RT},$A${rr})`, ...BUCK.map(b => `=COUNTIFS(${MK_RT},$A${rr},${MK_B},"${b}")`)];
            v.forEach((val, j) => put(RS, rr, j + 1, val, { fmt: j + 1 === 14 ? '+#,##0;-#,##0;0' : (j + 1 >= 16 ? '#,##0;-#,##0;"-"' : '#,##0'),
                font: F(10, j === 0 || j === 4), al: [2, 3, 11, 12, 15].includes(j + 1) ? CEN : undefined }));
        });
        const rT = r0 + D.rts.length;
        put(RS, rT, 1, 'Grand Total', { font: F(10, true), fill: LIGHT }); put(RS, rT, 2, '', { fill: LIGHT }); put(RS, rT, 3, '', { fill: LIGHT });
        for (let j = 4; j <= H.length; j++) {
            const L = CL(j), rng = `${L}${r0}:${L}${rT - 1}`;
            const v = ({ 4: `=COUNTIF('Daily Calendar'!B${rD}:${LL}${rD},">0")`, 8: `=IF(SUM(D${r0}:D${rT - 1})=0,0,ROUNDUP(F${rT}/SUM(D${r0}:D${rT - 1}),0))`,
                9: `=_xlfn.MINIFS(${rng},C${r0}:C${rT - 1},"Y")`, 10: `=_xlfn.MAXIFS(${rng},C${r0}:C${rT - 1},"Y")`,
                12: `=COUNTIF(${rng},"🟢")&" 🟢 · "&COUNTIF(${rng},"🟡")&" 🟡 · "&COUNTIF(${rng},"🔴")&" 🔴"`,
                14: `=IF(M${rT}=0,"",E${rT}-M${rT})`, 15: `=IF(M${rT}=0,"",IF(N${rT}>0,"▲ Increase",IF(N${rT}<0,"▼ Decrease","Equal")))` })[j] || `=SUM(${rng})`;
            put(RS, rT, j, v, { fmt: j === 14 ? '+#,##0;-#,##0;0' : '#,##0', font: F(10, true), fill: LIGHT, al: [12, 15].includes(j) ? CEN : undefined });
        }
        RS.getCell(rT + 1, 1).value = 'Working Day ของ Grand Total = วันในปฏิทินที่มีอย่างน้อย 1 สายวิ่ง · Visit/Day ของ Grand Total = Visit รวม ÷ Working Day รวมทุกสาย · ต่ำสุด/สูงสุดของ Grand Total = เฉพาะสาย P/V';
        RS.getCell(rT + 1, 1).font = F(8, false, GREY, true);
        widths(RS, [10, 11, 9, 9, 10, 9, 9, 9, 9, 9, 9, 8, 12, 8, 12, 9, 9, 9, 9, 7, 7, 7, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9]);
        RS.addConditionalFormatting({ ref: `E${r0}:E${rT - 1}`, rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: 'FF5B9BD5' } }] });
        const T = (c) => `'Route Summary'!$${c}$${rT}`;
        const RSL = (c) => `'Route Summary'!$${c}$${r0}:$${c}$${rT - 1}`;

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

        // ── Executive Summary
        E.getColumn(1).width = 2;
        for (let c = 2; c <= 11; c++) E.getColumn(c).width = 12.5;
        E.getCell('B2').value = `Route Plan Executive Summary — ศูนย์ ${D.centerId} · ${curL}`; E.getCell('B2').font = F(18, true, NAVY);
        E.getRow(2).height = 28;
        const now = new Date();
        E.getCell('B3').value = `แผน ${curL}${D.base ? ' เทียบแผน ' + baseL : ' (ไม่มีแผนเดือนก่อนให้เทียบ)'} · ${D.rts.length} สาย · ออกรายงาน ${now.toLocaleDateString('th-TH')} ${now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ทุกตัวเลขคำนวณจากชีทข้อมูลในไฟล์นี้`;
        E.getCell('B3').font = F(9, false, GREY);
        const section = (r, text, c1, c2) => {
            c1 = c1 || 2; c2 = c2 || 11;
            E.mergeCells(r, c1, r, c2);
            const x = E.getCell(r, c1); x.value = text; x.font = F(10.5, true, 'FFFFFFFF'); x.fill = FILL(BLUE); x.alignment = { vertical: 'middle', indent: 1 };
            E.getRow(r).height = 20;
        };
        const tile = (r, c, label, value, sub, o) => {
            o = o || {};
            for (let k = 0; k < 3; k++) {
                E.mergeCells(r + k, c, r + k, c + 1);
                const x = E.getCell(r + k, c);
                x.fill = FILL('FFF2F5FB');
                x.border = { left: thin, right: thin, top: k === 0 ? thin : undefined, bottom: k === 2 ? thin : undefined };
                x.alignment = CEN;
            }
            E.getCell(r, c).value = label; E.getCell(r, c).font = F(9, true, GREY);
            const b = E.getCell(r + 1, c); b.value = (typeof value === 'string' && value.startsWith('=')) ? fx(value) : value; b.font = F(o.sz || 20, true, o.color || NAVY); b.numFmt = o.fmt || '#,##0';
            const s = E.getCell(r + 2, c); s.value = (typeof sub === 'string' && sub.startsWith('=')) ? fx(sub) : sub; s.font = F(8, false, GREY);
            E.getRow(r + 1).height = 32;
        };
        section(5, 'ภาพรวมแผน');
        const N_PREV = `COUNTA(${PV_RT})`;
        const WT_NEW = `COUNTIF('รอจัดสาย'!$F$3:$F$${NW},"ร้านใหม่")`, WT_OLD = `COUNTIF('รอจัดสาย'!$F$3:$F$${NW},"ร้านเก่า")`;
        tile(6, 2, 'ร้าน Active ใน Master', `=IF(${P_ACT}="","—",${P_ACT})`, 'Customer Master ล่าสุด');
        tile(6, 4, 'Coverage (ร้านในแผน)', `=${T('E')}`, `=IF(${P_ACT}="","",TEXT(${T('E')}/${P_ACT},"0.0%")&" ของ Active")&IF(${N_PREV}=0,""," · ${baseL} "&TEXT(${N_PREV},"#,##0"))`);
        tile(6, 6, 'Visit ทั้งเดือน', `=${T('F')}`, 'ร้านที่เข้า 2 ครั้ง นับ 2');
        tile(6, 8, 'Re-Visit (ร้านเข้า ≥2 ครั้ง)', `=${T('G')}`, `=IF(${T('E')}=0,"",TEXT(${T('G')}/${T('E')},"0%")&" ของ Coverage")`, { color: 'FFC00000' });
        tile(6, 10, 'Working Day', `=${T('D')}`, `="วันหยุด "&COUNT(${HOLR})&" วัน"`);
        tile(10, 2, 'Visit/Day เฉลี่ยต่อสาย', `=${T('H')}`, 'ROUNDUP(Visit ÷ Working Day รวมทุกสาย)');
        tile(10, 4, 'รอจัดสาย', `=COUNTA('รอจัดสาย'!$A$3:$A$${NW})`, `="ร้านใหม่ "&${WT_NEW}&" · ร้านเก่า "&${WT_OLD}`, { color: 'FFC55A11' });
        tile(10, 6, `หลุดจากแผน (เทียบ ${baseL})`, `=COUNTIF(${PV_NOW},"${NOTIN}")`, `อยู่แผน ${baseL} แต่ไม่อยู่ ${curL}`, { color: 'FFC00000' });
        tile(10, 8, 'ร้านใหม่เข้าแผน', `=COUNTIFS(${R_FS},1,${R_MOVE},"ร้านใหม่*")`, `ไม่อยู่แผน ${baseL}`, { color: 'FF548235' });
        tile(10, 10, 'ย้าย Route', `=COUNTIFS(${R_FS},1,${R_MOVE},"ย้ายจาก*")`, `Route ${baseL} ≠ Route ${curL}`);

        section(14, `เทียบเดือนก่อน: Coverage ${baseL} → ${curL}`);
        const eq = [[`Coverage ${baseL}`, `=${N_PREV}`, NAVY], ['+ ร้านใหม่เข้าแผน', '=H11', 'FF548235'], ['− หลุดจากแผน', '=F11', 'FFC00000'],
                    [`→ Coverage ${curL}`, '=D7', NAVY], ['ตรวจสอบจำนวน', `=IF(${N_PREV}=0,"ไม่มีเดือนก่อน",IF(B16+D16-F16=H16,"✓ ตรงกัน","✗ ไม่ตรง"))`, GREY]];
        eq.forEach(([lab, val, colr], k) => {
            const c = 2 + 2 * k;
            E.mergeCells(15, c, 15, c + 1); E.mergeCells(16, c, 16, c + 1);
            const a = E.getCell(15, c); a.value = lab; a.font = F(9, true, GREY); a.alignment = CEN;
            const b = E.getCell(16, c); b.value = fx(val); b.font = F(16, true, colr); b.alignment = CEN; b.numFmt = '#,##0';
        });
        E.getRow(16).height = 26;

        // ซ้าย: ตารางสาย
        section(18, 'สรุปรายสาย — รายละเอียดเต็มดูชีท Route Summary', 2, 6);
        ['สาย', 'Coverage', 'Visit', 'Visit/Day', 'สถานะ'].forEach((h, j) => put(E, 19, 2 + j, h, { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN }));
        D.rts.forEach((rt, i) => {
            const rr = 20 + i, s = r0 + i;
            ['A', 'E', 'F', 'H', 'L'].forEach((c, j) => put(E, rr, 2 + j, `='Route Summary'!${c}${s}`, { fmt: '#,##0', font: F(9, j === 0), al: (c === 'L' || c === 'H') ? CEN : undefined }));
        });
        const rE = 20 + D.rts.length;
        put(E, rE, 2, 'รวม', { font: F(9, true), fill: LIGHT });
        ['E', 'F', 'H'].forEach((c, j) => put(E, rE, 3 + j, `=${T(c)}`, { fmt: '#,##0', font: F(9, true), fill: LIGHT, al: c === 'H' ? CEN : undefined }));
        put(E, rE, 6, `=COUNTIF(${RSL('L')},"🟢")&"/"&COUNTIF(${RSL('C')},"Y")&" 🟢"`, { font: F(9, true), fill: LIGHT, al: CEN });
        E.addConditionalFormatting({ ref: `C20:C${rE - 1}`, rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: 'FF9DC3E6' } }] });

        // ขวาบน: ขนาดตลาด
        section(18, 'ขนาดตลาด — จำนวนร้านต่อตลาด (สาย P/V)', 8, 11);
        E.mergeCells(19, 8, 19, 9);
        put(E, 19, 8, 'ร้านต่อตลาด', { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN });
        put(E, 19, 10, 'ตลาด', { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN }); put(E, 19, 11, '%', { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN });
        const rB = 20 + BUCK.length;
        BUCK.forEach((b, k) => {
            const rr = 20 + k, fl = k === 0 ? 'FFFCE4D6' : (k === BUCK.length - 1 ? 'FFFFF2CC' : undefined);
            E.mergeCells(rr, 8, rr, 9);
            put(E, rr, 8, b + ' ร้าน', { font: F(9), al: CEN, fill: fl });
            put(E, rr, 10, `=COUNTIFS(${MK_B},"${b}",${MK_EV},"Y")`, { fmt: '#,##0', font: F(9, true), al: CEN, fill: fl });
            put(E, rr, 11, `=IF(J${rB}=0,0,J${rr}/J${rB})`, { fmt: '0%', font: F(9), al: CEN, fill: fl });
        });
        E.mergeCells(rB, 8, rB, 9);
        put(E, rB, 8, 'รวมตลาด (P/V)', { font: F(9, true), al: CEN, fill: LIGHT });
        put(E, rB, 10, `=SUM(J20:J${rB - 1})`, { fmt: '#,##0', font: F(9, true), al: CEN, fill: LIGHT });
        put(E, rB, 11, `=SUM(K20:K${rB - 1})`, { fmt: '0%', font: F(9, true), al: CEN, fill: LIGHT });
        E.addConditionalFormatting({ ref: `K20:K${rB - 1}`, rules: [{ type: 'dataBar', priority: 2, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FF5B9BD5' } }] });
        E.mergeCells(rB + 1, 8, rB + 1, 11);
        E.getCell(rB + 1, 8).value = 'ตลาด = สาย × Day (การ์ด Day ในหน้าวางแผนคิวงาน) · รายการเต็มดูชีท ตลาด';
        E.getCell(rB + 1, 8).font = F(8, false, GREY, true);

        // ขวาล่าง: ประเภทร้าน + เปลี่ยน Shop type
        const cR = rB + 3;
        section(cR, 'ประเภทร้านใน Coverage + การเปลี่ยน Shop type', 8, 11);
        ['ประเภท', 'ร้าน', '%', '+เข้า / −ออก'].forEach((h, j) => put(E, cR + 1, 8 + j, h, { font: F(10, true, 'FFFFFFFF'), fill: NAVY, al: CEN }));
        const catL = CATS.map((c, k) => [c, CL(20 + k)]).concat([['อื่น ๆ', 'Z']]);
        catL.forEach(([c, L], k) => {
            const rr = cR + 2 + k;
            put(E, rr, 8, c, { font: F(9), al: CEN }); put(E, rr, 9, `=${T(L)}`, { fmt: '#,##0', font: F(9) });
            put(E, rr, 10, `=IF($D$7=0,0,I${rr}/$D$7)`, { fmt: '0.0%', font: F(9) });
            put(E, rr, 11, c === 'อื่น ๆ' ? '-' : `=IF(COUNTIFS(${PV_CH},1,${PV_CO},"${c}")+COUNTIFS(${PV_CH},1,${PV_CS},"${c}")=0,"-","+"&COUNTIFS(${PV_CH},1,${PV_CO},"${c}")&" / −"&COUNTIFS(${PV_CH},1,${PV_CS},"${c}"))`,
                { font: F(9, true), al: CEN });
        });
        const cE = cR + 2 + catL.length;
        E.addConditionalFormatting({ ref: `J${cR + 2}:J${cE - 1}`, rules: [{ type: 'dataBar', priority: 3, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FF5B9BD5' } }] });
        E.mergeCells(cE, 8, cE, 11);
        E.getCell(cE, 8).value = fx(`"ร้านที่เปลี่ยน Shop type เทียบ ${baseL}: "&SUM(${PV_CH})&" ร้าน → รายชื่อดูชีท Movement"`);
        E.getCell(cE, 8).font = F(9, true, 'FFC55A11'); E.getCell(cE, 8).alignment = { vertical: 'middle', indent: 1 };

        // Action
        const aR = Math.max(rE, cE) + 2;
        section(aR, 'สิ่งที่ต้องตัดสินใจ / Action — แต่ละข้อบอกที่มาของข้อมูล');
        const acts = [
            [`="ตลาดที่มีร้านต่ำกว่า 15 (สาย P/V): "&J20&" ตลาด"&IF(J20=0," ✓","")`, 'ที่มา: Raw Data → ชีท ตลาด'],
            [`="วันที่ร้าน/วัน นอกเกณฑ์ (สาย P/V): "&${T('K')}&" วัน"&IF(${T('K')}=0," ✓","")`, 'ที่มา: แผนเดือนนี้ × เกณฑ์ใน Parameters → Daily Calendar'],
            [`="ร้านใหม่ยังไม่จัดเข้าสาย: "&${WT_NEW}&" ร้าน"`, 'ที่มา: กองรอจัดสาย × วันเปิดบัญชี → ชีท รอจัดสาย'],
            [`="ร้านเก่า Active แต่ไม่อยู่ในแผน: "&${WT_OLD}&" ร้าน → พิจารณา Inactive"`, 'ที่มา: กองรอจัดสาย × วันเปิดบัญชี → ชีท รอจัดสาย'],
            [`="ร้านในแผนแต่ InActive ใน Master: "&COUNTIF(${IS_TOP},"*InActive ใน Master*")&" ร้าน"`, 'ที่มา: ไฟล์ RoutePlan × Customer Master → ชีท Issues'],
            [`="หลุดจากแผนเทียบ ${baseL}: "&F11&" ร้าน → ยืนยันว่าตั้งใจตัด"`, `ที่มา: แผน ${baseL} × แผน ${curL} → ชีท Movement`],
            [`="ร้านเปลี่ยน Shop type: "&SUM(${PV_CH})&" ร้าน → ตรวจว่าถูกต้อง"`, `ที่มา: แผน ${baseL} × แผน ${curL} → ชีท Movement`],
            [`="ร้านในแผนไม่มีพิกัด: "&COUNTIF(${IS_TOP},"ร้านในแผนไม่มีพิกัดใน Master")&" ร้าน"`, 'ที่มา: Customer Master (Lat/Long) ตอนนำเข้า → ชีท Issues'],
        ];
        acts.forEach(([t, src], k) => {
            const rr = aR + 1 + Math.floor(k / 2) * 2;
            const [c1, c2] = k % 2 === 0 ? [2, 6] : [8, 11];
            [[rr, t, F(9.5, true)], [rr + 1, src, F(8, false, GREY, true)]].forEach(([r2, val, fn]) => {
                E.mergeCells(r2, c1, r2, c2);
                const c = E.getCell(r2, c1);
                c.value = val.startsWith('=') ? fx(val) : val; c.font = fn; c.alignment = { vertical: 'middle', indent: 1 };
                c.fill = FILL('FFFFF8E5');
                E.getRow(r2).height = r2 === rr ? 18 : 14;
            });
        });
        const lastRow = aR + Math.ceil(acts.length / 2) * 2 + 2;
        for (let r = 19; r <= Math.max(rE, cE); r++) E.getRow(r).height = r === 19 ? 24 : 16;
        E.getCell(lastRow, 2).value = 'ตัวเลขทุกช่องเป็นสูตรที่ดึงจากชีทข้อมูล (Raw Data / ตลาด / Prev Plan / รอจัดสาย / Issues / Parameters) · นิยามดูชีท Definitions';
        E.getCell(lastRow, 2).font = F(8, false, GREY, true);
        E.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1,
                        printArea: `A1:K${lastRow}`, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
        [RS, DC].forEach(ws => { ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; });

        // ── Definitions
        title(DF, 'Definitions — นิยามและที่มาของตัวเลข');
        hdr(DF, 3, ['คำ', 'ความหมาย']);
        [
            ['Coverage', 'จำนวนร้าน (ไม่ซ้ำ) ที่มีสายและวันเข้าเยี่ยมในแผนเดือนนี้'],
            ['Visit', 'จำนวนครั้งเข้าเยี่ยมทั้งเดือน = จำนวนแถวใน Raw Data (ร้านที่เข้า 2 ครั้งนับ 2)'],
            ['Re-Visit', 'ร้านที่ถูกเข้าเยี่ยม ≥ 2 ครั้งในเดือน'],
            ['Working Day', 'จำนวนวันที่สายนั้นมีการเข้าเยี่ยม · Grand Total = วันในปฏิทินที่มีอย่างน้อย 1 สายวิ่ง'],
            ['Visit/Day', 'ROUNDUP(Visit ÷ Working Day) · Grand Total = Visit รวม ÷ Working Day รวมทุกสาย'],
            ['เกณฑ์ร้านต่อวัน', 'สาย Pre-sell (P) / Van (V) ตามค่าใน Parameters · สาย C และ E ไม่ประเมิน'],
            ['สถานะสาย', '🟢 ทุกวันอยู่ในเกณฑ์ · 🟡 นอกเกณฑ์ 1–2 วัน · 🔴 นอกเกณฑ์ ≥ 3 วัน'],
            ['ตลาด', 'สาย × Day ตามการ์ด Day ในหน้าวางแผนคิวงาน (รอบที่ 2 ของเดือนเป็น Day แยก) · ร้านในตลาด = ร้านที่อยู่ใน Day นั้น · ช่วงร้าน: ต่ำกว่า 15 / 15–20 / 21–30 / 31–40 / 41 ขึ้นไป · นับเฉพาะสาย P/V'],
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

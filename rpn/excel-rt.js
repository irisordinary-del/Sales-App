/* =============================================================================
 *  excel-rt.js — แผนเป็น Excel: Export → แก้ใน Excel → นำกลับเข้า (V0.9.3)
 * =============================================================================
 *  แทนปุ่ม ♻️ "นำเข้าไฟล์ที่แก้ใน Excel" รุ่นแรก ที่อ่านไฟล์รูปแบบปัจจุบันไม่ได้
 *  (อ่านเลขทุกตัวใน Cycle Name ต่อกันเป็นเลขวัน และไฟล์ Export มี 1 แถวต่อร้าน ร้านที่เข้า 2 Day หายไป 1 Day)
 *
 *  ไฟล์ Export (ปุ่ม 📝 แก้แผนใน Excel แถบล่างหน้าวางแผนคิวงาน · V0.9.4 ระบายสี เหลือง=แก้ได้ เทา=ดูอย่างเดียว) — ชีท "แผน": 1 แถว = ร้าน 1 ร้าน × Day 1 Day (ร้านที่ยังไม่มีวัน = 1 แถว Day ว่าง)
 *    แก้ได้: สาย · Day · ลำดับ · ชื่อตลาด      (คอลัมน์อื่นมีไว้ดู)
 *      ลบแถว            = เอาร้านออกจาก Day นั้น
 *      คัดลอกแถวแล้วแก้ Day = เพิ่ม Day ให้ร้าน
 *      แก้ สาย          = ย้ายร้านไปสายนั้น
 *      ลบทุกแถวของร้าน   = ร้านนั้นไม่มีวัน (รอจัดวัน)
 *  นำกลับเข้า — อ่านไฟล์ → หน้าตรวจก่อน (เปลี่ยนวัน / ย้ายสาย / ลำดับ / ชื่อตลาด / ร้านที่หาไม่เจอ) → ยืนยัน → บันทึก
 *  ทำกับแผนเดือนที่เปิดอยู่ · ย้อนกลับ (Ctrl+Z) ได้
 * ========================================================================== */
(function () {
    'use strict';
    const UNASSIGNED = 'รอจัดสาย';
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const R = () => State.db.routes || {};
    const pad2 = (n) => String(n).padStart(2, '0');
    const H = ['สาย', 'รหัสร้าน', 'ชื่อร้าน', 'Day', 'ลำดับ', 'วันที่เข้าเยี่ยม (ดูอย่างเดียว)', 'ชื่อตลาด',
               'ประเภทร้าน', 'ตำบล', 'อำเภอ', 'จังหวัด', 'Latitude', 'Longitude'];

    // ── Export ──────────────────────────────────────────────────────────
    // V0.9.4: เขียนด้วย ExcelJS เพื่อระบายสี — เหลือง = แก้ได้ · เทา = ดูอย่างเดียว (SheetJS รุ่นฟรีใส่สีไม่ได้)
    const EDIT = [0, 3, 4, 6];                       // สาย · Day · ลำดับ · ชื่อตลาด
    const C_EDIT_H = 'FFBF8F00', C_EDIT = 'FFFFF2CC', C_RO_H = 'FF595959', C_RO = 'FFEDEDED';
    const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const thin = { style: 'thin', color: { argb: 'FFD9D9D9' } };
    const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
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

    const exportFile = async (routeFilter) => {
        try {
            const ym = App._currentPlanYM || '';
            const want = Array.isArray(routeFilter) ? routeFilter.filter(Boolean) : null;
            const rts = Object.keys(R()).filter(r => r !== UNASSIGNED && Array.isArray(R()[r]))
                .filter(r => want ? want.includes(r) : (!routeFilter || routeFilter === 'ALL' || r === routeFilter))
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            if (!rts.length) return UI.showErrorToast('⚠️ ไม่มีสายให้ Export');
            UI.showLoader('📝 กำลังสร้างไฟล์ Excel…', `${rts.length} สาย`);
            const ExcelJS = await lib();
            const rows = [];
            rts.forEach(rt => {
                const list = (R()[rt] || []).filter(s => !s.inactive);
                const mk = {};
                list.forEach(s => (s.days || []).forEach(d => { if (!(d in mk)) { try { mk[d] = RoadMaster.marketName(rt, d, list) || ''; } catch (e) { mk[d] = ''; } } }));
                const dts = {};
                Object.keys(mk).forEach(d => {
                    let ds = [];
                    try { ds = (Runs.datesOf(rt, d) || []).filter(Boolean); } catch (e) {}
                    dts[d] = ds.map(x => x.getDate() + '/' + (x.getMonth() + 1)).join(', ');
                });
                const tail = (s) => [s.shopType || '', s.subDistrict || '', s.district || '', s.province || '', +s.lat || '', +s.lng || ''];
                list.forEach(s => {
                    const code = String(s.code || s.id);
                    const days = (s.days || []).slice().sort((a, b) => dayNum(a) - dayNum(b));
                    if (!days.length) { rows.push({ k: [rt, 9999, 0], v: [rt, code, s.name || '', '', '', '', ''].concat(tail(s)) }); return; }
                    days.forEach(d => rows.push({ k: [rt, dayNum(d), (s.seqs && s.seqs[d]) || 9999],
                        v: [rt, code, s.name || '', dayNum(d), (s.seqs && s.seqs[d]) || '', dts[d] || '', mk[d] || ''].concat(tail(s)) }));
                });
            });
            rows.sort((a, b) => a.k[0].localeCompare(b.k[0], 'th', { numeric: true }) || a.k[1] - b.k[1] || a.k[2] - b.k[2]);

            const wb = new ExcelJS.Workbook();
            wb.creator = 'Route Planner';
            const F = (sz, bold, argb) => ({ name: 'Tahoma', size: sz || 10, bold: !!bold, color: { argb: argb || 'FF000000' } });
            // ── ชีท แผน ──
            const ws = wb.addWorksheet('แผน', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] });
            const W = [10, 13, 36, 7, 8, 20, 30, 10, 16, 18, 14, 11, 11];
            ws.columns = H.map((h, j) => {
                const ed = EDIT.includes(j);
                return { width: W[j], style: { fill: fill(ed ? C_EDIT : C_RO), font: F(10, false, ed ? 'FF000000' : 'FF595959') } };
            });
            const hr = ws.getRow(1);
            H.forEach((h, j) => {
                const c = hr.getCell(j + 1), ed = EDIT.includes(j);
                c.value = h;
                c.font = F(10, true, 'FFFFFFFF');
                c.fill = fill(ed ? C_EDIT_H : C_RO_H);
                c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                c.border = BORDER;
                c.note = ed ? '✏️ แก้ได้' : '🔒 ดูอย่างเดียว — แก้ไปก็ไม่มีผล';
            });
            hr.height = 30;
            rows.forEach((r, i) => {
                const row = ws.getRow(i + 2);
                r.v.forEach((v, j) => {
                    const c = row.getCell(j + 1), ed = EDIT.includes(j);
                    c.value = v === '' ? null : v;
                    c.fill = fill(ed ? C_EDIT : C_RO);
                    c.font = F(10, ed, ed ? 'FF000000' : 'FF595959');
                    c.border = BORDER;
                    if (j === 1) c.numFmt = '@';
                    if (j === 3 || j === 4) c.alignment = { horizontal: 'center' };
                });
            });
            ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: H.length } };
            // ช่องเลือกสาย / ตรวจเลข Day — ใช้กับแถวที่เพิ่มเองด้วย (เผื่อไว้ 2,000 แถว)
            const allRts = Object.keys(R()).filter(r => r !== UNASSIGNED && Array.isArray(R()[r])).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            const nDay = (typeof DAY_COLORS !== 'undefined') ? Object.keys(DAY_COLORS).filter(k => /^Day \d+$/.test(k)).length : 0;
            const LS = wb.addWorksheet('รายชื่อสาย', { state: 'hidden' });
            allRts.forEach((r, i) => { LS.getCell(i + 1, 1).value = r; });
            const last = rows.length + 2001;
            const vRt = { type: 'list', allowBlank: true, formulae: [`'รายชื่อสาย'!$A$1:$A$${allRts.length}`],
                showErrorMessage: true, errorTitle: 'สาย', error: 'เลือกสายจากรายการ (สายที่มีในแผนเดือนนี้)' };
            const vDay = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, nDay],
                showErrorMessage: true, errorTitle: 'Day', error: `ใส่เลข Day 1–${nDay}` };
            const vSeq = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [1],
                showErrorMessage: true, errorTitle: 'ลำดับ', error: 'ใส่เลขลำดับ 1 ขึ้นไป หรือเว้นว่าง' };
            if (ws.dataValidations && typeof ws.dataValidations.add === 'function') {      // ทั้งช่วงทีเดียว (เร็วกว่าทีละช่อง)
                ws.dataValidations.add(`A2:A${last}`, vRt);
                if (nDay) ws.dataValidations.add(`D2:D${last}`, vDay);
                ws.dataValidations.add(`E2:E${last}`, vSeq);
            } else {
                for (let r = 2; r <= last; r++) {
                    ws.getCell(r, 1).dataValidation = vRt;
                    if (nDay) ws.getCell(r, 4).dataValidation = vDay;
                    ws.getCell(r, 5).dataValidation = vSeq;
                }
            }
            // ── ชีท วิธีแก้ ──
            const how = wb.addWorksheet('วิธีแก้');
            how.getColumn(1).width = 16; how.getColumn(2).width = 96;
            const line = (r, a, b, o) => { const c1 = how.getCell(r, 1), c2 = how.getCell(r, 2); c1.value = a; c2.value = b; c1.font = F(10, true); c2.font = F(10, !!(o && o.bold)); c2.alignment = { wrapText: true, vertical: 'top' };
                if (o && o.fill) { c1.fill = fill(o.fill); c1.font = F(10, true, o.fc || 'FF000000'); c1.alignment = { horizontal: 'center' }; } };
            how.getCell(1, 1).value = 'วิธีแก้แผนใน Excel แล้วนำกลับเข้าโปรแกรม'; how.getCell(1, 1).font = F(13, true, 'FF1F3864');
            line(3, 'สีเหลือง', 'แก้ได้: สาย · Day · ลำดับ · ชื่อตลาด', { fill: C_EDIT, bold: true });
            line(4, 'สีเทา', 'ดูอย่างเดียว: รหัสร้าน · ชื่อร้าน · วันที่เข้าเยี่ยม · ประเภทร้าน · ตำบล · อำเภอ · จังหวัด · พิกัด — แก้ไปก็ไม่มีผล', { fill: C_RO, fc: 'FF595959' });
            [['1 แถว', '= ร้าน 1 ร้าน ใน Day 1 Day — ร้านที่เข้าหลาย Day มีหลายแถว · ร้านที่ Day ว่าง = ยังไม่จัดวัน'],
             ['ย้ายวัน', 'แก้เลขในคอลัมน์ Day'],
             ['เพิ่ม Day', 'คัดลอกแถวของร้านนั้น แล้วแก้เลข Day ของแถวใหม่'],
             ['เอาออกจาก Day', 'ลบแถวนั้นทิ้ง (ลบทุกแถวของร้าน = ร้านไม่มีวัน รอจัดวัน)'],
             ['ย้ายสาย', 'แก้คอลัมน์ สาย (เลือกจากรายการ) ให้ครบทุกแถวของร้านนั้น'],
             ['ลำดับคิว', 'แก้เลขในคอลัมน์ ลำดับ · เว้นว่าง หรือปล่อยเลขเดิมของแถวที่คัดลอกมา = ให้โปรแกรมแทรกจุดที่อ้อมน้อยสุดให้ · โปรแกรมไล่เลข 1..n ใหม่ให้เอง'],
             ['ชื่อตลาด', 'แก้ชื่อในแถวของ Day นั้น (ใช้ชื่อที่ใส่มากที่สุดของ Day นั้น)'],
             ['', ''],
             ['นำกลับเข้า', 'โปรแกรม → หน้าวางแผนคิวงาน → ปุ่ม 📝 แก้แผนใน Excel (แถบล่าง) → ② นำไฟล์ที่แก้แล้วกลับเข้า → ตรวจรายการเปลี่ยนแปลง → ยืนยัน · ย้อนกลับได้ (Ctrl+Z)'],
             ['แผนเดือน', `ไฟล์นี้ออกจากแผนเดือน ${App.ymToLabel ? App.ymToLabel(ym) : ym} — นำกลับเข้าแผนเดือนเดียวกัน`],
             ['ข้อห้าม', 'ห้ามเปลี่ยนชื่อชีท "แผน" และชื่อหัวคอลัมน์ · เพิ่มร้านใหม่ผ่านไฟล์นี้ไม่ได้ (รหัสที่ไม่มีในแผนจะถูกข้าม)'],
            ].forEach((x, i) => line(6 + i, x[0], x[1]));
            // ── ชีท ระยะ Master ──
            try {
                const rr = RoadMaster.allRows().filter(r => rts.includes(r.route));
                if (rr.length) {
                    const km = (m) => Math.round((m || 0) / 100) / 10;
                    const ws2 = wb.addWorksheet('ระยะ Master');
                    ws2.columns = [10, 8, 30, 11, 16].map(w => ({ width: w }));
                    ws2.addRow(['สายวิ่ง', 'วัน', 'ชื่อตลาด', 'จำนวนร้าน', 'ระยะ Master (กม.)']).eachCell(c => { c.font = F(10, true, 'FFFFFFFF'); c.fill = fill(C_RO_H); });
                    rr.forEach(r => ws2.addRow([r.route, r.day, r.market || '', r.n, km(r.m)]).eachCell(c => { c.font = F(10); }));
                }
            } catch (e) {}
            const d = new Date();
            const tag = want ? (want.length === 1 ? '_' + want[0] : `_${want.length}สาย`) : (routeFilter && routeFilter !== 'ALL' ? '_' + routeFilter : '');
            const name = `แผน_${window.CENTER_ID || ''}_${ym}${tag}_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.xlsx`;
            const buf = await wb.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            UI.hideLoader();
            UI.showSaveToast(`📝 Export ${rows.length.toLocaleString()} แถว (${rts.length} สาย) — แก้ช่องสีเหลืองใน Excel แล้วนำกลับเข้าได้`);
        } catch (e) {
            UI.hideLoader();
            console.error('[ExcelRT.export]', e);
            UI.showErrorToast('❌ Export ไม่สำเร็จ: ' + (e && e.message));
        }
    };

    // ── Import: อ่านไฟล์ + เทียบกับแผน ─────────────────────────────────────
    let PLAN = null;
    const pick = () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.xlsx,.xls';
        inp.onchange = () => { const f = inp.files[0]; if (f) readFile(f); };
        inp.click();
    };
    const norm = (h) => String(h == null ? '' : h).trim().toLowerCase();
    const readFile = async (file) => {
        try {
            UI.showLoader('📝 กำลังอ่านไฟล์…', file.name);
            const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
            let aoa = null;
            for (const n of ['แผน'].concat(wb.SheetNames)) {
                const ws = wb.Sheets[n]; if (!ws) continue;
                const a = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                const h = (a[0] || []).map(norm);
                if (h.includes('รหัสร้าน') && h.includes('day') && h.includes('สาย')) { aoa = a; break; }
            }
            UI.hideLoader();
            if (!aoa) return UI.showErrorToast('⚠️ ไฟล์นี้ไม่ใช่ไฟล์ที่ Export จากปุ่ม 📝 แก้แผนใน Excel (ต้องมีชีท "แผน" คอลัมน์ สาย / รหัสร้าน / Day)');
            PLAN = analyze(aoa);
            showPreview();
        } catch (e) {
            UI.hideLoader();
            console.error('[ExcelRT.read]', e);
            UI.showErrorToast('❌ อ่านไฟล์ไม่สำเร็จ: ' + (e && e.message));
        }
    };

    const analyze = (aoa) => {
        const h = aoa[0].map(norm);
        const ci = (n) => h.indexOf(norm(n));
        const cR = ci('สาย'), cC = ci('รหัสร้าน'), cD = ci('day'), cQ = ci('ลำดับ'), cM = ci('ชื่อตลาด');
        // ร้านในโปรแกรม (เดือนที่เปิดอยู่)
        const where = new Map();
        Object.keys(R()).forEach(rt => (R()[rt] || []).forEach(s => {
            const c = String(s.code || s.id);
            if (!where.has(c) || (!s.inactive && where.get(c).s.inactive)) where.set(c, { rt, s });
        }));
        const want = new Map();               // code -> { rt, days: Map(day -> seq|null), rtVotes }
        const routesInFile = new Set();       // สายที่อยู่ในไฟล์ = สายปัจจุบันของร้านในไฟล์ (ไม่ใช่สายปลายทางที่ย้ายไป)
        const bad = [], notFound = new Set(), badRoute = new Set(), mkWant = {};
        for (let i = 1; i < aoa.length; i++) {
            const r = aoa[i];
            const code = String(r[cC] == null ? '' : r[cC]).trim();
            const rt = String(r[cR] == null ? '' : r[cR]).trim();
            if (!code && !rt) continue;
            if (!code) continue;
            if (!where.has(code)) { notFound.add(code); continue; }
            if (!rt || !Array.isArray(R()[rt]) || rt === UNASSIGNED) { badRoute.add(rt || '(ว่าง)'); continue; }
            routesInFile.add(where.get(code).rt);
            const o = want.get(code) || { votes: {}, days: new Map() };
            o.votes[rt] = (o.votes[rt] || 0) + 1;
            const dv = String(r[cD] == null ? '' : r[cD]).trim();
            if (dv) {
                const n = dayNum(dv);
                const dk = 'Day ' + n;
                if (!n || typeof DAY_COLORS === 'undefined' || !DAY_COLORS[dk]) { bad.push(`แถว ${i + 1}: Day "${dv}"`); }
                else {
                    const q = cQ >= 0 ? parseInt(String(r[cQ]).replace(/\D/g, ''), 10) : NaN;
                    o.days.set(dk, isFinite(q) && q > 0 ? q : (o.days.get(dk) || null));
                    if (cM >= 0 && where.get(code).rt === rt) { const m = String(r[cM] || '').trim(); if (m) { const k = rt + '|' + dk; (mkWant[k] || (mkWant[k] = {}))[m] = ((mkWant[k] || {})[m] || 0) + 1; } }
                }
            }
            want.set(code, o);
        }
        // ตัดสินสายของแต่ละร้าน (ถ้าแถวของร้านเดียวกันใส่คนละสาย ใช้สายที่มีแถวมากสุด)
        const conflict = [];
        want.forEach((o, code) => {
            const v = Object.entries(o.votes).sort((a, b) => b[1] - a[1]);
            o.rt = v[0][0];
            if (v.length > 1) conflict.push(code);
        });
        // เทียบกับของเดิม
        const ch = { days: [], move: [], seq: [], cleared: [], same: 0 };
        const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
        want.forEach((o, code) => {
            const cur = where.get(code);
            const s = cur.s;
            const nd = [...o.days.keys()];
            const od = s.inactive ? [] : (s.days || []);
            const moved = cur.rt !== o.rt;
            const daysCh = !sameSet(nd, od);
            const seqCh = !daysCh && nd.some(d => o.days.get(d) && (s.seqs || {})[d] !== o.days.get(d));
            if (moved) ch.move.push({ code, s, from: cur.rt, to: o.rt, od, nd });
            else if (daysCh) ch.days.push({ code, s, rt: o.rt, od, nd });
            else if (seqCh) ch.seq.push({ code, s, rt: o.rt });
            else ch.same++;
        });
        // ร้านในสายที่อยู่ในไฟล์ แต่ไม่มีแถวเลย → ไม่มีวัน
        routesInFile.forEach(rt => (R()[rt] || []).forEach(s => {
            const c = String(s.code || s.id);
            if (s.inactive || want.has(c) || !(s.days || []).length) return;
            ch.cleared.push({ code: c, s, rt, od: s.days.slice() });
        }));
        // ชื่อตลาด
        const mk = [];
        Object.entries(mkWant).forEach(([k, m]) => {
            const [rt, dk] = k.split('|');
            const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
            let cur = '';
            try { cur = RoadMaster.marketName(rt, dk, R()[rt]) || ''; } catch (e) {}
            if (top !== cur) mk.push({ rt, dk, from: cur, to: top });
        });
        return { want, ch, mk, bad, notFound: [...notFound], badRoute: [...badRoute], conflict, routesInFile: [...routesInFile] };
    };

    const dl = (a) => (a || []).slice().sort((x, y) => dayNum(x) - dayNum(y)).map(d => 'D' + dayNum(d)).join('·') || '—';
    const close = () => { const o = document.getElementById('xrt-modal'); if (o) o.remove(); };
    const showPreview = () => {
        close();
        const P = PLAN, c = P.ch;
        const n = c.days.length + c.move.length + c.seq.length + c.cleared.length + P.mk.length;
        const sec = (title, arr, fmt, cls) => arr.length ? `
            <details class="border border-gray-200 rounded-lg mb-1.5" ${arr.length <= 8 ? 'open' : ''}>
              <summary class="cursor-pointer px-2 py-1 text-[12px] font-bold ${cls || 'text-gray-700'}">${title} · <span class="font-black">${arr.length.toLocaleString()}</span></summary>
              <div class="px-2 pb-1.5 text-[11px] text-gray-600 max-h-40 overflow-y-auto">${arr.slice(0, 300).map(fmt).join('<br>')}${arr.length > 300 ? '<br>…' : ''}</div>
            </details>` : '';
        const ov = document.createElement('div');
        ov.id = 'xrt-modal';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px';
        ov.innerHTML = `<div class="bg-white rounded-2xl shadow-xl p-4 w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div class="flex items-center mb-1"><h3 class="text-sm font-black text-gray-800">📝 นำแผนที่แก้ใน Excel กลับเข้า — ตรวจก่อนยืนยัน</h3>
              <button onclick="ExcelRT.close()" class="ml-auto text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button></div>
            <p class="text-[11px] text-gray-500 mb-2">แผนเดือน ${esc(App.ymToLabel ? App.ymToLabel(App._currentPlanYM) : App._currentPlanYM)} · สายในไฟล์ ${P.routesInFile.length} สาย · ร้านที่ไม่เปลี่ยน ${c.same.toLocaleString()} ร้าน</p>
            <div class="overflow-y-auto flex-1">
              ${n ? '' : '<p class="text-[12px] text-emerald-700 font-bold py-3 text-center">✅ ไม่มีอะไรเปลี่ยน — ไฟล์ตรงกับแผนในโปรแกรม</p>'}
              ${sec('📅 เปลี่ยน Day', c.days, x => `${esc(x.rt)} · ${esc(x.s.name)} (${esc(x.code)}): ${dl(x.od)} → <b>${dl(x.nd)}</b>`)}
              ${sec('⇄ ย้ายสาย', c.move, x => `${esc(x.s.name)} (${esc(x.code)}): ${esc(x.from)} ${dl(x.od)} → <b>${esc(x.to)} ${dl(x.nd)}</b>`)}
              ${sec('🔢 เปลี่ยนลำดับคิว', c.seq, x => `${esc(x.rt)} · ${esc(x.s.name)} (${esc(x.code)})`)}
              ${sec('➖ ไม่มีแถวในไฟล์ → ถอดวัน (รอจัดวัน)', c.cleared, x => `${esc(x.rt)} · ${esc(x.s.name)} (${esc(x.code)}): ${dl(x.od)} → —`, 'text-amber-700')}
              ${sec('🏷️ เปลี่ยนชื่อตลาด', P.mk, x => `${esc(x.rt)} D${dayNum(x.dk)}: ${esc(x.from) || '—'} → <b>${esc(x.to)}</b>`)}
              ${sec('⚠️ รหัสร้านที่ไม่มีในแผนเดือนนี้ (ข้าม)', P.notFound, x => esc(x), 'text-red-600')}
              ${sec('⚠️ สายที่ไม่มีในโปรแกรม (ข้าม)', P.badRoute, x => esc(x), 'text-red-600')}
              ${sec('⚠️ Day ไม่ถูกต้อง (ข้ามแถวนั้น)', P.bad, x => esc(x), 'text-red-600')}
              ${sec('ℹ️ ร้านเดียวกันใส่คนละสาย (ใช้สายที่มีแถวมากสุด)', P.conflict, x => esc(x), 'text-gray-500')}
            </div>
            <div class="flex gap-2 mt-3">
              <button onclick="ExcelRT.close()" class="flex-1 border border-gray-200 rounded-xl py-2 text-sm font-bold text-gray-600 hover:bg-gray-50">ยกเลิก</button>
              <button onclick="ExcelRT.apply()" ${n ? '' : 'disabled'} class="flex-1 ${n ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300'} text-white rounded-xl py-2 text-sm font-bold">ใช้การเปลี่ยนแปลง ${n ? n.toLocaleString() + ' รายการ' : ''}</button>
            </div></div>`;
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        document.body.appendChild(ov);
    };

    // ── Apply ──────────────────────────────────────────────────────────
    const apply = async () => {
        const P = PLAN;
        if (!P) return;
        close();
        UI.showLoader('📝 กำลังนำแผนกลับเข้า…', '');
        try {
            try { if (window.EditHistory) EditHistory.mark('นำแผนที่แก้ใน Excel กลับเข้า'); } catch (e) {}
            const touched = new Set(), gone = {}, added = {};
            const push = (o, k, d) => { (o[k] || (o[k] = new Set())).add(d); };
            const fqOfDay = (rt, d) => {
                const c = {};
                (R()[rt] || []).forEach(x => { const v = x.fqs && x.fqs[d]; if (v && (x.days || []).includes(d)) c[v] = (c[v] || 0) + 1; });
                const t = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
                return t ? t[0] : '';
            };
            // oldQ = เลขลำดับเดิมของร้าน — Day ที่เพิ่ง เพิ่ม/ย้ายมา ถ้าเลขในไฟล์ซ้ำกับเลขเดิม (คัดลอกแถวมา) ให้โปรแกรมแทรกจุดที่อ้อมน้อยสุดแทน
            const setDays = (s, rt, want, od, oldQ) => {
                const nd = [...want.days.keys()];
                oldQ = oldQ || new Set(Object.values(s.seqs || {}));
                od.filter(d => !nd.includes(d)).forEach(d => {
                    push(gone, rt, d);
                    if (s.seqs) delete s.seqs[d];
                    if (s.cys) delete s.cys[d];
                    if (s.fqs) delete s.fqs[d];
                    if (s.runOf) delete s.runOf[d];
                });
                if (!s.seqs) s.seqs = {};
                nd.forEach(d => {
                    const q = want.days.get(d);
                    if (od.includes(d)) { if (q && q !== s.seqs[d]) s.seqs[d] = q - 0.5; }   // ลำดับจากไฟล์ — ไล่เลขใหม่ทีหลัง (−0.5 ให้ชนะร้านเดิมที่เลขเท่ากัน)
                    else if (q && !oldQ.has(q)) s.seqs[d] = q - 0.5;
                    else delete s.seqs[d];
                    if (!od.includes(d)) {
                        push(added, rt, d);
                        const f = fqOfDay(rt, d);
                        if (f) { if (!s.fqs) s.fqs = {}; s.fqs[d] = f; }
                    }
                    push(gone, rt, d);                         // ตลาดที่ร้านอยู่ — ไล่เลข 1..n ใหม่
                });
                s.days = nd.sort((a, b) => dayNum(a) - dayNum(b));
                s.freq = s.days.length >= 2 ? 2 : 1;
                s.selected = false;
                touched.add(rt);
            };
            P.ch.days.forEach(x => setDays(x.s, x.rt, P.want.get(x.code), x.od));
            P.ch.seq.forEach(x => setDays(x.s, x.rt, P.want.get(x.code), x.s.days.slice()));
            P.ch.move.forEach(x => {
                const s = x.s;
                const oldQ = new Set(Object.values(s.seqs || {}));
                R()[x.from] = (R()[x.from] || []).filter(y => y !== s);
                x.od.forEach(d => push(gone, x.from, d));
                touched.add(x.from);
                s.days = []; s.seqs = {}; s.cys = {}; s.cy = ''; s.fqs = {}; delete s.runOf;
                s.route = x.to; s.salesCode = x.to; s.inactive = false;
                R()[x.to].push(s);
                setDays(s, x.to, P.want.get(x.code), [], oldQ);
            });
            P.ch.cleared.forEach(x => {
                x.od.forEach(d => push(gone, x.rt, d));
                const s = x.s; s.days = []; s.seqs = {}; s.cys = {}; s.fqs = {}; delete s.runOf; s.freq = 1; s.selected = false;
                touched.add(x.rt);
            });
            // ร้านที่ได้ Day ใหม่ / ย้ายสาย — ใช้ชื่อตลาดของ Day ปลายทาง (ไม่ให้ชื่อตลาดเดิมติดไปปนกับตลาดใหม่)
            P.ch.days.concat(P.ch.move).forEach(x => {
                const s = x.s, rt = x.to || x.rt, d = (s.days || [])[0];
                if (!d) return;
                const nm = ((R()[rt] || []).find(y => y !== s && !y.inactive && y.marketName && (y.days || []).includes(d)) || {}).marketName;
                if (nm) s.marketName = nm;
            });
            P.mk.forEach(x => { try { RoadMaster.setMarketName(x.rt, x.dk, x.to); touched.add(x.rt); } catch (e) {} });
            // ไล่ลำดับคิวใหม่ + แทรกร้านที่ไม่มีลำดับ
            if (typeof SeqTool !== 'undefined') {
                try { if (typeof Runs !== 'undefined' && Runs.bump) Runs.bump(); } catch (e) {}
                // SeqTool ทำงานกับ State.stores (สายที่เปิดอยู่) — สลับให้ชี้สายที่แก้ชั่วคราว
                const keepS = State.stores, keepR = State.localActiveRoute;
                try {
                    [...new Set(Object.keys(gone).concat(Object.keys(added)))].forEach(rt => {
                        if (!Array.isArray(R()[rt])) return;
                        State.stores = R()[rt]; State.localActiveRoute = rt;
                        (gone[rt] || []).forEach(d => { try { SeqTool.compact(d, rt); } catch (e) {} });
                        if (added[rt]) { try { SeqTool.reflow([...added[rt]], rt); } catch (e) {} }
                        (gone[rt] || []).forEach(d => { try { SeqTool.compact(d, rt); } catch (e) {} });
                    });
                } finally { State.stores = keepS; State.localActiveRoute = keepR; }
            }
            const ym = App._currentPlanYM;
            try { if (typeof Runs !== 'undefined' && Runs.bump) Runs.bump(); } catch (e) {}
            await Promise.all([...touched].filter(r => Array.isArray(R()[r])).map(r => App.planRoutesCol(ym).doc(r).set({
                stores: R()[r],
                confirmedBy: firebase.firestore.FieldValue.delete(),
                confirmedAt: firebase.firestore.FieldValue.delete(),
            }, { merge: true })));
            if (State.localActiveRoute && R()[State.localActiveRoute] && !(typeof MultiRoute !== 'undefined' && MultiRoute.multi)) State.stores = R()[State.localActiveRoute];
            try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
            UI.hideLoader();
            UI.render();
            const c = P.ch;
            UI.showSaveToast(`✅ นำกลับเข้าแล้ว — เปลี่ยน Day ${c.days.length} · ย้ายสาย ${c.move.length} · ลำดับ ${c.seq.length} · ถอดวัน ${c.cleared.length} · ชื่อตลาด ${P.mk.length}`);
            PLAN = null;
        } catch (e) {
            UI.hideLoader();
            console.error('[ExcelRT.apply]', e);
            UI.showErrorToast('❌ นำกลับเข้าไม่สำเร็จ: ' + (e && e.message));
        }
    };

    window.ExcelRT = { export: exportFile, pick, readFile, apply, close, _analyze: analyze, _plan: () => PLAN };

})();

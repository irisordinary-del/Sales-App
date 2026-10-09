/* =============================================================================
 *  geo-tree.js — ร้านย้ายเซลล์: ออกไฟล์ GEO_TREE_END / GEO_TREE_START สำหรับ DMS   (V0.7.0)
 * =============================================================================
 *  ข้อมูลตั้งต้น = CUSTOMER_GEO_TREE ที่ดึงจาก DMS (Import/export Job) — บอกว่าร้านไหนผูกกับ Node (เซลล์) ไหน
 *    • ไฟล์ทั้งบริษัท (.zip หรือ .csv) — DMS ส่งออกเป็นข้อความ UTF-16 คั่นด้วย Tab แม้นามสกุลจะเป็น .csv
 *    • Node ID = Node แม่ของศูนย์ + รหัสสายตัดเลขศูนย์ เช่น BSTB06501D01 + P06 (Node แม่ต่างกันรายศูนย์ อ่านจากไฟล์)
 *    • ระบบเก็บเฉพาะศูนย์ที่เปิดอยู่: Node ของทุกสาย + การผูกที่ยังไม่สิ้นสุดของแต่ละร้าน
 *
 *  ตรวจร้านย้ายเซลล์ก่อน (ไม่ต้องมี Geo Tree): Salesman Code เดิมของร้าน (จาก Customer Master ตอนนำเข้า) ≠ สายหลังจัด
 *    → มีร้านย้ายแต่ยังไม่นำเข้า Geo Tree = ส่งออก zip ไม่ได้ (ต้องได้ Node ID จาก Geo Tree)
 *    ส่งออกแล้วระบบเปลี่ยน Salesman Code ของร้านที่ย้ายเป็นสายใหม่ (DMS จะผูกใหม่ตามไฟล์) — เดือนถัดไปไม่เตือนซ้ำ
 *
 *  ส่งออก (เฉพาะร้านที่ย้ายเซลล์ — ตกลงกันแล้ว 5 ต.ค. 2569) — อยู่ใน zip เดียวกับไฟล์แผน (dms-export.js)
 *    GEO_TREE_END   = Node เดิม + วันเริ่มเดิม + End Date = วันก่อนวันเริ่มผูกใหม่
 *    GEO_TREE_START = Node ของสายใหม่ + Start Date = วันที่ 1 ของเดือนแผน (แก้ได้) · ไม่ใส่ End Date
 *    ร้านใหม่ที่ยังไม่อยู่ใน Geo Tree → มีแค่ใน START
 *    รูปแบบไฟล์เหมือนที่ DMS ส่งออก: .csv · UTF-16 · คั่นด้วย Tab · วันที่ ปปปป/ดด/วว
 * ========================================================================== */
(function () {
    'use strict';

    const HEAD = ['Distributor Code', 'Tree ID', 'Node ID', 'Customer Code', 'Start Date', 'End Date'];
    const UNASSIGNED = 'รอจัดสาย';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad2 = (n) => String(n).padStart(2, '0');
    const ymd = (d) => d ? d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) : '';
    const iso = (d) => d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : '';
    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const thd = (d) => d ? d.getDate() + ' ' + TH[d.getMonth()] + ' ' + (d.getFullYear() + 543) : '';

    /** วันที่ในไฟล์: 2022/07/29 · 2022-07-29 · 29/07/2022 → Date (ว่าง = null) */
    const parseDate = (s) => {
        s = String(s == null ? '' : s).trim();
        if (!s) return null;
        let m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(s);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        return null;
    };
    const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

    /** ไบต์ → ข้อความ (ดู BOM: UTF-16LE / UTF-16BE / UTF-8) */
    const decode = (u8) => {
        if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
        if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
        // ไม่มี BOM แต่ไบต์ที่ 2 เป็น 0 → UTF-16LE
        if (u8.length > 3 && u8[1] === 0 && u8[3] === 0) return new TextDecoder('utf-16le').decode(u8);
        return new TextDecoder('utf-8').decode(u8).replace(/^﻿/, '');
    };

    /** ข้อความ → ไบต์ UTF-16LE มี BOM (แบบที่ Excel "Unicode Text" และ DMS ใช้) */
    const encodeUtf16 = (text) => {
        const out = new Uint8Array(2 + text.length * 2);
        out[0] = 0xFF; out[1] = 0xFE;
        for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[2 + i * 2] = c & 0xFF; out[3 + i * 2] = c >> 8; }
        return out;
    };

    const ref = () => App.dbRef.collection('meta').doc('geoTree');
    const center = () => {
        let c = '';
        try { c = (typeof DmsExport !== 'undefined' && DmsExport.distCode) ? String(DmsExport.distCode() || '') : ''; } catch (e) {}
        return c || String(window.CENTER_ID || '');
    };

    const G = {
        _doc: null,        // ข้อมูลที่เก็บไว้ของศูนย์นี้
        _center: '',
        _start: '',        // วันเริ่มผูกใหม่ที่ผู้ใช้แก้ (iso) ของเดือน _startYM
        _startYM: '',

        async ensure() {
            const c = window.CENTER_DOC || '';
            if (G._doc && G._center === c) return G._doc;
            G._center = c; G._doc = null;
            try { const d = await ref().get(); if (d && d.exists) G._doc = d.data(); } catch (e) {}
            return G._doc;
        },

        // ── อ่านไฟล์ ─────────────────────────────────────────────────────
        pick() {
            let inp = document.getElementById('geo-file');
            if (!inp) {
                inp = document.createElement('input');
                inp.type = 'file'; inp.id = 'geo-file'; inp.accept = '.zip,.csv,.txt';
                inp.style.display = 'none';
                inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) G.load(f); };
                document.body.appendChild(inp);
            }
            inp.click();
        },

        /** อ่านไฟล์ Geo Tree แล้วเก็บของศูนย์นี้ · dist = รหัสศูนย์ (ไม่ใส่ = ศูนย์ที่เปิดอยู่) · quiet = เรียกจากหน้านำเข้า */
        async load(file, dist, quiet) {
            if (!quiet) UI.showLoader('🌳 กำลังอ่าน CUSTOMER_GEO_TREE...', file.name);
            try {
                let u8 = new Uint8Array(await file.arrayBuffer());
                // zip → หยิบไฟล์ข้อมูลข้างใน
                if (u8[0] === 0x50 && u8[1] === 0x4B) {
                    const z = XLSX.CFB.read(u8, { type: 'array' });
                    const f = (z.FileIndex || []).find(x => x.type === 2 && /\.(csv|txt)$/i.test(x.name || ''))
                           || (z.FileIndex || []).find(x => x.type === 2 && x.content && x.content.length > 100);
                    if (!f) throw new Error('ไม่พบไฟล์ข้อมูลใน zip');
                    u8 = f.content instanceof Uint8Array ? f.content : new Uint8Array(f.content);
                }
                await new Promise(r => setTimeout(r, 30));
                const out = G.parse(decode(u8), dist || center());
                out.fileName = file.name;
                out.loadedAt = new Date().toISOString();
                await ref().set(out);
                G._doc = out; G._center = window.CENTER_DOC || '';
                if (quiet) return out;
                UI.hideLoader();
                UI.showSaveToast(`🌳 นำเข้า Geo Tree ศูนย์ ${out.dist} แล้ว — ${Object.keys(out.cust).length.toLocaleString()} ร้าน · ${Object.keys(out.nodes).length} Node`);
                if (typeof DmsExport !== 'undefined' && document.getElementById('dms-modal')
                    && !document.getElementById('dms-modal').classList.contains('hidden')) DmsExport.open();
            } catch (e) {
                console.error('[GeoTree]', e);
                if (quiet) throw e;
                UI.hideLoader();
                UI.showErrorToast('❌ อ่าน Geo Tree ไม่สำเร็จ: ' + (e && e.message || e));
            }
        },

        /** ข้อความทั้งไฟล์ → ข้อมูลของศูนย์ dist */
        parse(text, dist) {
            const lines = text.split(/\r?\n/);
            const head = (lines[0] || '').split(lines[0].indexOf('\t') >= 0 ? '\t' : ',').map(s => s.trim().replace(/^"|"$/g, '').toLowerCase());
            const sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
            const col = (...names) => { for (const n of names) { const i = head.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
            const cD = col('Distributor Code'), cT = col('Tree ID', 'Tree Code'), cN = col('Node ID', 'Node Code'),
                  cC = col('Customer Code', 'Cust Code (nv20)'), cS = col('Start Date', 'Effective Start Date'), cE = col('End Date', 'Effective End Date');
            if (cN < 0 || cC < 0 || cS < 0) throw new Error('หัวตารางไม่ตรงกับไฟล์ CUSTOMER_GEO_TREE (ต้องมี Node ID, Customer Code, Start Date)');

            const dists = {};
            const rows = [];
            for (let i = 1; i < lines.length; i++) {
                const ln = lines[i];
                if (!ln) continue;
                const r = ln.split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
                const d = cD >= 0 ? r[cD] : '';
                dists[d] = (dists[d] || 0) + 1;
                if (dist && cD >= 0 && d !== dist) continue;
                rows.push(r);
            }
            if (!rows.length) {
                const list = Object.keys(dists).filter(Boolean).sort().join(', ');
                throw new Error(`ไม่มีข้อมูลของศูนย์ ${dist || '(ไม่ทราบ)'} ในไฟล์นี้` + (list ? ` (ในไฟล์มีศูนย์ ${list})` : ''));
            }

            // Node แม่ = Node ส่วนใหญ่ตัด 3 ตัวท้าย (รหัสสาย)
            const pc = {};
            rows.forEach(r => { const n = r[cN] || ''; if (n.length > 3) { const p = n.slice(0, -3); pc[p] = (pc[p] || 0) + 1; } });
            const parent = (Object.entries(pc).sort((a, b) => b[1] - a[1])[0] || [''])[0];
            const nodes = {};
            rows.forEach(r => { const n = r[cN] || ''; if (parent && n.startsWith(parent) && n.length > parent.length) nodes[n.slice(parent.length)] = n; });

            // การผูกที่ยังไม่สิ้นสุด (ว่าง / ปีอนาคตไกล) หรือเพิ่งสิ้นสุดไม่เกิน ~2 เดือน — ไว้เทียบ ณ วันที่ส่งออก
            const cut = new Date(); cut.setDate(cut.getDate() - 70);
            const cust = {};
            let tree = 'BST';
            rows.forEach(r => {
                const c = r[cC]; if (!c) return;
                const s = parseDate(r[cS]); if (!s) return;
                const e = cE >= 0 ? parseDate(r[cE]) : null;
                if (e && e < cut) return;
                if (cT >= 0 && r[cT]) tree = r[cT];
                (cust[c] || (cust[c] = [])).push([r[cN], iso(s), e ? iso(e) : '']);
            });
            Object.values(cust).forEach(a => a.sort((x, y) => x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
            return { dist: dist || (rows[0][cD] || ''), tree, parent, nodes, cust, rows: rows.length };
        },

        // ── ตรวจร้านย้ายเซลล์จาก Salesman Code (ไม่ต้องมี Geo Tree) ─────────────
        /** ร้านที่สายหลังจัด ≠ Salesman Code เดิม (ร้านไม่มี Salesman Code = ร้านใหม่) */
        pre() {
            const R = (State.db && State.db.routes) || {};
            const out = [];
            const seen = new Set();
            Object.keys(R).forEach(rt => {
                if (rt === UNASSIGNED) return;
                (R[rt] || []).forEach(s => {
                    if (!s || s.inactive) return;
                    const c = String(s.code || s.id || '');
                    if (!c || seen.has(c)) return;
                    seen.add(c);
                    const sc = String(s.salesCode || '').trim();
                    if (sc !== rt) out.push({ c, name: s.name || '', route: rt, from: sc });
                });
            });
            return out;
        },
        /** ต้องนำเข้า Geo Tree ก่อนส่งออกไหม */
        blocked() { return !G._doc && G.pre().length > 0; },
        /** Geo Tree ที่นำเข้าไว้เก่าเกิน 30 วัน */
        stale() {
            const t = G._doc && G._doc.loadedAt ? new Date(G._doc.loadedAt) : null;
            return !!(t && (Date.now() - t.getTime()) > 30 * 86400000);
        },
        /** หลังส่งออก: ร้านที่ย้ายแล้วเปลี่ยน Salesman Code เป็นสายใหม่ (DMS จะผูกใหม่ตามไฟล์ที่อัป) */
        async markSent() {
            const R = (State.db && State.db.routes) || {};
            const touched = new Set();
            Object.keys(R).forEach(rt => {
                if (rt === UNASSIGNED) return;
                (R[rt] || []).forEach(s => { if (s && !s.inactive && String(s.salesCode || '').trim() !== rt) { s.salesCode = rt; touched.add(rt); } });
            });
            for (const rt of touched) {
                try { await App.planRoutesCol(App._currentPlanYM).doc(rt).set({ stores: R[rt] }, { merge: true }); } catch (e) {}
            }
            return touched.size;
        },

        // ── เทียบกับแผน ──────────────────────────────────────────────────
        startDate() {
            const ym = (typeof App !== 'undefined' && App._currentPlanYM) || '';
            if (G._startYM === ym && G._start) { const d = parseIso(G._start); if (d) return d; }
            const [y, m] = ym.split('_').map(Number);
            return (y && m) ? new Date(y, m - 1, 1) : null;
        },
        setStart(v) {
            if (!parseIso(v)) return;
            G._start = v; G._startYM = App._currentPlanYM || '';
            if (typeof DmsExport !== 'undefined') DmsExport.open();
        },

        /** Node ที่ร้านผูกอยู่ ณ วันที่ at — การผูกล่าสุดที่เริ่มไม่เกิน at และยังไม่สิ้นสุดก่อน at */
        nodeAt(list, at) {
            const a = iso(at);
            let hit = null;
            (list || []).forEach(b => { if (b[1] <= a && (!b[2] || b[2] >= a)) hit = b; });
            return hit;
        },

        /** รายการร้านที่ต้องปิด/เปิดการผูกใหม่ เทียบสายในแผนกับ Geo Tree */
        diff() {
            const doc = G._doc;
            if (!doc) return null;
            const start = G.startDate();
            if (!start) return null;
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
            const dist = doc.dist;
            const R = (State.db && State.db.routes) || {};
            const seen = {};
            const moved = [], fresh = [], noNode = {}, dup = [];
            let same = 0;
            Object.keys(R).forEach(rt => {
                if (rt === UNASSIGNED) return;
                (R[rt] || []).forEach(s => {
                    if (!s || s.inactive) return;
                    const c = String(s.code || s.id || '');
                    if (!c) return;
                    if (seen[c]) { dup.push({ c, a: seen[c], b: rt }); return; }
                    seen[c] = rt;
                    const suf = String(rt).startsWith(dist) ? String(rt).slice(dist.length) : String(rt).slice(-3);
                    const node = doc.nodes[suf] || (doc.parent + suf);
                    if (!doc.nodes[suf]) (noNode[rt] = noNode[rt] || []).push(c);
                    // ผูก ณ วันเริ่มใหม่ (เผื่ออัปไปแล้ว) ไม่งั้นดู ณ วันก่อนหน้า
                    const atStart = G.nodeAt(doc.cust[c], start);
                    if (atStart && atStart[0] === node) { same++; return; }
                    const cur = G.nodeAt(doc.cust[c], end);
                    if (cur && cur[0] === node) { same++; return; }
                    const row = { c, name: s.name || '', route: rt, node, from: cur ? cur[0] : '', fromStart: cur ? cur[1] : '' };
                    if (cur) moved.push(row); else fresh.push(row);
                });
            });
            const sortRows = (a) => a.sort((x, y) => x.route.localeCompare(y.route, 'th', { numeric: true }) || x.c.localeCompare(y.c));
            return { start, end, dist, tree: doc.tree || 'BST', moved: sortRows(moved), fresh: sortRows(fresh), same, noNode, dup };
        },

        // ── ส่วนในหน้าต่างส่งออก DMS ──────────────────────────────────────
        panel() {
            const doc = G._doc;
            const pre = G.pre();
            const box = (inner, tone) => `<div class="border ${tone === 'red' ? 'border-red-300 bg-red-50/60' : 'border-emerald-200 bg-emerald-50/40'} rounded-xl p-2.5 mb-3 text-[11px] leading-snug">${inner}</div>`;
            const head = `<div class="flex items-center justify-between gap-2 mb-1">
                    <b class="${!doc && pre.length ? 'text-red-800' : 'text-emerald-900'}">🌳 ร้านย้ายเซลล์ (Geo Tree)</b>
                    <button onclick="GeoTree.pick()" class="text-[10.5px] font-bold ${!doc && pre.length ? 'text-white bg-red-600 hover:bg-red-700 border-red-600' : 'text-emerald-700 bg-white hover:bg-emerald-50 border-emerald-300'} border rounded-lg px-2 py-0.5">${doc ? '↻ นำเข้าใหม่' : '📥 นำเข้า CUSTOMER_GEO_TREE'}</button></div>`;
            const preList = (xs) => xs.length ? `<details class="mt-1"><summary class="cursor-pointer font-bold text-gray-500">รายชื่อร้าน${xs.length > 300 ? ' (300 แรก)' : ''}</summary>
                    <div class="mt-1 max-h-40 overflow-y-auto pr-1 space-y-0.5">
                        ${xs.slice(0, 300).map(x => `<div class="flex gap-2"><span class="font-mono w-20 shrink-0">${esc(x.c)}</span>
                            <span class="flex-1 truncate">${esc(x.name)}</span>
                            <span class="font-mono text-gray-500 shrink-0">${x.from ? esc(x.from) : '<i>ใหม่</i>'} → <b class="text-emerald-800">${esc(x.route)}</b></span></div>`).join('')}
                    </div></details>` : '';
            if (!doc) {
                if (!pre.length) return box(head + `<p class="text-gray-500">ไม่มีร้านย้ายเซลล์ (ทุกร้านอยู่สายเดียวกับ Salesman Code เดิม) — ไม่ต้องนำเข้า Geo Tree · zip มีไฟล์แผน 2 ไฟล์</p>`);
                return box(head + `<p class="text-red-800"><b>⚠️ มี ${pre.length.toLocaleString()} ร้านย้ายเซลล์</b> (Salesman Code เดิม ≠ สายหลังจัด) — ต้องนำเข้า <b>CUSTOMER_GEO_TREE</b> จาก DMS (Import/export Job · .zip หรือ .csv) ก่อน
                    ระบบจึงจะออก GEO_TREE_END / START ใส่ zip ให้ได้</p>` + preList(pre), 'red');
            }
            const d = G.diff();
            if (!d) return box(head + `<p class="text-gray-500">ยังไม่ได้เปิดแผนเดือนไหน</p>`);
            const nMove = d.moved.length, nNew = d.fresh.length;
            const noNode = Object.keys(d.noNode);
            const loaded = doc.loadedAt ? new Date(doc.loadedAt) : null;
            const list = d.moved.concat(d.fresh).map(x => ({ c: x.c, name: x.name, route: x.route, from: x.from ? x.from.slice(-3) : '' }));
            return box(head + `
                <p class="text-gray-500 mb-1.5">ข้อมูลจาก <b>${esc(doc.fileName || '')}</b> ${loaded ? '· นำเข้า ' + esc(thd(loaded)) : ''} · ศูนย์ ${esc(doc.dist)} ${Object.keys(doc.cust).length.toLocaleString()} ร้าน</p>
                ${G.stale() ? `<p class="mb-1.5 text-amber-700">⚠️ Geo Tree นำเข้าไว้นานกว่า 30 วัน — ควรดึงจาก DMS แล้วนำเข้าใหม่ก่อนส่งออก</p>` : ''}
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span class="text-gray-600">เริ่มผูกใหม่</span>
                    <input type="date" value="${iso(d.start)}" onchange="GeoTree.setStart(this.value)" class="border border-gray-200 rounded-lg px-1.5 py-0.5 text-[11px]">
                    <span class="text-gray-400">ปิดของเดิม ${esc(thd(d.end))}</span>
                </div>
                <p class="${nMove || nNew ? 'text-emerald-800' : 'text-gray-500'}">
                    ย้ายเซลล์ <b>${nMove.toLocaleString()}</b> ร้าน (END + START) · ร้านใหม่ <b>${nNew.toLocaleString()}</b> ร้าน (START อย่างเดียว)
                    · ไม่เปลี่ยน ${d.same.toLocaleString()} ร้าน
                    <br>${nMove + nNew ? `zip จะมี <b>${nMove ? 'GEO_TREE_END + ' : ''}GEO_TREE_START</b> เพิ่มจากไฟล์แผน` : 'zip มีไฟล์แผน 2 ไฟล์ (ไม่มีร้านที่ต้องผูกใหม่)'}</p>
                ${noNode.length ? `<p class="mt-1 text-red-700"><b>⚠️ สายที่ยังไม่มี Node ใน DMS:</b> ${noNode.map(r => esc(r) + ' (' + d.noNode[r].length + ' ร้าน)').join(', ')} — ต้องสร้าง Node ใน DMS ก่อนอัป START ของสายนี้</p>` : ''}
                ${d.dup.length ? `<p class="mt-1 text-amber-700">⚠️ ${d.dup.length} ร้านอยู่ในแผนมากกว่า 1 สาย (${d.dup.slice(0, 3).map(x => esc(x.c) + ' ' + esc(x.a) + '/' + esc(x.b)).join(', ')}${d.dup.length > 3 ? ' …' : ''}) — ใช้สายแรก</p>` : ''}
                ${preList(list)}`);
        },

        // ── สร้างไฟล์ ────────────────────────────────────────────────────
        rowsOf(d) {
            const end = [HEAD], start = [HEAD];
            d.moved.forEach(x => end.push([d.dist, d.tree, x.from, x.c, ymd(parseIso(x.fromStart)), ymd(d.end)]));
            d.moved.concat(d.fresh).forEach(x => start.push([d.dist, d.tree, x.node, x.c, ymd(d.start), '']));
            return { end, start };
        },
        /** ไฟล์ Geo Tree ที่จะใส่ใน zip [{name, rows}] — ว่างถ้าไม่ได้นำเข้า / ไม่มีร้านที่ต้องผูกใหม่ */
        files() {
            if (!G._doc) return [];
            const d = G.diff();
            if (!d || !(d.moved.length + d.fresh.length)) return [];
            const { end, start } = G.rowsOf(d);
            const out = [];
            if (end.length > 1) out.push({ name: 'GEO_TREE_END.csv', rows: end });
            out.push({ name: 'GEO_TREE_START.csv', rows: start });
            return out;
        },
        _parseDate: parseDate, _decode: decode, _encode: encodeUtf16,
    };

    window.GeoTree = G;
})();

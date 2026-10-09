/* =============================================================================
 *  month.js — ยกยอดแผนข้ามเดือน
 * =============================================================================
 *  3 เรื่องที่ปิดช่องโหว่ของปุ่ม "+ เพิ่มเดือน" เดิม
 *    1) ล้าง CY ของเดือนเก่าที่ copy ติดมา — DMS ออกเลขใหม่ทุกเดือนโดยนับต่อจากเลขสุดท้าย
 *       (ตรวจจากไฟล์จริง 303: ทุกเดือนได้เลขใหม่ 264 ตัว ไม่เคยใช้ซ้ำ)
 *    2) ซิงก์กับ Customer Master ล่าสุด — ร้านใหม่ / ร้านปิด / ร้านที่ศูนย์ย้ายเซลล์แล้ว
 *    3) เตือนเมื่อรอบเปลี่ยนความยาว — ร้านที่ค้างอยู่วันที่เกินรอบ และคู่ F2 ที่ต้องขยับ
 * ========================================================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const UNASSIGNED = 'รอจัดสาย';
    const norm = h => String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' ');

    const routeNames = () => Object.keys((State.db && State.db.routes) || {});

    const saveRoute = (rt) => App.planRoutesCol(App._currentPlanYM).doc(rt).set({
        stores: State.db.routes[rt],
        confirmedBy: firebase.firestore.FieldValue.delete(),
        confirmedAt: firebase.firestore.FieldValue.delete(),
    }, { merge: true });

    // ══ 1) ล้าง CY หลังสร้างเดือนใหม่ ═══════════════════════════════════════
    const stripCY = async () => {
        let n = 0, mx = 0;
        const touched = [];
        // V0.5: ครั้งที่แยกออกมาแก้เอง (และครั้งที่เลือกวิ่งของตลาดแบบครั้งเดียว) เป็นของเดือนเก่า — รวมกลับก่อน
        let runsReset = { n: 0, orphan: 0, touched: [] };
        try { if (typeof Runs !== 'undefined' && Runs.resetAll) runsReset = Runs.resetAll(); } catch (e) { console.warn('[Month] Runs.resetAll', e); }
        routeNames().forEach(rt => {
            let hit = false;
            (State.db.routes[rt] || []).forEach(s => {
                const vals = [s.cy, ...Object.values(s.cys || {})];
                vals.forEach(v => { const k = parseInt(String(v || '').replace(/\D/g, ''), 10); if (k > mx) mx = k; });
                if (s.cy || (s.cys && Object.keys(s.cys).length)) { s.cy = ''; s.cys = {}; n++; hit = true; }
            });
            if (hit) touched.push(rt);
        });
        runsReset.touched.forEach(rt => { if (!touched.includes(rt)) touched.push(rt); });
        if (!n) {
            if (touched.length) await Promise.all(touched.map(saveRoute));
            return { n: 0, mx: 0, runs: runsReset };
        }
        // เก็บเลขสูงสุดไว้ที่ศูนย์ เพื่อให้เดือนใหม่นับต่อ ไม่ใช่เริ่มหนึ่ง
        try {
            const cur = await App.dbRef.get();
            const old = (cur.exists && cur.data().maxCycleCode) || 0;
            if (mx > old) await App.dbRef.set({ maxCycleCode: mx }, { merge: true });
            State.db.maxCycleCode = Math.max(mx, old);
        } catch (e) {}
        await Promise.all(touched.map(saveRoute));
        return { n, mx, runs: runsReset };
    };

    // ══ 3) ตรวจผลกระทบเมื่อรอบเปลี่ยนความยาว ═══════════════════════════════
    const cycleCheck = () => {
        const out = { stranded: [], pairs: [], byRoute: {} };
        routeNames().filter(r => r !== UNASSIGNED).forEach(rt => {
            const k = (typeof Freq !== 'undefined' && Freq._cycleOf) ? Freq._cycleOf(rt) : (State.db.cycleDays || 24);
            const list = (State.db.routes[rt] || []).filter(s => !s.inactive);
            const st = [], pr = [];
            list.forEach(s => {
                const ds = (s.days || []);
                if (ds.some(d => dayNum(d) > k)) { st.push(s); return; }
                if (ds.length === 2 && typeof Freq !== 'undefined' && Freq.canonical
                    && !Freq.canonical(s) && !s.f2custom) pr.push(s);
            });
            if (st.length || pr.length) out.byRoute[rt] = { k, stranded: st.length, pairs: pr.length };
            out.stranded.push(...st.map(s => ({ rt, s, k })));
            out.pairs.push(...pr.map(s => ({ rt, s, k })));
        });
        return out;
    };

    /** ย้ายร้านที่ค้างวันเกินรอบ ให้วนกลับมาต้นรอบ + จับคู่ F2 ใหม่ */
    const fixCycle = async () => {
        const c = cycleCheck();
        if (!c.stranded.length && !c.pairs.length)
            return UI.showErrorToast('ℹ️ ไม่มีร้านที่ต้องแก้จากการเปลี่ยนความยาวรอบ');
        const msg = `รอบของสายเปลี่ยนความยาว ทำให้มีร้านที่ต้องขยับ\n\n`
            + (c.stranded.length ? `• ${c.stranded.length} ร้านอยู่วันที่เกินรอบ — จะวนกลับมาต้นรอบให้\n` : '')
            + (c.pairs.length ? `• ${c.pairs.length} ร้าน F2 คู่วันไม่ใช่ครึ่งรอบแล้ว — จะจับคู่ใหม่ให้\n` : '')
            + `\nร้านที่คุณกำหนดวันที่สองเองไว้ จะไม่ถูกแตะ`;
        const ok = await new Promise(r => UI.showConfirm(msg, () => r(true), () => r(false)));
        if (!ok) return;

        const touched = new Set();
        UI.showLoader('🔧 กำลังขยับร้านให้เข้ารอบใหม่...', '');
        try {
            c.stranded.forEach(({ rt, s, k }) => {
                s.days = [...new Set((s.days || []).map(d => {
                    const n = dayNum(d);
                    return 'Day ' + (n > k ? (((n - 1) % k) + 1) : n);
                }))].sort((a, b) => dayNum(a) - dayNum(b));
                s.seqs = {}; s.cys = {}; s.cy = '';
                s.freq = s.days.length > 1 ? 2 : 1;
                touched.add(rt);
            });
            c.pairs.forEach(({ rt, s }) => {
                const first = (s.days || []).slice().sort((a, b) => dayNum(a) - dayNum(b))[0];
                const pd = Freq._pairOf(first, rt);
                if (!pd) return;
                s.days = [first, pd].sort((a, b) => dayNum(a) - dayNum(b));
                s.seqs = {}; s.cys = {}; s.cy = '';
                touched.add(rt);
            });
            // ไล่ลำดับคิวใหม่ทุกสายที่โดนแตะ
            if (typeof SeqTool !== 'undefined' && SeqTool.compactAll) {
                const sub = {};
                touched.forEach(rt => { sub[rt] = State.db.routes[rt]; });
                try { SeqTool.compactAll(sub); } catch (e) {}
            }
            await Promise.all([...touched].map(saveRoute));
            UI.hideLoader();
            if (typeof EditHistory !== 'undefined') EditHistory.mark('ขยับร้านเข้ารอบใหม่');
            UI.render();
            UI.showSaveToast(`✅ ขยับแล้ว ${(c.stranded.length + c.pairs.length).toLocaleString()} ร้าน`);
        } catch (e) {
            UI.hideLoader();
            console.error('[Month.fixCycle]', e);
            UI.showErrorToast('❌ ขยับไม่สำเร็จ: ' + (e && e.message));
        }
    };

    // ══ 2) ซิงก์กับ Customer Master ล่าสุด ═════════════════════════════════
    const readMaster = (file) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        fr.onload = e => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
                const need = ['customer code', 'master latitude', 'master longitude'];
                for (const sn of wb.SheetNames) {
                    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', blankrows: false });
                    let hi = -1;
                    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
                        const set = (aoa[i] || []).map(norm);
                        if (need.every(m => set.includes(m))) { hi = i; break; }
                    }
                    if (hi === -1) continue;
                    const H = aoa[hi].map(norm);
                    const col = (n) => H.indexOf(norm(n));
                    const c = {
                        id: col('Customer Code'), name: col('Customer Name'), status: col('Customer Status'),
                        lat: col('Master Latitude'), lng: col('Master Longitude'), cat: col('Outlet Category'),
                        city: col('City'), dist: col('District'), state: col('State'), sales: col('Salesman Code'),
                        open: col('Open Account Date'), seg: col('Segmentation'), bb: col('Brand Bonus'),
                    };
                    // V0.9.0: วันเปิดบัญชี → 'YYYY-MM-DD' (Date / เลขวัน Excel / ข้อความ)
                    const ymd = (v) => {
                        if (v == null || v === '') return '';
                        let d = null;
                        if (v instanceof Date) d = new Date(v.getTime() + 12 * 3600 * 1000);
                        else if (typeof v === 'number' && v > 20000 && v < 80000) d = new Date(Math.round((v - 25569) * 86400000) + 12 * 3600 * 1000);
                        else { const m = /^(\d{4})[-\/](\d{2})[-\/](\d{2})/.exec(String(v)); if (m) return m[1] + '-' + m[2] + '-' + m[3]; }
                        if (!d || isNaN(d.getTime())) return '';
                        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
                    };
                    const map = new Map();
                    aoa.slice(hi + 1).forEach(r => {
                        const id = String(r[c.id] == null ? '' : r[c.id]).trim();
                        if (!id) return;
                        map.set(id, {
                            id, name: c.name >= 0 ? String(r[c.name] || '').trim() : '',
                            status: c.status >= 0 ? String(r[c.status] || '').trim() : 'Active',
                            lat: parseFloat(r[c.lat]), lng: parseFloat(r[c.lng]),
                            cat: c.cat >= 0 ? String(r[c.cat] || '').trim() : '',
                            city: c.city >= 0 ? String(r[c.city] || '').trim() : '',
                            dist: c.dist >= 0 ? String(r[c.dist] || '').trim() : '',
                            state: c.state >= 0 ? String(r[c.state] || '').trim() : '',
                            sales: c.sales >= 0 ? String(r[c.sales] || '').trim() : '',
                            open: c.open >= 0 ? ymd(r[c.open]) : '',
                            seg: c.seg >= 0 ? String(r[c.seg] || '').trim() : '',
                            bb: c.bb >= 0 ? String(r[c.bb] || '').trim() : '',
                        });
                    });
                    return resolve(map);
                }
                reject(new Error('ไม่พบชีทที่มีคอลัมน์ Customer Code / Master Latitude / Master Longitude'));
            } catch (err) { reject(err); }
        };
        fr.readAsArrayBuffer(file);
    });

    let SYNC = null;        // { master, add:[], close:[], move:[] }

    const analyze = (master) => {
        const inPlan = new Map();        // id -> {route, store}
        routeNames().forEach(rt => (State.db.routes[rt] || []).forEach(s => {
            if (!inPlan.has(String(s.id))) inPlan.set(String(s.id), { rt, s });
        }));
        const add = [], close = [], move = [];
        master.forEach(g => {
            const cur = inPlan.get(g.id);
            const active = !/inactive/i.test(g.status || '');
            const hasGeo = isFinite(g.lat) && isFinite(g.lng) && !(g.lat === 0 && g.lng === 0);
            if (!cur) { if (active && hasGeo) add.push(g); return; }
            if (!active && !cur.s.inactive) { close.push({ g, ...cur }); return; }
            if (active && g.sales && cur.rt !== UNASSIGNED && g.sales !== cur.rt
                && routeNames().includes(g.sales)) move.push({ g, ...cur });
        });
        return { master, add, close, move };
    };

    const openSync = () => {
        let el = $('msync-modal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'msync-modal';
            el.className = 'fixed inset-0 bg-black/60 z-[9998] flex items-center justify-center p-4';
            document.body.appendChild(el);
        }
        el.classList.remove('hidden');
        paintSync();
    };
    const closeSync = () => { const el = $('msync-modal'); if (el) el.classList.add('hidden'); SYNC = null; };

    const paintSync = () => {
        const el = $('msync-modal');
        if (!el) return;
        const d = SYNC;
        el.innerHTML = `
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto">
            <h3 class="font-black text-gray-800 mb-1">🔄 ซิงก์กับ Customer Master ล่าสุด</h3>
            <p class="text-[11px] text-gray-500 mb-3 leading-snug">
              แผนที่ยกยอดมาจากเดือนก่อนเป็นร้านชุดเดิม — ตรวจกับไฟล์ Master ล่าสุดว่ามีร้านเปิดใหม่
              ร้านปิดไป หรือร้านที่ศูนย์ย้ายเซลล์แล้วหรือไม่ (ไม่แก้อะไรจนกว่าจะกดยืนยัน)
            </p>
            ${!d ? `
              <label class="block border-2 border-dashed border-gray-300 rounded-xl p-5 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40 transition">
                <input type="file" accept=".xlsx,.xls" class="hidden" onchange="Month.pick(event)">
                <p class="text-sm font-bold text-gray-700">เลือกไฟล์ MST - Customer Master</p>
                <p class="text-[11px] text-gray-400 mt-0.5">ไฟล์เดียวพอ ไม่ต้องใช้ RoutePlan</p>
              </label>` : `
              <div class="space-y-2 mb-3">
                ${row('⊕ ร้านเปิดใหม่ (ยังไม่อยู่ในแผน)', d.add.length, 'จะเข้ากอง "รอจัดสาย" ให้จัดวันเอง',
                      'border-emerald-200 bg-emerald-50', 'text-emerald-600',
                      d.add.slice(0, 4).map(x => x.name || x.id))}
                ${row('⊗ ร้านที่ปิด/Inactive แล้ว', d.close.length, 'จะถูกพักออกจากแผน (ไม่ลบทิ้ง กู้คืนได้)',
                      'border-red-200 bg-red-50', 'text-red-600',
                      d.close.slice(0, 4).map(x => (x.g.name || x.g.id) + ' · ' + x.rt))}
                ${row('⇄ ร้านที่ Master ระบุเซลล์ใหม่', d.move.length, 'จะย้ายไปสายตาม Salesman Code และล้างวันเดิม',
                      'border-amber-200 bg-amber-50', 'text-amber-600',
                      d.move.slice(0, 4).map(x => (x.g.name || x.g.id) + ' · ' + x.rt + ' → ' + x.g.sales))}
              </div>
              <p class="text-[10.5px] text-gray-400 mb-3">
                ไฟล์นี้มี ${d.master.size.toLocaleString()} ร้าน · แผนปัจจุบันมี
                ${routeNames().reduce((t, rt) => t + (State.db.routes[rt] || []).filter(s => !s.inactive).length, 0).toLocaleString()} ร้าน</p>
              <div class="flex gap-2">
                <button onclick="Month.closeSync()" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ยกเลิก</button>
                <button onclick="Month.applySync()" ${(d.add.length + d.close.length + d.move.length) ? '' : 'disabled'}
                  class="flex-1 ${(d.add.length + d.close.length + d.move.length) ? 'bg-gray-900 hover:bg-black' : 'bg-gray-300 cursor-not-allowed'} text-white py-2 rounded-xl text-sm font-bold">
                  ยืนยันซิงก์</button>
              </div>`}
            ${!d ? `<button onclick="Month.closeSync()" class="w-full mt-3 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ปิด</button>` : ''}
          </div>`;
    };

    const row = (title, n, sub, boxCls, numCls, sample) => `
        <div class="border rounded-xl px-3 py-2 ${n ? boxCls : 'border-gray-200 bg-gray-50'}">
          <div class="flex items-center gap-2">
            <span class="text-[12px] font-bold text-gray-700 flex-1">${title}</span>
            <span class="text-[18px] font-black ${n ? numCls : 'text-gray-300'}">${n.toLocaleString()}</span>
          </div>
          <p class="text-[10px] text-gray-500 leading-snug">${sub}</p>
          ${n && sample.length ? `<p class="text-[9.5px] text-gray-400 truncate">${esc(sample.join(' · '))}${n > 4 ? ' …' : ''}</p>` : ''}
        </div>`;

    const applySync = async () => {
        const d = SYNC;
        if (!d) return;
        UI.showLoader('🔄 กำลังซิงก์...', '');
        try {
            const R = State.db.routes;
            if (!R[UNASSIGNED]) R[UNASSIGNED] = [];
            const touched = new Set();

            d.add.forEach(g => {
                R[UNASSIGNED].push({
                    id: g.id, code: g.id, name: g.name || ('Store_' + g.id),
                    lat: +g.lat, lng: +g.lng, freq: 1, days: [], seqs: {}, selected: false,
                    salesCode: g.sales || '', shopType: g.cat, subDistrict: g.city,
                    district: g.dist, province: g.state, marketName: '', cy: '', cys: {}, dayOriginal: '',
                    status: g.status || '', openDate: g.open || '', segment: g.seg || '', brandBonus: g.bb || '',
                });
                touched.add(UNASSIGNED);
            });
            d.close.forEach(({ rt, s }) => { s.inactive = true; touched.add(rt); });
            d.move.forEach(({ g, rt, s }) => {
                const to = g.sales;
                if (!Array.isArray(R[to])) return;
                R[rt] = (R[rt] || []).filter(x => String(x.id) !== String(s.id));
                s.days = []; s.seqs = {}; s.cys = {}; s.cy = ''; s.freq = 1; s.route = to; s.salesCode = to;
                R[to].push(s);
                touched.add(rt); touched.add(to);
            });

            // V0.9.0: อัปเดต Status / Shop type / วันเปิดบัญชี / Segmentation ของร้านเดิมให้ตรง Master ล่าสุด
            //   (รายงาน Executive ใช้ดูร้านที่เปลี่ยน Shop type และร้านในแผนที่ InActive)
            routeNames().forEach(rt => (R[rt] || []).forEach(s => {
                const g = d.master.get(String(s.id));
                if (!g) return;
                const nv = { status: g.status || '', shopType: g.cat || s.shopType, openDate: g.open || s.openDate || '',
                             segment: g.seg || s.segment || '', brandBonus: g.bb || s.brandBonus || '' };
                if (Object.keys(nv).some(k => (s[k] || '') !== (nv[k] || ''))) { Object.assign(s, nv); touched.add(rt); }
            }));
            let mA = 0, mI = 0;
            d.master.forEach(g => { /inactive/i.test(g.status || '') ? mI++ : mA++; });
            try { await App.dbRef.set({ masterInfo: { at: new Date().toISOString(), ym: App._currentPlanYM, mActive: mA, mInactive: mI } }, { merge: true }); } catch (e) {}
            await Promise.all([...touched].map(saveRoute));
            await App.planRef(App._currentPlanYM).set({
                routeList: Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true })),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            UI.hideLoader();
            const n = d.add.length + d.close.length + d.move.length;
            closeSync();
            if (typeof EditHistory !== 'undefined') EditHistory.mark('ซิงก์ Master');
            UI.render();
            UI.showSaveToast(`✅ ซิงก์แล้ว — ร้านใหม่ ${d.add.length} · พัก ${d.close.length} · ย้ายสาย ${d.move.length}`);
            return n;
        } catch (e) {
            UI.hideLoader();
            console.error('[Month.sync]', e);
            UI.showErrorToast('❌ ซิงก์ไม่สำเร็จ: ' + (e && e.message));
        }
    };

    window.Month = {
        stripCY, cycleCheck, fixCycle, openSync, closeSync, applySync,
        async pick(ev) {
            const f = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!f) return;
            UI.showLoader('📖 กำลังอ่าน Customer Master...', f.name);
            try {
                const m = await readMaster(f);
                SYNC = analyze(m);
                UI.hideLoader();
                paintSync();
            } catch (e) {
                UI.hideLoader();
                UI.showErrorToast('❌ ' + e.message);
            }
        },
        _analyze: analyze, _readMaster: readMaster,
    };

    // ══ ผูกกับปุ่มสร้างเดือนใหม่ ═══════════════════════════════════════════
    const hookCreate = () => {
        if (typeof App === 'undefined' || !App.createPlan || App.createPlan._monthWrapped) return false;
        const orig = App.createPlan;
        const fn = async function (ym, src) {
            const r = await orig.apply(this, arguments);
            // หลัง copy เสร็จ ระบบจะสลับมาที่เดือนใหม่แล้ว — ล้าง CY ที่ติดมาจากเดือนเก่า
            setTimeout(async () => {
                try {
                    if (App._currentPlanYM !== ym) return;
                    const out = await stripCY();
                    if (out.n) {
                        UI.showSaveToast(`ℹ️ ล้าง CY ของเดือนเก่าออก ${out.n.toLocaleString()} ร้าน — `
                            + `ระบบจะออกเลขใหม่ต่อจาก CY${String(out.mx).padStart(10, '0')} ตอนส่งออก`
                            + (out.runs && out.runs.n ? ` · รวมครั้งที่แยกไว้ของเดือนเก่ากลับ ${out.runs.n} ครั้ง` : ''));
                        UI.render();
                    } else if (out.runs && out.runs.n) { UI.render(); }
                } catch (e) { console.error('[Month.stripCY]', e); }
                // V0.6: เปิดหน้าตั้งปฏิทินของเดือนใหม่ให้ทันที — วันหยุดเฉพาะกิจไม่ติดมาจากเดือนเก่า ต้องใส่ใหม่ทุกเดือน
                try {
                    if (App._currentPlanYM === ym && window.CalUI && CalUI.openNewMonth) await CalUI.openNewMonth(ym);
                } catch (e) { console.warn('[Month.openCalendar]', e); }
            }, 1500);
            return r;
        };
        fn._monthWrapped = true;
        App.createPlan = fn;
        return true;
    };

    const boot = () => {
        if (typeof App === 'undefined' || typeof State === 'undefined') return setTimeout(boot, 400);
        [400, 1200, 3000, 8000].forEach(t => setTimeout(hookCreate, t));
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800));
})();

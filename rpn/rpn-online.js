/* =============================================================================
 *  rpn-online.js — ต่อ RPN V0 เข้ากับระบบออนไลน์ (ส่วนที่โหลดท้ายสุด)
 * =============================================================================
 *  แทนหน้าที่ของ local-extras.js / center.js ที่ tools/sync-rpn.mjs ตัดออก
 *    1) LocalExtras.distCode — dms-export.js ใช้หา Distributor Code ของสาย (ยกตรรกะเดิมมาทั้งชุด)
 *       LocalExtras.backup — route-builder.js เรียกสำรองก่อนเขียนทับทั้งศูนย์ ออนไลน์ไม่มีไฟล์สำรอง → ไม่ทำอะไร
 *    2) นำเข้าไฟล์ RoutePlan ที่ Distributor Code ไม่ตรงกับศูนย์ที่เปิดอยู่ → ถามก่อนเสมอ
 *       (โหมด local สลับศูนย์ให้เอง แต่ออนไลน์คือการเขียนทับข้อมูลจริงของอีกศูนย์ ห้ามเงียบ)
 *    3) เปิดอยู่ในแท็บของหน้า admin (?embed=1) → ซ่อนเมนูซ้ายของ RPN เพราะหน้า admin มีเมนูของตัวเองแล้ว
 *    4) จดว่า RPN เขียน Firestore ไปแล้ว (RPNBridge.dirty) — หน้า admin ใช้ตัดสินว่าต้องโหลดข้อมูลใหม่
 *       ตอนสลับไปแท็บอื่น (Dashboard / ภาพรวมทุกสาย / แบ่งเซลล์ อ่าน State ของหน้า admin เอง)
 * ========================================================================== */
(function () {
    'use strict';
    const UNASSIGNED = 'รอจัดสาย';
    const toast = (msg, err) => {
        if (typeof UI !== 'undefined' && UI.showSaveToast) return err ? UI.showErrorToast(msg) : UI.showSaveToast(msg);
        console.log(msg);
    };

    // ── 1) LocalExtras (เท่าที่โมดูลอื่นเรียกใช้) ─────────────────────────────
    const distCode = (route) => {
        const rd = (typeof State !== 'undefined' && State.db && State.db.routeDist) || {};
        if (route) return rd[route] || String(route).slice(0, 3);
        const vals = [...new Set(Object.values(rd).filter(Boolean))].sort();
        if (vals.length) return vals.join(' / ');
        const r = Object.keys((State.db && State.db.routes) || {}).find(x => x !== UNASSIGNED);
        return r ? r.slice(0, 3) : '';
    };
    window.LocalExtras = {
        distCode,
        backup: async () => {},
        uploadSellout: () => toast('อัปโหลดยอดขายได้ที่หน้า Dashboard ของระบบ'),
    };

    // ── 2) กันนำเข้าไฟล์ผิดศูนย์ ──────────────────────────────────────────
    const majority = (routeDist) => {
        const n = {};
        Object.values(routeDist || {}).forEach(v => { const s = String(v || '').trim(); if (s) n[s] = (n[s] || 0) + 1; });
        return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || '';
    };
    const wireImport = () => {
        if (typeof SysImport === 'undefined' || !SysImport.run || SysImport._onlineWired) return;
        SysImport._onlineWired = true;
        const orig = SysImport.run.bind(SysImport);
        SysImport.run = async function () {
            const d = SysImport._data;
            const code = majority(d && d.routeDist);
            const cur = window.CENTER_ID || '';
            if (code && cur && code !== cur) {
                const ok = await new Promise(r => {
                    const msg = `ไฟล์นี้เป็นของศูนย์ ${code}\nแต่ตอนนี้เปิดศูนย์ ${cur} อยู่\n\n` +
                        `กด "ยืนยัน" = นำเข้าทับข้อมูลของศูนย์ ${cur} (ข้อมูลจริงที่เซลใช้อยู่)\n` +
                        `ถ้าจะนำเข้าศูนย์ ${code} ให้กด "ยกเลิก" แล้วเลือกศูนย์ ${code} จากหน้าเลือกศูนย์ก่อน`;
                    if (typeof UI !== 'undefined' && UI.showConfirm) UI.showConfirm(msg, () => r(true), () => r(false));
                    else r(confirm(msg));
                });
                if (!ok) return;
            }
            return orig.apply(this, arguments);
        };
    };

    // ── 3) โหมดฝังในหน้า admin ────────────────────────────────────────────
    if (window.RPN_EMBED) {
        const css = document.createElement('style');
        css.textContent = '#sidebar,#sidebar-overlay,#global-hamburger{display:none!important}';
        document.head.appendChild(css);
    }

    // ── 4) จดการเขียน Firestore ───────────────────────────────────────────
    const bridge = window.RPNBridge = {
        dirty: false,
        go: (page) => { if (typeof Nav !== 'undefined') Nav.go(page); },
        reload: () => location.reload(),
    };
    const mark = () => {
        bridge.dirty = true;
        try { if (window.parent !== window) window.parent.postMessage({ type: 'rpn-write' }, location.origin); } catch (e) {}
    };

    // ── 5) rpnCal — วันที่เข้าเยี่ยมจริงของแต่ละ Day ส่งให้แอปเซล ──────────────
    // วันที่ของ RPN คำนวณซับซ้อน (F1/F2 รายตลาด · รอบสั้นวิ่งซ้ำ +14 วัน · ช่องที่แยก ✂️ · End date ·
    // วันหยุด) — แทนที่จะเขียนสูตรซ้ำในแอปเซล (แล้วเพี้ยนทุกครั้งที่ RPN เปลี่ยน) ให้ RPN คำนวณด้วย
    // Runs.datesOf ตัวเดียวกับที่ใช้ส่งออก DMS แล้วเก็บผลไว้ในเอกสารสาย:
    //   plans/{ym}/routes/{สาย}.rpnCal = { v, ym, sig, days: { 'Day 3': { d: ['2026-10-03', ...], m: 'ชื่อตลาด' } } }
    //   plans/{ym}.rpnCalIndex = { สาย: hash }   (ไว้รู้ว่าสายไหนต้องเขียนใหม่ ไม่ต้องอ่านทุกเอกสารสาย)
    // แอปเซลใช้ rpnCal เฉพาะเมื่อ sig ตรงกับร้านที่โหลดมา (ถ้ามีใครแก้วันของร้านโดยไม่ผ่าน RPN = ไม่ตรง
    // → แอปเซลถอยไปใช้ตัวคำนวณปฏิทินของตัวเองเหมือนเดิม) — hash/sig ต้องตรงกับ RpnCompat ใน sales-app.js
    const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
    const sigOf = (stores) => hash((stores || []).filter(s => s && !s.inactive)
        .map(s => String(s.id) + ':' + (s.days || []).slice().sort().join(','))
        .sort().join('|'));
    // ✅ NEW (2026-10-09): ลายนิ้วมือของปฏิทินที่ใช้คำนวณ (override ของสาย › ของเดือน) — แอปเซลเทียบกับปฏิทิน
    // ปัจจุบันของสายก่อนใช้ rpnCal · เคยค้าง: ตั้งปฏิทิน 402C02 พ.ย. ตอน RPN เปิดเดือนอื่นอยู่ (reconcile คำนวณ
    // ใหม่แค่เดือนที่เปิด) แอปเซลจึงยังใช้วันที่ชุดเก่าเพราะร้านไม่เปลี่ยน sig เลยตรง — ต้องตรงกับ RpnCompat.cfgSig
    const CFG_KEYS = ['mode', 'cycleDays', 'anchorType', 'startDay', 'startDayNum', 'anchorWeekday', 'anchorDate',
        'anchorDayNum', 'holidays', 'weeklyHolidays', 'holidayMode', 'mapping', 'weekdayMap'];
    const cfgSig = (c) => {
        c = c || {};
        return hash(JSON.stringify(CFG_KEYS.map(k => {
            let v = c[k];
            if (k === 'holidayMode' && !v) v = 'shift';
            if (Array.isArray(v)) v = v.map(Number).sort((a, b) => a - b);
            else if (v && typeof v === 'object') v = Object.keys(v).sort().map(x => [x, v[x]]);
            return v === undefined ? null : v;
        })));
    };
    const cfgOfRoute = (rt) => ((State.db.routeCal || {})[rt]) || State.db.calendarConfig || null;
    const ROUTE_RE = /^appData\/([^/]+)\/plans\/(\d{4}_\d{2})\/routes\/([^/]+)$/;
    const PLAN_RE  = /^appData\/([^/]+)\/plans\/(\d{4}_\d{2})$/;
    const curYM = () => (typeof App !== 'undefined' && App._currentPlanYM) || '';
    const calReady = () => typeof Runs !== 'undefined' && Runs.datesOf && typeof State !== 'undefined' && State.db && State.db.routes;

    /** rpnCal ของสาย — คำนวณจาก State (ข้อมูลที่ RPN ถืออยู่) · null ถ้าคำนวณไม่ได้ */
    const calPayload = (rt) => {
        const list = State.db.routes[rt];
        if (!Array.isArray(list) || rt === UNASSIGNED) return null;
        try { Runs._memoClear && Runs._memoClear(); } catch (e) {}
        const days = {};
        const set = new Set();
        list.forEach(s => { if (s && !s.inactive) (s.days || []).forEach(d => set.add(d)); });
        for (const d of set) {
            const ds = (Runs.datesOf(rt, d) || []).map(x => Runs._iso(x)).filter(Boolean);
            const m = (typeof RoadMaster !== 'undefined' && RoadMaster.marketName) ? (RoadMaster.marketName(rt, d, list) || '') : '';
            days[d] = { d: ds, m };
        }
        return { v: 1, ym: curYM(), sig: sigOf(list), cfg: cfgSig(cfgOfRoute(rt)), days, at: new Date().toISOString() };
    };
    const calHash = (cal) => cal ? hash(cal.sig + '|' + (cal.cfg || '') + JSON.stringify(cal.days)) : '';

    const cal = { written: {}, index: {}, indexYM: '', done: {}, need: false, busy: false, loading: 0, gen: 0 };

    // ✅ FIX (2026-10-08): App._loadPlan ของ RPN ล้าง State.db.routes แล้วโหลดเดือนใหม่ "ก่อน" ค่อยตั้ง
    // App._currentPlanYM — ช่วงนั้น curYM() ยังเป็นเดือนเก่าแต่ข้อมูลเป็นของเดือนใหม่ (และยังโหลดไม่ครบ)
    // เคยทำให้ reconcile เขียน rpnCal ว่างลงเดือนที่เพิ่งออกจากมา (402 พ.ย. 11 สาย — แอปเซลไม่ใช้เพราะ sig
    // ไม่ตรง) → ระหว่างโหลดห้ามคำนวณ rpnCal เลย และงานที่ค้างข้ามรอบโหลดให้ทิ้ง (เทียบ gen)
    const wrapLoad = () => {
        if (typeof App === 'undefined' || typeof App._loadPlan !== 'function') return setTimeout(wrapLoad, 300);
        if (App._loadPlan._rpnWrapped) return;
        const orig = App._loadPlan;
        App._loadPlan = async function () {
            cal.loading++; cal.gen++;
            try { return await orig.apply(this, arguments); }
            finally { cal.loading--; cal.gen++; cal.done = {}; }
        };
        App._loadPlan._rpnWrapped = true;
    };
    wrapLoad();
    const failed = (rt) => !!(State.db._failedRoutes && State.db._failedRoutes[rt]);

    const fs = firebase.firestore;
    const DocProto = fs.DocumentReference && fs.DocumentReference.prototype;
    const origSet = DocProto && DocProto.set;

    // ✅ FIX (2026-10-16): rpnCal ของสายถูกลบ/ไม่ได้แนบ → ต้องลบ entry ใน rpnCalIndex ของเดือนนั้นด้วย
    // ไม่งั้น reconcile เห็น index ตรงกับที่คำนวณได้แล้วข้ามไปตลอด เอกสารสายจึงไม่มี rpnCal ค้างถาวร
    // (เจอ TEST_DAYOFF ธ.ค. 402V05: index มี hash แต่เอกสารไม่มี rpnCal — แอปเซลถอยไปใช้ CalendarCtrl)
    const dropIndex = (ref, m) => {
        if (m[2] === cal.indexYM) { if (cal.index) delete cal.index[m[3]]; delete cal.written[m[3]]; cal.done[m[3]] = false; }
        try {
            const planRef = ref.parent && ref.parent.parent;
            if (planRef && origSet) origSet.call(planRef, { rpnCalIndex: { [m[3]]: fs.FieldValue.delete() } }, { merge: true }).catch(() => {});
        } catch (e) {}
    };
    const noCal = (ref, m, data, opts) => {
        dropIndex(ref, m);
        return (opts && (opts.merge || opts.mergeFields)) ? Object.assign({}, data, { rpnCal: fs.FieldValue.delete() }) : data;
    };
    // บันทึกสาย (เดือนที่เปิดอยู่) → แนบ rpnCal ไปในคำสั่งเขียนเดียวกัน
    const injectCal = (ref, data, opts) => {
        const m = ROUTE_RE.exec(ref.path || '');
        if (!m || !data || !Array.isArray(data.stores) || m[3] === UNASSIGNED || !calReady()) return data;
        if (m[2] !== curYM() || cal.loading) return noCal(ref, m, data, opts);   // เดือนอื่น / กำลังสลับเดือน — คำนวณไม่ได้ ล้างของเดิมกันค้าง
        let c = null;
        try { if (sigOf(data.stores) === sigOf(State.db.routes[m[3]])) c = calPayload(m[3]); } catch (e) { console.warn('[rpnCal]', e); }
        if (c) {
            cal.written[m[3]] = calHash(c);
            // ✅ FIX (2026-10-15): บันทึกสายของ RPN เป็น merge:true → rpnCal ถูกผสมลึก Day ที่ไม่มีร้านแล้วค้างพร้อมวันที่เก่า
            // (402C02 พ.ย. D5) → ใส่คำสั่งลบ Day ที่ไม่อยู่ในชุดใหม่ไปด้วย (เฉพาะคำสั่งที่เป็น merge)
            if (opts && opts.merge) {
                const days = Object.assign({}, c.days);
                for (let i = 1; i <= 62; i++) { const k = 'Day ' + i; if (!(k in days)) days[k] = fs.FieldValue.delete(); }
                return Object.assign({}, data, { rpnCal: Object.assign({}, c, { days }) });
            }
            return Object.assign({}, data, { rpnCal: c });
        }
        // ข้อมูลที่เขียนไม่ใช่ชุดใน State — คำนวณไม่ได้ ล้างของเดิมทิ้งกันแอปเซลใช้วันที่ค้าง
        return noCal(ref, m, data, opts);
    };
    // เขียนปฏิทิน (ของเดือน หรือ override รายสาย) → วันที่ของทุกสายในเดือนนั้นอาจเปลี่ยน
    const touchesCalendar = (ref, data) => {
        if (!data) return false;
        const path = ref.path || '';
        if (PLAN_RE.test(path)) return 'calendarConfig' in data;
        const m = ROUTE_RE.exec(path);
        return !!(m && 'calendarOverride' in data && !Array.isArray(data.stores));
    };

    // ✅ FIX (2026-10-16): ด่านสุดท้ายกันบันทึก "ร้านของสายอื่น" ทับสายนี้ (บัค 402V12 พ.ย. ถูกทับด้วยร้าน 402V01 — ดู §10)
    // ร้านที่จะเขียนลงสาย X เกือบทั้งหมด (≥ 90% ทั้งสองฝั่ง) เป็นชุดเดียวกับที่สาย Y อื่นถืออยู่ในหน่วยความจำ = ผิดแน่
    // (ย้ายร้านข้ามสาย / สร้างสายใหม่จากร้านสายอื่น ร้านจะออกจากสายต้นทางไปแล้ว ชุดจึงไม่ซ้ำกัน)
    const aliasGuard = (ref, data) => {
        try {
            const m = ROUTE_RE.exec((ref && ref.path) || '');
            if (!m || !data || !Array.isArray(data.stores) || m[3] === UNASSIGNED) return '';
            if (typeof State === 'undefined' || !State.db || !State.db.routes || m[2] !== curYM()) return '';
            const act = data.stores.filter(s => s && !s.inactive);
            const ids = new Set(act.map(s => String(s.id)));
            if (ids.size < 5) return '';
            // เจ้าของจริงของชุดร้าน = Salesman Code ที่มากสุด — ตอนสองสายชี้อาร์เรย์เดียวกัน (saveOpen เขียนทั้งคู่)
            // ต้องปล่อยสายเจ้าของผ่าน ไม่งั้นงานที่แก้ในสายนั้นหายไปด้วย
            const tally = {};
            act.forEach(s => { const c = s.salesCode || s.route; if (c) tally[c] = (tally[c] || 0) + 1; });
            const owner = (Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [])[0];
            if (!owner || owner === m[3]) return '';
            for (const [rt, list] of Object.entries(State.db.routes)) {
                if (rt !== owner || !Array.isArray(list)) continue;
                const other = list.filter(s => s && !s.inactive).map(s => String(s.id));
                if (!other.length) continue;
                const both = other.filter(id => ids.has(id)).length;
                if (both >= 0.9 * ids.size && both >= 0.9 * other.length) {
                    console.error(`[rpn-online] กันบันทึก: ร้านที่จะเขียนลง ${m[3]} เป็นชุดเดียวกับสาย ${rt} (${both} ร้าน)`);
                    reloadRoute(m[2], m[3]);
                    try { UI.showErrorToast(`⛔ ไม่บันทึก ${m[3]} — ร้านที่จะบันทึกเป็นของสาย ${rt} (หน้าจอสลับสายไม่ตรงกัน) โหลดสาย ${m[3]} จาก server ใหม่แล้ว`); } catch (e) {}
                    return `ไม่บันทึก ${m[3]}: ร้านเป็นชุดเดียวกับสาย ${rt}`;
                }
            }
        } catch (e) { console.warn('[aliasGuard]', e); }
        return '';
    };
    // App.saveDB ของ RPN ทำ State.db.routes[สายที่แก้] = State.stores ก่อนเขียน → หน่วยความจำของสายนั้นเสียไปแล้ว ต้องโหลดคืนจาก server
    const reloadRoute = (ym, rt) => {
        App.planRoutesCol(ym).doc(rt).get({ source: 'server' }).then(d => {
            if (curYM() !== ym) return;
            State.db.routes[rt] = d.exists ? (d.data().stores || []) : [];
            try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
            try { Runs._memoClear && Runs._memoClear(); UI.render(); } catch (e) {}
        }).catch(e => console.warn('[aliasGuard] reload', e));
    };

    // ✅ FIX (2026-10-16): RPN ใส่ค่า undefined ในร้าน (เช่น removed.js: wasPlan.fqs / wasPlan.runOf ของร้านที่ไม่มีค่านั้น)
    // local-firebase.js ของ RPN ยอม แต่ Firestore จริงปฏิเสธทั้งคำสั่ง ("Unsupported field value: undefined")
    // → ปุ่ม "เอาออกจากแผน" บันทึกไม่ได้เงียบ ๆ (เจอ 402 พ.ย. 109 ร้าน) · ตัด key ที่เป็น undefined ออกก่อนเขียน stores
    const stripUndef = (v) => {
        if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { if (v[i] === undefined) v[i] = null; else stripUndef(v[i]); } }
        else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
            Object.keys(v).forEach(k => { if (v[k] === undefined) delete v[k]; else stripUndef(v[k]); });
        }
        return v;
    };
    if (DocProto) {
        ['set', 'update', 'delete'].forEach(n => {
            const orig = DocProto[n];
            if (typeof orig !== 'function' || orig._rpnWrapped) return;
            DocProto[n] = function (data, opts) {
                if (n !== 'delete') { const why = aliasGuard(this, data); if (why) return Promise.reject(new Error(why)); }
                mark();
                if (n !== 'delete' && data && Array.isArray(data.stores) && ROUTE_RE.test(this.path || '')) stripUndef(data.stores);
                if (n === 'set') data = injectCal(this, data, opts);
                const p = (n === 'delete') ? orig.call(this) : orig.call(this, data, opts);
                if (n !== 'delete' && touchesCalendar(this, data)) {
                    Promise.resolve(p).then(() => { cal.need = true; cal.done = {}; }).catch(() => {});
                } else if (n === 'set' && ROUTE_RE.test(this.path || '')) cal.need = true;
                return p;
            };
            DocProto[n]._rpnWrapped = true;
        });
    }
    [[fs.CollectionReference && fs.CollectionReference.prototype, ['add']],
     [fs.WriteBatch && fs.WriteBatch.prototype, ['commit']]].forEach(([proto, names]) => {
        if (!proto) return;
        names.forEach(n => {
            const orig = proto[n];
            if (typeof orig !== 'function' || orig._rpnWrapped) return;
            proto[n] = function () { mark(); return orig.apply(this, arguments); };
            proto[n]._rpnWrapped = true;
        });
    });

    // reconcile: สายที่โหลดแล้วในเดือนที่เปิดอยู่ ถ้า rpnCal ที่คำนวณได้ไม่ตรงกับ index → เขียนใหม่ (เฉพาะสายนั้น)
    const reconcile = async () => {
        if (cal.busy || !calReady() || !origSet) return;
        const ym = curYM();
        if (!ym) return;
        if (window.PlanLock && PlanLock.isLocked(ym)) return;                          // เดือนที่ล็อก (../plan-lock.js) — ไม่เขียน
        const loader = document.getElementById('loader');
        if (loader && loader.style.display && loader.style.display !== 'none') return;   // กำลังโหลด/ประมวลผล — รอก่อน
        if (cal.loading) return;                                                        // กำลังสลับ/โหลดเดือน (ดู wrapLoad)
        const routes = Object.keys(State.db.routes).filter(r => r !== UNASSIGNED && Array.isArray(State.db.routes[r]) && !failed(r));
        if (cal.indexYM !== ym) { cal.indexYM = ym; cal.index = null; cal.done = {}; cal.written = {}; }
        const todo = routes.filter(r => cal.need || !cal.done[r]);
        if (!todo.length) return;
        cal.busy = true;
        const gen0 = cal.gen;
        const still = () => cal.gen === gen0 && !cal.loading && curYM() === ym;          // ข้อมูลยังเป็นของเดือนนี้ชุดเดิมอยู่ไหม
        try {
            const planRef = App.planRef(ym);
            if (!cal.index) {
                const snap = await planRef.get();
                const idx = Object.assign({}, (snap.exists && snap.data().rpnCalIndex) || {});
                // ✅ FIX (2026-10-16): index ที่ค้างจากก่อนมี dropIndex — สายที่เอกสารไม่มี rpnCal (หรือไม่มี cfg = รุ่นก่อน 2026-10-09)
                // ให้ถือว่ายังไม่ได้เขียน (อ่านเอกสารสายครั้งเดียวต่อการเปิดเดือน ไม่เขียนถ้าไม่จำเป็น)
                await Promise.all(routes.filter(r => idx[r]).map(async (r) => {
                    try {
                        const d = await App.planRoutesCol(ym).doc(r).get();
                        const rc = d.exists && d.data().rpnCal;
                        if (!rc || !rc.cfg || !rc.days) delete idx[r];
                    } catch (e) {}
                }));
                if (!still()) return;
                cal.index = idx;
            }
            cal.need = false;
            let changed = false;
            for (const rt of todo) {
                if (!still()) return;
                const c = calPayload(rt);
                cal.done[rt] = true;
                if (!c) continue;
                const h = calHash(c);
                if (cal.index[rt] === h) continue;
                if (cal.written[rt] !== h) {
                    // ✅ FIX (2026-10-09): เทียบกับเอกสารสายบน server ก่อนเขียนเสมอ — เคยเขียน rpnCal ของ 402V08 พ.ย.
                    // จากข้อมูลเดือน ก.ย. ที่ยังค้างใน State ระหว่างสลับเดือน (ตัวกันช่วงโหลดใน wrapLoad ไม่พอ เพราะ
                    // โมดูลอื่นของ RPN ยังแตะ State.db.routes ได้) — ไม่ตรง = ข้ามไว้ รอบหน้าค่อยลองใหม่
                    let srv = null;
                    try { srv = await App.planRoutesCol(ym).doc(rt).get({ source: 'server' }); } catch (e) { srv = null; }
                    if (!srv || !srv.exists || sigOf(srv.data().stores) !== c.sig || !still()) { cal.done[rt] = false; continue; }
                    // ✅ FIX (2026-10-15): mergeFields = แทนที่ rpnCal ทั้งก้อน (merge:true เดิมผสมลึก Day ที่หายไปแล้วจึงค้าง)
                    await origSet.call(App.planRoutesCol(ym).doc(rt), { rpnCal: c }, { mergeFields: ['rpnCal'] });
                }
                cal.written[rt] = h;
                cal.index[rt] = h;
                changed = true;
            }
            if (changed && still()) await origSet.call(planRef, { rpnCalIndex: cal.index }, { merge: true });
        } catch (e) {
            console.warn('[rpnCal] reconcile', e);
        } finally {
            cal.busy = false;
        }
    };
    bridge.reconcileCal = reconcile;

    // ── 6) แถบบอกว่าเดือนที่เปิดอยู่ถูกล็อก (../plan-lock.js) — แก้บนจอได้แต่บันทึกไม่ได้ จึงต้องบอกให้เห็นตลอด ──
    const lockBanner = () => {
        const ym = curYM();
        const on = !!(ym && window.PlanLock && PlanLock.isLocked(ym));
        let el = document.getElementById('rpn-lock-banner');
        if (!on) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'rpn-lock-banner';
            el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9998;background:#991b1b;color:#fff;' +
                'padding:6px 16px;border-radius:999px;font-size:12px;font-weight:800;box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none;';
            document.body.appendChild(el);
        }
        el.textContent = `🔒 แผนเดือน ${PlanLock.label(ym)} ล็อกอยู่ — ดูได้อย่างเดียว การแก้ไขจะไม่ถูกบันทึก`;
    };

    // ── 7) อนุมัติคำขอ "จัดลำดับตลาด" จากแอปเซล (moveRequests type 'reorder') ──────────────
    // หน้า admin (MoveRequestAdmin ใน ../index.html) เรียก RPNBridge.applyReorder(req) — ทำใน RPN เพื่อให้
    // rpnCal (วันที่ของแอปเซล) คำนวณใหม่ด้วย Runs ทันทีตอนบันทึก (injectCal) และตรงกับไฟล์ DMS ที่ส่งออกจาก RPN
    // ไม่ใช้ Reorder.apply ของ RPN ตรง ๆ เพราะ (1) หาครึ่งรอบจากความยาวรอบของศูนย์ ไม่ใช่ของสาย และ
    // (2) ไม่ย้าย fqs/fqRun/vd ตามตลาด — ตรรกะที่เหลือยึดตาม reorder.js: ร้าน + ลำดับคิว + ข้อมูลรายตลาด
    // ไปทั้งกลุ่ม · CY อยู่กับช่องวัน (กติกา AS&D) · req.map = { 'Day เดิม': 'Day ใหม่' } (sales-app.js คำนวณ
    // รวมครึ่งหลังของสาย F2 มาแล้ว) ต้องเป็นการสับตำแหน่งในชุดเดิม (ทุกช่องปลายทางมีเจ้าของเดียว)
    const dn = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    bridge.ready = () => {
        try {
            const loader = document.getElementById('loader');
            return !!(curYM() && calReady() && !cal.loading && (!loader || !loader.style.display || loader.style.display === 'none'));
        } catch (e) { return false; }
    };
    /** "402V01 D04 บ้านไร่" → เลขวันในชื่อเปลี่ยนตาม map (คงจำนวนหลักเดิม) — ไม่มีเลขวันในชื่อ = ไม่แตะ
     *  ✅ FIX (2026-10-09): แก้เฉพาะเมื่อเลขในชื่อ "ตรงกับช่องเดิมของร้านนั้น" — สายที่ชื่อเหลื่อมอยู่แล้ว
     *  (402V09 พ.ย.: ช่อง D20 ชื่อ "D21 หนองตากยา") เคยโดนแก้ผิดทั้งที่ร้านไม่ได้ย้าย */
    const renameDay = (name, map, oldDays) => String(name || '').replace(/D(\d{1,2})(?!\d)/, (all, n) => {
        const k = 'Day ' + parseInt(n, 10);
        if (!(oldDays || []).includes(k)) return all;
        const to = map[k];
        if (!to) return all;
        const v = String(dn(to));
        return 'D' + (n.length >= 2 ? v.padStart(2, '0') : v);
    });
    bridge.applyReorder = async (req) => {
        const route = req && req.route, ym = req && req.ym, map = (req && req.map) || {};
        if (!route || !ym) return { ok: false, msg: 'คำขอไม่ครบ (ไม่มีสายหรือเดือน)' };
        if (window.PlanLock && PlanLock.isLocked(ym)) return { ok: false, msg: PlanLock.message(ym) };
        const from = Object.keys(map), to = from.map(k => map[k]);
        if (!from.length) return { ok: false, msg: 'คำขอนี้ไม่ได้ย้ายตลาดไหนเลย' };
        if (new Set(to).size !== to.length || to.some(t => !from.includes(t))) return { ok: false, msg: 'ลำดับในคำขอไม่สมบูรณ์ (ช่องปลายทางซ้ำหรือหาย)' };

        if (curYM() !== ym) {
            if (!(State.db.planList || []).includes(ym)) return { ok: false, msg: 'ไม่มีแผนเดือน ' + ym + ' ในศูนย์นี้' };
            await App.switchPlan(ym);
        }
        for (let i = 0; i < 80 && !(Array.isArray(State.db.routes[route]) && bridge.ready()); i++) await sleep(250);
        const arr = State.db.routes[route];
        if (!Array.isArray(arr)) return { ok: false, msg: 'ไม่พบสาย ' + route + ' ในแผนเดือนนี้' };
        // ✅ FIX (2026-10-09): ห้ามสลับบนข้อมูลในหน่วยความจำ — หลังสลับเดือน RPN อาจถือข้อมูลจากแคช IndexedDB
        // ของเบราว์เซอร์ (เก่ากว่า server) อยู่หลายวินาที เคยทำให้ 402V09 พ.ย. ถูกสลับบนข้อมูลเก่าแล้วบันทึกทับ
        // ของใหม่บน server → อ่านเอกสารสายจาก server ตรง ๆ ก่อนเสมอ แล้วใช้ชุดนั้นแทนของในหน่วยความจำ
        let fresh;
        try { fresh = await App.planRoutesCol(ym).doc(route).get({ source: 'server' }); }
        catch (e) { return { ok: false, msg: 'อ่านแผนล่าสุดจาก server ไม่ได้ (' + (e.code || e.message) + ') — ตรวจอินเทอร์เน็ตแล้วลองใหม่' }; }
        if (!fresh.exists) return { ok: false, msg: 'ไม่พบสาย ' + route + ' บน server' };
        const serverStores = fresh.data().stores || [];
        if (sigOf(serverStores) !== sigOf(arr) || serverStores.length !== arr.length) {
            arr.length = 0;
            serverStores.forEach(s => arr.push(s));                     // แทนที่ในอาร์เรย์เดิม (State.stores อาจชี้อาร์เรย์นี้อยู่)
        }
        if (req.basisSig && req.basisSig !== sigOf(arr) && !req.force) return { ok: false, stale: true, msg: 'แผนสายนี้ถูกแก้หลังจากส่งคำขอ' };

        try { if (window.EditHistory) EditHistory.mark('จัดลำดับตลาดตามคำขอ ' + route); } catch (e) {}
        const cyBySlot = {};
        arr.forEach(s => (s.days || []).forEach(d => {
            const c = (s.cys && s.cys[d]) || ((s.days || []).length === 1 ? s.cy : '');
            if (c && !cyBySlot[d]) cyBySlot[d] = c;
        }));
        const remapKeys = (o) => {
            if (!o || typeof o !== 'object') return o;
            const n = {};
            Object.keys(o).forEach(k => { n[map[k] || k] = o[k]; });
            return n;
        };
        arr.forEach(s => {
            if (s.runOf) Object.values(s.runOf).forEach(r => { if (r && r.src && map[r.src]) r.src = map[r.src]; });
            // ร้าน "ออกจากแผน" จำวันเดิมไว้ใน wasPlan (removed.js ใช้ตอนดึงกลับ) — ต้องย้ายตามตลาดด้วย
            if (s.wasPlan && Array.isArray(s.wasPlan.days)) {
                s.wasPlan.days = s.wasPlan.days.map(d => map[d] || d);
                if (s.wasPlan.seqs) s.wasPlan.seqs = remapKeys(s.wasPlan.seqs);
            }
            const old = s.days || [];
            if (!old.length) return;
            s.days = old.map(d => map[d] || d).sort((a, b) => dn(a) - dn(b));
            ['seqs', 'fqs', 'fqRun', 'vd'].forEach(k => { if (s[k]) s[k] = remapKeys(s[k]); });
            const nc = {};
            s.days.forEach(t => { if (cyBySlot[t]) nc[t] = cyBySlot[t]; });
            if (s.cys || Object.keys(nc).length) { s.cys = nc; s.cy = nc[s.days[0]] || ''; }
            if (s.marketName) s.marketName = renameDay(s.marketName, map, old);
        });
        let ptsChanged = false;
        const pts = State.db.cyPoints && State.db.cyPoints[route];
        if (pts && from.some(k => pts[k])) { State.db.cyPoints[route] = remapKeys(pts); ptsChanged = true; }

        await App.planRoutesCol(ym).doc(route).set({
            stores: arr,
            confirmedBy: firebase.firestore.FieldValue.delete(),
            confirmedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true });
        if (ptsChanged) await App.dbRef.set({ cyPoints: State.db.cyPoints }, { merge: true });
        try { Runs.bump && Runs.bump(); } catch (e) {}
        try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
        try { UI.render(); } catch (e) {}
        return { ok: true, moved: from.length };
    };

    // ── 7b) เซลหยุด 1 วัน → แบ่งร้านของวันนั้นไปวันทำงานก่อนหน้า/ถัดไปของสายเดียวกัน (เพิ่ม 2026-10-13) ────
    // หน้า admin (DayOffUI ใน ../index.html) เรียก dayOffPreview → ให้ผู้ใช้ปรับกลุ่มบนแผนที่ → applyDayOff
    // ย้ายใน "แผนจริง" (days/seqs ของร้าน) ไม่ใช่ข้อยกเว้นแบบ HolidayException เดิมของ RPN (ใช้ได้แค่โหมด weekday
    // ทั้งศูนย์ และไม่ไปถึงไฟล์ DMS) → วันที่ของแอปเซล (rpnCal) และ DMS ตรงกันเสมอ
    // วันที่ของแต่ละ Day มาจาก Runs.datesOf ตัวเดียวกับ DMS · ข้อมูลสายอ่านจาก server ก่อนเสมอ (เหมือน applyReorder)
    const openRoute = async (route, ym) => {
        if (curYM() !== ym) {
            if (!(State.db.planList || []).includes(ym)) return { ok: false, msg: 'ไม่มีแผนเดือน ' + ym + ' ในศูนย์นี้' };
            await App.switchPlan(ym);
        }
        for (let i = 0; i < 80 && !(Array.isArray(State.db.routes[route]) && bridge.ready()); i++) await sleep(250);
        const arr = State.db.routes[route];
        if (!Array.isArray(arr)) return { ok: false, msg: 'ไม่พบสาย ' + route + ' ในแผนเดือนนี้' };
        let fresh;
        try { fresh = await App.planRoutesCol(ym).doc(route).get({ source: 'server' }); }
        catch (e) { return { ok: false, msg: 'อ่านแผนล่าสุดจาก server ไม่ได้ (' + (e.code || e.message) + ')' }; }
        if (!fresh.exists) return { ok: false, msg: 'ไม่พบสาย ' + route + ' บน server' };
        const serverStores = fresh.data().stores || [];
        if (sigOf(serverStores) !== sigOf(arr) || serverStores.length !== arr.length) {
            arr.length = 0;
            serverStores.forEach(s => arr.push(s));
        }
        // ✅ FIX (2026-10-13): ปฏิทินที่ Runs ใช้ต้องเป็นของ server ด้วย — State.db.routeCal (override รายสาย) และ
        // State.db.calendarConfig ในหน่วยความจำของ RPN ค้างได้ (เจอจริง: 402V05 พ.ย. ในเครื่องผู้ใช้คิดว่า 14 พ.ย. = D13
        // ตามปฏิทินศูนย์ ทั้งที่สายตั้งปฏิทินเฉพาะไว้ = D16) → วันที่เซลหยุดชี้ผิดตลาด ย้ายร้านผิดชุด
        try {
            const ov = fresh.data().calendarOverride || null;
            if (!State.db.routeCal) State.db.routeCal = {};
            if (ov) State.db.routeCal[route] = ov; else delete State.db.routeCal[route];
            const ps = await App.planRef(ym).get({ source: 'server' });
            if (ps.exists && ps.data().calendarConfig) State.db.calendarConfig = ps.data().calendarConfig;
        } catch (e) { return { ok: false, msg: 'อ่านปฏิทินล่าสุดจาก server ไม่ได้ (' + (e.code || e.message) + ')' }; }
        try { Runs._memoClear && Runs._memoClear(); Runs.bump && Runs.bump(); } catch (e) {}
        try { if (window.DayDate && DayDate._clear) DayDate._clear(); } catch (e) {}
        return { ok: true, arr, cal: fresh.data().calendarOverride ? 'route' : 'plan' };
    };
    /** { 'YYYY-MM-DD': ['Day 3', ...] } ของสายนี้ในเดือนที่เปิดอยู่ */
    const dateDays = (route, arr) => {
        const set = new Set();
        arr.forEach(s => { if (s && !s.inactive) (s.days || []).forEach(d => set.add(d)); });
        const out = {};
        set.forEach(d => (Runs.datesOf(route, d) || []).map(x => Runs._iso(x)).filter(Boolean)
            .forEach(iso => { (out[iso] = out[iso] || []).push(d); }));
        return out;
    };
    bridge.dayOffPreview = async ({ route, ym, date }) => {
        if (!route || !ym || !date) return { ok: false, msg: 'ข้อมูลไม่ครบ (สาย / เดือน / วันที่)' };
        if (window.PlanLock && PlanLock.isLocked(ym)) return { ok: false, msg: PlanLock.message(ym) };
        const o = await openRoute(route, ym);
        if (!o.ok) return o;
        const arr = o.arr;
        const map = dateDays(route, arr);
        const here = (map[date] || []).sort((a, b) => dn(a) - dn(b));
        if (!here.length) return { ok: false, msg: `วันที่ ${date} สาย ${route} ไม่มีตลาดวิ่งอยู่แล้ว (วันหยุดหรือไม่มีแผน)` };
        if (here.length > 1) return { ok: false, msg: `วันที่ ${date} มีหลายตลาดวิ่งพร้อมกัน (${here.join(', ')}) — แบ่งอัตโนมัติไม่ได้ ให้ย้ายใน RPN เอง` };
        const day = here[0];
        // ด่านกันอีกชั้น: ถ้าบน server มี rpnCal ที่ยังตรงกับร้าน + ปฏิทินปัจจุบัน (= ที่แอปเซลใช้อยู่) ต้องบอกวันเดียวกัน
        try {
            const sv = (await App.planRoutesCol(ym).doc(route).get({ source: 'server' })).data() || {};
            const rc = sv.rpnCal;
            if (rc && rc.days && rc.sig === sigOf(arr) && rc.cfg && rc.cfg === cfgSig(cfgOfRoute(route))) {
                const sales = Object.keys(rc.days).filter(k => (rc.days[k].d || []).includes(date));
                if (sales.length && !sales.includes(day))
                    return { ok: false, msg: `วันที่ ${date} คำนวณได้ ${day} แต่ปฏิทินเซลบอก ${sales.join(', ')} — ไม่ตรงกัน หยุดไว้ก่อน (ปิดแล้วเปิดหน้า admin ใหม่แล้วลองอีกครั้ง)` };
            }
        } catch (e) { /* อ่านไม่ได้ = ข้ามด่านนี้ ข้อมูลหลักอ่านจาก server แล้ว */ }
        const all = Object.keys(map).filter(k => k.slice(0, 7) === date.slice(0, 7)).sort();
        const others = all.filter(k => k !== date && !map[k].includes(day));
        const before = others.filter(k => k < date), after = others.filter(k => k > date);
        const pick = (k) => k ? { date: k, day: map[k].slice().sort((a, b) => dn(a) - dn(b))[0], also: map[k].length > 1 ? map[k] : null } : null;
        const prev = pick(before[before.length - 1]), next = pick(after[0]);
        if (!prev && !next) return { ok: false, msg: 'ไม่มีวันทำงานอื่นในเดือนนี้ให้ย้ายไป' };
        const dayDates = all.filter(k => map[k].includes(day));
        const seqOf = (s) => (s.seqs && s.seqs[day]) || 9999;
        const stores = arr.filter(s => s && !s.inactive && (s.days || []).includes(day)).sort((a, b) => seqOf(a) - seqOf(b))
            .map(s => ({ id: s.id, name: s.name || '', lat: s.lat, lng: s.lng, seq: seqOf(s), days: (s.days || []).slice() }));
        // จุดกลางของร้านในวันก่อนหน้า/ถัดไป — หน้า admin ใช้แบ่งร้านตามระยะทางเป็นค่าเริ่มต้น
        const centroid = (d) => {
            if (!d) return null;
            const pts = arr.filter(s => s && !s.inactive && (s.days || []).includes(d) && isFinite(s.lat) && isFinite(s.lng) && s.lat && s.lng);
            if (!pts.length) return null;
            return { lat: pts.reduce((a, s) => a + +s.lat, 0) / pts.length, lng: pts.reduce((a, s) => a + +s.lng, 0) / pts.length };
        };
        if (prev) prev.center = centroid(prev.day);
        if (next) next.center = centroid(next.day);
        // ร้านเดิมของวันก่อนหน้า/ถัดไป — แผนที่ฝั่ง admin วาดเป็นจุดจาง ๆ ให้เห็นว่าตลาดของวันนั้นอยู่ตรงไหน
        const ptsOf = (d) => !d ? [] : arr.filter(s => s && !s.inactive && (s.days || []).includes(d) && !(s.days || []).includes(day)
            && isFinite(s.lat) && isFinite(s.lng) && s.lat && s.lng).map(s => ({ name: s.name || '', lat: +s.lat, lng: +s.lng }));
        if (prev) prev.stores = ptsOf(prev.day);
        if (next) next.stores = ptsOf(next.day);
        return {
            ok: true, route, ym, date, day, dayDates, prev, next, stores, calSource: o.cal,
            market: (RoadMaster.marketName && RoadMaster.marketName(route, day, arr)) || '',
            prevMarket: prev && RoadMaster.marketName ? (RoadMaster.marketName(route, prev.day, arr) || '') : '',
            nextMarket: next && RoadMaster.marketName ? (RoadMaster.marketName(route, next.day, arr) || '') : '',
            basisSig: sigOf(arr),
        };
    };
    /** moves = { storeId: 'Day ปลายทาง' } — ร้านที่ไม่อยู่ใน moves คงอยู่ที่ day เดิม */
    bridge.applyDayOff = async ({ route, ym, day, date, moves, basisSig, label }) => {
        if (!route || !ym || !day || !moves) return { ok: false, msg: 'ข้อมูลไม่ครบ' };
        if (window.PlanLock && PlanLock.isLocked(ym)) return { ok: false, msg: PlanLock.message(ym) };
        const o = await openRoute(route, ym);
        if (!o.ok) return o;
        const arr = o.arr;
        if (basisSig && basisSig !== sigOf(arr)) return { ok: false, stale: true, msg: 'แผนสายนี้ถูกแก้ระหว่างที่ตรวจสอบ — กด "ตรวจสอบ" ใหม่' };
        try { if (window.EditHistory) EditHistory.mark(label || ('เซลหยุด แบ่งร้าน ' + route + ' ' + day)); } catch (e) {}
        const PER_DAY = ['cys', 'fqs', 'fqRun', 'vd', 'runOf'];
        const moving = new Set(Object.keys(moves).map(String));
        const peerOf = (t) => arr.find(p => p && !p.inactive && !moving.has(String(p.id)) && (p.days || [])[0] === t)
            || arr.find(p => p && !p.inactive && !moving.has(String(p.id)) && (p.days || []).includes(t));
        const nextSeq = {};
        const seqStart = (t) => {
            if (!(t in nextSeq)) nextSeq[t] = arr.reduce((m, p) => Math.max(m, (p.days || []).includes(t) && p.seqs && p.seqs[t] ? p.seqs[t] : 0), 0);
            return ++nextSeq[t];
        };
        const seqOf = (s) => (s.seqs && s.seqs[day]) || 9999;
        let moved = 0; const skipped = [];
        const log = [];      // จำค่าเดิมไว้คืนทีหลัง (restoreDayOff / ตอนคัดลอกแผนไปเดือนใหม่)
        arr.filter(s => s && moving.has(String(s.id)) && (s.days || []).includes(day)).sort((a, b) => seqOf(a) - seqOf(b)).forEach(s => {
            const t = moves[s.id] || moves[String(s.id)];
            if (!t || t === day) return;
            if ((s.days || []).includes(t)) { skipped.push(s.name || s.id); return; }   // อยู่วันปลายทางอยู่แล้ว (F2) — ไม่ย้าย
            const pd = {};
            PER_DAY.forEach(k => { if (s[k] && typeof s[k] === 'object' && s[k][day] !== undefined) pd[k] = s[k][day]; });
            log.push({ id: s.id, to: t, seq: (s.seqs && s.seqs[day]) || null, mk: s.marketName || '', pd });
            const peer = peerOf(t);
            s.days = s.days.filter(d => d !== day).concat(t).sort((a, b) => dn(a) - dn(b));
            if (!s.seqs) s.seqs = {};
            delete s.seqs[day];
            s.seqs[t] = seqStart(t);
            PER_DAY.forEach(k => {
                if (!s[k] || typeof s[k] !== 'object') return;
                delete s[k][day];
                if (peer && peer[k] && peer[k][t] !== undefined) s[k][t] = JSON.parse(JSON.stringify(peer[k][t]));
            });
            if (s.cys && typeof s.cys === 'object') s.cy = s.cys[s.days[0]] || s.cy || '';
            if (s.days.length === 1 && peer && peer.marketName) s.marketName = peer.marketName;
            moved++;
        });
        if (!moved) return { ok: false, msg: 'ไม่มีร้านที่ย้ายได้' + (skipped.length ? ` (${skipped.length} ร้านอยู่วันปลายทางอยู่แล้ว)` : '') };
        let by = '';
        // Auth (../auth.js) ประกาศเป็น const ระดับบนสุด — ไม่อยู่บน window
        try { const ss = (typeof Auth !== 'undefined' && Auth.getSession) ? Auth.getSession() : null; by = (ss && (ss.displayName || ss.username)) || ''; } catch (e) {}
        // plans/{ym}/routes/{สาย}.dayOffs = [{ rid, date, day, at, by, moves:[{ id, to, seq, mk, pd }] }]
        const rec = JSON.parse(JSON.stringify({ rid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: date || '', day, at: new Date().toISOString(), by, moves: log }));
        await App.planRoutesCol(ym).doc(route).set({
            stores: arr,
            dayOffs: firebase.firestore.FieldValue.arrayUnion(rec),
            confirmedBy: firebase.firestore.FieldValue.delete(),
            confirmedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true });
        afterSave();
        return { ok: true, moved, skipped, rid: rec.rid };
    };
    const afterSave = () => {
        try { Runs.bump && Runs.bump(); } catch (e) {}
        try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
        try { UI.render(); } catch (e) {}
    };

    /** คืนร้านของรายการเซลหยุด rec กลับวันเดิม (แก้ arr ในที่) — ร้านที่ถูกแก้ต่อหลังแบ่ง (ไม่อยู่วันปลายทางแล้ว
     *  หรือกลับไปอยู่วันเดิมเองแล้ว / ออกจากแผน / หายจากสาย) ข้ามไว้ ไม่เดา */
    const restoreRec = (arr, rec) => {
        const PER_DAY = ['cys', 'fqs', 'fqRun', 'vd', 'runOf'];
        let restored = 0; const skipped = [];
        (rec.moves || []).forEach(m => {
            const s = arr.find(x => x && String(x.id) === String(m.id));
            if (!s || s.inactive || !(s.days || []).includes(m.to) || (s.days || []).includes(rec.day)) { skipped.push((s && s.name) || m.id); return; }
            s.days = s.days.filter(d => d !== m.to).concat(rec.day).sort((a, b) => dn(a) - dn(b));
            if (!s.seqs) s.seqs = {};
            delete s.seqs[m.to];
            if (m.seq != null) s.seqs[rec.day] = m.seq;
            PER_DAY.forEach(k => {
                if (s[k] && typeof s[k] === 'object') delete s[k][m.to];
                if (m.pd && m.pd[k] !== undefined) { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; s[k][rec.day] = m.pd[k]; }
            });
            if (s.cys && typeof s.cys === 'object') s.cy = s.cys[s.days[0]] || s.cy || '';
            if (m.mk && s.days.length === 1) s.marketName = m.mk;
            restored++;
        });
        return { restored, skipped };
    };
    /** คืนรายการเซลหยุด rid ของสายนี้ในเดือนนั้น แล้วลบรายการออกจาก dayOffs */
    bridge.restoreDayOff = async ({ route, ym, rid }) => {
        if (!route || !ym || !rid) return { ok: false, msg: 'ข้อมูลไม่ครบ' };
        if (window.PlanLock && PlanLock.isLocked(ym)) return { ok: false, msg: PlanLock.message(ym) };
        const o = await openRoute(route, ym);
        if (!o.ok) return o;
        const doc = (await App.planRoutesCol(ym).doc(route).get({ source: 'server' })).data() || {};
        const list = Array.isArray(doc.dayOffs) ? doc.dayOffs : [];
        const rec = list.find(r => r && r.rid === rid);
        if (!rec) return { ok: false, msg: 'ไม่พบรายการนี้ (อาจถูกคืนไปแล้ว)' };
        try { if (window.EditHistory) EditHistory.mark('คืนร้านเซลหยุด ' + route + ' ' + rec.date); } catch (e) {}
        const r = restoreRec(o.arr, rec);
        await App.planRoutesCol(ym).doc(route).set({
            stores: o.arr,
            dayOffs: list.filter(x => x && x.rid !== rid),
            confirmedBy: firebase.firestore.FieldValue.delete(),
            confirmedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true });
        afterSave();
        return { ok: true, restored: r.restored, skipped: r.skipped };
    };

    // คัดลอกแผนไปเดือนใหม่ (App.createPlan ของ RPN คัดลอก stores ทั้งก้อน) → การแบ่งร้านเพราะเซลหยุดของเดือนต้นทาง
    // จะติดไปทั้งเดือนใหม่ (วันนั้นว่าง ร้านค้างอยู่วันข้างเคียง) → ถามแล้วคืนร้านกลับวันเดิมในเดือนใหม่ให้
    // (รายการ dayOffs ไม่ถูกคัดลอกไป — createPlan เขียนแค่ stores; เดือนต้นทางไม่ถูกแตะ)
    const wireCopy = () => {
        if (typeof App === 'undefined' || typeof App.createPlan !== 'function') return false;
        if (App.createPlan._dayOffWrapped) return true;
        const orig = App.createPlan;
        const fn = async function (ym, srcOverride) {
            const src = srcOverride || App._currentPlanYM;
            let existed = true;
            try { existed = (await App.planRef(ym).get({ source: 'server' })).exists; } catch (e) {}
            const recs = [];
            if (!existed && src) {
                try {
                    const snap = await App.planRoutesCol(src).get();
                    snap.forEach(d => (d.data().dayOffs || []).forEach(rec => { if (rec && rec.moves && rec.moves.length) recs.push({ route: d.id, rec }); }));
                } catch (e) { console.warn('[dayOff] อ่านรายการเซลหยุดของเดือนต้นทางไม่ได้', e); }
            }
            const r = await orig.apply(this, arguments);
            if (existed || !recs.length) return r;
            try { if (!(await App.planRef(ym).get({ source: 'server' })).exists) return r; } catch (e) { return r; }
            const lines = recs.map(x => `• ${x.route} ${x.rec.date} (${x.rec.day} · ${x.rec.moves.length} ร้าน)`).join('\n');
            if (!confirm(`แผนต้นทาง (${src}) มีการแบ่งร้านเพราะเซลหยุด ${recs.length} รายการ:\n${lines}\n\n` +
                `คืนร้านกลับวันเดิมในแผนใหม่ (${ym}) เลยไหม?\nแนะนำ "ตกลง" — เซลหยุดเป็นเรื่องของเดือนนั้นเท่านั้น (แผนเดือนต้นทางไม่เปลี่ยน)`)) return r;
            let restored = 0; const skipped = [];
            const byRoute = {};
            recs.forEach(x => { (byRoute[x.route] = byRoute[x.route] || []).push(x.rec); });
            for (const route of Object.keys(byRoute)) {
                const o = await openRoute(route, ym);
                if (!o.ok) { skipped.push(route + ': ' + o.msg); continue; }
                byRoute[route].sort((a, b) => String(b.at).localeCompare(String(a.at))).forEach(rec => {   // ล่าสุดก่อน (ย้อนลำดับที่ทำ)
                    const res = restoreRec(o.arr, rec);
                    restored += res.restored;
                    res.skipped.forEach(n => skipped.push(route + ': ' + n));
                });
                await App.planRoutesCol(ym).doc(route).set({ stores: o.arr }, { merge: true });
            }
            afterSave();
            try { UI.showSaveToast(`↩️ คืนร้านเซลหยุดในแผนใหม่แล้ว ${restored} ร้าน` + (skipped.length ? ` · ข้าม ${skipped.length}` : '')); } catch (e) {}
            if (skipped.length) console.warn('[dayOff] ข้ามตอนคืนร้านในแผนใหม่:', skipped);
            return r;
        };
        fn._dayOffWrapped = true;
        App.createPlan = fn;
        return true;
    };

    // ── 8) ชื่อตลาด "สูตรเดิม" ของระบบเรา (FileManager._autoFillMarketNames ใน ../file-manager.js) ─────
    //   {สาย} D{NN} {2 ตำบลที่มีร้านมากสุด} {อำเภอที่มากสุด} {จังหวัดที่มากสุด} — ตัดคำนำหน้า ต./ตำบล ฯลฯ ก่อน
    //   อำเภอซ้ำกับตำบลก็ใส่ซ้ำ (ตั้งใจ ตามสูตรเดิม) · ใช้รหัสสายแทน salesCode ของร้าน (ร้านที่ RPN ย้ายสาย
    //   ยังมี salesCode เดิมจนกว่าจะส่งออก DMS)
    // เพิ่มเป็นตัวเลือกใน 2 ที่ของ market-suggest.js (ไม่แก้ไฟล์ของ RPN): ป้าย 💡 ในหน้าต่างรายวัน และ
    // ตาราง "ทั้งสาย" (ตัวเลือก "สูตรเดิม" ทุกแถว + ปุ่มเลือกสูตรเดิมทุกวันในครั้งเดียว) — ผู้ใช้เลือกเอง
    const legacyName = (route, day) => {
        const list = ((State.db.routes || {})[route] || []).filter(s => !s.inactive && (s.days || []).includes(day));
        if (!list.length) return '';
        const strip = (v) => String(v || '').replace(/^(ตำบล|ต\.|อำเภอ|อ\.|จังหวัด|จ\.)\s*/, '').trim();
        const rank = (f) => {
            const c = {}, order = [];
            list.forEach(s => { const v = strip(s[f]); if (!v) return; if (!(v in c)) { c[v] = 0; order.push(v); } c[v]++; });
            return order.sort((a, b) => c[b] - c[a]);
        };
        const digits = String(day).replace(/[^0-9]/g, '');
        return [route, digits ? 'D' + digits.padStart(2, '0') : '', ...rank('subDistrict').slice(0, 2),
            rank('district')[0] || '', rank('province')[0] || ''].filter(Boolean).join(' ');
    };
    const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const LEGACY = '__legacy__';
    const wireNaming = () => {
        if (typeof RoadMaster === 'undefined' || !RoadMaster.dayPanelHTML || !RoadMaster._mkWrapped
            || typeof MarketSuggest === 'undefined') return false;
        if (RoadMaster._legacyWrapped) return true;
        RoadMaster._legacyWrapped = true;
        // ป้ายในหน้าต่างรายวัน
        const origPanel = RoadMaster.dayPanelHTML;
        RoadMaster.dayPanelHTML = function (day) {
            const html = origPanel.apply(this, arguments);
            const route = State.localActiveRoute;
            const at = '<span class="text-gray-400 shrink-0">💡 แนะนำ</span>';
            if (!html || !route || !html.includes(at)) return html;
            const name = legacyName(route, day);
            if (!name) return html;
            const chip = `<button onclick="MarketSuggest.use('${escH(day)}', this.dataset.t)" data-t="${escH(name)}"
                title="สูตรเดิมของระบบ: สาย D วัน + 2 ตำบลที่มีร้านมากสุด + อำเภอ + จังหวัด — กดเพื่อใช้ชื่อนี้"
                class="px-1.5 py-0.5 rounded-md border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-[10.5px] text-indigo-900 font-bold">
                ${escH(name)} <span class="font-normal text-indigo-500">สูตรเดิม</span></button>`;
            return html.replace(at, at + chip);
        };
        // ตาราง "ทั้งสาย"
        const origBulk = MarketSuggest.bulk;
        MarketSuggest.bulk = async function () {
            const r = await origBulk.apply(this, arguments);
            const route = State.localActiveRoute;
            const days = (typeof RoadMaster !== 'undefined') ? RoadMaster.daysOf(route) : [];
            days.forEach((day, i) => {
                const sel = document.getElementById('mkb-s' + i);
                const name = legacyName(route, day);
                if (!sel || !name) return;
                sel.insertAdjacentHTML('beforeend', `<option value="${LEGACY}" data-t="${escH(name)}">${escH(name)} (สูตรเดิม)</option>`);
            });
            const bar = document.querySelector('#mk-bulk button[onclick="MarketSuggest.bulkAll(true)"]');
            if (bar) bar.insertAdjacentHTML('beforebegin', `<button onclick="MarketSuggest.bulkLegacyAll()"
                title="เลือกชื่อแบบสูตรเดิมให้ทุกวัน แล้วติ๊กไว้ — กด 'ใช้ชื่อที่ติ๊ก' เพื่อบันทึก"
                class="px-2 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-[11px] font-bold text-indigo-700">📛 สูตรเดิมทุกวัน</button>`);
            return r;
        };
        MarketSuggest.bulkLegacyAll = () => {
            document.querySelectorAll('#mk-bulk select[id^="mkb-s"]').forEach(sel => {
                if (!sel.querySelector(`option[value="${LEGACY}"]`)) return;
                sel.value = LEGACY;
                const c = document.getElementById('mkb-c' + sel.id.slice(5));
                if (c) c.checked = true;
            });
        };
        // ใช้ชื่อที่ติ๊ก — แถวที่เลือก "สูตรเดิม" บันทึกเอง แล้วเอาติ๊กออกก่อนส่งให้ของเดิมทำแถวที่เหลือ
        const origApply = MarketSuggest.bulkApply;
        MarketSuggest.bulkApply = function () {
            const route = State.localActiveRoute;
            const days = (typeof RoadMaster !== 'undefined') ? RoadMaster.daysOf(route) : [];
            let n = 0;
            days.forEach((day, i) => {
                const sel = document.getElementById('mkb-s' + i), c = document.getElementById('mkb-c' + i);
                if (!sel || !c || !c.checked || sel.value !== LEGACY) return;
                const t = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.t;
                if (t) { if (!n) { try { if (window.EditHistory) EditHistory.mark('ตั้งชื่อตลาดสูตรเดิม'); } catch (e) {} } RoadMaster.setMarketName(route, day, t); n++; }
                c.checked = false;
            });
            const rest = document.querySelectorAll('#mk-bulk input[id^="mkb-c"]:checked').length;
            if (rest) return origApply.apply(this, arguments);
            MarketSuggest.closeBulk();
            try { RoadMaster.render(); } catch (e) {}
            try { UI.render(); } catch (e) {}
            try { if (n && UI.showSaveToast) UI.showSaveToast(`✏️ ตั้งชื่อตลาดสูตรเดิม ${n} วัน`); } catch (e) {}
        };
        return true;
    };
    bridge.legacyName = legacyName;

    // ── 9) หน้าตั้งค่าปฏิทิน (CalendarAdmin + CalUI ของ cal-ui.js) — แก้ 2 จุดที่ทำให้ "ตั้งแล้วเปิดใหม่ไม่ตรง" ──
    // (2026-10-10, 402C02 พ.ย.) ① ติ๊กสายในโหมด "เลือกเฉพาะสาย" ไม่โหลดปฏิทินของสายนั้น (มีแต่ปุ่ม "แก้ไข" ที่โหลด)
    // ฟอร์มยังเป็นค่าของศูนย์ → เห็นเหมือนค่าที่ตั้งไว้หาย และถ้ากดบันทึกก็เขียนค่าศูนย์ทับของสาย
    // ② เลื่อนเดือนด้วยลูกศร ป้าย "✓ ตั้งค่าแล้ว" ยังเป็นของเดือนที่เปิด modal (loadOverrides ของ cal-ui โหลดตอน open เท่านั้น)
    const wireCal = () => {
        if (typeof CalendarAdmin === 'undefined' || !window.CalUI || !CalendarAdmin._calUiWired) return false;
        if (CalendarAdmin._rpnOnlineWired) return true;
        CalendarAdmin._rpnOnlineWired = true;
        const S = CalUI._state;
        const reloadOverrides = async () => {
            const ym = CalendarAdmin._ym;
            if (!ym) return;
            const names = (State.db.routeList || []).filter(r => r && r !== UNASSIGNED);
            const out = {};
            await Promise.all(names.map(async (n) => {
                try { const d = await App.planRoutesCol(ym).doc(n).get(); if (d.exists && d.data().calendarOverride) out[n] = true; } catch (e) {}
            }));
            if (CalendarAdmin._ym !== ym) return;                      // เลื่อนเดือนต่อไปแล้ว
            S.overrides = out;
            CalUI.refresh();
        };
        const origShift = CalendarAdmin.shiftMonth;
        CalendarAdmin.shiftMonth = async function () {
            const r = await origShift.apply(this, arguments);
            await reloadOverrides();
            return r;
        };
        // สายตัวแทน (ตัวแรกที่ติ๊ก) เปลี่ยน → โหลดปฏิทินของสายนั้น (ไม่มี override = ค่าศูนย์เป็นจุดเริ่ม เหมือนปุ่ม "แก้ไข")
        ['tick', 'tickAll'].forEach((name) => {
            const o = CalUI[name];
            if (typeof o !== 'function') return;
            CalUI[name] = function () {
                const before = CalendarAdmin._targetRoute;
                const r = o.apply(this, arguments);
                if (CalendarAdmin._targetRoute !== before) {
                    Promise.resolve(CalendarAdmin._loadConfig()).then(() => CalUI.refresh()).catch(e => console.warn('[CalUI]', e));
                }
                return r;
            };
        });
        return true;
    };

    // ── 10) กัน "บันทึกร้านของสายอื่นทับสายที่กำลังแก้" (บัคของ RPN — 402V12 พ.ย. ถูกทับด้วยร้าน 402V01, 2026-10-16) ──
    // ต้นเหตุ: multi-route.js — เมื่อตัวกรองเหลือสายเดียว MultiRoute.rebuild() ตั้ง State.stores = ร้านของสายในตัวกรอง
    // (open[0]) แต่ไม่เปลี่ยน State.localActiveRoute · App.saveDB (admin-data.js) ทำ State.db.routes[localActiveRoute] = State.stores
    // แล้วเขียนลงเอกสารของ localActiveRoute → เช่น เปิด V01+V12 เลือกแก้ V12 แล้วติ๊ก V12 ออก → แก้อะไรก็ตาม → V12 = ร้าน V01
    // ① ตัวกรองเหลือสายเดียว → ตั้งสายที่กำลังแก้เป็นสายนั้น (หน้าจอกับสายที่แก้ตรงกันเสมอ)
    // ② App.saveDB ตอนสองค่านี้ไม่ตรงกัน → บันทึกลงสายที่แสดงอยู่ (ร้านที่แก้อยู่ในอาร์เรย์ของสายนั้น) แทนการทับสายอื่น
    // ③ ด่านสุดท้ายที่ตัวเขียน Firestore (aliasGuard ใน §5)
    const shownRoute = () => {
        try {
            if (typeof MultiRoute === 'undefined' || MultiRoute.multi) return '';
            const o = MultiRoute.open || [];
            return o.length === 1 ? o[0] : '';
        } catch (e) { return ''; }
    };
    const wireActive = () => {
        if (typeof MultiRoute === 'undefined' || typeof App === 'undefined' || !App.saveDB || !App.switchRoute) return false;
        if (MultiRoute._rpnActiveWired) return true;
        MultiRoute._rpnActiveWired = true;
        const syncActive = () => {
            const r = shownRoute();
            if (r && r !== State.localActiveRoute && Array.isArray(State.db.routes[r])) {
                console.warn(`[rpn-online] ตัวกรองเหลือ ${r} แต่สายที่กำลังแก้เป็น ${State.localActiveRoute} → สลับสายที่แก้เป็น ${r}`);
                App.switchRoute(r);
            }
        };
        ['setOpen', 'toggleRoute', 'openOne', 'openAll', 'openSuggested'].forEach(n => {
            const o = MultiRoute[n];
            if (typeof o !== 'function') return;
            MultiRoute[n] = function () { const r = o.apply(this, arguments); try { syncActive(); } catch (e) {} return r; };
        });
        const origSave = App.saveDB;
        App.saveDB = function () {
            const r = shownRoute(), act = State.localActiveRoute;
            if (r && act && r !== act && State.stores === State.db.routes[r]) {
                console.warn(`[rpn-online] saveDB: หน้าจอแสดง ${r} แต่สายที่แก้เป็น ${act} → บันทึกลง ${r}`);
                State.localActiveRoute = r;
                try { localStorage.setItem(`last_route_${App._currentPlanYM}`, r); } catch (e) {}
            }
            return origSave.apply(this, arguments);
        };
        return true;
    };

    document.addEventListener('DOMContentLoaded', () => {
        // multi-route.js ครอบ App.saveDB / switchRoute หลัง DOMContentLoaded + setTimeout — รอให้ครอบเสร็จก่อน แล้วค่อยครอบชั้นนอก
        const tryActive = (k) => {
            const ready = typeof App !== 'undefined' && App.switchRoute && (String(App.switchRoute).includes('open.push') || k >= 20);
            if (!(ready && wireActive()) && k < 40) setTimeout(() => tryActive(k + 1), 500);
        };
        setTimeout(() => tryActive(0), 1500);
        const tryCopy = (k) => { if (!wireCopy() && k < 40) setTimeout(() => tryCopy(k + 1), 500); };
        setTimeout(() => tryCopy(0), 1500);
        const tryCal = (k) => { if (!wireCal() && k < 40) setTimeout(() => tryCal(k + 1), 500); };
        setTimeout(() => tryCal(0), 1500);
        [0, 400, 1600, 3000].forEach(t => setTimeout(wireImport, t));
        setInterval(reconcile, 4000);
        setInterval(lockBanner, 1000);
        const tryNaming = (k) => { if (!wireNaming() && k < 40) setTimeout(() => tryNaming(k + 1), 500); };
        setTimeout(() => tryNaming(0), 1500);
    });
})();

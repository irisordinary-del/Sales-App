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
        return { v: 1, ym: curYM(), sig: sigOf(list), days, at: new Date().toISOString() };
    };
    const calHash = (cal) => cal ? hash(cal.sig + JSON.stringify(cal.days)) : '';

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

    // บันทึกสาย (เดือนที่เปิดอยู่) → แนบ rpnCal ไปในคำสั่งเขียนเดียวกัน
    const injectCal = (ref, data, opts) => {
        const m = ROUTE_RE.exec(ref.path || '');
        if (!m || !data || !Array.isArray(data.stores) || m[3] === UNASSIGNED || !calReady()) return data;
        if (m[2] !== curYM() || cal.loading) {                           // เดือนอื่น / กำลังสลับเดือน — คำนวณไม่ได้ ล้างของเดิมกันค้าง
            return (opts && (opts.merge || opts.mergeFields)) ? Object.assign({}, data, { rpnCal: fs.FieldValue.delete() }) : data;
        }
        let c = null;
        try { if (sigOf(data.stores) === sigOf(State.db.routes[m[3]])) c = calPayload(m[3]); } catch (e) { console.warn('[rpnCal]', e); }
        if (c) { cal.written[m[3]] = calHash(c); return Object.assign({}, data, { rpnCal: c }); }
        // ข้อมูลที่เขียนไม่ใช่ชุดใน State — คำนวณไม่ได้ ล้างของเดิมทิ้งกันแอปเซลใช้วันที่ค้าง
        if (opts && (opts.merge || opts.mergeFields)) return Object.assign({}, data, { rpnCal: fs.FieldValue.delete() });
        return data;
    };
    // เขียนปฏิทิน (ของเดือน หรือ override รายสาย) → วันที่ของทุกสายในเดือนนั้นอาจเปลี่ยน
    const touchesCalendar = (ref, data) => {
        if (!data) return false;
        const path = ref.path || '';
        if (PLAN_RE.test(path)) return 'calendarConfig' in data;
        const m = ROUTE_RE.exec(path);
        return !!(m && 'calendarOverride' in data && !Array.isArray(data.stores));
    };

    if (DocProto) {
        ['set', 'update', 'delete'].forEach(n => {
            const orig = DocProto[n];
            if (typeof orig !== 'function' || orig._rpnWrapped) return;
            DocProto[n] = function (data, opts) {
                mark();
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
                cal.index = (snap.exists && snap.data().rpnCalIndex) || {};
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
                if (cal.written[rt] !== h) await origSet.call(App.planRoutesCol(ym).doc(rt), { rpnCal: c }, { merge: true });
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
    /** "402V01 D04 บ้านไร่" → เลขวันในชื่อเปลี่ยนตาม map (คงจำนวนหลักเดิม) — ไม่มีเลขวันในชื่อ = ไม่แตะ */
    const renameDay = (name, map) => String(name || '').replace(/D(\d{1,2})(?!\d)/, (all, n) => {
        const to = map['Day ' + parseInt(n, 10)];
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
            if (s.marketName) s.marketName = renameDay(s.marketName, map);
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

    document.addEventListener('DOMContentLoaded', () => {
        [0, 400, 1600, 3000].forEach(t => setTimeout(wireImport, t));
        setInterval(reconcile, 4000);
        setInterval(lockBanner, 1000);
        const tryNaming = (k) => { if (!wireNaming() && k < 40) setTimeout(() => tryNaming(k + 1), 500); };
        setTimeout(() => tryNaming(0), 1500);
    });
})();

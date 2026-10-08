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

    const cal = { written: {}, index: {}, indexYM: '', done: {}, need: false, busy: false };

    const fs = firebase.firestore;
    const DocProto = fs.DocumentReference && fs.DocumentReference.prototype;
    const origSet = DocProto && DocProto.set;

    // บันทึกสาย (เดือนที่เปิดอยู่) → แนบ rpnCal ไปในคำสั่งเขียนเดียวกัน
    const injectCal = (ref, data, opts) => {
        const m = ROUTE_RE.exec(ref.path || '');
        if (!m || !data || !Array.isArray(data.stores) || m[3] === UNASSIGNED || !calReady()) return data;
        if (m[2] !== curYM()) return data;                               // เดือนอื่น (เช่น คัดลอกตอนสร้างเดือน) — ให้ reconcile ทำตอนเปิดเดือนนั้น
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
        const loader = document.getElementById('loader');
        if (loader && loader.style.display && loader.style.display !== 'none') return;   // กำลังโหลด/ประมวลผล — รอก่อน
        const routes = Object.keys(State.db.routes).filter(r => r !== UNASSIGNED && Array.isArray(State.db.routes[r]));
        if (cal.indexYM !== ym) { cal.indexYM = ym; cal.index = null; cal.done = {}; cal.written = {}; }
        const todo = routes.filter(r => cal.need || !cal.done[r]);
        if (!todo.length) return;
        cal.busy = true;
        try {
            const planRef = App.planRef(ym);
            if (!cal.index) {
                const snap = await planRef.get();
                cal.index = (snap.exists && snap.data().rpnCalIndex) || {};
            }
            cal.need = false;
            let changed = false;
            for (const rt of todo) {
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
            if (changed && curYM() === ym) await origSet.call(planRef, { rpnCalIndex: cal.index }, { merge: true });
        } catch (e) {
            console.warn('[rpnCal] reconcile', e);
        } finally {
            cal.busy = false;
        }
    };
    bridge.reconcileCal = reconcile;

    document.addEventListener('DOMContentLoaded', () => {
        [0, 400, 1600, 3000].forEach(t => setTimeout(wireImport, t));
        setInterval(reconcile, 4000);
    });
})();

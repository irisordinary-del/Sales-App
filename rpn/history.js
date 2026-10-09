/* =============================================================================
 *  history.js — ย้อนกลับ / ทำซ้ำ (Undo / Redo)
 * =============================================================================
 *  วิธีทำงาน: ไม่ได้ดักทีละปุ่ม (ปุ่มบางอันแก้ข้อมูลทีหลังตอนกดยืนยัน จับไม่ทัน)
 *  แต่เก็บ "ภาพก่อนหน้า" ของสายที่โหลดอยู่ไว้ แล้วหลังวาดจอทุกครั้งเทียบลายนิ้วมือ
 *  ของแต่ละสาย ถ้าต่างจากเดิม = มีการแก้เกิดขึ้นจริง → เก็บเป็น 1 ขั้นย้อนกลับ
 *  เก็บเฉพาะสายที่เปลี่ยน ไม่ได้เก็บทั้งศูนย์ทุกครั้ง
 * ========================================================================== */
(function () {
    'use strict';

    const MAX_STEPS = 20;
    const MAX_BYTES = 40 * 1024 * 1024;      // เพดานหน่วยความจำรวมของประวัติ

    let base = new Map();      // route -> { fp, data(JSON string) }
    let stack = [];            // [{ label, ym, before:{r:json}, after:{r:json}, bytes }]
    let idx = -1;              // ตำแหน่งปัจจุบันใน stack (ชี้ขั้นที่ "ทำไปแล้ว")
    let label = '';            // ป้ายของ action ล่าสุดที่ผู้ใช้กด
    let quiet = false;         // ระหว่าง undo/redo ห้ามบันทึกเป็นขั้นใหม่
    let timer = null;
    let ready = false;

    const clone = (v) => JSON.parse(JSON.stringify(v));

    /** ลายนิ้วมือของสาย — เปลี่ยนเมื่อร้าน/วัน/ลำดับ/สถานะพัก เปลี่ยน */
    const fpOf = (arr) => {
        let s = arr.length + '#';
        for (const x of arr) {
            s += x.id + '|' + ((x.days || []).join(',')) + '|';
            const q = x.seqs;
            if (q) for (const k in q) s += k + q[k] + ',';
            s += (x.inactive ? 'I' : '') + (x.cy || '') + '|' + (x.marketName || '') + ';';   // V0.9.0: ชื่อตลาดย้อนกลับได้
        }
        return s;
    };

    const loaded = () => {
        const R = (typeof State !== 'undefined' && State.db && State.db.routes) || {};
        return Object.keys(R).filter(r => Array.isArray(R[r]));
    };

    const rebase = () => {
        const R = State.db.routes || {};
        base = new Map();
        loaded().forEach(r => base.set(r, { fp: fpOf(R[r]), data: JSON.stringify(R[r]) }));
    };

    /** สายที่ต่างจากภาพก่อนหน้า */
    const diff = () => {
        const R = State.db.routes || {};
        const out = [];
        loaded().forEach(r => {
            const f = fpOf(R[r]);
            const b = base.get(r);
            if (!b || b.fp !== f) out.push(r);
        });
        // สายที่หายไปทั้งสาย (โดนลบ) ก็นับว่าเปลี่ยน
        for (const r of base.keys()) if (!Array.isArray(R[r])) out.push(r);
        return out;
    };

    const trim = () => {
        let bytes = stack.reduce((a, e) => a + e.bytes, 0);
        while (stack.length > MAX_STEPS || (bytes > MAX_BYTES && stack.length > 1)) {
            const e = stack.shift(); bytes -= e.bytes; idx--;
        }
        if (idx < -1) idx = -1;
    };

    const capture = () => {
        if (quiet || !ready) return;
        const R = State.db.routes || {};
        const changed = diff();
        if (!changed.length) return;
        const before = {}, after = {};
        let bytes = 0;
        changed.forEach(r => {
            const b = base.get(r);
            before[r] = b ? b.data : '[]';
            after[r] = Array.isArray(R[r]) ? JSON.stringify(R[r]) : '[]';
            bytes += before[r].length + after[r].length;
        });
        stack = stack.slice(0, idx + 1);              // แก้ใหม่หลัง undo = ตัดกิ่ง redo ทิ้ง
        stack.push({ label: label || 'แก้ไขแผน', ym: App._currentPlanYM, before, after, bytes,
                     cycleBefore: base.get('__cycle__'), cycleAfter: State.db.cycleDays });
        idx = stack.length - 1;
        label = '';
        trim();
        rebase();
        paint();
    };

    const apply = async (obj, ym) => {
        const R = State.db.routes || {};
        const names = Object.keys(obj);
        names.forEach(r => { R[r] = JSON.parse(obj[r]); });
        // เขียนลงที่เก็บข้อมูลเฉพาะสายที่ย้อน ไม่ยุ่งสายอื่น
        try {
            const routeList = Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            await Promise.all([
                ...names.map(r => App.planRoutesCol(ym).doc(r).set({
                    stores: R[r],
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                }, { merge: true })),
                App.planRef(ym).set({ routeList, cycleDays: State.db.cycleDays || 24,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
            ]);
        } catch (e) { console.warn('[History] บันทึกไม่สำเร็จ', e); }
        if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild();
        else State.stores = R[State.localActiveRoute] || State.stores;
        if (typeof MapCtrl !== 'undefined' && MapCtrl.clearAll) MapCtrl.clearAll();
        UI.render();
    };

    const run = async (dir) => {
        const e = dir < 0 ? stack[idx] : stack[idx + 1];
        if (!e) return;
        if (e.ym && App._currentPlanYM && e.ym !== App._currentPlanYM) {
            return UI.showErrorToast('⚠️ ขั้นนี้เป็นของเดือนอื่น สลับเดือนกลับไปก่อนถึงจะย้อนได้');
        }
        quiet = true;
        try {
            await apply(dir < 0 ? e.before : e.after, e.ym || App._currentPlanYM);
            idx += dir < 0 ? -1 : 1;
            UI.showSaveToast((dir < 0 ? '↶ ย้อนกลับ: ' : '↷ ทำซ้ำ: ') + e.label);
        } finally {
            rebase();
            quiet = false;
            paint();
        }
    };

    // ── ปุ่มบนแถบเครื่องมือ ─────────────────────────────────────────────
    const paint = () => {
        const u = document.getElementById('hist-undo'), r = document.getElementById('hist-redo');
        if (!u || !r) return;
        const canU = idx >= 0, canR = idx < stack.length - 1;
        const cls = (on) => 'px-2 py-1.5 rounded-lg text-xs font-bold transition ' +
            (on ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed');
        u.className = cls(canU); r.className = cls(canR);
        u.disabled = !canU; r.disabled = !canR;
        u.title = canU ? 'ย้อนกลับ: ' + stack[idx].label + '  (Ctrl+Z)' : 'ยังไม่มีอะไรให้ย้อนกลับ';
        r.title = canR ? 'ทำซ้ำ: ' + stack[idx + 1].label + '  (Ctrl+Y)' : 'ไม่มีขั้นให้ทำซ้ำ';
    };

    const mount = () => {
        if (document.getElementById('hist-undo')) return;
        const sel = document.getElementById('routeSelector');
        const box = sel && sel.closest('.flex.items-center.bg-gray-900');
        if (!box || !box.parentNode) return;
        const wrap = document.createElement('div');
        wrap.className = 'flex items-center gap-1';
        wrap.innerHTML = '<button id="hist-undo" onclick="EditHistory.undo()">↶</button>'
                       + '<button id="hist-redo" onclick="EditHistory.redo()">↷</button>';
        box.parentNode.insertBefore(wrap, box.nextSibling);
        paint();
    };

    window.EditHistory = {
        undo: () => run(-1),
        redo: () => run(+1),
        /** ตั้งชื่อขั้นที่กำลังจะเกิด — เรียกก่อนสั่งแก้ข้อมูล */
        mark: (t) => { label = t; },
        get depth() { return { undo: idx + 1, redo: stack.length - 1 - idx }; },
        reset: () => { stack = []; idx = -1; rebase(); paint(); },
        _stack: () => stack,
    };

    // ── ตั้งชื่อขั้นให้อ่านรู้เรื่อง ────────────────────────────────────
    const NAMES = [
        ['StoreMgr', 'changeDay', 'เปลี่ยนวันเข้าเยี่ยม'],
        ['StoreMgr', 'assignSelected', 'จัดร้านที่เลือกลงวัน'],
        ['StoreMgr', 'permanentDelete', 'ลบร้านถาวร'],
        ['StoreMgr', 'reactivateStore', 'ดึงร้านที่พักกลับ'],
        ['MultiRoute', 'moveStore', 'ย้ายร้านข้ามสาย'],
        ['MultiRoute', 'unplanStore', 'เอาร้านออกจากแผน'],
        ['SalesSuggest', 'moveAll', 'ย้ายร้านตาม Salesman Code'],
        ['App', 'clearAllAssignments', 'ล้างวันทั้งสาย'],
        ['App', 'clearStores', 'ลบร้านทั้งหมดในสาย'],
        ['App', 'addRoute', 'สร้างสายใหม่'],
        ['App', 'deleteRoute', 'ลบสาย'],
        ['AI', 'run', 'AI จัดวัน'],
        ['SeqTool', 'orderDay', 'จัดลำดับคิวในวัน'],
        ['SeqTool', 'orderAll', 'จัดลำดับคิวทุกวัน'],
        ['SeqTool', 'move', 'สลับลำดับคิว'],
        ['RBUI', 'accept', 'สร้างสายใหม่ทั้งศูนย์'],
    ];
    const tagAll = () => {
        NAMES.forEach(([o, m, t]) => {
            const owner = window[o];
            if (!owner || typeof owner[m] !== 'function' || owner[m]._histTagged) return;
            const orig = owner[m];
            const fn = function () { label = t; return orig.apply(this, arguments); };
            fn._histTagged = true;
            owner[m] = fn;
        });
    };

    const boot = () => {
        if (typeof State === 'undefined' || typeof UI === 'undefined' || !UI.render
            || typeof App === 'undefined') return setTimeout(boot, 400);
        if (UI._histWired) return;
        UI._histWired = true;

        const orig = UI.render;
        UI.render = function () {
            const r = orig.apply(this, arguments);
            clearTimeout(timer);
            timer = setTimeout(() => { try { capture(); } catch (e) { console.warn('[History]', e); } }, 350);
            return r;
        };

        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
            const k = (e.key || '').toLowerCase();
            if (k === 'z' && !e.shiftKey) { e.preventDefault(); window.EditHistory.undo(); }
            else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); window.EditHistory.redo(); }
        });

        // เริ่มจับหลังข้อมูลเดือนแรกโหลดเสร็จ ไม่งั้นการโหลดเองจะกลายเป็นขั้นย้อนกลับ
        const settle = () => {
            rebase(); ready = true; mount(); paint();
        };
        setTimeout(settle, 4000);
        [1000, 2500, 6000, 12000].forEach(t => setTimeout(() => { mount(); tagAll(); }, t));

        // สลับเดือน = คนละชุดข้อมูล เริ่มประวัติใหม่
        // แต่ห้ามล้างเมื่อเป็นการโหลดเดือนเดิมซ้ำ — ทุกครั้งที่บันทึกแผน ตัวรับฟังข้อมูล
        // จะสั่งโหลดเดือนเดิมใหม่อีกรอบ ถ้าล้างตรงนี้ ขั้นที่เพิ่งทำจะหายทันที
        if (App._loadPlan) {
            let lastYM = null;
            const lp = App._loadPlan;
            App._loadPlan = async function (ym) {
                const r = await lp.apply(this, arguments);
                const cur = ym || App._currentPlanYM;
                if (lastYM && cur && cur !== lastYM) {
                    stack = []; idx = -1; ready = false;
                    setTimeout(() => { rebase(); ready = true; paint(); }, 2500);
                }
                lastYM = cur;
                return r;
            };
        }
    };

    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 600));
})();

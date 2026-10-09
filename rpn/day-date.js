/* =============================================================================
 *  day-date.js — ป้ายวันบอกวันที่จริงในปฏิทิน
 * =============================================================================
 *  เดิมทุกที่โชว์แค่ "วันที่ 18" ซึ่งเป็นเลขรอบ ไม่ใช่วันที่จริง คนอ่านต้องแปลเอง
 *  ตอนนี้โชว์ D18 (22 ต.ค.) โดยคำนวณจากปฏิทินตัวเดียวกับที่ใช้ตอน Export
 *    • ตั้งปฏิทินแล้ว  → วันที่จริง สีเข้ม
 *    • ยังไม่ได้ตั้ง   → ใช้เดือนของแผนนั้น D18 = วันที่ 18 (สีจาง บอกว่ายังไม่ได้ตั้ง)
 * ========================================================================== */
(function () {
    'use strict';

    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;

    let cache = new Map();      // route|day -> {txt, exact}
    let stamp = '';             // ลายนิ้วมือของ (เดือน + ปฏิทิน) ไว้ล้าง cache

    const ymParts = () => {
        const ym = (typeof App !== 'undefined' && App._currentPlanYM) || '';
        const [y, m] = String(ym).split('_').map(Number);
        if (!y || !m) return null;
        return { y, m0: m - 1 };
    };

    /** ปฏิทินที่มีผลกับสายนี้ — override ของสายมาก่อน ถ้าไม่มีใช้ของศูนย์ */
    const cfgOf = (route) => {
        const ov = (typeof State !== 'undefined' && State.db && State.db.routeCal) || {};
        return (route && ov[route]) || (State.db && State.db.calendarConfig) || null;
    };

    const sig = () => {
        const p = ymParts();
        const c = (State.db && State.db.calendarConfig) || null;
        return (p ? p.y + '_' + p.m0 : '-') + '|' + (c ? JSON.stringify(c) : 'none')
             + '|' + JSON.stringify((State.db && State.db.routeCal) || {})
             + '|' + ((typeof Runs !== 'undefined' && Runs.version) ? Runs.version() : 0)
             + '|' + ((typeof DmsExport !== 'undefined' && DmsExport._endDate) || '');
    };

    /** { txt:'22 ต.ค.', exact:true } — exact=false คือเดาจากเลขวันเพราะยังไม่ตั้งปฏิทิน */
    const dateOf = (route, dayLabel) => {
        const p = ymParts();
        if (!p) return null;
        const s = sig();
        if (s !== stamp) { stamp = s; cache = new Map(); }
        const key = (route || '') + '|' + dayLabel;
        if (cache.has(key)) return cache.get(key);

        let out = null;
        const cfg = cfgOf(route);
        // V0.5: วันที่ทุกครั้งที่ตลาดนี้วิ่งจริง (ความถี่ของตลาด · รอบสั้น +14 วัน · ครั้งที่แยกไป) จาก runs.js
        if (cfg && typeof Runs !== 'undefined' && Runs.datesOf) {
            try {
                const ds = Runs.datesOf(route, dayLabel);
                if (ds.length) out = { txt: Runs._dlist(ds), exact: true, dates: ds };
            } catch (e) {}
        }
        if (!out && cfg && typeof FileManager !== 'undefined' && FileManager._resolveCalendarDate) {
            try {
                const d = FileManager._resolveCalendarDate(cfg, dayLabel, p.y, p.m0);
                if (d) out = { txt: d.getDate() + ' ' + TH[d.getMonth()], exact: true };
            } catch (e) {}
        }
        if (!out) {
            // ยังไม่ตั้งปฏิทิน → เดาแบบเดียวกับตอน Export: Day N = วันที่ N ของเดือนนั้น
            const n = dayNum(dayLabel);
            const last = new Date(p.y, p.m0 + 1, 0).getDate();
            if (n >= 1 && n <= last) out = { txt: n + ' ' + TH[p.m0], exact: false };
        }
        cache.set(key, out);
        return out;
    };

    /** ข้อความพร้อมใช้ เช่น "วันที่ 18 (22 ต.ค.)" */
    /** ชื่อช่องวัน — ช่องที่แยกมาจากตลาดอื่นบอกที่มา เช่น "D3·ครั้ง2" */
    const baseName = (route, dayLabel, short) => {
        const tag = (typeof Runs !== 'undefined' && Runs.tagOf) ? Runs.tagOf(route, dayLabel) : '';
        if (tag) return tag;                                   // V0.7.6: ช่องที่แยกมา = "D5·ครั้ง2" ไม่โชว์เลขเกินรอบ
        return short ? ('D' + dayNum(dayLabel)) : ('Day ' + dayNum(dayLabel));
    };
    const label = (route, dayLabel, short) => {
        const base = baseName(route, dayLabel, short);
        const d = dateOf(route, dayLabel);
        return d ? `${base} (${d.txt})` : base;
    };

    const html = (route, dayLabel, short) => {
        const base = baseName(route, dayLabel, short);
        const d = dateOf(route, dayLabel);
        if (!d) return base;
        const cls = d.exact ? 'color:#475569' : 'color:#cbd5e1';
        const tip = d.exact ? 'วันที่จริงตามปฏิทินที่ตั้งไว้' : 'ยังไม่ได้ตั้งปฏิทิน — ใช้ Day N = วันที่ N ของเดือนนี้ไปก่อน';
        return `${base} <span style="${cls};font-size:.92em" title="${tip}">(${d.txt})</span>`;
    };

    window.DayDate = { dateOf, label, html, _clear: () => { cache = new Map(); }, reloadOverrides: () => loadOverrides() };

    // ── โหลด override ของแต่ละสายมาไว้ในหน่วยความจำ ─────────────────────
    // (ตัวอ่านเดิมไปดึงจากที่เก็บข้อมูลตอน Export เท่านั้น หน้าจอเลยไม่รู้)
    let calYM = '';                          // เดือนของ routeCal ที่อยู่ในหน่วยความจำ
    const loadOverrides = async () => {
        if (typeof App === 'undefined' || !App._currentPlanYM || !App.planRoutesCol) return;
        // ใช้ routeList ของเดือน ไม่ใช่ keys ของ routes — สายที่เหลือถูกโหลดเบื้องหลังทีละสาย ยังมาไม่ครบตอนนี้
        const names = [...new Set([...(State.db.routeList || []), ...Object.keys((State.db && State.db.routes) || {})])];
        if (!names.length) return;
        const out = {};
        await Promise.all(names.map(async (n) => {
            try {
                const d = await App.planRoutesCol(App._currentPlanYM).doc(n).get();
                if (d && d.exists && d.data().calendarOverride) out[n] = d.data().calendarOverride;
            } catch (e) {}
        }));
        State.db.routeCal = out;
        calYM = App._currentPlanYM;
        cache = new Map();
        // ปฏิทินเปลี่ยน → ตัวที่คำนวณวันที่จากแคชต้องล้าง และหน้าภาพรวมถ้าเปิดอยู่ต้องวาดใหม่
        try { if (window.PlanOverview && document.getElementById('page-overview')
                  && !document.getElementById('page-overview').classList.contains('hidden')) PlanOverview.render(); } catch (e) {}
        try { if (typeof UI !== 'undefined' && UI.render) UI.render(); } catch (e) {}
    };

    /** ปฏิทินเฉพาะสายต้องโหลดใหม่ทุกครั้งที่ "เดือนเปลี่ยน" หรือ "บันทึกปฏิทิน" — เดิมโหลดครั้งเดียวตอนเปิดหน้า
     *  ทำให้สลับไปเดือนใหม่แล้วยังใช้ปฏิทิน (และวันหยุดเฉพาะกิจ) ของเดือนก่อนอยู่ ทั้งบนจอและตอนส่งออก */
    const hookReload = () => {
        if (typeof App === 'undefined' || !App._loadPlan || App._ddReloadWired) return false;
        App._ddReloadWired = true;
        const lp = App._loadPlan;
        App._loadPlan = async function () {
            // อย่าให้ของเดือนก่อนค้างระหว่างโหลด — แต่โหลดซ้ำเดือนเดิม (เช่นเอกสารศูนย์อัปเดตตอนส่งออก) ไม่ต้องล้าง
            // V0.6: เดิมล้างทุกครั้ง ระหว่างส่งออก DMS ปฏิทินเฉพาะสายหายไปชั่วขณะ → End date ของสายนั้นผิด
            if (arguments[0] !== calYM) State.db.routeCal = {};
            const r = await lp.apply(this, arguments);
            await loadOverrides();
            return r;
        };
        if (typeof PlanUI !== 'undefined' && PlanUI.updateBadge && !PlanUI.updateBadge._ddWrapped) {
            const ub = PlanUI.updateBadge;
            const fn = function () {
                const r = ub.apply(this, arguments);
                cache = new Map();
                try { if (typeof Runs !== 'undefined' && Runs.bump) Runs.bump(); } catch (e) {}
                try { const pg = document.getElementById('page-overview');
                      if (window.PlanOverview && pg && !pg.classList.contains('hidden')) PlanOverview.render(); } catch (e) {}
                // V0.5: บันทึกปฏิทินแล้ววาดรายการตลาดใหม่ทันที (เดิมป้ายวันที่ค้างค่าเก่าจนกว่าจะคลิกอะไรสักอย่าง)
                try { if (typeof UI !== 'undefined' && UI.render) setTimeout(() => { try { UI.render(); } catch (e) {} }, 0); } catch (e) {}
                return r;
            };
            fn._ddWrapped = true;
            PlanUI.updateBadge = fn;
        }
        if (App.saveRouteCalendarOverride) {
            const sv = App.saveRouteCalendarOverride;
            const fn = async function () {
                const r = await sv.apply(this, arguments);
                await loadOverrides();
                return r;
            };
            fn._ddWrapped = true;
            App.saveRouteCalendarOverride = fn;
        }
        return true;
    };

    // ── แปะวันที่ลงจุดที่คนอ่านบ่อย ─────────────────────────────────────
    const paintFilterDays = () => {
        const rows = document.querySelectorAll('#mr-panel label, .mr-panel label');
        // ตัวกรองสร้าง label ใหม่ทุกครั้งที่เปิด — หา label ที่ข้อความขึ้นต้นด้วย "วันที่ N"
        document.querySelectorAll('label').forEach(el => {
            const sp = el.querySelector('span.flex-1');
            if (!sp || el.dataset.ddDone) return;
            // V0.7.6: อ่านเลขช่องวันจากช่องติ๊ก (ชื่อบนจออาจเป็น "Day N" หรือ "D5·ครั้ง2")
            const inp = el.querySelector('input[onchange*="toggleDay"]');
            const mi = inp && /toggleDay\('([^']+)'\)/.exec(inp.getAttribute('onchange') || '');
            const m = mi ? [null, String(dayNum(mi[1]))] : /^(?:Day|วันที่)\s*(\d+)$/.exec(sp.textContent.trim());
            if (!m) return;
            el.dataset.ddDone = '1';
            const route = (typeof MultiRoute !== 'undefined' && (MultiRoute.open || []).length === 1)
                ? MultiRoute.open[0] : State.localActiveRoute;
            sp.innerHTML = html(route, 'Day ' + m[1]);
        });
    };

    const paintSummary = () => {
        const host = document.getElementById('list-summary');
        if (!host) return;
        host.querySelectorAll('div[onclick^="UI.showDayModal"], div[onclick^="MultiRoute.openDay"]').forEach(card => {
            const p = card.querySelector('p');
            if (!p || card.dataset.ddDone) return;
            const oc = card.getAttribute('onclick') || '';
            const mo = /'(Day \d+)'\)/.exec(oc);
            const m = mo ? [null, String(dayNum(mo[1]))] : /^(?:Day|วันที่)\s*(\d+)$/.exec(p.textContent.trim());
            if (!m) return;
            card.dataset.ddDone = '1';
            const rt = oc.match(/openDay\('([^']+)'/);
            p.innerHTML = html(rt ? rt[1] : State.localActiveRoute, 'Day ' + m[1]);
        });
    };

    const paintModalTitle = () => {
        const t = document.getElementById('modalTitle');
        if (!t || !State.openDayModal) return;
        if (t.dataset.ddFor === State.openDayModal) return;
        const d = dateOf(State.localActiveRoute, State.openDayModal);
        if (!d) return;
        t.dataset.ddFor = State.openDayModal;
        t.insertAdjacentHTML('beforeend',
            `<span style="font-size:.8em;font-weight:700;color:${d.exact ? '#475569' : '#cbd5e1'}"> (${d.txt})</span>`);
    };

    const boot = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof State === 'undefined') return setTimeout(boot, 400);
        if (UI._ddWired) return;
        UI._ddWired = true;
        const orig = UI.render;
        UI.render = function () {
            const r = orig.apply(this, arguments);
            const go = () => { try { paintFilterDays(); paintSummary(); paintModalTitle(); } catch (e) {} };
            go(); setTimeout(go, 0); setTimeout(go, 250);
            return r;
        };
        document.addEventListener('click', () => setTimeout(() => {
            try { paintFilterDays(); paintModalTitle(); } catch (e) {}
        }, 120), true);

        // แผงตัวกรองสร้าง HTML ใหม่ทุกครั้งที่เปิด/ติ๊ก — ต้องแปะวันที่ทับหลังมันวาดเสร็จ
        const hookPanel = () => {
            if (typeof MultiRoute === 'undefined' || !MultiRoute.panel || MultiRoute.panel._ddWrapped) return false;
            const op = MultiRoute.panel;
            const fn = function () {
                const r = op.apply(this, arguments);
                try { paintFilterDays(); } catch (e) {}
                setTimeout(() => { try { paintFilterDays(); } catch (e) {} }, 0);
                return r;
            };
            fn._ddWrapped = true;
            MultiRoute.panel = fn;
            return true;
        };
        [500, 1500, 4000, 9000].forEach(t => setTimeout(hookPanel, t));
        [1500, 5000, 15000].forEach(t => setTimeout(loadOverrides, t));
        const tryHook = () => { if (!hookReload()) setTimeout(tryHook, 400); };
        tryHook();
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800));
})();

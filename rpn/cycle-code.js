/* =============================================================================
 *  cycle-code.js — เลข Cycle Code (CY) ต่อเนื่องข้ามเดือน
 * =============================================================================
 *  กติกาจากระบบ AS&D:
 *    • 1 CY = 1 ตลาด = ร้านทั้งหมดใน (สาย × วัน) เดียวกัน
 *    • เลข run ต่อกันไปเรื่อยๆ ไม่รีเซ็ตรายเดือน
 *      เช่น มิ.ย. ใช้ CY0000020943–021326 → ก.ค. เริ่ม CY0000021327
 *
 *  ไฟล์นี้เติม CY ให้ตลาดที่ยังไม่มี (เช่น แผนที่จัดขึ้นใหม่ในระบบ)
 *  ตอนกด Export โดยนับต่อจากเลขสูงสุดที่ระบบเคยเห็น แล้วเก็บกลับลงร้าน
 *  ตลาดไหนมี CY ติดมาจากไฟล์อยู่แล้ว จะใช้ของเดิมเสมอ ไม่เขียนทับ
 * ========================================================================== */
const CycleCode = (() => {
    'use strict';

    const PREFIX = 'CY';
    const WIDTH = 10;
    const fmt = n => PREFIX + String(n).padStart(WIDTH, '0');
    const num = cy => {
        const n = parseInt(String(cy || '').replace(/\D/g, ''), 10);
        return isFinite(n) ? n : 0;
    };
    const dayNum = d => parseInt(String(d || '').replace(/[^0-9]/g, ''), 10) || 0;

    const C = {
        /** เลขสูงสุดที่เคยเห็น (จากไฟล์ที่นำเข้า + ที่เคยออกให้ไปแล้ว) */
        max(routes) {
            let mx = num(State.db.maxCycleCode);
            Object.values(routes || {}).forEach(list =>
                (list || []).forEach(s => {
                    let n = num(s.cy); if (n > mx) mx = n;
                    Object.values(s.cys || {}).forEach(v => { const k = num(v); if (k > mx) mx = k; });
                }));
            return mx;
        },

        /** CY ของร้านในวันนั้น (ร้าน F2 มี CY คนละตัวในแต่ละวัน) */
        of(store, day) {
            if (store.cys && store.cys[day]) return store.cys[day];
            // ข้อมูลเก่าที่ยังไม่มี cys — เชื่อ s.cy ได้เฉพาะร้านที่อยู่วันเดียว
            return ((store.days || []).length === 1) ? (store.cy || '') : '';
        },

        /**
         * เติม CY ให้ครบทุกตลาดในชุด routes ที่ส่งมา
         * @returns {{assigned:number, max:number}} จำนวนตลาดที่ออกเลขใหม่ + เลขสูงสุดหลังเติม
         */
        fill(routes) {
            if (!routes) return { assigned: 0, max: 0 };
            let next = C.max(routes) + 1;
            let assigned = 0;

            const routeNames = Object.keys(routes).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            for (const name of routeNames) {
                const stores = routes[name] || [];
                // จัดกลุ่มเป็นตลาด: สาย × วัน
                const groups = new Map();      // dayLabel -> [store]
                stores.forEach(s => {
                    if (s.inactive) return;
                    (s.days || []).forEach(d => {
                        if (!groups.has(d)) groups.set(d, []);
                        groups.get(d).push(s);
                    });
                });

                const days = [...groups.keys()].sort((a, b) => dayNum(a) - dayNum(b));
                for (const d of days) {
                    const members = groups.get(d);
                    // ถ้ามีร้านไหนในตลาดนี้มี CY อยู่แล้ว → ใช้ของเดิมทั้งกลุ่ม
                    const existing = members.map(s => C.of(s, d)).find(cy => num(cy) > 0);
                    const code = existing || fmt(next);
                    if (!existing) { next++; assigned++; }
                    members.forEach(s => {
                        if (!s.cys) s.cys = {};
                        if (!num(s.cys[d])) s.cys[d] = code;
                        if (!s.cy) s.cy = code;          // เผื่อโค้ดเก่าที่ยังอ่าน s.cy
                    });
                }
            }
            return { assigned, max: next - 1 };
        },

        /** เติม CY ให้แผนที่กำลังเปิดอยู่ แล้วบันทึกถ้ามีการออกเลขใหม่ */
        async ensureCurrent() {
            const routes = State.db.routes || {};
            const before = C.max(routes);
            const r = C.fill(routes);
            if (!r.assigned) return r;

            State.db.maxCycleCode = Math.max(before, r.max);
            try {
                // เก็บเลขสูงสุดไว้ที่ศูนย์ เพื่อให้เดือนถัดไปนับต่อได้
                await App.dbRef.set({ maxCycleCode: State.db.maxCycleCode }, { merge: true });
                // เขียนร้านที่เพิ่งได้ CY กลับลงแต่ละสาย
                const ym = App._currentPlanYM;
                if (ym) {
                    await Promise.all(Object.keys(routes).map(name =>
                        App.planRoutesCol(ym).doc(name).set({ stores: routes[name] }, { merge: true })));
                }
            } catch (e) { console.warn('[CycleCode] บันทึกไม่สำเร็จ', e); }
            return r;
        },
    };

    // ── ต่อเข้ากับปุ่ม Export ────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof FileManager === 'undefined' || !FileManager.exportAllRoutes) return;
        const orig = FileManager.exportAllRoutes;
        FileManager.exportAllRoutes = async function (routeFilter) {
            try {
                const r = await CycleCode.ensureCurrent();
                if (r.assigned) UI.showSaveToast(`🔖 ออกเลข Cycle Code ใหม่ ${r.assigned} ตลาด`);
            } catch (e) { console.warn('[CycleCode]', e); }
            return orig.apply(this, arguments);
        };
    });

    return C;
})();

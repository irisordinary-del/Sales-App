/* =============================================================================
 *  plan-lock.js — ล็อกแผนบางเดือนไว้ (อ่านได้ เขียนไม่ได้)
 * =============================================================================
 *  ล็อกได้ 2 ทาง
 *    1) รายศูนย์ (ปกติใช้ทางนี้) — appData/{ศูนย์}_main.lockedMonths = ['YYYY_MM', ...]
 *       admin กดล็อก/ปลดล็อกได้ที่เมนู "🔒 ล็อกแผน" ในหน้า admin (PlanLockUI ใน index.html) —
 *       ทุกหน้าที่เปิดอยู่ (หน้า admin + RPN ใน iframe) ฟังเอกสารศูนย์แบบ realtime มีผลทันทีไม่ต้อง deploy
 *    2) ทุกศูนย์พร้อมกัน — รายการ LOCKED ด้านล่าง (แก้แล้ว push) · 2026-10-08 เคยล็อก 11–12 ระหว่างทดสอบ
 *       RPN V0 แล้วปลดในวันเดียวกัน
 *
 *  โหลดหลัง Firebase SDK และก่อนสคริปต์อื่นทุกตัว — ใช้ทั้ง index.html (หน้า admin) และ
 *  rpn/RoutePlannerV0.html (tools/sync-rpn.mjs ใส่ให้) · หน้าเซล (sales.html) ไม่โหลดไฟล์นี้
 *  ดักที่ Firestore SDK ตรง ๆ: set / update / delete ของเอกสารใต้ appData/{ศูนย์}/plans/{เดือนที่ล็อก}
 *  (รวม routes/ ข้างใน) ทั้งแบบเอกสารเดี่ยวและใน batch → ไม่เขียน และขึ้นข้อความบอก
 *  ⚠️ เป็นด่านฝั่งหน้าเว็บ (เหมือนระบบล็อกอินของแอปนี้) — firestore.rules ไม่ได้บังคับ
 *  ⚠️ ช่วงไม่กี่วินาทีแรกหลังเปิดหน้า (ก่อนอ่านเอกสารศูนย์เสร็จ) ยังไม่รู้ว่าเดือนไหนล็อกรายศูนย์
 * ========================================================================== */
(function () {
    'use strict';
    const LOCKED = [];   // ล็อกทุกศูนย์ — ใส่ 'YYYY_MM' แล้ว push · ว่าง = ไม่ล็อก (ใช้ล็อกรายศูนย์ในหน้า admin แทน)

    const RE = /(^|\/)appData\/([^/]+)\/plans\/(\d{4}_\d{2})(\/|$)/;
    const perCenter = {};                       // centerDoc -> Set('YYYY_MM')
    const listeners = [];
    const lockedFor = (centerDoc, ym) => LOCKED.includes(ym) || !!(perCenter[centerDoc] && perCenter[centerDoc].has(ym));
    const lockedOf = (path) => { const m = RE.exec(path || ''); return (m && lockedFor(m[2], m[3])) ? m[3] : null; };
    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const label = (ym) => { const [y, m] = String(ym).split('_').map(Number); return (y && m) ? `${TH[m - 1]} ${y + 543}` : ym; };
    const message = (ym) => `🔒 แผนเดือน ${label(ym)} ถูกล็อกอยู่ — ยังบันทึกไม่ได้`;

    let lastToast = 0;
    const notify = (ym) => {
        if (Date.now() - lastToast < 3000) return;
        lastToast = Date.now();
        try {
            if (typeof UI !== 'undefined' && UI.showErrorToast) UI.showErrorToast(message(ym));
            else console.warn(message(ym));
        } catch (e) { console.warn(message(ym)); }
    };
    const error = (ym) => Object.assign(new Error(message(ym)), { code: 'plan-locked' });

    const fs = window.firebase && firebase.firestore;
    if (!fs) { console.warn('[PlanLock] ไม่พบ Firebase — โหลดไฟล์นี้หลัง firebase-firestore-compat.js'); return; }

    const Doc = fs.DocumentReference && fs.DocumentReference.prototype;
    if (Doc) ['set', 'update', 'delete'].forEach(n => {
        const orig = Doc[n];
        if (typeof orig !== 'function') return;
        Doc[n] = function () {
            const ym = lockedOf(this.path);
            if (ym) { notify(ym); return Promise.reject(error(ym)); }
            return orig.apply(this, arguments);
        };
    });
    const Batch = fs.WriteBatch && fs.WriteBatch.prototype;
    if (Batch) ['set', 'update', 'delete'].forEach(n => {
        const orig = Batch[n];
        if (typeof orig !== 'function') return;
        Batch[n] = function (ref) {
            const ym = lockedOf(ref && ref.path);
            if (ym) { notify(ym); throw error(ym); }
            return orig.apply(this, arguments);
        };
    });

    // ✅ FIX (2026-10-09): อ่านจาก server ก่อนเสมอ — Firestore เปิด persistence ไว้ (enablePersistence) และในช่วง
    // ไม่กี่วินาทีแรกหลังเปิดหน้า/สลับเดือน get() แบบไม่ระบุ source คืนข้อมูลเก่าจากแคช IndexedDB ได้ (เจอจริงกับ
    // RPN 402V09 พ.ย. — แก้บนข้อมูลเก่าแล้วบันทึกทับของใหม่บน server) → get() ที่ไม่ระบุ options ลอง server ก่อน
    // ถ้าออฟไลน์/ไม่ได้ค่อยถอยไปแบบเดิม (แคช) · get({source:...}) ที่ระบุมาเองไม่แตะ
    if (Doc && typeof Doc.get === 'function' && !Doc.get._serverFirst) {
        const origGet = Doc.get;
        Doc.get = function (opts) {
            if (opts) return origGet.call(this, opts);
            const self = this;
            return new Promise((resolve, reject) => {
                let done = false;
                const fallback = () => { if (done) return; done = true; origGet.call(self).then(resolve, reject); };
                origGet.call(self, { source: 'server' }).then(v => { if (!done) { done = true; resolve(v); } }, fallback);
                setTimeout(fallback, 8000);                                     // รอ server ไม่เกิน 8 วิ
            });
        };
        Doc.get._serverFirst = true;
    }

    // ฟังรายการล็อกของศูนย์ที่เปิดอยู่ — รอจน app-config.js ตั้ง CENTER_DOC และ initializeApp แล้ว
    // (index.html เปลี่ยน CENTER_DOC ทีหลังสำหรับ supervisor — เช็คซ้ำเป็นระยะ ถ้าเปลี่ยนก็ย้ายไปฟังเอกสารใหม่)
    let watching = '', loaded = false, unsub = null;
    const watch = () => {
        const cd = window.CENTER_DOC;
        if (!cd || !(firebase.apps && firebase.apps.length)) return setTimeout(watch, 300);
        setTimeout(watch, 3000);
        if (watching === cd) return;
        watching = cd;
        if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
        try {
            unsub = firebase.firestore().collection('appData').doc(cd).onSnapshot(snap => {
                const list = (snap.exists && Array.isArray(snap.data().lockedMonths)) ? snap.data().lockedMonths : [];
                perCenter[cd] = new Set(list);
                loaded = true;
                listeners.forEach(f => { try { f(); } catch (e) { console.warn('[PlanLock]', e); } });
            }, e => console.warn('[PlanLock] อ่านรายการล็อกไม่สำเร็จ', e));
        } catch (e) { console.warn('[PlanLock] watch', e); watching = ''; setTimeout(watch, 1000); }
    };
    watch();

    window.PlanLock = {
        LOCKED: LOCKED.slice(),
        isLocked: (ym, centerDoc) => lockedFor(centerDoc || window.CENTER_DOC, ym),
        /** ล็อกทุกศูนย์จากไฟล์ (ปลดจากหน้าเว็บไม่ได้) */
        isGlobal: (ym) => LOCKED.includes(ym),
        /** เดือนที่ล็อกรายศูนย์ของศูนย์ที่เปิดอยู่ */
        months: (centerDoc) => [...(perCenter[centerDoc || window.CENTER_DOC] || [])].sort(),
        loaded: () => loaded,
        onChange: (fn) => { listeners.push(fn); },
        /** ล็อก/ปลดล็อกรายศูนย์ — เขียน lockedMonths ของเอกสารศูนย์ (ไม่ใช่ใต้ plans/ จึงไม่ติดล็อกเอง) */
        set: (ym, on, centerDoc) => {
            const cd = centerDoc || window.CENTER_DOC;
            const FV = firebase.firestore.FieldValue;
            return firebase.firestore().collection('appData').doc(cd)
                .set({ lockedMonths: on ? FV.arrayUnion(ym) : FV.arrayRemove(ym) }, { merge: true });
        },
        label, message,
    };
})();

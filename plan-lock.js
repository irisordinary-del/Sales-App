/* =============================================================================
 *  plan-lock.js — ล็อกแผนบางเดือนไว้ชั่วคราว (อ่านได้ เขียนไม่ได้)
 * =============================================================================
 *  2026-10-08: เริ่มใช้ RPN V0 เป็นตัววางแผน — ระหว่างทดสอบ ห้ามแก้แผนเดือน 11–12 ของทุกศูนย์
 *  ปลดล็อก: ลบเดือนออกจาก LOCKED แล้ว push
 *
 *  โหลดหลัง Firebase SDK และก่อนสคริปต์อื่นทุกตัว — ใช้ทั้ง index.html (หน้า admin) และ
 *  rpn/RoutePlannerV0.html (tools/sync-rpn.mjs ใส่ให้) · หน้าเซล (sales.html) ไม่โหลดไฟล์นี้
 *  ดักที่ Firestore SDK ตรง ๆ: set / update / delete ของเอกสารใต้ plans/{เดือนที่ล็อก} (รวม routes/ ข้างใน)
 *  ทั้งแบบเอกสารเดี่ยวและใน batch → ไม่เขียน และขึ้นข้อความบอก
 * ========================================================================== */
(function () {
    'use strict';
    const LOCKED = ['2026_11', '2026_12'];

    const RE = /(^|\/)plans\/(\d{4}_\d{2})(\/|$)/;
    const lockedOf = (path) => { const m = RE.exec(path || ''); return (m && LOCKED.includes(m[2])) ? m[2] : null; };
    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const label = (ym) => { const [y, m] = String(ym).split('_').map(Number); return (y && m) ? `${TH[m - 1]} ${y + 543}` : ym; };
    const message = (ym) => `🔒 แผนเดือน ${label(ym)} ถูกล็อกไว้ชั่วคราว — ยังบันทึกไม่ได้`;

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

    window.PlanLock = { LOCKED: LOCKED.slice(), isLocked: (ym) => LOCKED.includes(ym), label, message };
})();

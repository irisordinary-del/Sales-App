/* =============================================================================
 *  rpn-online-pre.js — ต่อ RPN V0 เข้ากับระบบออนไลน์ (ส่วนที่ต้องโหลดก่อน app-config.js)
 * =============================================================================
 *  โหลดหลัง ../auth.js และก่อน app-config.js ของ RPN V0 (tools/sync-rpn.mjs ใส่ให้)
 *    1) Auth.guard / logout ของ ../auth.js redirect แบบ relative ('login.html') ซึ่งจากในโฟลเดอร์
 *       rpn/ จะกลายเป็น rpn/login.html (ไม่มีไฟล์) — เปลี่ยนให้ไปหน้าหลักของระบบ และถ้าเปิดอยู่
 *       ในแท็บของหน้า admin (iframe) ให้เปลี่ยนทั้งหน้าต่าง ไม่ใช่แค่ใน iframe
 *    2) app-config.js ของ RPN V0 ถอยไปใช้ศูนย์ล่าสุดใน localStorage หรือ "LOCAL" ถ้าไม่มี ?center=
 *       — ออนไลน์ห้ามเดา (จะเขียนข้อมูลลง LOCAL_main ใน Firestore จริง) → ไม่มี ?center= ให้ไปเลือกศูนย์ก่อน
 * ========================================================================== */
(function () {
    'use strict';
    const params = new URLSearchParams(location.search);
    window.RPN_EMBED = params.get('embed') === '1';

    const goTop = (page) => {
        const url = new URL('../' + page, location.href).href;
        try { (window.top || window).location.replace(url); } catch (e) { location.replace(url); }
    };

    // RoutePlannerV0.html ส่ง ['admin','supervisor','sales'] มา (โหมด local ทุกคนเป็น admin) —
    // ออนไลน์ให้เข้าได้เฉพาะ admin / supervisor เหมือนหน้า admin ของระบบ ไม่ว่าจะส่งอะไรมา
    const ALLOWED = ['admin', 'supervisor'];
    Auth.guard = () => {
        const s = Auth.getSession();
        if (!s) { goTop('login.html'); return null; }
        if (!ALLOWED.includes(s.role)) {
            goTop(['sales', 'route_supervisor', 'asm'].includes(s.role) ? 'sales.html' : 'login.html');
            return null;
        }
        return s;
    };
    Auth.logout = async () => {
        if (typeof AuditLog !== 'undefined') { try { await AuditLog.userLogout(); } catch (e) {} }
        Auth.clearSession();
        goTop('login.html');
    };

    // ศูนย์: supervisor ใช้ศูนย์ของบัญชีเสมอ (ตรงกับ guard ใน RoutePlannerV0.html) — คนอื่นต้องมี ?center=
    const s = Auth.getSession();
    const cid = (params.get('center') || '').trim();
    if (s && !cid && !(s.role === 'supervisor' && s.centerId)) {
        goTop('center-select.html');
        throw new Error('RPN online: ไม่ได้ระบุศูนย์ (?center=)');
    }
})();

// Firebase init สำหรับ center-select.html (ไม่มี redirect)
const firebaseConfig = {
    apiKey: "AIzaSyDCYxJf0eHryjVJ8_INoWw_uTN14UMaEWE",
    authDomain: "route-plan-71e2e.firebaseapp.com",
    projectId: "route-plan-71e2e",
    storageBucket: "route-plan-71e2e.firebasestorage.app",
    messagingSenderId: "486778971661",
    appId: "1:486778971661:web:2ef83fa1eeb09ec6665744"
};
firebase.initializeApp(firebaseConfig);

// ─── ErrorMsg — แปล error code ของ Firebase เป็นข้อความไทยที่ user เข้าใจได้ ──
// (คัดลอกมาจาก app-config.js เพราะหน้านี้โหลดแค่ init เบาๆ ไม่โหลด app-config.js เต็ม)
const ErrorMsg = {
    _map: {
        'permission-denied':    'ไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อแอดมิน',
        'unavailable':          'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
        'deadline-exceeded':    'การเชื่อมต่อช้าเกินไป กรุณาลองใหม่อีกครั้ง',
        'not-found':            'ไม่พบข้อมูลที่ต้องการ อาจถูกลบไปแล้ว',
        'already-exists':       'มีข้อมูลนี้อยู่แล้วในระบบ',
        'resource-exhausted':   'ระบบมีผู้ใช้งานพร้อมกันมาก กรุณาลองใหม่อีกสักครู่',
        'cancelled':            'การทำรายการถูกยกเลิกกลางทาง กรุณาลองใหม่',
        'unauthenticated':      'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
        'failed-precondition':  'ไม่สามารถทำรายการได้ในขณะนี้ (อาจมีการแก้ไขซ้อนกัน) กรุณาลองใหม่',
        'invalid-argument':     'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    },
    translate: (e) => {
        if (!e) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
        if (e.code && ErrorMsg._map[e.code]) return ErrorMsg._map[e.code];
        console.warn('[ErrorMsg] ไม่รู้จัก error code:', e.code, '| message เดิม:', e.message);
        return 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่ หรือติดต่อผู้ดูแลระบบถ้ายังไม่หาย';
    },
};

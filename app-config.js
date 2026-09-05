// ==========================================
// 🔧 Firebase Configuration
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyDCYxJf0eHryjVJ8_INoWw_uTN14UMaEWE",
    authDomain: "route-plan-71e2e.firebaseapp.com",
    projectId: "route-plan-71e2e",
    storageBucket: "route-plan-71e2e.firebasestorage.app",
    messagingSenderId: "486778971661",
    appId: "1:486778971661:web:2ef83fa1eeb09ec6665744"
};
firebase.initializeApp(firebaseConfig);
const cloudDB = firebase.firestore();

// ✅ FIX (2026-07-12): กัน error "WebChannelConnection RPC 'Listen' stream transport
// errored" ที่เจอฝั่ง sales.html — เครือข่ายบางแห่งบล็อกการเชื่อมต่อ streaming (WebChannel)
// ของ Firestore แต่ยอมให้ long-polling ผ่าน ใส่ไว้ที่นี่ด้วยเพื่อความสม่ำเสมอ แม้ฝั่ง Admin
// จะยังไม่เจออาการนี้ชัดเจนเท่าฝั่ง Sales ก็ตาม
cloudDB.settings({ experimentalForceLongPolling: true });

// Enable offline persistence — synchronizeTabs รองรับหลาย tab พร้อมกัน
// window.firestoreReady เป็น Promise ที่ App.init() รอก่อนเริ่ม onSnapshot
window.firestoreReady = cloudDB.enablePersistence({ synchronizeTabs: true })
    .catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn('⚠️ Multiple tabs: persistence disabled');
        } else if (err.code === 'unimplemented') {
            console.warn('⚠️ Browser does not support persistence');
        }
        // persistence ไม่ได้ก็ไม่เป็นไร — ทำงานออนไลน์ปกติ
    });

// ==========================================
// 🎨 Color / Day Config
// ==========================================
const Config = {
    hexColors: [
        "#ef4444","#3b82f6","#22c55e","#f97316","#a855f7",
        "#06b6d4","#eab308","#ec4899","#14b8a6","#84cc16",
        "#6366f1","#f43f5e","#8b5cf6","#10b981","#d946ef",
        "#0ea5e9","#f59e0b","#991b1b","#1e40af","#166534",
        "#9a3412","#4c1d95","#115e59","#64748b","#ff3333",
        "#33cc33","#3333ff"
    ],
    getDays: () => {
        let obj = {};
        for (let i = 1; i <= 30; i++) {
            obj[`Day ${i}`] = {
                hex: Config.hexColors[(i - 1) % Config.hexColors.length],
                name: `วันที่ ${i}`
            };
        }
        return obj;
    }
};
const DAY_COLORS = Config.getDays();

// ==========================================
// 🗄️ Global State (ตัวแปรกลางทั้งระบบ)
// ==========================================
const State = {
    db: { routes: {}, cycleDays: 24, backups: {}, routeDayStats: {} },
    sales: {},
    rawData: [],
    previewSales: null,
    localActiveRoute: null,
    stores: [],
    activeRoadDay: null,
    openDayModal: null
};

// ==========================================
// 🏢 Center Selector — ตรวจสอบสิทธิ์จาก session
// ==========================================
(function () {
    // auth.js ต้องโหลดก่อน app-config.js เสมอ
    const session = (typeof Auth !== 'undefined') ? Auth.getSession() : null;

    // ไม่มี session → ไป login
    if (!session) {
        window.location.replace('login.html');
        return;
    }

    // Sales ไม่ควรเข้า index.html ยกเว้นเพื่อดู Dashboard
    // (ถ้าไม่มี ?center= → ส่งไป sales.html ตามเดิม; ถ้าเปิด index.html โดยตรงให้อยู่ต่อ)
    if (session.role === 'sales') {
        if (!session.centerId) {
            document.body.innerHTML = '<div style="font-family:sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:#0f172a;color:#e2e8f0"><p style="font-size:1.1rem;font-weight:700;">⚠️ บัญชี Sales ยังไม่ได้ผูกกับศูนย์</p><p style="color:#64748b;font-size:0.85rem;">กรุณาติดต่อ Admin</p><button onclick="Auth.logout()" style="margin-top:8px;background:#6366f1;color:#fff;border:none;border-radius:10px;padding:10px 24px;font-size:0.9rem;font-weight:700;cursor:pointer;">ออกจากระบบ</button></div>';
            return;
        }
        window.CENTER_DOC = session.centerId + '_main';
        window.CENTER_ID  = session.centerId;
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const centerParam = params.get('center');

    if (session.role === 'admin') {
        // Admin: เลือกศูนย์ได้อิสระ ถ้าไม่มี ?center= → ไป center-select
        if (!centerParam) {
            window.location.replace('center-select.html');
            return;
        }
        window.CENTER_DOC = centerParam + '_main';
        window.CENTER_ID  = centerParam;

    } else if (session.role === 'supervisor') {
        // Supervisor: บังคับใช้ centerId จาก session ห้ามแก้ URL
        const allowedCenter = session.centerId;
        if (!allowedCenter) {
            // supervisor ไม่ได้ผูกศูนย์ → แจ้งเตือน
            document.body.innerHTML = '<div style="font-family:sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:#0f172a;color:#e2e8f0"><p style="font-size:1.1rem;font-weight:700;">⚠️ บัญชีของคุณยังไม่ได้ผูกกับศูนย์</p><p style="color:#64748b;font-size:0.85rem;">กรุณาติดต่อ Admin เพื่อกำหนดศูนย์</p><button onclick="Auth.logout()" style="margin-top:8px;background:#6366f1;color:#fff;border:none;border-radius:10px;padding:10px 24px;font-size:0.9rem;font-weight:700;cursor:pointer;">ออกจากระบบ</button></div>';
            return;
        }
        // ไม่สนใจ ?center= ใน URL — ใช้ค่าจาก session เสมอ
        window.CENTER_DOC = allowedCenter + '_main';
        window.CENTER_ID  = allowedCenter;

        // แก้ URL ให้ตรงกับ session (กันสับสน) โดยไม่ reload
        const correctUrl = 'index.html?center=' + allowedCenter;
        if (window.location.pathname + window.location.search !== '/' + correctUrl) {
            history.replaceState(null, '', correctUrl);
        }
    }
})();

// ─── DateUtil — shared across all pages ──────────────────────────────────
// Define here (not in admin-data.js) so dashboard.js and index.html can use it
const DateUtil = {
    ymToThai: (ym) => {
        if (!ym) return '';
        const [y, m] = ym.split('_');
        return new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
    },
    ymToThaiShort: (ym) => {
        if (!ym) return '';
        const [y, m] = ym.split('_');
        return new Date(+y, +m - 1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
    },
    currentYM: () => {
        const d = new Date();
        return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
    },
};

// ─── ErrorMsg — แปล error code ของ Firebase เป็นข้อความไทยที่ user เข้าใจได้ ──
// ใช้แทนการโชว์ e.message ดิบๆ (ภาษาอังกฤษ/technical) ตรงๆ ให้ user เห็น
// ตัวอย่าง: UI.showErrorToast('บันทึกไม่สำเร็จ: ' + ErrorMsg.translate(e))
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
    // แปล error → ข้อความไทย พร้อม fallback ถ้าไม่รู้จัก code นี้
    translate: (e) => {
        if (!e) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
        if (e.code && ErrorMsg._map[e.code]) return ErrorMsg._map[e.code];
        // ไม่รู้จัก code นี้ — ไม่โชว์ raw message ภาษาอังกฤษให้ user งง
        // แต่ log เก็บไว้ให้ dev เช็คทีหลังได้จาก console
        console.warn('[ErrorMsg] ไม่รู้จัก error code:', e.code, '| message เดิม:', e.message);
        return 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่ หรือติดต่อผู้ดูแลระบบถ้ายังไม่หาย';
    },
};

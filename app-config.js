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
    db: { routes: {}, cycleDays: 24, backups: {} },
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
        // Sales สามารถอยู่ใน index.html เพื่อดู Dashboard ได้
        // ไม่ redirect ออกอีกต่อไป
        window.CENTER_DOC = null;
        window.CENTER_ID  = null;
        // ไม่ต้องทำอะไรเพิ่ม — dashboard.js จะแสดงเฉพาะข้อมูลของ sales คนนั้น
        return; // ออกจาก IIFE
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

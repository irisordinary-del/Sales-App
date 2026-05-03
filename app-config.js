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

// Enable offline persistence
cloudDB.enablePersistence()
    .catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn('⚠️ Multiple tabs open - offline persistence disabled');
        } else if (err.code === 'unimplemented') {
            console.warn('⚠️ Browser doesn\'t support offline persistence');
        }
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

// ==========================================
// 🔧 Firebase Configuration
// ==========================================
// (โหมด Local: ค่านี้ไม่ถูกใช้จริง เก็บไว้ให้โครงสร้างเดิมทำงานได้)
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
    // V0.7.9: จัดสีใหม่ให้ต่างกันชัดขึ้น — D1–D8 คงเดิม · D9–D24 เลือกให้คนละโทนกับวันใกล้เคียง (±5 วัน)
    //   เดิมคู่ที่แทบแยกไม่ออก: D5/D13 ม่วง · D11/D13 · D1/D12 แดง · D18/D21 · D20/D23 เขียวเข้ม/เขียวหัวเป็ด
    hexColors: [
        "#ef4444","#3b82f6","#22c55e","#f97316","#a855f7",   // D1-5   แดง ฟ้า เขียว ส้ม ม่วง
        "#06b6d4","#eab308","#ec4899","#1e3a8a","#84cc16",   // D6-10  ฟ้าน้ำทะเล เหลือง ชมพู กรมท่า เขียวมะนาว
        "#7c2d12","#0f766e","#c026d3","#475569","#166534",   // D11-15 น้ำตาล เขียวหัวเป็ด บานเย็น เทาเข้ม เขียวเข้ม
        "#9f1239","#0ea5e9","#a16207","#6d28d9","#1c1917",   // D16-20 แดงเลือดหมู ฟ้าสด เหลืองมัสตาร์ด ม่วงเข้ม ดำ
        "#4d7c0f","#94a3b8","#a78bfa","#c2410c",             // D21-24 เขียวขี้ม้า เทาอ่อน ม่วงลาเวนเดอร์ ส้มอิฐ
        "#f472b6","#2dd4bf","#ca8a04","#1e293b","#fb923c","#4338ca"   // D25-30 (ช่องที่แยกเกินรอบ)
    ],
    /** สีตัวเลขบนหมุด — พื้นสว่าง (เหลือง เขียวมะนาว เทาอ่อน ฯลฯ) ใช้ตัวเลขสีเข้ม */
    textOn: (hex) => {
        const h = String(hex || '').replace('#', '');
        if (h.length !== 6) return '#fff';
        const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        const L = 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
        return L > 0.33 ? '#111827' : '#fff';
    },
    getDays: () => {
        let obj = {};
        for (let i = 1; i <= 30; i++) {
            // V0.7.6: ชื่อตลาดเป็น "Day N" (เดิม "วันที่ N" ซึ่งสับสนกับวันที่จริงในปฏิทิน)
            // ช่องที่แยกจากตลาดอื่น (✂️) ใช้ชื่อที่มา เช่น "D5·ครั้ง2" แทนเลขเกินรอบ
            const key = `Day ${i}`;
            obj[key] = { hex: Config.hexColors[(i - 1) % Config.hexColors.length] };
            Object.defineProperty(obj[key], 'name', {
                enumerable: true,
                get() {
                    try {
                        if (i > 12 && typeof Runs !== 'undefined' && Runs.tagOf && typeof State !== 'undefined' && State.localActiveRoute) {
                            const t = Runs.tagOf(State.localActiveRoute, key);
                            if (t) return t;
                        }
                    } catch (e) {}
                    return key;
                },
            });
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
    // โหมด Local: ไม่มีระบบล็อกอิน / ไม่มีการเลือกศูนย์จากเซิร์ฟเวอร์
    // ลำดับการเลือกศูนย์:  ?center=402 ท้าย URL  >  ศูนย์ที่ใช้ล่าสุด  >  LOCAL
    // ปกติไม่ต้องพิมพ์อะไรท้าย URL — เปิดไฟล์ index.html เฉย ๆ ก็ใช้ได้
    // ครั้งแรกที่นำเข้าไฟล์ RoutePlan ระบบจะตั้งเลขศูนย์ให้เองจาก Distributor Code
    const params = new URLSearchParams(window.location.search);
    let _cid = (params.get('center') || '').trim();
    if (!_cid) { try { _cid = localStorage.getItem('rpl:center') || ''; } catch (e) {} }
    window.CENTER_ID  = _cid || 'LOCAL';
    window.CENTER_DOC = window.CENTER_ID + '_main';
    try { localStorage.setItem('rpl:center', window.CENTER_ID); } catch (e) {}
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


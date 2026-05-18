// ==========================================
// 📋 Audit Log System — Route Planner
// บันทึกทุก action ที่ user ทำ → Firestore
// collection: auditLogs/{centerId}/logs/{docId}
// ==========================================

const AuditLog = {

    // ─── Config ──────────────────────────────────────────────────────────
    BATCH_SIZE: 50,       // โหลด log ครั้งละกี่รายการ
    MAX_DISPLAY: 200,     // แสดงสูงสุดกี่รายการ

    // ─── Firestore path ──────────────────────────────────────────────────
    _col: () => {
        const centerId = window.CENTER_ID || 'unknown';
        return cloudDB.collection('auditLogs').doc(centerId).collection('logs');
    },

    // ─── Action Types ─────────────────────────────────────────────────────
    ACTIONS: {
        // Store / Route
        STORE_ASSIGN:        { icon: '📅', label: 'จัดสายร้านค้า' },
        STORE_REMOVE:        { icon: '❌', label: 'ยกเลิกจัดสาย' },
        STORE_SELECT:        { icon: '☑️', label: 'เลือกร้านค้า' },
        STORE_TRANSFER:      { icon: '🔄', label: 'ย้ายร้านระหว่างสาย' },
        ROUTE_ADD:           { icon: '➕', label: 'เพิ่มสายวิ่ง' },
        ROUTE_RENAME:        { icon: '✏️', label: 'เปลี่ยนชื่อสาย' },
        ROUTE_DELETE:        { icon: '🗑️', label: 'ลบสายวิ่ง' },
        ROUTE_UPLOAD:        { icon: '📂', label: 'อัปโหลดไฟล์ร้านค้า' },
        ROUTE_CLEAR_ASSIGN:  { icon: '🧹', label: 'เคลียร์การจัดสายทั้งหมด' },
        BULK_IMPORT:         { icon: '📦', label: 'Bulk Import ทุกสาย' },
        // Plan
        PLAN_DRAFT_CREATE:   { icon: '📝', label: 'สร้าง Draft Plan' },
        PLAN_DRAFT_ACTIVATE: { icon: '🚀', label: 'Activate Draft → Active' },
        PLAN_MODE_SWITCH:    { icon: '🔀', label: 'เปลี่ยน Plan Mode' },
        // AI
        AI_RUN:              { icon: '🤖', label: 'รัน AI จัดสาย' },
        // KPI / Data
        KPI_DEPLOY:          { icon: '📊', label: 'Deploy KPI ให้ Sales' },
        SELLOUT_UPLOAD:      { icon: '📈', label: 'อัปโหลด Sellout Data' },
        RAW_UPLOAD:          { icon: '📋', label: 'อัปโหลด Raw Data' },
        RAW_CLEAR:           { icon: '🗑️', label: 'ล้าง Raw Data' },
        TARGET_SAVE:         { icon: '🎯', label: 'ตั้ง Target รายสาย' },
        // SKU Dist
        CAMPAIGN_CREATE:     { icon: '🎯', label: 'สร้าง Campaign' },
        CAMPAIGN_EDIT:       { icon: '✏️', label: 'แก้ไข Campaign' },
        CAMPAIGN_DELETE:     { icon: '🗑️', label: 'ลบ Campaign' },
        // User
        USER_LOGIN:          { icon: '🔑', label: 'เข้าสู่ระบบ' },
        USER_LOGOUT:         { icon: '🚪', label: 'ออกจากระบบ' },
        USER_CREATE:         { icon: '👤', label: 'สร้าง User' },
        USER_UPDATE:         { icon: '✏️', label: 'แก้ไข User' },
        USER_DELETE:         { icon: '🗑️', label: 'ลบ User' },
        // Center
        CENTER_CREATE:       { icon: '🏢', label: 'สร้างศูนย์ใหม่' },
    },

    // ─── Write Log ────────────────────────────────────────────────────────
    // เรียกใช้: AuditLog.write('STORE_ASSIGN', { route: '402V01', day: 'Day 4', storeCount: 3 })
    write: async (actionKey, details = {}) => {
        try {
            const session = (typeof Auth !== 'undefined') ? Auth.getSession() : null;
            if (!session) return; // ไม่ log ถ้าไม่ได้ login

            const action = AuditLog.ACTIONS[actionKey] || { icon: '📌', label: actionKey };

            const logEntry = {
                actionKey,
                icon:        action.icon,
                label:       action.label,
                username:    session.username,
                displayName: session.displayName || session.username,
                role:        session.role,
                centerId:    window.CENTER_ID || null,
                centerDoc:   window.CENTER_DOC || null,
                details,
                ts:          firebase.firestore.FieldValue.serverTimestamp(),
                tsLocal:     new Date().toISOString(),
            };

            // เขียน async โดยไม่ block UI (fire-and-forget)
            AuditLog._col().add(logEntry).catch(e => {
                console.warn('AuditLog.write failed:', e.message);
            });
        } catch (e) {
            console.warn('AuditLog.write error:', e.message);
        }
    },

    // ─── Shorthand helpers ────────────────────────────────────────────────
    storeAssign:   (route, day, count)    => AuditLog.write('STORE_ASSIGN',        { route, day, storeCount: count }),
    storeRemove:   (route, storeId)       => AuditLog.write('STORE_REMOVE',        { route, storeId }),
    storeTransfer: (src, dst, count)      => AuditLog.write('STORE_TRANSFER',      { from: src, to: dst, storeCount: count }),
    routeAdd:      (name)                 => AuditLog.write('ROUTE_ADD',           { name }),
    routeRename:   (oldName, newName)     => AuditLog.write('ROUTE_RENAME',        { oldName, newName }),
    routeDelete:   (name)                 => AuditLog.write('ROUTE_DELETE',        { name }),
    routeUpload:   (route, count)         => AuditLog.write('ROUTE_UPLOAD',        { route, storeCount: count }),
    routeClear:    (route)                => AuditLog.write('ROUTE_CLEAR_ASSIGN',  { route }),
    bulkImport:    (routes, count)        => AuditLog.write('BULK_IMPORT',         { routes, totalStores: count }),
    draftCreate:   (ym)                   => AuditLog.write('PLAN_DRAFT_CREATE',   { ym }),
    draftActivate: (ym)                   => AuditLog.write('PLAN_DRAFT_ACTIVATE', { ym }),
    planSwitch:    (mode)                 => AuditLog.write('PLAN_MODE_SWITCH',    { mode }),
    aiRun:         (k, stores)            => AuditLog.write('AI_RUN',             { cycleDays: k, storeCount: stores }),
    kpiDeploy:     (count)                => AuditLog.write('KPI_DEPLOY',          { storeCount: count }),
    selloutUpload: (ym, rows)             => AuditLog.write('SELLOUT_UPLOAD',      { ym, rows }),
    rawUpload:     (rows)                 => AuditLog.write('RAW_UPLOAD',          { rows }),
    rawClear:      ()                     => AuditLog.write('RAW_CLEAR',           {}),
    targetSave:    (ym, routes)           => AuditLog.write('TARGET_SAVE',         { ym, routeCount: routes }),
    campaignCreate:(name)                 => AuditLog.write('CAMPAIGN_CREATE',     { name }),
    campaignEdit:  (name)                 => AuditLog.write('CAMPAIGN_EDIT',       { name }),
    campaignDelete:(name)                 => AuditLog.write('CAMPAIGN_DELETE',     { name }),
    userLogin:     ()                     => AuditLog.write('USER_LOGIN',          {}),
    userLogout:    ()                     => AuditLog.write('USER_LOGOUT',         {}),
    userCreate:    (username, role)       => AuditLog.write('USER_CREATE',         { username, role }),
    userUpdate:    (username)             => AuditLog.write('USER_UPDATE',         { username }),
    userDelete:    (username)             => AuditLog.write('USER_DELETE',         { username }),
    centerCreate:  (centerId)             => AuditLog.write('CENTER_CREATE',       { centerId }),

    // ─── Load & Render ───────────────────────────────────────────────────
    _logs: [],
    _lastDoc: null,
    _loading: false,

    load: async (reset = true) => {
        if (AuditLog._loading) return;
        AuditLog._loading = true;
        if (reset) { AuditLog._logs = []; AuditLog._lastDoc = null; }

        try {
            let query = AuditLog._col()
                .orderBy('ts', 'desc')
                .limit(AuditLog.BATCH_SIZE);

            if (AuditLog._lastDoc) {
                query = query.startAfter(AuditLog._lastDoc);
            }

            const snap = await query.get();
            snap.forEach(doc => {
                AuditLog._logs.push({ id: doc.id, ...doc.data() });
            });

            AuditLog._lastDoc = snap.docs[snap.docs.length - 1] || null;
            AuditLog._hasMore = snap.docs.length === AuditLog.BATCH_SIZE;
        } catch (e) {
            console.warn('AuditLog.load:', e.message);
        }
        AuditLog._loading = false;
        AuditLog.renderPage();
    },

    // ─── Filter state ─────────────────────────────────────────────────────
    _filterUser: '',
    _filterAction: '',

    // ─── Render audit log page ────────────────────────────────────────────
    renderPage: () => {
        const container = document.getElementById('page-auditlog');
        if (!container) return;

        // Shell ถ้ายังไม่มี
        if (!document.getElementById('auditlog-tbody')) {
            AuditLog._renderShell(container);
        }

        AuditLog._renderTable();
    },

    _renderShell: (container) => {
        container.innerHTML = `
        <!-- Header -->
        <div class="h-12 bg-gray-900 text-white flex items-center justify-between px-4 shrink-0 border-b-2 border-amber-500">
            <div class="flex items-center gap-3">
                <button onclick="SidebarCtrl.toggle()" class="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center transition">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>
                <span class="text-base font-black text-indigo-400">Route<span class="text-white">Plan</span></span>
            </div>
            <span class="text-xs text-gray-400 font-bold">📋 Audit Log</span>
        </div>

        <!-- Toolbar -->
        <div class="bg-white border-b border-gray-100 px-4 py-2.5 flex flex-wrap gap-2 items-center shrink-0 shadow-sm">
            <!-- User filter -->
            <input type="text" id="auditlog-filter-user" placeholder="🔍 กรองตาม user..."
                oninput="AuditLog._filterUser=this.value;AuditLog._renderTable()"
                class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 w-40 font-medium">

            <!-- Action filter -->
            <select id="auditlog-filter-action" onchange="AuditLog._filterAction=this.value;AuditLog._renderTable()"
                class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-300 font-medium">
                <option value="">ทุก Action</option>
                ${Object.entries(AuditLog.ACTIONS).map(([k, v]) =>
                    `<option value="${k}">${v.icon} ${v.label}</option>`
                ).join('')}
            </select>

            <button onclick="AuditLog.load(true)"
                class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm">
                🔄 โหลดใหม่
            </button>

            <button onclick="AuditLog.exportCsv()"
                class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm">
                📥 Export CSV
            </button>

            <span id="auditlog-count" class="text-xs text-gray-400 font-medium ml-auto"></span>
        </div>

        <!-- Table -->
        <div class="flex-1 overflow-y-auto bg-slate-50 p-4">
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table class="w-full text-sm">
                    <thead class="bg-gray-50 border-b border-gray-100 sticky top-0">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-bold text-gray-500">เวลา</th>
                            <th class="px-4 py-3 text-left text-xs font-bold text-gray-500">User</th>
                            <th class="px-4 py-3 text-left text-xs font-bold text-gray-500">Action</th>
                            <th class="px-4 py-3 text-left text-xs font-bold text-gray-500">รายละเอียด</th>
                        </tr>
                    </thead>
                    <tbody id="auditlog-tbody">
                        <tr><td colspan="4" class="text-center py-10 text-gray-400">กำลังโหลด...</td></tr>
                    </tbody>
                </table>
            </div>

            <!-- Load more -->
            <div class="text-center mt-4" id="auditlog-loadmore">
                <button onclick="AuditLog.load(false)"
                    class="bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-6 py-2.5 rounded-xl text-sm font-bold transition shadow-sm hidden"
                    id="auditlog-loadmore-btn">
                    โหลดเพิ่มเติม...
                </button>
            </div>
        </div>`;

        // โหลด logs ทันทีหลัง render shell
        AuditLog.load(true);
    },

    _renderTable: () => {
        const tbody = document.getElementById('auditlog-tbody');
        if (!tbody) return;

        const fu = AuditLog._filterUser.toLowerCase();
        const fa = AuditLog._filterAction;

        const filtered = AuditLog._logs.filter(log => {
            if (fu && !(log.username || '').toLowerCase().includes(fu) &&
                      !(log.displayName || '').toLowerCase().includes(fu)) return false;
            if (fa && log.actionKey !== fa) return false;
            return true;
        });

        const countEl = document.getElementById('auditlog-count');
        if (countEl) countEl.textContent = `แสดง ${filtered.length} รายการ`;

        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-gray-400 text-sm">ไม่พบรายการที่ตรงกัน</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.slice(0, AuditLog.MAX_DISPLAY).map((log, i) => {
            const ts = log.tsLocal ? new Date(log.tsLocal) : null;
            const timeStr = ts ? ts.toLocaleString('th-TH', {
                day: '2-digit', month: 'short', year: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            }) : '—';

            const roleColor = {
                admin:      'bg-violet-100 text-violet-700',
                supervisor: 'bg-blue-100 text-blue-700',
                sales:      'bg-emerald-100 text-emerald-700',
            }[log.role] || 'bg-gray-100 text-gray-600';

            const detailStr = AuditLog._formatDetails(log.details || {});

            return `
            <tr class="border-b border-gray-50 hover:bg-amber-50/30 transition ${i % 2 === 0 ? '' : 'bg-gray-50/50'}">
                <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap font-mono">${timeStr}</td>
                <td class="px-4 py-3">
                    <div class="font-bold text-gray-800 text-xs">${log.displayName || log.username}</div>
                    <span class="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full ${roleColor} mt-0.5">${log.role}</span>
                </td>
                <td class="px-4 py-3">
                    <span class="text-base">${log.icon || '📌'}</span>
                    <span class="text-xs font-bold text-gray-700 ml-1">${log.label || log.actionKey}</span>
                </td>
                <td class="px-4 py-3 text-xs text-gray-500 max-w-[280px]">
                    <div class="truncate" title="${detailStr}">${detailStr}</div>
                </td>
            </tr>`;
        }).join('');

        // show/hide load more button
        const btn = document.getElementById('auditlog-loadmore-btn');
        if (btn) btn.classList.toggle('hidden', !AuditLog._hasMore);
    },

    _formatDetails: (details) => {
        if (!details || !Object.keys(details).length) return '—';
        return Object.entries(details)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => {
                const labels = {
                    route: 'สาย', day: 'วัน', storeCount: 'ร้าน',
                    from: 'จาก', to: 'ไปยัง', name: 'ชื่อ', ym: 'เดือน',
                    rows: 'แถว', routes: 'สาย', cycleDays: 'วัน/รอบ',
                    oldName: 'ชื่อเดิม', newName: 'ชื่อใหม่',
                    username: 'username', role: 'role', centerId: 'ศูนย์',
                    routeCount: 'สาย', totalStores: 'ร้าน', storeId: 'ID',
                    mode: 'mode',
                };
                const label = labels[k] || k;
                return `${label}: ${Array.isArray(v) ? v.join(', ') : v}`;
            })
            .join(' | ');
    },

    // ─── Export CSV ───────────────────────────────────────────────────────
    exportCsv: () => {
        const headers = ['เวลา', 'Username', 'DisplayName', 'Role', 'Action', 'Label', 'รายละเอียด'];
        const rows = AuditLog._logs.map(log => [
            log.tsLocal || '',
            log.username || '',
            log.displayName || '',
            log.role || '',
            log.actionKey || '',
            log.label || '',
            AuditLog._formatDetails(log.details || {})
        ]);

        const csv = [headers, ...rows]
            .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const now  = new Date();
        a.href = url;
        a.download = `AuditLog_${window.CENTER_ID || 'all'}_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    },
};

// ==========================================
// 🔌 Hooks — เพิ่ม AuditLog.write() เข้าฟังก์ชันหลัก
// ใส่ไว้ใน DOMContentLoaded เพื่อรอให้ App โหลดเสร็จก่อน
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // รอให้ทุก module โหลดเสร็จก่อน patch
    setTimeout(() => {
        _patchAuditLog();
    }, 500);
});

function _patchAuditLog() {

    // ── App.addRoute ─────────────────────────────────────────────────────
    if (typeof App !== 'undefined') {
        const _origAddRoute = App.addRoute;
        App.addRoute = function() {
            // patch ผ่าน confirm button ใน modal ไม่ได้โดยตรง
            // ให้ wrap saveDB แทน
            _origAddRoute.apply(this, arguments);
        };

        // ── App.deleteRoute ───────────────────────────────────────────────
        const _origDeleteRoute = App.deleteRoute;
        App.deleteRoute = function() {
            const name = State.localActiveRoute;
            const _origShowConfirm = UI.showConfirm;
            UI.showConfirm = function(msg, onConfirm, onCancel) {
                UI.showConfirm = _origShowConfirm; // restore ทันที
                _origShowConfirm(msg, () => {
                    AuditLog.routeDelete(name);
                    if (onConfirm) onConfirm();
                }, onCancel);
            };
            _origDeleteRoute.apply(this, arguments);
        };

        // ── App.createDraft ───────────────────────────────────────────────
        const _origCreateDraft = App.createDraft;
        App.createDraft = async function(ym) {
            await _origCreateDraft.call(this, ym);
            AuditLog.draftCreate(ym);
        };

        // ── App.activateDraft ─────────────────────────────────────────────
        const _origActivate = App.activateDraft;
        App.activateDraft = async function(ym) {
            await _origActivate.call(this, ym);
            AuditLog.draftActivate(ym);
        };

        // ── App.switchPlanMode ────────────────────────────────────────────
        const _origSwitch = App.switchPlanMode;
        App.switchPlanMode = async function(mode) {
            await _origSwitch.call(this, mode);
            AuditLog.planSwitch(mode);
        };

        // ── App.handleMapUpload (route upload) ────────────────────────────
        const _origMapUpload = App.handleMapUpload;
        App.handleMapUpload = function(e) {
            const route = State.localActiveRoute;
            _origMapUpload.call(this, e);
            // log หลัง timeout ให้ State.stores update ก่อน
            setTimeout(() => {
                AuditLog.routeUpload(route, State.stores.length);
            }, 500);
        };

        // ── App.clearAllAssignments ───────────────────────────────────────
        const _origClear = App.clearAllAssignments;
        App.clearAllAssignments = function() {
            const route = State.localActiveRoute;
            _origClear.call(this);
            AuditLog.routeClear(route);
        };
    }

    // ── StoreMgr.assignSelected ───────────────────────────────────────────
    if (typeof StoreMgr !== 'undefined') {
        const _origAssign = StoreMgr.assignSelected;
        StoreMgr.assignSelected = function() {
            const ds = document.getElementById('assign-day');
            const day = ds ? ds.value : '';
            const cnt = State.stores.filter(s => s.selected).length;
            _origAssign.apply(this, arguments);
            if (cnt > 0) AuditLog.storeAssign(State.localActiveRoute, day, cnt);
        };

        const _origChangeDay = StoreMgr.changeDay;
        StoreMgr.changeDay = function(id, d) {
            _origChangeDay.call(this, id, d);
            if (d === 'remove') {
                AuditLog.storeRemove(State.localActiveRoute, id);
            } else {
                AuditLog.storeAssign(State.localActiveRoute, d, 1);
            }
        };
    }

    // ── StoreTrans.confirm ────────────────────────────────────────────────
    if (typeof StoreTrans !== 'undefined') {
        const _origTransConfirm = StoreTrans.confirm;
        StoreTrans.confirm = async function() {
            const srcEl = document.getElementById('transfer-src-route');
            const dstEl = document.getElementById('transfer-dst-route');
            const src = srcEl ? srcEl.value : '';
            const dst = dstEl ? dstEl.value : '';
            const cnt = StoreTrans._selectedIds.size;
            await _origTransConfirm.call(this);
            if (cnt > 0) AuditLog.storeTransfer(src, dst, cnt);
        };
    }

    // ── AI.calc ───────────────────────────────────────────────────────────
    if (typeof AI !== 'undefined') {
        const _origCalc = AI.calc;
        AI.calc = function(k, lock, limit, mxD) {
            const storeCount = State.stores.filter(s => !s.days || !s.days.length).length;
            _origCalc.call(this, k, lock, limit, mxD);
            AuditLog.aiRun(k, storeCount);
        };
    }

    // ── KPIMgr.deployToSales ──────────────────────────────────────────────
    if (typeof KPIMgr !== 'undefined') {
        const _origDeploy = KPIMgr.deployToSales;
        KPIMgr.deployToSales = function() {
            const cnt = State.previewSales ? Object.keys(State.previewSales).length : 0;
            _origDeploy.call(this);
            AuditLog.kpiDeploy(cnt);
        };
    }

    // ── RawDataMgr.clearAll ───────────────────────────────────────────────
    if (typeof RawDataMgr !== 'undefined') {
        const _origClearRaw = RawDataMgr.clearAll;
        RawDataMgr.clearAll = function() {
            const _origShowConfirm2 = UI.showConfirm;
            UI.showConfirm = function(msg, onConfirm, onCancel) {
                UI.showConfirm = _origShowConfirm2;
                _origShowConfirm2(msg, () => {
                    AuditLog.rawClear();
                    if (onConfirm) onConfirm();
                }, onCancel);
            };
            _origClearRaw.call(this);
        };
    }

    // ── Dashboard._saveTargets ────────────────────────────────────────────
    if (typeof Dashboard !== 'undefined') {
        const _origSaveTargets = Dashboard._saveTargets;
        Dashboard._saveTargets = async function() {
            await _origSaveTargets.call(this);
            const ym = Dashboard._currentYM;
            const routes = Dashboard._getRoutes().length;
            AuditLog.targetSave(ym, routes);
        };

        // ── Dashboard._onFileUpload (Sellout) ─────────────────────────────
        const _origFileUpload = Dashboard._onFileUpload;
        Dashboard._onFileUpload = async function(evt) {
            const file = evt.target.files[0];
            const ym = file ? Dashboard._detectYM(file.name) : '';
            await _origFileUpload.call(this, evt);
            if (ym) AuditLog.selloutUpload(ym, '(โหลดเสร็จ)');
        };
    }

    // ── SkuDist campaign actions ──────────────────────────────────────────
    if (typeof SkuDist !== 'undefined') {
        const _origSaveCampaign = SkuDist.saveCampaign;
        SkuDist.saveCampaign = async function() {
            const name = document.getElementById('skudist-c-name')?.value?.trim() || '';
            const isEdit = !!SkuDist._editingId;
            await _origSaveCampaign.call(this);
            isEdit ? AuditLog.campaignEdit(name) : AuditLog.campaignCreate(name);
        };

        const _origDeleteCampaign = SkuDist.deleteCampaign;
        SkuDist.deleteCampaign = function(id) {
            const c = SkuDist._campaigns.find(x => x.id === id);
            const name = c ? c.name : id;
            _origDeleteCampaign.call(this, id);
            AuditLog.campaignDelete(name);
        };
    }

    // ── FileManager.bulkImport ────────────────────────────────────────────
    if (typeof FileManager !== 'undefined') {
        const _origBulkImport = FileManager.bulkImport;
        FileManager.bulkImport = function(event) {
            // patch ใน reader.onload ไม่ได้ง่าย — log หลัง UI.showSaveToast แทน
            const _origToast = UI.showSaveToast;
            UI.showSaveToast = function(msg) {
                UI.showSaveToast = _origToast;
                _origToast.call(UI, msg);
                if (msg.includes('Bulk Import')) {
                    const routes = Object.keys(State.db.routes).length;
                    const total  = Object.values(State.db.routes).reduce((s, r) => s + (r || []).length, 0);
                    AuditLog.bulkImport(routes, total);
                }
            };
            _origBulkImport.call(this, event);
        };
    }

    console.log('✅ AuditLog patches applied');
}

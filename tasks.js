// ==========================================
// 📌 Tasks App — จัดการ "งานที่ต้องส่ง" แสดงในปฏิทิน Sales
// ==========================================

// Guard: admin + supervisor (supervisor ล็อคเฉพาะศูนย์ตัวเอง)
const _session = Auth.guard(['admin', 'supervisor']);
if (!_session) throw new Error('Unauthorized');

document.getElementById('session-info').textContent = `${_session.displayName} (${_session.role})`;

const TasksApp = {
    _db: () => firebase.firestore(),
    _centers: {},        // { "402": { name, docId }, ... } — admin เท่านั้น
    _centerId: null,     // ศูนย์ที่กำลังดู/แก้ไขอยู่
    _routeList: [],       // รายชื่อสายของศูนย์นั้น (สำหรับ checklist "เจาะจงสาย")
    _tasks: [],
    _scope: 'center',     // 'center' | 'routes' — state ของฟอร์มที่เปิดอยู่
    _dateType: 'once',    // 'once' | 'monthly'
    _editingId: null,

    // ─── Init ────────────────────────────────────────────────────────────
    init: async () => {
        if (_session.role === 'supervisor') {
            // Supervisor: ล็อคศูนย์ตัวเอง ห้ามสลับ
            if (!_session.centerId) {
                document.querySelector('main').innerHTML = '<p class="text-center text-red-500 font-bold py-10">⚠️ บัญชีนี้ยังไม่ได้ผูกกับศูนย์</p>';
                return;
            }
            const wrap = document.getElementById('center-select-wrap');
            wrap.innerHTML = `<div class="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold text-gray-700">🏢 ศูนย์ ${_session.centerId}</div>`;
            TasksApp._centerId = _session.centerId;
            await TasksApp.load();
        } else {
            // Admin: โหลดรายชื่อศูนย์ทั้งหมดมาให้เลือก
            const cSnap = await TasksApp._db().collection('appData').doc('app_centers').get();
            TasksApp._centers = cSnap.exists ? (cSnap.data().centers || {}) : {};
            const ids = Object.keys(TasksApp._centers).sort();
            const sel = document.getElementById('center-select');
            sel.innerHTML = ids.map(id => `<option value="${id}">${id} — ${TasksApp._centers[id].name || 'ศูนย์ ' + id}</option>`).join('');

            const params = new URLSearchParams(window.location.search);
            const preselect = params.get('center');
            TasksApp._centerId = (preselect && ids.includes(preselect)) ? preselect : ids[0];
            if (TasksApp._centerId) sel.value = TasksApp._centerId;

            if (TasksApp._centerId) await TasksApp.load();
        }
    },

    onCenterChange: async (centerId) => {
        TasksApp._centerId = centerId;
        await TasksApp.load();
    },

    // ─── Load ────────────────────────────────────────────────────────────
    load: async () => {
        if (!TasksApp._centerId) return;
        const tbody = document.getElementById('task-table-body');
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-400">กำลังโหลด...</td></tr>';
        try {
            const centerDoc = TasksApp._centerId + '_main';
            const [taskSnap, centerSnap] = await Promise.all([
                TasksApp._db().collection('appData').doc(centerDoc).collection('tasks').get(),
                TasksApp._db().collection('appData').doc(centerDoc).get(),
            ]);
            TasksApp._tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            TasksApp._routeList = (centerSnap.exists ? (centerSnap.data().routeList || []) : [])
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            TasksApp.renderTable();
        } catch (err) {
            TasksApp.toast('❌ โหลดไม่สำเร็จ: ' + ErrorMsg.translate(err), true);
        }
    },

    // ─── Render Table ────────────────────────────────────────────────────
    renderTable: () => {
        const tbody = document.getElementById('task-table-body');
        if (!TasksApp._tasks.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-400 text-sm">ยังไม่มีงานที่ตั้งไว้สำหรับศูนย์นี้</td></tr>';
            return;
        }
        tbody.innerHTML = TasksApp._tasks.map(t => {
            const scopeHtml = t.scope === 'routes'
                ? `<span class="scope-routes px-2.5 py-1 rounded-full text-xs font-bold">🚚 ${(t.routes || []).length} สาย</span>
                   <div class="flex flex-wrap gap-1 mt-1">${(t.routes || []).slice(0, 4).map(r => `<span class="route-chip">${r}</span>`).join('')}${(t.routes || []).length > 4 ? `<span class="route-chip">+${t.routes.length - 4}</span>` : ''}</div>`
                : `<span class="scope-center px-2.5 py-1 rounded-full text-xs font-bold">🏢 ทั้งศูนย์</span>`;
            const dateHtml = t.dateType === 'monthly'
                ? `🔁 ทุกวันที่ ${t.dayOfMonth}`
                : `📅 ${t.date ? new Date(t.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}`;
            return `
            <tr class="border-b border-gray-50 hover:bg-gray-50/60 transition align-top">
                <td class="px-4 py-3">
                    <div class="font-bold text-gray-800 text-sm">${t.title}</div>
                    ${t.desc ? `<div class="text-xs text-gray-400 mt-0.5">${t.desc}</div>` : ''}
                </td>
                <td class="px-4 py-3">${scopeHtml}</td>
                <td class="px-4 py-3 text-sm text-gray-600 font-medium">${dateHtml}</td>
                <td class="px-4 py-3 text-center">
                    <button onclick="TasksApp.toggleActive('${t.id}', ${!!t.active})"
                        class="px-2.5 py-1 rounded-full text-xs font-bold transition ${t.active ? 'badge-active' : 'badge-inactive'}">
                        ${t.active ? 'Active' : 'Inactive'}
                    </button>
                </td>
                <td class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-2">
                        <button onclick="TasksApp.openEdit('${t.id}')"
                            class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-bold transition border border-indigo-100">✏️ แก้ไข</button>
                        <button onclick="TasksApp.confirmDelete('${t.id}')"
                            class="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-bold transition border border-red-100">🗑️ ลบ</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    },

    // ─── Modal: Scope / DateType toggles ─────────────────────────────────
    setScope: (scope) => {
        TasksApp._scope = scope;
        document.getElementById('scope-btn-center').className = 'flex-1 py-2 rounded-xl text-sm font-bold border transition ' +
            (scope === 'center' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200');
        document.getElementById('scope-btn-routes').className = 'flex-1 py-2 rounded-xl text-sm font-bold border transition ' +
            (scope === 'routes' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200');
        document.getElementById('routes-picker').classList.toggle('hidden', scope !== 'routes');
    },

    setDateType: (type) => {
        TasksApp._dateType = type;
        document.getElementById('date-btn-once').className = 'flex-1 py-2 rounded-xl text-sm font-bold border transition ' +
            (type === 'once' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200');
        document.getElementById('date-btn-monthly').className = 'flex-1 py-2 rounded-xl text-sm font-bold border transition ' +
            (type === 'monthly' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200');
        document.getElementById('f-date-once').classList.toggle('hidden', type !== 'once');
        document.getElementById('f-date-monthly-wrap').classList.toggle('hidden', type !== 'monthly');
        document.getElementById('f-date-monthly-wrap').classList.toggle('flex', type === 'monthly');
    },

    _renderRoutesChecklist: (selected = []) => {
        const box = document.getElementById('routes-checklist');
        if (!TasksApp._routeList.length) {
            box.innerHTML = '<div class="col-span-3 text-gray-400 text-center py-2">ไม่พบรายชื่อสายของศูนย์นี้</div>';
            return;
        }
        box.innerHTML = TasksApp._routeList.map(r => `
            <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" value="${r}" class="route-check w-3.5 h-3.5 text-indigo-600 rounded" ${selected.includes(r) ? 'checked' : ''}>
                <span class="font-mono font-bold text-gray-700">${r}</span>
            </label>`).join('');
    },

    // ─── Open Modal (Create / Edit) ──────────────────────────────────────
    openCreate: () => {
        TasksApp._editingId = null;
        document.getElementById('modal-title').textContent = 'เพิ่มงาน';
        document.getElementById('f-title').value = '';
        document.getElementById('f-desc').value = '';
        document.getElementById('f-date-once').value = '';
        document.getElementById('f-date-monthly').value = '';
        document.getElementById('f-active').checked = true;
        TasksApp._renderRoutesChecklist([]);
        TasksApp.setScope('center');
        TasksApp.setDateType('once');
        document.getElementById('task-modal').classList.remove('hidden');
    },

    openEdit: (id) => {
        const t = TasksApp._tasks.find(x => x.id === id);
        if (!t) return;
        TasksApp._editingId = id;
        document.getElementById('modal-title').textContent = 'แก้ไขงาน';
        document.getElementById('f-title').value = t.title || '';
        document.getElementById('f-desc').value = t.desc || '';
        document.getElementById('f-date-once').value = t.date || '';
        document.getElementById('f-date-monthly').value = t.dayOfMonth || '';
        document.getElementById('f-active').checked = !!t.active;
        TasksApp._renderRoutesChecklist(t.routes || []);
        TasksApp.setScope(t.scope === 'routes' ? 'routes' : 'center');
        TasksApp.setDateType(t.dateType === 'monthly' ? 'monthly' : 'once');
        document.getElementById('task-modal').classList.remove('hidden');
    },

    closeModal: () => document.getElementById('task-modal').classList.add('hidden'),

    // ─── Save (Create / Update) ──────────────────────────────────────────
    save: async () => {
        const title = document.getElementById('f-title').value.trim();
        if (!title) return TasksApp.toast('⚠️ กรุณากรอกชื่องาน', true);

        let routes = [];
        if (TasksApp._scope === 'routes') {
            routes = Array.from(document.querySelectorAll('.route-check:checked')).map(el => el.value);
            if (!routes.length) return TasksApp.toast('⚠️ กรุณาเลือกอย่างน้อย 1 สาย', true);
        }

        let date = null, dayOfMonth = null;
        if (TasksApp._dateType === 'once') {
            date = document.getElementById('f-date-once').value;
            if (!date) return TasksApp.toast('⚠️ กรุณาเลือกวันที่', true);
        } else {
            dayOfMonth = parseInt(document.getElementById('f-date-monthly').value);
            if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return TasksApp.toast('⚠️ กรุณากรอกวันที่ 1-31', true);
        }

        const payload = {
            title,
            desc: document.getElementById('f-desc').value.trim() || '',
            scope: TasksApp._scope,
            routes: TasksApp._scope === 'routes' ? routes : [],
            dateType: TasksApp._dateType,
            date: TasksApp._dateType === 'once' ? date : null,
            dayOfMonth: TasksApp._dateType === 'monthly' ? dayOfMonth : null,
            active: document.getElementById('f-active').checked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        const btn = document.getElementById('btn-save');
        btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
        try {
            const col = TasksApp._db().collection('appData').doc(TasksApp._centerId + '_main').collection('tasks');
            if (TasksApp._editingId) {
                await col.doc(TasksApp._editingId).set(payload, { merge: true });
            } else {
                payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await col.add(payload);
            }
            TasksApp.closeModal();
            TasksApp.toast('✅ บันทึกเรียบร้อยแล้ว');
            await TasksApp.load();
        } catch (err) {
            TasksApp.toast('❌ บันทึกไม่สำเร็จ: ' + ErrorMsg.translate(err), true);
        } finally {
            btn.disabled = false; btn.textContent = 'บันทึก';
        }
    },

    toggleActive: async (id, current) => {
        try {
            await TasksApp._db().collection('appData').doc(TasksApp._centerId + '_main')
                .collection('tasks').doc(id).set({ active: !current }, { merge: true });
            await TasksApp.load();
        } catch (err) {
            TasksApp.toast('❌ อัปเดตไม่สำเร็จ: ' + ErrorMsg.translate(err), true);
        }
    },

    confirmDelete: (id) => {
        const t = TasksApp._tasks.find(x => x.id === id);
        if (!t) return;
        if (!confirm(`ลบงาน "${t.title}" ใช่ไหมครับ?`)) return;
        TasksApp._delete(id);
    },

    _delete: async (id) => {
        try {
            await TasksApp._db().collection('appData').doc(TasksApp._centerId + '_main')
                .collection('tasks').doc(id).delete();
            TasksApp.toast('🗑️ ลบเรียบร้อยแล้ว');
            await TasksApp.load();
        } catch (err) {
            TasksApp.toast('❌ ลบไม่สำเร็จ: ' + ErrorMsg.translate(err), true);
        }
    },

    // ─── Toast ───────────────────────────────────────────────────────────
    toast: (msg, isError = false) => {
        const el = document.getElementById('toast');
        const msgEl = document.getElementById('toast-msg');
        msgEl.textContent = msg;
        el.className = el.className.replace(/bg-(gray-900|red-600)/, isError ? 'bg-red-600' : 'bg-gray-900');
        el.classList.remove('translate-y-24', 'opacity-0');
        clearTimeout(el._tid);
        el._tid = setTimeout(() => el.classList.add('translate-y-24', 'opacity-0'), 3000);
    },
};

TasksApp.init();

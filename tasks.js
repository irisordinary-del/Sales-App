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
    _calYear: new Date().getFullYear(),
    _calMonth: new Date().getMonth(), // 0-indexed
    _dayModalDate: null,  // 'YYYY-MM-DD' ของวันที่กำลังเปิด day modal อยู่

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
        const grid = document.getElementById('task-calendar-grid');
        if (grid) grid.innerHTML = '<div class="col-span-7 text-center py-10 text-gray-400 text-sm">กำลังโหลด...</div>';
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
            TasksApp.renderCalendar();
        } catch (err) {
            TasksApp.toast('❌ โหลดไม่สำเร็จ: ' + ErrorMsg.translate(err), true);
        }
    },

    // ─── หางานที่ตรงกับวันที่ระบุ (เช็คทั้งแบบครั้งเดียวและซ้ำทุกเดือน) ─────
    _tasksForDate: (dateObj) => {
        const d = dateObj.getDate();
        const iso = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return TasksApp._tasks.filter(t => t.dateType === 'monthly' ? t.dayOfMonth === d : t.date === iso);
    },

    // ─── Calendar navigation ─────────────────────────────────────────────
    prevMonth: () => {
        TasksApp._calMonth--;
        if (TasksApp._calMonth < 0) { TasksApp._calMonth = 11; TasksApp._calYear--; }
        TasksApp.renderCalendar();
    },
    nextMonth: () => {
        TasksApp._calMonth++;
        if (TasksApp._calMonth > 11) { TasksApp._calMonth = 0; TasksApp._calYear++; }
        TasksApp.renderCalendar();
    },

    // ─── Render Calendar Grid ────────────────────────────────────────────
    renderCalendar: () => {
        const labelEl = document.getElementById('cal-month-label');
        const grid = document.getElementById('task-calendar-grid');
        if (!labelEl || !grid) return;

        const y = TasksApp._calYear, m = TasksApp._calMonth;
        labelEl.textContent = new Date(y, m, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });

        const firstDow     = new Date(y, m, 1).getDay();
        const daysInMonth  = new Date(y, m + 1, 0).getDate();
        const now          = new Date();

        let html = '';
        for (let i = 0; i < firstDow; i++) html += '<div></div>';

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj  = new Date(y, m, d);
            const iso      = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday  = d === now.getDate() && m === now.getMonth() && y === now.getFullYear();
            const dayTasks = TasksApp._tasksForDate(dateObj);
            const hasTask       = dayTasks.length > 0;
            const hasActiveTask = dayTasks.some(t => t.active);

            let cellBg = '#fff', cellBorder = '#f3f4f6';
            if (hasActiveTask)      { cellBg = '#fffbeb'; cellBorder = '#fcd34d'; }
            else if (hasTask)       { cellBg = '#f9fafb'; cellBorder = '#e5e7eb'; }
            if (isToday) cellBorder = '#6366f1';

            // ✅ แสดงทุกงานเป็นรายบรรทัด แทนการยุบรวมเป็น "N งาน"
            const taskLines = dayTasks.map(t => `
                <div title="${t.title}" style="font-size:9px;font-weight:800;line-height:1.35;color:${t.active ? '#92400e' : '#9ca3af'};
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">📌 ${t.title}</div>
            `).join('');

            html += `
            <div onclick="TasksApp.openDay('${iso}')"
                style="min-height:66px;border-radius:10px;border:1.5px solid ${cellBorder};background:${cellBg};
                       padding:5px 4px;cursor:pointer;display:flex;flex-direction:column;gap:2px;transition:transform .1s,box-shadow .1s;"
                onmouseover="this.style.boxShadow='0 2px 6px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
                <div style="font-size:12px;font-weight:${isToday ? '900' : '700'};color:${isToday ? '#4338ca' : '#111827'};">${d}${isToday ? ' •' : ''}</div>
                ${taskLines}
            </div>`;
        }
        grid.innerHTML = html;
    },

    // ─── Day Detail Modal ────────────────────────────────────────────────
    openDay: (iso) => {
        TasksApp._dayModalDate = iso;
        const [y, m, d] = iso.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        document.getElementById('day-modal-title').textContent =
            dateObj.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const tasks = TasksApp._tasksForDate(dateObj);
        const list = document.getElementById('day-task-list');
        list.innerHTML = tasks.length ? tasks.map(t => `
            <div class="border border-gray-100 rounded-xl p-3 bg-gray-50">
                <div class="flex justify-between items-start gap-2">
                    <div class="min-w-0">
                        <div class="font-bold text-sm text-gray-800">${t.title}</div>
                        ${t.desc ? `<div class="text-xs text-gray-400 mt-0.5">${t.desc}</div>` : ''}
                        <div class="flex flex-wrap gap-1 mt-1.5">
                            <span class="${t.scope === 'routes' ? 'scope-routes' : 'scope-center'} px-2 py-0.5 rounded-full text-[10px] font-bold">
                                ${t.scope === 'routes' ? '🚚 เจาะจงสาย' : '🏢 ทั้งศูนย์'}
                            </span>
                            ${t.dateType === 'monthly' ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600">🔁 ทุกเดือน</span>' : ''}
                            <span class="${t.active ? 'badge-active' : 'badge-inactive'} px-2 py-0.5 rounded-full text-[10px] font-bold">${t.active ? 'Active' : 'Inactive'}</span>
                        </div>
                        ${t.scope === 'routes' ? `<div class="flex flex-wrap gap-1 mt-1.5">${(t.routes || []).map(r => `<span class="route-chip">${r}</span>`).join('')}</div>` : ''}
                    </div>
                    <div class="flex flex-col gap-1.5 shrink-0 items-end">
                        <button onclick="TasksApp.openEdit('${t.id}')" class="text-xs font-bold text-indigo-600 hover:underline">แก้ไข</button>
                        <button onclick="TasksApp.confirmDelete('${t.id}')" class="text-xs font-bold text-red-500 hover:underline">ลบ</button>
                    </div>
                </div>
            </div>`).join('')
            : '<p class="text-sm text-gray-400 text-center py-3">ยังไม่มีงานวันนี้</p>';

        document.getElementById('day-modal').classList.remove('hidden');
    },

    closeDayModal: () => document.getElementById('day-modal').classList.add('hidden'),

    openCreateForDay: () => TasksApp.openCreate(TasksApp._dayModalDate),

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
    // prefillDate: 'YYYY-MM-DD' ไม่บังคับ — ใช้ตอนเปิดจากการคลิกวันในปฏิทิน
    openCreate: (prefillDate) => {
        document.getElementById('day-modal')?.classList.add('hidden');
        TasksApp._editingId = null;
        document.getElementById('modal-title').textContent = 'เพิ่มงาน';
        document.getElementById('f-title').value = '';
        document.getElementById('f-desc').value = '';
        document.getElementById('f-date-once').value = prefillDate || '';
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
        document.getElementById('day-modal')?.classList.add('hidden');
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
            dateType: TasksApp._dateType,
            active: document.getElementById('f-active').checked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        // ✅ FIX: อย่าส่ง field ที่ไม่เกี่ยวกับโหมดที่เลือกเป็น null — Firestore rule เช็คว่า
        // "ถ้ามี key นี้ ต้องเป็น number/list เท่านั้น" ซึ่ง null ก็ยังนับว่า "มี key" อยู่ดี
        // ทำให้ save โดนปฏิเสธ (permission-denied) ทั้งที่ user กรอกถูกทุกอย่าง
        // ตอนสร้างใหม่ (add) ให้ "ไม่ใส่ key" ไปเลยถ้าไม่เกี่ยว ส่วนตอนแก้ไข (merge) ให้ลบ key
        // เดิมทิ้งด้วย FieldValue.delete() กันข้อมูลค้าง (เช่นเปลี่ยนจากรายเดือน → ครั้งเดียว)
        const isEdit = !!TasksApp._editingId;
        const DEL = firebase.firestore.FieldValue.delete();

        if (TasksApp._scope === 'routes') payload.routes = routes;
        else if (isEdit) payload.routes = DEL;

        if (TasksApp._dateType === 'once') {
            payload.date = date;
            if (isEdit) payload.dayOfMonth = DEL;
        } else {
            payload.dayOfMonth = dayOfMonth;
            if (isEdit) payload.date = DEL;
        }

        const btn = document.getElementById('btn-save');
        btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
        try {
            const col = TasksApp._db().collection('appData').doc(TasksApp._centerId + '_main').collection('tasks');
            if (isEdit) {
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
            document.getElementById('day-modal')?.classList.add('hidden');
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

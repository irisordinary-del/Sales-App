// ==========================================
// 👥 Users App — User Management Logic
// ==========================================

// Guard: admin only
const _session = Auth.guard(['admin']);
if (!_session) throw new Error('Unauthorized');

document.getElementById('session-info').textContent = `${_session.displayName} (${_session.role})`;

const UsersApp = {
    _allUsers:  [],
    _centers:   {},   // { "402": { name, docId }, ... }
    _editingUsername: null,

    // ─── Load ─────────────────────────────────────────────────────────────
    load: async () => {
        try {
            const db = firebase.firestore();
            // โหลด users
            UsersApp._allUsers = await Auth.getAllUsers();

            // โหลด centers list
            const cSnap = await db.collection('appData').doc('app_centers').get();
            UsersApp._centers = cSnap.exists ? (cSnap.data().centers || {}) : {};

            UsersApp._populateCenterSelects();
            UsersApp.renderTable(UsersApp._allUsers);
            UsersApp.updateStats(UsersApp._allUsers);
        } catch (err) {
            UsersApp.toast('❌ โหลดไม่สำเร็จ: ' + err.message, true);
        }
    },

    // ─── Populate center <select> ──────────────────────────────────────
    _populateCenterSelects: () => {
        const opts = Object.keys(UsersApp._centers).sort().map(id =>
            `<option value="${id}">${id} — ${UsersApp._centers[id].name || 'ศูนย์ ' + id}</option>`
        ).join('');
        const addOpt = '<option value="">— ไม่ระบุ (Admin) —</option>' + opts;
        document.getElementById('f-center').innerHTML = addOpt;
        document.getElementById('gen-center').innerHTML = '<option value="">— เลือกศูนย์ —</option>' + opts;
    },

    // ─── Render Table ──────────────────────────────────────────────────
    renderTable: (users) => {
        const tbody = document.getElementById('user-table-body');
        if (!users.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-10 text-gray-400 text-sm">ไม่พบ user</td></tr>';
            return;
        }

        const roleLabel = { admin: 'Admin', supervisor: 'Supervisor', sales: 'Sales' };
        const roleClass = { admin: 'role-admin', supervisor: 'role-supervisor', sales: 'role-sales' };

        tbody.innerHTML = users.map(u => `
            <tr class="border-b border-gray-50 hover:bg-gray-50/60 transition">
                <td class="px-4 py-3">
                    <span class="font-black text-gray-800 text-sm font-mono">${u.username}</span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">${u.displayName || '—'}</td>
                <td class="px-4 py-3">
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold ${roleClass[u.role] || 'bg-gray-100 text-gray-600'}">
                        ${roleLabel[u.role] || u.role}
                    </span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-500 font-mono">${u.centerId || '—'}</td>
                <td class="px-4 py-3 text-center">
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold ${u.active ? 'badge-active' : 'badge-inactive'}">
                        ${u.active ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-2">
                        <button onclick="UsersApp.openEdit('${u.username}')"
                            class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-bold transition border border-indigo-100">
                            ✏️ แก้ไข
                        </button>
                        <button onclick="UsersApp.confirmDelete('${u.username}')"
                            class="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-bold transition border border-red-100">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>`).join('');
    },

    // ─── Stats ────────────────────────────────────────────────────────────
    updateStats: (users) => {
        document.getElementById('stat-total').textContent      = users.length;
        document.getElementById('stat-admin').textContent      = users.filter(u => u.role === 'admin').length;
        document.getElementById('stat-supervisor').textContent = users.filter(u => u.role === 'supervisor').length;
        document.getElementById('stat-sales').textContent      = users.filter(u => u.role === 'sales').length;
    },

    // ─── Filter ──────────────────────────────────────────────────────────
    filter: (val) => {
        const q = val.toLowerCase().trim();
        const filtered = q
            ? UsersApp._allUsers.filter(u =>
                u.username.toLowerCase().includes(q) ||
                (u.role || '').toLowerCase().includes(q) ||
                (u.centerId || '').toLowerCase().includes(q) ||
                (u.displayName || '').toLowerCase().includes(q)
              )
            : UsersApp._allUsers;
        UsersApp.renderTable(filtered);
    },

    // ─── Modal: Create ────────────────────────────────────────────────────
    openCreate: () => {
        UsersApp._editingUsername = null;
        document.getElementById('modal-title').textContent = '➕ เพิ่ม User';
        document.getElementById('f-username').value     = '';
        document.getElementById('f-username').disabled  = false;
        document.getElementById('f-displayname').value  = '';
        document.getElementById('f-password').value     = '';
        document.getElementById('f-role').value         = 'sales';
        document.getElementById('f-center').value       = '';
        document.getElementById('f-active').checked     = true;
        document.getElementById('pw-hint').textContent  = '(จำเป็น)';
        UsersApp.onRoleChange();
        document.getElementById('user-modal').classList.remove('hidden');
    },

    // ─── Modal: Edit ──────────────────────────────────────────────────────
    openEdit: (username) => {
        const u = UsersApp._allUsers.find(x => x.username === username);
        if (!u) return;
        UsersApp._editingUsername = username;
        document.getElementById('modal-title').textContent = '✏️ แก้ไข User: ' + username;
        document.getElementById('f-username').value     = u.username;
        document.getElementById('f-username').disabled  = true;
        document.getElementById('f-displayname').value  = u.displayName || '';
        document.getElementById('f-password').value     = '';
        document.getElementById('f-role').value         = u.role || 'sales';
        document.getElementById('f-center').value       = u.centerId || '';
        document.getElementById('f-active').checked     = u.active !== false;
        document.getElementById('pw-hint').textContent  = '(เว้นว่างถ้าไม่เปลี่ยน)';
        UsersApp.onRoleChange();
        document.getElementById('user-modal').classList.remove('hidden');
    },

    closeModal: () => {
        document.getElementById('user-modal').classList.add('hidden');
        UsersApp._editingUsername = null;
    },

    // Role change → ซ่อน/แสดง center field
    onRoleChange: () => {
        const role = document.getElementById('f-role').value;
        const cf   = document.getElementById('center-field');
        cf.style.opacity  = role === 'admin' ? '0.4' : '1';
        cf.style.pointerEvents = role === 'admin' ? 'none' : 'auto';
        if (role === 'admin') document.getElementById('f-center').value = '';
    },

    // ─── Save User (create or update) ────────────────────────────────────
    saveUser: async () => {
        const btn = document.getElementById('btn-save');
        btn.disabled = true;
        btn.textContent = 'กำลังบันทึก...';

        try {
            const username    = document.getElementById('f-username').value.trim().toUpperCase();
            const displayName = document.getElementById('f-displayname').value.trim();
            const password    = document.getElementById('f-password').value;
            const role        = document.getElementById('f-role').value;
            const centerId    = document.getElementById('f-center').value || null;
            const active      = document.getElementById('f-active').checked;

            if (!username) throw new Error('กรุณากรอก Username');
            if (!UsersApp._editingUsername && !password) throw new Error('กรุณากรอก Password สำหรับ user ใหม่');

            if (UsersApp._editingUsername) {
                // Update
                const updates = { displayName, role, centerId, active };
                if (password) updates.password = password;
                UsersApp._allUsers = await Auth.updateUser(username, updates);
                UsersApp.toast('✅ อัปเดต user เรียบร้อย');
            } else {
                // Create
                UsersApp._allUsers = await Auth.createUser({ username, password, role, centerId, displayName });
                UsersApp.toast('✅ สร้าง user เรียบร้อย');
            }

            UsersApp.renderTable(UsersApp._allUsers);
            UsersApp.updateStats(UsersApp._allUsers);
            UsersApp.closeModal();
        } catch (err) {
            UsersApp.toast('❌ ' + err.message, true);
        } finally {
            btn.disabled = false;
            btn.textContent = 'บันทึก';
        }
    },

    // ─── Delete ──────────────────────────────────────────────────────────
    confirmDelete: (username) => {
        if (!confirm(`ยืนยันลบ user "${username}"?\nการลบไม่สามารถย้อนกลับได้`)) return;
        Auth.deleteUser(username).then(users => {
            UsersApp._allUsers = users;
            UsersApp.renderTable(users);
            UsersApp.updateStats(users);
            UsersApp.toast(`🗑️ ลบ "${username}" เรียบร้อย`);
        }).catch(err => UsersApp.toast('❌ ' + err.message, true));
    },

    // ─── Gen from Routes ─────────────────────────────────────────────────
    openGenRoutes: () => {
        document.getElementById('gen-preview').classList.add('hidden');
        document.getElementById('gen-center').value   = '';
        document.getElementById('gen-password').value = '1234';
        document.getElementById('gen-modal').classList.remove('hidden');
    },

    closeGenModal: () => {
        document.getElementById('gen-modal').classList.add('hidden');
    },

    _getRoutesForCenter: async (centerId) => {
        const db     = firebase.firestore();
        const docId  = UsersApp._centers[centerId]?.docId || (centerId + '_main');
        const snap   = await db.collection('appData').doc(docId).get();
        return snap.exists ? (snap.data().routeList || []) : [];
    },

    previewGen: async () => {
        const centerId = document.getElementById('gen-center').value;
        if (!centerId) { UsersApp.toast('กรุณาเลือกศูนย์ก่อน', true); return; }

        try {
            const routes   = await UsersApp._getRoutesForCenter(centerId);
            const existing = new Set(UsersApp._allUsers.map(u => u.username.toUpperCase()));
            const newOnes  = routes.filter(r => !existing.has(r.toUpperCase()));

            const prev = document.getElementById('gen-preview');
            prev.classList.remove('hidden');

            if (!newOnes.length) {
                prev.innerHTML = '<p class="text-emerald-600 font-bold">✅ ทุกสายมี user แล้ว ไม่ต้อง gen เพิ่ม</p>';
            } else {
                prev.innerHTML = `<p class="font-bold text-gray-700 mb-2">จะสร้าง ${newOnes.length} user ใหม่:</p>` +
                    newOnes.map(r => `<span class="inline-block bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-mono text-xs mr-1 mb-1">${r}</span>`).join('');
            }
        } catch (err) {
            UsersApp.toast('❌ ' + err.message, true);
        }
    },

    confirmGen: async () => {
        const centerId = document.getElementById('gen-center').value;
        const password = document.getElementById('gen-password').value || '1234';
        if (!centerId) { UsersApp.toast('กรุณาเลือกศูนย์ก่อน', true); return; }

        try {
            const routes = await UsersApp._getRoutesForCenter(centerId);
            if (!routes.length) { UsersApp.toast('ศูนย์นี้ยังไม่มีสายวิ่ง', true); return; }

            const result = await Auth.genUsersFromRoutes(centerId, routes, password);
            UsersApp._allUsers = await Auth.getAllUsers();
            UsersApp.renderTable(UsersApp._allUsers);
            UsersApp.updateStats(UsersApp._allUsers);
            UsersApp.closeGenModal();
            UsersApp.toast(`✅ Gen เสร็จ! เพิ่ม ${result.added} user ใหม่ (รวม ${result.total} คน)`);
        } catch (err) {
            UsersApp.toast('❌ ' + err.message, true);
        }
    },

    // ─── Toast ────────────────────────────────────────────────────────────
    toast: (msg, isError = false) => {
        const t = document.getElementById('toast');
        t.style.background = isError ? '#dc2626' : '#111827';
        document.getElementById('toast-msg').textContent = msg;
        t.classList.remove('translate-y-24', 'opacity-0');
        setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), 2800);
    }
};

// ─── Init ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => UsersApp.load());

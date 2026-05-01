/**
 * ===================================================================
 * ADMIN PANEL - USER MANAGEMENT
 * ===================================================================
 * 
 * Show only to Admin users
 * - Create new users
 * - Assign roles
 * - Assign warehouses
 * - View activity log
 * 
 * ===================================================================
 */

const AdminPanel = {
    users: [],
    
    init: () => {
        if(Auth.userRole !== 'Admin') return;
        
        AdminPanel.renderAdminNav();
        AdminPanel.loadUsers();
    },
    
    renderAdminNav: () => {
        const nav = document.querySelector('nav');
        if(!nav) return;
        
        const adminBtn = document.createElement('button');
        adminBtn.className = 'sidebar-menu w-full flex items-center px-4 md:px-5 py-3.5 text-sm font-bold';
        adminBtn.innerHTML = '<span class="text-lg md:mr-3">⚙️</span> <span class="hidden md:inline">Admin Settings</span>';
        adminBtn.onclick = () => Nav.go('admin');
        
        nav.appendChild(adminBtn);
    },
    
    loadUsers: async () => {
        try {
            const snapshot = await firebase.firestore()
                .collection('users')
                .orderBy('email')
                .get();
            
            AdminPanel.users = snapshot.docs.map(doc => ({
                uid: doc.id,
                ...doc.data()
            }));
            
            AdminPanel.render();
            
        } catch(err) {
            console.error('Load users error:', err);
        }
    },
    
    render: () => {
        const container = document.getElementById('admin-content');
        if(!container) return;
        
        let html = `
            <div class="p-6 space-y-6">
                <h1 class="text-3xl font-black text-gray-900">⚙️ Admin Settings</h1>
                
                <!-- Add User Section -->
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <h2 class="text-lg font-bold text-gray-800 mb-4">➕ เพิ่มผู้ใช้ใหม่</h2>
                    <div class="space-y-4">
                        <input type="email" id="new-user-email" placeholder="อีเมล" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                        <select id="new-user-role" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                            <option value="">เลือกบทบาท</option>
                            <option value="Admin">Admin</option>
                            <option value="Manager Region">Manager Region</option>
                            <option value="District Manager">District Manager</option>
                            <option value="Sales">Sales</option>
                        </select>
                        <select id="new-user-warehouse" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                            <option value="">เลือกศูนย์กระจาย (ถ้าจำเป็น)</option>
                            <option value="402">402 - Yong Seng</option>
                            <option value="403">403</option>
                            <option value="404">404</option>
                            <option value="405">405</option>
                            <option value="406">406</option>
                            <option value="407">407</option>
                        </select>
                        <button onclick="AdminPanel.createUser()" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-bold">
                            ✅ สร้างผู้ใช้
                        </button>
                    </div>
                </div>
                
                <!-- Users List -->
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <h2 class="text-lg font-bold text-gray-800 mb-4">👥 รายชื่อผู้ใช้</h2>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="bg-gray-100 border-b border-gray-300">
                                <tr>
                                    <th class="p-3 text-left">อีเมล</th>
                                    <th class="p-3 text-left">บทบาท</th>
                                    <th class="p-3 text-left">ศูนย์กระจาย</th>
                                    <th class="p-3 text-left">สร้างเมื่อ</th>
                                    <th class="p-3 text-center">การกระทำ</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${AdminPanel.users.map(user => `
                                    <tr class="border-b border-gray-200 hover:bg-gray-50">
                                        <td class="p-3">${user.email}</td>
                                        <td class="p-3">
                                            <select onchange="AdminPanel.updateRole('${user.uid}', this.value)" class="px-2 py-1 border border-gray-300 rounded text-xs">
                                                <option value="Admin" ${user.role === 'Admin' ? 'selected' : ''}>Admin</option>
                                                <option value="Manager Region" ${user.role === 'Manager Region' ? 'selected' : ''}>Manager Region</option>
                                                <option value="District Manager" ${user.role === 'District Manager' ? 'selected' : ''}>District Manager</option>
                                                <option value="Sales" ${user.role === 'Sales' ? 'selected' : ''}>Sales</option>
                                            </select>
                                        </td>
                                        <td class="p-3">
                                            ${user.role === 'Admin' || user.role === 'Manager Region' ? 
                                                '<span class="text-gray-400">—</span>' : 
                                                `<select onchange="AdminPanel.updateWarehouse('${user.uid}', this.value)" class="px-2 py-1 border border-gray-300 rounded text-xs">
                                                    <option value="">ไม่มี</option>
                                                    <option value="402" ${user.warehouse === '402' ? 'selected' : ''}>402</option>
                                                    <option value="403" ${user.warehouse === '403' ? 'selected' : ''}>403</option>
                                                    <option value="404" ${user.warehouse === '404' ? 'selected' : ''}>404</option>
                                                    <option value="405" ${user.warehouse === '405' ? 'selected' : ''}>405</option>
                                                    <option value="406" ${user.warehouse === '406' ? 'selected' : ''}>406</option>
                                                    <option value="407" ${user.warehouse === '407' ? 'selected' : ''}>407</option>
                                                </select>`
                                            }
                                        </td>
                                        <td class="p-3 text-xs text-gray-400">
                                            ${user.createdAt ? new Date(user.createdAt.toDate()).toLocaleDateString('th-TH') : '—'}
                                        </td>
                                        <td class="p-3 text-center">
                                            <button onclick="AdminPanel.deleteUser('${user.uid}')" class="text-red-600 hover:text-red-800 font-bold text-xs">🗑️ ลบ</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    },
    
    createUser: async () => {
        const email = document.getElementById('new-user-email').value;
        const role = document.getElementById('new-user-role').value;
        const warehouse = document.getElementById('new-user-warehouse').value;
        
        if(!email || !role) {
            alert('กรุณากรอกอีเมล และ เลือกบทบาท');
            return;
        }
        
        try {
            UI.showLoader('กำลังสร้างผู้ใช้...', email);
            
            // Create user via Cloud Function (you need to set this up)
            const response = await fetch('https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/createUser', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, role, warehouse })
            });
            
            if(response.ok) {
                UI.hideLoader();
                UI.showSaveToast('✅ สร้างผู้ใช้สำเร็จ');
                
                document.getElementById('new-user-email').value = '';
                document.getElementById('new-user-role').value = '';
                document.getElementById('new-user-warehouse').value = '';
                
                await AdminPanel.loadUsers();
            } else {
                throw new Error(await response.text());
            }
        } catch(err) {
            UI.hideLoader();
            UI.showSaveToast('❌ สร้างผู้ใช้ไม่สำเร็จ: ' + err.message);
        }
    },
    
    updateRole: async (uid, newRole) => {
        try {
            await firebase.firestore().collection('users').doc(uid).update({
                role: newRole
            });
            UI.showSaveToast('✅ อัพเดตบทบาท');
        } catch(err) {
            UI.showSaveToast('❌ อัพเดตไม่สำเร็จ');
        }
    },
    
    updateWarehouse: async (uid, warehouse) => {
        try {
            await firebase.firestore().collection('users').doc(uid).update({
                warehouse: warehouse || null
            });
            UI.showSaveToast('✅ อัพเดตศูนย์กระจาย');
        } catch(err) {
            UI.showSaveToast('❌ อัพเดตไม่สำเร็จ');
        }
    },
    
    deleteUser: async (uid) => {
        if(!confirm('ลบผู้ใช้นี้ใช่ไหม?')) return;
        
        try {
            await firebase.firestore().collection('users').doc(uid).delete();
            UI.showSaveToast('✅ ลบผู้ใช้สำเร็จ');
            await AdminPanel.loadUsers();
        } catch(err) {
            UI.showSaveToast('❌ ลบไม่สำเร็จ');
        }
    }
};

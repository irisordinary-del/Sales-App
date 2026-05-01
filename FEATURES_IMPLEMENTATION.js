/**
 * ===================================================================
 * ROUTE PLANNER ADMIN - 6 NEW FEATURES IMPLEMENTATION
 * ===================================================================
 * 
 * Feature 1: Reset Button (ยกเลิกการจัดสายวิ่งทั้งหมด)
 * Feature 2: Login + User Roles (Firebase Auth + Role-based Access)
 * Feature 3: Mobile Responsive (Tailwind breakpoints + hamburger menu)
 * Feature 4: Remove KPI/Raw Data pages (ลบ tab แต่เก็บ logic)
 * Feature 5: Sales Data Management (Upload Excel + Parse + Table)
 * Feature 6: Dashboard as homepage (Stats + Charts)
 * 
 * ===================================================================
 */

// ==================== FEATURE 1: RESET BUTTON ====================

const ResetMgr = {
    confirmReset: () => {
        if(confirm('⚠️ ยกเลิกการจัดสายวิ่ง ALL ROUTES ใช่ไหม?\n\nการทำเช่นนี้จะลบข้อมูลการจัดสายของ Route ปัจจุบันเท่านั้น')) {
            ResetMgr.executeReset();
        }
    },
    
    executeReset: async () => {
        try {
            UI.showLoader('กำลังรีเซ็ต...', 'กำลังเคลียร์ข้อมูลการจัดสาย');
            
            // Reset all stores' days and seqs
            State.stores.forEach(store => {
                store.days = [];
                store.seqs = {};
                store.selected = false;
            });
            
            // Save to Firebase
            await DB.save();
            
            // Re-render UI
            UI.render();
            MapCtrl.renderMarkers();
            MapCtrl.drawLines();
            
            UI.hideLoader();
            UI.showSaveToast('✅ รีเซ็ตเสร็จสิ้น');
        } catch(err) {
            console.error('Reset error:', err);
            UI.hideLoader();
            UI.showSaveToast('❌ เกิดข้อผิดพลาด: ' + err.message);
        }
    },
    
    resetAllRoutes: async () => {
        if(!confirm('⚠️ ยกเลิกการจัดสายวิ่ง ALL ROUTES ทั้งหมด?\n\nการทำเช่นนี้จะลบข้อมูลการจัดสายของทั้งหมด')) return;
        
        try {
            UI.showLoader('กำลังรีเซ็ททั้งหมด...', 'กำลังเคลียร์ข้อมูล');
            
            // Reset ALL routes
            for(let routeName in State.db.routes) {
                State.db.routes[routeName].forEach(store => {
                    store.days = [];
                    store.seqs = {};
                    store.selected = false;
                });
            }
            
            await DB.save();
            UI.hideLoader();
            UI.showSaveToast('✅ รีเซ็ททั้งหมดเสร็จสิ้น');
            
            // Reload page
            setTimeout(() => window.location.reload(), 1500);
        } catch(err) {
            console.error('Reset all error:', err);
            UI.hideLoader();
            UI.showSaveToast('❌ เกิดข้อผิดพลาด');
        }
    }
};

// ==================== FEATURE 2: LOGIN & USER ROLES ====================

const Auth = {
    currentUser: null,
    userRole: null,
    userWarehouse: null,
    
    init: async () => {
        // Initialize Firebase Auth
        firebase.auth().onAuthStateChanged(async (user) => {
            if(user) {
                Auth.currentUser = user;
                await Auth.loadUserRole();
                Auth.showMainApp();
            } else {
                Auth.showLoginScreen();
            }
        });
    },
    
    loadUserRole: async () => {
        try {
            const doc = await firebase.firestore().collection('users').doc(Auth.currentUser.uid).get();
            if(doc.exists) {
                Auth.userRole = doc.data().role;
                Auth.userWarehouse = doc.data().warehouse;
            } else {
                // Default role: Sales
                Auth.userRole = 'Sales';
                Auth.userWarehouse = null;
            }
            Auth.checkAccessControl();
        } catch(err) {
            console.error('Load user role error:', err);
        }
    },
    
    checkAccessControl: () => {
        // Hide/Show UI based on role
        const adminOnlyElements = document.querySelectorAll('[data-role="admin"]');
        const managerElements = document.querySelectorAll('[data-role="manager"]');
        const dmElements = document.querySelectorAll('[data-role="dm"]');
        
        if(Auth.userRole === 'Admin') {
            adminOnlyElements.forEach(el => el.classList.remove('hidden'));
            managerElements.forEach(el => el.classList.remove('hidden'));
            dmElements.forEach(el => el.classList.remove('hidden'));
        } else if(Auth.userRole === 'Manager Region') {
            adminOnlyElements.forEach(el => el.classList.add('hidden'));
            managerElements.forEach(el => el.classList.remove('hidden'));
            dmElements.forEach(el => el.classList.remove('hidden'));
        } else if(Auth.userRole === 'District Manager') {
            adminOnlyElements.forEach(el => el.classList.add('hidden'));
            managerElements.forEach(el => el.classList.add('hidden'));
            dmElements.forEach(el => el.classList.remove('hidden'));
        } else {
            // Sales
            adminOnlyElements.forEach(el => el.classList.add('hidden'));
            managerElements.forEach(el => el.classList.add('hidden'));
            dmElements.forEach(el => el.classList.add('hidden'));
        }
        
        // Update warehouse selector based on role
        Auth.filterWarehouseAccess();
    },
    
    filterWarehouseAccess: () => {
        // If Manager Region -> can see all warehouses
        // If Sales -> can only see own warehouse
        // If Admin -> can see all
        if(Auth.userRole === 'Sales' && Auth.userWarehouse) {
            const routeSelector = document.getElementById('routeSelector');
            if(routeSelector) {
                Array.from(routeSelector.options).forEach(opt => {
                    if(!opt.value.includes(Auth.userWarehouse)) {
                        opt.style.display = 'none';
                    }
                });
            }
        }
    },
    
    showLoginScreen: () => {
        document.getElementById('app-container').classList.add('hidden');
        document.getElementById('login-container').classList.remove('hidden');
    },
    
    showMainApp: () => {
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        
        // Update header with user info
        const userHeader = document.getElementById('user-header-info');
        if(userHeader) {
            userHeader.innerHTML = `
                <span class="text-xs">${Auth.currentUser.email}</span>
                <span class="text-[10px] text-gray-400">${Auth.userRole}</span>
            `;
        }
    },
    
    login: async (email, password) => {
        try {
            UI.showLoader('กำลังเข้าสู่ระบบ...', email);
            await firebase.auth().signInWithEmailAndPassword(email, password);
        } catch(err) {
            UI.hideLoader();
            alert('❌ เข้าสู่ระบบไม่สำเร็จ: ' + err.message);
        }
    },
    
    logout: async () => {
        try {
            await firebase.auth().signOut();
            Auth.currentUser = null;
            Auth.userRole = null;
            Auth.showLoginScreen();
        } catch(err) {
            console.error('Logout error:', err);
        }
    }
};

// ==================== FEATURE 3: MOBILE RESPONSIVE ====================

const Mobile = {
    isOpen: false,
    
    init: () => {
        // Add hamburger menu button
        const sidebar = document.querySelector('aside');
        if(sidebar) {
            const hamburger = document.createElement('button');
            hamburger.id = 'mobile-hamburger';
            hamburger.className = 'md:hidden fixed top-4 left-4 z-[7000] bg-slate-900 text-white p-2 rounded-lg border border-slate-700';
            hamburger.innerHTML = '☰';
            hamburger.onclick = Mobile.toggleSidebar;
            document.body.insertBefore(hamburger, document.body.firstChild);
        }
        
        // Add responsive styles
        const style = document.createElement('style');
        style.innerHTML = `
            @media (max-width: 768px) {
                aside {
                    position: fixed;
                    left: 0;
                    top: 0;
                    height: 100vh;
                    width: 100%;
                    z-index: 6999;
                    transform: translateX(-100%);
                    transition: transform 0.3s ease;
                }
                
                aside.mobile-open {
                    transform: translateX(0);
                }
                
                .mobile-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0,0,0,0.5);
                    z-index: 6998;
                    display: none;
                }
                
                .mobile-overlay.active {
                    display: block;
                }
                
                #mobile-hamburger {
                    display: block !important;
                }
                
                .flex-1 {
                    width: 100% !important;
                }
            }
            
            @media (min-width: 769px) {
                #mobile-hamburger {
                    display: none !important;
                }
                
                aside {
                    transform: translateX(0) !important;
                }
            }
        `;
        document.head.appendChild(style);
    },
    
    toggleSidebar: () => {
        const sidebar = document.querySelector('aside');
        const overlay = document.querySelector('.mobile-overlay');
        
        if(!Mobile.isOpen) {
            sidebar.classList.add('mobile-open');
            if(!overlay) {
                const newOverlay = document.createElement('div');
                newOverlay.className = 'mobile-overlay active';
                newOverlay.onclick = Mobile.toggleSidebar;
                document.body.appendChild(newOverlay);
            } else {
                overlay.classList.add('active');
            }
            Mobile.isOpen = true;
        } else {
            sidebar.classList.remove('mobile-open');
            const overlay = document.querySelector('.mobile-overlay');
            if(overlay) overlay.classList.remove('active');
            Mobile.isOpen = false;
        }
    }
};

// ==================== FEATURE 4: REMOVE KPI/RAW DATA PAGES ====================

const PageManager = {
    init: () => {
        // Hide KPI and Raw Data nav items
        const navKpi = document.getElementById('nav-kpi');
        const navData = document.getElementById('nav-data');
        
        if(navKpi) navKpi.classList.add('hidden');
        if(navData) navData.classList.add('hidden');
        
        // Hide KPI and Data pages
        const pageKpi = document.getElementById('page-kpi');
        const pageData = document.getElementById('page-data');
        
        if(pageKpi) pageKpi.classList.add('hidden');
        if(pageData) pageData.classList.add('hidden');
        
        // Keep logic but don't display
        // KPI calculations still happen in background via KPIMgr
        // Raw data still processed via DataMgr
        console.log('✅ KPI & Raw Data pages hidden (logic preserved)');
    }
};

// ==================== FEATURE 5: SALES DATA MANAGEMENT ====================

const SalesDataMgr = {
    data: [],
    filteredData: [],
    
    // Columns to keep (skip S-AC and AI-AQ)
    COLUMNS_TO_KEEP: [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'AR', 'AS', 'AT'
    ],
    
    COLUMN_NAMES: {
        'A': 'Region Name',
        'B': 'Distributor Code',
        'C': 'Distributor Name',
        'D': 'Salesman Code',
        'E': 'Salesman Type',
        'F': 'Customer Code',
        'G': 'Customer Name',
        'H': 'Shop Type',
        'I': 'SO Number',
        'J': 'SO Create Date',
        'K': 'SO Suggest Delivery',
        'L': 'SO Status',
        'M': 'Product Code',
        'N': 'Product Name',
        'O': 'Category',
        'P': 'Brand',
        'Q': 'Selling Type',
        'R': 'Product Type',
        'AR': 'KPI Date',
        'AS': 'Brand Bonus',
        'AT': 'BB Point'
    },
    
    uploadFile: async (file) => {
        try {
            UI.showLoader('กำลังอ่านไฟล์...', file.name);
            
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const workbook = XLSX.read(e.target.result, { header: true });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
                    resolve(rows);
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
            
            // Filter columns: keep only needed ones, skip S-AC and AI-AQ
            SalesDataMgr.data = data.map(row => {
                const filteredRow = {};
                SalesDataMgr.COLUMNS_TO_KEEP.forEach(col => {
                    if(row[col] !== undefined) {
                        filteredRow[col] = row[col];
                    }
                });
                return filteredRow;
            }).filter(row => Object.values(row).some(v => v)); // Filter empty rows
            
            SalesDataMgr.filteredData = [...SalesDataMgr.data];
            
            // Save to Firestore
            await SalesDataMgr.saveToDB();
            
            UI.hideLoader();
            UI.showSaveToast(`✅ อัปโหลด ${SalesDataMgr.data.length} แถว`);
            
            SalesDataMgr.renderTable();
        } catch(err) {
            UI.hideLoader();
            UI.showSaveToast('❌ อ่านไฟล์ไม่สำเร็จ: ' + err.message);
            console.error('Upload error:', err);
        }
    },
    
    saveToDB: async () => {
        try {
            const batchSize = 500;
            for(let i = 0; i < SalesDataMgr.data.length; i += batchSize) {
                const batch = firebase.firestore().batch();
                const chunk = SalesDataMgr.data.slice(i, i + batchSize);
                
                chunk.forEach((row, idx) => {
                    const docRef = firebase.firestore()
                        .collection('appData/v1_main/sales_data')
                        .doc(`row_${i + idx}`);
                    batch.set(docRef, row);
                });
                
                await batch.commit();
            }
        } catch(err) {
            console.error('Save to DB error:', err);
        }
    },
    
    renderTable: () => {
        const container = document.getElementById('sales-data-table-container');
        if(!container) return;
        
        // Create table header
        let html = `<table class="w-full border-collapse text-xs">
            <thead class="bg-gray-900 text-white sticky top-0">
                <tr>
                    ${SalesDataMgr.COLUMNS_TO_KEEP.map(col => 
                        `<th class="border border-gray-300 px-2 py-1 text-left whitespace-nowrap">${SalesDataMgr.COLUMN_NAMES[col] || col}</th>`
                    ).join('')}
                </tr>
            </thead>
            <tbody>`;
        
        // Create table rows
        SalesDataMgr.filteredData.slice(0, 100).forEach(row => {
            html += `<tr class="hover:bg-blue-50">`;
            SalesDataMgr.COLUMNS_TO_KEEP.forEach(col => {
                html += `<td class="border border-gray-200 px-2 py-1">${row[col] || ''}</td>`;
            });
            html += `</tr>`;
        });
        
        html += `</tbody></table>`;
        
        container.innerHTML = html;
    },
    
    filter: (searchTerm) => {
        const term = searchTerm.toLowerCase();
        SalesDataMgr.filteredData = SalesDataMgr.data.filter(row => 
            Object.values(row).some(val => String(val).toLowerCase().includes(term))
        );
        SalesDataMgr.renderTable();
    },
    
    exportToExcel: () => {
        if(SalesDataMgr.data.length === 0) {
            alert('ไม่มีข้อมูลให้ export');
            return;
        }
        
        const ws = XLSX.utils.json_to_sheet(SalesDataMgr.data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sales Data');
        XLSX.writeFile(wb, 'sales-data-export.xlsx');
    }
};

// ==================== FEATURE 6: DASHBOARD AS HOMEPAGE ====================

const Dashboard = {
    init: () => {
        Dashboard.render();
    },
    
    render: () => {
        const dashboardContainer = document.getElementById('page-dashboard');
        if(!dashboardContainer) return;
        
        let stats = Dashboard.calculateStats();
        
        let html = `
            <div class="p-6 space-y-6">
                <h1 class="text-3xl font-black text-gray-900">📊 Dashboard</h1>
                
                <!-- Stats Cards -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                        <p class="text-sm text-gray-500 font-bold mb-2">🏪 ร้านค้าทั้งหมด</p>
                        <p class="text-4xl font-black text-indigo-600">${stats.totalStores}</p>
                    </div>
                    
                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                        <p class="text-sm text-gray-500 font-bold mb-2">✅ จัดสายแล้ว</p>
                        <p class="text-4xl font-black text-emerald-600">${stats.assignedStores}</p>
                        <p class="text-xs text-gray-400 mt-2">${stats.assignmentPercent}%</p>
                    </div>
                    
                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                        <p class="text-sm text-gray-500 font-bold mb-2">⏳ ยังไม่จัด</p>
                        <p class="text-4xl font-black text-yellow-600">${stats.unassignedStores}</p>
                    </div>
                    
                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                        <p class="text-sm text-gray-500 font-bold mb-2">📦 สาย/Route</p>
                        <p class="text-4xl font-black text-purple-600">${stats.totalRoutes}</p>
                    </div>
                </div>
                
                <!-- Recent Routes -->
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <h2 class="text-lg font-bold text-gray-800 mb-4">📍 สายล่าสุด</h2>
                    <div class="space-y-2">
                        ${stats.recentRoutes.map(r => `
                            <div class="flex justify-between p-3 bg-gray-50 rounded-lg">
                                <span class="font-bold text-gray-800">${r.name}</span>
                                <span class="text-xs font-bold px-3 py-1 rounded-full ${r.assigned > r.total ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}">
                                    ${r.assigned}/${r.total}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        
        dashboardContainer.innerHTML = html;
    },
    
    calculateStats: () => {
        let totalStores = 0;
        let assignedStores = 0;
        let totalRoutes = Object.keys(State.db.routes).length;
        let recentRoutes = [];
        
        for(let routeName in State.db.routes) {
            const stores = State.db.routes[routeName];
            const assigned = stores.filter(s => s.days.length > 0).length;
            
            totalStores += stores.length;
            assignedStores += assigned;
            
            recentRoutes.push({
                name: routeName,
                total: stores.length,
                assigned: assigned
            });
        }
        
        recentRoutes = recentRoutes.slice(0, 5); // Show top 5
        
        return {
            totalStores,
            assignedStores,
            unassignedStores: totalStores - assignedStores,
            assignmentPercent: totalStores ? Math.round((assignedStores / totalStores) * 100) : 0,
            totalRoutes,
            recentRoutes
        };
    }
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize all features
    Auth.init();
    Mobile.init();
    PageManager.init();
    Dashboard.init();
    
    console.log('✅ All 6 features initialized');
});

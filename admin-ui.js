const Nav = {
    // หน้าปกติ (วางแผน/ข้อมูล/KPI)
    go: (page) => {
        document.querySelectorAll('.sidebar-menu').forEach(b => b.classList.remove('active', 'text-emerald-400'));
        let btn = document.getElementById('nav-' + page);
        if (btn) btn.classList.add('active');
        if (page === 'kpi') document.getElementById('nav-kpi').classList.add('text-emerald-400');

        // จัดการการแสดงผลหน้าจอ
        document.getElementById('page-planning').classList.add('hidden');
        document.getElementById('page-data').classList.add('hidden');
        document.getElementById('page-kpi').classList.add('hidden');
        document.getElementById('page-' + page).classList.remove('hidden');

        // เปิดแถบเครื่องมือด้านขวา และซ่อนป้ายบอกสี (Legend)
        let rp = document.getElementById('right-panel'); 
        if (rp) rp.style.display = 'flex';
        let leg = document.getElementById('all-routes-legend'); 
        if (leg) leg.classList.add('hidden');
        
        if (page === 'planning') {
            setTimeout(() => { if (MapCtrl.map) MapCtrl.map.invalidateSize(); UI.render(); }, 200);
        }
        if (page === 'kpi') KPIMgr.renderSetup(); 
    },

    // 🌟 หน้าพิเศษ: ดูแผนที่รวมทุกสายวิ่ง (Vans)
    goAllRoutes: () => {
        document.querySelectorAll('.sidebar-menu').forEach(b => b.classList.remove('active', 'text-emerald-400'));
        let btn = document.getElementById('nav-all-routes');
        if (btn) btn.classList.add('active');

        // ใช้หน้าจอ planning เป็นฐาน แต่จะสั่งซ่อนแถบเครื่องมือ
        document.getElementById('page-planning').classList.remove('hidden');
        document.getElementById('page-data').classList.add('hidden');
        document.getElementById('page-kpi').classList.add('hidden');

        // ซ่อนแถบขวาเพื่อให้แผนที่กางเต็มจอ
        let rp = document.getElementById('right-panel'); 
        if (rp) rp.style.display = 'none';

        // สั่งให้ MapCtrl วาดหมุดทุกสายวิ่ง
        if (typeof MapCtrl !== 'undefined') {
            MapCtrl.renderAllRoutes();
            setTimeout(() => { if (MapCtrl.map) MapCtrl.map.invalidateSize(); }, 300);
        }
    }
};

const UI = {
    timeout: null,
    showLoader: (text, sub) => { 
        document.getElementById('loader-text').innerText = text; 
        document.getElementById('loader-subtext').innerText = sub || ""; 
        document.getElementById('loader').style.display = 'flex'; 
    },
    hideLoader: () => document.getElementById('loader').style.display = 'none',
    
    showSaveToast: (msg) => { 
        let t = document.getElementById('save-toast'); 
        document.getElementById('toast-msg').innerText = msg; 
        t.classList.remove('translate-y-24', 'opacity-0'); 
        setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), 2500); 
    },

    switchTab: (tabId) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[onclick="UI.switchTab('${tabId}')"]`).classList.add('active');
        document.getElementById('tab1-content').classList.add('hidden');
        document.getElementById('tab2-content').classList.add('hidden');
        document.getElementById('tab3-content').classList.add('hidden');
        document.getElementById(tabId + '-content').classList.remove('hidden');
    },

    render: () => {
        if (UI.timeout) clearTimeout(UI.timeout);
        UI.timeout = setTimeout(() => {
            MapCtrl.renderMarkers();
            UI.renderStoreList();
            UI.renderSummary();
        }, 100);
    },

    renderStoreList: () => {
        let list = document.getElementById('storeList');
        if (!list) return;
        let h = State.stores.map(s => `
            <div class="p-3 border-b hover:bg-slate-50 flex items-center gap-3 ${s.selected ? 'bg-blue-50 border-blue-200' : ''}">
                <input type="checkbox" ${s.selected ? 'checked' : ''} onchange="StoreMgr.toggleSelect('${s.id}')">
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm truncate">${s.name}</p>
                    <p class="text-[10px] text-gray-400 font-mono">ID: ${s.id} | ${s.days.length > 0 ? '✅ '+s.days.join(', ') : '❌ รอจัดสาย'}</p>
                </div>
            </div>
        `).join('');
        list.innerHTML = h || '<p class="p-4 text-center text-gray-400 text-xs">ไม่มีข้อมูลร้านค้า</p>';
    },

    renderSummary: () => {
        let total = State.stores.length;
        let done = State.stores.filter(s => s.days.length > 0).length;
        let percent = total > 0 ? Math.round((done / total) * 100) : 0;
        
        let elStatus = document.getElementById('overall-status');
        if (elStatus) elStatus.innerText = `${done} / ${total} ร้าน (${percent}%)`;
    },

    openDayModal: (d) => {
        State.openDayModal = d;
        let stores = State.stores.filter(x => x.days.includes(d));
        document.getElementById('modalTitle').innerText = d;
        
        let h = stores.map(x => `
            <div class="p-3 border-b flex items-center gap-3">
                ${x.seqs[d] ? `<div class="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black">${x.seqs[d]}</div>` : ''}
                <div class="flex-1">
                    <p class="text-sm font-bold truncate text-gray-800">${x.name} ${x.freq === 2 ? '<span class="f2-badge">F2</span>' : ''}</p>
                    <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${x.id}</p>
                </div>
            </div>
        `).join('');
        document.getElementById('modalContent').innerHTML = h; 
        document.getElementById('dayModal').classList.remove('hidden');
    },

    closeDayModal: () => { 
        State.openDayModal = null; 
        document.getElementById('dayModal').classList.add('hidden'); 
    },

    showSummaryModal: () => {
        let h = []; 
        let sortedRoutes = Object.keys(State.db.routes).sort((a, b) => a.localeCompare(b, 'th', {numeric: true}));
        for (let r of sortedRoutes) { 
            let s = State.db.routes[r], t = s.length, a = s.filter(x => x.days.length).length; 
            h.push(`
                <tr>
                    <td class="p-3 font-bold border-b border-gray-100">${r}</td>
                    <td class="p-3 text-center border-b border-gray-100">${t}</td>
                    <td class="p-3 text-center text-emerald-600 font-bold border-b border-gray-100">${a}</td>
                    <td class="p-3 text-center text-yellow-600 font-bold border-b border-gray-100">${t - a}</td>
                    <td class="p-3 text-center border-b border-gray-100">${t > 0 ? Math.round((a / t) * 100) : 0}%</td>
                </tr>
            `); 
        }
        document.getElementById('overallTableBody').innerHTML = h.join('');
        document.getElementById('overallModal').classList.remove('hidden');
    }
};

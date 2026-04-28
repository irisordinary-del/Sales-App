const Nav = {
    go: (page) => {
        document.querySelectorAll('.sidebar-menu').forEach(b => b.classList.remove('active', 'text-emerald-400', 'text-sky-400'));
        let btn = document.getElementById('nav-' + page);
        if (btn) btn.classList.add('active');
        if (page === 'kpi') {
            let kpiBtn = document.getElementById('nav-kpi');
            if (kpiBtn) kpiBtn.classList.add('text-emerald-400');
        }

        ['planning', 'data', 'kpi'].forEach(p => {
            let el = document.getElementById('page-' + p);
            if (el) el.classList.add('hidden');
        });
        
        let targetPage = document.getElementById('page-' + page);
        if (targetPage) targetPage.classList.remove('hidden');

        let rp = document.getElementById('right-panel'); 
        if (rp) rp.style.display = 'flex';
        let leg = document.getElementById('all-routes-legend'); 
        if (leg) leg.classList.add('hidden');
        
        if (page === 'planning') {
            setTimeout(() => { 
                if (typeof MapCtrl !== 'undefined' && MapCtrl.map) {
                    MapCtrl.map.invalidateSize(); 
                    MapCtrl.renderMarkers();
                }
            }, 200);
        }
        if (page === 'kpi' && typeof KPIMgr !== 'undefined' && KPIMgr.renderSetup) {
            KPIMgr.renderSetup(); 
        }
    },
    goAllRoutes: () => {
        document.querySelectorAll('.sidebar-menu').forEach(b => b.classList.remove('active', 'text-emerald-400', 'text-sky-400'));
        let btn = document.getElementById('nav-all-routes');
        if (btn) btn.classList.add('active', 'text-sky-400');

        ['planning', 'data', 'kpi'].forEach(p => {
            let el = document.getElementById('page-' + p);
            if (el) el.classList.add('hidden');
        });
        
        let targetPage = document.getElementById('page-planning');
        if (targetPage) targetPage.classList.remove('hidden');

        // ซ่อนเมนูขวา กางแผนที่เต็มจอ
        let rp = document.getElementById('right-panel'); 
        if (rp) rp.style.display = 'none';

        if (typeof MapCtrl !== 'undefined' && MapCtrl.renderAllRoutes) {
            MapCtrl.renderAllRoutes();
            setTimeout(() => { if (MapCtrl.map) MapCtrl.map.invalidateSize(); }, 300);
        }
    }
};

const UI = {
    timeout: null,
    showLoader: (text, sub) => { 
        let elText = document.getElementById('loader-text'); if (elText) elText.innerText = text; 
        let elSub = document.getElementById('loader-subtext'); if (elSub) elSub.innerText = sub || ""; 
        let loader = document.getElementById('loader'); if (loader) loader.style.display = 'flex'; 
    },
    hideLoader: () => { 
        let loader = document.getElementById('loader'); if (loader) loader.style.display = 'none'; 
    },
    showSaveToast: (msg) => { 
        let t = document.getElementById('save-toast'); 
        let tm = document.getElementById('toast-msg');
        if (t && tm) {
            tm.innerText = msg; 
            t.classList.remove('translate-y-24', 'opacity-0'); 
            setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), 2500); 
        }
    },
    switchTab: (tabId) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        let btn = document.getElementById('btn-' + tabId);
        if (btn) btn.classList.add('active');
        ['tab1', 'tab2', 'tab3', 'tab4'].forEach(id => {
            let el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        let content = document.getElementById(tabId);
        if (content) content.classList.remove('hidden');
    },
    filterList: (listId, txt) => {
        let list = document.getElementById(listId);
        if (!list) return;
        let lowerTxt = txt.toLowerCase();
        Array.from(list.children).forEach(item => {
            let text = item.innerText.toLowerCase();
            item.style.display = text.includes(lowerTxt) ? 'flex' : 'none';
        });
    },
    render: () => {
        if (UI.timeout) clearTimeout(UI.timeout);
        UI.timeout = setTimeout(() => {
            if (typeof MapCtrl !== 'undefined') MapCtrl.renderMarkers();
        }, 100);
    },
    // 🌟 คืนชีพฟังก์ชันนี้ให้แล้วครับ อาการค้างจะหายไปทันที 🌟
    initDaySelector: () => {
        let sel = document.getElementById('assign-day');
        if(!sel) return;
        let days = (typeof State !== 'undefined' && State.db && State.db.cycleDays) ? State.db.cycleDays : 24;
        let h = '';
        for(let i=1; i<=days; i++) h += `<option value="Day ${i}">Day ${i}</option>`;
        sel.innerHTML = h;
    },
    showSummaryModal: () => { let el = document.getElementById('overallModal'); if (el) el.classList.remove('hidden'); },
    hideSummaryModal: () => { let el = document.getElementById('overallModal'); if (el) el.classList.add('hidden'); },
    closeDayModal: () => { let el = document.getElementById('dayModal'); if (el) el.classList.add('hidden'); }
};

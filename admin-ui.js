const UI = {
    showLoader: (text, subtext) => {
        const loader = document.getElementById('loader');
        if (loader) {
            document.getElementById('loader-text').textContent = text;
            document.getElementById('loader-subtext').textContent = subtext || '';
            loader.classList.remove('hidden');
        }
    },
    
    hideLoader: () => {
        const loader = document.getElementById('loader');
        if (loader) loader.classList.add('hidden');
    },
    
    showSaveToast: (msg) => {
        const toast = document.getElementById('save-toast');
        if (toast) {
            document.getElementById('toast-msg').textContent = msg;
            toast.classList.remove('translate-y-24', 'opacity-0');
            setTimeout(() => {
                toast.classList.add('translate-y-24', 'opacity-0');
            }, 3000);
        }
    },
    
    switchTab: (tabName) => {
        document.querySelectorAll('[id^="tab"]').forEach(el => el.classList.add('hidden'));
        document.getElementById(tabName)?.classList.remove('hidden');
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        document.querySelector(`button[onclick*="${tabName}"]`)?.classList.add('active');
    },
    
    render: () => {
        if (MapCtrl) {
            MapCtrl.clearAll();
            MapCtrl.renderMarkers();
        }
    },
    
    filterList: (listId, query) => {
        const list = document.getElementById(listId);
        if (!list) return;
        const items = list.querySelectorAll('[data-searchable]');
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(query.toLowerCase()) ? 'block' : 'none';
        });
    },
    
    showSummaryModal: () => {
        const modal = document.getElementById('overallModal');
        if (modal) modal.classList.remove('hidden');
    },
    
    hideSummaryModal: () => {
        const modal = document.getElementById('overallModal');
        if (modal) modal.classList.add('hidden');
    }
};

const Nav = {
    go: (page) => {
        document.querySelectorAll('[id^="page-"]').forEach(el => el.classList.add('hidden'));
        document.getElementById(`page-${page}`)?.classList.remove('hidden');
        document.querySelectorAll('[id^="nav-"]').forEach(el => el.classList.remove('active'));
        document.getElementById(`nav-${page}`)?.classList.add('active');
    }
};

console.log('✅ UI loaded');

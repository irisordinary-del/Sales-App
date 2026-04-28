var DAY_COLORS = {
    "Day 1": { name: "Day 1", hex: "#EF4444" }, "Day 2": { name: "Day 2", hex: "#F97316" },
    "Day 3": { name: "Day 3", hex: "#F59E0B" }, "Day 4": { name: "Day 4", hex: "#EAB308" },
    "Day 5": { name: "Day 5", hex: "#84CC16" }, "Day 6": { name: "Day 6", hex: "#22C55E" },
    "Day 7": { name: "Day 7", hex: "#10B981" }, "Day 8": { name: "Day 8", hex: "#14B8A6" },
    "Day 9": { name: "Day 9", hex: "#06B6D4" }, "Day 10": { name: "Day 10", hex: "#0EA5E9" },
    "Day 11": { name: "Day 11", hex: "#3B82F6" }, "Day 12": { name: "Day 12", hex: "#6366F1" },
    "Day 13": { name: "Day 13", hex: "#8B5CF6" }, "Day 14": { name: "Day 14", hex: "#A855F7" },
    "Day 15": { name: "Day 15", hex: "#D946EF" }, "Day 16": { name: "Day 16", hex: "#EC4899" },
    "Day 17": { name: "Day 17", hex: "#F43F5E" }, "Day 18": { name: "Day 18", hex: "#991B1B" },
    "Day 19": { name: "Day 19", hex: "#9A3412" }, "Day 20": { name: "Day 20", hex: "#B45309" },
    "Day 21": { name: "Day 21", hex: "#4D7C0F" }, "Day 22": { name: "Day 22", hex: "#15803D" },
    "Day 23": { name: "Day 23", hex: "#047857" }, "Day 24": { name: "Day 24", hex: "#0F766E" },
    "Day 25": { name: "Day 25", hex: "#0369A1" }, "Day 26": { name: "Day 26", hex: "#1D4ED8" },
    "Day 27": { name: "Day 27", hex: "#4338CA" }, "Day 28": { name: "Day 28", hex: "#6D28D9" },
    "Day 29": { name: "Day 29", hex: "#7E22CE" }, "Day 30": { name: "Day 30", hex: "#BE185D" }
};

var Nav = {
    go: (p) => {
        document.querySelectorAll('.sidebar-menu').forEach(x => x.classList.remove('active'));
        let btn = document.getElementById('nav-'+p); if(btn) btn.classList.add('active');
        let page = document.getElementById('page-planning'); if(page) page.classList.toggle('hidden', p !== 'planning');
        if(p === 'planning' && typeof MapCtrl !== 'undefined' && MapCtrl.map) setTimeout(() => MapCtrl.map.invalidateSize(), 300);
    }
};

var UI = {
    showLoader: (t) => { let el = document.getElementById('loader'); if(el){ document.getElementById('loader-text').innerText = t; el.style.display = 'flex'; } },
    hideLoader: () => { let el = document.getElementById('loader'); if(el) el.style.display = 'none'; },
    showStatus: (t, c) => { let el = document.getElementById('db-status'); if(el){ el.innerText = t; el.className = `p-4 text-[10px] font-bold text-center text-${c}-400`; } },
    switchTab: (id) => {
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active', 'border-indigo-600', 'text-indigo-800'));
        let btn = document.getElementById('btn-'+id); if(btn) btn.classList.add('active', 'border-indigo-600', 'text-indigo-800');
        document.querySelectorAll('div[id^="tab"]').forEach(x => x.classList.add('hidden'));
        let tab = document.getElementById(id); if(tab) tab.classList.remove('hidden');
    },
    filterList: (id, v) => {
        let q = v.toLowerCase(); let el = document.getElementById(id);
        if(el) Array.from(el.children).forEach(c => c.style.display = c.innerText.toLowerCase().includes(q) ? '' : 'none');
    },
    render: () => {
        let h1=[], h2=[], sums={};
        State.stores.forEach(s => {
            h1.push(`<div class="p-3 bg-white border border-gray-200 rounded-xl shadow-sm text-xs"><div class="font-bold">${s.name}</div><div class="text-[10px] text-gray-400 mt-1">ID: ${s.id}</div></div>`);
            if(!s.days.length) {
                h2.push(`<label class="flex items-center gap-3 p-3 bg-white border ${s.selected?'border-indigo-400 ring-1 ring-indigo-400 bg-indigo-50':'border-gray-200'} rounded-xl cursor-pointer shadow-sm"><input type="checkbox" ${s.selected?'checked':''} onchange="StoreMgr.toggleSelect('${s.id}')" class="text-indigo-600"> <div class="flex-1 text-xs font-bold">${s.name}</div></label>`);
            } else {
                s.days.forEach(d => sums[d] = (sums[d]||0) + 1);
            }
        });
        
        let elUpload = document.getElementById('list-upload'); if(elUpload) elUpload.innerHTML = h1.join('');
        let elUnassigned = document.getElementById('list-unassigned'); if(elUnassigned) elUnassigned.innerHTML = h2.join('');
        
        let sumH = Object.keys(DAY_COLORS).map(d => sums[d] ? `<div onclick="UI.showDayModal('${d}')" class="p-4 bg-white border-t-4 border-gray-200 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition" style="border-top-color:${DAY_COLORS[d].hex}"><div class="text-xs font-bold text-gray-400">${DAY_COLORS[d].name}</div><div class="text-2xl font-black mt-1" style="color:${DAY_COLORS[d].hex}">${sums[d]}</div></div>` : '').join('');
        let elSummary = document.getElementById('list-summary'); if(elSummary) elSummary.innerHTML = sumH;
        
        let done = State.stores.filter(x=>x.days.length).length, total = State.stores.length;
        let elCount = document.getElementById('stat-count'); if(elCount) elCount.innerText = `ร้านทั้งหมด: ${total} | จัดแล้ว: ${done}`;
        let elBar = document.getElementById('progress-bar'); if(elBar) elBar.style.width = total ? `${(done/total)*100}%` : '0%';
        
        let elAssign = document.getElementById('assign-day');
        if(elAssign) elAssign.innerHTML = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name} ${sums[d]?`(${sums[d]})`:''}</option>`).join('');
        
        if(typeof MapCtrl !== 'undefined') MapCtrl.renderMarkers();
    },
    showDayModal: (d) => {
        State.openModalDay = d; 
        let title = document.getElementById('modalTitle'); if(title) title.innerText = d;
        let content = document.getElementById('modalContent'); 
        if(content) content.innerHTML = State.stores.filter(x=>x.days.includes(d)).map(x=>`<div class="p-3 border-b border-gray-100 text-sm font-bold flex justify-between"><span>${x.name}</span><span class="text-[10px] text-gray-400 font-normal">${x.id}</span></div>`).join('');
        let modal = document.getElementById('dayModal'); if(modal) modal.classList.remove('hidden');
    },
    closeDayModal: () => { let modal = document.getElementById('dayModal'); if(modal) modal.classList.add('hidden'); },
    showSummaryModal: () => {
        if(!State.db || !State.db.routes) return;
        let h = [];
        Object.keys(State.db.routes).sort().forEach(r => {
            let s = State.db.routes[r], t = s.length, a = s.filter(x=>x.days.length).length;
            h.push(`<tr><td class="p-3 font-bold border-b">${r}</td><td class="p-3 text-center border-b">${t}</td><td class="p-3 text-center text-emerald-600 font-bold border-b">${a}</td><td class="p-3 text-center text-xs font-bold text-gray-400 border-b">${t ? Math.round(a/t*100) : 0}%</td></tr>`);
        });
        let tb = document.getElementById('overallTableBody'); if(tb) tb.innerHTML = h.join('');
        let md = document.getElementById('overallModal'); if(md) md.classList.remove('hidden');
    },
    hideSummaryModal: () => { let md = document.getElementById('overallModal'); if(md) md.classList.add('hidden'); }
};

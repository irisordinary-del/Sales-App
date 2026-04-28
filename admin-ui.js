var DAY_COLORS = {};
for(let i=1; i<=30; i++) {
    DAY_COLORS[`Day ${i}`] = { name: `Day ${i}`, hex: `hsl(${(i * 137) % 360}, 70%, 50%)` };
}

var Nav = {
    go: (p) => {
        document.querySelectorAll('.sidebar-menu').forEach(x => x.classList.remove('active'));
        document.getElementById('nav-'+p).classList.add('active');
        document.getElementById('page-planning').classList.toggle('hidden', p !== 'planning');
        if(p === 'planning') setTimeout(() => MapCtrl.map.invalidateSize(), 200);
    }
};

var UI = {
    showLoader: (t) => { document.getElementById('loader-text').innerText = t; document.getElementById('loader').style.display = 'flex'; },
    hideLoader: () => { document.getElementById('loader').style.display = 'none'; },
    showStatus: (t, c) => {
        let el = document.getElementById('db-status');
        el.innerText = t; el.className = `p-4 text-[10px] font-bold text-center text-${c}-400`;
    },
    switchTab: (id) => {
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active', 'border-sky-600', 'text-sky-800'));
        document.getElementById('btn-'+id).classList.add('active', 'border-sky-600', 'text-sky-800');
        document.querySelectorAll('div[id^="tab"]').forEach(x => x.classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
    },
    render: () => {
        let h1=[], h2=[], h3=[], sums={};
        GlobalState.stores.forEach(s => {
            let b = `<div class="p-3 bg-white border rounded-xl shadow-sm text-xs"><b>${s.name}</b><br><span class="text-gray-400">ID: ${s.id}</span></div>`;
            h1.push(b);
            if(!s.days.length) {
                h2.push(`<label class="flex items-center gap-3 p-3 bg-white border rounded-xl ${s.selected?'border-sky-500 bg-sky-50':''}"><input type="checkbox" ${s.selected?'checked':''} onchange="StoreMgr.toggleSelect('${s.id}')"> <span class="text-xs"><b>${s.name}</b></span></label>`);
            } else {
                s.days.forEach(d => { sums[d] = (sums[d] || 0) + 1; });
            }
        });
        document.getElementById('list-upload').innerHTML = h1.join('');
        document.getElementById('list-unassigned').innerHTML = h2.join('');
        
        let hSum = Object.keys(DAY_COLORS).map(d => sums[d] ? `<div onclick="UI.showDayModal('${d}')" class="p-3 bg-white border-t-4 rounded-xl shadow-sm cursor-pointer" style="border-color:${DAY_COLORS[d].hex}"><p class="text-[10px] font-bold text-gray-400">${d}</p><p class="text-xl font-black">${sums[d]}</p></div>` : '').join('');
        document.getElementById('list-summary').innerHTML = hSum;
        
        let done = GlobalState.stores.filter(x => x.days.length).length;
        let total = GlobalState.stores.length;
        document.getElementById('progress-bar').style.width = total ? `${(done/total)*100}%` : '0%';
        
        document.getElementById('assign-day').innerHTML = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${d} (${sums[d]||0})</option>`).join('');
        
        MapCtrl.renderMarkers();
    },
    showDayModal: (d) => {
        GlobalState.openModalDay = d;
        document.getElementById('modalTitle').innerText = d;
        let h = GlobalState.stores.filter(x => x.days.includes(d)).map(x => `<div class="p-2 border-b text-xs">${x.name}</div>`).join('');
        document.getElementById('modalContent').innerHTML = h;
        document.getElementById('dayModal').classList.remove('hidden');
    },
    closeDayModal: () => { document.getElementById('dayModal').classList.add('hidden'); },
    filterList: (id, v) => {
        let q = v.toLowerCase();
        let el = document.getElementById(id);
        for(let child of el.children) child.style.display = child.innerText.toLowerCase().includes(q) ? '' : 'none';
    }
};

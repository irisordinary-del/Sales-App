var DAY_COLORS = {};
for(let i=1; i<=30; i++) DAY_COLORS[`Day ${i}`] = { name: `Day ${i}`, hex: `hsl(${(i * 137) % 360}, 65%, 45%)` };

var Nav = {
    go: (p) => {
        document.querySelectorAll('.sidebar-menu').forEach(x => x.classList.remove('active', 'bg-slate-800'));
        document.getElementById('nav-'+p).classList.add('bg-slate-800');
        document.getElementById('page-planning').classList.toggle('hidden', p !== 'planning');
        if(p === 'planning') setTimeout(() => { if(MapCtrl.map) MapCtrl.map.invalidateSize(); }, 300);
    }
};

var UI = {
    showLoader: (t) => { let el = document.getElementById('loader'); if(el){ document.getElementById('loader-text').innerText = t; el.style.display = 'flex'; } },
    hideLoader: () => { let el = document.getElementById('loader'); if(el) el.style.display = 'none'; },
    showStatus: (t, c) => { let el = document.getElementById('db-status'); if(el){ el.innerText = t; el.className = `p-4 text-[10px] font-bold text-center text-${c}-400`; } },
    switchTab: (id) => {
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active', 'border-sky-600', 'text-sky-800'));
        let btn = document.getElementById('btn-'+id); if(btn) btn.classList.add('active', 'border-sky-600', 'text-sky-800');
        document.querySelectorAll('div[id^="tab"]').forEach(x => x.classList.add('hidden'));
        let tab = document.getElementById(id); if(tab) tab.classList.remove('hidden');
    },
    filterList: (id, v) => {
        let q = v.toLowerCase(); let el = document.getElementById(id);
        if(el) Array.from(el.children).forEach(c => c.style.display = c.innerText.toLowerCase().includes(q) ? '' : 'none');
    },
    render: () => {
        if (typeof GlobalState === 'undefined') return;
        let h1=[], h2=[], sums={};
        GlobalState.stores.forEach(s => {
            h1.push(`<div class="p-3 bg-white border rounded-xl shadow-sm text-[11px]"><b>${s.name}</b><br><span class="text-gray-400">ID: ${s.id}</span></div>`);
            if(!s.days.length) h2.push(`<label class="flex items-center gap-3 p-3 bg-white border rounded-xl ${s.selected?'border-sky-500 bg-sky-50':''}"><input type="checkbox" ${s.selected?'checked':''} onchange="StoreMgr.toggleSelect('${s.id}')"> <span class="text-[11px]"><b>${s.name}</b></span></label>`);
            else s.days.forEach(d => sums[d] = (sums[d]||0) + 1);
        });
        let el1 = document.getElementById('list-upload'), el2 = document.getElementById('list-unassigned'), el3 = document.getElementById('list-summary');
        if(el1) el1.innerHTML = h1.join(''); if(el2) el2.innerHTML = h2.join('');
        if(el3) el3.innerHTML = Object.keys(DAY_COLORS).map(d => sums[d] ? `<div onclick="UI.showDayModal('${d}')" class="p-3 bg-white border-t-4 rounded-xl shadow-sm cursor-pointer" style="border-color:${DAY_COLORS[d].hex}"><p class="text-[10px] font-bold text-gray-400">${d}</p><p class="text-xl font-black">${sums[d]}</p></div>` : '').join('');
        
        let done = GlobalState.stores.filter(x=>x.days.length).length, total = GlobalState.stores.length;
        let sc = document.getElementById('stat-count'), pb = document.getElementById('progress-bar'), ad = document.getElementById('assign-day');
        if(sc) sc.innerText = `ร้านทั้งหมด: ${total} | จัดแล้ว: ${done}`;
        if(pb) pb.style.width = total ? `${(done/total)*100}%` : '0%';
        if(ad) ad.innerHTML = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${d} (${sums[d]||0})</option>`).join('');
        if(typeof MapCtrl !== 'undefined') MapCtrl.renderMarkers();
    },
    showDayModal: (d) => {
        GlobalState.openModalDay = d; document.getElementById('modalTitle').innerText = d;
        document.getElementById('modalContent').innerHTML = GlobalState.stores.filter(x=>x.days.includes(d)).map(x=>`<div class="p-2 border-b">${x.name}</div>`).join('');
        document.getElementById('dayModal').classList.remove('hidden');
    },
    closeDayModal: () => document.getElementById('dayModal').classList.add('hidden')
};

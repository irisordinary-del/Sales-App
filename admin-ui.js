const Nav = {
    go: (page) => {
        document.querySelectorAll('.sidebar-menu').forEach(b => b.classList.remove('active', 'text-emerald-400'));
        document.getElementById('nav-' + page).classList.add('active');
        if(page === 'kpi') document.getElementById('nav-kpi').classList.add('text-emerald-400');

        document.getElementById('page-planning').classList.add('hidden');
        document.getElementById('page-data').classList.add('hidden');
        document.getElementById('page-kpi').classList.add('hidden');
        
        document.getElementById('page-' + page).classList.remove('hidden');
        
        if(page === 'planning') setTimeout(() => { if(MapCtrl.map) MapCtrl.map.invalidateSize(); }, 200);
        if(page === 'kpi') KPIMgr.renderSetup(); // โหลดข้อมูลตอนเปิดหน้า KPI
    }
};

const UI = {
    timeout: null,
    showLoader: (text, sub) => { document.getElementById('loader-text').innerText = text; document.getElementById('loader-subtext').innerText = sub || ""; document.getElementById('loader').style.display = 'flex'; },
    hideLoader: () => document.getElementById('loader').style.display = 'none',
    showSaveToast: (msg) => { let t = document.getElementById('save-toast'); document.getElementById('toast-msg').innerText = msg; t.classList.remove('translate-y-24', 'opacity-0'); setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), 2500); },
    initDaySelector: () => { let ds = document.getElementById('assign-day'); if(ds) ds.innerHTML = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`).join(''); },
    switchTab: (id) => { document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active','border-indigo-600','text-indigo-800'); b.classList.add('text-gray-500'); }); document.querySelectorAll('div[id^="tab"]').forEach(d => { d.classList.add('hidden'); d.classList.remove('block'); }); document.getElementById('btn-'+id).classList.add('active','border-indigo-600', 'text-indigo-800'); document.getElementById('btn-'+id).classList.remove('text-gray-500'); document.getElementById(id).classList.remove('hidden'); document.getElementById(id).classList.add('block'); },
    filterList: (id, val) => { clearTimeout(UI.timeout); UI.timeout = setTimeout(() => { let q = val.toLowerCase().trim(), c = document.getElementById(id); if(c) for(let el of c.children) el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none"; }, 200); },
    
    render: () => {
        let htmlU=[], htmlA=[], htmlP=[], sums={}, aCnt=0, sel=0;
        for(let i=1; i<=30; i++) sums[`Day ${i}`] = 0;
        State.stores.forEach(s => { if(s.days.length) { aCnt+=s.days.length; s.days.forEach(d=>sums[d]++); } if(s.selected) sel++; });
        
        let ds = document.getElementById('assign-day'), cv = ds?ds.value:null;
        if(ds) { ds.innerHTML = Object.keys(DAY_COLORS).map(d=>`<option value="${d}">${DAY_COLORS[d].name}${sums[d]>0?` (${sums[d]})`:''}</option>`).join(''); if(cv) ds.value=cv; }
        const opts = Object.keys(DAY_COLORS).map(d=>`<option value="${d}">${DAY_COLORS[d].name}</option>`).join('');

        State.stores.forEach(s => {
            let b = s.freq===2?`<span class="f2-badge">F2</span>`:'';
            // ดึง KPI สรุปที่ Sales ใช้มาแสดงบนหมุดแผนที่
            let kpi = State.sales[s.id];
            let kpiBadge = kpi ? (kpi.active ? `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-bold">✅ ${kpi.vpo} ลัง | ${kpi.skuCount} SKU</span>` : `<span class="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[9px] font-bold">❌ Inactive</span>`) : '';

            htmlP.push(`<div class="p-3 bg-white border border-gray-200 rounded-xl shadow-sm"><div class="flex justify-between items-start"><span class="font-bold text-sm text-gray-800">${s.name} ${b}</span>${kpiBadge}</div><span class="block text-[10px] text-gray-400 font-mono mt-1">ID: ${s.id}</span></div>`);
            
            if(!s.days.length) {
                htmlU.push(`<label class="flex p-3 bg-white border ${s.selected?'border-indigo-400 ring-1 ring-indigo-400 bg-indigo-50':'border-gray-200'} rounded-2xl cursor-pointer shadow-sm"><input type="checkbox" ${s.selected?'checked':''} onchange="StoreMgr.toggleSelect('${s.id}')" class="mr-3 mt-1.5 w-4 h-4 text-indigo-600 rounded"><div class="flex-1"><div class="flex justify-between"><p class="font-bold text-sm text-gray-800">${s.name} ${b}</p>${kpiBadge}</div><p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${s.id}</p></div></label>`);
            } else {
                let dTxt = s.days.join(' & '), c = DAY_COLORS[s.days[0]].hex;
                htmlA.push(`<div id="card-${s.id}" class="p-3 bg-white border border-gray-200 rounded-2xl flex justify-between items-center shadow-sm"><div class="flex-1 overflow-hidden mr-2"><div class="flex justify-between pr-2"><p class="font-bold text-sm text-gray-800 truncate">${s.name} ${b}</p>${kpiBadge}</div><p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${s.id}</p><p class="text-[11px] font-bold mt-1.5"><span class="color-dot" style="background:${c}"></span>${dTxt}</p></div><div class="flex gap-1.5"><select onchange="StoreMgr.changeDay('${s.id}', this.value)" class="text-xs p-1.5 border border-gray-200 rounded-lg shadow-sm outline-none bg-gray-50">${opts.replace(`value="${s.days[0]}"`, `value="${s.days[0]}" selected`)}</select><button onclick="StoreMgr.changeDay('${s.id}','remove')" class="bg-red-50 text-red-500 px-2.5 rounded-lg font-bold hover:bg-red-100 border border-red-100">✕</button></div></div>`);
            }
        });

        document.getElementById('list-upload').innerHTML = htmlP.join(''); document.getElementById('list-unassigned').innerHTML = htmlU.join(''); document.getElementById('list-assigned').innerHTML = htmlA.join('');
        
        let wait = State.stores.filter(s=>!s.days.length).length, tot = State.stores.length;
        document.getElementById('stat-total').innerText = tot; document.getElementById('stat-done').innerText = aCnt; document.getElementById('stat-pending').innerText = wait;
        document.getElementById('progress-bar').style.width = tot ? `${Math.round(((tot-wait)/tot)*100)}%` : '0%';
        MapCtrl.renderMarkers(); MapCtrl.drawLines();
    },
    showDayModal: (d) => {
        State.openDayModal = d; document.getElementById('modalTitle').innerHTML = `<span class="w-4 h-4 rounded-full inline-block shadow-sm" style="background:${DAY_COLORS[d].hex}"></span> ${DAY_COLORS[d].name}`;
        let h = State.stores.filter(s=>s.days.includes(d)).sort((a,b)=>(a.seqs[d]||999)-(b.seqs[d]||999)).map(x=>`<div class="p-3 bg-white border border-gray-200 rounded-2xl flex items-center gap-3 mb-2 shadow-sm">${x.seqs[d]?`<div class="bg-gray-900 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-black">${x.seqs[d]}</div>`:''}<div class="flex-1"><p class="text-sm font-bold truncate text-gray-800">${x.name} ${x.freq===2?'<span class="f2-badge">F2</span>':''}</p><p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${x.id}</p></div></div>`).join('');
        document.getElementById('modalContent').innerHTML = h; document.getElementById('dayModal').classList.remove('hidden');
    },
    closeDayModal: () => { State.openDayModal=null; document.getElementById('dayModal').classList.add('hidden'); }
};

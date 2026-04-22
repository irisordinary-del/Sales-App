// ==========================================
// 🎨 admin-ui.js: จัดการหน้าจอแสดงผล เมนู และเอฟเฟกต์ต่างๆ
// ==========================================

// 🌟 ตั้งค่าสีประจำวัน (ใส่ var เผื่อไฟล์อื่นเรียกใช้ จะได้ไม่ Error)
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

// ==========================================
// 🧭 ระบบสลับหน้าเมนูซ้ายมือ
// ==========================================
var Nav = {
    go: (page) => {
        document.querySelectorAll('.sidebar-menu').forEach(b => b.classList.remove('active', 'text-emerald-400'));
        let navBtn = document.getElementById('nav-' + page);
        if(navBtn) navBtn.classList.add('active');
        if(page === 'kpi' && document.getElementById('nav-kpi')) document.getElementById('nav-kpi').classList.add('text-emerald-400');

        ['planning', 'data', 'kpi'].forEach(p => {
            let el = document.getElementById('page-' + p);
            if (el) el.classList.add('hidden');
        });
        
        let targetPage = document.getElementById('page-' + page);
        if (targetPage) targetPage.classList.remove('hidden');
        
        // ถ้าย้ายมาหน้าจัดสาย ให้สั่งแผนที่รีเฟรชขนาดตัวเอง
        if(page === 'planning') {
            setTimeout(() => { if (typeof MapCtrl !== 'undefined' && MapCtrl.map) MapCtrl.map.invalidateSize(); }, 200);
        }
        if(page === 'kpi' && typeof KPIMgr !== 'undefined') KPIMgr.renderSetup(); 
    }
};

// ==========================================
// 🖥️ ระบบแสดงผล (UI Controller)
// ==========================================
var UI = {
    timeout: null,
    
    // แสดง/ซ่อน หน้าต่างโหลด
    showLoader: (text, sub) => { 
        let lt = document.getElementById('loader-text');
        let ls = document.getElementById('loader-subtext');
        let l = document.getElementById('loader');
        if(lt) lt.innerText = text; 
        if(ls) ls.innerText = sub || ""; 
        if(l) l.style.display = 'flex'; 
    },
    hideLoader: () => { 
        let l = document.getElementById('loader');
        if(l) l.style.display = 'none'; 
    },
    
    // แสดงป๊อปอัปแจ้งเตือนมุมขวาบน
    showSaveToast: (msg) => { 
        let t = document.getElementById('save-toast'); 
        let tm = document.getElementById('toast-msg');
        if(!t || !tm) return;
        tm.innerText = msg; 
        t.classList.remove('translate-y-24', 'opacity-0'); 
        setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), 2500); 
    },
    
    // ตั้งค่า Dropdown เลือกวัน
    initDaySelector: () => { 
        let ds = document.getElementById('assign-day'); 
        if(ds) ds.innerHTML = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`).join(''); 
    },
    
    // สลับแท็บ 1, 2, 3, 4 ขวามือ
    switchTab: (id) => { 
        document.querySelectorAll('.tab-btn').forEach(b => { 
            b.classList.remove('active','border-indigo-600','text-indigo-800'); 
            b.classList.add('text-gray-500'); 
        }); 
        document.querySelectorAll('div[id^="tab"]').forEach(d => { 
            d.classList.add('hidden'); 
            d.classList.remove('block'); 
        }); 
        
        let btn = document.getElementById('btn-'+id);
        if(btn) {
            btn.classList.add('active','border-indigo-600', 'text-indigo-800'); 
            btn.classList.remove('text-gray-500'); 
        }
        
        let tab = document.getElementById(id);
        if(tab) {
            tab.classList.remove('hidden'); 
            tab.classList.add('block'); 
        }
    },
    
    // ค้นหาร้านค้า
    filterList: (id, val) => { 
        clearTimeout(UI.timeout); 
        UI.timeout = setTimeout(() => { 
            let q = val.toLowerCase().trim();
            let c = document.getElementById(id); 
            if(c) {
                for(let el of c.children) {
                    el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none"; 
                }
            }
        }, 200); 
    },
    
    // 🌟 ระบบวาดรายชื่อร้านค้าลงบนหน้าจอ (Render)
    render: () => {
        // ดึงข้อมูล State ที่มาจากไฟล์ admin-data.js
        if (typeof State === 'undefined' || !State.stores) return;

        let htmlU=[], htmlA=[], htmlP=[], sums={}, aCnt=0, sel=0;
        for(let i=1; i<=30; i++) sums[`Day ${i}`] = 0;
        
        State.stores.forEach(s => { 
            if (s.days && s.days.length && !DAY_COLORS[s.days[0]]) {
                s.days = []; // ถ้ารหัสวันไม่ตรง ให้ลบกลายเป็นรอจัด
            }
            if(s.days && s.days.length) { aCnt++; s.days.forEach(d => sums[d]++); } 
            if(s.selected) sel++; 
        });
        
        let ds = document.getElementById('assign-day'), cv = ds ? ds.value : null;
        if(ds) { 
            ds.innerHTML = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}${sums[d]>0 ? ` (${sums[d]})` : ''}</option>`).join(''); 
            if(cv) ds.value = cv; 
        }
        
        const opts = Object.keys(DAY_COLORS).map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`).join('');

        State.stores.forEach(s => {
            let b = s.freq === 2 ? `<span class="bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded text-[10px] font-bold ml-1">F2</span>` : '';
            let kpiBadge = ''; 
            
            // แท็บ 1: โชว์ข้อมูลดิบ
            htmlP.push(`<div class="p-3 bg-white border border-gray-200 rounded-xl shadow-sm"><div class="flex justify-between items-start"><span class="font-bold text-sm text-gray-800">${s.name} ${b}</span>${kpiBadge}</div><span class="block text-[10px] text-gray-400 font-mono mt-1">ID: ${s.id}</span></div>`);
            
            if(!s.days || !s.days.length) {
                // แท็บ 2: รอจัดสาย
                htmlU.push(`
                    <label class="flex p-3 bg-white border ${s.selected ? 'border-indigo-400 ring-1 ring-indigo-400 bg-indigo-50' : 'border-gray-200'} rounded-2xl cursor-pointer shadow-sm hover:shadow-md transition">
                        <input type="checkbox" ${s.selected ? 'checked' : ''} onchange="StoreMgr.toggleSelect('${s.id}')" class="mr-3 mt-1.5 w-4 h-4 text-indigo-600 rounded">
                        <div class="flex-1">
                            <p class="font-bold text-sm text-gray-800">${s.name} ${b}</p>
                            <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${s.id}</p>
                        </div>
                    </label>`);
            } else {
                // แท็บ 3: จัดแล้ว
                let dTxt = s.days.join(' & ');
                let c = DAY_COLORS[s.days[0]] ? DAY_COLORS[s.days[0]].hex : '#9CA3AF'; 
                
                htmlA.push(`
                    <div id="card-${s.id}" class="p-3 bg-white border border-gray-200 rounded-2xl flex justify-between items-center shadow-sm">
                        <div class="flex-1 overflow-hidden mr-2">
                            <p class="font-bold text-sm text-gray-800 truncate">${s.name} ${b}</p>
                            <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${s.id}</p>
                            <p class="text-[11px] font-bold mt-1.5 flex items-center gap-1"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${c};"></span>${dTxt}</p>
                        </div>
                        <div class="flex gap-1.5">
                            <select onchange="StoreMgr.changeDay('${s.id}', this.value)" class="text-xs p-1.5 border border-gray-200 rounded-lg shadow-sm outline-none bg-gray-50 cursor-pointer">
                                ${opts.replace(`value="${s.days[0]}"`, `value="${s.days[0]}" selected`)}
                            </select>
                            <button onclick="StoreMgr.changeDay('${s.id}','remove')" class="bg-red-50 text-red-500 px-2.5 rounded-lg font-bold hover:bg-red-100 border border-red-100 cursor-pointer transition">✕</button>
                        </div>
                    </div>`);
            }
        });

        // อัปเดตรายชื่อลงหน้าจอ
        let elUpload = document.getElementById('list-upload');
        let elUnassigned = document.getElementById('list-unassigned');
        let elAssigned = document.getElementById('list-assigned');
        
        if(elUpload) elUpload.innerHTML = htmlP.join(''); 
        if(elUnassigned) elUnassigned.innerHTML = htmlU.join(''); 
        if(elAssigned) elAssigned.innerHTML = htmlA.join('');
        
        // แท็บ 4: สรุปภาพรวม (ตารางใหญ่)
        let sumH = []; 
        Object.keys(sums).forEach(d => { 
            if(sums[d] > 0 && DAY_COLORS[d]) { 
                let c = DAY_COLORS[d].hex; 
                let act = (State.activeRoadDay === d); 
                sumH.push(`
                    <div onclick="UI.showDayModal('${d}')" class="p-4 bg-white border ${act ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'} rounded-2xl flex flex-col items-center cursor-pointer relative shadow-sm hover:shadow-md transition transform hover:-translate-y-1">
                        <div class="absolute top-0 left-0 w-full h-1.5 rounded-t-2xl" style="background:${c}"></div>
                        <p class="text-xs font-bold mt-1 text-gray-500">${DAY_COLORS[d].name}</p>
                        <p class="text-3xl font-black mt-1" style="color:${c}">${sums[d]}</p>
                    </div>`); 
            } 
        });
        
        let elSummary = document.getElementById('list-summary');
        if(elSummary) {
            elSummary.innerHTML = sumH.length ? sumH.join('') : '<p class="col-span-2 text-center text-xs text-gray-400 mt-4">ยังไม่จัดสาย</p>';
        }

        // อัปเดตตัวเลขแถบด้านล่าง
        let wait = State.stores.filter(s => !s.days || !s.days.length).length;
        let tot = State.stores.length;
        
        let elTotal = document.getElementById('stat-total');
        let elDone = document.getElementById('stat-done');
        let elPending = document.getElementById('stat-pending'); 
        let elProgress = document.getElementById('progress-bar');
        
        if(elTotal) elTotal.innerText = tot; 
        if(elDone) elDone.innerText = aCnt; 
        if(elPending) elPending.innerText = wait;
        if(elProgress) elProgress.style.width = tot ? `${Math.round(((tot-wait)/tot)*100)}%` : '0%';
        
        // สั่งอัปเดตแผนที่
        if (typeof MapCtrl !== 'undefined' && MapCtrl.renderMarkers) {
            MapCtrl.renderMarkers(); 
        }
    },
    
    // Modal โชว์รายชื่อร้านในวันนั้นๆ เพื่อวาดถนน
    showDayModal: (d) => {
        if(!DAY_COLORS[d]) return;
        State.openDayModal = d; 
        
        let mTitle = document.getElementById('modalTitle');
        if(mTitle) mTitle.innerHTML = `<span class="w-4 h-4 rounded-full inline-block shadow-sm" style="background:${DAY_COLORS[d].hex}"></span> ${DAY_COLORS[d].name}`;
        
        let h = State.stores.filter(s => s.days && s.days.includes(d)).sort((a,b) => (a.seqs[d]||999)-(b.seqs[d]||999)).map(x => `
            <div class="p-3 bg-white border border-gray-200 rounded-2xl flex items-center gap-3 mb-2 shadow-sm">
                ${x.seqs && x.seqs[d] ? `<div class="bg-gray-900 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-black">${x.seqs[d]}</div>` : ''}
                <div class="flex-1">
                    <p class="text-sm font-bold truncate text-gray-800">${x.name} ${x.freq===2?'<span class="bg-orange-100 text-orange-600 px-1 py-0.5 rounded text-[9px] font-bold">F2</span>':''}</p>
                    <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${x.id}</p>
                </div>
            </div>`).join('');
            
        let mContent = document.getElementById('modalContent');
        if(mContent) mContent.innerHTML = h; 
        
        let dModal = document.getElementById('dayModal');
        if(dModal) dModal.classList.remove('hidden');
    },
    
    closeDayModal: () => { 
        State.openDayModal = null; 
        let dModal = document.getElementById('dayModal');
        if(dModal) dModal.classList.add('hidden'); 
    },
    
    // Modal สรุปทุกสายวิ่ง (ถ้ามี)
    showSummaryModal: () => {
        if(!State.db || !State.db.routes) return;
        let h = []; 
        let sortedRoutes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b, 'th', {numeric: true}));
        for(let r of sortedRoutes) { 
            let s = State.db.routes[r];
            let t = s.length;
            let a = s.filter(x => x.days && x.days.length).length; 
            h.push(`
                <tr>
                    <td class="p-3 font-bold border-b border-gray-100">${r}</td>
                    <td class="p-3 text-center border-b border-gray-100">${t}</td>
                    <td class="p-3 text-center text-emerald-600 font-bold border-b border-gray-100">${a}</td>
                    <td class="p-3 text-center text-yellow-600 font-bold border-b border-gray-100">${t-a}</td>
                    <td class="p-3 text-xs font-bold text-gray-400 border-b border-gray-100">${t ? Math.round(a/t*100) : 0}%</td>
                </tr>`); 
        }
        let oBody = document.getElementById('overallTableBody');
        let oModal = document.getElementById('overallModal');
        if(oBody) oBody.innerHTML = h.join(''); 
        if(oModal) oModal.classList.remove('hidden');
    },
    
    hideSummaryModal: () => {
        let oModal = document.getElementById('overallModal');
        if(oModal) oModal.classList.add('hidden');
    }
};

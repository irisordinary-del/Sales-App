// ==========================================
// 🧭 Navigation
// ==========================================
const Nav = {
    go: (page) => {
        document.querySelectorAll('.sidebar-menu').forEach(b => {
            b.classList.remove('active', 'text-emerald-400');
        });
        const navEl = document.getElementById('nav-' + page);
        if (navEl) navEl.classList.add('active');

        // Only hide planning page (others deleted)
        const pageEl = document.getElementById('page-' + page);
        if (pageEl) pageEl.classList.remove('hidden');

        if (page === 'planning') {
            setTimeout(() => { if (MapCtrl.map) MapCtrl.map.invalidateSize(); }, 200);
        }
    }
};

// ==========================================
// 🖥️ UI Utilities
// ==========================================
const UI = {
    _filterTimeout: null,

    showLoader: (text, sub) => {
        const el = document.getElementById('loader');
        if (el) {
            document.getElementById('loader-text').innerText = text || 'กำลังประมวลผล...';
            document.getElementById('loader-subtext').innerText = sub || '';
            el.style.display = 'flex';
        }
    },

    hideLoader: () => {
        const el = document.getElementById('loader');
        if (el) el.style.display = 'none';
    },

    showSaveToast: (msg) => {
        const t = document.getElementById('save-toast');
        if (!t) return;
        document.getElementById('toast-msg').innerText = msg || 'บันทึกเรียบร้อย';
        t.classList.remove('translate-y-24', 'opacity-0');
        setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), 2500);
    },

    showErrorToast: (msg) => {
        const t = document.getElementById('save-toast');
        if (!t) return;
        t.style.background = '#dc2626';
        document.getElementById('toast-msg').innerText = msg || 'เกิดข้อผิดพลาด';
        t.classList.remove('translate-y-24', 'opacity-0');
        setTimeout(() => {
            t.classList.add('translate-y-24', 'opacity-0');
            t.style.background = '';
        }, 3000);
    },

    initDaySelector: () => {
        const ds = document.getElementById('assign-day');
        if (ds) {
            ds.innerHTML = Object.keys(DAY_COLORS)
                .map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`)
                .join('');
        }
    },

    switchTab: (id) => {
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active', 'border-indigo-600', 'text-indigo-800');
            b.classList.add('text-gray-500');
        });
        document.querySelectorAll('div[id^="tab"]').forEach(d => {
            d.classList.add('hidden');
            d.classList.remove('block');
        });
        const btn = document.getElementById('btn-' + id);
        if (btn) {
            btn.classList.add('active', 'border-indigo-600', 'text-indigo-800');
            btn.classList.remove('text-gray-500');
        }
        const tab = document.getElementById(id);
        if (tab) {
            tab.classList.remove('hidden');
            tab.classList.add('block');
        }
    },

    filterList: (id, val) => {
        clearTimeout(UI._filterTimeout);
        UI._filterTimeout = setTimeout(() => {
            const q = val.toLowerCase().trim();
            const container = document.getElementById(id);
            if (!container) return;
            for (const el of container.children) {
                el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
            }
        }, 200);
    },

    // แก้บัค: เพิ่ม focusOnEditTab ที่ขาดหายไป
    focusOnEditTab: (storeId) => {
        UI.switchTab('tab3');
        setTimeout(() => {
            const card = document.getElementById('card-' + storeId);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    },

    render: () => {
        const sums = {};
        for (let i = 1; i <= 30; i++) sums[`Day ${i}`] = 0;
        let aCnt = 0;

        State.stores.forEach(s => {
            if (s.days && s.days.length) {
                aCnt += s.days.length;
                s.days.forEach(d => { if (sums[d] !== undefined) sums[d]++; });
            }
        });

        // อัปเดต assign-day selector พร้อมจำนวน
        const ds = document.getElementById('assign-day');
        const cv = ds ? ds.value : null;
        if (ds) {
            ds.innerHTML = Object.keys(DAY_COLORS)
                .map(d => `<option value="${d}">${DAY_COLORS[d].name}${sums[d] > 0 ? ` (${sums[d]})` : ''}</option>`)
                .join('');
            if (cv) ds.value = cv;
        }

        const opts = Object.keys(DAY_COLORS)
            .map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`)
            .join('');

        const htmlU = [], htmlA = [], htmlP = [];

        State.stores.forEach(s => {
            const b = s.freq === 2 ? `<span class="f2-badge">F2</span>` : '';
            const kpi = State.sales[s.id];
            const kpiBadge = kpi
                ? (kpi.active
                    ? `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-bold">✅ ${kpi.vpo} ลัง | ${kpi.skuCount} SKU</span>`
                    : `<span class="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[9px] font-bold">❌ Inactive</span>`)
                : '';

            // Tab 1: ทุกร้าน
            htmlP.push(`
                <div class="p-3 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <div class="flex justify-between items-start">
                        <span class="font-bold text-sm text-gray-800">${s.name} ${b}</span>
                        ${kpiBadge}
                    </div>
                    <span class="block text-[10px] text-gray-400 font-mono mt-1">${s.marketName ? `<span class="block text-[10px] text-blue-400 font-mono mt-0.5">${s.marketName}</span>` : ''}ID: ${s.id}</span>
                </div>`);

            if (!s.days || !s.days.length) {
                // Tab 2: รอจัดสาย
                htmlU.push(`
                    <label class="flex p-3 bg-white border ${s.selected ? 'border-indigo-400 ring-1 ring-indigo-400 bg-indigo-50' : 'border-gray-200'} rounded-2xl cursor-pointer shadow-sm">
                        <input type="checkbox" ${s.selected ? 'checked' : ''} onchange="StoreMgr.toggleSelect('${s.id}')" class="mr-3 mt-1.5 w-4 h-4 text-indigo-600 rounded">
                        <div class="flex-1">
                            <div class="flex justify-between">
                                <p class="font-bold text-sm text-gray-800">${s.name} ${b}</p>
                                ${kpiBadge}
                            </div>
                            <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${s.id}</p>
                        </div>
                    </label>`);
            } else {
                // Tab 3: จัดสายแล้ว
                const dTxt = s.days.join(' & ');
                const c = DAY_COLORS[s.days[0]] ? DAY_COLORS[s.days[0]].hex : '#999';
                const selOpts = opts.replace(`value="${s.days[0]}"`, `value="${s.days[0]}" selected`);
                htmlA.push(`
                    <div id="card-${s.id}" class="p-3 bg-white border border-gray-200 rounded-2xl flex justify-between items-center shadow-sm">
                        <div class="flex-1 overflow-hidden mr-2">
                            <div class="flex justify-between pr-2">
                                <p class="font-bold text-sm text-gray-800 truncate">${s.name} ${b}</p>
                                ${kpiBadge}
                            </div>
                            <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${s.id}</p>
                            <p class="text-[11px] font-bold mt-1.5">
                                <span class="color-dot" style="background:${c}"></span>${dTxt}
                            </p>
                        </div>
                        <div class="flex gap-1.5">
                            <select onchange="StoreMgr.changeDay('${s.id}', this.value)" class="text-xs p-1.5 border border-gray-200 rounded-lg shadow-sm outline-none bg-gray-50">
                                ${selOpts}
                            </select>
                            <button onclick="StoreMgr.changeDay('${s.id}','remove')" class="bg-red-50 text-red-500 px-2.5 rounded-lg font-bold hover:bg-red-100 border border-red-100">✕</button>
                        </div>
                    </div>`);
            }
        });

        // Render lists
        const elUpload = document.getElementById('list-upload');
        const elUnassigned = document.getElementById('list-unassigned');
        const elAssigned = document.getElementById('list-assigned');
        if (elUpload) elUpload.innerHTML = htmlP.join('');
        if (elUnassigned) elUnassigned.innerHTML = htmlU.join('');
        if (elAssigned) elAssigned.innerHTML = htmlA.join('');

        // Tab 4: สรุปวันที่
        const sumH = [];
        Object.keys(sums).forEach(d => {
            if (sums[d] > 0) {
                const c = DAY_COLORS[d].hex;
                const act = State.activeRoadDay === d;
                sumH.push(`
                    <div onclick="UI.showDayModal('${d}')" class="p-4 bg-white border ${act ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'} rounded-2xl flex flex-col items-center cursor-pointer relative shadow-sm hover:shadow-md transition">
                        <div class="absolute top-0 left-0 w-full h-1.5 rounded-t-2xl" style="background:${c}"></div>
                        <p class="text-xs font-bold mt-1 text-gray-500">${DAY_COLORS[d].name}</p>
                        <p class="text-3xl font-black mt-1" style="color:${c}">${sums[d]}</p>
                    </div>`);
            }
        });
        const elSummary = document.getElementById('list-summary');
        if (elSummary) {
            elSummary.innerHTML = sumH.length
                ? sumH.join('')
                : '<p class="col-span-2 text-center text-xs text-gray-400 mt-4">ยังไม่จัดสาย</p>';
        }

        // Stats bar
        const wait = State.stores.filter(s => !s.days || !s.days.length).length;
        const tot = State.stores.length;
        const el = (id) => document.getElementById(id);
        if (el('stat-total')) el('stat-total').innerText = tot;
        if (el('stat-done')) el('stat-done').innerText = aCnt;
        if (el('stat-pending')) el('stat-pending').innerText = wait;
        if (el('progress-bar')) el('progress-bar').style.width = tot ? `${Math.round(((tot - wait) / tot) * 100)}%` : '0%';

        MapCtrl.renderMarkers();
        MapCtrl.drawLines();
    },

    showDayModal: (d) => {
        State.openDayModal = d;
        const title = document.getElementById('modalTitle');
        if (title) {
            title.innerHTML = `<span class="w-4 h-4 rounded-full inline-block shadow-sm" style="background:${DAY_COLORS[d].hex}"></span> ${DAY_COLORS[d].name}`;
        }
        const sorted = State.stores
            .filter(s => s.days && s.days.includes(d))
            .sort((a, b) => ((a.seqs && a.seqs[d]) || 999) - ((b.seqs && b.seqs[d]) || 999));

        const h = sorted.map(x => `
            <div class="p-3 bg-white border border-gray-200 rounded-2xl flex items-center gap-3 mb-2 shadow-sm">
                ${(x.seqs && x.seqs[d]) ? `<div class="bg-gray-900 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-black">${x.seqs[d]}</div>` : ''}
                <div class="flex-1">
                    <p class="text-sm font-bold truncate text-gray-800">${x.name} ${x.freq === 2 ? '<span class="f2-badge">F2</span>' : ''}</p>
                    <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${x.id}</p>
                </div>
            </div>`).join('');

        const content = document.getElementById('modalContent');
        if (content) content.innerHTML = h;
        const modal = document.getElementById('dayModal');
        if (modal) modal.classList.remove('hidden');
    },

    closeDayModal: () => {
        State.openDayModal = null;
        const modal = document.getElementById('dayModal');
        if (modal) modal.classList.add('hidden');
    },

    showSummaryModal: () => {
        const h = [];
        const sortedRoutes = Object.keys(State.db.routes)
            .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));

        for (const r of sortedRoutes) {
            const s = State.db.routes[r];
            const t = s.length;
            const a = s.filter(x => x.days && x.days.length).length;
            h.push(`
                <tr>
                    <td class="p-3 font-bold border-b border-gray-100">${r}</td>
                    <td class="p-3 text-center border-b border-gray-100">${t}</td>
                    <td class="p-3 text-center text-emerald-600 font-bold border-b border-gray-100">${a}</td>
                    <td class="p-3 text-center text-yellow-600 font-bold border-b border-gray-100">${t - a}</td>
                    <td class="p-3 text-xs font-bold text-gray-400 border-b border-gray-100">${t ? Math.round(a / t * 100) : 0}%</td>
                </tr>`);
        }
        const tbody = document.getElementById('overallTableBody');
        if (tbody) tbody.innerHTML = h.join('');
        const modal = document.getElementById('overallModal');
        if (modal) modal.classList.remove('hidden');
    },

    hideSummaryModal: () => {
        const modal = document.getElementById('overallModal');
        if (modal) modal.classList.add('hidden');
    }
};

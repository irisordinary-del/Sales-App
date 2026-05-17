// ==========================================
// 🎯 SKU Distribution Tracking System
// Admin กำหนด Target Groups + ระยะเวลา
// วัด Coverage % รายสาย (ร้าน + SKU)
// ==========================================

const SkuDist = {

    // ─── Firestore path ──────────────────────────────────────────────────
    _col: () => cloudDB.collection('skuDistribution'),
    _centerDoc: () => window.CENTER_DOC || 'v1_main',

    // ─── State ───────────────────────────────────────────────────────────
    _campaigns: [],      // [ { id, name, startYM, endYM, groups: [{id, name, keywords:[]}] } ]
    _activeCampaign: null,
    _result: null,       // คำนวณแล้ว { routeCode: { storeCoverage, skuCoverage, ... } }
    _allProdOptions: [], // prodCode+prodName จาก sellout (สำหรับ autocomplete)
    _previewRows: [],    // rows ที่ match keyword ล่าสุด (preview)

    // ─── Init ─────────────────────────────────────────────────────────────
    init: async () => {
        SkuDist._renderShell();
        await SkuDist._loadCampaigns();
        SkuDist._renderCampaignList();
        SkuDist._loadProdOptions();
    },

    // ─── โหลด Campaigns จาก Firestore ────────────────────────────────────
    _loadCampaigns: async () => {
        try {
            const snap = await SkuDist._col()
                .where('centerId', '==', SkuDist._centerDoc())
                .orderBy('createdAt', 'desc')
                .get();
            SkuDist._campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            // อาจยังไม่มี index → โหลดแบบไม่ orderBy
            try {
                const snap2 = await SkuDist._col()
                    .where('centerId', '==', SkuDist._centerDoc())
                    .get();
                SkuDist._campaigns = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e2) {
                console.warn('SkuDist._loadCampaigns:', e2);
                SkuDist._campaigns = [];
            }
        }
    },

    // ─── โหลด prodCode/prodName options จาก sellout ──────────────────────
    _loadProdOptions: async () => {
        if (SkuDist._allProdOptions.length > 0) return;
        try {
            // ดึงเดือนล่าสุดจาก sellout
            const snap = await cloudDB.collection('sellout').orderBy('__name__', 'desc').limit(1).get();
            if (snap.empty) return;
            const ym = snap.docs[0].id;
            const chunks = await cloudDB.collection('sellout').doc(ym)
                .collection('chunks').orderBy('index').get();
            const seen = new Map();
            chunks.forEach(doc => {
                (doc.data().rows || []).forEach(r => {
                    const code = String(r.prodCode || '').trim();
                    const name = String(r.prodName || '').trim();
                    if (code && !seen.has(code)) seen.set(code, name);
                });
            });
            SkuDist._allProdOptions = [...seen.entries()].map(([code, name]) => ({ code, name }));
        } catch (e) {
            console.warn('SkuDist._loadProdOptions:', e);
        }
    },

    // ─── Shell UI ─────────────────────────────────────────────────────────
    _renderShell: () => {
        const container = document.getElementById('page-skudist');
        if (!container) return;
        container.innerHTML = `
        <div class="h-12 bg-gray-900 text-white flex items-center justify-between px-4 shrink-0 border-b-2 border-pink-500">
            <div class="flex items-center gap-3">
                <button onclick="SidebarCtrl.toggle()" class="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center transition">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>
                <span class="text-base font-black text-indigo-400">Route<span class="text-white">Plan</span></span>
            </div>
            <span class="text-xs text-gray-400 font-bold">🎯 ติดตามการกระจายสินค้า</span>
        </div>

        <div class="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-4">

            <!-- Campaign list -->
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <span class="text-sm font-black text-gray-800">📋 Campaign ทั้งหมด</span>
                    <button onclick="SkuDist.openCreateCampaign()"
                        class="bg-pink-600 hover:bg-pink-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm">
                        + สร้าง Campaign
                    </button>
                </div>
                <div id="skudist-campaign-list" class="p-4">
                    <p class="text-center text-gray-400 text-xs py-6">กำลังโหลด...</p>
                </div>
            </div>

            <!-- Result panel -->
            <div id="skudist-result-panel" class="hidden">
                <!-- Result header -->
                <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
                    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <span id="skudist-result-title" class="text-sm font-black text-gray-800">📊 ผลการกระจาย</span>
                        <div class="flex gap-2">
                            <select id="skudist-group-filter" onchange="SkuDist._renderResult()"
                                class="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold outline-none">
                                <option value="ALL">ทุกกลุ่ม SKU</option>
                            </select>
                            <button onclick="SkuDist._exportResult()"
                                class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">
                                📥 Export
                            </button>
                        </div>
                    </div>
                    <div class="p-4" id="skudist-result-body">
                        <p class="text-center text-gray-400 text-xs py-6">เลือก Campaign แล้วกด "คำนวณ"</p>
                    </div>
                </div>
            </div>

        </div>

        <!-- Create/Edit Campaign Modal -->
        <div id="skudist-campaign-modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden" style="max-height:92dvh;">
                <div class="px-5 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                    <h2 id="skudist-modal-title" class="text-base font-black text-gray-900">สร้าง Campaign</h2>
                    <button onclick="SkuDist.closeModal()" class="w-8 h-8 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-100 font-bold transition text-sm">✕</button>
                </div>
                <div class="flex-1 overflow-y-auto p-5 space-y-5">

                    <!-- Campaign info -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div class="sm:col-span-2">
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5">ชื่อ Campaign *</label>
                            <input id="skudist-c-name" type="text" placeholder="เช่น Campaign กระจายน้ำดื่ม Q2/2568"
                                class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-pink-300 font-medium">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5">เดือนเริ่ม (YYYY_MM)</label>
                            <input id="skudist-c-start" type="text" placeholder="เช่น 2025_01"
                                class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-pink-300 font-mono">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase mb-1.5">เดือนสิ้นสุด (YYYY_MM)</label>
                            <input id="skudist-c-end" type="text" placeholder="เช่น 2025_03"
                                class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-pink-300 font-mono">
                        </div>
                    </div>

                    <div class="border-t border-gray-100 pt-4">
                        <div class="flex items-center justify-between mb-3">
                            <p class="text-sm font-black text-gray-800">กลุ่ม SKU Target</p>
                            <button onclick="SkuDist.addGroup()"
                                class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">
                                + เพิ่มกลุ่ม
                            </button>
                        </div>
                        <p class="text-xs text-gray-400 mb-3">แต่ละกลุ่มคือ "SKU target 1 ตัว" — ร้านที่ซื้อสินค้าใด ๆ ในกลุ่มจะนับว่า "กระจายแล้ว"</p>
                        <div id="skudist-groups-container" class="space-y-3"></div>
                    </div>

                </div>
                <div class="px-5 py-4 border-t flex gap-3 flex-shrink-0 bg-gray-50">
                    <button onclick="SkuDist.closeModal()" class="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 transition">ยกเลิก</button>
                    <button onclick="SkuDist.saveCampaign()" class="flex-1 bg-pink-600 hover:bg-pink-700 text-white rounded-xl py-2.5 text-sm font-bold transition shadow-sm">💾 บันทึก Campaign</button>
                </div>
            </div>
        </div>

        <!-- Preview Match Modal -->
        <div id="skudist-preview-modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style="max-height:80dvh;">
                <div class="px-5 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                    <h2 class="text-sm font-black text-gray-900">🔍 Preview สินค้าที่ match</h2>
                    <button onclick="SkuDist.closePreviewModal()" class="w-8 h-8 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-100 font-bold transition text-sm">✕</button>
                </div>
                <div class="flex-1 overflow-y-auto p-4" id="skudist-preview-body">
                </div>
            </div>
        </div>
        `;
    },

    // ─── Campaign List ────────────────────────────────────────────────────
    _renderCampaignList: () => {
        const el = document.getElementById('skudist-campaign-list');
        if (!el) return;
        if (!SkuDist._campaigns.length) {
            el.innerHTML = '<p class="text-center text-gray-400 text-xs py-6">ยังไม่มี Campaign — กด "+ สร้าง Campaign" ได้เลยครับ</p>';
            return;
        }
        el.innerHTML = SkuDist._campaigns.map(c => {
            const startLbl = DateUtil ? DateUtil.ymToThaiShort(c.startYM) : c.startYM;
            const endLbl   = DateUtil ? DateUtil.ymToThaiShort(c.endYM)   : c.endYM;
            const groups   = (c.groups || []).length;
            const isActive = SkuDist._activeCampaign?.id === c.id;
            return `
            <div class="flex items-center gap-3 p-3 rounded-xl border ${isActive ? 'border-pink-300 bg-pink-50' : 'border-gray-100 bg-gray-50'} mb-2">
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm text-gray-800 truncate">${c.name}</p>
                    <p class="text-xs text-gray-400 mt-0.5">📅 ${startLbl} → ${endLbl} &nbsp;|&nbsp; 🎯 ${groups} กลุ่ม SKU</p>
                </div>
                <div class="flex gap-1.5 flex-shrink-0">
                    <button onclick="SkuDist.calc('${c.id}')"
                        class="bg-pink-600 hover:bg-pink-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">
                        📊 คำนวณ
                    </button>
                    <button onclick="SkuDist.openEdit('${c.id}')"
                        class="bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1.5 rounded-lg text-xs font-bold transition">
                        ✏️
                    </button>
                    <button onclick="SkuDist.deleteCampaign('${c.id}')"
                        class="bg-red-50 hover:bg-red-100 text-red-500 px-2.5 py-1.5 rounded-lg text-xs font-bold transition">
                        🗑️
                    </button>
                </div>
            </div>`;
        }).join('');
    },

    // ─── Create / Edit Modal ──────────────────────────────────────────────
    _editingId: null,
    _groups: [],   // [ { id, name, keywords: [] } ]

    openCreateCampaign: () => {
        SkuDist._editingId = null;
        SkuDist._groups = [];
        document.getElementById('skudist-modal-title').textContent = 'สร้าง Campaign';
        document.getElementById('skudist-c-name').value = '';
        // default เดือนปัจจุบัน
        const ym = DateUtil ? DateUtil.currentYM() : '';
        document.getElementById('skudist-c-start').value = ym;
        document.getElementById('skudist-c-end').value   = ym;
        SkuDist._renderGroups();
        document.getElementById('skudist-campaign-modal').classList.remove('hidden');
    },

    openEdit: (id) => {
        const c = SkuDist._campaigns.find(x => x.id === id);
        if (!c) return;
        SkuDist._editingId = id;
        SkuDist._groups    = JSON.parse(JSON.stringify(c.groups || []));
        document.getElementById('skudist-modal-title').textContent = 'แก้ไข Campaign';
        document.getElementById('skudist-c-name').value  = c.name || '';
        document.getElementById('skudist-c-start').value = c.startYM || '';
        document.getElementById('skudist-c-end').value   = c.endYM   || '';
        SkuDist._renderGroups();
        document.getElementById('skudist-campaign-modal').classList.remove('hidden');
    },

    closeModal: () => {
        document.getElementById('skudist-campaign-modal').classList.add('hidden');
    },

    addGroup: () => {
        const gId = 'g_' + Date.now();
        SkuDist._groups.push({ id: gId, name: '', keywords: [] });
        SkuDist._renderGroups();
    },

    removeGroup: (gId) => {
        SkuDist._groups = SkuDist._groups.filter(g => g.id !== gId);
        SkuDist._renderGroups();
    },

    _renderGroups: () => {
        const el = document.getElementById('skudist-groups-container');
        if (!el) return;
        if (!SkuDist._groups.length) {
            el.innerHTML = '<p class="text-xs text-gray-400 text-center py-3">ยังไม่มีกลุ่ม — กด "+ เพิ่มกลุ่ม"</p>';
            return;
        }
        el.innerHTML = SkuDist._groups.map((g, gi) => `
            <div class="border border-gray-200 rounded-2xl p-4 bg-white" id="group-card-${g.id}">
                <div class="flex items-center gap-2 mb-3">
                    <span class="bg-pink-100 text-pink-700 text-xs font-black px-2 py-0.5 rounded-full">SKU Target ${gi+1}</span>
                    <input type="text" value="${g.name}" placeholder="ชื่อกลุ่ม เช่น น้ำดื่ม"
                        onchange="SkuDist._updateGroupName('${g.id}', this.value)"
                        class="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-pink-200">
                    <button onclick="SkuDist.removeGroup('${g.id}')" class="text-red-400 hover:text-red-600 font-bold text-lg leading-none px-1">✕</button>
                </div>

                <!-- Keywords / prodCode ที่เลือก -->
                <div class="mb-2">
                    <p class="text-xs font-bold text-gray-500 mb-1.5">สินค้าที่นับรวม (keyword จาก prodCode หรือ prodName)</p>
                    <div id="group-tags-${g.id}" class="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                        ${(g.keywords || []).map(kw => `
                            <span class="bg-indigo-100 text-indigo-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                                ${kw}
                                <button onclick="SkuDist._removeKeyword('${g.id}','${kw}')" class="text-indigo-400 hover:text-red-500 font-black text-sm leading-none">×</button>
                            </span>`).join('')}
                    </div>

                    <!-- Search input + autocomplete -->
                    <div class="relative">
                        <input type="text" id="kw-inp-${g.id}" placeholder="พิมพ์ prodCode หรือชื่อสินค้า..."
                            oninput="SkuDist._onKwInput('${g.id}', this.value)"
                            onkeydown="SkuDist._onKwKeydown(event, '${g.id}')"
                            class="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-200">
                        <div id="kw-dropdown-${g.id}" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto"></div>
                    </div>

                    <!-- Preview match button -->
                    <button onclick="SkuDist.previewMatch('${g.id}')"
                        class="mt-2 text-xs text-indigo-600 font-bold hover:underline">
                        🔍 Preview สินค้าที่ match ทั้งหมด
                    </button>
                </div>
            </div>
        `).join('');
    },

    _updateGroupName: (gId, val) => {
        const g = SkuDist._groups.find(x => x.id === gId);
        if (g) g.name = val;
    },

    _removeKeyword: (gId, kw) => {
        const g = SkuDist._groups.find(x => x.id === gId);
        if (!g) return;
        g.keywords = g.keywords.filter(k => k !== kw);
        SkuDist._renderGroups();
    },

    _onKwInput: (gId, val) => {
        const dropdown = document.getElementById(`kw-dropdown-${gId}`);
        if (!dropdown) return;
        const q = val.trim().toLowerCase();
        if (!q || q.length < 2) { dropdown.classList.add('hidden'); return; }

        const matches = SkuDist._allProdOptions
            .filter(p => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
            .slice(0, 20);

        if (!matches.length) {
            // แสดง option เพิ่ม keyword ตรงๆ
            dropdown.innerHTML = `<div class="px-3 py-2 text-xs text-gray-500">
                ไม่พบสินค้าที่ match — <button onclick="SkuDist._addKeywordRaw('${gId}','${val.trim()}')" class="text-indigo-600 font-bold hover:underline">เพิ่ม "${val.trim()}" เป็น keyword ตรงๆ</button>
            </div>`;
            dropdown.classList.remove('hidden');
            return;
        }

        dropdown.innerHTML = matches.map(p => `
            <div class="px-3 py-2 hover:bg-indigo-50 cursor-pointer flex items-center gap-2 border-b border-gray-50"
                onclick="SkuDist._addKeyword('${gId}','${p.code}')">
                <span class="font-mono text-xs text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">${p.code}</span>
                <span class="text-xs text-gray-700 truncate">${p.name}</span>
            </div>
        `).join('') + `
            <div class="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                หรือ <button onclick="SkuDist._addKeywordRaw('${gId}','${val.trim()}')" class="text-indigo-600 font-bold hover:underline">เพิ่ม "${val.trim()}" เป็น keyword</button> (match แบบ contains)
            </div>`;
        dropdown.classList.remove('hidden');
    },

    _onKwKeydown: (e, gId) => {
        if (e.key === 'Enter') {
            const inp = document.getElementById(`kw-inp-${gId}`);
            if (inp && inp.value.trim()) SkuDist._addKeywordRaw(gId, inp.value.trim());
        }
        if (e.key === 'Escape') {
            const dd = document.getElementById(`kw-dropdown-${gId}`);
            if (dd) dd.classList.add('hidden');
        }
    },

    _addKeyword: (gId, kw) => {
        const g = SkuDist._groups.find(x => x.id === gId);
        if (!g) return;
        if (!g.keywords.includes(kw)) g.keywords.push(kw);
        const inp = document.getElementById(`kw-inp-${gId}`);
        if (inp) inp.value = '';
        const dd = document.getElementById(`kw-dropdown-${gId}`);
        if (dd) dd.classList.add('hidden');
        SkuDist._renderGroups();
    },

    _addKeywordRaw: (gId, kw) => {
        SkuDist._addKeyword(gId, kw);
    },

    // ─── Preview สินค้าที่ match ──────────────────────────────────────────
    previewMatch: async (gId) => {
        const g = SkuDist._groups.find(x => x.id === gId);
        if (!g) return;
        if (!g.keywords.length) return UI.showErrorToast('⚠️ ยังไม่ได้เพิ่ม keyword ครับ');

        await SkuDist._loadProdOptions();
        const kws = g.keywords.map(k => k.toLowerCase());
        const matched = SkuDist._allProdOptions.filter(p =>
            kws.some(k => p.code.toLowerCase().includes(k) || p.name.toLowerCase().includes(k))
        );

        const body = document.getElementById('skudist-preview-body');
        if (body) {
            if (!matched.length) {
                body.innerHTML = '<p class="text-center text-gray-400 text-xs py-6">ไม่พบสินค้าที่ match keyword เหล่านี้ในข้อมูล sellout</p>';
            } else {
                body.innerHTML = `
                    <p class="text-xs text-gray-500 mb-3">พบ <span class="font-black text-indigo-700">${matched.length}</span> สินค้าที่ match keyword: ${g.keywords.map(k=>`<span class="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-xs font-bold">${k}</span>`).join(' ')}</p>
                    <div class="space-y-1.5">
                        ${matched.map(p => `
                            <div class="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                                <span class="font-mono text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded flex-shrink-0">${p.code}</span>
                                <span class="text-xs text-gray-700">${p.name}</span>
                            </div>`).join('')}
                    </div>`;
            }
        }
        document.getElementById('skudist-preview-modal').classList.remove('hidden');
    },

    closePreviewModal: () => {
        document.getElementById('skudist-preview-modal').classList.add('hidden');
    },

    // ─── Save Campaign ────────────────────────────────────────────────────
    saveCampaign: async () => {
        const name   = document.getElementById('skudist-c-name').value.trim();
        const startYM = document.getElementById('skudist-c-start').value.trim();
        const endYM   = document.getElementById('skudist-c-end').value.trim();

        if (!name) return UI.showErrorToast('⚠️ กรุณาใส่ชื่อ Campaign');
        if (!/^\d{4}_\d{2}$/.test(startYM)) return UI.showErrorToast('⚠️ เดือนเริ่มต้องเป็น YYYY_MM');
        if (!/^\d{4}_\d{2}$/.test(endYM))   return UI.showErrorToast('⚠️ เดือนสิ้นสุดต้องเป็น YYYY_MM');
        if (startYM > endYM) return UI.showErrorToast('⚠️ เดือนเริ่มต้องไม่เกินเดือนสิ้นสุด');
        if (!SkuDist._groups.length) return UI.showErrorToast('⚠️ กรุณาเพิ่มอย่างน้อย 1 กลุ่ม SKU');

        const emptyGroup = SkuDist._groups.find(g => !g.name || !g.keywords.length);
        if (emptyGroup) return UI.showErrorToast('⚠️ กลุ่ม SKU ต้องมีชื่อและอย่างน้อย 1 keyword');

        UI.showLoader('กำลังบันทึก Campaign...', '');
        try {
            const data = {
                name, startYM, endYM,
                centerId: SkuDist._centerDoc(),
                groups:   SkuDist._groups,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            };

            if (SkuDist._editingId) {
                await SkuDist._col().doc(SkuDist._editingId).set(data, { merge: true });
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await SkuDist._col().add(data);
            }

            await SkuDist._loadCampaigns();
            SkuDist._renderCampaignList();
            SkuDist.closeModal();
            UI.hideLoader();
            UI.showSaveToast('✅ บันทึก Campaign เรียบร้อย');
        } catch (e) {
            UI.hideLoader();
            UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + e.message);
        }
    },

    // ─── Delete Campaign ─────────────────────────────────────────────────
    deleteCampaign: (id) => {
        UI.showConfirm('ลบ Campaign นี้?', async () => {
            try {
                await SkuDist._col().doc(id).delete();
                SkuDist._campaigns = SkuDist._campaigns.filter(c => c.id !== id);
                if (SkuDist._activeCampaign?.id === id) {
                    SkuDist._activeCampaign = null;
                    document.getElementById('skudist-result-panel').classList.add('hidden');
                }
                SkuDist._renderCampaignList();
                UI.showSaveToast('🗑️ ลบ Campaign เรียบร้อย');
            } catch (e) {
                UI.showErrorToast('❌ ลบไม่สำเร็จ: ' + e.message);
            }
        });
    },

    // ─── Calculate ───────────────────────────────────────────────────────
    calc: async (id) => {
        const campaign = SkuDist._campaigns.find(c => c.id === id);
        if (!campaign) return;

        SkuDist._activeCampaign = campaign;
        UI.showLoader('กำลังคำนวณ...', `โหลดข้อมูล ${campaign.startYM} → ${campaign.endYM}`);

        try {
            // โหลดทุกเดือนใน range
            const months = SkuDist._getYMRange(campaign.startYM, campaign.endYM);
            let allRows = [];
            for (const ym of months) {
                try {
                    const chunks = await cloudDB.collection('sellout').doc(ym)
                        .collection('chunks').orderBy('index').get();
                    chunks.forEach(doc => { allRows = allRows.concat(doc.data().rows || []); });
                } catch (e) { /* เดือนนั้นอาจไม่มีข้อมูล */ }
            }

            // กรองเฉพาะ sCode ของศูนย์
            if (typeof State !== 'undefined' && State.db?.routeList?.length) {
                const centerRoutes = new Set(State.db.routeList.map(r => r.toUpperCase()));
                allRows = allRows.filter(r => centerRoutes.has((r.sCode || '').toUpperCase()));
            }

            // คำนวณ per route per group
            const routes = typeof State !== 'undefined' && State.db?.routeList?.length
                ? State.db.routeList
                : [...new Set(allRows.map(r => r.sCode))].sort();

            const groups = campaign.groups || [];
            const result = {}; // { routeCode: { total, groups: { gId: { storeCoverage, skuCoverage } } } }

            routes.forEach(route => {
                const routeRows = allRows.filter(r =>
                    (r.sCode || '').toUpperCase() === route.toUpperCase()
                );
                // ร้านทั้งหมดในสาย (จาก State)
                const allStoresInRoute = typeof State !== 'undefined'
                    ? (State.db.routes?.[route] || []).map(s => String(s.id))
                    : [];
                const totalStores = allStoresInRoute.length || new Set(routeRows.map(r => String(r.custCode))).size;

                const groupResult = {};
                groups.forEach(g => {
                    const kws = (g.keywords || []).map(k => k.toLowerCase());

                    // rows ที่ match group นี้
                    const matchedRows = routeRows.filter(r => {
                        const code = (r.prodCode || '').toLowerCase();
                        const name = (r.prodName || '').toLowerCase();
                        return kws.some(k => code.includes(k) || name.includes(k));
                    });

                    // ร้านที่ซื้อสินค้าในกลุ่มนี้อย่างน้อย 1 ครั้ง
                    const storesBought = new Set(matchedRows.map(r => String(r.custCode)));
                    const storeCoverageCount = storesBought.size;
                    const storeCoveragePct = totalStores > 0
                        ? Math.round(storeCoverageCount / totalStores * 100)
                        : 0;

                    // SKU ที่ขายได้จริงใน group นี้ ÷ keywords ทั้งหมด
                    // (นับ unique prodCode ที่ match)
                    const skusSold = new Set(matchedRows.map(r => r.prodCode).filter(Boolean));
                    // หา unique prodCode ที่ควรขายได้ (จาก allProdOptions ที่ match)
                    const targetSkus = new Set(SkuDist._allProdOptions
                        .filter(p => kws.some(k => p.code.toLowerCase().includes(k) || p.name.toLowerCase().includes(k)))
                        .map(p => p.code));
                    const skuCoveragePct = targetSkus.size > 0
                        ? Math.round(skusSold.size / targetSkus.size * 100)
                        : (skusSold.size > 0 ? 100 : 0);

                    groupResult[g.id] = {
                        groupName:           g.name,
                        storeCoverageCount,
                        storeCoveragePct,
                        skusSoldCount:       skusSold.size,
                        targetSkuCount:      targetSkus.size,
                        skuCoveragePct,
                        totalStores,
                        vol: matchedRows.reduce((s, r) => s + (r.net || r.gross || 0), 0),
                    };
                });

                result[route] = { totalStores, groups: groupResult };
            });

            SkuDist._result = result;
            SkuDist._renderGroupFilter(groups);
            SkuDist._renderResult();
            document.getElementById('skudist-result-panel').classList.remove('hidden');
            document.getElementById('skudist-result-title').textContent = `📊 ${campaign.name}  (${DateUtil?.ymToThaiShort(campaign.startYM)} → ${DateUtil?.ymToThaiShort(campaign.endYM)})`;
            UI.hideLoader();

            // scroll ลงไปที่ result
            setTimeout(() => {
                document.getElementById('skudist-result-panel')?.scrollIntoView({ behavior: 'smooth' });
            }, 300);

        } catch (e) {
            UI.hideLoader();
            UI.showErrorToast('❌ คำนวณไม่สำเร็จ: ' + e.message);
            console.error('SkuDist.calc:', e);
        }
    },

    // สร้าง list ของ YYYY_MM ในช่วง startYM → endYM
    _getYMRange: (startYM, endYM) => {
        const months = [];
        let [y, m] = startYM.split('_').map(Number);
        const [ey, em] = endYM.split('_').map(Number);
        while (y < ey || (y === ey && m <= em)) {
            months.push(`${y}_${String(m).padStart(2,'0')}`);
            m++;
            if (m > 12) { m = 1; y++; }
        }
        return months;
    },

    _renderGroupFilter: (groups) => {
        const sel = document.getElementById('skudist-group-filter');
        if (!sel) return;
        sel.innerHTML = '<option value="ALL">ทุกกลุ่ม SKU</option>' +
            groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    },

    // ─── Render Result Table ─────────────────────────────────────────────
    _renderResult: () => {
        const body = document.getElementById('skudist-result-body');
        if (!body || !SkuDist._result || !SkuDist._activeCampaign) return;

        const filterGId = document.getElementById('skudist-group-filter')?.value || 'ALL';
        const groups = (SkuDist._activeCampaign.groups || [])
            .filter(g => filterGId === 'ALL' || g.id === filterGId);
        const routes = Object.keys(SkuDist._result).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));

        if (!routes.length) {
            body.innerHTML = '<p class="text-center text-gray-400 text-xs py-6">ไม่พบข้อมูลในช่วงเวลานี้</p>';
            return;
        }

        const colSpan = 2 + groups.length * 2;

        // Summary cards (รวมทุกสาย)
        const summaryHtml = groups.map(g => {
            const vals = routes.map(r => SkuDist._result[r]?.groups?.[g.id]);
            const avgStore = vals.reduce((s,v) => s + (v?.storeCoveragePct||0), 0) / (vals.length||1);
            const avgSku   = vals.reduce((s,v) => s + (v?.skuCoveragePct||0),   0) / (vals.length||1);
            return `
            <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <p class="text-xs font-bold text-gray-500 mb-2">🎯 ${g.name}</p>
                <div class="flex gap-4">
                    <div>
                        <p class="text-2xl font-black ${SkuDist._coverageColor(avgStore)}">${Math.round(avgStore)}%</p>
                        <p class="text-xs text-gray-400">เฉลี่ยร้านที่กระจาย</p>
                    </div>
                    <div>
                        <p class="text-2xl font-black ${SkuDist._coverageColor(avgSku)}">${Math.round(avgSku)}%</p>
                        <p class="text-xs text-gray-400">เฉลี่ย SKU coverage</p>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Table
        const thead = `
        <tr class="bg-gray-50">
            <th class="px-3 py-2 text-left text-xs font-bold text-gray-500 sticky left-0 bg-gray-50">สาย</th>
            <th class="px-3 py-2 text-center text-xs font-bold text-gray-500">ร้านทั้งหมด</th>
            ${groups.map(g => `
                <th class="px-3 py-2 text-center text-xs font-bold text-pink-700 bg-pink-50" colspan="2">${g.name}</th>
            `).join('')}
        </tr>
        <tr class="bg-gray-50 border-b border-gray-200">
            <th class="px-3 py-1 sticky left-0 bg-gray-50"></th>
            <th class="px-3 py-1"></th>
            ${groups.map(() => `
                <th class="px-3 py-1 text-center text-[10px] font-bold text-gray-400">ร้านที่กระจาย</th>
                <th class="px-3 py-1 text-center text-[10px] font-bold text-gray-400">SKU coverage</th>
            `).join('')}
        </tr>`;

        const tbody = routes.map(route => {
            const rd = SkuDist._result[route];
            return `
            <tr class="border-b border-gray-100 hover:bg-pink-50/30 transition">
                <td class="px-3 py-2.5 font-bold text-xs text-indigo-700 sticky left-0 bg-white">${route}</td>
                <td class="px-3 py-2.5 text-center text-xs text-gray-500">${rd.totalStores}</td>
                ${groups.map(g => {
                    const gd = rd.groups?.[g.id] || {};
                    const sp = gd.storeCoveragePct || 0;
                    const kp = gd.skuCoveragePct   || 0;
                    return `
                    <td class="px-3 py-2.5 text-center">
                        <div class="flex flex-col items-center gap-0.5">
                            <span class="text-sm font-black ${SkuDist._coverageColor(sp)}">${sp}%</span>
                            <span class="text-[10px] text-gray-400">${gd.storeCoverageCount||0}/${rd.totalStores} ร้าน</span>
                            ${SkuDist._miniBar(sp)}
                        </div>
                    </td>
                    <td class="px-3 py-2.5 text-center">
                        <div class="flex flex-col items-center gap-0.5">
                            <span class="text-sm font-black ${SkuDist._coverageColor(kp)}">${kp}%</span>
                            <span class="text-[10px] text-gray-400">${gd.skusSoldCount||0}/${gd.targetSkuCount||0} SKU</span>
                            ${SkuDist._miniBar(kp)}
                        </div>
                    </td>`;
                }).join('')}
            </tr>`;
        }).join('');

        body.innerHTML = `
            <div class="grid grid-cols-2 sm:grid-cols-${Math.min(groups.length, 4)} gap-3 mb-4">
                ${summaryHtml}
            </div>
            <div class="overflow-x-auto rounded-xl border border-gray-100">
                <table class="w-full text-sm">
                    <thead>${thead}</thead>
                    <tbody>${tbody}</tbody>
                </table>
            </div>`;
    },

    _coverageColor: (pct) => {
        if (pct >= 80) return 'text-emerald-600';
        if (pct >= 50) return 'text-amber-500';
        return 'text-red-500';
    },

    _miniBar: (pct) => {
        const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
        return `<div style="width:60px;height:4px;background:#e5e7eb;border-radius:99px;overflow:hidden;">
            <div style="width:${pct}%;height:4px;background:${color};border-radius:99px;"></div>
        </div>`;
    },

    // ─── Export ────────────────────────────────────────────────────────────
    _exportResult: () => {
        if (!SkuDist._result || !SkuDist._activeCampaign) return UI.showErrorToast('ยังไม่มีผลคำนวณ');
        const campaign = SkuDist._activeCampaign;
        const groups   = campaign.groups || [];
        const routes   = Object.keys(SkuDist._result).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));

        const rows = [];
        routes.forEach(route => {
            const rd = SkuDist._result[route];
            const row = { 'สาย': route, 'ร้านทั้งหมด': rd.totalStores };
            groups.forEach(g => {
                const gd = rd.groups?.[g.id] || {};
                row[`${g.name} — ร้านที่กระจาย (%)`]  = gd.storeCoveragePct || 0;
                row[`${g.name} — ร้านที่กระจาย (ร้าน)`] = gd.storeCoverageCount || 0;
                row[`${g.name} — SKU coverage (%)`]     = gd.skuCoveragePct   || 0;
                row[`${g.name} — SKU ที่ขาย`]            = gd.skusSoldCount    || 0;
                row[`${g.name} — SKU เป้าหมาย`]         = gd.targetSkuCount   || 0;
                row[`${g.name} — ยอดขาย (Net)`]         = Math.round(gd.vol   || 0);
            });
            rows.push(row);
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'SKU Distribution');
        const now = new Date();
        XLSX.writeFile(wb, `SKUDist_${campaign.name.replace(/\s+/g,'_')}_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`);
        UI.showSaveToast('📥 Export เรียบร้อยครับ');
    },
};

/* =============================================================================
 *  tabs.js — ยุบแท็บขวาเหลือ 3 แท็บ
 * =============================================================================
 *  เดิม: 1.ข้อมูล  2.จัดสาย  3.แก้วันที่จัด  4.สรุป
 *        แท็บ 1 กับ 3 เป็นรายชื่อร้านเหมือนกัน ต่างแค่ "จัดวันแล้วหรือยัง"
 *        ส่วนรายชื่อ "ยังไม่จัดวัน" ไปแอบอยู่ท้ายแท็บ 2 อีกที่หนึ่ง
 *  ใหม่: 1.ร้านค้า (ชิปกรอง ทั้งหมด / จัดแล้ว / รอจัดวัน)  2.จัดสาย (เครื่องมือ)  3.สรุป
 *
 *  ไม่แตะ UI.render เลย — แค่ย้ายกล่องรายการทั้ง 3 อันมาไว้ที่เดียวกัน
 *  แล้วสลับให้เห็นทีละอัน ตัวเขียนรายการเดิมจึงทำงานเหมือนเดิมทุกอย่าง
 * ========================================================================== */
(function () {
    'use strict';

    // แต่ละชิปคือ "เห็นกล่องไหนบ้าง" — ใช้กล่องรายการเดิมของระบบทั้งหมด ไม่ได้สร้างการ์ดใหม่
    //   ทั้งหมด   = รอจัดวัน + จัดแล้ว   (การ์ดกดแก้วันได้จริง ไม่ใช่รายชื่อเฉย ๆ แบบแท็บ 1 เดิม)
    const LISTS = ['list-unassigned', 'list-assigned'];
    const PANES = {
        all:      { panes: ['wait', 'assigned'], label: 'ทั้งหมด',  ph: '🔍 ค้นหาร้านทั้งหมด...' },
        assigned: { panes: ['assigned'],         label: 'จัดแล้ว',  ph: '🔍 ค้นหาร้านที่จัดวันแล้ว...' },
        wait:     { panes: ['wait'],             label: 'รอจัดวัน', ph: '🔍 ค้นหาร้านที่ยังไม่จัดวัน...' },
    };
    let cur = 'all';

    const $ = (id) => document.getElementById(id);

    // ── นับจำนวนไว้โชว์บนชิป ────────────────────────────────────────────
    const counts = () => {
        // เปิดหลายสาย: นับจากชุดที่กรองแล้วของตัวกรอง ไม่ใช่ State.stores
        // (ตอนรายการถูกตัดให้เหลือสายเดียว State.stores ชั่วคราวจะไม่ใช่ชุดทำงานจริง)
        // ใช้ชุดของตัวกรองเฉพาะตอนเปิดหลายสายจริง ๆ — ถ้ายังไม่ได้แตะตัวกรองเลย
        // MultiRoute.open ยังว่าง แต่ระบบทำงานโหมดสายเดียวตามปกติ ต้องนับจาก State.stores
        // MultiRoute ประกาศเป็น const ระดับสคริปต์ ไม่ได้อยู่บน window — ต้องอ้างชื่อตรง ๆ
        const M = (typeof MultiRoute !== 'undefined') ? MultiRoute : null;
        const useM = !!(M && M.filtered && (M.open || []).length > 1);
        const st = useM ? M.filtered() : ((typeof State !== 'undefined' && State.stores) || []);
        const act = st.filter(s => !s.inactive);
        const wait = act.filter(s => !s.days || !s.days.length).length;
        // Coverage = ร้านที่มีทั้งสายและวันแล้ว (นับหัวร้าน ร้าน F2 นับ 1)
        // Visit    = จำนวนครั้งที่ต้องเข้าจริง = ผลรวมของทุกช่องวัน × จำนวนรอบที่ช่องวันนั้นวิ่งในเดือน
        //            (ศูนย์รอบสั้นช่องวันเดียววิ่ง 2 รอบ ถ้านับแค่ .days.length จะได้ครึ่งเดียว)
        let visits = 0;
        act.forEach(s => {
            if (typeof Freq !== 'undefined' && Freq.visitsOf) { visits += Freq.visitsOf(s); return; }
            visits += (s.days || []).length;
        });
        return { all: act.length, wait, assigned: act.length - wait, visits, cover: act.length - wait };
    };

    const paintChips = () => {
        const c = counts();
        const hint = $('tabs-hint');
        if (hint) hint.classList.toggle('hidden', c.all > 0);
        // ตัวเลขแถบล่างต้องเป็นของ "ชุดสายที่เลือกไว้" เหมือนชิป
        // (ของเดิมอ่านจาก State.stores ซึ่งตอนรายการถูกจำกัดจะเหลือแค่สายเดียว ตัวเลขเลยไม่ตรงกัน)
        const put = (id, v) => { const e = $(id); if (e) e.textContent = v.toLocaleString(); };
        put('stat-total', c.cover); put('stat-pending', c.wait); put('stat-done', c.visits);
        // ป้ายบอกความหมายให้ชัด — ตัวเลข 2 ช่องนี้ต่างกันเมื่อมีร้าน F2 หรือตลาดที่วิ่งหลายรอบ
        const lbl = (id, txt, tip) => {
            const e = $(id); if (!e) return;
            const t = e.previousElementSibling || e.parentElement && e.parentElement.querySelector('p');
            if (t && t.tagName === 'P') { t.textContent = txt; t.title = tip || ''; }
        };
        lbl('stat-total', 'ร้านในแผน', 'จำนวนร้านที่มีทั้งสายและวันเข้าเยี่ยมแล้ว (ร้าน F2 นับ 1)');
        lbl('stat-done', c.visits === c.cover ? 'ครั้งเข้าเยี่ยม' : 'ครั้งเข้าเยี่ยม ▲',
            'จำนวนครั้งที่ต้องเข้าจริงทั้งเดือน — ร้าน F2 นับ 2 ครั้ง');
        const bar = $('progress-bar');
        if (bar) bar.style.width = c.all ? Math.round(((c.all - c.wait) / c.all) * 100) + '%' : '0%';
        Object.keys(PANES).forEach(k => {
            const b = $('chip-' + k);
            if (!b) return;
            b.querySelector('.chip-n').textContent = c[k].toLocaleString();
            b.className = 'chip-btn flex-1 px-2 py-1.5 rounded-xl text-xs font-bold border transition ' +
                (k === cur ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                           : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100');
        });
    };

    // V0.7.6: ค้นหาให้ทำงานกับรายการที่จัดกลุ่ม สาย › ตลาด แล้ว
    //   เดิม UI.filterList ซ่อน/โชว์แค่ลูกชั้นแรก (= ทั้งกลุ่มสาย) ร้านที่ไม่ตรงยังโชว์อยู่ และกลุ่มพับไว้ เลยดูเหมือนค้นไม่ได้
    //   + ตัวหน่วงเวลาตัวเดียวใช้ร่วมกัน 2 รายการ → รายการแรกไม่เคยถูกกรอง
    const timers = {};
    const applyFilter = (id, val) => {
        const box = $(id);
        if (!box) return;
        const q = String(val || '').toLowerCase().trim();
        const cards = [...box.querySelectorAll('div[id^="card-"], label')].filter(c => /ID:/.test(c.textContent));
        const groups = [...box.querySelectorAll('details')];
        if (!q) {
            cards.forEach(c => { c.style.display = ''; });
            groups.forEach(g => {
                g.style.display = '';
                if (g.dataset.sqWas !== undefined) { g.open = g.dataset.sqWas === '1'; delete g.dataset.sqWas; }
            });
            [...box.children].forEach(el => { el.style.display = ''; });
            return;
        }
        cards.forEach(c => {
            const day = c.closest('details');
            const sum = day && day.querySelector(':scope > summary');
            // ตรงชื่อร้าน / รหัส / วัน · หรือชื่อตลาดบนหัวกลุ่ม → โชว์
            const hit = c.textContent.toLowerCase().includes(q) || (sum && sum.textContent.toLowerCase().includes(q));
            c.style.display = hit ? '' : 'none';
        });
        // กลุ่มชั้นในก่อน: ไม่มีร้านที่ตรงเลย = ซ่อน · มี = กางออกให้เห็น
        groups.reverse().forEach(g => {
            const any = [...g.querySelectorAll('div[id^="card-"], label')].some(c => /ID:/.test(c.textContent) && c.style.display !== 'none');
            g.style.display = any ? '' : 'none';
            if (any) { if (g.dataset.sqWas === undefined) g.dataset.sqWas = g.open ? '1' : '0'; g.open = true; }
        });
    };
    if (typeof UI !== 'undefined') UI.filterList = (id, val) => {
        clearTimeout(timers[id]);
        timers[id] = setTimeout(() => applyFilter(id, val), 150);
    };
    // V0.7.8: ค้นข้ามสาย — ร้านที่ตรงคำค้นแต่ไม่อยู่ในรายการ (สายไม่ได้เปิด / วันถูกกรอง / อยู่กองอื่น)
    //   ขึ้นใต้ช่องค้นหา กดแล้วเปิดสายนั้นเพิ่ม + เลือกร้านไว้ + ซูมแผนที่ไปหา
    const UNASSIGNED = 'รอจัดสาย';
    const escH = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nD = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    let xTimer = null, xHits = [];
    const xHost = () => {
        let el = $('tabs-xsearch');
        const inp = $('tabs-search');
        if (!el && inp) {
            el = document.createElement('div');
            el.id = 'tabs-xsearch';
            el.className = 'hidden';
            inp.insertAdjacentElement('afterend', el);
        }
        return el;
    };
    const crossSearch = (val) => {
        const el = xHost();
        if (!el) return;
        const q = String(val || '').toLowerCase().trim();
        xHits = [];
        if (q.length < 2) { el.className = 'hidden'; el.innerHTML = ''; return; }
        const shown = new Set();
        LISTS.forEach(id => {
            const box = $(id);
            if (!box) return;
            box.querySelectorAll('div[id^="card-"], label').forEach(c => {
                if (c.style.display === 'none') return;
                const m = c.textContent.match(/ID:\s*([A-Za-z0-9_.\-]+)/);
                if (m) shown.add(m[1]);
            });
        });
        const R = (State.db && State.db.routes) || {};
        Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true })).forEach(rt => (R[rt] || []).forEach(s => {
            if (!s || shown.has(String(s.id))) return;
            const hay = [s.name, s.code, s.id, s.marketName].map(v => String(v || '').toLowerCase()).join(' ');
            if (hay.includes(q)) xHits.push({ rt, s });
        }));
        if (!xHits.length) { el.className = 'hidden'; el.innerHTML = ''; return; }
        const MAX = 8;
        const where = ({ rt, s }) => s.inactive ? '🗑️ กองออกจากแผน'
            : rt === UNASSIGNED ? '📥 กองรอจัดสาย'
            : rt + ' · ' + ((s.days || []).length ? s.days.slice().sort((a, b) => nD(a) - nD(b)).map(d => 'D' + nD(d)).join('·') : 'ยังไม่จัดวัน');
        el.className = 'bg-amber-50 border border-amber-200 rounded-xl p-2 text-[11px]';
        el.innerHTML = `<p class="font-bold text-amber-800 mb-1">พบนอกรายการที่เปิดอยู่ ${xHits.length.toLocaleString()} ร้าน — กดเพื่อเปิด</p>`
            + xHits.slice(0, MAX).map((h, i) => `
                <button onclick="Tabs.goHit(${i})" class="w-full flex items-center gap-2 text-left px-2 py-1 rounded-lg hover:bg-amber-100">
                  <span class="flex-1 min-w-0 truncate"><b class="text-gray-800">${escH(h.s.name || '')}</b>
                    <span class="font-mono text-[10px] text-gray-400">${escH(h.s.code || h.s.id)}</span></span>
                  <span class="text-[10.5px] font-bold text-amber-800 whitespace-nowrap">${escH(where(h))} →</span>
                </button>`).join('')
            + (xHits.length > MAX ? `<p class="text-[10px] text-amber-700 px-2 pt-1">…อีก ${xHits.length - MAX} ร้าน พิมพ์ให้ละเอียดขึ้น</p>` : '');
    };
    const goHit = (i) => {
        const h = xHits[i];
        if (!h) return;
        const { rt, s } = h;
        if (s.inactive) { if (window.Removed) Removed.open([s.id]); return; }
        try {
            if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen) {
                MultiRoute.allDays && MultiRoute.allDays();
                const cur = MultiRoute.open || [];
                MultiRoute.setOpen(cur.includes(rt) ? cur : cur.concat([rt]));
            }
        } catch (e) {}
        setTimeout(() => {
            try {
                (State.stores || []).forEach(x => { if (String(x.id) === String(s.id)) x.selected = true; });
                if (isFinite(+s.lat) && isFinite(+s.lng) && +s.lat !== 0 && typeof MapCtrl !== 'undefined' && MapCtrl.map)
                    MapCtrl.map.setView([+s.lat, +s.lng], Math.max(MapCtrl.map.getZoom() || 0, 16));
                UI.render();
                UI.showSaveToast(`📌 เปิดสาย ${rt} และเลือก "${s.name}" ไว้แล้ว`);
            } catch (e) { console.warn('[Tabs.goHit]', e); }
        }, 450);
    };
    const search = (v) => {
        LISTS.forEach(id => UI.filterList(id, v));
        clearTimeout(xTimer);
        xTimer = setTimeout(() => crossSearch(v), 260);       // หลังกรองรายการเสร็จ (150ms)
    };

    const show = (k) => {
        if (!PANES[k]) return;
        cur = k;
        const on = PANES[k].panes;
        const c = counts();
        ['wait', 'assigned'].forEach(x => {
            const p = $('pane-' + x);
            // ดูรวม: กลุ่มที่ไม่มีร้านเลยให้ซ่อนไปเลย ไม่ต้องกินที่ด้วยข้อความ "ไม่มีร้าน"
            // ดูรวม: กลุ่มที่ไม่มีอะไรอยู่ในรายการเลย ให้ซ่อนหัวข้อไปด้วย ไม่ต้องเว้นที่ว่างไว้เฉย ๆ
            const l = $(x === 'wait' ? 'list-unassigned' : 'list-assigned');
            const empty = k === 'all' && (c[x] === 0 || !l || l.children.length === 0);
            if (p) p.classList.toggle('hidden', !on.includes(x) || empty);
            const h = $('head-' + x);
            if (h) h.classList.toggle('hidden', k !== 'all');   // หัวข้อคั่นโชว์เฉพาะตอนดูรวม
        });
        const s = $('tabs-search');
        if (s) { s.placeholder = PANES[k].ph; if (s.value) search(s.value); }
        paintChips();
        addMoveButtons();
    };

    // ── ข้อความ "รายการถูกจำกัด" ─────────────────────────────────────
    // ตัวกรองใส่ข้อความนี้ไว้ในกล่องรายการทั้ง 3 กล่อง — พอรวมกล่องมาไว้แท็บเดียวจะเห็นซ้ำกัน
    // ย้ายมาไว้ใต้ชิปอันเดียว แล้วตัดข้อความ "ไม่มีร้าน" ที่ทำให้เข้าใจผิดตอนรายการถูกจำกัดออก
    const tidyCapNote = () => {
        const host = $('tabs-note');
        if (!host) return;
        const notes = document.querySelectorAll('.mr-cap-note');
        if (notes.length) {
            host.innerHTML = '';
            host.appendChild(notes[0]);
            for (let i = 1; i < notes.length; i++) notes[i].remove();
            host.classList.remove('hidden');
            LISTS.forEach(id => {
                const el = $(id);
                if (el) el.querySelectorAll(':scope > p').forEach(x => x.remove());
            });
        } else {
            host.innerHTML = '';
            host.classList.add('hidden');
        }
    };

    // ── ปุ่มย้ายสายบนการ์ด ──────────────────────────────────────────────
    // การ์ดเดิมมีแต่ช่องเลือก "วัน" ถ้าจะย้ายสายต้องไปคลิกหมุดบนแผนที่
    // ใส่ปุ่มเล็ก ⇄ ไว้ที่การ์ด กดแล้วค่อยสร้างช่องเลือกสาย (ไม่งั้นการ์ดละ 1 dropdown = หนักมาก)
    const MV_BTN = '<button data-mv="1" onclick="Tabs.moveCard(this)" title="ย้ายร้านนี้ไปสายอื่น"' +
        ' class="bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 rounded-lg text-xs font-bold border border-gray-200">⇄</button>';

    const addMoveButtons = () => {
        const host = $('list-assigned');
        if (!host) return;
        const cards = host.querySelectorAll('div[id^="card-"]');
        for (const c of cards) {
            if (c.dataset.mvDone) continue;
            c.dataset.mvDone = '1';
            const bar = c.querySelector('.flex.gap-1\\.5') || c.lastElementChild;
            if (bar) bar.insertAdjacentHTML('beforeend', MV_BTN);
        }
    };

    const moveCard = (btn) => {
        const card = btn.closest('div[id^="card-"]');
        if (!card) return;
        const id = card.id.replace(/^card-/, '');
        const cur = (typeof MultiRoute !== 'undefined' && MultiRoute.routeOf)
            ? (MultiRoute.routeOf({ id }) || '') : '';
        let list = [];
        if (typeof MultiRoute !== 'undefined' && MultiRoute.routeList) list = MultiRoute.routeList();
        else list = Object.keys((State.db && State.db.routes) || {});
        const st = (State.stores || []).find(x => String(x.id) === id);
        const from = (st && st.route) || State.localActiveRoute || cur;
        const opts = list.filter(r => r !== from)
            .map(r => `<option value="${r}">${r}</option>`).join('');
        if (!opts) return;
        const sel = document.createElement('select');
        sel.className = 'text-xs p-1.5 border border-indigo-300 rounded-lg bg-white outline-none';
        sel.innerHTML = '<option value="">→ ย้ายไปสาย…</option>' + opts;
        sel.onchange = () => { if (sel.value) MultiRoute.moveStore(id, sel.value); };
        btn.replaceWith(sel);
        sel.focus();
    };

    // ── ประกอบแท็บ 1 ใหม่ ───────────────────────────────────────────────
    const build = () => {
        const t1 = $('tab1'), t2 = $('tab2'), t3 = $('tab3');
        if (!t1 || $('tabs-search')) return false;
        const lUp = $('list-upload'), lAs = $('list-assigned'), lUn = $('list-unassigned');
        if (!lUp || !lAs || !lUn) return false;
        // ถ้าบิลด์นี้ยังมีช่องเลือกไฟล์อยู่ ต้องย้าย element เดิมตามมาด้วย ห้ามสร้างใหม่
        // (admin-data.js ผูก event 'change' ไว้ครั้งเดียวตอนเริ่มระบบ สร้างใหม่แล้วอัปโหลดจะเงียบ)
        const fileInput = $('fileUpload');
        if (fileInput) fileInput.remove();

        t1.innerHTML = `
            <!-- V0.9.2: เอากล่อง "นำร้านเข้าระบบที่ปุ่ม…" ออกตามที่ผู้ใช้ขอ -->
            <div class="flex justify-end mb-1">
                <button id="tabs-unselect" onclick="StoreMgr.clearSelection()"
                    class="hidden text-[11px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-xl px-3 py-1 transition">
                    ยกเลิกเลือก
                </button>
            </div>
            <div class="sticky top-0 bg-gray-50/95 backdrop-blur-sm pt-1 pb-2 z-10 border-b space-y-2">
                <div class="flex gap-1.5">
                    ${Object.entries(PANES).map(([k, v]) => `
                        <button id="chip-${k}" onclick="Tabs.show('${k}')" class="chip-btn flex-1 px-2 py-1.5 rounded-xl text-xs font-bold border bg-white text-gray-600 border-gray-200">
                            ${v.label} <span class="chip-n">0</span>
                        </button>`).join('')}
                </div>
                <input type="text" id="tabs-search" placeholder="${PANES.all.ph}"
                    class="w-full p-2.5 border border-gray-300 rounded-xl text-sm outline-none shadow-inner">
            </div>
            <div id="tabs-note" class="hidden pt-2"></div>
            <div id="pane-wait" class="pt-2">
                <div id="head-wait" class="hidden px-1 pb-1 text-[11px] font-black text-amber-600">● รอจัดวัน</div>
            </div>
            <div id="pane-assigned" class="pt-2">
                <div id="head-assigned" class="hidden px-1 pb-1 pt-3 text-[11px] font-black text-emerald-600">● จัดวันแล้ว</div>
            </div>
            <div id="pane-hidden" class="hidden"></div>`;

        // ย้ายกล่องรายการเดิมเข้ามา (ตัว element เดิม ๆ ไม่ได้สร้างใหม่)
        $('pane-wait').appendChild(lUn);
        $('pane-assigned').appendChild(lAs);
        $('pane-hidden').appendChild(lUp);   // รายชื่อเฉย ๆ ของแท็บ 1 เดิม — ไม่ได้ใช้แล้ว แต่ปล่อยให้ระบบเขียนต่อได้
        if (fileInput) t1.appendChild(fileInput);

        // แถบค้นหาเดียว ใช้กับชิปที่เปิดอยู่
        // ใช้ oninput ไม่ใช่ onkeyup — วางข้อความ/ล้างช่องด้วยเมาส์ก็ต้องกรองด้วย
        $('tabs-search').oninput = function () { search(this.value); };

        // แท็บ 3 เดิมไม่ใช้แล้ว
        if (t3) t3.remove();
        const b3 = $('btn-tab3'); if (b3) b3.remove();
        const set = (id, txt) => { const b = $(id); if (b) b.textContent = txt; };
        set('btn-tab1', '1. ร้านค้า');
        set('btn-tab2', '2. จัดสาย');
        set('btn-tab4', '3. สรุป');

        // แท็บ 2 เหลือเฉพาะเครื่องมือ — ป้ายบอกว่ารายชื่อไปอยู่แท็บ 1 แล้ว
        if (t2 && !$('tab2-hint')) {
            t2.insertAdjacentHTML('beforeend',
                '<p id="tab2-hint" class="text-[11px] text-gray-400 text-center py-4">' +
                'รายชื่อร้านที่ยังไม่จัดวันย้ายไปอยู่แท็บ <b>1. ร้านค้า</b> › ชิป <b>รอจัดวัน</b><br>' +
                'ส่วนตัวสร้างสายใหม่ทั้งศูนย์ อยู่แท็บ <b>4. สร้างสายใหม่</b></p>');
        }

        // แท็บ 4 ใหม่: ตัวสร้างสายใหม่ทั้งศูนย์ (งานคนละจังหวะกับการแก้รายวัน)
        if (!$('tab5')) {
            const holder = t1.parentNode;
            const box = document.createElement('div');
            box.id = 'tab5';                       // ต้องขึ้นต้นด้วย tab เพราะ UI.switchTab ซ่อนจาก div[id^=tab]
            box.className = 'hidden space-y-4';
            box.innerHTML = '<p id="tab5-wait" class="text-[11px] text-gray-400 text-center py-6">'
                + 'กำลังเตรียมตัวสร้างสายใหม่...</p>';
            holder.appendChild(box);
        }
        const bar = $('btn-tab4') && $('btn-tab4').parentNode;
        if (bar && !$('btn-tab5')) {
            bar.insertAdjacentHTML('beforeend',
                '<button onclick="UI.userSwitchTab(\'tab5\')" id="btn-tab5" class="tab-btn flex-1 py-3 px-1">4. สร้างสายใหม่</button>');
        }
        show('all');
        addMoveButtons();
        [600, 1500, 3000, 6000].forEach(t => setTimeout(moveBuilder, t));
        // ระบบวาดรายการเสร็จตั้งแต่ ~0.3 วิ ซึ่งเร็วกว่าที่ส่วนเสริมพวกนี้จะติดตั้งเสร็จ
        // ถ้าไม่สั่งวาดซ้ำ หน้าจอจะค้างเป็นรายการดิบ (ไม่จัดกลุ่ม ไม่มีปุ่มย้ายสาย)
        [400, 1500, 3500].forEach(t => setTimeout(() => {
            try { if (typeof UI !== 'undefined' && UI.render) UI.render(); } catch (e) {}
        }, t));
        return true;
    };

    /** รายการร้านต้องถูกจัดกลุ่มตามตลาดเสมอ — บางจังหวะการวาดจอจบลงด้วยรายการแบน
     *  (เช่นตอนโหลดครั้งแรก) ตัวจัดกลุ่มเรียกซ้ำได้ ถ้าจัดไว้แล้วมันจะไม่ทำอะไร */
    const regroup = () => {
        if (typeof MultiRoute === 'undefined' || !MultiRoute.groupList) return;
        const set = (MultiRoute.multi && MultiRoute.filtered) ? MultiRoute.filtered() : (State.stores || []);
        if (!set.length) return;
        LISTS.forEach(id => {
            const el = $(id);
            if (!el) return;
            const flat = [...el.children].some(k => k.tagName === 'DIV' && /^card-/.test(k.id || ''));
            if (flat) { try { MultiRoute.groupList(id, set); } catch (e) {} }
        });
    };

    /** ตัวสร้างสายใหม่ mount ตัวเองไว้ที่แท็บ 2 — ย้ายกล่องมาไว้แท็บ 4 ให้ */
    const moveBuilder = () => {
        const card = $('rb-card'), host = $('tab5');
        if (card && host && card.parentNode !== host) {
            host.appendChild(card);
            const w = $('tab5-wait'); if (w) w.remove();
        }
        relayoutTab2();
    };

    /**
     * จัดลำดับแท็บ 2 ใหม่: แถบ "จัดลงวัน" ขึ้นบนสุด → กล่องแบ่งกลุ่ม → รายการ
     * AI Route Builder (ทำทั้งสาย ไม่เกี่ยวกับร้านที่เลือก) ย้ายไปอยู่แท็บสร้างสายใหม่
     * เรียกซ้ำได้ — ทุกขั้นเช็กก่อนว่าอยู่ที่ควรอยู่แล้วหรือยัง
     */
    const relayoutTab2 = () => {
        const t2 = $('tab2');
        if (!t2) return;
        const dayEl = $('assign-day');
        const bar = dayEl && dayEl.parentNode;
        const badge = $('selected-count-badge');
        const split = $('split-card');
        // คำอธิบาย "2 วิธีจัดสาย" เก่า — ชี้ไป AI ที่ย้ายออกไปแล้ว
        [...t2.querySelectorAll('div.bg-amber-50')].forEach(d => { if (/2 วิธีจัดสาย/.test(d.textContent)) d.remove(); });
        if (badge && badge.parentNode === t2 && t2.firstElementChild !== badge) t2.insertBefore(badge, t2.firstChild);
        if (bar && bar.parentNode === t2 && badge && badge.nextElementSibling !== bar) t2.insertBefore(bar, badge.nextSibling);
        if (split && bar && split.parentNode === t2 && bar.nextElementSibling !== split) t2.insertBefore(split, bar.nextSibling);
        const hint = $('tab2-hint');
        if (hint && !hint.dataset.v2) {
            hint.dataset.v2 = '1';
            hint.innerHTML = 'เลือกร้านบนแผนที่ (แตะ / Shift-คลิก / วาดพื้นที่) แล้วเลือกวันด้านบน กด <b>จัดลงวัน</b> '
                + 'หรือใช้ <b>แบ่งกลุ่ม</b> ซอยเป็นหลายวัน<br>'
                + 'รายชื่อร้านที่ยังไม่จัดวันอยู่แท็บ <b>1. ร้านค้า</b> › ชิป <b>รอจัดวัน</b> · '
                + 'จัดวันอัตโนมัติทั้งสาย (AI) และสร้างสายใหม่ อยู่แท็บ <b>4</b>';
        }

        // ── AI Route Builder → แท็บสร้างสายใหม่ ──
        const aiBtn = document.querySelector('button[onclick="AI.run()"]');
        const aiBox = aiBtn && aiBtn.closest('.bg-indigo-50');
        const host = $('tab5');
        if (aiBox && host && aiBox.parentNode !== host) {
            host.appendChild(aiBox);
            const w = $('tab5-wait'); if (w) w.remove();
            const h3 = aiBox.querySelector('h3');
            if (h3) h3.insertAdjacentHTML('beforeend',
                ' <span class="ml-1 text-[9px] font-bold text-white bg-indigo-600 rounded px-1.5 py-[1px] align-middle" '
                + 'title="ทำกับร้านที่ยังไม่มีวันของสายที่กำลังแก้ทั้งสาย — ไม่เกี่ยวกับร้านที่เลือกบนแผนที่">ทั้งสาย</span>');
        }
        // ช่อง "จำนวนวันทั้งหมด" = ความยาวรอบของสาย — ล็อกไม่ให้แก้ (เคยเขียนทับ cycleDays ของศูนย์เงียบๆ)
        const k = $('ai-days');
        if (k && !k.readOnly) {
            k.readOnly = true;
            k.tabIndex = -1;
            k.classList.remove('bg-white', 'text-indigo-800');
            k.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
            k.title = 'ความยาวรอบของสาย (อ่านจากปฏิทิน) — แก้ที่ปุ่ม 📅 ปฏิทิน ไม่ใช่ที่นี่';
            const lb = k.parentNode && k.parentNode.querySelector('label');
            if (lb) lb.innerHTML = 'ความยาวรอบ (วัน) <span class="text-[9px] text-gray-400 font-normal">ตามปฏิทินสาย</span>';
        }
        if (k) {
            try {
                const rt = State.localActiveRoute;
                const cyc = (typeof Freq !== 'undefined' && Freq._cycleOf && rt) ? Freq._cycleOf(rt) : (State.db.cycleDays || 24);
                if (cyc && String(k.value) !== String(cyc)) k.value = cyc;
            } catch (e) {}
        }
    };

    // ── ต่อเข้ากับของเดิม ───────────────────────────────────────────────
    const wire = () => {
        if (typeof UI === 'undefined' || UI._tabsWired) return;
        UI._tabsWired = true;

        // ที่ไหนเรียก tab3 อยู่ (เช่น กดร้านบนแผนที่แล้วเลื่อนไปหาการ์ด) → พาไปชิป "จัดแล้ว"
        const sw = UI.switchTab;
        UI.switchTab = function (id, force) {
            if (id === 'tab3') { const r = sw.call(this, 'tab1', force); show('assigned'); return r; }
            return sw.apply(this, arguments);
        };

        const rn = UI.render;
        UI.render = function () {
            const r = rn.apply(this, arguments);
            const after = () => {
                try {
                    tidyCapNote();
                    moveBuilder();
                    regroup();
                    paintChips();
                    show(cur);
                    addMoveButtons();
                    const n = (State.stores || []).filter(s => s.selected).length;
                    const u = $('tabs-unselect');
                    if (u) u.classList.toggle('hidden', n === 0);
                } catch (e) {}
            };
            after();
            // ตัวกรองหลายสายครอบ UI.render อีกชั้นและเขียนรายการต่อ "หลัง" ตัวนี้จบ
            // จึงต้องจัดหน้าซ้ำท้ายคิวด้วย ไม่งั้นข้อความซ้ำ/การ์ดใหม่จะหลุด
            setTimeout(after, 0);
            return r;
        };
    };

    window.Tabs = { show, refresh: paintChips, moveCard, goHit, _build: build, _xHits: () => xHits };

    document.addEventListener('DOMContentLoaded', () => {
        const t = setInterval(() => { if (build()) { wire(); clearInterval(t); } }, 300);
        setTimeout(() => clearInterval(t), 15000);
    });
})();

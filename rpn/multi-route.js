/* =============================================================================
 *  multi-route.js — ตัวกรองแผนที่: สาย × วัน + ร้านที่ยังไม่จัดวัน
 * =============================================================================
 *  รวมดรอปดาวน์เลือกสายเดิมกับตัวเลือกหลายสายไว้ในแผงเดียว
 *
 *    ติ๊กสาย   → สายไหนโผล่บนแผนที่และในรายการ
 *    คลิกชื่อสาย → ตั้งเป็น "สายที่กำลังแก้"
 *    ติ๊กวัน   → กรองว่าจะเห็นวันไหน ข้ามทุกสายที่เปิดอยู่
 *    ⊕ ยังไม่จัดวัน → ร้านที่ไม่มีวัน (ถือว่าเป็นร้านใหม่) แสดงเป็นวงกลมกลวงขอบประ
 *
 *  หลักที่ทำให้ข้อมูลไม่พัง
 *    • ติดชื่อสายไว้กับร้านทุกร้าน (s.route)
 *    • งานระดับ "วัน" — ลำดับคิว · CY · หน้าต่างรายวัน · การ์ดรายวัน · ระยะ Master
 *      ทำกับ "สายที่กำลังแก้" เสมอ ลำดับคิวและ CY จึงไม่มีทางปนข้ามสาย
 *    • เปิดสายเดียวและไม่กรองวัน = ระบบทำงานเหมือนเดิมทุกอย่าง
 * ========================================================================== */
const MultiRoute = (() => {
    'use strict';

    const PALETTE = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#10b981', '#14b8a6',
                     '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
                     '#ec4899', '#f43f5e', '#0ea5e9', '#65a30d'];
    const UNASSIGNED = 'รอจัดสาย';
    // V0.7.5: 🚩/🏁 ที่ปักแล้ว = พื้นเขียว + ✓ · ยังไม่ปัก = จางเป็นสีเทา (อีโมจิไม่รับสีตัวอักษร ต้องใช้ filter)
    const flagCss = (on) => on
        ? 'position:relative;background:#d1fae5;box-shadow:0 0 0 1.5px #10b981;'
        : 'filter:grayscale(1);opacity:.35;';
    const FLAG_OK = '<span style="position:absolute;top:-5px;right:-5px;width:12px;height:12px;border-radius:9999px;background:#059669;color:#fff;font-size:8px;line-height:12px;font-weight:900;text-align:center">✓</span>';
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const dayName = d => (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[d]) ? DAY_COLORS[d].name : d;

    let open = [];                 // สายที่เปิดอยู่
    let dayFilter = null;          // null = ทุกวัน · Set = เฉพาะวันที่เลือก
    let showNew = true;            // แสดงร้านที่ยังไม่จัดวัน
    let colorMode = 'route';
    let layer = null;

    const M = {
        get isOn() { return open.length !== 1 || !!dayFilter || !showNew; },
        /* multi = "ไม่ได้เปิดสายเดียวพอดี"
           สำคัญมากที่ 0 สาย ต้องถือเป็น multi ด้วย — ถ้านับเป็นโหมดสายเดียว
           App.saveDB จะเอา State.stores (ว่างเปล่า) ไปเขียนทับสายที่กำลังแก้ = ร้านหายทั้งสาย
           พอเป็น multi การเซฟจะไล่เขียนเฉพาะสายที่เปิด ซึ่งไม่มีเลย จึงไม่เขียนอะไร */
        get multi() { return open.length !== 1; },
        get empty() { return open.length === 0; },
        get open() { return open.slice(); },
        get colorMode() { return colorMode; },

        routeList() {
            const l = (State.db.routeList && State.db.routeList.length)
                ? State.db.routeList : Object.keys(State.db.routes || {});
            return [...new Set(l)].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
        },
        colorOf(route) {
            const i = M.routeList().indexOf(route);
            return route === UNASSIGNED ? '#94a3b8' : PALETTE[((i < 0 ? 0 : i) * 7) % PALETTE.length];
        },
        dayList() {
            const n = State.db.cycleDays || 24;
            const out = [];
            for (let i = 1; i <= n; i++) if (typeof DAY_COLORS === 'undefined' || DAY_COLORS['Day ' + i]) out.push('Day ' + i);
            return out;
        },

        stamp() {
            const R = State.db.routes || {};
            Object.keys(R).forEach(name => (R[name] || []).forEach(s => { s.route = name; }));
        },
        routeOf(s) { return s.route || State.localActiveRoute; },

        /** ร้านทั้งหมดของสายที่เปิดอยู่ ผ่านตัวกรองวันแล้ว */
        filtered() {
            M.stamp();
            const R = State.db.routes || {};
            const out = [];
            open.forEach(name => (R[name] || []).forEach(s => {
                const assigned = s.days && s.days.length;
                if (!assigned) { if (showNew) out.push(s); return; }
                if (!dayFilter || s.days.some(d => dayFilter.has(d))) out.push(s);
            }));
            return out;
        },
        /** State.stores = ร้านของทุกสายที่เปิด (ยังไม่กรองวัน) — เพื่อให้เลือกร้านข้ามสายได้ */
        rebuild() {
            M.stamp();
            const R = State.db.routes || {};
            if (M.empty) { State.stores = []; return; }   // ไม่ได้ติ๊กสายไหนเลย
            if (!M.multi) {                       // เปิดสายเดียว = คืน State.stores ให้เป็นของสายนั้น
                State.stores = R[open[0]] || [];
                return;
            }
            const arr = [];
            open.forEach(name => (R[name] || []).forEach(s => arr.push(s)));
            State.stores = arr;
        },

        storesOf(route, from) {
            return (from || State.stores || []).filter(s => M.routeOf(s) === route);
        },

        /* ── หมุดเต็ม vs จุดสี ────────────────────────────────────────────
           ตัดสินจาก "จำนวนร้านที่อยู่ในจอตอนนั้น" ไม่ใช่จากสาย
             ในจอ ≤ PIN_LIMIT → หมุดเต็มทุกสาย เห็นเลขวัน เลขคิว ป้าย F2
             มากกว่านั้น      → จุดสีทั้งหมด (วาดเร็วกว่าราว 19 เท่า)
           ตอนหมุดเยอะจนต้องใช้จุดสี ตัวเลขในหมุดก็ซ้อนกันจนอ่านไม่ออกอยู่แล้ว */
        PIN_LIMIT: 400,
        LIST_LIMIT: 2000,
        _listCapped: false,
        _pinIds: null,
        pinIds(src) {
            const list = src || State.stores || [];
            if (!MapCtrl || !MapCtrl.map) return new Set(list.map(s => s.id));
            let b;
            try { b = MapCtrl.map.getBounds(); } catch (e) { return new Set(list.map(s => s.id)); }
            const inView = [];
            for (const s of list) {
                if (s.inactive || !isFinite(s.lat) || !isFinite(s.lng)) continue;
                if (b.contains([s.lat, s.lng])) {
                    inView.push(s);
                    if (inView.length > M.PIN_LIMIT) return new Set();   // เยอะเกิน → จุดสีล้วน
                }
            }
            return new Set(inView.map(s => s.id));
        },

        // ── ตัวควบคุม ────────────────────────────────────────────────────
        setOpen(list) {
            const valid = M.routeList();
            open = (list || []).filter(r => valid.includes(r));
            M.apply();
        },
        toggleRoute(route) {
            const i = open.indexOf(route);
            if (i >= 0) open.splice(i, 1); else open.push(route);
            M.setOpen(open);
        },
        pickRoute(route) {
            if (!open.includes(route)) open.push(route);
            App.switchRoute(route);
            setTimeout(() => { M.apply(); }, 300);
        },
        openAll() { M.setOpen(M.routeList()); },
        /** ชุดสายที่ควรทำงานด้วย — คัดสายที่ร้านน้อยผิดปกติ (สายพิเศษ) ออก */
        openSuggested() {
            if (typeof RouteBuilder !== 'undefined' && RouteBuilder.defaultRoutes) {
                const want = [...RouteBuilder.defaultRoutes()];
                if (want.length) return M.setOpen(want);
            }
            M.openAll();
        },
        openOne() { M.setOpen([State.localActiveRoute]); },

        toggleDay(day) {
            if (!dayFilter) dayFilter = new Set(M.dayList());
            if (dayFilter.has(day)) dayFilter.delete(day); else dayFilter.add(day);
            if (dayFilter.size === M.dayList().length) dayFilter = null;
            M.refresh();
        },
        allDays() { dayFilter = null; M.refresh(); },
        noDays() { dayFilter = new Set(); M.refresh(); },
        toggleNew() { showNew = !showNew; M.refresh(); },
        setColorMode(m) { colorMode = m; M.refresh(); },

        refresh() { UI.render(); M.panel(); },

        /** ป้ายบอกว่ารายการด้านขวาถูกจำกัดไว้ที่สายเดียว */
        listNote(fullSet, listSet) {
            ['list-upload', 'list-assigned', 'list-unassigned'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.querySelectorAll(':scope > .mr-cap-note').forEach(n => n.remove());
                if (!M._listCapped) return;
                const n = document.createElement('div');
                n.className = 'mr-cap-note bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2 text-[10.5px] text-amber-800 leading-snug';
                n.innerHTML = `รายการนี้แสดงเฉพาะสาย <b>${esc(M._listRoute || State.localActiveRoute)}</b> `
                    + `(${listSet.length.toLocaleString()} ร้าน) เพราะเปิดอยู่ `
                    + `<b>${open.length} สาย รวม ${fullSet.length.toLocaleString()} ร้าน</b> ซึ่งมากเกินกว่าจะสร้างรายการไหว<br>`
                    + `<b>บนแผนที่ยังแก้ได้ทุกสายตามปกติ</b> — ถ้าอยากได้รายการของสายอื่น กดชื่อสายนั้นในตัวกรอง `
                    + `หรือติ๊กสายให้เหลือน้อยลง`;
                el.insertBefore(n, el.firstChild);
            });
        },

        /** วาดเฉพาะชั้นแผนที่ — ใช้ตอนเลื่อน/ซูม ไม่ต้องวาดรายการด้านขวาใหม่ */
        redrawMap() {
            if (!MapCtrl || !MapCtrl.map) return;
            const show = M.isOn ? M.filtered() : (State.stores || []);
            try { MapCtrl.renderMarkers(); } catch (e) { console.warn('[MultiRoute] markers', e); }
            try { M.render(show); } catch (e) { console.warn('[MultiRoute] dots', e); }
        },

        async apply() {
            const ym = App._currentPlanYM;
            const need = open.filter(r => !Array.isArray((State.db.routes || {})[r]));
            if (need.length && ym) {
                UI.showLoader('กำลังโหลด ' + need.length + ' สาย...', need.join(' · '));
                for (const r of need) {
                    try {
                        const d = await App.planRoutesCol(ym).doc(r).get();
                        State.db.routes[r] = d.exists ? (d.data().stores || []) : [];
                    } catch (e) { State.db.routes[r] = []; }
                }
                UI.hideLoader();
            }
            M.rebuild();
            MapCtrl.clearAll();
            UI.render(); M.panel();
        },

        // ── บันทึกทุกสายที่เปิด ───────────────────────────────────────────
        saveOpen() {
            const ym = App._currentPlanYM;
            if (!ym) return;
            const R = State.db.routes || {};
            const routeList = Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            Promise.all([
                ...open.filter(r => Array.isArray(R[r])).map(r => App.planRoutesCol(ym).doc(r).set({
                    stores: R[r],
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                }, { merge: true })),
                App.planRef(ym).set({ routeList, cycleDays: State.db.cycleDays || 24,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
            ]).then(() => UI.showSaveToast(`💾 บันทึก ${open.length} สายเรียบร้อย`))
              .catch(err => { console.error('saveOpen:', err); UI.showErrorToast('❌ บันทึกไม่สำเร็จ'); });
        },

        /** เอาร้านออกจากแผนเดือนนี้ — ไม่ได้ลบร้านทิ้ง แค่ย้ายไปพักที่สาย "รอจัดสาย"
         *  (ถ้าจะลบถาวรจริง ๆ ใช้ปุ่มลบถาวรในรายการร้านที่พัก) */
        unplanStore(id) {
            const R = State.db.routes || {};
            let s = null, from = null;
            Object.keys(R).some(r => {
                const f = (R[r] || []).find(x => String(x.id) === String(id));
                if (f) { s = f; from = r; return true; } return false;
            });
            if (!s || s.inactive) return;
            // V0.7.5: ไปกอง "ออกจากแผน" (นับเป็น Remove) — ไม่ปนกับกองรอจัดสายซึ่งไว้ดูร้านใหม่
            UI.showConfirm(
                `เอา "${s.name}" ออกจากแผนของสาย ${from}?\n\n` +
                `ร้านจะไปอยู่กอง "ออกจากแผน" — ไม่ถูกส่งออก DMS และนับเป็น Remove ในหน้าภาพรวม\n` +
                `ร้านไม่หาย ดึงกลับเข้าวันเดิมได้จากปุ่ม 🗑️ ออกจากแผน ในแท็บ 1`,
                () => { try { MapCtrl.map.closePopup(); } catch (e) {} Removed.remove([id]); });
        },

        // ── ย้ายร้านข้ามสาย ──────────────────────────────────────────────
        async moveStore(id, toRoute) {
            const R = State.db.routes || {};
            let s = null, from = null;
            Object.keys(R).some(r => {
                const f = (R[r] || []).find(x => String(x.id) === String(id));
                if (f) { s = f; from = r; return true; } return false;
            });
            if (!s || !toRoute || from === toRoute) return;
            if (!Array.isArray(R[toRoute])) {
                const d = await App.planRoutesCol(App._currentPlanYM).doc(toRoute).get().catch(() => null);
                R[toRoute] = (d && d.exists) ? (d.data().stores || []) : [];
            }
            const fromDays = [...(s.days || [])];
            R[from] = (R[from] || []).filter(x => String(x.id) !== String(id));
            const dstDays = new Set((R[toRoute] || []).flatMap(x => x.days || []));
            const keep = (s.days || []).filter(d => dstDays.has(d));
            s.days = keep; s.seqs = {}; s.cys = {}; s.cy = '';
            s.route = toRoute; s.selected = false;
            R[toRoute].push(s);
            if (!open.includes(toRoute)) open.push(toRoute);
            M.rebuild();
            if (typeof SeqTool !== 'undefined') {
                if (keep.length) SeqTool.reflow(keep, toRoute);
                fromDays.forEach(d => SeqTool.compact(d, from));
            }
            M.saveOpen(); UI.render(); M.panel();
            UI.showSaveToast(`🔀 ย้าย "${s.name}" ${from} → ${toRoute}` +
                (keep.length ? ` (คง ${keep.join(', ')})` : ' (ยังไม่ได้จัดวัน)'));
        },

        /** ย้อมหมุดเต็มเป็นสีสาย (ยกเว้นร้านที่เลือกไว้ = เหลืองเหมือนเดิม) */
        tintPins(list) {
            (list || []).forEach(s => {
                if (s.selected) return;
                const m = MapCtrl.markers[s.id];
                const el = m && m.getElement && m.getElement();
                const path = el && el.querySelector('svg path');
                if (!path) return;
                path.setAttribute('fill', M.colorOf(M.routeOf(s)));
                path.setAttribute('stroke', '#fff');
            });
        },

        // ── วาดจุดของสายอื่น (สายที่กำลังแก้ใช้หมุดเต็มเหมือนเดิม) ─────────
        render(stores) {
            if (!MapCtrl || !MapCtrl.map) return;
            if (layer) { MapCtrl.map.removeLayer(layer); layer = null; }
            const src = stores || [];
            if (!src.length) return;
            const pins = M._pinIds;
            const renderer = L.canvas({ padding: 0.4 });
            const cmap = {};
            M.routeList().forEach(r => { cmap[r] = M.colorOf(r); });
            const marks = [];
            src.forEach(s => {
                if (s.inactive || !isFinite(s.lat) || !isFinite(s.lng)) return;
                if (pins && pins.has(s.id)) return;                    // ร้านนี้ได้หมุดเต็มแล้ว
                const assigned = s.days && s.days.length;
                const sel = !!s.selected;
                let opt;
                if (!assigned) {
                    // ร้านที่ยังไม่จัดวัน = ร้านใหม่ → วงกลมกลวงขอบประ เห็นชัดว่าไม่เหมือนใคร
                    opt = { renderer, radius: sel ? 8 : 6, weight: 2.5, dashArray: '3,2',
                            color: sel ? '#111827' : '#dc2626',
                            fillColor: sel ? '#facc15' : '#ffffff', fillOpacity: 0.95 };
                } else {
                    const fill = (colorMode === 'day')
                        ? ((typeof DAY_COLORS !== 'undefined' && DAY_COLORS[s.days[0]]) ? DAY_COLORS[s.days[0]].hex : '#cbd5e1')
                        : (cmap[s.route] || '#94a3b8');
                    opt = { renderer, radius: sel ? 7 : 5, weight: sel ? 3 : 1,
                            color: sel ? '#111827' : '#ffffff',
                            fillColor: sel ? '#facc15' : fill, fillOpacity: 0.9 };
                }
                const mk = L.circleMarker([s.lat, s.lng], opt);
                mk.__store = s;
                marks.push(mk);
            });
            if (!marks.length) return;
            layer = L.featureGroup(marks, { renderer });
            layer.on('click', (ev) => {
                const s = ev.layer && ev.layer.__store;
                if (!s || (typeof Lasso !== 'undefined' && Lasso.active)) return;
                if (ev.originalEvent && (ev.originalEvent.shiftKey || ev.originalEvent.ctrlKey)) {
                    StoreMgr.toggleSelect(s.id); UI.render(); return;
                }
                M.popup(s, ev.latlng);
            });
            layer.on('mouseover', (ev) => {
                const s = ev.layer && ev.layer.__store;
                if (!s) return;
                const on = s.days && s.days.length;
                const sg = M.suggestOf(s);
                MapCtrl.map.openTooltip(
                    `<b>${esc(s.name)}</b><br>${esc(s.route)}${on ? ' · ' + esc(s.days.map(dayName).join(' & ')) : ' · <b style="color:#dc2626">ยังไม่จัดวัน</b>'}`
                    + (sg ? `<br><span style="color:#b45309">Salesman: ${esc(sg)}</span>` : ''),
                    [s.lat, s.lng], { direction: 'top', offset: [0, -6] });
            });
            layer.on('mouseout', () => MapCtrl.map.closeTooltip());
            layer.addTo(MapCtrl.map);
        },

        /** สายที่ Salesman Code ในไฟล์ Customer Master ชี้ไว้ (ถ้าตรงกับสายที่มีอยู่จริง) */
        suggestOf(s) {
            const code = String((s && s.salesCode) || '').trim();
            if (!code) return '';
            const rt = M.routeOf(s);
            if (code === rt) return '';
            return M.routeList().includes(code) ? code : '';
        },

        popup(s, latlng) {
            const routes = M.routeList().filter(r => r !== s.route);
            const days = M.dayList();
            const isNew = !(s.days && s.days.length);
            const sug = M.suggestOf(s);
            const html = `
                <div class="text-sm min-w-[190px]">
                    <b class="text-[13px] text-gray-800 block leading-tight">${esc(s.name)}</b>
                    <span class="text-gray-400 text-[10px] font-mono block mb-1.5">${esc(s.id)}</span>
                    <div class="flex gap-1 mb-1.5 flex-wrap">
                        <span class="text-[11px] font-bold px-1.5 py-0.5 rounded text-white"
                              style="background:${M.colorOf(s.route)}">${esc(s.route)}</span>
                        ${isNew ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                            ${s.route === UNASSIGNED ? '⊕ ร้านใหม่' : '⊕ ยังไม่จัดวัน'}</span>` : ''}
                    </div>
                    ${sug ? `<div class="bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-1.5">
                        <div class="text-[10px] text-amber-700 font-bold leading-tight mb-1">
                            Salesman Code ในไฟล์ Master = <b>${esc(sug)}</b></div>
                        <button onclick="MultiRoute.moveStore('${esc(s.id)}', '${esc(sug)}')"
                            class="w-full bg-amber-500 hover:bg-amber-600 text-white py-1 rounded text-[11px] font-bold">
                            → ย้ายเข้าสาย ${esc(sug)}</button>
                    </div>` : ''}
                    ${(typeof Visits !== 'undefined' && Visits.popupHTML) ? Visits.popupHTML(s) : `<label class="block text-[10px] text-gray-400 font-bold">วันที่เข้าเยี่ยม</label>
                    <select onchange="StoreMgr.changeDay('${esc(s.id)}', this.value); UI.render();"
                            class="w-full border border-gray-200 rounded-md px-1 py-1 text-xs mb-1.5">
                        <option value="remove">— ยังไม่จัดวัน —</option>
                        ${days.map(d => `<option value="${d}" ${(s.days || [])[0] === d ? 'selected' : ''}>${dayName(d)}</option>`).join('')}
                    </select>`}
                    <label class="block text-[10px] text-gray-400 font-bold">ย้ายไปสาย</label>
                    <select onchange="if(this.value) MultiRoute.moveStore('${esc(s.id)}', this.value)"
                            class="w-full border border-gray-200 rounded-md px-1 py-1 text-xs mb-1.5">
                        <option value="">— เลือกสายปลายทาง —</option>
                        ${routes.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
                    </select>
                    <button onclick="StoreMgr.toggleSelect('${esc(s.id)}'); UI.render(); MapCtrl.map.closePopup();"
                        class="w-full bg-gray-900 text-white py-1 rounded-md text-[11px] font-bold">
                        ${s.selected ? 'ยกเลิกเลือก' : 'เลือกร้านนี้'}</button>
                    ${s.inactive ? '' : `<button onclick="MultiRoute.unplanStore('${esc(s.id)}')"
                        title="เอาร้านนี้ออกจากแผนเดือนนี้ → กอง ออกจากแผน (นับเป็น Remove) — ร้านไม่หาย ดึงกลับได้"
                        class="w-full mt-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-1 rounded-md text-[11px] font-bold">
                        🗑️ เอาออกจากแผน</button>`}
                </div>`;
            L.popup({ closeButton: true }).setLatLng(latlng).setContent(html).openOn(MapCtrl.map);
        },

        // ── จัดกลุ่มรายการร้านทางขวา: สาย › วัน ───────────────────────────
        groupList(elId, all) {
            const el = document.getElementById(elId);
            if (!el) return;
            const kids = [...el.children].filter(k => k.tagName === 'DIV');
            if (!kids.length) return;
            const byId = new Map((all || []).map(s => [String(s.id), s]));
            const tree = new Map();                       // route -> Map(day -> [node])
            const uniq = new Map();                       // route -> Set(id) — นับร้านไม่ซ้ำ
            let unknown = [];
            kids.forEach(k => {
                const m = k.textContent.match(/ID:\s*([A-Za-z0-9_.\-]+)/);
                const s = m ? byId.get(m[1]) : null;
                if (!s) { unknown.push(k); return; }
                const rt = M.routeOf(s);
                if (!tree.has(rt)) tree.set(rt, new Map());
                const dm = tree.get(rt);
                if (!uniq.has(rt)) uniq.set(rt, new Set());
                uniq.get(rt).add(String(s.id));
                // V0.7.6: ร้านที่อยู่หลายตลาด (F2 / เข้ารายสัปดาห์) ขึ้นใต้ทุกตลาดที่อยู่ — เดิมขึ้นแค่ตลาดแรก
                // ทำให้ตลาดที่ 2 เป็นต้นไปดูเหมือนไม่มีร้านนั้น และตัวเลขบนหัวตลาดนับขาด
                const nd = (d) => parseInt(String(d).replace(/\D/g, ''), 10) || 0;
                const all = (s.days && s.days.length) ? s.days.slice().sort((a, b) => nd(a) - nd(b)) : [];
                const vis = all.filter(d => !dayFilter || dayFilter.has(d));
                const keys = vis.length ? vis : [all.length ? all[0] : '__new'];
                keys.forEach((dk, i) => {
                    let node = k;
                    if (i > 0) { node = k.cloneNode(true); node.dataset.dupOf = dk; }
                    // V0.8.0: ร้านที่อยู่หลาย Day — ปุ่ม ➖ เอาออกจาก Day ของกลุ่มนี้ Day เดียว
                    if (all.length >= 2 && dk !== '__new' && /^card-/.test(node.id || '')) {
                        const old = node.querySelector('[data-rmday]'); if (old) old.remove();
                        const bar = node.querySelector('.flex.gap-1\\.5');
                        if (bar) bar.insertAdjacentHTML('afterbegin',
                            `<button data-rmday="1" onclick="event.stopPropagation();Runs.removeDayOnly('${esc(rt)}','${esc(dk)}','${esc(s.id)}')"
                                title="เอาออกจาก D${nd(dk)} ตลาดเดียว — Day อื่นยังอยู่"
                                class="bg-red-50 hover:bg-red-100 text-red-600 px-2 rounded-lg font-black border border-red-200 text-sm leading-none">➖</button>`);
                    }
                    if (!dm.has(dk)) dm.set(dk, []);
                    dm.get(dk).push(node);
                });
            });
            if (!tree.size) return;
            if (!document.getElementById('mr-chev-css')) {
                const st = document.createElement('style'); st.id = 'mr-chev-css';
                st.textContent = 'details > summary .mr-chev{transition:transform .15s} details[open] > summary .mr-chev{transform:rotate(90deg)} details > summary::-webkit-details-marker{display:none} details > summary{list-style:none}';
                document.head.appendChild(st);
            }
            const frag = document.createDocumentFragment();
            [...tree.keys()].sort((a, b) => a.localeCompare(b, 'th', { numeric: true })).forEach(rt => {
                const dm = tree.get(rt);
                const total = uniq.has(rt) ? uniq.get(rt).size : [...dm.values()].reduce((t, a) => t + a.length, 0);
                const dRoute = document.createElement('details');
                // เปิดหลายสาย = หุบไว้ก่อน (ยกเว้นสายที่กำลังแก้) · จำสถานะที่ผู้ใช้กางไว้ข้ามการวาดใหม่
                if (!M._openRt) M._openRt = {};
                const manyOpen = tree.size > 1;
                dRoute.open = (M._openRt[rt] !== undefined) ? M._openRt[rt] : (!manyOpen || rt === State.localActiveRoute);
                dRoute.addEventListener('toggle', () => { M._openRt[rt] = dRoute.open; });
                dRoute.className = 'mb-2 border border-gray-200 rounded-xl overflow-hidden';
                const sRoute = document.createElement('summary');
                sRoute.className = 'cursor-pointer select-none px-2.5 py-1.5 text-xs font-black text-white flex items-center gap-2';
                sRoute.style.background = M.colorOf(rt);
                const nMk = [...dm.keys()].filter(k => k !== '__new').length;
                sRoute.innerHTML = `<span class="mr-chev inline-block w-3 text-center opacity-80" aria-hidden="true">▶</span>`
                    + `<span class="flex-1">${esc(rt)}${rt === State.localActiveRoute ? ' ◀ กำลังแก้' : ''}</span>`
                    + `<span class="tabular-nums text-[10.5px] font-bold opacity-90">${nMk} ตลาด · ${total} ร้าน</span>`;
                dRoute.appendChild(sRoute);
                const body = document.createElement('div');
                body.className = 'p-1.5 bg-gray-50 space-y-1.5';
                const keys = [...dm.keys()].sort((a, b) => {
                    if (a === '__new') return 1; if (b === '__new') return -1;
                    return (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0);
                });
                keys.forEach(dk => {
                    const dDay = document.createElement('details');
                    // พับไว้ก่อน เห็นแค่จำนวน กดค่อยกาง (กลุ่มร้านที่ยังไม่จัดวันเปิดไว้เลย)
                    dDay.open = (dk === '__new') || M._openDay === (rt + '|' + dk);
                    dDay.className = 'bg-white border border-gray-200 rounded-lg overflow-hidden';
                    const sDay = document.createElement('summary');
                    sDay.className = 'cursor-pointer select-none px-2 py-1 text-[11px] font-bold flex items-center gap-2 '
                        + (dk === '__new' ? 'text-red-600 bg-red-50' : 'text-gray-600');
                    const info = M._dayInfo(rt, dk, all);
                    sDay.innerHTML =
                        `<span class="mr-chev inline-block w-2.5 text-center text-[9px] text-gray-400" aria-hidden="true">▶</span>`
                        + `<span class="shrink-0 text-gray-700">${dk === '__new' ? '⊕ ยังไม่จัดวัน' : 'D' + (parseInt(String(dk).replace(/\D/g, ''), 10) || 0)}</span>`
                        + `<span class="flex-1 min-w-0 truncate font-normal text-gray-500">${esc(info.market || '—')}</span>`
                        + (info.was ? `<span class="shrink-0 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1">เดิม ${esc(info.was)}</span>` : '')
                        + (typeof DayDate !== 'undefined' && dk !== '__new'
                            ? `<span class="shrink-0 text-[9.5px] text-gray-400">${(DayDate.dateOf(rt, dk) || {}).txt || ''}</span>` : '')
                        + `<span class="tabular-nums text-gray-400 shrink-0">${dm.get(dk).length}</span>`;
                    if (dk !== '__new') {
                        // ปักจุดเริ่ม/จุดจบได้จากหน้ารายชื่อเลย ไม่ต้องเข้าไปในหน้าต่างรายวัน
                        const info2 = M._pointInfo(rt, dk);
                        sDay.insertAdjacentHTML('beforeend',
                            `<button onclick="event.preventDefault();event.stopPropagation();MultiRoute.pointFor('${esc(rt)}','${esc(dk)}','start')"
                                title="จุดเริ่มของวันนี้${info2.start ? ' — ' + esc(info2.start) : ''}"
                                class="shrink-0 px-1 rounded" style="${flagCss(info2.start)}">🚩${info2.start ? FLAG_OK : ''}</button>`
                          + `<button onclick="event.preventDefault();event.stopPropagation();MultiRoute.pointFor('${esc(rt)}','${esc(dk)}','end')"
                                title="จุดจบของวันนี้${info2.end ? ' — ' + esc(info2.end) : ''}"
                                class="shrink-0 px-1 rounded" style="${flagCss(info2.end)}">🏁${info2.end ? FLAG_OK : ''}</button>`);
                    }
                    dDay.addEventListener('toggle', () => { M._openDay = dDay.open ? (rt + '|' + dk) : null; });
                    dDay.appendChild(sDay);
                    const inner = document.createElement('div');
                    inner.className = 'p-1.5 space-y-1.5';
                    dm.get(dk).forEach(n => inner.appendChild(n));
                    dDay.appendChild(inner);
                    body.appendChild(dDay);
                });
                dRoute.appendChild(body);
                frag.appendChild(dRoute);
            });
            unknown.forEach(n => frag.appendChild(n));
            el.innerHTML = '';
            el.appendChild(frag);
        },

        _openDay: null,
        _sumOpen: null,
        _sumAll: false,
        sumAll(v) {
            M._sumAll = !!v; M._sumOpen = null;
            M.fixSummary();
            try { if (typeof RoadMaster !== 'undefined' && RoadMaster.render) RoadMaster.render(); } catch (e) {}
        },
        sumToggle(rt, open) {
            if (open) { M._sumAll = false; M._sumOpen = rt; }
            else if (M._sumOpen === rt) M._sumOpen = null;
        },

        /** ชื่อจุดเริ่ม/จุดจบที่ตั้งไว้ของวันนั้น (ไว้โชว์สีปุ่ม) */
        _pointInfo(route, day) {
            const cy = ((State.db.cyPoints || {})[route] || {})[day] || {};
            return { start: cy.start ? (cy.start.name || 'ตั้งไว้แล้ว') : '', end: cy.end ? (cy.end.name || 'ตั้งไว้แล้ว') : '' };
        },

        /** เปิดหน้าต่างตั้งจุดเริ่ม/จุดจบจากหน้ารายชื่อ (สลับสายให้เองถ้าจำเป็น) */
        pointFor(route, day, which) {
            if (typeof RoadMaster === 'undefined' || !RoadMaster.pointMenu) return;
            // ตัวเดิมจะเปิดหน้าต่างรายวันให้หลังบันทึก — เรียกจากหน้ารายชื่อไม่ต้องเปิด
            const orig = UI.showDayModal;
            UI.showDayModal = function () {};
            setTimeout(() => { UI.showDayModal = orig; }, 4000);
            if (route && route !== State.localActiveRoute) {
                M.pickRoute(route);
                setTimeout(() => { try { RoadMaster.pointMenu(day, which); } catch (e) {} }, 420);
            } else {
                RoadMaster.pointMenu(day, which);
            }
        },
        /** ชื่อตลาดของกลุ่ม + วันเดิมที่ร้านกลุ่มนี้เคยอยู่ (อ่านจาก Cycle Name ในไฟล์ที่นำเข้า) */
        _dayInfo(route, dk, all) {
            if (dk === '__new') return { market: '', was: '' };
            const src = (State.db.routes || {})[route] || all || [];
            const mem = src.filter(s => (s.days || []).includes(dk));
            const mk = {}, was = {};
            mem.forEach(s => {
                if (s.marketName) mk[s.marketName] = (mk[s.marketName] || 0) + 1;
                // ชื่อรอบเดิมของแต่ละศูนย์เขียนคนละทรง (…D01…, …DAY1…, … R01 …) ใช้ตัวแกะตัวเดียวกับตอนนำเข้า
                const od = (typeof SysImport !== 'undefined' && SysImport.parseCycleName)
                    ? (SysImport.parseCycleName(s.dayOriginal || '', route) || {}).day
                    : (/\bD(\d{1,2})\b/.exec(s.dayOriginal || '') || [])[1];
                if (od) was['D' + parseInt(od, 10)] = (was['D' + parseInt(od, 10)] || 0) + 1;
            });
            const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
            const tm = top(mk), tw = top(was);
            const cur = 'D' + (parseInt(String(dk).replace(/\D/g, ''), 10) || 0);
            return { market: tm ? tm[0] : '', was: (tw && tw[0] !== cur) ? tw[0] : '' };
        },

        /** การ์ดรายวันต้องเป็นของ "สายที่กำลังแก้" เท่านั้น ให้ตรงกับหน้าต่างรายวัน */
        /** เปิดหน้าต่างรายวันของสายใดก็ได้ โดยสลับสายที่กำลังแก้ให้เอง */
        openDay(route, day) {
            if (route && route !== State.localActiveRoute) {
                M.pickRoute(route);
                setTimeout(() => { try { UI.showDayModal(day); } catch (e) {} }, 420);
                return;
            }
            UI.showDayModal(day);
        },

        /** การ์ดรายวัน — แสดงทุกสายที่เปิด แยกเป็นกลุ่มตามสาย */
        fixSummary() {
            const el = document.getElementById('list-summary');
            if (!el || !M.multi) return;
            const R = State.db.routes || {};
            const act = State.localActiveRoute;
            const routes = open.filter(r => r !== UNASSIGNED);
            const card = (rt, d, n) => {
                const c = (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[d]) ? DAY_COLORS[d].hex : '#64748b';
                const on = (State.activeRoadDay === d && rt === act);
                return `<div onclick="MultiRoute.openDay('${esc(rt)}','${d}')"
                    class="p-3 bg-white border ${on ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'}
                           rounded-2xl flex flex-col items-center cursor-pointer relative shadow-sm hover:shadow-md transition">
                    <div class="absolute top-0 left-0 w-full h-1.5 rounded-t-2xl" style="background:${c}"></div>
                    <p class="text-[11px] font-bold mt-1 text-gray-500">${esc(dayName(d))}</p>
                    <p class="text-2xl font-black mt-0.5" style="color:${c}">${n}</p>
                </div>`;
            };
            const allOpen = M._sumAll === true;
            const bar = `<div class="col-span-2 flex gap-1.5 mb-1">
                <button onclick="MultiRoute.sumAll(true)" class="flex-1 bg-gray-100 hover:bg-gray-200 rounded-lg py-1 text-[10px] font-bold text-gray-600">⊞ กางทั้งหมด</button>
                <button onclick="MultiRoute.sumAll(false)" class="flex-1 bg-gray-100 hover:bg-gray-200 rounded-lg py-1 text-[10px] font-bold text-gray-600">⊟ ยุบทั้งหมด</button>
            </div>`;
            el.innerHTML = bar + routes.map(rt => {
                const mine = (R[rt] || []).filter(s => !s.inactive);
                const sums = {};
                mine.forEach(s => (s.days || []).forEach(d => { sums[d] = (sums[d] || 0) + 1; }));
                const keys = Object.keys(sums).sort((a, b) =>
                    (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));
                const tot = mine.length;
                // ยุบไว้ก่อนเป็นค่าเริ่มต้น — เปิดหน้าสรุปแล้วเห็นภาพรวมทุกสายในจอเดียว
                const isOpen = allOpen || M._sumOpen === rt;
                return `<details class="col-span-2" data-rt="${esc(rt)}" ${isOpen ? 'open' : ''}
                        ontoggle="MultiRoute.sumToggle('${esc(rt)}', this.open)">
                    <summary class="cursor-pointer select-none flex items-center gap-2 px-2 py-1.5 rounded-lg
                        ${rt === act ? 'bg-indigo-50' : 'bg-gray-50'} mb-2">
                      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${M.colorOf(rt)}"></span>
                      <span class="flex-1 text-[12px] font-black font-mono ${rt === act ? 'text-indigo-700' : 'text-gray-700'}">
                        ${esc(rt)}${rt === act ? ' <span class="font-sans font-bold text-[9px] opacity-70">กำลังแก้</span>' : ''}</span>
                      <span class="text-[11px] tabular-nums text-gray-400">${tot} ร้าน · ${keys.length} วัน</span>
                      <button onclick="event.preventDefault();event.stopPropagation();MultiRoute.routeMenu('${esc(rt)}',this)"
                        class="text-gray-400 hover:text-gray-700 px-1 text-sm leading-none" title="คำสั่งของสายนี้">⋯</button>
                    </summary>
                    <div class="grid grid-cols-2 gap-2 mb-3">
                      ${keys.length ? keys.map(d => card(rt, d, sums[d])).join('')
                        : '<p class="col-span-2 text-[11px] text-gray-400 px-1">ยังไม่มีร้านที่จัดวันในสายนี้</p>'}
                    </div>
                </details>`;
            }).join('');
        },

        /** เมนูคำสั่งระดับสาย — ผูกกับสายที่กดเท่านั้น ไม่ใช่สายที่กำลังแก้ */
        routeMenu(route, anchor) {
            document.getElementById('mr-rmenu')?.remove();
            const r = anchor.getBoundingClientRect();
            const el = document.createElement('div');
            el.id = 'mr-rmenu';
            el.style.cssText = `position:fixed;z-index:10001;top:${Math.round(r.bottom + 4)}px;`
                + `left:${Math.round(Math.min(r.left, window.innerWidth - 190))}px;width:180px;`
                + 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;'
                + 'box-shadow:0 12px 34px rgba(0,0,0,.16);overflow:hidden;font-family:inherit;';
            const item = (txt, fn, danger) => `<button onclick="${fn}"
                style="display:block;width:100%;text-align:left;padding:9px 13px;font-size:12px;font-weight:700;
                border:0;background:#fff;cursor:pointer;color:${danger ? '#dc2626' : '#374151'}">${txt}</button>`;
            el.innerHTML =
                `<div style="padding:7px 13px;font-size:10px;font-weight:800;color:#9ca3af;background:#f9fafb;
                    border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace">${esc(route)}</div>`
                + item('✏️ ตั้งเป็นสายที่กำลังแก้', `MultiRoute.pickRoute('${esc(route)}');MultiRoute.closeRouteMenu()`)
                + item('🏷️ เปลี่ยนชื่อสาย', `MultiRoute.routeCmd('rename','${esc(route)}')`)
                + item('🗑️ ลบร้านทั้งหมดในสาย', `MultiRoute.routeCmd('clear','${esc(route)}')`, true)
                + item('❌ ลบสายนี้', `MultiRoute.routeCmd('delete','${esc(route)}')`, true);
            document.body.appendChild(el);
            setTimeout(() => document.addEventListener('mousedown', M._rmenuOff), 0);
        },
        _rmenuOff(e) {
            const el = document.getElementById('mr-rmenu');
            if (el && !el.contains(e.target)) M.closeRouteMenu();
        },
        closeRouteMenu() {
            document.getElementById('mr-rmenu')?.remove();
            document.removeEventListener('mousedown', M._rmenuOff);
        },
        /** สั่งงานกับสายที่ระบุ — สลับสายที่กำลังแก้ไปที่สายนั้นก่อนเสมอ ไม่ให้กำกวม */
        routeCmd(cmd, route) {
            M.closeRouteMenu();
            const go = () => {
                if (cmd === 'rename') App.renameRoute();
                else if (cmd === 'clear') App.clearStores();
                else if (cmd === 'delete') App.deleteRoute ? App.deleteRoute() : UI.showErrorToast('⚠️ ไม่พบคำสั่งลบสาย');
            };
            if (route !== State.localActiveRoute) { M.pickRoute(route); setTimeout(go, 420); }
            else go();
        },

        // ── แผงตัวกรอง ───────────────────────────────────────────────────
        label() {
            const nd = dayFilter ? dayFilter.size : M.dayList().length;
            if (!open.length) return 'ยังไม่ได้เลือกสาย';
            const parts = [State.localActiveRoute || '—'];
            if (open.length > 1) parts.push(open.length + ' สาย');
            if (dayFilter) parts.push(nd ? nd + ' วัน' : 'ไม่แสดงวันไหนเลย');
            if (!showNew) parts.push('ซ่อนร้านใหม่');
            return parts.join(' · ');
        },
        panel() {
            const lab = document.getElementById('mr-label');
            if (lab) lab.textContent = M.label();
            const host = document.getElementById('multi-route-panel');
            if (!host) return;
            // V0.9.1: แผงปิดอยู่ไม่ต้องวาดใหม่ (เดิมวาดทุกครั้งที่จอเปลี่ยน + อ่านตำแหน่งเลื่อน ทำให้เบราว์เซอร์คำนวณหน้าใหม่ทั้งหน้า)
            const pop = document.getElementById('multi-route-pop');
            if (pop && pop.classList.contains('hidden')) return;
            const R = State.db.routes || {};
            const routes = M.routeList();
            const days = M.dayList();
            const dayCount = {};
            let newCount = 0;
            open.forEach(r => (R[r] || []).forEach(s => {
                if (s.inactive) return;
                if (!(s.days && s.days.length)) { newCount++; return; }
                s.days.forEach(d => { dayCount[d] = (dayCount[d] || 0) + 1; });
            }));
            // กล่องรายชื่อสาย/วันถูกสร้างใหม่ทุกครั้งที่ติ๊ก → จำตำแหน่งเลื่อนไว้แล้วใส่กลับ ไม่งั้นเด้งขึ้นบนทุกที
            const scrolls = [...host.querySelectorAll('.overflow-y-auto')].map(e => e.scrollTop);
            host.innerHTML = `
              <div class="p-2.5 w-[460px] max-w-[92vw]">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-black text-gray-700">เลือกสาย และกรองวัน</span>
                    <button onclick="MultiRoute.closePanel()" class="text-gray-400 hover:text-gray-700 text-sm">✕</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <div class="flex gap-1 mb-1">
                        <button onclick="MultiRoute.openAll()" class="flex-1 bg-gray-100 hover:bg-gray-200 rounded-md py-1 text-[10px] font-bold">ทุกสาย</button>
                        <button onclick="MultiRoute.openOne()" class="flex-1 bg-gray-100 hover:bg-gray-200 rounded-md py-1 text-[10px] font-bold">สายเดียว</button>
                        <button onclick="MultiRoute.openSuggested()" title="เลือกเฉพาะสายที่จำนวนร้านใกล้เคียงกัน — คัดสายพิเศษออก"
                            class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md py-1 text-[10px] font-bold">แนะนำ</button>
                    </div>
                    <div class="max-h-60 overflow-y-auto space-y-0.5 pr-0.5">
                    ${routes.map(r => `
                        <div class="flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded ${r === State.localActiveRoute ? 'bg-indigo-50' : 'hover:bg-gray-50'}">
                            <input type="checkbox" ${open.includes(r) ? 'checked' : ''} onchange="MultiRoute.toggleRoute('${esc(r)}')">
                            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${M.colorOf(r)}"></span>
                            <button onclick="MultiRoute.pickRoute('${esc(r)}')"
                                class="flex-1 min-w-0 text-left truncate font-mono ${r === State.localActiveRoute ? 'font-black text-indigo-700' : 'hover:underline'}">${esc(r)}</button>
                            <span class="text-gray-400 tabular-nums">${(R[r] || []).length}</span>
                        </div>`).join('')}
                    </div>
                  </div>
                  <div>
                    <div class="flex gap-1 mb-1">
                        <button onclick="MultiRoute.allDays()" class="flex-1 bg-gray-100 hover:bg-gray-200 rounded-md py-1 text-[10px] font-bold">ทุกวัน</button>
                        <button onclick="MultiRoute.noDays()" class="flex-1 bg-gray-100 hover:bg-gray-200 rounded-md py-1 text-[10px] font-bold">ล้าง</button>
                    </div>
                    <div class="max-h-60 overflow-y-auto space-y-0.5 pr-0.5">
                    ${days.map(d => `
                        <label class="flex items-center gap-1.5 text-[11px] px-1 py-0.5 rounded hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" ${(!dayFilter || dayFilter.has(d)) ? 'checked' : ''} onchange="MultiRoute.toggleDay('${d}')">
                            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${(typeof DAY_COLORS!=='undefined'&&DAY_COLORS[d])?DAY_COLORS[d].hex:'#94a3b8'}"></span>
                            <span class="flex-1 min-w-0 truncate">${esc(dayName(d))}</span>
                            <span class="text-gray-400 tabular-nums">${dayCount[d] || 0}</span>
                        </label>`).join('')}
                    </div>
                  </div>
                </div>
                <label class="flex items-center gap-2 text-[11px] mt-2 pt-2 border-t border-gray-100 cursor-pointer">
                    <input type="checkbox" ${showNew ? 'checked' : ''} onchange="MultiRoute.toggleNew()">
                    <span class="w-3 h-3 rounded-full border-2 border-dashed border-red-500 bg-white shrink-0"></span>
                    <span class="flex-1 font-bold text-red-600">ยังไม่จัดวัน (ร้านใหม่)</span>
                    <span class="text-gray-400 tabular-nums">${newCount}</span>
                </label>
                <div class="flex gap-1 mt-2">
                    <button onclick="MultiRoute.setColorMode('route')" class="flex-1 rounded-md py-1 text-[10px] font-bold ${colorMode === 'route' ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200'}">สีตามสาย</button>
                    <button onclick="MultiRoute.setColorMode('day')" class="flex-1 rounded-md py-1 text-[10px] font-bold ${colorMode === 'day' ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200'}">สีตามวัน</button>
                </div>
                ${M.multi ? `<p class="text-[10px] text-gray-400 leading-snug mt-2">
                    หมุดเต็ม = สายที่กำลังแก้ · จุด = สายอื่น · คลิกจุดเพื่อแก้วันหรือย้ายสาย<br>
                    ลำดับคิว CY และการ์ดรายวัน ทำกับสาย <b>${esc(State.localActiveRoute)}</b> เท่านั้น</p>` : ''}
              </div>`;
            [...host.querySelectorAll('.overflow-y-auto')].forEach((e, i) => { if (scrolls[i]) e.scrollTop = scrolls[i]; });
        },
        openPanel() {
            const el = document.getElementById('multi-route-pop');
            const btn = document.getElementById('mr-btn');
            if (!el || !btn) return;
            el.classList.remove('hidden');
            M.panel();
            const r = btn.getBoundingClientRect();
            const w = el.offsetWidth || 460, h = el.offsetHeight || 400;
            el.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w - 6)) + 'px';
            el.style.top = (r.bottom + h + 6 < window.innerHeight ? r.bottom + 4 : Math.max(6, r.top - h - 4)) + 'px';
        },
        closePanel() { const el = document.getElementById('multi-route-pop'); if (el) el.classList.add('hidden'); },
        togglePanel() {
            const el = document.getElementById('multi-route-pop');
            if (!el) return;
            if (el.classList.contains('hidden')) M.openPanel(); else M.closePanel();
        },
    };

    // ── ต่อเข้ากับระบบ ──────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const sel = document.getElementById('routeSelector');
        const box = sel && sel.closest('div');
        if (sel && box) {
            sel.style.display = 'none';           // ซ่อนดรอปดาวน์เดิม แต่ยังอยู่ใน DOM ให้โค้ดเดิมใช้ได้
            sel.insertAdjacentHTML('afterend', `
                <button id="mr-btn" onclick="MultiRoute.togglePanel()" title="เลือกสายและกรองวัน"
                    class="text-white text-sm font-bold py-1 px-2 rounded flex items-center gap-1 hover:bg-gray-800 transition max-w-[240px]">
                    <span id="mr-label" class="truncate">—</span><span class="text-gray-400 text-xs">▾</span>
                </button>`);
            // วางแผงแบบ fixed แล้วคำนวณตำแหน่งจากปุ่มตอนเปิด — กันโดน overflow ของ toolbar ตัด
            document.body.insertAdjacentHTML('beforeend', `
                <div id="multi-route-pop" class="hidden fixed bg-white rounded-xl shadow-2xl border border-gray-200 z-[9990]">
                    <div id="multi-route-panel"></div>
                </div>`);
        }

        setTimeout(() => {
            if (State.localActiveRoute) open = [State.localActiveRoute];

            const origSwitch = App.switchRoute;
            App.switchRoute = function (name) {
                const r = origSwitch.apply(this, arguments);
                if (!open.includes(name)) open.push(name);
                setTimeout(() => { M.rebuild(); UI.render(); M.panel(); }, 400);
                return r;
            };

            const origSync = App.sync;
            App.sync = function () {
                try { M.rebuild(); } catch (e) {}
                const r = origSync.apply(this, arguments);
                try { M.panel(); } catch (e) {}
                return r;
            };

            const origSave = App.saveDB;
            App.saveDB = function () {
                if (!M.multi) return origSave.apply(this, arguments);
                return M.saveOpen();
            };

            // หมุดเต็มวาดเฉพาะสายที่กำลังแก้ — สายอื่นวาดเป็นจุดเบา
            const origMarkers = MapCtrl.renderMarkers;
            MapCtrl.renderMarkers = function () {
                const all = State.stores;
                const show = M.isOn ? M.filtered() : all;
                M._pinIds = M.pinIds(show);
                const pinned = show.filter(s => M._pinIds.has(s.id));
                // หมุดที่ไม่ได้อยู่ในชุดนี้แล้ว ต้องถอดออกจากแผนที่ ไม่งั้นค้าง
                const keep = M._pinIds;
                for (const id in MapCtrl.markers) {
                    if (!keep.has(id) && !keep.has(Number(id))) {
                        MapCtrl.map.removeLayer(MapCtrl.markers[id]);
                        delete MapCtrl.markers[id];
                    }
                }
                State.stores = pinned;
                try { return origMarkers.apply(this, arguments); }
                finally {
                    State.stores = all;
                    // "สีตามสาย": หมุดเต็มก็ต้องเป็นสีสายด้วย (ตัวเลขข้างในยังเป็นเลขวัน) — เดิมหมุดเต็มยึดสีวันเสมอ
                    // ทำเฉพาะตอนเปิดหลายสาย เพราะสายเดียวสีสายจะกลืนเป็นสีเดียวหมด เสียข้อมูลวัน
                    try { if (colorMode === 'route' && open.length > 1) M.tintPins(pinned); } catch (e) {}
                }
            };

            // หน้าต่างรายวัน = ของสายที่กำลังแก้เสมอ
            if (UI.showDayModal) {
                const origDay = UI.showDayModal;
                UI.showDayModal = function () {
                    if (!M.multi) return origDay.apply(this, arguments);
                    const all = State.stores;
                    State.stores = M.storesOf(State.localActiveRoute, all);
                    try { return origDay.apply(this, arguments); }
                    finally { State.stores = all; }
                };
            }

            // วาดหน้าจอจากชุดที่ผ่านตัวกรอง แล้วจัดกลุ่มรายการ + วาดจุดสายอื่น
            const origRender = UI.render;
            UI.render = function () {
                const all = State.stores;
                const set = M.isOn ? M.filtered() : all;
                // รายการด้านขวาสร้างการ์ดร้านละใบ — เกินสองสามพันใบจะหน่วงหลายวินาทีทุกครั้งที่แก้
                // ถ้าชุดที่เปิดใหญ่เกิน ให้รายการโชว์เฉพาะสายที่กำลังแก้ (แผนที่ยังครบทุกสายเหมือนเดิม)
                M._listCapped = set.length > M.LIST_LIMIT;
                // สายที่กำลังแก้อาจไม่ได้อยู่ในชุดที่เปิด (เช่น กด "เลือกชุดที่แนะนำ" แล้วสายนั้นถูกคัดออก)
                // ถ้าไม่เผื่อไว้ รายการจะว่างเปล่าโดยไม่มีเหตุผลให้ผู้ใช้เห็น
                M._listRoute = open.includes(State.localActiveRoute) ? State.localActiveRoute : open[0];
                const listSet = M._listCapped ? M.storesOf(M._listRoute, set) : set;
                State.stores = listSet;
                let r;
                try { r = origRender.apply(this, arguments); }
                finally { State.stores = all; }
                try {
                    M.listNote(set, listSet);
                    M.render(set);
                    M.groupList('list-upload', listSet);
                    M.groupList('list-assigned', listSet);
                    M.groupList('list-unassigned', listSet);
                    M.fixSummary();
                    M.panel();
                } catch (e) { console.warn('[MultiRoute]', e); }
                return r;
            };

            // (เดิมบล็อกไม่ให้ลบตอนเปิดหลายสาย — ตอนนี้ปล่อยให้ลบได้ แต่ทำกับสายที่กำลังแก้
            //  เท่านั้น ดูตัวครอบท้ายไฟล์ที่จำกัดขอบเขตและวาดจอใหม่ให้ตรง)
            if (typeof StoreMgr !== 'undefined' && StoreMgr.permanentDelete) {
                const o = StoreMgr.permanentDelete;
                StoreMgr.permanentDelete = function (id) {
                    if (!M.multi) return o.apply(this, arguments);
                    const R = State.db.routes || {};
                    let s = null, rt = null;
                    Object.keys(R).some(r => { const f = (R[r]||[]).find(x => String(x.id)===String(id));
                        if (f) { s = f; rt = r; return true; } return false; });
                    if (!s) return;
                    UI.showConfirm(`ลบ "${s.name}" ออกจากสาย ${rt} ถาวรใช่ไหมครับ?\n(ไม่สามารถกู้คืนได้)`, () => {
                        R[rt] = (R[rt] || []).filter(x => String(x.id) !== String(id));
                        UI.render(); M.saveOpen();
                        UI.showSaveToast(`🗑️ ลบ "${s.name}" ออกแล้ว`);
                    });
                };
            }

            M.rebuild(); M.panel();
            document.addEventListener('mousedown', (e) => {
                const el = document.getElementById('multi-route-pop');
                if (!el || el.classList.contains('hidden')) return;
                if (el.contains(e.target) || (document.getElementById('mr-btn') || {}).contains?.(e.target)) return;
                M.closePanel();
            });
        }, 600);
    });

    return M;
})();

/* ============================================================================
 *  แก้บั๊กที่เกิดจากการเปิดหลายสายพร้อมกัน
 *  1) ปุ่ม AI Route Builder เดิม — เดิมเอาร้านของทุกสายที่เปิดมารวมเป็นกองเดียว
 *     แล้วซอยเป็นวัน ซึ่งให้ผลผิด เพราะเลขวันเป็นของแต่ละสาย
 *  2) ปุ่มลบร้านค้าทั้งหมด — เดิมล้างรายการบนจอทั้งชุดที่เปิดอยู่ ทั้งที่ลบจริงสายเดียว
 * ==========================================================================*/
(function () {
    'use strict';
    const boot = () => {
        if (typeof MultiRoute === 'undefined' || typeof State === 'undefined'
            || typeof UI === 'undefined' || !UI.render) return setTimeout(boot, 400);

        // ── 1) AI เดิม: บังคับให้ทำกับสายที่กำลังแก้เท่านั้น ────────────────
        if (typeof AI !== 'undefined' && AI.run && !AI._scoped) {
            const origRun = AI.run;
            AI._scoped = true;
            AI.run = function () {
                const rt = State.localActiveRoute;
                const open = MultiRoute.open || [];
                if (!open.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกสายในตัวกรอง');
                if (!open.includes(rt)) return UI.showErrorToast(
                    `⚠️ สาย ${rt} ไม่ได้อยู่ในตัวกรอง — กดชื่อสายที่ต้องการในตัวกรองก่อน`);
                const run = () => {
                    // ช่อง "จำนวนวัน" ต้องเท่ากับความยาวรอบของสายเสมอ — AI.calc เอาค่านี้ไปเขียนทับ State.db.cycleDays
                    try {
                        const el = document.getElementById('ai-days');
                        const cyc = (typeof Freq !== 'undefined' && Freq._cycleOf) ? Freq._cycleOf(rt) : (State.db.cycleDays || 24);
                        if (el && cyc) el.value = cyc;
                    } catch (e) {}
                    const all = State.stores;
                    State.stores = MultiRoute.storesOf(rt, all);   // เฉพาะสายที่กำลังแก้
                    try { return origRun.apply(this, arguments); }
                    finally {
                        // คืนชุดเต็มหลัง AI ทำงานเสร็จ (AI ทำงานแบบ async ผ่าน setTimeout)
                        setTimeout(() => { try { MultiRoute.setOpen(MultiRoute.open); } catch (e) { State.stores = all; } }, 1200);
                    }
                };
                if (open.length > 1) {
                    return UI.showConfirm(
                        `เปิดอยู่ ${open.length} สาย แต่ AI ซอยวันได้ทีละสาย\n\n`
                        + `จะทำกับสาย "${rt}" เท่านั้น (${MultiRoute.storesOf(rt, State.stores).length} ร้าน)\n`
                        + `สายอื่นไม่ถูกแตะ`, run);
                }
                return run();
            };
        }

        // ── 2) ลบร้านทั้งหมด: ลบสายเดียวจริง แล้ววาดจอใหม่ให้ตรง ──────────
        if (typeof App !== 'undefined' && App.clearStores && !App._clearScoped) {
            const origClear = App.clearStores;
            App._clearScoped = true;
            App.clearStores = function () {
                const rt = State.localActiveRoute;
                if (!(MultiRoute.open || []).includes(rt))
                    return UI.showErrorToast(`⚠️ สาย ${rt} ไม่ได้ติ๊กอยู่ในตัวกรอง — ติ๊กก่อนจึงจะลบได้`);
                const R = State.db.routes || {};
                const mine = (R[rt] || []).length;
                if (!mine) return UI.showErrorToast(`⚠️ สาย ${rt} ไม่มีร้านค้าอยู่แล้ว`);
                const all = State.stores;
                State.stores = MultiRoute.storesOf(rt, all);       // ให้ข้อความเตือนนับถูกสาย
                let r;
                try { r = origClear.apply(this, arguments); }
                finally {
                    // ไม่ว่าผู้ใช้จะกดยืนยันหรือยกเลิก ให้จอกลับมาตรงกับข้อมูลจริงเสมอ
                    setTimeout(() => { try { MultiRoute.setOpen(MultiRoute.open); UI.render(); } catch (e) {} }, 60);
                }
                return r;
            };
        }
    };
    boot();
})();

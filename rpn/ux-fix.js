/* =============================================================================
 *  ux-fix.js — เก็บรายละเอียดหน้าจอที่ใช้จริงแล้วสะดุด
 * =============================================================================
 *  1) ร้าน "รอจัดสาย" — ไฟล์ Customer Master มีคอลัมน์ Salesman Code ซึ่งใช้
 *     รหัสชุดเดียวกับ Route Code (ตรวจกับข้อมูลจริงศูนย์ 202 แล้ว ตรงกัน 8,253/8,253)
 *     จึงเอามาขึ้นเป็น "ข้อเสนอ" ให้เห็นบนหมุดและมีปุ่มย้ายทีเดียวทั้งชุด
 *     ระบบยังไม่ย้ายเอง — คนกดยืนยันเสมอ
 *  2) หมุดใหญ่ (ร้านที่จัดวันแล้ว) กับจุดวงกลมเล็ก เดิมคนละเมนู และหมุดใหญ่
 *     ยังเด้งเปลี่ยนแท็บให้เองด้วย — รวมให้ใช้เมนูเดียวกันทั้งหมด
 *  3) กล่อง "สีของแต่ละวัน" เปิดแล้วทับปุ่มของตัวเอง เลยกดปิดไม่ได้
 * ========================================================================== */
(function () {
    'use strict';

    const UNASSIGNED = 'รอจัดสาย';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ══ 1) Salesman Code Suggest ═══════════════════════════════════════════
    const parked = () => ((State.db && State.db.routes && State.db.routes[UNASSIGNED]) || []);

    /** ร้านรอจัดสายที่ Salesman Code ชี้ไปสายที่มีอยู่จริง → { route: [ร้าน] } */
    const groups = () => {
        const R = (State.db && State.db.routes) || {};
        const valid = new Set(Object.keys(R).filter(r => r !== UNASSIGNED));
        const g = new Map();
        parked().forEach(s => {
            const code = String(s.salesCode || '').trim();
            if (!code || !valid.has(code)) return;
            if (!g.has(code)) g.set(code, []);
            g.get(code).push(s);
        });
        return g;
    };

    const SUG_ID = 'tabs-suggest';
    const paintBanner = () => {
        const t1 = $('tab1');
        if (!t1) return;
        let el = $(SUG_ID);
        const g = groups();
        const n = [...g.values()].reduce((a, x) => a + x.length, 0);
        const rest = parked().length - n;
        if (!n) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = SUG_ID;
            el.className = 'bg-amber-50 border border-amber-200 rounded-xl p-3 mb-2 mt-2';
            // วางไว้เหนือกล่องรายการ ไม่ใช่ข้างใน — กล่องรายการถูกซ่อนได้ตามชิปที่เลือก
            const anchor = $('pane-wait');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
            else t1.appendChild(el);
        }
        const detail = [...g.entries()].sort((a, b) => b[1].length - a[1].length)
            .map(([r, list]) => `${esc(r)} ${list.length}`).join(' · ');
        el.innerHTML = `
            <div class="text-[11px] text-amber-800 font-bold leading-snug mb-1.5">
                ร้านรอจัดสาย ${n.toLocaleString()} ร้าน มี Salesman Code ระบุสายไว้แล้วในไฟล์ Master
            </div>
            <div class="text-[10.5px] text-amber-700 leading-snug mb-2">${detail}${
                rest ? ` <span class="text-amber-500">· อีก ${rest} ร้านไม่มีรหัสหรือชี้ไปสายที่ไม่มีในระบบ</span>` : ''}</div>
            <button onclick="SalesSuggest.moveAll()"
                class="w-full bg-amber-500 hover:bg-amber-600 text-white py-1.5 rounded-lg text-xs font-bold transition">
                → ย้ายเข้าสายตาม Salesman Code (${n.toLocaleString()} ร้าน)
            </button>`;
    };

    window.SalesSuggest = {
        groups,
        async moveAll() {
            const g = groups();
            const n = [...g.values()].reduce((a, x) => a + x.length, 0);
            if (!n) return;
            const lines = [...g.entries()].sort((a, b) => b[1].length - a[1].length)
                .map(([r, l]) => `   ${r} : ${l.length} ร้าน`).join('\n');
            const ok = await new Promise(r => UI.showConfirm(
                `ย้ายร้านรอจัดสาย ${n} ร้าน เข้าสายตาม Salesman Code ในไฟล์ Master\n\n${lines}\n\n` +
                `ร้านที่ย้ายยังไม่ได้จัดวัน ต้องจัดวันต่อเอง`,
                () => r(true), () => r(false)));
            if (!ok) return;

            const ym = App._currentPlanYM;
            const R = State.db.routes || {};
            UI.showLoader('🔀 กำลังย้ายร้าน...', `${n} ร้าน`);
            try {
                const targets = [...g.keys()];
                // สายปลายทางบางสายอาจยังไม่ได้โหลดเข้าเครื่อง ต้องดึงมาก่อนไม่งั้นเขียนทับของเดิม
                for (const to of targets) {
                    if (Array.isArray(R[to])) continue;
                    const d = await App.planRoutesCol(ym).doc(to).get().catch(() => null);
                    R[to] = (d && d.exists) ? (d.data().stores || []) : [];
                }
                const moved = new Set();
                for (const [to, list] of g) {
                    list.forEach(s => {
                        s.route = to; s.selected = false;
                        s.days = []; s.seqs = {}; s.cys = {}; s.cy = '';
                        R[to].push(s);
                        moved.add(String(s.id));
                    });
                }
                R[UNASSIGNED] = (R[UNASSIGNED] || []).filter(s => !moved.has(String(s.id)));

                const routeList = Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
                await Promise.all([
                    ...[...targets, UNASSIGNED].map(r => App.planRoutesCol(ym).doc(r).set({
                        stores: R[r],
                        confirmedBy: firebase.firestore.FieldValue.delete(),
                        confirmedAt: firebase.firestore.FieldValue.delete(),
                    }, { merge: true })),
                    App.planRef(ym).set({ routeList, cycleDays: State.db.cycleDays || 24,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
                ]);
                UI.hideLoader();
                if (typeof MultiRoute !== 'undefined') {
                    MultiRoute.setOpen([...new Set([...(MultiRoute.open || []), ...targets])]);
                } else { UI.render(); }
                UI.showSaveToast(`🔀 ย้ายแล้ว ${n} ร้าน เข้า ${targets.length} สาย — ยังไม่ได้จัดวัน`);
            } catch (e) {
                UI.hideLoader();
                UI.showErrorToast('❌ ย้ายไม่สำเร็จ: ' + (e && e.message));
                console.error('[SalesSuggest]', e);
            }
        },
    };

    // ══ 2) หมุดใหญ่ใช้เมนูเดียวกับจุดเล็ก ══════════════════════════════════
    const findStore = (id) => {
        const k = String(id);
        let s = (State.stores || []).find(x => String(x.id) === k);
        if (s) return s;
        const R = (State.db && State.db.routes) || {};
        for (const r of Object.keys(R)) {
            s = (R[r] || []).find(x => String(x.id) === k);
            if (s) { s.route = s.route || r; return s; }
        }
        return null;
    };

    const unifyPins = () => {
        if (!MapCtrl || !MapCtrl.markers) return;
        for (const id of Object.keys(MapCtrl.markers)) {
            const m = MapCtrl.markers[id];
            if (!m) continue;
            // เมนูเดิมของหมุดใหญ่ไม่มีย้ายสาย และเปิดทีไรเด้งเปลี่ยนแท็บ — ถอดทิ้ง
            if (m.getPopup()) m.unbindPopup();
            // ตัวจัดการคลิกเดิมของหมุด (ติ๊กเลือกร้าน) ถอดไม่ได้ ปิดด้วยธงนี้แทน
            m.customAssigned = true;
            if (m._uxWired) continue;
            m._uxWired = true;
            m.on('click', function (ev) {
                if (typeof Lasso !== 'undefined' && Lasso.active) return;
                const s = findStore(this.customId);
                if (!s) return;
                const oe = ev && ev.originalEvent;
                if (oe && (oe.shiftKey || oe.ctrlKey)) {      // เหมือนจุดเล็ก: กด Shift/Ctrl = ติ๊กเลือก
                    StoreMgr.toggleSelect(s.id); UI.render(); return;
                }
                if (typeof MultiRoute !== 'undefined' && MultiRoute.popup) {
                    MultiRoute.popup(s, ev.latlng || [s.lat, s.lng]);
                }
            });
        }
    };

    // ══ 2b) ปุ่มยกเลิกเลือก ไว้ข้างปุ่มวาดพื้นที่ ═══════════════════════════
    const paintUnselect = () => {
        const tools = $('mapTools');
        if (!tools) return;
        let btn = $('map-unselect');
        const n = ((State && State.stores) || []).filter(s => s.selected).length;
        if (!btn) {
            const lasso = [...tools.querySelectorAll('button')].find(b => /วาดเลือกพื้นที่/.test(b.textContent));
            btn = document.createElement('button');
            btn.id = 'map-unselect';
            btn.className = 'hidden bg-white hover:bg-gray-50 text-gray-800 px-4 py-2.5 rounded-xl shadow-lg text-sm font-bold border border-gray-200';
            btn.onclick = () => { try { StoreMgr.clearSelection(); } catch (e) {} };
            if (lasso && lasso.nextSibling) tools.insertBefore(btn, lasso.nextSibling);
            else tools.appendChild(btn);
        }
        btn.textContent = `✖️ ยกเลิกเลือก (${n.toLocaleString()})`;
        btn.classList.toggle('hidden', n === 0);
    };

    // ══ 3) กล่องสีวัน — วางใต้แถวปุ่ม + ปิดได้ ═════════════════════════════
    const fixLegend = () => {
        const panel = $('dayLegendPanel');
        const tools = $('mapTools');
        if (!panel) return;
        if (!panel.dataset.uxFixed) {
            panel.dataset.uxFixed = '1';
            panel.insertAdjacentHTML('afterbegin',
                '<button onclick="UI.toggleLegend()" title="ปิด"' +
                ' class="absolute top-2 right-2 w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200' +
                ' text-gray-500 text-sm font-bold leading-none">✕</button>');
            panel.classList.add('relative');
        }
        // เดิมกล่องอยู่ตำแหน่งเดียวกับปุ่ม เปิดแล้วทับปุ่มตัวเอง กดปิดไม่โดน
        if (tools) panel.style.top = (tools.offsetTop + tools.offsetHeight + 10) + 'px';
    };

    const wire = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof MapCtrl === 'undefined') return setTimeout(wire, 400);
        if (UI._uxWired) return;
        UI._uxWired = true;

        if (UI.toggleLegend) {
            const orig = UI.toggleLegend;
            UI.toggleLegend = function () {
                fixLegend();
                const r = orig.apply(this, arguments);
                fixLegend();
                return r;
            };
        }
        // กดที่ว่างบนแผนที่ = ปิดกล่องสีวัน
        document.addEventListener('click', (e) => {
            const panel = $('dayLegendPanel');
            if (!panel || panel.classList.contains('hidden')) return;
            if (panel.contains(e.target)) return;
            if ($('legendToggleBtn') && $('legendToggleBtn').contains(e.target)) return;
            panel.classList.add('hidden');
        }, true);

        if (MapCtrl.renderMarkers) {
            const origMk = MapCtrl.renderMarkers;
            MapCtrl.renderMarkers = function () {
                const r = origMk.apply(this, arguments);
                try { unifyPins(); } catch (e) { console.warn('[ux-fix] pins', e); }
                return r;
            };
        }

        const origRender = UI.render;
        UI.render = function () {
            const r = origRender.apply(this, arguments);
            const after = () => { try { paintBanner(); unifyPins(); paintUnselect(); } catch (e) {} };
            after(); setTimeout(after, 0);
            return r;
        };
    };

    /**
     * วาดพื้นที่เลือก = เลือกได้เฉพาะหมุดที่ "แสดงอยู่" เท่านั้น
     * เดิม Lasso.finish วน State.stores ทั้งชุด → ร้านที่ตัวกรองวัน/สายซ่อนไว้ก็ติดมาด้วยทั้งที่มองไม่เห็น
     * ตอนนี้ใช้ชุดที่ผ่านตัวกรอง (MultiRoute.filtered) ตัวเดียวกับที่ใช้วาดหมุด และบอกจำนวนที่ข้ามไป
     */
    const wireLasso = () => {
        if (typeof Lasso === 'undefined' || !Lasso.finish || Lasso._scoped) return setTimeout(wireLasso, 400);
        Lasso._scoped = true;
        Lasso.finish = function () {
            if (Lasso.pts.length < 3) return UI.showErrorToast('⚠️ วาดอย่างน้อย 3 จุดครับ');
            // ชุดที่แสดงบนแผนที่ = ชุดที่ผ่านตัวกรองวัน/สาย (ตัวเดียวกับที่ renderMarkers ใช้)
            let pins = null;
            try {
                if (typeof MultiRoute !== 'undefined' && MultiRoute.isOn && MultiRoute.filtered)
                    pins = new Set(MultiRoute.filtered().map(s => String(s.id)));
            } catch (e) { pins = null; }
            let c = 0, skipped = 0;
            (State.stores || []).forEach(s => {
                if (s.inactive || !isFinite(+s.lat) || !isFinite(+s.lng)) return;
                if (!Lasso.isInside([s.lat, s.lng], Lasso.pts)) return;
                const shown = !pins || pins.has(String(s.id));
                if (!shown) { skipped++; return; }
                s.selected = true; c++;
            });
            Lasso.cancel();
            if (c > 0) {
                UI.switchTab('tab2');
                UI.showSaveToast(`📌 เลือก ${c.toLocaleString()} ร้าน`
                    + (skipped ? ` · ข้าม ${skipped.toLocaleString()} ร้านที่ตัวกรองซ่อนไว้` : ''));
            } else if (skipped) {
                UI.showErrorToast(`⚠️ ในพื้นที่มี ${skipped.toLocaleString()} ร้าน แต่ถูกตัวกรองวัน/สายซ่อนไว้ทั้งหมด — เปิดตัวกรองก่อนถ้าต้องการเลือก`);
            } else {
                UI.showErrorToast('⚠️ ไม่พบร้านในพื้นที่ที่วาดครับ');
            }
            UI.render();
            App.saveDB();
        };
    };

    document.addEventListener('DOMContentLoaded', () => { setTimeout(wire, 500); setTimeout(wireLasso, 800); });
})();

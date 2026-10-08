/* =============================================================================
 *  unify.js — ตัวกรองเดียวคุมทุกแท็บ
 * =============================================================================
 *  1) การ์ดระยะ Master ในแท็บ 4 แสดงทุกสายที่เปิด ไม่ใช่เฉพาะสายที่กำลังแก้
 *  2) แถวในตารางระยะ Master กดแล้วเปิดหน้าต่างรายวันของสายนั้นได้เลย
 *  3) แท็บ 2 ไม่มีรายการติ๊กสายของตัวเอง — อ่านจากตัวกรองเดียว
 *  4) ตัวกรองมีปุ่ม "แนะนำ" สำหรับเลือกชุดสายที่ควรจัดใหม่
 * ========================================================================== */
(function () {
    'use strict';
    const UNASSIGNED = 'รอจัดสาย';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const boot = () => {
        if (typeof MultiRoute === 'undefined' || typeof State === 'undefined'
            || typeof UI === 'undefined' || !UI.render) return setTimeout(boot, 400);

        // ── 1+2) การ์ดระยะ Master ต่อสาย ────────────────────────────────────
        if (typeof RoadMaster !== 'undefined' && RoadMaster.render && !RoadMaster._multi) {
            const origRM = RoadMaster.render;
            RoadMaster._multi = true;
            RoadMaster.render = function () {
                const host = document.getElementById('master-km-box');
                if (!host) return;
                const open = (MultiRoute.open || []).filter(r => r !== UNASSIGNED);
                if (open.length <= 1) return origRM.call(RoadMaster);

                const act = State.localActiveRoute;
                const parts = [];
                host.id = 'master-km-box--host';        // ปล่อย id ให้กล่องชั่วคราวใช้
                try {
                    open.forEach(rt => {
                        const tmp = document.createElement('div');
                        tmp.id = 'master-km-box';
                        tmp.style.display = 'none';
                        document.body.appendChild(tmp);
                        State.localActiveRoute = rt;
                        try {
                            origRM.call(RoadMaster);
                            // แถววันในตารางต้องเปิดหน้าต่างของสายตัวเอง ไม่ใช่สายที่กำลังแก้
                            const html = tmp.innerHTML.replace(
                                /UI\.showDayModal\('([^']+)'\)/g,
                                (m, d) => `MultiRoute.openDay('${rt.replace(/'/g, "\\'")}','${d}')`);
                            // ยุบไว้ก่อน — เปิดหน้าสรุปแล้วต้องเห็นภาพรวมทุกสายในจอเดียว
                            // กางทีละสาย หรือกด "กางทั้งหมด" ข้างบนก็ได้
                            const km = (html.match(/([\d,]+\.\d)\s*กม\./) || [])[1] || '';
                            const isOpen = MultiRoute._sumAll === true || MultiRoute._sumOpen === rt;
                            parts.push(`<details class="mb-2" data-rt="${esc(rt)}" ${isOpen ? 'open' : ''}
                                    ontoggle="MultiRoute.sumToggle('${esc(rt)}', this.open)">
                                <summary class="cursor-pointer select-none flex items-center gap-2 mb-1.5 px-1 py-1 rounded-lg hover:bg-gray-50">
                                  <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${MultiRoute.colorOf(rt)}"></span>
                                  <span class="text-[12px] font-black font-mono ${rt === act ? 'text-indigo-700' : 'text-gray-700'}">${esc(rt)}</span>
                                  ${rt === act ? '<span class="text-[9px] font-bold text-indigo-400">กำลังแก้</span>' : ''}
                                  ${km ? `<span class="ml-auto text-[11px] font-bold text-gray-500 tabular-nums">${km} กม.</span>` : ''}
                                </summary>
                                <div class="pl-1">${html}</div></details>`);
                        } finally { tmp.remove(); }
                    });
                } finally {
                    State.localActiveRoute = act;
                    host.id = 'master-km-box';
                }
                host.innerHTML = `<div class="flex items-center gap-1.5 mb-2">
                        <p class="text-[10px] text-gray-400 flex-1">ระยะ Master ของ <b>${open.length} สายที่เปิดอยู่</b></p>
                        <button onclick="MultiRoute.sumAll(true)" class="bg-gray-100 hover:bg-gray-200 rounded-lg px-2 py-1 text-[10px] font-bold text-gray-600">⊞ กางทั้งหมด</button>
                        <button onclick="MultiRoute.sumAll(false)" class="bg-gray-100 hover:bg-gray-200 rounded-lg px-2 py-1 text-[10px] font-bold text-gray-600">⊟ ยุบทั้งหมด</button>
                    </div>` + parts.join('');
            };
        }

    };
    boot();
})();

/* ============================================================================
 *  วาดหมุดใหม่เมื่อเลื่อน/ซูมแผนที่ — เพื่อให้สลับหมุดเต็ม ↔ จุดสี ตามจำนวนในจอ
 *  หน่วงไว้เล็กน้อยกันไม่ให้วาดถี่เกินระหว่างลากแผนที่
 * ==========================================================================*/
(function () {
    'use strict';
    let timer = null, lastMode = null;
    const boot = () => {
        if (typeof MapCtrl === 'undefined' || !MapCtrl.map || typeof MultiRoute === 'undefined'
            || typeof UI === 'undefined' || !UI.render) return setTimeout(boot, 500);
        const redraw = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                try {
                    const show = MultiRoute.isOn ? MultiRoute.filtered() : (State.stores || []);
                    const mode = MultiRoute.pinIds(show).size ? 'pin' : 'dot';
                    const cur = MultiRoute._pinIds ? (MultiRoute._pinIds.size ? 'pin' : 'dot') : null;
                    // วาดใหม่เมื่อสลับโหมด หรือเมื่ออยู่โหมดหมุดเต็ม (ชุดร้านในจอเปลี่ยนไป)
                    // วาดเฉพาะชั้นแผนที่ ไม่แตะรายการด้านขวา (ซึ่งหนักกว่ามาก)
                    if (mode !== cur || mode === 'pin') { lastMode = mode; MultiRoute.redrawMap(); }
                } catch (e) { console.warn('[unify] redraw', e); }
            }, 220);
        };
        MapCtrl.map.on('moveend', redraw);
        MapCtrl.map.on('zoomend', redraw);
    };
    boot();
})();

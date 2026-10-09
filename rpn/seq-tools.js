/* =============================================================================
 *  seq-tools.js — เครื่องมือจัดลำดับคิวในวัน
 * =============================================================================
 *  ลำดับคิว (store.seqs['Day n']) บอกว่าในวันนั้นเข้าร้านไหนก่อน–หลัง
 *  ไฟล์นี้เพิ่ม 3 อย่างที่ระบบเดิมไม่มี
 *    1) แก้ลำดับด้วยมือ — ลากสลับ หรือกดลูกศรขึ้น/ลง ในหน้าต่างรายวัน
 *    2) ปุ่มจัดลำดับจากพิกัด — เรียงเส้นทางให้สั้นลงด้วย nearest-neighbour + 2-opt
 *    3) ร้านที่เพิ่งถูกจัดลงวัน จะถูกแทรกในตำแหน่งที่อ้อมน้อยที่สุดให้อัตโนมัติ
 *
 *    4) ระยะ Master — ระยะทางของแผน คำนวณจากลำดับที่จัดไว้
 *
 *  ระยะทางที่ใช้มาจาก RoadDist ซึ่งเป็นระยะถนนจริงจาก OpenStreetMap
 *  ถ้ายังไม่ได้โหลดตารางระยะถนน จะถอยไปใช้ระยะเส้นตรงให้ทำงานต่อได้
 * ========================================================================== */
const SeqTool = (() => {
    'use strict';

    // ระยะระหว่างร้าน 2 ร้าน หน่วยเมตร
    // ใช้ระยะถนนจริงถ้าโหลดตารางไว้แล้ว ไม่งั้นถอยไปใช้เส้นตรง
    const KY = 111132.0;
    const straightM = (a, b) => {
        const kx = KY * Math.cos((a.lat + b.lat) * 0.5 * Math.PI / 180);
        const dy = (a.lat - b.lat) * KY, dx = (a.lng - b.lng) * kx;
        return Math.sqrt(dy * dy + dx * dx);
    };
    const dist = (a, b) =>
        (typeof RoadDist !== 'undefined' && RoadDist.ready) ? RoadDist.m(a, b) : straightM(a, b);

    /** ตารางระยะย่อยของร้านชุดหนึ่ง — เรียกครั้งเดียวแล้วใช้ซ้ำ เร็วกว่าเรียก dist ทุกครั้ง */
    const localMatrix = (arr) => {
        const n = arr.length, M = new Float64Array(n * n);
        for (let i = 0; i < n; i++)
            for (let j = i + 1; j < n; j++) {
                const v = dist(arr[i], arr[j]);
                M[i * n + j] = v; M[j * n + i] = v;
            }
        return M;
    };
    // ลำดับคิวเป็นของ "สาย × วัน" เสมอ — เปิดหลายสายพร้อมกันก็ต้องไม่ปนกัน
    const routeOf = (s) => s.route || State.localActiveRoute;
    const list = (day, route) => {
        const rt = route || State.localActiveRoute;
        return State.stores
            .filter(s => !s.inactive && s.days && s.days.includes(day) && routeOf(s) === rt)
            .sort((a, b) => ((a.seqs && a.seqs[day]) || 9999) - ((b.seqs && b.seqs[day]) || 9999));
    };

    const write = (arr, day) => {
        arr.forEach((s, i) => {
            if (!s.seqs) s.seqs = {};
            s.seqs[day] = i + 1;
        });
    };

    const T = {
        /** เรียงเส้นทางของวันหนึ่งใหม่ — คืนจำนวนร้านที่จัด */
        orderDay(day, silent, route) {
            const arr = list(day, route);
            if (arr.length < 3) { if (arr.length) write(arr, day); return arr.length; }

            const n = arr.length;
            const M = localMatrix(arr);
            const D = (i, j) => M[i * n + j];

            // เริ่มจากร้านเหนือสุด (จุดอ้างอิงคงที่ ผลลัพธ์จึงซ้ำเดิมได้ทุกครั้ง)
            let start = 0;
            for (let i = 1; i < n; i++) if (arr[i].lat > arr[start].lat) start = i;

            // nearest neighbour
            const used = new Uint8Array(n);
            const seq = [start]; used[start] = 1;
            for (let step = 1; step < n; step++) {
                const cur = seq[seq.length - 1];
                let bi = -1, bd = Infinity;
                for (let i = 0; i < n; i++) {
                    if (used[i]) continue;
                    const d = D(cur, i);
                    if (d < bd) { bd = d; bi = i; }
                }
                seq.push(bi); used[bi] = 1;
            }

            // 2-opt — คราวนี้บวกระยะจริง ไม่ใช่ระยะกำลังสอง จึงตัดเส้นทับได้ถูกต้อง
            const maxPass = n > 300 ? 2 : 8;
            for (let pass = 0; pass < maxPass; pass++) {
                let improved = false;
                for (let i = 0; i < n - 2; i++) {
                    const a = seq[i], b = seq[i + 1];
                    for (let k = i + 2; k < n; k++) {
                        const c = seq[k], e = (k + 1 < n) ? seq[k + 1] : -1;
                        const before = D(a, b) + (e >= 0 ? D(c, e) : 0);
                        const after = D(a, c) + (e >= 0 ? D(b, e) : 0);
                        if (after < before - 0.5) {
                            let lo = i + 1, hi = k;
                            while (lo < hi) { const t = seq[lo]; seq[lo] = seq[hi]; seq[hi] = t; lo++; hi--; }
                            improved = true;
                            break;
                        }
                    }
                }
                if (!improved) break;
            }

            write(seq.map(i => arr[i]), day);
            if (!silent) { UI.render(); App.saveDB(); }
            return n;
        },

        /** ไล่เลขลำดับใหม่ 1..n ตามลำดับเดิม — ใช้หลังมีร้านย้ายออกจากวันนั้น
         *  (ไม่งั้นจะเหลือเลขขาดเป็นช่วง เช่น 1,2,4,5 แล้วติดไปในไฟล์ DMS) */
        compact(day, route) {
            const arr = list(day, route);
            if (!arr.length) return 0;
            const before = arr.map(s => s.seqs[day]).join(',');
            write(arr, day);
            return arr.map(s => s.seqs[day]).join(',') === before ? 0 : arr.length;
        },

        /** ไล่เลขลำดับใหม่ให้ครบทุกสาย ทุกวัน — คืนจำนวนตลาดที่ต้องแก้ */
        compactAll(routes) {
            const R = routes || State.db.routes || {};
            let fixed = 0;
            Object.keys(R).forEach(rt => {
                if (rt === 'รอจัดสาย') return;
                const days = [...new Set((R[rt] || []).flatMap(s => s.inactive ? [] : (s.days || [])))];
                days.forEach(d => {
                    const arr = (R[rt] || [])
                        .filter(s => !s.inactive && (s.days || []).includes(d))
                        .sort((a, b) => ((a.seqs && a.seqs[d]) || 9999) - ((b.seqs && b.seqs[d]) || 9999));
                    const ok = arr.every((s, i) => s.seqs && s.seqs[d] === i + 1);
                    if (!ok) { write(arr, d); fixed++; }
                });
            });
            return fixed;
        },

        /** จัดลำดับใหม่ทุกวันในสายที่เปิดอยู่ */
        orderAll() {
            const days = [...new Set(State.stores
                .filter(s => !s.inactive && routeOf(s) === State.localActiveRoute)
                .flatMap(s => s.days || []))];
            if (!days.length) return UI.showErrorToast('⚠️ ยังไม่มีร้านที่จัดลงวัน');
            UI.showConfirm(
                `จัดลำดับคิวใหม่ทุกวันของสาย ${State.localActiveRoute} ?\n\n` +
                `ระบบจะเรียงเส้นทางในแต่ละวันให้สั้นลงจากพิกัดร้าน (${days.length} วัน)\n` +
                `ลำดับเดิมที่แก้ไว้เองจะถูกเขียนทับ`,
                () => {
                    UI.showLoader('กำลังจัดลำดับคิว...', `${days.length} วัน`);
                    setTimeout(() => {
                        let n = 0;
                        days.forEach(d => { n += T.orderDay(d, true); });
                        UI.hideLoader(); UI.render(); App.saveDB();
                        UI.showSaveToast(`🔢 จัดลำดับแล้ว ${days.length} วัน · ${n} ร้าน`);
                    }, 100);
                });
        },

        /** แทรกร้านที่เพิ่งถูกจัดลงวัน ในตำแหน่งที่ทำให้เส้นทางอ้อมน้อยที่สุด */
        insert(store, day) {
            const arr = list(day, routeOf(store)).filter(s => s.id !== store.id);
            if (!store.seqs) store.seqs = {};
            if (!arr.length) { store.seqs[day] = 1; return; }
            let best = arr.length, bestCost = Infinity;
            for (let i = 0; i <= arr.length; i++) {
                const prev = i > 0 ? arr[i - 1] : null;
                const next = i < arr.length ? arr[i] : null;
                let cost;
                if (!prev) cost = dist(store, next);
                else if (!next) cost = dist(prev, store);
                else cost = dist(prev, store) + dist(store, next) - dist(prev, next);
                if (cost < bestCost) { bestCost = cost; best = i; }
            }
            arr.splice(best, 0, store);
            write(arr, day);
        },

        /** เรียกหลังจัดร้านลงวัน — แทรกลำดับให้ทุกร้านที่ยังไม่มีเลขคิว */
        reflow(days, route) {
            (days || []).forEach(day => {
                const arr = list(day, route);
                const missing = arr.filter(s => !s.seqs || !s.seqs[day]);
                if (!missing.length) return;
                // ถ้าวันนั้นยังไม่มีใครมีลำดับเลย = จัดใหม่ทั้งวัน
                if (missing.length === arr.length) { T.orderDay(day, true, route); return; }
                missing.forEach(s => T.insert(s, day));
            });
        },

        // ── หน้าต่างรายวัน: ลากสลับ + ปุ่มขึ้น/ลง ───────────────────────
        _drag: null,

        move(id, dir) {
            const day = State.openDayModal;
            const arr = list(day);
            const i = arr.findIndex(s => String(s.id) === String(id));
            const j = i + dir;
            if (i < 0 || j < 0 || j >= arr.length) return;
            const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            write(arr, day);
            App.saveDB(); UI.render(); UI.showDayModal(day);
        },

        dragStart(id) { T._drag = String(id); },
        dragOver(ev) { ev.preventDefault(); },
        drop(id) {
            const day = State.openDayModal;
            if (!T._drag || String(id) === T._drag) return;
            const arr = list(day);
            const from = arr.findIndex(s => String(s.id) === T._drag);
            const to = arr.findIndex(s => String(s.id) === String(id));
            if (from < 0 || to < 0) return;
            arr.splice(to, 0, arr.splice(from, 1)[0]);
            write(arr, day);
            T._drag = null;
            App.saveDB(); UI.render(); UI.showDayModal(day);
        },

        orderThisDay() {
            const day = State.openDayModal;
            const n = T.orderDay(day);
            UI.showDayModal(day);
            UI.showSaveToast(`🔢 จัดลำดับ ${DAY_COLORS[day].name} แล้ว ${n} ร้าน`);
        },
    };

    // ── ต่อของเข้ากับระบบเดิม ────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {

        // 1) หน้าต่างรายวัน — วาดใหม่ให้แก้ลำดับได้
        if (typeof UI !== 'undefined' && UI.showDayModal) {
            UI.showDayModal = (d) => {
                State.openDayModal = d;
                const title = document.getElementById('modalTitle');
                if (title) {
                    title.innerHTML = `<span class="w-4 h-4 rounded-full inline-block shadow-sm" style="background:${DAY_COLORS[d].hex}"></span> ${DAY_COLORS[d].name}`;
                }
                const arr = list(d);
                const rows = arr.map((x, i) => `
                    <div draggable="true" ondragstart="SeqTool.dragStart('${x.id}')"
                         ondragover="SeqTool.dragOver(event)" ondrop="SeqTool.drop('${x.id}')"
                         class="p-2.5 bg-white border border-gray-200 rounded-2xl flex items-center gap-2 mb-2 shadow-sm cursor-move">
                        <div class="bg-gray-900 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0">${i + 1}</div>
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-bold truncate text-gray-800">${x.name} ${x.freq === 2 ? '<span class="f2-badge">F2</span>' : ''}</p>
                            <p class="text-[10px] text-gray-400 font-mono mt-0.5">ID: ${x.id}${x.marketName ? ' · ' + x.marketName : ''}</p>
                        </div>
                        <div class="flex flex-col gap-0.5 shrink-0">
                            <button onclick="SeqTool.move('${x.id}',-1)" ${i === 0 ? 'disabled' : ''}
                                class="w-6 h-5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-[10px] leading-none disabled:opacity-30">▲</button>
                            <button onclick="SeqTool.move('${x.id}',1)" ${i === arr.length - 1 ? 'disabled' : ''}
                                class="w-6 h-5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-[10px] leading-none disabled:opacity-30">▼</button>
                        </div>
                    </div>`).join('');

                const content = document.getElementById('modalContent');
                if (content) content.innerHTML = `
                    <div class="flex items-center justify-between gap-2 mb-3 sticky top-0 bg-white pb-2 z-10">
                        <span class="text-[11px] text-gray-400">ลากสลับ หรือกดลูกศรเพื่อแก้ลำดับคิว</span>
                        <button onclick="SeqTool.orderThisDay()"
                            class="bg-gray-900 hover:bg-black text-white px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap">
                            🔢 จัดลำดับจากพิกัด
                        </button>
                    </div>${rows || '<p class="text-center text-gray-400 text-sm py-6">ยังไม่มีร้านในวันนี้</p>'}`;
                const modal = document.getElementById('dayModal');
                if (modal) modal.classList.remove('hidden');
            };
        }

        // 2) จัดร้านลงวันแล้ว → แทรกลำดับให้อัตโนมัติ
        if (typeof StoreMgr !== 'undefined') {
            const origAssign = StoreMgr.assignSelected;
            StoreMgr.assignSelected = function () {
                const ds = document.getElementById('assign-day');
                const day = ds ? ds.value : null;
                const sel = State.stores.filter(s => s.selected);
                const before = sel.map(s => s.id);
                // จำวันเดิมไว้ เพื่อไล่เลขลำดับของวันนั้นใหม่หลังร้านย้ายออก
                const oldDays = {};
                sel.forEach(s => {
                    const rt = routeOf(s);
                    (oldDays[rt] = oldDays[rt] || new Set());
                    (s.days || []).forEach(d => oldDays[rt].add(d));
                });
                origAssign.apply(this, arguments);
                if (!day || !before.length) return;
                Object.keys(oldDays).forEach(rt => oldDays[rt].forEach(d => T.compact(d, rt)));
                const touched = State.stores.filter(s => before.includes(s.id));
                const byRoute = {};
                touched.forEach(s => { (byRoute[routeOf(s)] = byRoute[routeOf(s)] || new Set())
                    .add(...(s.days || [])); (s.days || []).forEach(d => byRoute[routeOf(s)].add(d)); });
                Object.keys(byRoute).forEach(rt => SeqTool.reflow([...byRoute[rt]], rt));
                App.saveDB(); UI.render();
            };

            const origChange = StoreMgr.changeDay;
            StoreMgr.changeDay = function (id, d) {
                const s0 = State.stores.find(x => String(x.id) === String(id));
                const prevDays = s0 ? [...(s0.days || [])] : [];
                origChange.apply(this, arguments);
                if (d === 'remove') return;
                const s = State.stores.find(x => x.id === String(id));
                if (!s) return;
                SeqTool.reflow(s.days || [], routeOf(s));
                (prevDays || []).forEach(d => T.compact(d, routeOf(s)));
                App.saveDB(); UI.render();
            };
        }

        // 3) V0.7.5: เอาปุ่ม "จัดลำดับคิวทุกวันจากพิกัด" ออกจากแท็บสรุป — จัดทีละวันได้ในการ์ดวัน (🔢 จัดลำดับจากพิกัด)
    });

    return T;
})();

// ==========================================
// 🗂️ Cell Split — แบ่งพื้นที่ทั้งหมดออกเป็น K เซลล์ (สาย) ใหม่
// ==========================================
// โจทย์: ศูนย์ที่มีแต่ร้านค้า (พื้นที่ดิบ) ยังไม่ได้กำหนดเซลล์/เซลล์เดิมเกินภาระ —
// แบ่งร้านทั้งหมดออกเป็น K เซลล์ใหม่ ก่อนที่จะเข้า AI Route Builder (admin-ai.js) เพื่อจัดวันต่อ
//
// ลำดับความสำคัญ (ยืนยันกับผู้ใช้แล้ว 2026-09-05):
//   1. จังหวัด (province) = hard boundary เด็ดขาด ห้ามเซลล์ไหนคาบ 2 จังหวัด
//      ยกเว้น: จังหวัดที่มีร้านรวมกันไม่ถึงเกณฑ์ขั้นต่ำ 1 เซลล์ → รวมกับจังหวัดข้างเคียงที่ใกล้ที่สุด
//   2. อำเภอ (district) = soft boundary พยายามอยู่อำเภอเดียว ยอมข้ามได้ถ้าจำเป็นจริง
//   3. สมดุลจำนวนร้าน — ตั้งเป้าส่วนต่างเซลล์มาก-น้อยสุด ≤50 ร้าน แต่ยอมเกินได้ถ้าโครงสร้าง
//      จังหวัด/อำเภอจริงไม่เอื้อ (ไม่ฝืนแหกข้อ 1-2 เพื่อให้ได้ 50)
//   4. แอดมินตั้งชื่อเซลล์ใหม่เอง (ไม่ auto-name) ก่อนยืนยันสร้างเป็นสายจริง
// ==========================================

const CellSplit = {
    MIN_CELL_RATIO: 0.5,      // จังหวัดที่มีร้าน < 50% ของขนาดเซลล์เฉลี่ย ถือว่าเล็กเกินไป ต้องรวมกับจังหวัดข้างเคียง
    BALANCE_TARGET_DIFF: 50,  // ส่วนต่างร้าน มากสุด-น้อยสุด ที่ตั้งเป้าไว้ระหว่างเซลล์ (ภายในกลุ่มจังหวัดเดียวกัน)

    _dist: (a, b) => StoreMgr.getDistSq(a, b), // ระดับแบ่งเซลล์ (พื้นที่กว้างกว่าระดับวันมาก) ไม่ต้องใช้ elevation-aware แบบ AI Route Builder
    _centroid: (stores) => ({
        lat: stores.reduce((s, x) => s + x.lat, 0) / stores.length,
        lng: stores.reduce((s, x) => s + x.lng, 0) / stores.length,
    }),

    // ── ขั้น 1: กลุ่มร้านตามจังหวัด ──
    _groupByProvince: (stores) => {
        const byProv = {};
        stores.forEach(s => {
            const p = (s.province || 'ไม่ระบุจังหวัด').trim() || 'ไม่ระบุจังหวัด';
            (byProv[p] = byProv[p] || []).push(s);
        });
        return byProv;
    },

    // ── ขั้น 2: ควบรวมจังหวัดที่เล็กเกินไป (หรือจังหวัดเยอะกว่า K) เข้ากับจังหวัดข้างเคียงที่ใกล้ที่สุด ──
    _mergeSmallProvinces: (byProv, K) => {
        let groups = Object.keys(byProv).map(name => ({ names: [name], stores: byProv[name] }));
        const total = groups.reduce((s, g) => s + g.stores.length, 0);
        const minViable = (total / K) * CellSplit.MIN_CELL_RATIO;

        while (groups.length > 1) {
            groups.sort((a, b) => a.stores.length - b.stores.length);
            const smallest = groups[0];
            const needMerge = groups.length > K || smallest.stores.length < minViable;
            if (!needMerge) break;

            const smallC = CellSplit._centroid(smallest.stores);
            let nearest = null, nearestD = Infinity;
            for (let i = 1; i < groups.length; i++) {
                const d = CellSplit._dist(smallC, CellSplit._centroid(groups[i].stores));
                if (d < nearestD) { nearestD = d; nearest = groups[i]; }
            }
            if (!nearest) break;
            nearest.names = nearest.names.concat(smallest.names);
            nearest.stores = nearest.stores.concat(smallest.stores);
            groups = groups.filter(g => g !== smallest);
        }
        return groups;
    },

    // ── ขั้น 3: จัดสรรจำนวนเซลล์ K ให้แต่ละกลุ่มจังหวัด ตามสัดส่วนร้าน (largest-remainder method) ──
    _apportion: (groups, K) => {
        const total = groups.reduce((s, g) => s + g.stores.length, 0);
        const raw = groups.map(g => (g.stores.length / total) * K);
        let seats = raw.map(r => Math.max(1, Math.floor(r)));
        let used = seats.reduce((a, b) => a + b, 0);
        let remain = K - used;

        if (remain > 0) {
            const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
            let k = 0;
            while (remain > 0) { seats[order[k % order.length].i]++; remain--; k++; }
        } else if (remain < 0) {
            // กันเหนียวทางทฤษฎี (ไม่ควรเกิดเพราะ _mergeSmallProvinces การันตี groups.length<=K ไว้แล้ว)
            while (remain < 0) {
                const maxI = seats.indexOf(Math.max(...seats));
                if (seats[maxI] <= 1) break;
                seats[maxI]--; remain++;
            }
        }
        return groups.map((g, i) => ({ ...g, k: seats[i] }));
    },

    // ── K-Means++ init (เหมือน admin-ai.js แต่ไม่ใช้ elevation-aware — ระดับนี้กว้างเกินจะสนใจ) ──
    _initKMeansPP: (pts, nC) => {
        const cents = [pts[Math.floor(Math.random() * pts.length)]];
        while (cents.length < nC) {
            const ds = pts.map(p => { let m = Infinity; for (const c of cents) { const d = CellSplit._dist(p, c); if (d < m) m = d; } return m; });
            const tot = ds.reduce((a, b) => a + b, 0);
            if (tot === 0) { cents.push(pts[Math.floor(Math.random() * pts.length)]); continue; }
            let r = Math.random() * tot, ch = pts[pts.length - 1];
            for (let i = 0; i < pts.length; i++) { r -= ds[i]; if (r <= 0) { ch = pts[i]; break; } }
            cents.push(ch);
        }
        return cents;
    },

    // ── ขั้น 4: ภายในกลุ่มจังหวัดหนึ่ง แบ่งร้านเป็น k เซลล์ย่อยด้วย K-Means++ ──
    // ✅ ใช้ "capped greedy assignment" แบบเดียวกับ admin-ai.js (AI.calc) แทนการหา nearest-centroid
    // เฉยๆ — ถ้าปล่อยแบบ nearest-centroid ล้วน เซลล์ที่อยู่ในโซนหนาแน่นจะกินร้านเยอะเกินไปตั้งแต่
    // ต้น (ทดสอบกับข้อมูลจริงพบส่วนต่างสูงถึง 300+ ร้าน) เพราะไม่มีการจำกัดขนาดระหว่างจัดกลุ่มเลย
    // การจำกัดขนาดสูงสุดต่อเซลล์ (maxC) ตั้งแต่ตอน assign ทำให้ผลเริ่มต้นสมดุลกว่ามาก ก่อนที่
    // _balanceCells จะมาช่วยเกลี่ยรอบสุดท้ายอีกที (เหมือน pattern เดิมที่ทดสอบแล้วได้ผลดีใน AI Route Builder)
    _splitGroupIntoCells: (group) => {
        const { stores, k, names } = group;
        if (k <= 1 || stores.length <= k) {
            return [{ stores: stores.slice(), provinces: names }];
        }

        const maxC = Math.ceil(stores.length / k * 1.15); // เผื่อ slack 15% กันจัดลงไม่ได้ตอนท้ายๆ
        let cents = CellSplit._initKMeansPP(stores, k);
        let asg = new Array(stores.length).fill(-1);

        for (let it = 0; it < 30; it++) {
            asg.fill(-1);
            const cnt = Array(k).fill(0);
            const dA = [];
            for (let i = 0; i < stores.length; i++) for (let c = 0; c < k; c++) dA.push({ i, c, d: CellSplit._dist(stores[i], cents[c]) });
            dA.sort((a, b) => a.d - b.d);
            for (const p of dA) if (asg[p.i] === -1 && cnt[p.c] < maxC) { asg[p.i] = p.c; cnt[p.c]++; }
            for (let i = 0; i < stores.length; i++) if (asg[i] === -1) {
                let m = 0, mc = Infinity; for (let c = 0; c < k; c++) if (cnt[c] < mc) { mc = cnt[c]; m = c; } asg[i] = m; cnt[m]++;
            }
            const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0, n: 0 }));
            stores.forEach((s, i) => { const c = sums[asg[i]]; c.lat += s.lat; c.lng += s.lng; c.n++; });
            cents = cents.map((c, ci) => sums[ci].n > 0 ? { lat: sums[ci].lat / sums[ci].n, lng: sums[ci].lng / sums[ci].n } : c);
        }

        const cells = Array.from({ length: k }, () => ({ stores: [], provinces: names }));
        stores.forEach((s, i) => cells[asg[i]].stores.push(s));
        return cells.filter(c => c.stores.length > 0);
    },

    // ── ขั้น 5: เกลี่ยสมดุลภายในกลุ่มจังหวัดเดียวกัน (ห้ามข้ามจังหวัดเด็ดขาด — cells มาจาก group เดียวกันอยู่แล้ว) ──
    // ย้ายเฉพาะร้าน "borderline" (ใกล้เซลล์ปลายทาง ≤1.3x ระยะเดิม) เหมือนแนวทาง AI._balanceDays
    // ให้ความสำคัญกับร้านที่อำเภอตรงกับอำเภอหลักของเซลล์ปลายทางก่อน (ลดการข้ามอำเภอ)
    _balanceCells: (cells) => {
        if (cells.length <= 1) return;
        const TOL = CellSplit.BALANCE_TARGET_DIFF, MAX_ITER = 200, GR = 1.3;

        const dominantDistrict = (c) => {
            const cnt = {};
            c.stores.forEach(s => { const d = s.district || ''; cnt[d] = (cnt[d] || 0) + 1; });
            return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
        };

        for (let it = 0; it < MAX_ITER; it++) {
            const cents = cells.map(c => CellSplit._centroid(c.stores));
            const counts = cells.map(c => c.stores.length);
            const maxI = counts.indexOf(Math.max(...counts));
            const minI = counts.indexOf(Math.min(...counts));
            if (counts[maxI] - counts[minI] <= TOL) break;

            const over = cells[maxI], under = cells[minI];
            const underDistrict = dominantDistrict(under);

            const candidates = over.stores
                .map((s, idx) => ({ s, idx, dOver: CellSplit._dist(s, cents[maxI]), dUnder: CellSplit._dist(s, cents[minI]) }))
                .filter(c => c.dUnder <= c.dOver * GR * GR);
            if (!candidates.length) break;

            // เลือกร้านที่อำเภอตรงกับปลายทางก่อน (ลดข้ามอำเภอ) ถ้าไม่มีค่อยเอาที่ใกล้สุด
            candidates.sort((a, b) => {
                const aMatch = (a.s.district === underDistrict) ? 0 : 1;
                const bMatch = (b.s.district === underDistrict) ? 0 : 1;
                if (aMatch !== bMatch) return aMatch - bMatch;
                return a.dUnder - b.dUnder;
            });
            const pick = candidates[0];
            over.stores.splice(pick.idx, 1);
            under.stores.push(pick.s);
        }
    },

    // ── ขั้น 6: Fix Jumpers (Voronoi reassignment ทั่วทุกคู่เซลล์ในกลุ่มจังหวัดเดียวกัน) ──
    // ✅ NEW: _balanceCells ข้างบนดูแค่คู่ "เซลล์ใหญ่สุด-เล็กสุด" ต่อรอบเท่านั้น — ร้านที่อยู่ผิดที่
    // ระหว่างเซลล์ 2 อันที่ไม่ใช่สุดขั้ว (เช่น เซลล์กลางๆ ทั้งคู่) จะไม่มีวันถูกตรวจเจอเลย
    // (ทดสอบกับข้อมูลจริง 1,684 ร้าน พบร้าน "โดด" แบบนี้ 133 ร้าน — ตรงกับที่ผู้ใช้สังเกตเห็นจากแผนที่)
    // pass นี้เช็คทุกร้านกับ "ทุกเซลล์" หา centroid ที่ใกล้ที่สุดจริงๆ แล้วย้าย ถ้าไม่ทำให้ขนาดหลุด
    // กรอบ TOL มากเกินไป (กันย้ายวนไม่รู้จบ/กันทำลายสมดุลที่ _balanceCells เพิ่งจัดไว้)
    _fixJumpers: (cells) => {
        if (cells.length <= 1) return 0;
        // ✅ TOL ใช้ BALANCE_TARGET_DIFF เต็มจำนวน (ไม่ใช้ค่าแคบแบบ AI._fixJumpers) เพราะเซลล์ระดับนี้
        // มีขนาดหลักร้อยร้าน TOL แคบๆ จะบล็อกการแก้ร้านโดดจริงไปเกือบหมด — ปล่อยให้เพี้ยนได้ในกรอบ
        // เป้าหมายสุดท้าย (BALANCE_TARGET_DIFF) แล้วให้ _balanceCells ที่รันซ้ำอีกทีหลังจากนี้เก็บงานสมดุลต่อ
        const TOL = CellSplit.BALANCE_TARGET_DIFF;
        let fixed = 0;

        for (let pass = 0; pass < 5; pass++) {
            let cents = cells.map(c => CellSplit._centroid(c.stores));
            const total = cells.reduce((s, c) => s + c.stores.length, 0);
            const target = total / cells.length;
            let changed = false;

            cells.forEach((c, ci) => {
                for (let idx = c.stores.length - 1; idx >= 0; idx--) {
                    const s = c.stores[idx];
                    let best = ci, bestD = CellSplit._dist(s, cents[ci]);
                    cells.forEach((c2, ci2) => {
                        if (ci2 === ci) return;
                        const d = CellSplit._dist(s, cents[ci2]);
                        if (d < bestD) { bestD = d; best = ci2; }
                    });
                    if (best === ci) continue;
                    if (cells[best].stores.length > target + TOL) continue;
                    if (c.stores.length <= target - TOL) continue;

                    c.stores.splice(idx, 1);
                    cells[best].stores.push(s);
                    // เซลล์ว่างสนิทไม่ควรเกิดขึ้นจริง (มี TOL กันไว้) แต่กันเหนียวไม่ recalculate centroid เป็น NaN
                    if (c.stores.length) cents[ci] = CellSplit._centroid(c.stores);
                    cents[best] = CellSplit._centroid(cells[best].stores);
                    changed = true; fixed++;
                }
            });
            if (!changed) break;
        }
        return fixed;
    },

    // ── Public API: รัน pipeline เต็ม คืนผลลัพธ์ preview ──
    preview: (stores, K) => {
        if (!stores.length || K < 1) return { cells: [], provinceReport: [] };
        const byProv = CellSplit._groupByProvince(stores);
        const provinceGroups = CellSplit._mergeSmallProvinces(byProv, K);
        const apportioned = CellSplit._apportion(provinceGroups, K);

        let allCells = [];
        apportioned.forEach(g => {
            const cells = CellSplit._splitGroupIntoCells(g);
            CellSplit._balanceCells(cells);
            CellSplit._fixJumpers(cells);
            CellSplit._balanceCells(cells); // เช็คสมดุลอีกรอบ เผื่อ jumper-fix ทำให้บางเซลล์เพี้ยนไปนิดหน่อย
            allCells = allCells.concat(cells);
        });

        const provinceReport = apportioned.map(g => ({
            names: g.names, count: g.stores.length, k: g.k,
            merged: g.names.length > 1,
        }));

        return { cells: allCells, provinceReport };
    },
};

// ==========================================
// 🖥️ CellSplitApp — หน้าจอ "แบ่งเซลล์" (4 ขั้นตอน: เลือกสายต้นทาง → preview → ตั้งชื่อ → ยืนยัน)
// ==========================================
const CellSplitApp = {
    _sourceStores: [],
    _selectedRoutes: [],
    _result: null,
    _map: null,

    init: () => {
        CellSplitApp._renderRouteChecklist();
        CellSplitApp._showStep(1);
    },

    _renderRouteChecklist: () => {
        const el = document.getElementById('cellsplit-route-list');
        if (!el) return;
        const routes = (State.db.routeList || []).slice().sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
        el.innerHTML = routes.map(r => `
            <label class="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded cursor-pointer text-sm">
                <input type="checkbox" value="${r}" class="cellsplit-route-chk w-4 h-4 accent-indigo-600">
                <span>${r}</span>
            </label>
        `).join('') || '<p class="text-xs text-gray-400 p-2">ยังไม่มีสายในเดือนนี้</p>';
    },

    _showStep: (n) => {
        [1, 2].forEach(i => {
            const el = document.getElementById('cellsplit-step' + i);
            if (el) el.classList.toggle('hidden', i !== n);
        });
    },

    // ── ขั้น 1 → 2: โหลดร้านจากสายที่เลือก แล้วรัน CellSplit.preview() ──
    run: async () => {
        const checked = Array.from(document.querySelectorAll('.cellsplit-route-chk:checked')).map(el => el.value);
        const kInput = document.getElementById('cellsplit-k');
        const K = parseInt(kInput?.value);
        if (!checked.length) return UI.showErrorToast('⚠️ เลือกสายต้นทางอย่างน้อย 1 สาย');
        if (isNaN(K) || K < 1) return UI.showErrorToast('⚠️ กรอกจำนวนเซลล์ให้ถูกต้อง');

        UI.showLoader('กำลังโหลดร้านค้า...', '');
        const ym = App._currentPlanYM;
        let allStores = [];
        try {
            for (const name of checked) {
                let stores = State.db.routes[name];
                if (!Array.isArray(stores)) {
                    const doc = await App.planRoutesCol(ym).doc(name).get();
                    stores = doc.exists ? (doc.data().stores || []) : [];
                }
                // deep clone กันแก้ reference เดิมที่ผูกกับ State.db.routes (ถ้ายกเลิกกลางทาง ไม่ให้กระทบข้อมูลจริง)
                allStores = allStores.concat(stores.map(s => ({ ...s })));
            }
        } catch (e) {
            UI.hideLoader();
            return UI.showErrorToast('❌ โหลดร้านค้าไม่สำเร็จ: ' + e.message);
        }

        const noCoord = allStores.filter(s => typeof s.lat !== 'number' || typeof s.lng !== 'number' || isNaN(s.lat) || isNaN(s.lng));
        if (noCoord.length) {
            UI.hideLoader();
            return UI.showErrorToast(`⚠️ มี ${noCoord.length} ร้านที่ยังไม่มีพิกัด (lat/lng) — เพิ่มพิกัดให้ครบก่อนแบ่งเซลล์`);
        }
        if (allStores.length < K) {
            UI.hideLoader();
            return UI.showErrorToast('⚠️ ร้านน้อยกว่าจำนวนเซลล์ที่ต้องการ');
        }

        CellSplitApp._selectedRoutes = checked;
        CellSplitApp._sourceStores = allStores;
        CellSplitApp._result = CellSplit.preview(allStores, K);

        UI.hideLoader();
        // ✅ FIX: ต้องโชว์ step2 (เอา class hidden ออก) ก่อนเรียก _renderPreview()/_renderMap()
        // เพราะ Leaflet ต้อง measure ขนาด container ตอน init/fitBounds — ถ้า container ยังโดน
        // display:none อยู่ (ยัง hidden) จะวัดได้ 0x0 ทำให้ fitBounds คำนวณผิด (ซูมเข้าสุดผิดจุด)
        CellSplitApp._showStep(2);
        CellSplitApp._renderPreview();
    },

    _renderPreview: () => {
        const { cells, provinceReport } = CellSplitApp._result;

        const provEl = document.getElementById('cellsplit-province-table');
        if (provEl) {
            provEl.innerHTML = provinceReport.map(p => `
                <tr class="border-b border-gray-100">
                    <td class="py-1.5 px-2">${p.names.join(' + ')}${p.merged ? ' <span class="text-amber-600 text-[10px] font-bold">(ควบรวม — จังหวัดเล็กเกินไป)</span>' : ''}</td>
                    <td class="py-1.5 px-2 text-right">${p.count}</td>
                    <td class="py-1.5 px-2 text-right font-bold">${p.k}</td>
                </tr>
            `).join('');
        }

        const cardsEl = document.getElementById('cellsplit-cell-cards');
        if (cardsEl) {
            cardsEl.innerHTML = cells.map((c, i) => {
                const color = Config.hexColors[i % Config.hexColors.length];
                const provinces = [...new Set(c.stores.map(s => s.province))];
                const districts = [...new Set(c.stores.map(s => s.district))];
                return `
                <div class="flex items-center gap-2 p-2 border border-gray-200 rounded-lg mb-1.5">
                    <span class="w-4 h-4 rounded-full shrink-0" style="background:${color}"></span>
                    <div class="flex-1 min-w-0">
                        <input type="text" data-cell-idx="${i}" placeholder="ตั้งชื่อสายใหม่ เช่น 402V13"
                            class="cellsplit-name-inp w-full border border-gray-300 rounded-lg px-2 py-1 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                        <p class="text-[11px] text-gray-500 mt-0.5">${c.stores.length} ร้าน | ${provinces.join(',')} | ${districts.length} อำเภอ${districts.length > 1 ? ' (' + districts.join(', ') + ')' : ''}</p>
                    </div>
                </div>`;
            }).join('');
        }

        const counts = cells.map(c => c.stores.length);
        const diffEl = document.getElementById('cellsplit-balance-summary');
        if (diffEl) {
            const diff = Math.max(...counts) - Math.min(...counts);
            diffEl.innerHTML = `ร้านมากสุด <b>${Math.max(...counts)}</b> — น้อยสุด <b>${Math.min(...counts)}</b> (ส่วนต่าง ${diff} ร้าน)` +
                (diff > CellSplit.BALANCE_TARGET_DIFF
                    ? ` <span class="text-amber-600 font-bold">⚠️ เกินเป้า ${CellSplit.BALANCE_TARGET_DIFF} ร้าน (ข้อจำกัดจังหวัด/อำเภอไม่เอื้อให้เกลี่ยมากกว่านี้)</span>`
                    : ' <span class="text-emerald-600 font-bold">✓ อยู่ในเป้า</span>');
        }

        CellSplitApp._renderMap();
    },

    _renderMap: () => {
        const { cells } = CellSplitApp._result;
        if (!CellSplitApp._map) {
            CellSplitApp._map = L.map('cellsplit-map');
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(CellSplitApp._map);
        }
        CellSplitApp._map.eachLayer(l => { if (l instanceof L.CircleMarker) CellSplitApp._map.removeLayer(l); });

        const allPts = [];
        cells.forEach((c, i) => {
            const color = Config.hexColors[i % Config.hexColors.length];
            c.stores.forEach(s => {
                L.circleMarker([s.lat, s.lng], { radius: 4, color, fillColor: color, fillOpacity: 0.8, weight: 1 }).addTo(CellSplitApp._map);
                allPts.push([s.lat, s.lng]);
            });
        });
        // ✅ invalidateSize() ต้องมาก่อน fitBounds() เสมอ กัน container ที่เพิ่งโผล่ (จาก hidden)
        // ถูก Leaflet measure ผิดขนาดตอน fit — หน่วง 1 tick ให้ browser layout เสร็จก่อน
        setTimeout(() => {
            CellSplitApp._map.invalidateSize();
            if (allPts.length) CellSplitApp._map.fitBounds(allPts, { padding: [20, 20] });
        }, 50);
    },

    back: () => CellSplitApp._showStep(1),

    // ── ขั้น 2 → ยืนยัน: สร้างสายใหม่จริง + ลบสายต้นทาง ──
    confirm: () => {
        const inputs = document.querySelectorAll('.cellsplit-name-inp');
        const names = Array.from(inputs).map(el => el.value.trim());

        if (names.some(n => !n)) return UI.showErrorToast('⚠️ กรอกชื่อสายให้ครบทุกเซลล์');
        const dup = names.filter((n, i) => names.indexOf(n) !== i);
        if (dup.length) return UI.showErrorToast('⚠️ ชื่อสายซ้ำกัน: ' + [...new Set(dup)].join(', '));

        const existing = (State.db.routeList || []).filter(r => !CellSplitApp._selectedRoutes.includes(r));
        const clash = names.filter(n => existing.includes(n));
        if (clash.length) return UI.showErrorToast('⚠️ ชื่อสายนี้มีอยู่แล้วในระบบ: ' + clash.join(', '));

        UI.showConfirm(
            `ยืนยันสร้าง ${names.length} สายใหม่ (${names.join(', ')})\nและลบสายต้นทาง ${CellSplitApp._selectedRoutes.join(', ')} ทิ้ง?\n\nขั้นตอนนี้ย้อนกลับไม่ได้`,
            () => CellSplitApp._doConfirm(names)
        );
    },

    _doConfirm: async (names) => {
        UI.showLoader('กำลังสร้างสายใหม่...', '');
        const ym = App._currentPlanYM;
        const { cells } = CellSplitApp._result;
        try {
            const writes = cells.map((c, i) => App.planRoutesCol(ym).doc(names[i]).set({ stores: c.stores }));
            const deletes = CellSplitApp._selectedRoutes.map(name => App.planRoutesCol(ym).doc(name).delete());
            await Promise.all([...writes, ...deletes]);

            const newRouteList = (State.db.routeList || [])
                .filter(r => !CellSplitApp._selectedRoutes.includes(r))
                .concat(names)
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            await App.planRef(ym).set({ routeList: newRouteList }, { merge: true });

            CellSplitApp._selectedRoutes.forEach(name => delete State.db.routes[name]);
            State.db.routeList = newRouteList;
            cells.forEach((c, i) => { State.db.routes[names[i]] = c.stores; });

            if (typeof App !== 'undefined' && App.writeAuditLog) {
                App.writeAuditLog('cell_split', {
                    sourceRoutes: CellSplitApp._selectedRoutes, newRoutes: names,
                    totalStores: CellSplitApp._sourceStores.length, K: cells.length,
                });
            }

            UI.hideLoader();
            UI.showSaveToast(`✅ แบ่งเซลล์สำเร็จ! สร้าง ${names.length} สายใหม่เรียบร้อย`);
            CellSplitApp._showStep(1);
            CellSplitApp._renderRouteChecklist();
            document.querySelectorAll('.cellsplit-route-chk').forEach(el => { el.checked = false; });

            if (typeof App.sync === 'function') App.sync();
        } catch (e) {
            UI.hideLoader();
            UI.showErrorToast('❌ สร้างสายใหม่ไม่สำเร็จ: ' + ErrorMsg.translate(e));
        }
    },
};

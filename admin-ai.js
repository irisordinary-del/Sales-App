// ==========================================
// 🤖 AI Route Builder  v5
// K-Means++ | Elevation-Aware Distance | Geo-Aware Balance | Jumper Fix
// | Road-Verify | Min/Max Bound Enforcement
// ==========================================
const AI = {

    // ✅ NEW (2026-09-05): ขอบเขตจำนวนร้าน/วันบังคับ (กฎธุรกิจ — ไม่ใช่แค่ "พยายามให้ใกล้เคียงกัน" เหมือนเดิม)
    MIN_PER_DAY: 18,
    MAX_PER_DAY: 30,

    run: () => {
        if (!State || !State.stores) return UI.showErrorToast('⚠️ ระบบยังโหลดข้อมูลไม่เสร็จ กรุณารอสักครู่');
        if (State.stores.length === 0) return UI.showErrorToast('⚠️ ยังไม่มีข้อมูลร้านค้า กรุณาอัปโหลดไฟล์พิกัดก่อน');

        const elDays  = document.getElementById('ai-days');
        const elLock  = document.getElementById('ai-lock');
        const elLimit = document.getElementById('ai-outlier');
        const elDist  = document.getElementById('ai-dist');
        if (!elDays || !elLock || !elLimit || !elDist)
            return UI.showErrorToast('❌ หาปุ่มตั้งค่า AI ไม่เจอ');

        const k     = parseInt(elDays.value);
        const lock  = elLock.checked;
        const limit = elLimit.checked;
        const mxD   = parseFloat(elDist.value);

        if (isNaN(k) || k < 2) return UI.showErrorToast('⚠️ จำนวนวันต้องมีอย่างน้อย 2 วัน');

        // ✅ NEW (2026-09-05): ดึงความสูงร้านทั้งหมดก่อนเริ่มจัดกลุ่ม (ใช้ตรวจจับพื้นที่ภูเขา)
        // ยิงแค่ 1 request/สาย (สูงสุด 2,000 จุด/request ตามข้อจำกัดของ ORS) และแคชผลไว้กับร้าน
        // (State.stores) ไม่ได้ save ถาวรจนกว่าจะกด AI จริง — ถ้า fetch ไม่สำเร็จ ข้ามไปเงียบๆ
        // แล้วจัดแบบเดิม (เส้นตรงล้วน) ไม่ทำให้ทั้งฟีเจอร์พังเพราะจุดนี้จุดเดียว
        const proceed = () => {
            UI.showLoader('AI กำลังวิเคราะห์...', 'กำลังตรวจสอบความสูงพื้นที่...');
            UI.setLoaderProgress(2);
            AI._fetchElevations(State.stores).finally(() => {
                UI.setLoaderProgress(10, 'จับกลุ่มร้านค้าที่อยู่ใกล้กัน');
                setTimeout(() => AI.calc(k, lock, limit, mxD), 150);
            });
        };

        const hasAssigned = State.stores.some(s => s.days && s.days.length > 0);
        if (hasAssigned && !lock) {
            UI.showConfirm(
                "⚠️ มีร้านที่ถูกจัดสายไว้แล้ว!\nยืนยันที่จะล้างข้อมูลสายเดิมทั้งหมด แล้วให้ AI จัดใหม่ไหมครับ?",
                proceed
            );
            return;
        }
        proceed();
    },

    // ✅ NEW (2026-09-05): ดึงความสูง (เมตรจากระดับน้ำทะเล) ของร้านที่ยังไม่มี s.elevation
    // ผ่าน /api/elevation (proxy ไป OpenRouteService Elevation Line API) — เก็บผลไว้ที่ s.elevation
    // ของแต่ละร้านเลย (ครั้งต่อไปที่กด AI ร้านเดิมไม่ต้องยิงซ้ำ ประหยัดโควตา)
    _fetchElevations: async (stores) => {
        const needed = stores.filter(s => typeof s.elevation !== 'number');
        if (!needed.length) return;
        try {
            const res = await fetch('/api/elevation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: needed.map(s => ({ lat: s.lat, lng: s.lng })) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !Array.isArray(data.elevations)) {
                console.warn('[AI] ดึงความสูงไม่สำเร็จ — จัดสายแบบไม่ใช้ความสูงช่วยแทน:', data.error || res.statusText);
                return;
            }
            needed.forEach((s, i) => {
                if (typeof data.elevations[i] === 'number') s.elevation = data.elevations[i];
            });
        } catch (e) {
            console.warn('[AI] เชื่อมต่อ elevation API ไม่สำเร็จ — จัดสายแบบไม่ใช้ความสูงช่วยแทน:', e.message);
        }
    },

    // ✅ NEW (2026-09-05): ระยะทางที่ใช้ตัดสินใจจัดกลุ่ม — ปรับจากเส้นตรงเดิมให้ "ดูไกลขึ้น"
    // ถ้าความสูงต่างกันเยอะ (เดาว่ามีภูเขา/เนินสูงคั่นอยู่) แต่ไม่ปิดกั้นเด็ดขาด (คูณสูงสุด 4 เท่า
    // ไม่ใช่ตัดออกจากการจัดกลุ่มไปเลย) — ถ้าไม่มีข้อมูลความสูง (fetch ไม่สำเร็จ) fallback เป็น
    // เส้นตรงเดิมเป๊ะ ไม่กระทบพฤติกรรมเดิมเลย
    _getDist: (a, b) => {
        const base = StoreMgr.getDistSq(a, b);
        if (typeof a.elevation !== 'number' || typeof b.elevation !== 'number') return base;
        const elevDiff = Math.abs(a.elevation - b.elevation);
        if (elevDiff <= 100) return base; // ต่างกันไม่ถึง 100 ม. ไม่ถือว่ามีนัยสำคัญ ไม่ปรับ
        const factor = Math.min(1 + (elevDiff - 100) / 100, 4); // ยิ่งต่างสูงยิ่งปรับเยอะ เพดาน 4 เท่า
        return base * factor * factor; // base เป็นระยะยกกำลัง 2 อยู่แล้ว ต้องคูณ factor² ให้ตรงกับ "ระยะจริง × factor"
    },

    // ─── K-Means++ Initialization ───────────────────────────────────────
    _initKMeansPP: (pts, nC) => {
        const cents = [pts[Math.floor(Math.random() * pts.length)]];
        while (cents.length < nC) {
            const ds = pts.map(p => { let m = Infinity; for (const c of cents) { const d = AI._getDist(p, c); if (d < m) m = d; } return m; });
            const tot = ds.reduce((a, b) => a + b, 0);
            if (tot === 0) { cents.push(pts[Math.floor(Math.random() * pts.length)]); continue; }
            let r = Math.random() * tot, ch = pts[pts.length - 1];
            for (let i = 0; i < pts.length; i++) { r -= ds[i]; if (r <= 0) { ch = pts[i]; break; } }
            cents.push(ch);
        }
        return cents;
    },
    _calcWCSS: (pts, cs, asg) => pts.reduce((s, p, i) => s + (asg[i] >= 0 ? AI._getDist(p, cs[asg[i]]) : 0), 0),

    // ─── Build shared state for balance & jumper helpers ────────────────
    // ✅ FIX (2026-09-04 — พบจากทดสอบด้วยข้อมูลจริง): เดิม centroid ของแต่ละวันคำนวณจากร้าน
    // freq=1 (s.days.length===1) เท่านั้น ข้ามร้าน freq=2 (ไปเยี่ยม 2 ครั้ง/เดือน, s.days มี 2 ค่า)
    // ทิ้งไปเลย ทั้งที่ร้าน freq=2 ก็ไปเยี่ยมจริงในวันนั้นเหมือนกัน — โซนไหนมีร้าน freq=2 เยอะ
    // centroid ที่คำนวณได้จะเพี้ยนไปจากตำแหน่งจริง ทำให้ Balance/Jumper-Fix ตัดสินใจย้ายร้านผิดพลาด
    // (ทดสอบกับข้อมูลจริง 537 ร้าน พบร้าน "โดด" 10 ร้าน ส่วนใหญ่เป็นคู่วันของร้าน freq=2 พอดี)
    // แก้โดยแยก 2 อย่าง: "ร้านที่ย้ายได้" (ds — freq=1 เท่านั้น ยังคงเดิม ไม่เปลี่ยน logic การย้าย)
    // กับ "ร้านที่ใช้คำนวณ centroid" (all — รวมทุกร้านที่ไปเยี่ยมวันนั้นจริง ทั้ง freq=1 และ freq=2)
    _buildDayState: (k) => {
        const ds = {}, all = {}, cnt = {};
        for (let d = 1; d <= k; d++) { ds[`Day ${d}`] = []; all[`Day ${d}`] = []; }
        State.stores.forEach((s, i) => {
            if (!s.days || !s.days.length) return;
            s.days.forEach(d => {
                if (all[d] === undefined) return;
                all[d].push(i);
                if (s.days.length === 1) ds[d].push(i);
            });
        });
        const allDays = Object.keys(all).filter(d => all[d].length > 0);
        allDays.forEach(d => cnt[d] = ds[d].length);
        const calcC = d => {
            const ix = all[d]; if (!ix.length) return null;
            return { lat: ix.reduce((s,i)=>s+State.stores[i].lat,0)/ix.length,
                     lng: ix.reduce((s,i)=>s+State.stores[i].lng,0)/ix.length };
        };
        const cents = {}; allDays.forEach(d => cents[d] = calcC(d));
        return { ds, all, cnt, allDays, cents, calcC };
    },

    // ─── Step 1: Geo-Aware Balance ───────────────────────────────────────
    // ย้ายเฉพาะ "borderline" stores (อยู่ใกล้ปลายทาง ≤ 1.4× ระยะจากต้นทาง)
    _balanceDays: (k) => {
        const TOL = 5, MAX_ITER = 400, GR = 1.4;
        const { ds, all, cnt, allDays, cents, calcC } = AI._buildDayState(k);

        let stuck = 0;
        for (let it = 0; it < MAX_ITER; it++) {
            const byD = [...allDays].sort((a,b) => cnt[b]-cnt[a]);
            const byA = [...allDays].sort((a,b) => cnt[a]-cnt[b]);
            if (cnt[byD[0]] - cnt[byA[0]] <= TOL * 2) break;

            let moved = false;
            outer: for (const over of byD) {
                for (const under of byA) {
                    if (over === under) continue;
                    if (cnt[over] - cnt[under] <= TOL * 2) break outer;
                    if (!cents[over] || !cents[under]) continue;

                    const valid = ds[over].filter(i => {
                        const s = State.stores[i];
                        return AI._getDist(s, cents[under]) <= AI._getDist(s, cents[over]) * GR * GR;
                    });
                    if (!valid.length) continue;

                    const bestIdx = valid.reduce((b, i) =>
                        AI._getDist(State.stores[i], cents[under]) <
                        AI._getDist(State.stores[b], cents[under]) ? i : b);

                    State.stores[bestIdx].days = [under];
                    ds[over]  = ds[over].filter(x => x !== bestIdx);
                    ds[under].push(bestIdx);
                    // ✅ FIX: sync all[] เหมือนกับ ds[] เพราะ calcC() อ่านจาก all[] แล้ว (ดู comment ใน _buildDayState)
                    all[over]  = all[over].filter(x => x !== bestIdx);
                    all[under].push(bestIdx);
                    cnt[over]--; cnt[under]++;
                    cents[over]  = calcC(over);
                    cents[under] = calcC(under);
                    moved = true; stuck = 0;
                    break outer;
                }
            }
            if (!moved) { if (++stuck >= k * 3) break; }
        }
        const cv = allDays.map(d => cnt[d]).filter(c => c > 0);
        return { max: Math.max(...cv), min: Math.min(...cv), avg: Math.round(cv.reduce((a,b)=>a+b,0)/cv.length) };
    },

    // ─── Step 2: Fix Jumpers ─────────────────────────────────────────────
    // Voronoi reassignment: ส่งร้านที่อยู่ผิด Voronoi cell กลับที่ถูก
    // รัน 5 รอบหรือจนไม่มีการเปลี่ยนแปลง (converge)
    _fixJumpers: (k) => {
        const TOL = 5;
        const { ds, all, cnt, allDays, cents, calcC } = AI._buildDayState(k);
        const total  = allDays.reduce((s, d) => s + cnt[d], 0);
        const target = total / allDays.length;

        let fixed = 0;
        for (let pass = 0; pass < 5; pass++) {
            let changed = false;
            State.stores.forEach((s, idx) => {
                if (!s.days || s.days.length !== 1) return;
                const cur = s.days[0];
                if (!cents[cur]) return;

                // หา centroid ที่ใกล้ที่สุด
                let best = cur, bestD = AI._getDist(s, cents[cur]);
                allDays.forEach(d => {
                    if (!cents[d]) return;
                    const dd = AI._getDist(s, cents[d]);
                    if (dd < bestD) { bestD = dd; best = d; }
                });

                if (best === cur) return; // ถูกที่แล้ว

                // เช็ค balance: ไม่ย้ายถ้าปลายทางเต็มหรือต้นทางจะว่างเกิน
                if (cnt[best]  > target + TOL) return;
                if (cnt[cur]   <= target - TOL) return;

                // ย้าย
                s.days = [best];
                ds[cur]  = ds[cur].filter(x => x !== idx);
                ds[best].push(idx);
                // ✅ FIX: sync all[] เหมือนกับ ds[] เพราะ calcC() อ่านจาก all[] แล้ว (ดู comment ใน _buildDayState)
                all[cur]  = all[cur].filter(x => x !== idx);
                all[best].push(idx);
                cnt[cur]--; cnt[best]++;
                cents[cur]  = calcC(cur);
                cents[best] = calcC(best);
                changed = true; fixed++;
            });
            if (!changed) break; // converge
        }
        return fixed;
    },

    // ✅ NEW (2026-09-05): บังคับขอบเขตจำนวนร้าน/วัน (MIN_PER_DAY-MAX_PER_DAY) — รันหลังสุด
    // เพราะเป็นกฎธุรกิจที่ต้องทำตามเสมอ ต่อให้ต้องยอมเสียความ "ใกล้ทางภูมิศาสตร์" ไปบ้าง
    // (ยังเลือกร้านที่ใกล้ปลายทางที่สุดในการย้ายอยู่ดี แค่ไม่ยอมให้ไม่ย้ายเฉยๆ เหมือน pass อื่น)
    _enforceMinMax: (k, minPerDay, maxPerDay) => {
        const { ds, all, cnt, allDays, cents, calcC } = AI._buildDayState(k);
        let moved = 0, guard = 0;

        const pickWorst = () => {
            const over = allDays.filter(d => cnt[d] > maxPerDay).sort((a,b) => cnt[b]-cnt[a])[0];
            if (over) return { day: over, mode: 'over' };
            const under = allDays.filter(d => cnt[d] < minPerDay).sort((a,b) => cnt[a]-cnt[b])[0];
            if (under) return { day: under, mode: 'under' };
            return null;
        };

        while (guard++ < 1500) {
            const w = pickWorst();
            if (!w) break;

            if (w.mode === 'over') {
                const from = w.day;
                if (!ds[from].length) break;
                let bestStore = null, bestDay = null, bestD = Infinity;
                ds[from].forEach(i => {
                    allDays.forEach(d => {
                        if (d === from || cnt[d] >= maxPerDay || !cents[d]) return;
                        const dd = AI._getDist(State.stores[i], cents[d]);
                        if (dd < bestD) { bestD = dd; bestStore = i; bestDay = d; }
                    });
                });
                if (bestStore === null) break; // ทุกวันเต็ม max หมดแล้วจริงๆ — หยุดกันวนไม่รู้จบ
                State.stores[bestStore].days = [bestDay];
                ds[from]    = ds[from].filter(x => x !== bestStore);    ds[bestDay].push(bestStore);
                all[from]   = all[from].filter(x => x !== bestStore);   all[bestDay].push(bestStore);
                cnt[from]--; cnt[bestDay]++;
                cents[from] = calcC(from); cents[bestDay] = calcC(bestDay);
                moved++;
            } else {
                const to = w.day;
                let bestStore = null, bestFromDay = null, bestD = Infinity;
                allDays.forEach(d => {
                    if (d === to || cnt[d] <= minPerDay || !ds[d].length) return;
                    ds[d].forEach(i => {
                        const dd = AI._getDist(State.stores[i], cents[to]);
                        if (dd < bestD) { bestD = dd; bestStore = i; bestFromDay = d; }
                    });
                });
                if (bestStore === null) break; // ไม่มีวันไหนให้ดึงมาเติมได้แล้วจริงๆ — หยุด
                State.stores[bestStore].days = [to];
                ds[bestFromDay]  = ds[bestFromDay].filter(x => x !== bestStore);  ds[to].push(bestStore);
                all[bestFromDay] = all[bestFromDay].filter(x => x !== bestStore); all[to].push(bestStore);
                cnt[bestFromDay]--; cnt[to]++;
                cents[bestFromDay] = calcC(bestFromDay); cents[to] = calcC(to);
                moved++;
            }
        }
        return moved;
    },

    // ✅ NEW (2026-09-05): ตรวจสอบร้าน "โดด" ที่เหลือ (หลัง Balance+Jumper-Fix) ด้วยเส้นทางถนนจริง
    // ผ่าน /api/optimize-route (ยิงแค่ร้านที่ดูโดดจริงๆ ไม่ใช่ทุกร้าน) — กันพลาดกรณีความสูงหลอก
    // (มีถนนอ้อมภูเขาได้จริงแบบไม่ไกลมาก แต่ค่าความสูงต่างเยอะจนโดนปรับระยะไปแล้ว)
    // ย้ายจริงเฉพาะร้านที่เส้นทางจริงยืนยันว่าโดดจริง — ถ้า API ล้มเหลว/เกินโควตา ข้ามร้านนั้นไปเงียบๆ
    // ไม่กระทบร้านอื่น ไม่ทำให้ทั้งฟีเจอร์พัง
    _verifyJumpersWithRoad: async (k, onProgress) => {
        const { allDays, cents } = AI._buildDayState(k);
        const distKm = (a, b) => {
            const R = 6371, dLat = (b.lat-a.lat)*Math.PI/180, dLng = (b.lng-a.lng)*Math.PI/180;
            const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
            return R*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
        };

        const candidates = [];
        State.stores.forEach((s, idx) => {
            if (!s.days || s.days.length !== 1) return;
            const cur = s.days[0]; if (!cents[cur]) return;
            const ownDist = distKm(s, cents[cur]);
            let bestDay = null, bestDist = Infinity;
            allDays.forEach(d => {
                if (d === cur || !cents[d]) return;
                const dd = distKm(s, cents[d]);
                if (dd < bestDist) { bestDist = dd; bestDay = d; }
            });
            if (bestDay && bestDist < ownDist * 0.8) candidates.push({ idx, cur, candDay: bestDay });
        });
        if (!candidates.length) return 0;

        let verified = 0;
        for (let ci = 0; ci < candidates.length; ci++) {
            const c = candidates[ci];
            try {
                const s = State.stores[c.idx];
                const own = cents[c.cur], cand = cents[c.candDay];
                const res = await fetch('/api/optimize-route', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        start: { lat: s.lat, lng: s.lng },
                        end: null,
                        jobs: [{ id: 'OWN', lat: own.lat, lng: own.lng }, { id: 'CAND', lat: cand.lat, lng: cand.lng }],
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (data.order && data.order[0] === 'CAND') {
                    s.days = [c.candDay];
                    verified++;
                }
            } catch (e) { /* เช็คร้านนี้ไม่ได้ ข้ามไป ไม่กระทบร้านอื่น */ }
            if (onProgress) onProgress(ci + 1, candidates.length);
        }
        return verified;
    },

    // ✅ NEW (2026-09-05): จัดลำดับการเยี่ยมภายในแต่ละวันให้อัตโนมัติ ต่อจากขั้นจัดกลุ่มเลย
    // (เดิมแอดมินต้องมากดปุ่ม "🧭 จัดลำดับการเยี่ยมอัตโนมัติ" เองทีละวัน — 24 วันก็ต้องกด 24 ครั้ง)
    // ใช้ /api/optimize-route ตัวเดียวกับปุ่มเดิมทุกประการ (ดู App.optimizeDayOrder ใน admin-data.js)
    // เพื่อให้พฤติกรรม/ผลลัพธ์เหมือนกันเป๊ะ ต่างกันแค่ "ใครเป็นคนเรียก" — เขียนผลลง s.seqs[day] เหมือนกัน
    // ต้องมีจุดเริ่มต้นของสาย (ปุ่ม "📍 จุดเริ่ม-จุดจบ") ตั้งไว้ก่อนแล้วเท่านั้น ถ้ายังไม่ตั้ง จะข้ามทั้งหมด
    // แล้วรายงานกลับให้แอดมินรู้ผ่าน toast สุดท้าย (ไม่ทำให้ทั้ง flow ล้มเหลว)
    _sequenceAllDays: async (k, onProgress) => {
        const cfg = (typeof App !== 'undefined' && App.getRouteStartConfig)
            ? App.getRouteStartConfig(State.localActiveRoute)
            : { mode: 'none', point: null };
        if (cfg.mode === 'none' || !cfg.point) return { skipped: true };

        let done = 0, failed = 0;
        for (let d = 1; d <= k; d++) {
            const day = `Day ${d}`;
            if (onProgress) onProgress(d, k, day);

            const stores = State.stores.filter(s => s.days && s.days.includes(day) && !s.inactive
                && typeof s.lat === 'number' && typeof s.lng === 'number' && !isNaN(s.lat) && !isNaN(s.lng));
            if (stores.length < 2) continue; // ไม่ต้องจัดลำดับ (เหมือนเงื่อนไขในปุ่มเดิม)
            if (stores.length > 48) { failed++; continue; } // เกินลิมิตแผนฟรี ORS ต่อ request — ข้าม ให้แอดมินจัดมือ

            try {
                const res = await fetch('/api/optimize-route', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        start: cfg.point,
                        end:   cfg.returnToStart ? cfg.point : null,
                        jobs:  stores.map(s => ({ id: s.id, lat: s.lat, lng: s.lng })),
                    }),
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok && Array.isArray(result.order)) {
                    result.order.forEach((storeId, idx) => {
                        const s = State.stores.find(x => String(x.id) === String(storeId));
                        if (s) { if (!s.seqs) s.seqs = {}; s.seqs[day] = idx + 1; }
                    });
                    done++;
                } else { failed++; }
            } catch (e) { failed++; }
        }
        return { skipped: false, done, failed };
    },

    // ─── Main Calc ──────────────────────────────────────────────────────
    // ✅ CHANGE (2026-09-05): เปลี่ยนเป็น async เพราะต้อง await ขั้นตอนตรวจสอบเส้นทางจริง
    // (_verifyJumpersWithRoad) ก่อนบันทึกจริง
    calc: async (k, lock, limit, mxD) => {
        try {
            State.db.cycleDays = k;
            if (!lock) State.stores.forEach(s => { s.days=[]; s.selected=false; s.seqs={}; });

            const tIdx = [];
            const tgts = State.stores.filter((s, i) => {
                if (!s.days || !s.days.length) { tIdx.push(i); return true; } return false;
            });

            if (!tgts.length) { UI.hideLoader(); return UI.showSaveToast('✅ ไม่มีร้านที่รอจัดสายแล้ว'); }

            const mK = Math.ceil(k / 2);
            if (tgts.length < mK) { UI.hideLoader(); return UI.showErrorToast('⚠️ ร้านน้อยกว่ากลุ่ม แนะนำจัดด้วยมือครับ'); }

            const maxC = Math.ceil(tgts.length / mK); // tight cap → cluster sizes สมดุลตั้งแต่ต้น

            // รัน 3 รอบ K-Means++ เลือกผล WCSS ต่ำสุด
            let bestAsg=null, bestCents=null, bestWCSS=Infinity;
            for (let run = 0; run < 3; run++) {
                let cs = AI._initKMeansPP(tgts, mK), asg = Array(tgts.length).fill(-1);
                for (let it = 0; it < 50; it++) {
                    asg.fill(-1);
                    const cnt = Array(mK).fill(0), dA = [];
                    for (let i=0;i<tgts.length;i++) for (let c=0;c<mK;c++) dA.push({i,c,d:AI._getDist(tgts[i],cs[c])});
                    dA.sort((a,b)=>a.d-b.d);
                    for (const p of dA) if (asg[p.i]===-1&&cnt[p.c]<maxC) { asg[p.i]=p.c; cnt[p.c]++; }
                    for (let i=0;i<tgts.length;i++) if (asg[i]===-1) {
                        let m=0,mc=Infinity; for(let c=0;c<mK;c++) if(cnt[c]<mc){mc=cnt[c];m=c;} asg[i]=m; cnt[m]++;
                    }
                    let sw=true,ls=0;
                    while(sw&&ls<10){sw=false;ls++;
                        for(let i=0;i<tgts.length;i++) for(let j=i+1;j<tgts.length;j++){
                            const ci=asg[i],cj=asg[j]; if(ci===cj) continue;
                            if(AI._getDist(tgts[i],cs[cj])+AI._getDist(tgts[j],cs[ci])<
                               AI._getDist(tgts[i],cs[ci])+AI._getDist(tgts[j],cs[cj])-1e-5)
                                {asg[i]=cj;asg[j]=ci;sw=true;}
                        }
                    }
                    const sa=Array(mK).fill(0).map(()=>({lt:0,ln:0,n:0}));
                    tgts.forEach((s,i)=>{const c=asg[i];sa[c].lt+=s.lat;sa[c].ln+=s.lng;sa[c].n++;});
                    sa.forEach((s,c)=>{if(s.n>0) cs[c]={...cs[c],lat:s.lt/s.n,lng:s.ln/s.n};});
                }
                const w=AI._calcWCSS(tgts,cs,asg);
                if(w<bestWCSS){bestWCSS=w;bestAsg=[...asg];bestCents=[...cs];}
            }

            // จัดวันตามมุมองศา
            let gLat=0,gLng=0; bestCents.forEach(c=>{gLat+=c.lat;gLng+=c.lng;}); gLat/=mK;gLng/=mK;
            const zns=bestCents.map((c,i)=>({i,a:Math.atan2(c.lat-gLat,c.lng-gLng)})).sort((a,b)=>a.a-b.a);
            let drop=0;
            const mSq=Math.pow(mxD/111,2);

            for (let m=0;m<mK;m++){
                const ids=tgts.map((_,i)=>i).filter(i=>bestAsg[i]===zns[m].i);
                if(!ids.length) continue;
                let vIds=[];
                if(limit&&ids.length>1){
                    ids.forEach(i1=>{const ok=ids.some(i2=>i1!==i2&&AI._getDist(tgts[i1],tgts[i2])<=mSq);ok?vIds.push(i1):drop++;});
                } else if(limit&&ids.length===1){drop++;} else {vIds=ids;}
                if(!vIds.length) continue;

                vIds.sort((a,b)=>AI._getDist(tgts[a],{lat:gLat,lng:gLng})-AI._getDist(tgts[b],{lat:gLat,lng:gLng}));
                const f2=vIds.filter(i=>tgts[i].freq===2), f1=vIds.filter(i=>tgts[i].freq!==2);
                const md=Math.ceil(f1.length/2), d1=m+1, d2=m+1+mK, hasPair=d2<=k;
                f1.forEach((id,j)=>{ State.stores[tIdx[id]].days=hasPair?[j<md?`Day ${d1}`:`Day ${d2}`]:[`Day ${d1}`]; });
                f2.forEach(id=>{ State.stores[tIdx[id]].days=hasPair?[`Day ${d1}`,`Day ${d2}`]:[`Day ${d1}`]; });
            }

            UI.setLoaderProgress(18, 'กำลังปรับสมดุลจำนวนร้าน/วัน...');

            // ── Pass 1: Geo-Aware Balance ──
            const bal = AI._balanceDays(k);
            UI.setLoaderProgress(22, 'กำลังแก้ร้านที่จัดผิดกลุ่ม...');

            // ── Pass 2: Fix Jumpers (Voronoi Reassignment) ──
            const fixed = AI._fixJumpers(k);
            UI.setLoaderProgress(26, 'กำลังตรวจสอบเส้นทางจริงของร้านที่ดูโดด...');

            // ── Pass 3: ตรวจสอบร้านโดดที่เหลือด้วยเส้นทางจริง (ยิง API เท่าที่จำเป็น) ──
            let roadVerified = 0;
            try {
                roadVerified = await AI._verifyJumpersWithRoad(k, (i, total) => {
                    UI.setLoaderProgress(26 + (i / total) * 14, `กำลังตรวจสอบเส้นทางจริง ${i}/${total}`);
                });
            } catch (e) { console.warn('[AI] ตรวจสอบเส้นทางจริงไม่สำเร็จ ข้ามขั้นตอนนี้:', e.message); }

            UI.setLoaderProgress(42, 'กำลังปรับให้อยู่ในช่วง 18-30 ร้าน/วัน...');

            // ── Pass 4: บังคับขอบเขตจำนวนร้าน/วัน (18-30) — รันหลังสุดเสมอ ──
            const boundMoved = AI._enforceMinMax(k, AI.MIN_PER_DAY, AI.MAX_PER_DAY);

            // ── Pass 5: จัดลำดับการเยี่ยมภายในแต่ละวันอัตโนมัติ ต่อจากการจัดกลุ่มเลย ──
            // ✅ NEW (2026-09-05): ทำให้ "งานจบที่ AI" — แอดมินไม่ต้องไปกดปุ่ม "🧭 จัดลำดับการเยี่ยมอัตโนมัติ"
            // เองทีละวันอีก 24 ครั้ง (ถ้ายังไม่ได้ตั้งจุดเริ่มต้นของสายไว้ จะข้ามขั้นนี้ไปเงียบๆ แล้วบอกในข้อความสรุปแทน)
            UI.setLoaderProgress(48, 'เตรียมจัดลำดับการเยี่ยมรายวัน...');
            let seqResult = { skipped: true };
            try {
                seqResult = await AI._sequenceAllDays(k, (d, total, day) => {
                    UI.setLoaderProgress(50 + (d / total) * 48, `กำลังจัดลำดับการเยี่ยม วันที่ ${d}/${total}`);
                });
            } catch (e) { console.warn('[AI] จัดลำดับการเยี่ยมอัตโนมัติไม่สำเร็จ:', e.message); }

            UI.setLoaderProgress(100, 'เสร็จสิ้น!');
            MapCtrl.clearRoad(true); UI.hideLoader(); UI.render(); App.saveDB();

            if (limit&&drop===tgts.length) {
                UI.showErrorToast(`⚠️ ตัดร้านโดด (${mxD}กม.) ทิ้งทั้งหมด กรุณาปรับค่า`);
            } else {
                let msg=drop>0?`✨ AI จัดเสร็จ! (ตัดร้านโดด ${drop} ร้าน)`:`✨ AI จัดสำเร็จ!`;
                msg+=` | min:${bal.min} max:${bal.max} avg:${bal.avg}`;
                if (fixed>0) msg+=` | แก้ร้านกระโดด ${fixed} ร้าน`;
                if (roadVerified>0) msg+=` | ยืนยันด้วยเส้นทางจริง ${roadVerified} ร้าน`;
                if (boundMoved>0) msg+=` | ปรับให้อยู่ในช่วง ${AI.MIN_PER_DAY}-${AI.MAX_PER_DAY} ร้าน/วัน ${boundMoved} ครั้ง`;
                if (seqResult.skipped) {
                    msg += ` | ⚠️ ยังไม่ได้จัดลำดับการเยี่ยม (ยังไม่ได้ตั้งจุดเริ่มต้นของสาย — กด "📍 จุดเริ่ม-จุดจบ" แล้วกด AI ใหม่)`;
                } else {
                    msg += ` | จัดลำดับการเยี่ยมอัตโนมัติแล้ว ${seqResult.done}/${k} วัน`;
                    if (seqResult.failed > 0) msg += ` (${seqResult.failed} วันจัดลำดับไม่สำเร็จ — ลองกด "🧭 จัดลำดับการเยี่ยมอัตโนมัติ" ในวันนั้นด้วยมืออีกที)`;
                }
                UI.showSaveToast(msg);

                if (typeof App !== 'undefined' && App.writeAuditLog) {
                    App.writeAuditLog('ai_route_build', {
                        route: State.localActiveRoute, days: k, storeCount: tgts.length,
                        fixedJumpers: fixed, roadVerified, boundMoved,
                        sequencedDays: seqResult.skipped ? 0 : seqResult.done,
                        sequenceSkipped: !!seqResult.skipped,
                    });
                }
            }

        } catch(err) {
            UI.hideLoader(); console.error('AI Error:',err);
            UI.showErrorToast('❌ เกิดข้อผิดพลาด: '+err.message);
        }
    }
};

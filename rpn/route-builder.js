/* ============================================================================
 *  route-builder.js — สร้างสายใหม่ทั้งศูนย์จากศูนย์ (Territory + Day Builder)
 *  ----------------------------------------------------------------------------
 *  โจทย์: ร้าน N ร้าน → S สาย × D วัน โดยบาลานซ์และระยะทางสั้น
 *  ทำงาน 2 ชั้น  (1) แบ่งอาณาเขตให้เซลล์  (2) ซอยอาณาเขตเป็นวัน
 *  ไม่เขียนทับข้อมูลจนกว่าผู้ใช้จะกดรับในหน้าเสนอผล
 * ==========================================================================*/
(function () {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const UNASSIGNED = 'รอจัดสาย';
    const PALETTE = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e','#14b8a6','#06b6d4',
                     '#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e',
                     '#78716c','#0ea5e9','#65a30d','#ca8a04','#dc2626','#7c3aed'];

    // ── ระยะทาง ─────────────────────────────────────────────────────────────
    const hav = (a, b) => {
        const R = 6371, t = Math.PI / 180;
        const dLa = (b.lat - a.lat) * t, dLn = (b.lng - a.lng) * t;
        const s = Math.sin(dLa / 2) ** 2 +
            Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLn / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
    };
    // คืนค่าเป็นกิโลเมตรเสมอ — RoadDist.m() คืนเป็นเมตร
    const km = (a, b) => {
        if (typeof RoadDist !== 'undefined' && RoadDist.m) {
            try { const v = RoadDist.m(a, b); if (isFinite(v)) return v / 1000; } catch (e) {}
        }
        return hav(a, b);
    };

    const RB = {

        // ── ค่าตั้งต้น ──────────────────────────────────────────────────────
        cfg: {
            // routes ไม่เก็บเอง — อ่านจากตัวกรองเดียว (MultiRoute) ผ่าน getter ด้านล่าง
            S: 0, D: 12, cap: 32, markets: 0,
            free: 'markets',       // ช่องที่ปล่อยให้คำนวณ: S | D | cap | markets
            depotMode: 'auto',     // auto | pizza | blob
            keepBase: true,
            nearOld: true,
            f2Half: true,
            cutOutlier: true, outlierKm: 60,
        },
        plan: null,
        _busy: false,

        /** ชุดสายที่จะเข้ากระบวนการ = สายที่ติ๊กไว้ในตัวกรองเดียว */
        get routesSet() { return new Set((typeof MultiRoute !== 'undefined' ? MultiRoute.open : []) || []); },

        // ── ข้อมูลนำเข้า ────────────────────────────────────────────────────
        routeList() {
            const R = State.db.routes || {};
            return Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
        },
        /** สายที่ควรติ๊กเริ่มต้น: สายที่จำนวนร้าน ≥ 40% ของค่ามัธยฐาน (คัดสายพิเศษออก) */
        defaultRoutes() {
            const R = State.db.routes || {};
            const names = RB.routeList().filter(n => n !== UNASSIGNED);
            const ns = names.map(n => (R[n] || []).length).filter(n => n > 0).sort((a, b) => a - b);
            if (!ns.length) return new Set(names);
            const med = ns[Math.floor(ns.length / 2)];
            const keep = names.filter(n => (R[n] || []).length >= med * 0.4);
            keep.push(UNASSIGNED);                        // ร้านใหม่เข้าด้วยเสมอ
            return new Set(keep.filter(n => (R[n] || []).length || n === UNASSIGNED));
        },
        pool() {
            const R = State.db.routes || {};
            const out = [];
            [...RB.routesSet].forEach(n => (R[n] || []).forEach(s => {
                if (s.inactive) return;
                const la = +s.lat, ln = +s.lng;
                if (!la || !ln || isNaN(la) || isNaN(ln)) return;
                out.push({ s, from: n, lat: la, lng: ln, f2: s.freq === 2 });
            }));
            return out;
        },
        /** ร้านที่ตกหล่น (inactive / ไม่มีพิกัด) ในสายที่เลือก */
        skipped() {
            const R = State.db.routes || {};
            let noGeo = 0, inact = 0;
            [...RB.routesSet].forEach(n => (R[n] || []).forEach(s => {
                if (s.inactive) { inact++; return; }
                if (!+s.lat || !+s.lng) noGeo++;
            }));
            return { noGeo, inact };
        },

        // ── คณิตศาสตร์โครงสร้าง ─────────────────────────────────────────────
        /** เติมช่องที่ปล่อยว่างจากอีก 3 ช่อง แล้วคืนผลตรวจความเป็นไปได้ */
        solve() {
            const c = RB.cfg, N = RB.pool().length;
            if (c.free === 'markets') c.markets = Math.max(1, c.S * c.D);
            else if (c.free === 'S')  c.S = Math.max(1, Math.ceil(N / Math.max(1, c.cap * c.D)));
            else if (c.free === 'D')  c.D = Math.max(1, Math.ceil(N / Math.max(1, c.cap * c.S)));
            else if (c.free === 'cap') c.cap = Math.max(1, Math.ceil(N / Math.max(1, c.S * c.D)));
            if (c.free !== 'markets') c.markets = c.S * c.D;

            const visits = RB.pool().reduce((a, p) => a + (p.f2 ? 2 : 1), 0);
            const avg = c.markets ? visits / c.markets : 0;
            const ok  = N > 0 && avg > 0 && avg <= c.cap && c.S >= 1 && c.D >= 2;
            let msg;
            if (!N) msg = 'ยังไม่ได้เลือกสาย หรือสายที่เลือกไม่มีร้านที่มีพิกัด';
            else if (c.D < 2) msg = 'จำนวนวันต่อรอบต้องอย่างน้อย 2 วัน';
            else if (!ok) msg = `เกินเพดาน — ${visits.toLocaleString()} visit ÷ ${c.markets} ตลาด = เฉลี่ย `
                + `${avg.toFixed(1)} เกินเพดาน ${c.cap} · ต้องเพิ่มสาย เพิ่มวัน หรือขยายเพดาน`;
            else msg = `${N.toLocaleString()} ร้าน (${visits.toLocaleString()} visit) ÷ ${c.markets} ตลาด = เฉลี่ย `
                + `${avg.toFixed(1)} visit/ตลาด (เพดาน ${c.cap}) เหลือที่ว่าง ${Math.round((1 - avg / c.cap) * 100)}%`;
            return { ok, msg, N, visits, avg };
        },

        // ── อัลกอริทึมแบ่งกลุ่ม ─────────────────────────────────────────────
        /** แปลงพิกัดเป็นระนาบกิโลเมตร (equirectangular รอบจุดกึ่งกลาง) */
        proj(pts) {
            const la0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
            const ln0 = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
            const kx = 111.32 * Math.cos(la0 * Math.PI / 180), ky = 110.57;
            return { la0, ln0, kx, ky, of: (p) => [(p.lng - ln0) * kx, (p.lat - la0) * ky] };
        },

        /** k-means แบบบังคับจำนวนสมาชิกให้เท่ากัน (capacitated) */
        balanced(X, k, iters, seed, opt) {
            const n = X.length;
            const home = opt && opt.home;                 // home[i] = กลุ่มที่ร้าน i อยู่เดิม (-1 = ไม่มี)
            const loyal = (opt && opt.loyal) || 1;        // <1 = ลดระยะให้กลุ่มเดิม (ยึดของเดิม)
            if (k <= 1) return { lab: new Int32Array(n), C: [[
                X.reduce((a, p) => a + p[0], 0) / n, X.reduce((a, p) => a + p[1], 0) / n]] };
            let s = (seed || 1) >>> 0;
            const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
            // เริ่มจากศูนย์กลางที่กำหนดมา (โหมดใกล้ของเดิม) หรือ k-means++
            if (opt && opt.seedC && opt.seedC.length === k) {
                const C0 = opt.seedC.map(c => c.slice());
                return RB._loop(X, C0, k, iters || 24, home, loyal);
            }
            const C = [X[(rnd() * n) | 0].slice()];
            const d2 = new Float64Array(n).fill(Infinity);
            while (C.length < k) {
                const c = C[C.length - 1];
                let tot = 0;
                for (let i = 0; i < n; i++) {
                    const dx = X[i][0] - c[0], dy = X[i][1] - c[1], d = dx * dx + dy * dy;
                    if (d < d2[i]) d2[i] = d;
                    tot += d2[i];
                }
                let r = rnd() * tot, j = 0;
                while (j < n - 1 && (r -= d2[j]) > 0) j++;
                C.push(X[j].slice());
            }
            return RB._loop(X, C, k, iters || 24, home, loyal);
        },

        _loop(X, C, k, iters, home, loyal) {
            const n = X.length;
            const cap = Math.ceil(n / k);
            const lab = new Int32Array(n).fill(-1);
            const D = new Float64Array(n * k);
            const ord = new Int32Array(n);
            const regret = new Float64Array(n);
            const cnt = new Int32Array(k);
            const rank = new Int32Array(k);
            for (let it = 0; it < iters; it++) {
                for (let i = 0; i < n; i++) {
                    let b0 = Infinity, b1 = Infinity;
                    const h = home ? home[i] : -1;
                    for (let j = 0; j < k; j++) {
                        const dx = X[i][0] - C[j][0], dy = X[i][1] - C[j][1];
                        let d = dx * dx + dy * dy;
                        if (j === h) d *= loyal;
                        D[i * k + j] = d;
                        if (d < b0) { b1 = b0; b0 = d; } else if (d < b1) b1 = d;
                    }
                    regret[i] = b0 - b1;                 // ยิ่งติดลบมาก = ยิ่งต้องได้ที่ที่อยากได้
                    ord[i] = i;
                }
                const oa = Array.from(ord).sort((a, b) => regret[a] - regret[b]);
                cnt.fill(0); lab.fill(-1);
                for (let z = 0; z < n; z++) {
                    const i = oa[z];
                    for (let j = 0; j < k; j++) rank[j] = j;
                    const rk = Array.from(rank).sort((a, b) => D[i * k + a] - D[i * k + b]);
                    for (let q = 0; q < k; q++) {
                        const j = rk[q];
                        if (cnt[j] < cap) { lab[i] = j; cnt[j]++; break; }
                    }
                }
                const sx = new Float64Array(k), sy = new Float64Array(k), sn = new Int32Array(k);
                for (let i = 0; i < n; i++) { const j = lab[i]; sx[j] += X[i][0]; sy[j] += X[i][1]; sn[j]++; }
                let move = 0;
                for (let j = 0; j < k; j++) {
                    if (!sn[j]) continue;
                    const nx = sx[j] / sn[j], ny = sy[j] / sn[j];
                    move += Math.abs(nx - C[j][0]) + Math.abs(ny - C[j][1]);
                    C[j][0] = nx; C[j][1] = ny;
                }
                if (move < 1e-4) break;
            }
            return { lab, C };
        },

        /** โหมดใกล้ของเดิม: เริ่มจากการจัดปัจจุบัน แล้วแก้เฉพาะที่ไม่สมดุล + ขัดขอบ */
        keepMost(X, k, home, passes, gainFactor) {
            const GF = gainFactor == null ? 0.35 : gainFactor;   // สลับเฉพาะคู่ที่ดีขึ้นชัดเจน
            const n = X.length, cap = Math.ceil(n / k);
            const lab = new Int32Array(n).fill(-1);
            const cnt = new Int32Array(k);
            const C = [];
            const cen = () => {
                const sx = new Float64Array(k), sy = new Float64Array(k), sn = new Int32Array(k);
                for (let i = 0; i < n; i++) { const j = lab[i]; if (j < 0) continue; sx[j] += X[i][0]; sy[j] += X[i][1]; sn[j]++; }
                for (let j = 0; j < k; j++) C[j] = sn[j] ? [sx[j] / sn[j], sy[j] / sn[j]] : (C[j] || X[j % n].slice());
            };
            const d2 = (i, j) => { const dx = X[i][0] - C[j][0], dy = X[i][1] - C[j][1]; return dx * dx + dy * dy; };

            for (let i = 0; i < n; i++) if (home[i] >= 0) { lab[i] = home[i]; cnt[home[i]]++; }
            cen();
            // ร้านที่ไม่มีสายเดิม (รอจัดสาย) → กลุ่มใกล้สุดที่ยังไม่เต็ม
            for (let i = 0; i < n; i++) {
                if (lab[i] >= 0) continue;
                let bj = -1, bd = Infinity;
                for (let j = 0; j < k; j++) if (cnt[j] < cap) { const d = d2(i, j); if (d < bd) { bd = d; bj = j; } }
                if (bj < 0) { bj = 0; for (let j = 1; j < k; j++) if (cnt[j] < cnt[bj]) bj = j; }
                lab[i] = bj; cnt[bj]++;
            }
            cen();

            // แก้กลุ่มที่ล้น — ย้ายร้านที่ "อยู่ผิดที่ที่สุด" ออกไปกลุ่มใกล้สุดที่ยังว่าง
            for (let guard = 0; guard < n; guard++) {
                let over = -1;
                for (let j = 0; j < k; j++) if (cnt[j] > cap) { over = j; break; }
                if (over < 0) break;
                let worst = -1, worstGain = -Infinity, worstTo = -1;
                for (let i = 0; i < n; i++) {
                    if (lab[i] !== over) continue;
                    let bj = -1, bd = Infinity;
                    for (let j = 0; j < k; j++) if (j !== over && cnt[j] < cap) { const d = d2(i, j); if (d < bd) { bd = d; bj = j; } }
                    if (bj < 0) continue;
                    const g = d2(i, over) - bd;
                    if (g > worstGain) { worstGain = g; worst = i; worstTo = bj; }
                }
                if (worst < 0) break;
                cnt[lab[worst]]--; lab[worst] = worstTo; cnt[worstTo]++;
            }
            cen();

            // ขัดขอบ — สลับคู่ข้ามกลุ่มเมื่อระยะรวมลดลง (คงจำนวนสมาชิกเท่าเดิม)
            for (let pass = 0; pass < (passes || 4); pass++) {
                const want = new Int32Array(n).fill(-1);
                const bucket = new Map();
                for (let i = 0; i < n; i++) {
                    let bj = lab[i], bd = d2(i, lab[i]);
                    for (let j = 0; j < k; j++) { const d = d2(i, j); if (d < bd) { bd = d; bj = j; } }
                    if (bj === lab[i]) continue;
                    want[i] = bj;
                    const key = lab[i] + '>' + bj;
                    (bucket.get(key) || bucket.set(key, []).get(key)).push(i);
                }
                let done = 0;
                bucket.forEach((list, key) => {
                    const [a, b] = key.split('>').map(Number);
                    const back = bucket.get(b + '>' + a);
                    if (!back || !back.length) return;
                    const m = Math.min(list.length, back.length);
                    for (let t = 0; t < m; t++) {
                        const i = list[t], j = back[t];
                        if (lab[i] !== a || lab[j] !== b) continue;
                        const before = d2(i, a) + d2(j, b), after = d2(i, b) + d2(j, a);
                        if (after >= before * GF) continue;      // ดีขึ้นน้อย = ไม่คุ้มกับการรื้อ
                        lab[i] = b; lab[j] = a; done++;
                    }
                });
                cen();
                if (!done) break;
            }
            return { lab, C };
        },

        /** หั่นเป็นชิ้นพิซซ่ารอบจุดออก จำนวนสมาชิกเท่ากัน */
        pizza(X, k, depot) {
            const n = X.length;
            const ang = new Array(n);
            for (let i = 0; i < n; i++) ang[i] = [Math.atan2(X[i][1] - depot[1], X[i][0] - depot[0]), i];
            ang.sort((a, b) => a[0] - b[0]);
            const lab = new Int32Array(n);
            const base = Math.floor(n / k), extra = n % k;
            let p = 0;
            for (let j = 0; j < k; j++) {
                const take = base + (j < extra ? 1 : 0);
                for (let q = 0; q < take; q++) lab[ang[p + q][1]] = j;
                p += take;
            }
            const C = [];
            for (let j = 0; j < k; j++) {
                let sx = 0, sy = 0, c = 0;
                for (let i = 0; i < n; i++) if (lab[i] === j) { sx += X[i][0]; sy += X[i][1]; c++; }
                C.push(c ? [sx / c, sy / c] : depot.slice());
            }
            return { lab, C };
        },

        /** ระยะเฉลี่ยจากสมาชิกถึงศูนย์กลางกลุ่มตัวเอง — ยิ่งน้อยยิ่งกระชับ */
        compactness(X, lab, C) {
            let tot = 0;
            for (let i = 0; i < X.length; i++) {
                const c = C[lab[i]];
                tot += Math.hypot(X[i][0] - c[0], X[i][1] - c[1]);
            }
            return tot / X.length;
        },

        // ── สร้างแผน ────────────────────────────────────────────────────────
        build() {
            const c = RB.cfg;
            const chk = RB.solve();
            if (!chk.ok) return { error: chk.msg };

            let P = RB.pool();
            if (!P.length) return { error: 'ไม่มีร้านที่มีพิกัดในสายที่เลือก' };

            const pr = RB.proj(P);
            let X = P.map(pr.of);

            // ── คัดร้านหลุดโซน ──
            const outliers = [];
            if (c.cutOutlier) {
                const cx = X.reduce((a, p) => a + p[0], 0) / X.length;
                const cy = X.reduce((a, p) => a + p[1], 0) / X.length;
                const d = X.map(p => Math.hypot(p[0] - cx, p[1] - cy));
                const sorted = [...d].sort((a, b) => a - b);
                const med = sorted[Math.floor(sorted.length / 2)];
                const lim = Math.max(c.outlierKm, med * 3);
                const keepI = [];
                for (let i = 0; i < P.length; i++) {
                    if (d[i] > lim) outliers.push(P[i]); else keepI.push(i);
                }
                if (outliers.length) { P = keepI.map(i => P[i]); X = keepI.map(i => X[i]); }
            }

            // ── จุดออก ──
            let depot = null;
            if (typeof RoadDist !== 'undefined' && RoadDist.depots && RoadDist.depots.length) {
                const d0 = RoadDist.depots[0];
                if (d0 && d0.lat) depot = pr.of(d0);
            }
            if (!depot && c.keepBase && State.db.routeBase) {
                const bs = Object.values(State.db.routeBase).filter(b => b && b.lat);
                if (bs.length) depot = pr.of({ lat: bs[0].lat, lng: bs[0].lng });
            }
            if (!depot) depot = [X.reduce((a, p) => a + p[0], 0) / X.length,
                                 X.reduce((a, p) => a + p[1], 0) / X.length];

            // ── ชั้นที่ 1: อาณาเขต ──
            const S = c.S;
            const origAll = RB.routeList().filter(n => RB.routesSet.has(n) && n !== UNASSIGNED
                                                  && (State.db.routes[n] || []).length);
            // โหมดใกล้ของเดิม: เริ่มนับจากศูนย์กลางของสายเดิม + ลดระยะให้สายเดิมของแต่ละร้าน
            let opt = null, seedNames = null;
            if (c.nearOld && origAll.length === S) {
                seedNames = origAll;
                const oi = new Map(origAll.map((n, i) => [n, i]));
                const sx = new Float64Array(S), sy = new Float64Array(S), sn = new Int32Array(S);
                const home = new Int32Array(P.length).fill(-1);
                P.forEach((p, i) => {
                    const j = oi.get(p.from);
                    if (j === undefined) return;
                    home[i] = j; sx[j] += X[i][0]; sy[j] += X[i][1]; sn[j]++;
                });
                opt = { home };
            }

            let terr, mode = c.depotMode, why = '';
            const blob = () => (opt ? RB.keepMost(X, S, opt.home, 5) : RB.balanced(X, S, 24, 7));
            if (mode === 'auto') {
                const A = RB.pizza(X, S, depot);
                const B = blob();
                const ca = RB.compactness(X, A.lab, A.C), cb = RB.compactness(X, B.lab, B.C);
                if (ca <= cb) { terr = A; mode = 'pizza'; seedNames = null; }
                else { terr = B; mode = 'blob'; }
                why = `ระบบเลือกเอง — ชิ้นพิซซ่า ${ca.toFixed(1)} กม. · ก้อนกระจุก ${cb.toFixed(1)} กม.`;
            } else if (mode === 'pizza') {
                terr = RB.pizza(X, S, depot); seedNames = null;
            } else {
                terr = blob();
            }

            // ── ตั้งชื่อกลุ่มตามสายเดิมที่ทับกันมากที่สุด ──
            if (seedNames) {
                var nameOfSeed = seedNames.slice();
            }
            const orig = origAll;
            const cross = orig.map(() => new Int32Array(S));
            const oi = new Map(orig.map((n, i) => [n, i]));
            P.forEach((p, i) => { const r = oi.get(p.from); if (r !== undefined) cross[r][terr.lab[i]]++; });
            const nameOf = new Array(S).fill(null);
            const usedR = new Set(), usedC = new Set();
            const pairs = [];
            orig.forEach((n, r) => { for (let j = 0; j < S; j++) if (cross[r][j]) pairs.push([cross[r][j], r, j]); });
            pairs.sort((a, b) => b[0] - a[0]);
            pairs.forEach(([, r, j]) => {
                if (usedR.has(r) || usedC.has(j)) return;
                nameOf[j] = orig[r]; usedR.add(r); usedC.add(j);
            });
            if (typeof nameOfSeed !== 'undefined' && nameOfSeed) {
                for (let j = 0; j < S; j++) nameOf[j] = nameOfSeed[j];
            }
            let auto = 1;
            for (let j = 0; j < S; j++) if (!nameOf[j]) {
                let n; do { n = 'สายใหม่ ' + (auto++); } while (nameOf.includes(n) || orig.includes(n));
                nameOf[j] = n;
            }

            // ── ใกล้ของเดิมที่สุด: ดึงร้านตรงรอยต่อกลับสายเดิม ──
            let pulled = 0;
            if (c.nearOld && !seedNames) {
                const idxOf = new Map(nameOf.map((n, j) => [n, j]));
                const capT = Math.ceil(P.length / S);
                const cnt = new Int32Array(S);
                for (let i = 0; i < P.length; i++) cnt[terr.lab[i]]++;
                for (let pass = 0; pass < 3; pass++) {
                    for (let i = 0; i < P.length; i++) {
                        const want = idxOf.get(P[i].from);
                        const cur = terr.lab[i];
                        if (want === undefined || want === cur) continue;
                        if (cnt[want] >= capT) continue;
                        const dc = Math.hypot(X[i][0] - terr.C[cur][0], X[i][1] - terr.C[cur][1]);
                        const dw = Math.hypot(X[i][0] - terr.C[want][0], X[i][1] - terr.C[want][1]);
                        if (dw <= dc * 1.25) { terr.lab[i] = want; cnt[cur]--; cnt[want]++; pulled++; }
                    }
                }
            }

            // ── ชั้นที่ 2: ซอยเป็นวันในแต่ละอาณาเขต ──
            const D = c.D, mK = Math.max(1, Math.ceil(D / 2));
            const assign = new Array(P.length).fill(null);
            const perRoute = [];
            for (let j = 0; j < S; j++) {
                const ids = [];
                for (let i = 0; i < P.length; i++) if (terr.lab[i] === j) ids.push(i);
                const sub = ids.map(i => X[i]);
                const dayOf = new Array(ids.length).fill(null);
                if (!ids.length) { perRoute.push({ name: nameOf[j], i: j, n: 0, days: [], kmTot: 0 }); continue; }

                let g;
                if (c.f2Half && D >= 4) {
                    g = (mode === 'pizza')
                        ? RB.pizza(sub, mK, terr.C[j])
                        : RB.balanced(sub, mK, 20, 11 + j);
                    // กลุ่ม m → วัน m+1 กับ m+1+mK ; F1 แบ่งครึ่ง, F2 เข้าทั้งคู่
                    for (let m = 0; m < mK; m++) {
                        const mem = [];
                        for (let q = 0; q < ids.length; q++) if (g.lab[q] === m) mem.push(q);
                        const f2 = mem.filter(q => P[ids[q]].f2), f1 = mem.filter(q => !P[ids[q]].f2);
                        const d1 = m + 1, d2 = m + 1 + mK;
                        const half = Math.ceil(f1.length / 2);
                        f1.forEach((q, t) => { dayOf[q] = [(t < half || d2 > D) ? d1 : d2]; });
                        f2.forEach(q => { dayOf[q] = d2 <= D ? [d1, d2] : [d1]; });
                    }
                } else {
                    g = (mode === 'pizza') ? RB.pizza(sub, D, terr.C[j]) : RB.balanced(sub, D, 20, 11 + j);
                    for (let q = 0; q < ids.length; q++) dayOf[q] = [g.lab[q] + 1];
                }
                ids.forEach((i, q) => { assign[i] = { r: j, days: dayOf[q].map(d => 'Day ' + d) }; });

                // ── ระยะทางต่อวัน (NN tour) ──
                const base = (c.keepBase && State.db.routeBase && State.db.routeBase[nameOf[j]]
                              && State.db.routeBase[nameOf[j]].lat) ? State.db.routeBase[nameOf[j]] : null;
                const anchor = base || { lat: pr.la0 + terr.C[j][1] / pr.ky, lng: pr.ln0 + terr.C[j][0] / pr.kx };
                const days = [];
                let kmTot = 0;
                for (let d = 1; d <= D; d++) {
                    const lbl = 'Day ' + d;
                    const mem = ids.filter((i, q) => dayOf[q] && dayOf[q].includes(d))
                                   .map(i => P[i]);
                    const tour = RB.nn(mem, anchor);
                    days.push({ d, label: lbl, n: mem.length, km: tour.km, order: tour.order });
                    kmTot += tour.km;
                }
                perRoute.push({ name: nameOf[j], i: j, n: ids.length, days, kmTot, anchor });
            }

            // ── สรุปการย้าย ──
            const movedIn = new Int32Array(S), movedOut = {};
            let moved = 0;
            P.forEach((p, i) => {
                const to = nameOf[assign[i] ? assign[i].r : 0];
                if (p.from !== to) {
                    moved++; movedIn[assign[i].r]++;
                    movedOut[p.from] = (movedOut[p.from] || 0) + 1;
                }
            });
            perRoute.forEach(r => { r.movedIn = movedIn[r.i]; r.movedOut = movedOut[r.name] || 0; });

            // เตือนสายที่ระยะหรือจำนวนผิดปกติ
            const kms = perRoute.filter(r => r.n).map(r => r.kmTot);
            const kmAvg = kms.reduce((a, b) => a + b, 0) / (kms.length || 1);
            perRoute.forEach(r => {
                r.warn = null;
                if (!r.n) r.warn = 'ไม่มีร้าน';
                else if (r.kmTot > kmAvg * 1.3) r.warn = 'ระยะสูง';
                else if (r.days.some(d => d.n > c.cap)) r.warn = 'เกินเพดาน';
            });

            const ns = perRoute.filter(r => r.n).map(r => r.n);
            return {
                // ล็อกชุดสายไว้ตั้งแต่ตอนคำนวณ — ถ้าผู้ใช้ไปเปลี่ยนตัวกรองก่อนกดรับ
                // การเขียนกลับต้องอิงชุดนี้ ไม่ใช่ค่าที่เปลี่ยนไปแล้ว
                routes: [...RB.routesSet],
                S, D, cap: c.cap, mode, why, pulled, moved, outliers,
                P, X, pr, assign, nameOf, perRoute, depot,
                total: P.length,
                kmTotal: perRoute.reduce((a, r) => a + r.kmTot, 0),
                nMin: Math.min(...ns), nMax: Math.max(...ns),
                spread: ns.length ? (Math.max(...ns) - Math.min(...ns)) / (ns.reduce((a, b) => a + b, 0) / ns.length) : 0,
            };
        },

        /** nearest-neighbour + 2-opt เบา ๆ — ใช้ประเมินระยะและตั้งลำดับคิว */
        nn(list, anchor) {
            const n = list.length;
            if (!n) return { km: 0, order: [] };
            const used = new Array(n).fill(false);
            const order = [];
            let cur = anchor, tot = 0;
            for (let z = 0; z < n; z++) {
                let best = -1, bd = Infinity;
                for (let i = 0; i < n; i++) {
                    if (used[i]) continue;
                    const d = km(cur, list[i]);
                    if (d < bd) { bd = d; best = i; }
                }
                used[best] = true; order.push(best); tot += bd; cur = list[best];
            }
            tot += km(cur, anchor);                        // ขากลับ
            return { km: tot, order: order.map(i => list[i]) };
        },
    };

    window.RouteBuilder = RB;
})();

/* ============================================================================
 *  route-builder-ui.js — แผงตั้งค่าในแท็บ 2 + หน้าเสนอผล
 * ==========================================================================*/
(function () {
    'use strict';
    const RB = window.RouteBuilder;
    if (!RB) return;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const UNASSIGNED = 'รอจัดสาย';
    const PALETTE = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e','#14b8a6','#06b6d4',
                     '#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e',
                     '#78716c','#0ea5e9','#65a30d','#ca8a04','#dc2626','#7c3aed'];
    const col = (i) => PALETTE[((i < 0 ? 0 : i) * 7) % PALETTE.length];
    const fmt = (n) => Math.round(n).toLocaleString();

    // ── แผงตั้งค่า ──────────────────────────────────────────────────────────
    const UIx = {
        _picked: new Set(),

        _sig: '', _userPicked: false,
        init(force) {
            const c = RB.cfg;
            const sig = [...RB.routesSet].join('|') + '#'
                + RB.routeList().map(n => (State.db.routes[n] || []).length).join(',');
            if (!force && sig === UIx._sig) return;
            UIx._sig = sig;
            c.S = [...RB.routesSet].filter(n => n !== UNASSIGNED).length || 1;
            c.D = State.db.cycleDays || 12;
            const chk = RB.solve();
            c.cap = Math.max(1, Math.ceil(chk.avg * 1.15));
            RB.solve();
        },

        mount() {
            const tab = document.getElementById('tab2');
            if (!tab) return;
            const sig = RB.routeList().map(n => n + ':' + (State.db.routes[n] || []).length).join('|');
            if (document.getElementById('rb-card')) {
                if (sig !== UIx._sig) UIx.paint();     // สายโหลดครบทีหลัง → ตั้งค่าใหม่
                return;
            }
            UIx.init();
            const box = document.createElement('div');
            box.id = 'rb-card';
            box.className = 'bg-white border-2 border-indigo-200 rounded-2xl p-4 shadow-sm';
            tab.insertBefore(box, tab.firstChild);
            UIx.paint();
        },

        paint() {
            const box = document.getElementById('rb-card');
            if (!box) return;
            UIx.init();
            const c = RB.cfg, chk = RB.solve();
            const sk = RB.skipped();
            const all = RB.routeList();
            const nRoute = [...RB.routesSet].filter(n => n !== UNASSIGNED).length;
            const hasNew = RB.routesSet.has(UNASSIGNED);

            const field = (key, label, val, hint) => `
                <div class="flex items-center gap-2 py-1">
                  <button onclick="RBUI.free('${key}')" title="ปล่อยให้ระบบคำนวณช่องนี้"
                    class="w-6 h-6 rounded-md border text-[11px] shrink-0 ${c.free === key
                      ? 'bg-gray-100 border-gray-200 text-gray-400' : 'bg-indigo-50 border-indigo-200 text-indigo-600'}">
                    ${c.free === key ? '🔓' : '🔒'}</button>
                  <span class="flex-1 text-xs font-bold text-gray-700">${label}${hint
                      ? `<span class="block text-[10px] font-semibold text-gray-400">${hint}</span>` : ''}</span>
                  <input type="number" min="1" value="${val}" ${c.free === key ? 'readonly' : ''}
                    oninput="RBUI.set('${key}', this.value)"
                    class="w-16 text-center font-black text-sm rounded-lg py-1 border ${c.free === key
                      ? 'bg-gray-100 border-dashed border-gray-300 text-gray-500' : 'border-gray-300 text-gray-800 bg-white'}">
                </div>`;

            const sw = (key, t, s) => `
                <button onclick="RBUI.toggle('${key}')"
                  class="w-full flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl mb-1.5 text-left">
                  <span class="flex-1"><b class="block text-[11.5px] font-black text-gray-700">${t}</b>
                    <small class="block text-[10px] text-gray-400 leading-snug">${s}</small></span>
                  <span class="w-9 h-5 rounded-full relative shrink-0 transition ${RB.cfg[key] ? 'bg-indigo-600' : 'bg-gray-300'}">
                    <i class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${RB.cfg[key] ? 'left-4.5' : 'left-0.5'}"
                       style="left:${RB.cfg[key] ? '18px' : '2px'}"></i></span>
                </button>`;

            const dm = (v, ic, t, s) => `
                <button onclick="RBUI.mode('${v}')" class="border-2 rounded-xl px-1 py-2 text-center transition ${
                    c.depotMode === v ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50'}">
                  <span class="block text-base leading-none mb-1">${ic}</span>
                  <b class="block text-[10.5px] font-black ${c.depotMode === v ? 'text-indigo-800' : 'text-gray-600'}">${t}</b>
                  <small class="block text-[9px] font-semibold ${c.depotMode === v ? 'text-indigo-500' : 'text-gray-400'}">${s}</small>
                </button>`;

            box.innerHTML = `
              <h3 class="text-sm font-black text-gray-900 mb-1">🏗️ สร้างสายใหม่ทั้งศูนย์</h3>
              <p class="text-[11px] text-gray-500 leading-relaxed mb-3">แบ่งร้านทั้งหมดออกเป็นสายและวันจากพิกัดจริง —
                กดแล้วจะเสนอผลให้ดูก่อน <b>ยังไม่เขียนทับข้อมูล</b></p>

              <div class="border border-gray-200 rounded-xl p-3 mb-2.5 ${nRoute ? '' : 'border-rose-300 bg-rose-50'}">
                <div class="text-[10px] font-black text-gray-500 uppercase tracking-wide mb-1.5">สายที่จะเข้ากระบวนการ</div>
                <p class="text-[12px] font-bold text-gray-700 leading-snug">
                  ${nRoute ? `ใช้ <b class="text-indigo-700">${nRoute} สาย</b> ที่ติ๊กไว้ในตัวกรอง`
                           : 'ยังไม่ได้ติ๊กสายไหนไว้ในตัวกรอง'}
                  ${hasNew ? '<span class="text-rose-600"> + ร้านที่ยังไม่จัดสาย</span>' : ''}</p>
                <p class="text-[10px] text-gray-400 mt-1 leading-snug truncate">${esc([...RB.routesSet].join(' · ')) || '—'}</p>
                <div class="flex gap-1 mt-2">
                  <button onclick="MultiRoute.openPanel && MultiRoute.openPanel(); RBUI.paint()"
                    class="flex-1 bg-gray-100 hover:bg-gray-200 rounded-md py-1.5 text-[10.5px] font-bold">เปิดตัวกรองเพื่อแก้</button>
                  <button onclick="RBUI.suggest()"
                    class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md py-1.5 text-[10.5px] font-bold">เลือกชุดที่แนะนำ</button>
                </div>
              </div>

              <div class="border border-gray-200 rounded-xl p-3 mb-2.5">
                <div class="text-[10px] font-black text-gray-500 uppercase tracking-wide mb-1">
                  โครงสร้าง — ล็อก 3 ช่อง ช่องที่ 4 คำนวณให้</div>
                ${field('S', 'จำนวนสาย (เซลล์)', c.S)}
                ${field('D', 'จำนวนวันต่อรอบ', c.D)}
                ${field('cap', 'เพดาน visit ต่อตลาด', c.cap)}
                ${field('markets', 'จำนวนตลาด', c.markets, 'สาย × วัน')}
                <div class="mt-2 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed border ${chk.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-rose-50 border-rose-200 text-rose-700'}">
                  ${chk.ok ? '✅ <b>เป็นไปได้</b> — ' : '⚠️ <b>ยังไม่ได้</b> — '}${chk.msg}</div>
                ${(sk.noGeo || sk.inact) ? `<p class="text-[10px] text-amber-600 mt-1.5">⚠️ ข้ามไป
                    ${sk.noGeo ? sk.noGeo + ' ร้านไม่มีพิกัด' : ''}${sk.noGeo && sk.inact ? ' · ' : ''}${sk.inact ? sk.inact + ' ร้าน inactive' : ''}
                    — จะคงอยู่สายเดิม</p>` : ''}
              </div>

              <div class="border border-gray-200 rounded-xl p-3 mb-2.5">
                <div class="text-[10px] font-black text-gray-500 uppercase tracking-wide mb-1.5">จุดออกของเซลล์</div>
                <div class="grid grid-cols-3 gap-1.5 mb-1.5">
                  ${dm('auto', '✨', 'ให้ระบบเลือก', 'ลองทั้งคู่')}
                  ${dm('pizza', '🏭', 'คลังเดียวกัน', 'ชิ้นพิซซ่า')}
                  ${dm('blob', '🏠', 'ฐานตัวเอง', 'ก้อนกระจุก')}
                </div>
                ${sw('keepBase', 'ยึดจุดประจำสายที่ปักไว้', 'สายที่ยังไม่ปัก ระบบหาจุดให้เอง')}
              </div>

              <div class="border border-gray-200 rounded-xl p-3 mb-3">
                <div class="text-[10px] font-black text-gray-500 uppercase tracking-wide mb-1.5">เงื่อนไข</div>
                ${sw('nearOld', 'ใกล้ของเดิมที่สุด', 'พยายามให้ร้านอยู่สายเดิม ย้ายเท่าที่จำเป็น')}
                ${sw('f2Half', 'ร้าน F2 ห่างกันครึ่งรอบ', 'เข้า 2 ครั้งในสายเดียวกัน เช่น วัน 3 กับ วัน 9')}
                ${sw('cutOutlier', 'คัดร้านหลุดโซน', 'ร้านที่ไกลผิดปกติ ส่งไปที่ ' + UNASSIGNED)}
              </div>

              <button onclick="RBUI.run()" ${chk.ok ? '' : 'disabled'}
                class="w-full ${chk.ok ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-300 cursor-not-allowed'}
                       text-white py-3 rounded-xl font-black text-sm shadow-sm transition">
                🏗️ คำนวณและเสนอแผน</button>
              <p class="text-[10px] text-gray-400 text-center mt-1.5">ระบบจะ Save ข้อมูลอัตโนมัติก่อนบันทึกจริงเสมอ</p>`;
        },

        // ── ตัวควบคุม ──
        set(k, v) { const n = parseInt(v); if (!isNaN(n) && n > 0) { RB.cfg[k] = n; RB.solve(); UIx.paint(); } },
        free(k) { RB.cfg.free = k; RB.solve(); UIx.paint(); },
        mode(v) { RB.cfg.depotMode = v; UIx.paint(); },
        toggle(k) { RB.cfg[k] = !RB.cfg[k]; UIx.paint(); },
        /** เลือกชุดสายที่ควรจัดใหม่ให้อัตโนมัติ แล้วสั่งตัวกรองเดียว */
        suggest() {
            const want = [...RB.defaultRoutes()];
            if (!want.length) return UI.showErrorToast('⚠️ ไม่พบสายที่มีร้าน');
            MultiRoute.setOpen(want);
            setTimeout(() => { UIx.init(true); UIx.paint(); }, 300);
        },

        run() {
            if (RB._busy) return;
            RB._busy = true;
            UI.showLoader('กำลังคำนวณแผนใหม่...', 'แบ่งอาณาเขต แล้วซอยเป็นวัน');
            setTimeout(() => {
                let p;
                try { p = RB.build(); }
                catch (e) { console.error('[RouteBuilder]', e); p = { error: e.message }; }
                RB._busy = false; UI.hideLoader();
                if (p.error) return UI.showErrorToast('⚠️ ' + p.error);
                RB.plan = p;
                UIx.showPlan();
            }, 120);
        },

        // ── หน้าเสนอผล ──────────────────────────────────────────────────────
        showPlan() {
            const p = RB.plan;
            document.getElementById('rb-modal')?.remove();
            UIx._sel = new Set();
            const el = document.createElement('div');
            el.id = 'rb-modal';
            el.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:9000;'
                + 'display:flex;align-items:center;justify-content:center;padding:18px;';
            el.innerHTML = `<div style="background:#fff;border-radius:16px;width:100%;max-width:1180px;
                max-height:94vh;display:flex;flex-direction:column;overflow:hidden;
                box-shadow:0 24px 70px rgba(0,0,0,.4)">
              <div style="padding:15px 22px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px">
                <h2 style="font-size:17px;font-weight:900;color:#111827">🏗️ แผนที่ระบบเสนอ</h2>
                <span style="font-size:10.5px;font-weight:800;background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:99px">ยังไม่บันทึก</span>
                <button onclick="RBUI.close()" style="margin-left:auto;width:30px;height:30px;border-radius:50%;
                  border:1px solid #e5e7eb;background:#fff;color:#9ca3af;font-weight:700;cursor:pointer">✕</button>
              </div>
              <div id="rb-kpi"></div>
              <div style="flex:1;overflow:auto;display:grid;grid-template-columns:1fr 380px">
                <div style="padding:14px 20px;border-right:1px solid #e5e7eb"><div id="rb-table"></div></div>
                <div style="padding:14px 18px;background:#f8fafc"><div id="rb-side"></div></div>
              </div>
              <div style="padding:12px 22px;border-top:1px solid #e5e7eb;display:flex;gap:9px;align-items:center">
                <span style="flex:1;font-size:10.5px;color:#9ca3af">ติ๊กสายในตารางเพื่อรับเฉพาะสายนั้น — สายที่ไม่รับจะคงแผนเดิมไว้</span>
                <button onclick="RBUI.close()" style="padding:10px 18px;border-radius:10px;border:1px solid #d1d5db;
                  background:#fff;color:#6b7280;font-weight:800;font-size:12.5px;cursor:pointer">ยกเลิก</button>
                <button id="rb-acc-some" onclick="RBUI.accept(false)" style="padding:10px 18px;border-radius:10px;border:0;
                  background:#eef2ff;color:#4338ca;font-weight:800;font-size:12.5px;cursor:pointer">รับเฉพาะสายที่เลือก (0)</button>
                <button onclick="RBUI.accept(true)" style="padding:10px 20px;border-radius:10px;border:0;
                  background:#4f46e5;color:#fff;font-weight:800;font-size:12.5px;cursor:pointer">✅ รับทั้งหมด</button>
              </div></div>`;
            el.onclick = (e) => { if (e.target === el) UIx.close(); };
            document.body.appendChild(el);
            UIx.paintPlan();
        },
        close() { document.getElementById('rb-modal')?.remove(); },

        paintPlan() {
            const p = RB.plan; if (!p) return;
            const kpi = (k, v, u, d, cls) => `<div style="background:#fff;padding:12px 16px">
                <div style="font-size:10px;font-weight:800;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em">${k}</div>
                <div style="font-size:20px;font-weight:900;color:#111827;line-height:1.15;margin-top:2px">${v}${
                    u ? `<span style="font-size:11px;font-weight:700;color:#6b7280"> ${u}</span>` : ''}</div>
                <div style="font-size:10.5px;font-weight:700;margin-top:1px;color:${cls || '#6b7280'}">${d}</div></div>`;

            document.getElementById('rb-kpi').innerHTML =
                `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#e5e7eb;border-bottom:1px solid #e5e7eb">
                ${kpi('ร้านที่จัดได้', fmt(p.total), '', p.outliers.length
                    ? `คัดออก ${p.outliers.length} ร้านหลุดโซน` : 'ไม่มีร้านหลุดโซน',
                    p.outliers.length ? '#b45309' : '#059669')}
                ${kpi('สาย × วัน', p.S, `× ${p.D} = ${p.S * p.D} ตลาด`,
                    `เฉลี่ย ${(p.total / (p.S * p.D)).toFixed(1)} ร้าน/ตลาด`)}
                ${kpi('ระยะรวมทั้งศูนย์', fmt(p.kmTotal), 'กม.', (() => {
                    const inf = (typeof RoadDist !== 'undefined') ? RoadDist.info : null;
                    if (!inf || inf.coverage == null) return 'ค่าประมาณ — ยังไม่มีตารางถนนของศูนย์นี้';
                    if (inf.coverage < 5) return 'ค่าประมาณ — ตารางถนนไม่ครอบคลุมศูนย์นี้';
                    return `จากตารางถนนจริง ${inf.coverage}%`;
                })())}
                ${kpi('ความสมดุล', '±' + Math.round(p.spread * 50) + '%', '',
                    `ต่ำสุด ${p.nMin} · สูงสุด ${p.nMax}`, p.spread < .15 ? '#059669' : '#b45309')}
                ${kpi('ร้านที่ย้ายสาย', fmt(p.moved), 'ร้าน',
                    Math.round(p.moved / p.total * 100) + '% ของทั้งหมด', p.moved / p.total > .3 ? '#b45309' : '#6b7280')}
                </div>`;

            const th = (t, a) => `<th style="background:#f9fafb;color:#6b7280;font-size:10px;font-weight:800;
                padding:7px 6px;text-align:${a || 'center'};border-bottom:1px solid #e5e7eb;
                text-transform:uppercase;white-space:nowrap">${t}</th>`;
            document.getElementById('rb-table').innerHTML = `
              <div style="font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;
                letter-spacing:.05em;margin-bottom:8px">ผลรายสาย</div>
              <div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:11.5px;min-width:620px">
                <tr>${th('')}${th('สาย', 'left')}${th('ร้าน')}${th('ร้าน/วัน')}${th('กม./รอบ')}${th('กม./วัน')}${th('ย้ายเข้า')}${th('ย้ายออก')}${th('สถานะ')}</tr>
                ${p.perRoute.map(r => {
                    const nd = r.days.filter(d => d.n).length || 1;
                    return `<tr style="background:${r.warn && r.warn !== 'ไม่มีร้าน' ? '#fffbeb' : '#fff'}">
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center">
                        <input type="checkbox" onchange="RBUI.selRoute(${r.i})"></td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace;
                        font-weight:800;color:#111827;white-space:nowrap">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
                          background:${col(r.i)};margin-right:6px"></span>${esc(r.name)}</td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center;font-weight:800;color:#111827">${r.n}</td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center;color:#374151">${Math.round(r.n / nd)}</td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center;color:#059669;font-weight:700">${fmt(r.kmTot)}</td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center;color:#059669;font-weight:700">${fmt(r.kmTot / nd)}</td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center;color:#059669;font-weight:800">${r.movedIn ? '+' + r.movedIn : '—'}</td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center;color:#b45309;font-weight:800">${r.movedOut ? '−' + r.movedOut : '—'}</td>
                      <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:center">${r.warn
                        ? `<span style="font-size:9.5px;font-weight:800;padding:1px 7px;border-radius:99px;
                            background:#fef3c7;color:#92400e">${r.warn}</span>` : '—'}</td></tr>`;
                }).join('')}
              </table></div>`;

            const bar = p.perRoute.filter(r => r.n);
            const tot = bar.reduce((a, r) => a + r.n, 0) || 1;
            document.getElementById('rb-side').innerHTML = `
              <div style="font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;
                letter-spacing:.05em;margin-bottom:8px">แผนที่พรีวิว</div>
              <div style="border:1px solid #e2e8f0;border-radius:12px;background:#eef2f7;overflow:hidden;margin-bottom:11px">
                ${UIx.svg(320, 300)}</div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:10px">
                <div style="font-size:11px;font-weight:800;color:#374151;margin-bottom:6px">วิธีแบ่งที่ใช้</div>
                <p style="font-size:10.5px;color:#6b7280;line-height:1.6">
                  <b style="color:#374151">${p.mode === 'pizza' ? 'ชิ้นพิซซ่าจากคลัง' : 'ก้อนกระจุกตามภูมิศาสตร์'}</b>
                  ${p.why ? '<br>' + esc(p.why) : ''}
                  ${p.pulled ? `<br>ดึงกลับสายเดิม ${fmt(p.pulled)} ร้าน` : ''}</p>
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:10px">
                <div style="font-size:11px;font-weight:800;color:#374151;margin-bottom:6px">ความสมดุลจำนวนร้านต่อสาย</div>
                <div style="height:8px;border-radius:99px;overflow:hidden;display:flex;margin:5px 0 4px">
                  ${bar.map(r => `<i style="display:block;height:100%;background:${col(r.i)};width:${r.n / tot * 100}%"></i>`).join('')}</div>
                <p style="font-size:10.5px;color:#6b7280">ต่ำสุด <b style="color:#374151">${p.nMin}</b>
                  · สูงสุด <b style="color:#374151">${p.nMax}</b> · ต่าง <b style="color:#374151">${(p.spread * 100).toFixed(1)}%</b></p>
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px">
                <div style="font-size:11px;font-weight:800;color:#374151;margin-bottom:6px">ตอนกดรับ จะบันทึกด้วยชื่อ</div>
                <select id="rb-naming" onchange="RBUI.naming()" style="width:100%;font-family:inherit;font-size:11px;
                  font-weight:700;border:1px solid #d1d5db;border-radius:8px;padding:6px 8px;color:#374151;background:#fff">
                  <option value="keep">ทับชื่อสายเดิม (${esc(p.perRoute.slice(0, 2).map(r => r.name).join(', '))}, …)</option>
                  <option value="new">สร้างชุดใหม่จาก prefix…</option>
                </select>
                <input id="rb-prefix" placeholder="เช่น 501N" oninput="RBUI.naming()" style="display:none;width:100%;
                  box-sizing:border-box;margin-top:6px;font-family:inherit;font-size:11px;font-weight:700;
                  border:1px solid #d1d5db;border-radius:8px;padding:6px 8px">
                <p style="font-size:10px;color:#9ca3af;margin-top:7px;line-height:1.55">
                  Save ข้อมูลอัตโนมัติก่อนบันทึกเสมอ กู้กลับได้ด้วยปุ่ม Restore</p>
              </div>`;
            UIx.selCount();
        },

        svg(w, h) {
            const p = RB.plan;
            const xs = p.X.map(v => v[0]), ys = p.X.map(v => v[1]);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            const sc = Math.min((w - 16) / Math.max(1e-6, x1 - x0), (h - 16) / Math.max(1e-6, y1 - y0));
            const ox = (w - (x1 - x0) * sc) / 2, oy = (h - (y1 - y0) * sc) / 2;
            const px = (v) => (ox + (v[0] - x0) * sc).toFixed(1);
            const py = (v) => (h - oy - (v[1] - y0) * sc).toFixed(1);
            let s = '';
            for (let i = 0; i < p.X.length; i += (p.X.length > 4000 ? 2 : 1)) {
                const a = p.assign[i]; if (!a) continue;
                s += `<circle cx="${px(p.X[i])}" cy="${py(p.X[i])}" r="1.9" fill="${col(a.r)}" opacity=".85"/>`;
            }
            if (p.depot) s += `<circle cx="${px(p.depot)}" cy="${py(p.depot)}" r="6" fill="#0f172a" stroke="#fff" stroke-width="2"/>`;
            return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}">${s}</svg>`;
        },

        _sel: new Set(),
        selRoute(i) { UIx._sel.has(i) ? UIx._sel.delete(i) : UIx._sel.add(i); UIx.selCount(); },
        selCount() {
            const b = document.getElementById('rb-acc-some');
            if (b) b.textContent = `รับเฉพาะสายที่เลือก (${UIx._sel.size})`;
        },
        naming() {
            const m = document.getElementById('rb-naming').value;
            document.getElementById('rb-prefix').style.display = m === 'new' ? 'block' : 'none';
        },

        // ── รับแผน ──────────────────────────────────────────────────────────
        async accept(all) {
            const p = RB.plan; if (!p) return;
            const take = all ? p.perRoute.map(r => r.i) : [...UIx._sel];
            if (!take.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกสาย');

            const mode = document.getElementById('rb-naming')?.value || 'keep';
            const prefix = (document.getElementById('rb-prefix')?.value || '').trim();
            if (mode === 'new' && !prefix) return UI.showErrorToast('⚠️ ใส่ prefix ก่อน');
            const finalName = (r) => {
                if (mode !== 'new') return r.name;
                return prefix + String(take.indexOf(r.i) + 1).padStart(2, '0');
            };

            const n = take.length;
            UI.showConfirm(
                `รับแผนใหม่ ${n} สาย?\n\nร้านในสายเหล่านี้จะถูกจัดใหม่ทั้งหมด (สาย วัน และลำดับคิว)\n` +
                `ระบบจะ Save ไฟล์สำรองให้อัตโนมัติก่อน`,
                async () => {
                    try {
                        UI.showLoader('กำลังบันทึกแผนใหม่...', 'สำรองข้อมูลก่อน');
                        try { if (window.LocalExtras && LocalExtras.backup) await LocalExtras.backup(); } catch (e) {}
                        await new Promise(r => setTimeout(r, 400));
                        UIx.apply(take, finalName);
                    } catch (e) {
                        UI.hideLoader(); console.error('[RouteBuilder] apply', e);
                        UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + e.message);
                    }
                });
        },

        apply(take, finalName) {
            const p = RB.plan;
            const R = State.db.routes || (State.db.routes = {});
            const takeSet = new Set(take);
            const scope = p.routes || [...RB.routesSet];      // ชุดสายที่ล็อกไว้ตอนคำนวณ

            // ร้านทุกตัวที่อยู่ในกลุ่มที่รับ ต้องถูกถอดออกจากสายเดิมก่อน
            const moving = [];
            p.P.forEach((pt, i) => {
                const a = p.assign[i];
                if (a && takeSet.has(a.r)) moving.push({ pt, a });
            });
            const movingIds = new Set(moving.map(m => m.pt.s.id));

            // ถอดออกจากทุกสายที่เข้ากระบวนการ
            scope.forEach(nm => {
                if (!Array.isArray(R[nm])) return;
                R[nm] = R[nm].filter(s => !movingIds.has(s.id));
            });

            // ร้านหลุดโซน → รอจัดสาย
            if (p.outliers.length) {
                if (!Array.isArray(R[UNASSIGNED])) R[UNASSIGNED] = [];
                const oid = new Set(p.outliers.map(o => o.s.id));
                scope.forEach(nm => {
                    if (!Array.isArray(R[nm]) || nm === UNASSIGNED) return;
                    R[nm] = R[nm].filter(s => !oid.has(s.id));
                });
                p.outliers.forEach(o => {
                    const s = o.s;
                    s.days = []; s.seqs = {}; s.cys = {}; s.cy = ''; s.selected = false;
                    if (!R[UNASSIGNED].some(x => x.id === s.id)) R[UNASSIGNED].push(s);
                });
            }

            // ใส่กลับตามแผนใหม่
            const touched = new Set();
            take.forEach(ri => {
                const r = p.perRoute.find(x => x.i === ri);
                const nm = finalName(r);
                touched.add(nm);
                if (!Array.isArray(R[nm])) R[nm] = [];
            });
            moving.forEach(({ pt, a }) => {
                const r = p.perRoute.find(x => x.i === a.r);
                const nm = finalName(r);
                const s = pt.s;
                s.days = a.days.slice();
                s.seqs = {}; s.cys = {}; s.cy = ''; s.selected = false;
                s.route = nm;
                R[nm].push(s);
            });

            // ลำดับคิวจาก NN tour
            take.forEach(ri => {
                const r = p.perRoute.find(x => x.i === ri);
                const nm = finalName(r);
                r.days.forEach(d => {
                    d.order.forEach((pt, k) => {
                        const s = pt.s;
                        if (!s.seqs) s.seqs = {};
                        s.seqs[d.label] = k + 1;
                    });
                });
            });

            // ลบสายเดิมที่กลายเป็นว่างเปล่า (กรณีตั้งชื่อชุดใหม่)
            const empties = [];
            scope.forEach(nm => {
                if (nm === UNASSIGNED || touched.has(nm)) return;
                if (Array.isArray(R[nm]) && R[nm].length === 0) { delete R[nm]; empties.push(nm); }
            });

            State.db.cycleDays = p.D;
            State.db.routeList = Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            if (!R[State.localActiveRoute]) State.localActiveRoute = State.db.routeList[0];
            State.stores = R[State.localActiveRoute] || [];

            // บันทึกทุกสายที่แตะ
            const ym = App._currentPlanYM;
            const writes = [...new Set([...touched, ...scope])]
                .filter(nm => Array.isArray(R[nm]))
                .map(nm => App.planRoutesCol(ym).doc(nm).set({
                    stores: R[nm],
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                }, { merge: true }));
            empties.forEach(nm => writes.push(App.planRoutesCol(ym).doc(nm).delete()));
            writes.push(App.planRef(ym).set({
                routeList: State.db.routeList, cycleDays: p.D,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true }));

            Promise.all(writes).then(async () => {
                // ตลาดที่เพิ่งสร้างยังไม่มี Cycle Code — ออกเลขให้ทันที
                // ไม่งั้นการ์ดระยะ Master และไฟล์ Export จะมีช่อง CY ว่าง
                if (typeof CycleCode !== 'undefined' && CycleCode.ensureCurrent) {
                    try { await CycleCode.ensureCurrent(); } catch (e) { console.warn('[RouteBuilder] CY', e); }
                }
                UI.hideLoader(); UIx.close();
                if (window.MultiRoute && MultiRoute.setOpen) MultiRoute.setOpen([...touched]);
                App.sync(); UI.render();
                if (MapCtrl && MapCtrl.fitToStores) MapCtrl.fitToStores();
                UI.showSaveToast(`✅ รับแผนใหม่ ${touched.size} สาย · ย้าย ${fmt(moving.length)} ร้าน`
                    + (p.outliers.length ? ` · ส่ง ${p.outliers.length} ร้านหลุดโซนไป ${UNASSIGNED}` : ''));
                UIx.paint();
            }).catch(err => {
                UI.hideLoader(); console.error('[RouteBuilder] save', err);
                UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + err.message);
            });
        },
    };

    window.RBUI = UIx;

    // ── ติดตั้งแผงเข้าไปในแท็บ 2 ────────────────────────────────────────────
    const boot = () => {
        if (typeof State === 'undefined' || typeof UI === 'undefined' || !UI.render) return setTimeout(boot, 400);
        const origRender = UI.render;
        UI.render = function () {
            const r = origRender.apply(this, arguments);
            try { UIx.mount(); } catch (e) { console.warn('[RouteBuilder]', e); }
            return r;
        };
        setTimeout(() => { try { UIx.mount(); } catch (e) {} }, 900);
    };
    boot();
})();

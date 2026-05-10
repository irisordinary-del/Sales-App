// ==========================================
// 🤖 AI Route Builder (K-Means++ + Geo-Aware Balance)
// ==========================================
const AI = {
    run: () => {
        if (!State || !State.stores) {
            return UI.showErrorToast('⚠️ ระบบยังโหลดข้อมูลไม่เสร็จ กรุณารอสักครู่');
        }
        if (State.stores.length === 0) {
            return UI.showErrorToast('⚠️ ยังไม่มีข้อมูลร้านค้า กรุณาอัปโหลดไฟล์พิกัดก่อน');
        }

        const elDays  = document.getElementById('ai-days');
        const elLock  = document.getElementById('ai-lock');
        const elLimit = document.getElementById('ai-outlier');
        const elDist  = document.getElementById('ai-dist');

        if (!elDays || !elLock || !elLimit || !elDist) {
            return UI.showErrorToast('❌ เกิดข้อผิดพลาด: หาปุ่มตั้งค่า AI ไม่เจอ');
        }

        const k     = parseInt(elDays.value);
        const lock  = elLock.checked;
        const limit = elLimit.checked;
        const mxD   = parseFloat(elDist.value);

        if (isNaN(k) || k < 2) {
            return UI.showErrorToast('⚠️ จำนวนวันต้องมีอย่างน้อย 2 วัน');
        }

        const hasAssigned = State.stores.some(s => s.days && s.days.length > 0);
        if (hasAssigned && !lock) {
            UI.showConfirm(
                "⚠️ มีร้านที่ถูกจัดสายไว้แล้ว!\nยืนยันที่จะล้างข้อมูลสายเดิมทั้งหมด แล้วให้ AI จัดใหม่ไหมครับ?",
                () => {
                    UI.showLoader('AI กำลังวิเคราะห์พื้นที่...', 'กำลังจับกลุ่มร้านค้าที่อยู่ใกล้กัน');
                    setTimeout(() => { AI.calc(k, lock, limit, mxD); }, 150);
                }
            );
            return;
        }

        UI.showLoader('AI กำลังวิเคราะห์พื้นที่...', 'กำลังจับกลุ่มร้านค้าที่อยู่ใกล้กัน');
        setTimeout(() => { AI.calc(k, lock, limit, mxD); }, 150);
    },

    // K-Means++ initialization
    _initKMeansPP: (points, numClusters) => {
        if (points.length === 0) return [];
        const cents = [points[Math.floor(Math.random() * points.length)]];
        while (cents.length < numClusters) {
            const dists = points.map(p => {
                let minD = Infinity;
                for (const c of cents) { const d = StoreMgr.getDistSq(p, c); if (d < minD) minD = d; }
                return minD;
            });
            const total = dists.reduce((a, b) => a + b, 0);
            if (total === 0) { cents.push(points[Math.floor(Math.random() * points.length)]); continue; }
            let r = Math.random() * total, chosen = points[points.length - 1];
            for (let i = 0; i < points.length; i++) { r -= dists[i]; if (r <= 0) { chosen = points[i]; break; } }
            cents.push(chosen);
        }
        return cents;
    },

    _calcWCSS: (points, cents, asg) => {
        let wcss = 0;
        for (let i = 0; i < points.length; i++) {
            if (asg[i] >= 0) wcss += StoreMgr.getDistSq(points[i], cents[asg[i]]);
        }
        return wcss;
    },

    // ✅ Geo-Aware Day Balance
    // ย้ายเฉพาะร้าน "borderline" — ร้านที่อยู่ใกล้ปลายทาง ≤ 1.5x เทียบกับต้นทาง
    // → คลัสเตอร์ยังคงอยู่ครบ, แค่ปรับขอบๆ ระหว่างโซนที่ติดกัน
    _balanceDays: (k) => {
        const TOLERANCE   = 5;    // ยอมรับ max − min ≤ 10 (±5)
        const MAX_ITER    = 400;
        const GEO_RATIO   = 1.5;  // ร้านต้องอยู่ใกล้ปลายทาง ≤ 1.5× ระยะห่างจากต้นทาง

        // สร้าง map วัน → [store indices] (เฉพาะ f1)
        const dayStores = {};
        for (let d = 1; d <= k; d++) dayStores[`Day ${d}`] = [];
        State.stores.forEach((s, idx) => {
            if (!s.days || s.days.length !== 1) return;
            const d = s.days[0];
            if (dayStores[d] !== undefined) dayStores[d].push(idx);
        });

        const allDays = Object.keys(dayStores);
        const dayCount = {};
        allDays.forEach(d => { dayCount[d] = dayStores[d].length; });

        const calcCentroid = (dayKey) => {
            const idxs = dayStores[dayKey];
            if (!idxs.length) return null;
            return {
                lat: idxs.reduce((s, i) => s + State.stores[i].lat, 0) / idxs.length,
                lng: idxs.reduce((s, i) => s + State.stores[i].lng, 0) / idxs.length
            };
        };

        const dayCentroids = {};
        allDays.forEach(d => { dayCentroids[d] = calcCentroid(d); });

        let stuckCount = 0;
        const MAX_STUCK = k * 3;

        for (let iter = 0; iter < MAX_ITER; iter++) {
            // เรียงวันจากมาก→น้อย และน้อย→มาก
            const byDesc = [...allDays].sort((a, b) => dayCount[b] - dayCount[a]);
            const byAsc  = [...allDays].sort((a, b) => dayCount[a] - dayCount[b]);

            if (dayCount[byDesc[0]] - dayCount[byAsc[0]] <= TOLERANCE * 2) break;

            let moved = false;

            // ลองทุกคู่ (over, under) โดยเริ่มจากคู่ที่ต่างกันมากสุด
            outer:
            for (const overDay of byDesc) {
                for (const underDay of byAsc) {
                    if (overDay === underDay) continue;
                    if (dayCount[overDay] - dayCount[underDay] <= TOLERANCE * 2) break outer;

                    const overCent  = dayCentroids[overDay];
                    const underCent = dayCentroids[underDay];
                    if (!overCent || !underCent) continue;

                    // ✅ Borderline check: ร้านต้องอยู่ใกล้ underDay ไม่เกิน GEO_RATIO × ระยะห่างจาก overDay
                    const validCandidates = dayStores[overDay].filter(idx => {
                        const s = State.stores[idx];
                        const dToOver  = StoreMgr.getDistSq(s, overCent);
                        const dToUnder = StoreMgr.getDistSq(s, underCent);
                        // ย้ายได้ถ้าร้านอยู่ใกล้ underDay ไม่เกิน GEO_RATIO เท่าของระยะห่างจาก overDay
                        return dToUnder <= dToOver * GEO_RATIO * GEO_RATIO;
                    });

                    if (!validCandidates.length) continue;

                    // หาร้านที่ใกล้ underDay มากที่สุดในบรรดา borderline stores
                    let bestIdx = validCandidates[0];
                    let bestDist = Infinity;
                    validCandidates.forEach(idx => {
                        const d = StoreMgr.getDistSq(State.stores[idx], underCent);
                        if (d < bestDist) { bestDist = d; bestIdx = idx; }
                    });

                    // ย้าย
                    State.stores[bestIdx].days = [underDay];
                    dayStores[overDay]  = dayStores[overDay].filter(x => x !== bestIdx);
                    dayStores[underDay].push(bestIdx);
                    dayCount[overDay]--;
                    dayCount[underDay]++;
                    dayCentroids[underDay] = calcCentroid(underDay);
                    moved = true;
                    stuckCount = 0;
                    break outer;
                }
            }

            if (!moved) {
                stuckCount++;
                if (stuckCount >= MAX_STUCK) break;
            }
        }

        const counts = allDays.map(d => dayCount[d]).filter(c => c > 0);
        return {
            max: Math.max(...counts),
            min: Math.min(...counts),
            avg: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length)
        };
    },

    calc: (k, lock, limit, mxD) => {
        try {
            State.db.cycleDays = k;

            if (!lock) {
                State.stores.forEach(s => { s.days = []; s.selected = false; s.seqs = {}; });
            }

            const tIdx = [];
            const tgts = State.stores.filter((s, i) => {
                if (!s.days || s.days.length === 0) { tIdx.push(i); return true; }
                return false;
            });

            if (tgts.length === 0) {
                UI.hideLoader();
                return UI.showSaveToast('✅ ไม่มีร้านที่รอจัดสายแล้วครับ');
            }

            const mK = Math.ceil(k / 2);
            if (tgts.length < mK) {
                UI.hideLoader();
                return UI.showErrorToast('⚠️ จำนวนร้านค้าน้อยกว่าจำนวนกลุ่ม แนะนำให้จัดสายด้วยมือครับ');
            }

            // ✅ ใช้ maxC ที่แน่นขึ้น (ไม่มี +1 buffer) → cluster sizes สมดุลตั้งแต่ต้น
            const maxC = Math.ceil(tgts.length / mK);

            // รัน 3 รอบ เลือกผลดีที่สุด (WCSS ต่ำสุด)
            let bestAsg = null, bestCents = null, bestWCSS = Infinity;
            for (let run = 0; run < 3; run++) {
                let cents = AI._initKMeansPP(tgts, mK);
                let asg   = Array(tgts.length).fill(-1);

                for (let iter = 0; iter < 50; iter++) {
                    asg.fill(-1);
                    const cnt  = Array(mK).fill(0);
                    const dArr = [];
                    for (let i = 0; i < tgts.length; i++) {
                        for (let c = 0; c < mK; c++) {
                            dArr.push({ i, c, d: StoreMgr.getDistSq(tgts[i], cents[c]) });
                        }
                    }
                    dArr.sort((a, b) => a.d - b.d);
                    for (const p of dArr) {
                        if (asg[p.i] === -1 && cnt[p.c] < maxC) { asg[p.i] = p.c; cnt[p.c]++; }
                    }
                    for (let i = 0; i < tgts.length; i++) {
                        if (asg[i] === -1) {
                            let m = 0, mc = Infinity;
                            for (let c = 0; c < mK; c++) { if (cnt[c] < mc) { mc = cnt[c]; m = c; } }
                            asg[i] = m; cnt[m]++;
                        }
                    }
                    let swp = true, ls = 0;
                    while (swp && ls < 10) {
                        swp = false; ls++;
                        for (let i = 0; i < tgts.length; i++) {
                            for (let j = i + 1; j < tgts.length; j++) {
                                const cI = asg[i], cJ = asg[j];
                                if (cI === cJ) continue;
                                if (StoreMgr.getDistSq(tgts[i], cents[cJ]) + StoreMgr.getDistSq(tgts[j], cents[cI]) <
                                    StoreMgr.getDistSq(tgts[i], cents[cI]) + StoreMgr.getDistSq(tgts[j], cents[cJ]) - 0.00001) {
                                    asg[i] = cJ; asg[j] = cI; swp = true;
                                }
                            }
                        }
                    }
                    const sArr = Array(mK).fill(0).map(() => ({ lt: 0, ln: 0, n: 0 }));
                    tgts.forEach((s, i) => { const c = asg[i]; sArr[c].lt += s.lat; sArr[c].ln += s.lng; sArr[c].n++; });
                    sArr.forEach((s, c) => { if (s.n > 0) cents[c] = { ...cents[c], lat: s.lt / s.n, lng: s.ln / s.n }; });
                }

                const wcss = AI._calcWCSS(tgts, cents, asg);
                if (wcss < bestWCSS) { bestWCSS = wcss; bestAsg = [...asg]; bestCents = [...cents]; }
            }

            // จัดวันตามมุมองศา
            let gLat = 0, gLng = 0;
            bestCents.forEach(c => { gLat += c.lat; gLng += c.lng; });
            gLat /= mK; gLng /= mK;

            const zns = bestCents
                .map((c, i) => ({ i, a: Math.atan2(c.lat - gLat, c.lng - gLng) }))
                .sort((a, b) => a.a - b.a);

            let drop = 0;
            const mSq = Math.pow(mxD / 111, 2);

            for (let m = 0; m < mK; m++) {
                const ids = tgts.map((_, i) => i).filter(i => bestAsg[i] === zns[m].i);
                if (!ids.length) continue;

                let vIds = [];
                if (limit && ids.length > 1) {
                    ids.forEach(i1 => {
                        const hs = ids.some(i2 => i1 !== i2 && StoreMgr.getDistSq(tgts[i1], tgts[i2]) <= mSq);
                        if (hs) vIds.push(i1); else drop++;
                    });
                } else if (limit && ids.length === 1) {
                    drop++;
                } else {
                    vIds = ids;
                }
                if (!vIds.length) continue;

                vIds.sort((a, b) =>
                    StoreMgr.getDistSq(tgts[a], { lat: gLat, lng: gLng }) -
                    StoreMgr.getDistSq(tgts[b], { lat: gLat, lng: gLng })
                );

                const f2  = vIds.filter(i => tgts[i].freq === 2);
                const f1  = vIds.filter(i => tgts[i].freq !== 2);
                const md  = Math.ceil(f1.length / 2);
                const day1 = m + 1, day2 = m + 1 + mK;
                const hasPair = day2 <= k;

                f1.forEach((id, j) => {
                    State.stores[tIdx[id]].days = hasPair
                        ? [j < md ? `Day ${day1}` : `Day ${day2}`]
                        : [`Day ${day1}`];
                });
                f2.forEach(id => {
                    State.stores[tIdx[id]].days = hasPair
                        ? [`Day ${day1}`, `Day ${day2}`]
                        : [`Day ${day1}`];
                });
            }

            // ✅ Geo-Aware Balance: ปรับเฉพาะร้านขอบโซน ไม่ข้ามคลัสเตอร์
            const stats = AI._balanceDays(k);

            MapCtrl.clearRoad(true);
            UI.hideLoader();
            UI.render();
            App.saveDB();

            if (limit && drop === tgts.length) {
                UI.showErrorToast(`⚠️ AI จัดสายไม่ได้เลย เงื่อนไข "ตัดร้านโดด (${mxD}กม.)" ตัดทิ้งทั้งหมด`);
            } else {
                let msg = drop > 0
                    ? `✨ AI จัดเสร็จ! (ตัดร้านโดด ${drop} ร้าน)`
                    : `✨ AI จัดโซนสำเร็จ!`;
                msg += ` | min:${stats.min} max:${stats.max} avg:${stats.avg} ร้าน/วัน`;
                UI.showSaveToast(msg);
            }

        } catch (err) {
            UI.hideLoader();
            console.error('AI Error:', err);
            UI.showErrorToast('❌ เกิดข้อผิดพลาด: ' + err.message);
        }
    }
};

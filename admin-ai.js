// ==========================================
// 🤖 AI Route Builder (K-Means++ + Day Balance)
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

        // ✅ รองรับทั้งเลขคู่และเลขคี่
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

    // ✅ K-Means++ initialization
    _initKMeansPP: (points, numClusters) => {
        if (points.length === 0) return [];
        const cents = [points[Math.floor(Math.random() * points.length)]];
        while (cents.length < numClusters) {
            const dists = points.map(p => {
                let minD = Infinity;
                for (const c of cents) {
                    const d = StoreMgr.getDistSq(p, c);
                    if (d < minD) minD = d;
                }
                return minD;
            });
            const total = dists.reduce((a, b) => a + b, 0);
            if (total === 0) { cents.push(points[Math.floor(Math.random() * points.length)]); continue; }
            let r = Math.random() * total;
            let chosen = points[points.length - 1];
            for (let i = 0; i < points.length; i++) {
                r -= dists[i];
                if (r <= 0) { chosen = points[i]; break; }
            }
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

    // ✅ Day Balance Pass: ปรับจำนวนร้านแต่ละวันให้ใกล้เคียงกัน (±5)
    _balanceDays: (k) => {
        const TOLERANCE = 5;      // ยอมรับ max - min <= 10 (±5)
        const MAX_ITER  = 500;    // จำกัด loop ป้องกัน infinite

        // สร้าง map: วัน → [store indices ที่เป็น f1 เท่านั้น]
        const dayStores = {};
        for (let d = 1; d <= k; d++) dayStores[`Day ${d}`] = [];

        State.stores.forEach((s, idx) => {
            if (!s.days || s.days.length !== 1) return; // ข้าม f2 และยังไม่จัด
            const d = s.days[0];
            if (dayStores[d] !== undefined) dayStores[d].push(idx);
        });

        // นับจำนวนต่อวัน
        const dayCount = {};
        for (let d = 1; d <= k; d++) {
            const key = `Day ${d}`;
            dayCount[key] = dayStores[key].length;
        }

        // คำนวณ centroid แต่ละวัน (จาก lat/lng เฉลี่ยของร้านในวันนั้น)
        const calcCentroid = (dayKey) => {
            const idxs = dayStores[dayKey];
            if (!idxs.length) return null;
            return {
                lat: idxs.reduce((s, i) => s + State.stores[i].lat, 0) / idxs.length,
                lng: idxs.reduce((s, i) => s + State.stores[i].lng, 0) / idxs.length
            };
        };

        const dayCentroids = {};
        for (let d = 1; d <= k; d++) {
            const key = `Day ${d}`;
            dayCentroids[key] = calcCentroid(key);
        }

        const allDays = Object.keys(dayCount);

        for (let iter = 0; iter < MAX_ITER; iter++) {
            // หาวันที่มีมากสุดและน้อยสุด
            const maxDay = allDays.reduce((a, b) => dayCount[a] > dayCount[b] ? a : b);
            const minDay = allDays.reduce((a, b) => dayCount[a] < dayCount[b] ? a : b);

            if (dayCount[maxDay] - dayCount[minDay] <= TOLERANCE * 2) break; // สมดุลแล้ว

            const candidates = dayStores[maxDay];
            if (!candidates.length) break;

            const minCent = dayCentroids[minDay];
            if (!minCent) break;

            // หาร้านใน maxDay ที่ใกล้ centroid ของ minDay มากที่สุด
            let bestIdx = candidates[0];
            let bestDist = Infinity;
            candidates.forEach(idx => {
                const d = StoreMgr.getDistSq(State.stores[idx], minCent);
                if (d < bestDist) { bestDist = d; bestIdx = idx; }
            });

            // ย้ายร้านจาก maxDay → minDay
            State.stores[bestIdx].days = [minDay];
            dayStores[maxDay] = dayStores[maxDay].filter(x => x !== bestIdx);
            dayStores[minDay].push(bestIdx);
            dayCount[maxDay]--;
            dayCount[minDay]++;

            // อัปเดต centroid ของ minDay
            dayCentroids[minDay] = calcCentroid(minDay);
        }

        // คืน stats สรุป
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

            const maxC = Math.ceil(tgts.length / mK) + 1;

            // รัน 3 รอบ เลือกผลดีที่สุด
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
                    // Swap optimization (10 รอบ)
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
                    // อัปเดต centroids
                    const sArr = Array(mK).fill(0).map(() => ({ lt: 0, ln: 0, n: 0 }));
                    tgts.forEach((s, i) => { const c = asg[i]; sArr[c].lt += s.lat; sArr[c].ln += s.lng; sArr[c].n++; });
                    sArr.forEach((s, c) => { if (s.n > 0) cents[c] = { ...cents[c], lat: s.lt / s.n, lng: s.ln / s.n }; });
                }

                const wcss = AI._calcWCSS(tgts, cents, asg);
                if (wcss < bestWCSS) { bestWCSS = wcss; bestAsg = [...asg]; bestCents = [...cents]; }
            }

            // จัดลงวันตามมุมองศา
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

                const day1 = m + 1;
                const day2 = m + 1 + mK;
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

            // ✅ Balance Pass: ปรับจำนวนร้านแต่ละวันให้สมดุล (±5)
            UI.showLoader('AI กำลังปรับสมดุล...', 'จัดวันให้บาลานซ์ใกล้เคียงกัน');
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
                msg += ` | วัน min:${stats.min} max:${stats.max} avg:${stats.avg} ร้าน`;
                UI.showSaveToast(msg);
            }

        } catch (err) {
            UI.hideLoader();
            console.error('AI Error:', err);
            UI.showErrorToast('❌ เกิดข้อผิดพลาด: ' + err.message);
        }
    }
};

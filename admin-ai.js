// ==========================================
// 🤖 AI Route Builder (K-Means Clustering)
// ==========================================
const AI = {
    run: () => {
        if (!State || !State.stores) {
            return alert('⚠️ ระบบยังโหลดข้อมูลไม่เสร็จ กรุณารอสักครู่ครับ');
        }
        if (State.stores.length === 0) {
            return alert('⚠️ ยังไม่มีข้อมูลร้านค้า กรุณาอัปโหลดไฟล์พิกัดก่อนครับ');
        }

        const elDays = document.getElementById('ai-days');
        const elLock = document.getElementById('ai-lock');
        const elLimit = document.getElementById('ai-outlier');
        const elDist = document.getElementById('ai-dist');

        if (!elDays || !elLock || !elLimit || !elDist) {
            return alert('❌ เกิดข้อผิดพลาด: หาปุ่มตั้งค่า AI ไม่เจอ');
        }

        const k = parseInt(elDays.value);
        const lock = elLock.checked;
        const limit = elLimit.checked;
        const mxD = parseFloat(elDist.value);

        // แก้บัค: k < 4 (เลขคู่ที่ใช้งานได้จริงคือ 4 ขึ้นไป)
        if (isNaN(k) || k < 4 || k % 2 !== 0) {
            return alert('⚠️ จำนวนวันต้องเป็นเลขคู่ และอย่างน้อย 4 วันครับ (เช่น 24)');
        }

        const hasAssigned = State.stores.some(s => s.days && s.days.length > 0);
        if (hasAssigned && !lock) {
            if (!confirm("⚠️ มีร้านที่ถูกจัดสายไว้แล้ว!\nยืนยันที่จะ 'ล้างข้อมูลสายเดิมทั้งหมด' แล้วให้ AI จัดใหม่ไหมครับ?")) {
                return;
            }
        }

        UI.showLoader('AI กำลังวิเคราะห์พื้นที่...', 'กำลังจับกลุ่มร้านค้าที่อยู่ใกล้กัน');
        setTimeout(() => { AI.calc(k, lock, limit, mxD); }, 150);
    },

    calc: (k, lock, limit, mxD) => {
        try {
            State.db.cycleDays = k;

            if (!lock) {
                State.stores.forEach(s => {
                    s.days = [];
                    s.selected = false;
                    s.seqs = {};
                });
            }

            const tIdx = [];
            const tgts = State.stores.filter((s, i) => {
                if (!s.days || s.days.length === 0) {
                    tIdx.push(i);
                    return true;
                }
                return false;
            });

            if (tgts.length === 0) {
                UI.hideLoader();
                return alert('✅ ไม่มีร้านที่รอจัดสายแล้วครับ');
            }

            const mK = k / 2;
            if (tgts.length < mK) {
                UI.hideLoader();
                return alert('⚠️ จำนวนร้านค้าน้อยกว่าจำนวนกลุ่ม แนะนำให้จัดสายด้วยมือครับ');
            }

            // --- K-Means Clustering ---
            const maxC = Math.ceil(tgts.length / mK) + 1;
            let cents = [...tgts].sort(() => 0.5 - Math.random()).slice(0, mK);
            let asg = Array(tgts.length).fill(-1);

            for (let iter = 0; iter < 30; iter++) {
                asg.fill(-1);
                const cnt = Array(mK).fill(0);
                const dArr = [];

                for (let i = 0; i < tgts.length; i++) {
                    for (let c = 0; c < mK; c++) {
                        dArr.push({ i, c, d: StoreMgr.getDistSq(tgts[i], cents[c]) });
                    }
                }
                dArr.sort((a, b) => a.d - b.d);

                for (const p of dArr) {
                    if (asg[p.i] === -1 && cnt[p.c] < maxC) {
                        asg[p.i] = p.c;
                        cnt[p.c]++;
                    }
                }

                // กำหนดกลุ่มให้ร้านที่ยังไม่ได้กลุ่ม
                for (let i = 0; i < tgts.length; i++) {
                    if (asg[i] === -1) {
                        let m = 0, mc = Infinity;
                        for (let c = 0; c < mK; c++) {
                            if (cnt[c] < mc) { mc = cnt[c]; m = c; }
                        }
                        asg[i] = m;
                        cnt[m]++;
                    }
                }

                // Swap optimization
                let swp = true, ls = 0;
                while (swp && ls < 20) {
                    swp = false; ls++;
                    for (let i = 0; i < tgts.length; i++) {
                        for (let j = i + 1; j < tgts.length; j++) {
                            const cI = asg[i], cJ = asg[j];
                            if (cI === cJ) continue;
                            if (
                                StoreMgr.getDistSq(tgts[i], cents[cJ]) + StoreMgr.getDistSq(tgts[j], cents[cI]) <
                                StoreMgr.getDistSq(tgts[i], cents[cI]) + StoreMgr.getDistSq(tgts[j], cents[cJ]) - 0.00001
                            ) {
                                asg[i] = cJ; asg[j] = cI; swp = true;
                            }
                        }
                    }
                }

                // อัปเดต centroids
                const sArr = Array(mK).fill(0).map(() => ({ lt: 0, ln: 0, n: 0 }));
                tgts.forEach((s, i) => {
                    const c = asg[i];
                    sArr[c].lt += s.lat;
                    sArr[c].ln += s.lng;
                    sArr[c].n++;
                });
                sArr.forEach((s, c) => {
                    if (s.n > 0) {
                        cents[c] = { ...cents[c], lat: s.lt / s.n, lng: s.ln / s.n };
                    }
                });
            }

            // --- จัดลงวันตามมุมองศา ---
            let gLat = 0, gLng = 0;
            cents.forEach(c => { gLat += c.lat; gLng += c.lng; });
            gLat /= mK; gLng /= mK;

            const zns = cents
                .map((c, i) => ({ i, a: Math.atan2(c.lat - gLat, c.lng - gLng) }))
                .sort((a, b) => a.a - b.a);

            let drop = 0;
            const mSq = Math.pow(mxD / 111, 2);

            for (let m = 0; m < mK; m++) {
                const ids = tgts.map((_, i) => i).filter(i => asg[i] === zns[m].i);
                if (!ids.length) continue;

                let vIds = [];
                if (limit && ids.length > 1) {
                    ids.forEach(i1 => {
                        const hs = ids.some(i2 => i1 !== i2 && StoreMgr.getDistSq(tgts[i1], tgts[i2]) <= mSq);
                        if (hs) vIds.push(i1);
                        else drop++;
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

                const f2 = vIds.filter(i => tgts[i].freq === 2);
                const f1 = vIds.filter(i => tgts[i].freq !== 2);
                const md = Math.ceil(f1.length / 2);

                f1.forEach((id, j) => {
                    State.stores[tIdx[id]].days = [j < md ? `Day ${m + 1}` : `Day ${m + 1 + mK}`];
                });
                f2.forEach(id => {
                    State.stores[tIdx[id]].days = [`Day ${m + 1}`, `Day ${m + 1 + mK}`];
                });
            }

            MapCtrl.clearRoad(true);
            UI.hideLoader();
            UI.render();
            App.saveDB();

            if (limit && drop === tgts.length) {
                alert(`⚠️ AI ไม่สามารถจัดสายได้เลย!\nเพราะเงื่อนไข "ตัดร้านโดด (${mxD} กม.)" ตัดร้านทิ้งทั้งหมด\n👉 ลองเอาติ๊กถูกออก แล้วรัน AI ใหม่อีกครั้งครับ`);
            } else {
                const msg = drop > 0
                    ? `✨ AI จัดเสร็จแล้ว! (ตัดร้านที่ไกลเกินรัศมีออก ${drop} ร้าน)`
                    : `✨ AI จัดโซนและแบ่งวันสำเร็จเรียบร้อย!`;
                alert(msg);
            }

        } catch (err) {
            UI.hideLoader();
            console.error('AI Error:', err);
            alert('❌ เกิดข้อผิดพลาดในการประมวลผล AI: ' + err.message);
        }
    }
};

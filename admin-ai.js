const AI = {
    run: () => {
        // ดักจับไว้เลยว่าข้อมูลมีปัญหาหรือไม่
        if (!State || !State.stores) {
            return alert("⚠️ ระบบยังโหลดข้อมูลไม่เสร็จ กรุณารอสักครู่ครับ");
        }
        if (State.stores.length === 0) {
            return alert("⚠️ ยังไม่มีข้อมูลร้านค้า กรุณาอัปโหลดไฟล์พิกัดก่อนครับ");
        }

        let elDays = document.getElementById('ai-days');
        let elLock = document.getElementById('ai-lock');
        let elLimit = document.getElementById('ai-outlier');
        let elDist = document.getElementById('ai-dist');

        if (!elDays || !elLock || !elLimit || !elDist) {
            return alert("❌ เกิดข้อผิดพลาด: หาปุ่มตั้งค่า AI หน้าจอไม่เจอ");
        }

        let k = parseInt(elDays.value);
        let lock = elLock.checked;
        let limit = elLimit.checked;
        let mxD = parseFloat(elDist.value);

        if (isNaN(k) || k < 2 || k % 2 !== 0) {
            return alert("⚠️ จำนวนวันต้องเป็นเลขคู่ และมากกว่า 2 วันครับ (เช่น 24)");
        }

        // เช็คว่ามีร้านจัดไว้แล้วหรือยัง ถ้ายกเลิกล็อค ต้องถามยืนยันก่อนลบ
        let hasAssigned = State.stores.some(s => s.days && s.days.length > 0);
        if (hasAssigned && !lock) {
            if (!confirm("⚠️ มีร้านที่ถูกจัดสายไว้แล้ว!\nยืนยันที่จะ 'ล้างข้อมูลสายเดิมทั้งหมด' แล้วให้ AI จัดใหม่ไหมครับ?")) {
                return; // ถ้ายกเลิก ก็หยุดทำงาน
            }
        }

        UI.showLoader("AI กำลังวิเคราะห์พื้นที่...", "กำลังจับกลุ่มร้านค้าที่อยู่ใกล้กัน (อาจใช้เวลาสักครู่)");
        
        // สั่งให้ UI โชว์ขึ้นมาก่อน ค่อยรันโค้ดหนักๆ
        setTimeout(() => {
            AI.calc(k, lock, limit, mxD);
        }, 150);
    },

    calc: (k, lock, limit, mxD) => {
        try {
            State.db.cycleDays = k;
            
            // ถ้ายกเลิกล็อค ให้ล้างสายเก่าออกให้หมดก่อนจัดใหม่
            if (!lock) {
                State.stores.forEach(s => {
                    s.days = [];
                    s.selected = false;
                    s.seqs = {};
                });
            }

            // หาเฉพาะร้านที่ "รอจัด" (ยังไม่มีสาย)
            let tIdx = [];
            let tgts = State.stores.filter((s, i) => {
                if (!s.days || s.days.length === 0) {
                    tIdx.push(i);
                    return true;
                }
                return false;
            });

            if (tgts.length === 0) {
                UI.hideLoader();
                return alert("✅ ไม่มีร้านที่รอจัดสายแล้วครับ (ถ้าต้องการจัดใหม่ อย่าลืมเอาติ๊กถูก 'ล็อคร้าน' ออก)");
            }

            let mK = k / 2; 
            if (tgts.length < mK) {
                UI.hideLoader();
                return alert("⚠️ จำนวนร้านค้าน้อยกว่าจำนวนวัน แนะนำให้กดจัดสายด้วยมือ (Manual) ดีกว่าครับ");
            }

            // --- เริ่มสมองกล (K-Means Clustering) ---
            let maxC = Math.ceil(tgts.length / mK) + 1;
            let cents = [...tgts].sort(() => 0.5 - Math.random()).slice(0, mK);
            let asg = Array(tgts.length).fill(-1);

            for (let iter = 0; iter < 30; iter++) {
                asg.fill(-1); 
                let cnt = Array(mK).fill(0);
                let dArr = [];

                for (let i = 0; i < tgts.length; i++) {
                    for (let c = 0; c < mK; c++) {
                        dArr.push({ i: i, c: c, d: StoreMgr.getDistSq(tgts[i], cents[c]) });
                    }
                }
                dArr.sort((a, b) => a.d - b.d);

                for (let p of dArr) {
                    if (asg[p.i] === -1 && cnt[p.c] < maxC) {
                        asg[p.i] = p.c;
                        cnt[p.c]++;
                    }
                }

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

                let swp = true, ls = 0;
                while (swp && ls < 20) {
                    swp = false; ls++;
                    for (let i = 0; i < tgts.length; i++) {
                        for (let j = i + 1; j < tgts.length; j++) {
                            let cI = asg[i], cJ = asg[j];
                            if (cI === cJ) continue;
                            if (StoreMgr.getDistSq(tgts[i], cents[cJ]) + StoreMgr.getDistSq(tgts[j], cents[cI]) < 
                                StoreMgr.getDistSq(tgts[i], cents[cI]) + StoreMgr.getDistSq(tgts[j], cents[cJ]) - 0.00001) {
                                asg[i] = cJ; asg[j] = cI; swp = true;
                            }
                        }
                    }
                }

                let sArr = Array(mK).fill(0).map(() => ({ lt: 0, ln: 0, n: 0 }));
                tgts.forEach((s, i) => {
                    let c = asg[i];
                    sArr[c].lt += s.lat;
                    sArr[c].ln += s.lng;
                    sArr[c].n++;
                });

                sArr.forEach((s, c) => {
                    if (s.n > 0) {
                        cents[c].lat = s.lt / s.n;
                        cents[c].lng = s.ln / s.n;
                    }
                });
            }

            // --- จัดลงวัน ตามมุมองศา ---
            let gLat = 0, gLng = 0;
            cents.forEach(c => { gLat += c.lat; gLng += c.lng; });
            gLat /= mK; gLng /= mK;

            let zns = cents.map((c, i) => ({ i: i, a: Math.atan2(c.lat - gLat, c.lng - gLng) })).sort((a, b) => a.a - b.a);
            let drop = 0;
            let mSq = Math.pow(mxD / 111, 2);

            for (let m = 0; m < mK; m++) {
                let ids = tgts.map((_, i) => i).filter(i => asg[i] === zns[m].i);
                let vIds = [];
                if (!ids.length) continue;

                if (limit && ids.length > 1) {
                    ids.forEach(i1 => {
                        let hs = false;
                        for (let i2 of ids) {
                            if (i1 === i2) continue;
                            if (StoreMgr.getDistSq(tgts[i1], tgts[i2]) <= mSq) { hs = true; break; }
                        }
                        if (hs) {
                            vIds.push(i1);
                        } else {
                            drop++;
                        }
                    });
                } else if (limit && ids.length === 1) {
                    drop++;
                } else {
                    vIds = ids;
                }

                if (!vIds.length) continue;

                vIds.sort((a, b) => StoreMgr.getDistSq(tgts[a], { lat: gLat, lng: gLng }) - StoreMgr.getDistSq(tgts[b], { lat: gLat, lng: gLng }));
                
                let f2 = vIds.filter(i => tgts[i].freq === 2);
                let f1 = vIds.filter(i => tgts[i].freq !== 2);
                let md = Math.ceil(f1.length / 2);

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
                alert(`⚠️ AI ไม่สามารถจัดสายได้เลย!\nเพราะโดนเงื่อนไข "ตัดร้านโดด (${mxD} กม.)" ตัดร้านทิ้งทั้งหมดครับ\n👉 ลองเอาติ๊กถูกออก แล้วรัน AI ใหม่อีกครั้งครับ`);
            } else {
                alert(drop > 0 ? `✨ AI จัดเสร็จแล้ว!\n(ตัดร้านที่ไกลเกินรัศมีออก ${drop} ร้าน เพื่อไม่ให้คิวงานโดด)` : `✨ AI จัดโซนและแบ่งวันสำเร็จเรียบร้อย!`);
            }

        } catch (err) {
            UI.hideLoader();
            console.error("AI Error:", err);
            alert("❌ เกิดข้อผิดพลาดในการประมวลผล AI: " + err.message);
        }
    }
};

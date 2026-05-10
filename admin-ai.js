// ==========================================
// 🤖 AI Route Builder  v4
// K-Means++ | Geo-Aware Balance | Jumper Fix
// ==========================================
const AI = {

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

        const hasAssigned = State.stores.some(s => s.days && s.days.length > 0);
        if (hasAssigned && !lock) {
            UI.showConfirm(
                "⚠️ มีร้านที่ถูกจัดสายไว้แล้ว!\nยืนยันที่จะล้างข้อมูลสายเดิมทั้งหมด แล้วให้ AI จัดใหม่ไหมครับ?",
                () => { UI.showLoader('AI กำลังวิเคราะห์...', 'จับกลุ่มร้านค้าที่อยู่ใกล้กัน'); setTimeout(() => AI.calc(k, lock, limit, mxD), 150); }
            );
            return;
        }
        UI.showLoader('AI กำลังวิเคราะห์...', 'จับกลุ่มร้านค้าที่อยู่ใกล้กัน');
        setTimeout(() => AI.calc(k, lock, limit, mxD), 150);
    },

    // ─── K-Means++ Initialization ───────────────────────────────────────
    _initKMeansPP: (pts, nC) => {
        const cents = [pts[Math.floor(Math.random() * pts.length)]];
        while (cents.length < nC) {
            const ds = pts.map(p => { let m = Infinity; for (const c of cents) { const d = StoreMgr.getDistSq(p, c); if (d < m) m = d; } return m; });
            const tot = ds.reduce((a, b) => a + b, 0);
            if (tot === 0) { cents.push(pts[Math.floor(Math.random() * pts.length)]); continue; }
            let r = Math.random() * tot, ch = pts[pts.length - 1];
            for (let i = 0; i < pts.length; i++) { r -= ds[i]; if (r <= 0) { ch = pts[i]; break; } }
            cents.push(ch);
        }
        return cents;
    },
    _calcWCSS: (pts, cs, asg) => pts.reduce((s, p, i) => s + (asg[i] >= 0 ? StoreMgr.getDistSq(p, cs[asg[i]]) : 0), 0),

    // ─── Build shared state for balance & jumper helpers ────────────────
    _buildDayState: (k) => {
        const ds = {}, cnt = {};
        for (let d = 1; d <= k; d++) ds[`Day ${d}`] = [];
        State.stores.forEach((s, i) => {
            if (!s.days || s.days.length !== 1) return;
            const d = s.days[0];
            if (ds[d] !== undefined) ds[d].push(i);
        });
        const allDays = Object.keys(ds).filter(d => ds[d].length > 0);
        allDays.forEach(d => cnt[d] = ds[d].length);
        const calcC = d => {
            const ix = ds[d]; if (!ix.length) return null;
            return { lat: ix.reduce((s,i)=>s+State.stores[i].lat,0)/ix.length,
                     lng: ix.reduce((s,i)=>s+State.stores[i].lng,0)/ix.length };
        };
        const cents = {}; allDays.forEach(d => cents[d] = calcC(d));
        return { ds, cnt, allDays, cents, calcC };
    },

    // ─── Step 1: Geo-Aware Balance ───────────────────────────────────────
    // ย้ายเฉพาะ "borderline" stores (อยู่ใกล้ปลายทาง ≤ 1.4× ระยะจากต้นทาง)
    _balanceDays: (k) => {
        const TOL = 5, MAX_ITER = 400, GR = 1.4;
        const { ds, cnt, allDays, cents, calcC } = AI._buildDayState(k);

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
                        return StoreMgr.getDistSq(s, cents[under]) <= StoreMgr.getDistSq(s, cents[over]) * GR * GR;
                    });
                    if (!valid.length) continue;

                    const bestIdx = valid.reduce((b, i) =>
                        StoreMgr.getDistSq(State.stores[i], cents[under]) <
                        StoreMgr.getDistSq(State.stores[b], cents[under]) ? i : b);

                    State.stores[bestIdx].days = [under];
                    ds[over]  = ds[over].filter(x => x !== bestIdx);
                    ds[under].push(bestIdx);
                    cnt[over]--; cnt[under]++;
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
        const { ds, cnt, allDays, cents, calcC } = AI._buildDayState(k);
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
                let best = cur, bestD = StoreMgr.getDistSq(s, cents[cur]);
                allDays.forEach(d => {
                    if (!cents[d]) return;
                    const dd = StoreMgr.getDistSq(s, cents[d]);
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
                cnt[cur]--; cnt[best]++;
                cents[cur]  = calcC(cur);
                cents[best] = calcC(best);
                changed = true; fixed++;
            });
            if (!changed) break; // converge
        }
        return fixed;
    },

    // ─── Main Calc ──────────────────────────────────────────────────────
    calc: (k, lock, limit, mxD) => {
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
                    for (let i=0;i<tgts.length;i++) for (let c=0;c<mK;c++) dA.push({i,c,d:StoreMgr.getDistSq(tgts[i],cs[c])});
                    dA.sort((a,b)=>a.d-b.d);
                    for (const p of dA) if (asg[p.i]===-1&&cnt[p.c]<maxC) { asg[p.i]=p.c; cnt[p.c]++; }
                    for (let i=0;i<tgts.length;i++) if (asg[i]===-1) {
                        let m=0,mc=Infinity; for(let c=0;c<mK;c++) if(cnt[c]<mc){mc=cnt[c];m=c;} asg[i]=m; cnt[m]++;
                    }
                    let sw=true,ls=0;
                    while(sw&&ls<10){sw=false;ls++;
                        for(let i=0;i<tgts.length;i++) for(let j=i+1;j<tgts.length;j++){
                            const ci=asg[i],cj=asg[j]; if(ci===cj) continue;
                            if(StoreMgr.getDistSq(tgts[i],cs[cj])+StoreMgr.getDistSq(tgts[j],cs[ci])<
                               StoreMgr.getDistSq(tgts[i],cs[ci])+StoreMgr.getDistSq(tgts[j],cs[cj])-1e-5)
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
                    ids.forEach(i1=>{const ok=ids.some(i2=>i1!==i2&&StoreMgr.getDistSq(tgts[i1],tgts[i2])<=mSq);ok?vIds.push(i1):drop++;});
                } else if(limit&&ids.length===1){drop++;} else {vIds=ids;}
                if(!vIds.length) continue;

                vIds.sort((a,b)=>StoreMgr.getDistSq(tgts[a],{lat:gLat,lng:gLng})-StoreMgr.getDistSq(tgts[b],{lat:gLat,lng:gLng}));
                const f2=vIds.filter(i=>tgts[i].freq===2), f1=vIds.filter(i=>tgts[i].freq!==2);
                const md=Math.ceil(f1.length/2), d1=m+1, d2=m+1+mK, hasPair=d2<=k;
                f1.forEach((id,j)=>{ State.stores[tIdx[id]].days=hasPair?[j<md?`Day ${d1}`:`Day ${d2}`]:[`Day ${d1}`]; });
                f2.forEach(id=>{ State.stores[tIdx[id]].days=hasPair?[`Day ${d1}`,`Day ${d2}`]:[`Day ${d1}`]; });
            }

            // ── Pass 1: Geo-Aware Balance ──
            const bal = AI._balanceDays(k);

            // ── Pass 2: Fix Jumpers (Voronoi Reassignment) ──
            const fixed = AI._fixJumpers(k);

            MapCtrl.clearRoad(true); UI.hideLoader(); UI.render(); App.saveDB();

            if (limit&&drop===tgts.length) {
                UI.showErrorToast(`⚠️ ตัดร้านโดด (${mxD}กม.) ทิ้งทั้งหมด กรุณาปรับค่า`);
            } else {
                let msg=drop>0?`✨ AI จัดเสร็จ! (ตัดร้านโดด ${drop} ร้าน)`:`✨ AI จัดสำเร็จ!`;
                msg+=` | min:${bal.min} max:${bal.max} avg:${bal.avg}`;
                if (fixed>0) msg+=` | แก้ร้านกระโดด ${fixed} ร้าน`;
                UI.showSaveToast(msg);
            }

        } catch(err) {
            UI.hideLoader(); console.error('AI Error:',err);
            UI.showErrorToast('❌ เกิดข้อผิดพลาด: '+err.message);
        }
    }
};

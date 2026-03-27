const AI = {
    run: () => {
        if(!State.stores.length) return alert("อัปโหลดไฟล์พิกัดก่อนครับ");
        let k = parseInt(document.getElementById('ai-days').value), lock = document.getElementById('ai-lock').checked, limit = document.getElementById('ai-outlier').checked, mxD = parseFloat(document.getElementById('ai-dist').value);
        if(isNaN(k) || k<2 || k%2!==0) return alert("จำนวนวันต้องเป็นเลขคู่");
        if(State.stores.some(s=>s.days.length) && !lock && !confirm("ยืนยันล้างข้อมูลสายเดิม?")) return;
        UI.showLoader("AI กำลังวิเคราะห์พื้นที่...", "และจับกลุ่มร้านค้าที่อยู่ใกล้กัน"); setTimeout(() => AI.calc(k, lock, limit, mxD), 100);
    },
    calc: (k, lock, limit, mxD) => {
        State.db.cycleDays = k;
        if(!lock) State.stores.forEach(s => {s.days=[]; s.selected=false; s.seqs={};});
        let tIdx=[], tgts = State.stores.filter((s,i)=>{if(!s.days.length){tIdx.push(i); return true;} return false;});
        if(!tgts.length) { UI.hideLoader(); return alert("ไม่มีร้านให้จัดแล้ว"); }
        let mK = k/2; if(tgts.length<mK) { UI.hideLoader(); return alert("ร้านน้อยกว่าจำนวนวัน จัด Manual ดีกว่าครับ"); }
        
        let maxC = Math.ceil(tgts.length/mK)+1, cents = [...tgts].sort(()=>0.5-Math.random()).slice(0,mK), asg = Array(tgts.length).fill(-1);
        for(let iter=0; iter<30; iter++){
            asg.fill(-1); let cnt=Array(mK).fill(0), dArr=[];
            for(let i=0; i<tgts.length; i++) for(let c=0; c<mK; c++) dArr.push({i, c, d:StoreMgr.getDistSq(tgts[i],cents[c])});
            dArr.sort((a,b)=>a.d-b.d);
            for(let p of dArr) if(asg[p.i]===-1 && cnt[p.c]<maxC){ asg[p.i]=p.c; cnt[p.c]++; }
            for(let i=0; i<tgts.length; i++) if(asg[i]===-1){ let m=0, mc=Infinity; for(let c=0; c<mK; c++)if(cnt[c]<mc){mc=cnt[c];m=c;} asg[i]=m; cnt[m]++; }
            let swp=true, ls=0;
            while(swp && ls<20){ swp=false; ls++; for(let i=0; i<tgts.length; i++) for(let j=i+1; j<tgts.length; j++){ let cI=asg[i], cJ=asg[j]; if(cI===cJ)continue; if(StoreMgr.getDistSq(tgts[i],cents[cJ])+StoreMgr.getDistSq(tgts[j],cents[cI]) < StoreMgr.getDistSq(tgts[i],cents[cI])+StoreMgr.getDistSq(tgts[j],cents[cJ]) - 0.00001){ asg[i]=cJ; asg[j]=cI; swp=true; } } }
            let sArr=Array(mK).fill(0).map(()=>({lt:0,ln:0,n:0}));
            tgts.forEach((s,i)=>{let c=asg[i]; sArr[c].lt+=s.lat; sArr[c].ln+=s.lng; sArr[c].n++;});
            sArr.forEach((s,c)=>{if(s.n>0){cents[c].lat=s.lt/s.n; cents[c].lng=s.ln/s.n;}});
        }
        
        let gLat=0, gLng=0; cents.forEach(c=>{gLat+=c.lat; gLng+=c.lng;}); gLat/=mK; gLng/=mK;
        let zns = cents.map((c,i)=>({i, a:Math.atan2(c.lat-gLat, c.lng-gLng)})).sort((a,b)=>a.a-b.a);
        let drop = 0, mSq = Math.pow(mxD/111,2);

        for(let m=0; m<mK; m++) {
            let ids = tgts.map((_,i)=>i).filter(i=>asg[i]===zns[m].i), vIds=[];
            if(!ids.length)continue;
            if(limit && ids.length>1) { ids.forEach(i1 => { let hs=false; for(let i2 of ids){if(i1===i2)continue; if(StoreMgr.getDistSq(tgts[i1],tgts[i2])<=mSq){hs=true;break;}} hs?vIds.push(i1):drop++; }); }
            else if(limit && ids.length===1) drop++; else vIds=ids;
            if(!vIds.length)continue;
            vIds.sort((a,b)=>StoreMgr.getDistSq(tgts[a],{lat:gLat,lng:gLng})-StoreMgr.getDistSq(tgts[b],{lat:gLat,lng:gLng}));
            let f2=vIds.filter(i=>tgts[i].freq===2), f1=vIds.filter(i=>tgts[i].freq!==2), md=Math.ceil(f1.length/2);
            f1.forEach((id,j) => State.stores[tIdx[id]].days = [j<md ? `Day ${m+1}`:`Day ${m+1+mK}`]);
            f2.forEach(id => State.stores[tIdx[id]].days = [`Day ${m+1}`, `Day ${m+1+mK}`]);
        }
        MapCtrl.clearRoad(true); UI.hideLoader(); UI.render(); App.saveDB();
        alert(drop>0 ? `✨ AI จัดเสร็จแล้ว!\n(ตัด ${drop} ร้านที่อยู่ไกลเกินรัศมี โยนกลับไปช่องรอจัด)` : `✨ AI จัดโซนและคำนวณวันสำเร็จ!`);
    }
};

const OSRM = {
    generate: async () => {
        let d = State.openDayModal; if(!d) return;
        let s = State.stores.filter(x=>x.days.includes(d)); if(s.length<2) return alert("ต้องมีอย่างน้อย 2 ร้าน"); if(s.length>100) return alert("จำกัด 100 ร้านต่อวัน");
        let lt=0, ln=0; s.forEach(x=>{lt+=x.lat; ln+=x.lng;}); lt/=s.length; ln/=s.length;
        let u=[...s].sort((a,b)=>StoreMgr.getDistSq(a,{lat:lt,lng:ln})-StoreMgr.getDistSq(b,{lat:lt,lng:ln})), r=[u.shift()];
        while(u.length){ let c=r[r.length-1], idx=0, min=Infinity; for(let i=0; i<u.length; i++){let d=StoreMgr.getDistSq(c,u[i]); if(d<min){min=d;idx=i;}} r.push(u.splice(idx,1)[0]); }
        r.forEach((x,i) => { if(!x.seqs) x.seqs={}; x.seqs[d] = i+1; }); App.saveDB();
        UI.showLoader("กำลังวาดเส้นทางถนน...", "เชื่อมต่อ GPS");
        try {
            let res = await fetch(`https://router.project-osrm.org/route/v1/driving/${r.map(x=>`${x.lng},${x.lat}`).join(';')}?overview=full&geometries=geojson`);
            let json = await res.json();
            if(json.code==='Ok') {
                if(MapCtrl.roadLayer) MapCtrl.map.removeLayer(MapCtrl.roadLayer);
                MapCtrl.roadLayer = L.geoJSON(json.routes[0].geometry, {style: {color:DAY_COLORS[d].hex, weight:6, opacity:0.8}}).addTo(MapCtrl.map);
                State.activeRoadDay = d; MapCtrl.map.fitBounds(MapCtrl.roadLayer.getBounds(), {padding:[50,50]});
                document.getElementById('clearRoadBtn').classList.remove('hidden'); UI.render();
            } else alert("เซิร์ฟเวอร์ขัดข้อง หรือระยะทางไกลเกินไป");
        } catch(e) { alert("เครือข่ายมีปัญหา"); }
        UI.hideLoader();
    }
};

/* =============================================================================
 *  road-master.js — ระยะ Master + จุดเริ่ม/จุดจบของแต่ละ CY + ชื่อตลาด
 * =============================================================================
 *  ระยะ Master คือระยะของแผน คำนวณจากลำดับเข้าเยี่ยมที่จัดไว้
 *  ใช้เทียบว่าสายไหนหนัก/เบา และเป็นฐานเทียบกับระยะที่วิ่งจริง
 *
 *  ค่าเริ่มต้นคือ "ระยะระหว่างร้าน" เท่านั้น — ระบบไม่เดาจุดตั้งต้นให้
 *  เพราะแต่ละศูนย์ทำงานไม่เหมือนกัน บางสายไม่ได้ออกจากที่เดิมและกลับที่เดิมทุกวัน
 *  ถ้าผู้ใช้ระบุจุดเริ่ม/จุดจบเอง ระบบจะบวกขาออกและขากลับให้ด้วย
 *
 *  โครงข้อมูลจุด (ผู้ใช้กรอกเองทั้งหมด ไม่มีการเดา)
 *    State.db.routeBase[สาย]            = จุดประจำสาย (ใช้กับทุกวันที่ไม่ได้ระบุ)
 *    State.db.cyPoints[สาย][วัน].start  = จุดเริ่มของวันนั้น
 *    State.db.cyPoints[สาย][วัน].end    = จุดจบของวันนั้น
 *
 *    State.db.cyPoints[สาย][วัน].at[YYYY-MM-DD] = {start,end}  จุดเฉพาะครั้ง (รอบสั้น วันเดียววิ่ง 2 ครั้ง)
 *
 *  V1.0.3 ลำดับที่ใช้ (เลิกกฎ "จุดจบวันนี้ = จุดเริ่มวันถัดไป" แล้ว):
 *    จุดเฉพาะครั้ง → จุดของ Day นั้น → จุดประจำสาย → ไม่มี (เริ่มที่ร้านแรก / จบที่ร้านสุดท้าย ไม่คิดขาเดินทาง)
 * ========================================================================== */
const RoadMaster = (() => {
    'use strict';

    const dayNum = d => parseInt(String(d || '').replace(/[^0-9]/g, ''), 10) || 0;
    const km = m => Math.round(m / 100) / 10;
    const valid = p => !!(p && isFinite(p.lat) && isFinite(p.lng));
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const M = {
        /** V1.0.4 (11 พ.ย. 2569 11:10): ขาออก/ขากลับเกินนี้ (กม.) = ทาพื้นแดง + เตือนตอน Export */
        FAR_KM: 80,
        isFar(mtr) { return mtr != null && mtr / 1000 > M.FAR_KM; },
        /** ช่องตัวเลขขาออก/ขากลับ — ไม่มีจุด = ว่าง · เกิน FAR_KM = พื้นแดง */
        legHTML(mtr, unit) {
            if (mtr == null) return '';
            const v = km(mtr).toFixed(1) + (unit ? ' กม.' : '');
            return M.isFar(mtr)
                ? `<span title="เกิน ${M.FAR_KM} กม." style="background:#dc2626;color:#fff;font-weight:800;border-radius:5px;padding:0 4px;display:inline-block">${v}</span>`
                : `<span class="text-gray-500">${v}</span>`;
        },
        /** ตลาดที่ขาออก/ขากลับเกิน FAR_KM — ใช้ในหน้าตรวจก่อน Export */
        farList(routes) {
            const out = [];
            const R = State.db.routes || {};
            (routes || Object.keys(R)).forEach(rt => {
                try {
                    M.routeRows(rt, R[rt] || []).forEach(r => {
                        const o = M.isFar(r.outM), b = M.isFar(r.backM);
                        if (o || b) out.push({ route: rt, day: r.day, outKm: o ? Math.round(km(r.outM)) : null, backKm: b ? Math.round(km(r.backM)) : null });
                    });
                } catch (e) {}
            });
            return out;
        },

        // ── จุดเริ่ม / จุดจบ ──────────────────────────────────────────────
        base(route) {
            const b = (State.db.routeBase || {})[route];
            return valid(b) ? b : null;
        },
        _cy(route, day) {
            return ((State.db.cyPoints || {})[route] || {})[day] || {};
        },
        /** วันก่อนหน้าในสายเดียวกัน (ตามเลขวัน) */
        prevDay(route, day, stores) {
            const days = M.daysOf(route, stores);
            const n = dayNum(day);
            let best = null;
            days.forEach(d => {
                const k = dayNum(d);
                if (k < n && (!best || k > dayNum(best))) best = d;
            });
            return best;
        },
        /** V1.0.3: จุดเฉพาะครั้ง (date = 'YYYY-MM-DD') */
        _at(route, day, date) {
            if (!date) return {};
            const at = M._cy(route, day).at;
            return (at && at[date]) || {};
        },
        endOf(route, day, date) {
            const o = M._at(route, day, date).end;
            if (valid(o)) return o;
            const e = M._cy(route, day).end;
            return valid(e) ? e : M.base(route);
        },
        /** V1.0.3: ไม่ได้ตั้งจุดเริ่ม → จุดประจำสาย → ไม่มี (เริ่มที่ร้านแรก) — ไม่สืบจากจุดจบของวันก่อนแล้ว */
        startOf(route, day, stores, date) {
            const o = M._at(route, day, date).start;
            if (valid(o)) return o;
            const s = M._cy(route, day).start;
            return valid(s) ? s : M.base(route);
        },
        /** เลิกใช้ตั้งแต่ V1.0.3 (คงไว้ให้โค้ดเก่าเรียกได้) */
        startInherited() { return false; },
        /** V1.0.3: ลายนิ้วมือจุดเริ่ม/จบของครั้งนั้น — ให้ Runs ใช้ตัดสินว่ารวมเป็น CY เดียวได้ไหม */
        ptSig(route, day, date) {
            const k = p => p ? (+p.lat).toFixed(6) + ',' + (+p.lng).toFixed(6) : '-';
            return k(M.startOf(route, day, null, date)) + '>' + k(M.endOf(route, day, date));
        },
        /** V1.0.3: วันที่วิ่งของ Day นี้ (Date[]) */
        _dates(route, day) {
            try { return (typeof Runs !== 'undefined' && Runs.datesOf) ? Runs.datesOf(route, day).filter(Boolean) : []; } catch (e) { return []; }
        },
        _iso(d) { return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : ''; },
        _shortD(d) { return d ? d.getDate() + ' ' + ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][d.getMonth()] : ''; },
        _shortIso(x) { const m = String(x || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? M._shortD(new Date(+m[1], +m[2] - 1, +m[3])) : String(x || ''); },

        /** date = 'YYYY-MM-DD' → ตั้งเฉพาะครั้งนั้น · ไม่ใส่ = ทุกครั้งของ Day นี้ */
        async setPoint(route, day, which, point, date) {
            M._put(route, day, which, point, date);
            await M._persist();
        },
        _put(route, day, which, point, date) {
            State.db.cyPoints = State.db.cyPoints || {};
            State.db.cyPoints[route] = State.db.cyPoints[route] || {};
            const rec = State.db.cyPoints[route][day] = State.db.cyPoints[route][day] || {};
            let tgt = rec;
            if (date) { rec.at = rec.at || {}; tgt = rec.at[date] = rec.at[date] || {}; }
            if (point) tgt[which] = { lat: +point.lat, lng: +point.lng, name: point.name || '', code: point.code || '' };
            else delete tgt[which];
            if (date && !tgt.start && !tgt.end) delete rec.at[date];
            if (rec.at && !Object.keys(rec.at).length) delete rec.at;
            if (!rec.start && !rec.end && !rec.at) delete State.db.cyPoints[route][day];
            if (!Object.keys(State.db.cyPoints[route]).length) delete State.db.cyPoints[route];
        },
        async setBase(route, point) {
            State.db.routeBase = State.db.routeBase || {};
            if (point) State.db.routeBase[route] = { lat: +point.lat, lng: +point.lng, name: point.name || '', code: point.code || '' };
            else delete State.db.routeBase[route];
            await M._persist();
        },
        // เขียนลงฐานข้อมูลแบบหน่วงเล็กน้อย — ตั้งหลายจุดติดกันจะเขียนครั้งเดียว
        // (ทุกครั้งที่เขียนศูนย์กลาง ระบบจะโหลดแผนใหม่ ซึ่งกินเวลา)
        _timer: null,
        _persist() {
            try { if (typeof Runs !== 'undefined' && Runs.bump) Runs.bump(); } catch (e) {}   // จุดมีผลกับการรวม CY
            clearTimeout(M._timer);
            M._timer = setTimeout(M._flush, 800);
            return Promise.resolve();
        },
        async _flush() {
            clearTimeout(M._timer); M._timer = null;
            try {
                // V1.0.3: mergeFields = แทนทั้งก้อน — merge:true แบบเดิมรวมลึก ทำให้จุดที่ล้างแล้วไม่หายจากฐานข้อมูล
                await App.dbRef.set({ cyPoints: State.db.cyPoints || {},
                                      routeBase: State.db.routeBase || {} }, { mergeFields: ['cyPoints', 'routeBase'] });
            } catch (e) { console.warn('[RoadMaster] บันทึกจุดไม่สำเร็จ', e); }
        },

        // ── ชื่อตลาด ─────────────────────────────────────────────────────
        marketName(route, day, stores) {
            const arr = M.storesOfDay(day, stores || State.stores || [], route);
            const withName = arr.find(s => s.marketName);
            return withName ? withName.marketName : '';
        },
        /** V1.0.4: ชื่อตลาดยาวได้เท่าไร — Cycle name = สาย + "D" + เลข 2 หลัก + ชื่อตลาด รวมไม่เกิน 50 ตัวอักษร */
        nameMax(route) { return Math.max(5, 50 - (String(route || '').length + 3)); },
        async setMarketName(route, day, name) {
            name = String(name || '').slice(0, M.nameMax(route));
            const list = (State.db.routes || {})[route] || State.stores || [];
            list.forEach(s => { if (!s.inactive && (s.days || []).includes(day)) s.marketName = name; });
            try { App.saveDB(); } catch (e) { console.warn('[RoadMaster]', e); }
        },

        // ── คำนวณ ────────────────────────────────────────────────────────
        daysOf(route, stores) {
            const list = (stores || (State.db.routes || {})[route] || [])
                .filter(s => !route || !s.route || s.route === route);
            return [...new Set(list.flatMap(s => s.inactive ? [] : (s.days || [])))]
                .sort((a, b) => dayNum(a) - dayNum(b));
        },
        /** CY ของตลาดนี้ — ร้าน F2 มี CY คนละตัวในแต่ละวัน */
        cyOf(day, arr) {
            if (typeof CycleCode !== 'undefined' && CycleCode.of) {
                for (const s of arr) { const v = CycleCode.of(s, day); if (v) return v; }
                return '';
            }
            for (const s of arr) { if (s.cys && s.cys[day]) return s.cys[day]; }
            for (const s of arr) { if ((s.days || []).length === 1 && s.cy) return s.cy; }
            return '';
        },

        storesOfDay(day, stores, route) {
            return (stores || [])
                // ร้านที่ยังไม่ได้ติดชื่อสาย = มาจากกล่องของสายนั้นอยู่แล้ว ถือว่าตรง
                .filter(s => !s.inactive && (s.days || []).includes(day)
                          && (!route || !s.route || s.route === route))
                .sort((a, b) => ((a.seqs && a.seqs[day]) || 9999) - ((b.seqs && b.seqs[day]) || 9999));
        },

        /** ระยะของวันหนึ่ง (เมตร) ตามลำดับคิวที่จัดไว้ */
        dayM(route, day, stores) {
            const arr = M.storesOfDay(day, stores, route);
            if (!arr.length) return { n: 0, m: 0, legs: 0, exactM: 0, exactLegs: 0 };
            const D = (a, b) => (typeof RoadDist !== 'undefined')
                ? RoadDist.mx(a, b) : { m: 0, exact: false };
            let m = 0, legs = 0, exactM = 0, exactLegs = 0;
            const add = (a, b) => { const r = D(a, b); m += r.m; legs++; if (r.exact) { exactM += r.m; exactLegs++; } return r.m; };
            const st = M.startOf(route, day, stores), en = M.endOf(route, day);
            // V1.0.4 (11 พ.ย. 2569 11:10): เก็บระยะขาออก (จุดเริ่ม→ร้านแรก) / ขากลับ (ร้านสุดท้าย→จุดจบ) ไว้โชว์ + เตือนเกิน FAR_KM
            const outM = st ? add(st, arr[0]) : null;
            for (let i = 1; i < arr.length; i++) add(arr[i - 1], arr[i]);
            const backM = en ? add(arr[arr.length - 1], en) : null;
            return { n: arr.length, m, legs, exactM, exactLegs, cy: M.cyOf(day, arr),
                     start: st, end: en, hasPoints: !!(st || en),
                     outM, backM, first: arr[0], last: arr[arr.length - 1] };
        },

        routeRows(route, stores) {
            const list = stores || (State.db.routes || {})[route] || [];
            return M.daysOf(route, list).map(d => ({ route, day: d, ...M.dayM(route, d, list),
                                                     market: M.marketName(route, d, list) }));
        },
        allRows(routes) {
            const R = routes || State.db.routes || {};
            const out = [];
            Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }))
                .forEach(name => { if (name !== 'รอจัดสาย') out.push(...M.routeRows(name, R[name])); });
            return out;
        },

        basis() {
            if (typeof RoadDist === 'undefined' || !RoadDist.ready) return 'เส้นตรง (ยังไม่ได้โหลดตารางระยะถนน)';
            const i = RoadDist.info;
            return `ระยะถนนจริง · OSM ${i.built}`;
        },

        async freeze(precomputed) {
            const ym = App._currentPlanYM;
            if (!ym) return null;
            const rows = precomputed || M.allRows();
            const byRoute = {};
            rows.forEach(r => {
                byRoute[r.route] = byRoute[r.route] || { km: 0, days: 0, stores: 0 };
                byRoute[r.route].km += km(r.m);
                byRoute[r.route].days++;
                byRoute[r.route].stores += r.n;
            });
            Object.values(byRoute).forEach(v => { v.km = Math.round(v.km * 10) / 10; });
            const rec = {
                at: new Date().toISOString().slice(0, 16).replace('T', ' '),
                basis: (typeof RoadDist !== 'undefined' && RoadDist.ready) ? 'road' : 'straight',
                totalKm: Math.round(rows.reduce((t, r) => t + km(r.m), 0) * 10) / 10,
                routes: byRoute,
            };
            State.db.masterKm = State.db.masterKm || {};
            State.db.masterKm[ym] = rec;
            try { await App.dbRef.set({ masterKm: State.db.masterKm }, { merge: true }); }
            catch (e) { console.warn('[RoadMaster] บันทึกระยะ Master ไม่สำเร็จ', e); }
            return rec;
        },

        // ── กล่องสรุปในแท็บ 4 ────────────────────────────────────────────
        render() {
            const box = document.getElementById('master-km-box');
            if (!box) return;
            const route = State.localActiveRoute;
            if (!route || !State.stores || !State.stores.length) {
                box.innerHTML = '<p class="text-[11px] text-gray-400">เลือกสายวิ่งก่อน</p>';
                return;
            }
            const rows = M.routeRows(route, State.stores);
            const total = rows.reduce((t, r) => t + r.m, 0);
            const exact = rows.reduce((t, r) => t + (r.exactM || 0), 0);
            const exactPct = total ? Math.round(exact / total * 100) : 0;
            const roadOn = (typeof RoadDist !== 'undefined' && RoadDist.ready);
            const withPts = rows.filter(r => r.hasPoints).length;
            const bs = M.base(route);

            box.innerHTML = `
                <div class="flex items-baseline justify-between gap-2 mb-1">
                    <span class="text-[11px] font-bold text-gray-500">ระยะ Master · สาย ${esc(route)}</span>
                    <span class="text-lg font-black ${roadOn ? 'text-emerald-700' : 'text-amber-600'}">${km(total).toLocaleString()} กม.</span>
                </div>
                <p class="text-[10px] ${roadOn ? 'text-gray-400' : 'text-amber-600'} mb-2 leading-snug">
                    ฐาน: ${M.basis()}${roadOn ? ` · มาจากตารางถนนจริง ${exactPct}%` : ''}<br>
                    ${withPts ? `รวมขาออก–ขากลับแล้ว ${withPts}/${rows.length} วัน`
                              : 'เป็นระยะ<b>ระหว่างร้าน</b>เท่านั้น — ยังไม่รวมขาไป-กลับจุดตั้งต้น'}
                    ${bs ? ` · จุดประจำสาย: ${esc(bs.name || bs.lat.toFixed(4) + ', ' + bs.lng.toFixed(4))}` : ''}
                </p>
                <!-- V1.0.4 (11 พ.ย. 2569 15:35): ตัดกรอบเหลือง "ตารางระยะถนนไม่ครอบคลุม…" — ซ้ำกับ % ในบรรทัดฐานด้านบน -->
                <div class="max-h-44 overflow-y-auto -mx-1 px-1">
                <table class="w-full text-[11px]">
                    <thead><tr class="text-gray-400 text-left">
                        <th class="font-medium py-0.5">วัน</th><th class="font-medium">ตลาด</th>
                        <th class="font-medium text-right">ร้าน</th>
                        <th class="font-medium text-right">กม.</th>
                        <th class="font-medium text-right whitespace-nowrap" title="จุดเริ่ม → ร้านแรก (กม.) · ว่าง = ยังไม่ใส่จุดเริ่ม">🚩 ขาออก</th>
                        <th class="font-medium text-right whitespace-nowrap" title="ร้านสุดท้าย → จุดจบ (กม.) · ว่าง = ยังไม่ใส่จุดจบ">🏁 ขากลับ</th></tr></thead>
                    <tbody>${rows.map(r => `
                        <tr class="border-t border-gray-100 hover:bg-gray-50 cursor-pointer${State.seqView && State.seqView.route === route && State.seqView.day === r.day ? ' bg-indigo-50' : ''}" onclick="(typeof MultiRoute!=='undefined'&&MultiRoute.viewDay)?MultiRoute.openDay('${esc(route)}','${r.day}'):UI.showDayModal('${r.day}')">
                            <td class="py-0.5 whitespace-nowrap">${(typeof DAY_COLORS !== 'undefined' && DAY_COLORS[r.day]) ? DAY_COLORS[r.day].name : r.day}</td>
                            <td class="truncate max-w-[110px] text-gray-500">${esc(r.market) || '<span class="text-amber-500">— ยังไม่ตั้งชื่อ</span>'}</td>
                            <td class="text-right tabular-nums">${r.n}</td>
                            <td class="text-right tabular-nums font-bold">${km(r.m).toFixed(1)}</td>
                            <td class="text-right tabular-nums">${M.legHTML(r.outM)}</td>
                            <td class="text-right tabular-nums">${M.legHTML(r.backM)}</td>
                        </tr>`).join('')}</tbody>
                </table></div>
                <div class="flex gap-1 mt-2">
                    <!-- V1.0.4 (11 พ.ย. 2569 14:35): จัดลำดับทุกตลาดของสายทีเดียว -->
                    <button onclick="SeqTool.orderAll()" title="จัดลำดับคิวใหม่ทุกตลาดของสายนี้จากพิกัด (ถามยืนยันก่อน · ย้อนกลับได้)" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-1.5 rounded-lg text-[11px] font-bold">🔢 จัดลำดับทั้งสาย</button>
                    <button onclick="RoadMaster.baseModal()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 rounded-lg text-[11px] font-bold">📍 จุดประจำสาย</button>
                    <!-- V0.7.5: ปุ่มตารางระยะถนนเอาออก (โปรแกรมโหลดไฟล์ road-matrix เองตอนเปิด) -->
                </div>`;
        },

        // ── แผงในหน้าต่างรายวัน ──────────────────────────────────────────
        dayPanelHTML(day) {
            const route = State.localActiveRoute;
            if (!route) return '';
            const info = M.dayM(route, day, State.stores);
            const st = info.start, en = info.end;
            const rec = M._cy(route, day), bs = M.base(route);
            const label = p => p ? esc(p.name || (p.lat.toFixed(4) + ', ' + p.lng.toFixed(4))) : '—';
            // V1.0.3: บอกที่มาของจุด — ตั้งเฉพาะวันนี้ / จุดประจำสาย / ไม่มี (ร้านแรก-ร้านสุดท้าย)
            const src = (which, p) => valid(rec[which]) ? '' : (p ? '<span class="text-[10px] text-gray-400">(ประจำสาย)</span>'
                : `<span class="text-[10px] text-gray-400">(${which === 'start' ? 'ร้านแรก' : 'ร้านสุดท้าย'})</span>`);
            const ats = Object.keys(rec.at || {}).sort();
            const cls = 'px-1.5 py-0.5 rounded-md bg-white border border-gray-200 hover:border-gray-400 text-[11px] font-bold';
            return `
            <div class="bg-gray-50 border border-gray-200 rounded-xl p-2 mb-2 text-[11px]">
                <div class="flex items-center gap-1.5 mb-1.5">
                    <span class="text-gray-400 shrink-0">ชื่อตลาด</span>
                    <input id="rm-market" value="${esc(M.marketName(route, day, State.stores))}"
                           placeholder="เช่น ในเมืองร้อยเอ็ด" maxlength="${M.nameMax(route)}"
                           title="ชื่อ Cycle ใน DMS = ${esc(route)}D${String(dayNum(day)).padStart(2, '0')} + ชื่อตลาด รวมไม่เกิน 50 ตัวอักษร → ชื่อตลาดได้ ${M.nameMax(route)} ตัว"
                           oninput="var c=document.getElementById('rm-market-n');if(c)c.textContent=this.value.length+'/${M.nameMax(route)}'"
                           onchange="RoadMaster.saveMarket('${esc(day)}', this.value)"
                           class="flex-1 min-w-0 border border-gray-200 rounded-md px-1.5 py-0.5 text-[11px]">
                    <span id="rm-market-n" class="shrink-0 text-[9.5px] tabular-nums ${M.marketName(route, day, State.stores).length > M.nameMax(route) ? 'text-red-600 font-bold' : 'text-gray-400'}">${M.marketName(route, day, State.stores).length}/${M.nameMax(route)}</span>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-gray-400">🚩 เริ่ม</span>
                    <button class="${cls}" onclick="RoadMaster.pointMenu('${esc(day)}','start')">${label(st)}</button>${src('start', st)}
                    <span class="text-gray-400 ml-1">🏁 จบ</span>
                    <button class="${cls}" onclick="RoadMaster.pointMenu('${esc(day)}','end')">${label(en)}</button>${src('end', en)}
                    <span class="ml-auto font-black text-gray-700">${km(info.m).toFixed(1)} กม.</span>
                </div>
                ${st || en ? `<div class="flex items-center gap-3 flex-wrap mt-1.5">
                    ${st ? `<span>🚩 ขาออก → ${esc((info.first && info.first.name) || 'ร้านแรก')} ${M.legHTML(info.outM, true)}</span>` : ''}
                    ${en ? `<span>🏁 ขากลับ ← ${esc((info.last && info.last.name) || 'ร้านสุดท้าย')} ${M.legHTML(info.backM, true)}</span>` : ''}
                </div>` : ''}
                ${ats.map(d => { const a = rec.at[d] || {}; return `<div class="mt-1 text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md px-1.5 py-0.5">
                    เฉพาะ ${esc(M._shortIso(d))}: ${a.start ? '🚩 ' + label(a.start) : ''}${a.start && a.end ? ' · ' : ''}${a.end ? '🏁 ' + label(a.end) : ''}
                    <span class="text-gray-400">(ครั้งอื่นใช้ค่าข้างบน)</span></div>`; }).join('')}
            </div>`;
        },

        saveMarket(day, name) {
            M.setMarketName(State.localActiveRoute, day, (name || '').trim());
            M.render();
        },

        pointMenu(day, which) {
            const route = State.localActiveRoute;
            const arr = M.storesOfDay(day, State.stores, route);
            const cur = M._cy(route, day)[which];
            const s = which === 'start' ? arr[0] : arr[arr.length - 1];
            // V1.0.3: รอบสั้น — Day เดียววิ่งหลายครั้ง เลือกได้ว่าจะตั้งทุกครั้ง หรือเฉพาะครั้งไหน
            const dates = M._dates(route, day).map(M._iso);
            M._pmCtx = { route, day, which };
            const html = `
                <p class="text-xs text-gray-500 mb-3 leading-snug">
                    ${which === 'start' ? 'จุดที่ออกตอนเช้าของวันนี้' : 'จุดที่จบวันนี้ (ถ้าไม่ได้กลับที่เดิม)'}<br>
                    ปล่อยว่างได้ — ไม่ตั้งจะใช้<b>จุดประจำสาย</b> ถ้าไม่มีจุดประจำสาย${which === 'start' ? 'เริ่มที่ร้านแรก' : 'จบที่ร้านสุดท้าย'} (ไม่คิดขาเดินทาง)
                </p>
                ${dates.length > 1 ? `
                <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-2 mb-3 text-xs text-gray-700">
                    <div class="text-[11px] font-bold text-indigo-700 mb-1">Day นี้วิ่ง ${dates.length} ครั้ง — ใช้จุดนี้กับ</div>
                    <label class="flex items-center gap-1.5"><input type="radio" name="rm-at" value="" checked onchange="RoadMaster._pmScope(this.value)"> ทุกครั้ง (${dates.map(M._shortIso).join(', ')})</label>
                    ${dates.map(d => `<label class="flex items-center gap-1.5"><input type="radio" name="rm-at" value="${d}" onchange="RoadMaster._pmScope(this.value)"> เฉพาะ ${M._shortIso(d)}${M._at(route, day, d)[which] ? ' <span class="text-indigo-600">(ตั้งไว้แล้ว)</span>' : ''}</label>`).join('')}
                </div>` : ''}
                <div class="space-y-1.5 mb-3">
                    ${s ? `<button onclick="RoadMaster._useStore('${esc(day)}','${which}','${esc(s.id)}')"
                        class="w-full text-left bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-2 text-xs">
                        📌 ใช้ร้าน${which === 'start' ? 'แรก' : 'สุดท้าย'}ของวัน — <b>${esc(s.name)}</b></button>` : ''}
                    <button onclick="RoadMaster._pickOnMap('${esc(day)}','${which}')"
                        class="w-full text-left bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-2 text-xs">
                        🗺️ ปักหมุดบนแผนที่</button>
                </div>
                <label class="text-[11px] font-bold text-gray-500">หรือวางพิกัด / ลิงก์ Google Maps</label>
                <input id="rm-ll" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm mb-2"
                       placeholder="16.4322, 102.8236" value="${cur ? cur.lat + ', ' + cur.lng : ''}">
                <label class="text-[11px] font-bold text-gray-500">ชื่อเรียก</label>
                <input id="rm-nm" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                       placeholder="เช่น คลังขอนแก่น / ที่พักภูเวียง" value="${cur ? esc(cur.name || '') : ''}">
                <p class="text-[10px] text-gray-400 mt-2">เว้นช่องพิกัดว่างแล้วกดตกลง = ล้างจุดนี้${dates.length > 1 ? ' (ล้างเฉพาะครั้ง = กลับไปใช้ค่าของทุกครั้ง)' : ''}</p>`;
            // V0.9.10: หน้าต่างรายวันอยู่ชั้นบนกว่า — ปิดไว้ก่อน ให้หน้าใส่จุดขึ้นมาข้างหน้า แล้วเปิดกลับเมื่อเสร็จ/ยกเลิก
            const dm = document.getElementById('dayModal');
            const wasOpen = !!(dm && !dm.classList.contains('hidden'));
            if (wasOpen) dm.classList.add('hidden');
            const back = () => { if (wasOpen) { try { UI.showDayModal(day); } catch (e) {} } };
            M._modal((which === 'start' ? '🚩 จุดเริ่ม' : '🏁 จุดจบ') + ' — ' +
                     ((typeof DAY_COLORS !== 'undefined' && DAY_COLORS[day]) ? DAY_COLORS[day].name : day), html,
                async () => {
                    const raw = (document.getElementById('rm-ll').value || '').trim();
                    const nm = (document.getElementById('rm-nm').value || '').trim();
                    const p = M.parseLatLng(raw);
                    const atEl = document.querySelector('input[name="rm-at"]:checked');
                    await M.setPoint(route, day, which, p ? { ...p, name: nm } : null, atEl ? atEl.value : '');
                    M.render(); back();
                }, back);
        },

 /** V1.0.3: สลับ "ทุกครั้ง / เฉพาะครั้ง" ในหน้าใส่จุด → เติมค่าที่ตั้งไว้ของขอบเขตนั้น */
        _pmScope(date) {
            const c = M._pmCtx; if (!c) return;
            const p = date ? M._at(c.route, c.day, date)[c.which] : M._cy(c.route, c.day)[c.which];
            const ll = document.getElementById('rm-ll'), nm = document.getElementById('rm-nm');
            if (ll) ll.value = valid(p) ? p.lat + ', ' + p.lng : '';
            if (nm) nm.value = valid(p) ? (p.name || '') : '';
        },

        /** รับได้ทั้ง "16.43, 102.82" และลิงก์ Google Maps ที่มี @lat,lng หรือ !3dlat!4dlng */
        parseLatLng(txt) {
            if (!txt) return null;
            let m = txt.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
            if (!m) m = txt.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (!m) m = txt.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
            if (!m) return null;
            const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
            return (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null;
        },

        async _useStore(day, which, id) {
            const s = (State.stores || []).find(x => String(x.id) === String(id));
            if (!s) return;
            const at = M._atSel();
            M._closeModal();
            await M.setPoint(State.localActiveRoute, day, which, { lat: s.lat, lng: s.lng, name: s.name }, at);
            M.render(); UI.showDayModal(day);
            try { if (typeof PlanOverview !== 'undefined' && PlanOverview._distClear) PlanOverview._distClear(); } catch (e) {}
        },

        /** V1.0.3: ขอบเขตที่เลือกในหน้าใส่จุด ('' = ทุกครั้ง) */
        _atSel() { const el = document.querySelector('input[name="rm-at"]:checked'); return el ? el.value : ''; },
        _pickOnMap(day, which) {
            const at = M._atSel();
            M._closeModal();
            const modal = document.getElementById('dayModal');
            if (modal) modal.classList.add('hidden');
            const banner = document.createElement('div');
            banner.id = 'rm-pick-banner';
            banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900 text-white px-4 py-2 rounded-full text-xs font-bold shadow-2xl';
            banner.innerHTML = 'คลิกบนแผนที่เพื่อวางจุด — กด ESC หรือ <button id="rm-pick-cancel" class="underline">ยกเลิก</button> แล้วกลับหน้าต่างรายวัน';
            document.body.appendChild(banner);
            const map = MapCtrl.map;
            const done = () => {
                banner.remove();
                map.off('click', onClick);
                document.removeEventListener('keydown', onKey);
                map.getContainer().style.cursor = '';
            };
            const onClick = async (e) => {
                done();
                await M.setPoint(State.localActiveRoute, day, which,
                    { lat: e.latlng.lat, lng: e.latlng.lng, name: '' }, at);
                M.render(); UI.showDayModal(day);
            };
            const onKey = (e) => { if (e.key === 'Escape') { done(); UI.showDayModal(day); } };
            const cb = document.getElementById('rm-pick-cancel');
            if (cb) cb.onclick = (ev) => { ev.stopPropagation(); done(); UI.showDayModal(day); };
            map.getContainer().style.cursor = 'crosshair';
            map.on('click', onClick);
            document.addEventListener('keydown', onKey);
        },

        baseModal() {
            const route = State.localActiveRoute;
            const b = M.base(route);
            const known = (typeof RoadDist !== 'undefined') ? RoadDist.depots : [];
            const html = `
                ${known.length ? `
                <label class="text-[11px] font-bold text-gray-500">จุดที่มีระยะถนนจริงในตารางแล้ว</label>
                <select id="rm-known" onchange="RoadMaster._pickKnown(this.value)"
                        class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm mb-2">
                    <option value="">— กรอกพิกัดเอง (ขาเดินทางจะเป็นค่าประมาณ) —</option>
                    ${known.map((d, i) => `<option value="${i}" ${b && b.code === d.code ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
                </select>` : ''}
                <p class="text-xs text-gray-500 mb-3 leading-snug">
                    จุดที่สาย ${esc(route)} ออกและกลับเป็นปกติ (คลัง / จุดจอดรถ / บ้านเซล)<br>
                    ตั้งไว้แล้วทุกวันในสายนี้จะใช้จุดนี้ ยกเว้นวันที่ระบุจุดเฉพาะไว้เอง<br>
                    <b>ไม่ตั้งก็ได้</b> — ระยะจะเป็นระยะระหว่างร้านอย่างเดียว
                </p>
                <label class="text-[11px] font-bold text-gray-500">พิกัด / ลิงก์ Google Maps</label>
                <input id="rm-ll" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm mb-2"
                       placeholder="16.4322, 102.8236" value="${b ? b.lat + ', ' + b.lng : ''}">
                <label class="text-[11px] font-bold text-gray-500">ชื่อเรียก</label>
                <input id="rm-nm" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                       placeholder="เช่น คลังขอนแก่น" value="${b ? esc(b.name || '') : ''}">
                <p class="text-[10px] text-gray-400 mt-2">เว้นช่องพิกัดว่างแล้วกดตกลง = ล้างจุดประจำสาย (เฉพาะสายนี้)</p>
                <div class="mt-3 border-t border-gray-100 pt-2">
                    <label class="text-[11px] font-bold text-gray-500">ใช้จุดนี้กับ</label>
                    <div class="flex flex-col gap-1 mt-1 text-xs text-gray-700">
                        <label class="flex items-center gap-1.5"><input type="radio" name="rm-scope" value="one" checked> เฉพาะสาย ${esc(route)}</label>
                        <label class="flex items-center gap-1.5"><input type="radio" name="rm-scope" value="empty"> ทุกสายในศูนย์ที่ยังไม่ได้ตั้งจุดประจำสาย (${M._routes().filter(r => !M.base(r)).length} สาย)</label>
                        <label class="flex items-center gap-1.5"><input type="radio" name="rm-scope" value="all"> ทุกสายในศูนย์ — ทับของเดิม (${M._routes().length} สาย)</label>
                    </div>
                </div>
                <div class="mt-3 border-t border-gray-100 pt-2">
                    <label class="text-[11px] font-bold text-gray-500">หลายสายคนละจุด — ใช้ไฟล์ Excel</label>
                    <div class="flex gap-1.5 mt-1">
                        <button type="button" onclick="RoadMaster.baseTemplate()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 rounded-lg text-[11px] font-bold">⬇️ ดาวน์โหลดแบบฟอร์ม</button>
                        <label class="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 py-1.5 rounded-lg text-[11px] font-bold text-center cursor-pointer">⬆️ นำเข้าจาก Excel
                            <input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="RoadMaster.baseImport(this.files[0]); this.value=''"></label>
                    </div>
                    <p class="text-[10px] text-gray-400 mt-1 leading-snug">คอลัมน์: สาย · Latitude · Longitude (กรอกช่องสีเหลือง · ไม่ต้องตั้งชื่อจุด) — แถวที่พิกัดว่างไม่แตะสายนั้น</p>
                </div>
                <div class="mt-3 border-t border-gray-100 pt-2">
                    <label class="text-[11px] font-bold text-gray-500">จุดเริ่ม–จุดจบรายวัน (ทุกสาย ทุก Day) — ใช้ไฟล์ Excel</label>
                    <div class="flex gap-1.5 mt-1">
                        <button type="button" onclick="RoadMaster.dayTemplate()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 rounded-lg text-[11px] font-bold">⬇️ ดาวน์โหลดฟอร์มรายวัน</button>
                        <label class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 py-1.5 rounded-lg text-[11px] font-bold text-center cursor-pointer">⬆️ นำเข้าฟอร์มรายวัน
                            <input type="file" accept=".xlsx,.xls" class="hidden" onchange="RoadMaster.dayImport(this.files[0]); this.value=''"></label>
                    </div>
                    <p class="text-[10px] text-gray-400 mt-1 leading-snug">กรอก Lat / Long ช่องสีเหลือง · ฟอร์มมีจุดที่ตั้งไว้แล้วให้ · ลบค่าในช่อง = ล้างจุด · ลบทั้งแถว = ไม่แตะ · Day ที่ไม่ตั้ง → จุดประจำสาย → ร้านแรก/ร้านสุดท้าย · ระบบสรุปให้ดูก่อนบันทึก</p>
                </div>`;
            M._modal('📍 จุดประจำสาย ' + esc(route), html, async () => {
                const sel = document.getElementById('rm-known');
                const picked = (sel && sel.value !== '') ? RoadDist.depots[+sel.value] : null;
                const scopeEl = document.querySelector('input[name="rm-scope"]:checked');
                const scope = scopeEl ? scopeEl.value : 'one';
                let pt = null;
                if (picked) pt = { lat: picked.lat, lng: picked.lng, name: picked.name, code: picked.code };
                else {
                    const p = M.parseLatLng((document.getElementById('rm-ll').value || '').trim());
                    const nm = (document.getElementById('rm-nm').value || '').trim();
                    pt = p ? { ...p, name: nm } : null;
                }
                if (scope !== 'one') {
                    // V1.0.3: ตั้งจุดเดียวกันให้หลายสาย
                    if (!pt) { UI.showErrorToast('⚠️ ใส่พิกัดหรือเลือกจุดก่อน (ล้างจุดได้ทีละสาย)'); return; }
                    const list = M._routes().filter(r => scope === 'all' || !M.base(r) || r === route);
                    if (scope === 'all' && !confirm(`ตั้งจุด "${pt.name || (pt.lat + ', ' + pt.lng)}" เป็นจุดประจำสายของทุกสาย (${list.length} สาย) — สายที่ตั้งไว้แล้วจะถูกทับ\n\nยืนยัน?`)) return;
                    State.db.routeBase = State.db.routeBase || {};
                    list.forEach(r => { State.db.routeBase[r] = { lat: +pt.lat, lng: +pt.lng, name: pt.name || '', code: pt.code || '' }; });
                    await M._persist();
                    M.render();
                    UI.showSaveToast(`📍 ตั้งจุดประจำสายแล้ว ${list.length} สาย`);
                    return;
                }
                await M.setBase(route, pt);
                M.render();
                UI.showSaveToast(pt ? '📍 ตั้งจุดประจำสายแล้ว' : '📍 ล้างจุดประจำสายแล้ว');
            });
        },

        /** V1.0.3: สายทั้งหมดของศูนย์ (เดือนที่เปิด) */
        _routes() {
            return (State.db.routeList || Object.keys(State.db.routes || {})).filter(r => r && r !== 'รอจัดสาย');
        },
        /** V1.0.3: แบบฟอร์ม Excel จุดประจำสาย — ใส่ค่าที่ตั้งไว้แล้วมาให้ */
        // ── V1.0.4 (12 พ.ย. 2569): ฟอร์ม Excel ทั้ง 2 ไฟล์ ใช้ Latitude / Longitude แยกช่อง · ไม่มีชื่อจุด · ช่องกรอก = เหลือง
        //    (เขียนด้วย ExcelJS เพราะ SheetJS รุ่นฟรีใส่สีไม่ได้ · ไฟล์เก่าแบบ "พิกัด" ช่องเดียว + ชื่อจุด ยังนำเข้าได้)
        _xlP: null,
        _xl() {
            if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
            if (M._xlP) return M._xlP;
            M._xlP = new Promise((resolve, reject) => {
                const el = document.createElement('script');
                el.src = 'vendor/exceljs.min.js';
                el.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('โหลด ExcelJS ไม่สำเร็จ'));
                el.onerror = () => { M._xlP = null; reject(new Error('ไม่พบไฟล์ vendor/exceljs.min.js')); };
                document.head.appendChild(el);
            });
            return M._xlP;
        },
        /** sheets: [{ name, rows (แถวแรก = หัว), widths, edit: [คอลัมน์กรอก], ro: [คอลัมน์ดูอย่างเดียว], freeze: {x, y}, plain: true = ชีทข้อความ }] */
        async _xlWrite(sheets, fileName) {
            const ExcelJS = await M._xl();
            const wb = new ExcelJS.Workbook();
            wb.creator = 'Route Planner';
            const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
            const thin = { style: 'thin', color: { argb: 'FFD9D9D9' } };
            const BOX = { top: thin, left: thin, bottom: thin, right: thin };
            const F = (b, c) => ({ name: 'Tahoma', size: 10, bold: !!b, color: { argb: c || 'FF000000' } });
            const ED_H = 'FFBF8F00', ED = 'FFFFF2CC', RO_H = 'FF595959', RO = 'FFEDEDED', KEY_H = 'FF1F3864';
            sheets.forEach(sh => {
                const ws = wb.addWorksheet(sh.name, sh.freeze ? { views: [{ state: 'frozen', xSplit: sh.freeze.x || 0, ySplit: sh.freeze.y || 0 }] } : {});
                (sh.widths || []).forEach((w, j) => { ws.getColumn(j + 1).width = w; });
                const ed = new Set(sh.edit || []), ro = new Set(sh.ro || []);
                sh.rows.forEach((r, i) => {
                    const row = ws.getRow(i + 1);
                    r.forEach((v, j) => {
                        const c = row.getCell(j + 1);
                        c.value = (v === '' || v == null) ? null : v;
                        if (sh.plain) {
                            c.font = F(i === 0 || (sh.bold || []).includes(i));
                            if (sh.fillRows && sh.fillRows[i] && sh.fillRows[i].includes(j)) c.fill = fill(ED);
                            return;
                        }
                        if (i === 0) {
                            c.font = F(true, 'FFFFFFFF'); c.fill = fill(ed.has(j) ? ED_H : ro.has(j) ? RO_H : KEY_H);
                            c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                            c.note = ed.has(j) ? '✏️ กรอกช่องนี้' : ro.has(j) ? '🔒 ดูอย่างเดียว — ระบบไม่อ่าน' : 'ใช้จับคู่สาย / Day — ไม่ต้องแก้';
                        } else {
                            c.font = F(ed.has(j), ro.has(j) ? 'FF595959' : 'FF000000');
                            if (ed.has(j)) { c.fill = fill(ED); c.numFmt = '0.000000'; } else if (ro.has(j)) c.fill = fill(RO);
                        }
                        c.border = BOX;
                    });
                    if (i === 0 && !sh.plain) row.height = 32;
                });
            });
            const buf = await wb.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = fileName;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        },
        /** ช่อง Lat + ช่อง Long → จุด · ทั้งคู่ว่าง = null · วางพิกัดคู่/ลิงก์ Google Maps ลงช่อง Lat ช่องเดียวก็ได้ · อ่านไม่ได้/ไม่ครบ = 'bad' */
        _llPair(la, ln) {
            la = String(la == null ? '' : la).trim(); ln = String(ln == null ? '' : ln).trim();
            if (!la && !ln) return null;
            let p = null;
            if (la && !ln && /[,\s]|http|maps|@/.test(la)) p = M.parseLatLng(la);
            else if (la && ln) p = { lat: parseFloat(la.replace(/[^0-9.\-]/g, '')), lng: parseFloat(ln.replace(/[^0-9.\-]/g, '')) };
            if (!p || !isFinite(p.lat) || !isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return 'bad';
            return { lat: +p.lat, lng: +p.lng };
        },
        async baseTemplate() {
            try {
                const rows = [['สาย', 'Latitude', 'Longitude']];
                M._routes().sort((a, b) => a.localeCompare(b, 'th', { numeric: true }))
                    .forEach(r => { const b = M.base(r); rows.push([r, b ? +b.lat : '', b ? +b.lng : '']); });
                const help = [
                    ['วิธีกรอกฟอร์มจุดประจำสาย'],
                    [''],
                    ['• 1 แถว = 1 สาย · ระบบใส่จุดประจำสายที่ตั้งไว้ตอนนี้มาให้แล้ว · กรอก/แก้เฉพาะช่องสีเหลือง (Latitude · Longitude)'],
                    ['• Latitude เช่น 16.432200 · Longitude เช่น 102.823600 (วางพิกัดคู่ "16.4322, 102.8236" หรือลิงก์ Google Maps ลงช่อง Latitude ช่องเดียวก็ได้)'],
                    ['• เว้นว่างทั้ง 2 ช่อง = ไม่แตะสายนั้น · ไม่ต้องตั้งชื่อจุด (ระบบแสดงเป็นพิกัด)'],
                    ['• นำเข้า: หน้าต่าง 📍 จุดประจำสาย → ⬆️ นำเข้าจาก Excel'],
                ];
                await M._xlWrite([
                    { name: 'จุดประจำสาย', rows, widths: [12, 16, 16], edit: [1, 2], freeze: { x: 1, y: 1 } },
                    { name: 'วิธีกรอก', rows: help, widths: [120], plain: true },
                ], `จุดประจำสาย_${window.CENTER_ID || 'ศูนย์'}.xlsx`);
            } catch (e) { UI.showErrorToast('❌ สร้างแบบฟอร์มไม่สำเร็จ: ' + (e && e.message)); }
        },
        /** V1.0.3: นำเข้าจุดประจำสายจาก Excel — คอลัมน์ สาย · ชื่อจุด · Latitude · Longitude (หรือ พิกัด) */
        async baseImport(file) {
            if (!file) return;
            if (typeof XLSX === 'undefined') return UI.showErrorToast('❌ ไม่พบตัวอ่าน Excel');
            try {
                const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
                const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
                const hi = aoa.findIndex(r => r.some(c => /^(สาย|route|salesman)/i.test(String(c).trim())));
                if (hi < 0) throw new Error('ไม่พบหัวคอลัมน์ "สาย"');
                const H = aoa[hi].map(c => String(c).trim().toLowerCase());
                const col = (re) => H.findIndex(h => re.test(h));
                const cR = col(/^(สาย|route|salesman)/), cN = col(/ชื่อ|name/), cLa = col(/^lat|ละติจูด/), cLn = col(/^(lng|lon)|ลองจิจูด/), cLL = col(/พิกัด|coord|google/);
                const known = new Set(M._routes());
                let ok = 0; const unknown = [], bad = [];
                State.db.routeBase = State.db.routeBase || {};
                aoa.slice(hi + 1).forEach((r, i) => {
                    const rt = String(r[cR] || '').trim();
                    if (!rt) return;
                    let p = null;
                    if (cLa >= 0) p = M._llPair(r[cLa], cLn >= 0 ? r[cLn] : '');
                    if (!p && cLL >= 0 && String(r[cLL]).trim()) p = M.parseLatLng(String(r[cLL]).trim()) || 'bad';
                    if (!p) return;                                   // พิกัดว่าง = ไม่แตะสายนี้
                    if (!known.has(rt)) { unknown.push(rt); return; }
                    if (p === 'bad' || !isFinite(p.lat) || !isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) { bad.push(`แถว ${hi + i + 2} (${rt})`); return; }
                    // V1.0.4: ฟอร์มใหม่ไม่มีชื่อจุด — พิกัดเดิม = คงชื่อ/รหัสเดิมไว้
                    const old = M.base(rt);
                    if (cN < 0 && old && Math.abs(old.lat - p.lat) < 1e-6 && Math.abs(old.lng - p.lng) < 1e-6) { ok++; return; }
                    State.db.routeBase[rt] = { lat: +p.lat, lng: +p.lng, name: cN >= 0 ? String(r[cN] || '').trim() : '', code: '' };
                    ok++;
                });
                await M._persist();
                M._closeModal(); M.render(); UI.render();
                const extra = (unknown.length ? ` · ไม่พบสาย ${unknown.length} (${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''})` : '')
                            + (bad.length ? ` · พิกัดผิด ${bad.length} (${bad.slice(0, 3).join(', ')})` : '');
                (ok ? UI.showSaveToast : UI.showErrorToast)(`📍 นำเข้าจุดประจำสาย ${ok} สาย${extra}`);
            } catch (e) { UI.showErrorToast('❌ นำเข้าไม่สำเร็จ: ' + (e && e.message)); }
        },

        // ── V1.0.3: ฟอร์มจุดเริ่ม–จุดจบรายวัน (ทุกสายในไฟล์เดียว) ─────────────
        _dk(v) {                                                   // "D3" / "3" / "Day 3" → "Day 3"
            const n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
            return n > 0 ? 'Day ' + n : '';
        },
        _ll(p) { return valid(p) ? `${+(+p.lat).toFixed(6)}, ${+(+p.lng).toFixed(6)}` : ''; },
        _same(a, b) {
            if (!valid(a) && !valid(b)) return true;
            if (!valid(a) || !valid(b)) return false;
            return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6 && (a.name || '') === (b.name || '');
        },
        /** วันที่จากฟอร์ม → 'YYYY-MM-DD' ที่ตรงกับวันวิ่งจริงของ Day นั้น (เทียบแค่วัน+เดือน) */
        _matchDate(v, isoList) {
            if (v === '' || v == null) return '';
            let d = null, m = null;
            if (v instanceof Date) { d = v.getDate(); m = v.getMonth() + 1; }
            else if (typeof v === 'number' && v > 20000) { const x = new Date(Math.round((v - 25569) * 86400000)); d = x.getUTCDate(); m = x.getUTCMonth() + 1; }
            else {
                const t = String(v).trim();
                let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
                if (r) { m = +r[2]; d = +r[3]; }
                else if ((r = t.match(/^(\d{1,2})[\/.\-](\d{1,2})/))) { d = +r[1]; m = +r[2]; }
                else if ((r = t.match(/^(\d{1,2})\s*([ก-๙.]+)/))) {
                    d = +r[1];
                    const TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                    const k = TH.findIndex(x => x.replace(/\./g, '') === r[2].replace(/\./g, ''));
                    m = k >= 0 ? k + 1 : null;
                }
            }
            if (!d || !m) return null;
            return isoList.find(x => +x.slice(5, 7) === m && +x.slice(8, 10) === d) || null;
        },
        async dayTemplate() {
          try {
            const H = ['สาย', 'Day', 'เฉพาะวันที่', 'วันที่วิ่ง (ดูอย่างเดียว)', 'ตลาด (ดูอย่างเดียว)',
                       'Lat จุดเริ่ม', 'Long จุดเริ่ม', 'Lat จุดจบ', 'Long จุดจบ', 'ถ้าเว้นว่างจะใช้ (ดูอย่างเดียว)'];
            const la = (p) => valid(p) ? +(+p.lat).toFixed(6) : '', lo = (p) => valid(p) ? +(+p.lng).toFixed(6) : '';
            const rows = [H];
            const R = State.db.routes || {};
            M._routes().sort((a, b) => a.localeCompare(b, 'th', { numeric: true })).forEach(rt => {
                const list = R[rt] || [];
                const bs = M.base(rt);
                const fb = bs ? `จุดประจำสาย: ${M._ll(bs)}${bs.name ? ' (' + bs.name + ')' : ''}` : 'ร้านแรก / ร้านสุดท้าย (ไม่คิดขาเดินทาง)';
                M.daysOf(rt, list).forEach(day => {
                    const rec = M._cy(rt, day);
                    const ds = M._dates(rt, day);
                    const dk = 'D' + dayNum(day);
                    const mk = M.marketName(rt, day, list);
                    rows.push([rt, dk, '', ds.map(M._shortD).join(', '), mk,
                        la(rec.start), lo(rec.start), la(rec.end), lo(rec.end), fb]);
                    Object.keys(rec.at || {}).sort().forEach(d => {
                        const a = rec.at[d] || {};
                        const p = d.split('-');
                        rows.push([rt, dk, `${+p[2]}/${+p[1]}/${p[0]}`, '', mk,
                            la(a.start), lo(a.start), la(a.end), lo(a.end), 'ค่าของแถว "ทุกครั้ง" ข้างบน']);
                    });
                });
            });
            const help = [
                ['วิธีกรอกฟอร์มจุดเริ่ม–จุดจบรายวัน'],
                [''],
                ['• 1 แถว = 1 สาย × 1 Day · ระบบใส่จุดที่ตั้งไว้ตอนนี้มาให้แล้ว · กรอก/แก้เฉพาะช่องสีเหลือง (Lat / Long ของจุดเริ่มและจุดจบ)'],
                ['• Lat เช่น 14.040000 · Long เช่น 100.520000 (วางพิกัดคู่ "14.04, 100.52" หรือลิงก์ Google Maps ลงช่อง Lat ช่องเดียวก็ได้) · ไม่ต้องตั้งชื่อจุด'],
                ['• ลบค่าในช่อง Lat + Long = ล้างจุดนั้น → กลับไปใช้จุดประจำสาย ถ้าไม่มีจุดประจำสาย = เริ่มที่ร้านแรก / จบที่ร้านสุดท้าย'],
                ['• ลบทั้งแถวออกจากไฟล์ = ไม่แตะ Day นั้น (จะแก้แค่บางสาย/บางวัน ลบแถวอื่นทิ้งได้เลย)'],
                ['• รอบสั้น (Day เดียววิ่ง 2 ครั้ง): แถวที่ช่อง "เฉพาะวันที่" ว่าง = ใช้กับทุกครั้ง'],
                ['   ถ้าจะให้ครั้งไหนต่างออกไป เพิ่มแถว สาย + Day เดิม แล้วใส่วันที่ของครั้งนั้นในช่อง "เฉพาะวันที่" (เช่น 16/11/2026)'],
                ['• สาย / Day / วันที่ที่ไม่มีในแผน หรือพิกัดอ่านไม่ได้ → ระบบข้ามแถวนั้นและแจ้งให้รู้'],
                ['• คอลัมน์ "(ดูอย่างเดียว)" ระบบไม่อ่าน แก้ไปก็ไม่มีผล'],
                ['• นำเข้า: หน้าต่าง 📍 จุดประจำสาย → ⬆️ นำเข้าฟอร์มรายวัน — ระบบสรุปให้ดูก่อนบันทึก'],
                [''],
                ['ตัวอย่าง', '', '', '', '', '', '', '', '', ''],
                H,
                ['301P01', 'D1', '', '2 พ.ย., 16 พ.ย.', 'ตลาดบ้านลาด', 13.0921, 99.9502, 12.8001, 99.9672, ''],
                ['301P01', 'D1', '16/11/2026', '', 'ตลาดบ้านลาด', 12.8001, 99.9672, '', '', ''],
            ];
            const ym = (App._currentPlanYM || '').replace('_', '-');
            await M._xlWrite([
                { name: 'จุดรายวัน', rows, widths: [9, 6, 12, 18, 24, 13, 13, 13, 13, 40], edit: [5, 6, 7, 8], ro: [3, 4, 9], freeze: { x: 2, y: 1 } },
                { name: 'วิธีกรอก', rows: help, widths: [9, 6, 12, 18, 22, 13, 13, 13, 13, 10], plain: true,
                  bold: [0, help.length - 3], fillRows: { [help.length - 2]: [5, 6, 7, 8], [help.length - 1]: [5, 6] } },
            ], `จุดเริ่มจบรายวัน_${window.CENTER_ID || 'ศูนย์'}_${ym}.xlsx`);
          } catch (e) { UI.showErrorToast('❌ สร้างฟอร์มไม่สำเร็จ: ' + (e && e.message)); }
        },
        /** อ่านฟอร์ม → แผนการเปลี่ยน (ยังไม่บันทึก) */
        _dayParse(aoa) {
            const hi = aoa.findIndex(r => r.some(c => /^สาย$|^route$/i.test(String(c).trim())) && r.some(c => /^day$|^วัน$/i.test(String(c).trim())));
            if (hi < 0) throw new Error('ไม่พบหัวคอลัมน์ "สาย" และ "Day" (ใช้แบบฟอร์มที่ดาวน์โหลดจากระบบ)');
            const H = aoa[hi].map(c => String(c).trim());
            const col = (re) => H.findIndex(h => re.test(h));
            const cR = col(/^(สาย|route)$/i), cD = col(/^(day|วัน)$/i), cAt = col(/^เฉพาะวันที่/);
            const cSN = col(/^ชื่อจุดเริ่ม/), cSL = col(/^พิกัดจุดเริ่ม/), cEN = col(/^ชื่อจุดจบ/), cEL = col(/^พิกัดจุดจบ/);
            // V1.0.4: ฟอร์มใหม่ Lat / Long แยกช่อง (ไม่มีชื่อจุด) · ฟอร์มเก่า (ชื่อ + พิกัดช่องเดียว) ยังอ่านได้
            const cSLa = col(/^lat.*เริ่ม/i), cSLn = col(/^(long|lng|lon).*เริ่ม/i), cELa = col(/^lat.*จบ/i), cELn = col(/^(long|lng|lon).*จบ/i);
            if (cSL < 0 && cEL < 0 && cSLa < 0 && cELa < 0) throw new Error('ไม่พบคอลัมน์ "Lat จุดเริ่ม" / "Lat จุดจบ" (ใช้แบบฟอร์มที่ดาวน์โหลดจากระบบ)');
            const R = State.db.routes || {};
            const known = new Set(M._routes());
            const txt = (r, c) => c >= 0 ? String(r[c] == null ? '' : r[c]).trim() : '';
            const changes = new Map();          // key → {route, day, at, which, point|null, label}
            const skip = [], dup = [];
            const seen = new Map();
            let rowsRead = 0;
            aoa.slice(hi + 1).forEach((r, i) => {
                const line = hi + i + 2;
                const rt = txt(r, cR);
                if (!rt) return;
                if (/^ตัวอย่าง/.test(rt)) return;
                rowsRead++;
                if (!known.has(rt)) { skip.push(`แถว ${line}: ไม่มีสาย "${rt}"`); return; }
                const day = M._dk(r[cD]);
                const list = R[rt] || [];
                if (!day || !M.daysOf(rt, list).includes(day)) { skip.push(`แถว ${line}: ${rt} ไม่มี Day "${txt(r, cD)}" ในแผน`); return; }
                let at = '';
                const rawAt = cAt >= 0 ? r[cAt] : '';
                if (rawAt !== '' && rawAt != null && String(rawAt).trim() !== '') {
                    const isoL = M._dates(rt, day).map(M._iso);
                    at = M._matchDate(rawAt, isoL);
                    if (!at) { skip.push(`แถว ${line}: ${rt} D${dayNum(day)} ไม่ได้วิ่งวันที่ "${txt(r, cAt)}" (วิ่ง ${isoL.map(M._shortIso).join(', ') || '—'})`); return; }
                }
                const k0 = rt + '|' + day + '|' + at;
                if (seen.has(k0)) dup.push(`แถว ${line} ซ้ำกับแถว ${seen.get(k0)} (${rt} D${dayNum(day)}${at ? ' ' + M._shortIso(at) : ''}) — ใช้แถวล่าสุด`);
                seen.set(k0, line);
                [['start', cSN, cSL, cSLa, cSLn], ['end', cEN, cEL, cELa, cELn]].forEach(([which, cN, cL, cLa, cLn]) => {
                    if (cL < 0 && cLa < 0) return;
                    const wTxt = which === 'start' ? 'จุดเริ่ม' : 'จุดจบ';
                    const nm = txt(r, cN);
                    let p = null;
                    if (cLa >= 0) {
                        const q = M._llPair(r[cLa], cLn >= 0 ? r[cLn] : '');
                        if (q === 'bad') { skip.push(`แถว ${line}: Lat/Long ${wTxt}อ่านไม่ได้หรือกรอกไม่ครบ "${(txt(r, cLa) + ' ' + txt(r, cLn)).trim().slice(0, 40)}"`); return; }
                        if (q) p = { lat: q.lat, lng: q.lng, name: nm, code: '' };
                    } else {
                        const ll = txt(r, cL);
                        if (ll) {
                            p = M.parseLatLng(ll);
                            if (!p || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) { skip.push(`แถว ${line}: พิกัด${wTxt}อ่านไม่ได้ "${ll.slice(0, 40)}"`); return; }
                            p = { lat: p.lat, lng: p.lng, name: nm, code: '' };
                        } else if (nm) { skip.push(`แถว ${line}: ${wTxt} "${nm}" ไม่มีพิกัด — ไม่แตะช่องนี้`); return; }
                    }
                    const cur = at ? M._at(rt, day, at)[which] : M._cy(rt, day)[which];
                    // คงชื่อ/รหัสเดิมถ้าพิกัดเดิม (เช่น จุดจากตารางระยะถนน) — ฟอร์มใหม่ไม่มีช่องชื่อ = ดูแค่พิกัด
                    const sameLL = p && valid(cur) && Math.abs(p.lat - cur.lat) < 1e-6 && Math.abs(p.lng - cur.lng) < 1e-6;
                    if (sameLL && (cN < 0 || M._same(p, cur))) p = cur;
                    changes.set(k0 + '|' + which, { route: rt, day, at, which, point: p, same: M._same(p, cur), had: valid(cur) });
                });
            });
            const ch = [...changes.values()];
            return {
                rowsRead, skip, dup,
                set: ch.filter(c => !c.same && c.point),
                clear: ch.filter(c => !c.same && !c.point && c.had),
                same: ch.filter(c => c.same).length,
            };
        },
        async dayImport(file) {
            if (!file) return;
            if (typeof XLSX === 'undefined') return UI.showErrorToast('❌ ไม่พบตัวอ่าน Excel');
            let plan;
            try {
                const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
                const sn = wb.SheetNames.find(n => /จุดรายวัน/.test(n)) || wb.SheetNames[0];
                const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true });
                plan = M._dayParse(aoa);
            } catch (e) { return UI.showErrorToast('❌ อ่านฟอร์มไม่สำเร็จ: ' + (e && e.message)); }
            const nm = (c) => `${esc(c.route)} D${dayNum(c.day)}${c.at ? ' (' + esc(M._shortIso(c.at)) + ')' : ''} ${c.which === 'start' ? '🚩' : '🏁'}`;
            const li = (arr, max) => arr.slice(0, max).map(x => `<li>${x}</li>`).join('') + (arr.length > max ? `<li>… อีก ${arr.length - max}</li>` : '');
            const html = `
                <p class="text-xs text-gray-500 mb-2">อ่านฟอร์มได้ ${plan.rowsRead} แถว — ตรวจก่อนบันทึก</p>
                <div class="grid grid-cols-3 gap-1.5 text-center mb-2">
                    <div class="bg-emerald-50 border border-emerald-200 rounded-lg py-1.5"><div class="text-lg font-black text-emerald-700">${plan.set.length}</div><div class="text-[10px] text-emerald-700">ตั้ง/เปลี่ยนจุด</div></div>
                    <div class="bg-rose-50 border border-rose-200 rounded-lg py-1.5"><div class="text-lg font-black text-rose-700">${plan.clear.length}</div><div class="text-[10px] text-rose-700">ล้างจุด</div></div>
                    <div class="bg-gray-50 border border-gray-200 rounded-lg py-1.5"><div class="text-lg font-black text-gray-600">${plan.skip.length}</div><div class="text-[10px] text-gray-500">ข้าม</div></div>
                </div>
                <div style="max-height:46vh;overflow-y:auto" class="text-[11px] leading-snug space-y-2">
                    ${plan.set.length ? `<div><b class="text-emerald-700">ตั้ง/เปลี่ยน</b><ul class="list-disc pl-4">${li(plan.set.map(c => nm(c) + ' → ' + esc(c.point.name || M._ll(c.point))), 30)}</ul></div>` : ''}
                    ${plan.clear.length ? `<div><b class="text-rose-700">ล้าง (ช่องถูกลบจนว่าง)</b><ul class="list-disc pl-4">${li(plan.clear.map(nm), 30)}</ul>
                        <p class="text-[10px] text-gray-400">ล้างแล้วจะใช้จุดประจำสาย ถ้าไม่มี = เริ่มที่ร้านแรก / จบที่ร้านสุดท้าย</p></div>` : ''}
                    ${plan.skip.length ? `<div><b class="text-gray-600">ข้าม</b><ul class="list-disc pl-4 text-gray-500">${li(plan.skip.map(esc), 30)}</ul></div>` : ''}
                    ${plan.dup.length ? `<div><b class="text-amber-700">แถวซ้ำ</b><ul class="list-disc pl-4 text-amber-700">${li(plan.dup.map(esc), 10)}</ul></div>` : ''}
                    ${!plan.set.length && !plan.clear.length ? '<p class="text-gray-500">ไม่มีอะไรเปลี่ยน — ค่าในฟอร์มตรงกับระบบอยู่แล้ว</p>' : ''}
                </div>`;
            M._modal('📋 นำเข้าฟอร์มจุดรายวัน', html, async () => {
                if (!plan.set.length && !plan.clear.length) return;
                plan.set.concat(plan.clear).forEach(c => M._put(c.route, c.day, c.which, c.point, c.at));
                await M._persist(); await M._flush();
                M.render(); try { UI.render(); } catch (e) {}
                try { if (typeof PlanOverview !== 'undefined' && PlanOverview._distClear) PlanOverview._distClear(); } catch (e) {}
                UI.showSaveToast(`📋 บันทึกจุดรายวันแล้ว — ตั้ง ${plan.set.length} · ล้าง ${plan.clear.length}${plan.skip.length ? ' · ข้าม ' + plan.skip.length : ''}`);
            });
            const ok = document.getElementById('rm-ok');
            if (ok) ok.textContent = (plan.set.length || plan.clear.length) ? 'บันทึก' : 'ปิด';
            const box = document.querySelector('#rm-modal > div');
            if (box) box.style.maxWidth = '30rem';
        },

        _pickKnown(i) {
            const d = (i === '') ? null : RoadDist.depots[+i];
            const ll = document.getElementById('rm-ll'), nm = document.getElementById('rm-nm');
            if (d && ll) { ll.value = d.lat + ', ' + d.lng; if (nm) nm.value = d.name; }
        },

        roadModal() {
            const on = (typeof RoadDist !== 'undefined' && RoadDist.ready);
            const i = on ? RoadDist.info : null;
            const html = `
                <p class="text-xs text-gray-500 mb-3 leading-snug">
                    ตารางระยะถนนคือไฟล์ <code>road-matrix.bin</code> ที่สร้างไว้ล่วงหน้าจากแผนที่ OpenStreetMap<br>
                    โหลดเข้าครั้งเดียวแล้วระบบจำไว้ ใช้งานต่อได้โดยไม่ต้องต่อเน็ต
                </p>
                ${on ? `<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 mb-3">
                    <b>โหลดแล้ว</b><br>
                    สร้างเมื่อ ${i.built} · ร้าน ${i.nStore.toLocaleString()} · คู่ที่เก็บ ${i.pairs.toLocaleString()}<br>
                    รัศมี ${i.radiusKm} กม. · คู่ที่ไกลเกินตารางใช้เส้นตรง × ${i.fallbackFactor}
                   </div>`
                  : `<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-3">
                    <b>ยังไม่ได้โหลด</b> — ตอนนี้ระยะทั้งหมดคิดเป็นเส้นตรง ซึ่งสั้นกว่าระยะวิ่งจริง
                   </div>`}
                <input type="file" id="roadmx-file" accept=".bin" class="w-full text-xs mb-2">
                <p class="text-[11px] text-gray-400">เลือกไฟล์ road-matrix.bin แล้วกดตกลง</p>`;
            M._modal('🛣️ ตารางระยะถนน', html, async () => {
                const f = document.getElementById('roadmx-file').files[0];
                if (!f) return;
                UI.showLoader('กำลังอ่านตารางระยะถนน...', f.name);
                try {
                    const info = await RoadDist.use(await f.arrayBuffer());
                    UI.hideLoader();
                    UI.showSaveToast(`🛣️ โหลดแล้ว ${info.nStore.toLocaleString()} ร้าน`);
                    M.render(); UI.render();
                } catch (e) { UI.hideLoader(); UI.showErrorToast('❌ ' + e.message); }
            });
        },

        _closeModal() {
            const el = document.getElementById('rm-modal');
            if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
        },
        _modal(title, bodyHTML, onOK, onCancel) {
            let el = document.getElementById('rm-modal');
            if (!el) {
                el = document.createElement('div');
                el.id = 'rm-modal';
                // V0.9.10: ชั้นบนกว่าหน้าต่างรายวัน (z 9999) — เดิมเปิดแล้วไปอยู่ข้างหลัง กดเริ่ม/จบแล้วเหมือนไม่มีอะไรขึ้น
                el.className = 'fixed inset-0 bg-black/40 z-[10000] hidden items-center justify-center p-4';
                el.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-4">
                        <h3 id="rm-title" class="font-black text-gray-800 mb-2"></h3>
                        <div id="rm-body"></div>
                        <div class="flex gap-2 mt-3">
                            <button id="rm-cancel" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-xl text-sm font-bold">ยกเลิก</button>
                            <button id="rm-ok" class="flex-1 bg-gray-900 hover:bg-black text-white py-2 rounded-xl text-sm font-bold">ตกลง</button>
                        </div></div>`;
                document.body.appendChild(el);
            }
            document.getElementById('rm-title').textContent = title;
            document.getElementById('rm-ok').textContent = 'ตกลง';                 // V1.0.3: หน้าต่างนำเข้าเปลี่ยนข้อความ/ความกว้าง — คืนค่าทุกครั้ง
            el.firstElementChild.style.maxWidth = '';
            document.getElementById('rm-body').innerHTML = bodyHTML;
            document.getElementById('rm-cancel').onclick = () => { M._closeModal(); if (onCancel) onCancel(); };
            document.getElementById('rm-ok').onclick = async () => { M._closeModal(); await onOK(); };
            el.classList.remove('hidden'); el.classList.add('flex');
        },
    };

    // ── ต่อเข้ากับระบบ ──────────────────────────────────────────────────
    window.addEventListener('beforeunload', () => { if (M._timer) M._flush(); });
    document.addEventListener('DOMContentLoaded', () => {

        // ล้างจุดตั้งต้นแบบเก่าที่ระบบเคยเดาให้ (เลิกใช้แล้ว — ผู้ใช้ต้องระบุเอง)
        setTimeout(() => {
            if (State.db && (State.db.depot || Object.keys(State.db.routeDepots || {}).length)) {
                State.db.depot = null; State.db.routeDepots = {};
                App.dbRef.set({ depot: null, routeDepots: {} }, { merge: true })
                    .then(() => console.log('[RoadMaster] ล้างจุดตั้งต้นที่ระบบเคยเดาไว้'))
                    .catch(() => {});
            }
        }, 3000);

        const host = document.getElementById('tab4');
        if (host) {
            host.insertAdjacentHTML('afterbegin',
                '<div id="master-km-box" class="bg-white border border-gray-200 rounded-2xl p-3 mb-2 shadow-sm"></div>');
            setTimeout(M.render, 800);
        }

        if (typeof UI !== 'undefined' && UI.render) {
            const orig = UI.render;
            UI.render = function () { const r = orig.apply(this, arguments); try { M.render(); } catch (e) {} return r; };
        }
        document.addEventListener('roaddist:ready', () => { try { M.render(); } catch (e) {} });

        // แทรกแผงชื่อตลาด + จุดเริ่ม/จบ ไว้บนสุดของหน้าต่างรายวัน
        // ห่อทีหลังสุด (setTimeout) เพราะ seq-tools.js โหลดทีหลังและเขียนทับ UI.showDayModal
        setTimeout(() => {
            if (typeof UI === 'undefined' || !UI.showDayModal) return;
            const prev = UI.showDayModal;
            UI.showDayModal = function (d) {
                const r = prev.apply(this, arguments);
                try {
                    const c = document.getElementById('modalContent');
                    if (c) c.insertAdjacentHTML('afterbegin', M.dayPanelHTML(d));
                } catch (e) { console.warn('[RoadMaster]', e); }
                return r;
            };
        }, 0);

        // แนบชีท "ระยะ Master" เข้าไฟล์ที่ Export
        if (typeof FileManager !== 'undefined' && FileManager.exportAllRoutes) {
            const orig = FileManager.exportAllRoutes;
            FileManager.exportAllRoutes = async function () {
                let rows = [];
                try { rows = M.allRows(); } catch (e) { console.warn('[RoadMaster]', e); }
                const realWrite = XLSX.writeFile;
                XLSX.writeFile = function (wb, filename) {
                    try {
                        if (rows.length) {
                            const data = rows.map(r => ({
                                'A': r.route, 'B': r.day, 'C': r.cy || '', 'D': r.market || '', 'E': r.n,
                                'F': km(r.m), 'G': r.n ? Math.round(km(r.m) / r.n * 10) / 10 : '',
                                'H': r.start ? (r.start.name || `${r.start.lat.toFixed(5)}, ${r.start.lng.toFixed(5)}`) : '',
                                'I': r.end ? (r.end.name || `${r.end.lat.toFixed(5)}, ${r.end.lng.toFixed(5)}`) : '',
                                'J': r.m ? Math.round((r.exactM || 0) / r.m * 100) + '%' : '',
                            }));
                            const ws = XLSX.utils.json_to_sheet(data, { header: ['A','B','C','D','E','F','G','H','I','J'] });
                            ['สายวิ่ง','วัน','CY','ชื่อตลาด','จำนวนร้าน','ระยะ Master (กม.)','กม./ร้าน','จุดเริ่ม','จุดจบ','จากตารางถนนจริง']
                                .forEach((t, i) => { ws[String.fromCharCode(65 + i) + '1'] = { v: t, t: 's' }; });
                            ws['!cols'] = [{wch:14},{wch:10},{wch:16},{wch:24},{wch:11},{wch:18},{wch:10},{wch:22},{wch:22},{wch:16}];
                            const tot = rows.reduce((t, r) => t + km(r.m), 0);
                            XLSX.utils.sheet_add_aoa(ws, [
                                [], ['รวมทุกสาย', '', '', '', rows.reduce((t, r) => t + r.n, 0), Math.round(tot * 10) / 10],
                                ['ฐานที่ใช้คำนวณ', M.basis()],
                            ], { origin: -1 });
                            XLSX.utils.book_append_sheet(wb, ws, 'ระยะ Master');
                        }
                    } catch (e) { console.warn('[RoadMaster] แนบชีทระยะ Master ไม่สำเร็จ', e); }
                    return realWrite.call(this, wb, filename);
                };
                try { return await orig.apply(this, arguments); }
                finally {
                    XLSX.writeFile = realWrite;
                    M.freeze(rows).catch(e => console.warn('[RoadMaster]', e));
                }
            };
        }
    });

    return M;
})();
;(window.__RPV=window.__RPV||{})['road-master.js']='1.0.4';

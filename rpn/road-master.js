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
 *  กติกาลูกโซ่: จุดจบของวันนี้ = จุดเริ่มของวันถัดไป (เพราะคนค้างอยู่ตรงนั้น)
 *  ระบุจุดจบวันเดียว ระบบเติมจุดเริ่มวันถัดไปให้เอง ไม่ต้องกรอกซ้ำ
 * ========================================================================== */
const RoadMaster = (() => {
    'use strict';

    const dayNum = d => parseInt(String(d || '').replace(/[^0-9]/g, ''), 10) || 0;
    const km = m => Math.round(m / 100) / 10;
    const valid = p => !!(p && isFinite(p.lat) && isFinite(p.lng));
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const M = {

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
        endOf(route, day) {
            const e = M._cy(route, day).end;
            return valid(e) ? e : M.base(route);
        },
        startOf(route, day, stores) {
            const s = M._cy(route, day).start;
            if (valid(s)) return s;
            const pv = M.prevDay(route, day, stores);
            if (pv) {
                const pe = M._cy(route, pv).end;
                if (valid(pe)) return pe;
            }
            return M.base(route);
        },
        /** จุดเริ่มของวันนี้ถูกสืบทอดมาจากจุดจบของเมื่อวานหรือเปล่า */
        startInherited(route, day, stores) {
            if (valid(M._cy(route, day).start)) return false;
            const pv = M.prevDay(route, day, stores);
            return !!(pv && valid(M._cy(route, pv).end));
        },

        async setPoint(route, day, which, point) {
            State.db.cyPoints = State.db.cyPoints || {};
            State.db.cyPoints[route] = State.db.cyPoints[route] || {};
            const rec = State.db.cyPoints[route][day] = State.db.cyPoints[route][day] || {};
            if (point) rec[which] = { lat: +point.lat, lng: +point.lng, name: point.name || '', code: point.code || '' };
            else delete rec[which];
            if (!rec.start && !rec.end) delete State.db.cyPoints[route][day];
            await M._persist();
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
            clearTimeout(M._timer);
            M._timer = setTimeout(M._flush, 800);
            return Promise.resolve();
        },
        async _flush() {
            clearTimeout(M._timer); M._timer = null;
            try {
                await App.dbRef.set({ cyPoints: State.db.cyPoints || {},
                                      routeBase: State.db.routeBase || {} }, { merge: true });
            } catch (e) { console.warn('[RoadMaster] บันทึกจุดไม่สำเร็จ', e); }
        },

        // ── ชื่อตลาด ─────────────────────────────────────────────────────
        marketName(route, day, stores) {
            const arr = M.storesOfDay(day, stores || State.stores || [], route);
            const withName = arr.find(s => s.marketName);
            return withName ? withName.marketName : '';
        },
        async setMarketName(route, day, name) {
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
            const add = (a, b) => { const r = D(a, b); m += r.m; legs++; if (r.exact) { exactM += r.m; exactLegs++; } };
            const st = M.startOf(route, day, stores), en = M.endOf(route, day);
            if (st) add(st, arr[0]);
            for (let i = 1; i < arr.length; i++) add(arr[i - 1], arr[i]);
            if (en) add(arr[arr.length - 1], en);
            return { n: arr.length, m, legs, exactM, exactLegs, cy: M.cyOf(day, arr),
                     start: st, end: en, hasPoints: !!(st || en) };
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
                ${roadOn && exactPct < 60 ? `
                <div class="bg-amber-50 border border-amber-200 rounded-xl p-2 mb-2 text-[10px] text-amber-800 leading-snug">
                    <b>ตารางระยะถนนไม่ครอบคลุมร้านในสายนี้</b> (ตรงแค่ ${exactPct}%)
                    ระยะส่วนใหญ่จึงเป็นค่าประมาณจากเส้นตรง
                </div>` : ''}
                <div class="max-h-44 overflow-y-auto -mx-1 px-1">
                <table class="w-full text-[11px]">
                    <thead><tr class="text-gray-400 text-left">
                        <th class="font-medium py-0.5">วัน</th><th class="font-medium">ตลาด</th>
                        <th class="font-medium text-right">ร้าน</th>
                        <th class="font-medium text-right">กม.</th><th class="font-medium text-center">จุด</th></tr></thead>
                    <tbody>${rows.map(r => `
                        <tr class="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onclick="UI.showDayModal('${r.day}')">
                            <td class="py-0.5 whitespace-nowrap">${(typeof DAY_COLORS !== 'undefined' && DAY_COLORS[r.day]) ? DAY_COLORS[r.day].name : r.day}</td>
                            <td class="truncate max-w-[110px] text-gray-500">${esc(r.market) || '<span class="text-amber-500">— ยังไม่ตั้งชื่อ</span>'}</td>
                            <td class="text-right tabular-nums">${r.n}</td>
                            <td class="text-right tabular-nums font-bold">${km(r.m).toFixed(1)}</td>
                            <td class="text-center">${r.start ? '🚩' : ''}${r.end ? '🏁' : ''}${!r.start && !r.end ? '<span class="text-gray-300">—</span>' : ''}</td>
                        </tr>`).join('')}</tbody>
                </table></div>
                <div class="flex gap-1 mt-2">
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
            const inh = M.startInherited(route, day, State.stores);
            const pv = M.prevDay(route, day, State.stores);
            const label = p => p ? esc(p.name || (p.lat.toFixed(4) + ', ' + p.lng.toFixed(4))) : '—';
            const cls = 'px-1.5 py-0.5 rounded-md bg-white border border-gray-200 hover:border-gray-400 text-[11px] font-bold';
            return `
            <div class="bg-gray-50 border border-gray-200 rounded-xl p-2 mb-2 text-[11px]">
                <div class="flex items-center gap-1.5 mb-1.5">
                    <span class="text-gray-400 shrink-0">ชื่อตลาด</span>
                    <input id="rm-market" value="${esc(M.marketName(route, day, State.stores))}"
                           placeholder="เช่น ในเมืองร้อยเอ็ด"
                           onchange="RoadMaster.saveMarket('${esc(day)}', this.value)"
                           class="flex-1 min-w-0 border border-gray-200 rounded-md px-1.5 py-0.5 text-[11px]">
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-gray-400">🚩 เริ่ม</span>
                    <button class="${cls}" onclick="RoadMaster.pointMenu('${esc(day)}','start')">${label(st)}</button>
                    ${inh ? `<span class="text-[10px] text-gray-400">(ต่อจาก${(typeof DAY_COLORS !== 'undefined' && DAY_COLORS[pv]) ? DAY_COLORS[pv].name : pv})</span>` : ''}
                    <span class="text-gray-400 ml-1">🏁 จบ</span>
                    <button class="${cls}" onclick="RoadMaster.pointMenu('${esc(day)}','end')">${label(en)}</button>
                    <span class="ml-auto font-black text-gray-700">${km(info.m).toFixed(1)} กม.</span>
                </div>
            </div>`;
        },

        saveMarket(day, name) {
            M.setMarketName(State.localActiveRoute, day, (name || '').trim());
            M.render();
        },

        pointMenu(day, which) {
            const route = State.localActiveRoute;
            const arr = M.storesOfDay(day, State.stores, route);
            const cur = which === 'start' ? M._cy(route, day).start : M._cy(route, day).end;
            const s = which === 'start' ? arr[0] : arr[arr.length - 1];
            const html = `
                <p class="text-xs text-gray-500 mb-3 leading-snug">
                    ${which === 'start' ? 'จุดที่ออกตอนเช้าของวันนี้' : 'จุดที่จบวันนี้ (ถ้าไม่ได้กลับที่เดิม)'}<br>
                    ${which === 'end' ? 'จุดจบของวันนี้จะกลายเป็นจุดเริ่มของวันถัดไปให้อัตโนมัติ' : 'ปล่อยว่างได้ ถ้าไม่ระบุระบบจะไม่คิดขาเดินทาง'}
                </p>
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
                <p class="text-[10px] text-gray-400 mt-2">เว้นช่องพิกัดว่างแล้วกดตกลง = ล้างจุดนี้</p>`;
            M._modal((which === 'start' ? '🚩 จุดเริ่ม' : '🏁 จุดจบ') + ' — ' +
                     ((typeof DAY_COLORS !== 'undefined' && DAY_COLORS[day]) ? DAY_COLORS[day].name : day), html,
                async () => {
                    const raw = (document.getElementById('rm-ll').value || '').trim();
                    const nm = (document.getElementById('rm-nm').value || '').trim();
                    const p = M.parseLatLng(raw);
                    await M.setPoint(route, day, which, p ? { ...p, name: nm } : null);
                    M.render(); UI.showDayModal(day);
                });
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
            M._closeModal();
            await M.setPoint(State.localActiveRoute, day, which, { lat: s.lat, lng: s.lng, name: s.name });
            M.render(); UI.showDayModal(day);
        },

        _pickOnMap(day, which) {
            M._closeModal();
            const modal = document.getElementById('dayModal');
            if (modal) modal.classList.add('hidden');
            const banner = document.createElement('div');
            banner.id = 'rm-pick-banner';
            banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900 text-white px-4 py-2 rounded-full text-xs font-bold shadow-2xl';
            banner.textContent = 'คลิกบนแผนที่เพื่อวางจุด — กด ESC เพื่อยกเลิก';
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
                    { lat: e.latlng.lat, lng: e.latlng.lng, name: '' });
                M.render(); UI.showDayModal(day);
            };
            const onKey = (e) => { if (e.key === 'Escape') { done(); UI.showDayModal(day); } };
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
                <p class="text-[10px] text-gray-400 mt-2">เว้นช่องพิกัดว่างแล้วกดตกลง = ล้างจุดประจำสาย</p>`;
            M._modal('📍 จุดประจำสาย ' + esc(route), html, async () => {
                const sel = document.getElementById('rm-known');
                const picked = (sel && sel.value !== '') ? RoadDist.depots[+sel.value] : null;
                if (picked) {
                    await M.setBase(route, { lat: picked.lat, lng: picked.lng, name: picked.name, code: picked.code });
                    M.render(); UI.showSaveToast('📍 ตั้งจุดประจำสายแล้ว'); return;
                }
                const p = M.parseLatLng((document.getElementById('rm-ll').value || '').trim());
                const nm = (document.getElementById('rm-nm').value || '').trim();
                await M.setBase(route, p ? { ...p, name: nm } : null);
                M.render();
                UI.showSaveToast(p ? '📍 ตั้งจุดประจำสายแล้ว' : '📍 ล้างจุดประจำสายแล้ว');
            });
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
        _modal(title, bodyHTML, onOK) {
            let el = document.getElementById('rm-modal');
            if (!el) {
                el = document.createElement('div');
                el.id = 'rm-modal';
                el.className = 'fixed inset-0 bg-black/40 z-[9998] hidden items-center justify-center p-4';
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
            document.getElementById('rm-body').innerHTML = bodyHTML;
            document.getElementById('rm-cancel').onclick = M._closeModal;
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

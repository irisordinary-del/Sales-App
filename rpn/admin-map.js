// ==========================================
// 🗺️ Map Controller
// ==========================================
const MapCtrl = {
    map: null,
    markers: {},
    roadLayer: null,
    polylines: [],

    init: () => {
        if (MapCtrl.map || !document.getElementById('map')) return;
        MapCtrl.map = L.map('map').setView([14.4745, 100.1222], 10);
        MapCtrl._tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            referrerPolicy: 'strict-origin-when-cross-origin', updateWhenZooming: false, keepBuffer: 4,
            maxZoom: 18,
            attribution: '© OpenStreetMap contributors'
        }).addTo(MapCtrl.map);
    },

    // V0.9.17: ติ๊กเลือกร้านในรายการ → แมพเลื่อนไปหาหมุด (เฉพาะเมื่อหมุดอยู่นอกจอ) + หมุดกะพริบให้เห็น
    //   ไม่เปลี่ยนซูม ยกเว้นซูมออกไกลมาก (< 13) ค่อยซูมเข้าให้เห็นร้านรอบ ๆ · ติ๊กออกไม่เลื่อน
    reveal: (store) => {
        try {
            const map = MapCtrl.map;
            if (!map || !store) return;
            const lat = +store.lat, lng = +store.lng;
            if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) return;
            const ll = L.latLng(lat, lng);
            const inView = map.getBounds().pad(-0.08).contains(ll);
            if (map.getZoom() < 13) map.setView(ll, 15, { animate: true });
            else if (!inView) map.panTo(ll, { animate: true, duration: 0.5 });
            const pulse = (n) => {
                const m = MapCtrl.markers[store.id];
                const el = m && m.getElement && m.getElement();
                if (!el) { if (n > 0) setTimeout(() => pulse(n - 1), 120); return; }
                el.classList.remove('rp-reveal'); void el.offsetWidth; el.classList.add('rp-reveal');
                setTimeout(() => el.classList.remove('rp-reveal'), 1600);
            };
            setTimeout(() => pulse(6), 60);
            if (!document.getElementById('rp-reveal-css')) {
                const st = document.createElement('style'); st.id = 'rp-reveal-css';
                st.textContent = `@keyframes rpReveal{0%{transform:translateY(0) scale(1)}30%{transform:translateY(-10px) scale(1.35)}60%{transform:translateY(0) scale(1)}80%{transform:translateY(-5px) scale(1.15)}100%{transform:translateY(0) scale(1)}}
.leaflet-marker-icon.rp-reveal{z-index:10000!important}.leaflet-marker-icon.rp-reveal>svg{animation:rpReveal 1.4s ease-out;transform-origin:50% 100%}`;
                document.head.appendChild(st);
            }
        } catch (e) { console.warn('[MapCtrl.reveal]', e); }
    },

    // แก้บัค: clearAll ล้าง markers ทั้งหมดก่อน render ใหม่เสมอ
    clearAll: () => {
        if (!MapCtrl.map) return;
        for (const id in MapCtrl.markers) {
            MapCtrl.map.removeLayer(MapCtrl.markers[id]);
        }
        MapCtrl.markers = {};
        MapCtrl.clearRoad(true);
    },

    closePopups: () => {
        for (const id in MapCtrl.markers) {
            if (MapCtrl.markers[id].getPopup()) {
                MapCtrl.markers[id].closePopup();
            }
        }
    },

    clearRoad: (skipRender = false) => {
        if (MapCtrl.roadLayer) MapCtrl.map.removeLayer(MapCtrl.roadLayer);
        MapCtrl.roadLayer = null;
        State.activeRoadDay = null;
        const btn = document.getElementById('clearRoadBtn');
        if (btn) btn.classList.add('hidden');
        if (!skipRender) UI.render();
    },

    drawLines: () => {
        MapCtrl.polylines.forEach(l => MapCtrl.map.removeLayer(l));
        MapCtrl.polylines = [];

        const toggleEl = document.getElementById('toggleLines');
        if (!toggleEl || !toggleEl.checked) return;

        const byDay = {};
        State.stores.forEach(s => {
            // V1.0.4 (11 พ.ย. 2569 11:45): ตลาดที่กำลังโชว์ลำดับ (🔢) ไม่วาดเส้นเชื่อม
            const sv = State.seqView;
            const inSv = sv && s.days && s.days.includes(sv.day) && (s.route || State.localActiveRoute) === sv.route;
            if (s.days && s.days.length && !s.days.includes(State.activeRoadDay) && !inSv) {
                const d = s.days[0];
                if (!byDay[d]) byDay[d] = [];
                byDay[d].push([s.lat, s.lng]);
            }
        });

        Object.keys(byDay).forEach(d => {
            const c = DAY_COLORS[d] ? DAY_COLORS[d].hex : '#999';
            if (byDay[d].length > 1) {
                MapCtrl.polylines.push(
                    L.polyline(byDay[d], { color: c, weight: 3, opacity: 0.5, dashArray: '5, 10' })
                        .addTo(MapCtrl.map)
                );
            }
        });
    },

    fitToStores: () => {
        if (State.stores.length > 0) {
            try {
                MapCtrl.map.fitBounds(
                    L.latLngBounds(State.stores.map(s => [s.lat, s.lng])),
                    { padding: [30, 30] }
                );
            } catch (e) { /* ignore */ }
        }
    },

    renderMarkers: () => {
        const dayOpts = Object.keys(DAY_COLORS)
            .map(d => `<option value="${d}">${DAY_COLORS[d].name}</option>`)
            .join('');

        // V1.0.4 (11 พ.ย. 2569 11:45): โหมด 🔢 โชว์ลำดับ — หมุดของตลาดที่เลือกขึ้นเลขลำดับคิว ร้านอื่นจางลง
        const sv = (State.seqView && State.seqView.route === State.localActiveRoute) ? State.seqView : null;
        const inSv = (st) => !!(sv && !st.inactive && st.days && st.days.includes(sv.day)
                                && (st.route || State.localActiveRoute) === sv.route);
        const svOn = !!(sv && State.stores.some(inSv));

        State.stores.forEach(store => {
            // ✅ ซ่อนร้าน inactive — ยังเก็บใน Firestore แต่ไม่แสดงบนแผนที่
            if (store.inactive) {
                if (MapCtrl.markers[store.id]) {
                    MapCtrl.map.removeLayer(MapCtrl.markers[store.id]);
                    delete MapCtrl.markers[store.id];
                }
                return;
            }
            const isAssigned = store.days && store.days.length > 0;
            let pDay = isAssigned ? store.days[0] : null;
            // V1.0.1: ช่องที่เป็นรอบอื่นของตลาดหลัก (เช่น D14 = D2 รอบ 2) โชว์เลข/สีของตลาดหลัก — ไม่มีเลขเกินรอบให้เห็น
            if (pDay && typeof Runs !== 'undefined' && Runs.metaOf) {
                try { const mt = Runs.metaOf(store.route || State.localActiveRoute, pDay); if (mt && mt.src) pDay = mt.src; } catch (e) {}
            }

            let fill = '#cbd5e1', border = '#fff', stroke = '2', zIdx = 1000;
            if (store.selected) {
                fill = '#facc15'; border = '#ca8a04'; stroke = '3'; zIdx = 2000;
            } else if (isAssigned && DAY_COLORS[pDay]) {
                fill = DAY_COLORS[pDay].hex; zIdx = 500;
            }

            const isR = svOn ? inSv(store) : (isAssigned && store.days.includes(State.activeRoadDay));
            const seqDay = svOn ? sv.day : State.activeRoadDay;
            const seq = isR && store.seqs ? store.seqs[seqDay] : null;
            const svgW = isR ? 30 : (isAssigned ? 26 : 30);
            const svgH = isR ? 44 : (isAssigned ? 36 : 44);
            if (isR) zIdx = 1500;

            const kpi = State.sales[store.id];
            const kpiStar = (kpi && kpi.active)
                ? `<circle cx="20" cy="5" r="5" fill="#10b981" stroke="#fff" stroke-width="1.5"/>`
                : '';

            let iconTxt;
            if (isR && seq) {
                iconTxt = `<circle cx="12" cy="10" r="8" fill="#fff"/><text x="12" y="14" font-size="11" font-weight="900" fill="#000" text-anchor="middle">${seq}</text>`;
            } else if (isAssigned) {
                iconTxt = `<text x="12" y="12" font-size="10" font-family="sans-serif" font-weight="bold" fill="${(typeof Config !== 'undefined' && Config.textOn) ? Config.textOn(fill) : '#fff'}" text-anchor="middle">${String(pDay).replace('Day ', '')}</text>`;
            } else {
                iconTxt = `<circle cx="12" cy="9" r="3.5" fill="#fff"/>`;
            }

            // V1.0.3: ร้านใหม่ (ไม่อยู่แผนเดือนฐาน) — วงเขียวรอบหัวหมุด
            const nwRing = (isAssigned && typeof NewStores !== 'undefined' && NewStores.ringOn && NewStores.isNew(store))
                ? `<circle cx="12" cy="8" r="13.5" fill="rgba(16,185,129,.15)" stroke="#059669" stroke-width="4"/>` : '';
            // V0.9.6: สร้างไอคอนใหม่เฉพาะหมุดที่หน้าตาเปลี่ยน — เดิมทุกครั้งที่ซูม/เลื่อนสร้างใหม่ทุกหมุดในจอ
            const sig = [fill, border, stroke, svgW, svgH, iconTxt, kpiStar, nwRing].join('|');
            const icon = MapCtrl.markers[store.id] && MapCtrl.markers[store.id]._sig === sig ? null : L.divIcon({
                html: `<svg viewBox="0 0 24 24" width="${svgW}" height="${svgH}" style="filter:drop-shadow(0px 3px 4px rgba(0,0,0,0.3));overflow:visible;">
                    ${nwRing}<path d="M12 0C7.5 0 4 3.5 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z" fill="${fill}" stroke="${border}" stroke-width="${stroke}"/>
                    ${iconTxt}${kpiStar}
                </svg>`,
                className: 'custom-svg-icon',
                iconSize: [svgW, svgH],
                iconAnchor: [svgW / 2, svgH],
                popupAnchor: [0, -svgH]
            });

            if (!MapCtrl.markers[store.id]) {
                MapCtrl.markers[store.id] = L.marker([store.lat, store.lng]).addTo(MapCtrl.map);

                // แก้บัค: ใช้ UI.focusOnEditTab ที่นิยามใน admin-ui.js
                MapCtrl.markers[store.id].on('popupopen', function () {
                    if (this.customAssigned) UI.focusOnEditTab(this.customId);
                });

                MapCtrl.markers[store.id].on('click', function () {
                    if (!this.customAssigned && !Lasso.active) {
                        StoreMgr.toggleSelect(this.customId);
                    }
                });
            }

            const m = MapCtrl.markers[store.id];
            m.customId = store.id;
            m.customAssigned = isAssigned;
            if (icon) { m.setIcon(icon); m._sig = sig; m._tinted = null; }
            const op = (svOn && !isR) ? 0.3 : 1;
            if (m._op !== op) { m.setOpacity(op); m._op = op; }
            if (m._zi !== zIdx) { m.setZIndexOffset(zIdx); m._zi = zIdx; }

            const badge = store.freq === 2 ? `<span class="f2-badge">F2</span>` : '';
            const kpiHtml = kpi
                ? (kpi.active
                    ? `<div class="bg-emerald-50 text-emerald-700 px-2 py-1.5 rounded-lg text-[10px] font-bold mt-2 border border-emerald-100 flex justify-between"><span>📦 ${kpi.vpo} ลัง</span><span>🏷️ ${kpi.skuCount} SKU</span></div>`
                    : `<div class="bg-gray-100 text-gray-500 px-2 py-1 rounded-lg text-[10px] font-bold mt-2 text-center border border-gray-200">❌ Inactive</div>`)
                : '';

            if (isAssigned) {
                const dTxt = store.days.join(' & ');
                const drop = dayOpts.replace(`value="${pDay}"`, `value="${pDay}" selected`);
                const html = `
                    <div class="text-sm min-w-[170px]">
                        <b class="text-[14px] text-gray-800 block leading-tight mb-0.5">${store.name} ${badge}</b>
                        <span class="text-gray-400 text-[10px] font-mono block mb-2">ID: ${store.id}</span>
                        <div class="inline-block px-2 py-1 rounded text-white text-[11px] font-bold w-full text-center" style="background:${fill};">📅 ${dTxt}</div>
                        ${kpiHtml}
                        <div class="mt-2 pt-2 border-t border-gray-100">
                            <span class="text-[10px] text-gray-500 font-bold mb-1 block">แก้ไขสายวิ่ง:</span>
                            <select onchange="StoreMgr.changeDay('${store.id}', this.value)" class="w-full text-xs p-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none">
                                ${drop}
                                <option disabled>---</option>
                                <option value="remove" class="text-red-500 font-bold">❌ ยกเลิกจัดสาย</option>
                            </select>
                        </div>
                    </div>`;
                if (m._popHtml !== html) {
                    if (m.getTooltip()) m.unbindTooltip();
                    m._ttHtml = null;
                    if (!m.getPopup()) m.bindPopup(html, { autoPan: false, className: 'custom-popup' });
                    else m.setPopupContent(html);
                    m._popHtml = html;
                }
            } else {
                if (m.getPopup()) m.unbindPopup();
                m._popHtml = null;
                const tooltipContent = `<b>${store.name}</b> ${badge}<br><span class="text-[10px] font-mono text-gray-400">${store.id}</span>${kpiHtml}`;
                if (m._ttHtml !== tooltipContent) {
                    if (!m.getTooltip()) m.bindTooltip(tooltipContent, { direction: 'top', offset: [0, -svgH] });
                    else m.setTooltipContent(tooltipContent);
                    m._ttHtml = tooltipContent;
                }
            }
        });

        // ลบ marker ที่ไม่มีใน State.stores อีกต่อไป
        const storeIds = new Set(State.stores.map(s => s.id));
        Object.keys(MapCtrl.markers).forEach(id => {
            if (!storeIds.has(id)) {
                MapCtrl.map.removeLayer(MapCtrl.markers[id]);
                delete MapCtrl.markers[id];
            }
        });
        try { MapCtrl.seqBox(svOn ? sv : null); } catch (e) {}
        try { MapCtrl.seqPins(svOn ? sv : null); } catch (e) {}
    },

    /** V1.0.4 (11 พ.ย. 2569 11:55): หมุดจุดเริ่ม/จุดจบของตลาดที่โชว์ลำดับ (ไม่มีจุด = ไม่มีหมุด · ที่เดียวกัน = หมุดเดียว) */
    _svPins: null,
    seqPins: (sv) => {
        if (!MapCtrl.map) return;
        const ok = p => !!(p && isFinite(p.lat) && isFinite(p.lng));
        let st = null, en = null, info = null;
        if (sv && typeof RoadMaster !== 'undefined') {
            try { st = RoadMaster.startOf(sv.route, sv.day); en = RoadMaster.endOf(sv.route, sv.day); info = RoadMaster.dayM(sv.route, sv.day, State.stores); } catch (e) {}
        }
        if (!ok(st)) st = null; if (!ok(en)) en = null;
        // V1.0.4 (11 พ.ย. 2569 15:20): ซูมออกกว้าง (< 11) ป้ายย่อเหลือ 🚩/🏁 — หมุดยังอยู่ทุกระดับซูม
        let zoom = 13;
        try { zoom = MapCtrl.map.getZoom(); } catch (e) {}
        const small = zoom < 11;
        const sig = sv && (st || en) ? JSON.stringify([sv, st, en, info && info.outM, info && info.backM, info && info.n, small]) : '';
        if (MapCtrl._svSig === sig) return;
        MapCtrl._svSig = sig;
        if (MapCtrl._svPins) { MapCtrl.map.removeLayer(MapCtrl._svPins); MapCtrl._svPins = null; }
        if (!sig) return;
        const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const km = m => (m == null ? '' : (Math.round(m / 100) / 10).toFixed(1) + ' กม.');
        const nm = p => esc(p.name || (p.lat.toFixed(4) + ', ' + p.lng.toFixed(4)));
        const n = info ? info.n : 0;
        const pin = (glyph, title, sub) => small ? L.divIcon({
            className: '', iconSize: [1, 1], iconAnchor: [13, 36],
            html: `<div style="position:relative;width:1px;height:1px" title="${title.replace(/<[^>]+>/g, '')}">`
                + `<svg viewBox="0 0 24 24" width="26" height="36" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,.35));overflow:visible">`
                + `<path d="M12 0C7.5 0 4 3.5 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z" fill="#1e293b" stroke="#fff" stroke-width="1.5"/>`
                + `<text x="12" y="11.5" font-size="9" text-anchor="middle">${glyph}</text></svg></div>`
        }) : L.divIcon({
            className: '', iconSize: [1, 1], iconAnchor: [16, 44],
            html: `<div style="position:relative;width:1px;height:1px">`
                + `<svg viewBox="0 0 24 24" width="32" height="44" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,.35));overflow:visible">`
                + `<path d="M12 0C7.5 0 4 3.5 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z" fill="#1e293b" stroke="#fff" stroke-width="1.5"/>`
                + `<text x="12" y="11.5" font-size="9" text-anchor="middle">${glyph}</text></svg>`
                + `<div style="position:absolute;left:34px;top:2px;background:#1e293b;color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:8px;white-space:nowrap;line-height:1.45">`
                + `${title}<br><span style="font-weight:400;opacity:.85">${sub}</span></div></div>`
        });
        const marks = [];
        const outTxt = info && info.outM != null ? `ขาออก ${km(info.outM)} (ไปร้านที่ 1)` : '';
        const backTxt = info && info.backM != null ? `ขากลับ ${km(info.backM)} (จากร้านที่ ${n})` : '';
        const same = st && en && Math.abs(st.lat - en.lat) < 1e-6 && Math.abs(st.lng - en.lng) < 1e-6;
        if (same) {
            marks.push(L.marker([st.lat, st.lng], { icon: pin('🚩', `🚩 เริ่ม / 🏁 จบ · ${nm(st)}`, [outTxt, backTxt].filter(Boolean).join(' · ')), zIndexOffset: 4000, interactive: false }));
        } else {
            if (st) marks.push(L.marker([st.lat, st.lng], { icon: pin('🚩', `🚩 เริ่ม · ${nm(st)}`, outTxt), zIndexOffset: 4000, interactive: false }));
            if (en) marks.push(L.marker([en.lat, en.lng], { icon: pin('🏁', `🏁 จบ · ${nm(en)}`, backTxt), zIndexOffset: 4000, interactive: false }));
        }
        MapCtrl._svPins = L.layerGroup(marks).addTo(MapCtrl.map);
    },

    /** V1.0.4 (11 พ.ย. 2569 11:45): กล่องเล็กมุมแผนที่ บอกว่ากำลังโชว์ลำดับของตลาดไหน (ปิดที่ปุ่ม 🔢 หัวตลาด) */
    seqBox: (sv) => {
        if (!MapCtrl.map) return;
        const host = MapCtrl.map.getContainer();
        let el = document.getElementById('seqview-box');
        if (!sv) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'seqview-box';
            el.style.cssText = 'position:absolute;left:56px;top:12px;z-index:401;max-width:320px;background:#fff;border:1px solid #c7d2fe;'
                + 'border-radius:12px;padding:6px 10px;font-size:11.5px;line-height:1.5;color:#1e293b;box-shadow:0 4px 12px rgba(0,0,0,.12);pointer-events:none';
            host.appendChild(el);
        }
        const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        let n = 0, kmTxt = '', mk = '';
        try {
            const info = RoadMaster.dayM(sv.route, sv.day, State.stores);
            n = info.n; kmTxt = (Math.round(info.m / 100) / 10).toFixed(1) + ' กม.';
            mk = RoadMaster.marketName(sv.route, sv.day, State.stores) || '';
        } catch (e) {}
        const dn = (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[sv.day]) ? DAY_COLORS[sv.day].name : sv.day;
        el.innerHTML = `🔢 <b>ลำดับคิว ${esc(sv.route)} · ${esc(dn)}${mk ? ' ' + esc(mk) : ''}</b><br>`
            + `<span style="color:#475569">${n} ร้าน${kmTxt ? ' · ' + kmTxt : ''} · เลขบนหมุด = ลำดับเข้าร้าน</span>`;
    }
};

// ==========================================
// ✏️ Lasso Tool (วาดเลือกพื้นที่)
// ==========================================
const Lasso = {
    active: false,
    pts: [],
    poly: null,
    mkrs: [],

    toggle: () => {
        Lasso.active = !Lasso.active;
        Lasso.active ? Lasso.start() : Lasso.cancel();
    },

    start: () => {
        const lassoPanel = document.getElementById('lassoPanel');
        const mapTools = document.getElementById('mapTools');
        if (lassoPanel) lassoPanel.classList.remove('hidden');
        if (mapTools) mapTools.classList.add('hidden');
        document.getElementById('map').classList.add('draw-cursor');
        MapCtrl.map.on('click', Lasso.addPt);
    },

    addPt: (e) => {
        Lasso.pts.push([e.latlng.lat, e.latlng.lng]);
        Lasso.mkrs.push(
            L.circleMarker(e.latlng, { radius: 4, color: '#ef4444' }).addTo(MapCtrl.map)
        );
        if (Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly);
        Lasso.poly = L.polyline(Lasso.pts, { color: '#4f46e5', weight: 4, dashArray: '5, 8' })
            .addTo(MapCtrl.map);
    },

    cancel: () => {
        Lasso.active = false;
        Lasso.pts = [];
        if (Lasso.poly) MapCtrl.map.removeLayer(Lasso.poly);
        Lasso.poly = null;
        Lasso.mkrs.forEach(m => MapCtrl.map.removeLayer(m));
        Lasso.mkrs = [];

        const lassoPanel = document.getElementById('lassoPanel');
        const mapTools = document.getElementById('mapTools');
        if (lassoPanel) lassoPanel.classList.add('hidden');
        if (mapTools) mapTools.classList.remove('hidden');
        document.getElementById('map').classList.remove('draw-cursor');
        MapCtrl.map.off('click', Lasso.addPt);
    },

    finish: () => {
        if (Lasso.pts.length < 3) return UI.showErrorToast('⚠️ วาดอย่างน้อย 3 จุดครับ');
        let c = 0;
        State.stores.forEach(s => {
            if (Lasso.isInside([s.lat, s.lng], Lasso.pts)) {
                s.selected = true;
                c++;
            }
        });
        Lasso.cancel();
        if (c > 0) {
            UI.switchTab('tab2');
        } else {
            UI.showErrorToast('⚠️ ไม่พบร้านในพื้นที่ที่วาดครับ');
        }
        UI.render();
        App.saveDB();
    },

    isInside: (pt, vs) => {
        let x = pt[0], y = pt[1], ins = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i][0], yi = vs[i][1], xj = vs[j][0], yj = vs[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
                ins = !ins;
            }
        }
        return ins;
    }
};
;(window.__RPV=window.__RPV||{})['admin-map.js']='1.0.4';

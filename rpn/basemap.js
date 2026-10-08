/* =============================================================================
 *  basemap.js — จัดการภาพพื้นหลังแผนที่ (V0.4.0 · ปุ่มเหลือ 3 แบบ V0.6.1)
 * =============================================================================
 *  พื้นหลังหลัก 3 แบบจาก Esri (ArcGIS Location Platform — ต้องมีคีย์ใน map-key.js)
 *      gray   = เทาอ่อน  (ค่าเริ่มต้น หมุดเด่น)
 *      street = ถนน      (ดูชื่อถนน/ซอย)
 *      sat    = ดาวเทียม (เช็คตำแหน่งร้านจริง)
 *  พื้นหลังสำรอง (ไม่ต้องใช้คีย์) — V0.6.1 ไม่มีให้เลือกเองแล้ว ใช้เฉพาะตอนถอยอัตโนมัติ
 *      osm     = OpenStreetMap (ช้ากว่า และบางเครือข่ายโดนจำกัด)
 *      offline = เส้นที่วาดเองจาก basemap-data.js (ทำงานได้แม้ไม่มีเน็ต)
 *      off     = ไม่มีพื้นหลัง
 *
 *  ถ้าไม่มีคีย์ / คีย์หมดอายุ / เครือข่ายบล็อก Esri → โปรแกรมถอยไป OSM แล้วออฟไลน์เอง
 *  พร้อมข้อความบอกสาเหตุ ผู้ใช้ทำงานต่อได้เสมอ
 * ========================================================================== */
(function () {
    'use strict';
    const KEY = 'rpl:basemap';           // โหมดที่เลือกไว้
    const MIGRATED = 'rpl:basemap:v040'; // ธงว่าเคยตั้งค่าเริ่มต้นใหม่เป็นเทาอ่อนแล้ว
    const PROBE_OSM = 'https://tile.openstreetmap.org/7/101/57.png';

    const MODES = ['gray', 'street', 'sat', 'osm', 'offline', 'off'];
    const ESRI_MODES = ['gray', 'street', 'sat'];
    const LABEL = { gray: 'Light Gray', street: 'Main Road', sat: 'Satellite', osm: 'OSM', offline: 'ออฟไลน์', off: 'ปิด' };
    const ESRI_ATTR = 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors';
    const ESRI_SAT_ATTR = 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Maxar, Earthstar Geographics';

    const B = {
        mode: 'gray',
        _vec: null,
        _esri: {},          // layer ต่อโหมด
        _esriOK: null,      // ผลตรวจคีย์รอบนี้: true/false/null(ยังไม่ตรวจ)
        _esriWhy: '',
        _wired: false,
        _falling: false,
        get on() { return B.mode !== 'off'; },

        /** คีย์ Esri: ที่วางไว้ในเบราว์เซอร์นี้ (หน้า Basemap-Preview) ก่อน แล้วค่อย map-key.js */
        key() {
            let k = '';
            try { k = (localStorage.getItem('rpl:mapkey') || '').trim(); } catch (e) {}
            if (!k && window.RP_MAP_KEY && !/PASTE_KEY_HERE/.test(String(window.RP_MAP_KEY))) k = String(window.RP_MAP_KEY).trim();
            return k;
        },
        esriUrl(mode) {
            const k = B.key();
            if (mode === 'sat') return 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + k;
            const style = mode === 'street' ? 'arcgis/streets' : 'arcgis/light-gray';
            return 'https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/' + style + '/static/tile/{z}/{y}/{x}?token=' + k;
        },
        esriLayer(mode) {
            if (B._esri[mode]) return B._esri[mode];
            const sat = mode === 'sat';
            const lyr = L.tileLayer(B.esriUrl(mode), sat
                ? { maxNativeZoom: 19, maxZoom: 20, attribution: ESRI_SAT_ATTR, updateWhenZooming: false, keepBuffer: 4, referrerPolicy: 'strict-origin-when-cross-origin' }
                : { tileSize: 512, zoomOffset: -1, maxNativeZoom: 21, maxZoom: 20, attribution: ESRI_ATTR, updateWhenZooming: false, keepBuffer: 4, referrerPolicy: 'strict-origin-when-cross-origin' });
            // ถ้าโหลดพลาดติดกันหลายแผ่นตั้งแต่ครั้งแรก (คีย์เพิ่งหมดอายุกลางคัน) → ถอยไปสำรอง
            let errs = 0, okOnce = false;
            lyr.on('load', () => { okOnce = true; errs = 0; });
            lyr.on('tileerror', () => { errs++; if (!okOnce && errs >= 6 && B.mode === mode) { B._esriOK = false; B._esriWhy = 'โหลดภาพจาก Esri ไม่ได้ (คีย์หมดอายุ หรือเครือข่ายบล็อก)'; B.fallback(true); } });
            B._esri[mode] = lyr;
            return lyr;
        },

        note(msg, ms) {
            const el = MapCtrl.map.getContainer();
            el.querySelectorAll('.rpl-bm-note').forEach(n => n.remove());
            if (!msg) return;
            const n = document.createElement('div');
            n.className = 'rpl-bm-note';
            n.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);'
                + 'z-index:900;background:#fffbeb;border:1px solid #fcd34d;color:#92400e;'
                + 'padding:7px 14px;border-radius:10px;font-size:12px;font-weight:700;line-height:1.5;'
                + 'box-shadow:0 4px 14px rgba(0,0,0,.12);font-family:inherit;max-width:86%;text-align:center';
            n.textContent = msg;
            el.appendChild(n);
            setTimeout(() => n.remove(), ms || 14000);
        },

        _removeAll() {
            const m = MapCtrl.map;
            const t = MapCtrl._tiles;
            if (t && m.hasLayer(t)) m.removeLayer(t);
            if (B._vec && m.hasLayer(B._vec)) m.removeLayer(B._vec);
            Object.values(B._esri).forEach(l => { if (m.hasLayer(l)) m.removeLayer(l); });
        },

        async apply(mode, quiet) {
            B.mode = MODES.includes(mode) ? mode : 'gray';
            try { localStorage.setItem(KEY, B.mode); } catch (e) {}
            B._removeAll();

            if (ESRI_MODES.includes(B.mode)) {
                if (!B.key()) { B._esriOK = false; B._esriWhy = 'ยังไม่ได้ใส่คีย์แผนที่ใน map-key.js'; return B.fallback(quiet); }
                if (B._esriOK === null) await B.checkEsri();
                if (B._esriOK === false) return B.fallback(quiet);
                B.esriLayer(B.mode).addTo(MapCtrl.map);
            }
            if (B.mode === 'osm' && MapCtrl._tiles) {
                // OSM บางเครือข่ายตอบ 403 เป็นรูปภาพ — ตรวจก่อน 1 แผ่น ถ้าโดนบล็อกไปออฟไลน์
                if (!quiet && !(await B.probeOsm())) { B.mode = 'offline'; B.note('OpenStreetMap ใช้ไม่ได้จากเครือข่ายนี้ — ใช้แผนที่ออฟไลน์แทน'); }
                else MapCtrl._tiles.addTo(MapCtrl.map);
            }
            if (B.mode === 'offline') {
                if (!B._vec && window.VectorBasemap) {
                    if (!quiet) B.note('กำลังโหลดแผนที่ออฟไลน์...', 30000);
                    B._vec = await VectorBasemap.layer();
                    if (!quiet) B.note('');
                }
                if (B._vec) B._vec.addTo(MapCtrl.map);
                else { B.mode = 'off'; if (!quiet) B.note('ไม่พบไฟล์แผนที่ออฟไลน์ (basemap-data.js)'); }
            }
            MapCtrl.map.getContainer().style.background =
                (B.mode === 'offline' && window.VectorBasemap) ? VectorBasemap.STYLE.bg : (B.mode === 'sat' ? '#0b1a2b' : '#eef2f7');
            B.paint();
        },

        async probeOsm() {
            try {
                const res = await Promise.race([
                    fetch(PROBE_OSM + '?rpl=' + Date.now(), { cache: 'no-store' }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
                ]);
                return !!(res && res.ok);
            } catch (e) { return false; }
        },

        /** Esri ใช้ไม่ได้ → ลอง OSM → ไม่ได้อีกก็ออฟไลน์ (ไม่จำโหมดสำรองทับตัวเลือกของผู้ใช้) */
        async fallback(quiet) {
            if (B._falling) return; B._falling = true;
            const wanted = B.mode;
            const why = B._esriWhy || 'ใช้พื้นหลัง Esri ไม่ได้';
            const osmOK = await B.probeOsm();
            B._removeAll();
            if (osmOK && MapCtrl._tiles) { B.mode = 'osm'; MapCtrl._tiles.addTo(MapCtrl.map); }
            else {
                B.mode = 'offline';
                if (!B._vec && window.VectorBasemap) B._vec = await VectorBasemap.layer();
                if (B._vec) B._vec.addTo(MapCtrl.map); else B.mode = 'off';
            }
            // จำ "สิ่งที่ผู้ใช้อยากได้" ไว้ รอบหน้าถ้าคีย์กลับมาใช้ได้จะได้เทาอ่อนตามเดิม
            try { localStorage.setItem(KEY, wanted); } catch (e) {}
            MapCtrl.map.getContainer().style.background =
                (B.mode === 'offline' && window.VectorBasemap) ? VectorBasemap.STYLE.bg : '#eef2f7';
            B.paint();
            B.note(why + ' — ใช้แผนที่' + LABEL[B.mode] + 'แทนไปก่อน', 16000);
            B._falling = false;
        },

        /** ยิงคำขอทดสอบ 1 แผ่นจาก Esri ด้วยคีย์ปัจจุบัน */
        async checkEsri() {
            const url = B.esriUrl('gray').replace('{z}/{y}/{x}', '7/57/101');
            try {
                const res = await Promise.race([
                    fetch(url, { cache: 'no-store' }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
                ]);
                const ct = (res.headers.get('content-type') || '').toLowerCase();
                if (res.ok && ct.indexOf('image') === 0) { B._esriOK = true; B._esriWhy = ''; return true; }
                B._esriOK = false;
                B._esriWhy = (res.status === 401 || res.status === 403 || res.status === 498 || res.status === 499 || ct.indexOf('json') >= 0)
                    ? 'คีย์แผนที่ Esri ใช้ไม่ได้ (หมดอายุหรือไม่ถูกต้อง — ตรวจ map-key.js)'
                    : 'โหลดภาพจาก Esri ไม่ได้ (' + res.status + ')';
            } catch (e) {
                B._esriOK = false; B._esriWhy = 'เชื่อมต่อ Esri ไม่ได้ (เครือข่ายบล็อกหรือไม่มีอินเทอร์เน็ต)';
            }
            return false;
        },

        /** ลองคีย์/เครือข่ายใหม่ (เรียกจากปุ่ม) */
        async retry() {
            B._esriOK = null; B._esriWhy = '';
            Object.values(B._esri).forEach(l => { if (MapCtrl.map.hasLayer(l)) MapCtrl.map.removeLayer(l); });
            B._esri = {};
            let wanted = 'gray';
            try { wanted = localStorage.getItem(KEY) || 'gray'; } catch (e) {}
            await B.apply(ESRI_MODES.includes(wanted) ? wanted : 'gray');
            if (B._esriOK) B.note('พื้นหลัง Esri กลับมาแล้ว', 5000);
        },

        paint() {
            const box = document.getElementById('rpl-bm-box');
            if (!box) return;
            box.querySelectorAll('button[data-mode]').forEach(b => {
                const on = b.dataset.mode === B.mode;
                b.style.background = on ? '#1f2937' : '#fff';
                b.style.color = on ? '#fff' : '#374151';
            });
        },

        wire() {
            if (B._wired || typeof MapCtrl === 'undefined' || !MapCtrl.map || typeof L === 'undefined') return false;
            B._wired = true;
            try {
                const saved = localStorage.getItem(KEY);
                // V0.4.0: ตั้งค่าเริ่มต้นใหม่เป็นเทาอ่อนให้ทุกเครื่อง 1 ครั้ง (ของเดิมเป็นออฟไลน์) หลังจากนั้นจำตัวเลือกของผู้ใช้
                // V0.6.1: เหลือให้เลือก 3 แบบ — เครื่องที่เคยเลือก OSM/ออฟไลน์/ปิด ไว้ กลับมาเป็นเทาอ่อน
                if (!localStorage.getItem(MIGRATED)) { B.mode = 'gray'; localStorage.setItem(MIGRATED, '1'); localStorage.setItem(KEY, 'gray'); }
                else B.mode = ESRI_MODES.includes(saved) ? saved : 'gray';
            } catch (e) { B.mode = 'gray'; }

            const c = L.control({ position: 'bottomleft' });
            c.onAdd = function () {
                const d = L.DomUtil.create('div', 'leaflet-bar');
                d.id = 'rpl-bm-box';
                d.style.cssText = 'background:#fff;border-radius:10px;overflow:hidden;display:flex;align-items:stretch;box-shadow:0 2px 8px rgba(0,0,0,.15)';
                const btn = (m, title, last) => '<button data-mode="' + m + '" title="' + title + '" style="border:0;' + (last ? '' : 'border-right:1px solid #e5e7eb;') + 'background:#fff;padding:6px 10px;font-size:11px;font-weight:700;font-family:inherit;cursor:pointer;color:#374151;white-space:nowrap">' + LABEL[m] + '</button>';
                d.innerHTML = '<span style="padding:6px 8px;font-size:11px;color:#6b7280;border-right:1px solid #e5e7eb;white-space:nowrap">🗺️</span>'
                    + btn('gray', 'พื้นหลังเทาอ่อน — หมุดเด่น (Esri)')
                    + btn('street', 'แผนที่ถนน ดูชื่อถนน/ซอย (Esri)')
                    + btn('sat', 'ภาพดาวเทียม เช็คตำแหน่งร้านจริง (Esri)', true);
                L.DomEvent.disableClickPropagation(d);
                L.DomEvent.disableScrollPropagation(d);
                // กดปุ่มตอนที่ถอยไปพื้นหลังสำรองอยู่ = ลองคีย์ Esri ใหม่ในตัว (แทนเมนู "↻ ลองคีย์ Esri ใหม่" เดิม)
                d.querySelectorAll('button[data-mode]').forEach(b => { b.onclick = () => {
                    if (B._esriOK === false) {
                        Object.values(B._esri).forEach(l => { if (MapCtrl.map.hasLayer(l)) MapCtrl.map.removeLayer(l); });
                        B._esri = {}; B._esriOK = null; B._esriWhy = '';
                    }
                    B.apply(b.dataset.mode);
                }; });
                return d;
            };
            c.addTo(MapCtrl.map);

            B.apply(B.mode, true);
            return true;
        },
    };

    window.Basemap = B;
    const boot = () => { if (!B.wire()) setTimeout(boot, 500); };
    boot();
})();

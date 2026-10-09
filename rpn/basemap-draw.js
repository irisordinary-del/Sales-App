/* =============================================================================
 *  basemap-draw.js — แผนที่พื้นหลังแบบเส้น วาดเองในเครื่อง ไม่ต้องต่อเน็ต
 * =============================================================================
 *  ข้อมูลมาจาก basemap-data.js (สกัดจากไฟล์ .osm.pbf ด้วย tools/build-basemap.py)
 *  วาดบน canvas ชั้นเดียว — ถนนสายหลัก · ชายฝั่งและแม่น้ำ · ชื่อเมือง
 *  ใช้แทนภาพจาก OpenStreetMap เวลาโหลดไม่ได้ หรือเลือกใช้เองก็ได้
 * ========================================================================== */
(function () {
    'use strict';

    const STYLE = {
        bg:    '#aad3ea',                    // พื้นหลัง = ทะเล แล้วถมพื้นดินทับ
        land:  '#eae6dd',
        urban: '#e2ddd2',
        wfill: '#aad3ea',
        bound: { prov: 'rgba(150,140,160,.55)', dist: 'rgba(160,152,168,.32)' },
        water: { color: '#8fc2e4', width: 1.1 },
        coast: { color: '#7fb4da', width: 0.9 },
        road:  [                                   // ชั้น 0..5
            { color: '#e8935a', w: [1.4, 2.2, 3.4] },   // มอเตอร์เวย์
            { color: '#f0ad74', w: [1.1, 1.9, 2.9] },   // ทางหลวงแผ่นดินสายหลัก
            { color: '#f7cf9a', w: [0.8, 1.5, 2.4] },   // สายประธาน
            { color: '#ffffff', w: [0.6, 1.3, 2.2] },   // สายรอง
            { color: '#fdfdfb', w: [0.0, 1.0, 1.9] },   // สายย่อย (tertiary)
            { color: '#f7f7f4', w: [0.0, 0.0, 1.0] },   // ถนนในชุมชน
        ],
        label: { city: '#3f4a5a', town: '#6b7280' },
    };
    // ชั้นถนนที่แสดง ตามระดับซูม
    const SHOW = (z) => (z < 8 ? 1 : z < 10 ? 2 : z < 12 ? 3 : z < 14 ? 4 : 5);
    const WIDX = (z) => (z < 9 ? 0 : z < 12 ? 1 : 2);

    let data = null, lines = null, loading = null;

    /** คลายพิกัดจากรูปแบบผลต่าง แล้วคำนวณกรอบไว้ใช้คัดตอนวาด */
    function prepare(raw) {
        const m = Math.pow(10, raw.prec || 4);
        const out = [];
        const add = (arr, kind, cls) => {
            for (const seq of arr) {
                let la = 0, ln = 0;
                const pts = new Float64Array(seq.length);
                let s = 90, w = 180, n = -90, e = -180;
                for (let i = 0; i < seq.length; i += 2) {
                    la += seq[i]; ln += seq[i + 1];
                    const y = la / m, x = ln / m;
                    pts[i] = y; pts[i + 1] = x;
                    if (y < s) s = y; if (y > n) n = y;
                    if (x < w) w = x; if (x > e) e = x;
                }
                out.push({ kind, cls, pts, s, w, n, e });
            }
        };
        (raw.roads || []).forEach((arr, cls) => add(arr, 'r', cls));
        add(raw.water || [], 'w', 0);
        add(raw.coast || [], 'c', 0);
        add(raw.wpoly || [], 'W', 0);        // พื้นที่แหล่งน้ำ
        add(raw.urban || [], 'U', 0);        // พื้นที่ชุมชน
        add(raw.land  || [], 'L', 0);        // ขอบประเทศ
        // ขอบเขตปกครอง เก็บระดับไว้ในตัวแรกของลำดับ
        for (const seq of (raw.bound || [])) {
            const lvl = seq[0];
            add([seq.slice(1)], 'B', lvl);
        }
        return out;
    }

    function load() {
        if (lines) return Promise.resolve(true);
        if (loading) return loading;
        loading = new Promise((resolve) => {
            const go = () => {
                if (!window.__BASEMAP_DATA) return resolve(false);
                data = window.__BASEMAP_DATA;
                lines = prepare(data);
                resolve(true);
            };
            if (window.__BASEMAP_DATA) return go();
            const el = document.createElement('script');
            el.src = 'basemap-data.js';
            el.onload = go;
            el.onerror = () => resolve(false);
            document.head.appendChild(el);
        });
        return loading;
    }

    // ── ชั้นวาดบน Leaflet ────────────────────────────────────────────────
    const VectorBase = L.Layer.extend({
        onAdd(map) {
            this._map = map;
            const c = this._canvas = L.DomUtil.create('canvas', 'leaflet-layer rpl-vbase');
            c.style.pointerEvents = 'none';
            const pane = map.getPane('tilePane');
            pane.appendChild(c);
            map.on('moveend zoomend resize', this._reset, this);
            this._reset();
        },
        onRemove(map) {
            map.off('moveend zoomend resize', this._reset, this);
            if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
            this._canvas = null;
        },
        _reset() {
            const map = this._map, c = this._canvas;
            if (!map || !c) return;
            const size = map.getSize();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            c.width = size.x * dpr; c.height = size.y * dpr;
            c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
            const tl = map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(c, tl);
            this._draw(dpr);
        },
        _draw(dpr) {
            const map = this._map, c = this._canvas;
            const g = c.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, c.width, c.height);
            if (!lines) return;

            const z = map.getZoom(), maxCls = SHOW(z), wi = WIDX(z);
            const b = map.getBounds().pad(0.15);
            const s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
            const origin = map.getPixelOrigin();
            const off = map.containerPointToLayerPoint([0, 0]);
            const px = (lat, lng) => {
                const p = map.project([lat, lng], z);
                return [p.x - origin.x - off.x, p.y - origin.y - off.y];
            };

            // ลากทีละกลุ่มสี เพื่อลดการสลับสถานะของ canvas
            // ── พื้นที่ระบายสี ────────────────────────────────────────
            const fillGroup = (kind, color) => {
                g.fillStyle = color;
                g.beginPath();
                for (const L2 of lines) {
                    if (L2.kind !== kind) continue;
                    if (L2.n < s || L2.s > n || L2.e < w || L2.w > e) continue;
                    const p = L2.pts;
                    let q = px(p[0], p[1]);
                    g.moveTo(q[0], q[1]);
                    for (let i = 2; i < p.length; i += 2) { q = px(p[i], p[i + 1]); g.lineTo(q[0], q[1]); }
                    g.closePath();
                }
                g.fill('evenodd');
            };
            fillGroup('L', STYLE.land);       // พื้นดิน (บนพื้นหลังสีทะเล)
            if (z >= 9) fillGroup('U', STYLE.urban);   // เขตชุมชน โผล่ตอนซูมพอควร
            fillGroup('W', STYLE.wfill);      // แหล่งน้ำ

            // ── ขอบเขตปกครอง ─────────────────────────────────────────
            const boundGroup = (lvl, color, dash) => {
                g.save();
                g.setLineDash(dash);
                g.strokeStyle = color; g.lineWidth = 1;
                g.beginPath();
                for (const L2 of lines) {
                    if (L2.kind !== 'B' || L2.cls !== lvl) continue;
                    if (L2.n < s || L2.s > n || L2.e < w || L2.w > e) continue;
                    const p = L2.pts;
                    let q = px(p[0], p[1]);
                    g.moveTo(q[0], q[1]);
                    for (let i = 2; i < p.length; i += 2) { q = px(p[i], p[i + 1]); g.lineTo(q[0], q[1]); }
                }
                g.stroke();
                g.restore();
            };
            if (z >= 10) boundGroup(1, STYLE.bound.dist, [3, 3]);   // อำเภอ
            boundGroup(0, STYLE.bound.prov, [6, 4]);                // จังหวัด

            const order = [{ kind: 'c' }, { kind: 'w' }].concat(
                [5, 4, 3, 2, 1, 0].filter(i => i <= maxCls).map(i => ({ kind: 'r', cls: i })));
            const strokeGroup = (grp, width, color) => {
                g.beginPath();
                g.strokeStyle = color;
                g.lineWidth = width;
                g.lineJoin = 'round'; g.lineCap = 'round';
                for (const L2 of lines) {
                    if (L2.kind !== grp.kind) continue;
                    if (grp.kind === 'r' && L2.cls !== grp.cls) continue;
                    if (L2.n < s || L2.s > n || L2.e < w || L2.w > e) continue;
                    const p = L2.pts;
                    let q = px(p[0], p[1]);
                    g.moveTo(q[0], q[1]);
                    for (let i = 2; i < p.length; i += 2) { q = px(p[i], p[i + 1]); g.lineTo(q[0], q[1]); }
                }
                g.stroke();
            };
            // เส้นขอบก่อน แล้วค่อยทับด้วยสีจริง — ถนนจะอ่านง่ายขึ้นบนพื้นเบจ
            for (const grp of order) {
                if (grp.kind !== 'r' || grp.cls > 3) continue;
                const w2 = STYLE.road[grp.cls].w[wi];
                if (w2 >= 1.2) strokeGroup(grp, w2 + 1.1, 'rgba(150,142,128,.55)');
            }
            for (const grp of order) {
                const st = grp.kind === 'w' ? STYLE.water
                         : grp.kind === 'c' ? STYLE.coast : STYLE.road[grp.cls];
                const width = (grp.kind === 'w' || grp.kind === 'c') ? st.width : st.w[wi];
                if (!width) continue;
                g.beginPath();
                g.strokeStyle = st.color;
                g.lineWidth = width;
                g.lineJoin = 'round'; g.lineCap = 'round';
                for (const L2 of lines) {
                    if (L2.kind !== grp.kind) continue;
                    if (grp.kind === 'r' && L2.cls !== grp.cls) continue;
                    if (L2.n < s || L2.s > n || L2.e < w || L2.w > e) continue;   // นอกจอ
                    const p = L2.pts;
                    let q = px(p[0], p[1]);
                    g.moveTo(q[0], q[1]);
                    for (let i = 2; i < p.length; i += 2) { q = px(p[i], p[i + 1]); g.lineTo(q[0], q[1]); }
                }
                g.stroke();
            }

            // ชื่อเมือง
            if (data && data.places && z >= 7) {
                g.textAlign = 'center'; g.textBaseline = 'middle';
                g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)';
                const MINZ = [7, 10, 13];       // เมืองใหญ่ · เมือง/อำเภอ · ตำบล/หมู่บ้าน
                const SIZE = [12.5, 11, 9.5];
                let drawn = 0;
                for (const [cls, la, ln, nm] of data.places) {
                    if (z < MINZ[cls]) continue;
                    if (la < s || la > n || ln < w || ln > e) continue;
                    if (cls === 2 && ++drawn > 220) break;             // กันป้ายท่วมจอตอนซูมใกล้
                    const q = px(la, ln);
                    g.font = (cls === 0 ? '700 ' : '600 ') + SIZE[cls] + 'px ' +
                             'Prompt, "Noto Sans Thai", sans-serif';
                    g.strokeText(nm, q[0], q[1]);
                    g.fillStyle = cls === 0 ? STYLE.label.city
                                : cls === 1 ? STYLE.label.town : '#8a8f98';
                    g.fillText(nm, q[0], q[1]);
                }
            }
        },
    });

    window.VectorBasemap = {
        STYLE,
        async layer() {
            const ok = await load();
            if (!ok) return null;
            return new VectorBase();
        },
        get loaded() { return !!lines; },
        get counts() {
            if (!lines) return null;
            return { เส้น: lines.length, เมือง: (data.places || []).length };
        },
    };
})();

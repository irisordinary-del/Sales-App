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

    // ── V0.9.6: ดัชนีตาราง — แยกเส้นตามกลุ่ม (ชนิด+ชั้น) แล้วแบ่งเป็นช่อง 0.25° ──────────
    //   เดิมทุกครั้งที่ซูม/เลื่อน วนเส้นทั้งประเทศหลายรอบ (ทุกกลุ่มวนทั้งก้อน) — ตอนนี้หยิบเฉพาะช่องที่อยู่ในจอ
    const CELL = 0.25;
    let index = null, stamp = 0;
    const gkey = (kind, cls) => kind + (cls || 0);
    function buildIndex(all) {
        const groups = {};
        for (const L2 of all) {
            const k = gkey(L2.kind, L2.cls);
            const gp = groups[k] || (groups[k] = { cells: new Map(), list: [] });
            L2._st = 0;
            gp.list.push(L2);
            const cy0 = Math.floor(L2.s / CELL), cy1 = Math.floor(L2.n / CELL);
            const cx0 = Math.floor(L2.w / CELL), cx1 = Math.floor(L2.e / CELL);
            if ((cy1 - cy0 + 1) * (cx1 - cx0 + 1) > 400) { (gp.big || (gp.big = [])).push(L2); continue; }  // รูปใหญ่มาก (ขอบประเทศ) เก็บแยก
            for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
                const key = y * 4096 + x;
                let a = gp.cells.get(key); if (!a) gp.cells.set(key, a = []);
                a.push(L2);
            }
        }
        return groups;
    }
    /** เส้นของกลุ่มนี้ที่อยู่ในกรอบ s,w,n,e (ไม่ซ้ำ) */
    function inView(kind, cls, s, w, n, e) {
        const gp = index && index[gkey(kind, cls)];
        if (!gp) return [];
        const st = ++stamp, out = [];
        const take = (L2) => {
            if (L2._st === st) return; L2._st = st;
            if (L2.n < s || L2.s > n || L2.e < w || L2.w > e) return;
            out.push(L2);
        };
        if (gp.big) gp.big.forEach(take);
        const cy0 = Math.floor(s / CELL), cy1 = Math.floor(n / CELL);
        const cx0 = Math.floor(w / CELL), cx1 = Math.floor(e / CELL);
        if ((cy1 - cy0 + 1) * (cx1 - cx0 + 1) > gp.cells.size) { gp.list.forEach(take); return out; }  // ซูมออกกว้าง: วนรายการตรง ๆ เร็วกว่า
        for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
            const a = gp.cells.get(y * 4096 + x);
            if (a) for (const L2 of a) take(L2);
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
                index = buildIndex(lines);
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
            // V0.9.6: คำนวณ Web Mercator เอง (เท่ากับ map.project) ไม่ต้องสร้างวัตถุทุกจุด
            const SC = 256 * Math.pow(2, z), ox = origin.x + off.x, oy = origin.y + off.y;
            const D2R = Math.PI / 180, MAXLAT = 85.0511287798;
            const pxX = (lng) => (lng + 180) / 360 * SC - ox;
            const pxY = (lat) => {
                const la = lat > MAXLAT ? MAXLAT : lat < -MAXLAT ? -MAXLAT : lat;
                const sn = Math.sin(la * D2R);
                return (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * SC - oy;
            };
            const px = (lat, lng) => [pxX(lng), pxY(lat)];
            // ลากเส้นหนึ่งเส้น — ข้ามจุดที่ห่างจากจุดก่อนไม่ถึง ~0.8 px (ซูมออกแล้วจุดซ้อนกันเยอะ วาดไปก็มองไม่เห็น)
            // ซูมออก (≤ 11): ใช้ชุดจุดที่ตัดให้บางลงแล้วของระดับซูมนั้น (ทำครั้งแรกครั้งเดียว แล้วเก็บไว้)
            const zb = z <= 11 ? Math.max(5, Math.floor(z)) : 0;
            const tol = zb ? 0.8 * 360 / (256 * Math.pow(2, zb)) : 0, tol2 = tol * tol;
            const ptsOf = (L2) => {
                if (!zb || L2.pts.length <= 8) return L2.pts;
                const cache = L2._simp || (L2._simp = {});
                let q = cache[zb];
                if (q) return q;
                const p = L2.pts, out = [p[0], p[1]];
                let a0 = p[0], b0 = p[1];
                for (let i = 2; i < p.length - 2; i += 2) {
                    const da = p[i] - a0, db = p[i + 1] - b0;
                    if (da * da + db * db < tol2) continue;
                    out.push(p[i], p[i + 1]); a0 = p[i]; b0 = p[i + 1];
                }
                out.push(p[p.length - 2], p[p.length - 1]);
                return (cache[zb] = Float64Array.from(out));
            };
            // ชิ้นที่เล็กกว่า ~1.5 px บนจอ (บ่อ/สระเล็ก ๆ ตอนซูมออก) ข้ามไป — มองไม่เห็นอยู่แล้ว แต่กินเวลาวาดมากสุด
            const minDeg = 1.5 * 360 / SC;
            const tiny = (L2) => (L2.n - L2.s) < minDeg && (L2.e - L2.w) < minDeg;
            const minFill = (z <= 11 ? 3 : 1.5) * 360 / SC;           // พื้นที่ระบายสี ตอนซูมออกต้องใหญ่ 3 px ขึ้นไปถึงวาด
            const tinyFill = (L2) => (L2.n - L2.s) < minFill && (L2.e - L2.w) < minFill;
            const trace = (p0, close) => {
                const p = p0.pts ? ptsOf(p0) : p0;
                let x0 = pxX(p[1]), y0 = pxY(p[0]);
                g.moveTo(x0, y0);
                const last = p.length - 2;
                for (let i = 2; i < p.length; i += 2) {
                    const x = pxX(p[i + 1]), y = pxY(p[i]);
                    const dx = x - x0, dy = y - y0;
                    if (i !== last && dx * dx + dy * dy < 0.64) continue;
                    g.lineTo(x, y); x0 = x; y0 = y;
                }
                if (close) g.closePath();
            };

            // ลากทีละกลุ่มสี เพื่อลดการสลับสถานะของ canvas
            // ── พื้นที่ระบายสี ────────────────────────────────────────
            const fillGroup = (kind, color) => {
                g.fillStyle = color;
                g.beginPath();
                for (const L2 of inView(kind, 0, s, w, n, e)) { if (!tinyFill(L2)) trace(L2, true); }
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
                for (const L2 of inView('B', lvl, s, w, n, e)) { if (!tiny(L2)) trace(L2, false); }
                g.stroke();
                g.restore();
            };
            if (z >= 10) boundGroup(1, STYLE.bound.dist, [3, 3]);   // อำเภอ
            boundGroup(0, STYLE.bound.prov, [6, 4]);                // จังหวัด

            const order = [{ kind: 'c' }, { kind: 'w' }].concat(
                [5, 4, 3, 2, 1, 0].filter(i => i <= maxCls).map(i => ({ kind: 'r', cls: i })));
            const vis = new Map();
            const listOf = (grp) => { const k = grp.kind + (grp.cls || 0); if (!vis.has(k)) vis.set(k, inView(grp.kind, grp.cls || 0, s, w, n, e)); return vis.get(k); };
            const strokeGroup = (grp, width, color) => {
                g.beginPath();
                g.strokeStyle = color;
                g.lineWidth = width;
                g.lineJoin = 'round'; g.lineCap = 'round';
                for (const L2 of listOf(grp)) { if (!tiny(L2)) trace(L2, false); }
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
                strokeGroup(grp, width, st.color);
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

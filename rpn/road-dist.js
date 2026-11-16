/* =============================================================================
 *  road-dist.js — ระยะถนนจริงระหว่างร้าน
 * =============================================================================
 *  ระบบเดิมวัดระยะเป็น "เส้นตรง" (ระยะกระจัด) ซึ่งสั้นกว่าระยะวิ่งจริงเสมอ
 *  ไฟล์นี้อ่านตารางระยะถนนที่สร้างไว้ล่วงหน้าจากข้อมูล OpenStreetMap
 *  (สร้างด้วย tools/build-road-matrix-all.py → ได้ไฟล์ road-matrix/<ศูนย์>.js ทุกศูนย์)
 *  V1.0.3: ตารางแยกไฟล์ต่อศูนย์ — โปรแกรมโหลดเฉพาะของศูนย์ที่เปิดอยู่ให้เอง
 *  แล้วให้ระยะถนนจริงเป็นเมตร โดยไม่ต้องต่อเน็ตตอนใช้งาน
 *
 *  คู่ร้านที่อยู่ไกลกันเกินรัศมีที่เก็บไว้ (ปกติ 25 กม.) จะไม่มีในตาราง
 *  กรณีนั้นจะถอยไปใช้เส้นตรง × ตัวคูณที่ "วัดได้จริง" จากตารางเดียวกัน
 *  ซึ่งแม่นกว่าการเดาตัวคูณเอง และคู่แบบนั้นแทบไม่เกิดในคิวของวันเดียวกัน
 *
 *  โครงไฟล์ road-matrix.bin
 *    'RDM1' | uint32 ความยาว header | header JSON | รหัสร้านคั่นด้วย \n
 *          | ptr uint32[n+1] | nbr uint16/uint32[] | dist uint16[] (หน่วย 10 ม.)
 * ========================================================================== */
const RoadDist = (() => {
    'use strict';

    const DB_NAME = 'rp_roadmatrix';
    const STORE = 'blob';
    // V1.0.3: ตารางแยกตามศูนย์ — เก็บในเครื่องแยกคีย์ต่อศูนย์ (เดิมคีย์เดียว 'current' ใช้ร่วมทุกศูนย์)
    const cid = () => String(window.CENTER_ID || 'LOCAL');
    const KEY_OF = () => 'c:' + cid();
    const KEY = 'current';            // คีย์เก่า (≤ V1.0.2) — ลบทิ้งตอนเปิด
    const FALLBACK_DEFAULT = 1.30;

    let head = null;        // header จากไฟล์
    let idx = null;         // Map: รหัสร้าน -> ลำดับ
    let ptr = null, nbr = null, dst = null;
    let ready = false;
    let hit = 0, miss = 0;
    let source = '';        // V1.0.3: 'folder' = มากับโปรแกรม · 'user' = ผู้ใช้เลือกไฟล์เอง

    // ── ระยะเส้นตรง (เมตร) ────────────────────────────────────────────────
    const KY = 111132.0;
    const straight = (a, b) => {
        const kx = KY * Math.cos((a.lat + b.lat) * 0.5 * Math.PI / 180);
        const dy = (a.lat - b.lat) * KY, dx = (a.lng - b.lng) * kx;
        return Math.sqrt(dy * dy + dx * dx);
    };

    // ── อ่านไฟล์ .bin ─────────────────────────────────────────────────────
    function parse(buf) {
        const dv = new DataView(buf);
        const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
        if (magic !== 'RDM1') throw new Error('ไม่ใช่ไฟล์ตารางระยะถนน (magic=' + magic + ')');
        const hlen = dv.getUint32(4, true);
        let off = 8;
        const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, hlen)));
        off += hlen;

        const codes = new TextDecoder().decode(new Uint8Array(buf, off, h.codesBytes)).split('\n');
        off += h.codesBytes;
        if (codes.length !== h.nStore) throw new Error('จำนวนรหัสร้านไม่ตรง header');

        const n = h.nStore;
        const P = new Uint32Array(buf.slice(off, off + (n + 1) * 4)); off += (n + 1) * 4;
        const total = P[n];
        let N;
        if (h.idxBytes === 4) { N = new Uint32Array(buf.slice(off, off + total * 4)); off += total * 4; }
        else { N = new Uint16Array(buf.slice(off, off + total * 2)); off += total * 2; }
        const D = new Uint16Array(buf.slice(off, off + total * 2));

        // เรียงเพื่อนบ้านในแต่ละแถวตามหมายเลขร้าน เพื่อค้นแบบ binary search ได้
        for (let i = 0; i < n; i++) {
            const a = P[i], b = P[i + 1], len = b - a;
            if (len < 2) continue;
            let sorted = true;                       // V1.0.3: ไฟล์รายศูนย์เรียงตามเลขร้านมาแล้ว — ข้ามการเรียงซ้ำ
            for (let k = a + 1; k < b; k++) if (N[k - 1] > N[k]) { sorted = false; break; }
            if (sorted) continue;
            const ord = Array.from({ length: len }, (_, k) => k).sort((p, q) => N[a + p] - N[a + q]);
            const tn = new Array(len), td = new Array(len);
            for (let k = 0; k < len; k++) { tn[k] = N[a + ord[k]]; td[k] = D[a + ord[k]]; }
            for (let k = 0; k < len; k++) { N[a + k] = tn[k]; D[a + k] = td[k]; }
        }

        const m = new Map();
        for (let i = 0; i < n; i++) m.set(codes[i], i);
        return { h, m, P, N, D };
    }

    function adopt(o) {
        head = o.h; idx = o.m; ptr = o.P; nbr = o.N; dst = o.D;
        ready = true; hit = 0; miss = 0;
    }

    // ── ค้นระยะจากตาราง (คืน null ถ้าไม่มีคู่นี้) ─────────────────────────
    function lookup(i, j) {
        let lo = ptr[i], hi = ptr[i + 1] - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1, v = nbr[mid];
            if (v === j) return dst[mid] * 10;
            if (v < j) lo = mid + 1; else hi = mid - 1;
        }
        return null;
    }

    // ── IndexedDB (เก็บไฟล์ไว้ ไม่ต้องเลือกใหม่ทุกครั้ง) ──────────────────
    function db() {
        return new Promise((res, rej) => {
            const r = indexedDB.open(DB_NAME, 1);
            r.onupgradeneeded = () => r.result.createObjectStore(STORE);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
    }
    async function save(buf) {
        try {
            const d = await db();
            await new Promise((res, rej) => {
                const t = d.transaction(STORE, 'readwrite');
                t.objectStore(STORE).put(buf, KEY_OF());
                t.oncomplete = res; t.onerror = () => rej(t.error);
            });
        } catch (e) { console.warn('[RoadDist] เก็บลงเครื่องไม่สำเร็จ', e); }
    }
    async function load() {
        try {
            const d = await db();
            return await new Promise((res, rej) => {
                const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_OF());
                r.onsuccess = () => res(r.result || null);
                r.onerror = () => rej(r.error);
            });
        } catch (e) { return null; }
    }

    const R = {
        get ready() { return ready; },
        get depots() { return (ready && head.depots) ? head.depots : []; },
        get info() {
            return ready
                ? { ...head, pairs: ptr[head.nStore], hit, miss,
                    coverage: hit + miss ? +(hit / (hit + miss) * 100).toFixed(1) : null }
                : null;
        },

        /** ระยะระหว่างร้าน 2 ร้าน หน่วยเมตร */
        m(a, b) {
            if (ready) {
                const i = idx.get(a.code || a.id), j = idx.get(b.code || b.id);
                if (i !== undefined && j !== undefined && i !== j) {
                    let v = lookup(i, j);
                    if (v === null) v = lookup(j, i);       // เผื่อเก็บไว้ข้างเดียว
                    // ระยะถนนต้องไม่สั้นกว่าเส้นตรงเสมอ (กันเคสร้านเกาะจุดถนนเดียวกัน)
                    if (v !== null) { hit++; return Math.max(v, straight(a, b)); }
                }
                miss++;
                return straight(a, b) * (head.fallbackFactor || FALLBACK_DEFAULT);
            }
            return straight(a, b);
        },
        km(a, b) { return R.m(a, b) / 1000; },

        /** เหมือน m() แต่บอกด้วยว่าได้มาจากตารางถนนจริง (exact) หรือประมาณจากเส้นตรง */
        mx(a, b) {
            if (ready) {
                const i = idx.get(a.code || a.id), j = idx.get(b.code || b.id);
                if (i !== undefined && j !== undefined && i !== j) {
                    let v = lookup(i, j);
                    if (v === null) v = lookup(j, i);
                    if (v !== null) { hit++; return { m: Math.max(v, straight(a, b)), exact: true }; }
                }
                miss++;
                return { m: straight(a, b) * (head.fallbackFactor || FALLBACK_DEFAULT), exact: false };
            }
            return { m: straight(a, b), exact: false };
        },
        straightM: straight,

        /** ระยะรวมของลำดับร้าน (เมตร) — ใส่ depot เพื่อคิดขาออก/ขากลับด้วย */
        pathM(arr, depot) {
            let t = 0;
            if (!arr.length) return 0;
            if (depot) t += R.m(depot, arr[0]);
            for (let i = 1; i < arr.length; i++) t += R.m(arr[i - 1], arr[i]);
            if (depot) t += R.m(arr[arr.length - 1], depot);
            return t;
        },

        /** รับ ArrayBuffer เข้าระบบ (จาก fetch หรือจากที่ผู้ใช้เลือกไฟล์) */
        async use(buf, persist) {
            adopt(parse(buf)); source = 'user';
            if (persist !== false) await save(buf);
            document.dispatchEvent(new CustomEvent('roaddist:ready', { detail: R.info }));
            return R.info;
        },

        /**
         * เริ่มต้น (V1.0.3): ตารางของ "ศูนย์ที่เปิดอยู่" จากโฟลเดอร์โปรแกรม road-matrix/<ศูนย์>.js (มากับโปรแกรม)
         *   → ไม่มี: ใช้ตารางที่ผู้ใช้เลือกไฟล์เองและเก็บไว้ในเครื่อง (ของศูนย์นี้)
         *   → ไม่มี: ระยะเส้นตรง
         * ถ้าตารางที่เก็บในเครื่องสร้างทีหลังไฟล์ในโฟลเดอร์ (ผู้ใช้โหลดไฟล์ใหม่กว่าเอง) ใช้ของในเครื่อง
         */
        async init() {
            try {   // ล้างตารางคีย์เก่าที่ใช้ร่วมทุกศูนย์ (≤ V1.0.2)
                const d = await db();
                d.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
            } catch (e) { /* ไม่เป็นไร */ }
            const c = cid();
            let folder = null;
            {
                // เบราว์เซอร์ห้าม fetch ไฟล์ในเครื่อง แต่โหลดผ่าน <script> ได้
                try {
                    const b64 = await new Promise((resolve) => {
                        const el = document.createElement('script');
                        el.src = `road-matrix/${encodeURIComponent(c)}.js`;
                        el.onload = () => resolve(window.__ROAD_MATRIX_CID === c ? window.__ROAD_MATRIX_B64 : null);
                        el.onerror = () => resolve(null);
                        document.head.appendChild(el);
                    });
                    if (b64) {
                        const bin = atob(b64);
                        const u8 = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                        // ไฟล์รายศูนย์บีบ gzip ไว้ (เล็กลง ~40%) — คลายด้วยตัวคลายในเบราว์เซอร์
                        folder = window.__ROAD_MATRIX_GZ
                            ? await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
                            : u8.buffer;
                    }
                    try { delete window.__ROAD_MATRIX_B64; delete window.__ROAD_MATRIX_GZ; } catch (e) { window.__ROAD_MATRIX_B64 = null; }
                } catch (e) { console.warn('[RoadDist] อ่าน road-matrix/' + c + '.js ไม่สำเร็จ', e); }
            }
            const cached = await load();
            let fo = null, ca = null;
            try { if (folder) fo = parse(folder); } catch (e) { console.warn('[RoadDist] ไฟล์ตารางของศูนย์ ' + c + ' เสีย', e); }
            try { if (cached) ca = parse(cached); } catch (e) { console.warn('[RoadDist] ตารางที่เก็บไว้เสีย', e); }
            let pick = fo, from = 'folder';
            if (ca && (!fo || String(ca.h.built || '') > String(fo.h.built || ''))) { pick = ca; from = 'user'; }
            if (pick) {
                adopt(pick); source = from;
                document.dispatchEvent(new CustomEvent('roaddist:ready', { detail: R.info }));
                console.log(`[RoadDist] ศูนย์ ${c}: ใช้ตาราง${from === 'folder' ? 'จากโฟลเดอร์โปรแกรม' : 'ที่โหลดเองไว้ในเครื่อง'}`, R.info);
                return R.info;
            }
            console.log(`[RoadDist] ศูนย์ ${c}: ยังไม่มีตารางระยะถนน — ใช้ระยะเส้นตรงไปก่อน`);
            return null;
        },

        /** V0.9.17: ตารางดิบที่เก็บไว้ในเครื่อง (ArrayBuffer) — ใช้ตอน Save เป็น .json */
        // V1.0.3: ตารางที่มากับโปรแกรม (โฟลเดอร์ road-matrix) ไม่ต้องแนบในไฟล์สำรอง — เปิดเครื่องไหนก็มี
        async raw() { return source === 'user' ? await load() : null; },
        get source() { return source; },

        /** ลบตารางที่เก็บไว้ */
        async clear() {
            try {
                const d = await db();
                await new Promise(res => {
                    const t = d.transaction(STORE, 'readwrite');
                    t.objectStore(STORE).delete(KEY_OF()); t.oncomplete = res;
                });
            } catch (e) { /* ไม่เป็นไร */ }
            head = idx = ptr = nbr = dst = null; ready = false;
        },
    };

    document.addEventListener('DOMContentLoaded', () => { R.init(); });
    return R;
})();
;(window.__RPV=window.__RPV||{})['road-dist.js']='1.0.4';

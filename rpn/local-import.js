/* =============================================================================
 *  local-import.js — นำเข้าจากไฟล์มาตรฐานที่โหลดออกจากระบบหลัก  (v2)
 * =============================================================================
 *  รับ 2 ไฟล์แล้วจับคู่ด้วย Customer Code
 *    1) MST - RoutePlan Detail   → สายวิ่ง · วันในรอบ (จาก Cycle Name) · Cycle Code · ลำดับคิว
 *    2) MST - Customer Master    → พิกัด · ที่อยู่ · ประเภทร้าน · สถานะ Active/InActive
 *
 *  v2 เพิ่ม
 *    • อ่านได้ทุกแท็บในไฟล์เดียว (ไฟล์ RoutePlan ของ AS&D มีเดือนละแท็บ)
 *    • เลือกได้ว่าจะนำเข้าเดือนไหนบ้าง — ค่าเริ่มต้นติ๊กเดือนล่าสุดเดือนเดียว
 *    • ตัวกรองสถานะร้าน (ค่าเริ่มต้น = เฉพาะ Active)
 *    • ร้าน Active ที่ยังไม่อยู่ในแผน → เข้าสาย "รอจัดสาย" เป็นหมุดเทา
 *    • ลำดับคิวในวัน มาจากลำดับแถวภายใน Cycle Code เดียวกัน
 *    • เก็บ Cycle Code ไว้ในร้าน (ใช้ต่อตอน export)
 * ========================================================================== */
const SysImport = (() => {
    'use strict';

    const UNASSIGNED_ROUTE = 'รอจัดสาย';
    const norm = h => String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' ');

    /** แกะเลขวันในรอบ + ชื่อตลาด จาก Cycle Name
     *  แต่ละศูนย์เขียนไม่เหมือนกัน — สำรวจจากไฟล์รวมทุกศูนย์แล้วเจอ 6 ทรง
     *    101C01 D01 อ.เมืองเชียงราย1        เว้นวรรค D
     *    303C01D01แขวงหนองค้างพลู           D ติดรหัสสาย  (ตัว D ไปชนเลข 1 ของ C01)
     *    502C01D01-อำเภอเมืองฉะเชิงเทรา     D ติด + ขีดคั่นหน้าชื่อตลาด
     *    202C01DAY1ตำบลในเมือง              DAY ติดกัน
     *    403C01 Day - 2หาดใหญ่              Day มีขีดคั่นก่อนเลข
     *    302C01 R01 เขตราชเทวี              ใช้ R แทน D (ตรวจแล้ว R = เลขวันจริง)
     *  วิธี: ตัดรหัสสายทิ้งก่อนเสมอ แล้วค่อยหาเลขวันจากส่วนที่เหลือ
     */
    const RX_HEAD = /^[\s|_\-]*\d{0,3}[A-Za-z]{1,2}\d{1,2}[\s|_\-]*/;          // รหัสสายที่ขึ้นต้นชื่อรอบ
    const RX_CODE = /^[\s|_\-]*\d{0,3}[A-Za-z]{1,2}\d{1,2}(?![A-Za-z0-9])[\s|_\-]*/;
    const RX_DAY  = /DAY\s*[-–—]?\s*0*(\d{1,2})(?!\d)/i;
    const RX_DR   = /(^|[^A-Za-z0-9])([DR])\s*[-–—]?\s*0*(\d{1,2})(?!\d)/i;

    const RX_F2 = /(^|[^A-Za-z0-9])F\s*-?\s*2(?![0-9])/i;   // ป้าย "F2" ที่ 302 ใช้บอกว่าเป็นรอบที่สองของเดือน

    function parseCycleName(cycle, route) {
        let rest = ' ' + String(cycle == null ? '' : cycle);
        // ตัดรหัสสาย — ถ้าชื่อรอบใส่รหัสสายผิดสาย (เจอที่ 303) ให้ตัดรหัสที่ขึ้นต้นทิ้งแทน
        if (route && rest.indexOf(route) >= 0) rest = rest.split(route).join(' ');
        else rest = rest.replace(RX_HEAD, ' ');

        let day = null, m = rest.match(RX_DAY);
        if (m) { day = parseInt(m[1], 10); rest = rest.replace(m[0], ' '); }
        else if ((m = rest.match(RX_DR))) { day = parseInt(m[3], 10); rest = rest.replace(m[0], m[1] + ' '); }
        if (!(day >= 1 && day <= 31)) day = null;

        // ป้าย F2 ต้องตรวจ "หลัง" ดึงเลขวันออก (จะได้ไม่ปนกับตัว D/R) แต่ "ก่อน" ล้างเศษรหัสสาย
        // (ไม่งั้น RX_CODE จะกิน " F2 " ไปเพราะหน้าตาเหมือนรหัสสาย)
        let second = false;
        const f2 = rest.match(RX_F2);
        if (f2) { second = true; rest = rest.replace(f2[0], f2[1] + ' '); }
        rest = rest.replace(RX_CODE, ' ');   // เศษรหัสสายที่ยังเหลือ เช่น "C01"
        const market = rest.replace(/\s+/g, ' ').replace(/^[\s|_\-]+/, '').replace(/[\s|_\-]+$/, '');
        return { day, market, second };
    }

    /** วันที่เป็น 'YYYY-MM-DD' (เวลาท้องถิ่น) */
    /**
     * วันที่จากเซลล์ Excel — SheetJS (cellDates) คืน Date ที่คลาดจากเที่ยงคืนได้หลายนาที
     * ในเขตเวลาที่ offset ปี 1899 ไม่เท่าปัจจุบัน (กรุงเทพฯ 1899 = +6:42 ปัจจุบัน +7:00 → Date ออกมา 23:42 ของ "วันก่อนหน้า")
     * เครื่องที่ตั้งเวลาไทยจึงอ่านทุกวันที่เลื่อนไป 1 วัน ส่วนเครื่อง UTC ไม่เป็น
     * แก้โดยเลื่อนไปกลางวัน (+12 ชม.) ก่อนอ่านวัน — ค่าที่ห่างเที่ยงคืนไม่เกิน 12 ชม. จะได้วันที่ตั้งใจเสมอ
     */
    const asDay = v => {
        if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600 * 1000); return isNaN(d.getTime()) ? null : d; }
        if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) {   // เลขวัน Excel (serial)
            const ms = Math.round(v) * 86400000 + Date.UTC(1899, 11, 30);
            const u = new Date(ms); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12);
        }
        if (!v) return null;
        const str = String(v).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str) || /^(\d{4})\/(\d{2})\/(\d{2})/.exec(str);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
        const m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str);            // dd/mm/yyyy แบบไทย
        if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1], 12);
        const d = new Date(str); return isNaN(d.getTime()) ? null : new Date(d.getTime() + 12 * 3600 * 1000);
    };
    const ymdOf = v => {
        const d = asDay(v);
        if (!d) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    const ymOf = v => {
        const d = asDay(v);
        if (!d) return '';
        return d.getFullYear() + '_' + String(d.getMonth() + 1).padStart(2, '0');
    };

    /** อ่านไฟล์ Excel → คืนทุกแท็บที่มีคอลัมน์ครบตามที่ต้องการ */
    const readWorkbook = (file, mustHave) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        fr.onload = e => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
                const sheets = [];
                for (const sn of wb.SheetNames) {
                    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', blankrows: false });
                    let hi = -1;
                    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
                        const set = (aoa[i] || []).map(norm);
                        if (mustHave.every(m => set.includes(norm(m)))) { hi = i; break; }
                    }
                    if (hi === -1) continue;
                    const header = aoa[hi].map(norm);
                    sheets.push({ name: sn, rows: aoa.slice(hi + 1), col: n => header.indexOf(norm(n)) });
                }
                if (!sheets.length) return reject(new Error('ไม่พบแท็บที่มีคอลัมน์ ' + mustHave.join(' / ')));
                resolve(sheets);
            } catch (err) { reject(err); }
        };
        fr.readAsArrayBuffer(file);
    });

    // V0.9.10: ประเภทสายจากรหัสสาย (ตัวอักษรหลังเลขศูนย์ 3 หลัก) — รายงานนับยอดรวมเฉพาะ P / V / C
    const RTYPES = [
        { k: 'P', name: 'Presales', note: 'นับรวมในยอด P/V/C' },
        { k: 'V', name: 'Vansales', note: 'นับรวมในยอด P/V/C' },
        { k: 'C', name: 'Credit', note: 'นับรวมในยอด P/V/C' },
        { k: 'E', name: 'Spare/Gainer', note: 'จัดสายได้ตามปกติ แต่ไม่นับรวมในยอด P/V/C' },
        { k: 'X', name: 'อื่น ๆ', note: 'สายที่ไม่ใช่ P / V / C / E — ไม่นับรวมในยอด P/V/C' },
    ];
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const rtype = (code) => { const m = /^\d{3}([A-Za-z])/.exec(String(code || '')); const t = m ? m[1].toUpperCase() : ''; return 'PVCE'.includes(t) && t ? t : 'X'; };

    // V1.0.0: เก็บสำเนาไฟล์ที่นำเข้าล่าสุด (RoutePlan / Customer Master / Geo Tree) ไว้ในเครื่อง — ครั้งถัดไปกด "ใช้ไฟล์เดิม" ได้
    //   เก็บชุดเดียวต่อศูนย์ · ติดไปกับไฟล์ Save .json (LocalExtras) · ไม่ถูกล้างด้วยปุ่มล้างข้อมูลแผน
    const FileVault = (() => {
        const DB = 'rp_importfiles', ST = 'files';
        const db = () => new Promise((res, rej) => {
            const r = indexedDB.open(DB, 1);
            r.onupgradeneeded = () => r.result.createObjectStore(ST);
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        const key = () => String(window.CENTER_ID || 'LOCAL');
        return {
            async get(k) {
                try { const d = await db(); return await new Promise((res, rej) => { const r = d.transaction(ST, 'readonly').objectStore(ST).get(k || key()); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); }
                catch (e) { return null; }
            },
            async put(v, k) {
                try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(v, k || key()); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; }
                catch (e) { console.warn('[FileVault]', e); return false; }
            },
            async all() {
                try { const d = await db(); return await new Promise((res, rej) => { const out = {}; const r = d.transaction(ST, 'readonly').objectStore(ST).openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); }; r.onerror = () => rej(r.error); }); }
                catch (e) { return {}; }
            },
            async clear(k) { try { const d = await db(); await new Promise(res => { const t = d.transaction(ST, 'readwrite'); if (k) t.objectStore(ST).delete(k); else t.objectStore(ST).clear(); t.oncomplete = res; }); } catch (e) {} },
            async saveFiles(files) {
                const pack = async (f) => f ? { name: f.name, size: f.size, buf: await f.arrayBuffer() } : null;
                const v = { at: new Date().toISOString(), plan: await pack(files.plan), master: await pack(files.master), geo: await pack(files.geo) };
                return S._vaultSaved = await FileVault.put(v);
            },
            toFile(e) { return e && e.buf ? new File([e.buf], e.name || 'file.xlsx') : null; },
            fmt(n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB'; },
        };
    })();

    const S = {
        _files: { plan: null, master: null },
        _data: null,
        _months: {},        // ym -> true/false (ติ๊กไว้ไหม)
        _routes: {},        // routeCode -> true/false
        _onlyActive: false,        // V1.0.0 (J1): ยึด Route Plan — ร้านในไฟล์แผนเอาเข้าทั้งหมด (Inactive ใน Master ติดป้ายไว้)
        _withOutside: true,        // ค่าเริ่มต้น: เอาร้านใหม่เข้ามาด้วย (ไปกองที่สาย 'รอจัดสาย')
        _busy: false,
        _overwrite: false,         // V0.9.18 (I2): สายที่มีอยู่แล้วในเดือนนั้น — false = ไม่แตะ (เก็บที่แก้ไว้) · true = เขียนทับด้วยไฟล์
        _last: null,               // V0.9.18 (I2): ใบนำเข้าล่าสุดของเดือนที่เปิดอยู่ (อ่านจากแผน)
        _reuse: true,              // ใช้ค่าที่ติ๊กไว้ครั้งก่อนเป็นค่าเริ่มต้นเมื่ออ่านไฟล์เสร็จ
        _vault: null,              // V1.0.0: สำเนาไฟล์ที่นำเข้าล่าสุดของศูนย์นี้ (จาก FileVault)
        _fromVault: false,         // กำลังใช้ไฟล์เดิมจาก vault อยู่

        // ── เปิด/ปิด ────────────────────────────────────────────────────
        open() {
            S._files = { plan: null, master: null, geo: null };
            S._data = null; S._months = {}; S._routes = {};
            S._onlyActive = false; S._withOutside = true; S._busy = false; S._overwrite = false; S._reuse = true;
            S._vault = null; S._fromVault = false;
            FileVault.get().then(v => { if (v && (v.plan || v.master)) { S._vault = v; S._render(); } }).catch(() => {});
            // V0.9.18 (I2): ใบนำเข้าล่าสุดของเดือนที่เปิดอยู่
            S._last = null;
            // เดือนที่เปิดอยู่มีใบนำเข้า (V0.9.18) → แสดงเต็ม · นำเข้าด้วยเวอร์ชันก่อน → แสดงเท่าที่มี ·
            // เดือนนี้ไม่ได้นำเข้า (สร้างด้วย + เพิ่มเดือน) → แสดงของเดือนที่นำเข้าล่าสุดของศูนย์แทน
            (async () => {
                try {
                    const ym = App._currentPlanYM; if (!ym) return;
                    const pick = async (y) => { const d = await App.planRef(y).get(); return d.exists ? (d.data().importInfo || null) : null; };
                    let info = await pick(ym), src = ym;
                    if (!info) {
                        const db = await App.dbRef.get();
                        const ly = db.exists ? db.data().lastImportYM : '';
                        if (ly && ly !== ym) { info = await pick(ly); src = ly; }
                    }
                    if (!info) return;
                    S._last = info.sel ? { ym: src, ...info.sel, at: info.at, legacy: false, other: src !== ym }
                                       : { ym: src, at: info.at, types: info.types || [], mActive: info.mActive, mActiveBy: info.mActiveBy, legacy: true, other: src !== ym };
                    S._render();
                } catch (e) {}
            })();
            let el = document.getElementById('sysimport-modal');
            if (!el) {
                el = document.createElement('div');
                el.id = 'sysimport-modal';
                el.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998] flex items-center justify-center p-4';
                document.body.appendChild(el);
            }
            el.classList.remove('hidden');
            S._render();
        },
        close() {
            const el = document.getElementById('sysimport-modal');
            if (el) el.classList.add('hidden');
        },

        async pick(kind, evt) {
            const f = evt.target.files[0];
            evt.target.value = '';
            if (!f) return;
            S._files[kind] = f; S._fromVault = false;
            if (kind === 'geo') return S._render();          // V0.7.1: Geo Tree ไม่ต้องอ่านใหม่ทั้งชุด
            S._data = null;
            S._render();
            if (S._files.plan && S._files.master) await S.analyze();
        },

        // ── อ่าน + จับคู่ ───────────────────────────────────────────────
        async analyze() {
            UI.showLoader('📖 กำลังอ่านไฟล์...', 'ไฟล์แผนวิ่งอาจมีหลายแท็บ (เดือนละแท็บ) รอสักครู่');
            try {
                const planSheets = await readWorkbook(S._files.plan, ['Route Code', 'Cycle Name', 'Customer Code']);
                const mstSheets = await readWorkbook(S._files.master, ['Customer Code', 'Master Latitude', 'Master Longitude']);

                // ---- Customer Master ----
                const ms = mstSheets[0];
                const mc = {
                    id: ms.col('Customer Code'), lat: ms.col('Master Latitude'), lng: ms.col('Master Longitude'),
                    name: ms.col('Customer Name'), cat: ms.col('Outlet Category'), status: ms.col('Customer Status'),
                    city: ms.col('City'), dist: ms.col('District'), state: ms.col('State'), sales: ms.col('Salesman Code'),
                    // V0.9.0: ใช้ในรายงาน Executive (ร้านใหม่/เก่า · Segmentation · Brand Bonus)
                    open: ms.col('Open Account Date'), seg: ms.col('Segmentation'), bb: ms.col('Brand Bonus'),
                };
                const master = new Map();
                let mActive = 0, mInactive = 0;
                const mActiveBy = { P: 0, V: 0, C: 0, E: 0, X: 0 };
                for (const r of ms.rows) {
                    const id = String(r[mc.id] == null ? '' : r[mc.id]).trim();
                    if (!id) continue;
                    const lat = parseFloat(r[mc.lat]), lng = parseFloat(r[mc.lng]);
                    const status = mc.status >= 0 ? String(r[mc.status] || '').trim() : 'Active';
                    const active = !/inactive/i.test(status);
                    active ? mActive++ : mInactive++;
                    if (active) { const sc = mc.sales >= 0 ? String(r[mc.sales] || '').trim() : ''; mActiveBy[rtype(sc)]++; }
                    master.set(id, {
                        lat, lng, active, status,
                        name: mc.name >= 0 ? String(r[mc.name] || '').trim() : '',
                        cat: mc.cat >= 0 ? String(r[mc.cat] || '').trim() : '',
                        city: mc.city >= 0 ? String(r[mc.city] || '').trim() : '',
                        dist: mc.dist >= 0 ? String(r[mc.dist] || '').trim() : '',
                        state: mc.state >= 0 ? String(r[mc.state] || '').trim() : '',
                        sales: mc.sales >= 0 ? String(r[mc.sales] || '').trim() : '',
                        open: mc.open >= 0 ? ymdOf(r[mc.open]) : '',
                        seg: mc.seg >= 0 ? String(r[mc.seg] || '').trim() : '',
                        bb: mc.bb >= 0 ? String(r[mc.bb] || '').trim() : '',
                    });
                }

                // ---- RoutePlan: ทุกแท็บ → แยกตามเดือน ----
                // months[ym] = { routes: { code: { cys: Map(cy -> [rows]) } }, sheets:Set }
                const months = {};
                let noMaster = 0, noGeo = 0, noDay = 0, inactiveSkipped = 0;
                let maxCY = 0;
                const routeDist = {};        // สาย -> Distributor Code จากไฟล์

                for (const sh of planSheets) {
                    const pc = {
                        route: sh.col('Route Code'), cycle: sh.col('Cycle Name'), cyCode: sh.col('Cycle Code'),
                        id: sh.col('Customer Code'), name: sh.col('Customer Name'), visit: sh.col('Visit Date'),
                        freq: sh.col('Frequency'), dist: sh.col('Distributor Code'),
                    };
                    for (const r of sh.rows) {
                        const route = String(r[pc.route] == null ? '' : r[pc.route]).trim();
                        const id = String(r[pc.id] == null ? '' : r[pc.id]).trim();
                        if (!route || !id) continue;

                        const ym = pc.visit >= 0 ? ymOf(r[pc.visit]) : '';
                        if (!ym) continue;

                        const rawCycle = String(r[pc.cycle] == null ? '' : r[pc.cycle]).trim();
                        const c = parseCycleName(rawCycle, route);
                        if (!c.day) { noDay++; continue; }

                        const cyCode = pc.cyCode >= 0 ? String(r[pc.cyCode] || '').trim() : '';
                        const n = parseInt(cyCode.replace(/\D/g, ''), 10);
                        if (isFinite(n) && n > maxCY) maxCY = n;

                        // Distributor Code ของสายนี้ — ใช้เป็นเลขศูนย์จริง แทนที่จะเดาจาก URL
                        if (pc.dist >= 0) {
                            const dc = String(r[pc.dist] == null ? '' : r[pc.dist]).trim();
                            if (dc) routeDist[route] = dc;
                        }
                        const M = months[ym] || (months[ym] = { routes: {}, sheets: new Set(), rows: 0 });
                        M.sheets.add(sh.name); M.rows++;
                        const R = M.routes[route] || (M.routes[route] = { cys: new Map(), custs: new Set(), days: new Set() });
                        const key = cyCode || (route + '|' + c.day);
                        (R.cys.get(key) || R.cys.set(key, []).get(key)).push({
                            id, name: String(r[pc.name] || '').trim(), day: c.day, market: c.market,
                            cy: cyCode, dayOriginal: rawCycle, second: !!c.second,
                            vd: pc.visit >= 0 ? ymdOf(r[pc.visit]) : '',
                            fq: pc.freq >= 0 ? String(r[pc.freq] == null ? '' : r[pc.freq]).trim() : '',
                        });
                        R.custs.add(id); R.days.add(c.day);
                    }
                }

                // ---- ตรวจการจับคู่ (ใช้ทุกเดือนรวมกันเพื่อรายงาน) ----
                const allCust = new Set();
                Object.values(months).forEach(M => Object.values(M.routes).forEach(R => R.custs.forEach(c => allCust.add(c))));
                for (const id of allCust) {
                    const g = master.get(id);
                    if (!g) { noMaster++; continue; }
                    if (!isFinite(g.lat) || !isFinite(g.lng) || (g.lat === 0 && g.lng === 0)) { noGeo++; continue; }
                    if (!g.active) inactiveSkipped++;
                }

                const yms = Object.keys(months).sort();
                if (!yms.length) throw new Error('อ่านข้อมูลแผนไม่ได้เลย — ตรวจว่าเลือกไฟล์ถูกช่องหรือไม่');

                // ร้าน Active ที่ไม่อยู่ในแผนเลย (ทุกเดือน)
                // V0.9.18 (I1): เก็บประเภทจาก Salesman Code ไว้ด้วย — ตอนนำเข้าเอาเฉพาะประเภทที่ติ๊ก (P/V/C/E)
                //   ร้านที่ Salesman Code ว่าง/รหัสอื่น (เช่น T…, B… = บัญชีพนักงาน) ไม่นำเข้า แต่รายงานจำนวนให้รู้
                const outside = [];
                const outsideType = new Map();
                const outsideBy = { P: 0, V: 0, C: 0, E: 0, X: 0 };
                for (const [id, g] of master) {
                    if (allCust.has(id)) continue;
                    if (!g.active) continue;
                    if (!isFinite(g.lat) || !isFinite(g.lng) || (g.lat === 0 && g.lng === 0)) continue;
                    const t = rtype(g.sales);
                    outside.push(id); outsideType.set(id, t); outsideBy[t]++;
                }

                const routeCodes = [...new Set(yms.flatMap(y => Object.keys(months[y].routes)))]
                    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));

                S._data = { months, yms, master, routeCodes, outside, outsideType, outsideBy, maxCY, routeDist,
                            stats: { noMaster, noGeo, noDay, inactiveSkipped, mActive, mInactive, mActiveBy, sheets: planSheets.length } };
                // ค่าเริ่มต้น: เดือนล่าสุดเดือนเดียว · ทุกสาย
                yms.forEach(y => { S._months[y] = false; });
                S._months[yms[yms.length - 1]] = true;
                routeCodes.forEach(c => { S._routes[c] = true; });
                // V0.9.18 (I2): ใช้ค่าที่ติ๊กไว้ครั้งก่อน (ถ้าเปิดเดือนเดิมและมีใบนำเข้า)
                if (S._reuse && S._last) S.applyLast(false);

                UI.hideLoader();
                S._render();
            } catch (e) {
                UI.hideLoader();
                S._data = null;
                S._render();
                UI.showErrorToast('❌ ' + e.message);
            }
        },

        /** V1.0.0: ใช้ไฟล์เดิมที่เก็บไว้ (ไม่ต้องเลือกไฟล์ใหม่) */
        async useVault() {
            const v = S._vault; if (!v) return;
            S._files = { plan: FileVault.toFile(v.plan), master: FileVault.toFile(v.master), geo: FileVault.toFile(v.geo) };
            S._fromVault = true; S._data = null; S._render();
            if (S._files.plan && S._files.master) await S.analyze();
        },
        toggleMonth(y) { S._months[y] = !S._months[y]; S._render(); },
        allMonths(v) { S._data.yms.forEach(y => { S._months[y] = v; }); S._render(); },
        toggleRoute(c) { S._routes[c] = !S._routes[c]; S._render(); },
        /** V0.9.10: ติ๊กทั้งประเภทสาย (P / V / C / E / อื่น ๆ) — ไม่ติ๊ก = ไม่นำเข้าร้านของสายประเภทนั้นเลย */
        toggleType(t) {
            const codes = S._data.routeCodes.filter(c => rtype(c) === t);
            const on = !codes.every(c => S._routes[c]);
            codes.forEach(c => { S._routes[c] = on; });
            S._render();
        },
        _rtype: rtype,
        allRoutes(v) { S._data.routeCodes.forEach(c => { S._routes[c] = v; }); S._render(); },
        setActive(v) { S._onlyActive = (v === '1'); S._render(); },
        setOutside(v) { S._withOutside = v; S._render(); },
        setOverwrite(v) { S._overwrite = !!v; S._render(); },
        setReuse(v) { S._reuse = !!v; if (S._reuse && S._data) S.applyLast(true); else S._render(); },
        /** ประเภทสายที่ติ๊กอยู่ (มีสายของประเภทนั้นถูกเลือกอย่างน้อย 1 สาย) */
        typesOn() {
            const d = S._data; if (!d) return new Set();
            return new Set(d.routeCodes.filter(c => S._routes[c]).map(rtype));
        },
        /** V0.9.18 (I1): ร้านนอกแผนที่จะนำเข้าจริง = ประเภทตรงกับที่ติ๊ก · X (ว่าง/รหัสอื่น) ไม่เอา */
        outsidePick() {
            const d = S._data; if (!d) return [];
            const on = S.typesOn();
            return d.outside.filter(id => { const t = d.outsideType.get(id); return t !== 'X' && on.has(t); });
        },
        /** V0.9.18 (I2): ติ๊กตามใบนำเข้าล่าสุด */
        applyLast(render) {
            const d = S._data, L = S._last; if (!d || !L || L.legacy) return;
            d.yms.forEach(y => { S._months[y] = (L.months || []).includes(y); });
            if (!d.yms.some(y => S._months[y])) S._months[d.yms[d.yms.length - 1]] = true;
            d.routeCodes.forEach(c => { S._routes[c] = (L.routes || []).includes(c) || !(L.routesAll || []).includes(c); });
            if (typeof L.withOutside === 'boolean') S._withOutside = L.withOutside;
            if (render !== false) S._render();
        },

        // ── ประกอบร้านของเดือนหนึ่ง ─────────────────────────────────────
        _buildMonth(ym) {
            const M = S._data.months[ym];
            const master = S._data.master;
            const routes = {};
            let maxDay = 0;
            // ปฏิทินอนุมานจากไฟล์ — ให้วันที่ในระบบตรงกับที่ศูนย์วิ่งจริงตั้งแต่เปิดมา ("ยึดแผนเดิม")
            //   จุดยึดรายสาย = วันที่แรกสุดของสาย + เลขวันของบีตนั้น (รอบหมุนต่อเนื่องภายในเดือน)
            //   วันหยุดประจำสัปดาห์ = วันในสัปดาห์ที่ทั้งศูนย์ไม่มีการวิ่งเลย
            //   วันหยุดเฉพาะกิจ    = วันทำงานระหว่างวันแรก–วันสุดท้ายของแผน ที่ทั้งศูนย์ไม่มีการวิ่งเลย
            const routeCal = {};
            const visitedDates = new Set();
            const anchorOf = {};
            const srcDay = {};          // สาย -> เลขวัน -> วันที่แรกที่วิ่งจริงตามไฟล์
            const routeDates = {};      // สาย -> Set วันที่ที่สายนี้วิ่ง
            const skipped = new Map();  // V0.9.0: ร้านในไฟล์แผนที่ไม่ได้นำเข้า (ไม่มีพิกัด / ไม่มีใน Master / InActive) → รายงาน Executive

            for (const [code, R] of Object.entries(M.routes)) {
                if (!S._routes[code]) continue;
                const byStore = new Map();
                // บีตเงา (ชื่อรอบมีป้าย F2 เช่น "302P01 R01 F2") คือรอบที่สองของเดือน ใช้เลขวันซ้ำกับรอบแรก
                // ต้องเลื่อนให้เป็นช่องวันของตัวเอง ไม่งั้นสองบีตจะยุบรวมกันแล้วการเข้าเยี่ยมครั้งที่สองหาย
                let firstRound = 0;
                for (const rows of R.cys.values())
                    for (const row of rows)
                        if (!row.second && row.day > firstRound) firstRound = row.day;
                const dayOf = row => (row.second && firstRound) ? row.day + firstRound : row.day;

                // เรียง cycle ตามเลขวัน เพื่อให้ลำดับคิวคงที่
                const cyKeys = [...R.cys.keys()].sort((a, b) => {
                    const da = dayOf(R.cys.get(a)[0]), db = dayOf(R.cys.get(b)[0]);
                    return da - db || String(a).localeCompare(String(b));
                });
                for (const k of cyKeys) {
                    const rows = R.cys.get(k);
                    let seq = 0;
                    for (const row of rows) {
                        const g = master.get(row.id);
                        if (!g) { skipped.set(row.id, { id: row.id, name: row.name || '', route: code, why: 'ไม่มีใน Customer Master' }); continue; }
                        if (!isFinite(g.lat) || !isFinite(g.lng) || (g.lat === 0 && g.lng === 0)) {
                            skipped.set(row.id, { id: row.id, name: row.name || g.name || '', route: code, why: 'ไม่มีพิกัด', status: g.status || '' }); continue; }
                        if (S._onlyActive && !g.active) {      // (ไม่ใช้แล้วตั้งแต่ J1 — คงไว้เผื่อเปิดกลับ)
                            skipped.set(row.id, { id: row.id, name: row.name || g.name || '', route: code, why: 'InActive ใน Master (ไม่ได้นำเข้า)', status: g.status || '' }); continue; }
                        seq++;
                        const rowDay = dayOf(row);
                        const dayLabel = 'Day ' + rowDay;
                        if (rowDay > maxDay) maxDay = rowDay;
                        let s = byStore.get(row.id);
                        if (!s) {
                            s = {
                                id: row.id, code: row.id,
                                name: row.name || g.name || ('Store_' + row.id),
                                lat: +g.lat, lng: +g.lng, freq: 1, days: [], seqs: {}, selected: false,
                                salesCode: g.sales || code, shopType: g.cat, subDistrict: g.city,
                                district: g.dist, province: g.state, marketName: row.market,
                                cy: row.cy || '', dayOriginal: row.dayOriginal,
                                status: g.status || '', openDate: g.open || '', segment: g.seg || '', brandBonus: g.bb || '',
                                masterInactive: !g.active,      // V1.0.0 (J1): อยู่ในแผนแต่ Master เป็น Inactive → ป้ายเตือน (ยังส่งออก DMS ตามแผน)
                            };
                            byStore.set(row.id, s);
                        }
                        if (!s.days.includes(dayLabel)) s.days.push(dayLabel);
                        if (s.days.length > 1) s.freq = 2;
                        s.seqs[dayLabel] = seq;
                        // CY ต้องเก็บแยกรายวัน — ร้าน F2 อยู่ 2 ตลาด จึงมี CY คนละตัว
                        if (!s.cys) s.cys = {};
                        if (row.cy) s.cys[dayLabel] = row.cy;
                        if (!s.cy && row.cy) s.cy = row.cy;
                        // Frequency รายบีตจากไฟล์ (F2 = เดือนละ 2 ครั้ง, W = เดือนละครั้ง)
                        // เก็บไว้เฉย ๆ ตอนนี้ ยังไม่เอาไปคิดอะไร — ใช้ตอน export ให้ตรงกับที่ศูนย์ส่งมา
                        if (row.fq) { if (!s.fqs) s.fqs = {}; s.fqs[dayLabel] = row.fq; }
                        // วันที่วิ่งจริงครั้งแรกของบีตนี้ตามไฟล์ — ใช้เลือก "ครั้งไหน" ตอน export ถ้าปฏิทินให้หลายวัน
                        if (row.vd) {
                            if (!s.vd) s.vd = {};
                            if (!s.vd[dayLabel] || row.vd < s.vd[dayLabel]) s.vd[dayLabel] = row.vd;
                            visitedDates.add(row.vd);
                            (routeDates[code] || (routeDates[code] = new Set())).add(row.vd);
                            const sd = srcDay[code] || (srcDay[code] = {});
                            if (!sd[rowDay] || row.vd < sd[rowDay]) sd[rowDay] = row.vd;
                            const a = anchorOf[code];
                            if (!a || row.vd < a.date) anchorOf[code] = { date: row.vd, day: rowDay };
                        }
                    }
                }
                routes[code] = [...byStore.values()];
                // V0.5: ความถี่เป็นของตลาด (CY) ไม่ใช่ของร้าน — ตั้งค่าเดียวให้ทุกร้านในตลาด (ใช้ค่าที่ไฟล์ส่วนใหญ่บอก)
                {
                    const byDay = {};
                    routes[code].forEach(st => Object.entries(st.fqs || {}).forEach(([d, v]) => {
                        const k = String(v || '').trim().toUpperCase() === 'F2' ? 'F2' : 'F1';
                        const c = byDay[d] || (byDay[d] = {}); c[k] = (c[k] || 0) + 1;
                    }));
                    Object.entries(byDay).forEach(([d, c]) => {
                        const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
                        routes[code].forEach(st => { if ((st.days || []).includes(d)) { if (!st.fqs) st.fqs = {}; st.fqs[d] = top; } });
                    });
                }
            }

            // ประกอบปฏิทินรายสายจากจุดยึดที่เจอ
            if (visitedDates.size) {
                const wkCount = [0, 0, 0, 0, 0, 0, 0];
                let lo = null, hi = null;
                visitedDates.forEach(v => {
                    const d = new Date(v + 'T00:00:00'); wkCount[d.getDay()]++;
                    if (!lo || v < lo) lo = v; if (!hi || v > hi) hi = v;
                });
                const weeklyHolidays = wkCount.map((n, i) => n === 0 ? i : -1).filter(i => i >= 0);
                const holidays = [];
                if (lo && hi) {
                    const [y, m] = ym.split('_').map(Number);
                    const last = new Date(y, m, 0).getDate();
                    for (let d = 1; d <= last; d++) {
                        const iso = ym.replace('_', '-') + '-' + String(d).padStart(2, '0');
                        if (iso <= lo || iso >= hi) continue;
                        const wd = new Date(y, m - 1, d).getDay();
                        if (weeklyHolidays.includes(wd)) continue;
                        if (!visitedDates.has(iso)) holidays.push(d);
                    }
                }
                const [yy, mm] = ym.split('_').map(Number);
                const dayDiff = (a, b) => Math.abs((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
                for (const [code, a] of Object.entries(anchorOf)) {
                    let rmax = 0;
                    (routes[code] || []).forEach(st => (st.days || []).forEach(dl => {
                        const n = parseInt(String(dl).replace(/\D/g, ''), 10) || 0; if (n > rmax) rmax = n; }));
                    // รูปแบบเดียวกับที่หน้าปฏิทินในระบบใช้ (โหมดรอบ เริ่มนับที่วันที่ X ของเดือน = Day N แล้วหมุนต่อเนื่อง)
                    // จะได้เปิดแก้ในหน้าปฏิทินได้เลย และรองรับวันหยุดเฉพาะกิจ
                    const cfg = {
                        mode: 'cycle', anchorType: 'date',
                        startDay: parseInt(a.date.slice(8, 10), 10) || 1, startDayNum: a.day,
                        cycleDays: rmax || maxDay || 24,
                        weeklyHolidays, holidays: holidays.slice(), holidayMode: 'shift',
                        source: 'import',
                        // V0.5: วันที่วิ่งวันสุดท้ายของศูนย์ในไฟล์ — ใช้เป็น "วันทำงานสุดท้ายของเดือน" (End date ค่าเริ่มต้น)
                        lastDay: hi ? (parseInt(String(hi).slice(8, 10), 10) || 0) : 0,
                    };
                    // วันหยุดเฉพาะสาย (เช่น เซลล์ลา): วันที่สายนี้ไม่ได้วิ่ง แล้วถ้านับเป็นวันหยุดแล้ววันที่ของบีตตรงกับไฟล์มากขึ้น
                    // (ไม่ใช่ทุกวันว่างจะเป็นวันหยุด — ในรอบสั้น 12 วัน บีตที่วิ่งเดือนละครั้งจะเว้นช่องไว้เฉย ๆ)
                    if (typeof FileManager !== 'undefined' && FileManager._resolveCalendarDate && srcDay[code]) {
                        const beats = Object.entries(srcDay[code]).map(([d, v]) => ({ day: +d, src: v }));
                        const score = (c) => beats.reduce((t, b) => {
                            let d = null; try { d = FileManager._resolveCalendarDate(c, 'Day ' + b.day, yy, mm - 1); } catch (e) {}
                            return t + (d ? dayDiff(ymdOf(d), b.src) : 31);
                        }, 0);
                        let best = score(cfg);
                        if (best > 0) {
                            const mine = routeDates[code] || new Set();
                            const lo = a.date, hi = [...mine].sort().pop();
                            const last = new Date(yy, mm, 0).getDate();
                            for (let d = 1; d <= last && best > 0; d++) {
                                const iso = ym.replace('_', '-') + '-' + String(d).padStart(2, '0');
                                if (iso <= lo || iso >= hi || mine.has(iso)) continue;
                                if (weeklyHolidays.includes(new Date(yy, mm - 1, d).getDay())) continue;
                                if (cfg.holidays.includes(d)) continue;
                                const trial = { ...cfg, holidays: cfg.holidays.concat([d]).sort((x, y) => x - y) };
                                const sc = score(trial);
                                if (sc < best) { best = sc; cfg.holidays = trial.holidays; }
                            }
                        }
                    }
                    routeCal[code] = cfg;
                }
            }

            // ร้าน Active นอกแผน → สาย "รอจัดสาย" (หมุดเทา ไม่มีวัน)
            if (S._withOutside && S._data.outside.length) {
                routes[UNASSIGNED_ROUTE] = S.outsidePick().sort((a, b) => String((master.get(b) || {}).open || '').localeCompare(String((master.get(a) || {}).open || ''))).map(id => {
                    const g = master.get(id);
                    return {
                        id, code: id, name: g.name || ('Store_' + id),
                        lat: +g.lat, lng: +g.lng, freq: 1, days: [], seqs: {}, selected: false,
                        salesCode: g.sales || '', shopType: g.cat, subDistrict: g.city,
                        district: g.dist, province: g.state, marketName: '', cy: '', dayOriginal: '',
                        status: g.status || '', openDate: g.open || '', segment: g.seg || '', brandBonus: g.bb || '',
                    };
                });
            }
            // V0.9.18 (I1): ร้านนอกแผนที่ไม่ได้นำเข้าเพราะ Salesman Code ไม่ใช่ประเภทที่ติ๊ก → รายงาน Executive (Issues)
            if (S._withOutside) {
                const picked = new Set(S.outsidePick());
                S._data.outside.forEach(id => {
                    if (picked.has(id)) return;
                    const g = master.get(id); const t = S._data.outsideType.get(id);
                    skipped.set(id, { id, name: (g && g.name) || '', route: g && g.sales || '', status: g && g.status || '',
                        why: t === 'X' ? 'Salesman Code ไม่ใช่ P/V/C/E (ไม่ได้นำเข้า)' : `ประเภทสาย ${t} ไม่ได้ติ๊ก (ไม่ได้นำเข้า)` });
                });
            }
            return { routes, cycleDays: maxDay || 24, routeCal, skipped: [...skipped.values()] };
        },

        // ── เขียนแผนลงที่เก็บข้อมูล ─────────────────────────────────────
        async _writeMonth(ym, routes, cycleDays, routeCal, skipped, opt) {
            routeCal = routeCal || {};
            opt = opt || {};
            let names = Object.keys(routes).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            let parked = 0, kept = 0;
            // V0.9.18 (I2): เดือนนี้มีสายอยู่แล้ว + ไม่ได้เลือก "เขียนทับ" → สายที่มีอยู่ไม่ถูกแตะ (เก็บที่แก้ไว้) นำเข้าเฉพาะสายใหม่
            let existing = new Set();
            try { const cur = await App.planRef(ym).get(); existing = new Set(cur.exists ? (cur.data().routeList || []) : []); } catch (e) {}
            const existingAll = new Set(existing);
            // ร้านที่อยู่ในสายเดิมแล้ว (ใช้กันร้านนอกแผนซ้ำ)
            const inPlan = new Set();
            if (!opt.overwrite && existing.size) {
                for (const n of existing) {
                    if (n === UNASSIGNED_ROUTE) continue;
                    try { const o = await App.planRoutesCol(ym).doc(n).get(); (o.exists ? (o.data().stores || []) : []).forEach(st => { if (!st.inactive) inPlan.add(st.id); }); } catch (e) {}
                }
            }
            for (const name of names) {
                let stores = routes[name];
                if (!opt.overwrite && existing.has(name) && name !== UNASSIGNED_ROUTE) { kept++; continue; }
                try {
                    const old = await App.planRoutesCol(ym).doc(name).get();
                    const prev = old.exists ? (old.data().stores || []) : [];
                    if (name === UNASSIGNED_ROUTE && !opt.overwrite && prev.length) {
                        // กองรอจัดสาย: เติมเฉพาะร้านใหม่ที่ยังไม่อยู่ที่ไหนเลย ของเดิมคงไว้
                        const have = new Set(prev.map(s => s.id));
                        stores = prev.concat(stores.filter(s => !have.has(s.id) && !inPlan.has(s.id)));
                    } else if (prev.length) {
                        // ร้านเดิมที่หายไปจากไฟล์ → พักไว้ (ไม่ลบทิ้ง)
                        const incoming = new Set(stores.map(s => s.id));
                        const missing = prev.filter(s => !incoming.has(s.id) && !s.inactive)
                                            .map(s => ({ ...s, inactive: true }));
                        parked += missing.length;
                        stores = stores.concat(missing);
                    }
                } catch (e) { /* ไม่มีของเดิมก็ข้าม */ }

                const payload = {
                    stores,
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                };
                if (routeCal[name]) payload.calendarOverride = routeCal[name];   // วันที่ตามไฟล์ที่ศูนย์วิ่งจริง
                await App.planRoutesCol(ym).doc(name).set(payload, { merge: true });
            }
            // V0.9.18 (I2): ลบสายที่ติ๊กออก (ผู้ใช้ยืนยันแล้วใน run) · รายชื่อสาย = ของเดิมที่ยังอยู่ + ที่นำเข้า
            const removed = [];
            for (const n of (opt.remove || [])) {
                if (!existingAll.has(n)) continue;
                try { await App.planRoutesCol(ym).doc(n).delete(); removed.push(n); existingAll.delete(n); } catch (e) {}
            }
            names = [...new Set([...existingAll, ...names])].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            const planPatch = {
                routeList: names, cycleDays,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                importedAt: new Date().toISOString(),       // V0.7.2: เดือนนี้มาจากไฟล์ระบบ (ฐานเทียบในหน้าภาพรวมแผน)
                // V0.9.0: ข้อมูลประกอบรายงาน Executive
                importInfo: {
                    at: new Date().toISOString(),
                    mActive: (S._data.stats || {}).mActive || 0, mInactive: (S._data.stats || {}).mInactive || 0,
                    mActiveBy: (S._data.stats || {}).mActiveBy || null,
                    types: [...new Set(S._data.routeCodes.filter(c => S._routes[c]).map(rtype))],
                    skipped: (skipped || []).slice(0, 5000),
                    // V0.9.18 (I2): ใบนำเข้า — เปิดดู/ใช้ติ๊กซ้ำได้จากหน้าต่างนำเข้า และติดไปกับไฟล์ Save
                    sel: {
                        planFile: (S._files.plan && S._files.plan.name) || '', masterFile: (S._files.master && S._files.master.name) || '',
                        geoFile: (S._files.geo && S._files.geo.name) || '',
                        months: S._data.yms.filter(y => S._months[y]), monthsAll: S._data.yms.slice(),
                        routes: S._data.routeCodes.filter(c => S._routes[c]), routesAll: S._data.routeCodes.slice(),
                        onlyActive: S._onlyActive, withOutside: S._withOutside, overwrite: !!opt.overwrite,
                        outside: S._withOutside ? S.outsidePick().length : 0, outsideBy: S._data.outsideBy || null,
                        kept, removed, imported: Object.keys(routes).filter(n => !(existing.has(n) && !opt.overwrite && n !== UNASSIGNED_ROUTE)),
                    },
                },
            };
            // ค่าตั้งต้นของศูนย์: ถ้ายังไม่เคยตั้ง ใช้ปฏิทินของสายที่มีร้านมากสุดเป็นตัวแทน
            try {
                const cur = await App.planRef(ym).get();
                const hasCal = cur.exists && cur.data().calendarConfig && (cur.data().calendarConfig.mode || cur.data().calendarConfig.mapping);
                const big = names.filter(n => routeCal[n]).sort((a, b) => (routes[b] || []).length - (routes[a] || []).length)[0];
                if (!hasCal && big) planPatch.calendarConfig = { ...routeCal[big], cycleDays };
            } catch (e) {}
            await App.planRef(ym).set(planPatch, { merge: true });

            const cur = await App.dbRef.get();
            const data = cur.exists ? cur.data() : {};
            const planList = [...new Set([...(data.planList || []), ym])].sort().reverse();
            const patch = { planList };
            // V0.7.2: เดือนที่นำเข้าจากระบบล่าสุด = แผนที่ DMS ใช้อยู่ → หน้าภาพรวมแผนใช้เป็นฐานเทียบ
            if (!data.lastImportYM || ym >= data.lastImportYM) patch.lastImportYM = ym;
            if (S._data.maxCY > (data.maxCycleCode || 0)) patch.maxCycleCode = S._data.maxCY;
            // V0.9.0: Customer Master ที่นำเข้าล่าสุด — จำนวน Active ใช้ในรายงาน Executive ของเดือนถัด ๆ ไป
            patch.masterInfo = { at: new Date().toISOString(), ym, mActive: (S._data.stats || {}).mActive || 0, mInactive: (S._data.stats || {}).mInactive || 0,
                                 mActiveBy: (S._data.stats || {}).mActiveBy || null,
                                 types: [...new Set(S._data.routeCodes.filter(c => S._routes[c]).map(rtype))] };
            // เลขศูนย์จริงจากไฟล์ RoutePlan (ไม่เอาจาก URL เพราะอาจไม่ตรงกับข้อมูล)
            if (S._data.routeDist && Object.keys(S._data.routeDist).length) {
                patch.routeDist = { ...(data.routeDist || {}), ...S._data.routeDist };
            }
            await App.dbRef.set(patch, { merge: true });
            return { parked, kept, removed };
        },

        // ── นำเข้าจริง ──────────────────────────────────────────────────
        async run() {
            if (!S._data || S._busy) return;
            const months = S._data.yms.filter(y => S._months[y]);
            const routes = S._data.routeCodes.filter(c => S._routes[c]);
            if (!months.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกเดือนที่จะนำเข้า');
            if (!routes.length) return UI.showErrorToast('⚠️ ยังไม่ได้เลือกสายที่จะนำเข้า');

            if (months.length > 2) {
                const ok = await new Promise(r => UI.showConfirm(
                    `เลือกไว้ ${months.length} เดือน\n\nแต่ละเดือนใช้เวลาราวครึ่งนาที รวมแล้วประมาณ ${Math.ceil(months.length * 0.6)} นาที\nระหว่างนี้อย่าปิดหน้าจอ — ยืนยันนำเข้าทั้งหมดหรือไม่?`,
                    () => r(true), () => r(false)));
                if (!ok) return;
            }

            // V0.9.18 (I2): สายที่มีอยู่ในเดือนนั้นแล้วแต่ติ๊กออก → ถามว่าจะลบออกจากแผนไหม
            const removeBy = {};
            let removeList = [];
            for (const ym of months) {
                try {
                    const cur = await App.planRef(ym).get();
                    const have = cur.exists ? (cur.data().routeList || []) : [];
                    const inFile = Object.keys(S._data.months[ym].routes);
                    const off = have.filter(n => inFile.includes(n) && !S._routes[n]);
                    if (off.length) { removeBy[ym] = off; removeList = removeList.concat(off.map(n => `${App.ymToLabel(ym)} · ${n}`)); }
                } catch (e) {}
            }
            if (removeList.length) {
                const ok = await new Promise(r => UI.showConfirm(
                    `สายที่ติ๊กออก แต่มีอยู่ในแผนแล้ว ${removeList.length} สาย:\n${removeList.slice(0, 12).join('\n')}${removeList.length > 12 ? '\n…' : ''}\n\nลบสายเหล่านี้ออกจากแผนเลยหรือไม่? (ร้านในสายจะหายไปจากแผนเดือนนั้น · ย้อนกลับไม่ได้ ควร Save ก่อน)\nกด "ยกเลิก" = คงสายไว้ตามเดิม นำเข้าเฉพาะที่ติ๊ก`,
                    () => r(true), () => r(false)));
                if (!ok) Object.keys(removeBy).forEach(k => delete removeBy[k]);
            }

            S._busy = true;
            S.close();
            let totalStores = 0, totalParked = 0, totalKept = 0, totalRemoved = 0;
            const done = [];

            try {
                for (let i = 0; i < months.length; i++) {
                    const ym = months[i];
                    UI.showLoader(`📦 นำเข้าเดือน ${App.ymToLabel(ym)}`,
                        `${i + 1}/${months.length} เดือน — กำลังประกอบข้อมูล`);
                    const built = S._buildMonth(ym);
                    const n = Object.values(built.routes).reduce((a, v) => a + v.length, 0);
                    if (!n) { done.push({ ym, n: 0 }); continue; }

                    UI.showLoader(`📦 นำเข้าเดือน ${App.ymToLabel(ym)}`,
                        `${i + 1}/${months.length} เดือน — บันทึก ${n.toLocaleString()} ร้าน`);
                    const w = await S._writeMonth(ym, built.routes, built.cycleDays, built.routeCal, built.skipped, { overwrite: S._overwrite, remove: removeBy[ym] || [] });
                    totalParked += w.parked; totalKept += w.kept; totalRemoved += (w.removed || []).length;
                    totalStores += n;
                    done.push({ ym, n, routes: Object.keys(built.routes).length, cal: Object.keys(built.routeCal || {}).length });
                }

                // V0.7.1: Geo Tree (ไม่บังคับ) — เก็บของศูนย์ตามไฟล์ที่นำเข้า
                let geoMsg = '';
                if (S._files.geo && window.GeoTree) {
                    UI.showLoader('🌳 กำลังอ่าน CUSTOMER_GEO_TREE...', S._files.geo.name);
                    try {
                        const rd = Object.values(S._data.routeDist || {}).filter(Boolean);
                        const cnt = {}; rd.forEach(v => { cnt[v] = (cnt[v] || 0) + 1; });
                        const dist = (Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || [''])[0];
                        const g = await GeoTree.load(S._files.geo, String(dist || ''), true);
                        geoMsg = ` · Geo Tree ${Object.keys(g.cust).length.toLocaleString()} ร้าน`;
                    } catch (e) { UI.showErrorToast('⚠️ นำเข้าแผนแล้ว แต่อ่าน Geo Tree ไม่สำเร็จ: ' + (e && e.message || e)); }
                }

                // V1.0.0: เก็บสำเนาไฟล์ไว้ให้ครั้งถัดไป
                try { UI.showLoader('📁 กำลังเก็บสำเนาไฟล์ไว้ในเครื่อง...', ''); await FileVault.saveFiles(S._files); } catch (e) { console.warn('[FileVault]', e); }

                // เปิดดูเดือนล่าสุดที่เพิ่งนำเข้า
                const last = months[months.length - 1];
                UI.showLoader('กำลังเปิดแผน...', App.ymToLabel(last));
                State.localActiveRoute = '';
                await App._loadPlan(last);
                App._currentPlanYM = last;
                PlanUI.refresh();
                UI.hideLoader();
                MapCtrl.fitToStores();

                const calN = done.reduce((t, d) => t + (d.cal || 0), 0);
                UI.showSaveToast(`✅ นำเข้าแล้ว ${done.filter(d => d.n).length} เดือน · ${totalStores.toLocaleString()} ร้าน` +
                    (calN ? ` · ตั้งปฏิทินให้ ${calN} สายตามวันที่ในไฟล์` : '') +
                    (totalParked ? ` · พักร้านเดิมที่หายจากไฟล์ ${totalParked}` : '') +
                    (totalKept ? ` · ไม่แตะสายที่มีอยู่แล้ว ${totalKept}` : '') + (totalRemoved ? ` · ลบสายที่ติ๊กออก ${totalRemoved}` : '') + geoMsg);
            } catch (e) {
                UI.hideLoader();
                UI.showErrorToast('❌ นำเข้าไม่สำเร็จ: ' + e.message);
                console.error('[SysImport]', e);
            } finally {
                S._busy = false;
            }
        },

        // ── หน้าตา ──────────────────────────────────────────────────────
        _render() {
            const el = document.getElementById('sysimport-modal');
            if (!el) return;
            const f = S._files, d = S._data;

            const slot = (kind, label, hint, accept, extra) => {
                const file = f[kind];
                return `
                <div class="border-2 border-dashed ${file ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-gray-50'} rounded-xl p-3 cursor-pointer hover:bg-gray-100 transition ${extra || ''}"
                     onclick="document.getElementById('sysimport-${kind}').click()">
                    <input type="file" id="sysimport-${kind}" accept="${accept || '.xlsx,.xls'}" class="hidden" onchange="SysImport.pick('${kind}', event)">
                    <div class="text-xs font-black ${file ? 'text-emerald-800' : 'text-gray-700'}">${file ? '✅ ' : '📄 '}${label}</div>
                    <div class="text-[11px] ${file ? 'text-emerald-600' : 'text-gray-400'} truncate">${file ? file.name : hint}</div>
                </div>`;
            };

            // V0.9.18 (I2): ใบนำเข้าล่าสุดของเดือนที่เปิดอยู่
            const L = S._last;
            const lastBox = L ? `
                <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-[11.5px] text-amber-900">
                    <div class="flex items-center justify-between gap-2">
                        <b class="text-xs">📋 การนำเข้าล่าสุด${L.other ? 'ของศูนย์ (เดือน ' + App.ymToLabel(L.ym) + ')' : 'ของเดือน ' + App.ymToLabel(L.ym)}</b>
                        <span class="text-[10.5px] text-amber-700">${L.at ? new Date(L.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                    </div>
                    ${L.other ? `<div class="text-[10.5px] text-amber-700">เดือน ${App.ymToLabel(App._currentPlanYM)} ที่เปิดอยู่ไม่ได้นำเข้าจากไฟล์ (สร้างด้วย + เพิ่มเดือน) — นำเข้าตอนนี้จะเข้าเดือนที่ติ๊กด้านล่าง</div>` : ''}
                    ${L.legacy ? `<div class="mt-1 leading-snug">นำเข้าด้วยเวอร์ชันก่อน V0.9.18 — ยังไม่มีรายการที่ติ๊กเก็บไว้ · ประเภทสาย: ${(L.types || []).join(' / ') || '—'} · ร้าน Active ใน Master: ${(L.mActive || 0).toLocaleString()}${L.mActiveBy ? ' (' + ['P','V','C','E'].filter(t => L.mActiveBy[t]).map(t => t + ' ' + L.mActiveBy[t].toLocaleString()).join(' · ') + ')' : ''}<br>นำเข้าครั้งถัดไประบบจะเก็บใบนำเข้าให้</div></div>` : `
                    <div class="mt-1 leading-snug">ไฟล์: ${esc(L.planFile || '—')} + ${esc(L.masterFile || '—')}${L.geoFile ? ' + ' + esc(L.geoFile) : ''}<br>
                    เดือน: ${(L.months || []).map(y => App.ymToLabel(y)).join(', ') || '—'} · สาย: <b>${(L.routes || []).length}</b>/${(L.routesAll || []).length}${(L.routesAll || []).length > (L.routes || []).length ? ` (ไม่ได้ติ๊ก: ${(L.routesAll || []).filter(c => !(L.routes || []).includes(c)).join(' ')})` : ''}<br>
                    ร้านในแผน: ${L.onlyActive === false ? 'เอาเข้าทั้งหมดตาม RoutePlan' : 'เฉพาะ Active (เวอร์ชันก่อน)'} · ร้านใหม่นอกแผน (Active): ${L.withOutside ? `เอาเข้า ${(L.outside || 0).toLocaleString()} ร้าน` : 'ไม่เอาเข้า'}${L.outsideBy && L.outsideBy.X ? ` · ข้าม ${L.outsideBy.X.toLocaleString()} ร้านที่ Salesman Code ไม่ใช่ P/V/C/E` : ''}${(L.kept || 0) ? ` · ไม่แตะสายเดิม ${L.kept}` : ''}${(L.removed || []).length ? ` · ลบ ${L.removed.join(' ')}` : ''}</div>
                    <label class="flex items-center gap-2 mt-1.5 cursor-pointer"><input type="checkbox" ${S._reuse ? 'checked' : ''} onchange="SysImport.setReuse(this.checked)" class="w-3.5 h-3.5"> <span>เมื่อเลือกไฟล์ใหม่ ให้ติ๊กตามครั้งก่อนเป็นค่าเริ่มต้น (แล้วค่อยติ๊กเพิ่ม/ออก)</span></label>
                </div>`}` : '';

            let body = lastBox + `<p class="text-xs text-gray-400 text-center py-6">เลือกไฟล์ให้ครบทั้ง 2 ช่อง แล้วระบบจะอ่านและสรุปให้ดูก่อนนำเข้า${L ? '<br>นำเข้าเพิ่ม/แก้: เลือก 2 ไฟล์เดิม (หรือไฟล์ใหม่) แล้วติ๊กเพิ่ม/ออกจากชุดเดิม' : ''}</p>`;

            if (d) {
                const pickedM = d.yms.filter(y => S._months[y]);
                const pickedR = d.routeCodes.filter(c => S._routes[c]);
                let nStore = 0;
                pickedM.forEach(y => {
                    const set = new Set();
                    Object.entries(d.months[y].routes).forEach(([c, R]) => { if (S._routes[c]) R.custs.forEach(x => set.add(x)); });
                    nStore = Math.max(nStore, set.size);
                });
                const st = d.stats;
                const skipped = st.noMaster + st.noGeo + st.noDay;

                const outPick = S.outsidePick().length;
                const ob = d.outsideBy || {};
                const on = S.typesOn();
                const outTxt = ['P', 'V', 'C', 'E'].filter(t => ob[t]).map(t => `${t} ${ob[t].toLocaleString()}${on.has(t) ? '' : ' (ไม่ได้ติ๊ก)'}`).join(' · ');
                body = lastBox + `
                <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-3">
                    <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-indigo-900">
                        <span>พบ <span class="text-base">${d.yms.length}</span> เดือน (${st.sheets} แท็บ)</span>
                        <span>เลือก <span class="text-base">${pickedM.length}</span> เดือน · <span class="text-base">${pickedR.length}</span>/${d.routeCodes.length} สาย</span>
                        <span>ร้านต่อเดือน ~<span class="text-base">${nStore.toLocaleString()}</span></span>
                    </div>
                    ${skipped ? `<div class="text-[11px] text-amber-700 mt-1.5 font-medium">
                        ข้ามร้าน ${skipped.toLocaleString()} —
                        ${st.noMaster ? `ไม่พบใน Customer Master ${st.noMaster} · ` : ''}
                        ${st.noGeo ? `ไม่มีพิกัด ${st.noGeo} · ` : ''}
                        ${st.noDay ? `แกะเลขวันไม่ได้ ${st.noDay} · ` : ''}
                    </div>` : `<div class="text-[11px] text-emerald-700 mt-1.5 font-medium">จับคู่ครบทุกแถว ไม่มีร้านตกหล่น</div>`}
                    ${st.inactiveSkipped ? `<div class="text-[11px] text-indigo-800 mt-1 font-medium">ร้านในแผนที่ Master เป็น InActive ${st.inactiveSkipped.toLocaleString()} ร้าน — เอาเข้าตาม Route Plan มีป้าย "Master: Inactive" ให้ตรวจ</div>` : ''}
                </div>

                <div class="flex items-center justify-between mb-1.5">
                    <label class="text-xs font-black text-gray-700">เดือนที่จะนำเข้า</label>
                    <div class="flex gap-1.5">
                        <button onclick="SysImport.allMonths(true)" class="text-[11px] font-bold text-indigo-600 hover:underline">ทั้งหมด</button>
                        <span class="text-gray-300">|</span>
                        <button onclick="SysImport.allMonths(false)" class="text-[11px] font-bold text-gray-500 hover:underline">ล้าง</button>
                    </div>
                </div>
                <div class="border border-gray-200 rounded-xl max-h-40 overflow-y-auto divide-y divide-gray-100 mb-1">
                    ${d.yms.slice().reverse().map(y => `
                        <label class="flex items-center gap-3 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" ${S._months[y] ? 'checked' : ''} onchange="SysImport.toggleMonth('${y}')" class="w-4 h-4 shrink-0">
                            <span class="font-bold text-sm text-gray-800 w-28 shrink-0">${App.ymToLabel(y)}</span>
                            <span class="text-[11px] text-gray-500">${d.months[y].rows.toLocaleString()} แถว · ${Object.keys(d.months[y].routes).length} สาย</span>
                        </label>`).join('')}
                </div>
                <p class="text-[11px] text-gray-400 mb-3">แต่ละเดือนใช้เวลาราวครึ่งนาที เลือกเท่าที่จำเป็น</p>

                <label class="text-xs font-black text-gray-700 block mb-1.5">ประเภทสายที่จะนำเข้า <span class="font-normal text-[11px] text-gray-400">· ไม่ติ๊ก = ไม่นำเข้าร้านของสายประเภทนั้นเลย</span></label>
                <div class="border border-gray-200 rounded-xl divide-y divide-gray-100 mb-3">
                    ${(() => {
                        const lastM = d.yms[d.yms.length - 1];
                        return RTYPES.map(t => {
                            const codes = d.routeCodes.filter(c => rtype(c) === t.k);
                            if (!codes.length) return '';
                            const on = codes.filter(c => S._routes[c]).length;
                            const set = new Set();
                            codes.forEach(c => { const R = d.months[lastM].routes[c]; if (R) R.custs.forEach(x => set.add(x)); });
                            return `<label class="flex items-center gap-3 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                                <input type="checkbox" ${on === codes.length ? 'checked' : ''} ${on && on < codes.length ? 'data-mixed="1"' : ''} onchange="SysImport.toggleType('${t.k}')" class="w-4 h-4 shrink-0">
                                <span class="font-black text-sm text-gray-800 w-28 shrink-0">${t.k === 'X' ? '' : t.k + ' · '}${t.name}</span>
                                <span class="text-[11px] text-gray-500 flex-1">${codes.length} สาย${on && on < codes.length ? ` (เลือก ${on})` : ''} · ${set.size.toLocaleString()} ร้าน${t.k === 'X' ? ' · ' + codes.slice(0, 4).join(' ') + (codes.length > 4 ? ' …' : '') : ''}</span>
                                <span class="text-[10px] ${'PVC'.includes(t.k) ? 'text-emerald-600' : 'text-amber-600'} text-right">${t.note}</span>
                            </label>`;
                        }).join('');
                    })()}
                </div>

                <div class="flex items-center justify-between mb-1.5">
                    <label class="text-xs font-black text-gray-700">สายที่จะนำเข้า</label>
                    <div class="flex gap-1.5">
                        <button onclick="SysImport.allRoutes(true)" class="text-[11px] font-bold text-indigo-600 hover:underline">ทั้งหมด</button>
                        <span class="text-gray-300">|</span>
                        <button onclick="SysImport.allRoutes(false)" class="text-[11px] font-bold text-gray-500 hover:underline">ล้าง</button>
                    </div>
                </div>
                <div class="border border-gray-200 rounded-xl max-h-36 overflow-y-auto divide-y divide-gray-100 mb-3">
                    ${d.routeCodes.map(c => `
                        <label class="flex items-center gap-3 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" ${S._routes[c] ? 'checked' : ''} onchange="SysImport.toggleRoute('${c}')" class="w-4 h-4 shrink-0">
                            <span class="font-bold text-sm text-gray-800">${c}</span>
                        </label>`).join('')}
                </div>

                <div class="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                    <div class="text-xs text-gray-700 leading-snug">
                        <b>ร้านในแผน: เอาเข้าทั้งหมดตามไฟล์ RoutePlan</b><br>
                        <span class="text-[11px] text-gray-400">ไม่ตัดร้านที่ Master เป็น InActive (ติดป้ายให้ตรวจ และส่งออก DMS ตามแผน) · ข้ามเฉพาะร้านที่ไม่มีใน Master / ไม่มีพิกัด</span>
                    </div>
                    <label class="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" ${S._withOutside ? 'checked' : ''} onchange="SysImport.setOutside(this.checked)" class="w-4 h-4 mt-0.5 shrink-0">
                        <span class="text-xs text-gray-700 leading-snug">
                            <b>เพิ่มร้าน Active ที่ยังไม่อยู่ในแผน</b> (${outPick.toLocaleString()} ร้าน${outTxt ? ' — ' + outTxt : ''})<br>
                            <span class="text-[11px] text-gray-400">เฉพาะร้านที่ Salesman Code เป็นประเภทที่ติ๊กด้านบน · จะเข้าสาย "${UNASSIGNED_ROUTE}" เป็นหมุดเทา ยังไม่มีวัน</span>
                            ${ob.X ? `<br><span class="text-[11px] text-amber-700">ข้าม ${ob.X.toLocaleString()} ร้านที่ Salesman Code ว่าง/ไม่ใช่ P/V/C/E (เช่น บัญชีพนักงาน) — ไม่นำเข้า</span>` : ''}
                        </span>
                    </label>
                    <label class="flex items-start gap-2 cursor-pointer border-t border-gray-200 pt-2">
                        <input type="checkbox" ${S._overwrite ? 'checked' : ''} onchange="SysImport.setOverwrite(this.checked)" class="w-4 h-4 mt-0.5 shrink-0">
                        <span class="text-xs text-gray-700 leading-snug">
                            <b>เขียนทับสายที่มีอยู่แล้วในเดือนนั้นด้วยข้อมูลจากไฟล์</b><br>
                            <span class="text-[11px] text-gray-400">ไม่ติ๊ก (ค่าเริ่มต้น) = สายที่มีอยู่แล้วไม่ถูกแตะ เก็บที่แก้ไว้ นำเข้าเฉพาะสายที่ยังไม่มี · ติ๊ก = ทุกสายที่เลือกถูกแทนด้วยไฟล์ (ร้านที่หายจากไฟล์ถูกพักไว้) · สายที่ติ๊กออกแต่มีอยู่แล้ว ระบบจะถามว่าจะลบไหม</span>
                        </span>
                    </label>
                </div>`;
            }

            el.innerHTML = `
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
                    <div>
                        <h2 class="text-base font-black text-gray-900">📥 นำเข้าจากไฟล์ระบบ</h2>
                        <p class="text-[11px] text-gray-500">จับคู่แผนวิ่งกับพิกัดร้านให้อัตโนมัติด้วย Customer Code</p>
                    </div>
                    <button onclick="SysImport.close()" class="text-gray-400 hover:text-gray-700 text-xl leading-none px-2">✕</button>
                </div>
                <div class="p-4 overflow-y-auto">
                    ${S._vault ? `<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 mb-2.5 flex items-center gap-3">
                        <div class="flex-1 text-[11.5px] text-emerald-900 leading-snug">
                            <b class="text-xs">📁 ไฟล์ที่เก็บไว้จากการนำเข้าล่าสุด</b> <span class="text-[10.5px] text-emerald-700">${S._vault.at ? new Date(S._vault.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span><br>
                            ${S._vault.plan ? esc(S._vault.plan.name) + ' (' + FileVault.fmt(S._vault.plan.size) + ')' : '—'} · ${S._vault.master ? esc(S._vault.master.name) + ' (' + FileVault.fmt(S._vault.master.size) + ')' : '—'}${S._vault.geo ? ' · ' + esc(S._vault.geo.name) : ''}
                        </div>
                        <button onclick="SysImport.useVault()" ${S._fromVault ? 'disabled' : ''} class="shrink-0 ${S._fromVault ? 'bg-emerald-200 text-emerald-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} px-3 py-1.5 rounded-lg text-xs font-bold">${S._fromVault ? '✅ ใช้ไฟล์เดิมอยู่' : '📂 ใช้ไฟล์เดิม'}</button>
                    </div>` : ''}
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                        ${slot('plan', '1. RoutePlan Detail', 'แผนวิ่ง — มีหลายแท็บได้ (เดือนละแท็บ)')}
                        ${slot('master', '2. Customer Master', 'ข้อมูลร้าน — มีพิกัดและสถานะร้าน')}
                        ${slot('geo', '3. CUSTOMER_GEO_TREE (ไม่บังคับ)', 'ร้าน → เซลล์ใน DMS (.zip / .csv) — ต้องใช้เมื่อย้ายร้านข้ามเซลล์', '.zip,.csv,.txt', 'sm:col-span-2')}
                    </div>
                    ${body}
                </div>
                <div class="p-4 border-t bg-gray-50 flex gap-2 shrink-0">
                    <button onclick="SysImport.close()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-2.5 rounded-xl font-bold text-sm transition">ยกเลิก</button>
                    <button onclick="SysImport.run()" ${d ? '' : 'disabled'}
                        class="flex-1 ${d ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300 cursor-not-allowed'} text-white py-2.5 rounded-xl font-bold text-sm transition">
                        นำเข้าข้อมูล
                    </button>
                </div>
            </div>`;
        },
    };

    S.parseCycleName = parseCycleName;
    S._vaultApi = FileVault;      // ให้ LocalExtras แนบ/คืนสำเนาไฟล์ตอน Save / Restore
    S.asDay = asDay;   // ให้โมดูลอื่นอ่านวันที่จาก Excel ด้วยกติกาเดียวกัน   // ให้ส่วนอื่นใช้ตัวแกะตัวเดียวกัน (multi-route ใช้หา "เดิม Dx")
    return S;
})();

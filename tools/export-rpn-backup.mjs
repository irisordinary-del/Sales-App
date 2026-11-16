#!/usr/bin/env node
/* =============================================================================
 *  tools/export-rpn-backup.mjs — ส่งออกแผนจากระบบออนไลน์ (Firestore) เป็นไฟล์ "Save" ของ RPN ออฟไลน์
 * =============================================================================
 *  RPN ของส่วนกลาง (แพ็กเกจ RoutePlanner <ศูนย์>) เก็บข้อมูลใน IndexedDB ของเครื่อง · ปุ่ม Restore
 *  (มุมซ้ายล่าง, local-extras.js) อ่านไฟล์ { _v: 1, docs: { "<path Firestore>": {ข้อมูล} } } แล้วเขียนทับ path นั้น
 *  path ของ RPN ออฟไลน์ = path เดียวกับ Firestore ของเรา → ดึงจาก Firestore แล้วจัดรูปให้ตรงได้เลย
 *
 *  ใช้:  node tools/export-rpn-backup.mjs <ศูนย์> <เดือน,เดือน,...> [ไฟล์ปลายทาง.json]
 *        เช่น node tools/export-rpn-backup.mjs 402 2026_11,2026_12
 *  ไฟล์ที่ได้ → เปิด RoutePlanner <ศูนย์> ในเครื่องปลายทาง → กด Restore → เลือกไฟล์
 *
 *  ใส่อะไรบ้าง
 *    • appData/<ศูนย์>_main (เอกสารศูนย์ — planList ตัดเหลือเฉพาะเดือนที่ส่งออก)
 *    • appData/<ศูนย์>_main/plans/<เดือน> + routes/* ทุกสาย (รวม รอจัดสาย, calendarOverride, dayOffs ฯลฯ)
 *    • appData/<ศูนย์>_main/meta/geoTree (แปลงกลับจากรูปแบบออนไลน์ "Node\tเริ่ม\tจบ" เป็น array ซ้อนแบบที่ RPN ใช้)
 *  ไม่ใส่: rpnCal / rpnCalIndex (ของแอปเซลฝั่งออนไลน์เท่านั้น) · ตารางระยะถนน (มากับแพ็กเกจของศูนย์อยู่แล้ว)
 *  ส่งเดือนก่อนหน้าไปด้วยเสมอ (เช่น พ.ย. คู่ ธ.ค.) — หน้าภาพรวมใช้เป็น "เดือนฐาน" และส่งออก DMS ใช้ต่อเลข CY
 *
 *  ⚠️ Restore เขียนทับข้อมูลศูนย์+เดือนเดียวกันในเครื่องปลายทาง (เดือนอื่นไม่แตะ) — ให้ปลายทาง Save เก็บไว้ก่อน
 *  อ่านอย่างเดียวจาก Firestore (REST ไม่ต้องล็อกอิน เพราะ rules อ่านได้) — ไม่เขียนอะไรกลับ
 * ========================================================================== */
import fs from 'node:fs';

const [center, monthsArg, outArg] = process.argv.slice(2);
if (!center || !monthsArg) {
    console.error('ใช้: node tools/export-rpn-backup.mjs <ศูนย์> <YYYY_MM,YYYY_MM,...> [ไฟล์.json]');
    process.exit(1);
}
const months = monthsArg.split(',').map(s => s.trim()).filter(Boolean);
if (months.some(m => !/^\d{4}_\d{2}$/.test(m))) { console.error('เดือนต้องเป็น YYYY_MM'); process.exit(1); }
const out = outArg || `RPN-Restore-${center}-${months.join('_')}.json`;

const API = 'https://firestore.googleapis.com/v1/projects/route-plan-71e2e/databases/(default)/documents/';
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

// Firestore REST value → ค่าแบบที่ local-firebase.js ของ RPN เก็บ (Timestamp = { __ts__: มิลลิวินาที })
const dec = (v) => {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return { __ts__: Date.parse(v.timestampValue) };
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = dec(x); return o; }
    if ('geoPointValue' in v) return v.geoPointValue;
    if ('referenceValue' in v) return v.referenceValue;
    throw new Error('ไม่รู้จักชนิดข้อมูล ' + JSON.stringify(v).slice(0, 80));
};
const fields = (d) => { const o = {}; for (const [k, x] of Object.entries(d.fields || {})) o[k] = dec(x); return o; };
const getDoc = async (p) => {
    const r = await fetch(API + enc(p));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return fields(await r.json());
};
const listCol = async (p) => {
    const docs = []; let tok = '';
    do {
        const r = await fetch(API + enc(p) + '?pageSize=300' + (tok ? '&pageToken=' + tok : ''));
        if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
        const j = await r.json();
        (j.documents || []).forEach(d => docs.push({ id: decodeURIComponent(d.name.split('/').pop()), data: fields(d) }));
        tok = j.nextPageToken;
    } while (tok);
    return docs;
};

const base = `appData/${center}_main`;
const docs = {};
const centerDoc = await getDoc(base);
if (!centerDoc) { console.error(`ไม่พบศูนย์ ${center}`); process.exit(2); }
centerDoc.planList = months.slice().sort().reverse();
delete centerDoc.currentPlanYM;                       // ของระบบออนไลน์เดิม — RPN ไม่ใช้
docs[base] = centerDoc;

const summary = [];
for (const ym of months) {
    const plan = await getDoc(`${base}/plans/${ym}`);
    if (!plan) { console.error(`❌ ศูนย์ ${center} ไม่มีแผนเดือน ${ym}`); process.exit(2); }
    delete plan.rpnCalIndex;
    docs[`${base}/plans/${ym}`] = plan;
    const routes = await listCol(`${base}/plans/${ym}/routes`);
    let stores = 0;
    for (const { id, data } of routes) {
        delete data.rpnCal;
        docs[`${base}/plans/${ym}/routes/${id}`] = data;
        if (id !== 'รอจัดสาย') stores += (data.stores || []).filter(s => !s.inactive && (s.days || []).length).length;
    }
    summary.push(`${ym}: ${routes.length} เอกสารสาย · ${stores.toLocaleString()} ร้านที่มีวัน`);
}

// Geo Tree — ออนไลน์เก็บเป็น "Node\tเริ่ม\tจบ" (+ _enc:'tsv1') เพราะ Firestore ไม่รับ array ซ้อน (rpn-online.js §5) → แปลงกลับ
const geo = await getDoc(`${base}/meta/geoTree`);
if (geo) {
    if (geo._enc === 'tsv1' && geo.cust) {
        for (const c of Object.keys(geo.cust)) {
            const v = geo.cust[c];
            if (Array.isArray(v)) geo.cust[c] = v.map(x => typeof x === 'string' ? x.split('\t') : x);
        }
        delete geo._enc;
    }
    docs[`${base}/meta/geoTree`] = geo;
}

fs.writeFileSync(out, JSON.stringify({ _v: 1, exportedAt: new Date().toISOString(), source: `online ${base}`, docs }));
console.log(`✅ ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB · ${Object.keys(docs).length} รายการ)`);
summary.forEach(s => console.log('   ' + s));
console.log('   Geo Tree: ' + (geo ? 'มี' : 'ไม่มี'));

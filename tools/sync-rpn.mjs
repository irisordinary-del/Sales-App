#!/usr/bin/env node
/* =============================================================================
 *  tools/sync-rpn.mjs — ดึง RPN V0 (โปรแกรมวางแผนของบริษัท) เข้ามาไว้ที่ rpn/ แบบออนไลน์
 * =============================================================================
 *  RPN V0 เป็นโปรแกรมวางแผนที่บริษัทพัฒนาต่อจากหน้า admin เดิมของเรา รันในเครื่อง (IndexedDB)
 *  แต่ยังเรียก Firestore API และ path เดียวกับระบบเรา (appData/{ศูนย์}_main/plans/...)
 *  สคริปต์นี้คัดลอกไฟล์ของ RPN V0 มาไว้ใน rpn/ แล้วแก้เฉพาะ RoutePlannerV0.html ให้
 *    • ใช้ Firebase จริงแทน local-firebase.js
 *    • ใช้ระบบล็อกอินของเรา (../auth.js) แทน auth-local.js
 *    • ตัดไฟล์ที่ใช้ได้เฉพาะโหมด local (Save/Restore/ล้างข้อมูลในเครื่อง, สลับศูนย์ในเครื่อง)
 *    • โหลด rpn-online-pre.js / rpn-online.js ซึ่งเป็นตัวต่อเข้ากับระบบออนไลน์ (เราเขียนเอง)
 *  ไฟล์ .js อื่นของ RPN V0 ไม่แตะเลย — เวอร์ชันใหม่ของบริษัทจึงวางทับได้ด้วยการรันสคริปต์นี้ซ้ำ
 *
 *  วิธีใช้:  node tools/sync-rpn.mjs "<โฟลเดอร์ RPN V0>"
 *  ถ้าจุดที่ต้องแก้ใน HTML หาไม่เจอ (บริษัทเปลี่ยนโครงไฟล์) สคริปต์จะหยุดและบอกว่าจุดไหน
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(path.join(SRC, 'RoutePlannerV0.html'))) {
    console.error('ใช้: node tools/sync-rpn.mjs "<โฟลเดอร์ RPN V0 ที่มี RoutePlannerV0.html>"');
    process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DST = path.join(ROOT, 'rpn');

// ไฟล์ที่ใช้ได้เฉพาะโหมด local — ไม่คัดลอก (หน้าที่ของมันย้ายไปอยู่ใน rpn-online*.js)
const SKIP = new Set([
    'local-firebase.js',     // ตัวจำลอง Firestore บน IndexedDB → ใช้ Firebase จริงแทน
    'auth-local.js',         // ไม่มีล็อกอิน → ใช้ ../auth.js
    'local-extras.js',       // Save/Restore/ล้างข้อมูลในเครื่อง + ป้ายศูนย์
    'center.js',             // สลับศูนย์ในเครื่อง → ศูนย์มาจาก ?center= ของระบบเรา
    'road-matrix.js',        // สำเนาของ road-matrix.bin ไว้ใช้ตอนเปิดแบบ file:// เท่านั้น
    'Basemap-Preview.html', 'Reset-RoutePlanner.html', 'Start-RoutePlanner.bat',
]);
// ไฟล์ของเราเองที่อยู่ใน rpn/ — ห้ามลบ/ทับ
const OURS = new Set(['rpn-online-pre.js', 'rpn-online.js', 'SYNC.md']);
const COPY_DIRS = ['vendor'];

// ── 1) ล้างของเดิม (ยกเว้นไฟล์ของเรา) แล้วคัดลอกใหม่ ─────────────────────────
fs.mkdirSync(DST, { recursive: true });
for (const f of fs.readdirSync(DST)) {
    if (OURS.has(f)) continue;
    fs.rmSync(path.join(DST, f), { recursive: true, force: true });
}
const copied = [];
for (const f of fs.readdirSync(SRC)) {
    const p = path.join(SRC, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
        if (COPY_DIRS.includes(f)) { fs.cpSync(p, path.join(DST, f), { recursive: true }); copied.push(f + '/'); }
        continue;
    }
    if (SKIP.has(f) || OURS.has(f)) continue;
    if (!/\.(js|css|html|bin|md)$/i.test(f) && f !== 'VERSION') continue;
    fs.copyFileSync(p, path.join(DST, f));
    copied.push(f);
}

// ── 2) แก้ RoutePlannerV0.html ──────────────────────────────────────────────
const htmlPath = path.join(DST, 'RoutePlannerV0.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const must = (re, to, what) => {
    if (!re.test(html)) { console.error(`❌ หาจุดแก้ไม่เจอ: ${what}\n   (RPN V0 เปลี่ยนโครง RoutePlannerV0.html — ต้องแก้ tools/sync-rpn.mjs)`); process.exit(2); }
    html = html.replace(re, to);
};
const FIREBASE = '<script src="https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js"></script>\n' +
                 '    <script src="https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore-compat.js"></script>\n' +
                 '    <script src="../plan-lock.js"></script>';
must(/<script src="local-firebase\.js[^"]*"><\/script>/, FIREBASE, 'local-firebase.js');
must(/<script src="auth-local\.js[^"]*"><\/script>/,
     '<script src="../auth.js"></script>\n    <script src="rpn-online-pre.js"></script>', 'auth-local.js');
must(/\s*<script src="local-extras\.js[^"]*"><\/script>/, '', 'local-extras.js');
must(/\s*<script src="center\.js[^"]*"><\/script>/, '', 'center.js');
must(/<\/body>/, '    <script src="rpn-online.js"></script>\n</body>', '</body>');
fs.writeFileSync(htmlPath, html);

const ver = fs.existsSync(path.join(DST, 'VERSION')) ? fs.readFileSync(path.join(DST, 'VERSION'), 'utf8').trim() : '?';
console.log(`✅ ซิงก์ RPN V${ver} เข้า rpn/ แล้ว — ${copied.length} รายการ`);

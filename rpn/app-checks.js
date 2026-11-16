/* =============================================================================
 *  app-checks.js — คำเตือนระหว่างใช้งาน (V1.0.3)
 * =============================================================================
 *  1) เปิดแผน "เดือนปัจจุบัน" (เดือนเดียวกับวันนี้) → แถบเตือนค้างไว้ด้านบน
 *     + ทุกครั้งที่มีการแก้/บันทึกข้อมูลของเดือนนั้น → เตือนซ้ำ (เว้นระยะ 1 นาที)
 *     เพราะแผนเดือนปัจจุบันคือแผนที่ทีมขายวิ่งอยู่ / ส่งเข้า DMS ไปแล้ว
 *  2) เปิดโปรแกรม → ตรวจพื้นที่เก็บข้อมูลของเบราว์เซอร์ ใกล้เต็ม = เตือน (บันทึกจะไม่ลงเครื่อง)
 *  3) เปิดโปรแกรม → ตรวจว่าไฟล์โปรแกรมทุกไฟล์เป็นเวอร์ชันเดียวกัน (กันแตกไฟล์ทับไม่ครบ / ไฟล์เก่าค้างในแคช)
 * ========================================================================== */
const AppChecks = (() => {
    'use strict';
    const VER = '1.0.4';
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const realYM = () => { const d = new Date(); return `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const label = (ym) => { try { return App.ymToLabel(ym); } catch (e) { return ym; } };
    const isCur = () => typeof App !== 'undefined' && App._currentPlanYM && App._currentPlanYM === realYM();

    // ── 1) แผนเดือนปัจจุบัน ─────────────────────────────────────────────
    let bar = null, quietUntil = 0, lastWarn = 0, lastYM = '';
    const paint = () => {
        const on = isCur();
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'curmonth-bar';
            bar.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:9990;pointer-events:none;'
                + 'background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:999px;padding:3px 14px;'
                + 'font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis;transition:transform .2s';
            document.body.appendChild(bar);
        }
        if (on) bar.innerHTML = `⚠️ กำลังเปิดแผนเดือนปัจจุบัน (${esc(label(App._currentPlanYM))}) — ทีมขายใช้แผนนี้อยู่ แก้แล้วต้องส่งออก DMS ใหม่`;
        bar.style.display = on ? '' : 'none';
        if (App && App._currentPlanYM !== lastYM) { lastYM = App._currentPlanYM; quietUntil = Date.now() + 8000; }   // ช่วงโหลดเดือน ระบบเขียนซ่อมข้อมูลเองได้ — ไม่นับ
    };
    const flash = () => {
        if (!bar) return;
        bar.style.transform = 'translateX(-50%) scale(1.12)';
        setTimeout(() => { if (bar) bar.style.transform = 'translateX(-50%)'; }, 350);
    };
    const onWrite = (path) => {
        if (!isCur() || Date.now() < quietUntil) return;
        let col = '';
        try { col = App.planRef(App._currentPlanYM).path; } catch (e) { return; }
        if (path !== col && path.indexOf(col + '/') !== 0) return;               // ไม่ใช่ข้อมูลของเดือนนี้
        flash();
        const now = Date.now();
        if (now - lastWarn < 60000) return;
        lastWarn = now;
        toast(`⚠️ กำลังแก้แผนเดือนปัจจุบัน (${label(App._currentPlanYM)}) — แผนนี้ทีมขายใช้อยู่ ถ้าตั้งใจแก้ อย่าลืมส่งออก DMS ใหม่ · ถ้าจะทำแผนเดือนหน้า ให้สลับเดือนก่อน`);
    };
    const toast = (msg, red) => {
        const el = document.createElement('div');
        el.style.cssText = `position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:9999;max-width:min(560px,calc(100vw - 32px));`
            + `background:${red ? '#fee2e2' : '#fffbeb'};color:${red ? '#991b1b' : '#92400e'};border:2px solid ${red ? '#ef4444' : '#f59e0b'};`
            + 'border-radius:14px;padding:10px 14px;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.2);line-height:1.5';
        el.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1">${esc(msg)}</div><button style="font-weight:800;opacity:.6">✕</button></div>`;
        el.querySelector('button').onclick = () => el.remove();
        document.body.appendChild(el);
        setTimeout(() => el.remove(), red ? 20000 : 7000);
    };

    // ── 2) พื้นที่เก็บข้อมูล ──────────────────────────────────────────────
    const checkStorage = async () => {
        try {
            if (!navigator.storage || !navigator.storage.estimate) return null;
            const { usage = 0, quota = 0 } = await navigator.storage.estimate();
            if (!quota) return null;
            const mb = (x) => Math.round(x / 1048576).toLocaleString();
            const free = quota - usage;
            const info = { usage, quota, free, pct: usage / quota };
            if (info.pct > 0.85 || free < 150 * 1048576) {
                toast(`💾 พื้นที่เก็บข้อมูลของเบราว์เซอร์ใกล้เต็ม (ใช้ ${mb(usage)} จาก ${mb(quota)} MB · เหลือ ${mb(free)} MB) — การบันทึกอาจไม่ลงเครื่อง ` +
                    `ให้สำรองข้อมูล (ไฟล์ JSON) ไว้ก่อน แล้วเคลียร์พื้นที่ดิสก์ของเครื่อง / ลบข้อมูลเว็บที่ไม่ใช้`, true);
            }
            return info;
        } catch (e) { return null; }
    };

    // ── 3) ไฟล์โปรแกรมเวอร์ชันเดียวกันไหม ───────────────────────────────
    const checkFiles = () => {
        const stamp = window.__RPV || {};
        const bad = [];
        document.querySelectorAll('script[src]').forEach(s => {
            const src = s.getAttribute('src') || '';
            if (/^(https?:)?\/\//i.test(src) || /(^|\/)(vendor|road-matrix)\//.test(src) || !/\.js(\?|$)/.test(src)) return;   // ไลบรารีภายนอก · ตารางระยะถนนรายศูนย์
            const f = src.split('?')[0].split('/').pop();
            if (f === 'app-config.js' || f === 'basemap-data.js' || f === 'road-matrix.js' || f === 'package.js') return;   // ไฟล์ข้อมูล/ตั้งค่า (บางไฟล์โหลดภายหลัง) ไม่มีเลขเวอร์ชัน
            if (stamp[f] !== VER) bad.push(`${f}${stamp[f] ? ' (V' + stamp[f] + ')' : ' (ไม่มีเลขเวอร์ชัน)'}`);
        });
        if (bad.length) {
            console.error('[AppChecks] ไฟล์ไม่ตรงเวอร์ชัน', bad);
            toast(`⛔ ไฟล์โปรแกรมไม่ครบ/ไม่ตรงเวอร์ชัน V${VER} (${bad.length} ไฟล์: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}) — ` +
                `ปิดโปรแกรม แตกไฟล์ zip ใหม่ทับให้ครบทุกไฟล์ แล้วเปิดใหม่ด้วย Ctrl+F5 · อย่าเพิ่งแก้แผน`, true);
        }
        return bad;
    };

    const boot = () => {
        if (typeof App === 'undefined' || !document.body) return setTimeout(boot, 400);
        paint();
        setInterval(paint, 1500);
        try { if (window.LocalDB && LocalDB.onWrite) LocalDB.onWrite(onWrite); } catch (e) {}
        setTimeout(checkFiles, 2500);
        setTimeout(checkStorage, 4000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    return { VER, isCur, realYM, checkStorage, checkFiles, _onWrite: onWrite };
})();
window.AppChecks = AppChecks;
;(window.__RPV=window.__RPV||{})['app-checks.js']='1.0.4';

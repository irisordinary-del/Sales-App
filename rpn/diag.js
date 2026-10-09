/* =============================================================================
 *  diag.js — ตัวจดร่องรอย (breadcrumb) หาจุดที่หน้าค้าง
 * =============================================================================
 *  จดว่า "กำลังทำขั้นไหน" ลง localStorage ก่อน/หลังงานหนักทุกงาน + ชีพจรทุก 2 วิ
 *  ปิดแท็บปกติจะประทับ clean-exit ไว้ · ถ้าเปิดมาแล้วไม่มีประทับ = รอบก่อนจบผิดปกติ (ค้าง/ถูกฆ่า)
 *  → เด้งแถบบอกขั้นสุดท้ายที่ทำอยู่ พร้อมปุ่มก๊อปบันทึก 40 ขั้นล่าสุดส่งให้คนแก้
 *  ไฟล์นี้ต้องโหลดก่อนไฟล์อื่น ๆ ของแอป และห้ามพึ่งอะไรนอกจาก window/localStorage
 * ========================================================================== */
(function () {
    'use strict';
    const K_LOG = 'rp_diag_log', K_EXIT = 'rp_diag_exit', K_ALIVE = 'rp_diag_alive', K_VER = 'rp_diag_ver';
    const MAX = 40;
    let ring = [];
    const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
    const now = () => { const d = new Date(); return d.toLocaleTimeString('th-TH', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
    let dirty = false, flushT = null;
    const flush = () => { dirty = false; ls(K_LOG, JSON.stringify(ring)); };
    const step = (s) => {
        ring.push(now() + ' ' + s);
        if (ring.length > MAX) ring.shift();
        // เขียนทันทีเมื่อเป็นจุด "เริ่ม" (ถ้าค้างระหว่างทำ จะได้เห็นว่าค้างที่ไหน) — จุด "จบ" รวมเขียนทีหลัง
        if (/:start|^import|^open /.test(s)) flush();
        else if (!dirty) { dirty = true; clearTimeout(flushT); flushT = setTimeout(flush, 400); }
    };

    // ── ตรวจรอบก่อน ──
    const prevLog = (() => { try { return JSON.parse(ls(K_LOG) || '[]'); } catch (e) { return []; } })();
    const prevExit = ls(K_EXIT);
    const prevVer = ls(K_VER);
    const ver = (document.title.match(/V[\d.]+/) || [''])[0];
    const abnormal = prevLog.length > 0 && prevExit !== '1';
    ls(K_EXIT, '0');
    ls(K_VER, ver);
    ring = [];
    step('boot:start ' + ver + ' ' + (location.protocol) + ' ua=' + (navigator.userAgent.match(/(Edg|Chrome|Firefox)\/[\d.]+/) || [''])[0]);

    window.addEventListener('pagehide', () => { step('exit:clean'); flush(); ls(K_EXIT, '1'); });
    window.addEventListener('beforeunload', () => { step('exit:clean'); flush(); ls(K_EXIT, '1'); });
    setInterval(() => ls(K_ALIVE, String(Date.now())), 2000);
    window.addEventListener('error', (e) => step('error: ' + String(e.message || e).slice(0, 120)));
    window.addEventListener('unhandledrejection', (e) => step('reject: ' + String((e.reason && e.reason.message) || e.reason).slice(0, 120)));

    // ── ครอบฟังก์ชันหนัก ๆ เมื่อมันพร้อม ──
    const wrap = (objName, fn, label) => {
        const o = window[objName];
        if (!o || typeof o[fn] !== 'function' || o[fn]._diag) return false;
        const orig = o[fn];
        const w = function () {
            const t0 = performance.now();
            step(label + ':start');
            const done = () => { const ms = Math.round(performance.now() - t0); step(label + ':end ' + ms + 'ms'); if (ms > 3000) flush(); };
            let r;
            try { r = orig.apply(this, arguments); }
            catch (e) { step(label + ':throw ' + String(e && e.message).slice(0, 100)); flush(); throw e; }
            if (r && typeof r.then === 'function') return r.then(v => { done(); return v; }, e => { step(label + ':reject ' + String(e && e.message).slice(0, 100)); flush(); throw e; });
            done(); return r;
        };
        w._diag = true;
        // เก็บ property อื่น ๆ ของฟังก์ชันเดิม (บางตัวใช้ธง _wrapped ต่าง ๆ)
        Object.keys(orig).forEach(k => { try { w[k] = orig[k]; } catch (e) {} });
        o[fn] = w;
        return true;
    };
    const TARGETS = [
        ['App', '_loadPlan', 'loadPlan'], ['App', '_loadAllRoutes', 'loadRoutes'], ['App', 'createPlan', 'createPlan'],
        ['App', 'switchPlan', 'switchPlan'], ['App', 'saveRouteCalendarOverride', 'saveRouteCal'],
        ['UI', 'render', 'render'], ['MapCtrl', 'renderMarkers', 'markers'],
        ['PlanOverview', 'render', 'overview'], ['Coverage', 'paint', 'coverage'],
        ['CalendarAdmin', 'open', 'calOpen'], ['CalendarAdmin', '_renderPreview', 'calPreview'], ['CalendarAdmin', '_loadConfig', 'calLoad'],
        ['SysImport', 'run', 'import'], ['DmsExport', 'open', 'exportOpen'], ['DmsExport', 'run', 'export'],
        ['Month', 'openSync', 'syncOpen'], ['Month', 'applySync', 'syncApply'], ['Month', 'stripCY', 'stripCY'],
        ['SplitSel', 'run', 'split'], ['Unassign', 'run', 'unassign'], ['AI', 'run', 'ai'],
        ['DayDate', 'reloadOverrides', 'reloadOverrides'], ['CalUI', 'clearAllOverrides', 'clearOverrides'],
    ];
    let tries = 0;
    const arm = () => {
        let left = 0;
        TARGETS.forEach(([o, f, l]) => { if (!wrap(o, f, l)) left++; });
        if (left && tries++ < 40) setTimeout(arm, 500);
    };
    document.addEventListener('DOMContentLoaded', () => { step('dom:ready'); arm(); });
    window.addEventListener('load', () => step('window:load'));

    // ── แถบแจ้งรอบก่อนค้าง ──
    const banner = () => {
        if (!abnormal) return;
        // หา "ขั้นที่เริ่มแล้วไม่จบ" ตัวล่าสุด — นั่นคือจุดที่ค้าง ถ้าไม่มีให้ใช้บรรทัดสุดท้าย
        let last = prevLog[prevLog.length - 1] || '';
        const open = [];
        prevLog.forEach(line => {
            const m = /^\S+ (\S+?):(start|end|throw|reject)/.exec(line);
            if (!m) return;
            if (m[1] === 'boot') return;
            if (m[2] === 'start') open.push({ name: m[1], line });
            else { const i = open.map(o => o.name).lastIndexOf(m[1]); if (i >= 0) open.splice(i, 1); }
        });
        if (open.length) last = open[open.length - 1].line + '  (เริ่มแล้วไม่จบ)';
        const el = document.createElement('div');
        el.id = 'diag-banner';
        el.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;max-width:92vw;background:#1f2937;color:#fff;border-radius:14px;padding:10px 14px;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;font-family:inherit;';
        el.innerHTML = '<span>🩺 <b>รอบก่อนปิดแบบผิดปกติ</b> (ค้าง/ถูกปิดกลางคัน) — ขั้นสุดท้าย: <code style="background:#374151;padding:1px 6px;border-radius:6px">'
            + String(last).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</code>'
            + (prevVer && prevVer !== ver ? ' · เวอร์ชัน ' + prevVer : '') + '</span>'
            + '<button id="diag-copy" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-weight:700;cursor:pointer">ก๊อปบันทึก</button>'
            + '<button id="diag-x" style="background:transparent;color:#9ca3af;border:none;font-size:16px;cursor:pointer">✕</button>';
        document.body.appendChild(el);
        const text = ['Route Planner diag', 'version: ' + prevVer, 'ua: ' + navigator.userAgent, 'url: ' + location.href, '--- last steps ---', ...prevLog].join('\n');
        el.querySelector('#diag-copy').onclick = () => {
            const ok = () => { el.querySelector('#diag-copy').textContent = 'ก๊อปแล้ว ✓'; };
            try { navigator.clipboard.writeText(text).then(ok, () => { window.prompt('ก๊อปข้อความนี้ส่งให้คนแก้', text); ok(); }); }
            catch (e) { window.prompt('ก๊อปข้อความนี้ส่งให้คนแก้', text); ok(); }
        };
        el.querySelector('#diag-x').onclick = () => el.remove();
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(banner, 1500));

    window.Diag = { step, log: () => ring.slice(), prev: () => prevLog.slice(), abnormal, flush };
})();

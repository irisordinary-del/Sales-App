/* =============================================================================
 *  pane-resize.js — เส้นแบ่งลากปรับความกว้าง แผนที่ ↔ แผงขวา (V1.0.4)
 * =============================================================================
 *  ลากเส้นแบ่งซ้าย–ขวา: แผงขวาแคบสุดเท่าเดิม (320 px) กว้างสุด 60% ของพื้นที่
 *  ดับเบิลคลิกที่เส้น = กลับขนาดเดิม · จำความกว้างไว้ในเครื่อง (เปิดครั้งหน้าใช้ขนาดเดิม)
 *  จอแคบ (มือถือ แผนที่อยู่บน รายการอยู่ล่าง) ไม่มีเส้นแบ่ง
 * ========================================================================== */
const PaneResize = (() => {
    'use strict';
    const KEY = 'rpl:sideW';
    const MIN = 320, MAXR = 0.6, BP = 768;
    let side = null, bar = null, w = 0, raf = 0;

    const read = () => { try { return parseInt(localStorage.getItem(KEY), 10) || 0; } catch (e) { return 0; } };
    const write = (v) => { try { if (v) localStorage.setItem(KEY, String(v)); else localStorage.removeItem(KEY); } catch (e) {} };
    const maxW = () => Math.max(MIN, Math.round(((side && side.parentElement && side.parentElement.clientWidth) || window.innerWidth) * MAXR));
    const clamp = (v) => Math.min(maxW(), Math.max(MIN, Math.round(v)));
    const wide = () => window.innerWidth >= BP;
    const fitMap = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { try { if (typeof MapCtrl !== 'undefined' && MapCtrl.map) MapCtrl.map.invalidateSize({ pan: false }); } catch (e) {} });
    };
    const apply = () => {
        if (!side) return;
        if (bar) bar.style.display = wide() ? 'block' : 'none';
        if (wide() && w) { side.style.width = clamp(w) + 'px'; side.style.flex = 'none'; }
        else { side.style.width = ''; side.style.flex = ''; }
        fitMap();
    };

    const boot = () => {
        side = document.getElementById('plan-side');
        if (!side || bar) return;
        bar = document.createElement('div');
        bar.id = 'pane-handle';
        bar.title = 'ลากเพื่อปรับความกว้างแผนที่ / รายการด้านขวา · ดับเบิลคลิก = ขนาดเดิม';
        bar.style.cssText = 'flex:none;width:7px;cursor:col-resize;position:relative;z-index:20;background:#e5e7eb;touch-action:none;';
        bar.innerHTML = '<div style="position:absolute;top:50%;left:1px;width:5px;height:40px;margin-top:-20px;border-radius:3px;'
            + 'background:repeating-linear-gradient(#9ca3af 0 2px,transparent 2px 5px)"></div>';
        bar.onmouseenter = () => { bar.style.background = '#c7d2fe'; };
        bar.onmouseleave = () => { if (!bar._drag) bar.style.background = '#e5e7eb'; };
        side.parentElement.insertBefore(bar, side);

        bar.addEventListener('pointerdown', (e) => {
            if (!wide()) return;
            e.preventDefault();
            bar._drag = true;
            bar.setPointerCapture(e.pointerId);
            bar.style.background = '#a5b4fc';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        bar.addEventListener('pointermove', (e) => {
            if (!bar._drag) return;
            const right = side.getBoundingClientRect().right;
            w = clamp(right - e.clientX);
            side.style.width = w + 'px'; side.style.flex = 'none';
            fitMap();
        });
        const end = (e) => {
            if (!bar._drag) return;
            bar._drag = false;
            try { bar.releasePointerCapture(e.pointerId); } catch (x) {}
            bar.style.background = '#e5e7eb';
            document.body.style.cursor = ''; document.body.style.userSelect = '';
            write(w);
            fitMap();
        };
        bar.addEventListener('pointerup', end);
        bar.addEventListener('pointercancel', end);
        bar.addEventListener('dblclick', () => { w = 0; write(0); apply(); });

        w = read();
        apply();
        window.addEventListener('resize', apply);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    return { reset() { w = 0; write(0); apply(); }, get width() { return w; } };
})();
window.PaneResize = PaneResize;
;(window.__RPV=window.__RPV||{})['pane-resize.js']='1.0.4';

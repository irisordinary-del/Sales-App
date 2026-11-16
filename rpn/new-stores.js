/* =============================================================================
 *  new-stores.js — กลุ่ม "🆕 ร้านใหม่" บนหน้าวางแผน (V1.0.3)
 * =============================================================================
 *  นิยามเดียวกับหน้าภาพรวมแผน / รายงาน Executive:
 *    ร้านใหม่ = ร้านที่อยู่ในแผนเดือนนี้ (มีสาย + วันแล้ว) แต่ไม่อยู่ในแผนเดือนฐาน
 *               (เดือนฐาน = เดือนล่าสุดที่นำเข้าจากไฟล์ DMS ก่อนเดือนที่เปิด)
 *    ถ้าเดือนที่เปิดเป็นเดือนที่นำเข้าเอง (ไม่มีเดือนฐาน) → ร้านที่ไม่ได้มาจากไฟล์แผน (ไม่มี Cycle เดิม)
 *  ใช้ใน: ชิป "🆕 ร้านใหม่" แท็บ 1 · แถวในช่องเลือกสาย · วงเขียวรอบหมุด/จุด · ป้ายในรายชื่อร้าน
 *  ป้ายหายเองเมื่อเดือนฐานเปลี่ยน (นำเข้าไฟล์ DMS เดือนใหม่) หรือกด "รับทราบ" (ซ่อนวงเขียว)
 *
 *  V1.0.4 (12 พ.ย. 2569): 🔄 Re-Active = ร้านใหม่ (หรือร้านในกองรอจัดสาย) ที่ Open Account Date
 *    เก่ากว่า 60 วันนับจากวันที่ 1 ของเดือนแผน — ร้านเก่าที่เคย Inactive แล้วเปิด Active กลับมา
 *    ไม่มีวันเปิดบัญชี = นับเป็นร้านใหม่ · เกณฑ์เดียวกันทั้งหน้าภาพรวม / รายงาน Executive / ป้ายในรายชื่อร้าน
 * ========================================================================== */
const NewStores = (() => {
    'use strict';
    const UN = 'รอจัดสาย';
    const ckey = (s) => String((s && (s.code || s.id)) || '');
    let B = { key: '', ym: '', ids: null, mode: 'none', loading: false };
    let ringOn = true;
    try { ringOn = localStorage.getItem('rpl:newRing') !== '0'; } catch (e) {}

    const load = async () => {
        if (typeof App === 'undefined' || !App._currentPlanYM) return;
        const cur = App._currentPlanYM;
        const key = (window.CENTER_DOC || '') + '|' + cur;
        if (B.key === key) return;
        B = { key, ym: '', ids: null, mode: 'none', loading: true };
        let ym = '';
        try { const c = (await App.dbRef.get()).data() || {}; if (c.lastImportYM && c.lastImportYM < cur) ym = c.lastImportYM; } catch (e) {}
        if (!ym) {
            const list = (State.db.planList || []).filter(p => p < cur).sort().reverse();
            for (const p of list) {
                try { const d = (await App.planRef(p).get()).data() || {}; if (d.importedAt || (d.calendarConfig && d.calendarConfig.source === 'import')) { ym = p; break; } } catch (e) {}
            }
        }
        let ids = null, mode = 'none';
        if (ym) {
            ids = new Set();
            try {
                const rs = await App.planRoutesCol(ym).get();
                (rs.docs || []).forEach(doc => {
                    if (doc.id === UN) return;
                    ((doc.data() || {}).stores || []).forEach(s => { if (!s.inactive && (s.days || []).length) ids.add(ckey(s)); });
                });
                mode = 'base';
            } catch (e) { ids = null; }
        } else {
            // เดือนที่เปิดคือเดือนที่นำเข้าจากไฟล์เอง → ร้านที่ไม่ได้มาจากไฟล์แผน = ร้านใหม่
            try { const d = (await App.planRef(cur).get()).data() || {}; if (d.importedAt) mode = 'file'; } catch (e) {}
        }
        if (B.key !== key) return;
        B = { key, ym, ids, mode, loading: false };
        try { UI.render(); } catch (e) {}
    };

    const isNew = (s) => {
        if (!s || s.inactive || !(s.days || []).length) return false;
        if (s.route === UN) return false;
        if (B.mode === 'base' && B.ids) return !B.ids.has(ckey(s));
        if (B.mode === 'file') return !s.dayOriginal;          // ร้านจากไฟล์แผนมี Cycle Name เดิมเสมอ
        return false;
    };
    const countIn = (list) => (list || []).filter(isNew).length;

    // V1.0.4: Re-Active — เปิดบัญชีก่อนวันตัด (60 วันก่อนวันที่ 1 ของเดือนแผน)
    const REACT_DAYS = 60;
    const cutDate = (ym) => {
        const [y, m] = String(ym || (typeof App !== 'undefined' && App._currentPlanYM) || '').split('_').map(Number);
        if (!y || !m) return null;
        return new Date(y, m - 1, 1 - REACT_DAYS);
    };
    const isoOf = (d) => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    const cutISO = (ym) => isoOf(cutDate(ym));
    /** วันเปิดบัญชีเก่ากว่าวันตัด (ไม่ดูว่าอยู่แผนหรือไม่) */
    const oldOpen = (s, ym) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((s && s.openDate) || ''));
        const c = cutISO(ym);
        return !!(m && c && m[0] < c);
    };
    /** ร้านใหม่ในแผน หรือร้านในกองรอจัดสาย ที่เปิดบัญชีเก่ากว่า 60 วัน */
    const isReAct = (s) => {
        if (!s || s.inactive) return false;
        const parked = s.route === UN || !(s.days || []).length;
        return (parked || isNew(s)) && oldOpen(s);
    };
    const badge = (s, sm) => isReAct(s)
        ? `<span title="Re-Active: ร้านเก่า (เปิดบัญชีเกิน ${REACT_DAYS} วัน) ที่กลับมา Active นอก Route Plan" class="inline-block ${sm ? 'text-[8.5px] px-1' : 'text-[9.5px] px-1.5'} py-px rounded bg-orange-100 text-orange-800 border border-orange-300 font-bold align-middle whitespace-nowrap">🔄 Re-Active</span>`
        : '';

    const setRing = (on) => {
        ringOn = !!on;
        try { localStorage.setItem('rpl:newRing', ringOn ? '1' : '0'); } catch (e) {}
        try { if (typeof MultiRoute !== 'undefined' && MultiRoute.refresh) MultiRoute.refresh(); else UI.render(); } catch (e) {}
    };

    const tick = () => { try { load(); } catch (e) {} };
    const boot = () => {
        if (typeof App === 'undefined' || typeof State === 'undefined') return setTimeout(boot, 500);
        setInterval(tick, 1500);
        tick();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

    return {
        isNew, countIn, setRing, isReAct, oldOpen, cutISO, badge, REACT_DAYS,
        get ringOn() { return ringOn; },
        get baseYM() { return B.ym; },
        get mode() { return B.mode; },
        reload() { B.key = ''; return load(); },
    };
})();
window.NewStores = NewStores;
;(window.__RPV=window.__RPV||{})['new-stores.js']='1.0.4';

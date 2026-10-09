/* =============================================================================
 *  multi-day.js — กันร้านที่อยู่หลายตลาดหายตลาดโดยไม่รู้ตัว (V0.7.6)
 * =============================================================================
 *  ร้านบางร้านอยู่ 3 ตลาดขึ้นไปในสายเดียวกัน (เช่น 204 ร้านเข้ารายสัปดาห์ D1·D7·D11·D17·D22)
 *  ปุ่มเดิม "จัดลงวัน" / เปลี่ยนวันใน popup หมุด เขียนทับวันทั้งหมดเหลือ 1 ตลาด (หรือ 2 ถ้าเป็น F2)
 *  → ถามยืนยันก่อนทุกครั้ง บอกว่าร้านไหนจะเหลือกี่ตลาด
 * ========================================================================== */
(function () {
    'use strict';

    const MANY = 3;
    const nDay = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const dl = (days) => (days || []).slice().sort((a, b) => nDay(a) - nDay(b)).map(d => 'D' + nDay(d)).join('·');
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const many = (s) => s && !s.inactive && (s.days || []).length >= MANY;

    const wrap = () => {
        if (typeof StoreMgr === 'undefined' || !StoreMgr.assignSelected || typeof UI === 'undefined') return setTimeout(wrap, 500);
        if (StoreMgr._mdWrapped) return;
        StoreMgr._mdWrapped = true;

        const origAssign = StoreMgr.assignSelected;
        StoreMgr.assignSelected = function () {
            const args = arguments, self = this;
            const hit = (State.stores || []).filter(s => s.selected && many(s));
            if (!hit.length) return origAssign.apply(self, args);
            const ds = document.getElementById('assign-day');
            const to = ds ? ds.value : '';
            const lines = hit.slice(0, 6).map(s => `• ${esc(s.name)} — ${dl(s.days)} (${s.days.length} ตลาด)`).join('\n');
            UI.showConfirm(
                `มี ${hit.length} ร้านที่อยู่หลายตลาด:\n${lines}${hit.length > 6 ? '\n…' : ''}\n\n` +
                `กด "จัดลงวัน" แล้วร้านพวกนี้จะเหลือแค่ ${to ? 'D' + nDay(to) : 'วันที่เลือก'} (ตลาดอื่นหายหมด)\n` +
                `ถ้าไม่ได้ตั้งใจ กดยกเลิก แล้วเอาร้านพวกนี้ออกจากชุดที่เลือกก่อน · ย้อนกลับได้ด้วย Ctrl+Z`,
                () => origAssign.apply(self, args));
        };

        const origChange = StoreMgr.changeDay;
        StoreMgr.changeDay = function (id, d) {
            const args = arguments, self = this;
            const s = (State.stores || []).find(x => String(x.id) === String(id));
            if (!many(s)) return origChange.apply(self, args);
            UI.showConfirm(
                `"${esc(s.name)}" อยู่ ${s.days.length} ตลาด (${dl(s.days)})\n\n` +
                (d === 'remove' ? 'ถอดวันแล้วจะหายทุกตลาด' : `เปลี่ยนเป็น D${nDay(d)} แล้วจะเหลือตลาดเดียว — ตลาดอื่นหายหมด`) +
                `\nถ้าจะเอาออกเฉพาะบางตลาด ให้เปิดการ์ดวันนั้นในแท็บ 3 แล้วกด ➖ ท้ายแถวแทน · ย้อนกลับได้ด้วย Ctrl+Z`,
                () => origChange.apply(self, args));
            try { UI.render(); } catch (e) {}       // คืนค่าช่องเลือกเดิมระหว่างรอยืนยัน
        };
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(wrap, 2500));
})();

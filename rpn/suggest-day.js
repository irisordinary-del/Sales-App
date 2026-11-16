/* =============================================================================
 *  suggest-day.js — 💡 แนะนำวันให้ร้าน "รอจัดวัน" (V1.0.3)
 * =============================================================================
 *  ร้านที่อยู่ในสายแล้วแต่ยังไม่มีวัน (เช่น เพิ่งย้ายเข้าสายตาม Salesman Code)
 *  → ลองแทรกร้านเข้าเส้นทางของแต่ละตลาดในสาย ตลาดที่ "ระยะวิ่งเพิ่มน้อยสุด" = คำแนะนำ (ได้ตำแหน่งคิวด้วย)
 *    · ระยะ = ตารางระยะถนน (ถ้ามี) ไม่งั้นเส้นตรง — ตัวเดียวกับตัวจัดคิว (seq-tools)
 *    · เฉพาะตลาดที่มีวันวิ่งเดือนนี้ (กฎเดียวกับช่อง Day/Visit) · ไม่นับช่องที่แยกครั้งไว้
 *    · รอบ 24 แบบคู่ครึ่งรอบ (D1 = D13 เป็น CY เดียว) → ใส่ทั้งคู่ ลำดับเดียวกัน (ยังเป็น CY เดียว)
 *    · ความถี่ตามตลาด (รอบ 12 = วิ่งทุกครั้งของตลาด)
 *    · ร้านไกลจากทุกร้านในสายเกิน 3 กม. = ⚠️ ไม่มีตลาดใกล้ (ไม่ติ๊กให้ในหน้ารวม)
 *    · ตลาดที่ร้านเยอะกว่าค่าเฉลี่ยของสาย 20% ขึ้นไป = ⚠️ ร้านเยอะ (ยังแนะนำ แต่บอกทางเลือก)
 *  หน้าจอ: กล่อง 💡 + ป้ายใต้ร้านในรายการ "รอจัดวัน" (กด = จัดทันที) · ปุ่ม "จัดตามคำแนะนำทั้งหมด" = ตารางทั้งศูนย์
 *  ไม่จัดอะไรเองจนกว่าจะกด · ย้อนได้ด้วย Ctrl+Z
 * ========================================================================== */
const SuggestDay = (() => {
    'use strict';
    const UN = 'รอจัดสาย';
    const FAR_M = 3000, CROWD = 1.2;
    const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dn = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const R = () => (State.db && State.db.routes) || {};
    const KY = 111132.0;
    const straight = (a, b) => { const kx = KY * Math.cos((a.lat + b.lat) * 0.5 * Math.PI / 180); const dy = (a.lat - b.lat) * KY, dx = (a.lng - b.lng) * kx; return Math.sqrt(dy * dy + dx * dx); };
    const dist = (a, b) => (typeof RoadDist !== 'undefined' && RoadDist.ready) ? RoadDist.m(a, b) : straight(a, b);
    const okPt = (s) => s && isFinite(+s.lat) && isFinite(+s.lng) && !(+s.lat === 0 && +s.lng === 0);

    const slotList = (rt, d, except) => (R()[rt] || [])
        .filter(x => x !== except && !x.inactive && (x.days || []).includes(d))
        .sort((a, b) => ((a.seqs && a.seqs[d]) || 9999) - ((b.seqs && b.seqs[d]) || 9999));
    /** ตำแหน่งแทรกที่อ้อมน้อยสุด (เหมือน SeqTool.insert) → {i, cost(m)} */
    const bestInsert = (s, arr) => {
        if (!arr.length) return { i: 0, cost: 0 };
        let best = arr.length, bc = Infinity;
        for (let i = 0; i <= arr.length; i++) {
            const p = i > 0 ? arr[i - 1] : null, n = i < arr.length ? arr[i] : null;
            const c = !p ? dist(s, n) : !n ? dist(p, s) : dist(p, s) + dist(s, n) - dist(p, n);
            if (c < bc) { bc = c; best = i; }
        }
        return { i: best, cost: bc };
    };
    /** ช่องที่รับร้านได้ — {slot, pair} (pair = ช่องคู่ที่เป็น CY เดียวกัน) */
    const targets = (rt) => {
        let cyc = 24, short = false;
        try { cyc = Runs.cycleOf(rt); short = Runs.isShort(rt); } catch (e) {}
        const out = [];
        let days = [];
        try { days = Runs.daysOf(rt); } catch (e) {}
        days.forEach(d => {
            try {
                if (Runs.isDetached(rt, d) || dn(d) > cyc || !Runs.potential(rt, d).length) return;
                let pair = null;
                if (!short) {
                    const m = (Runs.pairOfDay(rt, d).merged || []).filter(x => !Runs.isDetached(rt, x));
                    if (m.some(x => dn(x) < dn(d))) return;                // ช่องหลังของคู่ — นับรวมกับช่องแรก
                    pair = m.find(x => dn(x) > dn(d)) || null;
                }
                if (!slotList(rt, d).length) return;
                out.push({ slot: d, pair });
            } catch (e) {}
        });
        return out;
    };
    const dateTxt = (rt, t) => {
        let ds = [];
        try { ds = Runs.datesOf(rt, t.slot).concat(t.pair ? Runs.datesOf(rt, t.pair) : []); } catch (e) {}
        ds = ds.filter(Boolean).sort((a, b) => a - b);
        if (!ds.length) return '';
        return WD[ds[0].getDay()] + ' ' + ds.map(x => x.getDate()).join(' + ') + ' ' + TH[ds[ds.length - 1].getMonth()];
    };
    const marketOf = (rt, d) => {
        const c = {};
        slotList(rt, d).forEach(x => { if (x.marketName) c[x.marketName] = (c[x.marketName] || 0) + 1; });
        const t = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
        return t ? t[0] : '';
    };

    let memoVer = -1;
    const memo = new Map();
    /** คำแนะนำของร้าน — {list:[{slot,pair,cost,km,pos,n,crowd,date,market}], far, nearKm} */
    const suggest = (rt, s) => {
        let ver = 0;
        try { ver = Runs.version(); } catch (e) {}
        if (ver !== memoVer) { memo.clear(); memoVer = ver; }
        const key = rt + '|' + s.id + '|' + (typeof RoadDist !== 'undefined' && RoadDist.ready ? 1 : 0);
        if (memo.has(key)) return memo.get(key);
        let res = { list: [], far: false, nearKm: null };
        if (okPt(s)) {
            const T = targets(rt);
            const sizes = T.map(t => slotList(rt, t.slot, s).length);
            const avg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
            let near = Infinity;
            (R()[rt] || []).forEach(x => { if (x !== s && !x.inactive && (x.days || []).length && okPt(x)) near = Math.min(near, straight(s, x)); });
            const list = T.map((t, k) => {
                const arr = slotList(rt, t.slot, s).filter(okPt);
                const b = bestInsert(s, arr);
                return { slot: t.slot, pair: t.pair, cost: b.cost, km: b.cost / 1000, pos: b.i + 1, n: sizes[k],
                         crowd: avg > 0 && sizes[k] > avg * CROWD, date: dateTxt(rt, t), market: marketOf(rt, t.slot) };
            }).sort((a, b) => a.cost - b.cost);
            res = { list, far: near > FAR_M, nearKm: isFinite(near) ? near / 1000 : null };
        }
        memo.set(key, res);
        return res;
    };

    // ── จัดลงวัน ─────────────────────────────────────────────────────────
    const findStore = (id) => {
        const all = R();
        for (const rt of Object.keys(all)) {
            if (rt === UN) continue;
            const s = (all[rt] || []).find(x => String(x.id) === String(id));
            if (s) return { rt, s };
        }
        return null;
    };
    /** ใส่ร้านลงช่อง (ในหน่วยความจำ) — คืน true ถ้าสำเร็จ */
    const put = (rt, s, slot) => {
        const t = targets(rt).find(x => x.slot === slot);
        if (!t) return false;
        const want = [slot].concat(t.pair ? [t.pair] : []);
        const arr0 = slotList(rt, slot, s).filter(okPt);
        const ins = bestInsert(s, arr0);
        s.days = want.slice();
        s.seqs = {}; s.cys = {}; s.cy = ''; s.selected = false;
        s.freq = want.length > 1 ? 2 : 1;
        delete s.runOf; delete s.f2custom;
        const fq = {};
        want.forEach(d => {
            const list = slotList(rt, d, s);
            const ref = list.find(x => x.cys && x.cys[d]);
            if (ref) s.cys[d] = ref.cys[d];
            const f = list.find(x => x.fqs && x.fqs[d]);
            if (f) fq[d] = f.fqs[d];
            // แทรกตำแหน่งเดียวกันทุกช่องของคู่ (ร้าน+ลำดับยังเหมือนกัน = CY เดียว)
            const ord = list.slice();
            ord.splice(Math.min(ins.i, ord.length), 0, s);
            ord.forEach((x, i) => { if (!x.seqs) x.seqs = {}; x.seqs[d] = i + 1; });
        });
        if (Object.keys(fq).length) s.fqs = fq; else delete s.fqs;
        const mk = marketOf(rt, slot);
        if (mk && !s.marketName) s.marketName = mk;
        s.route = rt;
        return true;
    };
    const saveRoutes = async (routes, label) => {
        const ym = App._currentPlanYM;
        try { Runs.bump(); } catch (e) {}
        await Promise.all([...routes].map(r => App.planRoutesCol(ym).doc(r).set({
            stores: R()[r], confirmedBy: firebase.firestore.FieldValue.delete(), confirmedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true })));
        try { if (window.EditHistory && EditHistory.mark) EditHistory.mark(label); } catch (e) {}
        try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
        try { UI.render(); } catch (e) {}
    };
    const apply = async (id, slot) => {
        const f = findStore(id);
        if (!f) return UI.showErrorToast('⚠️ ไม่พบร้านในสาย');
        try { if (window.EditHistory && EditHistory.mark) EditHistory.mark('จัดลงวันตามคำแนะนำ'); } catch (e) {}
        if (!put(f.rt, f.s, slot)) return UI.showErrorToast('⚠️ ตลาดนี้รับร้านไม่ได้แล้ว — ลองกดใหม่');
        try { await saveRoutes([f.rt], 'จัดลงวันตามคำแนะนำ'); } catch (e) { return UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message)); }
        UI.showSaveToast(`📅 "${f.s.name}" → ${f.rt} ${tag(f.rt, slot)} คิวที่ ${(f.s.seqs || {})[slot] || '-'} · ย้อนได้ (Ctrl+Z)`);
    };
    const tag = (rt, slot) => { const t = targets(rt).find(x => x.slot === slot); return 'D' + dn(slot) + (t && t.pair ? '+D' + dn(t.pair) : ''); };

    // ── ร้านรอจัดวัน (ในสาย) ─────────────────────────────────────────────
    const waitIn = (routes) => {
        const out = [];
        (routes || Object.keys(R())).forEach(rt => {
            if (rt === UN) return;
            (R()[rt] || []).forEach(s => { if (s && !s.inactive && !(s.days || []).length) out.push({ rt, s }); });
        });
        return out;
    };
    const openRoutes = () => {
        const o = (typeof MultiRoute !== 'undefined' && (MultiRoute.open || []).length) ? MultiRoute.open : [State.localActiveRoute];
        return o.filter(r => r && r !== UN);
    };

    // ── ป้ายใต้ร้าน + กล่อง 💡 ในรายการ "รอจัดวัน" ─────────────────────────
    const chipHTML = (id, o, best) => `<button type="button" onclick="event.preventDefault();event.stopPropagation();SuggestDay.apply('${esc(id)}','${esc(o.slot)}')"
        title="${esc((o.market ? 'ตลาด ' + o.market + ' · ' : '') + 'ระยะวิ่งเพิ่ม ' + o.km.toFixed(1) + ' กม. · แทรกเป็นคิวที่ ' + o.pos + ' · ตลาดมี ' + o.n + ' ร้าน' + (o.crowd ? ' (เยอะกว่าค่าเฉลี่ยของสาย)' : ''))}"
        style="border-radius:8px;padding:3px 7px;font-size:10.5px;line-height:1.25;text-align:left;border:1px solid ${best ? '#4f46e5' : '#c7d2fe'};background:${best ? '#4f46e5' : '#eef2ff'};color:${best ? '#fff' : '#3730a3'};cursor:pointer">
        <b>${esc('D' + dn(o.slot) + (o.pair ? '+D' + dn(o.pair) : ''))}</b> ${esc(o.date)}
        <span style="display:block;font-size:9.5px;opacity:.85">+${o.km.toFixed(1)} กม. · คิวที่ ${o.pos} · ${o.n} ร้าน${o.crowd ? ' ⚠️ เยอะ' : ''}</span></button>`;
    const paint = () => {
        const box = document.getElementById('list-unassigned');
        const pane = document.getElementById('pane-wait');
        if (!box || !pane) return;
        const idx = new Map();
        waitIn().forEach(x => idx.set(String(x.s.id), x));
        let shown = 0;
        [...box.querySelectorAll('label, div[id^="card-"]')].forEach(c => {
            const m = c.textContent.match(/ID:\s*([A-Za-z0-9_.\-]+)/);
            const old = c.querySelector(':scope .sgd');
            const w = m && idx.get(m[1]);
            if (!w) { if (old) old.remove(); return; }
            const r = suggest(w.rt, w.s);
            const sig = (r.list.slice(0, 2).map(o => o.slot + o.pos + o.n).join(',')) + '|' + r.far;
            if (old && old.dataset.sig === sig) { shown++; return; }
            if (old) old.remove();
            const host = c.querySelector('.flex-1') || c;
            const top = r.list.slice(0, 2);
            let alt = null;
            if (top[0] && top[0].crowd) alt = r.list.find(o => !o.crowd && o.slot !== top[0].slot && (!top[1] || o.slot !== top[1].slot));
            const html = `<div class="sgd" data-sig="${esc(sig)}" style="margin-top:6px">
                ${r.far ? `<div style="font-size:10.5px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:4px 7px;margin-bottom:4px">⚠️ ไม่มีตลาดใกล้ — ร้านที่ใกล้สุดในสายห่าง ${r.nearKm != null ? r.nearKm.toFixed(1) : '?'} กม. · ตรวจ Salesman Code ใน Master แล้วจัดเอง</div>` : ''}
                <div style="display:flex;gap:4px;flex-wrap:wrap">${top.map((o, i) => chipHTML(m[1], o, i === 0 && !r.far)).join('')}${alt ? chipHTML(m[1], alt, false) : ''}</div>
                ${!top.length ? '<div style="font-size:10.5px;color:#9ca3af">ยังไม่มีตลาดที่วิ่งเดือนนี้ให้แนะนำ</div>' : ''}</div>`;
            host.insertAdjacentHTML('beforeend', html);
            shown++;
        });
        // กล่อง 💡 เหนือรายการ
        let el = document.getElementById('sgd-box');
        const mine = waitIn(openRoutes());
        const all = waitIn();
        if (!all.length) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'sgd-box';
            el.style.cssText = 'background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:9px 10px;margin:6px 0 8px';
            pane.insertBefore(el, box);
        } else if (el.nextElementSibling !== box) pane.insertBefore(el, box);
        const byRt = {};
        all.forEach(x => { byRt[x.rt] = (byRt[x.rt] || 0) + 1; });
        const html = `<div style="font-size:12px;font-weight:800;color:#3730a3">💡 แนะนำวันให้ร้านรอจัดวัน ${mine.length.toLocaleString()} ร้าน${openRoutes().length === 1 ? ' (' + esc(openRoutes()[0]) + ')' : ''}</div>
            <div style="font-size:10.5px;color:#4338ca;margin:2px 0 6px">จากระยะวิ่งที่เพิ่มน้อยที่สุดเมื่อแทรกร้านเข้าตลาด · กดป้ายใต้ร้าน = จัดทันที · ยังไม่มีอะไรถูกจัดจนกว่าจะกด${all.length > mine.length ? ` · ทั้งศูนย์ ${all.length} ร้าน (${Object.entries(byRt).map(([k, v]) => k + ' ' + v).join(' · ')})` : ''}</div>
            <button type="button" onclick="SuggestDay.openAll()" style="width:100%;background:#4f46e5;color:#fff;border-radius:9px;padding:6px;font-weight:800;font-size:12px">✅ จัดตามคำแนะนำทั้งหมด (${all.length.toLocaleString()} ร้าน · ตรวจก่อนยืนยัน)…</button>`;
        if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
        void shown;
    };

    // ── หน้าต่างรวมทั้งศูนย์ ───────────────────────────────────────────────
    let rows = [];
    const closeAll = () => { const el = document.getElementById('sgd-modal'); if (el) el.remove(); };
    const openAll = () => {
        const pend = (State.db.routeList || []).filter(r => r && r !== UN && !Array.isArray(R()[r]));
        if (pend.length) return UI.showErrorToast(`⏳ รอโหลดสายให้ครบก่อน (เหลือ ${pend.length} สาย)`);
        rows = waitIn().map(({ rt, s }) => {
            const r = suggest(rt, s);
            return { rt, s, r, pick: r.list[0] ? r.list[0].slot : '', on: !!r.list[0] && !r.far };
        }).sort((a, b) => a.rt.localeCompare(b.rt, 'th', { numeric: true }));
        renderAll();
    };
    const renderAll = () => {
        closeAll();
        const sel = rows.filter(x => x.on && x.pick);
        const tot = sel.reduce((a, x) => a + ((x.r.list.find(o => o.slot === x.pick) || {}).km || 0), 0);
        const nRt = new Set(rows.map(x => x.rt)).size;
        const el = document.createElement('div');
        el.id = 'sgd-modal';
        el.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4';
        el.style.zIndex = '9996';
        el.onclick = (e) => { if (e.target === el) closeAll(); };
        el.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden" style="max-width:860px;max-height:88vh">
          <div class="px-4 py-3 border-b flex items-center gap-2" style="background:#eef2ff"><b class="text-sm">💡 จัดร้านรอจัดวันตามคำแนะนำ</b>
            <span class="text-xs text-gray-500">ศูนย์ ${esc(window.CENTER_ID || '')} · ${nRt} สาย · ${rows.length} ร้าน</span>
            <button onclick="SuggestDay.closeAll()" class="ml-auto w-8 h-8 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 font-bold">✕</button></div>
          <div class="overflow-auto px-4 py-2">
            <p class="text-[11px] text-gray-500 mb-1">ติ๊กออกร้านที่ไม่ต้องการ หรือเปลี่ยนตลาดในช่อง "จัดลง" ก่อนยืนยัน · ระยะ${(typeof RoadDist !== 'undefined' && RoadDist.ready) ? 'ใช้ตารางระยะถนน (ร้านที่ไม่อยู่ในตาราง = ประมาณจากเส้นตรง)' : 'เป็นเส้นตรง (ยังไม่ได้โหลดตารางระยะถนน)'}</p>
            <table class="w-full text-xs">
              <tr class="text-gray-500 text-left border-b"><th class="py-1"></th><th class="pr-2">สาย</th><th class="pr-2">ร้าน</th><th class="pr-2">จัดลง</th><th class="pr-2">วันที่</th><th class="pr-2 text-right">ระยะเพิ่ม</th><th class="pr-2 text-right">คิว</th><th class="pr-2 text-right">ร้านในตลาด</th><th>หมายเหตุ</th></tr>
              ${rows.map((x, i) => {
                  const o = x.r.list.find(v => v.slot === x.pick);
                  const alt = o && o.crowd ? x.r.list.find(v => !v.crowd && v.slot !== o.slot) : null;
                  const note = x.r.far ? `<span style="color:#b91c1c">⚠️ ไม่มีตลาดใกล้ (${x.r.nearKm != null ? x.r.nearKm.toFixed(1) : '?'} กม.)</span>`
                      : !o ? '<span style="color:#9ca3af">ไม่มีตลาดที่วิ่งเดือนนี้</span>'
                      : alt ? `<span style="color:#b45309">ตลาดร้านเยอะ · ทางเลือก D${dn(alt.slot)} (+${alt.km.toFixed(1)} กม. · ${alt.n} ร้าน)</span>` : '';
                  return `<tr class="border-b border-gray-100" style="${x.r.far ? 'background:#fef2f2' : (o && o.crowd ? 'background:#fffbeb' : '')}">
                    <td class="py-1"><input type="checkbox" ${x.on ? 'checked' : ''} ${o ? '' : 'disabled'} onchange="SuggestDay._on(${i},this.checked)"></td>
                    <td class="pr-2 font-mono">${esc(x.rt)}</td><td class="pr-2">${esc(x.s.name || x.s.id)}</td>
                    <td class="pr-2">${o ? `<select onchange="SuggestDay._pick(${i},this.value)" class="border border-gray-300 rounded px-1 py-0.5 text-[11px]">${x.r.list.slice(0, 5).map(v => `<option value="${esc(v.slot)}" ${v.slot === x.pick ? 'selected' : ''}>D${dn(v.slot)}${v.pair ? '+D' + dn(v.pair) : ''} ${esc(v.market || '')} (+${v.km.toFixed(1)})</option>`).join('')}</select>` : '—'}</td>
                    <td class="pr-2 whitespace-nowrap">${o ? esc(o.date) : ''}</td>
                    <td class="pr-2 text-right">${o ? o.km.toFixed(1) + ' กม.' : ''}</td>
                    <td class="pr-2 text-right">${o ? o.pos : ''}</td>
                    <td class="pr-2 text-right whitespace-nowrap">${o ? o.n + ' → ' + (o.n + 1) : ''}</td>
                    <td>${note}</td></tr>`;
              }).join('')}
            </table>
          </div>
          <div class="px-4 py-3 border-t flex items-center gap-2">
            <span class="text-xs text-gray-600">เลือก ${sel.length} ร้าน · ระยะรวมเพิ่ม ${tot.toFixed(1)} กม./รอบ</span>
            <button onclick="SuggestDay.closeAll()" class="ml-auto px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold">ยกเลิก</button>
            <button onclick="SuggestDay.applyAll()" ${sel.length ? '' : 'disabled'} class="px-4 py-2 rounded-xl text-sm font-black ${sel.length ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-400'}">✅ จัดลงวัน ${sel.length} ร้าน</button>
          </div></div>`;
        document.body.appendChild(el);
    };
    const applyAll = async () => {
        const sel = rows.filter(x => x.on && x.pick);
        if (!sel.length) return;
        try { if (window.EditHistory && EditHistory.mark) EditHistory.mark('จัดลงวันตามคำแนะนำ ' + sel.length + ' ร้าน'); } catch (e) {}
        const touched = new Set();
        let n = 0;
        sel.forEach(x => { if (put(x.rt, x.s, x.pick)) { touched.add(x.rt); n++; } });
        closeAll();
        UI.showLoader('📅 กำลังจัดลงวันตามคำแนะนำ...', `${n} ร้าน`);
        try { await saveRoutes(touched, 'จัดลงวันตามคำแนะนำ ' + n + ' ร้าน'); }
        catch (e) { UI.hideLoader(); return UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + (e && e.message)); }
        UI.hideLoader();
        UI.showSaveToast(`📅 จัดลงวันตามคำแนะนำแล้ว ${n} ร้าน ใน ${touched.size} สาย · ร้านเหล่านี้อยู่ชิป "🆕 ร้านใหม่" · ย้อนได้ (Ctrl+Z)`);
    };

    const wire = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof Runs === 'undefined') return setTimeout(wire, 500);
        if (UI._sgdWired) return;
        UI._sgdWired = true;
        const r0 = UI.render;
        UI.render = function () {
            const r = r0.apply(this, arguments);
            setTimeout(() => { try { paint(); } catch (e) { console.warn('[SuggestDay]', e); } }, 40);
            return r;
        };
        setTimeout(() => { try { paint(); } catch (e) {} }, 1500);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(wire, 1200)); else setTimeout(wire, 1200);

    return {
        suggest, apply, openAll, closeAll, applyAll, paint,
        _on(i, v) { if (rows[i]) rows[i].on = !!v; renderAll(); },
        _pick(i, v) { if (rows[i]) rows[i].pick = v; renderAll(); },
        _targets: targets,
    };
})();
window.SuggestDay = SuggestDay;
;(window.__RPV=window.__RPV||{})['suggest-day.js']='1.0.4';

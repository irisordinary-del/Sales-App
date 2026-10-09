/* =============================================================================
 *  market-suggest.js — คำแนะนำชื่อตลาด (V0.9.0)
 * =============================================================================
 *  ช่อง "ชื่อตลาด" ในหน้าต่างรายวันยังโชว์ชื่อเดิม (จาก Cycle Name) — ใต้ช่องมีป้าย 💡 ให้กดใช้
 *    อำเภอ/เขต       อำเภอที่ร้านในวันนั้นอยู่มากสุด (ใกล้กันสองอำเภอ = ต่อสองชื่อ)
 *    ตำบล/แขวง       1–3 ตำบลที่รวมกันได้ ≥ 70% ของร้าน
 *    ชุมชน           ชื่อชุมชน/หมู่บ้านบนแผนที่ออฟไลน์ (basemap-data.js) ที่ใกล้ร้านมากที่สุด (≤ 3 กม.)
 *    คำจากชื่อร้าน   ตลาด/วัด/โรงเรียน/นิคม/ซอย/หมู่บ้าน ที่อยู่ในชื่อร้าน ≥ 2 ร้าน
 *  ทุกป้ายบอกจำนวนร้านที่รองรับ · กดแล้วใส่ชื่อในช่องและบันทึก (ระบบไม่เปลี่ยนเอง)
 *  ⚠️ เตือนเมื่อชื่อเดิมเป็นชื่อพื้นที่ แต่ร้านในวันนั้นอยู่พื้นที่นั้นไม่ถึงครึ่ง
 *  ปุ่ม "ทั้งสาย" — ตารางชื่อเดิม ↔ ชื่อแนะนำของทุกวันในสาย ติ๊กแล้วกดยืนยันทีเดียว
 * ========================================================================== */
(function () {
    'use strict';
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const dayLbl = (d) => (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[d]) ? DAY_COLORS[d].name : String(d || '');
    const core = (s) => String(s || '').trim().replace(/^(อำเภอ|เขต|ตำบล|แขวง|อ\.|ต\.)\s*/, '');
    const shortDist = (d) => String(d || '').trim().replace(/^อำเภอ\s*/, 'อ.');
    const shortTam = (t) => String(t || '').trim().replace(/^ตำบล\s*/, 'ต.');
    const SHARE = 0.7;

    // ── ชื่อชุมชนจากแผนที่ออฟไลน์ (โหลดเมื่อใช้ครั้งแรก) ─────────────────
    let placesP = null;
    const places = () => {
        if (placesP) return placesP;
        placesP = new Promise((resolve) => {
            const done = () => {
                const d = window.__BASEMAP_DATA;
                resolve(d && Array.isArray(d.places) ? d.places.filter(p => /[ก-๙]/.test(p[3] || '')) : []);
            };
            if (window.__BASEMAP_DATA) return done();
            const el = document.createElement('script');
            el.src = 'basemap-data.js';
            el.onload = done; el.onerror = () => resolve([]);
            document.head.appendChild(el);
        });
        return placesP;
    };
    const km = (a, b, c, d) => {
        const R = Math.PI / 180, x = (d - b) * R * Math.cos((a + c) / 2 * R), y = (c - a) * R;
        return Math.sqrt(x * x + y * y) * 6371;
    };

    const storesOf = (route, day) => (typeof RoadMaster !== 'undefined' && RoadMaster.storesOfDay)
        ? RoadMaster.storesOfDay(day, (State.db.routes || {})[route] || State.stores || [], route)
        : ((State.db.routes || {})[route] || []).filter(s => !s.inactive && (s.days || []).includes(day));

    const count = (arr, f) => {
        const m = {};
        arr.forEach(s => { const k = String(f(s) || '').trim(); if (k) m[k] = (m[k] || 0) + 1; });
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    /** รวมรายการบนสุดจนได้ ≥ 70% (สูงสุด 3 ชื่อ) */
    const group = (top, total, fmt) => {
        if (!top.length) return null;
        const pick = []; let n = 0;
        for (const [k, v] of top) { pick.push(k); n += v; if (n / total >= SHARE || pick.length >= 3) break; }
        const text = pick.map((k, i) => i ? core(k) : fmt(k)).join('–');
        return { text, n };
    };

    /** คำแนะนำแบบไม่ต้องใช้แผนที่ — คำนวณทันที */
    const basic = (route, day) => {
        const arr = storesOf(route, day);
        const total = arr.length;
        const out = [];
        if (!total) return { total, items: out, arr };
        const dist = count(arr, s => s.district);
        const g1 = group(dist, total, shortDist);
        if (g1) out.push({ kind: 'อำเภอ/เขต', ...g1 });
        const tam = count(arr, s => s.subDistrict);
        const g2 = group(tam, total, shortTam);
        if (g2 && (!g1 || g2.text !== g1.text)) out.push({ kind: 'ตำบล/แขวง', ...g2 });
        const KW = /(ตลาด|วัด|โรงเรียน|นิคม|หมู่บ้าน|ซอย)[^\s()\[\],.]{2,}/g;
        const kw = {};
        arr.forEach(s => new Set(String(s.name || '').match(KW) || []).forEach(k => { kw[k] = (kw[k] || 0) + 1; }));
        Object.entries(kw).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2)
            .forEach(([k, v]) => out.push({ kind: 'จากชื่อร้าน', text: k, n: v }));
        return { total, items: out, arr, dist };
    };

    /** ชุมชนที่ใกล้ร้านมากสุด (≤ 3 กม.) — ต้องรอโหลดแผนที่ */
    const community = async (route, day) => {
        const arr = storesOf(route, day).filter(s => isFinite(s.lat) && isFinite(s.lng) && (s.lat || s.lng));
        if (!arr.length) return null;
        const pl = await places();
        if (!pl.length) return null;
        let a = 90, b = 180, c = -90, d = -180;
        arr.forEach(s => { a = Math.min(a, s.lat); c = Math.max(c, s.lat); b = Math.min(b, s.lng); d = Math.max(d, s.lng); });
        const near = pl.filter(p => p[1] > a - 0.02 && p[1] < c + 0.02 && p[2] > b - 0.02 && p[2] < d + 0.02);
        if (!near.length) return null;
        const m = {};
        arr.forEach(s => {
            let best = null, bd = 3;
            near.forEach(p => { const k = km(s.lat, s.lng, p[1], p[2]); if (k < bd) { bd = k; best = p[3]; } });
            if (best) m[best] = (m[best] || 0) + 1;
        });
        const top = Object.entries(m).sort((x, y) => y[1] - x[1])[0];
        if (!top || top[1] < Math.max(2, arr.length * 0.25)) return null;
        return { kind: 'ชุมชน', text: top[0], n: top[1] };
    };

    /** ชื่อเดิมตรงกับพื้นที่จริงไหม — เตือนเฉพาะชื่อที่เป็นชื่อพื้นที่ (มีชื่อเขต/ตำบลของสายนี้อยู่ในชื่อ) */
    const mismatch = (route, day, name, b) => {
        name = String(name || '');
        if (!name || !b.total) return null;
        const all = (State.db.routes || {})[route] || [];
        const cores = new Set();
        all.forEach(s => { [s.district, s.subDistrict].forEach(v => { const c = core(v); if (c.length >= 3) cores.add(c); }); });
        const hit = [...cores].filter(c => name.includes(c));
        if (!hit.length) return null;
        const ok = b.arr.filter(s => hit.some(c => core(s.district) === c || core(s.subDistrict) === c)).length;
        if (ok / b.total >= 0.5) return null;
        const top = (b.dist && b.dist[0]) ? `${shortDist(b.dist[0][0])} ${b.dist[0][1]}/${b.total} ร้าน` : '';
        return { ok, total: b.total, top };
    };

    const chip = (day, it, total) => `<button onclick="MarketSuggest.use('${esc(day)}', this.dataset.t)" data-t="${esc(it.text)}"
            title="${esc(it.kind)} · รองรับ ${it.n}/${total} ร้าน — กดเพื่อใช้ชื่อนี้"
            class="px-1.5 py-0.5 rounded-md border border-amber-200 bg-amber-50 hover:bg-amber-100 text-[10.5px] text-amber-900 font-bold">
            ${esc(it.text)} <span class="font-normal text-amber-600">${it.n}/${total}</span></button>`;

    const panelHTML = (route, day) => {
        const b = basic(route, day);
        if (!b.total) return '';
        const cur = (typeof RoadMaster !== 'undefined') ? RoadMaster.marketName(route, day, State.stores) : '';
        const mm = mismatch(route, day, cur, b);
        return `<div id="mk-sugg" data-day="${esc(day)}" class="mb-1.5">
            ${mm ? `<p id="mk-warn" class="text-[10.5px] text-red-700 bg-red-50 border border-red-200 rounded-md px-1.5 py-0.5 mb-1">⚠️ ชื่อเดิมตรงกับพื้นที่ของร้านแค่ ${mm.ok}/${mm.total} ร้าน — ส่วนใหญ่อยู่ ${esc(mm.top)}</p>` : ''}
            <div class="flex items-center gap-1 flex-wrap">
              <span class="text-gray-400 shrink-0">💡 แนะนำ</span>
              ${b.items.map(it => chip(day, it, b.total)).join('')}
              <span id="mk-sugg-place" class="text-[10px] text-gray-400">⏳ ชุมชนใกล้เคียง…</span>
              <button onclick="MarketSuggest.bulk()" title="ดู/ตั้งชื่อตลาดตามคำแนะนำทุกวันของสายนี้"
                      class="ml-auto px-1.5 py-0.5 rounded-md border border-gray-200 bg-white hover:bg-gray-100 text-[10.5px] font-bold text-gray-600">🗂 ทั้งสาย</button>
            </div></div>`;
    };

    const fillPlace = async (route, day) => {
        const it = await community(route, day).catch(() => null);
        const el = document.getElementById('mk-sugg-place');
        const box = document.getElementById('mk-sugg');
        if (!el || !box || box.dataset.day !== day) return;
        const total = storesOf(route, day).length;
        el.outerHTML = it ? chip(day, it, total) : '<span class="text-[10px] text-gray-300">ไม่พบชื่อชุมชนใกล้ร้าน</span>';
    };

    // ── ตั้งชื่อทั้งสาย ───────────────────────────────────────────────────
    let bulkRows = [];
    const closeBulk = () => { const o = document.getElementById('mk-bulk'); if (o) o.remove(); };
    const bulk = async () => {
        const route = State.localActiveRoute;
        if (!route) return;
        closeBulk();
        const days = (typeof RoadMaster !== 'undefined') ? RoadMaster.daysOf(route) : [];
        bulkRows = days.map(day => {
            const b = basic(route, day);
            const cur = RoadMaster.marketName(route, day, (State.db.routes || {})[route] || State.stores);
            const rec = b.items.find(x => x.kind === 'ตำบล/แขวง') || b.items[0] || null;
            return { day, cur, b, opts: b.items.slice(), rec, mm: mismatch(route, day, cur, b) };
        });
        const ov = document.createElement('div');
        ov.id = 'mk-bulk';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px';
        const rowH = (r, i) => {
            const opts = r.opts.map((o, k) => `<option value="${k}" ${r.rec && o.text === r.rec.text ? 'selected' : ''}>${esc(o.text)} (${o.n}/${r.b.total} · ${esc(o.kind)})</option>`).join('');
            const diff = r.rec && r.rec.text !== r.cur;
            return `<tr class="border-t border-gray-100 ${r.mm ? 'bg-red-50' : ''}">
                <td class="px-2 py-1"><input type="checkbox" id="mkb-c${i}" ${diff ? 'checked' : ''}></td>
                <td class="px-2 py-1 font-bold whitespace-nowrap">${esc(dayLbl(r.day))}</td>
                <td class="px-2 py-1 text-right tabular-nums">${r.b.total}</td>
                <td class="px-2 py-1 text-gray-600">${esc(r.cur) || '<span class="text-gray-300">— ไม่มีชื่อ</span>'}${r.mm ? ` <span class="text-red-600" title="ส่วนใหญ่อยู่ ${esc(r.mm.top)}">⚠️ ${r.mm.ok}/${r.mm.total}</span>` : ''}</td>
                <td class="px-2 py-1"><select id="mkb-s${i}" class="border border-gray-200 rounded px-1 py-0.5 text-[11px] max-w-[300px]" onchange="document.getElementById('mkb-c${i}').checked=true">${opts}</select></td>
            </tr>`;
        };
        ov.innerHTML = `<div class="bg-white rounded-2xl shadow-xl p-4 w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="text-sm font-black text-gray-800">💡 ตั้งชื่อตลาดตามคำแนะนำ — สาย ${esc(route)}</h3>
              <button onclick="MarketSuggest.closeBulk()" class="ml-auto text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
            </div>
            <p class="text-[10.5px] text-gray-500 mb-2">ติ๊กวันที่ต้องการเปลี่ยน · ค่าเริ่มต้นเลือกชื่อแบบตำบล/แขวง (แยกวันได้ชัดสุด) และติ๊กไว้เฉพาะวันที่ชื่อต่างจากเดิม · แถวสีแดง = ชื่อเดิมไม่ตรงพื้นที่ · ย้อนกลับได้ด้วย Ctrl+Z</p>
            <div class="overflow-y-auto flex-1"><table class="w-full text-[11.5px]">
              <thead><tr class="bg-gray-50 text-gray-500"><th class="px-2 py-1 text-left">✓</th><th class="px-2 py-1 text-left">Day</th><th class="px-2 py-1 text-right">ร้าน</th><th class="px-2 py-1 text-left">ชื่อเดิม</th><th class="px-2 py-1 text-left">ชื่อใหม่</th></tr></thead>
              <tbody>${bulkRows.map(rowH).join('')}</tbody></table></div>
            <div class="flex gap-2 mt-3">
              <button onclick="MarketSuggest.bulkAll(true)" class="px-2 py-1.5 rounded-lg border border-gray-200 text-[11px] font-bold text-gray-600">☑ ทุกวัน</button>
              <button onclick="MarketSuggest.bulkAll(false)" class="px-2 py-1.5 rounded-lg border border-gray-200 text-[11px] font-bold text-gray-600">☐ ล้าง</button>
              <button onclick="MarketSuggest.bulkApply()" class="ml-auto px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">ใช้ชื่อที่ติ๊ก</button>
            </div></div>`;
        ov.addEventListener('click', (e) => { if (e.target === ov) closeBulk(); });
        document.body.appendChild(ov);
    };
    const bulkAll = (on) => bulkRows.forEach((_, i) => { const c = document.getElementById('mkb-c' + i); if (c) c.checked = on; });
    const bulkApply = () => {
        const route = State.localActiveRoute;
        let n = 0;
        try { if (window.EditHistory) EditHistory.mark('ตั้งชื่อตลาดตามคำแนะนำ'); } catch (e) {}
        bulkRows.forEach((r, i) => {
            const c = document.getElementById('mkb-c' + i), s = document.getElementById('mkb-s' + i);
            if (!c || !c.checked || !s || !r.opts[+s.value]) return;
            RoadMaster.setMarketName(route, r.day, r.opts[+s.value].text); n++;
        });
        closeBulk();
        try { RoadMaster.render(); } catch (e) {}
        try { UI.render(); } catch (e) {}
        try { if (UI.showSaveToast) UI.showSaveToast(`✏️ ตั้งชื่อตลาดใหม่ ${n} วัน`); } catch (e) {}
    };

    const use = (day, text) => {
        try { if (window.EditHistory) EditHistory.mark('ตั้งชื่อตลาด'); } catch (e) {}
        const inp = document.getElementById('rm-market');
        if (inp) inp.value = text;
        RoadMaster.saveMarket(day, text);
        try { UI.render(); } catch (e) {}
        const w = document.getElementById('mk-warn');
        if (w) w.remove();
        const b = basic(State.localActiveRoute, day);
        const mm = mismatch(State.localActiveRoute, day, text, b);
        if (mm) {
            const box = document.getElementById('mk-sugg');
            if (box) box.insertAdjacentHTML('afterbegin', `<p id="mk-warn" class="text-[10.5px] text-red-700 bg-red-50 border border-red-200 rounded-md px-1.5 py-0.5 mb-1">⚠️ ชื่อนี้ตรงกับพื้นที่ของร้านแค่ ${mm.ok}/${mm.total} ร้าน</p>`);
        }
    };

    // ── ติดตั้ง: แทรกใต้ช่องชื่อตลาดในหน้าต่างรายวัน ─────────────────────────
    const wrap = () => {
        if (typeof RoadMaster === 'undefined' || !RoadMaster.dayPanelHTML) return setTimeout(wrap, 500);
        if (RoadMaster._mkWrapped) return;
        RoadMaster._mkWrapped = true;
        const orig = RoadMaster.dayPanelHTML;
        RoadMaster.dayPanelHTML = function (day) {
            const html = orig.apply(this, arguments);
            const route = State.localActiveRoute;
            if (!html || !route) return html;
            let extra = '';
            try { extra = panelHTML(route, day); } catch (e) { console.warn('[MarketSuggest]', e); }
            if (extra) setTimeout(() => fillPlace(route, day), 0);
            const at = '<div class="flex items-center gap-1.5 flex-wrap">';
            return html.includes(at) ? html.replace(at, extra + at) : html + extra;
        };
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(wrap, 1200));

    window.MarketSuggest = { basic, community, mismatch, use, bulk, bulkAll, bulkApply, closeBulk, _places: places };
})();

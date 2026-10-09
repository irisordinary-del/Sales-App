/* =============================================================================
 *  cover.js — แยก "จำนวนร้าน (Coverage)" ออกจาก "จำนวนครั้งเข้าเยี่ยม (Visit)"
 * =============================================================================
 *  นิยามที่ตกลงกันไว้
 *    Coverage = ร้านที่ถูกระบุทั้งสายและวันเข้าเยี่ยมแล้ว — นับหัวร้าน ร้าน F2 นับ 1
 *    Visit    = จำนวนครั้งที่ต้องเข้าจริงทั้งเดือน — ร้าน F2 นับ 2
 *               (ศูนย์รอบสั้น ช่องวันเดียวก็วิ่ง 2 รอบ ตัวนับอ่านจาก Freq.visitsOf)
 *
 *  ระดับ "วัน" สองค่านี้เท่ากันเสมอ (ร้านหนึ่งเข้าวันนั้นได้ครั้งเดียว)
 *  จะต่างกันก็ต่อเมื่อดูระดับสายหรือระดับศูนย์ — จึงโชว์แยกเฉพาะที่แถบล่างกับแท็บสรุป
 * ========================================================================== */
(function () {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const UNASSIGNED = 'รอจัดสาย';

    const visitsOf = (s) => {
        if (typeof Freq !== 'undefined' && Freq.visitsOf) { try { return Freq.visitsOf(s); } catch (e) {} }
        return (s.days || []).length;
    };

    /** สรุปของสายเดียว */
    const statOf = (rt) => {
        const list = ((State.db.routes || {})[rt] || []).filter(s => !s.inactive);
        const byDay = {};
        let cover = 0, visits = 0, f2 = 0, noDay = 0;
        list.forEach(s => {
            const d = s.days || [];
            if (!d.length) { noDay++; return; }
            cover++;
            const v = visitsOf(s);
            // ร้าน F2 = ถูกเข้า ≥ 2 ครั้ง/เดือน ไม่ว่าจะเพราะมี 2 ช่องวัน (รอบยาว) หรือตลาดวิ่งทุกรอบ (รอบสั้น)
            if (v >= 2) f2++;
            visits += v;
            d.forEach(x => { byDay[x] = (byDay[x] || 0) + 1; });
        });
        const days = Object.keys(byDay).sort((a, b) => dayNum(a) - dayNum(b));
        const nums = days.map(d => byDay[d]);
        // วันทำงานจริงของสายในเดือนนี้ = จำนวน "รอบวิ่ง" ของทุกตลาดรวมกัน (ตลาดที่วิ่ง 2-3 รอบนับ 2-3 วัน)
        let workDays = 0;
        days.forEach(d => { let r = 1; try { if (typeof Freq !== 'undefined' && Freq.runsOf) r = Freq.runsOf(rt, d) || 1; } catch (e) {} workDays += r; });
        return {
            rt, cover, visits, f2, f1: cover - f2, noDay,
            beats: days.length, byDay, days, workDays,
            avg: workDays ? Math.round((visits / workDays) * 10) / 10 : 0,
            max: nums.length ? Math.max(...nums) : 0,
            min: nums.length ? Math.min(...nums) : 0,
            maxDay: nums.length ? days[nums.indexOf(Math.max(...nums))] : '',
            minDay: nums.length ? days[nums.indexOf(Math.min(...nums))] : '',
        };
    };

    const all = () => Object.keys(State.db.routes || {})
        .filter(r => r !== UNASSIGNED)
        .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }))
        .map(statOf);

    /** ตารางรายสายในแท็บสรุป */
    const table = (rows) => {
        const tot = rows.reduce((t, r) => ({
            cover: t.cover + r.cover, visits: t.visits + r.visits,
            f2: t.f2 + r.f2, beats: t.beats + r.beats, workDays: t.workDays + (r.workDays || 0),
        }), { cover: 0, visits: 0, f2: 0, beats: 0, workDays: 0 });
        // เรียงให้สายที่ไม่สมดุลที่สุดลอยขึ้นบน (ส่วนต่างวันหนักสุด-เบาสุด)
        const sorted = [...rows].sort((a, b) => (b.max - b.min) - (a.max - a.min));
        const head = ['สาย', 'ตลาด', 'ร้าน', 'ครั้ง', 'F2', 'เฉลี่ย/วันทำงาน', 'หนักสุด', 'เบาสุด'];
        return `
        <details class="col-span-2 mb-2" id="cover-box" ${window.__coverOpen ? 'open' : ''}
                 ontoggle="Coverage.remember(this.open)">
          <summary class="cursor-pointer select-none flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-800 text-white mb-2">
            <span class="flex-1 text-[12px] font-black">📊 ร้าน &amp; ครั้งเข้าเยี่ยม รายสาย</span>
            <span class="text-[11px] tabular-nums opacity-80">
              ${tot.cover.toLocaleString()} ร้าน · ${tot.visits.toLocaleString()} ครั้ง</span>
          </summary>
          <div class="overflow-x-auto mb-2">
            <table class="w-full text-[10.5px] bg-white border border-gray-200 rounded-xl overflow-hidden">
              <thead><tr class="bg-gray-50 text-gray-500">
                ${head.map((h, i) => `<th class="px-1.5 py-1 font-bold ${i ? 'text-right' : 'text-left'}">${h}</th>`).join('')}
              </tr></thead>
              <tbody>
                ${sorted.map(r => {
                    const gap = r.max - r.min;
                    const warn = r.beats && gap > Math.max(5, r.avg * 0.6);
                    return `<tr class="border-t border-gray-100 ${warn ? 'bg-amber-50' : ''}">
                      <td class="px-1.5 py-1 font-mono font-bold text-gray-700">${esc(r.rt)}</td>
                      <td class="px-1.5 py-1 text-right tabular-nums text-gray-500">${r.beats}</td>
                      <td class="px-1.5 py-1 text-right tabular-nums font-bold text-gray-800">${r.cover.toLocaleString()}</td>
                      <td class="px-1.5 py-1 text-right tabular-nums font-bold ${r.visits > r.cover ? 'text-emerald-600' : 'text-gray-800'}">${r.visits.toLocaleString()}</td>
                      <td class="px-1.5 py-1 text-right tabular-nums ${r.f2 ? 'text-red-600 font-bold' : 'text-gray-300'}">${r.f2 || '—'}</td>
                      <td class="px-1.5 py-1 text-right tabular-nums text-gray-500">${r.avg || '—'}</td>
                      <td class="px-1.5 py-1 text-right tabular-nums ${warn ? 'text-amber-700 font-bold' : 'text-gray-500'}">
                        ${r.max ? r.max + ' <span class="text-[9px] opacity-60">' + r.maxDay.replace('Day ', 'D') + '</span>' : '—'}</td>
                      <td class="px-1.5 py-1 text-right tabular-nums text-gray-500">
                        ${r.beats ? r.min + ' <span class="text-[9px] opacity-60">' + r.minDay.replace('Day ', 'D') + '</span>' : '—'}</td>
                    </tr>`;
                }).join('')}
              </tbody>
              <tfoot><tr class="border-t-2 border-gray-200 bg-gray-50 font-bold text-gray-700">
                <td class="px-1.5 py-1">รวม ${sorted.length} สาย</td>
                <td class="px-1.5 py-1 text-right tabular-nums">${tot.beats}</td>
                <td class="px-1.5 py-1 text-right tabular-nums">${tot.cover.toLocaleString()}</td>
                <td class="px-1.5 py-1 text-right tabular-nums text-emerald-700">${tot.visits.toLocaleString()}</td>
                <td class="px-1.5 py-1 text-right tabular-nums text-red-600">${tot.f2 || '—'}</td>
                <td class="px-1.5 py-1 text-right tabular-nums" colspan="3">
                  ${tot.cover ? 'เฉลี่ย ' + (tot.visits / tot.cover).toFixed(2) + ' ครั้ง/ร้าน/เดือน' : ''}</td>
              </tr></tfoot>
            </table>
          </div>
          <p class="text-[10px] text-gray-400 leading-snug px-1 mb-1">
            <b>ร้าน</b> = จำนวนร้านที่จัดสายและวันแล้ว (ร้าน F2 นับ 1) ·
            <b>ครั้ง</b> = จำนวนครั้งที่ต้องเข้าจริงทั้งเดือน ·
            <b>F2</b> = ร้านที่ถูกเข้า ≥ 2 ครั้ง/เดือน (2 ช่องวัน หรือตลาดวิ่งทุกรอบ) ·
            <b>เฉลี่ย/วันทำงาน</b> = ครั้ง ÷ จำนวนวันที่สายวิ่งจริงในเดือน ·
            แถวสีเหลืองคือสายที่วันหนักกับวันเบาต่างกันมาก ควรเกลี่ย
          </p>
        </details>`;
    };

    const paint = () => {
        // V0.7.5: ตารางรายสายย้ายไปอยู่หน้าภาพรวม (Details by Route) — ไม่โชว์ในแท็บสรุปแล้ว
        const old0 = document.getElementById('cover-box');
        if (old0) old0.remove();
        if (!window.__coverInSummary) return;
        const el = document.getElementById('list-summary');
        if (!el) return;
        const rows = all().filter(r => r.cover || r.beats);
        if (!rows.length) return;
        const old = document.getElementById('cover-box');
        const html = table(rows);
        if (old) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            old.replaceWith(tmp.firstElementChild);
        } else {
            el.insertAdjacentHTML('afterbegin', html);
        }
    };

    window.Coverage = {
        statOf, all, visitsOf, paint,
        remember(v) { window.__coverOpen = !!v; },
        /** ตัวเลขรวมทั้งศูนย์ — ให้ส่วนอื่นเรียกใช้ได้ */
        totals() {
            const rows = all();
            return rows.reduce((t, r) => ({
                cover: t.cover + r.cover, visits: t.visits + r.visits,
                f2: t.f2 + r.f2, beats: t.beats + r.beats, noDay: t.noDay + r.noDay,
            }), { cover: 0, visits: 0, f2: 0, beats: 0, noDay: 0 });
        },
    };

    const boot = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof State === 'undefined') return setTimeout(boot, 400);
        if (UI._coverWired) return;
        UI._coverWired = true;
        const orig = UI.render;
        UI.render = function () {
            const r = orig.apply(this, arguments);
            const go = () => { try { paint(); } catch (e) {} };
            go(); setTimeout(go, 0); setTimeout(go, 300);
            return r;
        };
        // แท็บสรุปวาดใหม่เองตอนกาง/ยุบ ต้องแปะทับหลังมันวาดเสร็จ
        const hook = () => {
            if (typeof MultiRoute === 'undefined' || !MultiRoute.fixSummary || MultiRoute.fixSummary._coverWrapped) return false;
            const op = MultiRoute.fixSummary;
            const fn = function () {
                const r = op.apply(this, arguments);
                try { paint(); } catch (e) {}
                setTimeout(() => { try { paint(); } catch (e) {} }, 0);
                return r;
            };
            fn._coverWrapped = true;
            MultiRoute.fixSummary = fn;
            return true;
        };
        [500, 1500, 4000, 9000].forEach(t => setTimeout(hook, t));
        document.addEventListener('click', () => setTimeout(() => { try { paint(); } catch (e) {} }, 150), true);
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 900));
})();

/* =============================================================================
 *  split-sel.js — แบ่งกลุ่มเฉพาะร้านที่เลือกไว้
 * =============================================================================
 *  ปุ่ม AI เดิมทำงานกับร้านทั้งสายเสมอ ใช้กับงานจริงไม่ได้เวลาอยากหยิบแค่โซนเดียว
 *  กล่องนี้รับ "ร้านที่ติ๊กไว้" (วาดพื้นที่ / Shift-คลิก / ปุ่มในเมนูหมุด) มาแบ่งเป็น
 *  N ก้อนด้วยตัวคำนวณเดียวกับตัวสร้างสายใหม่ แล้วเสนอผลก่อน ไม่เขียนทับทันที
 *
 *  กติกาที่ยึด
 *    • CY ผูกกับช่องวันของสาย ไม่ได้ติดไปกับกลุ่มร้าน — ย้ายร้านเข้าวันไหน ใช้ CY ของวันนั้น
 *    • ร้าน F2 ลงวันไหน เติมคู่ครึ่งรอบให้อัตโนมัติ
 *    • วันที่โดนแตะ จัดลำดับคิวใหม่ตามระยะถนนจริง
 * ========================================================================== */
(function () {
    'use strict';

    const UNASSIGNED = 'รอจัดสาย';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4',
                    '#eab308', '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#f43f5e'];
    const dayNum = (d) => parseInt(String(d || '').replace(/\D/g, ''), 10) || 0;
    const dayName = (d) => (typeof DAY_COLORS !== 'undefined' && DAY_COLORS[d]) ? DAY_COLORS[d].name : d;

    const S = {
        cfg: { mode: 'count', n: 4, cap: 25, dest: 'keep', route: '' },
        plan: null,        // ผลที่เสนอ
        layer: null,       // ชั้นวาดสีก้อนบนแผนที่
    };

    // ── ข้อมูลตั้งต้น ───────────────────────────────────────────────────
    const picked = () => (State.stores || []).filter(s => s.selected && !s.inactive
        && isFinite(s.lat) && isFinite(s.lng));

    const routeOf = (s) => (typeof MultiRoute !== 'undefined' && MultiRoute.routeOf)
        ? MultiRoute.routeOf(s) : (s.route || State.localActiveRoute);

    const breakdown = (list) => {
        const byR = new Map(), byD = new Map();
        list.forEach(s => {
            const r = routeOf(s);
            byR.set(r, (byR.get(r) || 0) + 1);
            const ds = (s.days || []);
            if (!ds.length) byD.set('—', (byD.get('—') || 0) + 1);
            else byD.set(ds[0], (byD.get(ds[0]) || 0) + 1);
        });
        const sortN = (a, b) => b[1] - a[1];
        return { byR: [...byR.entries()].sort(sortN), byD: [...byD.entries()].sort(sortN) };
    };

    const routeList = () => Object.keys(State.db.routes || {})
        .filter(r => r !== UNASSIGNED)
        .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));

    const dayList = () => {
        const k = State.db.cycleDays || 24;
        const out = [];
        for (let i = 1; i <= k; i++) out.push('Day ' + i);
        return out;
    };

    /** CY ที่ช่อง (สาย × วัน) นั้นถืออยู่ — ไม่ได้ติดไปกับกลุ่มร้าน */
    const cyOfSlot = (route, day) => {
        const arr = (State.db.routes || {})[route] || [];
        for (const s of arr) {
            if (!(s.days || []).includes(day)) continue;
            const cy = (s.cys && s.cys[day]) || ((s.days || []).length === 1 ? s.cy : '');
            if (cy) return cy;
        }
        return '';
    };

    const pairDay = (day) => {
        const k = State.db.cycleDays || 24;
        const mK = Math.ceil(k / 2), n = dayNum(day);
        const p = n <= mK ? n + mK : n - mK;
        return (p >= 1 && p <= k) ? ('Day ' + p) : null;
    };

    const kmOf = (list) => {
        if (!list.length) return 0;
        const dist = (a, b) => (typeof RoadDist !== 'undefined' && RoadDist.ready)
            ? RoadDist.m(a, b) / 1000
            : Math.hypot((a.lat - b.lat) * 110.57, (a.lng - b.lng) * 97.4);
        // เส้นทางแบบเพื่อนบ้านใกล้สุดคร่าว ๆ พอให้เทียบก้อนกันได้
        const rest = list.slice(1); let cur = list[0], km = 0;
        while (rest.length) {
            let bi = 0, bd = Infinity;
            for (let i = 0; i < rest.length; i++) { const d = dist(cur, rest[i]); if (d < bd) { bd = d; bi = i; } }
            km += bd; cur = rest.splice(bi, 1)[0];
        }
        return Math.round(km);
    };

    // ── คำนวณ ───────────────────────────────────────────────────────────
    const compute = () => {
        const list = picked();
        if (list.length < 2) return UI.showErrorToast('⚠️ เลือกร้านก่อน (วาดพื้นที่ หรือ Shift-คลิกหมุด)');
        const c = S.cfg;
        let k = c.mode === 'count' ? Math.max(1, c.n | 0)
                                   : Math.max(1, Math.round(list.length / Math.max(1, c.cap | 0)));
        k = Math.min(k, list.length);
        if (typeof RouteBuilder === 'undefined' || !RouteBuilder.balanced)
            return UI.showErrorToast('❌ ตัวคำนวณยังไม่พร้อม (route-builder.js)');

        // กดซ้ำ = ทางเลือกใหม่ (ชุดร้าน/จำนวนก้อนเดิม จะนับเป็นครั้งที่ 2, 3, …)
        // ชุดร้านเล็ก ๆ k-means สุ่มจุดตั้งต้นยังไงก็ลู่เข้าคำตอบเดิม จึงต้องเปลี่ยน "วิธีตัด" ไม่ใช่แค่เปลี่ยน seed
        // และข้ามผลที่ซ้ำกับครั้งก่อน ๆ เสมอ
        const key = list.map(s => s.id).sort().join(',') + '|' + k;
        if (S._key === key) S.attempt = (S.attempt || 1) + 1; else { S._key = key; S.attempt = 1; S.seen = new Set(); }
        if (!S.seen) S.seen = new Set();
        const pr = RouteBuilder.proj(list);
        const X = list.map(s => pr.of(s));
        const sigOf = (lb) => {
            const g = []; for (let i = 0; i < k; i++) g.push([]);
            lb.forEach((v, i) => g[v].push(list[i].id));
            return g.map(a => a.sort().join(',')).sort().join('|');
        };
        let lab = null, how = '';
        const tries = altStrategies(X, k, S.attempt);
        for (const [name, fn] of tries) {
            const cand = fn();
            if (!cand) continue;
            const sg = sigOf(cand);
            if (S.seen.has(sg)) continue;
            lab = cand; how = name; S.seen.add(sg); break;
        }
        if (!lab) {
            // ทุกวิธีให้ผลซ้ำหมด → ใช้ผลแรกสุด และบอกตรง ๆ
            lab = tries[0][1](); how = tries[0][0];
            S.repeat = true;
        } else S.repeat = false;

        const groups = [];
        for (let i = 0; i < k; i++) groups.push([]);
        lab.forEach((g, i) => groups[g].push(list[i]));

        const plan = { k, total: list.length, groups: [] };
        groups.forEach((mem, i) => {
            if (!mem.length) return;
            // ปลายทางเริ่มต้น = สาย/วันที่ร้านส่วนใหญ่ในก้อนนี้อยู่เดิม
            const cR = new Map(), cD = new Map();
            mem.forEach(s => {
                const r = routeOf(s); cR.set(r, (cR.get(r) || 0) + 1);
                const d = (s.days || [])[0]; if (d) cD.set(d, (cD.get(d) || 0) + 1);
            });
            const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
            const [bR, nR] = top(cR), [bD, nD] = top(cD);
            const second = [...cR.entries()].sort((a, b) => b[1] - a[1])[1];
            const close = !!(second && (nR - second[1]) <= Math.max(1, Math.round(mem.length * 0.1)));
            plan.groups.push({
                i, mem,
                route: (c.dest === 'new' && c.route) ? c.route : (bR || State.localActiveRoute),
                day: bD || dayList()[i % dayList().length],
                votes: nD,
                km: kmOf(mem.slice()),
                fromR: [...cR.entries()].sort((a, b) => b[1] - a[1]),
                fromD: [...cD.entries()].sort((a, b) => b[1] - a[1]),
                close,                                  // สายของเดิมก้ำกึ่ง
                f2: mem.filter(s => s.freq === 2).length,
            });
        });
        dedupe(plan);
        plan.attempt = S.attempt;
        plan.how = how;
        S.plan = plan;
        paint(true);
        preview();
        if (S.repeat) UI.showErrorToast(`ℹ️ ชุดนี้แบ่ง ${k} ก้อนได้แบบเดียวที่สมดุล — ทุกวิธีให้ผลเดิม ลองเปลี่ยนจำนวนก้อนหรือเลือกร้านเพิ่ม`);
        else if (S.attempt > 1) UI.showSaveToast(`🎲 ทางเลือกที่ ${S.attempt} (${how})`);
    };

    /**
     * ชุดวิธีตัดสำหรับ "กดซ้ำ" — เรียงจากวิธีที่ควรลองก่อน ตามครั้งที่กด
     *   k-means สมดุล (แน่นสุด) → ตัดแนวตะวันออก-ตะวันตก → เหนือ-ใต้ → ทแยง 2 แบบ → รอบจุดศูนย์กลาง (พิซซ่า)
     *   → k-means สมดุลจากจุดตั้งต้นสุ่มอื่น
     * ทุกวิธีให้ก้อนขนาดเท่ากัน (±1) เหมือน k-means เดิม
     */
    const altStrategies = (X, k, attempt) => {
        const n = X.length, cap = Math.ceil(n / k);
        const chunk = (order) => { const lab = new Int32Array(n); order.forEach((i, z) => { lab[i] = Math.min(k - 1, Math.floor(z / cap)); }); return lab; };
        const sweep = (ang) => () => {
            const c = Math.cos(ang), sn = Math.sin(ang);
            const order = X.map((p, i) => i).sort((a, b) => (X[a][0] * c + X[a][1] * sn) - (X[b][0] * c + X[b][1] * sn));
            return chunk(order);
        };
        const pizza = () => {
            const cx = X.reduce((a, p) => a + p[0], 0) / n, cy = X.reduce((a, p) => a + p[1], 0) / n;
            const order = X.map((p, i) => i).sort((a, b) => Math.atan2(X[a][1] - cy, X[a][0] - cx) - Math.atan2(X[b][1] - cy, X[b][0] - cx));
            return chunk(order);
        };
        const km = (seed) => () => RouteBuilder.balanced(X, k, 30, seed).lab;
        const all = [
            ['จับกลุ่มแน่นสุด', km(7)],
            ['ตัดแนวตะวันออก-ตะวันตก', sweep(0)],
            ['ตัดแนวเหนือ-ใต้', sweep(Math.PI / 2)],
            ['ตัดแนวทแยง ↗', sweep(Math.PI / 4)],
            ['ตัดแนวทแยง ↖', sweep(3 * Math.PI / 4)],
            ['แบ่งรอบจุดศูนย์กลาง', pizza],
            ['จับกลุ่มจากจุดตั้งต้นอื่น', km(131)],
            ['จับกลุ่มจากจุดตั้งต้นอื่น (2)', km(977)],
            ['จับกลุ่มจากจุดตั้งต้นอื่น (3)', km(4243)],
        ];
        // ครั้งที่ 1 เริ่มที่วิธีแรก ครั้งถัด ๆ ไปเริ่มไล่จากวิธีถัดไป (วนกลับมาได้)
        const start = Math.min(attempt - 1, all.length - 1);
        return [...all.slice(start), ...all.slice(0, start)];
    };

    /** ห้ามสองก้อนลงช่องเดียวกัน — ไม่งั้นมันจะรวมเป็นตลาดเดียว เสียความหมายของการแบ่ง
     *  ก้อนที่ "เป็นเจ้าของเดิม" ของช่องนั้นมากที่สุดได้อยู่ต่อ ที่เหลือเลี่ยงไปวันถัดไปที่ว่าง */
    const dedupe = (plan) => {
        const used = new Set();
        const order = plan.groups.map((g, i) => i).sort((a, b) =>
            (plan.groups[b].votes || 0) - (plan.groups[a].votes || 0));
        const days = dayList();
        order.forEach(i => {
            const g = plan.groups[i];
            const key = () => g.route + '|' + g.day;
            if (!used.has(key())) { used.add(key()); return; }
            // 1) ลองวันอื่นที่ร้านในก้อนนี้เคยอยู่
            for (const [d] of (g.fromD || [])) {
                g.day = d;
                if (!used.has(key())) { used.add(key()); g.shifted = true; return; }
            }
            // 2) ไล่หาวันว่างในสายนั้น
            for (const d of days) {
                g.day = d;
                if (!used.has(key())) { used.add(key()); g.shifted = true; return; }
            }
            used.add(key());
        });
    };

    /** ระบายสีก้อนบนแผนที่ให้เห็นก่อนรับ */
    const preview = () => {
        clearPreview();
        if (!S.plan || typeof L === 'undefined' || !MapCtrl || !MapCtrl.map) return;
        const layer = L.layerGroup();
        S.plan.groups.forEach((g, i) => {
            const col = COLORS[i % COLORS.length];
            g.mem.forEach(s => {
                L.circleMarker([s.lat, s.lng], { radius: 7, color: '#fff', weight: 2,
                    fillColor: col, fillOpacity: 0.95 }).addTo(layer);
            });
        });
        layer.addTo(MapCtrl.map);
        S.layer = layer;
    };
    const clearPreview = () => {
        if (S.layer && MapCtrl && MapCtrl.map) { try { MapCtrl.map.removeLayer(S.layer); } catch (e) {} }
        S.layer = null;
    };

    // ── สรุปก่อนยืนยัน ───────────────────────────────────────────────────
    /** นับว่าถ้ารับผลนี้จะเกิดอะไรจริง — ร้านไหนเปลี่ยนสาย/วัน ร้านไหนอยู่ที่เดิม วันไหนโดนเรียงคิวใหม่ */
    const impact = (p) => {
        let moveRoute = 0, moveDay = 0, same = 0;
        const reflow = new Set(), touchedR = new Set(), from = new Map();
        p.groups.forEach(g => {
            touchedR.add(g.route);
            reflow.add(g.route + '|' + g.day);
            g.mem.forEach(s => {
                const r0 = routeOf(s), d0 = (s.days || [])[0] || '';
                const sameRoute = r0 === g.route, sameDay = (s.days || []).length === 1 && d0 === g.day;
                if (sameRoute && sameDay) { same++; return; }
                if (!sameRoute) { moveRoute++; touchedR.add(r0); } else moveDay++;
                (s.days || []).forEach(d => reflow.add(r0 + '|' + d));
                const k = r0 + ' ' + (d0 ? dayName(d0) : 'ยังไม่จัดวัน');
                from.set(k, (from.get(k) || 0) + 1);
            });
        });
        return { moveRoute, moveDay, same, reflow, touchedR, from };
    };

    const accept = () => {
        const p = S.plan;
        if (!p) return;
        const im = impact(p);
        const changed = im.moveRoute + im.moveDay;
        if (!changed) return UI.showErrorToast('ℹ️ ทุกร้านอยู่ที่สาย/วันเดิมอยู่แล้ว — ไม่มีอะไรต้องเปลี่ยน (ใช้ "Assign ใหม่" หรือแก้ปลายทางรายก้อนก่อน)');
        const dest = p.groups.map((g, i) => `  ก้อน ${i + 1}: ${g.mem.length} ร้าน → ${g.route} ${dayName(g.day)}`).join('\n');
        const src = [...im.from.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
            .map(([k, v]) => `  ${k}: ${v} ร้าน`).join('\n') + (im.from.size > 6 ? `\n  …อีก ${im.from.size - 6} ที่` : '');
        const msg = `จะย้าย ${changed.toLocaleString()} ร้าน (เปลี่ยนสาย ${im.moveRoute} · เปลี่ยนวันในสายเดิม ${im.moveDay})`
            + (im.same ? ` · อยู่ที่เดิม ${im.same} ร้าน` : '') + `\n\nลงที่:\n${dest}\n\nมาจาก:\n${src}`
            + `\n\nผลพวง: เรียงคิวใหม่ ${im.reflow.size} วัน · CY ของร้านที่ย้ายเปลี่ยนตามช่องวันใหม่`
            + ` · สถานะ "เซลยืนยันแผน" ของ ${im.touchedR.size} สายถูกล้าง`
            + `\n\nบันทึกทันทีเมื่อกดยืนยัน — ย้อนกลับได้ด้วย Ctrl+Z หรือปุ่ม ↶`;
        UI.showConfirm(msg, () => { doAccept(); });
    };

    // ── รับผลลัพธ์ ──────────────────────────────────────────────────────
    const doAccept = async () => {
        const p = S.plan;
        if (!p) return;
        try { if (window.EditHistory && EditHistory.mark) EditHistory.mark('แบ่งกลุ่มร้านที่เลือก'); } catch (e) {}
        const R = State.db.routes || {};
        const ym = App._currentPlanYM;
        const touched = new Set(), reflow = new Map();    // route -> Set(day)
        let moved = 0;

        UI.showLoader('🔀 กำลังย้ายร้าน...', `${p.total} ร้าน · ${p.groups.length} ก้อน`);
        try {
            // สายปลายทางที่ยังไม่ได้โหลดเข้าเครื่อง ต้องดึงมาก่อน ไม่งั้นเขียนทับของเดิม
            for (const g of p.groups) {
                if (Array.isArray(R[g.route])) continue;
                const d = await App.planRoutesCol(ym).doc(g.route).get().catch(() => null);
                R[g.route] = (d && d.exists) ? (d.data().stores || []) : [];
            }

            for (const g of p.groups) {
                const days = [g.day];
                const pd = pairDay(g.day);
                const cyMain = cyOfSlot(g.route, g.day);
                const cyPair = pd ? cyOfSlot(g.route, pd) : '';
                g.mem.forEach(s => {
                    const from = routeOf(s);
                    const oldDays = [...(s.days || [])];
                    const sameRoute = from === g.route;
                    const sameDay = oldDays.length === 1 && oldDays[0] === g.day;
                    if (sameRoute && sameDay && !(s.freq === 2 && oldDays.length < 2)) {
                        s.selected = false; return;                       // อยู่ที่เดิมอยู่แล้ว
                    }
                    if (!sameRoute) {
                        R[from] = (R[from] || []).filter(x => String(x.id) !== String(s.id));
                        touched.add(from);
                        if (!reflow.has(from)) reflow.set(from, new Set());
                        oldDays.forEach(d => reflow.get(from).add(d));
                        R[g.route].push(s);
                        s.route = g.route;
                    } else {
                        if (!reflow.has(from)) reflow.set(from, new Set());
                        oldDays.forEach(d => reflow.get(from).add(d));
                    }
                    s.days = (s.freq === 2 && pd) ? [g.day, pd] : days.slice();
                    s.seqs = {};
                    s.cys = {};
                    if (cyMain) s.cys[g.day] = cyMain;
                    if (s.freq === 2 && pd && cyPair) s.cys[pd] = cyPair;
                    s.cy = cyMain || '';
                    s.selected = false;
                    moved++;
                });
                touched.add(g.route);
                if (!reflow.has(g.route)) reflow.set(g.route, new Set());
                reflow.get(g.route).add(g.day);
                if (pd) reflow.get(g.route).add(pd);
            }

            // จัดลำดับคิวใหม่เฉพาะวันที่โดนแตะ
            // SeqTool อ่านจาก State.stores (ชุดที่เปิดอยู่) — สายปลายทางบางสายอาจไม่ได้เปิด
            // จึงต้องยืมให้มันเห็นร้านของทุกสายที่แตะก่อน แล้วค่อยคืนค่าเดิม
            if (typeof SeqTool !== 'undefined' && SeqTool.orderDay) {
                const keep = State.stores;
                const seen = new Set(), pool = [];
                [...touched].forEach(rt => (R[rt] || []).forEach(s => {
                    s.route = rt;
                    const k2 = rt + '|' + s.id;
                    if (!seen.has(k2)) { seen.add(k2); pool.push(s); }
                }));
                State.stores = pool;
                try {
                    reflow.forEach((days, rt) => days.forEach(d => {
                        try { SeqTool.orderDay(d, true, rt); } catch (e) {}
                    }));
                } finally { State.stores = keep; }
                // กันเหนียว: ไล่เลข 1..n ให้ครบทุกสายทุกวัน (เลขขาดช่วงจะติดไปในไฟล์ DMS)
                if (SeqTool.compactAll) {
                    const sub = {};
                    touched.forEach(rt => { if (Array.isArray(R[rt])) sub[rt] = R[rt]; });
                    try { SeqTool.compactAll(sub); } catch (e) {}
                }
            }

            const routeList2 = Object.keys(R).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            await Promise.all([
                ...[...touched].filter(r => Array.isArray(R[r])).map(r => App.planRoutesCol(ym).doc(r).set({
                    stores: R[r],
                    confirmedBy: firebase.firestore.FieldValue.delete(),
                    confirmedAt: firebase.firestore.FieldValue.delete(),
                }, { merge: true })),
                App.planRef(ym).set({ routeList: routeList2, cycleDays: State.db.cycleDays || 24,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
            ]);
            UI.hideLoader();
            clearPreview();
            S.plan = null;
            if (typeof MultiRoute !== 'undefined' && MultiRoute.setOpen)
                MultiRoute.setOpen([...new Set([...(MultiRoute.open || []), ...touched])]);
            else UI.render();
            UI.showSaveToast(`✅ แบ่งแล้ว ${p.groups.length} ก้อน · ย้าย ${moved.toLocaleString()} ร้าน · ย้อนกลับได้ (Ctrl+Z)`);
            paint();
        } catch (e) {
            UI.hideLoader();
            console.error('[SplitSel]', e);
            UI.showErrorToast('❌ แบ่งกลุ่มไม่สำเร็จ: ' + (e && e.message));
        }
    };

    // ── หน้าตา ──────────────────────────────────────────────────────────
    let _sig = '';
    const paint = (force) => {
        const box = $('split-card');
        if (!box) return;
        const list = picked();
        const c = S.cfg;
        const sig = [list.length, c.mode, c.n, c.cap, c.dest, c.route,
                     S.plan ? S.plan.groups.map(g => g.route + g.day + g.mem.length).join() : ''].join('|');
        if (!force && sig === _sig) return;
        _sig = sig;
        if (!list.length) {
            box.innerHTML = `<div class="text-[11px] text-gray-400 text-center py-3">
                ✂️ <b>แบ่งกลุ่มร้านที่เลือก</b> — ยังไม่ได้เลือกร้าน<br>
                ใช้ "วาดเลือกพื้นที่" บนแผนที่ หรือ Shift-คลิกหมุด แล้วกลับมาที่นี่</div>`;
            return;
        }
        const b = breakdown(list);
        const k = c.mode === 'count' ? Math.max(1, c.n | 0) : Math.max(1, Math.round(list.length / Math.max(1, c.cap | 0)));
        const tbl = (rows, head) => `
            <table class="w-full text-[10.5px] bg-white border border-gray-200 rounded-lg overflow-hidden">
                <tr class="bg-gray-50 text-gray-500"><th class="text-left px-2 py-1 font-bold">${head}</th><th class="text-right px-2 py-1 font-bold">ร้าน</th></tr>
                ${rows.slice(0, 4).map(([k2, v]) => `<tr class="border-t border-gray-100"><td class="px-2 py-1">${esc(k2 === '—' ? 'ยังไม่จัดวัน' : (head === 'วันเดิม' ? dayName(k2) : k2))}</td><td class="px-2 py-1 text-right font-bold">${v}</td></tr>`).join('')}
                ${rows.length > 4 ? `<tr class="border-t border-gray-100 text-gray-400"><td class="px-2 py-1">อีก ${rows.length - 4} ${head === 'วันเดิม' ? 'วัน' : 'สาย'}</td><td class="px-2 py-1 text-right">${rows.slice(4).reduce((a, x) => a + x[1], 0)}</td></tr>` : ''}
            </table>`;

        const opt = (on, val, label) => `<button onclick="SplitSel.set('${val}')"
            class="flex-1 text-[11px] font-bold rounded-lg py-1.5 border transition ${on
                ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}">${label}</button>`;

        let res = '';
        if (S.plan) {
            const rs = routeList();
            res = `
            <div class="mt-3 pt-3 border-t border-gray-200">
                <div class="text-[11px] font-black text-gray-700 mb-1.5">ผลที่เสนอ${(S.plan.attempt || 1) > 1 ? ' (ทางเลือกที่ ' + S.plan.attempt + (S.plan.how ? ' · ' + esc(S.plan.how) : '') + ')' : ''} — ยังไม่เขียนทับอะไร</div>
                <table class="w-full text-[10.5px] bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <tr class="bg-gray-50 text-gray-500">
                        <th class="text-left px-2 py-1 font-bold">ก้อน</th><th class="px-1 py-1 font-bold">ร้าน</th>
                        <th class="px-1 py-1 font-bold">กม.</th><th class="text-left px-2 py-1 font-bold">ลงที่</th></tr>
                    ${S.plan.groups.map((g, i) => `
                    <tr class="border-t border-gray-100">
                        <td class="px-2 py-1"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${COLORS[i % COLORS.length]}"></span> ${i + 1}
                            ${g.close ? '<span class="text-[9px] text-amber-600 font-bold" title="ก้อนนี้มีร้านจากหลายสายพอ ๆ กัน ตรวจปลายทางอีกที">ก้ำกึ่ง</span>' : ''}
                            ${g.shifted ? '<span class="text-[9px] text-sky-600 font-bold" title="วันเดิมของก้อนนี้ถูกก้อนอื่นใช้ไปแล้ว ระบบเลี่ยงให้">เลี่ยงวันชน</span>' : ''}</td>
                        <td class="px-1 py-1 text-center font-bold">${g.mem.length}</td>
                        <td class="px-1 py-1 text-center text-gray-500">${g.km}</td>
                        <td class="px-2 py-1">
                            <select onchange="SplitSel.setDest(${i},'route',this.value)" class="border border-gray-200 rounded px-1 py-0.5 text-[10px]">
                                ${rs.map(r => `<option value="${esc(r)}" ${r === g.route ? 'selected' : ''}>${esc(r)}</option>`).join('')}
                            </select>
                            <select onchange="SplitSel.setDest(${i},'day',this.value)" class="border border-gray-200 rounded px-1 py-0.5 text-[10px]">
                                ${dayList().map(d => `<option value="${d}" ${d === g.day ? 'selected' : ''}>${dayName(d)}</option>`).join('')}
                            </select>
                        </td></tr>`).join('')}
                </table>
                ${S.plan.groups.some(g => g.f2) ? `<div class="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 text-[10px] text-amber-800">
                    ร้าน F2 ในชุดนี้ ${S.plan.groups.reduce((a, g) => a + g.f2, 0)} ร้าน — ลงวันไหน ระบบเติมคู่ครึ่งรอบให้อัตโนมัติ</div>` : ''}
                <div class="flex gap-2 mt-2">
                    <button onclick="SplitSel.cancel()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-xl text-xs font-bold">ยกเลิก</button>
                    <button onclick="SplitSel.accept()" class="flex-[2] bg-gray-900 hover:bg-black text-white py-2 rounded-xl text-xs font-bold">รับผลลัพธ์</button>
                </div>
            </div>`;
        }

        box.innerHTML = `
            <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-black text-gray-800">✂️ แบ่งกลุ่มร้านที่เลือก</span>
                <span class="ml-auto text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">${list.length.toLocaleString()} ร้าน</span>
            </div>
            <div class="text-[10px] font-bold text-gray-400 mb-1">ของเดิมมาจากไหน</div>
            <div class="flex gap-2">${tbl(b.byR, 'สายเดิม')}${tbl(b.byD, 'วันเดิม')}</div>

            <div class="text-[10px] font-bold text-gray-400 mt-3 mb-1">แบ่งเป็นกี่ก้อน</div>
            <div class="flex gap-2 items-center">
                ${opt(c.mode === 'count', 'mode:count', 'จำนวนก้อน')}
                ${opt(c.mode === 'cap', 'mode:cap', 'ก้อนละกี่ร้าน')}
                <input type="number" min="1" value="${c.mode === 'count' ? c.n : c.cap}"
                    onchange="SplitSel.set('${c.mode === 'count' ? 'n' : 'cap'}:'+this.value)"
                    class="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-center">
            </div>
            <div class="text-[10px] text-gray-400 mt-1">= ${k} ก้อน · ก้อนละ ~${Math.round(list.length / k)} ร้าน</div>

            <div class="text-[10px] font-bold text-gray-400 mt-3 mb-1">ผลลัพธ์จะลงที่ไหน</div>
            <div class="flex gap-2">
                ${opt(c.dest === 'keep', 'dest:keep', 'อิงสายเดิม')}
                ${opt(c.dest === 'new', 'dest:new', 'Assign ใหม่')}
            </div>
            ${c.dest === 'new' ? `<select onchange="SplitSel.set('route:'+this.value)"
                class="w-full mt-2 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-bold">
                <option value="">— เลือกสายปลายทาง —</option>
                ${routeList().map(r => `<option value="${esc(r)}" ${r === c.route ? 'selected' : ''}>${esc(r)}</option>`).join('')}
            </select>` : `<div class="text-[10px] text-gray-400 mt-1">แต่ละก้อนลงสาย/วันที่ร้านส่วนใหญ่ในก้อนนั้นอยู่เดิม แก้รายก้อนได้หลังคำนวณ</div>`}

            <button onclick="SplitSel.run()" class="w-full mt-3 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-xl text-xs font-bold transition"
                title="กดซ้ำได้ — แต่ละครั้งสุ่มจุดตั้งต้นใหม่ ได้การแบ่งอีกแบบ">
                ${S.plan ? '🎲 คำนวณใหม่อีกแบบ <span class="opacity-80 font-bold">(ครั้งที่ ' + ((S.plan.attempt || 1) + 1) + ')</span>' : '✨ คำนวณแบ่งกลุ่ม'}
            </button>
            ${res}`;
    };

    const mount = () => {
        const t2 = $('tab2');
        if (!t2 || $('split-card')) return;
        const box = document.createElement('div');
        box.id = 'split-card';
        box.className = 'bg-white border-2 border-amber-200 rounded-2xl p-4 shadow-sm';
        const anchor = $('selected-count-badge');
        if (anchor && anchor.parentNode === t2) t2.insertBefore(box, anchor);
        else t2.appendChild(box);
        paint();
    };

    window.SplitSel = {
        set(v) {
            const [k, val] = String(v).split(':');
            if (k === 'mode') S.cfg.mode = val;
            else if (k === 'dest') S.cfg.dest = val;
            else if (k === 'route') S.cfg.route = val;
            else if (k === 'n') S.cfg.n = Math.max(1, parseInt(val, 10) || 1);
            else if (k === 'cap') S.cfg.cap = Math.max(1, parseInt(val, 10) || 1);
            paint();
        },
        setDest(i, what, val) {
            if (!S.plan || !S.plan.groups[i]) return;
            S.plan.groups[i][what] = val;
            paint(true);
        },
        run: compute,
        get _plan() { return S.plan; },
        accept,
        cancel() { S.plan = null; clearPreview(); paint(); },
        _state: S,
    };

    const boot = () => {
        if (typeof UI === 'undefined' || !UI.render || typeof State === 'undefined') return setTimeout(boot, 400);
        if (UI._splitWired) return;
        UI._splitWired = true;
        const orig = UI.render;
        UI.render = function () {
            const r = orig.apply(this, arguments);
            try { mount(); if (!S.plan) paint(); } catch (e) { console.warn('[SplitSel]', e); }
            return r;
        };
        [800, 2000, 5000].forEach(t => setTimeout(() => { try { mount(); } catch (e) {} }, t));
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 700));
})();

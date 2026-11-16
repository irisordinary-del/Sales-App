/* =============================================================================
 *  save-guard.js — ด่านตรวจก่อนบันทึกร้านลงสาย (V1.0.1)
 * =============================================================================
 *  ที่มา: 16 ต.ค. 2569 ศูนย์ 502 — ติ๊กสายที่กำลังแก้ออกจากรายการสายที่เปิด แล้วบันทึก
 *         ร้านของ 502P07 ไปทับ 502C01 ทั้งสาย (ร้านเดิมของ C01 หาย · ร้านชุดเดียวกันอยู่ 2 สาย)
 *
 *  ทุกการเขียน "ร้านของสาย" ของเดือนที่เปิดอยู่ (…/plans/<เดือน>/routes/<สาย> ที่มี stores)
 *  ไม่ว่าจะมาจากปุ่มไหน ต้องผ่าน 2 ข้อ — ไม่ผ่าน = ไม่บันทึก + เตือน (ข้อมูลในเครื่องไม่ถูกทับ)
 *    1) รายชื่อร้านที่จะเขียน ต้องไม่ใช่ "ก้อนเดียวกัน" กับของสายอื่นในหน่วยความจำ
 *    2) ร้านที่จะเขียน ต้องไม่ได้อยู่ในสายอื่นเกินครึ่ง (ตั้งแต่ 10 ร้านขึ้นไป)
 *       — ย้ายร้านข้ามสายตามปกติ ร้านถูกเอาออกจากสายต้นทางก่อนบันทึกเสมอ จึงไม่โดนข้อนี้
 *  งานที่เขียนข้อมูลทั้งเดือนจากไฟล์ (นำเข้าจากไฟล์ระบบ) ข้ามด่านนี้ — ข้อมูลในหน่วยความจำยังเป็นชุดเก่า
 * ========================================================================== */
const SaveGuard = (() => {
    'use strict';
    const RX = /^(.*)\/routes\/([^/]+)$/;
    const log = [];
    let off = 0, lastToast = 0;

    const note = (rt, why) => { log.push({ at: new Date().toISOString(), rt, why }); if (log.length > 50) log.shift(); };
    const curCol = () => { try { return App.planRoutesCol(App._currentPlanYM).path; } catch (e) { return null; } };
    const idOf = (s) => (s && s.id != null) ? String(s.id) : '';

    /** คืนเหตุผลที่ห้ามบันทึก (null = ผ่าน) */
    const check = (path, data) => {
        if (off > 0 || !data || !Array.isArray(data.stores)) return null;
        const m = RX.exec(String(path || ''));
        if (!m || typeof App === 'undefined' || !App._currentPlanYM) return null;
        if (m[1] + '/routes' !== curCol()) return null;                       // เดือน/ศูนย์อื่น — ไม่ได้อยู่ในหน่วยความจำ
        const rt = m[2];
        const R = (State.db && State.db.routes) || {};
        for (const o of Object.keys(R)) if (o !== rt && R[o] === data.stores) return { rt, other: o, alias: true, why: `ร้านชุดนี้เป็นข้อมูลก้อนเดียวกับสาย ${o}` };
        const ids = new Set(data.stores.map(idOf).filter(Boolean));
        if (ids.size < 10) return null;
        for (const o of Object.keys(R)) {
            if (o === rt || !Array.isArray(R[o]) || R[o] === data.stores) continue;
            let n = 0;
            for (const s of R[o]) if (ids.has(idOf(s))) n++;
            if (n >= 10 && n >= ids.size * 0.5) return { rt, other: o, why: `ร้าน ${n.toLocaleString()} จาก ${ids.size.toLocaleString()} ร้านเป็นร้านของสาย ${o} อยู่แล้ว` };
        }
        return null;
    };

    const block = (ref, bad) => {
        note(bad.rt, bad.why);
        console.error('[SaveGuard] blocked write', ref.path, bad.why);
        const now = Date.now();
        if (now - lastToast > 3000) {
            lastToast = now;
            try { UI.showErrorToast(`⛔ ไม่บันทึกสาย ${bad.rt} — ${bad.why} (กันร้านไปทับสายอื่น) · ข้อมูลเดิมในเครื่องยังอยู่ครบ`); } catch (e) {}
        }
        // V1.0.3: ทุกครั้งที่บล็อก → โหลดสายนี้กลับจากที่บันทึกไว้ (ของจริง) ให้หน่วยความจำตรงกับที่บันทึก
        //   (เดิมทำเฉพาะกรณีสองสายชี้ข้อมูลก้อนเดียวกัน)
        {
            ref.get().then(d => {
                State.db.routes[bad.rt] = (d && d.exists) ? ((d.data() || {}).stores || []) : [];
                try { if (typeof Runs !== 'undefined' && Runs.bump) Runs.bump(); } catch (e) {}
                try { if (typeof MultiRoute !== 'undefined' && MultiRoute.rebuild) MultiRoute.rebuild(); } catch (e) {}
                if (!(typeof MultiRoute !== 'undefined' && MultiRoute.multi) && State.localActiveRoute === bad.rt) State.stores = State.db.routes[bad.rt];
                try { UI.render(); } catch (e) {}
            }).catch(() => {});
        }
        return Promise.reject(new Error('SaveGuard: ' + bad.why));
    };

    const wire = () => {
        if (typeof firebase === 'undefined' || !firebase.firestore) return setTimeout(wire, 300);
        const proto = Object.getPrototypeOf(firebase.firestore().doc('x/y'));
        if (!proto || proto._sgWired) return;
        proto._sgWired = true;
        const set0 = proto.set, upd0 = proto.update;
        // V1.0.3: ตัดช่องที่เป็น undefined ในข้อมูลร้านก่อนเขียน (Firestore ออนไลน์ปฏิเสธทั้งคำสั่ง · ในเครื่องไม่มีผล)
        const hasU = (v) => { if (v === undefined) return true; if (!v || typeof v !== 'object') return false; if (Array.isArray(v)) return v.some(hasU); if (Object.getPrototypeOf(v) !== Object.prototype) return false; for (const k in v) if (hasU(v[k])) return true; return false; };
        const strip = (v) => { if (!v || typeof v !== 'object') return v; if (Array.isArray(v)) return v.map(strip); if (Object.getPrototypeOf(v) !== Object.prototype) return v; const o = {}; for (const k in v) if (v[k] !== undefined) o[k] = strip(v[k]); return o; };
        const clean = (data) => (data && Array.isArray(data.stores) && hasU(data.stores)) ? Object.assign({}, data, { stores: strip(data.stores) }) : data;
        proto.set = function (data, opts) { const bad = check(this.path, data); return bad ? block(this, bad) : set0.call(this, clean(data), opts); };
        proto.update = function (data) { const bad = check(this.path, data); return bad ? block(this, bad) : upd0.call(this, data); };
        const bproto = Object.getPrototypeOf(firebase.firestore().batch());
        if (bproto && !bproto._sgWired) {
            bproto._sgWired = true;
            const bset = bproto.set;
            bproto.set = function (ref, data, opts) {
                const bad = check(ref && ref.path, data);
                if (bad) { block(ref, bad).catch(() => {}); return this; }
                return bset.call(this, ref, data, opts);
            };
        }
        // นำเข้าจากไฟล์ระบบ: เขียนทั้งเดือนจากไฟล์ ข้อมูลในหน่วยความจำยังเป็นชุดเก่า → ข้ามด่าน
        const wrapImport = () => {
            if (typeof SysImport === 'undefined' || !SysImport._writeMonth) return setTimeout(wrapImport, 500);
            if (SysImport._writeMonth._sg) return;
            const w0 = SysImport._writeMonth;
            const w = async function () { off++; try { return await w0.apply(this, arguments); } finally { off--; } };
            w._sg = true;
            SysImport._writeMonth = w;
        };
        wrapImport();
    };
    wire();

    return {
        check, log: () => log.slice(), _note: note,
        /** ทำงานที่ตั้งใจเขียนทั้งสายใหม่ (ไม่ผ่านด่าน) */
        async bypass(fn) { off++; try { return await fn(); } finally { off--; } },
    };
})();
window.SaveGuard = SaveGuard;
;(window.__RPV=window.__RPV||{})['save-guard.js']='1.0.4';

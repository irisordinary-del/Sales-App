// ==========================================
// 🏪 Store Manager
// v2 — 2026-05-21 | fixes: BUG-08 toast, performance cleanup
// ==========================================
const StoreMgr = {
    toggleSelect: (id) => {
        const s = State.stores.find(x => x.id === String(id));
        if (s) {
            s.selected = !s.selected;
            UI.switchTab('tab2');
            UI.render();
            App.saveDB();
        }
    },

    clearSelection: () => {
        State.stores.forEach(s => s.selected = false);
        UI.render();
        App.saveDB();
    },

    changeDay: (id, d) => {
        const s = State.stores.find(x => x.id === String(id));
        if (!s) return;
        if (d === 'remove') {
            s.days = [];
        } else if (s.freq === 2) {
            const mK  = State.db.cycleDays / 2;
            const num = parseInt(d.replace('Day ', ''));
            const pair = num <= mK ? num + mK : num - mK;
            s.days = [d, `Day ${pair}`];
        } else {
            s.days = [d];
        }
        s.seqs = {};
        MapCtrl.closePopups();
        UI.render();
        App.saveDB();
    },

    assignSelected: () => {
        const ds = document.getElementById('assign-day');
        if (!ds) return;
        const d  = ds.value;
        const mK = State.db.cycleDays / 2;
        let changed = false;

        State.stores.forEach(s => {
            if (!s.selected) return;
            if (s.freq === 2) {
                const num  = parseInt(d.replace('Day ', ''));
                const pair = num <= mK ? num + mK : num - mK;
                s.days = [d, `Day ${pair}`];
            } else {
                s.days = [d];
            }
            s.selected = false;
            s.seqs     = {};
            changed    = true;
        });

        if (!changed) {
            UI.showErrorToast('กรุณาเลือกร้านค้าก่อนครับ');
        } else {
            UI.render();
            App.saveDB();
        }
    },

    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2),
};

// ==========================================
// 🚀 App Controller
// ==========================================
const App = {
    get dbRef()   { return cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main'); },
    routesCol:  () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('routes'),

    // ─── Plan Mode helpers ──────────────────────────────────────────────
    _planMode: 'active',

    draftsCol:  () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('drafts'),
    historyCol: () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('history'),

    currentRoutesCol: () => {
        const m = App._planMode;
        if (m === 'active')          return App.routesCol();
        if (m.startsWith('draft:'))  return App.draftsCol().doc(m.replace('draft:', '')).collection('routes');
        if (m.startsWith('history:'))return App.historyCol().doc(m.replace('history:', '')).collection('routes');
        return App.routesCol();
    },

    isReadOnly: () => App._planMode.startsWith('history:'),
    _snapshotUnsub:    null,
    _fileListenersReady: false,

    // ─── Migrate: format เก่า → subcollection ──────────────────────────
    _migrate: async (oldRoutes) => {
        console.log('🔄 Migration: ย้ายข้อมูลไปยัง subcollection...');
        for (const name of Object.keys(oldRoutes)) {
            await App.routesCol().doc(name).set({ stores: oldRoutes[name] || [] });
        }
        await App.dbRef.update({
            routeList: Object.keys(oldRoutes),
            routes:    firebase.firestore.FieldValue.delete(),
        });
        console.log('✅ Migration เสร็จสิ้น');
    },

    // โหลดทุกสายพร้อมกัน (Promise.all)
    _loadAllRoutes: async (routeList) => {
        State.db.routes = {};
        const col = App.currentRoutesCol();
        await Promise.all(routeList.map(name =>
            col.doc(name).get()
                .then(d => {
                    State.db.routes[name] = d.exists ? (d.data().stores || []) : [];
                    App.log(`  ✅ ${name}: ${State.db.routes[name].length} ร้าน`);
                })
                .catch(e => {
                    App.log(`  ⚠️ ${name}: ${e.code || e.message}`);
                    State.db.routes[name] = [];
                })
        ));
    },

    // ─── Process Logger ─────────────────────────────────────────────────
    _logLines: [],
    log: (msg) => {
        const ts   = new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        const line = `[${ts}] ${msg}`;
        App._logLines.push(line);
        console.log('🔵', line);
        const el = document.getElementById('loader-log');
        if (el) { el.innerHTML = App._logLines.slice(-12).join('<br>'); el.scrollTop = el.scrollHeight; }
    },

    // ─── Force Reload ───────────────────────────────────────────────────
    forceReload: async () => {
        App._logLines = [];
        App.log('🔄 Force reload เริ่มต้น...');
        UI.showLoader('กำลัง Force Reload...', 'ดึงข้อมูลจาก Firestore โดยตรง');
        const btn = document.getElementById('force-reload-btn');
        if (btn) btn.style.display = 'none';
        clearTimeout(App._forceReloadTimer);

        try {
            App.log(`📡 ดึง metadata: ${window.CENTER_DOC}`);
            const doc = await App.dbRef.get({ source: 'server' });
            const d   = doc.exists ? doc.data() : {};
            App.log(`✅ metadata OK — routeList: ${(d.routeList || []).length} สาย`);

            State.db.cycleDays = d.cycleDays || 24;
            State.db.routeList = (d.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));

            if (State.db.routeList.length === 0) {
                App.log('⚠️ ไม่มี routeList — สร้างสายเริ่มต้น');
                State.db.routeList      = ['สายที่ 1'];
                State.db.routes['สายที่ 1'] = [];
            } else {
                App.log(`📦 โหลด ${State.db.routeList.length} สาย...`);
                await Promise.all(State.db.routeList.map(async name => {
                    try {
                        const rd     = await App.routesCol().doc(name).get({ source: 'server' });
                        State.db.routes[name] = rd.exists ? (rd.data().stores || []) : [];
                        App.log(`  ✅ ${name}: ${State.db.routes[name].length} ร้าน`);
                    } catch (e) {
                        App.log(`  ⚠️ ${name}: โหลดไม่สำเร็จ (${e.code || e.message})`);
                        State.db.routes[name] = [];
                    }
                }));
            }

            if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                State.localActiveRoute = localStorage.getItem('last_viewed_route') || State.db.routeList[0];
            }
            State.stores = State.db.routes[State.localActiveRoute] || [];
            App.log(`🏪 สายปัจจุบัน: ${State.localActiveRoute} (${State.stores.length} ร้าน)`);

            App.fetchSalesData();
            App.log('✅ Force reload เสร็จสิ้น');

        } catch (err) {
            App.log(`❌ Error: ${err.code || err.message}`);
            UI.hideLoader();
            UI.showErrorToast('❌ Force reload ไม่สำเร็จ: ' + err.message);
            if (btn) btn.style.display = 'block';
        }
    },

    _forceReloadTimer: null,
    _startForceReloadTimer: () => {
        clearTimeout(App._forceReloadTimer);
        App._forceReloadTimer = setTimeout(() => {
            const btn = document.getElementById('force-reload-btn');
            if (btn) btn.style.display = 'block';
            App.log('⏰ โหลดนานผิดปกติ — กด "บังคับโหลดใหม่" ถ้ายังค้างอยู่');
        }, 8000);
    },

    init: async () => {
        if (!MapCtrl.map) MapCtrl.init();
        if (App._snapshotUnsub) return;

        UI.showLoader('กำลังเชื่อมต่อ...', '');
        App.log(`🚀 เริ่มต้น — Center: ${window.CENTER_DOC || '(ไม่ระบุ)'}`);
        App._startForceReloadTimer();

        App.log('🔌 รอ Firestore persistence...');
        if (window.firestoreReady) {
            await Promise.race([
                window.firestoreReady,
                new Promise(resolve => setTimeout(resolve, 3000)),
            ]);
        }
        App.log('✅ Firestore persistence พร้อม');

        App._snapshotUnsub = App.dbRef.onSnapshot(async (doc) => {
            clearTimeout(App._forceReloadTimer);
            const btn = document.getElementById('force-reload-btn');
            if (btn) btn.style.display = 'none';

            const d = doc.exists ? doc.data() : {};
            State.db.cycleDays = d.cycleDays || 24;
            App.log(`📄 onSnapshot — doc.exists: ${doc.exists}`);

            // ตรวจสอบ format เก่า → migrate
            if (d.routes && typeof d.routes === 'object' && Object.keys(d.routes).length > 0) {
                App.log('🔄 พบข้อมูล format เก่า → migrate...');
                State.db.routeList = Object.keys(d.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                await App._migrate(d.routes);
                return;
            }

            const routeList = (d.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            App.log(`📋 routeList: [${routeList.join(', ')}]`);
            State.db.routeList = routeList.length > 0 ? routeList : ['สายที่ 1'];

            App.log(`📦 โหลด ${State.db.routeList.length} สาย...`);
            await App._loadAllRoutes(State.db.routeList);
            App.log(`✅ โหลดสายเสร็จ — รวม ${Object.values(State.db.routes).reduce((s,v) => s + v.length, 0)} ร้าน`);

            if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                State.localActiveRoute = localStorage.getItem('last_viewed_route') || State.db.routeList[0];
            }
            State.stores = State.db.routes[State.localActiveRoute] || [];
            App.log(`🏪 สายปัจจุบัน: ${State.localActiveRoute} (${State.stores.length} ร้าน)`);

            App.sync();
            MapCtrl.fitToStores();
            UI.hideLoader();
            await PlanUI?.refresh?.();

        }, (err) => {
            console.error('Firestore onSnapshot error:', err);
            App.log(`❌ onSnapshot error: ${err.code} — ${err.message}`);
            UI.hideLoader();
            if (err.code === 'permission-denied') {
                UI.showErrorToast('⚠️ ไม่มีสิทธิ์เข้าถึงข้อมูล กรุณาตรวจสอบ center ID');
            } else {
                UI.showErrorToast('⚠️ เชื่อมต่อ Firestore ไม่ได้ — กด "บังคับโหลดใหม่" หรือรอ retry');
                const btn = document.getElementById('force-reload-btn');
                if (btn) btn.style.display = 'block';
                setTimeout(() => App.forceReload(), 5000);
            }
        });

        // ✅ ลงทะเบียน #fileUpload listener ครั้งเดียวเท่านั้น (ป้องกัน BUG-06)
        if (!App._fileListenersReady) {
            App._fileListenersReady = true;
            const fileUpload = document.getElementById('fileUpload');
            if (fileUpload) fileUpload.addEventListener('change', App.handleMapUpload);
        }
    },

    // ✅ saveDB: บันทึกทีละสายใน subcollection — รองรับ active/draft
    saveDB: () => {
        if (App.isReadOnly()) {
            UI.showErrorToast('⚠️ ไม่สามารถแก้ไข History ได้ครับ');
            return;
        }
        State.db.routes[State.localActiveRoute] = State.stores;
        const routeList = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
        const isDraft   = App._planMode.startsWith('draft:');
        const ym        = isDraft ? App._planMode.replace('draft:', '') : null;

        const routePromise = App.currentRoutesCol().doc(State.localActiveRoute).set({ stores: State.stores });
        const metaPromise  = isDraft
            ? App.draftsCol().doc(ym).set(
                { routeList, cycleDays: State.db.cycleDays || 24, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
                { merge: true }
              )
            : App.dbRef.update({ routeList, cycleDays: State.db.cycleDays || 24 });

        const modeLabel = isDraft ? `📝 Draft ${ym}` : '💾';
        Promise.all([routePromise, metaPromise])
            .then(() => UI.showSaveToast(`${modeLabel} บันทึกเรียบร้อย`))
            .catch(err => {
                console.error('saveDB error:', err);
                UI.showErrorToast('❌ บันทึกไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต');
            });
    },

    sync: () => {
        const rs = document.getElementById('routeSelector');
        if (rs) {
            const sortedRoutes = Object.keys(State.db.routes)
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            const newHTML = sortedRoutes.map(r => `<option value="${r}">${r}</option>`).join('');
            if (rs.innerHTML !== newHTML) rs.innerHTML = newHTML;
            rs.value = State.localActiveRoute;
        }
        MapCtrl.clearAll();
        UI.initDaySelector();
        UI.switchTab('tab1');
        UI.render();
    },

    switchRoute: (name) => {
        if (State.localActiveRoute === name) return;
        State.localActiveRoute = name;
        if (App._planMode === 'active') localStorage.setItem('last_viewed_route', name);
        if (State.db.routes[name] === undefined) {
            UI.showLoader('กำลังโหลดสาย ' + name + '...');
            App.currentRoutesCol().doc(name).get()
                .then(d => {
                    State.db.routes[name] = d.exists ? (d.data().stores || []) : [];
                    State.stores = State.db.routes[name];
                    App.sync(); MapCtrl.fitToStores(); UI.hideLoader();
                })
                .catch(() => { State.stores = []; App.sync(); UI.hideLoader(); });
        } else {
            State.stores = State.db.routes[name] || [];
            App.sync(); MapCtrl.fitToStores();
        }
    },

    addRoute: () => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;max-width:340px;width:90%;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.innerHTML = '<p style="font-size:14px;font-weight:700;color:#111827;margin-bottom:12px;">ชื่อสายใหม่</p>'
            + '<input id="_add-route-inp" type="text" placeholder="เช่น 402V01" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;font-family:inherit;outline:none;margin-bottom:16px;">'
            + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
            + '<button id="_add-route-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-size:13px;font-weight:600;">ยกเลิก</button>'
            + '<button id="_add-route-ok" style="padding:8px 18px;border-radius:8px;border:none;background:#4f46e5;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">เพิ่ม</button>'
            + '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const inp   = box.querySelector('#_add-route-inp');
        inp.focus();
        const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
        const confirm = () => {
            const n = inp.value.trim();
            close();
            if (!n) return;
            State.db.routes[n] = [];
            State.localActiveRoute = n;
            State.stores = [];
            App.sync();
            App.saveDB();
        };
        box.querySelector('#_add-route-cancel').onclick = close;
        box.querySelector('#_add-route-ok').onclick     = confirm;
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); });
        overlay.onclick = e => { if (e.target === overlay) close(); };
    },

    renameRoute: () => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;max-width:340px;width:90%;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.innerHTML = '<p style="font-size:14px;font-weight:700;color:#111827;margin-bottom:12px;">เปลี่ยนชื่อสาย</p>'
            + `<input id="_ren-route-inp" type="text" value="${State.localActiveRoute}" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;font-family:inherit;outline:none;margin-bottom:16px;">`
            + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
            + '<button id="_ren-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#6b7280;cursor:pointer;font-size:13px;font-weight:600;">ยกเลิก</button>'
            + '<button id="_ren-ok" style="padding:8px 18px;border-radius:8px;border:none;background:#4f46e5;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">บันทึก</button>'
            + '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const inp   = box.querySelector('#_ren-route-inp');
        inp.focus(); inp.select();
        const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
        const confirm = () => {
            const newName = inp.value.trim();
            close();
            if (!newName || newName === State.localActiveRoute) return;
            const oldName = State.localActiveRoute;
            State.db.routes[newName] = State.db.routes[oldName];
            delete State.db.routes[oldName];
            State.localActiveRoute = newName;
            App.sync();
            const routeList = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            Promise.all([
                App.currentRoutesCol().doc(oldName).delete(),
                App.currentRoutesCol().doc(newName).set({ stores: State.db.routes[newName] || [] }),
                App.dbRef.update({ routeList }),
            ])
            .then(() => UI.showSaveToast('💾 เปลี่ยนชื่อสายเรียบร้อย'))
            .catch(err => UI.showErrorToast('❌ เปลี่ยนชื่อไม่สำเร็จ: ' + err.message));
        };
        box.querySelector('#_ren-cancel').onclick = close;
        box.querySelector('#_ren-ok').onclick     = confirm;
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); });
        overlay.onclick = e => { if (e.target === overlay) close(); };
    },

    deleteRoute: () => {
        if (Object.keys(State.db.routes).length <= 1)
            return UI.showErrorToast('ห้ามลบสายสุดท้ายครับ');
        UI.showConfirm('ยืนยันลบสาย "' + State.localActiveRoute + '"?', () => {
            const deletedName = State.localActiveRoute;
            delete State.db.routes[deletedName];
            const sortedKeys = Object.keys(State.db.routes)
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            State.localActiveRoute = sortedKeys[0];
            State.stores = State.db.routes[State.localActiveRoute] || [];
            App.sync(); MapCtrl.fitToStores();
            Promise.all([
                App.routesCol().doc(deletedName).delete(),
                App.dbRef.update({ routeList: sortedKeys }),
            ])
            .then(() => UI.showSaveToast('🗑️ ลบสายเรียบร้อย'))
            .catch(err => UI.showErrorToast('❌ ลบไม่สำเร็จ: ' + err.message));
        });
    },

    // ─── Plan Management ────────────────────────────────────────────────
    switchPlanMode: async (mode) => {
        App._planMode      = mode;
        State.db.routes    = {};
        const isActive     = mode === 'active';
        const isDraft      = mode.startsWith('draft:');
        const isHistory    = mode.startsWith('history:');
        const ym           = (isDraft || isHistory) ? mode.split(':')[1] : null;

        UI.showLoader('กำลังโหลด Plan...', isActive ? 'โหลด Plan ปัจจุบัน' : `โหลด ${isDraft ? 'Draft' : 'History'} ${ym || ''}`);

        try {
            let routeList, cycleDays;
            if (isActive) {
                const d    = await App.dbRef.get();
                const data = d.exists ? d.data() : {};
                routeList  = (data.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                cycleDays  = data.cycleDays || 24;
            } else if (isDraft) {
                const d    = await App.draftsCol().doc(ym).get();
                const data = d.exists ? d.data() : {};
                routeList  = (data.routeList || State.db.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                cycleDays  = data.cycleDays  || State.db.cycleDays || 24;
            } else {
                const d    = await App.historyCol().doc(ym).get();
                const data = d.exists ? d.data() : {};
                routeList  = (data.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                cycleDays  = data.cycleDays || 24;
            }

            State.db.routeList = routeList.length ? routeList : (State.db.routeList || []);
            State.db.cycleDays = cycleDays;

            await App._loadAllRoutes(State.db.routeList);
            State.localActiveRoute = State.db.routeList[0] || '';
            State.stores = State.db.routes[State.localActiveRoute] || [];

            PlanUI.updateBadge();
            App.sync(); MapCtrl.fitToStores(); UI.hideLoader();

            const label = isActive ? 'Plan ปัจจุบัน' : (isDraft ? `Draft ${ym}` : `History ${ym}`);
            UI.showSaveToast(`✅ โหลด ${label} เสร็จ`);
        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ โหลด Plan ไม่สำเร็จ: ' + err.message);
            console.error('switchPlanMode error:', err);
        }
    },

    createDraft: async (ym) => {
        if (!ym) return;
        UI.showLoader('กำลังสร้าง Draft...', `Copy plan → Draft ${ym}`);
        try {
            const existing = await App.draftsCol().doc(ym).get();
            if (existing.exists) {
                UI.hideLoader();
                return UI.showErrorToast(`⚠️ Draft ${ym} มีอยู่แล้วครับ`);
            }
            await App.draftsCol().doc(ym).set({
                routeList:  State.db.routeList,
                cycleDays:  State.db.cycleDays || 24,
                createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
                sourceMode: 'active',
            });
            const draftRoutesCol = App.draftsCol().doc(ym).collection('routes');
            await Promise.all(State.db.routeList.map(name =>
                draftRoutesCol.doc(name).set({ stores: State.db.routes[name] || [] })
            ));
            const curDoc   = await App.dbRef.get();
            const curData  = curDoc.exists ? curDoc.data() : {};
            const draftList = [...new Set([...(curData.draftList || []), ym])].sort();
            await App.dbRef.update({ draftList });

            UI.hideLoader();
            UI.showSaveToast(`✅ สร้าง Draft ${ym} เรียบร้อย`);
            if (typeof PlanUI !== 'undefined') PlanUI.refresh();
        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ สร้าง Draft ไม่สำเร็จ: ' + err.message);
            console.error('createDraft error:', err);
        }
    },

    activateDraft: async (ym) => {
        UI.showLoader('กำลัง Activate...', `Draft ${ym} → Active`);
        try {
            // 1. Snapshot active → history
            const activeDoc  = await App.dbRef.get();
            const activeData = activeDoc.exists ? activeDoc.data() : {};
            const histYm     = PlanUI.currentYM();
            await App.historyCol().doc(histYm).set({
                routeList:  activeData.routeList || [],
                cycleDays:  activeData.cycleDays || 24,
                archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
                label:      histYm,
            });
            const histRoutesCol = App.historyCol().doc(histYm).collection('routes');
            await Promise.all((activeData.routeList || []).map(async name => {
                const rd = await App.routesCol().doc(name).get();
                await histRoutesCol.doc(name).set({ stores: rd.exists ? (rd.data().stores || []) : [] });
            }));

            // 2. Copy draft → active
            const draftDoc    = await App.draftsCol().doc(ym).get();
            const draftData   = draftDoc.exists ? draftDoc.data() : {};
            const newRouteList = (draftData.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            const newCycleDays = draftData.cycleDays || 24;
            const draftRoutes  = await App.draftsCol().doc(ym).collection('routes').get();
            const activeRoutesCol = App.routesCol();
            await Promise.all(draftRoutes.docs.map(d => activeRoutesCol.doc(d.id).set(d.data())));

            // 3. Update metadata
            const curDoc = await App.dbRef.get();
            const curData = curDoc.exists ? curDoc.data() : {};
            await App.dbRef.update({
                routeList:     newRouteList,
                cycleDays:     newCycleDays,
                historyList:   [...new Set([...(curData.historyList || []), histYm])].sort().reverse(),
                draftList:     (curData.draftList || []).filter(d => d !== ym),
                lastActivated: ym,
                updatedAt:     firebase.firestore.FieldValue.serverTimestamp(),
            });

            UI.hideLoader();
            UI.showSaveToast(`✅ Activate ${ym} เรียบร้อย! Sales จะเห็น Plan ใหม่ทันที`);
            if (typeof PlanUI !== 'undefined') PlanUI.refresh();
        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ Activate ไม่สำเร็จ: ' + err.message);
            console.error('activateDraft error:', err);
        }
    },

    // helper: map cycle day → calendar day (ข้ามวันหยุด)
    _mapCycleDayToCalDay: (cycleDay, cfg) => {
        if (!cfg || cfg.mode !== 'cycle') return cycleDay ? `Day ${cycleDay}` : '';
        const startDate   = parseInt(cfg.startDay  || 1);
        const startDayNum = parseInt(cfg.startDayNum || 1);
        const holidays    = cfg.holidays || [];
        const cycleDays   = cfg.cycleDays || 24;
        const targetNum   = parseInt(cycleDay);
        if (isNaN(targetNum) || targetNum < 1 || targetNum > cycleDays) return '';
        let workDay = startDayNum;
        for (let d = startDate; d <= 31; d++) {
            if (holidays.includes(d)) continue;
            if (workDay === targetNum) return `Day ${d}`;
            workDay++;
        }
        return '';
    },

    handleMapUpload: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data      = new Uint8Array(ev.target.result);
                const workbook  = XLSX.read(data, { type: 'array' });
                const json      = XLSX.utils.sheet_to_json(
                    workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' }
                );
                if (json.length < 2) return UI.showErrorToast('ไฟล์ว่างเปล่าหรือไม่มีข้อมูล');

                const headers = json[0];
                let idCol=-1, nameCol=-1, latCol=-1, lngCol=-1, freqCol=-1,
                    dayCol=-1, seqCol=-1, salesCodeCol=-1, shopTypeCol=-1,
                    subDistrictCol=-1, districtCol=-1, provinceCol=-1,
                    marketNameCol=-1, cyCol=-1;

                for (let i = 0; i < headers.length; i++) {
                    const h = String(headers[i]).toLowerCase();
                    if      (h.includes('รหัส') && !h.includes('เซลล์'))             idCol = i;
                    else if ((h.includes('ชื่อ') && !h.includes('ตลาด')) || h.includes('name')) nameCol = i;
                    else if (h.includes('lat') || h.includes('ละติจูด'))             latCol = i;
                    else if (h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด')) lngCol = i;
                    else if (h.includes('freq') || h.includes('ความถี่'))            freqCol = i;
                    else if (h.includes('day') || h.includes('สายวิ่ง'))             dayCol = i;
                    else if (h.includes('คิว') || h.includes('seq'))                 seqCol = i;
                    else if (h.includes('salescode') || h.includes('รหัสเซลล์') || h === 'sales') salesCodeCol = i;
                    else if (h.includes('ประเภท') || h.includes('type'))             shopTypeCol = i;
                    else if (h.includes('sold to city') || h.includes('ตำบล'))       subDistrictCol = i;
                    else if (h.includes('sold to state') || h.includes('อำเภอ'))     districtCol = i;
                    else if (h.includes('address 5') || h.includes('จังหวัด'))       provinceCol = i;
                    else if (h.includes('ตลาด') || h.includes('market'))             marketNameCol = i;
                    else if (h === 'cy' || h.startsWith('cy'))                       cyCol = i;
                }

                if (latCol === -1 || lngCol === -1 || idCol === -1)
                    return UI.showErrorToast('ไม่พบคอลัมน์ รหัส / Lat / Lng ในไฟล์ครับ');

                // โหลด calendarConfig แล้ว process
                const _processUpload = (calCfg) => {
                    const storeMap = {};
                    for (let i = 1; i < json.length; i++) {
                        const row = json[i];
                        if (!row || row.length === 0) continue;
                        const idStr = row[idCol] ? String(row[idCol]).trim() : `S_${i}`;
                        if (!idStr) continue;
                        const lat = parseFloat(String(row[latCol] || '').replace(/[^0-9.-]/g, ''));
                        const lng = parseFloat(String(row[lngCol] || '').replace(/[^0-9.-]/g, ''));
                        if (isNaN(lat) || isNaN(lng)) continue;

                        const freq      = (freqCol !== -1 && String(row[freqCol]||'').trim().toUpperCase().includes('2')) ? 2 : 1;
                        const rawDay    = (dayCol !== -1 && row[dayCol]) ? String(row[dayCol]).trim() : '';
                        const dayNum    = rawDay ? parseInt(rawDay.replace(/[^0-9]/g, '')) : NaN;
                        const assignedDay = !isNaN(dayNum) ? App._mapCycleDayToCalDay(dayNum, calCfg) : '';
                        const assignedSeq = (seqCol !== -1 && row[seqCol]) ? parseInt(String(row[seqCol]).replace(/[^0-9]/g,'')) : NaN;
                        const isValidDay  = !!assignedDay;

                        if (storeMap[idStr]) {
                            if (isValidDay && !storeMap[idStr].days.includes(assignedDay)) {
                                storeMap[idStr].days.push(assignedDay);
                                if (!isNaN(assignedSeq)) storeMap[idStr].seqs[assignedDay] = assignedSeq;
                            }
                            storeMap[idStr].freq = 2;
                        } else {
                            const newStore = {
                                id: idStr, code: idStr,
                                name:        row[nameCol] ? String(row[nameCol]).trim() : `Store_${idStr}`,
                                lat, lng, freq, days: [], seqs: {}, selected: false,
                                salesCode:   salesCodeCol !== -1   ? String(row[salesCodeCol]||'').trim()   : '',
                                shopType:    shopTypeCol !== -1    ? String(row[shopTypeCol]||'').trim()    : '',
                                subDistrict: subDistrictCol !== -1 ? String(row[subDistrictCol]||'').trim() : '',
                                district:    districtCol !== -1    ? String(row[districtCol]||'').trim()    : '',
                                province:    provinceCol !== -1    ? String(row[provinceCol]||'').trim()    : '',
                                marketName:  marketNameCol !== -1  ? String(row[marketNameCol]||'').trim()  : '',
                                cy:          cyCol !== -1          ? String(row[cyCol]||'').trim()          : '',
                                dayOriginal: dayCol !== -1         ? String(row[dayCol]||'').trim()         : '',
                            };
                            if (isValidDay) {
                                newStore.days.push(assignedDay);
                                if (!isNaN(assignedSeq)) newStore.seqs[assignedDay] = assignedSeq;
                            }
                            storeMap[idStr] = newStore;
                        }
                    }

                    const finalArray = Object.values(storeMap);
                    if (finalArray.length === 0)
                        return UI.showErrorToast('ไม่พบพิกัด (Lat, Lng) ในไฟล์ครับ');

                    MapCtrl.clearAll();
                    State.stores = finalArray;
                    App.sync();
                    App.saveDB();
                    MapCtrl.fitToStores();
                };

                try {
                    const planRef = App._planMode.startsWith('draft:')
                        ? App.draftsCol().doc(App._planMode.replace('draft:',''))
                        : App.dbRef;
                    planRef.get()
                        .then(snap => _processUpload(snap.exists ? (snap.data().calendarConfig || null) : null))
                        .catch(() => _processUpload(null));
                } catch(err2) {
                    _processUpload(null);
                }

            } catch (err) {
                UI.showErrorToast('ขัดข้อง: ' + err.message);
            }
            const inp = document.getElementById('fileUpload');
            if (inp) inp.value = '';
        };
        reader.readAsArrayBuffer(file);
    },

    fetchSalesData: async () => {
        try {
            const snap = await cloudDB.collection('v1_sales_chunks').get();
            State.sales = {};
            snap.forEach(doc => Object.assign(State.sales, doc.data()));
        } catch(e) {
            console.warn('fetchSalesData error:', e);
            State.sales = {};
        }
        App.sync();
        UI.hideLoader();
    },

    // ✅ FIX BUG-08: ลด duplicate toast call
    clearAllAssignments: () => {
        try {
            if (!confirm('🗑️ ยืนยันการเคลียร์การจัดสายทั้งหมด?\n(ร้านทั้งหมดจะกลับไปอยู่ในสถานะ "รอจัดสาย")'))
                return;
            if (!State.stores?.length)
                return UI.showErrorToast('⚠️ ไม่มีข้อมูลร้านค้า');

            State.stores.forEach(s => { s.days = []; s.seqs = {}; s.selected = false; });

            MapCtrl?.clearRoad?.(true);
            MapCtrl?.clearAll?.();
            UI?.render?.();
            App?.saveDB?.();

            // ✅ เรียกครั้งเดียว ไม่มี duplicate
            UI.showSaveToast('✅ เคลียร์การจัดสายเสร็จ');
        } catch(err) {
            console.error('❌ Clear error:', err);
            UI.showErrorToast('❌ เกิดข้อผิดพลาด: ' + err.message);
        }
    },

    logout: () => {
        if (typeof Auth !== 'undefined') Auth.logout();
        else window.location.replace('login.html');
    },
};

// ==========================================
// 🔄 Store Transfer
// ==========================================
const StoreTrans = {
    _selectedIds: new Set(),

    open: () => {
        StoreTrans._selectedIds.clear();
        StoreTrans._renderRouteList();
        StoreTrans._renderStoreList();
        document.getElementById('transfer-modal').classList.remove('hidden');
    },

    close: () => {
        document.getElementById('transfer-modal').classList.add('hidden');
        StoreTrans._selectedIds.clear();
    },

    _renderRouteList: () => {
        const routes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
        const srcEl  = document.getElementById('transfer-src-route');
        const dstEl  = document.getElementById('transfer-dst-route');
        if (srcEl) {
            srcEl.innerHTML = routes.map(r =>
                `<option value="${r}" ${r === State.localActiveRoute ? 'selected' : ''}>${r}</option>`
            ).join('');
        }
        if (dstEl) {
            dstEl.innerHTML = routes.map(r => `<option value="${r}">${r}</option>`).join('');
            const other = routes.find(r => r !== State.localActiveRoute);
            if (other) dstEl.value = other;
        }
        if (srcEl) srcEl.addEventListener('change', () => StoreTrans._renderStoreList());
    },

    _renderStoreList: () => {
        const srcEl   = document.getElementById('transfer-src-route');
        const srcRoute = srcEl ? srcEl.value : State.localActiveRoute;
        const stores   = State.db.routes[srcRoute] || [];
        StoreTrans._selectedIds.clear();
        const listEl = document.getElementById('transfer-store-list');
        if (!listEl) return;
        if (!stores.length) {
            listEl.innerHTML = '<p class="text-center text-xs text-gray-400 py-6">ไม่มีร้านค้าในสายนี้</p>';
            return;
        }
        listEl.innerHTML = stores.map(s => {
            const dayTxt = s.days?.length ? s.days.join(' & ') : 'รอจัดสาย';
            const c      = s.days?.length && DAY_COLORS[s.days[0]] ? DAY_COLORS[s.days[0]].hex : '#9ca3af';
            return `
            <label class="flex items-center gap-2.5 p-2.5 bg-white border border-gray-100 rounded-xl cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition">
                <input type="checkbox" value="${s.id}" onchange="StoreTrans._toggle(this)" class="w-4 h-4 text-indigo-600 rounded flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-gray-800 truncate">${s.name}${s.freq===2?' <span style="background:#ef4444;color:#fff;padding:1px 5px;border-radius:8px;font-size:9px;font-weight:700;">F2</span>':''}</p>
                    <p class="text-[10px] text-gray-400 font-mono">${s.id}</p>
                </div>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full text-white flex-shrink-0" style="background:${c};">${dayTxt}</span>
            </label>`;
        }).join('');
    },

    _toggle: (cb) => {
        if (cb.checked) StoreTrans._selectedIds.add(cb.value);
        else            StoreTrans._selectedIds.delete(cb.value);
        const countEl = document.getElementById('transfer-count');
        if (countEl) countEl.textContent = StoreTrans._selectedIds.size;
    },

    selectAll: () => {
        document.querySelectorAll('#transfer-store-list input[type=checkbox]').forEach(cb => {
            cb.checked = true;
            StoreTrans._selectedIds.add(cb.value);
        });
        const countEl = document.getElementById('transfer-count');
        if (countEl) countEl.textContent = StoreTrans._selectedIds.size;
    },

    confirm: async () => {
        if (StoreTrans._selectedIds.size === 0)
            return UI.showErrorToast('กรุณาเลือกร้านค้าก่อนครับ');
        const srcEl  = document.getElementById('transfer-src-route');
        const dstEl  = document.getElementById('transfer-dst-route');
        const srcRoute = srcEl ? srcEl.value : State.localActiveRoute;
        const dstRoute = dstEl ? dstEl.value : '';
        if (!dstRoute || dstRoute === srcRoute)
            return UI.showErrorToast('กรุณาเลือกสายปลายทางที่ต่างกันครับ');

        const ids      = Array.from(StoreTrans._selectedIds);
        const srcStores = State.db.routes[srcRoute] || [];
        const dstStores = State.db.routes[dstRoute] || [];
        const moving    = srcStores.filter(s => ids.includes(s.id));

        State.db.routes[srcRoute] = srcStores.filter(s => !ids.includes(s.id));
        State.db.routes[dstRoute] = [...dstStores, ...moving];

        if (State.localActiveRoute === srcRoute) State.stores = State.db.routes[srcRoute];
        else if (State.localActiveRoute === dstRoute) State.stores = State.db.routes[dstRoute];

        try {
            await Promise.all([
                App.currentRoutesCol().doc(srcRoute).set({ stores: State.db.routes[srcRoute] }),
                App.currentRoutesCol().doc(dstRoute).set({ stores: State.db.routes[dstRoute] }),
            ]);
            StoreTrans.close();
            App.sync();
            UI.showSaveToast(`✅ ย้าย ${moving.length} ร้าน → ${dstRoute}`);
        } catch (err) {
            UI.showErrorToast('❌ ย้ายร้านไม่สำเร็จ: ' + err.message);
        }
    },
};

console.log('✅ admin-data v2 loaded');

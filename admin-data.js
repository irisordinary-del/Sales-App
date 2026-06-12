// ==========================================
// 🏪 StoreMgr
// ==========================================
const StoreMgr = {
    toggleSelect: (id) => {
        const s = State.stores.find(x => x.id === String(id));
        if (s) { s.selected = !s.selected; UI.switchTab('tab2'); UI.render(); App.saveDB(); }
    },
    clearSelection: () => { State.stores.forEach(s => s.selected = false); UI.render(); App.saveDB(); },

    // ✅ ดึงร้าน inactive กลับมา active
    reactivateStore: (id) => {
        const s = State.stores.find(x => x.id === String(id));
        if (!s) return;
        s.inactive = false;
        UI.render();
        App.saveDB();
        UI.showSaveToast(`↩️ ดึง "${s.name}" กลับมาแล้ว`);
    },

    // ✅ ลบร้านออกถาวร — ยืนยันก่อน
    permanentDelete: (id) => {
        const s = State.stores.find(x => x.id === String(id));
        if (!s) return;
        UI.showConfirm(
            `ลบ "${s.name}" ถาวรใช่ไหมครับ?\n(ไม่สามารถกู้คืนได้)`,
            () => {
                State.stores = State.stores.filter(x => x.id !== String(id));
                State.db.routes[State.localActiveRoute] = State.stores;
                UI.render();
                App.saveDB();
                UI.showSaveToast(`🗑️ ลบ "${s.name}" ออกแล้ว`);
            }
        );
    },

    changeDay: (id, d) => {
        const s = State.stores.find(x => x.id === String(id));
        if (!s) return;
        if (d === 'remove') { s.days = []; }
        else if (s.freq === 2) {
            const mK = State.db.cycleDays / 2;
            const num = parseInt(d.replace('Day ', ''));
            const pair = num <= mK ? num + mK : num - mK;
            s.days = [d, `Day ${pair}`];
        } else { s.days = [d]; }
        s.seqs = {};
        MapCtrl.closePopups();
        UI.render(); App.saveDB();
    },
    assignSelected: () => {
        const ds = document.getElementById('assign-day');
        if (!ds) return;
        const d = ds.value;
        const mK = State.db.cycleDays / 2;
        let changed = false;
        State.stores.forEach(s => {
            if (!s.selected) return;
            if (s.freq === 2) {
                const num = parseInt(d.replace('Day ', ''));
                const pair = num <= mK ? num + mK : num - mK;
                s.days = [d, `Day ${pair}`];
            } else { s.days = [d]; }
            s.selected = false; s.seqs = {}; changed = true;
        });
        if (!changed) UI.showErrorToast('กรุณาเลือกร้านค้าก่อนครับ');
        else { UI.render(); App.saveDB(); }
    },
    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2),
};

// ==========================================
// 🚀 App Controller — ระบบ plans/{YYYY_MM}
// ==========================================
const App = {
    // ─── Firestore refs ──────────────────────────────────────────────────
    get dbRef()   { return cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main'); },
    plansCol:     () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('plans'),
    planRef:      (ym) => App.plansCol().doc(ym),
    planRoutesCol:(ym) => App.plansCol().doc(ym).collection('routes'),

    // ─── State ───────────────────────────────────────────────────────────
    _currentPlanYM:  '',   // YYYY_MM ที่กำลังดูอยู่
    _snapshotUnsub:  null,
    _fileListenersReady: false,

    // ─── Helpers ─────────────────────────────────────────────────────────
    currentYM: () => {
        const d = new Date();
        return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
    },

    ymToLabel: (ym) => {
        if (!ym) return '';
        const [y, m] = ym.split('_');
        return new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
    },

    // ─── Load all routes ─────────────────────────────────────────────────
    _loadAllRoutes: async (ym, routeList) => {
        State.db.routes = {};
        if (!routeList.length) return;

        const col = App.planRoutesCol(ym);

        // ── Step 1: โหลด active route ก่อน → แสดงผลทันที ────────────────
        const activeRoute = localStorage.getItem(`last_route_${ym}`) || routeList[0];
        try {
            const d = await col.doc(activeRoute).get();
            State.db.routes[activeRoute] = d.exists ? (d.data().stores || []) : [];
            App.log(`  ✅ ${activeRoute}: ${State.db.routes[activeRoute].length} ร้าน (active)`);
            // แสดงผลทันทีหลังได้ active route
            State.localActiveRoute = activeRoute;
            State.stores = State.db.routes[activeRoute];
            App.sync();
        } catch(e) {
            App.log(`  ⚠️ ${activeRoute}: ${e.code || e.message}`);
            State.db.routes[activeRoute] = [];
        }

        // ── Step 2: background load ที่เหลือ ทีละ 4 สาย ─────────────────
        const remaining = routeList.filter(n => n !== activeRoute);
        const BATCH = 4;
        for (let i = 0; i < remaining.length; i += BATCH) {
            const batch = remaining.slice(i, i + BATCH);
            await Promise.all(batch.map(name =>
                col.doc(name).get()
                    .then(d => {
                        State.db.routes[name] = d.exists ? (d.data().stores || []) : [];
                        App.log(`  ✅ ${name}: ${State.db.routes[name].length} ร้าน`);
                        UI.renderAllRoutes(); // อัปเดต route list ระหว่าง load
                    })
                    .catch(e => { App.log(`  ⚠️ ${name}: ${e.code || e.message}`); State.db.routes[name] = []; })
            ));
        }
    },

    // ─── Logger ──────────────────────────────────────────────────────────
    _logLines: [],
    log: (msg) => {
        const ts = new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        App._logLines.push(`[${ts}] ${msg}`);
        console.log('🔵', msg);
        const el = document.getElementById('loader-log');
        if (el) { el.innerHTML = App._logLines.slice(-12).join('<br>'); el.scrollTop = el.scrollHeight; }
    },

    // ─── Force Reload ────────────────────────────────────────────────────
    forceReload: async () => {
        App._logLines = [];
        App.log('🔄 Force reload...');
        UI.showLoader('กำลัง Force Reload...', '');
        const btn = document.getElementById('force-reload-btn');
        if (btn) btn.style.display = 'none';
        clearTimeout(App._forceReloadTimer);
        try {
            await App._loadPlan(App._currentPlanYM, true);
        } catch(err) {
            App.log(`❌ ${err.message}`);
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
        }, 8000);
    },

    // ─── Load plan ───────────────────────────────────────────────────────
    _loadPlan: async (ym, forceServer = false) => {
        if (!ym) return;
        UI.showLoader(`โหลด Plan ${App.ymToLabel(ym)}...`, '');
        App.log(`📦 โหลด plan ${ym}...`);

        try {
            const snap    = forceServer ? await App.planRef(ym).get({ source: 'server' }) : await App.planRef(ym).get();
            const data    = snap.exists ? snap.data() : {};
            const routeList = (data.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            State.db.cycleDays     = data.cycleDays     || 24;
            State.db.calendarConfig = data.calendarConfig || null;

            // ✅ FIX: fallback ถ้า plan ไม่มี หรือ routeList ว่าง หรือมีแค่ route default ปลอม
            const hasFakeRoute = routeList.length === 1 && routeList[0] === 'สายที่ 1';
            if (!snap.exists || routeList.length === 0 || hasFakeRoute) {
                const fallbackYM = (State.db.planList || []).find(p => p !== ym);
                if (fallbackYM) {
                    App.log(`⚠️ plan ${ym} ไม่มีข้อมูลจริง → fallback ไป ${fallbackYM}`);
                    UI.hideLoader();
                    return App._loadPlan(fallbackYM);
                }
                // ไม่มี fallback → set routeList ว่าง
                App.log(`⚠️ plan ${ym} ยังไม่มี — รอ Admin สร้าง`);
                State.db.routeList = [];
                await App.planRef(ym).set({
                    routeList:  [],
                    cycleDays:  State.db.cycleDays,
                    updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                State.db.routeList = routeList;
            }

            await App._loadAllRoutes(ym, State.db.routeList);
            App.log(`✅ โหลด plan ${ym} เสร็จ — ${State.db.routeList.length} สาย`);

            if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                State.localActiveRoute = localStorage.getItem(`last_route_${ym}`) || State.db.routeList[0];
            }
            State.stores = State.db.routes[State.localActiveRoute] || [];

            App._currentPlanYM = ym;
            App.fetchSalesData();
            App.sync();
            PlanUI.updateBadge();
            MapCtrl.fitToStores();

        } catch(err) {
            App.log(`❌ โหลด plan ${ym} ล้มเหลว: ${err.message}`);
            UI.hideLoader();
            UI.showErrorToast('❌ โหลด plan ไม่สำเร็จ: ' + err.message);
        }
    },

    // ─── Init ────────────────────────────────────────────────────────────
    init: async () => {
        if (!MapCtrl.map) MapCtrl.init();
        if (App._snapshotUnsub) return;

        UI.showLoader('กำลังเชื่อมต่อ...', '');
        App.log(`🚀 เริ่มต้น — Center: ${window.CENTER_DOC || '(ไม่ระบุ)'}`);
        App._startForceReloadTimer();

        if (window.firestoreReady) {
            await Promise.race([window.firestoreReady, new Promise(r => setTimeout(r, 3000))]);
        }

        // ─── โหลด planList + currentPlanYM จาก centerDoc ────────────
        App._snapshotUnsub = App.dbRef.onSnapshot(async (doc) => {
            clearTimeout(App._forceReloadTimer);
            const btn = document.getElementById('force-reload-btn');
            if (btn) btn.style.display = 'none';

            const d = doc.exists ? doc.data() : {};
            const planList      = (d.planList || []).sort().reverse();
            const currentPlanYM = d.currentPlanYM || App.currentYM();

            State.db.planList      = planList;
            State.db.currentPlanYM = currentPlanYM;

            App.log(`📋 planList: [${planList.join(', ')}], current: ${currentPlanYM}`);

            // ถ้ายังไม่ได้เลือก plan → ใช้ currentPlanYM จาก centerDoc
            if (!App._currentPlanYM) {
                App._currentPlanYM = currentPlanYM;
            }

            await App._loadPlan(App._currentPlanYM);
            PlanUI.refresh();

        }, (err) => {
            console.error('onSnapshot error:', err);
            UI.hideLoader();
            if (err.code === 'permission-denied') {
                UI.showErrorToast('⚠️ ไม่มีสิทธิ์เข้าถึงข้อมูล');
            } else {
                UI.showErrorToast('⚠️ เชื่อมต่อ Firestore ไม่ได้');
                const btn = document.getElementById('force-reload-btn');
                if (btn) btn.style.display = 'block';
                setTimeout(() => App.forceReload(), 5000);
            }
        });

        if (!App._fileListenersReady) {
            App._fileListenersReady = true;
            const fileUpload = document.getElementById('fileUpload');
            if (fileUpload) fileUpload.addEventListener('change', App.handleMapUpload);
        }
    },

    // ─── saveDB ──────────────────────────────────────────────────────────
    saveDB: () => {
        const ym = App._currentPlanYM;
        if (!ym) return;
        State.db.routes[State.localActiveRoute] = State.stores;
        const routeList = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));

        Promise.all([
            App.planRoutesCol(ym).doc(State.localActiveRoute).set({ stores: State.stores }),
            App.planRef(ym).set({ routeList, cycleDays: State.db.cycleDays || 24, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
        ])
        .then(() => UI.showSaveToast(`💾 บันทึกเรียบร้อย`))
        .catch(err => { console.error('saveDB:', err); UI.showErrorToast('❌ บันทึกไม่สำเร็จ'); });
    },

    // ─── sync UI ─────────────────────────────────────────────────────────
    sync: () => {
        const rs = document.getElementById('routeSelector');
        if (rs) {
            const sorted = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            const newHTML = sorted.map(r => `<option value="${r}">${r}</option>`).join('');
            if (rs.innerHTML !== newHTML) rs.innerHTML = newHTML;
            rs.value = State.localActiveRoute;
        }
        MapCtrl.clearAll();
        UI.initDaySelector();
        UI.switchTab('tab1');
        UI.render();
    },

    // ─── Switch plan ─────────────────────────────────────────────────────
    switchPlan: async (ym) => {
        if (App._currentPlanYM === ym) return;
        State.localActiveRoute = localStorage.getItem(`last_route_${ym}`) || '';
        await App._loadPlan(ym);
        // บันทึก currentPlanYM ลง centerDoc ให้ Sales เห็นตาม
        await App.dbRef.set({ currentPlanYM: ym }, { merge: true });
    },

    // ─── Create new plan ─────────────────────────────────────────────────
    createPlan: async (ym) => {
        if (!ym) return;
        UI.showLoader(`กำลังสร้าง Plan ${App.ymToLabel(ym)}...`, '');
        try {
            const existing = await App.planRef(ym).get();
            if (existing.exists) {
                UI.hideLoader();
                UI.showErrorToast(`⚠️ Plan ${App.ymToLabel(ym)} มีอยู่แล้วครับ`);
                return;
            }

            // Copy จาก plan ปัจจุบัน
            const srcYM   = App._currentPlanYM;
            const srcData = srcYM ? (await App.planRef(srcYM).get()) : null;
            const srcMeta = srcData?.exists ? srcData.data() : {};
            const copyRouteList = srcMeta.routeList || State.db.routeList || [];

            await App.planRef(ym).set({
                routeList:     copyRouteList,
                cycleDays:     srcMeta.cycleDays     || State.db.cycleDays || 24,
                calendarConfig: srcMeta.calendarConfig || null,
                createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt:     firebase.firestore.FieldValue.serverTimestamp(),
                copiedFrom:    srcYM || '',
            });

            // Copy routes จาก plan ต้นทาง
            if (srcYM && copyRouteList.length > 0) {
                await Promise.all(copyRouteList.map(async name => {
                    const rd = await App.planRoutesCol(srcYM).doc(name).get();
                    const stores = rd.exists ? (rd.data().stores || []) : [];
                    await App.planRoutesCol(ym).doc(name).set({ stores });
                }));
            }

            // อัปเดต planList ใน centerDoc
            const curDoc  = await App.dbRef.get();
            const curData = curDoc.exists ? curDoc.data() : {};
            const planList = [...new Set([...(curData.planList || []), ym])].sort().reverse();
            await App.dbRef.set({ planList }, { merge: true });

            State.db.planList = planList;
            UI.hideLoader();
            UI.showSaveToast(`✅ สร้าง Plan ${App.ymToLabel(ym)} เรียบร้อย`);
            PlanUI.refresh();

            // switch ไปที่ plan ใหม่
            await App.switchPlan(ym);

        } catch(err) {
            UI.hideLoader();
            UI.showErrorToast('❌ สร้าง Plan ไม่สำเร็จ: ' + err.message);
            console.error('createPlan:', err);
        }
    },

    // ─── Delete plan ─────────────────────────────────────────────────────
    deletePlan: async (ym) => {
        if (!ym) return;
        UI.showConfirm(`ยืนยันลบ Plan ${App.ymToLabel(ym)}?`, async () => {
            try {
                // ลบ routes subcollection
                const routeDocs = await App.planRoutesCol(ym).get();
                await Promise.all(routeDocs.docs.map(d => d.ref.delete()));
                await App.planRef(ym).delete();

                // อัปเดต planList
                const curDoc  = await App.dbRef.get();
                const curData = curDoc.exists ? curDoc.data() : {};
                const planList = (curData.planList || []).filter(p => p !== ym).sort().reverse();
                const newCurrentYM = planList[0] || App.currentYM();
                await App.dbRef.set({ planList, currentPlanYM: newCurrentYM }, { merge: true });

                UI.showSaveToast(`🗑️ ลบ Plan ${App.ymToLabel(ym)} เรียบร้อย`);

                if (App._currentPlanYM === ym) {
                    await App._loadPlan(newCurrentYM);
                }
                PlanUI.refresh();
            } catch(err) {
                UI.showErrorToast('❌ ลบ Plan ไม่สำเร็จ: ' + err.message);
            }
        });
    },

    // ─── Route management ────────────────────────────────────────────────
    switchRoute: (name) => {
        if (State.localActiveRoute === name) return;
        State.localActiveRoute = name;
        localStorage.setItem(`last_route_${App._currentPlanYM}`, name);
        if (State.db.routes[name] === undefined) {
            UI.showLoader('กำลังโหลดสาย ' + name + '...');
            App.planRoutesCol(App._currentPlanYM).doc(name).get().then(d => {
                State.db.routes[name] = d.exists ? (d.data().stores || []) : [];
                State.stores = State.db.routes[name];
                App.sync(); MapCtrl.fitToStores(); UI.hideLoader();
            }).catch(() => { State.stores = []; App.sync(); UI.hideLoader(); });
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
        overlay.appendChild(box); document.body.appendChild(overlay);
        const inp = box.querySelector('#_add-route-inp'); inp.focus();
        const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
        const confirm = () => {
            const n = inp.value.trim(); close(); if (!n) return;
            State.db.routes[n] = []; State.localActiveRoute = n; State.stores = [];
            App.sync(); App.saveDB();
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
        overlay.appendChild(box); document.body.appendChild(overlay);
        const inp = box.querySelector('#_ren-route-inp'); inp.focus(); inp.select();
        const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
        const confirm = () => {
            const newName = inp.value.trim(); close();
            if (!newName || newName === State.localActiveRoute) return;
            const ym = App._currentPlanYM;
            const oldName = State.localActiveRoute;
            State.db.routes[newName] = State.db.routes[oldName];
            delete State.db.routes[oldName];
            State.localActiveRoute = newName;
            App.sync();
            const routeList = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            Promise.all([
                App.planRoutesCol(ym).doc(oldName).delete(),
                App.planRoutesCol(ym).doc(newName).set({ stores: State.db.routes[newName] || [] }),
                App.planRef(ym).set({ routeList }, { merge: true }),
            ]).then(() => UI.showSaveToast('💾 เปลี่ยนชื่อสายเรียบร้อย'))
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
            const ym = App._currentPlanYM;
            const deletedName = State.localActiveRoute;
            delete State.db.routes[deletedName];
            const sortedKeys = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            State.localActiveRoute = sortedKeys[0];
            State.stores = State.db.routes[State.localActiveRoute] || [];
            App.sync(); MapCtrl.fitToStores();
            Promise.all([
                App.planRoutesCol(ym).doc(deletedName).delete(),
                App.planRef(ym).set({ routeList: sortedKeys }, { merge: true }),
            ]).then(() => UI.showSaveToast('🗑️ ลบสายเรียบร้อย'))
              .catch(err => UI.showErrorToast('❌ ลบไม่สำเร็จ: ' + err.message));
        });
    },

    // ─── calendarConfig ──────────────────────────────────────────────────
    saveCalendarConfig: async (cfg) => {
        const ym = App._currentPlanYM;
        if (!ym) return;
        try {
            await App.planRef(ym).set({ calendarConfig: cfg, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            State.db.calendarConfig = cfg;
            UI.showSaveToast('📅 บันทึกปฏิทินเรียบร้อย');
        } catch(err) {
            UI.showErrorToast('❌ บันทึกปฏิทินไม่สำเร็จ: ' + err.message);
        }
    },

    // ─── Sales data ──────────────────────────────────────────────────────
    fetchSalesData: async () => {
        try {
            const snap = await cloudDB.collection('v1_sales_chunks').get();
            State.sales = {};
            snap.forEach(doc => Object.assign(State.sales, doc.data()));
        } catch(e) { console.warn('fetchSalesData:', e); State.sales = {}; }
        App.sync();
        UI.hideLoader();
    },

    clearAllAssignments: () => {
        if (!confirm('🗑️ ยืนยันการเคลียร์การจัดสายทั้งหมด?')) return;
        if (!State.stores?.length) return UI.showErrorToast('⚠️ ไม่มีข้อมูลร้านค้า');
        State.stores.forEach(s => { s.days = []; s.seqs = {}; s.selected = false; });
        MapCtrl?.clearRoad?.(true);
        MapCtrl?.clearAll?.();
        UI?.render?.();
        App?.saveDB?.();
        UI.showSaveToast('✅ เคลียร์การจัดสายเสร็จ');
    },

    handleMapUpload: (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data     = new Uint8Array(ev.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const json     = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
                if (json.length < 2) return UI.showErrorToast('ไฟล์ว่างเปล่า');
                const headers = json[0];
                let idCol=-1, nameCol=-1, latCol=-1, lngCol=-1, freqCol=-1, dayCol=-1, seqCol=-1, salesCodeCol=-1, shopTypeCol=-1, subDistrictCol=-1, districtCol=-1, provinceCol=-1, marketNameCol=-1, cyCol=-1;
                for (let i = 0; i < headers.length; i++) {
                    const h = String(headers[i]).toLowerCase();
                    if      (h.includes('รหัส') && !h.includes('เซลล์'))                         idCol = i;
                    else if ((h.includes('ชื่อ') && !h.includes('ตลาด')) || h.includes('name'))  nameCol = i;
                    else if (h.includes('lat') || h.includes('ละติจูด'))                         latCol = i;
                    else if (h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด'))   lngCol = i;
                    else if (h.includes('freq') || h.includes('ความถี่'))                        freqCol = i;
                    else if (h.includes('day') || h.includes('สายวิ่ง'))                         dayCol = i;
                    else if (h.includes('คิว') || h.includes('seq'))                              seqCol = i;
                    else if (h.includes('salescode') || h.includes('รหัสเซลล์') || h === 'sales') salesCodeCol = i;
                    else if (h.includes('ประเภท') || h.includes('type'))                         shopTypeCol = i;
                    else if (h.includes('sold to city') || h.includes('ตำบล'))                   subDistrictCol = i;
                    else if (h.includes('sold to state') || h.includes('อำเภอ'))                 districtCol = i;
                    else if (h.includes('address 5') || h.includes('จังหวัด'))                   provinceCol = i;
                    else if (h.includes('ตลาด') || h.includes('market'))                          marketNameCol = i;
                    else if (h === 'cy' || h.startsWith('cy'))                                    cyCol = i;
                }
                if (latCol === -1 || lngCol === -1 || idCol === -1)
                    return UI.showErrorToast('ไม่พบคอลัมน์ รหัส / Lat / Lng ในไฟล์ครับ');
                const storeMap = {};
                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length === 0) continue;
                    const idStr = row[idCol] ? String(row[idCol]).trim() : `S_${i}`;
                    if (!idStr) continue;
                    const lat = parseFloat(String(row[latCol]||'').replace(/[^0-9.-]/g,''));
                    const lng = parseFloat(String(row[lngCol]||'').replace(/[^0-9.-]/g,''));
                    if (isNaN(lat)||isNaN(lng)) continue;
                    const freq = (freqCol !== -1 && String(row[freqCol]||'').trim().toUpperCase().includes('2')) ? 2 : 1;
                    const rawDay = (dayCol !== -1 && row[dayCol]) ? String(row[dayCol]).trim() : '';
                    const dayNum = rawDay ? parseInt(rawDay.replace(/[^0-9]/g,'')) : NaN;
                    const assignedDay = !isNaN(dayNum) ? 'Day ' + dayNum : '';
                    const assignedSeq = (seqCol !== -1 && row[seqCol]) ? parseInt(String(row[seqCol]).replace(/[^0-9]/g,'')) : NaN;
                    if (storeMap[idStr]) {
                        if (assignedDay && !storeMap[idStr].days.includes(assignedDay)) {
                            storeMap[idStr].days.push(assignedDay);
                            if (!isNaN(assignedSeq)) storeMap[idStr].seqs[assignedDay] = assignedSeq;
                        }
                        storeMap[idStr].freq = 2;
                    } else {
                        const s = { id:idStr, code:idStr, name: row[nameCol]?String(row[nameCol]).trim():`Store_${idStr}`, lat, lng, freq, days:[], seqs:{}, selected:false,
                            salesCode: salesCodeCol !== -1 ? String(row[salesCodeCol]||'').trim() : '',
                            shopType: shopTypeCol !== -1 ? String(row[shopTypeCol]||'').trim() : '',
                            subDistrict: subDistrictCol !== -1 ? String(row[subDistrictCol]||'').trim() : '',
                            district: districtCol !== -1 ? String(row[districtCol]||'').trim() : '',
                            province: provinceCol !== -1 ? String(row[provinceCol]||'').trim() : '',
                            marketName: marketNameCol !== -1 ? String(row[marketNameCol]||'').trim() : '',
                            cy: cyCol !== -1 ? String(row[cyCol]||'').trim() : '',
                            dayOriginal: rawDay,
                        };
                        if (assignedDay) { s.days.push(assignedDay); if (!isNaN(assignedSeq)) s.seqs[assignedDay] = assignedSeq; }
                        storeMap[idStr] = s;
                    }
                }
                const finalArray = Object.values(storeMap);
                if (finalArray.length === 0) return UI.showErrorToast('ไม่พบพิกัด (Lat, Lng) ในไฟล์ครับ');
                MapCtrl.clearAll();
                State.stores = finalArray;
                App.sync(); App.saveDB(); MapCtrl.fitToStores();
            } catch(err) { UI.showErrorToast('ขัดข้อง: ' + err.message); }
            const inp = document.getElementById('fileUpload');
            if (inp) inp.value = '';
        };
        reader.readAsArrayBuffer(file);
    },

    logout: () => { if (typeof Auth !== 'undefined') Auth.logout(); else window.location.replace('login.html'); },
};

// ==========================================
// 📅 PlanUI — plan selector รายเดือน
// ==========================================
const PlanUI = {
    // refresh dropdown
    refresh: async () => {
        try {
            const doc = await App.dbRef.get();
            const d   = doc.exists ? doc.data() : {};
            const planList     = (d.planList     || []).sort().reverse();
            const currentPlanYM = d.currentPlanYM || App.currentYM();

            const sel = document.getElementById('plan-selector');
            if (!sel) return;
            sel.innerHTML = planList.length
                ? planList.map(ym => `<option value="${ym}" ${ym === App._currentPlanYM ? 'selected' : ''}>${App.ymToLabel(ym)}</option>`).join('')
                : `<option value="${currentPlanYM}">${App.ymToLabel(currentPlanYM)}</option>`;

            PlanUI.updateBadge();
        } catch(e) { console.warn('PlanUI.refresh:', e); }
    },

    onSelect: async (ym) => {
        if (!ym || ym === App._currentPlanYM) return;
        await App.switchPlan(ym);
    },

    updateBadge: () => {
        const ym    = App._currentPlanYM;
        const badge = document.getElementById('plan-mode-badge');
        if (badge) badge.textContent = ym ? `📅 ${App.ymToLabel(ym)}` : '📅 Plan';
        const sel = document.getElementById('plan-selector');
        if (sel && ym) sel.value = ym;
    },

    // เปิด modal เพิ่มเดือนใหม่
    openCreatePlan: () => {
        const sel = document.getElementById('plan-month-select');
        if (sel) {
            const months = [];
            const d = new Date();
            for (let i = 0; i <= 3; i++) {
                const next = new Date(d.getFullYear(), d.getMonth() + i, 1);
                const ym   = `${next.getFullYear()}_${String(next.getMonth()+1).padStart(2,'0')}`;
                const lbl  = App.ymToLabel(ym);
                months.push({ ym, lbl });
            }
            sel.innerHTML = months.map(({ym,lbl}) => `<option value="${ym}">${lbl}</option>`).join('');
        }
        document.getElementById('create-plan-modal')?.classList.remove('hidden');
    },

    doCreatePlan: async () => {
        const ym = document.getElementById('plan-month-select')?.value;
        document.getElementById('create-plan-modal')?.classList.add('hidden');
        if (!ym) return;
        await App.createPlan(ym);
    },

    confirmDelete: () => {
        const ym = App._currentPlanYM;
        if (!ym) return;
        App.deletePlan(ym);
    },
};

// ==========================================
// 🔄 StoreTrans
// ==========================================
const StoreTrans = {
    _selectedIds: new Set(),
    open: () => {
        StoreTrans._selectedIds.clear();
        StoreTrans._renderRouteList();
        StoreTrans._renderStoreList();
        document.getElementById('transfer-modal').classList.remove('hidden');
    },
    close: () => { document.getElementById('transfer-modal').classList.add('hidden'); StoreTrans._selectedIds.clear(); },
    _renderRouteList: () => {
        const routes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
        const srcEl  = document.getElementById('transfer-src-route');
        const dstEl  = document.getElementById('transfer-dst-route');
        if (srcEl) srcEl.innerHTML = routes.map(r => `<option value="${r}" ${r===State.localActiveRoute?'selected':''}>${r}</option>`).join('');
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
        if (!stores.length) { listEl.innerHTML = '<p class="text-center text-xs text-gray-400 py-6">ไม่มีร้านค้าในสายนี้</p>'; return; }
        listEl.innerHTML = stores.map(s => {
            const dayTxt = s.days?.length ? s.days.join(' & ') : 'รอจัดสาย';
            const c = s.days?.length && DAY_COLORS[s.days[0]] ? DAY_COLORS[s.days[0]].hex : '#9ca3af';
            return `<label class="flex items-center gap-2.5 p-2.5 bg-white border border-gray-100 rounded-xl cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition">
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
        document.querySelectorAll('#transfer-store-list input[type=checkbox]').forEach(cb => { cb.checked = true; StoreTrans._selectedIds.add(cb.value); });
        const countEl = document.getElementById('transfer-count');
        if (countEl) countEl.textContent = StoreTrans._selectedIds.size;
    },
    confirm: async () => {
        if (StoreTrans._selectedIds.size === 0) return UI.showErrorToast('กรุณาเลือกร้านค้าก่อนครับ');
        const srcEl  = document.getElementById('transfer-src-route');
        const dstEl  = document.getElementById('transfer-dst-route');
        const srcRoute = srcEl ? srcEl.value : State.localActiveRoute;
        const dstRoute = dstEl ? dstEl.value : '';
        if (!dstRoute || dstRoute === srcRoute) return UI.showErrorToast('กรุณาเลือกสายปลายทางที่ต่างกันครับ');
        const ids = Array.from(StoreTrans._selectedIds);
        const srcStores = State.db.routes[srcRoute] || [];
        const dstStores = State.db.routes[dstRoute] || [];
        const moving    = srcStores.filter(s => ids.includes(s.id));
        State.db.routes[srcRoute] = srcStores.filter(s => !ids.includes(s.id));
        State.db.routes[dstRoute] = [...dstStores, ...moving];
        if (State.localActiveRoute === srcRoute) State.stores = State.db.routes[srcRoute];
        else if (State.localActiveRoute === dstRoute) State.stores = State.db.routes[dstRoute];
        const ym = App._currentPlanYM;
        try {
            await Promise.all([
                App.planRoutesCol(ym).doc(srcRoute).set({ stores: State.db.routes[srcRoute] }),
                App.planRoutesCol(ym).doc(dstRoute).set({ stores: State.db.routes[dstRoute] }),
            ]);
            StoreTrans.close(); App.sync();
            UI.showSaveToast(`✅ ย้าย ${moving.length} ร้าน → ${dstRoute}`);
        } catch(err) { UI.showErrorToast('❌ ย้ายร้านไม่สำเร็จ: ' + err.message); }
    },
};

console.log('✅ admin-data v3 (plans system) loaded');

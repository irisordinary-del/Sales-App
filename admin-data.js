// ==========================================
// 🏪 Store Manager
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
            const mK = State.db.cycleDays / 2;
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
        const d = ds.value;
        const mK = State.db.cycleDays / 2;
        let changed = false;

        State.stores.forEach(s => {
            if (!s.selected) return;
            if (s.freq === 2) {
                const num = parseInt(d.replace('Day ', ''));
                const pair = num <= mK ? num + mK : num - mK;
                s.days = [d, `Day ${pair}`];
            } else {
                s.days = [d];
            }
            s.selected = false;
            s.seqs = {};
            changed = true;
        });

        if (!changed) {
            UI.showErrorToast('กรุณาเลือกร้านค้าก่อนครับ');
        } else {
            UI.render();
            App.saveDB();
        }
    },

    getDistSq: (a, b) => Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2)
};

// ==========================================
// ==========================================
// ==========================================
// ==========================================
// 🚀 App Controller
// ==========================================
const App = {
    get dbRef() {
        return cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main');
    },
    routesCol:  () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('routes'),

    // ─── Plan Mode helpers ───────────────────────────────────────────────
    // planMode: 'active' | 'draft:{YYYY_MM}' | 'history:{YYYY_MM}'
    _planMode: 'active',

    draftsCol:  () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('drafts'),
    historyCol: () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('history'),

    // ส่งคืน collection ตาม planMode ปัจจุบัน
    currentRoutesCol: () => {
        const m = App._planMode;
        if (m === 'active') return App.routesCol();
        if (m.startsWith('draft:')) {
            const ym = m.replace('draft:', '');
            return App.draftsCol().doc(ym).collection('routes');
        }
        if (m.startsWith('history:')) {
            const ym = m.replace('history:', '');
            return App.historyCol().doc(ym).collection('routes');
        }
        return App.routesCol();
    },

    isReadOnly: () => App._planMode.startsWith('history:'),
    _snapshotUnsub: null,
    _fileListenersReady: false,

    // Migrate: ข้อมูลเก่า (routes map ใน v1_main) → subcollection
    _migrate: async (oldRoutes) => {
        console.log('🔄 Migration: ย้ายข้อมูลไปยัง subcollection...');
        const names = Object.keys(oldRoutes);
        for (const name of names) {
            await App.routesCol().doc(name).set({ stores: oldRoutes[name] || [] });
        }
        await App.dbRef.update({
            routeList: names,
            routes: firebase.firestore.FieldValue.delete()
        });
        console.log('✅ Migration เสร็จสิ้น');
    },

    // โหลดทุกสายจาก subcollection พร้อมกัน
    _loadAllRoutes: async (routeList) => {
        State.db.routes = {};
        // ใช้ currentRoutesCol() เพื่อโหลดจาก path ที่ถูกต้องตาม mode
        const col = App.currentRoutesCol();
        await Promise.all(routeList.map(name =>
            col.doc(name).get()
                .then(d => {
                    const stores = d.exists ? (d.data().stores || []) : [];
                    State.db.routes[name] = stores;
                    App.log(`  ✅ ${name}: ${stores.length} ร้าน`);
                })
                .catch((e) => {
                    App.log(`  ⚠️ ${name}: ${e.code || e.message}`);
                    State.db.routes[name] = [];
                })
        ));
    },

    // ─── Process Logger (แสดงใน loader ขณะโหลด) ─────────────────────────
    _logLines: [],
    log: (msg) => {
        const ts = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const line = `[${ts}] ${msg}`;
        App._logLines.push(line);
        console.log('🔵', line);
        const el = document.getElementById('loader-log');
        if (el) {
            el.innerHTML = App._logLines.slice(-12).join('<br>');
            el.scrollTop = el.scrollHeight;
        }
    },

    // ─── Force Reload: ดึงข้อมูลใหม่จาก Firestore ทั้งหมด ──────────────
    forceReload: async () => {
        App._logLines = [];
        App.log('🔄 Force reload เริ่มต้น...');
        UI.showLoader('กำลัง Force Reload...', 'ดึงข้อมูลจาก Firestore โดยตรง');
        const btn = document.getElementById('force-reload-btn');
        if (btn) btn.style.display = 'none';
        clearTimeout(App._forceReloadTimer);

        try {
            App.log(`📡 ดึง metadata: ${window.CENTER_DOC}`);
            // ดึงตรงๆ โดยไม่ผ่าน cache (source: server)
            const doc = await App.dbRef.get({ source: 'server' });
            const d = doc.exists ? doc.data() : {};
            App.log(`✅ metadata OK — routeList: ${(d.routeList || []).length} สาย`);

            State.db.cycleDays = d.cycleDays || 24;
            State.db.routeList = (d.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));

            if (State.db.routeList.length === 0) {
                App.log('⚠️ ไม่มี routeList — สร้างสายเริ่มต้น');
                State.db.routeList = ['สายที่ 1'];
                State.db.routes['สายที่ 1'] = [];
            } else {
                App.log(`📦 โหลด ${State.db.routeList.length} สาย...`);
                await Promise.all(State.db.routeList.map(async (name) => {
                    try {
                        const rd = await App.routesCol().doc(name).get({ source: 'server' });
                        const stores = rd.exists ? (rd.data().stores || []) : [];
                        State.db.routes[name] = stores;
                        App.log(`  ✅ ${name}: ${stores.length} ร้าน`);
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


                    App.fetchSalesData(); // fetchSalesData เรียก App.sync() + UI.hideLoader() ปิดท้าย
            App.log('✅ Force reload เสร็จสิ้น');
        } catch (err) {
            App.log(`❌ Error: ${err.code || err.message}`);
            UI.hideLoader();
            UI.showErrorToast('❌ Force reload ไม่สำเร็จ: ' + err.message);
            if (btn) btn.style.display = 'block';
        }
    },

    // ─── Timer สำหรับแสดงปุ่ม force reload ถ้าโหลดนานเกิน 8 วิ ──────────
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

        // รอ Firestore persistence พร้อมก่อน — ป้องกัน cache miss ตอน network ช้า
        // ใช้ Promise.race กับ timeout 3 วิ เพื่อไม่ให้ค้างบนมือถือ
        App.log('🔌 รอ Firestore persistence...');
        if (window.firestoreReady) {
            await Promise.race([
                window.firestoreReady,
                new Promise(resolve => setTimeout(resolve, 3000))
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

            // ✅ ตรวจสอบ: มีข้อมูลเก่า (routes map) → migrate อัตโนมัติ
            if (d.routes && typeof d.routes === 'object' && Object.keys(d.routes).length > 0) {
                App.log('🔄 พบข้อมูล format เก่า → migrate...');
                State.db.routeList = Object.keys(d.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                await App._migrate(d.routes);
                return; // รอ onSnapshot trigger รอบถัดไปหลัง migration
            }

            // โครงสร้างใหม่: routeList ใน metadata
            const routeList = (d.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            App.log(`📋 routeList: [${routeList.join(', ')}]`);
            State.db.routeList = routeList.length > 0 ? routeList : ['สายที่ 1'];

            App.log(`📦 โหลด ${State.db.routeList.length} สาย...`);
            await App._loadAllRoutes(State.db.routeList);
            App.log(`✅ โหลดสายเสร็จ — รวม ${Object.keys(State.db.routes).reduce((s,k) => s + (State.db.routes[k]||[]).length, 0)} ร้าน`);

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
            // onSnapshot error — มักเกิดจาก permission หรือ network
            // ถ้า persistence เปิดอยู่ Firestore จะ serve จาก cache อัตโนมัติ
            // ถ้าไม่มี cache เลย ให้แสดง retry
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

        if (!App._fileListenersReady) {
            App._fileListenersReady = true;
            const fileUpload = document.getElementById('fileUpload');
            if (fileUpload) {
                fileUpload.addEventListener('change', App.handleMapUpload);
            }
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

        const isDraft = App._planMode.startsWith('draft:');
        const ym = isDraft ? App._planMode.replace('draft:', '') : null;

        const routePromise = App.currentRoutesCol().doc(State.localActiveRoute).set({ stores: State.stores });
        const metaPromise  = isDraft
            ? App.draftsCol().doc(ym).set({ routeList, cycleDays: State.db.cycleDays || 24, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
            : App.dbRef.update({ routeList, cycleDays: State.db.cycleDays || 24 });

        const modeLabel = isDraft ? `📝 Draft ${ym}` : '💾';
        Promise.all([routePromise, metaPromise])
            .then(() => UI.showSaveToast(`${modeLabel} บันทึกเรียบร้อย`))
            .catch(err => {
                console.error('saveDB error:', err);
                UI.showErrorToast('❌ บันทึกไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต');
            });
    },

    // แก้บัค: reset tab กลับ tab1 ทุกครั้งที่ sync
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
        UI.switchTab('tab1'); // reset tab (แต่ switchTab จะ guard ไม่ให้ทับ tab ที่ user เลือกอยู่)
        UI.render();
    },

    switchRoute: (name) => {
        if (State.localActiveRoute === name) return;
        State.localActiveRoute = name;
        if (App._planMode === 'active') localStorage.setItem('last_viewed_route', name);
        // ถ้า route นี้ยังไม่ได้โหลด → ดึงจาก Firestore
        if (State.db.routes[name] === undefined) {
            UI.showLoader('กำลังโหลดสาย ' + name + '...');
            App.currentRoutesCol().doc(name).get().then(d => {
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
        overlay.appendChild(box);  // แก้บัค: appendChild เพียงครั้งเดียว ไม่ซ้ำ
        document.body.appendChild(overlay);
        const inp = box.querySelector('#_add-route-inp');
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
        box.querySelector('#_add-route-ok').onclick = confirm;
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
        const inp = box.querySelector('#_ren-route-inp');
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
            // แก้บัค: ใช้ currentRoutesCol() ให้ตรงกับ planMode ปัจจุบัน
            Promise.all([
                App.currentRoutesCol().doc(oldName).delete(),
                App.currentRoutesCol().doc(newName).set({ stores: State.db.routes[newName] || [] }),
                App.dbRef.update({ routeList })
            ])
            .then(() => UI.showSaveToast('💾 เปลี่ยนชื่อสายเรียบร้อย'))
            .catch(err => UI.showErrorToast('❌ เปลี่ยนชื่อไม่สำเร็จ: ' + err.message));
        };
        box.querySelector('#_ren-cancel').onclick = close;
        box.querySelector('#_ren-ok').onclick = confirm;
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); });
        overlay.onclick = e => { if (e.target === overlay) close(); };
    },

    deleteRoute: () => {
        if (Object.keys(State.db.routes).length <= 1) {
            return UI.showErrorToast('ห้ามลบสายสุดท้ายครับ');
        }
        UI.showConfirm('ยืนยันลบสาย "' + State.localActiveRoute + '"?', () => {
            const deletedName = State.localActiveRoute;
            delete State.db.routes[deletedName];
            const sortedKeys = Object.keys(State.db.routes)
                .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
            State.localActiveRoute = sortedKeys[0];
            State.stores = State.db.routes[State.localActiveRoute] || [];
            App.sync(); MapCtrl.fitToStores();
            // ✅ ลบ subcollection doc + อัปเดต routeList
            Promise.all([
                App.routesCol().doc(deletedName).delete(),
                App.dbRef.update({ routeList: sortedKeys })
            ])
            .then(() => UI.showSaveToast('🗑️ ลบสายเรียบร้อย'))
            .catch(err => UI.showErrorToast('❌ ลบไม่สำเร็จ: ' + err.message));
        });
    },

    // ─── Plan Management ────────────────────────────────────────────────

    // โหลด plan ตาม mode (active / draft:YYYY_MM / history:YYYY_MM)
    switchPlanMode: async (mode) => {
        App._planMode = mode;
        State.db.routes = {};

        const isActive  = mode === 'active';
        const isDraft   = mode.startsWith('draft:');
        const isHistory = mode.startsWith('history:');
        const ym = (isDraft || isHistory) ? mode.split(':')[1] : null;

        UI.showLoader('กำลังโหลด Plan...', isActive ? 'โหลด Plan ปัจจุบัน' : `โหลด ${isDraft ? 'Draft' : 'History'} ${ym || ''}`);

        try {
            let routeList, cycleDays;

            if (isActive) {
                const doc = await App.dbRef.get();
                const d = doc.exists ? doc.data() : {};
                routeList  = (d.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                cycleDays  = d.cycleDays || 24;
            } else if (isDraft) {
                const doc = await App.draftsCol().doc(ym).get();
                const d = doc.exists ? doc.data() : {};
                routeList  = (d.routeList || State.db.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                cycleDays  = d.cycleDays || State.db.cycleDays || 24;
            } else {
                const doc = await App.historyCol().doc(ym).get();
                const d = doc.exists ? doc.data() : {};
                routeList  = (d.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                cycleDays  = d.cycleDays || 24;
            }

            State.db.routeList = routeList.length ? routeList : (State.db.routeList || []);
            State.db.cycleDays = cycleDays;

            await App._loadAllRoutes(State.db.routeList);

            State.localActiveRoute = State.db.routeList[0] || '';
            State.stores = State.db.routes[State.localActiveRoute] || [];

            // อัปเดต UI badge
            PlanUI.updateBadge();
            App.sync();
            MapCtrl.fitToStores();
            UI.hideLoader();

            const label = isActive ? 'Plan ปัจจุบัน' : (isDraft ? `Draft ${ym}` : `History ${ym}`);
            UI.showSaveToast(`✅ โหลด ${label} เสร็จ`);
        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ โหลด Plan ไม่สำเร็จ: ' + err.message);
            console.error('switchPlanMode error:', err);
        }
    },

    // สร้าง Draft จาก Active plan ปัจจุบัน
    createDraft: async (ym) => {
        if (!ym) return;
        UI.showLoader('กำลังสร้าง Draft...', `Copy plan → Draft ${ym}`);
        try {
            // เช็คว่ามี draft นี้แล้วหรือยัง
            const existing = await App.draftsCol().doc(ym).get();
            if (existing.exists) {
                UI.hideLoader();
                UI.showErrorToast(`⚠️ Draft ${ym} มีอยู่แล้วครับ`);
                return;
            }

            // Copy routeList + cycleDays
            const meta = {
                routeList:  State.db.routeList,
                cycleDays:  State.db.cycleDays || 24,
                createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
                sourceMode: 'active'
            };
            await App.draftsCol().doc(ym).set(meta);

            // Copy ทุกสาย
            const draftRoutesCol = App.draftsCol().doc(ym).collection('routes');
            await Promise.all(State.db.routeList.map(async name => {
                const stores = State.db.routes[name] || [];
                await draftRoutesCol.doc(name).set({ stores });
            }));

            // อัปเดต draftList ใน metadata
            const curDoc = await App.dbRef.get();
            const curData = curDoc.exists ? curDoc.data() : {};
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

    // Activate: copy active→history, draft→active
    activateDraft: async (ym) => {
        UI.showLoader('กำลัง Activate...', `Draft ${ym} → Active`);
        try {
            // 1. Snapshot active → history
            const activeDoc = await App.dbRef.get();
            const activeData = activeDoc.exists ? activeDoc.data() : {};
            const histYm = PlanUI.currentYM(); // เดือนปัจจุบัน
            const histMeta = {
                routeList:   activeData.routeList  || [],
                cycleDays:   activeData.cycleDays  || 24,
                archivedAt:  firebase.firestore.FieldValue.serverTimestamp(),
                label:       histYm
            };
            await App.historyCol().doc(histYm).set(histMeta);

            // copy routes active → history
            const histRoutesCol = App.historyCol().doc(histYm).collection('routes');
            await Promise.all((activeData.routeList || []).map(async name => {
                const rd = await App.routesCol().doc(name).get();
                const stores = rd.exists ? (rd.data().stores || []) : [];
                await histRoutesCol.doc(name).set({ stores });
            }));

            // 2. Load draft
            const draftDoc = await App.draftsCol().doc(ym).get();
            const draftData = draftDoc.exists ? draftDoc.data() : {};
            const newRouteList = (draftData.routeList || []).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            const newCycleDays = draftData.cycleDays || 24;

            // copy routes draft → active
            const draftRoutesCol = App.draftsCol().doc(ym).collection('routes');
            const draftRoutes = await draftRoutesCol.get();
            const activeRoutesCol = App.routesCol();
            await Promise.all(draftRoutes.docs.map(async d => {
                await activeRoutesCol.doc(d.id).set(d.data());
            }));

            // 3. อัปเดต metadata active
            const curDoc = await App.dbRef.get();
            const curData = curDoc.exists ? curDoc.data() : {};
            const historyList = [...new Set([...(curData.historyList || []), histYm])].sort().reverse();
            const draftList   = (curData.draftList || []).filter(d => d !== ym);

            await App.dbRef.update({
                routeList:   newRouteList,
                cycleDays:   newCycleDays,
                historyList,
                draftList,
                lastActivated: ym,
                updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
            });

            UI.hideLoader();
            UI.showSaveToast(`✅ Activate ${ym} เรียบร้อย! Sales จะเห็น Plan ใหม่ทันที`);

            // Reload active mode
            await App.switchPlanMode('active');
            if (typeof PlanUI !== 'undefined') PlanUI.refresh();
        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ Activate ไม่สำเร็จ: ' + err.message);
            console.error('activateDraft error:', err);
        }
    },

    clearStores: () => {
        if (!confirm('ล้างข้อมูลร้านค้าทั้งหมดในสายนี้?')) return;
        State.stores = [];
        MapCtrl.clearAll();
        App.sync();
        App.saveDB();
    },


    // ─── Helper: แปลง cycle-day (1-24) → calendar day โดยคำนวณจาก calendarConfig
    // input:  assignedDayNum = 1-24 (จากไฟล์ Excel)
    // output: 'Day N' ที่ถูกต้องตาม calendarConfig ของ draft/active นั้น
    _mapCycleDayToCalDay: (dayNum, calCfg) => {
        if (!calCfg || calCfg.mode !== 'cycle' || !dayNum) return `Day ${dayNum}`;
        const holidays = calCfg.holidays || [];
        const cycleDays = calCfg.cycleDays || 24;
        if (!holidays.length) return `Day ${dayNum}`; // ไม่มีวันหยุด → ตรงกัน

        // สร้าง mapping: cycle-day (1,2,3...) → calendar-day (1,2,...,cycleDays) ข้ามวันหยุด
        // cycle-day 1 = วันทำงานแรก, ข้ามวันหยุดทุกวัน
        const mapping = {}; // cycleDay → calDay
        let cycleDay = 1;
        for (let calDay = 1; calDay <= cycleDays && cycleDay <= cycleDays; calDay++) {
            if (holidays.includes(calDay)) continue; // ข้ามวันหยุด
            mapping[cycleDay] = calDay;
            cycleDay++;
        }
        const mapped = mapping[dayNum];
        return mapped ? `Day ${mapped}` : `Day ${dayNum}`;
    },

    handleMapUpload: function (e) {
        const file = e.target.files[0];
        if (!file) return;

        if (State.stores.length > 0 && !confirm(`ข้อมูลเดิมของ "${State.localActiveRoute}" จะถูกแทนที่\nยืนยันการอัปโหลด?`)) {
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(
                    workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' }
                );
                if (json.length < 2) return UI.showErrorToast('ไฟล์ว่างเปล่า');

                // โหลด calendarConfig ของ plan ปัจจุบัน (สำหรับ remap days)
                // ใช้แบบ async ผ่าน .get() แล้ว process ใน callback
                const _processUpload = async (calCfg) => {

                const headers = json[0];
                let idCol = -1, nameCol = -1, latCol = -1, lngCol = -1, freqCol = -1, dayCol = -1, seqCol = -1, salesCodeCol = -1, shopTypeCol = -1, subDistrictCol = -1, districtCol = -1, provinceCol = -1, marketNameCol = -1, cyCol = -1;

                for (let i = 0; i < headers.length; i++) {
                    const h = String(headers[i]).toLowerCase();
                    if (h.includes('รหัส') || h.includes('customer code') || h.includes('id')) idCol = i;
                    else if ((h.includes('ชื่อ') && !h.includes('ตลาด')) || h.includes('name')) nameCol = i;
                    else if (h.includes('lat') || h.includes('ละติจูด')) latCol = i;
                    else if (h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด')) lngCol = i;
                    else if (h.includes('freq') || h.includes('ความถี่') || h.includes('รอบ') || h.includes('f2')) freqCol = i;
                    else if (h.includes('สายวิ่ง') || h.includes('day')) dayCol = i;
                    else if (h.includes('คิว') || h.includes('seq')) seqCol = i;
                    else if (h.includes('salescode') || h.includes('รหัสเซลล์')) salesCodeCol = i;
                    else if (h.includes('sales')) salesCodeCol = i;
                                        else if (h.includes('ประเภท') || h.includes('type') || h.includes('shoptype')) shopTypeCol = i;
                                        else if (h.includes('sold to city') || h.includes('subdistrict') || h.includes('ตำบล')) subDistrictCol = i;
                                        else if (h.includes('sold to state') || h.includes('district') || h.includes('อำเภอ')) districtCol = i;
                                        else if (h.includes('address 5') || h.includes('province') || h.includes('จังหวัด')) provinceCol = i;
                                        else if (h.includes('ตลาด') || h.includes('market')) marketNameCol = i;
                                        else if (h === 'cy' || h.includes('cy')) cyCol = i;
                }

                const storeMap = {};
                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length === 0) continue;
                    const idStr = row[idCol] ? String(row[idCol]).trim() : `S_${i}`;
                    if (!idStr) continue;
                    const lat = parseFloat(String(row[latCol] || '').replace(/[^0-9.-]/g, ''));
                    const lng = parseFloat(String(row[lngCol] || '').replace(/[^0-9.-]/g, ''));
                    if (isNaN(lat) || isNaN(lng)) continue;

                    const freq = (freqCol !== -1 && String(row[freqCol] || '').trim().toUpperCase().includes('2')) ? 2 : 1;
                    const rawDay = (dayCol !== -1 && row[dayCol]) ? String(row[dayCol]).trim() : '';
                    const dayNum = rawDay ? parseInt(rawDay.replace(/[^0-9]/g, '')) : NaN;
                    // remap cycle-day → calendar-day ตาม calendarConfig (ข้ามวันหยุด)
                    const assignedDay = !isNaN(dayNum) ? App._mapCycleDayToCalDay(dayNum, calCfg) : '';
                    const assignedSeq = (seqCol !== -1 && row[seqCol]) ? parseInt(String(row[seqCol]).replace(/[^0-9]/g, '')) : NaN;
                    const isValidDay = !!assignedDay;

                    if (storeMap[idStr]) {
                        if (isValidDay && !storeMap[idStr].days.includes(assignedDay)) {
                            storeMap[idStr].days.push(assignedDay);
                            if (!isNaN(assignedSeq)) storeMap[idStr].seqs[assignedDay] = assignedSeq;
                        }
                        storeMap[idStr].freq = 2;
                    } else {
                        const newStore = {
                            id: idStr,
                            name: row[nameCol] ? String(row[nameCol]).trim() : `Store_${idStr}`,
                            lat, lng, freq, days: [], seqs: {}, selected: false,
                            code: idStr,
                            salesCode: salesCodeCol !== -1 ? (String(row[salesCodeCol] || '')).trim() : '',
                            shopType: shopTypeCol !== -1 ? (String(row[shopTypeCol] || '')).trim() : '',
                            subDistrict: subDistrictCol !== -1 ? (String(row[subDistrictCol] || '')).trim() : '',
                            district: districtCol !== -1 ? (String(row[districtCol] || '')).trim() : '',
                            province: provinceCol !== -1 ? (String(row[provinceCol] || '')).trim() : '',
                            marketName: marketNameCol !== -1 ? (String(row[marketNameCol] || '')).trim() : '',
                            cy: cyCol !== -1 ? (String(row[cyCol] || '')).trim() : '',
                            dayOriginal: dayCol !== -1 ? (String(row[dayCol] || '')).trim() : ''
                        };
                        if (isValidDay) {
                            newStore.days.push(assignedDay);
                            if (!isNaN(assignedSeq)) newStore.seqs[assignedDay] = assignedSeq;
                        }
                        storeMap[idStr] = newStore;
                    }
                }

                const finalArray = Object.values(storeMap);
                if (finalArray.length === 0) return UI.showErrorToast('ไม่พบพิกัด (Lat, Lng) ในไฟล์ครับ');

                // แก้บัค: clearAll markers เก่าก่อน load ใหม่
                MapCtrl.clearAll();
                State.stores = finalArray;
                App.sync();
                App.saveDB();
                MapCtrl.fitToStores();

                }; // end _processUpload

                // โหลด calendarConfig: draft → draftsCol doc, active → dbRef
                try {
                    const _planRef = App._planMode.startsWith('draft:')
                        ? App.draftsCol().doc(App._planMode.replace('draft:',''))
                        : App.dbRef;
                    _planRef.get().then(snap => {
                        const calCfg = snap.exists ? (snap.data().calendarConfig || null) : null;
                        _processUpload(calCfg);
                    }).catch(() => _processUpload(null));
                } catch(e) {
                    _processUpload(null);
                }
                UI.showSaveToast(`✅ โหลด ${finalArray.length} ร้าน พร้อมการจัดวันวิ่งสำเร็จ`);

            } catch (err) {
                UI.showErrorToast('ขัดข้อง: ' + err.message);
            }
            const inp = document.getElementById('fileUpload');
            if (inp) inp.value = '';
        };
        reader.readAsArrayBuffer(file);
    },
    
    // เคลียร์การจัดสายทั้งหมด
    clearAllAssignments: () => {
        try {
            if (!confirm('🗑️ ยืนยันการเคลียร์การจัดสายทั้งหมด?\n(ร้านทั้งหมดจะกลับไปอยู่ในสถานะ "รอจัดสาย")')) {
                return;
            }
            
            if (!State.stores || State.stores.length === 0) {
                UI.showErrorToast('⚠️ ไม่มีข้อมูลร้านค้า');
                return;
            }
            
            State.stores.forEach(s => {
                s.days = [];
                s.seqs = {};
                s.selected = false;
            });
            
            if (MapCtrl && MapCtrl.clearRoad) MapCtrl.clearRoad(true);
            if (MapCtrl && MapCtrl.clearAll) MapCtrl.clearAll();
            if (UI && UI.render) UI.render();
            if (App && App.saveDB) App.saveDB();
            
            UI.showSaveToast('✅ เคลียร์การจัดสายเสร็จ');
        } catch(err) {
            console.error('❌ Clear error:', err);
            UI.showErrorToast('❌ เกิดข้อผิดพลาด: ' + err.message);
        }
    }
};

// ==========================================
// 🔄 Store Transfer — ย้ายร้านระหว่างสาย
// ==========================================
const StoreTrans = {
    _selectedIds: new Set(),

    // เปิด modal ย้ายร้าน
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

    // render dropdown สาย source (= สายปัจจุบัน) และ target
    _renderRouteList: () => {
        const routes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
        const srcEl = document.getElementById('transfer-src-route');
        const dstEl = document.getElementById('transfer-dst-route');
        if (srcEl) {
            srcEl.innerHTML = routes.map(r =>
                `<option value="${r}" ${r === State.localActiveRoute ? 'selected' : ''}>${r}</option>`
            ).join('');
        }
        if (dstEl) {
            dstEl.innerHTML = routes.map(r =>
                `<option value="${r}" ${r !== State.localActiveRoute ? '' : ''}>${r}</option>`
            ).join('');
            // default dst = อันแรกที่ไม่ใช่ src
            const other = routes.find(r => r !== State.localActiveRoute);
            if (other && dstEl) dstEl.value = other;
        }
        if (srcEl) srcEl.addEventListener('change', () => StoreTrans._renderStoreList());
    },

    // render รายการร้านของ src route
    _renderStoreList: () => {
        const srcEl = document.getElementById('transfer-src-route');
        const srcRoute = srcEl ? srcEl.value : State.localActiveRoute;
        const stores = State.db.routes[srcRoute] || [];
        StoreTrans._selectedIds.clear();

        const listEl = document.getElementById('transfer-store-list');
        if (!listEl) return;

        if (!stores.length) {
            listEl.innerHTML = '<p class="text-center text-xs text-gray-400 py-6">ไม่มีร้านค้าในสายนี้</p>';
            return;
        }

        listEl.innerHTML = stores.map(s => {
            const dayTxt = s.days && s.days.length ? s.days.join(' & ') : 'รอจัดสาย';
            const c = s.days && s.days.length && DAY_COLORS[s.days[0]] ? DAY_COLORS[s.days[0]].hex : '#9ca3af';
            return `
            <label class="flex items-center gap-2.5 p-2.5 bg-white border border-gray-100 rounded-xl cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition">
                <input type="checkbox" value="${s.id}" onchange="StoreTrans._toggle(this)"
                    class="w-4 h-4 text-indigo-600 rounded flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-gray-800 truncate">${s.name} ${s.freq===2?'<span style="background:#ef4444;color:#fff;padding:1px 5px;border-radius:8px;font-size:9px;font-weight:700;">F2</span>':''}</p>
                    <p class="text-[10px] text-gray-400 font-mono">${s.id}</p>
                </div>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full text-white flex-shrink-0" style="background:${c};">${dayTxt}</span>
            </label>`;
        }).join('');
    },

    _toggle: (cb) => {
        if (cb.checked) StoreTrans._selectedIds.add(cb.value);
        else StoreTrans._selectedIds.delete(cb.value);
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

    clearAll: () => {
        document.querySelectorAll('#transfer-store-list input[type=checkbox]').forEach(cb => {
            cb.checked = false;
        });
        StoreTrans._selectedIds.clear();
        const countEl = document.getElementById('transfer-count');
        if (countEl) countEl.textContent = 0;
    },

    // ยืนยันย้าย
    confirm: async () => {
        if (StoreTrans._selectedIds.size === 0)
            return UI.showErrorToast('⚠️ กรุณาเลือกร้านที่ต้องการย้าย');

        if (App.isReadOnly())
            return UI.showErrorToast('⚠️ ไม่สามารถแก้ไข History ได้');

        const srcEl = document.getElementById('transfer-src-route');
        const dstEl = document.getElementById('transfer-dst-route');
        const srcRoute = srcEl ? srcEl.value : State.localActiveRoute;
        const dstRoute = dstEl ? dstEl.value : '';

        if (!dstRoute || srcRoute === dstRoute)
            return UI.showErrorToast('⚠️ กรุณาเลือกสายปลายทางที่ต่างจากต้นทาง');

        const count = StoreTrans._selectedIds.size;
        UI.showConfirm(
            `ย้าย ${count} ร้าน\nจาก "${srcRoute}" → "${dstRoute}"\nยืนยันหรือไม่?`,
            async () => {
                UI.showLoader('กำลังย้ายร้าน...', `${count} ร้าน → ${dstRoute}`);
                try {
                    const srcStores = State.db.routes[srcRoute] || [];
                    const dstStores = State.db.routes[dstRoute] || [];
                    const toMove = srcStores.filter(s => StoreTrans._selectedIds.has(s.id));
                    const remaining = srcStores.filter(s => !StoreTrans._selectedIds.has(s.id));

                    // รีเซ็ต days/seqs ของร้านที่ย้าย (เพราะ sequence ของสายเดิมไม่ match)
                    toMove.forEach(s => { s.days = []; s.seqs = {}; s.selected = false; });

                    State.db.routes[srcRoute] = remaining;
                    State.db.routes[dstRoute] = [...dstStores, ...toMove];

                    // อัปเดต State.stores ถ้า route ที่กำลังดูอยู่ถูกกระทบ
                    if (State.localActiveRoute === srcRoute) State.stores = remaining;
                    if (State.localActiveRoute === dstRoute) State.stores = State.db.routes[dstRoute];

                    // บันทึกทั้ง src และ dst
                    await Promise.all([
                        App.currentRoutesCol().doc(srcRoute).set({ stores: remaining }),
                        App.currentRoutesCol().doc(dstRoute).set({ stores: State.db.routes[dstRoute] })
                    ]);

                    StoreTrans.close();
                    App.sync();
                    MapCtrl.fitToStores();
                    UI.hideLoader();
                    UI.showSaveToast(`✅ ย้าย ${count} ร้าน → ${dstRoute} เรียบร้อย`);
                } catch (err) {
                    UI.hideLoader();
                    UI.showErrorToast('❌ ย้ายไม่สำเร็จ: ' + err.message);
                }
            }
        );
    }
};

// ==========================================
// 📤 Export Controller — รองรับทุก planMode
// ==========================================
const ExportCtrl = {

    // แปลง YYYY_MM → ชื่อเดือนภาษาไทย พ.ศ.
    formatYM: (ym) => {
        if (!ym) return '';
        const [y, m] = ym.split('_');
        const d = new Date(+y, +m - 1, 1);
        return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
    },

    // เปิด modal เลือก plan/route ก่อน export
    openModal: () => {
        const modal = document.getElementById('export-modal');
        if (!modal) { ExportCtrl.exportCurrent(); return; }

        // reset plan selector — เลือก draft ถ้า planMode ปัจจุบันเป็น draft
        const planSel = document.getElementById('export-plan-sel');
        if (planSel) {
            const m = App._planMode;
            if (m.startsWith('draft:')) planSel.value = 'draft';
            else if (m.startsWith('history:')) planSel.value = 'history';
            else planSel.value = 'current';
            ExportCtrl.onPlanSelChange(planSel.value);
        }

        // populate route options
        const routeSel = document.getElementById('export-route-sel');
        if (routeSel) {
            const routes = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            routeSel.innerHTML = `<option value="ALL">📦 ทุกสาย</option>` +
                routes.map(r => `<option value="${r}" ${r === State.localActiveRoute ? 'selected' : ''}>${r}</option>`).join('');
        }

        modal.classList.remove('hidden');
    },

    // เมื่อเปลี่ยน plan type → แสดง/ซ่อน month selector
    onPlanSelChange: async (val) => {
        const monthRow = document.getElementById('export-month-row');
        const monthSel = document.getElementById('export-month-sel');
        if (!monthRow || !monthSel) return;

        if (val === 'draft' || val === 'history') {
            monthRow.classList.remove('hidden');
            monthSel.innerHTML = '<option value="">— กำลังโหลด... —</option>';

            try {
                // โหลด draftList / historyList จาก metadata
                const metaSnap = await App.dbRef.get();
                const meta = metaSnap.exists ? metaSnap.data() : {};
                const list = val === 'draft'
                    ? (meta.draftList   || []).sort().reverse()
                    : (meta.historyList || []).sort().reverse();

                if (!list.length) {
                    monthSel.innerHTML = `<option value="">— ไม่มีข้อมูล ${val === 'draft' ? 'Draft' : 'History'} —</option>`;
                } else {
                    monthSel.innerHTML = list.map(ym => {
                        const [y, m] = ym.split('_');
                        const label = new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { year:'numeric', month:'long' });
                        // pre-select เดือนที่กำลังเปิดอยู่
                        const cur = App._planMode.replace('draft:','').replace('history:','');
                        return `<option value="${ym}" ${ym === cur ? 'selected' : ''}>${label}</option>`;
                    }).join('');
                }
            } catch(e) {
                monthSel.innerHTML = '<option value="">— โหลดไม่สำเร็จ —</option>';
            }
        } else {
            monthRow.classList.add('hidden');
        }
    },

    closeModal: () => {
        const modal = document.getElementById('export-modal');
        if (modal) modal.classList.add('hidden');
    },

    doExport: async () => {
        const planSel  = document.getElementById('export-plan-sel');
        const monthSel = document.getElementById('export-month-sel');
        const routeSel = document.getElementById('export-route-sel');
        const planVal  = planSel  ? planSel.value  : 'current';
        const monthVal = monthSel ? monthSel.value : '';
        const routeVal = routeSel ? routeSel.value : State.localActiveRoute;

        ExportCtrl.closeModal();

        // ─── helper: โหลด routes จาก Firestore ───────────────────────
        const _loadFromFirestore = async (col, routeList, routeFilter) => {
            const toLoad = routeFilter === 'ALL' ? routeList : [routeFilter];
            const routeData = {};
            await Promise.all(toLoad.map(async name => {
                const d = await col.doc(name).get();
                routeData[name] = d.exists ? (d.data().stores || []) : [];
            }));
            return routeData;
        };

        try {
            // ─── Active ───────────────────────────────────────────────
            if (planVal === 'active') {
                UI.showLoader('กำลังโหลด Active Plan...', 'ดึงข้อมูลจาก Firestore');
                const routeList = (await App.dbRef.get()).data()?.routeList || [];
                const routeData = await _loadFromFirestore(App.routesCol(), routeList, routeVal);
                UI.hideLoader();
                ExportCtrl._writeExcel(routeData, 'Active');
                return;
            }

            // ─── Draft เดือนที่เลือก ──────────────────────────────────
            if (planVal === 'draft') {
                if (!monthVal) return UI.showErrorToast('⚠️ กรุณาเลือกเดือน Draft');
                // ถ้าเดือนที่เลือก = planMode ปัจจุบัน → ใช้ State แทน (เร็วกว่า)
                if (App._planMode === 'draft:' + monthVal) {
                    const routeData = {};
                    if (routeVal === 'ALL') Object.assign(routeData, State.db.routes);
                    else routeData[routeVal] = State.db.routes[routeVal] || [];
                    ExportCtrl._writeExcel(routeData, `Draft_${monthVal}`);
                    return;
                }
                UI.showLoader(`กำลังโหลด Draft ${monthVal}...`, 'ดึงข้อมูลจาก Firestore');
                const draftDoc  = await App.draftsCol().doc(monthVal).get();
                const routeList = draftDoc.exists ? (draftDoc.data().routeList || []) : [];
                const col = App.draftsCol().doc(monthVal).collection('routes');
                const routeData = await _loadFromFirestore(col, routeList, routeVal);
                UI.hideLoader();
                ExportCtrl._writeExcel(routeData, `Draft_${monthVal}`);
                return;
            }

            // ─── History เดือนที่เลือก ────────────────────────────────
            if (planVal === 'history') {
                if (!monthVal) return UI.showErrorToast('⚠️ กรุณาเลือกเดือน History');
                UI.showLoader(`กำลังโหลด History ${monthVal}...`, 'ดึงข้อมูลจาก Firestore');
                const histDoc   = await App.dbRef.collection('history').doc(monthVal).get();
                const routeList = histDoc.exists ? (histDoc.data().routeList || Object.keys(State.db.routes)) : [];
                const col = App.dbRef.collection('history').doc(monthVal).collection('routes');
                const routeData = await _loadFromFirestore(col, routeList, routeVal);
                UI.hideLoader();
                ExportCtrl._writeExcel(routeData, `History_${monthVal}`);
                return;
            }

            // ─── Current (default) — ใช้ State ────────────────────────
            const routeData = {};
            if (routeVal === 'ALL') Object.assign(routeData, State.db.routes);
            else routeData[routeVal] = State.db.routes[routeVal] || [];
            const label = App._planMode === 'active' ? 'Active' :
                App._planMode.startsWith('draft:')   ? 'Draft_'   + App._planMode.replace('draft:','') :
                                                       'History_' + App._planMode.replace('history:','');
            ExportCtrl._writeExcel(routeData, label);

        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ Export ไม่สำเร็จ: ' + err.message);
        }
    },

    _writeExcel: (routeData, label) => {
        const allStores = [];
        Object.entries(routeData).forEach(([routeName, stores]) => {
            (stores || []).forEach(s => {
                allStores.push({
                    'Route':           routeName,
                    'CY':              s.cy || '',
                    'รหัส':            s.id,
                    'ชื่อ':            s.name,
                    'Sales':           s.salesCode || '',
                    'ประเภทร้านค้า1':  s.shopType || '',
                    'Sold To City':    s.subDistrict || '',
                    'Sold To State':   s.district || '',
                    'Address 5':       s.province || '',
                    'Latitude':        s.lat,
                    'Longitude':       s.lng,
                    'ชื่อตลาด':        s.marketName || '',
                    'Day':             s.days && s.days.length > 0 ? s.days[0] : '',
                    'seq':             (() => {
                        const d0 = s.days && s.days.length > 0 ? s.days[0] : '';
                        return (s.seqs && d0 && s.seqs[d0] !== undefined) ? s.seqs[d0] : '';
                    })()
                });
            });
        });

        if (!allStores.length) return UI.showErrorToast('ไม่มีข้อมูลให้โหลดครับ');

        allStores.sort((a, b) => {
            if (a['Route'] !== b['Route']) return a['Route'].localeCompare(b['Route'], 'th', { numeric: true });
            const da = a['Day'] ? parseInt(String(a['Day']).replace('Day ', '')) : 999;
            const db2 = b['Day'] ? parseInt(String(b['Day']).replace('Day ', '')) : 999;
            return da - db2;
        });

        const ws = XLSX.utils.json_to_sheet(allStores, {
            header: ['Route','CY','รหัส','ชื่อ','Sales','ประเภทร้านค้า1','Sold To City','Sold To State','Address 5','Latitude','Longitude','ชื่อตลาด','Day','seq']
        });
        ws['!cols'] = [
            {wch:10},{wch:14},{wch:12},{wch:40},{wch:10},{wch:10},
            {wch:18},{wch:18},{wch:14},{wch:14},{wch:14},{wch:30},{wch:6},{wch:6}
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'RoutePlan');
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        XLSX.writeFile(wb, `RoutePlan_${label}_${dateStr}.xlsx`);
        UI.showSaveToast(`✅ Export ${allStores.length} ร้าน เรียบร้อย`);
    },

    // backward compat สำหรับ ExcelIO.export() เดิม
    exportCurrent: () => {
        const routeData = { [State.localActiveRoute]: State.stores };
        ExportCtrl._writeExcel(routeData, State.localActiveRoute);
    }
};

// ==========================================
// 🗓️ ฟังก์ชัน utility — แปลง YYYY_MM → ไทย
// ==========================================
const DateUtil = {
    // แปลง YYYY_MM → "มิถุนายน 2569" (พ.ศ.)
    ymToThai: (ym) => {
        if (!ym) return '';
        const [y, m] = ym.split('_');
        const d = new Date(+y, +m - 1, 1);
        return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
    },
    // แปลง YYYY_MM → "มิ.ย. 2569"
    ymToThaiShort: (ym) => {
        if (!ym) return '';
        const [y, m] = ym.split('_');
        const d = new Date(+y, +m - 1, 1);
        return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
    },
    // YYYY_MM ของเดือนปัจจุบัน
    currentYM: () => {
        const d = new Date();
        return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
    }
};

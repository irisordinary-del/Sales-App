

// ==========================================
// 📊 Excel Export
// ==========================================
const ExcelIO = {
    export: () => {
                if (!State.stores.length) return UI.showErrorToast('ไม่มีข้อมูลให้โหลดครับ');

                // Export 12 columns (A-L) matching uploaded file format exactly
                const exportData = State.stores.map(s => {
                                // Try to get original row data from rawData
                                const rawRow = (State.rawData || []).find(r =>
                                                    String(r['รหัส'] || r['B'] || '').trim() === String(s.id)
                                                                                      ) || {};

                                return {
                                                    'CY': s.cy || '',
                                                    'รหัส': s.id,
                                                    'ชื่อ': s.name,
                                                    'Sales': s.salesCode || '',
                                                    'ประเภทร้านค้า1': s.shopType || '',
                                                    'Sold To City': s.subDistrict || '',
                                                    'Sold To State': s.district || '',
                                                    'Address 5': s.province || '',
                                                    'Latitude': s.lat,
                                                    'Longtitude': s.lng,
                                                    'ชื่อตลาด': s.marketName || '',
                                                    'Day': s.days && s.days.length > 0 ? s.days[0] : (rawRow['Day'] || rawRow['L'] || ''),
                                    'seq': (() => { const d0 = s.days && s.days.length > 0 ? s.days[0] : (rawRow['Day'] || rawRow['L'] || ''); return (s.seqs && d0 && s.seqs[d0] !== undefined) ? s.seqs[d0] : ''; })()
                                };
                });

                // Sort by Day number
                exportData.sort((a, b) => {
                                const da = a['Day'] && a['Day'] !== '' ? parseInt(String(a['Day']).replace('Day ', '')) : 999;
                                const db = b['Day'] && b['Day'] !== '' ? parseInt(String(b['Day']).replace('Day ', '')) : 999;
                                return da - db;
                });

                // Create worksheet with 12 columns matching upload format
                const ws = XLSX.utils.json_to_sheet(exportData, {
                                header: ['CY', 'รหัส', 'ชื่อ', 'Sales', 'ประเภทร้านค้า1', 'Sold To City', 'Sold To State', 'Address 5', 'Latitude', 'Longtitude', 'ชื่อตลาด', 'Day', 'seq']
                });

                // Set column widths
                ws['!cols'] = [
                    { wch: 14 }, // CY
                    { wch: 12 }, // รหัส
                    { wch: 40 }, // ชื่อ
                    { wch: 10 }, // Sales
                    { wch: 8  }, // ประเภทร้านค้า1
                    { wch: 18 }, // Sold To City
                    { wch: 18 }, // Sold To State
                    { wch: 14 }, // Address 5
                    { wch: 14 }, // Latitude
                    { wch: 14 }, // Longtitude
                    { wch: 30 }, // ชื่อตลาด
                    { wch: 6  }, // Day
                    { wch: 6  }  // seq
                            ];

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'RoutePlan');

                const now = new Date();
                const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
                XLSX.writeFile(wb, `Route_${State.localActiveRoute}_${dateStr}.xlsx`);
    }
};

// ==========================================
// 🚀 App Controller
// ==========================================
const App = {
    dbRef:      cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main'),
    routesCol:  () => cloudDB.collection('appData').doc(window.CENTER_DOC || 'v1_main').collection('routes'),

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
        await Promise.all(routeList.map(name =>
            App.routesCol().doc(name).get()
                .then(d => { State.db.routes[name] = d.exists ? (d.data().stores || []) : []; })
                .catch(() => { State.db.routes[name] = []; })
        ));
    },

    init: () => {

        MapCtrl.init();
        UI.showLoader('กำลังเชื่อมต่อ...', '');

        App.dbRef.onSnapshot(async (doc) => {
            const d = doc.exists ? doc.data() : {};
            State.db.cycleDays = d.cycleDays || 24;

            // ✅ ตรวจสอบ: มีข้อมูลเก่า (routes map) → migrate อัตโนมัติ
            if (d.routes && typeof d.routes === 'object' && Object.keys(d.routes).length > 0) {
                State.db.routeList = Object.keys(d.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
                await App._migrate(d.routes);
                return; // รอ onSnapshot trigger รอบถัดไปหลัง migration
            }

            // โครงสร้างใหม่: routeList ใน metadata
            State.db.routeList = (d.routeList || ['สายที่ 1'])
                .sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            await App._loadAllRoutes(State.db.routeList);

            if (!State.localActiveRoute || !State.db.routes[State.localActiveRoute]) {
                State.localActiveRoute = localStorage.getItem('last_viewed_route') || State.db.routeList[0];
            }
            State.stores = State.db.routes[State.localActiveRoute] || [];

            App.fetchSalesData();
        }, (err) => {
            console.error('Firestore error:', err);
            UI.hideLoader();
            UI.showErrorToast('⚠️ ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
        });


        const fileUpload = document.getElementById('fileUpload');
        if (fileUpload) {
            fileUpload.addEventListener('change', App.handleMapUpload);
        }
    },

    fetchRawData: () => {
        cloudDB.collection('v1_raw_chunks').get().then(snap => {
            let raw = [];
            snap.forEach(doc => { raw = raw.concat(doc.data().rows || []); });
            State.rawData = raw;
        }).catch(err => console.warn('โหลด rawData ไม่สำเร็จ:', err));
    },

    fetchSalesData: () => {
        cloudDB.collection('v1_sales_chunks').get().then(snap => {
            const merged = {};
            snap.forEach(doc => { Object.assign(merged, doc.data()); });
            State.sales = merged;
            App.sync();
            UI.hideLoader();
        }).catch(err => {
            console.warn('โหลด salesData ไม่สำเร็จ:', err);
            App.sync();
            UI.hideLoader();
        });
    },

    // ✅ saveDB: บันทึกทีละสายใน subcollection (ไม่เกิน 1MB ต่อสาย)
    saveDB: () => {
        State.db.routes[State.localActiveRoute] = State.stores;
        const routeList = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
        Promise.all([
            App.routesCol().doc(State.localActiveRoute).set({ stores: State.stores }),
            App.dbRef.update({ routeList, cycleDays: State.db.cycleDays || 24 })
        ])
        .then(() => UI.showSaveToast('💾 บันทึกเรียบร้อย'))
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
        UI.switchTab('tab1');  // แก้บัค: reset tab กลับต้นเสมอ
        UI.render();
    },

    switchRoute: (name) => {
        if (State.localActiveRoute === name) return;
        State.localActiveRoute = name;
        localStorage.setItem('last_viewed_route', name);
        // ถ้า route นี้ยังไม่ได้โหลด → ดึงจาก Firestore
        if (State.db.routes[name] === undefined) {
            UI.showLoader('กำลังโหลดสาย ' + name + '...');
            App.routesCol().doc(name).get().then(d => {
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
        const n = prompt('ชื่อสายใหม่:');
        if (n && n.trim()) {
            State.db.routes[n.trim()] = [];
            State.localActiveRoute = n.trim();
            State.stores = [];
            App.sync();
            App.saveDB();
        }
    },

    renameRoute: () => {
        const n = prompt('ชื่อใหม่:', State.localActiveRoute);
        if (n && n.trim()) {
            const oldName = State.localActiveRoute;
            const newName = n.trim();
            State.db.routes[newName] = State.db.routes[oldName];
            delete State.db.routes[oldName];
            State.localActiveRoute = newName;
            App.sync();
            const routeList = Object.keys(State.db.routes).sort((a,b) => a.localeCompare(b,'th',{numeric:true}));
            // ✅ ลบ doc เก่า + สร้าง doc ใหม่ + อัปเดต routeList
            Promise.all([
                App.routesCol().doc(oldName).delete(),
                App.routesCol().doc(newName).set({ stores: State.db.routes[newName] || [] }),
                App.dbRef.update({ routeList })
            ])
            .then(() => UI.showSaveToast('💾 เปลี่ยนชื่อสายเรียบร้อย'))
            .catch(err => UI.showErrorToast('❌ เปลี่ยนชื่อไม่สำเร็จ: ' + err.message));
        }
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

    clearStores: () => {
        if (!confirm('ล้างข้อมูลร้านค้าทั้งหมดในสายนี้?')) return;
        State.stores = [];
        MapCtrl.clearAll();
        App.sync();
        App.saveDB();
    },

    handleMapUpload: function (e) {
        const file = e.target.files[0];
        if (!file) return;

        if (State.stores.length > 0 && !confirm(`ข้อมูลเดิมของ "${State.localActiveRoute}" จะถูกแทนที่\nยืนยันการอัปโหลด?`)) {
            this.value = '';
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
                                        else if (h.includes('sales') && !h.includes('salescode')) salesCodeCol = i;
                                        else if (h.includes('salescode') || h.includes('รหัสเซลล์')) salesCodeCol = i;
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
                    const assignedDay = !isNaN(dayNum) ? 'Day ' + dayNum : '';
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
            
            if (UI && UI.showSaveToast) {
                UI.showSaveToast('✅ เคลียร์การจัดสายเสร็จ');
            } else {
                UI.showSaveToast('✅ เคลียร์การจัดสายเสร็จ');
            }
        } catch(err) {
            console.error('❌ Clear error:', err);
            UI.showErrorToast('❌ เกิดข้อผิดพลาด: ' + err.message);
        }
    }
};

// ==========================================
// 🔥 Firebase Chunk Manager
// แก้ปัญหา Firestore document limit 1MB
// วิธีใช้: แทนที่ App.saveDB() ด้วย ChunkDB.save()
//          และ App.loadDB() ด้วย ChunkDB.load()
// ==========================================

const CHUNK_SIZE = 200; // ร้านค้า/chunk (ปรับตาม field จำนวน)

const ChunkDB = {

    // ==========================================
    // บันทึกข้อมูลแบบ chunked (แทน 1 document ใหญ่)
    // ==========================================
    save: async (routeName) => {
        if (!State || !State.stores || !State.db) return;
        try {
            UI.showLoader('กำลังบันทึก...', 'แบ่งข้อมูลและบันทึกลง Firebase');

            const stores = State.stores;
            const meta = {
                cycleDays:   State.db.cycleDays || 24,
                updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
                totalStores: stores.length,
                totalChunks: Math.ceil(stores.length / CHUNK_SIZE),
                version:     2
            };

            const batch = cloudDB.batch();

            // บันทึก metadata document
            const metaRef = cloudDB.collection('routes').doc(routeName);
            batch.set(metaRef, meta);

            // ลบ chunks เก่าทั้งหมดก่อน
            const oldChunks = await cloudDB
                .collection('routes').doc(routeName)
                .collection('chunks').get();
            oldChunks.forEach(doc => batch.delete(doc.ref));

            await batch.commit();

            // บันทึก chunks ใหม่ (Firestore batch limit = 500 ops)
            const chunkCount = Math.ceil(stores.length / CHUNK_SIZE);
            for (let i = 0; i < chunkCount; i++) {
                const chunkStores = stores.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                const chunkRef = cloudDB
                    .collection('routes').doc(routeName)
                    .collection('chunks').doc(`chunk_${String(i).padStart(4, '0')}`);
                await chunkRef.set({
                    index:  i,
                    stores: chunkStores
                });
            }

            UI.hideLoader();
            UI.showSaveToast(`✅ บันทึกสำเร็จ (${stores.length} ร้าน / ${chunkCount} chunks)`);
            console.log(`✅ ChunkDB.save: ${stores.length} stores in ${chunkCount} chunks`);

        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ บันทึกไม่สำเร็จ: ' + err.message);
            console.error('ChunkDB.save error:', err);
        }
    },

    // ==========================================
    // โหลดข้อมูลแบบ chunked
    // ==========================================
    load: async (routeName) => {
        try {
            UI.showLoader('กำลังโหลด...', 'ดึงข้อมูลจาก Firebase');

            // โหลด metadata
            const metaDoc = await cloudDB.collection('routes').doc(routeName).get();
            if (!metaDoc.exists) {
                UI.hideLoader();
                return null;
            }
            const meta = metaDoc.data();

            // โหลด chunks ทั้งหมด (เรียงตาม index)
            const chunksSnap = await cloudDB
                .collection('routes').doc(routeName)
                .collection('chunks')
                .orderBy('index')
                .get();

            let allStores = [];
            chunksSnap.forEach(doc => {
                const data = doc.data();
                if (data.stores) allStores = allStores.concat(data.stores);
            });

            UI.hideLoader();
            console.log(`✅ ChunkDB.load: ${allStores.length} stores from ${chunksSnap.size} chunks`);
            return { ...meta, stores: allStores };

        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('❌ โหลดไม่สำเร็จ: ' + err.message);
            console.error('ChunkDB.load error:', err);
            return null;
        }
    },

    // ==========================================
    // Migrate: แปลงข้อมูลเก่า (1 document) → chunked
    // เรียกใช้ครั้งเดียวตอน migrate
    // ==========================================
    migrate: async (routeName) => {
        try {
            console.log('🔄 Starting migration for:', routeName);
            UI.showLoader('กำลัง Migrate...', 'แปลงข้อมูลเก่าเป็น format ใหม่');

            // อ่านข้อมูลเก่า
            const oldDoc = await cloudDB.collection('routes_v1').doc(routeName).get();
            if (!oldDoc.exists) {
                UI.hideLoader();
                return UI.showErrorToast('ไม่พบข้อมูลเก่า');
            }
            const oldData = oldDoc.data();
            if (State) {
                State.stores = oldData.stores || [];
                State.db.cycleDays = oldData.cycleDays || 24;
            }

            // บันทึกในรูปแบบใหม่
            await ChunkDB.save(routeName);
            UI.showSaveToast('✅ Migrate สำเร็จ!');

        } catch (err) {
            UI.hideLoader();
            UI.showErrorToast('Migration failed: ' + err.message);
        }
    }
};

// ==========================================
// วิธีใช้งาน:
//
// แทน:    await cloudDB.collection('routes').doc(routeName).set({ stores: [...] })
// ใช้:    await ChunkDB.save(routeName);
//
// แทน:    const doc = await cloudDB.collection('routes').doc(routeName).get();
// ใช้:    const data = await ChunkDB.load(routeName);
//
// รองรับ: ข้อมูลสูงสุดประมาณ 200 × 200 ร้าน = 40,000 ร้าน
// (ปรับ CHUNK_SIZE ขึ้น/ลงตามขนาด field แต่ละร้าน)
// ==========================================

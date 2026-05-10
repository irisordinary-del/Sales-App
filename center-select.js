// ==========================================
// 🏢 Center Selector Logic
// ==========================================

const db = firebase.firestore();
const CENTERS_DOC = db.collection('appData').doc('app_centers');

const App = {
    centers: {},

    init: () => {
        CENTERS_DOC.onSnapshot(doc => {
            App.centers = doc.exists ? (doc.data().centers || {}) : {};
            App.render();
        }, err => {
            console.error('Error loading centers:', err);
            App.renderError();
        });
    },

    render: () => {
        const grid = document.getElementById('center-grid');
        if (!grid) return;
        const ids = Object.keys(App.centers).sort();
        let html = ids.map(id => {
            const c = App.centers[id];
            return `
            <div class="center-card" onclick="App.select('${id}')">
                <div class="center-badge">${id}</div>
                <div class="center-name">${c.name || 'ศูนย์ ' + id}</div>
                <div class="center-routes">${c.routeCount || 0} สายวิ่ง</div>
            </div>`;
        }).join('');
        // ปุ่มเพิ่มศูนย์
        html += `
            <div class="center-card add-card" onclick="App.addCenter()">
                <div class="add-icon">+</div>
                <div class="center-name">เพิ่มศูนย์</div>
            </div>`;
        grid.innerHTML = html;

        // อัปเดต routeCount แบบ async
        ids.forEach(id => App.updateRouteCount(id));
    },

    updateRouteCount: async (id) => {
        try {
            const docId = App.centers[id].docId || (id + '_main');
            const meta  = await db.collection('appData').doc(docId).get();
            const count = meta.exists ? (meta.data().routeList || []).length : 0;
            const el    = document.querySelector(`.center-card[onclick="App.select('${id}')"] .center-routes`);
            if (el) el.textContent = count + ' สายวิ่ง';
            // cache
            App.centers[id].routeCount = count;
        } catch (e) { /* ไม่กระทบ UI */ }
    },

    select: (id) => {
        window.location.href = 'index.html?center=' + id;
    },

    addCenter: () => {
        const id = prompt('รหัสศูนย์ใหม่ (เช่น 406):');
        if (!id || !id.trim()) return;
        const centerId = id.trim();
        if (App.centers[centerId]) {
            alert('มีศูนย์นี้แล้วครับ');
            return;
        }
        const name = prompt('ชื่อศูนย์ (เช่น ศูนย์ 406):', 'ศูนย์ ' + centerId);
        if (name === null) return;

        const docId = centerId + '_main';

        // สร้าง document ใหม่สำหรับศูนย์นี้
        Promise.all([
            // สร้าง metadata document ของศูนย์
            db.collection('appData').doc(docId).set({
                routeList: [],
                cycleDays: 24,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }),
            // อัปเดต __centers__ metadata
            CENTERS_DOC.set({
                centers: {
                    ...App.centers,
                    [centerId]: { name: name || ('ศูนย์ ' + centerId), docId, routeCount: 0 }
                }
            }, { merge: true })
        ])
        .then(() => {
            alert('✅ สร้างศูนย์ ' + centerId + ' เรียบร้อยแล้วครับ');
            App.select(centerId); // ไปที่ศูนย์ใหม่เลย
        })
        .catch(err => alert('❌ สร้างไม่สำเร็จ: ' + err.message));
    },

    renderError: () => {
        const grid = document.getElementById('center-grid');
        if (grid) grid.innerHTML = '<p style="color:red">⚠️ โหลดข้อมูลไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต</p>';
    }
};

window.addEventListener('DOMContentLoaded', App.init);

// ✅ Toast helper — แทน alert()
function _csToast(msg, isError = false) {
    let t = document.getElementById('_cs-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = '_cs-toast';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;color:#fff;z-index:99999;transition:transform 0.3s,opacity 0.3s;opacity:0;font-family:Prompt,sans-serif;max-width:90vw;text-align:center;';
        document.body.appendChild(t);
    }
    t.style.background = isError ? '#dc2626' : '#111827';
    t.textContent = msg;
    t.style.transform = 'translateX(-50%) translateY(0)';
    t.style.opacity = '1';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(80px)'; t.style.opacity = '0'; }, 3000);
}

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

    // ✅ FIX (2026-07-12): เดิมใช้ prompt() ของเบราว์เซอร์ดิบๆ 2 รอบ — หน้าตาไม่ตรงกับ
    // ดีไซน์แอป, ไม่มี validation feedback (พิมพ์รหัสศูนย์ผิดฟอร์แมตก็สร้างไปเลยเงียบๆ)
    // เปลี่ยนเป็น modal ในธีมเดียวกับแอป พร้อมเช็ครูปแบบก่อนกดสร้างจริง
    addCenter: () => {
        const existing = document.getElementById('_cs-add-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = '_cs-add-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:#1e293b;border:1px solid rgba(99,102,241,0.25);border-radius:20px;padding:28px;max-width:360px;width:100%;font-family:Prompt,sans-serif;">
                <h3 style="font-size:16px;font-weight:800;color:#f8fafc;margin:0 0 4px;">➕ เพิ่มศูนย์ใหม่</h3>
                <p style="font-size:12px;color:#64748b;margin:0 0 18px;">รหัสศูนย์ควรเป็นตัวเลข เช่น 406</p>

                <label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:6px;">รหัสศูนย์ *</label>
                <input id="_cs-add-id" type="text" placeholder="เช่น 406" maxlength="10"
                    style="width:100%;box-sizing:border-box;padding:10px 14px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;font-weight:700;outline:none;margin-bottom:6px;">
                <div id="_cs-add-id-err" style="font-size:11px;color:#f87171;min-height:16px;margin-bottom:10px;"></div>

                <label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:6px;">ชื่อศูนย์</label>
                <input id="_cs-add-name" type="text" placeholder="เช่น ศูนย์ 406"
                    style="width:100%;box-sizing:border-box;padding:10px 14px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;font-weight:600;outline:none;margin-bottom:20px;">

                <div style="display:flex;gap:10px;">
                    <button id="_cs-add-cancel" style="flex:1;padding:10px;border-radius:10px;border:1px solid #334155;background:transparent;color:#94a3b8;font-weight:700;font-size:13px;cursor:pointer;">ยกเลิก</button>
                    <button id="_cs-add-confirm" style="flex:1;padding:10px;border-radius:10px;border:none;background:#6366f1;color:#fff;font-weight:700;font-size:13px;cursor:pointer;">สร้างศูนย์</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const idInput   = document.getElementById('_cs-add-id');
        const nameInput = document.getElementById('_cs-add-name');
        const errEl     = document.getElementById('_cs-add-id-err');
        idInput.focus();

        const close = () => modal.remove();
        document.getElementById('_cs-add-cancel').onclick = close;
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        document.getElementById('_cs-add-confirm').onclick = () => App._confirmAddCenter(idInput, nameInput, errEl, close);
        [idInput, nameInput].forEach(inp => inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') App._confirmAddCenter(idInput, nameInput, errEl, close);
            if (e.key === 'Escape') close();
        }));
    },

    _confirmAddCenter: (idInput, nameInput, errEl, close) => {
        const centerId = idInput.value.trim();

        // ✅ Validation ที่ prompt() เดิมไม่มีเลย — กันพิมพ์ผิด/ช่องว่าง/อักขระแปลกๆ
        if (!centerId) {
            errEl.textContent = '⚠️ กรุณากรอกรหัสศูนย์';
            return;
        }
        if (!/^[a-zA-Z0-9]+$/.test(centerId)) {
            errEl.textContent = '⚠️ รหัสศูนย์ใช้ได้แค่ตัวอักษร/ตัวเลขเท่านั้น ห้ามมีช่องว่างหรืออักขระพิเศษ';
            return;
        }
        if (App.centers[centerId]) {
            errEl.textContent = '⚠️ มีศูนย์รหัสนี้อยู่แล้ว';
            return;
        }
        errEl.textContent = '';

        const name   = nameInput.value.trim() || ('ศูนย์ ' + centerId);
        const docId  = centerId + '_main';

        const confirmBtn = document.getElementById('_cs-add-confirm');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'กำลังสร้าง...';

        Promise.all([
            db.collection('appData').doc(docId).set({
                routeList: [],
                cycleDays: 24,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }),
            CENTERS_DOC.set({
                centers: {
                    ...App.centers,
                    [centerId]: { name, docId, routeCount: 0 }
                }
            }, { merge: true })
        ])
        .then(() => {
            close();
            _csToast('✅ สร้างศูนย์ ' + centerId + ' เรียบร้อยแล้วครับ');
            App.select(centerId); // ไปที่ศูนย์ใหม่เลย
        })
        .catch(err => {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'สร้างศูนย์';
            // ✅ ใช้ ErrorMsg ถ้ามี (โหลดจาก app-config-init.js) ไม่งั้น fallback ข้อความทั่วไป
            const msg = (typeof ErrorMsg !== 'undefined') ? ErrorMsg.translate(err) : 'กรุณาลองใหม่อีกครั้ง';
            errEl.textContent = '❌ สร้างไม่สำเร็จ: ' + msg;
        });
    },

    renderError: () => {
        const grid = document.getElementById('center-grid');
        if (grid) grid.innerHTML = '<p style="color:red">⚠️ โหลดข้อมูลไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต</p>';
    }
};

window.addEventListener('DOMContentLoaded', App.init);

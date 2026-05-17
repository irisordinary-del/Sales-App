// ==========================================
// 📱 PWA Register — Service Worker + Install prompt
// โหลดในทุกหน้า: login.html, index.html, sales.html, center-select.html
// ==========================================

const PWA = {

    _deferredPrompt: null,   // install prompt event
    _swRegistration: null,

    // ─── Register Service Worker ──────────────────────────────────────────
    init: () => {
        if (!('serviceWorker' in navigator)) {
            console.log('[PWA] Service Worker ไม่รองรับ browser นี้');
            return;
        }

        // Register SW
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => {
                PWA._swRegistration = reg;
                console.log('[PWA] SW registered:', reg.scope);

                // ตรวจสอบ update ทุกครั้งที่ load
                reg.update();

                // มี SW ใหม่รอ activate → แจ้ง user
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            PWA._showUpdateBanner();
                        }
                    });
                });
            })
            .catch(e => console.warn('[PWA] SW register failed:', e.message));

        // ตรวจ controller change (หลัง skip waiting) → reload
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });

        // ─── Install prompt ─────────────────────────────────────────────
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            PWA._deferredPrompt = e;
            PWA._showInstallBtn();
        });

        // ─── installed ─────────────────────────────────────────────────
        window.addEventListener('appinstalled', () => {
            PWA._deferredPrompt = null;
            PWA._hideInstallBtn();
            console.log('[PWA] App installed!');
        });
    },

    // ─── Install ─────────────────────────────────────────────────────────
    install: async () => {
        if (!PWA._deferredPrompt) return;
        PWA._deferredPrompt.prompt();
        const { outcome } = await PWA._deferredPrompt.userChoice;
        console.log('[PWA] Install outcome:', outcome);
        PWA._deferredPrompt = null;
        PWA._hideInstallBtn();
    },

    // ─── Update ─────────────────────────────────────────────────────────
    update: () => {
        if (PWA._swRegistration?.waiting) {
            PWA._swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
    },

    // ─── Show/Hide install button ─────────────────────────────────────────
    _showInstallBtn: () => {
        // ถ้ามี #pwa-install-btn อยู่แล้วให้แสดง
        const btn = document.getElementById('pwa-install-btn');
        if (btn) { btn.classList.remove('hidden'); return; }

        // สร้างปุ่ม floating install
        const el = document.createElement('div');
        el.id = 'pwa-install-btn';
        el.style.cssText = [
            'position:fixed', 'bottom:80px', 'right:16px', 'z-index:9998',
            'background:linear-gradient(135deg,#6366f1,#4f46e5)',
            'color:#fff', 'padding:10px 16px', 'border-radius:14px',
            'font-family:Prompt,sans-serif', 'font-size:12px', 'font-weight:700',
            'cursor:pointer', 'box-shadow:0 4px 20px rgba(99,102,241,0.45)',
            'display:flex', 'align-items:center', 'gap:8px',
            'transition:opacity 0.3s', 'user-select:none',
        ].join(';');
        el.innerHTML = '📱 ติดตั้งแอป';
        el.onclick = PWA.install;
        document.body.appendChild(el);
    },

    _hideInstallBtn: () => {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.remove();
    },

    // ─── Update banner ───────────────────────────────────────────────────
    _showUpdateBanner: () => {
        if (document.getElementById('pwa-update-banner')) return;
        const el = document.createElement('div');
        el.id = 'pwa-update-banner';
        el.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
            'background:#1e40af', 'color:#fff',
            'padding:10px 16px',
            'display:flex', 'align-items:center', 'justify-content:space-between',
            'font-family:Prompt,sans-serif', 'font-size:13px', 'font-weight:700',
            'box-shadow:0 2px 12px rgba(0,0,0,0.3)',
        ].join(';');
        el.innerHTML = `
            <span>🔄 มีการอัปเดตระบบใหม่พร้อมแล้ว</span>
            <div style="display:flex;gap:8px;">
                <button onclick="PWA.update()" style="background:#fff;color:#1e40af;border:none;border-radius:8px;padding:5px 14px;font-size:12px;font-weight:800;cursor:pointer;">รีโหลด</button>
                <button onclick="this.parentElement.parentElement.remove()" style="background:transparent;color:#93c5fd;border:none;font-size:18px;cursor:pointer;padding:0 4px;">✕</button>
            </div>`;
        document.body.prepend(el);
    },

    // ─── Cache utilities (เรียกจาก admin UI) ─────────────────────────────
    clearCache: () => {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
        }
        // ล้าง SW cache โดยตรงด้วย (กัน race)
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => console.log('[PWA] Cache cleared'));
    },

    getCacheInfo: () => {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_SIZE' });
        }
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data?.type === 'CACHE_SIZE') {
                console.log('[PWA] Cache info:', e.data);
            }
        }, { once: true });
    },

    // ─── isInstalled helper ───────────────────────────────────────────────
    isInstalled: () => {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
    },
};

// Auto-init
document.addEventListener('DOMContentLoaded', () => PWA.init());

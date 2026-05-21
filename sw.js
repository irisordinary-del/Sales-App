// ==========================================
// 🔧 Service Worker — Route Planner PWA
// Strategy:
//   Static assets  → Cache First (offline OK)
//   Firebase API   → Network Only (Firestore จัดการ offline เอง)
//   CDN libs       → Cache First + background update
//   Tiles (maps)   → Stale-While-Revalidate
// ==========================================

const CACHE_VERSION = 'rp-v4';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const TILE_CACHE    = `${CACHE_VERSION}-tiles`;
const CDN_CACHE     = `${CACHE_VERSION}-cdn`;

// ── ไฟล์ที่ต้อง cache ไว้ทำงาน offline ──────────────────────────────────
const STATIC_ASSETS = [
    '/',
    '/login.html',
    '/sales.html',
    '/index.html',
    '/center-select.html',
    '/users.html',
    // Styles
    '/admin-style.css',
    '/sales-style.css',
    // Scripts
    '/app-config.js',
    '/app-config-init.js',
    '/auth.js',
    '/admin-data.js',
    '/admin-ui.js',
    '/admin-map.js',
    '/admin-ai.js',
    '/dashboard.js',
    '/file-manager.js',
    '/firebase-chunks.js',
    '/sku-distribution.js',
    '/store-history.js',
    '/users.js',
    '/center-select.js',
    '/sales-app.js',
    '/sales-dashboard.js',
    '/pwa-register.js',
    '/audit-log.js',
    // Icons
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/manifest.json',
];

// ── CDN ที่ต้อง cache ──────────────────────────────────────────────────────
const CDN_ORIGINS = [
    'cdn.tailwindcss.com',
    'unpkg.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
];

// ── Firebase / Firestore → ห้าม intercept (Firestore offline ดูแลเอง) ──────
const BYPASS_ORIGINS = [
    'firebaseio.com',
    'googleapis.com',
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'gstatic.com',
];

// ── Map tiles → Stale-While-Revalidate ────────────────────────────────────
const TILE_ORIGINS = [
    'tile.openstreetmap.org',
    'a.tile.openstreetmap.org',
    'b.tile.openstreetmap.org',
    'c.tile.openstreetmap.org',
];

// ============================================================
// INSTALL — pre-cache static assets
// ============================================================
self.addEventListener('install', (event) => {
    console.log('[SW] Installing', CACHE_VERSION);
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                // ใช้ addAll แบบ individual ไม่ให้ล้มทั้งหมดถ้า 1 ไฟล์ fail
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(e =>
                            console.warn('[SW] cache.add failed:', url, e.message)
                        )
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ============================================================
// ACTIVATE — ลบ cache เก่า
// ============================================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating', CACHE_VERSION);
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(k => k.startsWith('rp-') && k !== STATIC_CACHE && k !== TILE_CACHE && k !== CDN_CACHE)
                    .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
            ))
            .then(() => self.clients.claim())
    );
});

// ============================================================
// FETCH — routing strategy
// ============================================================
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // ── 1. bypass Firebase / Firestore / Google APIs ─────────────────────
    if (BYPASS_ORIGINS.some(o => url.hostname.includes(o))) {
        return; // ปล่อยผ่าน browser ปกติ
    }

    // ── 2. Map tiles → Stale-While-Revalidate ─────────────────────────────
    if (TILE_ORIGINS.some(o => url.hostname.includes(o))) {
        event.respondWith(staleWhileRevalidate(event.request, TILE_CACHE, 200));
        return;
    }

    // ── 3. CDN libs → Cache First (อัปเดตเบื้องหลัง) ─────────────────────
    if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
        event.respondWith(cacheFirstWithUpdate(event.request, CDN_CACHE));
        return;
    }

    // ── 4. Static assets (same-origin) → Cache First ──────────────────────
    if (url.origin === self.location.origin) {
        // ข้าม POST / non-GET
        if (event.request.method !== 'GET') return;
        event.respondWith(cacheFirst(event.request, STATIC_CACHE));
        return;
    }

    // ── 5. อื่นๆ → Network Only ───────────────────────────────────────────
    // (ไม่ทำอะไร — browser จัดการเอง)
});

// ============================================================
// Strategy helpers
// ============================================================

/** Cache First: เปิดจาก cache ถ้ามี มิฉะนั้น network แล้ว cache ไว้ */
async function cacheFirst(request, cacheName) {
    const cache    = await caches.open(cacheName);
    const cached   = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (e) {
        // offline + ไม่มี cache → return offline fallback
        return offlineFallback(request);
    }
}

/** Cache First + background update (CDN libs) */
async function cacheFirstWithUpdate(request, cacheName) {
    const cache  = await caches.open(cacheName);
    const cached = await cache.match(request);

    // อัปเดตเบื้องหลัง
    const fetchPromise = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => null);

    return cached || fetchPromise;
}

/** Stale-While-Revalidate: ส่ง cache ทันที แล้วอัปเดตเบื้องหลัง */
async function staleWhileRevalidate(request, cacheName, maxAgeSec = 3600) {
    const cache  = await caches.open(cacheName);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request)
        .then(response => {
            if (response.ok) {
                const clone = response.clone();
                cache.put(request, clone);
            }
            return response;
        })
        .catch(() => cached);

    // ถ้ามี cache และยังไม่หมดอายุ → ส่งทันที
    if (cached) {
        const dateHeader = cached.headers.get('date');
        if (dateHeader) {
            const age = (Date.now() - new Date(dateHeader).getTime()) / 1000;
            if (age < maxAgeSec) return cached;
        } else {
            return cached; // ไม่มี date header → ส่ง cache เลย
        }
    }

    return fetchPromise;
}

/** Offline fallback page */
async function offlineFallback(request) {
    const url = new URL(request.url);
    // ส่ง HTML offline page สำหรับ navigation request
    if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
        return new Response(
            `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ออฟไลน์ — Route Planner</title>
<style>
  body { font-family: sans-serif; background:#0f172a; color:#e2e8f0; display:flex; height:100vh; align-items:center; justify-content:center; flex-direction:column; gap:16px; margin:0; }
  .icon { font-size:64px; }
  h1 { font-size:20px; font-weight:800; color:#f8fafc; margin:0; }
  p  { font-size:13px; color:#94a3b8; margin:0; text-align:center; }
  button { margin-top:8px; background:#6366f1; color:#fff; border:none; border-radius:12px; padding:12px 28px; font-size:14px; font-weight:700; cursor:pointer; }
</style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>ไม่มีอินเทอร์เน็ต</h1>
  <p>กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
  <button onclick="location.reload()">ลองอีกครั้ง</button>
</body>
</html>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
}

// ============================================================
// Message handler — รับ command จาก app
// ============================================================
self.addEventListener('message', (event) => {
    if (!event.data) return;

    switch (event.data.type) {
        // ── SKIP_WAITING: อัปเดต SW ทันที ──────────────────────────────
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;

        // ── CACHE_URLS: เพิ่ม URL เข้า cache ────────────────────────────
        case 'CACHE_URLS':
            if (event.data.urls) {
                caches.open(STATIC_CACHE).then(cache => {
                    cache.addAll(event.data.urls).catch(e =>
                        console.warn('[SW] CACHE_URLS failed:', e)
                    );
                });
            }
            break;

        // ── CLEAR_CACHE: ล้าง cache ทั้งหมด ─────────────────────────────
        case 'CLEAR_CACHE':
            caches.keys().then(keys =>
                Promise.all(keys.map(k => caches.delete(k)))
            ).then(() => {
                if (event.source) {
                    event.source.postMessage({ type: 'CACHE_CLEARED' });
                }
            });
            break;

        // ── GET_CACHE_SIZE: รายงาน cache stats ───────────────────────────
        case 'GET_CACHE_SIZE':
            (async () => {
                let totalBytes = 0;
                const keys = await caches.keys();
                for (const k of keys) {
                    const c = await caches.open(k);
                    const reqs = await c.keys();
                    totalBytes += reqs.length * 512; // ประมาณ
                }
                if (event.source) {
                    event.source.postMessage({
                        type: 'CACHE_SIZE',
                        caches: keys,
                        approxKB: Math.round(totalBytes / 1024),
                    });
                }
            })();
            break;
    }
});

console.log('[SW] Service Worker loaded:', CACHE_VERSION);

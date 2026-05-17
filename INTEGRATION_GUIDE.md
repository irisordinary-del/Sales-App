# ==========================================
# 📋 วิธีใส่ Session 3 เข้า HTML ทุกไฟล์
# ==========================================

# ── 1. ใส่ใน <head> ทุกหน้า (login.html, index.html, sales.html, center-select.html, users.html) ──

    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#6366f1">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="RoutePlan">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">


# ── 2. ใส่ก่อน </body> ทุกหน้า ──

    <script src="/pwa-register.js"></script>


# ── 3. ใส่ใน index.html ก่อน </body> (Admin app เท่านั้น) ──

    <script src="/audit-log.js"></script>


# ── 4. เพิ่ม nav item ใน sidebar ของ index.html ──

    <!-- ใส่ใน sidebar menu (ข้าง nav-skudist) -->
    <button id="nav-auditlog" onclick="Nav.go('auditlog')"
        class="sidebar-menu flex items-center gap-3 px-4 py-3 w-full text-left text-sm font-bold">
        📋 Audit Log
    </button>


# ── 5. เพิ่ม page div ใน index.html (ข้าง page-skudist) ──

    <div id="page-auditlog" class="app-page hidden flex-col overflow-hidden">
        <!-- AuditLog.renderPage() จะ inject UI เข้ามาเมื่อ Nav.go('auditlog') -->
    </div>


# ── 6. อัปเดต Nav.go() ใน admin-ui.js ให้รองรับ 'auditlog' ──
# เพิ่มเงื่อนไขนี้ใน Nav.go():

    if (page === 'auditlog') {
        if (typeof AuditLog !== 'undefined') AuditLog.renderPage();
    }


# ── 7. Firestore Rules — เพิ่ม rule สำหรับ auditLogs ──
# (ดู firestore.rules ที่สร้างใหม่)

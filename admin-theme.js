// ==========================================
// 🎨 AdminTheme — สลับโหมดสว่าง/มืด ใช้ร่วมกันทุกหน้า Admin/Supervisor
// (ไม่รวม login.html / center-select.html — 2 หน้านั้นเป็นธีมมืดคงที่ตามที่ต้องการ)
// ==========================================
const AdminTheme = {
    KEY: 'admin_theme', // 'light' | 'dark'

    // เรียกให้เร็วที่สุด (ก่อน Tailwind ประมวลผล class) เพื่อกันหน้าจอกระพริบผิดธีมตอนโหลด
    init: () => {
        const saved = localStorage.getItem(AdminTheme.KEY) || 'light';
        document.documentElement.classList.toggle('dark', saved === 'dark');
    },

    toggle: () => {
        const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        localStorage.setItem(AdminTheme.KEY, next);
        document.documentElement.classList.toggle('dark', next === 'dark');
        AdminTheme.syncButton();
        // แจ้งหน้าเพจที่มีเนื้อหาสร้างด้วย inline style (สี hex ตรงๆ ไม่ใช่ Tailwind class)
        // ให้มีโอกาส re-render ตัวเองใหม่ตามธีมล่าสุด เช่น ปฏิทินใน tasks.js
        document.dispatchEvent(new CustomEvent('admin-theme-change', { detail: { theme: next } }));
    },

    // ไอคอนพระอาทิตย์/พระจันทร์แบบ inline SVG — แทน emoji ☀️/🌙 เดิม ให้ตรงกับสไตล์
    // "Clean Operations" ที่เลิกใช้ emoji ในหน้า chrome แล้ว (ดู admin-ui.js AdminIcons)
    _ICON_SUN:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>',
    _ICON_MOON: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',

    // อัปเดตหน้าตาปุ่มสวิตช์ให้ตรงกับโหมดปัจจุบัน — เรียกอีกทีหลัง AdminNav render ปุ่มเสร็จ
    syncButton: () => {
        const btn = document.getElementById('admin-theme-btn');
        if (!btn) return;
        const isDark = document.documentElement.classList.contains('dark');
        btn.innerHTML = isDark ? AdminTheme._ICON_SUN : AdminTheme._ICON_MOON;
        btn.title = isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';
    },
};

// รันทันทีตอนไฟล์ถูกโหลด (วางสคริปต์นี้ไว้ใน <head> ก่อน Tailwind CDN เสมอ)
AdminTheme.init();

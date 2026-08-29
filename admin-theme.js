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

    // อัปเดตหน้าตาปุ่มสวิตช์ให้ตรงกับโหมดปัจจุบัน — เรียกอีกทีหลัง AdminNav render ปุ่มเสร็จ
    syncButton: () => {
        const btn = document.getElementById('admin-theme-btn');
        if (!btn) return;
        const isDark = document.documentElement.classList.contains('dark');
        btn.textContent = isDark ? '☀️' : '🌙';
        btn.title = isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';
    },
};

// รันทันทีตอนไฟล์ถูกโหลด (วางสคริปต์นี้ไว้ใน <head> ก่อน Tailwind CDN เสมอ)
AdminTheme.init();

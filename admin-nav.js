// ==========================================
// 🧭 AdminNav — แถบเมนูสลับหน้า ใช้ร่วมกันทุกหน้า Admin/Supervisor
// เรียก AdminNav.render('users' | 'tasks' | 'index') หลัง DOM พร้อม (ต้องมี #admin-nav-root)
// อ่านสิทธิ์จาก Auth.getSession() เอง ไม่ผูกกับตัวแปร session ของแต่ละหน้า
// ==========================================
// ไอคอน inline SVG ของแต่ละเมนู — แทน emoji เดิม ให้ตรงกับสไตล์ "Clean Operations"
// ที่ใช้ทั่วทั้งแอปแล้ว (ดู index.html sidebar / admin-ui.js AdminIcons ชุดเดียวกัน)
const ADMIN_NAV_ICONS = {
    index: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z"/><circle cx="12" cy="9.5" r="2.3"/></svg>',
    users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    tasks: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="14" y2="15"/></svg>',
};

const AdminNav = {
    render: (activePage) => {
        const root = document.getElementById('admin-nav-root');
        if (!root) return;
        const session = (typeof Auth !== 'undefined') ? Auth.getSession() : null;
        if (!session) return;

        // เก็บ ?center= เดิมไว้เสมอตอนสลับหน้า (ถ้ามี) กัน Supervisor/Admin หลุด context ศูนย์ที่กำลังดู
        const params   = new URLSearchParams(window.location.search);
        const centerId = params.get('center') || session.centerId || (window.CENTER_ID || '');
        const q        = centerId ? ('?center=' + encodeURIComponent(centerId)) : '';

        const items = [
            { key: 'index', href: 'index.html' + q, icon: ADMIN_NAV_ICONS.index, label: 'วางแผนสาย' },
            { key: 'users', href: 'users.html',      icon: ADMIN_NAV_ICONS.users, label: 'Users',        roles: ['admin'] },
            { key: 'tasks', href: 'tasks.html' + q,  icon: ADMIN_NAV_ICONS.tasks, label: 'งานที่ต้องส่ง' },
        ].filter(it => !it.roles || it.roles.includes(session.role));

        const linksHtml = items.map(it => `
            <a href="${it.href}"
               class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap
                      ${it.key === activePage
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800'}">
                <span class="flex items-center">${it.icon}</span><span class="hidden sm:inline">${it.label}</span>
            </a>`).join('');

        root.innerHTML = `
            <div class="flex items-center gap-1">${linksHtml}</div>
            <button id="admin-theme-btn" onclick="AdminTheme.toggle()"
                class="w-8 h-8 shrink-0 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 transition flex items-center justify-center"
                title="สลับโหมดสว่าง/มืด"></button>
        `;
        if (typeof AdminTheme !== 'undefined') AdminTheme.syncButton();
    },
};

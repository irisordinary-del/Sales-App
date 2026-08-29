// ==========================================
// 🧭 AdminNav — แถบเมนูสลับหน้า ใช้ร่วมกันทุกหน้า Admin/Supervisor
// เรียก AdminNav.render('users' | 'tasks' | 'index') หลัง DOM พร้อม (ต้องมี #admin-nav-root)
// อ่านสิทธิ์จาก Auth.getSession() เอง ไม่ผูกกับตัวแปร session ของแต่ละหน้า
// ==========================================
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
            { key: 'index', href: 'index.html' + q, icon: '🗺️', label: 'วางแผนสาย' },
            { key: 'users', href: 'users.html',      icon: '👥', label: 'Users',        roles: ['admin'] },
            { key: 'tasks', href: 'tasks.html' + q,  icon: '📌', label: 'งานที่ต้องส่ง' },
        ].filter(it => !it.roles || it.roles.includes(session.role));

        const linksHtml = items.map(it => `
            <a href="${it.href}"
               class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap
                      ${it.key === activePage
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800'}">
                <span>${it.icon}</span><span class="hidden sm:inline">${it.label}</span>
            </a>`).join('');

        root.innerHTML = `
            <div class="flex items-center gap-1">${linksHtml}</div>
            <button id="admin-theme-btn" onclick="AdminTheme.toggle()"
                class="w-8 h-8 shrink-0 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm transition flex items-center justify-center"
                title="สลับโหมดสว่าง/มืด">🌙</button>
        `;
        if (typeof AdminTheme !== 'undefined') AdminTheme.syncButton();
    },
};

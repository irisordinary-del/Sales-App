// ==========================================
// 🔐 Auth Module — Sales App
// SHA-256 + Firestore storage
// ==========================================

const Auth = {

    // ─── Constants ───────────────────────────────────────────────────────
    STORAGE_KEY: 'sales_app_session',
    USERS_DOC:   'appData/app_users',

    // Static salt — ป้องกัน rainbow table (เปลี่ยนค่านี้แล้วต้อง reset password ทุก user)
    _SALT: 'rp-2025-#!@route',

    // ─── SHA-256 (Web Crypto API — native browser, no library needed) ────
    sha256: async (text) => {
        const salted = Auth._SALT + text;
        const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // ─── Session ─────────────────────────────────────────────────────────
    getSession: () => {
        try {
            const raw = localStorage.getItem(Auth.STORAGE_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            // ตรวจ expiry
            if (s.expiresAt && Date.now() > s.expiresAt) {
                Auth.clearSession();
                return null;
            }
            // ตรวจ user-agent fingerprint (ป้องกัน token copy ข้าม browser)
            if (s.ua && s.ua !== navigator.userAgent.slice(0, 80)) {
                Auth.clearSession();
                return null;
            }
            return s;
        } catch { return null; }
    },

    SESSION_TTL: 8 * 60 * 60 * 1000, // 8 ชั่วโมง

    setSession: (user) => {
        localStorage.setItem(Auth.STORAGE_KEY, JSON.stringify({
            username:    user.username,
            role:        user.role,
            centerId:    user.centerId || null,
            centerDoc:   user.centerId ? (user.centerId + '_main') : null,
            displayName: user.displayName || user.username,
            loginAt:     Date.now(),
            expiresAt:   Date.now() + Auth.SESSION_TTL,
            ua:          navigator.userAgent.slice(0, 80) // fingerprint เบื้องต้น
        }));
    },

    clearSession: () => {
        localStorage.removeItem(Auth.STORAGE_KEY);
    },

    // ─── Guard — เรียกที่ต้นไฟล์ทุกหน้า ────────────────────────────────
    // allowedRoles: ['admin','supervisor','sales'] หรือ subset
    guard: (allowedRoles) => {
        const session = Auth.getSession();
        if (!session) {
            window.location.replace('login.html');
            return null;
        }
        if (allowedRoles && !allowedRoles.includes(session.role)) {
            // Sales / route_supervisor / asm พยายามเข้า admin → ส่งกลับ sales
            if (['sales','route_supervisor','asm'].includes(session.role)) {
                window.location.replace('sales.html');
            } else {
                window.location.replace('login.html');
            }
            return null;
        }
        return session;
    },

    // ─── Login ───────────────────────────────────────────────────────────
    login: async (username, password) => {
        if (!username || !password) throw new Error('กรุณากรอก username และ password');

        const hash = await Auth.sha256(password.trim());
        const uname = username.trim().toUpperCase();

        // โหลด users doc
        const db = firebase.firestore();
        const snap = await db.collection('appData').doc('app_users').get();

        if (!snap.exists) throw new Error('ไม่พบข้อมูล users กรุณาติดต่อ Admin');

        const users = snap.data().users || [];
        const user  = users.find(u => u.username.toUpperCase() === uname);

        if (!user)             throw new Error('ไม่พบ username นี้ในระบบ');
        if (!user.active)      throw new Error('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อ Admin');
        if (user.passwordHash !== hash) throw new Error('Password ไม่ถูกต้อง');

        Auth.setSession(user);
        return user;
    },

    logout: () => {
        Auth.clearSession();
        window.location.replace('login.html');
    },

    // ─── User Management (Admin only) ────────────────────────────────────
    _db: () => firebase.firestore(),
    _usersRef: () => firebase.firestore().collection('appData').doc('app_users'),

    getAllUsers: async () => {
        const snap = await Auth._usersRef().get();
        if (!snap.exists) return [];
        return snap.data().users || [];
    },

    saveAllUsers: async (users) => {
        await Auth._usersRef().set({ users }, { merge: false });
    },

    createUser: async ({ username, password, role, centerId, displayName }) => {
        const users = await Auth.getAllUsers();
        const uname = username.trim().toUpperCase();
        if (users.find(u => u.username.toUpperCase() === uname)) {
            throw new Error(`Username "${uname}" มีอยู่แล้ว`);
        }
        const hash = await Auth.sha256(password.trim());
        const VALID_ROLES = ['sales','supervisor','admin','route_supervisor','asm'];
        users.push({
            username:    uname,
            passwordHash: hash,
            role:        VALID_ROLES.includes(role) ? role : 'sales',
            centerId:    centerId || null,
            displayName: displayName || uname,
            active:      true,
            createdAt:   new Date().toISOString()
        });
        await Auth.saveAllUsers(users);
        return users;
    },

    updateUser: async (username, updates) => {
        const users = await Auth.getAllUsers();
        const idx   = users.findIndex(u => u.username.toUpperCase() === username.toUpperCase());
        if (idx === -1) throw new Error('ไม่พบ user นี้');
        // ถ้ามี password ใหม่ → hash ก่อน
        if (updates.password) {
            updates.passwordHash = await Auth.sha256(updates.password.trim());
            delete updates.password;
        }
        users[idx] = { ...users[idx], ...updates };
        await Auth.saveAllUsers(users);
        return users;
    },

    deleteUser: async (username) => {
        let users = await Auth.getAllUsers();
        // ห้ามลบ admin คนสุดท้าย
        const admins = users.filter(u => u.role === 'admin');
        if (admins.length === 1 && admins[0].username.toUpperCase() === username.toUpperCase()) {
            throw new Error('ไม่สามารถลบ Admin คนสุดท้ายได้');
        }
        users = users.filter(u => u.username.toUpperCase() !== username.toUpperCase());
        await Auth.saveAllUsers(users);
        return users;
    },

    // ─── Gen users จาก routeList อัตโนมัติ ──────────────────────────────
    // centerId: เช่น "402", routeList: ["402V01","402V02",...]
    // defaultPassword: password เริ่มต้นสำหรับ user ใหม่
    genUsersFromRoutes: async (centerId, routeList, defaultPassword = '1234') => {
        const users    = await Auth.getAllUsers();
        const existing = new Set(users.map(u => u.username.toUpperCase()));
        const hash     = await Auth.sha256(defaultPassword);
        let   added    = 0;

        for (const route of routeList) {
            const uname = route.toUpperCase();
            if (existing.has(uname)) continue;
            users.push({
                username:     uname,
                passwordHash: hash,
                role:         'sales',
                centerId:     centerId,
                displayName:  route,
                active:       true,
                createdAt:    new Date().toISOString()
            });
            existing.add(uname);
            added++;
        }

        if (added > 0) await Auth.saveAllUsers(users);
        return { added, total: users.length };
    },

    // ─── Change Password (self-service) ──────────────────────────────────
    // ตรวจ password เดิมก่อน แล้วค่อย hash + save ใหม่
    changePassword: async (oldPassword, newPassword) => {
        if (!oldPassword || !newPassword) throw new Error('กรุณากรอกข้อมูลให้ครบ');
        if (newPassword.length < 4)       throw new Error('Password ใหม่ต้องมีอย่างน้อย 4 ตัวอักษร');

        const session = Auth.getSession();
        if (!session) throw new Error('ไม่พบ session กรุณา login ใหม่');

        const oldHash = await Auth.sha256(oldPassword.trim());
        const newHash = await Auth.sha256(newPassword.trim());

        const users = await Auth.getAllUsers();
        const idx   = users.findIndex(u => u.username.toUpperCase() === session.username.toUpperCase());
        if (idx === -1) throw new Error('ไม่พบ user นี้ในระบบ');

        if (users[idx].passwordHash !== oldHash) throw new Error('Password เดิมไม่ถูกต้อง');

        users[idx].passwordHash = newHash;
        await Auth.saveAllUsers(users);
    },
    seedAdmin: async () => {
        const snap = await Auth._usersRef().get();
        // ถ้ามีข้อมูลแล้วไม่ต้อง seed
        if (snap.exists && (snap.data().users || []).length > 0) return false;

        const hash = await Auth.sha256('admin');
        await Auth._usersRef().set({
            users: [{
                username:     'ADMIN',
                passwordHash: hash,
                role:         'admin',
                centerId:     null,
                displayName:  'Super Admin',
                active:       true,
                createdAt:    new Date().toISOString()
            }]
        });
        return true;
    }
};

// api/optimize-route.js
// ══════════════════════════════════════════════════════════════════════
// Vercel Serverless Function — proxy ไปยัง OpenRouteService Optimization API
// (บริการฟรีที่ครอบ VROOM engine ไว้ให้ - ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง)
//
// ทำไมต้องมีไฟล์นี้คั่นกลาง (ไม่ยิงจากฝั่งเบราว์เซอร์ตรง ๆ):
//   1) ซ่อน ORS_API_KEY ไว้ฝั่งเซิร์ฟเวอร์ ไม่ให้หลุดไปกับโค้ดฝั่ง client
//   2) VROOM (เอนจินเบื้องหลัง ORS Optimization) บังคับให้ job id เป็นเลข
//      จำนวนเต็มเท่านั้น แต่รหัสร้านค้าในระบบนี้อาจเป็น string — ไฟล์นี้
//      แปลง id ร้านค้า -> เลขลำดับชั่วคราวก่อนส่ง แล้วแปลงกลับตอนได้ผลลัพธ์
//
// ต้องตั้งค่า Environment Variable บน Vercel ก่อนใช้งาน:
//   ORS_API_KEY = <API key จาก openrouteservice.org (สมัครฟรี)>
//
// รับ (POST body):
//   {
//     start: { lat, lng },              // จุดเริ่มต้นของสาย (บังคับ)
//     end:   { lat, lng } | null,       // จุดจบ - ใส่ค่าเดียวกับ start เพื่อ "กลับจุดเดิม"
//                                        // หรือ null/ไม่ใส่ = ปลายทางเปิด (จบที่ร้านสุดท้าย)
//     jobs:  [{ id, lat, lng }, ...],   // ร้านค้าที่ต้องแวะ (2-50 ร้าน)
//   }
//
// ส่งกลับ:
//   { order: [storeId, ...], distanceKm, durationMin }                    -> สำเร็จ
//   { order: [...], unassigned: [storeId,...], distanceKm, durationMin }  -> สำเร็จบางส่วน (บางร้านคำนวณไม่ได้)
//   { error: "ข้อความ" }                                                  -> ล้มเหลว
// ══════════════════════════════════════════════════════════════════════

const ORS_OPTIMIZATION_URL = 'https://api.openrouteservice.org/optimization';
const MAX_JOBS = 48; // เผื่อขอบเขต "50 locations/request" ของแผนฟรี ORS (jobs + จุดเริ่ม/จุดจบ)

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
        return;
    }

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ORS_API_KEY (Environment Variable บน Vercel)' });
        return;
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    const { start, end, jobs } = body || {};

    if (!start || typeof start.lat !== 'number' || typeof start.lng !== 'number') {
        res.status(400).json({ error: 'ไม่มีพิกัดจุดเริ่มต้น (start)' });
        return;
    }
    if (!Array.isArray(jobs) || jobs.length < 2) {
        res.status(400).json({ error: 'ต้องมีร้านค้าอย่างน้อย 2 ร้านจึงจะจัดลำดับได้' });
        return;
    }
    if (jobs.length > MAX_JOBS) {
        res.status(400).json({ error: `จำนวนร้าน (${jobs.length}) เกิน ${MAX_JOBS} แห่ง — ข้อจำกัดของแผนฟรี OpenRouteService ต่อคำขอ` });
        return;
    }
    for (const j of jobs) {
        if (typeof j.lat !== 'number' || typeof j.lng !== 'number' || Number.isNaN(j.lat) || Number.isNaN(j.lng)) {
            res.status(400).json({ error: `ร้าน "${j.id ?? '?'}" ไม่มีพิกัด (lat/lng) ที่ถูกต้อง` });
            return;
        }
    }

    // VROOM ต้องการ job id เป็น integer — map รหัสร้านค้าจริง <-> เลขลำดับชั่วคราว
    const idMap = jobs.map(j => j.id);
    const vroomJobs = jobs.map((j, idx) => ({
        id: idx,
        location: [j.lng, j.lat], // VROOM/ORS ใช้ลำดับ [lon, lat]
    }));

    // ✅ FIX (2026-09-04 — พบจากทดสอบจริงบน Vercel): เดิมไม่ส่ง profile เลย ทำให้ ORS
    // fallback เป็นค่าดิบ "car" ซึ่งไม่ใช่ชื่อ profile ที่ ORS รู้จัก (ต้องเป็น "driving-car"
    // เต็มรูปแบบ) reject กลับมาเป็น "Invalid profile: car." ทุกครั้ง
    const vehicle = { id: 1, profile: 'driving-car', start: [start.lng, start.lat] };
    if (end && typeof end.lat === 'number' && typeof end.lng === 'number') {
        vehicle.end = [end.lng, end.lat];
    }
    // ไม่ใส่ end = ปลายทางเปิด ปล่อยให้ VROOM จบที่ร้านสุดท้ายที่เหมาะสมที่สุด

    try {
        const orsRes = await fetch(ORS_OPTIMIZATION_URL, {
            method: 'POST',
            headers: {
                'Authorization': apiKey, // ORS ใช้คีย์ดิบตรง ๆ ใน header นี้ ไม่ต้องมี "Bearer "
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ jobs: vroomJobs, vehicles: [vehicle] }),
        });

        const data = await orsRes.json().catch(() => ({}));

        if (!orsRes.ok || data.code !== 0) {
            res.status(orsRes.ok ? 502 : orsRes.status).json({
                error: data.error || `OpenRouteService ตอบกลับผิดพลาด (HTTP ${orsRes.status})`,
            });
            return;
        }

        const route = (data.routes || [])[0];
        if (!route) {
            res.status(502).json({ error: 'ไม่พบเส้นทางที่คำนวณได้จากผลลัพธ์ของ OpenRouteService' });
            return;
        }

        const order = route.steps
            .filter(s => s.type === 'job')
            .map(s => idMap[s.id])
            .filter(id => id !== undefined);

        const unassigned = (data.unassigned || [])
            .map(u => idMap[u.id])
            .filter(id => id !== undefined);

        // ✅ NEW (2026-09-04): ส่ง distance/duration ของเส้นทางจริงกลับไปด้วย — VROOM คำนวณให้อยู่แล้ว
        // เดิมทิ้งไป ใช้แค่ order (สำหรับ "ระยะทางรวมของสาย" และเทียบระยะทางจริงระหว่างจุด)
        const result = { order };
        if (unassigned.length) result.unassigned = unassigned;
        if (typeof route.distance === 'number') result.distanceKm = +(route.distance / 1000).toFixed(2);
        if (typeof route.duration === 'number') result.durationMin = Math.round(route.duration / 60);

        res.status(200).json(result);
    } catch (e) {
        res.status(502).json({ error: 'เชื่อมต่อ OpenRouteService ไม่สำเร็จ: ' + e.message });
    }
};

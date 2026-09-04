// api/elevation.js
// ══════════════════════════════════════════════════════════════════════
// Vercel Serverless Function — proxy ไปยัง OpenRouteService Elevation Line API
// ใช้ดึงความสูง (เมตรจากระดับน้ำทะเล) ของร้านค้าหลายจุดพร้อมกัน เพื่อให้ AI จัดสาย
// (admin-ai.js) ใช้ตรวจจับพื้นที่ภูเขา/เนินสูงที่ระยะทางเส้นตรงมองไม่เห็น
//
// ทำไมต้องมีไฟล์นี้คั่นกลาง: เหตุผลเดียวกับ optimize-route.js — ซ่อน ORS_API_KEY
// ไว้ฝั่งเซิร์ฟเวอร์ ไม่ให้หลุดไปกับโค้ดฝั่ง client
//
// รับ (POST body): { points: [{ lat, lng }, ...] }   — สูงสุด 2,000 จุด/request (ข้อจำกัดของ ORS)
// ส่งกลับ: { elevations: [เมตร, ...] }  — เรียงลำดับตรงกับ points ที่ส่งมาเป๊ะ (ตัวไหนหาไม่ได้ = null)
//          { error: "ข้อความ" }          — ล้มเหลว
// ══════════════════════════════════════════════════════════════════════

const ORS_ELEVATION_URL = 'https://api.openrouteservice.org/elevation/line';
const MAX_POINTS = 2000; // ตามข้อจำกัดของ ORS Elevation service (vertex amount)

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
    const { points } = body || {};

    if (!Array.isArray(points) || points.length === 0) {
        res.status(400).json({ error: 'ไม่มีพิกัดที่จะขอความสูง (points)' });
        return;
    }
    if (points.length > MAX_POINTS) {
        res.status(400).json({ error: `จำนวนจุด (${points.length}) เกิน ${MAX_POINTS} จุด — ข้อจำกัดของ ORS Elevation ต่อคำขอ` });
        return;
    }
    for (const p of points) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || Number.isNaN(p.lat) || Number.isNaN(p.lng)) {
            res.status(400).json({ error: 'มีพิกัด lat/lng ที่ไม่ถูกต้องในรายการ' });
            return;
        }
    }

    try {
        const orsRes = await fetch(ORS_ELEVATION_URL, {
            method: 'POST',
            headers: {
                'Authorization': apiKey, // ORS ใช้คีย์ดิบตรง ๆ ใน header นี้ ไม่ต้องมี "Bearer "
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                format_in: 'geojson',
                format_out: 'geojson',
                geometry: {
                    type: 'LineString',
                    // ORS ใช้ลำดับ [lon, lat] — ยืมบริการ "เส้น" มาใช้ขอความสูงทีละหลายจุดพร้อมกัน
                    // (ไม่ได้สนใจว่าเป็นเส้นทางจริง แค่ต้องการความสูงของแต่ละจุดตามลำดับที่ส่งไป)
                    coordinates: points.map(p => [p.lng, p.lat]),
                },
            }),
        });

        const data = await orsRes.json().catch(() => ({}));

        if (!orsRes.ok) {
            const msg = (data.error && data.error.message) || data.error || `OpenRouteService ตอบกลับผิดพลาด (HTTP ${orsRes.status})`;
            res.status(orsRes.status).json({ error: msg });
            return;
        }

        const coords = data && data.geometry && data.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length !== points.length) {
            res.status(502).json({ error: 'ผลลัพธ์ความสูงจาก OpenRouteService ไม่ครบตามจำนวนจุดที่ส่งไป' });
            return;
        }

        const elevations = coords.map(c => (Array.isArray(c) && typeof c[2] === 'number') ? c[2] : null);
        res.status(200).json({ elevations });
    } catch (e) {
        res.status(502).json({ error: 'เชื่อมต่อ OpenRouteService ไม่สำเร็จ: ' + e.message });
    }
};

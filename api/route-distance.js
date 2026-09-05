// api/route-distance.js
// ══════════════════════════════════════════════════════════════════════
// Vercel Serverless Function — proxy ไปยัง OpenRouteService Directions API
//
// ต่างจาก api/optimize-route.js (ORS Optimization/VROOM) ตรงที่ไฟล์นี้ "ไม่จัดลำดับใหม่"
// เลย — รับลำดับจุดที่ "ตายตัวแล้ว" (เช่น ลำดับที่เซลล์ลากจัดเองในมือถือ หรือลำดับเดิมที่มีอยู่
// ก่อนแล้ว) แล้วแค่คำนวณระยะทาง/เวลาจริงของเส้นทางตามลำดับนั้นเป๊ะๆ ตามถนนจริง
//
// ใช้ตอนไหน: หน้า "📏 ระยะทางจริงต่อวัน" ต้องการเลขระยะทางจริง แต่ผู้ใช้ไม่ต้องการให้ระบบ
// จัดลำดับร้านใหม่ (เพราะจะไปขัดกับลำดับที่เซลล์จัดมาเองแล้วในสายที่ใช้งานจริงอยู่)
//
// ทำไมต้องมีไฟล์นี้คั่นกลาง: เหตุผลเดียวกับ optimize-route.js/elevation.js —
// ซ่อน ORS_API_KEY ไว้ฝั่งเซิร์ฟเวอร์ ไม่ให้หลุดไปกับโค้ดฝั่ง client
//
// รับ (POST body): { points: [{ lat, lng }, ...] }  — เรียงตามลำดับที่จะวิ่งจริง (รวมจุดเริ่ม/จุดจบ
//                    ที่ผู้เรียกต้องใส่มาในลิสต์เองแล้ว) — สูงสุด 50 จุด/request (ข้อจำกัดแผนฟรี ORS)
// ส่งกลับ: { distanceKm, durationMin }  — สำเร็จ
//          { error: "ข้อความ" }         — ล้มเหลว
// ══════════════════════════════════════════════════════════════════════

const ORS_DIRECTIONS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car';
const MAX_POINTS = 50;

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

    if (!Array.isArray(points) || points.length < 2) {
        res.status(400).json({ error: 'ต้องมีอย่างน้อย 2 จุด (จุดเริ่มต้น + ร้านอย่างน้อย 1 ร้าน)' });
        return;
    }
    if (points.length > MAX_POINTS) {
        res.status(400).json({ error: `จำนวนจุด (${points.length}) เกิน ${MAX_POINTS} จุด — ข้อจำกัดของแผนฟรี OpenRouteService ต่อคำขอ` });
        return;
    }
    for (const p of points) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || Number.isNaN(p.lat) || Number.isNaN(p.lng)) {
            res.status(400).json({ error: 'มีพิกัด lat/lng ที่ไม่ถูกต้องในรายการ' });
            return;
        }
    }

    try {
        const orsRes = await fetch(ORS_DIRECTIONS_URL, {
            method: 'POST',
            headers: {
                'Authorization': apiKey, // ORS ใช้คีย์ดิบตรง ๆ ใน header นี้ ไม่ต้องมี "Bearer "
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                coordinates: points.map(p => [p.lng, p.lat]), // ORS ใช้ลำดับ [lon, lat]
            }),
        });

        const data = await orsRes.json().catch(() => ({}));

        if (!orsRes.ok) {
            const msg = (data.error && (data.error.message || data.error)) || `OpenRouteService ตอบกลับผิดพลาด (HTTP ${orsRes.status})`;
            res.status(orsRes.status).json({ error: msg });
            return;
        }

        const route = (data.routes || [])[0];
        const summary = route && route.summary;
        if (!summary || typeof summary.distance !== 'number') {
            res.status(502).json({ error: 'ไม่พบระยะทางที่คำนวณได้จากผลลัพธ์ของ OpenRouteService' });
            return;
        }

        res.status(200).json({
            distanceKm: +(summary.distance / 1000).toFixed(2),
            durationMin: Math.round(summary.duration / 60),
        });
    } catch (e) {
        res.status(502).json({ error: 'เชื่อมต่อ OpenRouteService ไม่สำเร็จ: ' + e.message });
    }
};

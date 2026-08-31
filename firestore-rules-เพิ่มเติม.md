# Firestore Rules ที่ต้องเพิ่ม (สำหรับ 2 ฟีเจอร์ใหม่)

⚠️ **สำคัญ:** ผมไม่มีไฟล์ `firestore.rules` ปัจจุบันของคุณในเซสชันนี้ (ไม่เคยถูกอัปโหลด)
จึงไม่สามารถแก้ไขให้โดยตรงได้ — ด้านล่างนี้เป็น **แนวทาง** ที่ต้องเอาไปปรับให้เข้ากับ
โครงสร้าง rules เดิมของคุณเอง (ไปที่ Firebase Console → Firestore Database → Rules)

## 1) ฟีเจอร์ "ยืนยันรับสายวิ่ง" — เพิ่ม field ในเอกสารเดิม

เซลจะเขียน field ใหม่ 2 ตัว (`confirmedBy`, `confirmedAt`) ลงในเอกสารเดิมที่
`appData/{centerId}/plans/{ym}/routes/{routeId}` — **เอกสารเดียวกับที่เซลเขียน `stores`
อยู่แล้วทุกวัน** ดังนั้นถ้า rules เดิมของคุณอนุญาตให้เซลเขียนเอกสารนี้อยู่แล้ว
(เช่น อนุญาตตาม `request.auth != null` หรือเช็ค role) **ก็ไม่ต้องแก้อะไรเพิ่มเลย**
ฟีเจอร์นี้จะใช้ path และสิทธิ์เดิมที่มีอยู่แล้วทันที

ถ้า rules เดิมมีการจำกัด field ที่แก้ไขได้แบบเจาะจง (เช่นใช้ `request.resource.data.diff()`
บังคับว่าห้ามแก้ field อื่นนอกจาก `stores`) ให้เพิ่ม `confirmedBy`, `confirmedAt` เข้าไปใน
whitelist นั้นด้วย

## 2) ฟีเจอร์ "ขอย้ายวัน" — collection ใหม่ `moveRequests`

Path: `appData/{centerId}/moveRequests/{autoId}`

ตัวอย่าง rules (ปรับตัวแปร role/auth ให้ตรงกับระบบเดิมของคุณ):

```
match /appData/{centerId}/moveRequests/{reqId} {
  // เซล/แอดมิน/หัวหน้างาน ที่ login แล้ว อ่านได้ (ใช้แสดงประวัติ/แจ้งเตือน)
  allow read: if request.auth != null;

  // สร้างคำขอใหม่ได้ (เซล/แอดมิน/หัวหน้างานทุกคนตามที่ตกลงกัน)
  // บังคับว่าตอนสร้างต้อง status = 'pending' เท่านั้น กันคนยิง status อื่นเข้ามาตรงๆ
  allow create: if request.auth != null
                && request.resource.data.status == 'pending';

  // อัปเดตได้เฉพาะตอนอนุมัติ/ปฏิเสธ (ฝั่งแอดมินเท่านั้น) — ปรับเงื่อนไข role ตามระบบเดิม
  allow update: if request.auth != null
                && request.auth.token.role == 'admin'; // หรือเช็คตามที่ระบบเดิมใช้เช็ค role แอดมิน

  allow delete: if false;
}
```

**หมายเหตุ:** ถ้าระบบเดิมของคุณเช็ค role จาก custom claims (`request.auth.token.role`)
คนละแบบ (เช่นเช็คจากเอกสาร users แทน) ให้เปลี่ยนเงื่อนไข `allow update` ให้ตรงกับ
Pattern เดิมที่ใช้อยู่ในไฟล์ rules ของคุณ — ผมใส่ตัวอย่างไว้แบบกว้างๆ เพื่อให้เอาไป
ปรับต่อได้ง่าย

**แนะนำ:** ก่อน deploy จริง ให้ทดสอบใน Firebase Rules Playground หรือทดสอบกับ
แอคเคาท์เซลจริง 1 คนก่อน เพราะถ้า rules ไม่ครบ ฟีเจอร์ใหม่จะขึ้น
"permission-denied" (ระบบจะแปลเป็นข้อความ "ไม่มีสิทธิ์ทำรายการนี้" ให้อัตโนมัติอยู่แล้ว
จาก ErrorMsg ที่มีในระบบ)

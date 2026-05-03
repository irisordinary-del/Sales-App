# 📋 Upload Checklist - Route Planner Admin

## 🔧 Files Modified (9 files)

### ✅ **MUST UPLOAD (แก้แล้ว):**

| # | File | Size | Change |
|---|------|------|--------|
| 1 | `index.html` | 26K | ✨ เพิ่ม App controller, ลบ page-data & page-kpi |
| 2 | `app-config.js` | 2.1K | 🔌 เพิ่ม offline persistence |
| 3 | `admin-data.js` | 32K | 🗑️ เพิ่ม clearAllAssignments with error handling |
| 4 | `admin-ui.js` | 14K | 🧭 ลบ page-data/kpi logic จาก Nav.go() |
| 5 | `admin-map.js` | 12K | ✅ No change |
| 6 | `admin-ai.js` | 9.2K | ✅ No change |
| 7 | `file-manager.js` | 8.6K | 📂 Upload & Export function |
| 8 | `admin-style.css` | 2.8K | ✅ No change |
| 9 | `FEATURES_IMPLEMENTATION.js` | 5.4K | ✅ No change |

---

## 📁 **How to Upload to GitHub:**

### **Step 1: Delete old files from GitHub**
```bash
# On GitHub: Delete all files in repo
# Then commit empty repo
```

### **Step 2: Upload 9 files to GitHub**
```
Drag & drop ทั้ง 9 ไฟล์ลงใน GitHub
หรือ
git add .
git commit -m "Route Planner Admin v2 - Offline support, Clear button, Export template"
git push origin main
```

### **Step 3: Deploy via Vercel**
```
Vercel auto-detect → Deploy ✅
(ใช้เวลา 1-2 นาที)
```

---

## ✨ **Features ที่เพิ่มเข้ามา:**

```
✅ Offline mode - ทำงานแม้ไม่มี internet
✅ Auto sync - เมื่อ internet กลับมา
✅ Clear button - ลบการจัดสายทั้งหมด
✅ Export template - Export เหมือน upload format
✅ Upload route file - Load ร้านค้าจากไฟล์
✅ Delete page - ลบ Raw Data & KPI
```

---

## 🎯 **โครงสร้าง:**

```
Route Planner Admin
├── 📍 วางแผนคิวงาน (Planning)
│   ├─ Tab 1: ข้อมูลพิกัด
│   ├─ Tab 2: จัดสาย (+ Clear button)
│   ├─ Tab 3: แก้ไข
│   └─ Tab 4: สรุป
├── 📂 Upload/Export
│   ├─ 📂 Upload file (.xlsx)
│   └─ 💾 Export template (.xlsx)
├── 🤖 AI Route Builder
│   └─ Auto assign stores to days
└── 🗺️ Map
    ├─ Markers + Popup
    ├─ Lasso selection
    └─ Route visualization
```

---

## 📝 **Test Checklist:**

```
After Upload to GitHub & Deploy:

[ ] 1. Open web app
[ ] 2. 📂 Upload Route_Plan file
[ ] 3. See map with markers
[ ] 4. Go to Tab 2 (จัดสาย)
[ ] 5. Click 🗑️ Clear button
[ ] 6. Confirm dialog
[ ] 7. All assignments cleared ✅
[ ] 8. Click 💾 Export
[ ] 9. Get Excel file
[ ] 10. Offline test (turn off internet)
[ ] 11. Can still click Clear
[ ] 12. Turn internet back on
[ ] 13. Data syncs to Firestore ✅
```

---

## 🔗 **GitHub Upload URL:**

```
https://github.com/irisordinary-del/Sales-App
```

---

## ✅ **Ready!**

All files are in `/mnt/user-data/outputs/`

Upload them to GitHub now! 🚀

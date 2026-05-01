// ==========================================
// 📂 Upload & Parse Route Plan File
// ==========================================
const FileManager = {
    // Parse uploaded Excel file
    uploadRouteFile: async (file) => {
        try {
            if (!file) return;
            
            UI.showLoader('📂 กำลังอ่านไฟล์...', file.name);
            
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { header: 'A' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
            
            // Parse Excel columns: A-L
            // A=CY(skip), B=Code, C=Name, D=SalesCode, E=Type, F=SubDistrict, G=District, H=Province, I=Lat, J=Lng, K=Market, L=DayHistory
            const stores = [];
            
            rows.forEach((row, idx) => {
                // Skip header row and empty rows
                if (!row.B || idx === 0) return;
                
                const lat = parseFloat(row.I);
                const lng = parseFloat(row.J);
                
                // Validate lat/lng
                if (isNaN(lat) || isNaN(lng)) {
                    console.warn(`Row ${idx}: Missing lat/lng for ${row.C}`);
                    return;
                }
                
                stores.push({
                    id: row.B,
                    code: row.B || '',
                    name: row.C || '',
                    salesCode: row.D || '',
                    shopType: row.E || '',
                    subDistrict: row.F || '',
                    district: row.G || '',
                    province: row.H || '',
                    lat: lat,
                    lng: lng,
                    marketName: row.K || '',
                    dayOriginal: row.L || '', // Keep original day history
                    days: [], // Will be filled after AI or manual assignment
                    seqs: {},
                    freq: 1,
                    selected: false
                });
            });
            
            if (stores.length === 0) {
                UI.hideLoader();
                UI.showErrorToast('⚠️ ไม่พบข้อมูลร้านค้า');
                return;
            }
            
            // Create route name from sales code
            const routeName = `Route_${stores[0].salesCode?.substring(0, 3) || 'NEW'}`;
            
            // Store to State
            State.db.routes[routeName] = stores;
            State.localActiveRoute = routeName;
            State.stores = stores;
            
            // Update UI
            const selector = document.getElementById('routeSelector');
            if (selector) {
                selector.innerHTML = Object.keys(State.db.routes)
                    .map(r => `<option value="${r}" ${r === routeName ? 'selected' : ''}>${r}</option>`)
                    .join('');
            }
            
            UI.hideLoader();
            UI.showSaveToast(`✅ อัพโหลด: ${stores.length} แถว`);
            
            // Render map
            UI.render();
            if (MapCtrl && MapCtrl.map) {
                setTimeout(() => MapCtrl.fitToStores(), 300);
            }
            
            // Switch to planning tab
            Nav.go('planning');
            
        } catch(err) {
            UI.hideLoader();
            console.error('❌ Upload error:', err);
            UI.showErrorToast('❌ อ่านไฟล์ไม่สำเร็จ: ' + err.message);
        }
    },
    
    // Export route data back to template format
    exportTemplate: async () => {
        try {
            if (!State.localActiveRoute) {
                alert('⚠️ กรุณาเลือกสายวิ่งก่อนครับ');
                return;
            }
            
            if (State.stores.length === 0) {
                alert('⚠️ ไม่มีข้อมูลร้านค้าในสายนี้');
                return;
            }
            
            UI.showLoader('💾 กำลังสร้างไฟล์ Excel...', 'กำลังเตรียมข้อมูล');
            
            // Create export data array
            const exportData = State.stores.map(store => ({
                'A': '', // CY (skip)
                'B': store.code || store.id,
                'C': store.name,
                'D': store.salesCode || '',
                'E': store.shopType || '',
                'F': store.subDistrict || '',
                'G': store.district || '',
                'H': store.province || '',
                'I': store.lat,
                'J': store.lng,
                'K': store.marketName || '',
                'L': store.dayOriginal || '', // Original day history (keep as is)
                'M': '', // Day 05 (DELETE - ให้ว่าง)
                'N': store.days.length > 0 ? store.days[0] : '' // New planned day (can edit)
            }));
            
            // Create worksheet
            const ws = XLSX.utils.json_to_sheet(exportData, {
                header: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']
            });
            
            // Add header row
            ws['A1'] = 'CY';
            ws['B1'] = 'Store Code';
            ws['C1'] = 'Store Name';
            ws['D1'] = 'Sales Rep Code';
            ws['E1'] = 'Shop Type';
            ws['F1'] = 'Sub-district';
            ws['G1'] = 'District';
            ws['H1'] = 'Province';
            ws['I1'] = 'Latitude';
            ws['J1'] = 'Longitude';
            ws['K1'] = 'Market Name';
            ws['L1'] = 'Day (Original)';
            ws['M1'] = 'Day 05 (DELETE)';
            ws['N1'] = 'Day (New Result)';
            
            // Set column widths
            ws['!cols'] = [
                { wch: 5 },   // A
                { wch: 12 },  // B
                { wch: 20 },  // C
                { wch: 15 },  // D
                { wch: 15 },  // E
                { wch: 15 },  // F
                { wch: 15 },  // G
                { wch: 15 },  // H
                { wch: 12 },  // I
                { wch: 12 },  // J
                { wch: 20 },  // K
                { wch: 12 },  // L
                { wch: 5 },   // M
                { wch: 12 }   // N
            ];
            
            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Route Plan');
            
            // Generate filename with date
            const now = new Date();
            const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const filename = `Route_Plan_${State.localActiveRoute}_${dateStr}.xlsx`;
            
            // Save file
            XLSX.writeFile(wb, filename);
            
            UI.hideLoader();
            UI.showSaveToast(`✅ Export: ${filename}`);
            
        } catch(err) {
            UI.hideLoader();
            console.error('❌ Export error:', err);
            UI.showErrorToast('❌ Export ไม่สำเร็จ: ' + err.message);
        }
    }
};

// ==========================================
// 🔗 File Input Event Listeners
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // File upload handler
    const fileUploadEl = document.getElementById('fileUpload');
    if (fileUploadEl) {
        fileUploadEl.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                FileManager.uploadRouteFile(e.target.files[0]);
            }
        });
    }
    
    // Export button
    const exportBtn = document.querySelector('button[onclick*="exportTemplate"]');
    if (!exportBtn) {
        // Create export button if not exists
        const headerBtn = document.querySelector('[class*="planning"] .h-16');
        if (headerBtn) {
            const btn = document.createElement('button');
            btn.onclick = () => FileManager.exportTemplate();
            btn.className = 'bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md transition ml-2';
            btn.innerHTML = '💾 Export Template';
            headerBtn.appendChild(btn);
        }
    }
});

console.log('✅ FileManager loaded');

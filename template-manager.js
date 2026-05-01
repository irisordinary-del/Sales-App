/**
 * ===================================================================
 * ROUTE TEMPLATE EXPORT/IMPORT MANAGER
 * ===================================================================
 * 
 * Feature: Export route data back to Excel template format
 * - Upload template: Route_Plan_402_12_Route_052026.xlsx
 * - Process: Parse columns B-K + L (history) → FB
 * - Export: Save B-K + L (old) + N (new) to Excel
 * 
 * Columns:
 * A = CY (skip)
 * B = Store Code
 * C = Store Name
 * D = Sales Rep Code (Sales column)
 * E = Shop Type
 * F = Sub-district
 * G = District
 * H = Province
 * I = Latitude
 * J = Longitude
 * K = Market Name
 * L = Day (Original/History)
 * M = Day 05 (DELETE - เดิม)
 * N = Day XX (NEW - ผลลัพธ์ใหม่)
 * 
 * ===================================================================
 */

const TemplateManager = {
    // Template columns definition
    TEMPLATE_COLUMNS: {
        'A': { name: 'CY', skip: true },
        'B': { name: 'Store Code', index: 'code' },
        'C': { name: 'Store Name', index: 'name' },
        'D': { name: 'Sales Rep Code', index: 'salesCode' },
        'E': { name: 'Shop Type', index: 'shopType' },
        'F': { name: 'Sub-district', index: 'subDistrict' },
        'G': { name: 'District', index: 'district' },
        'H': { name: 'Province', index: 'province' },
        'I': { name: 'Latitude', index: 'lat' },
        'J': { name: 'Longitude', index: 'lon' },
        'K': { name: 'Market Name', index: 'marketName' },
        'L': { name: 'Day (Original)', index: 'dayOriginal' },
        'M': { name: 'Day 05 (DELETE)', skip: true },
        'N': { name: 'Day (New Result)', index: 'dayNew' }
    },
    
    /**
     * IMPORT: Parse uploaded template file
     */
    importTemplateFile: async (file) => {
        try {
            UI.showLoader('กำลังอ่าน Template...', file.name);
            
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { header: 'A' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
            
            // Parse template data
            const stores = [];
            rows.forEach((row, idx) => {
                if(!row.B || idx === 0) return; // Skip header and empty rows
                
                stores.push({
                    id: row.B,
                    code: row.B,
                    name: row.C || '',
                    salesCode: row.D || '',
                    shopType: row.E || '',
                    subDistrict: row.F || '',
                    district: row.G || '',
                    province: row.H || '',
                    lat: parseFloat(row.I) || 0,
                    lon: parseFloat(row.J) || 0,
                    marketName: row.K || '',
                    dayOriginal: row.L || '', // Keep history
                    dayNew: '', // Will be filled after planning
                    days: [], // Will be filled after AI assignment
                    seqs: {},
                    freq: 1,
                    selected: false
                });
            });
            
            UI.hideLoader();
            return stores;
            
        } catch(err) {
            UI.hideLoader();
            console.error('Template import error:', err);
            throw err;
        }
    },
    
    /**
     * EXPORT: Save planned routes back to template format
     */
    exportToTemplate: async (routeName) => {
        try {
            UI.showLoader('กำลังสร้าง Excel...', 'Preparing export');
            
            const stores = State.stores; // Current route stores
            
            // Create data array matching template structure
            const exportData = stores.map(store => ({
                'A': '', // CY - skip
                'B': store.code || store.id,
                'C': store.name,
                'D': store.salesCode || '',
                'E': store.shopType || '',
                'F': store.subDistrict || '',
                'G': store.district || '',
                'H': store.province || '',
                'I': store.lat,
                'J': store.lon,
                'K': store.marketName || '',
                'L': store.dayOriginal || '', // Keep original history
                'M': '', // Skip old Day 05
                'N': store.days.length > 0 ? store.days[0] : '' // New planned day
            }));
            
            // Create worksheet
            const ws = XLSX.utils.json_to_sheet(exportData, { header: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'] });
            
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
            ws['N1'] = 'Day (New)';
            
            // Set column widths
            ws['!cols'] = [
                { wch: 5 }, // A
                { wch: 12 }, // B
                { wch: 20 }, // C
                { wch: 15 }, // D
                { wch: 15 }, // E
                { wch: 15 }, // F
                { wch: 15 }, // G
                { wch: 15 }, // H
                { wch: 12 }, // I
                { wch: 12 }, // J
                { wch: 20 }, // K
                { wch: 12 }, // L
                { wch: 5 }, // M
                { wch: 12 } // N
            ];
            
            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Route Plan');
            
            // Generate filename with date
            const date = new Date();
            const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
            const filename = `Route_Plan_${routeName}_${dateStr}.xlsx`;
            
            // Save file
            XLSX.writeFile(wb, filename);
            
            UI.hideLoader();
            UI.showSaveToast(`✅ Export: ${filename}`);
            
            // Also update Firebase with new day results
            await TemplateManager.syncNewDaysToDatabase(stores);
            
        } catch(err) {
            UI.hideLoader();
            console.error('Export error:', err);
            UI.showSaveToast('❌ Export ไม่สำเร็จ');
        }
    },
    
    /**
     * Sync newly planned days to Firebase
     */
    syncNewDaysToDatabase: async (stores) => {
        try {
            // Update current route in State.db.routes
            State.stores = stores;
            
            // Save to Firebase
            await DB.save();
            
            console.log('✅ Database synced with new days');
            UI.showSaveToast('✅ บันทึก Database เสร็จ');
            
        } catch(err) {
            console.error('Sync error:', err);
        }
    },
    
    /**
     * Create versioned backup in Firebase
     */
    createVersionedBackup: async (routeName, version) => {
        try {
            const backupPath = `appData/v1_main/route_versions/${routeName}/${version}`;
            const backupData = {
                routeName: routeName,
                timestamp: new Date().toISOString(),
                version: version,
                stores: State.stores,
                metadata: {
                    totalStores: State.stores.length,
                    assignedStores: State.stores.filter(s => s.days.length > 0).length,
                    unassignedStores: State.stores.filter(s => !s.days.length).length
                }
            };
            
            await firebase.firestore().doc(backupPath).set(backupData);
            console.log(`✅ Backup created: ${backupPath}`);
            
        } catch(err) {
            console.error('Backup error:', err);
        }
    },
    
    /**
     * Get version history of a route
     */
    getVersionHistory: async (routeName) => {
        try {
            const snapshot = await firebase.firestore()
                .collection(`appData/v1_main/route_versions/${routeName}`)
                .orderBy('timestamp', 'desc')
                .limit(10)
                .get();
            
            return snapshot.docs.map(doc => ({
                version: doc.id,
                ...doc.data()
            }));
            
        } catch(err) {
            console.error('Get history error:', err);
            return [];
        }
    }
};

// ==================== UI INTEGRATION ====================

// Add export button to UI
const addExportButton = () => {
    const header = document.querySelector('[class*="planning"] .h-16');
    if(!header || header.querySelector('#export-template-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'export-template-btn';
    btn.className = 'bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md transition';
    btn.innerHTML = '💾 Export Template';
    btn.onclick = () => {
        const routeName = document.getElementById('routeSelector').value;
        if(routeName) {
            TemplateManager.exportToTemplate(routeName);
        } else {
            alert('กรุณาเลือกสาย');
        }
    };
    
    header.querySelector('[class*="flex-1 flex"]')?.parentElement?.appendChild(btn);
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(addExportButton, 500);
});

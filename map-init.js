// ==================== FORCE MAP INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🗺️ Page loaded - initializing map...');
    
    // Small delay to ensure all scripts loaded
    setTimeout(() => {
        // Check if map div exists
        const mapDiv = document.getElementById('map');
        if (!mapDiv) {
            console.error('❌ Map div not found!');
            return;
        }
        
        // Ensure map div has size
        mapDiv.style.width = '100%';
        mapDiv.style.height = '100%';
        mapDiv.style.position = 'relative';
        
        console.log('✅ Map div configured');
        
        // Check if Leaflet loaded
        if (typeof L === 'undefined') {
            console.error('❌ Leaflet not loaded!');
            return;
        }
        
        // Check if MapCtrl exists
        if (typeof MapCtrl === 'undefined') {
            console.error('❌ MapCtrl not loaded!');
            return;
        }
        
        console.log('✅ MapCtrl ready:', MapCtrl);
        
        // Try to initialize map
        if (!MapCtrl.map) {
            try {
                console.log('🗺️ Calling MapCtrl.init()...');
                MapCtrl.init();
                console.log('✅ Map initialized!', MapCtrl.map);
            } catch(err) {
                console.error('❌ MapCtrl.init() failed:', err);
            }
        } else {
            console.log('✅ Map already initialized');
        }
        
    }, 1000); // Wait 1 second for all scripts
    
    // Also init when switching to planning tab
    document.addEventListener('click', (e) => {
        if (e.target.onclick?.toString().includes('planning')) {
            setTimeout(() => {
                if (MapCtrl && !MapCtrl.map) {
                    console.log('🗺️ Initializing map on tab switch...');
                    MapCtrl.init();
                }
            }, 100);
        }
    });
});

// Also listen for visibility change (when tab becomes visible)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        console.log('📱 Page visible - checking map...');
        if (typeof MapCtrl !== 'undefined' && !MapCtrl.map) {
            setTimeout(() => {
                MapCtrl.init();
                console.log('✅ Map re-initialized on visibility');
            }, 100);
        }
    }
});

console.log('✅ Map initialization script loaded');

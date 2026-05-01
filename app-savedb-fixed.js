/**
 * App.saveDB - Fixed Version
 * Proper Firestore write pattern
 */

if (!window.App) window.App = {};

window.App.saveDB = async function() {
    try {
        console.log('💾 Saving routes to Firestore...');
        const db = firebase.firestore();
        
        // Save each route
        for (let routeName in State.db.routes) {
            const stores = State.db.routes[routeName];
            
            // Path: appData/v1_main/routes/Route_402
            const routeRef = db
                .collection('appData')
                .doc('v1_main')
                .collection('routes')
                .doc(routeName);
            
            // Use set with merge to create or update
            await routeRef.set({
                routeName: routeName,
                storeCount: stores.length,
                stores: stores,
                updatedAt: new Date(),
                createdAt: new Date()
            }, { merge: true });
            
            console.log(`✅ Saved: ${routeName} (${stores.length} stores)`);
        }
        
        console.log('✅ All routes saved!');
        return true;
        
    } catch(err) {
        console.error('❌ saveDB error:', err);
        alert('❌ Save failed: ' + err.message);
        return false;
    }
};

console.log('✅ App.saveDB (fixed) loaded');

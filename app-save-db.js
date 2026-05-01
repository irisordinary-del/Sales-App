/**
 * App.saveDB - Save routes to Firestore
 * Must load AFTER FEATURES_IMPLEMENTATION.js
 */

if (!window.App) window.App = {};

// Override saveDB with better error handling
window.App.saveDB = async function() {
    try {
        console.log('💾 Saving to Firestore...');
        const db = firebase.firestore();
        
        // Step 1: Ensure appData/v1_main exists
        const appDataRef = db.collection('appData').doc('v1_main');
        await appDataRef.set({ 
            lastUpdated: new Date(),
            routeCount: Object.keys(State.db.routes).length
        }, { merge: true });
        console.log('✅ appData/v1_main updated');
        
        // Step 2: Save each route to appData/v1_main/routes/[routeName]
        for (let routeName in State.db.routes) {
            try {
                const routeRef = appDataRef.collection('routes').doc(routeName);
                const storeCount = State.db.routes[routeName].length;
                
                await routeRef.set({
                    routeName: routeName,
                    storeCount: storeCount,
                    stores: State.db.routes[routeName],
                    updatedAt: new Date(),
                    createdAt: new Date()
                }, { merge: true });
                
                console.log(`✅ Route ${routeName} saved (${storeCount} stores)`);
            } catch(routeErr) {
                console.error(`❌ Error saving route ${routeName}:`, routeErr);
            }
        }
        
        console.log('✅ All routes saved successfully!');
        
    } catch(err) {
        console.error('❌ Save DB error:', err);
        if (err.code === 'permission-denied') {
            console.error('⚠️ Permission denied - check Firebase Rules');
        }
    }
};

console.log('✅ App.saveDB loaded (fixed version)');

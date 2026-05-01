/**
 * Load Routes from Firestore
 * Run on page load
 */

if (!window.App) window.App = {};

window.App.loadRoutes = async function() {
    try {
        console.log('📂 Loading routes from Firestore...');
        const db = firebase.firestore();
        const routesRef = db.collection('appData').doc('v1_main').collection('routes');
        
        const snapshot = await routesRef.get();
        
        snapshot.forEach(doc => {
            const routeName = doc.id;
            const data = doc.data();
            State.db.routes[routeName] = data.stores || [];
            console.log(`✅ Loaded: ${routeName} (${data.stores?.length || 0} stores)`);
        });
        
        // Set first route as active
        const routes = Object.keys(State.db.routes);
        if (routes.length > 0) {
            State.localActiveRoute = routes[0];
            State.stores = State.db.routes[routes[0]];
        }
        
        console.log(`✅ Total routes loaded: ${routes.length}`);
        
        // Refresh selector
        if (window.App.refreshRouteSelector) App.refreshRouteSelector();
        
    } catch(err) {
        console.error('❌ Load routes error:', err);
    }
};

// Load on startup
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.App.loadRoutes) App.loadRoutes();
    }, 1000);
});

console.log('✅ Route loader initialized');

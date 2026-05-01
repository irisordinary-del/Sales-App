// Load routes from Firestore on startup
setTimeout(() => {
    if (window.App && window.App.loadRoutes) {
        App.loadRoutes = async function() {
            try {
                console.log('📂 Loading routes from Firestore...');
                const db = firebase.firestore();
                const routesRef = db.collection('appData').doc('v1_main').collection('routes');
                const snapshot = await routesRef.get();
                
                snapshot.forEach(doc => {
                    State.db.routes[doc.id] = doc.data().stores || [];
                });
                
                const routes = Object.keys(State.db.routes);
                if (routes.length > 0) {
                    State.localActiveRoute = routes[0];
                    State.stores = State.db.routes[routes[0]];
                }
                
                if (App.refreshRouteSelector) App.refreshRouteSelector();
                console.log(`✅ ${routes.length} routes loaded`);
            } catch(err) {
                console.error('❌ Load error:', err);
            }
        };
        App.loadRoutes();
    }
}, 1500);

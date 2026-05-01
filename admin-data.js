const AdminData = {
    updateState: (key, value) => {
        State[key] = value;
    },
    
    addStore: (store) => {
        if (!State.stores.find(s => s.id === store.id)) {
            State.stores.push(store);
        }
    },
    
    updateStore: (storeId, updates) => {
        const store = State.stores.find(s => s.id === storeId);
        if (store) Object.assign(store, updates);
    },
    
    removeStore: (storeId) => {
        State.stores = State.stores.filter(s => s.id !== storeId);
    },
    
    getStore: (storeId) => {
        return State.stores.find(s => s.id === storeId);
    },
    
    filterStores: (predicate) => {
        return State.stores.filter(predicate);
    }
};

console.log('✅ AdminData loaded');

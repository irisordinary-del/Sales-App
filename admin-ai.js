const AI = {
    run: async function() {
        console.log('🤖 Running AI optimization...');
        
        if (State.stores.length === 0) {
            alert('No stores to optimize');
            return;
        }
        
        const days = parseInt(document.getElementById('ai-days')?.value || 24);
        const unassigned = State.stores.filter(s => s.days.length === 0);
        
        if (unassigned.length === 0) {
            alert('All stores already assigned');
            return;
        }
        
        const perDay = Math.ceil(unassigned.length / days);
        let dayIndex = 1;
        
        unassigned.forEach((store, idx) => {
            const dayName = `Day ${dayIndex}`;
            store.days = [dayName];
            store.seqs = {[dayName]: idx % perDay + 1};
            
            if ((idx + 1) % perDay === 0) dayIndex++;
        });
        
        UI.showSaveToast(`✅ Optimized: ${unassigned.length} stores`);
        UI.render();
        if (App.saveDB) await App.saveDB();
    }
};

console.log('✅ AI loaded');
